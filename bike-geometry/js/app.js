/**
 * UI for Bike Geometry Comparison.
 * Loads the catalog, keeps up to three slots, live-renders an SVG, and
 * stores the current setup in the URL hash so it can be shared.
 */
import {
  DEFAULTS,
  BLEND_MODES,
  validateBike,
  coerceBike,
  computeAlignedBikes,
  normalizeAlign,
  DEFAULT_ALIGN,
} from "./geometry.js";
import { generateSVG } from "./svg.js";
import { rasterizeSvgToPng, suggestedPngFilename, PNG_FRIENDLY_FAIL } from "./png.js";
import {
  savedBikeName,
  extractSavedBike,
  serializeMyBikes,
  parseMyBikesJson,
  mergeImportedBikes,
  probeStorage,
  getDefaultStore,
  loadMyBikes,
  saveMyBikes,
  DEFAULT_CRANK_LENGTH,
} from "./storage.js";

const FIELD_DEFS = [
  { key: "model", label: "Model", type: "text", unit: "" },
  { key: "frame_size", label: "Frame size", type: "text", unit: "" },
  { key: "notes", label: "Notes", type: "text", unit: "", optional: true, full: true },
  { key: "top_tube_meas_l", label: "Top tube (effective)", type: "number", unit: "mm", step: "0.1" },
  { key: "seat_tube_l", label: "Seat tube", type: "number", unit: "mm", step: "0.1" },
  { key: "head_tube_l", label: "Head tube", type: "number", unit: "mm", step: "0.1" },
  { key: "stand_over_h", label: "Stand-over", type: "number", unit: "mm", step: "0.1" },
  { key: "bb_drop", label: "BB drop", type: "number", unit: "mm", step: "0.1" },
  { key: "wheel_base", label: "Wheelbase", type: "number", unit: "mm", step: "0.1" },
  { key: "chainstay_l", label: "Chainstay", type: "number", unit: "mm", step: "0.1" },
  { key: "reach", label: "Reach", type: "number", unit: "mm", step: "0.1" },
  { key: "stack", label: "Stack", type: "number", unit: "mm", step: "0.1" },
  { key: "fork_offset", label: "Fork offset", type: "number", unit: "mm", step: "0.1" },
  { key: "crank_length", label: "Crank length", type: "number", unit: "mm", step: "0.5" },
  { key: "seat_tube_angle", label: "Seat tube angle", type: "number", unit: "°", step: "0.1" },
  { key: "head_angle", label: "Head angle", type: "number", unit: "°", step: "0.1" },
  { key: "wheel_dia_front_in", label: "Front wheel", type: "number", unit: "in", step: "0.1" },
  { key: "wheel_dia_rear_in", label: "Rear wheel", type: "number", unit: "in", step: "0.1" },
];

const NAMED_COLORS = {
  darkgreen: "#006400",
  darkslateblue: "#483d8b",
  firebrick: "#b22222",
};

function defaultSlots() {
  return [
    { id: "bike_sc_megatower2", color: DEFAULTS.COLORS[0], custom: null },
    { id: "bike_sp_levo4", color: DEFAULTS.COLORS[1], custom: null },
    { id: "", color: DEFAULTS.COLORS[2], custom: null },
  ];
}

function defaultSettings() {
  return {
    BLEND_MODE: DEFAULTS.BLEND_MODE,
    ZOOM_SCALE: DEFAULTS.ZOOM_SCALE,
    WINDOW_WIDTH: DEFAULTS.WINDOW_WIDTH,
    WINDOW_HEIGHT: DEFAULTS.WINDOW_HEIGHT,
    GROUND_LEVEL: DEFAULTS.GROUND_LEVEL,
    REAR_WHEEL_X: DEFAULTS.REAR_WHEEL_X,
    ALIGN: DEFAULT_ALIGN,
  };
}

const MINE_PREFIX = "mine:";

const state = {
  catalog: [],
  myBikes: [],
  storageOk: true,
  storageMessage: "",
  slots: defaultSlots(),
  settings: defaultSettings(),
  lastComputed: [],
};

function isMineId(id) {
  return String(id || "").startsWith(MINE_PREFIX);
}

function mineId(name) {
  return MINE_PREFIX + encodeURIComponent(name);
}

function mineNameFromId(id) {
  try {
    return decodeURIComponent(String(id).slice(MINE_PREFIX.length));
  } catch {
    return String(id).slice(MINE_PREFIX.length);
  }
}

function findMineByName(name) {
  const key = String(name || "").trim().toLowerCase();
  return state.myBikes.find((b) => savedBikeName(b).toLowerCase() === key) || null;
}

function findMine(id) {
  return isMineId(id) ? findMineByName(mineNameFromId(id)) : null;
}

const CATEGORY_ORDER = ["trail", "enduro", "emtb", "light-emtb"];
const CATEGORY_LABELS = {
  trail: "Trail",
  enduro: "Enduro",
  emtb: "Full-power eMTB",
  "light-emtb": "Light eMTB",
};

function bikeLabel(bike) {
  const model = (bike.model || "").trim();
  const size = (bike.frame_size || "").trim();
  return [model, size].filter(Boolean).join(", ");
}

// Frame sizes sort small to large so the sizes of one model sit together.
// Specialized S1–S6 sort by number; letter sizes by this list; anything
// unrecognised keeps its catalog order after the known sizes.
const SIZE_RANK = { XXS: 0, XS: 1, S: 2, SM: 2, M: 3, MD: 3, ML: 3.5, XM: 3.5, L: 4, LG: 4, XL: 5, XXL: 6 };

function sizeRank(bike) {
  const size = String(bike.frame_size || "").trim().toUpperCase();
  const spec = /^S(\d)$/.exec(size);
  if (spec) return Number(spec[1]);
  return size in SIZE_RANK ? SIZE_RANK[size] : 99;
}

// Within a category: models in first-appearance order, each model's sizes small to large.
function sortCatalogGroup(items) {
  const modelOrder = new Map();
  items.forEach((b) => {
    const key = (b.model || "").trim();
    if (!modelOrder.has(key)) modelOrder.set(key, modelOrder.size);
  });
  return items
    .map((b, i) => ({ b, i }))
    .sort(
      (x, y) =>
        modelOrder.get((x.b.model || "").trim()) - modelOrder.get((y.b.model || "").trim()) ||
        sizeRank(x.b) - sizeRank(y.b) ||
        x.i - y.i
    )
    .map((x) => x.b);
}

function findCatalog(id) {
  return state.catalog.find((b) => b.id === id) || null;
}

function emptyCustom() {
  const first = state.catalog[0];
  if (first) {
    const { id, ...rest } = first;
    return {
      ...rest,
      model: "Custom",
      frame_size: "",
      description: "",
      notes: "",
      crank_length: rest.crank_length ?? DEFAULT_CRANK_LENGTH,
    };
  }
  return {
    model: "Custom",
    frame_size: "",
    description: "",
    notes: "",
    top_tube_meas_l: 600,
    seat_tube_l: 400,
    head_tube_l: 120,
    stand_over_h: 750,
    bb_drop: 20,
    wheel_base: 1200,
    chainstay_l: 430,
    seat_tube_angle: 74,
    head_angle: 66,
    reach: 450,
    stack: 620,
    fork_offset: 44,
    crank_length: DEFAULT_CRANK_LENGTH,
    wheel_dia_front_in: 29,
    wheel_dia_rear_in: 29,
  };
}

function slotEntry(slot) {
  if (slot.id === "custom") return slot.custom || emptyCustom();
  if (isMineId(slot.id)) return findMine(slot.id);
  return findCatalog(slot.id);
}

function persistMyBikes() {
  const result = saveMyBikes(state.myBikes);
  if (!result.ok) {
    state.storageOk = false;
    state.storageMessage = result.message;
  }
  return result;
}

function setLibraryStatus(message, isError = false) {
  const el = document.getElementById("library-status");
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.classList.remove("status-error");
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("status-error", isError);
}

function renderLibrary() {
  const note = document.getElementById("library-note");
  const exportBtn = document.getElementById("btn-export-mine");
  const importBtn = document.getElementById("btn-import-mine");
  if (note) {
    note.textContent = state.storageOk
      ? "Saved bikes are stored only in this browser. Clearing site or browser data removes them, so export a JSON backup if you want to keep them."
      : state.storageMessage;
    note.classList.toggle("storage-warning", !state.storageOk);
  }
  if (exportBtn) exportBtn.disabled = state.myBikes.length === 0;
  if (importBtn) importBtn.disabled = !state.storageOk;
}

/* ---------------- URL hash ---------------- */

function toHashObject() {
  return {
    v: 1,
    slots: state.slots.map((s) => {
      const row = { id: s.id, color: s.color };
      if (s.id === "custom" && s.custom) {
        row.bike = s.custom;
      } else if (isMineId(s.id)) {
        // Embed full geometry so the link works in another browser
        // that does not have this saved bike.
        const saved = findMine(s.id);
        if (saved) {
          row.id = "custom";
          row.bike = extractSavedBike(saved);
        }
      }
      return row;
    }),
    set: { ...state.settings },
  };
}

function writeHash() {
  const json = JSON.stringify(toHashObject());
  const hash = "#" + encodeURIComponent(json);
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

function readHash() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return false;
  try {
    const data = JSON.parse(decodeURIComponent(raw));
    if (!data || !Array.isArray(data.slots)) return false;
    const slots = defaultSlots();
    for (let i = 0; i < 3; i += 1) {
      const src = data.slots[i];
      if (!src) continue;
      let id = src.id ?? "";
      let custom = src.bike ? coerceBike(src.bike) : src.custom ? coerceBike(src.custom) : null;
      // Saved-bike ids from a newer hash, or a mine: id with no local copy:
      // fall back to the embedded geometry as a custom bike.
      if (isMineId(id) && !findMine(id)) {
        if (custom) id = "custom";
        else id = "";
      }
      slots[i] = {
        id,
        color: src.color || slots[i].color,
        custom,
      };
    }
    state.slots = slots;
    if (data.set && typeof data.set === "object") {
      state.settings = { ...defaultSettings(), ...data.set };
      // Old share links may carry per-bike offsets; ignore them and use
      // the alignment choice (default: bottom bracket) instead.
      state.settings.ALIGN = normalizeAlign(state.settings.ALIGN ?? data.set.align);
    }
    return true;
  } catch (err) {
    console.warn("Could not read share URL:", err);
    return false;
  }
}

/* ---------------- Rendering ---------------- */

function optionList(selectedId) {
  const none = `<option value=""${selectedId === "" ? " selected" : ""}>— None —</option>`;
  const custom = `<option value="custom"${selectedId === "custom" ? " selected" : ""}>Your Bike…</option>`;
  let mineGroup = "";
  if (state.myBikes.length) {
    mineGroup = `<optgroup label="My bikes">`;
    for (const b of state.myBikes) {
      const id = mineId(savedBikeName(b));
      mineGroup += `<option value="${escapeAttr(id)}"${selectedId === id ? " selected" : ""}>${escapeHtml(savedBikeName(b))}</option>`;
    }
    mineGroup += `</optgroup>`;
  }
  const groups = new Map();
  for (const b of state.catalog) {
    const cat = CATEGORY_LABELS[b.category] ? b.category : "trail";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(b);
  }
  let bikes = "";
  for (const cat of CATEGORY_ORDER) {
    const items = groups.get(cat);
    if (!items || !items.length) continue;
    bikes += `<optgroup label="${escapeAttr(CATEGORY_LABELS[cat])}">`;
    for (const b of sortCatalogGroup(items)) {
      bikes += `<option value="${escapeAttr(b.id)}"${selectedId === b.id ? " selected" : ""}>${escapeHtml(bikeLabel(b))}</option>`;
    }
    bikes += `</optgroup>`;
  }
  return none + custom + mineGroup + bikes;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function fieldInput(slotIndex, field, value, error) {
  const id = `f-${slotIndex}-${field.key}`;
  const unit = field.unit ? ` <em>(${field.unit})</em>` : "";
  const extra = field.type === "number" ? ` step="${field.step || "any"}"` : "";
  const val = value == null ? "" : value;
  return `<label class="${field.full ? "full" : ""}">
      <span>${escapeHtml(field.label)}${unit}</span>
      <input id="${id}" data-slot="${slotIndex}" data-field="${field.key}" type="${field.type}" value="${escapeAttr(val)}"${extra} />
      <span class="field-error" data-err-for="${field.key}">${error ? escapeHtml(error) : ""}</span>
    </label>`;
}

function renderSlots() {
  const host = document.getElementById("slot-list");
  host.innerHTML = state.slots
    .map((slot, i) => {
      const colorValue = NAMED_COLORS[slot.color] || slot.color || "#333333";
      const customOpen = slot.id === "custom";
      const custom = slot.custom || emptyCustom();
      const errors = customOpen ? validateBike(coerceBike(custom)).errors : {};
      const catalogBike = !customOpen && !isMineId(slot.id) && slot.id ? findCatalog(slot.id) : null;
      const savedBike = isMineId(slot.id) ? findMine(slot.id) : null;
      const sourceMeta = catalogBike && catalogBike.source_url
        ? `<p class="source-meta">Geometry source: <a href="${escapeAttr(catalogBike.source_url)}" target="_blank" rel="noopener noreferrer">manufacturer / listed source</a>${catalogBike.setting ? ` · ${escapeHtml(catalogBike.setting)}` : ""}</p>`
        : savedBike
          ? `<p class="source-meta">Saved in this browser as ${escapeHtml(savedBikeName(savedBike))}.</p>`
          : "";
      const mineActions = savedBike
        ? `<div class="mine-actions">
            <button type="button" class="btn btn-small" data-role="edit-mine" data-slot="${i}">Edit</button>
            <button type="button" class="btn btn-small btn-danger" data-role="delete-mine" data-slot="${i}">Delete</button>
          </div>`
        : "";
      const form = customOpen
        ? `<div class="custom-form" data-form="${i}">
            ${FIELD_DEFS.map((f) => fieldInput(i, f, custom[f.key] ?? (f.key === "crank_length" ? DEFAULT_CRANK_LENGTH : ""), errors[f.key])).join("")}
            <div class="form-actions full">
              <button type="button" class="btn btn-primary" data-role="save-mine" data-slot="${i}"${state.storageOk ? "" : " disabled"}>Save to My bikes</button>
              <p class="storage-note">${state.storageOk
                ? "Saved under the model and size you entered. Stored only in this browser — export a backup if you want to keep it."
                : escapeHtml(state.storageMessage)}</p>
            </div>
          </div>`
        : "";
      return `<article class="slot" data-slot="${i}">
        <div class="slot-head">
          <h2 class="slot-title">Bike ${i + 1}
            <input class="color-input" type="color" data-role="color" data-slot="${i}" value="${escapeAttr(hexColor(colorValue))}" title="Bike color" aria-label="Bike ${i + 1} color" />
          </h2>
        </div>
        <label>
          <span>Bike</span>
          <select data-role="source" data-slot="${i}">${optionList(slot.id)}</select>
        </label>
        ${sourceMeta}
        ${mineActions}
        ${form}
      </article>`;
    })
    .join("");
}

function hexColor(value) {
  if (!value) return "#006400";
  if (value.startsWith("#") && (value.length === 7 || value.length === 4)) return value;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return NAMED_COLORS[value] || "#006400";
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  const computed = probe.fillStyle;
  return /^#/.test(computed) ? computed : NAMED_COLORS[value] || "#006400";
}

function renderSettings() {
  const blend = document.getElementById("setting-blend");
  if (!blend.options.length) {
    blend.innerHTML = BLEND_MODES.map(
      (m) => `<option value="${m}"${m === state.settings.BLEND_MODE ? " selected" : ""}>${m}</option>`,
    ).join("");
  } else {
    blend.value = state.settings.BLEND_MODE;
  }
  document.getElementById("setting-width").value = state.settings.WINDOW_WIDTH;
  document.getElementById("setting-height").value = state.settings.WINDOW_HEIGHT;
  document.getElementById("setting-ground").value = state.settings.GROUND_LEVEL;
  const align = document.getElementById("setting-align");
  if (align) align.value = normalizeAlign(state.settings.ALIGN);
}

function currentComputed() {
  const baseSettings = { ...DEFAULTS, ...state.settings };
  const bikes = [];
  const optionsList = [];
  const problems = [];
  state.slots.forEach((slot, i) => {
    if (!slot.id) return;
    const entry = slotEntry(slot);
    if (!entry) {
      problems.push(`Bike ${i + 1}: no geometry selected.`);
      return;
    }
    const bike = coerceBike(entry);
    const check = validateBike(bike);
    if (!check.ok) {
      problems.push(`Bike ${i + 1} has invalid geometry. Check the highlighted fields.`);
      return;
    }
    bikes.push(bike);
    optionsList.push({ color: slot.color, bikeNumber: bikes.length });
  });
  const { computed, settings } = computeAlignedBikes(
    bikes,
    optionsList,
    baseSettings,
    baseSettings.ALIGN,
  );
  return { computed, problems, settings };
}

function renderPreview() {
  const host = document.getElementById("svg-host");
  const err = document.getElementById("preview-error");
  const { computed, problems, settings } = currentComputed();
  state.lastComputed = computed;
  if (problems.length && computed.length === 0) {
    err.hidden = false;
    err.textContent = problems.join(" ");
    host.innerHTML = "";
    setDownloadEnabled(false);
    return;
  }
  if (problems.length) {
    err.hidden = false;
    err.textContent = problems.join(" ");
  } else {
    err.hidden = true;
    err.textContent = "";
  }
  const svg = generateSVG(computed, settings);
  host.innerHTML = svg;
  setDownloadEnabled(computed.length > 0);
}

function setDownloadEnabled(on) {
  const pngBtn = document.getElementById("btn-download-png");
  if (pngBtn) pngBtn.disabled = !on;
}

function refresh({ rebuildSlots = false } = {}) {
  if (rebuildSlots) renderSlots();
  renderPreview();
  writeHash();
}

/* ---------------- Events ---------------- */

function bind() {
  document.getElementById("slot-list").addEventListener("input", onSlotInput);
  document.getElementById("slot-list").addEventListener("change", onSlotInput);
  document.getElementById("slot-list").addEventListener("click", onSlotClick);

  document.getElementById("setting-blend").addEventListener("change", (e) => {
    state.settings.BLEND_MODE = e.target.value;
    refresh();
  });
  const numSetting = (id, key, fallback) => {
    document.getElementById(id).addEventListener("change", (e) => {
      const n = Number(e.target.value);
      state.settings[key] = Number.isFinite(n) ? n : fallback;
      refresh();
    });
  };
  numSetting("setting-width", "WINDOW_WIDTH", DEFAULTS.WINDOW_WIDTH);
  numSetting("setting-height", "WINDOW_HEIGHT", DEFAULTS.WINDOW_HEIGHT);
  numSetting("setting-ground", "GROUND_LEVEL", DEFAULTS.GROUND_LEVEL);
  document.getElementById("setting-align").addEventListener("change", (e) => {
    state.settings.ALIGN = normalizeAlign(e.target.value);
    refresh();
  });

  document.getElementById("btn-download-png").addEventListener("click", downloadPng);
  document.getElementById("btn-share").addEventListener("click", copyShareLink);
  document.getElementById("btn-reset").addEventListener("click", () => {
    state.slots = defaultSlots();
    state.settings = defaultSettings();
    renderSettings();
    refresh({ rebuildSlots: true });
  });

  window.addEventListener("hashchange", () => {
    if (readHash()) {
      renderSettings();
      refresh({ rebuildSlots: true });
    }
  });

  const exportBtn = document.getElementById("btn-export-mine");
  const importBtn = document.getElementById("btn-import-mine");
  const importFile = document.getElementById("import-mine-file");
  if (exportBtn) exportBtn.addEventListener("click", exportMyBikes);
  if (importBtn && importFile) {
    importBtn.addEventListener("click", () => {
      if (!state.storageOk) {
        setLibraryStatus(state.storageMessage, true);
        return;
      }
      importFile.value = "";
      importFile.click();
    });
    importFile.addEventListener("change", onImportFile);
  }
}

function onSlotClick(event) {
  const el = event.target.closest("[data-role]");
  if (!el) return;
  const role = el.dataset.role;
  if (role !== "save-mine" && role !== "edit-mine" && role !== "delete-mine") return;
  event.preventDefault();
  const index = Number(el.dataset.slot);
  if (!Number.isInteger(index) || !state.slots[index]) return;
  const slot = state.slots[index];
  if (role === "save-mine") saveCurrentCustom(index);
  else if (role === "edit-mine") editSavedBike(index);
  else if (role === "delete-mine") deleteSavedBike(index);
}

function saveCurrentCustom(index) {
  const slot = state.slots[index];
  if (!state.storageOk) {
    setLibraryStatus(state.storageMessage, true);
    return;
  }
  if (!slot.custom) slot.custom = emptyCustom();
  const bike = coerceBike(slot.custom);
  const check = validateBike(bike);
  if (!check.ok) {
    setLibraryStatus("Fix the highlighted fields before saving.", true);
    refresh({ rebuildSlots: true });
    return;
  }
  const record = extractSavedBike(bike);
  const name = savedBikeName(record);
  record.name = name;
  const existing = findMineByName(name);
  const editingSame = slot.editingName && slot.editingName.toLowerCase() === name.toLowerCase();
  if (existing && !editingSame) {
    const ok = window.confirm(
      `A saved bike named “${name}” already exists. Replace it with these numbers?`,
    );
    if (!ok) return;
  }
  if (existing) {
    const idx = state.myBikes.findIndex((b) => savedBikeName(b).toLowerCase() === name.toLowerCase());
    state.myBikes[idx] = record;
  } else {
    state.myBikes.push(record);
  }
  const written = persistMyBikes();
  if (!written.ok) {
    setLibraryStatus(written.message, true);
    renderLibrary();
    return;
  }
  slot.id = mineId(name);
  slot.custom = record;
  slot.editingName = name;
  setLibraryStatus(`Saved “${name}” to My bikes.`);
  renderLibrary();
  refresh({ rebuildSlots: true });
}

function editSavedBike(index) {
  const slot = state.slots[index];
  const saved = findMine(slot.id);
  if (!saved) return;
  const name = savedBikeName(saved);
  slot.id = "custom";
  slot.custom = coerceBike(extractSavedBike(saved));
  slot.editingName = name;
  refresh({ rebuildSlots: true });
}

function deleteSavedBike(index) {
  const slot = state.slots[index];
  const saved = findMine(slot.id);
  if (!saved) return;
  const name = savedBikeName(saved);
  const ok = window.confirm(`Delete “${name}” from My bikes? This cannot be undone.`);
  if (!ok) return;
  // Keep a copy in any slot that was showing this bike, as a custom entry.
  const copy = coerceBike(extractSavedBike(saved));
  state.myBikes = state.myBikes.filter((b) => savedBikeName(b).toLowerCase() !== name.toLowerCase());
  const written = persistMyBikes();
  if (!written.ok) {
    setLibraryStatus(written.message, true);
    renderLibrary();
    return;
  }
  for (const s of state.slots) {
    if (isMineId(s.id) && mineNameFromId(s.id).toLowerCase() === name.toLowerCase()) {
      s.id = "custom";
      s.custom = { ...copy };
      s.editingName = "";
    }
  }
  setLibraryStatus(`Deleted “${name}” from My bikes. The numbers are still in the custom form so you can keep or re-save them.`);
  renderLibrary();
  refresh({ rebuildSlots: true });
}

function exportMyBikes() {
  if (!state.myBikes.length) {
    setLibraryStatus("There are no saved bikes to export yet.", true);
    return;
  }
  const text = serializeMyBikes(state.myBikes);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "my-bikes.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setLibraryStatus("Exported My bikes as my-bikes.json.");
}

async function onImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  if (!state.storageOk) {
    setLibraryStatus(state.storageMessage, true);
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    setLibraryStatus("Could not read that file.", true);
    return;
  }
  const parsed = parseMyBikesJson(text);
  if (!parsed.ok) {
    setLibraryStatus(parsed.error, true);
    return;
  }
  if (!parsed.bikes.length) {
    const skipped = parsed.skipped.length
      ? ` No valid bikes found. Skipped: ${parsed.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}.`
      : " No bikes were in that file.";
    setLibraryStatus(skipped.trim(), true);
    return;
  }
  const existingNames = new Set(state.myBikes.map((b) => savedBikeName(b).toLowerCase()));
  const clashes = parsed.bikes.filter((b) => existingNames.has(savedBikeName(b).toLowerCase()));
  let clash = "suffix";
  if (clashes.length) {
    const ok = window.confirm(
      `${clashes.length} imported bike${clashes.length === 1 ? "" : "s"} use a name that already exists. Click OK to replace the existing bike${clashes.length === 1 ? "" : "s"}, or Cancel to keep both (a number will be added to the imported name).`,
    );
    clash = ok ? "overwrite" : "suffix";
  }
  const merged = mergeImportedBikes(state.myBikes, parsed.bikes, clash);
  state.myBikes = merged.bikes;
  const written = persistMyBikes();
  if (!written.ok) {
    setLibraryStatus(written.message, true);
    renderLibrary();
    return;
  }
  const parts = [];
  if (merged.added.length) parts.push(`added ${merged.added.length}`);
  if (merged.overwritten.length) parts.push(`replaced ${merged.overwritten.length}`);
  if (merged.renamed.length) parts.push(`renamed ${merged.renamed.length}`);
  const skippedAll = [...(parsed.skipped || []), ...(merged.skipped || [])];
  if (skippedAll.length) {
    parts.push(
      `skipped ${skippedAll.length} invalid ${skippedAll.length === 1 ? "entry" : "entries"} (${skippedAll.map((s) => s.name).join(", ")})`,
    );
  }
  setLibraryStatus(`Import complete: ${parts.join(", ") || "no changes"}.`, skippedAll.length > 0 && !merged.added.length && !merged.overwritten.length && !merged.renamed.length);
  renderLibrary();
  refresh({ rebuildSlots: true });
}

function onSlotInput(event) {
  const el = event.target;
  const index = Number(el.dataset.slot);
  if (!Number.isInteger(index) || !state.slots[index]) return;
  const slot = state.slots[index];
  const role = el.dataset.role;

  if (role === "source") {
    const prevEntry = slotEntry(slot);
    const prevId = slot.id;
    slot.id = el.value;
    if (slot.id === "custom") {
      const src = prevEntry || emptyCustom();
      const { id, ...rest } = src;
      slot.custom = coerceBike(rest);
      slot.editingName = prevId && isMineId(prevId) ? mineNameFromId(prevId) : "";
    } else {
      slot.editingName = isMineId(slot.id) ? mineNameFromId(slot.id) : "";
    }
    refresh({ rebuildSlots: true });
    return;
  }
  if (role === "color") {
    slot.color = el.value;
    refresh();
    return;
  }
  if (el.dataset.field) {
    if (!slot.custom) slot.custom = emptyCustom();
    const key = el.dataset.field;
    slot.custom[key] = el.type === "number" && el.value !== "" ? Number(el.value) : el.value;
    const check = validateBike(coerceBike(slot.custom));
    const errEl = el.parentElement.querySelector(".field-error");
    if (errEl) errEl.textContent = check.errors[key] || "";
    refresh();
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadPng() {
  const { computed, settings } = currentComputed();
  if (!computed.length) return;
  const pngBtn = document.getElementById("btn-download-png");
  if (pngBtn) pngBtn.disabled = true;
  try {
    const text = generateSVG(computed, settings);
    const result = await rasterizeSvgToPng(text);
    triggerDownload(result.blob, suggestedPngFilename(computed));
  } catch (err) {
    console.warn("PNG download failed:", err);
    showActionStatus(err?.message || PNG_FRIENDLY_FAIL, 5000);
  } finally {
    const still = currentComputed();
    if (pngBtn) pngBtn.disabled = still.computed.length === 0;
  }
}

function showActionStatus(message, timeoutMs = 3000) {
  const status = document.getElementById("share-status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  setTimeout(() => {
    status.hidden = true;
  }, timeoutMs);
}

async function copyShareLink() {
  writeHash();
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    showActionStatus("Share link copied to the clipboard.");
  } catch {
    showActionStatus("Copy the address bar — the current setup is already in the URL.");
  }
}

/* ---------------- Boot ---------------- */

async function boot() {
  const err = document.getElementById("preview-error");
  try {
    const res = await fetch("bikes/bikes.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load bikes/bikes.json (${res.status})`);
    state.catalog = await res.json();
  } catch (e) {
    err.hidden = false;
    err.textContent =
      "Could not load the bike catalog. If you opened index.html as a file, serve the folder instead: python3 -m http.server";
    console.error(e);
    return;
  }
  const stored = loadMyBikes();
  state.storageOk = !stored.unavailable;
  state.storageMessage = stored.message || "";
  state.myBikes = stored.bikes || [];
  readHash();
  renderSettings();
  renderLibrary();
  renderSlots();
  bind();
  refresh();
  if (stored.skipped && stored.skipped.length) {
    setLibraryStatus(
      `Some saved bikes in this browser were skipped because they are invalid: ${stored.skipped.map((s) => s.name).join(", ")}.`,
      true,
    );
  }
}

boot();
