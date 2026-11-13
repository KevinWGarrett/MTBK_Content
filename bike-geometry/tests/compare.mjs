#!/usr/bin/env node
/**
 * Compare JS geometry to the patched Python reference (py-fixed),
 * check generated SVG well-formedness, and confirm unique IDs.
 *
 * Usage (from the web/ directory or this file's parent):
 *   node tests/compare.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  computeBike,
  validateBike,
  coerceBike,
  DEFAULTS,
  normalizeAlign,
  DEFAULT_ALIGN,
  ALIGN_MARGIN_X,
  alignmentX,
  drawingExtentX,
  computeAlignmentOffsets,
  computeAlignedBikes,
} from "../js/geometry.js";
import { generateSVG } from "../js/svg.js";
import {
  savedBikeName,
  uniqueName,
  extractSavedBike,
  validateSavedBike,
  serializeMyBikes,
  parseMyBikesJson,
  mergeImportedBikes,
  probeStorage,
  loadMyBikes,
  saveMyBikes,
  STORAGE_KEY,
} from "../js/storage.js";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "..");
const pyFixed = resolve(repoRoot, "py-fixed");
const bikesPath = join(webRoot, "bikes/bikes.json");
const tmpDir = join(webRoot, "tests/.tmp");
const python =
  process.env.PYTHON ||
  (existsSync(resolve(repoRoot, "venv/bin/python"))
    ? resolve(repoRoot, "venv/bin/python")
    : "python3");

mkdirSync(tmpDir, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name, detail) {
  if (cond) {
    passed += 1;
    return true;
  }
  failed += 1;
  failures.push(detail ? `${name}: ${detail}` : name);
  console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  return false;
}

function near(a, b, tol = 0.1) {
  if (a == null || b == null) return false;
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return false;
  return Math.abs(Number(a) - Number(b)) <= tol + 1e-9;
}

function runPythonHarness() {
  const outPath = join(tmpDir, "py-fixed-out.json");
  const harness = join(pyFixed, "harness.py");
  if (!existsSync(harness)) {
    ok(false, "python harness present", `missing ${harness}`);
    return null;
  }
  const result = spawnSync(python, [harness, outPath], {
    encoding: "utf8",
    cwd: pyFixed,
  });
  if (result.status !== 0) {
    ok(false, "python harness ran", result.stderr || result.stdout);
    return null;
  }
  ok(true, "python harness ran");
  return JSON.parse(readFileSync(outPath, "utf8"));
}

function parseXml(text, label) {
  const script = `
import sys, xml.etree.ElementTree as ET
try:
    ET.fromstring(sys.stdin.read())
except Exception as e:
    sys.stderr.write(type(e).__name__ + ': ' + str(e))
    sys.exit(1)
`;
  const result = spawnSync(python, ["-c", script], { input: text, encoding: "utf8" });
  return ok(result.status === 0, `${label} is well-formed XML`, result.stderr);
}

function uniqueIds(svg, label) {
  const ids = [...svg.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const seen = new Map();
  const dups = [];
  for (const id of ids) {
    seen.set(id, (seen.get(id) || 0) + 1);
    if (seen.get(id) === 2) dups.push(id);
  }
  return ok(dups.length === 0, `${label} has unique IDs`, dups.join(", "));
}

function compareComputed(js, ref, label) {
  let local = 0;
  for (const i of Object.keys(ref.points)) {
    const jp = js.points[i];
    const rp = ref.points[i];
    if (!ok(near(jp[0], rp[0]), `${label} pt ${i} x`, `js=${jp?.[0]} py=${rp[0]}`)) local += 1;
    if (!ok(near(jp[1], rp[1]), `${label} pt ${i} y`, `js=${jp?.[1]} py=${rp[1]}`)) local += 1;
  }
  for (const k of Object.keys(ref.specs)) {
    if (!ok(near(js.specs[k][0], ref.specs[k][0]), `${label} spec ${k}`, `js=${js.specs[k][0]} py=${ref.specs[k][0]}`))
      local += 1;
  }
  if (!ok(near(js.wheels.front.cx, ref.wheels.front.cx), `${label} front hub x`)) local += 1;
  if (!ok(near(js.wheels.front.cy, ref.wheels.front.cy), `${label} front hub y`)) local += 1;
  if (!ok(near(js.wheels.rear.cx, ref.wheels.rear.cx), `${label} rear hub x`)) local += 1;
  if (!ok(near(js.wheels.rear.cy, ref.wheels.rear.cy), `${label} rear hub y`)) local += 1;
  if (!ok(near(js.tiltDeg, ref.tilt_deg), `${label} tilt deg`)) local += 1;
  return local;
}

console.log("Bike Geometry Comparison — JS vs patched Python\n");

const py = runPythonHarness();
const shippedCatalog = JSON.parse(readFileSync(bikesPath, "utf8"));
// Pole Voima K2/K3 were removed from the shipped catalog but stay as test fixtures
// because the Python reference uses them.
const legacyBikes = JSON.parse(readFileSync(join(webRoot, "tests/fixtures/legacy-bikes.json"), "utf8"));
const catalog = [...legacyBikes, ...shippedCatalog];
ok(!shippedCatalog.some((b) => b.id === "bike_pvk2" || b.id === "bike_pvk3"), "Pole bikes not in shipped catalog");
ok(Array.isArray(catalog) && catalog.length >= 7, "catalog loads", `count=${catalog.length}`);

const ORIGINAL_IDS = [
  "bike_pvk2",
  "bike_pvk3",
  "bike_amxl",
  "bike_ammul",
  "bike_ams",
  "bike_rmip",
  "bike_sb",
];
ok(
  ORIGINAL_IDS.every((id) => catalog.some((b) => b.id === id)),
  "original 7 catalog bikes still present",
);

if (py) {
  // Python reference covers only the original catalog; new MTB entries are checked below.
  for (const id of ORIGINAL_IDS) {
    const bike = catalog.find((b) => b.id === id);
    const ref0 = py.bikes[id];
    ok(!!ref0, `python result for ${id}`);
    if (ref0 && bike) {
      const js = computeBike(bike, { xOffset: 0, bikeNumber: 1, color: "darkgreen" });
      compareComputed(js, ref0, `${id} offset 0`);
    }
    const ref200 = py.offset_cases[id];
    if (ref200 && bike) {
      const js = computeBike(bike, { xOffset: 200, bikeNumber: 1, color: "darkgreen" });
      compareComputed(js, ref200, `${id} offset 200`);
      // x-offset must actually move the bike
      if (ref0) {
        ok(
          near(js.points[1][0] - ref0.points["1"][0], 200),
          `${id} offset 200 shifts rear axle by 200`,
        );
      }
    }
  }

  ok(py.zero_wheelbase_ok, "python wheel_base=0 does not crash");
  const zeroBike = { ...catalog.find((b) => b.id === "bike_pvk2"), wheel_base: 0 };
  const jsZero = computeBike(zeroBike, { xOffset: 0, bikeNumber: 1 });
  ok(Number.isFinite(jsZero.tiltDeg), "js wheel_base=0 does not crash");
  if (py.zero_wheelbase && py.zero_wheelbase.tilt_deg != null) {
    ok(near(jsZero.tiltDeg, py.zero_wheelbase.tilt_deg), "js/python tilt at wheel_base=0");
  }
}

const pvk2 = catalog.find((b) => b.id === "bike_pvk2");
const pvk3 = catalog.find((b) => b.id === "bike_pvk3");
const ammul = catalog.find((b) => b.id === "bike_ammul");

const combos = {
  "0-bikes": [],
  "1-bike": [computeBike(pvk2, { bikeNumber: 1, color: "darkgreen" })],
  "2-bikes": [
    computeBike(pvk2, { bikeNumber: 1, color: "darkgreen" }),
    computeBike(pvk3, { bikeNumber: 2, color: "darkslateblue" }),
  ],
  "3-bikes": [
    computeBike(pvk2, { bikeNumber: 1, color: "darkgreen" }),
    computeBike(pvk3, { bikeNumber: 2, color: "darkslateblue" }),
    computeBike(ammul, { bikeNumber: 3, color: "firebrick" }),
  ],
};

for (const [name, bikes] of Object.entries(combos)) {
  const svg = generateSVG(bikes);
  writeFileSync(join(tmpDir, `${name}.svg`), svg);
  parseXml(svg, name);
  uniqueIds(svg, name);
  ok(svg.includes('<line id="ground"'), `${name} ground is a line`);
  ok(!svg.includes("solid;;"), `${name} has no solid;; typo`);
  if (bikes.length) {
    ok(svg.includes("font-size: 40px"), `${name} fork-offset font-size has px`);
  }
  if (bikes.length >= 2) {
    ok(svg.includes("Diffs (2-1)"), `${name} diffs title is (2-1)`);
  }
  if (bikes.length >= 3) {
    ok(svg.includes("Diffs (3-1)"), `${name} diffs title is (3-1)`);
  }
}

// Every catalog bike: validation, well-formed SVG, unique IDs, and (for new MTBs) sanity bands.
const SANITY = {
  reach: [430, 520],
  stack: [600, 680],
  head_angle: [62, 67],
  seat_tube_angle: [74, 80],
  chainstay_l: [420, 470],
};
// Hard limits used as test failures (wider than the soft bands; soft outliers are warned).
const HARD = {
  reach: [400, 560],
  stack: [560, 720],
  head_angle: [58, 72],
  seat_tube_angle: [70, 82],
  chainstay_l: [400, 490],
};

const sanityFlags = [];
for (const bike of catalog) {
  const v = validateBike(bike);
  ok(v.ok, `${bike.id} validates`, Object.entries(v.errors || {}).map(([k, e]) => `${k}: ${e}`).join("; "));
  const computed = computeBike(bike, { bikeNumber: 1, color: "darkgreen" });
  ok(Number.isFinite(computed.tiltDeg), `${bike.id} computes a finite tilt`);
  const finitePts = Object.values(computed.points).every(
    (pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]),
  );
  ok(finitePts, `${bike.id} computed points are finite`);
  const svg = generateSVG([computed]);
  parseXml(svg, bike.id);
  uniqueIds(svg, bike.id);
  ok(svg.includes("<svg"), `${bike.id} SVG starts with an svg element`);

  if (ORIGINAL_IDS.includes(bike.id)) continue;
  const flags = [];
  for (const [key, [lo, hi]] of Object.entries(SANITY)) {
    const val = Number(bike[key]);
    if (!Number.isFinite(val) || val < lo || val > hi) {
      flags.push(`${key}=${bike[key]} outside ${lo}–${hi}`);
    }
  }
  if (flags.length) {
    sanityFlags.push(`${bike.id}: ${flags.join("; ")}`);
    console.log(`  WARN  ${bike.id} sanity: ${flags.join("; ")}`);
  }
  for (const [key, [lo, hi]] of Object.entries(HARD)) {
    const val = Number(bike[key]);
    ok(
      Number.isFinite(val) && val >= lo && val <= hi,
      `${bike.id} ${key} within hard limits`,
      `${bike[key]} not in ${lo}–${hi}`,
    );
  }
  ok(
    Number.isFinite(Number(bike.fork_offset)) && bike.fork_offset > 0 && bike.fork_offset < 80,
    `${bike.id} fork_offset looks like millimeters`,
    String(bike.fork_offset),
  );
}

ok(
  sanityFlags.length === 0,
  "new bikes sit inside published sanity bands (reach 430-520, stack 600-680, HA 62-67, STA 74-80, CS 420-470)",
  sanityFlags.join(" | "),
);

// Crank length: default is the original Python 165 mm; a custom value
// changes only the crank circle, not frame points.
{
  const base = computeBike(pvk2, { bikeNumber: 1, color: "darkgreen" });
  ok(base.crank_length === 165, "catalog bike defaults to 165 mm crank");
  const baseSvg = generateSVG([base]);
  ok(baseSvg.includes('id="crank_circle_1"') && baseSvg.includes('r="165"'), "default crank circle radius is 165");

  const longBike = { ...pvk2, crank_length: 175 };
  const long = computeBike(longBike, { bikeNumber: 1, color: "darkgreen" });
  ok(long.crank_length === 175, "explicit crank_length is used");
  const ptsMatch = Object.keys(base.points).every((k) => {
    const a = base.points[k];
    const b = long.points[k];
    return near(a[0], b[0]) && near(a[1], b[1]);
  });
  ok(ptsMatch, "changing crank length does not move frame points");
  const longSvg = generateSVG([long]);
  ok(longSvg.includes('r="175"'), "non-default crank circle radius is 175");
  ok(longSvg.includes("Crank Length: 175 mm"), "crank length appears in the details table");

  const coerced = coerceBike({ ...pvk2 });
  delete coerced.crank_length;
  const coerced2 = coerceBike(coerced);
  ok(coerced2.crank_length === DEFAULTS.CRANK_LENGTH, "coerceBike fills the default crank on old share-link data");
  const missing = validateBike({ ...pvk2 });
  ok(missing.ok, "catalog bike without crank_length still validates");
  const badCrank = validateBike({ ...pvk2, crank_length: 0 });
  ok(!badCrank.ok && badCrank.errors.crank_length, "crank_length 0 is rejected");
}

// Saved-bike storage helpers (pure functions; in-memory store for load/save).
{
  ok(savedBikeName({ model: "My Trail", frame_size: "L" }) === "My Trail, L", "savedBikeName uses model and size");
  ok(uniqueName("Foo", []) === "Foo", "uniqueName keeps a free name");
  ok(uniqueName("Foo", ["Foo"]) === "Foo (2)", "uniqueName suffixes a clash");
  ok(uniqueName("Foo", ["Foo", "Foo (2)"]) === "Foo (3)", "uniqueName skips already-used suffixes");

  const sample = extractSavedBike({
    model: "My Trail",
    frame_size: "L",
    notes: "home build",
    top_tube_meas_l: 620,
    seat_tube_l: 450,
    head_tube_l: 120,
    stand_over_h: 780,
    bb_drop: 20,
    wheel_base: 1220,
    wheel_dia_front_in: 29,
    wheel_dia_rear_in: 29,
    chainstay_l: 435,
    seat_tube_angle: 75,
    head_angle: 66,
    reach: 470,
    stack: 630,
    fork_offset: 44,
  });
  ok(sample.crank_length === 165, "extractSavedBike defaults crank length");
  const good = validateSavedBike(sample);
  ok(good.ok, "valid saved bike passes");
  const bad = validateSavedBike({ model: "Nope" });
  ok(!bad.ok, "incomplete saved bike is rejected");
  const notObj = validateSavedBike("nope");
  ok(!notObj.ok, "non-object saved bike is rejected");

  const json = serializeMyBikes([sample]);
  const parsed = parseMyBikesJson(json);
  ok(parsed.ok && parsed.bikes.length === 1, "round-trip serialize/parse keeps one bike");
  ok(parsed.bikes[0].model === "My Trail" && parsed.bikes[0].crank_length === 165, "parsed bike keeps fields");

  const mixed = parseMyBikesJson(
    JSON.stringify({
      version: 1,
      bikes: [sample, { model: "Broken" }, { model: "Also bad", frame_size: "M" }],
    }),
  );
  ok(mixed.ok && mixed.bikes.length === 1, "parse keeps only valid imported bikes");
  ok(mixed.skipped.length === 2, "parse reports skipped invalid entries");

  const garbage = parseMyBikesJson("not json");
  ok(!garbage.ok && garbage.error, "invalid JSON is reported clearly");

  const other = extractSavedBike({ ...sample, name: "Other, M", model: "Other", frame_size: "M", crank_length: 170 });
  const overwritten = mergeImportedBikes([sample], [extractSavedBike({ ...sample, reach: 480 })], "overwrite");
  ok(overwritten.overwritten.length === 1 && overwritten.bikes[0].reach === 480, "import can overwrite a name clash");
  const suffixed = mergeImportedBikes([sample], [extractSavedBike({ ...sample, reach: 490 })], "suffix");
  ok(
    suffixed.renamed.length === 1 &&
      suffixed.bikes.length === 2 &&
      savedBikeName(suffixed.bikes[1]) === "My Trail, L (2)",
    "import can suffix a name clash",
  );
  const added = mergeImportedBikes([sample], [other], "suffix");
  ok(added.added.length === 1 && added.bikes.length === 2, "import adds a new name");

  const mem = {
    data: {},
    setItem(k, v) { this.data[k] = String(v); },
    getItem(k) { return this.data[k] ?? null; },
    removeItem(k) { delete this.data[k]; },
  };
  const wrote = saveMyBikes([sample], mem);
  ok(wrote.ok && mem.data[STORAGE_KEY], "saveMyBikes writes to an in-memory store");
  const loaded = loadMyBikes(mem);
  ok(loaded.ok && loaded.bikes.length === 1 && loaded.bikes[0].model === "My Trail", "loadMyBikes reads the store");

  const blocked = {
    setItem() { throw new Error("blocked"); },
    getItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  const probed = probeStorage(blocked);
  ok(!probed.ok && probed.message, "blocked storage is reported without throwing");
  const blockedLoad = loadMyBikes(blocked);
  ok(blockedLoad.unavailable && blockedLoad.bikes.length === 0, "loadMyBikes survives a blocked store");
  const blockedSave = saveMyBikes([sample], blocked);
  ok(!blockedSave.ok, "saveMyBikes survives a blocked store");
}


/* ---------------- Alignment ---------------- */
{
  ok(normalizeAlign(undefined) === DEFAULT_ALIGN && DEFAULT_ALIGN === "bb", "default align is bottom bracket");
  ok(normalizeAlign("rear") === "rear" && normalizeAlign("front") === "front", "known align values are kept");
  ok(normalizeAlign("sideways") === "bb" && normalizeAlign("") === "bb", "unknown align values fall back to bb");

  const short = catalog.find((b) => b.id === "bike_ams");
  const mid = catalog.find((b) => b.id === "bike_sp_levo4");
  const long = catalog.find((b) => b.id === "bike_pvk3");
  ok(short && mid && long, "short, mid, and long wheelbase catalog bikes exist");
  ok(short.wheel_base < mid.wheel_base && mid.wheel_base < long.wheel_base, "chosen bikes have distinct wheelbases");

  const colors = DEFAULTS.COLORS;
  const opts = colors.map((color, i) => ({ color, bikeNumber: i + 1 }));

  for (const align of ["bb", "rear", "front"]) {
    const { computed, settings, plan } = computeAlignedBikes(
      [short, mid, long],
      opts,
      DEFAULTS,
      align,
    );
    ok(computed.length === 3, `${align} alignment returns three bikes`);
    const xs = computed.map((c) => alignmentX(c, align));
    ok(
      xs.every((x) => near(x, xs[0], 0.15)),
      `${align} alignment puts the chosen point at the same x`,
      `xs=${xs.map((n) => n.toFixed(1)).join(",")}`,
    );
    // Vertical placement is unchanged: same ground line, rear/front hub y depends only on wheel size.
    ok(
      computed.every((c) => near(c.wheels.rear.cy + c.wheels.rear.radius, DEFAULTS.GROUND_LEVEL, 0.15)),
      `${align} alignment keeps rear tyres on the ground line`,
    );
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of computed) {
      const ext = drawingExtentX(c);
      minX = Math.min(minX, ext.minX);
      maxX = Math.max(maxX, ext.maxX);
    }
    ok(minX >= ALIGN_MARGIN_X - 0.2, `${align} drawing is not clipped on the left`, `minX=${minX}, width=${settings.WINDOW_WIDTH}`);
    ok(maxX <= settings.WINDOW_WIDTH - ALIGN_MARGIN_X + 0.2, `${align} drawing is not clipped on the right`, `maxX=${maxX}, width=${settings.WINDOW_WIDTH}`);
    const svg = generateSVG(computed, settings);
    ok(!svg.includes("NaN") && svg.includes("<svg"), `${align} SVG is well-formed`);
    // Also confirm the internal offsets were applied (at least one non-zero except rear, which starts coincident).
    if (align !== "rear") {
      ok(plan.offsets.some((o) => Math.abs(o) > 1), `${align} applies a non-zero xOffset through the existing mechanism`);
    } else {
      ok(plan.offsets.every((o) => near(o, plan.offsets[0], 0.15)), "rear-hub alignment starts from a shared rear-axle origin");
    }
  }

  // Front-hub align on a narrow canvas must widen rather than clip a long/short pair.
  const narrow = computeAlignedBikes(
    [short, long],
    opts.slice(0, 2),
    { ...DEFAULTS, WINDOW_WIDTH: 800 },
    "front",
  );
  ok(narrow.settings.WINDOW_WIDTH > 800, "front-hub alignment widens a narrow canvas");
  const nMin = Math.min(...narrow.computed.map((c) => drawingExtentX(c).minX));
  const nMax = Math.max(...narrow.computed.map((c) => drawingExtentX(c).maxX));
  ok(nMin >= ALIGN_MARGIN_X - 0.2, "narrow+front: left edge stays inside the canvas", `minX=${nMin}`);
  ok(nMax <= narrow.settings.WINDOW_WIDTH - ALIGN_MARGIN_X + 0.2, "narrow+front: right edge stays inside the canvas", `maxX=${nMax} width=${narrow.settings.WINDOW_WIDTH}`);

  // Rear-hub alignment of two catalog bikes should leave offsets at 0 (same origin).
  const rearOnly = computeAlignedBikes([short, long], opts.slice(0, 2), DEFAULTS, "rear");
  ok(rearOnly.plan.offsets.every((o) => near(o, 0, 0.15)), "rear alignment of unshifted bikes needs no extra offset");

  // Empty input is safe.
  const empty = computeAlignmentOffsets([], "bb", DEFAULTS);
  ok(empty.offsets.length === 0 && empty.width === DEFAULTS.WINDOW_WIDTH, "empty alignment plan is a no-op");

  // Geometry numbers themselves are unchanged: BB height / wheelbase match a zero-offset compute.
  const unshifted = computeBike(long, { xOffset: 0, bikeNumber: 1 });
  const aligned = computeAlignedBikes([long], [{ bikeNumber: 1 }], DEFAULTS, "front");
  ok(near(aligned.computed[0].specs.wheelbase[0], unshifted.specs.wheelbase[0]), "alignment does not change wheelbase");
  ok(near(aligned.computed[0].specs.bb_height[0], unshifted.specs.bb_height[0]), "alignment does not change BB height");
  ok(near(aligned.computed[0].specs.reach[0], unshifted.specs.reach[0]), "alignment does not change reach");
}

// Default K2 vs K3 sample used later by the build
const sample = generateSVG(combos["2-bikes"]);
writeFileSync(join(tmpDir, "k2-vs-k3.svg"), sample);

console.log("");
console.log(`${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(" -", f);
  process.exit(1);
}
