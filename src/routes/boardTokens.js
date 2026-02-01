import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { DEFAULT_TOKEN_PRIORITY, DEFAULT_TOKEN_SIZE } from "../lib/constants.js";
import { parseNumberField, parsePositiveInt, parsePriority } from "../lib/parsers.js";
import { hasOwn } from "../lib/object.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";
import { ensureParticipant } from "../services/participants.js";

export const registerBoardTokenRoutes = (app, { emitChange }) => {
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
      .select(
        "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
      )
      .eq("session_id", req.params.sessionId)
      .maybeSingle();

    if (error) {
      return handleSupabaseError(res, error);
    }
    if (!data) {
      return res.status(204).end();
    }
    return res.json(data);
  });

  app.post("/sessions/:sessionId/board", requireAuth, async (req, res) => {
    const {
      background_url: backgroundUrl,
      grid_enabled: gridEnabled,
      grid_background_color: gridBackgroundColor,
      grid_background_image_url: gridBackgroundImageUrl,
      grid_background_blur: gridBackgroundBlur
    } = req.body ?? {};
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
    const normalizeGridBackgroundColor = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return String(value);
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };
    const normalizeGridBackgroundImageUrl = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return String(value);
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };
    const buildBoardPayload = () => {
      const payload = { updated_at: updatedAt };
      if (backgroundUrl !== undefined) {
        payload.background_url = backgroundUrl ?? null;
      }
      if (typeof gridEnabled === "boolean") {
        payload.grid_enabled = gridEnabled;
      }
      if (gridBackgroundColor !== undefined) {
        payload.grid_background_color =
          normalizeGridBackgroundColor(gridBackgroundColor);
      }
      if (gridBackgroundImageUrl !== undefined) {
        payload.grid_background_image_url =
          normalizeGridBackgroundImageUrl(gridBackgroundImageUrl);
      }
      if (typeof gridBackgroundBlur === "boolean") {
        payload.grid_background_blur = gridBackgroundBlur;
      }
      return payload;
    };
    if (existing) {
      const payload = buildBoardPayload();
      const { data, error } = await client
        .from("boards")
        .update(payload)
        .eq("id", existing.id)
        .select(
          "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
        )
        .single();

      if (error) {
        return handleSupabaseError(res, error);
      }

      emitChange("boards", "update", data);
      return res.json(data);
    }

    const payload = buildBoardPayload();
    const { data, error } = await client
      .from("boards")
      .insert({
        id: randomUUID(),
        session_id: req.params.sessionId,
        ...payload
      })
      .select(
        "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
      )
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
      .select(
        "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
      )
      .eq("session_id", req.params.sessionId)
      .order("updated_at", { ascending: false });

    if (error) {
      return handleSupabaseError(res, error);
    }
    return res.json(data ?? []);
  });

  app.post("/sessions/:sessionId/tokens", requireAuth, async (req, res) => {
    const body = req.body ?? {};
    const imageUrl = body.image_url ?? body.imageUrl;
    const { name, x, y, rotation, width, height, priority } = body;
    const showName = body.show_name ?? body.showName;
    if (!name || x === undefined || y === undefined) {
      return res.status(400).json({ error: "name, x, y are required" });
    }

    const parsedX = parseNumberField(x);
    const parsedY = parseNumberField(y);
    const parsedRotation = parseNumberField(rotation);
    const parsedWidth = parsePositiveInt(width, DEFAULT_TOKEN_SIZE);
    const parsedHeight = parsePositiveInt(height, DEFAULT_TOKEN_SIZE);
    const parsedPriority = parsePriority(priority, DEFAULT_TOKEN_PRIORITY);
    if (!parsedX.ok || !parsedY.ok || !parsedRotation.ok) {
      return res.status(400).json({ error: "x, y, rotation must be numbers" });
    }
    if (!parsedWidth.ok || !parsedHeight.ok) {
      return res.status(400).json({ error: "width and height must be >= 1" });
    }
    if (!parsedPriority.ok) {
      return res.status(400).json({ error: "priority must be a number" });
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
      x: parsedX.value,
      y: parsedY.value,
      width: parsedWidth.value,
      height: parsedHeight.value,
      rotation: parsedRotation.value ?? 0,
      image_url: imageUrl ?? null,
      show_name: typeof showName === "boolean" ? showName : false,
      priority: parsedPriority.value,
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
      .select(
        "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
      )
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

    const body = req.body ?? {};
    const updates = {};
    if (hasOwn(body, "name")) {
      if (!body.name) {
        return res.status(400).json({ error: "name is required" });
      }
      updates.name = body.name;
    }
    if (hasOwn(body, "x")) {
      if (body.x === undefined || body.x === null) {
        return res.status(400).json({ error: "x must be a number" });
      }
      const parsed = parseNumberField(body.x);
      if (!parsed.ok) {
        return res.status(400).json({ error: "x must be a number" });
      }
      updates.x = parsed.value;
    }
    if (hasOwn(body, "y")) {
      if (body.y === undefined || body.y === null) {
        return res.status(400).json({ error: "y must be a number" });
      }
      const parsed = parseNumberField(body.y);
      if (!parsed.ok) {
        return res.status(400).json({ error: "y must be a number" });
      }
      updates.y = parsed.value;
    }
    if (hasOwn(body, "rotation")) {
      if (body.rotation === undefined || body.rotation === null) {
        return res.status(400).json({ error: "rotation must be a number" });
      }
      const parsed = parseNumberField(body.rotation);
      if (!parsed.ok) {
        return res.status(400).json({ error: "rotation must be a number" });
      }
      updates.rotation = parsed.value ?? 0;
    }
    if (hasOwn(body, "width")) {
      if (body.width === undefined || body.width === null) {
        return res.status(400).json({ error: "width must be >= 1" });
      }
      const parsed = parsePositiveInt(body.width, existing.width);
      if (!parsed.ok) {
        return res.status(400).json({ error: "width must be >= 1" });
      }
      updates.width = parsed.value;
    }
    if (hasOwn(body, "height")) {
      if (body.height === undefined || body.height === null) {
        return res.status(400).json({ error: "height must be >= 1" });
      }
      const parsed = parsePositiveInt(body.height, existing.height);
      if (!parsed.ok) {
        return res.status(400).json({ error: "height must be >= 1" });
      }
      updates.height = parsed.value;
    }
    if (hasOwn(body, "priority")) {
      if (body.priority === undefined || body.priority === null) {
        return res.status(400).json({ error: "priority must be a number" });
      }
      const parsed = parsePriority(body.priority, existing.priority);
      if (!parsed.ok) {
        return res.status(400).json({ error: "priority must be a number" });
      }
      updates.priority = parsed.value;
    }
    if (hasOwn(body, "image_url") || hasOwn(body, "imageUrl")) {
      const imageUrl = body.image_url ?? body.imageUrl;
      updates.image_url = imageUrl ?? null;
    }
    if (hasOwn(body, "show_name") || hasOwn(body, "showName")) {
      const rawShowName = hasOwn(body, "show_name") ? body.show_name : body.showName;
      if (typeof rawShowName !== "boolean") {
        return res.status(400).json({ error: "show_name must be boolean" });
      }
      updates.show_name = rawShowName;
    }

    const { data, error } = await client
      .from("tokens")
      .update({
        ...updates,
        updated_at: now()
      })
      .eq("id", existing.id)
      .select(
        "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
      )
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
      .select(
        "id, session_id, name, x, y, width, height, rotation, image_url, show_name, priority, updated_at"
      )
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

    const { error } = await client.from("tokens").delete().eq("id", req.params.tokenId);
    if (error) {
      return handleSupabaseError(res, error);
    }

    emitChange("tokens", "delete", existing);
    return res.status(204).end();
  });
};
