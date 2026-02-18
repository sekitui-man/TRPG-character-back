const STANDARD_PARAM_LABELS = [
  "STR",
  "CON",
  "POW",
  "DEX",
  "APP",
  "SIZ",
  "INT",
  "EDU"
];

const STANDARD_STATUS_LABELS = ["HP", "MP", "SAN"];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toStringValue = (value, fallback = "") => {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return `${value}`;
};

const normalizeParamRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const label = toStringValue(row.label).trim();
      if (!label) {
        return null;
      }
      return {
        label,
        value: toStringValue(row.value)
      };
    })
    .filter(Boolean);
};

const normalizeStatusRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const label = toStringValue(row.label).trim();
      if (!label) {
        return null;
      }
      const value = toNumber(row.value, 0);
      const max = row.max === undefined ? value : toNumber(row.max, value);
      return {
        label,
        value,
        max
      };
    })
    .filter(Boolean);
};

const getSheetData = (sheet) => {
  const data = sheet?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }
  return data;
};

export const buildTypedCharacter = (character, sheet) => {
  const sheetData = getSheetData(sheet);
  const attributes =
    sheetData.attributes && typeof sheetData.attributes === "object"
      ? sheetData.attributes
      : {};
  const legacyStatus =
    sheetData.status && typeof sheetData.status === "object" && !Array.isArray(sheetData.status)
      ? sheetData.status
      : {};

  const paramsRows = normalizeParamRows(sheetData.params);
  const paramsMap = new Map(paramsRows.map((row) => [row.label, row.value]));
  const extraParamsRows = normalizeParamRows(sheetData.paramExtras);

  const statusRows = normalizeStatusRows(
    Array.isArray(sheetData.statusRows) ? sheetData.statusRows : sheetData.status
  );
  const statusMap = new Map(statusRows.map((row) => [row.label, row]));
  const extraStatusRows = normalizeStatusRows(sheetData.statusExtras);

  const con = toNumber(attributes.CON, toNumber(paramsMap.get("CON"), 0));
  const siz = toNumber(attributes.SIZ, toNumber(paramsMap.get("SIZ"), 0));
  const pow = toNumber(attributes.POW, toNumber(paramsMap.get("POW"), 0));
  const hpMaxByAttr = Math.ceil((con + siz) / 2);
  const mpMaxByAttr = pow;
  const sanMaxByAttr = pow * 5;

  const standardParams = STANDARD_PARAM_LABELS.map((label) => {
    const attrValue = attributes[label];
    const fallback = paramsMap.get(label);
    const value = attrValue === undefined ? toStringValue(fallback, "0") : `${toNumber(attrValue, 0)}`;
    return { label, value };
  });
  const extraParams = [
    ...paramsRows.filter((row) => !STANDARD_PARAM_LABELS.includes(row.label)),
    ...extraParamsRows.filter((row) => !STANDARD_PARAM_LABELS.includes(row.label))
  ];
  const dedupedExtraParams = [];
  const extraParamSeen = new Set();
  extraParams.forEach((row) => {
    if (extraParamSeen.has(row.label)) {
      return;
    }
    extraParamSeen.add(row.label);
    dedupedExtraParams.push(row);
  });

  const hpValue =
    legacyStatus.hp !== undefined
      ? toNumber(legacyStatus.hp, 0)
      : toNumber(statusMap.get("HP")?.value, 0);
  const mpValue =
    legacyStatus.mp !== undefined
      ? toNumber(legacyStatus.mp, 0)
      : toNumber(statusMap.get("MP")?.value, 0);
  const sanValue =
    legacyStatus.san !== undefined
      ? toNumber(legacyStatus.san, 0)
      : toNumber(statusMap.get("SAN")?.value, 0);

  const standardStatus = [
    {
      label: "HP",
      value: hpValue,
      max:
        statusMap.get("HP")?.max ??
        (hpMaxByAttr > 0 ? hpMaxByAttr : hpValue)
    },
    {
      label: "MP",
      value: mpValue,
      max:
        statusMap.get("MP")?.max ??
        (mpMaxByAttr > 0 ? mpMaxByAttr : mpValue)
    },
    {
      label: "SAN",
      value: sanValue,
      max:
        statusMap.get("SAN")?.max ??
        (sanMaxByAttr > 0 ? sanMaxByAttr : sanValue)
    }
  ];

  const extraStatus = [
    ...statusRows.filter((row) => !STANDARD_STATUS_LABELS.includes(row.label)),
    ...extraStatusRows
  ];
  const dedupedExtraStatus = [];
  const extraStatusSeen = new Set();
  extraStatus.forEach((row) => {
    if (extraStatusSeen.has(row.label)) {
      return;
    }
    extraStatusSeen.add(row.label);
    dedupedExtraStatus.push(row);
  });

  return {
    kind: "character",
    data: {
      name: toStringValue(sheetData.name, toStringValue(character?.name, "名称未設定")),
      initiative: toNumber(sheetData.initiative, toNumber(attributes.DEX, 0)),
      externalUrl: toStringValue(sheetData.externalUrl, ""),
      iconUrl: toStringValue(sheetData.iconUrl, toStringValue(character?.image_url, "")),
      commands: toStringValue(sheetData.commands, ""),
      status: [...standardStatus, ...dedupedExtraStatus],
      params: [...standardParams, ...dedupedExtraParams]
    },
    meta: {
      character_id: character?.id ?? null,
      user_id: character?.user_id ?? null,
      system: character?.system ?? null,
      created_at: character?.created_at ?? null,
      has_sheet: Boolean(sheet),
      sheet_visibility: sheet?.visibility ?? null,
      sheet_updated_at: sheet?.updated_at ?? null
    }
  };
};
