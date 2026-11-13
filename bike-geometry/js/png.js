/**
 * Client-side SVG-to-PNG helpers.
 * Size and filename helpers are pure (safe to unit-test in Node). Rasterizing
 * uses an Image + canvas and must run in a browser.
 */

import { suggestedFilename } from "./svg.js";

/** Default export scale, applied to the SVG's width/height (ignoring zoom). */
export const PNG_DEFAULT_SCALE = 2;
/** Cap on canvas pixels (width * height) so very large drawings still export. */
export const PNG_MAX_PIXELS = 32_000_000;
/** Cap on either canvas side; many browsers reject canvases above ~8k. */
export const PNG_MAX_SIDE = 8192;
const MIN_SCALE = 0.25;

const SVG_NS_ATTR = 'xmlns="http://www.w3.org/2000/svg"';

/**
 * Read the root SVG width and height attributes (pixel values, units ignored).
 * Returns null if they are missing or not positive numbers.
 */
export function parseSvgSize(svgText) {
  const text = String(svgText ?? "");
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const tag = open[0];
  const width = readLengthAttr(tag, "width");
  const height = readLengthAttr(tag, "height");
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function readLengthAttr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([0-9.]+)\\s*(?:px)?["']`, "i");
  const m = tag.match(re);
  if (!m) return NaN;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Choose a raster scale: 2x when it fits under the pixel and side caps,
 * otherwise the largest scale that does. Huge canvases may go below 1x.
 */
export function pngScaleForSize(width, height, options = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  const requested = Number(options.scale);
  const want = Number.isFinite(requested) && requested > 0 ? requested : PNG_DEFAULT_SCALE;
  const maxPixels = Number(options.maxPixels);
  const pixelsCap = Number.isFinite(maxPixels) && maxPixels > 0 ? maxPixels : PNG_MAX_PIXELS;
  const maxSide = Number(options.maxSide);
  const sideCap = Number.isFinite(maxSide) && maxSide > 0 ? maxSide : PNG_MAX_SIDE;
  const caps = [want, sideCap / w, sideCap / h, Math.sqrt(pixelsCap / (w * h))];
  const scale = Math.min(...caps.filter((n) => Number.isFinite(n) && n > 0));
  return Math.max(scale, MIN_SCALE);
}

/**
 * Strip the download-only zoom style so rasterization uses the SVG's
 * width and height attributes. Leaves markup otherwise unchanged.
 */
export function prepareSvgForRaster(svgText) {
  let text = String(svgText ?? "");
  text = text.replace(
    /(<svg\b[^>]*?)\sstyle="([^"]*)"/i,
    (full, pre, style) => {
      const cleaned = style
        .replace(/zoom\s*:\s*[^;"]*;?/gi, "")
        .replace(/^\s*;\s*|\s*;\s*$/g, "")
        .trim();
      // Drop the attribute entirely when zoom was the only declaration.
      if (!cleaned) return pre;
      return `${pre} style="${cleaned}"`;
    },
  );
  // Ensure the SVG namespace is present (some Image decoders require it).
  if (/<svg\b/i.test(text) && !/<svg\b[^>]*xmlns=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg ${SVG_NS_ATTR}`);
  }
  return text;
}

/** Same name as the SVG download, with a .png suffix. */
export function pngFilenameFromSvg(svgName) {
  const raw = String(svgName ?? "").trim();
  if (!raw) return "bike-geometry.png";
  if (/\.png$/i.test(raw)) return raw;
  if (/\.svg$/i.test(raw)) return raw.replace(/\.svg$/i, ".png");
  return `${raw}.png`;
}

export function suggestedPngFilename(computedBikes) {
  return pngFilenameFromSvg(suggestedFilename(computedBikes));
}

/** Data URL with reserved characters encoded so fragments like url(#grid) survive. */
export function svgToDataUrl(svgText) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(String(svgText ?? ""));
}

const FRIENDLY_FAIL =
  "Couldn't create the PNG. Try a smaller canvas in Drawing settings.";

/**
 * Draw an SVG document to a PNG blob at the chosen scale.
 * Tries a blob: URL first, then a data URL. If a 2x canvas fails, retries at 1x.
 *
 * @returns {Promise<{ blob: Blob, width: number, height: number, scale: number }>}
 */
export async function rasterizeSvgToPng(svgText, options = {}) {
  const prepared = prepareSvgForRaster(svgText);
  const size = parseSvgSize(prepared);
  if (!size) {
    throw new Error(FRIENDLY_FAIL);
  }
  const scale = pngScaleForSize(size.width, size.height, options);
  try {
    return await drawSvgToPng(prepared, size, scale);
  } catch (first) {
    if (scale > 1.01) {
      try {
        return await drawSvgToPng(prepared, size, 1);
      } catch {
        // keep the original error
      }
    }
    if (first && first.message === FRIENDLY_FAIL) throw first;
    const err = new Error(FRIENDLY_FAIL);
    err.cause = first;
    throw err;
  }
}

async function drawSvgToPng(svgText, size, scale) {
  const canvasWidth = Math.max(1, Math.round(size.width * scale));
  const canvasHeight = Math.max(1, Math.round(size.height * scale));
  let lastErr;
  for (const src of [blobUrlForSvg(svgText), svgToDataUrl(svgText)]) {
    try {
      const blob = await renderSourceToBlob(src.url, canvasWidth, canvasHeight);
      src.revoke();
      return { blob, width: canvasWidth, height: canvasHeight, scale };
    } catch (err) {
      src.revoke();
      lastErr = err;
    }
  }
  throw lastErr || new Error(FRIENDLY_FAIL);
}

function blobUrlForSvg(svgText) {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return { url: svgToDataUrl(svgText), revoke() {} };
  }
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return {
    url,
    revoke() {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    },
  };
}

function renderSourceToBlob(url, canvasWidth, canvasHeight) {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined" || typeof document === "undefined") {
      reject(new Error(FRIENDLY_FAIL));
      return;
    }
    const img = new Image();
    const fail = () => reject(new Error(FRIENDLY_FAIL));
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail();
          return;
        }
        // White fill underneath in case the SVG decoder omits the background rect.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
        if (typeof canvas.toBlob !== "function") {
          fail();
          return;
        }
        canvas.toBlob((blob) => {
          if (!blob) fail();
          else resolve(blob);
        }, "image/png");
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = fail;
    img.src = url;
  });
}

export const PNG_FRIENDLY_FAIL = FRIENDLY_FAIL;
