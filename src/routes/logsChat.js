import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { normalizeAllowedUsers } from "../lib/roles.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";
import { ensureParticipant } from "../services/participants.js";
import { resolveChatTab } from "../services/chatTabs.js";

export const registerLogsChatRoutes = (app, { emitChange }) => {
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
      const blockCount = Math.max(
        6,
        Math.min(18, Math.floor(Math.random() * 12) + 6)
      );
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
};
