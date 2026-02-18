import { randomUUID } from "node:crypto";
import { requireAuth, requireBotAuth } from "../auth.js";
import { now } from "../lib/time.js";
import { getServiceSupabaseClient } from "../supabase.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";

const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVISIONED_EMAIL_DOMAIN = "discord.local.invalid";

const isValidDiscordUserId = (value) =>
  typeof value === "string" && DISCORD_ID_PATTERN.test(value.trim());

const sanitizeDiscordUserId = (value) =>
  typeof value === "string" ? value.trim() : "";

const isValidUuid = (value) =>
  typeof value === "string" && UUID_PATTERN.test(value.trim());

const getDiscordUserIdFromUser = (user) => {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const candidates = identities
    .filter((identity) => identity?.provider === "discord")
    .flatMap((identity) => [
      identity?.provider_id,
      identity?.identity_data?.sub,
      identity?.identity_data?.id
    ])
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

const fetchLink = async ({ client, discordUserId, userId }) => {
  let query = client
    .from("discord_user_links")
    .select("discord_user_id, user_id, created_at, updated_at");
  if (discordUserId) {
    query = query.eq("discord_user_id", discordUserId);
  } else {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    return { error };
  }
  return { data };
};

const migrateCharacterOwnership = async ({ client, fromUserId, toUserId }) => {
  if (!fromUserId || !toUserId || fromUserId === toUserId) {
    return {};
  }

  const { error: characterError } = await client
    .from("characters")
    .update({ user_id: toUserId })
    .eq("user_id", fromUserId);
  if (characterError) {
    return { error: characterError };
  }

  const { error: sheetError } = await client
    .from("character_sheets_coc6")
    .update({ user_id: toUserId })
    .eq("user_id", fromUserId);
  if (sheetError && sheetError.code !== "42P01") {
    return { error: sheetError };
  }

  return {};
};

const createProvisionedUser = async ({ client, discordUserId }) => {
  const safeDiscordUserId = sanitizeDiscordUserId(discordUserId);
  const email = `discord_${safeDiscordUserId}_${randomUUID()}@${PROVISIONED_EMAIL_DOMAIN}`;
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      discord_user_id: safeDiscordUserId,
      provisioned_by: "bot"
    },
    app_metadata: {
      provider: "discord",
      providers: ["discord"]
    }
  });

  if (error) {
    return { error };
  }

  const userId = data?.user?.id;
  if (!isValidUuid(userId)) {
    return { error: new Error("failed to provision auth user") };
  }

  return { userId };
};

const saveLink = async ({ client, discordUserId, userId }) => {
  const linkResult = await fetchLink({ client, discordUserId, userId: "" });
  if (linkResult.error) {
    return { error: linkResult.error };
  }

  const existingUserId = linkResult.data?.user_id ?? "";
  if (existingUserId && existingUserId !== userId) {
    const migrated = await migrateCharacterOwnership({
      client,
      fromUserId: existingUserId,
      toUserId: userId
    });
    if (migrated.error) {
      return { error: migrated.error };
    }
  }

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
  app.post("/bot/users/provision", requireBotAuth, async (req, res) => {
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }

    const discordUserId = sanitizeDiscordUserId(req.body?.discord_user_id);
    if (!isValidDiscordUserId(discordUserId)) {
      return res.status(400).json({ error: "valid discord_user_id is required" });
    }

    const existing = await fetchLink({ client, discordUserId, userId: "" });
    if (existing.error) {
      return handleSupabaseError(res, existing.error);
    }
    if (existing.data) {
      return res.json({
        ...existing.data,
        created: false
      });
    }

    const provisioned = await createProvisionedUser({ client, discordUserId });
    if (provisioned.error) {
      return handleSupabaseError(res, provisioned.error);
    }

    const linked = await saveLink({
      client,
      discordUserId,
      userId: provisioned.userId
    });
    if (linked.error) {
      return handleSupabaseError(res, linked.error);
    }

    return res.status(201).json({
      ...linked.data,
      created: true
    });
  });

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

    const result = await fetchLink({ client, discordUserId, userId });
    if (result.error) {
      return handleSupabaseError(res, result.error);
    }
    if (!result.data) {
      return res.status(404).json({ error: "link not found" });
    }
    return res.json(result.data);
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
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }
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
