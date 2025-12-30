import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
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
app.use(express.json());

const server = http.createServer(app);

const now = () => new Date().toISOString();

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

const normalizeVisibility = (value) =>
  ["private", "link", "public"].includes(value) ? value : "private";

const createJoinToken = () => randomBytes(16).toString("hex");

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
    .select("id, session_id, background_url, updated_at")
    .eq("session_id", req.params.sessionId)
    .maybeSingle();

  if (error) {
    return handleSupabaseError(res, error);
  }
  if (!data) {
    return res.status(404).json({ error: "board not found" });
  }
  return res.json(data);
});

app.post("/sessions/:sessionId/board", requireAuth, async (req, res) => {
  const { background_url: backgroundUrl } = req.body ?? {};
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
  if (existing) {
    const { data, error } = await client
      .from("boards")
      .update({
        background_url: backgroundUrl ?? null,
        updated_at: updatedAt
      })
      .eq("id", existing.id)
      .select("id, session_id, background_url, updated_at")
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    emitChange("boards", "update", data);
    return res.json(data);
  }

  const { data, error } = await client
    .from("boards")
    .insert({
      id: randomUUID(),
      session_id: req.params.sessionId,
      background_url: backgroundUrl ?? null,
      updated_at: updatedAt
    })
    .select("id, session_id, background_url, updated_at")
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
    .select("id, session_id, name, x, y, rotation, image_url, updated_at")
    .eq("session_id", req.params.sessionId)
    .order("updated_at", { ascending: false });

  if (error) {
    return handleSupabaseError(res, error);
  }
  return res.json(data ?? []);
});

app.post("/sessions/:sessionId/tokens", requireAuth, async (req, res) => {
  const { name, x, y, rotation, image_url: imageUrl } = req.body ?? {};
  if (!name || x === undefined || y === undefined) {
    return res.status(400).json({ error: "name, x, y are required" });
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
    x,
    y,
    rotation: rotation ?? 0,
    image_url: imageUrl ?? null,
    updated_at: now()
  };

  const { error } = await client.from("tokens").insert(record);
  if (error) {
    return handleSupabaseError(res, error);
  }

  emitChange("tokens", "insert", record);
  return res.status(201).json(record);
});

app.patch("/tokens/:tokenId", requireAuth, async (req, res) => {
  const client = getUserClient(req);
  const { data: existing, error: existingError } = await client
    .from("tokens")
    .select("id, session_id, name, x, y, rotation, image_url, updated_at")
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

  const updated = {
    ...existing,
    ...req.body,
    updated_at: now()
  };

  const { data, error } = await client
    .from("tokens")
    .update({
      name: updated.name,
      x: updated.x,
      y: updated.y,
      rotation: updated.rotation ?? 0,
      image_url: updated.image_url ?? null,
      updated_at: updated.updated_at
    })
    .eq("id", existing.id)
    .select("id, session_id, name, x, y, rotation, image_url, updated_at")
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
    .select("id, session_id, name, x, y, rotation, image_url, updated_at")
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
    .select("id, name, system, level, background, notes, user_id, created_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return handleSupabaseError(res, error);
  }
  return res.json(data ?? []);
});

app.post("/characters", requireAuth, async (req, res) => {
  const { name, system, level, background, notes } = req.body ?? {};
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
    .select("id, name, system, level, background, notes, user_id, created_at")
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
      notes: updated.notes ?? null
    })
    .eq("id", existing.id)
    .select("id, name, system, level, background, notes, user_id, created_at")
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

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on ${port}`);
});
