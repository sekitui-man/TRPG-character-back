import { timingSafeEqual } from "node:crypto";
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

const parseCsv = (value = "") =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const botApiKeys = Array.from(
  new Set([
    ...parseCsv(process.env.BOT_API_KEYS ?? ""),
    ...parseCsv(process.env.BOT_API_KEY ?? "")
  ])
);

const isSameToken = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};

const getBotToken = (headers = {}) => {
  const bearerToken = getBearerToken(headers);
  if (bearerToken) {
    return bearerToken;
  }
  const value = headers["x-bot-key"];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return typeof value === "string" ? value : "";
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

export const requireBotAuth = (req, res, next) => {
  if (botApiKeys.length === 0) {
    return res.status(500).json({ error: "bot auth is not configured" });
  }

  const botToken = getBotToken(req.headers);
  if (!botToken) {
    return res.status(401).json({ error: "missing bot authorization" });
  }

  const authorized = botApiKeys.some((key) => isSameToken(key, botToken));
  if (!authorized) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return next();
};
