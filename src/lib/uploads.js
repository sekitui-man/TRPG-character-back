import { randomUUID } from "node:crypto";

export const sanitizeFilename = (value = "upload") =>
  value.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 80) || "upload";

export const normalizeUploadCategory = (value) => {
  const allowed = ["background", "token", "character", "avatar"];
  return allowed.includes(value) ? value : "misc";
};

export const buildStoragePath = (userId, filename, category) => {
  const safeCategory = normalizeUploadCategory(category);
  return `uploads/${userId}/${safeCategory}/${randomUUID()}-${sanitizeFilename(
    filename
  )}`;
};
