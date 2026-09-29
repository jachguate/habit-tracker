/* SPDX-License-Identifier: MIT — Copyright (c) 2026 Juan Antonio Castillo (jachguate). See LICENSE. */
/*
  Radial habit tracker renderer.

  buildScene() lays out the whole sheet in PostScript points (1/72 in), origin
  at the top-left corner of the page, and returns it as a list of drawing
  operations. The scene is then turned into:
    - sceneToSVG()    -> SVG document (string), also used for the live preview;
    - sceneToCanvas() -> <canvas> at a given resolution (PNG / PDF output);
    - canvasToPNG()   -> PNG Blob carrying its resolution and source URL.

  Texts are measured with a 2D canvas, so both outputs use the same fonts
  (system font stacks, which cover every supported script).
*/
(function (global) {
  'use strict';
  const HT = global.HabitTracker = global.HabitTracker || {};

  const PAGE_SIZES = {
    letter: { short: 8.5, long: 11, unit: 'in' },
    legal: { short: 8.5, long: 14, unit: 'in' },
    tabloid: { short: 11, long: 17, unit: 'in' },
    a5: { short: 148, long: 210, unit: 'mm' },
    a4: { short: 210, long: 297, unit: 'mm' },
    a3: { short: 297, long: 420, unit: 'mm' },
  };

  const FONT_STACKS = {
    sans: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'PingFang SC', 'Microsoft YaHei', 'Nirmala UI', sans-serif",
    hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', 'Dancing Script', cursive",
    serif: "Georgia, 'Times New Roman', 'Noto Serif', serif",
  };

  const THIN_LINE = 0.8;
  const THICK_LINE = 1.6;
  const GUIDE_LINE = 0.6;
  const MAX_RINGS = 40;
  // Largest canvas we create (iOS Safari refuses canvases above ~16.7 Mpx).
  const MAX_CANVAS_PIXELS = 16000000;

  function toPoints(value, unit) {
    switch (unit) {
      case 'in': return value * 72;
      case 'mm': return value * 72 / 25.4;
      case 'px': return value * 0.75;
      default: return value;
    }
  }

  /** Days of a month; month is 1-based. */
  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const rad = (deg) => deg * Math.PI / 180;

  /* ---------- text measurement ---------- */

  function fontCss(font) {
    return `${font.italic ? 'italic ' : ''}${font.weight || 400} ${font.size}px ${FONT_STACKS[font.family]}`;
  }

  let measureCtx = null;
  const measureCache = new Map();

  /** Width of a text in points (measured at 100 px and scaled). */
  function measure(text, font) {
    if (!text) return 0;
    const key = `${font.family}|${font.weight || 400}|${font.italic ? 1 : 0}|${text}`;
    let width = measureCache.get(key);
    if (width === undefined) {
      if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
      measureCtx.font = fontCss(Object.assign({}, font, { size: 100 }));
      width = measureCtx.measureText(text).width / 100;
      if (measureCache.size > 5000) measureCache.clear();
      measureCache.set(key, width);
    }
    return width * font.size;
  }

  const capHeight = (size) => 0.7 * size;

  const font = (family, weight, size, italic) => ({ family, weight, size, italic: !!italic });

  /** Font size that makes text fit in maxWidth (never larger than size). */
  function fitSize(text, f, maxWidth) {
    if (!text) return f.size;
    const width = measure(text, f);
    return width > maxWidth && width > 0 ? f.size * maxWidth / width : f.size;
  }

  // Punctuation that must not start a line in Chinese text (it stays at the
  // end of the previous line, slightly past the margin if needed).
  const NO_LINE_START = /^[，。、；：！？）》」』】〉”’…—,.;:!?)\]]$/;

  /** Word wrap; byChar wraps between any two characters (Chinese). */
  function wrapText(text, f, maxWidth, byChar) {
    const tokens = byChar ? Array.from(text) : text.split(/\s+/).filter(Boolean);
    const joiner = byChar ? '' : ' ';
    const lines = [];
    let line = '';
    for (const token of tokens) {
      const candidate = line ? line + joiner + token : token;
      if (line && measure(candidate, f) > maxWidth && !(byChar && NO_LINE_START.test(token))) {
        lines.push(line);
        line = byChar ? token.trimStart() : token;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* ---------- scene ---------- */

  function normalize(params) {
    const p = Object.assign({
      pageWidth: 11, pageHeight: 8.5, unit: 'in',
      userName: '', monthText: '', days: 31, habits: [], habitCount: 8,
      title1: '{days} DAYS', title2: '', habitsHeader: '', monthLabel: '',
      box1: '', box2: '', quote: '', author: '', quoteOpen: '“', quoteClose: '”',
      lineColor: '#000000', bgColor: '#ffffff', sweep: 270, rtl: false, wrapByChar: false,
      formatNumber: (n) => String(n), sourceUrl: '', sourceLabel: '',
    }, params);
    p.pageWidthPt = toPoints(p.pageWidth, p.unit);
    p.pageHeightPt = toPoints(p.pageHeight, p.unit);
    p.days = clamp(Math.round(p.days) || 31, 1, 31);
    p.rings = clamp(Math.round(p.habitCount || p.habits.length || 8), 1, MAX_RINGS);
    p.sweep = clamp(Number(p.sweep) || 270, 30, 360);
    return p;
  }

  function buildScene(params) {
    const p = normalize(params);
    const W = p.pageWidthPt;
    const H = p.pageHeightPt;
    const ops = [];
    const fmt = p.formatNumber;
    const fullCircle = p.sweep >= 359.99;
    const openWheel = p.sweep <= 270.01;

    // Wheel region (including the day-number band). Landscape: left part of
    // the page, between the header and the quote, focus boxes on the right.
    // Portrait: full width below the title, focus boxes side by side below.
    const portrait = H > W;
    const margin = 0.045 * W;
    const region = portrait
      ? { left: margin, right: 0.955 * W, top: 0.16 * H, bottom: 0.72 * H }
      : { left: margin, right: 0.68 * W, top: 0.075 * H, bottom: 0.85 * H };
    const size = Math.min(region.right - region.left, region.bottom - region.top);
    const rOuter = size / 2 / 1.1;
    const band = 0.1 * rOuter;
    const rInner = 0.26 * rOuter;
    const deltaR = (rOuter - rInner) / p.rings;
    const cx = (region.left + region.right) / 2;
    const cy = (region.top + region.bottom) / 2;
    const polar = (r, deg) => ({ x: cx + r * Math.cos(rad(deg)), y: cy + r * Math.sin(rad(deg)) });

    const stroke = (op, width) => ops.push(Object.assign(op, { width }));
    const text = (str, x, y, f, align, extra) => {
      if (!str) return;
      ops.push(Object.assign({ t: 'text', text: str, x, y, font: f, align }, extra));
    };
    // User-provided or translated texts follow the language direction.
    const langText = (str, x, y, f, align, extra) =>
      text(str, x, y, f, align, Object.assign({ rtl: p.rtl }, extra));
    const expand = (s) => String(s || '').replace(/\{days\}/gi, fmt(p.days)).replace(/\{month\}/gi, p.monthText);

    // Background
    ops.push({ t: 'rect', x: 0, y: 0, w: W, h: H, fill: p.bgColor });

    // User name
    const userName = p.userName.trim();
    if (userName) {
      const f = font('sans', 700, 0.028 * H);
      f.size = fitSize(userName, f, 0.55 * W);
      langText(userName, margin, 0.05 * H, f, 'left');
    }

    // Concentric habit rings: j = 0 is the hub, j = rings the outer border.
    for (let j = 0; j <= p.rings; j++) {
      const r = rInner + j * deltaR;
      const width = j === 0 || j === p.rings ? THICK_LINE : THIN_LINE;
      if (fullCircle) stroke({ t: 'circle', cx, cy, r }, width);
      else stroke({ t: 'arc', cx, cy, r, start: -90, sweep: p.sweep }, width);
    }

    // Radial day lines; the first and last close the open wheel.
    const step = p.sweep / p.days;
    for (let i = 0; i <= p.days; i++) {
      if (fullCircle && i === p.days) break;
      const angle = -90 + i * step;
      const a = polar(rInner, angle);
      const b = polar(rOuter, angle);
      const width = !fullCircle && (i === 0 || i === p.days) ? THICK_LINE : THIN_LINE;
      stroke({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }, width);
    }

    // Day numbers: baseline tangent to the wheel, glyph tops pointing outwards.
    {
      const textR = rOuter + band / 2;
      const f = font('sans', 700, Math.min(0.55 * band, 0.45 * textR * rad(step)));
      for (let i = 0; i < p.days; i++) {
        const angle = -90 + (i + 0.5) * step;
        const c = polar(textR, angle);
        text(fmt(i + 1), 0, capHeight(f.size) / 2, f, 'center', { tx: c.x, ty: c.y, rot: angle + 90 });
      }
    }

    // Hub: month label and month text; the month goes on two lines, split at
    // its last space, when it does not fit on one.
    {
      const maxWidth = 1.6 * rInner;
      const month = p.monthText.trim();
      const monthFont = font('hand', 400, 0.36 * rInner);
      let lines = [month];
      const lastSpace = month.lastIndexOf(' ');
      if (lastSpace > 0 && measure(month, monthFont) > maxWidth) {
        lines = [month.slice(0, lastSpace).trim(), month.slice(lastSpace + 1).trim()];
      }
      for (const line of lines) monthFont.size = fitSize(line, monthFont, maxWidth);
      const labelFont = font('sans', 700, 0.24 * rInner);
      labelFont.size = fitSize(p.monthLabel, labelFont, 1.5 * rInner);
      if (lines.length === 1) {
        langText(p.monthLabel, cx, cy - 0.12 * rInner, labelFont, 'center');
        langText(lines[0], cx, cy + 0.32 * rInner, monthFont, 'center');
      } else {
        langText(p.monthLabel, cx, cy - 0.3 * rInner, labelFont, 'center');
        langText(lines[0], cx, cy + 0.1 * rInner, monthFont, 'center');
        langText(lines[1], cx, cy + 0.1 * rInner + 1.05 * monthFont.size, monthFont, 'center');
      }
    }

    // Habit list. The header sits on the day-number band: centered over the
    // list with an open wheel, at the left margin when the wheel is (nearly)
    // full because the day numbers use the top of the band.
    {
      const headerFont = font('sans', 400, 0.65 * band);
      let headerX, headerAlign;
      if (openWheel) {
        headerFont.size = fitSize(p.habitsHeader, headerFont, cx - margin);
        headerX = (margin + cx) / 2;
        headerAlign = 'center';
      } else {
        headerFont.size = fitSize(p.habitsHeader, headerFont, cx - margin - 0.4 * rOuter);
        headerX = margin;
        headerAlign = 'left';
      }
      langText(p.habitsHeader, headerX, cy - rOuter - band / 2 + capHeight(headerFont.size) / 2,
        headerFont, headerAlign);

      // One row per ring, outermost ring first; each guideline is the inner
      // border of its ring and ends where it meets the wheel.
      const rowSize = Math.min(0.62 * deltaR, 0.024 * Math.min(W, H));
      const numFont = font('sans', 700, rowSize);
      const lineStart = margin + measure(fmt(p.rings) + '.', numFont) + 0.15 * rowSize;
      for (let j = 0; j < p.rings; j++) {
        const r = rOuter - (j + 1) * deltaR;
        const y = cy - r;
        const lineEnd = openWheel
          ? cx
          : Math.max(lineStart, cx - Math.sqrt(Math.max(0, (rOuter + band) ** 2 - r ** 2)));
        text(fmt(j + 1) + '.', lineStart, y - 0.1 * rowSize, numFont, 'right');
        stroke({ t: 'line', x1: lineStart, y1: y, x2: lineEnd, y2: y }, GUIDE_LINE);
        const habit = String(p.habits[j] || '').trim();
        if (habit) {
          const textX = lineStart + 0.3 * rowSize;
          const f = font('sans', 400, rowSize);
          f.size = fitSize(habit, f, lineEnd - textX - 0.3 * rowSize);
          langText(habit, textX, y - 0.18 * rowSize, f, 'left');
        }
      }
    }

    // Title, right-aligned at the top; returns the y below it.
    let titleBottom;
    {
      const t1 = expand(p.title1);
      const t2 = expand(p.title2);
      const right = 0.955 * W;
      const maxWidth = portrait ? 0.6 * W : 0.32 * W;
      let y = portrait ? 0.03 * H : 0.04 * H;
      const f1 = font('sans', 900, portrait ? 0.075 * H : 0.12 * H);
      f1.size = fitSize(t1, f1, maxWidth);
      if (t1) {
        // Room above the capitals for accents (DÍAS).
        y += 1.3 * capHeight(f1.size);
        langText(t1, right, y, f1, 'right');
      }
      if (t2) {
        const f2 = font('sans', 700, 0.5 * f1.size);
        f2.size = fitSize(t2, f2, maxWidth);
        // Room for the descenders of line 1 (Cyrillic Д) and the accents of line 2 (Ї, Ă).
        y += (t1 ? 0.22 * f1.size : 0) + f2.size;
        langText(t2, right, y, f2, 'right');
        y += 0.3 * f2.size;
      }
      titleBottom = y;
    }

    // Focus boxes
    {
      const box = (title, left, top, right, bottom) => {
        const f = font('sans', 400, Math.min(0.028 * H, 0.2 * (bottom - top)));
        f.size = fitSize(title, f, right - left);
        const cap = capHeight(f.size);
        langText(title, (left + right) / 2, top + cap, f, 'center');
        const boxTop = top + cap + 0.6 * f.size;
        stroke({ t: 'rect', x: left, y: boxTop, w: right - left, h: bottom - boxTop }, THICK_LINE);
      };
      const right = 0.955 * W;
      if (portrait) {
        // Side by side, between the wheel and the quote.
        const gap = 0.04 * W;
        const top = 0.735 * H;
        const bottom = 0.865 * H;
        const w = (right - margin - gap) / 2;
        box(p.box1, margin, top, margin + w, bottom);
        box(p.box2, right - w, top, right, bottom);
      } else {
        // Stacked, on the right side under the title.
        const left = 0.70 * W;
        const gap = 0.035 * H;
        const top = Math.max(titleBottom, 0.15 * H) + 0.02 * H;
        const bottom = 0.855 * H;
        const h = (bottom - top - gap) / 2;
        box(p.box1, left, top, right, top + h);
        box(p.box2, left, bottom - h, right, bottom);
      }
    }

    // Quote: at most two lines, the font shrinks until the text fits.
    const quote = String(p.quote || '').trim();
    if (quote) {
      let full = p.quoteOpen + quote + p.quoteClose;
      const author = String(p.author || '').trim();
      if (author) full += ' — ' + author;
      const f = font('serif', 400, 0.026 * H, true);
      let lines;
      for (;;) {
        lines = wrapText(full, f, 0.9 * W, p.wrapByChar);
        if (lines.length <= 2 || f.size < 4) break;
        f.size *= 0.92;
      }
      const lineHeight = 1.3 * f.size;
      let y = 0.925 * H - (lines.length - 1) * lineHeight / 2 + capHeight(f.size) / 2;
      for (const line of lines) {
        langText(line, W / 2, y, f, 'center');
        y += lineHeight;
      }
    }

    // Source URL, small, at the bottom-right corner.
    let link = null;
    if (p.sourceLabel) {
      const f = font('sans', 400, Math.max(5, 0.0125 * H));
      const right = 0.955 * W;
      const y = 0.978 * H;
      const w = measure(p.sourceLabel, f);
      link = { url: p.sourceUrl, x: right - w, y: y - f.size, w, h: 1.25 * f.size };
      text(p.sourceLabel, right, y, f, 'right', { opacity: 0.75, href: p.sourceUrl });
    }

    return { width: W, height: H, pageWidth: p.pageWidth, pageHeight: p.pageHeight, unit: p.unit,
      lineColor: p.lineColor, ops, link };
  }

  /* ---------- SVG ---------- */

  const n2 = (v) => String(Math.round(v * 100) / 100);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function svgAnchor(align, rtl) {
    if (align === 'center') return 'middle';
    // text-anchor follows the writing direction: "start" is the right edge in RTL.
    if (align === 'left') return rtl ? 'end' : 'start';
    return rtl ? 'start' : 'end';
  }

  /**
   * SVG document for a scene. With options.physicalSize the root element gets
   * the page size in inches/millimetres (for standalone files); otherwise it
   * scales to its container (preview).
   */
  function sceneToSVG(scene, options) {
    const o = options || {};
    const size = o.physicalSize
      ? ` width="${n2(scene.pageWidth)}${scene.unit}" height="${n2(scene.pageHeight)}${scene.unit}"`
      : '';
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg"${size} viewBox="0 0 ${n2(scene.width)} ${n2(scene.height)}"` +
      `${o.lang ? ` xml:lang="${esc(o.lang)}"` : ''}${o.className ? ` class="${esc(o.className)}"` : ''}>`);
    if (o.title) out.push(`<title>${esc(o.title)}</title>`);
    const color = esc(scene.lineColor);
    out.push(`<g fill="none" stroke="${color}" stroke-linecap="round">`);
    const strokes = [];
    const texts = [];
    let background = '';
    for (const op of scene.ops) {
      switch (op.t) {
        case 'rect':
          if (op.fill) background = `<rect x="0" y="0" width="${n2(op.w)}" height="${n2(op.h)}" fill="${esc(op.fill)}"/>`;
          else strokes.push(`<rect x="${n2(op.x)}" y="${n2(op.y)}" width="${n2(op.w)}" height="${n2(op.h)}" stroke-width="${op.width}"/>`);
          break;
        case 'line':
          strokes.push(`<line x1="${n2(op.x1)}" y1="${n2(op.y1)}" x2="${n2(op.x2)}" y2="${n2(op.y2)}" stroke-width="${op.width}"/>`);
          break;
        case 'circle':
          strokes.push(`<circle cx="${n2(op.cx)}" cy="${n2(op.cy)}" r="${n2(op.r)}" stroke-width="${op.width}"/>`);
          break;
        case 'arc': {
          const a0 = rad(op.start);
          const a1 = rad(op.start + op.sweep);
          const large = op.sweep > 180 ? 1 : 0;
          strokes.push(`<path d="M${n2(op.cx + op.r * Math.cos(a0))} ${n2(op.cy + op.r * Math.sin(a0))}` +
            `A${n2(op.r)} ${n2(op.r)} 0 ${large} 1 ${n2(op.cx + op.r * Math.cos(a1))} ${n2(op.cy + op.r * Math.sin(a1))}"` +
            ` stroke-width="${op.width}"/>`);
          break;
        }
        case 'text': {
          const f = op.font;
          let attrs = `x="${n2(op.x)}" y="${n2(op.y)}" font-size="${n2(f.size)}"`;
          attrs += ` font-family="${esc(FONT_STACKS[f.family])}"`;
          if ((f.weight || 400) !== 400) attrs += ` font-weight="${f.weight}"`;
          if (f.italic) attrs += ' font-style="italic"';
          const anchor = svgAnchor(op.align, op.rtl);
          if (anchor !== 'start') attrs += ` text-anchor="${anchor}"`;
          if (op.rtl) attrs += ' direction="rtl"';
          if (op.opacity !== undefined) attrs += ` fill-opacity="${op.opacity}"`;
          if (op.rot !== undefined) attrs += ` transform="translate(${n2(op.tx)} ${n2(op.ty)}) rotate(${n2(op.rot)})"`;
          let el = `<text ${attrs}>${esc(op.text)}</text>`;
          if (op.href) el = `<a href="${esc(op.href)}">${el}</a>`;
          texts.push(el);
          break;
        }
      }
    }
    out.push(strokes.join(''), '</g>');
    out.push(`<g fill="${color}" stroke="none">`, texts.join(''), '</g>');
    out.push('</svg>');
    // Background first, under everything.
    out.splice(o.title ? 2 : 1, 0, background);
    return out.join('');
  }

  /* ---------- Canvas / PNG ---------- */

  function drawScene(ctx, scene) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = scene.lineColor;
    for (const op of scene.ops) {
      switch (op.t) {
        case 'rect':
          if (op.fill) {
            ctx.fillStyle = op.fill;
            ctx.fillRect(op.x, op.y, op.w, op.h);
          } else {
            ctx.lineWidth = op.width;
            ctx.strokeRect(op.x, op.y, op.w, op.h);
          }
          break;
        case 'line':
          ctx.lineWidth = op.width;
          ctx.beginPath();
          ctx.moveTo(op.x1, op.y1);
          ctx.lineTo(op.x2, op.y2);
          ctx.stroke();
          break;
        case 'circle':
        case 'arc': {
          const start = op.t === 'circle' ? 0 : rad(op.start);
          const end = op.t === 'circle' ? 2 * Math.PI : rad(op.start + op.sweep);
          ctx.lineWidth = op.width;
          ctx.beginPath();
          ctx.arc(op.cx, op.cy, op.r, start, end);
          ctx.stroke();
          break;
        }
        case 'text':
          ctx.save();
          ctx.font = fontCss(op.font);
          ctx.fillStyle = scene.lineColor;
          ctx.textAlign = op.align;
          ctx.textBaseline = 'alphabetic';
          ctx.direction = op.rtl ? 'rtl' : 'ltr';
          if (op.opacity !== undefined) ctx.globalAlpha = op.opacity;
          if (op.rot !== undefined) {
            ctx.translate(op.tx, op.ty);
            ctx.rotate(rad(op.rot));
          }
          ctx.fillText(op.text, op.x, op.y);
          ctx.restore();
          break;
      }
    }
  }

  /**
   * Draws the scene on a new canvas at dpi pixels per inch. The resolution is
   * lowered when the canvas would be too large for the browser; the returned
   * dpi is the one actually used.
   */
  function sceneToCanvas(scene, dpi) {
    let scale = dpi / 72;
    const pixels = scene.width * scene.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(scene.width * scale));
    canvas.height = Math.max(1, Math.round(scene.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(canvas.width / scene.width, canvas.height / scene.height);
    drawScene(ctx, scene);
    return { canvas, dpi: scale * 72 };
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function pngChunk(type, data) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
  }

  const latin1 = (s) => Uint8Array.from(Array.from(s, (ch) => ch.charCodeAt(0) & 0xFF));

  /**
   * PNG Blob from a canvas, with a pHYs chunk (so it prints at the right
   * size) and tEXt chunks for the given key/value pairs (ASCII values).
   */
  async function canvasToPNG(canvas, dpi, textEntries) {
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
    const png = new Uint8Array(await blob.arrayBuffer());
    const ihdrEnd = 8 + 25;
    const phys = new Uint8Array(9);
    const ppm = Math.round(dpi / 0.0254);
    new DataView(phys.buffer).setUint32(0, ppm);
    new DataView(phys.buffer).setUint32(4, ppm);
    phys[8] = 1; // unit: metre
    const extra = [pngChunk('pHYs', phys)];
    for (const [key, value] of Object.entries(textEntries || {})) {
      if (value) extra.push(pngChunk('tEXt', latin1(`${key}\0${value}`)));
    }
    return new Blob([png.subarray(0, ihdrEnd), ...extra, png.subarray(ihdrEnd)], { type: 'image/png' });
  }

  Object.assign(HT, {
    PAGE_SIZES, FONT_STACKS, MAX_RINGS,
    toPoints, daysInMonth, buildScene, sceneToSVG, sceneToCanvas, canvasToPNG,
  });
})(window);
