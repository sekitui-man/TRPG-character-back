import { requireAuth } from "../auth.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";

export const registerProfileRoutes = (app) => {
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
      return res
        .status(400)
        .json({ error: "name or tagline or avatar_url is required" });
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
};
