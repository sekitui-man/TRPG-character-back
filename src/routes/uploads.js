import { randomUUID } from "node:crypto";
import multer from "multer";
import { requireAuth } from "../auth.js";
import { STORAGE_BUCKET } from "../lib/constants.js";
import { buildStoragePath, normalizeUploadCategory } from "../lib/uploads.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

export const registerUploadRoutes = (app) => {
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
        .from(STORAGE_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        return handleSupabaseError(res, uploadError);
      }

      const { data: publicData } = client.storage
        .from(STORAGE_BUCKET)
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
};
