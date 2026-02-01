import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { COC6_SHEET_FIELDS } from "../lib/constants.js";
import { now } from "../lib/time.js";
import { normalizeSheetVisibility } from "../lib/visibility.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";

export const registerCharacterRoutes = (app) => {
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

  app.get("/characters/:characterId/coc6", requireAuth, async (req, res) => {
    const client = getUserClient(req);
    const { data, error } = await client
      .from("character_sheets_coc6")
      .select(COC6_SHEET_FIELDS)
      .eq("character_id", req.params.characterId)
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, error);
    }
    if (!data) {
      return res.status(404).json({ error: "sheet not found" });
    }
    return res.json(data);
  });

  app.post("/characters/:characterId/coc6", requireAuth, async (req, res) => {
    const client = getUserClient(req);
    const characterId = req.params.characterId;

    const { data: character, error: characterError } = await client
      .from("characters")
      .select("id, user_id")
      .eq("id", characterId)
      .maybeSingle();

    if (characterError) {
      return handleSupabaseError(res, characterError);
    }
    if (!character) {
      return res.status(404).json({ error: "character not found" });
    }
    if (character.user_id !== req.user.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const { data: existing, error: existingError } = await client
      .from("character_sheets_coc6")
      .select("id")
      .eq("character_id", characterId)
      .maybeSingle();

    if (existingError) {
      return handleSupabaseError(res, existingError);
    }
    if (existing) {
      return res.status(409).json({ error: "sheet already exists" });
    }

    const payload = req.body?.data;
    if (
      payload !== undefined &&
      (payload === null || typeof payload !== "object" || Array.isArray(payload))
    ) {
      return res.status(400).json({ error: "data must be an object" });
    }

    const record = {
      id: randomUUID(),
      character_id: characterId,
      user_id: req.user.id,
      data: payload ?? {},
      visibility: normalizeSheetVisibility(req.body?.visibility),
      created_at: now(),
      updated_at: now()
    };

    const { error } = await client.from("character_sheets_coc6").insert(record);
    if (error) {
      return handleSupabaseError(res, error);
    }
    return res.status(201).json(record);
  });

  app.patch("/characters/:characterId/coc6", requireAuth, async (req, res) => {
    const client = getUserClient(req);
    const { data: existing, error: existingError } = await client
      .from("character_sheets_coc6")
      .select(COC6_SHEET_FIELDS)
      .eq("character_id", req.params.characterId)
      .maybeSingle();

    if (existingError) {
      return handleSupabaseError(res, existingError);
    }
    if (!existing) {
      return res.status(404).json({ error: "sheet not found" });
    }
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    const payload = req.body?.data;
    if (
      payload !== undefined &&
      (payload === null || typeof payload !== "object" || Array.isArray(payload))
    ) {
      return res.status(400).json({ error: "data must be an object" });
    }

    const updatedData = payload ?? existing.data ?? {};
    const updatedVisibility =
      req.body?.visibility !== undefined
        ? normalizeSheetVisibility(req.body?.visibility)
        : existing.visibility;

    const { data, error } = await client
      .from("character_sheets_coc6")
      .update({
        data: updatedData,
        visibility: updatedVisibility,
        updated_at: now()
      })
      .eq("id", existing.id)
      .select(COC6_SHEET_FIELDS)
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }
    return res.json(data);
  });

  app.get(
    "/characters/:characterId/coc6/export.json",
    requireAuth,
    async (req, res) => {
      const client = getUserClient(req);
      const { data: sheet, error: sheetError } = await client
        .from("character_sheets_coc6")
        .select(COC6_SHEET_FIELDS)
        .eq("character_id", req.params.characterId)
        .maybeSingle();

      if (sheetError) {
        return handleSupabaseError(res, sheetError);
      }
      if (!sheet) {
        return res.status(404).json({ error: "sheet not found" });
      }

      const { data: character } = await client
        .from("characters")
        .select("id, name, system, level, background, notes, image_url, created_at")
        .eq("id", req.params.characterId)
        .maybeSingle();

      return res.json({
        kind: "coc6",
        exported_at: now(),
        character: character ?? null,
        sheet
      });
    }
  );
};
