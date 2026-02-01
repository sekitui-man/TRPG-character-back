import { createUserSupabaseClient } from "../supabase.js";

export const getUserClient = (req) => createUserSupabaseClient(req.accessToken);
