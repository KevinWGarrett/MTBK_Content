/**
 * Pure geometry for Bike Geometry Visual Comparator.
 * Port of bike_geo_classes.py + mymaths.py, with the confirmed bug fixes applied.
 * No DOM. Safe to import from the browser or from Node tests.
 */

export const DEFAULTS = Object.freeze({
  COLORS: Object.freeze(["darkgreen", "darkslateblue", "firebrick"]),
  WINDOW_WIDTH: 2600,
  WINDOW_HEIGHT: 2200,
  ZOOM_SCALE: 0.4,
  GROUND_LEVEL: 1600,
  BLEND_MODE: "hard-light",
  REAR_WHEEL_X: 650,
  SEATTUBE_L: 450,
  TIRE_WIDTH: 60,
  SADDLE_OFFSET_X: -20,
  SADDLE_OFFSET_Y: 290,
  TOPTUBE_Y_OFFSET: 30,
  DOWNTUBE_Y_OFFSET: 25,
  CRANK_LENGTH: 165,
  LABELS_OFFSET_Y: 200,
  BLOCK_OFFSET_Y: 1690,
  COLUMNS_X_TWEAK: 740,
  DIFFS_OFFSET_X: 320,
  MADEBY_X_TWEAK: 660,
  MADEBY_Y_TWEAK: 20,
  FONT_FAMILY: "'Noto Sans', sans-serif",
  LABEL_FONT_SIZE: 80,
  NOTES_FONT_SIZE: 48,
  SPECS_HEADING_FONT_SIZE: 52,
  SPECS_NOTES_FONT_SIZE: 34,
  SPECS_FONT_SIZE: 40,
  MARKER_FONT_SIZE: 38,
  MADEBY_FONT_SIZE: 30,
  LINE_HEIGHT: 1.3,
  DASH_STROKE: "stroke-dasharray:15",
  DIM_FILL: "rgba(204, 204, 204, 0.2)",
});

export function in2mm(inches) {
  return inches * 25.4;
}

export function mm2in(millimeters) {
  return millimeters / 25.4;
}

/** Python-like round to `digits` decimal places. Close enough for 0.1 tolerance. */
export function pyRound(x, digits = 0) {
  if (!Number.isFinite(x)) return x;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

function rad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Point on the line through (x1,y1)-(x2,y2).
 * Pass new_x === "x" (or "") to solve for x given new_y, or new_y === "y" (or "") to solve for y given new_x.
 */
export function getpointonline(x1, y1, x2, y2, new_x, new_y) {
  if (new_x === "x" || new_x === "") {
    const m = (y2 - y1) / (x2 - x1);
    const b = y2 - m * x2;
    return (new_y - b) / m;
  }
  if (new_y === "y" || new_y === "") {
    const m = (y2 - y1) / (x2 - x1);
    const b = y2 - m * x2;
    return m * new_x + b;
  }
  return "Error";
}

/**
 * Point on the line through (x1,y1) at `angle_from_horizontal` degrees.
 * Same calling convention as getpointonline.
 */
export function getpointonlinebyangle(x1, y1, angle_from_horizontal, new_x, new_y) {
  const myAngle = rad(angle_from_horizontal);
  const m = Math.sin(myAngle) / Math.cos(myAngle);
  if (new_x === "x" || new_x === "") {
    const b = y1 - m * x1;
    return (new_y - b) / m;
  }
  if (new_y === "y" || new_y === "") {
    const b = y1 - m * x1;
    return m * new_x + b;
  }
  return "Error";
}

const SPEC_ORDER = [
  ["caster", "caster"],
  ["bb_height", "bb_height"],
  ["head_angle", "head_angle"],
  ["reach", "reach"],
  ["stack", "stack"],
  ["standover", "standover"],
  ["seat_angle", "seat_angle"],
  ["wheelbase", "wheelbase"],
];

/**
 * Compute a full bike: frame points, wheels, and effective specs.
 * x-offset is applied before any geometry is built.
 *
 * @param {object} bike catalog / form entry
 * @param {{xOffset?: number, color?: string, bikeNumber?: number}} [options]
 * @param {object} [settings] overrides for DEFAULTS
 */
export function computeBike(bike, options = {}, settings = {}) {
  const S = { ...DEFAULTS, ...settings };
  const xOffset = Number(options.xOffset ?? 0) || 0;
  const bikeNumber = options.bikeNumber ?? 1;
  const color = options.color ?? S.COLORS[(bikeNumber - 1) % S.COLORS.length] ?? "darkgreen";

  const top_tube_meas_l = bike.top_tube_meas_l;
  const head_tube_l = bike.head_tube_l;
  const stand_over_h = bike.stand_over_h;
  const bb_drop = bike.bb_drop;
  const wheel_base = bike.wheel_base;
  const chainstay_l = bike.chainstay_l;
  const seat_tube_angle_deg = bike.seat_tube_angle;
  const head_angle_deg = bike.head_angle;
  const reach = bike.reach;
  const stack = bike.stack;
  const fork_offset = bike.fork_offset;
  const wheel_dia_front = in2mm(bike.wheel_dia_front_in);
  const wheel_dia_rear = in2mm(bike.wheel_dia_rear_in);
  const wheel_rear_c_x = S.REAR_WHEEL_X + xOffset;
  const head_angle_complement_deg = 90 - head_angle_deg;

  const p_10_y = S.GROUND_LEVEL - wheel_dia_front / 2;
  const p_1_y = S.GROUND_LEVEL - wheel_dia_rear / 2;

  // atan2 guards wheel_base == 0 (equal wheels => tilt 0)
  const frame_tilt_angle_rad = Math.atan2(p_10_y - p_1_y, wheel_base || 0);
  const frame_tilt_angle_deg = (frame_tilt_angle_rad * 180) / Math.PI;

  const p_1_x = S.REAR_WHEEL_X + xOffset;

  // Chainstay is a true length, not a horizontal run
  const csHoriz = Math.sqrt(Math.max(chainstay_l ** 2 - bb_drop ** 2, 0));
  const p_2_x = p_1_x + csHoriz;
  const p_2_y = p_1_y + bb_drop;

  const p_6_x = p_2_x + reach;
  const p_6_y = p_2_y - stack;

  const p_7_x = p_6_x - top_tube_meas_l;
  const p_7_y = p_6_y;

  const p_3_x = pyRound(p_6_x + Math.sin(rad(90 - head_angle_deg)) * head_tube_l, 1);
  const p_3_y = pyRound(p_6_y + Math.cos(rad(90 - head_angle_deg)) * head_tube_l, 1);

  const p_4_x = pyRound(p_3_x - S.DOWNTUBE_Y_OFFSET * Math.sin(rad(90 - head_angle_deg)), 1);
  const p_4_y = pyRound(p_3_y - S.DOWNTUBE_Y_OFFSET * Math.cos(rad(90 - head_angle_deg)), 1);

  const p_5_x = pyRound(p_6_x + S.TOPTUBE_Y_OFFSET * Math.sin(rad(90 - head_angle_deg)), 1);
  const p_5_y = pyRound(p_6_y + S.TOPTUBE_Y_OFFSET * Math.cos(rad(90 - head_angle_deg)), 1);

  const p_8_y = S.GROUND_LEVEL - stand_over_h;
  const p_8_x = getpointonlinebyangle(p_7_x, p_7_y, seat_tube_angle_deg, "x", p_8_y);

  const p_9_x = pyRound(p_7_x + Math.sin(rad(90 - seat_tube_angle_deg)) * S.SEATTUBE_L, 1);
  const p_9_y = pyRound(p_7_y + Math.cos(rad(90 - seat_tube_angle_deg)) * S.SEATTUBE_L, 1);

  const p_11_x = p_6_x + fork_offset * Math.cos(rad(head_angle_complement_deg));
  const p_11_y = p_6_y - fork_offset * Math.sin(rad(head_angle_complement_deg));

  function rotateFrame(x, y) {
    const dx = x - p_1_x;
    const dy = y - p_1_y;
    const radius = Math.sqrt(dx ** 2 + dy ** 2);
    const angleOriginal = Math.atan2(dy, dx);
    const angleNew = angleOriginal + frame_tilt_angle_rad;
    return [
      pyRound(p_1_x + Math.cos(angleNew) * radius, 1),
      pyRound(p_1_y + Math.sin(angleNew) * radius, 1),
    ];
  }

  const pt_1 = rotateFrame(p_1_x, p_1_y);
  const pt_2 = rotateFrame(p_2_x, p_2_y);
  const pt_3 = rotateFrame(p_3_x, p_3_y);
  const pt_4 = rotateFrame(p_4_x, p_4_y);
  const pt_5 = rotateFrame(p_5_x, p_5_y);
  const pt_6 = rotateFrame(p_6_x, p_6_y);
  let pt_7 = rotateFrame(p_7_x, p_7_y);
  let pt_8 = rotateFrame(p_8_x, p_8_y);
  let pt_9 = rotateFrame(p_9_x, p_9_y);
  const pt_10 = [0, p_10_y];
  const pt_11 = rotateFrame(p_11_x, p_11_y);

  const new_head_angle_deg = head_angle_deg + frame_tilt_angle_deg;

  // Seatpost correction: virtual top tube stays level with the stem
  pt_7 = [pt_6[0] - top_tube_meas_l, pt_6[1]];

  // Recompute points 8 and 9 from the corrected seatpost using the effective seat-tube angle
  const effSta = seat_tube_angle_deg + frame_tilt_angle_deg;
  const p8y = S.GROUND_LEVEL - stand_over_h;
  pt_8 = [
    pyRound(getpointonlinebyangle(pt_7[0], pt_7[1], effSta, "x", p8y), 1),
    pyRound(p8y, 1),
  ];
  pt_9 = [
    pyRound(pt_7[0] + Math.sin(rad(90 - effSta)) * S.SEATTUBE_L, 1),
    pyRound(pt_7[1] + Math.cos(rad(90 - effSta)) * S.SEATTUBE_L, 1),
  ];

  const pt_saddle = [pt_7[0] + S.SADDLE_OFFSET_X, pt_6[1] + S.SADDLE_OFFSET_Y];

  pt_10[0] = pyRound(
    getpointonlinebyangle(pt_11[0], pt_11[1], new_head_angle_deg, "x", pt_10[1]),
    1,
  );

  const pt_12 = [
    pyRound(getpointonlinebyangle(pt_6[0], pt_6[1], new_head_angle_deg, "x", S.GROUND_LEVEL), 1),
    S.GROUND_LEVEL,
  ];
  const pt_13 = [pt_10[0], S.GROUND_LEVEL];

  const frontRadius = pyRound(wheel_dia_front / 2, 1);
  const rearRadius = pyRound(wheel_dia_rear / 2, 1);
  const frontCx = pyRound(pt_10[0], 1);
  const rearCx = pyRound(wheel_rear_c_x, 1);
  const frontCy = S.GROUND_LEVEL - frontRadius;
  const rearCy = S.GROUND_LEVEL - rearRadius;

  const specs = {
    caster: [pyRound(pt_12[0] - frontCx, 0), "Caster"],
    bb_height: [pyRound(S.GROUND_LEVEL - pt_2[1], 0), "BB Height"],
    head_angle: [pyRound(head_angle_deg + frame_tilt_angle_deg, 1), "Head Angle"],
    reach: [pyRound(pt_6[0] - pt_2[0], 1), "Reach"],
    stack: [pyRound(pt_2[1] - pt_6[1], 0), "Stack"],
    standover: [pyRound(S.GROUND_LEVEL - pt_8[1], 1), "Stand Over"],
    seat_angle: [pyRound(seat_tube_angle_deg + frame_tilt_angle_deg, 1), "Seat Tube Angle"],
    wheelbase: [pyRound(pt_10[0] - pt_1[0], 1), "Wheel Base"],
  };
  const crank_length = resolveCrankLength(bike, S);
  // Pedal at the bottom of the stroke, ignoring pedal thickness.
  specs.pedal_to_ground = [pyRound(specs.bb_height[0] - crank_length, 0), "Pedal to Ground"];

  return {
    bikeNumber,
    color,
    xOffset,
    model: bike.model,
    frame_size: bike.frame_size,
    description: bike.description ?? "",
    notes: String(bike.notes ?? bike.description ?? "").trim(),
    fork_offset,
    crank_length,
    input: bike,
    tiltDeg: frame_tilt_angle_deg,
    tiltRad: frame_tilt_angle_rad,
    newHeadAngleDeg: new_head_angle_deg,
    wheelDiaFront: wheel_dia_front,
    wheelDiaRear: wheel_dia_rear,
    wheelRearCx: wheel_rear_c_x,
    points: {
      1: pt_1,
      2: pt_2,
      3: pt_3,
      4: pt_4,
      5: pt_5,
      6: pt_6,
      7: pt_7,
      8: pt_8,
      9: pt_9,
      10: pt_10,
      11: pt_11,
      12: pt_12,
      13: pt_13,
      saddle: pt_saddle,
    },
    specs,
    wheels: {
      front: {
        cx: frontCx,
        cy: frontCy,
        radius: frontRadius,
        tireRadius: frontRadius - S.TIRE_WIDTH / 2,
        title: "Front Wheel",
      },
      rear: {
        cx: rearCx,
        cy: rearCy,
        radius: rearRadius,
        tireRadius: rearRadius - S.TIRE_WIDTH / 2,
        title: "Rear Wheel",
      },
    },
  };
}

/** Allowed range for the global Crank length setting (mm). */
export const CRANK_LENGTH_MIN = 120;
export const CRANK_LENGTH_MAX = 185;

/** Clamp a global crank-length setting; invalid values fall back to 165. */
export function normalizeCrankLength(value, fallback = DEFAULTS.CRANK_LENGTH) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < CRANK_LENGTH_MIN) return CRANK_LENGTH_MIN;
  if (n > CRANK_LENGTH_MAX) return CRANK_LENGTH_MAX;
  return n;
}

/**
 * Per-bike crank length in mm. An explicit crank_length on the bike (Your Bike…
 * or a saved My bikes entry that recorded one) wins. Catalog bikes and older
 * records that omit the field use the global setting (DEFAULTS.CRANK_LENGTH,
 * originally 165 mm from the Python project).
 */
export function resolveCrankLength(bike, settings = DEFAULTS) {
  const S = { ...DEFAULTS, ...settings };
  const n = Number(bike?.crank_length);
  return Number.isFinite(n) && n > 0 ? n : S.CRANK_LENGTH;
}

/** Short catalog/display name: "Brand Model, Size". */
export function bikeShortName(bike) {
  const model = String(bike?.model ?? "").trim();
  const size = String(bike?.frame_size ?? "").trim();
  return [model, size].filter(Boolean).join(", ");
}

/** Display notes, falling back to legacy `description` for older share links. */
export function bikeNotes(bike) {
  const notes = String(bike?.notes ?? "").trim();
  if (notes) return notes;
  return String(bike?.description ?? "").trim();
}

export function getDescription(computed) {
  return bikeShortName(computed);
}

export function bikeColumnsX(bikeNumber, settings = DEFAULTS) {
  const S = { ...DEFAULTS, ...settings };
  return (S.WINDOW_WIDTH / 3) * bikeNumber - S.COLUMNS_X_TWEAK;
}

/** Difference of two spec tuples: bike N minus bike 1 (b - a). */
export function specDiff(specA, specB) {
  return [pyRound(specB[0] - specA[0], 1), specA[1]];
}

export { SPEC_ORDER };

/** Fore-aft alignment targets used by the "Align bikes at" control. */
export const ALIGN_OPTIONS = Object.freeze([
  { value: "bb", label: "Bottom bracket" },
  { value: "rear", label: "Rear wheel hub" },
  { value: "front", label: "Front wheel hub" },
]);
export const DEFAULT_ALIGN = "bb";
/** Horizontal padding kept around the drawn bikes after alignment. */
export const ALIGN_MARGIN_X = 80;
/** Saddle path extents relative to the saddle anchor (see svg.js SADDLE_PATH). */
const SADDLE_EXTENT_LEFT = 90;
const SADDLE_EXTENT_RIGHT = 116;

export function normalizeAlign(value) {
  if (value === "rear" || value === "front" || value === "bb") return value;
  return DEFAULT_ALIGN;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/** X coordinate of the chosen alignment point on an already-computed bike. */
export function alignmentX(computed, align) {
  const key = normalizeAlign(align);
  if (key === "rear") return computed.wheels.rear.cx;
  if (key === "front") return computed.wheels.front.cx;
  return computed.points[2][0];
}

/**
 * Horizontal extent of a computed bike, including tyres, crank, and saddle.
 * Used only to keep aligned drawings inside the canvas.
 */
export function drawingExtentX(computed) {
  let minX = Infinity;
  let maxX = -Infinity;
  const consider = (x) => {
    if (Number.isFinite(x)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  };
  for (const pt of Object.values(computed.points || {})) {
    if (Array.isArray(pt)) consider(pt[0]);
  }
  const saddle = computed.points?.saddle;
  if (Array.isArray(saddle)) {
    consider(saddle[0] - SADDLE_EXTENT_LEFT);
    consider(saddle[0] + SADDLE_EXTENT_RIGHT);
  }
  for (const w of [computed.wheels?.front, computed.wheels?.rear]) {
    if (!w) continue;
    const r = Number(w.radius) || 0;
    consider(w.cx - r);
    consider(w.cx + r);
  }
  const crank = resolveCrankLength(computed);
  const bb = computed.points?.[2];
  if (Array.isArray(bb)) {
    consider(bb[0] - crank);
    consider(bb[0] + crank);
  }
  return { minX, maxX };
}

/**
 * Compute per-bike xOffsets that put the chosen point at the same x for every
 * bike, then shift / widen so the drawing stays inside the canvas.
 * `computeds` must be bikes already computed at xOffset 0.
 */
export function computeAlignmentOffsets(computeds, align = DEFAULT_ALIGN, settings = {}) {
  const S = { ...DEFAULTS, ...settings };
  const margin = ALIGN_MARGIN_X;
  const key = normalizeAlign(align);
  if (!computeds.length) {
    return { offsets: [], width: S.WINDOW_WIDTH, targetX: null, align: key };
  }
  const xs = computeds.map((c) => alignmentX(c, key));
  const reference = xs[0];
  const rawOffsets = xs.map((x) => round1(reference - x));
  let minX = Infinity;
  let maxX = -Infinity;
  computeds.forEach((c, i) => {
    const ext = drawingExtentX(c);
    minX = Math.min(minX, ext.minX + rawOffsets[i]);
    maxX = Math.max(maxX, ext.maxX + rawOffsets[i]);
  });
  const pad = minX < margin ? round1(margin - minX) : 0;
  const offsets = rawOffsets.map((o) => round1(o + pad));
  const width = Math.max(S.WINDOW_WIDTH, Math.ceil(maxX + pad + margin));
  return { offsets, width, targetX: round1(reference + pad), align: key };
}

/**
 * Compute bikes with alignment offsets applied through the existing xOffset
 * mechanism. Returns widened settings when the drawing would otherwise clip.
 */
export function computeAlignedBikes(bikes, optionsList = [], settings = {}, align = DEFAULT_ALIGN) {
  const S = { ...DEFAULTS, ...settings };
  const key = normalizeAlign(align);
  const prelim = bikes.map((bike, i) => {
    const opts = { ...(optionsList[i] || {}), xOffset: 0, bikeNumber: optionsList[i]?.bikeNumber ?? i + 1 };
    return computeBike(bike, opts, S);
  });
  const plan = computeAlignmentOffsets(prelim, key, S);
  const computed = bikes.map((bike, i) => {
    const opts = {
      ...(optionsList[i] || {}),
      xOffset: plan.offsets[i],
      bikeNumber: optionsList[i]?.bikeNumber ?? i + 1,
    };
    return computeBike(bike, opts, S);
  });
  return { computed, settings: { ...S, WINDOW_WIDTH: plan.width }, plan };
}


/**
 * Validate a bike entry. Returns { ok, errors: { field: message } }.
 */
export function validateBike(bike) {
  const errors = {};
  const reqText = ["model", "frame_size"];
  for (const k of reqText) {
    if (bike[k] == null || String(bike[k]).trim() === "") {
      errors[k] = "This field is required.";
    }
  }

  const positive = {
    top_tube_meas_l: "Top tube length",
    seat_tube_l: "Seat tube length",
    head_tube_l: "Head tube length",
    stand_over_h: "Stand-over height",
    wheel_base: "Wheelbase",
    chainstay_l: "Chainstay length",
    reach: "Reach",
    stack: "Stack",
    fork_offset: "Fork offset",
    wheel_dia_front_in: "Front wheel diameter",
    wheel_dia_rear_in: "Rear wheel diameter",
  };
  for (const [k, label] of Object.entries(positive)) {
    const v = bike[k];
    if (v === "" || v == null || !Number.isFinite(Number(v))) {
      errors[k] = `${label} must be a number.`;
    } else if (Number(v) <= 0) {
      errors[k] = `${label} must be greater than 0.`;
    }
  }

  if (bike.bb_drop === "" || bike.bb_drop == null || !Number.isFinite(Number(bike.bb_drop))) {
    errors.bb_drop = "BB drop must be a number (0 is allowed; use a negative value for BB rise).";
  }

  const angleFields = {
    seat_tube_angle: "Seat tube angle",
    head_angle: "Head angle",
  };
  for (const [k, label] of Object.entries(angleFields)) {
    const v = bike[k];
    if (v === "" || v == null || !Number.isFinite(Number(v))) {
      errors[k] = `${label} must be a number in degrees.`;
    } else if (Number(v) <= 0 || Number(v) >= 90) {
      errors[k] = `${label} must be between 0 and 90 degrees (not inclusive).`;
    }
  }

  const cs = Number(bike.chainstay_l);
  const drop = Number(bike.bb_drop);
  if (Number.isFinite(cs) && Number.isFinite(drop) && cs * cs < drop * drop) {
    errors.chainstay_l = "Chainstay must be at least as long as the BB drop.";
  }

  const wf = Number(bike.wheel_dia_front_in);
  const wr = Number(bike.wheel_dia_rear_in);
  if (Number.isFinite(wf) && (wf < 12 || wf > 36)) {
    errors.wheel_dia_front_in = "Front wheel diameter looks unusual (expected about 12–36 inches).";
  }
  if (Number.isFinite(wr) && (wr < 12 || wr > 36)) {
    errors.wheel_dia_rear_in = "Rear wheel diameter looks unusual (expected about 12–36 inches).";
  }

  if (bike.crank_length !== "" && bike.crank_length != null) {
    const c = Number(bike.crank_length);
    if (!Number.isFinite(c)) {
      errors.crank_length = "Crank length must be a number in millimetres.";
    } else if (c <= 0 || c >= 400) {
      errors.crank_length = "Crank length must be between 0 and 400 mm (not inclusive).";
    }
  }

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Coerce form strings to the numeric types computeBike expects. */
export function coerceBike(raw) {
  const numKeys = [
    "top_tube_meas_l",
    "seat_tube_l",
    "head_tube_l",
    "stand_over_h",
    "bb_drop",
    "wheel_base",
    "chainstay_l",
    "seat_tube_angle",
    "head_angle",
    "reach",
    "stack",
    "fork_offset",
    "wheel_dia_front_in",
    "wheel_dia_rear_in",
  ];
  const out = { ...raw };
  for (const k of numKeys) {
    if (out[k] !== "" && out[k] != null) out[k] = Number(out[k]);
  }
  out.model = String(out.model ?? "").trim();
  out.frame_size = String(out.frame_size ?? "").trim();
  out.description = String(out.description ?? "");
  out.notes = String(out.notes ?? "").trim();
  // Older share links stored the subtitle in `description`.
  if (!out.notes && out.description.trim()) out.notes = out.description.trim();
  // Leave a missing or invalid crank_length unset so computeBike can apply
  // the global CRANK_LENGTH setting. Do not invent 165 here.
  if (out.crank_length === "" || out.crank_length == null || !Number.isFinite(Number(out.crank_length))) {
    delete out.crank_length;
  } else {
    out.crank_length = Number(out.crank_length);
  }
  return out;
}

export const BLEND_MODES = [
  "hard-light",
  "multiply",
  "normal",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-burn",
  "color-dodge",
  "difference",
];
