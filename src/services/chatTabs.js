import { userCanViewTab } from "../lib/roles.js";

export const fetchChatTabById = async (client, tabId) => {
  const { data, error } = await client
    .from("chat_tabs")
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .eq("id", tabId)
    .maybeSingle();
  if (error) return { error };
  return { data };
};

export const fetchDefaultChatTab = async (client, sessionId) => {
  const { data, error } = await client
    .from("chat_tabs")
    .select(
      "id, session_id, name, allowed_roles, allowed_users, toast_enabled, is_default, created_at, updated_at"
    )
    .eq("session_id", sessionId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { error };
  return { data };
};

export const resolveChatTab = async (
  client,
  sessionId,
  tabId,
  participant,
  userId
) => {
  if (tabId) {
    const { data, error } = await fetchChatTabById(client, tabId);
    if (error) return { error };
    if (!data || data.session_id !== sessionId) {
      return { error: { message: "chat tab not found" }, status: 404 };
    }
    if (!userCanViewTab(data, participant, userId)) {
      return { error: { message: "forbidden" }, status: 403 };
    }
    return { data };
  }

  const { data, error } = await fetchDefaultChatTab(client, sessionId);
  if (error) return { error };
  if (!data) {
    return { error: { message: "chat tab not found" }, status: 404 };
  }
  if (!userCanViewTab(data, participant, userId)) {
    return { error: { message: "forbidden" }, status: 403 };
  }
  return { data };
};
