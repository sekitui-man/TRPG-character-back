export const parseNumberField = (value) => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: parsed };
};

export const parsePositiveInt = (value, fallback) => {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return { ok: false };
  return { ok: true, value: Math.round(parsed) };
};

export const parsePriority = (value, fallback) => {
  if (value === undefined) return { ok: true, value: fallback };
  if (value === null) return { ok: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { ok: false };
  return { ok: true, value: Math.round(parsed) };
};
