import { supabase } from "./supabase.js";

export const verifyAuthToken = async (token) => {
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }
  return data.user;
};

const getBearerToken = (headers = {}) => {
  const authHeader = headers.authorization ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) {
    return token;
  }
  return "";
};

export const requireAuth = async (req, res, next) => {
  const accessToken = getBearerToken(req.headers);
  if (!accessToken) {
    return res.status(401).json({ error: "missing authorization" });
  }

  const user = await verifyAuthToken(accessToken);
  if (!user) {
    return res.status(401).json({ error: "unauthorized" });
  }

  req.user = user;
  req.accessToken = accessToken;
  return next();
};
