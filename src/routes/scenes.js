import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { now } from "../lib/time.js";
import { getUserClient } from "../services/clients.js";
import { handleSupabaseError } from "../services/errors.js";
import { ensureParticipant } from "../services/participants.js";
import { fetchPatternById, fetchSceneSteps } from "../services/scenes.js";

export const registerSceneRoutes = (app, { emitChange }) => {
  const upsertBoardBackground = async (client, sessionId, backgroundUrl) => {
    const { data: existing, error: existingError } = await client
      .from("boards")
      .select("id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existingError) {
      return { error: existingError };
    }

    const updatedAt = now();
    if (existing) {
      const { data, error } = await client
        .from("boards")
        .update({
          background_url: backgroundUrl ?? null,
          updated_at: updatedAt
        })
        .eq("id", existing.id)
        .select(
          "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
        )
        .single();

      if (error) {
        return { error };
      }
      emitChange("boards", "update", data);
      return { data };
    }

    const { data, error } = await client
      .from("boards")
      .insert({
        id: randomUUID(),
        session_id: sessionId,
        background_url: backgroundUrl ?? null,
        updated_at: updatedAt
      })
      .select(
        "id, session_id, background_url, grid_enabled, grid_background_color, grid_background_image_url, grid_background_blur, updated_at"
      )
      .single();

    if (error) {
      return { error };
    }

    emitChange("boards", "insert", data);
    return { data };
  };

  app.get("/sessions/:sessionId/places", requireAuth, async (req, res) => {
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
      .from("places")
      .select(
        "id, session_id, name, created_at, updated_at, place_patterns (id, name, background_url, created_at)"
      )
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.json(data ?? []);
  });

  app.post("/sessions/:sessionId/places", requireAuth, async (req, res) => {
    const { name } = req.body ?? {};
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

    const record = {
      id: randomUUID(),
      session_id: req.params.sessionId,
      name,
      created_by: req.user.id,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await client
      .from("places")
      .insert(record)
      .select("id, session_id, name, created_at, updated_at")
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.status(201).json(data);
  });

  app.post("/places/:placeId/patterns", requireAuth, async (req, res) => {
    const { name, background_url: backgroundUrl } = req.body ?? {};
    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const client = getUserClient(req);
    const { data: place, error: placeError } = await client
      .from("places")
      .select("id, session_id")
      .eq("id", req.params.placeId)
      .maybeSingle();

    if (placeError) {
      return handleSupabaseError(res, placeError);
    }
    if (!place) {
      return res.status(404).json({ error: "place not found" });
    }

    const membership = await ensureParticipant(client, place.session_id, req.user.id);
    if (!membership.ok) {
      if (membership.status === 403) {
        return res.status(403).json({ error: "forbidden" });
      }
      return handleSupabaseError(res, membership.error);
    }
    if (membership.participant.role !== "owner") {
      return res.status(403).json({ error: "forbidden" });
    }

    const record = {
      id: randomUUID(),
      place_id: place.id,
      name,
      background_url: backgroundUrl ?? null,
      created_at: now()
    };

    const { data, error } = await client
      .from("place_patterns")
      .insert(record)
      .select("id, place_id, name, background_url, created_at")
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.status(201).json(data);
  });

  app.get("/sessions/:sessionId/scenes", requireAuth, async (req, res) => {
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
      .from("scenes")
      .select(
        "id, session_id, name, created_at, updated_at, scene_steps (id, position, place_id, pattern_id, created_at)"
      )
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true })
      .order("position", { foreignTable: "scene_steps", ascending: true });

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.json(data ?? []);
  });

  app.post("/sessions/:sessionId/scenes", requireAuth, async (req, res) => {
    const { name } = req.body ?? {};
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

    const record = {
      id: randomUUID(),
      session_id: req.params.sessionId,
      name,
      created_by: req.user.id,
      created_at: now(),
      updated_at: now()
    };

    const { data, error } = await client
      .from("scenes")
      .insert(record)
      .select("id, session_id, name, created_at, updated_at")
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.status(201).json(data);
  });

  app.post("/scenes/:sceneId/steps", requireAuth, async (req, res) => {
    const { place_id: placeId, pattern_id: patternId } = req.body ?? {};
    if (!placeId || !patternId) {
      return res.status(400).json({ error: "place_id and pattern_id are required" });
    }

    const client = getUserClient(req);
    const { data: scene, error: sceneError } = await client
      .from("scenes")
      .select("id, session_id")
      .eq("id", req.params.sceneId)
      .maybeSingle();

    if (sceneError) {
      return handleSupabaseError(res, sceneError);
    }
    if (!scene) {
      return res.status(404).json({ error: "scene not found" });
    }

    const membership = await ensureParticipant(client, scene.session_id, req.user.id);
    if (!membership.ok) {
      if (membership.status === 403) {
        return res.status(403).json({ error: "forbidden" });
      }
      return handleSupabaseError(res, membership.error);
    }
    if (membership.participant.role !== "owner") {
      return res.status(403).json({ error: "forbidden" });
    }

    const { data: place, error: placeError } = await client
      .from("places")
      .select("id, session_id")
      .eq("id", placeId)
      .maybeSingle();

    if (placeError) {
      return handleSupabaseError(res, placeError);
    }
    if (!place || place.session_id !== scene.session_id) {
      return res.status(400).json({ error: "invalid place" });
    }

    const { data: pattern, error: patternError } = await client
      .from("place_patterns")
      .select("id, place_id")
      .eq("id", patternId)
      .maybeSingle();

    if (patternError) {
      return handleSupabaseError(res, patternError);
    }
    if (!pattern || pattern.place_id !== placeId) {
      return res.status(400).json({ error: "invalid pattern" });
    }

    const { data: lastStep, error: lastStepError } = await client
      .from("scene_steps")
      .select("position")
      .eq("scene_id", scene.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastStepError) {
      return handleSupabaseError(res, lastStepError);
    }

    const position = lastStep ? lastStep.position + 1 : 0;
    const record = {
      id: randomUUID(),
      scene_id: scene.id,
      place_id: placeId,
      pattern_id: patternId,
      position,
      created_at: now()
    };

    const { data, error } = await client
      .from("scene_steps")
      .insert(record)
      .select("id, scene_id, place_id, pattern_id, position, created_at")
      .single();

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.status(201).json(data);
  });

  app.get("/sessions/:sessionId/scene-state", requireAuth, async (req, res) => {
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

    const { data: state, error: stateError } = await client
      .from("scene_states")
      .select("session_id, scene_id, step_index, updated_at")
      .eq("session_id", req.params.sessionId)
      .maybeSingle();

    if (stateError) {
      return handleSupabaseError(res, stateError);
    }

    if (!state || !state.scene_id) {
      return res.json({ state: state ?? null, step: null });
    }

    const { data: steps, error: stepsError } = await fetchSceneSteps(
      client,
      state.scene_id
    );
    if (stepsError) {
      return handleSupabaseError(res, stepsError);
    }
    if (!steps.length) {
      return res.json({ state, step: null });
    }

    const index = Math.min(Math.max(state.step_index, 0), steps.length - 1);
    const step = steps[index];
    const { data: pattern, error: patternError } = await fetchPatternById(
      client,
      step.pattern_id
    );
    if (patternError) {
      return handleSupabaseError(res, patternError);
    }

    return res.json({
      state,
      step: {
        ...step,
        background_url: pattern?.background_url ?? null
      }
    });
  });

  app.post("/sessions/:sessionId/scene-state", requireAuth, async (req, res) => {
    const { scene_id: sceneId } = req.body ?? {};
    if (!sceneId) {
      return res.status(400).json({ error: "scene_id is required" });
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

    const { data: scene, error: sceneError } = await client
      .from("scenes")
      .select("id, session_id")
      .eq("id", sceneId)
      .maybeSingle();

    if (sceneError) {
      return handleSupabaseError(res, sceneError);
    }
    if (!scene || scene.session_id !== req.params.sessionId) {
      return res.status(404).json({ error: "scene not found" });
    }

    const { data: steps, error: stepsError } = await fetchSceneSteps(
      client,
      scene.id
    );
    if (stepsError) {
      return handleSupabaseError(res, stepsError);
    }
    if (!steps.length) {
      return res.status(400).json({ error: "scene has no steps" });
    }

    const { data: pattern, error: patternError } = await fetchPatternById(
      client,
      steps[0].pattern_id
    );
    if (patternError) {
      return handleSupabaseError(res, patternError);
    }

    const updatedAt = now();
    const { data: state, error: stateError } = await client
      .from("scene_states")
      .upsert({
        session_id: req.params.sessionId,
        scene_id: scene.id,
        step_index: 0,
        updated_at: updatedAt
      })
      .select("session_id, scene_id, step_index, updated_at")
      .single();

    if (stateError) {
      return handleSupabaseError(res, stateError);
    }

    const { error: boardError } = await upsertBoardBackground(
      client,
      req.params.sessionId,
      pattern?.background_url ?? null
    );
    if (boardError) {
      return handleSupabaseError(res, boardError);
    }

    return res.json({ state, step: steps[0] });
  });

  app.post("/sessions/:sessionId/scene-next", requireAuth, async (req, res) => {
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

    const { data: state, error: stateError } = await client
      .from("scene_states")
      .select("session_id, scene_id, step_index, updated_at")
      .eq("session_id", req.params.sessionId)
      .maybeSingle();

    if (stateError) {
      return handleSupabaseError(res, stateError);
    }
    if (!state || !state.scene_id) {
      return res.status(404).json({ error: "scene state not found" });
    }

    const { data: steps, error: stepsError } = await fetchSceneSteps(
      client,
      state.scene_id
    );
    if (stepsError) {
      return handleSupabaseError(res, stepsError);
    }
    if (!steps.length) {
      return res.status(400).json({ error: "scene has no steps" });
    }

    const nextIndex = (state.step_index + 1) % steps.length;
    const nextStep = steps[nextIndex];
    const { data: pattern, error: patternError } = await fetchPatternById(
      client,
      nextStep.pattern_id
    );
    if (patternError) {
      return handleSupabaseError(res, patternError);
    }

    const { data: updatedState, error: updateError } = await client
      .from("scene_states")
      .update({
        step_index: nextIndex,
        updated_at: now()
      })
      .eq("session_id", req.params.sessionId)
      .select("session_id, scene_id, step_index, updated_at")
      .single();

    if (updateError) {
      return handleSupabaseError(res, updateError);
    }

    const { error: boardError } = await upsertBoardBackground(
      client,
      req.params.sessionId,
      pattern?.background_url ?? null
    );
    if (boardError) {
      return handleSupabaseError(res, boardError);
    }

    return res.json({ state: updatedState, step: nextStep });
  });
};
