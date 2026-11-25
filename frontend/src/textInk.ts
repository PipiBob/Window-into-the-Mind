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
  const y = Math.max(0, Math.floor(box[1] * height));
  const w = Math.min(width, Math.ceil(box[2] * width)) - x;
  const h = Math.min(height, Math.ceil(box[3] * height)) - y;
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
  let best: VerticalBounds | undefined;
  let strength = 0;
  for (let row = 0; row < h;) {
    if (!rows[row]) {
      row++;
      continue;
    }
    const first = row;
    let ink = 0;
    while (row < h && rows[row]) ink += rows[row++];
    const centerDistance = Math.abs((first + row) / 2 - h / 2) / h;
    const score = ink * Math.pow(1 - centerDistance, 2);
    if (score > strength) {
      best = [(y + first) / height, (y + row) / height];
      strength = score;
    }
  }
  bounds.set(key, best);
  return best;
}
