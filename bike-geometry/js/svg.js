/**
 * SVG generation for Bike Geometry Comparison.
 * Port of svg_lib.py, svg_templates.py, labels_specs.py, and the run script wrapper.
 *
 * Titles stack vertically (one bike under the next) and wrap to the canvas width.
 * Spec / Diffs column headers wrap inside their column so long names do not collide.
 * The canvas grows and the drawing shifts down so neither titles nor the bottom
 * tables are clipped or drawn over the bikes.
 */
import {
  DEFAULTS,
  getDescription,
  bikeShortName,
  bikeNotes,
  bikeColumnsX,
  specDiff,
  SPEC_ORDER,
} from "./geometry.js";

const SADDLE_PATH = "M -23.963 -272.104 C -36.84 -272.286 -41.084 -274.958 -53.606 -283.014 C -66.124 -291.069 -63.061 -289.744 -71.33 -295.606 C -79.6 -301.466 -89.811 -316.713 -85.702 -324.952 C -81.595 -333.197 -68.205 -337.06 -48.573 -324.264 C -28.942 -311.467 16.574 -307.553 27.097 -307.553 C 37.622 -307.553 74.117 -304.935 87.244 -305.253 C 100.37 -305.572 114.866 -298.244 112.244 -290.24 C 109.62 -282.236 100.548 -282.905 88.888 -282.905 C 77.226 -282.905 54.219 -283.163 31.183 -282.088 C 8.148 -281.015 -1.528 -271.785 -23.963 -272.104 Z";

/** Saddle path extends this far above the saddle anchor point. */
const SADDLE_PATH_TOP = 340;

/**
 * Approximate glyph width in ems for Noto Sans. Used only to decide wrap
 * points — slightly conservative so text is more likely to stay inside its column.
 */
function charEm(ch) {
  if (ch === " ") return 0.28;
  if ("ilI.,:;!'`|".includes(ch)) return 0.30;
  if ("jtJfr-()[]{}".includes(ch)) return 0.40;
  if ("mwMW@".includes(ch)) return 0.88;
  if (ch >= "A" && ch <= "Z") return 0.68;
  if (ch >= "0" && ch <= "9") return 0.62;
  return 0.56;
}

function estimateWidth(text, fontSize) {
  let w = 0;
  for (const ch of String(text ?? "")) w += charEm(ch);
  return w * fontSize;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function lineEl(ptA, ptB, name, color, width, lineStyle) {
  return `<line id="${esc(name)}" style="stroke: ${esc(color)}; ${esc(lineStyle)}; stroke-width: ${esc(width)}px;" x1="${ptA[0]}" y1="${ptA[1]}" x2="${ptB[0]}" y2="${ptB[1]}" />`;
}

function circleEl(point, radius, width, lineStyle, color, fill, name) {
  return `<circle id="${esc(name)}" style="stroke: ${esc(color)}; stroke-width: ${esc(width)}; fill: ${esc(fill)}; ${esc(lineStyle)};" cx="${point[0]}" cy="${point[1]}" r="${radius}" />`;
}

function polygonEl(name, style, width, color, fill, points) {
  const pointsString = points.map((p) => `${p[0]},${p[1]}`).join(" ") + " ";
  return `<polygon id="${esc(name)}" points="${pointsString}" style="stroke: ${esc(color)}; stroke-width: ${esc(width)}px; ${esc(style)}; fill:${esc(fill)}" />`;
}

function unitFor(label) {
  return String(label).toLowerCase().includes("angle") ? "°" : " mm";
}

function formatSpecValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return String(value);
}

/**
 * Split text into lines that fit `maxWidth` at `fontSize`, using a fixed
 * average character width. Prefers wrapping on whitespace; hard-breaks a
 * single token that is itself wider than the column.
 */
export function wrapText(text, fontSize, maxWidth) {
  const raw = String(text ?? "");
  if (!raw.trim()) return [""];
  const limit = Math.max(fontSize, maxWidth);

  const words = raw.split(/\s+/).filter((w) => w.length);
  const lines = [];
  let current = "";

  const flush = () => {
    if (current) {
      lines.push(current);
      current = "";
    }
  };

  const hardBreak = (token) => {
    let chunk = "";
    for (const ch of token) {
      const trial = chunk + ch;
      if (chunk && estimateWidth(trial, fontSize) > limit) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = trial;
      }
    }
    current = chunk;
  };

  for (const word of words) {
    if (estimateWidth(word, fontSize) > limit) {
      flush();
      hardBreak(word);
      continue;
    }
    const trial = current ? `${current} ${word}` : word;
    if (current && estimateWidth(trial, fontSize) > limit) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  flush();
  return lines.length ? lines : [""];
}

function tspanLines(lines, { x = 0, startY = null, dyEm = 1.2 } = {}) {
  return lines
    .map((line, i) => {
      if (i === 0 && startY != null) {
        return `<tspan x="${x}" y="${startY}">${esc(line)}</tspan>`;
      }
      if (i === 0) {
        return `<tspan x="${x}">${esc(line)}</tspan>`;
      }
      return `<tspan x="${x}" dy="${dyEm}em">${esc(line)}</tspan>`;
    })
    .join("\n            ");
}

function headingTitle(computed) {
  return bikeShortName(computed);
}

function minDrawingY(computedBikes, settings) {
  let minY = Infinity;
  for (const bike of computedBikes) {
    for (const pt of Object.values(bike.points || {})) {
      if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[1])) {
        minY = Math.min(minY, pt[1]);
      }
    }
    if (bike.points?.saddle) {
      minY = Math.min(minY, bike.points.saddle[1] - SADDLE_PATH_TOP);
    }
    for (const wheel of [bike.wheels?.front, bike.wheels?.rear]) {
      if (!wheel) continue;
      const r = (wheel.tireRadius ?? wheel.radius ?? 0) + (settings.TIRE_WIDTH ?? 0) / 2;
      if (Number.isFinite(wheel.cy)) minY = Math.min(minY, wheel.cy - r);
    }
  }
  return Number.isFinite(minY) ? minY : settings.LABELS_OFFSET_Y;
}

function layoutTitles(computedBikes, settings) {
  const margin = 40;
  const maxWidth = settings.WINDOW_WIDTH - margin * 2;
  const titleLh = 1.2;
  const forkLh = 1.3;
  const gapAfterBlock = settings.LABEL_FONT_SIZE * 0.45;
  let y = settings.LABEL_FONT_SIZE + 16;
  let lastBottom = y;
  const parts = [];

  if (!computedBikes.length) {
    return { markup: "", bottom: 0 };
  }

  const notesSize = settings.NOTES_FONT_SIZE ?? 48;
  const notesLh = 1.2;

  for (const bike of computedBikes) {
    const title = bikeShortName(bike);
    const notes = bikeNotes(bike);
    const titleLines = wrapText(title, settings.LABEL_FONT_SIZE, maxWidth);
    const notesLines = notes ? wrapText(notes, notesSize, maxWidth) : [];
    const forkLine = `Fork Offset: ${bike.fork_offset} mm`;

    const blockStart = y;
    const nameBottom = blockStart + (titleLines.length - 1) * settings.LABEL_FONT_SIZE * titleLh;
    let afterName = nameBottom;
    let notesMarkup = "";
    if (notesLines.length) {
      const notesStart = nameBottom + notesSize * notesLh + 6;
      const notesBottom = notesStart + (notesLines.length - 1) * notesSize * notesLh;
      afterName = notesBottom;
      notesMarkup = `
            <text style="white-space: pre; fill: ${esc(bike.color)}; font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${notesSize}px;">
            ${tspanLines(notesLines, { x: margin, startY: notesStart, dyEm: notesLh })}
            </text>`;
    }
    const forkBaseline = afterName + settings.SPECS_FONT_SIZE * forkLh + 8;
    parts.push(`
        <!-- bike_labels bike ${bike.bikeNumber} -->
        <g>
            <text style="white-space: pre; fill: ${esc(bike.color)}; font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.LABEL_FONT_SIZE}px;">
            ${tspanLines(titleLines, { x: margin, startY: blockStart, dyEm: titleLh })}
            </text>${notesMarkup}
            <text style="white-space: pre; fill: ${esc(bike.color)}; font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.SPECS_FONT_SIZE}px;">
            <tspan x="${margin}" y="${forkBaseline}">${esc(forkLine)}</tspan>
            </text>
        </g>
            `);

    // Leave room below the fork-offset descent and above the next title's ascent
    // so the small "Fork Offset" line cannot sit inside the following name.
    const blockBottom = forkBaseline + settings.SPECS_FONT_SIZE * 0.4;
    y = blockBottom + Math.max(gapAfterBlock, 24) + settings.LABEL_FONT_SIZE * 0.95;
    lastBottom = blockBottom;
  }

  return { markup: parts.join(""), bottom: lastBottom + 16 };
}

function displayBikeData(spec, settings, first, startY) {
  const label = spec[1];
  const value = spec[0];
  const text = `${label}: ${formatSpecValue(value)}${unitFor(label)}`;
  if (first) {
    return `              <tspan x="0" y="${startY}">${esc(text)}</tspan>\n`;
  }
  return `              <tspan x="0" dy="${settings.LINE_HEIGHT}em">${esc(text)}</tspan>\n`;
}

function displayDataDiffs(specA, specB, settings, first, startY) {
  const diff = specDiff(specA, specB);
  const text = `${formatSpecValue(diff[0])}${unitFor(specA[1])}`;
  if (first) {
    return `  <tspan x="0" y="${startY}">${esc(text)}</tspan>`;
  }
  return `  <tspan x="0" dy="${settings.LINE_HEIGHT}em">${esc(text)}</tspan>`;
}

function columnPlan(bikes, settings) {
  const xOf = (n) => bikeColumnsX(n, settings);
  const blocks = [];
  if (!bikes.length) return blocks;
  blocks.push({ type: "spec", bike: bikes[0], x: xOf(1) });
  if (bikes.length >= 2) {
    blocks.push({
      type: "diff",
      title: `Diffs (${bikes[1].bikeNumber}-${bikes[0].bikeNumber})`,
      bikeA: bikes[0],
      bikeB: bikes[1],
      x: xOf(2) - settings.DIFFS_OFFSET_X,
    });
    blocks.push({ type: "spec", bike: bikes[1], x: xOf(2) });
  }
  if (bikes.length >= 3) {
    blocks.push({
      type: "diff",
      title: `Diffs (${bikes[2].bikeNumber}-${bikes[0].bikeNumber})`,
      bikeA: bikes[0],
      bikeB: bikes[2],
      x: xOf(3) - settings.DIFFS_OFFSET_X,
    });
    blocks.push({ type: "spec", bike: bikes[2], x: xOf(3) });
  }
  const rightEdge = settings.WINDOW_WIDTH - 20;
  for (let i = 0; i < blocks.length; i += 1) {
    const nextX = i + 1 < blocks.length ? blocks[i + 1].x : rightEdge;
    blocks[i].width = Math.max(48, nextX - blocks[i].x - 20);
    blocks[i].titleText = blocks[i].type === "spec" ? headingTitle(blocks[i].bike) : blocks[i].title;
    blocks[i].lines = wrapText(blocks[i].titleText, settings.SPECS_HEADING_FONT_SIZE, blocks[i].width);
    const notes = blocks[i].type === "spec" ? bikeNotes(blocks[i].bike) : "";
    const notesSize = settings.SPECS_NOTES_FONT_SIZE ?? 34;
    blocks[i].notesLines = notes ? wrapText(notes, notesSize, blocks[i].width) : [];
  }
  return blocks;
}

function layoutSpecs(bikes, settings, blockY) {
  if (!bikes.length) return { markup: "", bottom: blockY };
  const blocks = columnPlan(bikes, settings);
  const headingLh = 1.2;
  const notesLh = 1.2;
  const notesSize = settings.SPECS_NOTES_FONT_SIZE ?? 34;
  const maxHeaderLines = Math.max(1, ...blocks.map((b) => b.lines.length));
  const maxNotesLines = Math.max(0, ...blocks.map((b) => (b.notesLines || []).length));
  const headingSize = settings.SPECS_HEADING_FONT_SIZE;
  // First heading baseline is y=0; last heading baseline is (n-1) lines down.
  const headingLastY = (maxHeaderLines - 1) * headingSize * headingLh;
  const notesStartY = maxNotesLines
    ? headingLastY + headingSize * 0.4 + 10 + notesSize * 0.85
    : headingLastY;
  const notesLastY = maxNotesLines
    ? notesStartY + (maxNotesLines - 1) * notesSize * notesLh
    : headingLastY;
  const afterHeader = (maxNotesLines ? notesLastY + notesSize * 0.4 : headingLastY + headingSize * 0.35);
  // Leave room for the 40px data-row ascent so "Caster" cannot sit inside the notes.
  const dataStartY = afterHeader + 12 + settings.SPECS_FONT_SIZE * 0.9;
  const extraSpecs = (bike) => [[bike.crank_length, "Crank Length"]];
  const rowCount = SPEC_ORDER.length + 1;
  const dataBottom =
    dataStartY + (rowCount - 1) * settings.SPECS_FONT_SIZE * settings.LINE_HEIGHT + settings.SPECS_FONT_SIZE * 0.35;

  const parts = [];
  for (const block of blocks) {
    const notesMarkup = (block.notesLines || []).length
      ? `
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${notesSize}px;">
            ${tspanLines(block.notesLines, { x: 0, startY: notesStartY, dyEm: notesLh })}
        </text>`
      : "";
    if (block.type === "spec") {
      const specRows = [
        ...SPEC_ORDER.map(([, key]) => block.bike.specs[key]),
        ...extraSpecs(block.bike),
      ];
      const list = specRows.map((spec, i) => displayBikeData(spec, settings, i === 0, dataStartY)).join("");
      parts.push(`
<!-- spec_block -->
    <g transform="translate(${block.x},${blockY})">
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.SPECS_HEADING_FONT_SIZE}px;">
            ${tspanLines(block.lines, { x: 0, startY: 0, dyEm: headingLh })}
        </text>${notesMarkup}
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size:${settings.SPECS_FONT_SIZE}px;">
${list}        </text>
    </g>
    `);
    } else {
      const rows = [
        ...SPEC_ORDER.map(([, key]) => [block.bikeA.specs[key], block.bikeB.specs[key]]),
        ...extraSpecs(block.bikeA).map((specA, i) => [specA, extraSpecs(block.bikeB)[i]]),
      ].map((pair, i) => displayDataDiffs(pair[0], pair[1], settings, i === 0, dataStartY));
      parts.push(`
<!-- diff_block -->
    <g transform="translate(${block.x},${blockY})">
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.SPECS_HEADING_FONT_SIZE}px;">
            ${tspanLines(block.lines, { x: 0, startY: 0, dyEm: headingLh })}
        </text>
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.SPECS_FONT_SIZE}px;">
            ${rows.join("\n            ")}
        </text>
    </g>
    `);
    }
  }

  return { markup: parts.join(""), bottom: blockY + dataBottom };
}

function madeBy(settings, height) {
  const x = settings.WINDOW_WIDTH - settings.MADEBY_X_TWEAK;
  const y = height - settings.MADEBY_Y_TWEAK;
  return `<!-- madeby -->
    <g transform="translate(${x},${y})">
        <text style="font-family: ${esc(settings.FONT_FAMILY)}; font-size: ${settings.MADEBY_FONT_SIZE}px;" transform="matrix(1, 0, 0, 1, 0, 0)">
        Bike Geometry Comparison by Kevin Garrett
        </text>
    </g>
        `;
}

function frameOutput(computed, settings) {
  const p = computed.points;
  const color = computed.color;
  const id = `_${computed.bikeNumber}`;
  const dash = settings.DASH_STROKE;

  const chainstay = lineEl(p[2], p[1], "chainstay" + id, color, 25, "solid");
  const downtube = lineEl(p[2], p[4], "downtube" + id, color, 40, "solid");
  const toptube = lineEl(p[8], p[5], "toptube" + id, color, 40, "solid");
  const headtube = lineEl(p[6], p[3], "headtube" + id, color, 50, "solid");
  const seattube = lineEl(p[8], p[9], "seattube" + id, color, 35, "solid");
  const bb = circleEl(p[2], 22, 15, "solid", color, "white", "bottom_bracket" + id);
  const crankLen = computed.crank_length ?? settings.CRANK_LENGTH;
  const crank = circleEl(p[2], crankLen, 3, dash, "black", "none", "crank_circle" + id);

  const frontTri = polygonEl("front_triangle" + id, dash, 3, "black", "none", [p[2], p[7], p[6], p[4]]);
  const rearTri = polygonEl("rear_triangle" + id, dash, 3, "black", "none", [p[2], p[1], p[7]]);
  const steering = lineEl(p[6], p[12], "steeringaxis" + id, "black", 3, dash);
  const offset = lineEl(p[11], p[10], "offsetaxis" + id, "black", 3, dash);
  const contact = lineEl(p[10], p[13], "contactpatch" + id, "black", 3, dash);

  const saddle = `<!-- saddle_shape -->
        <g transform="translate(${p.saddle[0]}, ${p.saddle[1]})"> 
            <title>Saddle</title>
            <path id="saddle${id}" style="stroke: black; fill: ${esc(color)};stroke-width: 3px;" d="${SADDLE_PATH}"></path>
        </g>
`;

  return `
        <!-- frame_output -->
        <g>
            <title>Frame</title>
            ${chainstay}
            ${downtube}
            ${toptube}
            ${headtube}
            ${seattube}
            ${bb}
            ${crank}
        </g>
        ${saddle}
        <!-- triangles_output -->
        <g id="triangles${id}">
            ${frontTri}
            ${rearTri}
        </g>
        
        <!-- steering_proj_output -->
        <g>
            <title>Steering Projections</title>
            ${steering}
            ${offset}
            ${contact}
        </g>
            `;
}

function wheelOutput(computed, settings) {
  const idn = computed.bikeNumber;
  const fw = computed.wheels.front;
  const rw = computed.wheels.rear;
  const color = computed.color;
  const tireW = settings.TIRE_WIDTH;
  const frontTire = circleEl([fw.cx, fw.cy], fw.tireRadius, tireW, "solid", color, "none", `front_wheel_${idn}`);
  const frontHub = circleEl([fw.cx, fw.cy], 12, 6, "solid", color, "white", `front_wheel_${idn}_hub`);
  const rearTire = circleEl([rw.cx, rw.cy], rw.tireRadius, tireW, "solid", color, "none", `rear_wheel_${idn}`);
  const rearHub = circleEl([rw.cx, rw.cy], 12, 6, "solid", color, "white", `rear_wheel_${idn}_hub`);
  return `
        <!-- mywheel -->
        <g><title>Front Wheel</title>
            ${frontTire}
            ${frontHub}
        </g>
        
        <!-- mywheel -->
        <g><title>Rear Wheel</title>
            ${rearTire}
            ${rearHub}
        </g>
        `;
}

function writeBike(computed, settings) {
  const header = `
<!-- ${esc(getDescription(computed))} -->
`;
  const blend = `
    <g id='blend-mode_${computed.bikeNumber}' style='mix-blend-mode: ${esc(settings.BLEND_MODE)}; opacity: 1;' >
`;
  const close = `
    </g> <!-- blend_mode_close -->
    `;
  return header + blend + frameOutput(computed, settings) + wheelOutput(computed, settings) + close;
}

/**
 * Build a complete SVG document from an array of computeBike() results (1–3 bikes).
 */
export function generateSVG(computedBikes, settings = {}) {
  const S = { ...DEFAULTS, ...settings };
  const titles = layoutTitles(computedBikes, S);
  const drawingTop = minDrawingY(computedBikes, S);
  const gapBelowTitles = 40;
  const extraTop = computedBikes.length
    ? Math.max(0, Math.ceil(titles.bottom + gapBelowTitles - drawingTop))
    : Math.max(0, Math.ceil(titles.bottom));

  const blockY = S.BLOCK_OFFSET_Y + extraTop;
  const specs = layoutSpecs(computedBikes, S, blockY);
  const madebyReserve = S.MADEBY_FONT_SIZE + S.MADEBY_Y_TWEAK + 16;
  const contentBottom = Math.max(S.GROUND_LEVEL + extraTop + 20, specs.bottom);
  const height = Math.max(S.WINDOW_HEIGHT, Math.ceil(contentBottom + madebyReserve));
  const groundY = S.GROUND_LEVEL + extraTop;

  const head = `
<!-- head -->
<svg style="zoom: ${S.ZOOM_SCALE};"
    width="${S.WINDOW_WIDTH}"
    height="${height}"
    viewBox="0 0 ${S.WINDOW_WIDTH} ${height}"
    id="svg_document"
    baseProfile="full" version="1.1"
    preserveAspectRatio="xMidYMid meet" 
    xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" >
    `;
  const setUp = `
<!-- set_up -->
<title id="svg_document_title">Bike Geometry Comparison</title>
<defs id="svg_document_defs">
    <pattern id="tenthGrid" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="red" stroke-width="1"/>
    </pattern>
    <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
        <rect width="100" height="100" fill="url(#tenthGrid)"/>
        <path d="M 100 0 L 0 0 0 100" fill="none" stroke="red" stroke-width="1"/>
    </pattern>
</defs>

<rect width="100%" height="100%" fill="url(#grid)"/>

<line id="ground" x1="0" y1="${groundY}" x2="${S.WINDOW_WIDTH}" y2="${groundY}" stroke="black" stroke-width="5px" />
`;
  const titleSvg = titles.markup
    ? `
<!-- stacked_titles -->
${titles.markup}
`
    : "";
  const shiftOpen = extraTop ? `\n    <g id="drawing-shift" transform="translate(0, ${extraTop})">\n` : "";
  const shiftClose = extraTop ? `\n    </g> <!-- drawing-shift -->\n` : "";
  const bikesSvg = computedBikes.map((b) => writeBike(b, S)).join("");
  const close = `
</svg>
`;
  return head + setUp + titleSvg + shiftOpen + bikesSvg + shiftClose + specs.markup + madeBy(S, height) + close;
}

export function suggestedFilename(computedBikes) {
  if (!computedBikes.length) return "bike-geometry.svg";
  const slug = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const parts = computedBikes.map((b) => slug(`${b.model}-${b.frame_size}`));
  return `${parts.join("-vs-") || "bike-geometry"}.svg`;
}
