import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { normalizeAllowedRoles, normalizeAllowedUsers } from "../lib/roles.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";
import { ensureParticipant } from "../services/participants.js";

export const registerChatTabRoutes = (app) => {
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
};
