export const normalizeVisibility = (value) =>
  ["private", "link", "public"].includes(value) ? value : "private";

export const normalizeSheetVisibility = (value) =>
  value === "public" ? "public" : "private";
