import type {Box} from './types';

type VerticalBounds = [top: number, bottom: number];
const cache = new WeakMap<HTMLCanvasElement, Map<string, VerticalBounds | undefined>>();

export function clearTextInk(canvas: HTMLCanvasElement) {
  cache.delete(canvas);
}

export function textInkBounds(canvas: HTMLCanvasElement, box: Box): VerticalBounds | undefined {
  const {width, height} = canvas;
  const context = canvas.getContext('2d');
  if (!width || !height || !context) return;

  let bounds = cache.get(canvas);
  if (!bounds) {
    bounds = new Map();
    cache.set(canvas, bounds);
  }
  const key = box.join(',');
  if (bounds.has(key)) return bounds.get(key);

  // The PDF.js page canvas covers the same normalized page as the overlay.
  // Sample the original ink within the verified horizontal span in bitmap pixels.
  const x = Math.max(0, Math.floor(box[0] * width));
  const glyphTop = box[1] * height;
  const glyphBottom = box[3] * height;
  const fontHeight = glyphBottom - glyphTop;
  const center = (glyphTop + glyphBottom) / 2;
  // Read a little beyond the glyph box to detect adjacent text, highlighted or not.
  const y = Math.max(0, Math.floor(glyphTop - fontHeight / 4));
  const w = Math.min(width, Math.ceil(box[2] * width)) - x;
  const h = Math.min(height, Math.ceil(glyphBottom + fontHeight / 4)) - y;
  if (w <= 0 || h <= 0) return;

  const pixels = context.getImageData(x, y, w, h).data;
  const rows = Array.from({length: h}, (_, row) => {
    let ink = 0;
    for (let i = row * w * 4; i < (row + 1) * w * 4; i += 4) {
      if (pixels[i + 3] > 96 && (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 180) ink++;
    }
    return ink;
  });

  // Font boxes may include the edges of neighbouring lines. Pick the ink band
  // nearest the source line's centre, weighted by its amount of foreground ink.
  const sourceStart = Math.max(0, Math.floor(glyphTop) - y);
  const sourceEnd = Math.min(h, Math.ceil(glyphBottom) - y);
  let band: VerticalBounds | undefined;
  let strength = 0;
  for (let row = sourceStart; row < sourceEnd;) {
    if (!rows[row]) {
      row++;
      continue;
    }
    const first = row;
    let ink = 0;
    while (row < sourceEnd && rows[row]) ink += rows[row++];
    const centerDistance = Math.abs(y + (first + row) / 2 - center) / (sourceEnd - sourceStart);
    const score = ink * Math.pow(1 - centerDistance, 2);
    if (score > strength) {
      band = [first, row];
      strength = score;
    }
  }
  let fitted: VerticalBounds | undefined;
  if (band) {
    const [top, bottom] = band;
    const padding = (bottom - top) * .16;
    let above = top;
    let below = bottom;
    while (above > 0 && !rows[above - 1]) above--;
    while (below < h && !rows[below]) below++;
    // Use at most half the available whitespace, leaving a gap to the next line.
    fitted = [
      (y + top - Math.min(padding, (top - above) / 2)) / height,
      (y + bottom + Math.min(padding, (below - bottom) / 2)) / height,
    ];
  }
  bounds.set(key, fitted);
  return fitted;
}
