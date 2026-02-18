import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
}

const createSupabaseClient = (apiKey, accessToken = "") =>
  createClient(supabaseUrl, apiKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    }
  });

export const supabase = createSupabaseClient(supabaseAnonKey);

export const createUserSupabaseClient = (accessToken) =>
  createSupabaseClient(supabaseAnonKey, accessToken);

export const getServiceSupabaseClient = () => {
  if (!supabaseServiceRoleKey) {
    return null;
  }
  return createSupabaseClient(supabaseServiceRoleKey);
};
