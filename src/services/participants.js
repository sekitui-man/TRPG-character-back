export const ensureParticipant = async (client, sessionId, userId) => {
  const { data, error } = await client
    .from("session_participants")
    .select("id, role")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error };
  }
  if (!data) {
    return { ok: false, status: 403 };
  }
  return { ok: true, participant: data };
};
