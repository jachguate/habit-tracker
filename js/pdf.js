/* SPDX-License-Identifier: MIT — Copyright (c) 2026 Juan Antonio Castillo (jachguate). See LICENSE. */
/*
  Minimal PDF writer: a single page whose only content is the sheet image,
  scaled to the full page, plus a link annotation over the printed source URL.

  The image is stored losslessly (raw RGB, FlateDecode through the browser's
  CompressionStream); browsers without CompressionStream get a high-quality
  JPEG (DCTDecode) instead. Rendering the sheet as an image keeps the output
  identical to the preview in every script (Arabic, Devanagari, Chinese...)
  without embedding fonts.
*/
(function (global) {
  'use strict';
  const HT = global.HabitTracker = global.HabitTracker || {};

  const encoder = new TextEncoder();
  const num = (v) => String(Math.round(v * 1000) / 1000);

  /** PDF text string: literal when ASCII, UTF-16BE with BOM otherwise. */
  function pdfString(text) {
    if (/^[\x20-\x7E]*$/.test(text)) return '(' + text.replace(/[\\()]/g, '\\$&') + ')';
    let hex = 'FEFF';
    for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return '<' + hex + '>';
  }

  function pdfDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  }

  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** Image XObject data for the canvas: { dict, data }. */
  async function encodeImage(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    if (typeof CompressionStream === 'function') {
      const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      const data = await deflate(rgb);
      return { dict: `/Filter /FlateDecode /ColorSpace /DeviceRGB /BitsPerComponent 8`, data };
    }
    const blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', 0.95));
    const data = new Uint8Array(await blob.arrayBuffer());
    return { dict: `/Filter /DCTDecode /ColorSpace /DeviceRGB /BitsPerComponent 8`, data };
  }

  /**
   * PDF Blob with the canvas as the whole page.
   * options: { widthPt, heightPt, title, link: { url, x, y, w, h } (points,
   * top-left origin), creator }
   */
  async function makePDF(canvas, options) {
    const W = options.widthPt;
    const H = options.heightPt;
    const image = await encodeImage(canvas);
    const content = encoder.encode(`q ${num(W)} 0 0 ${num(H)} 0 0 cm /Im0 Do Q`);

    const objects = []; // each: array of parts (strings or Uint8Array)
    const add = (parts) => { objects.push(parts); return objects.length; };

    const catalog = add([]);
    const pages = add([]);
    const page = add([]);
    const img = add([`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      `${image.dict} /Length ${image.data.length} >>\nstream\n`, image.data, '\nendstream']);
    const contents = add([`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
    let annots = '';
    if (options.link && options.link.url) {
      const l = options.link;
      const annot = add([`<< /Type /Annot /Subtype /Link /Rect [${num(l.x)} ${num(H - l.y - l.h)} ` +
        `${num(l.x + l.w)} ${num(H - l.y)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(l.url)} >> >>`]);
      annots = ` /Annots [${annot} 0 R]`;
    }
    const info = add([`<< /Title ${pdfString(options.title || '')} /Creator ${pdfString(options.creator || '')}` +
      ` /Producer (habit-tracker github-page) /CreationDate (${pdfDate(new Date())}) >>`]);

    objects[catalog - 1] = [`<< /Type /Catalog /Pages ${pages} 0 R >>`];
    objects[pages - 1] = [`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`];
    objects[page - 1] = [`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${num(W)} ${num(H)}]` +
      ` /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${contents} 0 R${annots} >>`];

    const chunks = [];
    let offset = 0;
    const push = (part) => {
      const bytes = typeof part === 'string' ? encoder.encode(part) : part;
      chunks.push(bytes);
      offset += bytes.length;
    };
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // binary marker comment
    const offsets = [];
    objects.forEach((parts, i) => {
      offsets.push(offset);
      push(`${i + 1} 0 obj\n`);
      parts.forEach(push);
      push('\nendobj\n');
    });
    const xref = offset;
    let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) table += `${String(o).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  HT.makePDF = makePDF;
})(window);
