import { randomBytes, randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { now } from "../lib/time.js";
import { normalizeVisibility } from "../lib/visibility.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";
import { ensureParticipant } from "../services/participants.js";

const createJoinToken = () => randomBytes(16).toString("hex");

export const registerSessionRoutes = (app, { emitChange }) => {
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
};
