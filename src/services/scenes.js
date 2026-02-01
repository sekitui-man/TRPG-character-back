export const fetchSceneSteps = async (client, sceneId) => {
  const { data, error } = await client
    .from("scene_steps")
    .select("id, scene_id, place_id, pattern_id, position, created_at")
    .eq("scene_id", sceneId)
    .order("position", { ascending: true });

  if (error) return { error };
  return { data: data ?? [] };
};

export const fetchPatternById = async (client, patternId) => {
  if (!patternId) return { data: null };
  const { data, error } = await client
    .from("place_patterns")
    .select("id, place_id, name, background_url")
    .eq("id", patternId)
    .maybeSingle();
  if (error) return { error };
  return { data };
};
