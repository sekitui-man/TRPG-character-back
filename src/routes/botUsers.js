import { requireAuth, requireBotAuth } from "../auth.js";
import { now } from "../lib/time.js";
import { getServiceSupabaseClient } from "../supabase.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";

const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isValidDiscordUserId = (value) =>
  typeof value === "string" && DISCORD_ID_PATTERN.test(value.trim());

const sanitizeDiscordUserId = (value) =>
  typeof value === "string" ? value.trim() : "";

const isValidUuid = (value) =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());

const getDiscordUserIdFromUser = (user) => {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const candidates = [
    user?.user_metadata?.provider_id,
    user?.app_metadata?.provider_id,
    ...identities.flatMap((identity) => [
      identity?.provider === "discord" ? identity?.provider_id : null,
      identity?.provider === "discord" ? identity?.identity_data?.sub : null,
      identity?.provider === "discord" ? identity?.identity_data?.id : null
    ])
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim());

  return candidates.find((value) => DISCORD_ID_PATTERN.test(value)) ?? "";
};

const requireServiceClient = (res) => {
  const client = getServiceSupabaseClient();
  if (client) {
    return client;
  }
  res.status(500).json({ error: "bot api is not configured" });
  return null;
};

const saveLink = async ({ client, discordUserId, userId }) => {
  const { error: cleanupError } = await client
    .from("discord_user_links")
    .delete()
    .eq("user_id", userId)
    .neq("discord_user_id", discordUserId);

  if (cleanupError) {
    return { error: cleanupError };
  }

  const record = {
    discord_user_id: discordUserId,
    user_id: userId,
    updated_at: now()
  };

  const { data, error } = await client
    .from("discord_user_links")
    .upsert(record, { onConflict: "discord_user_id" })
    .select("discord_user_id, user_id, created_at, updated_at")
    .single();

  if (error) {
    return { error };
  }
  return { data };
};

export const registerBotUserRoutes = (app) => {
  app.get("/bot/users/resolve", requireBotAuth, async (req, res) => {
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }

    const discordUserId = sanitizeDiscordUserId(req.query.discord_user_id);
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : "";
    if (!discordUserId && !userId) {
      return res
        .status(400)
        .json({ error: "discord_user_id or user_id is required" });
    }

    let query = client
      .from("discord_user_links")
      .select("discord_user_id, user_id, created_at, updated_at");
    query = discordUserId
      ? query.eq("discord_user_id", discordUserId)
      : query.eq("user_id", userId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      return handleSupabaseError(res, error);
    }
    if (!data) {
      return res.status(404).json({ error: "link not found" });
    }
    return res.json(data);
  });

  app.put("/bot/users/resolve", requireBotAuth, async (req, res) => {
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }

    const discordUserId = sanitizeDiscordUserId(req.body?.discord_user_id);
    const userId = typeof req.body?.user_id === "string" ? req.body.user_id : "";
    if (!isValidDiscordUserId(discordUserId)) {
      return res.status(400).json({ error: "valid discord_user_id is required" });
    }
    if (!isValidUuid(userId)) {
      return res.status(400).json({ error: "valid user_id is required" });
    }

    const result = await saveLink({ client, discordUserId, userId });
    if (result.error) {
      return handleSupabaseError(res, result.error);
    }
    return res.json(result.data);
  });

  app.get("/me/discord-link", requireAuth, async (req, res) => {
    const client = getUserClient(req);
    const { data, error } = await client
      .from("discord_user_links")
      .select("discord_user_id, user_id, created_at, updated_at")
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, error);
    }
    if (!data) {
      return res.status(404).json({ error: "link not found" });
    }
    return res.json(data);
  });

  app.post("/me/discord-link/sync", requireAuth, async (req, res) => {
    const client = getUserClient(req);
    const discordUserId = getDiscordUserIdFromUser(req.user);
    if (!discordUserId) {
      return res
        .status(400)
        .json({ error: "discord identity is not linked in auth user" });
    }

    const result = await saveLink({
      client,
      discordUserId,
      userId: req.user.id
    });
    if (result.error) {
      return handleSupabaseError(res, result.error);
    }
    return res.json(result.data);
  });
};
