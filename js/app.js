/* SPDX-License-Identifier: MIT — Copyright (c) 2026 Juan Antonio Castillo (jachguate). See LICENSE. */
/*
  Page logic: form state, language, preview, download and share.

  Texts that have a per-language default (titles, labels, quote, author) are
  stored as null while the user keeps the default, so they follow language
  changes; once edited, the user's text is kept as is.
*/
(function () {
  'use strict';
  const HT = window.HabitTracker;
  const I18N = HT.i18n;

  const STORAGE_KEY = 'habitTracker.settings.v1';
  const TEXT_KEYS = ['title1', 'title2', 'habitsHeader', 'monthLabel', 'box1', 'box2', 'quote', 'author'];
  const MAX_LINES = 20;
  const DPIS = [150, 300, 600];
  const FORMATS = ['pdf', 'png', 'svg'];
  const MIME = { pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml' };
  // Regions that use US paper sizes.
  const LETTER_REGIONS = ['US', 'CA', 'MX', 'GT', 'SV', 'HN', 'NI', 'CR', 'PA', 'DO', 'PR', 'CO', 'VE', 'CL', 'PH', 'BZ'];

  const $ = (id) => document.getElementById(id);

  /* ---------- persistence ---------- */

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function persist() {
    const { year, month, ...rest } = state; // the month always starts at the current one
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch (e) { /* private mode or storage full: nothing to do */ }
  }

  const clampInt = (v, lo, hi, def) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Math.round(+v))) : def);
  const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

  function defaultPageSize() {
    const tag = navigator.language || '';
    const region = (tag.split('-')[1] || '').toUpperCase();
    if (region) return LETTER_REGIONS.includes(region) ? 'letter' : 'a4';
    return tag.toLowerCase().startsWith('en') ? 'letter' : 'a4';
  }

  const saved = load();
  const today = new Date();
  const state = {
    lang: I18N.languages[saved.lang] ? saved.lang : I18N.detect(),
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    lines: clampInt(saved.lines, 1, MAX_LINES, 8),
    name: typeof saved.name === 'string' ? saved.name : '',
    habits: Array.isArray(saved.habits) ? saved.habits.map((h) => String(h || '')) : [],
    texts: {},
    pageSize: HT.PAGE_SIZES[saved.pageSize] ? saved.pageSize : defaultPageSize(),
    orientation: saved.orientation === 'portrait' ? 'portrait' : 'landscape',
    sweep: clampInt(saved.sweep, 180, 270, 270),
    lineColor: isColor(saved.lineColor) ? saved.lineColor : '#000000',
    bgColor: isColor(saved.bgColor) ? saved.bgColor : '#ffffff',
    dpi: DPIS.includes(saved.dpi) ? saved.dpi : 300,
    format: FORMATS.includes(saved.format) ? saved.format : 'pdf',
  };
  for (const key of TEXT_KEYS) {
    const value = saved.texts && saved.texts[key];
    state.texts[key] = typeof value === 'string' ? value : null;
  }

  /* ---------- language helpers ---------- */

  const t = (key) => I18N.t(state.lang, key);
  const days = () => HT.daysInMonth(state.year, state.month);
  const numberFormat = () => new Intl.NumberFormat(state.lang, { useGrouping: false });
  const capitalize = (s) => (s ? s.charAt(0).toLocaleUpperCase(state.lang) + s.slice(1) : s);

  function monthName(month) {
    return capitalize(new Intl.DateTimeFormat(state.lang, { month: 'long' }).format(new Date(2000, month - 1, 1)));
  }

  /** Month and year as printed in the hub, e.g. "Agosto 2029" / "2029年8月". */
  function monthText() {
    if (state.lang === 'zh') {
      return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' })
        .format(new Date(state.year, state.month - 1, 1));
    }
    return `${monthName(state.month)} ${numberFormat().format(state.year)}`;
  }

  function defaultText(key) {
    let value = I18N.sheet(state.lang)[key];
    if (value && typeof value === 'object') {
      value = value[new Intl.PluralRules(state.lang).select(days())] || value.other;
    }
    return value || '';
  }

  const text = (key) => (state.texts[key] !== null ? state.texts[key] : defaultText(key));

  /* ---------- rendering ---------- */

  function buildParams() {
    const size = HT.PAGE_SIZES[state.pageSize];
    const landscape = state.orientation === 'landscape';
    const nf = numberFormat();
    const sheet = I18N.sheet(state.lang);
    return {
      pageWidth: landscape ? size.long : size.short,
      pageHeight: landscape ? size.short : size.long,
      unit: size.unit,
      userName: state.name,
      monthText: monthText(),
      days: days(),
      habitCount: state.lines,
      habits: state.habits.slice(0, state.lines),
      title1: text('title1'),
      title2: text('title2'),
      habitsHeader: text('habitsHeader'),
      monthLabel: text('monthLabel'),
      box1: text('box1'),
      box2: text('box2'),
      quote: text('quote'),
      author: text('author'),
      quoteOpen: sheet.quoteOpen,
      quoteClose: sheet.quoteClose,
      lineColor: state.lineColor,
      bgColor: state.bgColor,
      sweep: state.sweep,
      rtl: I18N.isRtl(state.lang),
      wrapByChar: state.lang === 'zh',
      formatNumber: (n) => nf.format(n),
      sourceUrl: HT.config.sourceUrl,
      sourceLabel: HT.config.sourceLabel,
    };
  }

  const docTitle = () => `${t('appTitle')} — ${monthText()}`;

  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      const scene = HT.buildScene(buildParams());
      $('preview').innerHTML = HT.sceneToSVG(scene, { title: docTitle(), lang: state.lang, className: 'sheet' });
      const paper = $('preview');
      paper.style.aspectRatio = `${scene.width} / ${scene.height}`;
      paper.classList.toggle('is-portrait', scene.height > scene.width);
      scheduleSharePrepare();
    });
  }

  function changed() {
    persist();
    render();
  }

  /* ---------- files ---------- */

  const pad2 = (n) => String(n).padStart(2, '0');
  const fileBase = () => `habit-tracker-${state.year}-${pad2(state.month)}`;

  async function makeFile(format) {
    const scene = HT.buildScene(buildParams());
    let blob;
    if (format === 'svg') {
      const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        HT.sceneToSVG(scene, { physicalSize: true, title: docTitle(), lang: state.lang });
      blob = new Blob([svg], { type: MIME.svg });
    } else {
      // Let the UI repaint ("Generating…") before the heavy work.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const { canvas, dpi } = HT.sceneToCanvas(scene, state.dpi);
      if (format === 'png') {
        blob = await HT.canvasToPNG(canvas, dpi, { Title: `Habit tracker ${state.year}-${pad2(state.month)}`, Source: HT.config.sourceUrl });
      } else {
        blob = await HT.makePDF(canvas, {
          widthPt: scene.width,
          heightPt: scene.height,
          title: docTitle(),
          creator: HT.config.sourceUrl,
          link: scene.link,
        });
      }
      canvas.width = canvas.height = 0; // release the memory early (Safari)
    }
    return new File([blob], `${fileBase()}.${format}`, { type: MIME[format] });
  }

  function saveFile(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  let statusTimer = 0;
  function setStatus(message, sticky) {
    const el = $('status');
    el.textContent = message || '';
    clearTimeout(statusTimer);
    if (message && !sticky) statusTimer = setTimeout(() => { el.textContent = ''; }, 6000);
  }

  function setBusy(busy) {
    for (const id of ['btnDownload', 'btnShare']) $(id).disabled = busy;
    document.body.classList.toggle('busy', busy);
    if (busy) setStatus(t('generating'), true);
  }

  async function onDownload() {
    setBusy(true);
    try {
      saveFile(await makeFile(state.format));
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus(t('error'));
    } finally {
      setBusy(false);
    }
  }

  /* ---------- share (mobile) ---------- */

  function canShareType(type, ext) {
    try {
      return !!(navigator.share && navigator.canShare &&
        navigator.canShare({ files: [new File(['x'], `test.${ext}`, { type })] }));
    } catch (e) {
      return false;
    }
  }

  const shareTypes = FORMATS.filter((f) => canShareType(MIME[f], f));
  const shareFormat = () => (shareTypes.includes(state.format) ? state.format : shareTypes.includes('png') ? 'png' : shareTypes[0]);

  // Browsers only allow navigator.share() shortly after a tap, and the PDF
  // takes a moment to build, so the file is prepared in advance.
  let shareCache = { key: '', file: null };
  let sharePrepareTimer = 0;
  const shareKey = () => JSON.stringify([buildParams(), state.dpi, shareFormat()]);

  function scheduleSharePrepare() {
    if (!shareTypes.length) return;
    clearTimeout(sharePrepareTimer);
    sharePrepareTimer = setTimeout(async () => {
      const key = shareKey();
      if (shareCache.key === key || document.hidden) return;
      try {
        const file = await makeFile(shareFormat());
        if (shareKey() === key) shareCache = { key, file };
      } catch (e) { /* made again on demand */ }
    }, 1500);
  }

  async function onShare() {
    const key = shareKey();
    let file = shareCache.key === key ? shareCache.file : null;
    if (!file) {
      setBusy(true);
      try {
        file = await makeFile(shareFormat());
        shareCache = { key, file };
      } catch (e) {
        console.error(e);
        setStatus(t('error'));
        return;
      } finally {
        setBusy(false);
      }
    }
    try {
      await navigator.share({ files: [file], title: docTitle(), text: HT.config.sourceUrl });
      setStatus('');
    } catch (e) {
      if (e.name === 'NotAllowedError') setStatus(t('shareRetry'), true);
      else if (e.name !== 'AbortError') setStatus(t('error'));
    }
  }

  /* ---------- UI ---------- */

  function fillLanguageSelect() {
    const select = $('lang');
    for (const [code, lang] of Object.entries(I18N.languages)) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = lang.name;
      option.lang = code;
      select.appendChild(option);
    }
  }

  function fillMonthSelect() {
    const select = $('month');
    select.textContent = '';
    for (let m = 1; m <= 12; m++) {
      const option = document.createElement('option');
      option.value = m;
      option.textContent = monthName(m);
      select.appendChild(option);
    }
    select.value = state.month;
  }

  function fillPageSizeSelect() {
    const select = $('pageSize');
    select.textContent = '';
    const names = { letter: t('paperLetter'), legal: t('paperLegal'), tabloid: t('paperTabloid') };
    const nf = new Intl.NumberFormat(state.lang, { maximumFractionDigits: 1 });
    for (const [key, size] of Object.entries(HT.PAGE_SIZES)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = `${names[key] || key.toUpperCase()} (${nf.format(size.short)} × ${nf.format(size.long)} ${size.unit})`;
      select.appendChild(option);
    }
    select.value = state.pageSize;
  }

  function renderHabitInputs() {
    const list = $('habitList');
    const inputs = list.querySelectorAll('input');
    // Add or remove rows, keeping the ones already there (and their focus).
    for (let i = inputs.length; i < state.lines; i++) {
      const li = document.createElement('li');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 60;
      input.dataset.index = i;
      input.value = state.habits[i] || '';
      input.addEventListener('input', () => {
        state.habits[i] = input.value;
        changed();
      });
      li.appendChild(input);
      list.appendChild(li);
    }
    while (list.children.length > state.lines) list.lastElementChild.remove();
    list.querySelectorAll('input').forEach((input, i) => {
      input.placeholder = t('habitPlaceholder').replace('{n}', i + 1);
      input.setAttribute('aria-label', input.placeholder);
    });
  }

  function syncTextInputs() {
    for (const input of document.querySelectorAll('[data-text]')) {
      if (document.activeElement !== input) input.value = text(input.dataset.text);
    }
    if (document.activeElement !== $('quote')) $('quote').value = text('quote');
  }

  function applyLanguage() {
    const root = document.documentElement;
    root.lang = state.lang;
    root.dir = I18N.isRtl(state.lang) ? 'rtl' : 'ltr';
    document.title = t('appTitle');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
    $('lang').value = state.lang;
    fillMonthSelect();
    fillPageSizeSelect();
    renderHabitInputs();
    syncTextInputs();
    updateSweepOutput();
    setStatus('');
  }

  function updateSweepOutput() {
    $('sweepOut').value = `${new Intl.NumberFormat(state.lang).format(state.sweep)}°`;
  }

  function setLines(value) {
    state.lines = clampInt(value, 1, MAX_LINES, state.lines);
    $('lines').value = state.lines;
    $('lines2').value = state.lines;
    renderHabitInputs();
    changed();
  }

  function bindTextInput(input, key) {
    input.addEventListener('input', () => {
      state.texts[key] = input.value === defaultText(key) ? null : input.value;
      changed();
    });
    // Back to the default text when the field is left equal to it.
    input.addEventListener('change', () => { input.value = text(key); });
  }

  function selectTab(tab) {
    for (const other of document.querySelectorAll('[role="tab"]')) {
      const selected = other === tab;
      other.setAttribute('aria-selected', selected);
      other.tabIndex = selected ? 0 : -1;
      $(other.getAttribute('aria-controls')).hidden = !selected;
    }
  }

  function initDialog() {
    const dialog = $('settingsDialog');
    $('btnSettings').addEventListener('click', () => {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    });
    for (const btn of dialog.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => (dialog.close ? dialog.close() : dialog.removeAttribute('open')));
    }
    // Click on the backdrop closes the dialog.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    const tabs = Array.from(dialog.querySelectorAll('[role="tab"]'));
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => selectTab(tab));
      tab.addEventListener('keydown', (e) => {
        const rtl = document.documentElement.dir === 'rtl';
        const delta = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
        if (!delta) return;
        const next = tabs[(i + delta + tabs.length) % tabs.length];
        selectTab(next);
        next.focus();
      });
    });
  }

  function init() {
    fillLanguageSelect();
    initDialog();

    $('lang').addEventListener('change', (e) => {
      state.lang = e.target.value;
      applyLanguage();
      changed();
    });

    $('month').addEventListener('change', (e) => {
      state.month = +e.target.value;
      syncTextInputs(); // title plural may depend on the number of days
      render();
    });
    const year = $('year');
    year.value = state.year;
    year.addEventListener('input', () => {
      const value = parseInt(year.value, 10);
      if (value >= 1900 && value <= 2999) {
        state.year = value;
        syncTextInputs();
        render();
      }
    });
    year.addEventListener('change', () => { year.value = state.year; });

    for (const id of ['lines', 'lines2']) {
      const input = $(id);
      input.value = state.lines;
      input.addEventListener('input', () => {
        if (input.value !== '') setLines(input.value);
      });
      input.addEventListener('change', () => setLines(input.value));
    }
    for (const btn of document.querySelectorAll('.step')) {
      btn.addEventListener('click', () => setLines(state.lines + Number(btn.dataset.step)));
    }

    const name = $('name');
    name.value = state.name;
    name.addEventListener('input', () => {
      state.name = name.value;
      changed();
    });

    bindTextInput($('quote'), 'quote');
    for (const input of document.querySelectorAll('[data-text]')) bindTextInput(input, input.dataset.text);
    $('btnResetTexts').addEventListener('click', () => {
      for (const key of TEXT_KEYS) if (key !== 'quote') state.texts[key] = null;
      syncTextInputs();
      changed();
    });

    $('pageSize').addEventListener('change', (e) => {
      state.pageSize = e.target.value;
      changed();
    });
    for (const radio of document.querySelectorAll('input[name="orientation"]')) {
      radio.checked = radio.value === state.orientation;
      radio.addEventListener('change', () => {
        state.orientation = radio.value;
        changed();
      });
    }
    const sweep = $('sweep');
    sweep.value = state.sweep;
    sweep.addEventListener('input', () => {
      state.sweep = +sweep.value;
      updateSweepOutput();
      changed();
    });
    for (const key of ['lineColor', 'bgColor']) {
      const input = $(key);
      input.value = state[key];
      input.addEventListener('input', () => {
        state[key] = input.value;
        changed();
      });
    }
    const dpi = $('dpi');
    dpi.value = state.dpi;
    dpi.addEventListener('change', () => {
      state.dpi = +dpi.value;
      changed();
    });

    const format = $('format');
    format.value = state.format;
    format.addEventListener('change', () => {
      state.format = format.value;
      changed();
    });
    $('btnDownload').addEventListener('click', onDownload);
    if (shareTypes.length) {
      $('btnShare').hidden = false;
      $('btnShare').addEventListener('click', onShare);
    }

    const source = $('sourceLink');
    source.href = HT.config.sourceUrl;

    applyLanguage();
    render();
  }

  init();
})();
