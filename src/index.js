import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import multer from "multer";
import { createRealtimeServer } from "./realtime.js";
import { createUserSupabaseClient } from "./supabase.js";
import { requireAuth, verifyAuthToken } from "./auth.js";

const app = express();
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  : true;
const corsOriginSetting =
  Array.isArray(corsOrigins) && corsOrigins.length === 0 ? true : corsOrigins;
app.use(
  cors({
    origin: corsOriginSetting,
    credentials: true
  })
);
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

const now = () => new Date().toISOString();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || "trpg-assets";
const DEFAULT_TOKEN_SIZE = 64;
const DEFAULT_TOKEN_PRIORITY = 0;

const parseNumberField = (value) => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
};
const parsePositiveInt = (value, fallback) => {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return { ok: false };
  return { ok: true, value: Math.round(parsed) };
};
const parsePriority = (value, fallback) => {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: Math.round(parsed) };
};
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const handleSupabaseError = (res, error) =>
  res.status(500).json({ error: error?.message ?? "database error" });

const getUserClient = (req) => createUserSupabaseClient(req.accessToken);

const ensureParticipant = async (client, sessionId, userId) => {
  const { data, error } = await client
    .from("session_participants")
    .select("id, role")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error };
  }
  if (!data) {
    return { ok: false, status: 403 };
  }
  return { ok: true, participant: data };
};

const fetchChatTabById = async (client, tabId) => {
  const { data, error } = await client
    .from("chat_tabs")
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .eq("id", tabId)
    .maybeSingle();
  if (error) return { error };
  return { data };
};

const fetchDefaultChatTab = async (client, sessionId) => {
  const { data, error } = await client
    .from("chat_tabs")
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .eq("session_id", sessionId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { error };
  return { data };
};

const resolveChatTab = async (client, sessionId, tabId, participant, userId) => {
  if (tabId) {
    const { data, error } = await fetchChatTabById(client, tabId);
    if (error) return { error };
    if (!data || data.session_id !== sessionId) {
      return { error: { message: "chat tab not found" }, status: 404 };
    }
    if (!userCanViewTab(data, participant, userId)) {
      return { error: { message: "forbidden" }, status: 403 };
    }
    return { data };
  }

  const { data, error } = await fetchDefaultChatTab(client, sessionId);
  if (error) return { error };
  if (!data) {
    return { error: { message: "chat tab not found" }, status: 404 };
  }
  if (!userCanViewTab(data, participant, userId)) {
    return { error: { message: "forbidden" }, status: 403 };
  }
  return { data };
};

const fetchSceneSteps = async (client, sceneId) => {
  const { data, error } = await client
    .from("scene_steps")
    .select("id, scene_id, place_id, pattern_id, position, created_at")
    .eq("scene_id", sceneId)
    .order("position", { ascending: true });

  if (error) return { error };
  return { data: data ?? [] };
};

const fetchPatternById = async (client, patternId) => {
  if (!patternId) return { data: null };
  const { data, error } = await client
    .from("place_patterns")
    .select("id, place_id, name, background_url")
    .eq("id", patternId)
    .maybeSingle();
  if (error) return { error };
  return { data };
};

const normalizeVisibility = (value) =>
  ["private", "link", "public"].includes(value) ? value : "private";

const createJoinToken = () => randomBytes(16).toString("hex");
const sanitizeFilename = (value = "upload") =>
  value.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 80) || "upload";
const normalizeUploadCategory = (value) => {
  const allowed = ["background", "token", "character", "avatar"];
  return allowed.includes(value) ? value : "misc";
};
const buildStoragePath = (userId, filename, category) => {
  const safeCategory = normalizeUploadCategory(category);
  return `uploads/${userId}/${safeCategory}/${randomUUID()}-${sanitizeFilename(
    filename
  )}`;
};
const normalizeAllowedRoles = (roles) => {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};
const normalizeAllowedUsers = (users) => {
  if (!Array.isArray(users)) return [];
  return users
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
};
const userCanViewTab = (tab, participant, userId) => {
  if (!tab) return false;
  const roles = tab.allowed_roles || [];
  const users = tab.allowed_users || [];
  if (roles.length === 0 && users.length === 0) return true;
  if (userId && users.includes(userId)) return true;
  if (participant?.role && roles.includes(participant.role)) return true;
  return false;
};
const upsertBoardBackground = async (client, sessionId, backgroundUrl) => {
  const { data: existing, error: existingError } = await client
    .from("boards")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingError) {
    return { error: existingError };
  }

  const updatedAt = now();
  if (existing) {
    const { data, error } = await client
      .from("boards")
      .update({
        background_url: backgroundUrl ?? null,
        updated_at: updatedAt
      })
      .eq("id", existing.id)
      .select(
        "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
      )
      .single();

    if (error) {
      return { error };
    }
    emitChange("boards", "update", data);
    return { data };
  }

  const { data, error } = await client
    .from("boards")
    .insert({
      id: randomUUID(),
      session_id: sessionId,
      background_url: backgroundUrl ?? null,
      updated_at: updatedAt
    })
    .select(
      "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
    )
    .single();

  if (error) {
    return { error };
  }

  emitChange("boards", "insert", data);
  return { data };
};

const realtime = createRealtimeServer(server, {
  verifyToken: verifyAuthToken,
  isParticipant: async (accessToken, sessionId, userId) => {
    const client = createUserSupabaseClient(accessToken);
    const result = await ensureParticipant(client, sessionId, userId);
    return result.ok;
  }
});

const emitChange = (table, action, record) => {
  realtime.broadcast({
    type: "change",
    table,
    action,
    record
  });
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/me", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: profile, error } = await client
    .from("profiles")
    .select("id, name, tagline, avatar_url, updated_at")
    .eq("id", req.user.id)
    .maybeSingle();

  if (error) {
    return handleSupabaseError(res, error);
  }
  if (profile) {
    return res.json(profile);
  }

  const fallbackName =
    req.user.user_metadata?.name || req.user.email || "Unknown";
  const record = {
    id: req.user.id,
    name: fallbackName,
    tagline: null,
    avatar_url: null,
    updated_at: now()
  };

  const { data: inserted, error: insertError } = await client
    .from("profiles")
    .insert(record)
    .select("id, name, tagline, avatar_url, updated_at")
    .single();

  if (insertError) {
    return handleSupabaseError(res, insertError);
  }

  return res.status(201).json(inserted);
});

app.patch("/me", requireAuth, async (req, res) => {
  const { name, tagline, avatar_url: avatarUrl } = req.body ?? {};
  if (name === undefined && tagline === undefined && avatarUrl === undefined) {
    return res.status(400).json({ error: "name or tagline or avatar_url is required" });
  }

  const client = getUserClient(req);
  const { data: profile, error } = await client
    .from("profiles")
    .select("id, name, tagline, avatar_url, updated_at")
    .eq("id", req.user.id)
    .maybeSingle();

  if (error) {
    return handleSupabaseError(res, error);
  }

  if (!profile) {
    const fallbackName =
      req.user.user_metadata?.name || req.user.email || "Unknown";
    const record = {
      id: req.user.id,
      name: name ?? fallbackName,
      tagline: tagline ?? null,
      avatar_url: avatarUrl ?? null,
      updated_at: now()
    };
    const { data: inserted, error: insertError } = await client
      .from("profiles")
      .insert(record)
      .select("id, name, tagline, avatar_url, updated_at")
      .single();

    if (insertError) {
      return handleSupabaseError(res, insertError);
    }
    return res.status(201).json(inserted);
  }

  const updates = { updated_at: now() };
  if (name !== undefined) updates.name = name;
  if (tagline !== undefined) updates.tagline = tagline;
  if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

  const { data: updated, error: updateError } = await client
    .from("profiles")
    .update(updates)
    .eq("id", req.user.id)
    .select("id, name, tagline, avatar_url, updated_at")
    .single();

  if (updateError) {
    return handleSupabaseError(res, updateError);
  }

  return res.json(updated);
});

app.post("/sessions", requireAuth, async (req, res) => {
  const { name, visibility: requestedVisibility } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const visibility = normalizeVisibility(requestedVisibility);
  const joinToken = visibility === "link" ? createJoinToken() : null;
  const record = {
    id: randomUUID(),
    name,
    visibility,
    join_token: joinToken,
    created_at: now()
  };

  const { error: sessionError } = await client.from("sessions").insert(record);
  if (sessionError) {
    return handleSupabaseError(res, sessionError);
  }

  const participant = {
    id: randomUUID(),
    session_id: record.id,
    user_id: req.user.id,
    role: "owner",
    created_at: now()
  };

  const { error: participantError } = await client
    .from("session_participants")
    .insert(participant);
  if (participantError) {
    return handleSupabaseError(res, participantError);
  }

  const { error: tabError } = await client.from("chat_tabs").insert({
    id: randomUUID(),
    session_id: record.id,
    name: "全体",
    allowed_roles: null,
    allowed_users: null,
    toast_enabled: true,
    is_default: true,
    created_by: req.user.id,
    created_at: now(),
    updated_at: now()
  });
  if (tabError) {
    return handleSupabaseError(res, tabError);
  }

  emitChange("sessions", "insert", {
    id: record.id,
    name: record.name,
    visibility: record.visibility,
    created_at: record.created_at
  });
  return res.status(201).json(record);
});

app.get("/sessions", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: memberData, error: memberError } = await client
    .from("sessions")
    .select("id, name, created_at, visibility, session_participants!inner(user_id)")
    .eq("session_participants.user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (memberError) {
    return handleSupabaseError(res, memberError);
  }

  const { data: publicData, error: publicError } = await client
    .from("sessions")
    .select("id, name, created_at, visibility")
    .eq("visibility", "public")
    .order("created_at", { ascending: false });

  if (publicError) {
    return handleSupabaseError(res, publicError);
  }

  const sessionsMap = new Map();
  (memberData ?? []).forEach(({ id, name, created_at: createdAt, visibility }) => {
    sessionsMap.set(id, { id, name, created_at: createdAt, visibility });
  });
  (publicData ?? []).forEach(({ id, name, created_at: createdAt, visibility }) => {
    if (!sessionsMap.has(id)) {
      sessionsMap.set(id, { id, name, created_at: createdAt, visibility });
    }
  });

  const sessions = Array.from(sessionsMap.values()).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  return res.json(sessions);
});

app.get("/sessions/owned", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data, error } = await client
    .from("sessions")
    .select("id, name, created_at, visibility, session_participants!inner(user_id, role)")
    .eq("session_participants.user_id", req.user.id)
    .eq("session_participants.role", "owner")
    .order("created_at", { ascending: false });

  if (error) {
    return handleSupabaseError(res, error);
  }

  const sessions = (data ?? []).map(({ id, name, created_at: createdAt, visibility }) => ({
    id,
    name,
    created_at: createdAt,
    visibility
  }));
  return res.json(sessions);
});

app.get("/sessions/:sessionId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );

  const { data, error } = await client
    .from("sessions")
    .select("id, name, created_at, visibility, join_token")
    .eq("id", req.params.sessionId)
    .maybeSingle();

  if (error) {
    return handleSupabaseError(res, error);
  }
  if (!data) {
    return res.status(404).json({ error: "session not found" });
  }

  if (!membership.ok && membership.status === 500) {
    return handleSupabaseError(res, membership.error);
  }

  if (!membership.ok) {
    if (data.visibility === "public" || data.visibility === "link") {
      const { join_token: _joinToken, ...publicSession } = data;
      return res.json(publicSession);
    }
    return res.status(403).json({ error: "forbidden" });
  }

  if (membership.participant?.role !== "owner") {
    const { join_token: _joinToken, ...memberSession } = data;
    return res.json({ ...memberSession, participant_role: membership.participant?.role });
  }

  return res.json({ ...data, participant_role: membership.participant?.role });
});

app.post("/sessions/:sessionId/join", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const joinToken =
    (req.body?.join_token ?? req.query?.token ?? "").toString() || null;

  const { error } = await client.rpc("join_session_with_token", {
    session_id: req.params.sessionId,
    join_token: joinToken
  });

  if (error) {
    if (error.code === "P0002") {
      return res.status(404).json({ error: "session not found" });
    }
    if (error.code === "42501") {
      return res.status(403).json({ error: "forbidden" });
    }
    if (error.code === "28000") {
      return res.status(401).json({ error: "unauthorized" });
    }
    return handleSupabaseError(res, error);
  }

  return res.status(204).end();
});

app.post("/sessions/:sessionId/participants", requireAuth, async (req, res) => {
  const { user_id: userId } = req.body ?? {};
  if (!userId) {
    return res.status(400).json({ error: "user_id is required" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant?.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const participant = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    user_id: userId,
    role: "participant",
    created_at: now()
  };

  const { error } = await client.from("session_participants").insert(participant);
  if (error) {
    if (error.code === "23505") {
      return res.status(204).end();
    }
    return handleSupabaseError(res, error);
  }

  return res.status(201).json({ user_id: userId });
});

app.get("/sessions/:sessionId/participants", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("session_participants")
    .select("id, session_id, user_id, role, created_at")
    .eq("session_id", req.params.sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return handleSupabaseError(res, error);
  }

  const participants = data ?? [];
  const userIds = participants.map((item) => item.user_id).filter(Boolean);
  let profileMap = new Map();
  if (userIds.length) {
    const { data: profiles, error: profileError } = await client
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", userIds);
    if (profileError) {
      return handleSupabaseError(res, profileError);
    }
    profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  }

  return res.json(
    participants.map((participant) => ({
      ...participant,
      profile_name: profileMap.get(participant.user_id)?.name ?? null,
      profile_avatar_url: profileMap.get(participant.user_id)?.avatar_url ?? null
    }))
  );
});

app.get("/sessions/:sessionId/chat-tabs", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("chat_tabs")
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .eq("session_id", req.params.sessionId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/chat-tabs", requireAuth, async (req, res) => {
  const {
    name,
    allowed_roles: allowedRoles,
    allowed_users: allowedUsers,
    toast_enabled: toastEnabled
  } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const roles = normalizeAllowedRoles(allowedRoles);
  const users = normalizeAllowedUsers(allowedUsers);
  const record = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    name,
    allowed_roles: roles.length ? roles : null,
    allowed_users: users.length ? users : null,
    toast_enabled: typeof toastEnabled === "boolean" ? toastEnabled : true,
    is_default: false,
    created_by: req.user.id,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await client
    .from("chat_tabs")
    .insert(record)
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.patch("/chat-tabs/:tabId", requireAuth, async (req, res) => {
  const {
    name,
    allowed_roles: allowedRoles,
    allowed_users: allowedUsers,
    toast_enabled: toastEnabled
  } = req.body ?? {};
  const client = getUserClient(req);
  const { data: tab, error: tabError } = await client
    .from("chat_tabs")
    .select("id, session_id, is_default")
    .eq("id", req.params.tabId)
    .maybeSingle();

  if (tabError) {
    return handleSupabaseError(res, tabError);
  }
  if (!tab) {
    return res.status(404).json({ error: "chat tab not found" });
  }

  const membership = await ensureParticipant(
    client,
    tab.session_id,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const roles = normalizeAllowedRoles(allowedRoles);
  const users = normalizeAllowedUsers(allowedUsers);
  const updates = {
    updated_at: now()
  };
  if (name !== undefined) updates.name = name;
  if (allowedRoles !== undefined) {
    updates.allowed_roles = roles.length ? roles : null;
  }
  if (allowedUsers !== undefined) {
    updates.allowed_users = users.length ? users : null;
  }
  if (typeof toastEnabled === "boolean") {
    updates.toast_enabled = toastEnabled;
  }

  const { data, error } = await client
    .from("chat_tabs")
    .update(updates)
    .eq("id", tab.id)
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data);
});

app.delete("/chat-tabs/:tabId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: tab, error: tabError } = await client
    .from("chat_tabs")
    .select("id, session_id, is_default")
    .eq("id", req.params.tabId)
    .maybeSingle();

  if (tabError) {
    return handleSupabaseError(res, tabError);
  }
  if (!tab) {
    return res.status(404).json({ error: "chat tab not found" });
  }

  if (tab.is_default) {
    return res.status(400).json({ error: "default tab cannot be deleted" });
  }

  const membership = await ensureParticipant(
    client,
    tab.session_id,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const { error } = await client.from("chat_tabs").delete().eq("id", tab.id);
  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(204).end();
});

app.get("/sessions/:sessionId/board", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("boards")
    .select(
      "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
    )
    .eq("session_id", req.params.sessionId)
    .maybeSingle();

  if (error) {
    return handleSupabaseError(res, error);
  }
  if (!data) {
    return res.status(204).end();
  }
  return res.json(data);
});

app.post("/sessions/:sessionId/board", requireAuth, async (req, res) => {
  const {
    background_url: backgroundUrl,
    grid_enabled: gridEnabled,
    grid_background_color: gridBackgroundColor,
    grid_background_image_url: gridBackgroundImageUrl,
    grid_background_blur: gridBackgroundBlur
  } = req.body ?? {};
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data: existing, error: existingError } = await client
    .from("boards")
    .select("id")
    .eq("session_id", req.params.sessionId)
    .maybeSingle();

  if (existingError) {
    return handleSupabaseError(res, existingError);
  }

  const updatedAt = now();
  const normalizeGridBackgroundColor = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return String(value);
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  const normalizeGridBackgroundImageUrl = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return String(value);
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };
  const buildBoardPayload = () => {
    const payload = { updated_at: updatedAt };
    if (backgroundUrl !== undefined) {
      payload.background_url = backgroundUrl ?? null;
    }
    if (typeof gridEnabled === "boolean") {
      payload.grid_enabled = gridEnabled;
    }
    if (gridBackgroundColor !== undefined) {
      payload.grid_background_color =
        normalizeGridBackgroundColor(gridBackgroundColor);
    }
    if (gridBackgroundImageUrl !== undefined) {
      payload.grid_background_image_url =
        normalizeGridBackgroundImageUrl(gridBackgroundImageUrl);
    }
    if (typeof gridBackgroundBlur === "boolean") {
      payload.grid_background_blur = gridBackgroundBlur;
    }
    return payload;
  };
  if (existing) {
    const payload = buildBoardPayload();
    const { data, error } = await client
      .from("boards")
      .update(payload)
      .eq("id", existing.id)
      .select(
        "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
      )
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    emitChange("boards", "update", data);
    return res.json(data);
  }

  const payload = buildBoardPayload();
  const { data, error } = await client
    .from("boards")
    .insert({
      id: randomUUID(),
      session_id: req.params.sessionId,
      ...payload
    })
    .select(
      "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
    )
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("boards", "insert", data);
  return res.status(201).json(data);
});

app.get("/sessions/:sessionId/tokens", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("tokens")
    .select(
      "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
    )
    .eq("session_id", req.params.sessionId)
    .order("updated_at", { ascending: false });

  if (error) {
    return handleSupabaseError(res, error);
  }
  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/tokens", requireAuth, async (req, res) => {
  const body = req.body ?? {};
  const imageUrl = body.image_url ?? body.imageUrl;
  const { name, x, y, rotation, width, height, priority } = body;
  const showName = body.show_name ?? body.showName;
  if (!name || x === undefined || y === undefined) {
    return res.status(400).json({ error: "name, x, y are required" });
  }

  const parsedX = parseNumberField(x);
  const parsedY = parseNumberField(y);
  const parsedRotation = parseNumberField(rotation);
  const parsedWidth = parsePositiveInt(width, DEFAULT_TOKEN_SIZE);
  const parsedHeight = parsePositiveInt(height, DEFAULT_TOKEN_SIZE);
  const parsedPriority = parsePriority(priority, DEFAULT_TOKEN_PRIORITY);
  if (!parsedX.ok || !parsedY.ok || !parsedRotation.ok) {
    return res.status(400).json({ error: "x, y, rotation must be numbers" });
  }
  if (!parsedWidth.ok || !parsedHeight.ok) {
    return res.status(400).json({ error: "width and height must be >= 1" });
  }
  if (!parsedPriority.ok) {
    return res.status(400).json({ error: "priority must be a number" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const record = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    name,
    x: parsedX.value,
    y: parsedY.value,
    width: parsedWidth.value,
    height: parsedHeight.value,
    rotation: parsedRotation.value ?? 0,
    image_url: imageUrl ?? null,
    show_name: typeof showName === "boolean" ? showName : false,
    priority: parsedPriority.value,
    updated_at: now()
  };

  const { error } = await client.from("tokens").insert(record);
  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("tokens", "insert", record);
  return res.status(201).json(record);
});

app.get("/sessions/:sessionId/logs", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const tabId = typeof req.query?.tab_id === "string" ? req.query.tab_id : "";
  const resolvedTab = await resolveChatTab(
    client,
    req.params.sessionId,
    tabId || null,
    membership.participant,
    req.user.id
  );
  if (resolvedTab?.error) {
    if (resolvedTab.status === 404) {
      return res.status(404).json({ error: "chat tab not found" });
    }
    if (resolvedTab.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, resolvedTab.error);
  }

  const { data, error } = await client
    .from("session_logs")
    .select(
      "id, session_id, tab_id, user_id, message, message_type, speaker_type, speaker_name, speaker_color, speaker_image_url, message_font, dice_result, visible_user_ids, redacted_for_id, created_at"
    )
    .eq("session_id", req.params.sessionId)
    .eq("tab_id", resolvedTab.data?.id ?? null)
    .order("created_at", { ascending: true });

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/chat", requireAuth, async (req, res) => {
  const {
    message,
    message_type: messageType,
    speaker_type: speakerType,
    speaker_name: speakerName,
    speaker_color: speakerColor,
    speaker_image_url: speakerImageUrl,
    message_font: messageFont,
    dice_result: diceResult,
    tab_id: tabId,
    visible_user_ids: visibleUserIds,
    redact_for_others: redactForOthers
  } = req.body ?? {};
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  const normalizedMessageType = messageType === "dice" ? "dice" : "chat";
  const allowedSpeakers = ["account", "character", "custom", "kp"];
  const normalizedSpeakerType = allowedSpeakers.includes(speakerType)
    ? speakerType
    : "account";
  const normalizedSpeakerImageUrl =
    normalizedSpeakerType === "character" && typeof speakerImageUrl === "string"
      ? speakerImageUrl.trim() || null
      : null;

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const resolvedTab = await resolveChatTab(
    client,
    req.params.sessionId,
    tabId || null,
    membership.participant,
    req.user.id
  );
  if (resolvedTab?.error) {
    if (resolvedTab.status === 404) {
      return res.status(404).json({ error: "chat tab not found" });
    }
    if (resolvedTab.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, resolvedTab.error);
  }

  const requestedVisibleUsers = normalizeAllowedUsers(visibleUserIds);
  let visibleUsers = [];
  if (requestedVisibleUsers.length) {
    const userSet = new Set([...requestedVisibleUsers, req.user.id]);
    const { data: participantIds, error: participantError } = await client
      .from("session_participants")
      .select("user_id")
      .eq("session_id", req.params.sessionId)
      .in("user_id", Array.from(userSet));
    if (participantError) {
      return handleSupabaseError(res, participantError);
    }
    visibleUsers = (participantIds ?? []).map((row) => row.user_id);
    if (!visibleUsers.includes(req.user.id)) {
      visibleUsers.push(req.user.id);
    }
  }

  const record = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    tab_id: resolvedTab.data?.id ?? null,
    user_id: req.user.id,
    message,
    message_type: normalizedMessageType,
    speaker_type: normalizedSpeakerType,
    speaker_name: speakerName ?? null,
    speaker_color: speakerColor ?? null,
    speaker_image_url: normalizedSpeakerImageUrl,
    message_font: messageFont ?? null,
    dice_result: diceResult ?? null,
    visible_user_ids: visibleUsers.length ? visibleUsers : null,
    created_at: now()
  };

  const { data, error } = await client
    .from("session_logs")
    .insert(record)
    .select(
      "id, session_id, tab_id, user_id, message, message_type, speaker_type, speaker_name, speaker_color, speaker_image_url, message_font, dice_result, visible_user_ids, redacted_for_id, created_at"
    )
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("session_logs", "insert", data);

  if (visibleUsers.length && redactForOthers) {
    const blockCount = Math.max(6, Math.min(18, Math.floor(Math.random() * 12) + 6));
    const redactedRecord = {
      id: randomUUID(),
      session_id: req.params.sessionId,
      tab_id: resolvedTab.data?.id ?? null,
      user_id: req.user.id,
      message: "■".repeat(blockCount),
      message_type: "redacted",
      speaker_type: normalizedSpeakerType,
      speaker_name: speakerName ?? null,
      speaker_color: speakerColor ?? null,
      speaker_image_url: null,
      message_font: messageFont ?? null,
      dice_result: null,
      visible_user_ids: null,
      redacted_for_id: data.id,
      created_at: now()
    };
    const { data: redactedData, error: redactedError } = await client
      .from("session_logs")
      .insert(redactedRecord)
      .select(
        "id, session_id, tab_id, user_id, message, message_type, speaker_type, speaker_name, speaker_color, speaker_image_url, message_font, dice_result, visible_user_ids, redacted_for_id, created_at"
      )
      .single();
    if (!redactedError) {
      emitChange("session_logs", "insert", redactedData);
    }
  }

  return res.status(201).json(data);
});

app.get("/sessions/:sessionId/places", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("places")
    .select(
      "id, session_id, name, created_at, updated_at, place_patterns (id, name, background_url, created_at)"
    )
    .eq("session_id", req.params.sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/places", requireAuth, async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const record = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    name,
    created_by: req.user.id,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await client
    .from("places")
    .insert(record)
    .select("id, session_id, name, created_at, updated_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.post("/places/:placeId/patterns", requireAuth, async (req, res) => {
  const { name, background_url: backgroundUrl } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const { data: place, error: placeError } = await client
    .from("places")
    .select("id, session_id")
    .eq("id", req.params.placeId)
    .maybeSingle();

  if (placeError) {
    return handleSupabaseError(res, placeError);
  }
  if (!place) {
    return res.status(404).json({ error: "place not found" });
  }

  const membership = await ensureParticipant(client, place.session_id, req.user.id);
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const record = {
    id: randomUUID(),
    place_id: place.id,
    name,
    background_url: backgroundUrl ?? null,
    created_at: now()
  };

  const { data, error } = await client
    .from("place_patterns")
    .insert(record)
    .select("id, place_id, name, background_url, created_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.get("/sessions/:sessionId/scenes", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data, error } = await client
    .from("scenes")
    .select(
      "id, session_id, name, created_at, updated_at, scene_steps (id, position, place_id, pattern_id, created_at)"
    )
    .eq("session_id", req.params.sessionId)
    .order("created_at", { ascending: true })
    .order("position", { foreignTable: "scene_steps", ascending: true });

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/scenes", requireAuth, async (req, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const record = {
    id: randomUUID(),
    session_id: req.params.sessionId,
    name,
    created_by: req.user.id,
    created_at: now(),
    updated_at: now()
  };

  const { data, error } = await client
    .from("scenes")
    .insert(record)
    .select("id, session_id, name, created_at, updated_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.post("/scenes/:sceneId/steps", requireAuth, async (req, res) => {
  const { place_id: placeId, pattern_id: patternId } = req.body ?? {};
  if (!placeId || !patternId) {
    return res.status(400).json({ error: "place_id and pattern_id are required" });
  }

  const client = getUserClient(req);
  const { data: scene, error: sceneError } = await client
    .from("scenes")
    .select("id, session_id")
    .eq("id", req.params.sceneId)
    .maybeSingle();

  if (sceneError) {
    return handleSupabaseError(res, sceneError);
  }
  if (!scene) {
    return res.status(404).json({ error: "scene not found" });
  }

  const membership = await ensureParticipant(client, scene.session_id, req.user.id);
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data: place, error: placeError } = await client
    .from("places")
    .select("id, session_id")
    .eq("id", placeId)
    .maybeSingle();

  if (placeError) {
    return handleSupabaseError(res, placeError);
  }
  if (!place || place.session_id !== scene.session_id) {
    return res.status(400).json({ error: "invalid place" });
  }

  const { data: pattern, error: patternError } = await client
    .from("place_patterns")
    .select("id, place_id")
    .eq("id", patternId)
    .maybeSingle();

  if (patternError) {
    return handleSupabaseError(res, patternError);
  }
  if (!pattern || pattern.place_id !== placeId) {
    return res.status(400).json({ error: "invalid pattern" });
  }

  const { data: lastStep, error: lastStepError } = await client
    .from("scene_steps")
    .select("position")
    .eq("scene_id", scene.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastStepError) {
    return handleSupabaseError(res, lastStepError);
  }

  const position = lastStep ? lastStep.position + 1 : 0;
  const record = {
    id: randomUUID(),
    scene_id: scene.id,
    place_id: placeId,
    pattern_id: patternId,
    position,
    created_at: now()
  };

  const { data, error } = await client
    .from("scene_steps")
    .insert(record)
    .select("id, scene_id, place_id, pattern_id, position, created_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.get("/sessions/:sessionId/scene-state", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { data: state, error: stateError } = await client
    .from("scene_states")
    .select("session_id, scene_id, step_index, updated_at")
    .eq("session_id", req.params.sessionId)
    .maybeSingle();

  if (stateError) {
    return handleSupabaseError(res, stateError);
  }

  if (!state || !state.scene_id) {
    return res.json({ state: state ?? null, step: null });
  }

  const { data: steps, error: stepsError } = await fetchSceneSteps(
    client,
    state.scene_id
  );
  if (stepsError) {
    return handleSupabaseError(res, stepsError);
  }
  if (!steps.length) {
    return res.json({ state, step: null });
  }

  const index = Math.min(Math.max(state.step_index, 0), steps.length - 1);
  const step = steps[index];
  const { data: pattern, error: patternError } = await fetchPatternById(
    client,
    step.pattern_id
  );
  if (patternError) {
    return handleSupabaseError(res, patternError);
  }

  return res.json({
    state,
    step: {
      ...step,
      background_url: pattern?.background_url ?? null
    }
  });
});

app.post("/sessions/:sessionId/scene-state", requireAuth, async (req, res) => {
  const { scene_id: sceneId } = req.body ?? {};
  if (!sceneId) {
    return res.status(400).json({ error: "scene_id is required" });
  }

  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data: scene, error: sceneError } = await client
    .from("scenes")
    .select("id, session_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return handleSupabaseError(res, sceneError);
  }
  if (!scene || scene.session_id !== req.params.sessionId) {
    return res.status(404).json({ error: "scene not found" });
  }

  const { data: steps, error: stepsError } = await fetchSceneSteps(
    client,
    scene.id
  );
  if (stepsError) {
    return handleSupabaseError(res, stepsError);
  }
  if (!steps.length) {
    return res.status(400).json({ error: "scene has no steps" });
  }

  const { data: pattern, error: patternError } = await fetchPatternById(
    client,
    steps[0].pattern_id
  );
  if (patternError) {
    return handleSupabaseError(res, patternError);
  }

  const updatedAt = now();
  const { data: state, error: stateError } = await client
    .from("scene_states")
    .upsert({
      session_id: req.params.sessionId,
      scene_id: scene.id,
      step_index: 0,
      updated_at: updatedAt
    })
    .select("session_id, scene_id, step_index, updated_at")
    .single();

  if (stateError) {
    return handleSupabaseError(res, stateError);
  }

  const { error: boardError } = await upsertBoardBackground(
    client,
    req.params.sessionId,
    pattern?.background_url ?? null
  );
  if (boardError) {
    return handleSupabaseError(res, boardError);
  }

  return res.json({ state, step: steps[0] });
});

app.post("/sessions/:sessionId/scene-next", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const membership = await ensureParticipant(
    client,
    req.params.sessionId,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }
  if (membership.participant.role !== "owner") {
    return res.status(403).json({ error: "forbidden" });
  }

  const { data: state, error: stateError } = await client
    .from("scene_states")
    .select("session_id, scene_id, step_index, updated_at")
    .eq("session_id", req.params.sessionId)
    .maybeSingle();

  if (stateError) {
    return handleSupabaseError(res, stateError);
  }
  if (!state || !state.scene_id) {
    return res.status(404).json({ error: "scene state not found" });
  }

  const { data: steps, error: stepsError } = await fetchSceneSteps(
    client,
    state.scene_id
  );
  if (stepsError) {
    return handleSupabaseError(res, stepsError);
  }
  if (!steps.length) {
    return res.status(400).json({ error: "scene has no steps" });
  }

  const nextIndex = (state.step_index + 1) % steps.length;
  const nextStep = steps[nextIndex];
  const { data: pattern, error: patternError } = await fetchPatternById(
    client,
    nextStep.pattern_id
  );
  if (patternError) {
    return handleSupabaseError(res, patternError);
  }

  const { data: updatedState, error: updateError } = await client
    .from("scene_states")
    .update({
      step_index: nextIndex,
      updated_at: now()
    })
    .eq("session_id", req.params.sessionId)
    .select("session_id, scene_id, step_index, updated_at")
    .single();

  if (updateError) {
    return handleSupabaseError(res, updateError);
  }

  const { error: boardError } = await upsertBoardBackground(
    client,
    req.params.sessionId,
    pattern?.background_url ?? null
  );
  if (boardError) {
    return handleSupabaseError(res, boardError);
  }

  return res.json({ state: updatedState, step: nextStep });
});

app.patch("/tokens/:tokenId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: existing, error: existingError } = await client
    .from("tokens")
    .select(
      "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
    )
    .eq("id", req.params.tokenId)
    .maybeSingle();

  if (existingError) {
    return handleSupabaseError(res, existingError);
  }
  if (!existing) {
    return res.status(404).json({ error: "token not found" });
  }

  const membership = await ensureParticipant(
    client,
    existing.session_id,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const body = req.body ?? {};
  const updates = {};
  if (hasOwn(body, "name")) {
    if (!body.name) {
      return res.status(400).json({ error: "name is required" });
    }
    updates.name = body.name;
  }
  if (hasOwn(body, "x")) {
    if (body.x === undefined || body.x === null) {
      return res.status(400).json({ error: "x must be a number" });
    }
    const parsed = parseNumberField(body.x);
    if (!parsed.ok) {
      return res.status(400).json({ error: "x must be a number" });
    }
    updates.x = parsed.value;
  }
  if (hasOwn(body, "y")) {
    if (body.y === undefined || body.y === null) {
      return res.status(400).json({ error: "y must be a number" });
    }
    const parsed = parseNumberField(body.y);
    if (!parsed.ok) {
      return res.status(400).json({ error: "y must be a number" });
    }
    updates.y = parsed.value;
  }
  if (hasOwn(body, "rotation")) {
    if (body.rotation === undefined || body.rotation === null) {
      return res.status(400).json({ error: "rotation must be a number" });
    }
    const parsed = parseNumberField(body.rotation);
    if (!parsed.ok) {
      return res.status(400).json({ error: "rotation must be a number" });
    }
    updates.rotation = parsed.value ?? 0;
  }
  if (hasOwn(body, "width")) {
    if (body.width === undefined || body.width === null) {
      return res.status(400).json({ error: "width must be >= 1" });
    }
    const parsed = parsePositiveInt(body.width, existing.width);
    if (!parsed.ok) {
      return res.status(400).json({ error: "width must be >= 1" });
    }
    updates.width = parsed.value;
  }
  if (hasOwn(body, "height")) {
    if (body.height === undefined || body.height === null) {
      return res.status(400).json({ error: "height must be >= 1" });
    }
    const parsed = parsePositiveInt(body.height, existing.height);
    if (!parsed.ok) {
      return res.status(400).json({ error: "height must be >= 1" });
    }
    updates.height = parsed.value;
  }
  if (hasOwn(body, "priority")) {
    if (body.priority === undefined || body.priority === null) {
      return res.status(400).json({ error: "priority must be a number" });
    }
    const parsed = parsePriority(body.priority, existing.priority);
    if (!parsed.ok) {
      return res.status(400).json({ error: "priority must be a number" });
    }
    updates.priority = parsed.value;
  }
  if (hasOwn(body, "image_url") || hasOwn(body, "imageUrl")) {
    const imageUrl = body.image_url ?? body.imageUrl;
    updates.image_url = imageUrl ?? null;
  }
  if (hasOwn(body, "show_name") || hasOwn(body, "showName")) {
    const rawShowName = hasOwn(body, "show_name") ? body.show_name : body.showName;
    if (typeof rawShowName !== "boolean") {
      return res.status(400).json({ error: "show_name must be boolean" });
    }
    updates.show_name = rawShowName;
  }

  const { data, error } = await client
    .from("tokens")
    .update({
      ...updates,
      updated_at: now()
    })
    .eq("id", existing.id)
    .select(
      "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
    )
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("tokens", "update", data);
  return res.json(data);
});

app.delete("/tokens/:tokenId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: existing, error: existingError } = await client
    .from("tokens")
    .select(
      "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
    )
    .eq("id", req.params.tokenId)
    .maybeSingle();

  if (existingError) {
    return handleSupabaseError(res, existingError);
  }
  if (!existing) {
    return res.status(404).json({ error: "token not found" });
  }

  const membership = await ensureParticipant(
    client,
    existing.session_id,
    req.user.id
  );
  if (!membership.ok) {
    if (membership.status === 403) {
      return res.status(403).json({ error: "forbidden" });
    }
    return handleSupabaseError(res, membership.error);
  }

  const { error } = await client
    .from("tokens")
    .delete()
    .eq("id", req.params.tokenId);
  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("tokens", "delete", existing);
  return res.status(204).end();
});

app.get("/characters", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data, error } = await client
    .from("characters")
    .select("id, name, system, level, background, notes, image_url, user_id, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return handleSupabaseError(res, error);
  }
  return res.json(data ?? []);
});

app.post("/characters", requireAuth, async (req, res) => {
  const { name, system, level, background, notes, image_url: imageUrl } = req.body ?? {};
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const client = getUserClient(req);
  const record = {
    id: randomUUID(),
    name,
    system: system ?? null,
    level: level ?? null,
    background: background ?? null,
    notes: notes ?? null,
    image_url: imageUrl ?? null,
    user_id: req.user.id,
    created_at: now()
  };

  const { error } = await client.from("characters").insert(record);
  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(record);
});

app.patch("/characters/:characterId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: existing, error: existingError } = await client
    .from("characters")
    .select("id, name, system, level, background, notes, image_url, user_id, created_at")
    .eq("id", req.params.characterId)
    .maybeSingle();

  if (existingError) {
    return handleSupabaseError(res, existingError);
  }
  if (!existing) {
    return res.status(404).json({ error: "character not found" });
  }
  if (existing.user_id !== req.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const updated = {
    ...existing,
    ...req.body
  };

  const { data, error } = await client
    .from("characters")
    .update({
      name: updated.name,
      system: updated.system ?? null,
      level: updated.level ?? null,
      background: updated.background ?? null,
      notes: updated.notes ?? null,
      image_url: updated.image_url ?? null
    })
    .eq("id", existing.id)
    .select("id, name, system, level, background, notes, image_url, user_id, created_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data);
});

app.delete("/characters/:characterId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: existing, error: existingError } = await client
    .from("characters")
    .select("id, user_id")
    .eq("id", req.params.characterId)
    .maybeSingle();

  if (existingError) {
    return handleSupabaseError(res, existingError);
  }
  if (!existing) {
    return res.status(404).json({ error: "character not found" });
  }
  if (existing.user_id !== req.user.id) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { error } = await client
    .from("characters")
    .delete()
    .eq("id", req.params.characterId);
  if (error) {
    return handleSupabaseError(res, error);
  }
  return res.status(204).end();
});

app.post("/uploads", requireAuth, upload.single("file"), async (req, res) => {
  const client = getUserClient(req);
  const file = req.file;
  let assetUrl = req.body?.url || null;
  let assetName = req.body?.name || null;
  const category = normalizeUploadCategory(req.body?.category);

  if (file) {
    const storagePath = buildStoragePath(
      req.user.id,
      file.originalname || "upload",
      category
    );
    const { error: uploadError } = await client.storage
      .from(storageBucket)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) {
      return handleSupabaseError(res, uploadError);
    }

    const { data: publicData } = client.storage
      .from(storageBucket)
      .getPublicUrl(storagePath);
    assetUrl = publicData?.publicUrl || null;
    assetName = file.originalname || assetName || null;
  }

  if (!assetUrl) {
    return res.status(400).json({ error: "file or url is required" });
  }

  const record = {
    id: randomUUID(),
    user_id: req.user.id,
    name: assetName,
    url: assetUrl,
    category,
    created_at: now()
  };

  const { data, error } = await client
    .from("uploads")
    .insert(record)
    .select("id, user_id, name, url, category, created_at")
    .single();

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.status(201).json(data);
});

app.get("/uploads", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const category = req.query?.category;
  let query = client
    .from("uploads")
    .select("id, name, url, category, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (category) {
    query = query.eq("category", normalizeUploadCategory(category));
  }

  const { data, error } = await query;

  if (error) {
    return handleSupabaseError(res, error);
  }

  return res.json(data ?? []);
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on ${port}`);
});
