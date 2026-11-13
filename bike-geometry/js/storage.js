/**
 * Saved "My bikes" helpers.
 * Pure serialize/validate/merge functions are safe to import from Node tests.
 * localStorage access is wrapped so a missing or blocked store does not throw.
 */
import {
  DEFAULTS,
  coerceBike,
  validateBike,
  bikeShortName,
} from "./geometry.js";

export const STORAGE_KEY = "bikegeo.myBikes.v1";

export const SAVED_FIELDS = Object.freeze([
  "model",
  "frame_size",
  "notes",
  "description",
  "top_tube_meas_l",
  "seat_tube_l",
  "head_tube_l",
  "stand_over_h",
  "bb_drop",
  "wheel_base",
  "wheel_dia_front_in",
  "wheel_dia_rear_in",
  "chainstay_l",
  "seat_tube_angle",
  "head_angle",
  "reach",
  "stack",
  "fork_offset",
  "crank_length",
]);

/** Display / unique name for a saved bike: "Model, Size". */
export function savedBikeName(bike) {
  const explicit = String(bike?.name ?? "").trim();
  if (explicit) return explicit;
  return bikeShortName(bike);
}

export function uniqueName(name, existingNames) {
  const base = String(name || "").trim() || "Custom";
  const taken = new Set(
    (existingNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean),
  );
  if (!taken.has(base.toLowerCase())) return base;
  let i = 2;
  let candidate = `${base} (${i})`;
  while (taken.has(candidate.toLowerCase())) {
    i += 1;
    candidate = `${base} (${i})`;
  }
  return candidate;
}

/** Pick known geometry fields, coerce types, and default crank length. */
export function extractSavedBike(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const picked = {};
  for (const key of SAVED_FIELDS) {
    if (src[key] !== undefined) picked[key] = src[key];
  }
  const bike = coerceBike(picked);
  const name = String(src.name ?? "").trim() || bikeShortName(bike);
  if (name) bike.name = name;
  return bike;
}

export function validateSavedBike(raw) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, bike: null, errors: { bike: "Entry is not an object." } };
  }
  const bike = extractSavedBike(raw);
  const check = validateBike(bike);
  if (!savedBikeName(bike)) {
    check.errors.model = check.errors.model || "A name (model and size) is required.";
    check.ok = false;
  }
  return { ok: check.ok, bike, errors: check.errors };
}

export function serializeMyBikes(list) {
  const bikes = (Array.isArray(list) ? list : [])
    .map((b) => {
      const bike = extractSavedBike(b);
      const name = savedBikeName(bike);
      return name ? { name, ...bike } : bike;
    })
    .filter((b) => savedBikeName(b));
  return JSON.stringify({ version: 1, bikes }, null, 2);
}

/**
 * Parse an exported JSON string (or already-parsed value).
 * Invalid entries are skipped and listed; valid ones are returned.
 */
export function parseMyBikesJson(text) {
  const skipped = [];
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch (err) {
    return {
      ok: false,
      bikes: [],
      skipped,
      error: `That file is not valid JSON (${err.message || err}).`,
    };
  }

  let rows;
  if (Array.isArray(data)) rows = data;
  else if (data && Array.isArray(data.bikes)) rows = data.bikes;
  else if (data && typeof data === "object" && (data.model || data.name)) rows = [data];
  else {
    return {
      ok: false,
      bikes: [],
      skipped,
      error: "That file does not contain a list of saved bikes.",
    };
  }

  const bikes = [];
  rows.forEach((row, index) => {
    const result = validateSavedBike(row);
    if (!result.ok) {
      const label = savedBikeName(row) || `entry ${index + 1}`;
      const details = Object.values(result.errors || {}).filter(Boolean).join(" ");
      skipped.push({ index, name: label, reason: details || "Invalid geometry." });
      return;
    }
    bikes.push(result.bike);
  });

  return { ok: true, bikes, skipped, error: "" };
}

/**
 * Merge imported bikes into an existing list.
 * `clash` is "overwrite", "suffix", or a function(name) => "overwrite" | "suffix".
 */
export function mergeImportedBikes(existing, incoming, clash = "suffix") {
  const out = (Array.isArray(existing) ? existing : []).map((b) => extractSavedBike(b));
  const added = [];
  const overwritten = [];
  const renamed = [];
  const skipped = [];

  for (const raw of incoming || []) {
    const result = validateSavedBike(raw);
    if (!result.ok) {
      skipped.push({
        name: savedBikeName(raw) || "unnamed",
        reason: Object.values(result.errors || {}).join(" ") || "Invalid geometry.",
      });
      continue;
    }
    const bike = result.bike;
    const name = savedBikeName(bike);
    const idx = out.findIndex((b) => savedBikeName(b).toLowerCase() === name.toLowerCase());
    if (idx === -1) {
      out.push({ ...bike, name });
      added.push(name);
      continue;
    }
    const action = typeof clash === "function" ? clash(name) : clash;
    if (action === "overwrite") {
      out[idx] = { ...bike, name };
      overwritten.push(name);
    } else {
      const next = uniqueName(
        name,
        out.map((b) => savedBikeName(b)),
      );
      out.push({ ...bike, name: next });
      renamed.push({ from: name, to: next });
    }
  }

  return { bikes: out, added, overwritten, renamed, skipped };
}

export function storageUnavailableMessage() {
  return "This browser cannot save bikes locally (private mode or blocked storage). The rest of the app still works. Use Export/Import after storage is available, or copy a share link for a one-off bike.";
}

/** Returns { ok, message } after a probe write. Does not throw. */
export function probeStorage(store) {
  if (!store) {
    return { ok: false, message: storageUnavailableMessage() };
  }
  const probeKey = STORAGE_KEY + ".probe";
  try {
    store.setItem(probeKey, "1");
    store.removeItem(probeKey);
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: storageUnavailableMessage() };
  }
}

export function getDefaultStore() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadMyBikes(store = getDefaultStore()) {
  const probe = probeStorage(store);
  if (!probe.ok) return { ok: false, unavailable: true, bikes: [], message: probe.message };
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { ok: false, unavailable: true, bikes: [], message: storageUnavailableMessage() };
  }
  if (!raw) return { ok: true, unavailable: false, bikes: [], message: "" };
  const parsed = parseMyBikesJson(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      unavailable: false,
      bikes: [],
      message: "Saved bikes in this browser could not be read. Export will not help until they are repaired; you can import a backup if you have one.",
    };
  }
  return { ok: true, unavailable: false, bikes: parsed.bikes, skipped: parsed.skipped, message: "" };
}

export function saveMyBikes(list, store = getDefaultStore()) {
  const probe = probeStorage(store);
  if (!probe.ok) return { ok: false, message: probe.message };
  try {
    store.setItem(STORAGE_KEY, serializeMyBikes(list));
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: storageUnavailableMessage() };
  }
}

/** Default crank from the original Python settings.py (CRANK_LENGTH = 165). */
export const DEFAULT_CRANK_LENGTH = DEFAULTS.CRANK_LENGTH;
