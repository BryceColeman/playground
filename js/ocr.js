// ocr.js — import pipeline. Directory screenshots are a regular grid of
// household cards (photo on top, name text below). We slice the grid, crop each
// card into a photo + a text strip, preprocess the text strip, and OCR it with
// Tesseract.js — all in the browser, so screenshots never leave the device.

let _workerPromise = null;

// Lazily create one reusable Tesseract worker. Tesseract is loaded from a CDN
// <script> in index.html (global `Tesseract`).
export function getWorker(onProgress) {
  if (_workerPromise) return _workerPromise;
  if (!window.Tesseract) {
    return Promise.reject(
      new Error('OCR engine not loaded (needs internet the first time).')
    );
  }
  _workerPromise = window.Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
    },
  });
  return _workerPromise;
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load image'));
    };
    img.src = url;
  });
}

// Slice an image into grid cells. `textBand` is the fraction of each cell
// (from the bottom) that holds the name text; the rest is treated as the photo.
// marginX/marginY trim gutters between cards (fraction of cell size).
export function sliceGrid(img, opts = {}) {
  const {
    rows = 4,
    cols = 2,
    textBand = 0.28,
    marginX = 0.04,
    marginY = 0.04,
  } = opts;

  const cellW = img.width / cols;
  const cellH = img.height / rows;
  const mx = cellW * marginX;
  const my = cellH * marginY;
  const cells = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW + mx;
      const y = r * cellH + my;
      const w = cellW - 2 * mx;
      const h = cellH - 2 * my;
      const photoH = h * (1 - textBand);
      const textY = y + photoH;
      const textH = h * textBand;

      cells.push({
        row: r,
        col: c,
        photo: cropCanvas(img, x, y, w, photoH),
        text: cropCanvas(img, x, textY, w, textH),
      });
    }
  }
  return cells;
}

function cropCanvas(img, sx, sy, sw, sh) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(sw));
  cv.height = Math.max(1, Math.round(sh));
  cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return cv;
}

// Upscale + grayscale + contrast-stretch to give Tesseract a cleaner target.
export function preprocess(canvas, scale = 2) {
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let min = 255,
    max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export async function ocrText(canvas, worker) {
  const pre = preprocess(canvas);
  const { data } = await worker.recognize(pre);
  return (data.text || '').trim();
}

// Best-effort parse of an OCR'd card into a name guess. Member Tools usually
// shows "Last, First" or "First Last"; we keep the raw text around so the user
// can correct it on the review screen.
export function parseName(raw) {
  const line = (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)[0] || '';
  const cleaned = line.replace(/[^A-Za-z ,.'-]/g, '').trim();

  let firstName = '',
    lastName = '';
  if (cleaned.includes(',')) {
    const [last, first] = cleaned.split(',');
    lastName = (last || '').trim();
    firstName = (first || '').trim().split(/\s+/)[0] || '';
  } else {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ');
  }
  return { firstName, lastName, raw: cleaned };
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
