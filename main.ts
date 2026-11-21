// THE SATURDAY GLOBE — front page for Saturday 21 November 2026.
// Written from scratch. Node 22+ standard library only, no network,
// no dependencies, fully deterministic output.
//
// Run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Writes entry.png (1024x1024, RGBA PNG) to $MAKEFUN_OUTPUT_DIR or /output.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- PNG ----
// CRC32 (IEEE 802.3 polynomial), implemented from scratch.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

// Encode an RGBA pixel buffer (width x height) as a PNG.
// Filter type 0 (None) on every scanline: simple and deterministic.
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- Canvas ----
type RGB = [number, number, number];

const W = 1024;
const H = 1024;

class Canvas {
  data: Buffer;
  constructor() {
    this.data = Buffer.alloc(W * H * 4);
  }
  setPixel(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = 255;
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.setPixel(i, j, c);
  }
  strokeRect(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
    this.fillRect(x, y, w, t, c);
    this.fillRect(x, y + h - t, w, t, c);
    this.fillRect(x, y, t, h, c);
    this.fillRect(x + w - t, y, t, h, c);
  }
  hline(x0: number, x1: number, y: number, c: RGB, t: number): void {
    for (let t2 = 0; t2 < t; t2++) for (let x = x0; x <= x1; x++) this.setPixel(x, y + t2, c);
  }
  vline(x: number, y0: number, y1: number, c: RGB, t: number): void {
    for (let t2 = 0; t2 < t; t2++) for (let y = y0; y <= y1; y++) this.setPixel(x + t2, y, c);
  }
  // Bresenham line with square brush of size t.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      for (let x = -half; x <= half; x++) this.setPixel(cx + x, cy + y, c);
    }
  }
  strokeCircle(cx: number, cy: number, r: number, c: RGB, t: number): void {
    for (let a = 0; a < 360; a += 1) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      this.fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    }
  }
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
    const minX = Math.min(x0, x1, x2);
    const maxX = Math.max(x0, x1, x2);
    const minY = Math.min(y0, y1, y2);
    const maxY = Math.max(y0, y1, y2);
    const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
    if (d === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((x1 - x) * (y2 - y) - (y1 - y) * (x2 - x)) / d;
        const w1 = ((x2 - x) * (y0 - y) - (y2 - y) * (x0 - x)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) this.setPixel(x, y, c);
      }
    }
  }
}

// -------------------------------------------------------------- Font -----
// Hand-drawn 5x7 bitmap font. Each glyph: 7 rows of 5 cells ("#" = ink).
const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10001", "10000", "10001", "01110"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11110", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  j: ["00010", "00000", "00110", "00010", "00010", "10010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "00000", "11110", "10001", "11110", "10000", "10000"],
  q: ["00000", "00000", "01111", "10001", "01111", "00001", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11100", "01000", "01000", "01000", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10001", "01111"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  w: ["00000", "00000", "10001", "10101", "10101", "10101", "01010"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "01010", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "£": ["00110", "01000", "01000", "11110", "01000", "10010", "01110"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "•": ["00000", "00000", "01100", "01100", "01100", "00000", "00000"],
  "—": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
};

const BLANK: string[] = ["00000", "00000", "00000", "00000", "00000", "00000", "00000"];

function glyph(ch: string): string[] {
  return FONT[ch] ?? BLANK;
}

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale; // 5px glyph + 1px tracking, no trailing gap
}

function drawText(cv: Canvas, x: number, y: number, s: string, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of s) {
    const g = glyph(ch);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row][col] === "1") cv.fillRect(cx + col * scale, y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, cx: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cv, cx - Math.floor(textWidth(s, scale) / 2), y, s, scale, c);
}

function drawTextRight(cv: Canvas, right: number, y: number, s: string, scale: number, c: RGB): void {
  drawText(cv, right - textWidth(s, scale), y, s, scale, c);
}

// Greedy word wrap. Returns lines that fit maxWidth px at the given scale.
function wrapText(s: string, maxWidth: number, scale: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxWidth || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawWrapped(cv: Canvas, x: number, y: number, s: string, scale: number, c: RGB, maxWidth: number, lineGap: number): number {
  const lines = wrapText(s, maxWidth, scale);
  const lh = 7 * scale + lineGap;
  lines.forEach((ln, i) => drawText(cv, x, y + i * lh, ln, scale, c));
  return lines.length;
}

// ------------------------------------------------------------- Colours ---
const PAPER: RGB = [247, 242, 231];
const INK: RGB = [17, 17, 17];
const RED: RGB = [178, 28, 28];
const DARKRED: RGB = [120, 18, 18];
const BLUE: RGB = [30, 58, 95];
const DARKBLUE: RGB = [14, 28, 48];
const SKY: RGB = [96, 140, 190];
const GOLD: RGB = [212, 160, 32];
const ORANGE: RGB = [230, 110, 20];
const GREEN: RGB = [34, 120, 60];
const GREY: RGB = [110, 110, 105];
const LIGHTGREY: RGB = [222, 216, 203];
const WHITE: RGB = [255, 255, 255];
const YELLOW: RGB = [245, 205, 60];

// ------------------------------------------------------- Illustrations ---
// All illustrations are simple drawn shapes (geometry, no photos).

// Lead illustration: Kyiv skyline at night under missile trails.
function drawLeadArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, DARKBLUE);
  // Stars (fixed pattern).
  const stars: Array<[number, number]> = [
    [30, 12], [90, 26], [150, 10], [230, 22], [320, 12], [410, 26], [500, 10],
    [590, 24], [680, 12], [770, 26], [860, 10], [920, 24], [60, 44], [360, 40], [640, 42],
  ];
  for (const [sx, sy] of stars) cv.fillRect(x + sx, y + sy, 3, 3, WHITE);
  // Missile trails arcing down.
  cv.line(x + 120, y + 4, x + 210, y + 58, GOLD, 3);
  cv.line(x + 480, y + 2, x + 560, y + 52, GOLD, 3);
  cv.line(x + 760, y + 6, x + 700, y + 50, GOLD, 3);
  cv.fillCircle(x + 210, y + 58, 4, ORANGE);
  cv.fillCircle(x + 560, y + 52, 4, ORANGE);
  cv.fillCircle(x + 700, y + 50, 4, ORANGE);
  // Explosions over the skyline.
  cv.fillCircle(x + 300, y + 46, 12, ORANGE);
  cv.fillCircle(x + 300, y + 46, 6, YELLOW);
  cv.fillCircle(x + 840, y + 52, 9, ORANGE);
  cv.fillCircle(x + 840, y + 52, 4, YELLOW);
  // Skyline silhouettes.
  const buildings: Array<[number, number, number]> = [
    [0, 44, 70], [80, 30, 60], [150, 52, 80], [240, 34, 55], [305, 48, 70],
    [385, 28, 60], [455, 50, 75], [540, 32, 55], [605, 48, 70], [685, 30, 60],
    [755, 50, 70], [835, 34, 55], [900, 46, 68],
  ];
  for (const [bx, bh, bw] of buildings) {
    cv.fillRect(x + bx, y + h - bh, bw, bh, INK);
  }
  // Lit windows (fixed pattern).
  for (let i = 0; i < 26; i++) {
    const wx = x + 12 + ((i * 37) % (w - 24));
    const wy = y + h - 38 + ((i * 13) % 26);
    cv.fillRect(wx, wy, 4, 5, YELLOW);
  }
  // Ground line.
  cv.fillRect(x, y + h - 4, w, 4, INK);
}

// Falling-market chart: descending bars with a down arrow.
function drawChartArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.strokeRect(x, y, w, h, INK, 2);
  const base = y + h - 18;
  const heights = [92, 78, 84, 62, 48, 30];
  const bw = 14;
  const gap = 4;
  heights.forEach((hh, i) => {
    const bx = x + 10 + i * (bw + gap);
    cv.fillRect(bx, base - hh, bw, hh, i >= 3 ? RED : DARKRED);
  });
  cv.line(x + 12, y + 14, x + w - 12, base - 26, RED, 3);
  // Arrow head.
  cv.fillTriangle(x + w - 12, base - 26, x + w - 26, base - 30, x + w - 16, base - 12, RED);
  cv.line(x + 8, base, x + w - 8, base, INK, 2);
  drawText(cv, x + 8, y + h - 14, "-5.3%", 1, RED);
}

// Scales of justice.
function drawScalesArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.strokeRect(x, y, w, h, INK, 2);
  const cx = x + Math.floor(w / 2);
  const top = y + 16;
  const beamY = y + 30;
  cv.fillCircle(cx, top, 4, GOLD);
  cv.vline(cx, top, y + h - 22, INK, 3);
  cv.hline(cx - 42, cx + 42, beamY, INK, 3);
  cv.line(cx - 42, beamY, cx - 42, beamY + 34, INK, 2);
  cv.line(cx + 42, beamY, cx + 42, beamY + 34, INK, 2);
  cv.fillTriangle(cx - 56, beamY + 34, cx - 28, beamY + 34, cx - 42, beamY + 52, GOLD);
  cv.fillTriangle(cx + 28, beamY + 34, cx + 56, beamY + 34, cx + 42, beamY + 52, GOLD);
  cv.fillRect(cx - 26, y + h - 22, 52, 6, INK);
  drawTextCentered(cv, cx, y + h - 14, "9 - 6", 1, INK);
}

// Two flags: United Kingdom and European Union.
function drawFlagsArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.strokeRect(x, y, w, h, INK, 2);
  // UK flag (simplified): blue field, white cross, red cross.
  const fx = x + 10;
  const fy = y + 22;
  const fw = 46;
  const fh = 30;
  cv.fillRect(fx, fy, fw, fh, BLUE);
  cv.fillRect(fx, fy + 12, fw, 6, WHITE);
  cv.fillRect(fx + 20, fy, 6, fh, WHITE);
  cv.fillRect(fx, fy + 13, fw, 4, RED);
  cv.fillRect(fx + 21, fy, 4, fh, RED);
  cv.strokeRect(fx, fy, fw, fh, INK, 1);
  // EU flag: blue field, ring of gold dots.
  const ex = x + w - 56;
  const ey = y + 22;
  cv.fillRect(ex, ey, fw, fh, BLUE);
  for (let a = 0; a < 12; a++) {
    const rad = (a * Math.PI) / 6;
    cv.fillCircle(ex + 23 + Math.round(10 * Math.cos(rad)), ey + 15 + Math.round(9 * Math.sin(rad)), 2, GOLD);
  }
  cv.strokeRect(ex, ey, fw, fh, INK, 1);
  // Handshake line below.
  drawTextCentered(cv, x + Math.floor(w / 2), y + 62, "DEAL", 2, INK);
  cv.line(x + 16, y + 88, x + w - 16, y + 88, GREEN, 3);
  drawTextCentered(cv, x + Math.floor(w / 2), y + h - 16, "GBP 17bn", 1, GREEN);
}

// Globe with sun (climate).
function drawGlobeArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.strokeRect(x, y, w, h, INK, 2);
  const cx = x + Math.floor(w / 2);
  const cy = y + 58;
  // Sun.
  cv.fillCircle(x + w - 22, y + 20, 9, GOLD);
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    cv.line(
      x + w - 22 + Math.round(13 * Math.cos(rad)), y + 20 + Math.round(13 * Math.sin(rad)),
      x + w - 22 + Math.round(18 * Math.cos(rad)), y + 20 + Math.round(18 * Math.sin(rad)),
      GOLD, 2,
    );
  }
  // Globe.
  cv.fillCircle(cx, cy, 36, SKY);
  cv.strokeCircle(cx, cy, 36, BLUE, 3);
  cv.fillCircle(cx - 12, cy - 8, 10, GREEN);
  cv.fillCircle(cx + 12, cy + 10, 12, GREEN);
  cv.fillCircle(cx + 16, cy - 14, 6, GREEN);
  cv.line(cx - 36, cy, cx + 36, cy, BLUE, 2);
  cv.line(cx, cy - 36, cx, cy + 36, BLUE, 2);
  drawTextCentered(cv, cx, y + h - 16, "1.5 C", 1, RED);
}

// Mountains with a crack (earthquake).
function drawQuakeArt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, WHITE);
  cv.strokeRect(x, y, w, h, INK, 2);
  cv.fillTriangle(x + 6, y + h - 24, x + 44, y + 22, x + 82, y + h - 24, GREY);
  cv.fillTriangle(x + 46, y + h - 24, x + 88, y + 34, x + 118, y + h - 24, [140, 140, 135]);
  // Snow caps.
  cv.fillTriangle(x + 36, y + 30, x + 44, y + 22, x + 52, y + 30, WHITE);
  // Crack zig-zag through the ground.
  cv.line(x + 10, y + h - 24, x + 34, y + h - 16, RED, 3);
  cv.line(x + 34, y + h - 16, x + 58, y + h - 26, RED, 3);
  cv.line(x + 58, y + h - 26, x + 84, y + h - 14, RED, 3);
  cv.line(x + 84, y + h - 14, x + w - 10, y + h - 22, RED, 3);
  cv.fillRect(x + 6, y + h - 12, w - 12, 4, INK);
  drawTextCentered(cv, x + Math.floor(w / 2), y + 8, "6.8", 2, RED);
}

// ------------------------------------------------------------ Cards ------
interface CardSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  labelColor: RGB;
  headline: string[]; // 1-2 lines, scale 3
  body: string;
  art: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

function drawCard(cv: Canvas, spec: CardSpec): void {
  const { x, y, w, h } = spec;
  cv.fillRect(x, y, w, h, PAPER);
  cv.strokeRect(x, y, w, h, INK, 2);
  cv.fillRect(x + 2, y + 2, w - 4, 22, spec.labelColor);
  drawText(cv, x + 10, y + 6, spec.label, 2, WHITE);
  let hy = y + 32;
  for (const ln of spec.headline) {
    drawText(cv, x + 10, hy, ln, 3, INK);
    hy += 25;
  }
  const artX = x + w - 134;
  const artY = y + 30;
  spec.art(cv, artX, artY, 124, h - 40);
  const bodyW = w - 154;
  drawWrapped(cv, x + 10, hy + 4, spec.body, 2, INK, bodyW, 4);
}

// ------------------------------------------------------------- Layout ----
const M = 28; // page margin
const CW = W - 2 * M; // 968 content width

function drawPage(cv: Canvas): void {
  cv.fillRect(0, 0, W, H, PAPER);

  // ---- Masthead ----
  cv.fillRect(M, 20, CW, 4, INK);
  drawTextCentered(cv, Math.floor(W / 2), 30, "THE SATURDAY GLOBE", 8, INK);
  cv.fillRect(M, 96, CW, 2, INK);
  drawText(cv, M, 104, "WORLD EDITION", 2, INK);
  drawTextCentered(cv, Math.floor(W / 2), 102, "SATURDAY 21 NOVEMBER 2026", 3, INK);
  drawTextRight(cv, W - M, 104, "NO. 325", 2, INK);
  cv.fillRect(M, 132, CW, 4, INK);

  // ---- Lead story: Russia strikes Ukraine ----
  const leadY = 146;
  cv.fillRect(M, leadY, CW, 26, RED);
  drawText(cv, M + 12, leadY + 5, "WAR IN UKRAINE", 2, WHITE);
  drawTextRight(cv, W - M - 12, leadY + 5, "KYIV", 2, WHITE);
  drawText(cv, M, 180, "RUSSIA FIRES 400 DRONES", 5, INK);
  drawText(cv, M, 225, "AND 110 MISSILES AT UKRAINE", 5, INK);
  drawWrapped(
    cv, M, 274,
    "Overnight strikes kill at least eight people and hit bridges, power plants and railways across Ukraine. Two missiles and a suspected drone also come down in Poland. Warsaw calls it a deliberate provocation.",
    2, INK, CW, 4,
  );
  drawLeadArt(cv, M, 338, CW, 88);

  // ---- Row 1: AI sell-off | ICJ genocide ruling ----
  drawCard(cv, {
    x: M, y: 438, w: 470, h: 170,
    label: "MARKETS - NEW YORK", labelColor: DARKRED,
    headline: ["AI ROUT ERASES", "2026 GAINS"],
    body: "Nasdaq falls 5.3% on Friday. Nvidia drops 14%. Anthropic slides 9% on day two.",
    art: drawChartArt,
  });
  drawCard(cv, {
    x: 526, y: 438, w: 470, h: 170,
    label: "JUSTICE - THE HAGUE", labelColor: BLUE,
    headline: ["MYANMAR GUILTY", "OF GENOCIDE"],
    body: "The ICJ rules 9-6 that Myanmar committed genocide in 2017. Rights groups now urge sanctions.",
    art: drawScalesArt,
  });

  // ---- Row 2: UK-EU deal | COP31 overtime ----
  drawCard(cv, {
    x: M, y: 620, w: 470, h: 170,
    label: "BRUSSELS", labelColor: GREEN,
    headline: ["UK AND EU SEAL", "BREXIT RESET"],
    body: "Food trade, carbon markets and youth mobility. PM Burnham hails a win-win worth £17bn a year.",
    art: drawFlagsArt,
  });
  drawCard(cv, {
    x: 526, y: 620, w: 470, h: 170,
    label: "CLIMATE - ANTALYA", labelColor: [120, 80, 10],
    headline: ["COP31 TALKS RUN", "PAST DEADLINE"],
    body: "Nations miss the Friday finish as a draft drops fossil fuels. A new text is due on Saturday.",
    art: drawGlobeArt,
  });

  // ---- Row 3: Peru quake | Also today ----
  drawCard(cv, {
    x: M, y: 802, w: 470, h: 170,
    label: "DISASTER - PERU", labelColor: DARKBLUE,
    headline: ["QUAKE SHAKES", "PERU AT 6.8"],
    body: "The tremor is centred in Junin and felt in Lima. No deaths or major damage are reported.",
    art: drawQuakeArt,
  });

  // Also-today box.
  const bx = 526;
  const by = 802;
  const bw = 470;
  const bh = 170;
  cv.fillRect(bx, by, bw, bh, PAPER);
  cv.strokeRect(bx, by, bw, bh, INK, 2);
  cv.fillRect(bx + 2, by + 2, bw - 4, 22, INK);
  drawText(cv, bx + 10, by + 6, "ALSO TODAY", 2, WHITE);
  const items = [
    "Pancreatic cancer pill: tumours vanish in 1 in 12 patients.",
    "Gen Z protests spread across 25 European countries.",
    "FBI probes a hack of its criminal database.",
  ];
  let iy = by + 34;
  for (const item of items) {
    drawText(cv, bx + 10, iy, "•", 2, RED);
    const n = drawWrapped(cv, bx + 28, iy, item, 2, INK, bw - 44, 4);
    iy += n * 18 + 10;
  }

  // ---- Ticker / footer ----
  cv.fillRect(M, 984, CW, 22, INK);
  drawTextCentered(
    cv, Math.floor(W / 2), 989,
    "BITCOIN BELOW $58,000 • GTA VI $3.8BN DAY ONE • HOUTHI MISSILES AT RIYADH",
    2, WHITE,
  );
}

// --------------------------------------------------------------- Main ----
import * as crypto from "node:crypto";

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const cv = new Canvas();
  drawPage(cv);
  const png = encodePng(W, H, cv.data);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  console.log(`wrote ${outPath} (${png.length} bytes, sha256 ${sha})`);
}

main();
