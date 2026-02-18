import { requireBotAuth } from "../auth.js";
import { COC6_SHEET_FIELDS } from "../lib/constants.js";
import { getServiceSupabaseClient } from "../supabase.js";
import { handleSupabaseError } from "../services/errors.js";

const CHARACTER_FIELDS =
  "id, name, system, level, background, notes, image_url, user_id, created_at";
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return value === "1" || value.toLowerCase() === "true";
};

const parseListLimit = (value) => {
  const parsed = Number.parseInt(`${value ?? ""}`, 10);
  if (Number.isNaN(parsed)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIST_LIMIT);
};

const requireServiceClient = (res) => {
  const client = getServiceSupabaseClient();
  if (client) {
    return client;
  }
  res.status(500).json({ error: "bot api is not configured" });
  return null;
};

const fetchCoc6Sheets = async ({
  client,
  characterIds,
  includePrivateSheet
}) => {
  if (!characterIds.length) {
    return { sheetsByCharacterId: new Map() };
  }

  let query = client
    .from("character_sheets_coc6")
    .select(COC6_SHEET_FIELDS)
    .in("character_id", characterIds);

  if (!includePrivateSheet) {
    query = query.eq("visibility", "public");
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === "42P01") {
      return { sheetsByCharacterId: new Map() };
    }
    return { error };
  }

  const sheetsByCharacterId = new Map();
  (data ?? []).forEach((sheet) => {
    sheetsByCharacterId.set(sheet.character_id, sheet);
  });
  return { sheetsByCharacterId };
};

export const registerBotCharacterRoutes = (app) => {
  app.get("/bot/users/:userId/characters", requireBotAuth, async (req, res) => {
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }

    const includeSheet = parseBoolean(req.query.include_sheet);
    const includePrivateSheet = parseBoolean(req.query.include_private_sheet);
    const limit = parseListLimit(req.query.limit);

    const { data: characters, error: characterError } = await client
      .from("characters")
      .select(CHARACTER_FIELDS)
      .eq("user_id", req.params.userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (characterError) {
      return handleSupabaseError(res, characterError);
    }
    if (!includeSheet) {
      return res.json(characters ?? []);
    }

    const characterIds = (characters ?? []).map((character) => character.id);
    const sheetResult = await fetchCoc6Sheets({
      client,
      characterIds,
      includePrivateSheet
    });

    if (sheetResult.error) {
      return handleSupabaseError(res, sheetResult.error);
    }

    const rows = (characters ?? []).map((character) => ({
      ...character,
      coc6_sheet: sheetResult.sheetsByCharacterId.get(character.id) ?? null
    }));
    return res.json(rows);
  });

  app.get("/bot/characters/:characterId", requireBotAuth, async (req, res) => {
    const client = requireServiceClient(res);
    if (!client) {
      return;
    }

    const includeSheet = parseBoolean(req.query.include_sheet);
    const includePrivateSheet = parseBoolean(req.query.include_private_sheet);
    const userId = typeof req.query.user_id === "string" ? req.query.user_id : "";

    const { data: character, error: characterError } = await client
      .from("characters")
      .select(CHARACTER_FIELDS)
      .eq("id", req.params.characterId)
      .maybeSingle();

    if (characterError) {
      return handleSupabaseError(res, characterError);
    }
    if (!character) {
      return res.status(404).json({ error: "character not found" });
    }
    if (userId && character.user_id !== userId) {
      return res.status(404).json({ error: "character not found" });
    }
    if (!includeSheet) {
      return res.json(character);
    }

    let query = client
      .from("character_sheets_coc6")
      .select(COC6_SHEET_FIELDS)
      .eq("character_id", req.params.characterId);

    if (!includePrivateSheet) {
      query = query.eq("visibility", "public");
    }

    const { data: sheet, error: sheetError } = await query.maybeSingle();
    if (sheetError) {
      if (sheetError.code === "42P01") {
        return res.json({
          ...character,
          coc6_sheet: null
        });
      }
      return handleSupabaseError(res, sheetError);
    }

    return res.json({
      ...character,
      coc6_sheet: sheet ?? null
    });
  });
};
