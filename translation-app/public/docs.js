/* VoiceCast Documents v3 */
(function () {
  'use strict';
  var root = document.getElementById('view-documents');
  if (!root || root.getAttribute('data-dx')) return;
  root.setAttribute('data-dx', '1');

  var MAX_BYTES = 15 * 1024 * 1024;
  var MAX_CHARS = 60000;
  var BATCH_STRINGS = 100;
  var BATCH_CHARS = 8000;
  var SEG_MAX = 4500;
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var NS_XML = 'http://www.w3.org/XML/1998/namespace';

  var LANGS = window.VC.docList;
  var NAME = window.VC.names;
  var KIND = {
    docx: { label: 'Word document', color: '#2B6CE6' },
    pptx: { label: 'PowerPoint', color: '#E4572E' },
    pdf: { label: 'PDF', color: '#D93B3B' },
    txt: { label: 'Text file', color: '#6B7A90' },
    srt: { label: 'Subtitles', color: '#8B6BFF' }
  };
  var SAMPLE = 'Welcome to VoiceCast.\n\nVoiceCast translates speech, text and documents. This short file shows how document translation works.\n\nUpload your own Word, PowerPoint, PDF, text or subtitle file to see the translation next to the original.';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function baseName(n) { return String(n || 'document').replace(/\.[^.]+$/, '') || 'document'; }
  function readSettings() { try { return JSON.parse(localStorage.getItem('voicecast_settings') || '{}'); } catch (e) { return {}; } }
  function toast(msg, type) { if (typeof window.vcToast === 'function') window.vcToast(msg, { type: type || '' }); }
  function ico(p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; }
  var I = {
    up: ico('<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
    x: ico('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    dl: ico('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>'),
    print: ico('<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><rect x="7" y="14" width="10" height="7"/>'),
    copy: ico('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    mark: ico('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),
    go: ico('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>')
  };
  function btn(label, cls, fn, icon) {
    var b = el('button', cls);
    b.type = 'button';
    if (icon) { b.innerHTML = icon; b.appendChild(el('span', '', label)); } else { b.textContent = label; }
    b.addEventListener('click', function (e) { fn(e, b); });
    return b;
  }
  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }
  function hasOpt(sel, v) { for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === v) return true; } return false; }
  function vis(it) { return !it.hidden; }
  function saveBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }
  function copyText(text, done) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove(); done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  var PRINT_CSS = '@page{size:A4;margin:20mm}html{-webkit-print-color-adjust:exact}body{font:12pt/1.7 Georgia,"Times New Roman",serif;color:#111;text-align:justify;margin:0}h1{font-size:20pt;line-height:1.3;margin:18pt 0 8pt;text-align:left;page-break-after:avoid}h2{font-size:15pt;line-height:1.3;margin:14pt 0 6pt;text-align:left;page-break-after:avoid}p{margin:0 0 9pt;orphans:3;widows:3}ul{margin:0 0 9pt;padding-left:20pt}li{margin:0 0 4pt}';

  var style = document.createElement('style');
  style.textContent = `
  #view-documents .dx-wrap { max-width: 1180px; }
  .dx-head h2 { margin: 0; font-size: 19px; }
  .dx-head p { margin: 4px 0 18px; font-size: 13.5px; color: var(--ink-soft); max-width: 640px; }
  .dx-bar { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
  .dx-sel { display: flex; flex-direction: column; gap: 5px; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
  .dx-sel select { min-width: 220px; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 14px; font-weight: 600; letter-spacing: normal; text-transform: none; }
  .dx-sel select:disabled { opacity: .55; }
  .dx-arrow { padding-bottom: 12px; color: var(--ink-soft); }
  .dx-drop { border: 1.5px dashed rgba(46,107,255,.40); border-radius: 20px; padding: clamp(40px, 9vh, 84px) 24px; text-align: center; cursor: pointer; background: var(--tint); transition: background .15s, border-color .15s; }
  .dx-drop:hover, .dx-over .dx-drop { background: rgba(46,107,255,.13); border-color: var(--blue); }
  .dx-up { width: 56px; height: 56px; border-radius: 16px; background: var(--surface); color: var(--blue); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 8px 20px -12px rgba(46,107,255,.6); }
  .dx-up svg { width: 26px; height: 26px; }
  .dx-drop h3 { margin: 0 0 6px; font-size: 18px; }
  .dx-drop p { margin: 0; font-size: 13px; color: var(--ink-soft); }
  .dx-chips { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 18px 0 10px; }
  .dx-chips span { padding: 5px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-size: 12px; font-weight: 600; color: var(--ink-soft); }
  .dx-linkbtn { background: none; border: none; color: var(--blue); font-size: 13px; font-weight: 600; cursor: pointer; margin-top: 12px; padding: 4px 6px; }
  .dx-linkbtn:hover { text-decoration: underline; }
  .dx-err { margin-top: 14px; padding: 10px 14px; border-radius: 10px; background: rgba(229,72,77,.10); color: #E5484D; font-size: 13px; line-height: 1.5; }
  .dx-card { display: flex; align-items: center; gap: 16px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); }
  .dx-badge { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 12px; color: #fff; font: 700 11px 'IBM Plex Mono', monospace; letter-spacing: .04em; display: flex; align-items: center; justify-content: center; }
  .dx-info { flex: 1; min-width: 0; }
  .dx-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dx-meta { font-size: 12.5px; color: var(--ink-soft); margin-top: 3px; }
  .dx-x { flex: 0 0 auto; width: 36px; height: 36px; border: none; background: none; border-radius: 10px; color: var(--ink-soft); cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .dx-x svg { width: 18px; height: 18px; }
  .dx-x:hover { background: var(--tint); color: var(--ink); }
  .dx-note { margin: 14px 2px 0; font-size: 13px; color: var(--ink-soft); line-height: 1.55; }
  .dx-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
  .dx-btn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border-radius: 11px; border: none; background: linear-gradient(135deg, #2E6BFF, #22D3EE); color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 10px 22px -12px rgba(46,107,255,.8); transition: transform .15s; }
  .dx-btn:hover:not(:disabled) { transform: translateY(-1px); }
  .dx-btn:disabled { opacity: .5; cursor: not-allowed; }
  .dx-btn svg { width: 17px; height: 17px; }
  .dx-btn.ghost { background: var(--surface); color: var(--ink); border: 1px solid var(--line); box-shadow: none; font-weight: 600; }
  .dx-btn.ghost:hover:not(:disabled) { background: var(--tint); color: var(--blue); }
  .dx-btn.saved { color: #E6A700; }
  .dx-btn.saved svg { fill: currentColor; }
  .dx-spin { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; border: 2.5px solid rgba(46,107,255,.25); border-top-color: var(--blue); animation: dxSpin .8s linear infinite; }
  @keyframes dxSpin { to { transform: rotate(360deg); } }
  :root[data-motion="reduced"] .dx-spin { animation: none; }
  .dx-prog { margin-top: 18px; }
  .dx-track { height: 8px; border-radius: 999px; background: var(--tint); overflow: hidden; }
  .dx-fill { height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #2E6BFF, #22D3EE); transition: width .35s ease; }
  .dx-prog-text { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 13px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
  .dx-rhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .dx-rtitle { font-size: 16px; font-weight: 700; overflow-wrap: anywhere; }
  .dx-rsub { font-size: 12.5px; color: var(--ink-soft); margin-top: 4px; line-height: 1.5; }
  .dx-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--surface); flex: 0 0 auto; }
  .dx-seg button { border: none; background: none; padding: 8px 14px; font-size: 12.5px; font-weight: 600; color: var(--ink-soft); cursor: pointer; }
  .dx-seg button.active { background: var(--blue); color: #fff; }
  .dx-rows { border: 1px solid var(--line); border-radius: 16px; background: var(--surface); max-height: calc(100vh - 380px); min-height: 280px; overflow: auto; }
  .dx-cols, .dx-row { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; padding: 14px 22px; }
  .dx-cols { position: sticky; top: 0; z-index: 2; background: var(--surface); border-bottom: 1px solid var(--line); padding-top: 11px; padding-bottom: 11px; font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--ink-soft); }
  .dx-row { border-bottom: 1px solid var(--line); }
  .dx-row:last-child { border-bottom: none; }
  .dx-row:hover { background: var(--tint); }
  .dx-row.slide { background: var(--tint); padding-top: 10px; padding-bottom: 10px; }
  .dx-cell { min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 14.5px; line-height: 1.65; }
  .dx-cell.o { color: var(--ink-soft); }
  .dx-rows.v-tr .dx-cols, .dx-rows.v-tr .dx-row, .dx-rows.v-or .dx-cols, .dx-rows.v-or .dx-row { grid-template-columns: 1fr; }
  .dx-rows.v-tr .o, .dx-rows.v-or .t { display: none; }
  .dx-h1 { font-size: 19px; font-weight: 700; line-height: 1.35; }
  .dx-h2 { font-size: 16px; font-weight: 700; line-height: 1.4; }
  .dx-li { position: relative; padding-left: 18px; }
  .dx-li::before { content: '\u2022'; position: absolute; left: 3px; color: var(--blue); }
  .dx-slide { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--blue); }
  .dx-time { font: 500 11px 'IBM Plex Mono', monospace; color: var(--ink-soft); margin-bottom: 3px; }
  .dx-recent { margin-top: 30px; }
  .dx-recent-head { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-soft); margin-bottom: 4px; }
  .dx-rrow { display: flex; align-items: center; gap: 14px; padding: 11px 8px; margin: 0 -8px; border-bottom: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
  .dx-rrow:hover { background: var(--tint); }
  .dx-rname { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dx-rmeta { flex: 0 0 auto; font-size: 12px; color: var(--ink-soft); }
  .dxp { background: #fff; color: #111; width: 100%; font-family: Georgia, 'Times New Roman', serif; font-size: 13.5px; line-height: 1.75; text-align: justify; text-justify: inter-word; overflow-wrap: break-word; }
  .dxp[lang^="ja"], .dxp[lang^="zh"] { text-justify: inter-character; line-break: strict; }
  .dxp h1 { font-size: 22px; line-height: 1.3; margin: 18px 0 10px; text-align: left; }
  .dxp h2 { font-size: 17px; line-height: 1.3; margin: 14px 0 8px; text-align: left; }
  .dxp p { margin: 0 0 11px; }
  .dxp ul { margin: 0 0 11px; padding-left: 22px; }
  .dxp li { margin: 0 0 5px; }
  @media (max-width: 760px) {
    .dx-cols { display: none; }
    .dx-row { grid-template-columns: 1fr; gap: 6px; padding: 14px 16px; }
    .dx-rows.v-tr .dx-row, .dx-rows.v-or .dx-row { grid-template-columns: 1fr; }
    .dx-sel select { min-width: 0; width: 100%; }
    .dx-sel { flex: 1 1 100%; }
    .dx-arrow { display: none; }
    .dx-rows { max-height: none; }
  }`;
  document.head.appendChild(style);

  root.innerHTML =
    '<div class="dx-wrap">' +
      '<div class="dx-head"><h2>Document Translation</h2><p>Upload a Word, PowerPoint, PDF, text or subtitle file. Word and PowerPoint files keep their formatting.</p></div>' +
      '<div class="dx-bar">' +
        '<label class="dx-sel"><span>From</span><select id="dxSrc"></select></label>' +
        '<span class="dx-arrow" aria-hidden="true">\u2192</span>' +
        '<label class="dx-sel"><span>To</span><select id="dxTgt"></select></label>' +
        '<label class="dx-keep"><span>Keep a copy in History</span><span class="switch"><input type="checkbox" id="dxKeep"><span class="knob"></span></span></label>' +
      '</div>' +
      '<div id="dxStage"></div>' +
      '<div class="dx-recent" id="dxRecent" hidden><div class="dx-recent-head">Recent documents</div><div id="dxRecentList"></div></div>' +
    '</div>';

  var S = { state: 'empty', doc: null, error: '', progress: { done: 0, total: 0, part: 0, parts: 0, label: '' }, result: null, view: 'both', cancel: false, ctl: null, sessionId: null };
  var stage, selSrc, selTgt, fileInput;

  /* ---------- reading files ---------- */
  async function readText(file) {
    var buf = await file.arrayBuffer();
    var b = new Uint8Array(buf);
    var enc = (b[0] === 0xFF && b[1] === 0xFE) ? 'utf-16le' : ((b[0] === 0xFE && b[1] === 0xFF) ? 'utf-16be' : 'utf-8');
    var s = new TextDecoder(enc).decode(buf);
    if (enc === 'utf-8' && (s.match(/\uFFFD/g) || []).length > 2) s = new TextDecoder('windows-1252').decode(buf);
    return s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  }

  async function extractTxt(file) {
    var raw = await readText(file);
    var items = [];
    raw.split(/\n\s*\n/).forEach(function (chunk) {
      var t = chunk.replace(/^\n+/, '').replace(/\s+$/, '');
      if (t.trim()) items.push({ type: 'p', text: t.trim() });
    });
    return { items: items, meta: items.length + (items.length === 1 ? ' paragraph' : ' paragraphs') };
  }

  async function extractSrt(file) {
    var raw = (await readText(file)).trim();
    var items = [];
    raw.split(/\n{2,}/).forEach(function (blk) {
      var lines = blk.split('\n');
      var i = 0;
      if (/^\d+$/.test(lines[0].trim()) && lines[1] && lines[1].indexOf('-->') !== -1) i = 1;
      if (lines[i] && lines[i].indexOf('-->') !== -1) {
        var text = lines.slice(i + 1).join('\n').replace(/<\/?[a-z][^>]*>/gi, '').trim();
        if (text) items.push({ type: 'cue', text: text, meta: { time: lines[i].trim() } });
      }
    });
    if (!items.length) throw new Error('No subtitles were found. Check that this is a valid .srt file.');
    return { items: items, meta: items.length + ' subtitles' };
  }

  function nearest(n, ns, local) {
    var x = n.parentNode;
    while (x && !(x.localName === local && x.namespaceURI === ns)) x = x.parentNode;
    return x;
  }

  function docxType(p) {
    var ppr = null;
    for (var c = p.firstChild; c; c = c.nextSibling) { if (c.localName === 'pPr' && c.namespaceURI === NS_W) { ppr = c; break; } }
    if (!ppr) return 'p';
    var st = ppr.getElementsByTagNameNS(NS_W, 'pStyle')[0];
    var val = st ? (st.getAttributeNS(NS_W, 'val') || st.getAttribute('w:val') || '') : '';
    if (/^(title|heading ?1)$/i.test(val)) return 'h1';
    if (/^(subtitle|heading ?[2-9])$/i.test(val)) return 'h2';
    if (ppr.getElementsByTagNameNS(NS_W, 'numPr').length || /^listparagraph$/i.test(val)) return 'li';
    return 'p';
  }

  async function loadZip(file, badMsg) {
    if (typeof JSZip === 'undefined') throw new Error('Document tools did not load. Check your connection and refresh the page.');
    try { return await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (e) { throw new Error(badMsg); }
  }

  async function extractDocx(file) {
    var zip = await loadZip(file, 'This file could not be opened. It may be damaged, or it is not a real .docx file.');
    var names = Object.keys(zip.files).filter(function (n) { return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n); });
    if (names.indexOf('word/document.xml') === -1) throw new Error('This does not look like a Word document.');
    names.sort(function (a, b) { return a === 'word/document.xml' ? -1 : (b === 'word/document.xml' ? 1 : (a < b ? -1 : 1)); });
    var parts = [], items = [], body = 0;
    for (var n = 0; n < names.length; n++) {
      var xml = new DOMParser().parseFromString(await zip.file(names[n]).async('string'), 'application/xml');
      if (xml.getElementsByTagName('parsererror').length) {
        if (names[n] === 'word/document.xml') throw new Error('The text of this document could not be read.');
        continue;
      }
      parts.push({ name: names[n], xml: xml });
      var isBody = names[n] === 'word/document.xml';
      var ps = xml.getElementsByTagNameNS(NS_W, 'p');
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i], ts = [], all = p.getElementsByTagNameNS(NS_W, 't');
        for (var k = 0; k < all.length; k++) { if (nearest(all[k], NS_W, 'p') === p) ts.push(all[k]); }
        if (!ts.length) continue;
        var text = ts.map(function (t) { return t.textContent; }).join('');
        if (!/\S/.test(text)) continue;
        items.push({ type: isBody ? docxType(p) : 'p', text: text, ts: ts, orig: ts.map(function (t) { return t.textContent; }), hidden: !isBody });
        if (isBody) body++;
      }
    }
    return { items: items, zip: zip, parts: parts, meta: body + (body === 1 ? ' paragraph' : ' paragraphs') };
  }

  async function pptxSlidePaths(zip) {
    var paths = [];
    try {
      var pres = new DOMParser().parseFromString(await zip.file('ppt/presentation.xml').async('string'), 'application/xml');
      var rels = new DOMParser().parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('string'), 'application/xml');
      var map = {}, rl = rels.getElementsByTagName('Relationship');
      for (var i = 0; i < rl.length; i++) map[rl[i].getAttribute('Id')] = rl[i].getAttribute('Target');
      var ids = pres.getElementsByTagNameNS(NS_P, 'sldId');
      for (var j = 0; j < ids.length; j++) {
        var t = map[ids[j].getAttributeNS(NS_R, 'id')];
        if (!t) continue;
        t = t.charAt(0) === '/' ? t.slice(1) : 'ppt/' + t;
        if (zip.file(t)) paths.push(t);
      }
    } catch (e) { paths = []; }
    if (!paths.length) {
      paths = Object.keys(zip.files).filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
        .sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); });
    }
    return paths;
  }

  async function extractPptx(file) {
    var zip = await loadZip(file, 'This file could not be opened. It may be damaged, or it is not a real .pptx file.');
    var paths = await pptxSlidePaths(zip);
    if (!paths.length) throw new Error('No slides were found in this file.');
    var parts = [], items = [], slides = 0;
    for (var s = 0; s < paths.length; s++) {
      var xml = new DOMParser().parseFromString(await zip.file(paths[s]).async('string'), 'application/xml');
      if (xml.getElementsByTagName('parsererror').length) continue;
      parts.push({ name: paths[s], xml: xml });
      slides++;
      var marker = { type: 'slide', text: 'Slide ' + slides, skip: true };
      items.push(marker);
      var added = 0, ps = xml.getElementsByTagNameNS(NS_A, 'p');
      for (var i = 0; i < ps.length; i++) {
        var ts = [];
        for (var c = ps[i].firstChild; c; c = c.nextSibling) {
          if (c.localName === 'r' && c.namespaceURI === NS_A) {
            for (var d = c.firstChild; d; d = d.nextSibling) { if (d.localName === 't' && d.namespaceURI === NS_A) ts.push(d); }
          }
        }
        if (!ts.length) continue;
        var text = ts.map(function (t) { return t.textContent; }).join('');
        if (!/\S/.test(text)) continue;
        items.push({ type: 'p', text: text, ts: ts, orig: ts.map(function (t) { return t.textContent; }) });
        added++;
      }
      if (!added) items.pop();
    }
    return { items: items, zip: zip, parts: parts, meta: slides + (slides === 1 ? ' slide' : ' slides') };
  }

  /* ---------- PDF structure ---------- */
  var SENT_END = /[.!?\u2026:;\u3002\uff01\uff1f\u201d"')\]]$/;
  var CJK_END = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]$/;
  var CJK_START = /^[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;

  function joinText(a, b) {
    if (/-$/.test(a) && /^[a-z\u00e0-\u00ff]/.test(b)) return a.slice(0, -1) + b;
    if (CJK_END.test(a) && CJK_START.test(b)) return a + b;
    return a + ' ' + b;
  }

  function pdfLines(items) {
    var words = [];
    items.forEach(function (it) {
      if (typeof it.str !== 'string' || !it.str.trim()) return;
      var tr = it.transform || [10, 0, 0, 10, 0, 0];
      var size = Math.hypot(tr[0], tr[1]) || Math.abs(tr[3]) || 10;
      words.push({ s: it.str, x: tr[4], y: tr[5], w: it.width || 0, size: size });
    });
    var lines = [];
    words.forEach(function (w) {
      var tol = Math.max(2, w.size * 0.45), ln = null;
      for (var i = 0; i < lines.length; i++) { if (Math.abs(lines[i].y - w.y) <= tol) { ln = lines[i]; break; } }
      if (!ln) { ln = { y: w.y, words: [] }; lines.push(ln); }
      ln.words.push(w);
    });
    return lines.map(function (ln) {
      ln.words.sort(function (a, b) { return a.x - b.x; });
      var text = '', prev = null, sizeChars = {}, x0 = ln.words[0].x, x1 = x0;
      ln.words.forEach(function (w) {
        if (prev) {
          var gap = w.x - (prev.x + prev.w);
          if (gap > Math.min(w.size, prev.size) * 0.18 && !/\s$/.test(text) && !/^\s/.test(w.s)) text += ' ';
        }
        text += w.s;
        var key = Math.round(w.size * 2) / 2;
        sizeChars[key] = (sizeChars[key] || 0) + w.s.length;
        x1 = Math.max(x1, w.x + w.w);
        prev = w;
      });
      var best = 0, bestKey = 10;
      Object.keys(sizeChars).forEach(function (k) { if (sizeChars[k] > best) { best = sizeChars[k]; bestKey = parseFloat(k); } });
      var clean = text.replace(/\s+/g, ' ').trim();
      return { y: ln.y, x0: x0, x1: x1, text: clean, size: bestKey, chars: clean.length };
    }).filter(function (l) { return l.text; }).sort(function (a, b) { return b.y - a.y; });
  }

  function dropRepeated(pages) {
    var counts = Object.create(null);
    function key(t) { return t.replace(/\d+/g, '#').toLowerCase(); }
    function edge(p, l) { return l.y > p.h * 0.92 || l.y < p.h * 0.08; }
    pages.forEach(function (p) {
      var seen = Object.create(null);
      p.lines.forEach(function (l) {
        if (!edge(p, l)) return;
        var k = key(l.text);
        if (!seen[k]) { seen[k] = 1; counts[k] = (counts[k] || 0) + 1; }
      });
    });
    var need = Math.max(3, Math.ceil(pages.length * 0.5));
    pages.forEach(function (p) {
      p.lines = p.lines.filter(function (l) {
        if (!edge(p, l)) return true;
        if (/^\s*(page\s*)?\d+(\s*(of|\/)\s*\d+)?\s*$/i.test(l.text)) return false;
        return !(pages.length >= 3 && counts[key(l.text)] >= need);
      });
    });
  }

  function bodySize(pages) {
    var m = {};
    pages.forEach(function (p) { p.lines.forEach(function (l) { var k = Math.round(l.size * 2) / 2; m[k] = (m[k] || 0) + l.chars; }); });
    var best = 0, size = 11;
    Object.keys(m).forEach(function (k) { if (m[k] > best) { best = m[k]; size = parseFloat(k); } });
    return size;
  }

  function pdfBlocks(pages, body) {
    var items = [];
    pages.forEach(function (p) {
      var maxW = 0;
      p.lines.forEach(function (l) { maxW = Math.max(maxW, l.x1 - l.x0); });
      var cur = null, prevLine = null;
      p.lines.forEach(function (l) {
        var type = l.size >= body * 1.6 ? 'h1' : (l.size >= body * 1.22 ? 'h2' : 'p');
        var text = l.text, isBullet = false;
        var bm = /^[\u2022\u00b7\u25aa\u25cf\u25e6\u2023\u2043\-\u2013\u2014*]\s+/.exec(text);
        if (bm && type === 'p') { isBullet = true; text = text.slice(bm[0].length); type = 'li'; }
        var numbered = type === 'p' && /^\d{1,3}[.)]\s+/.test(text);
        var gap = prevLine ? prevLine.y - l.y : 0;
        var lh = l.size * 1.3, cont = false;
        if (cur && !isBullet && !numbered && gap <= lh * 1.55) {
          if (cur.type === type && type !== 'li') {
            cont = !(type === 'p' && (prevLine.x1 - prevLine.x0) < maxW * 0.6 && SENT_END.test(cur.text));
          } else if (cur.type === 'li' && type === 'p' && l.x0 > cur.x0 + 4) {
            cont = true;
          }
        }
        if (cont) { cur.text = joinText(cur.text, text); }
        else { cur = { type: type, text: text, page: p.n, x0: l.x0 }; items.push(cur); }
        prevLine = l;
      });
    });
    var out = [];
    items.forEach(function (it) {
      var prev = out[out.length - 1];
      if (prev && prev.page !== it.page && prev.type === 'p' && it.type === 'p' && !SENT_END.test(prev.text) && /^[a-z\u00e0-\u00ff]/.test(it.text)) {
        prev.text = joinText(prev.text, it.text);
      } else {
        out.push({ type: it.type, text: it.text, page: it.page });
      }
    });
    return out;
  }

  async function extractPdf(file) {
    if (typeof pdfjsLib === 'undefined') throw new Error('The PDF reader did not load. Check your connection and refresh the page.');
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {}
    var pdf;
    try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('This PDF is password protected. Remove the password and try again.');
      throw new Error('This PDF could not be read. It may be damaged.');
    }
    var pages = [], total = 0;
    for (var pn = 1; pn <= pdf.numPages; pn++) {
      var page = await pdf.getPage(pn);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      var lines = pdfLines(tc.items);
      lines.forEach(function (l) { total += l.text.length; });
      pages.push({ n: pn, h: vp.height, lines: lines });
      if (pn % 5 === 0) await sleep(0);
    }
    if (total < Math.max(20, pdf.numPages * 25)) throw new Error('No selectable text was found. This looks like a scanned PDF, which needs OCR and is not supported yet.');
    dropRepeated(pages);
    var items = pdfBlocks(pages, bodySize(pages));
    if (!items.length) throw new Error('No readable text was found in this PDF.');
    return { items: items, meta: pdf.numPages + (pdf.numPages === 1 ? ' page' : ' pages') };
  }

  var EXTRACT = { txt: extractTxt, srt: extractSrt, docx: extractDocx, pptx: extractPptx, pdf: extractPdf };

  function unsupportedMsg(ext) {
    if (/^(png|jpe?g|gif|webp|bmp|tiff?|heic)$/.test(ext)) return "Images need text recognition (OCR), which isn't supported yet. Upload a DOCX, PPTX, PDF, TXT or SRT file.";
    if (ext === 'doc') return "Old .doc files aren't supported. Open it in Word, choose Save As \u2192 .docx, and upload that.";
    if (ext === 'ppt') return "Old .ppt files aren't supported. Open it in PowerPoint, choose Save As \u2192 .pptx, and upload that.";
    if (/^(xls|xlsx|csv)$/.test(ext)) return "Spreadsheets aren't supported yet.";
    return "This file type isn't supported. Upload a DOCX, PPTX, PDF, TXT or SRT file.";
  }

  /* ---------- translating ---------- */
  function planUnits(items) {
    var seen = Object.create(null), uniq = [], chars = 0;
    items.forEach(function (it) {
      if (it.skip || !/\p{L}/u.test(it.text) || seen[it.text]) return;
      seen[it.text] = true;
      uniq.push(it.text);
      chars += it.text.length;
    });
    var li = 0;
    for (var i = 1; i < uniq.length; i++) { if (uniq[i].length > uniq[li].length) li = i; }
    if (li > 0) { var t = uniq[0]; uniq[0] = uniq[li]; uniq[li] = t; }
    return { uniq: uniq, chars: chars };
  }

  function splitLong(s) {
    if (s.length <= SEG_MAX) return [s];
    var parts = [], rest = s;
    while (rest.length > SEG_MAX) {
      var cut = Math.max(rest.lastIndexOf('. ', SEG_MAX), rest.lastIndexOf('\n', SEG_MAX), rest.lastIndexOf('\u3002', SEG_MAX));
      if (cut < SEG_MAX * 0.4) cut = rest.lastIndexOf(' ', SEG_MAX);
      if (cut < SEG_MAX * 0.4) cut = SEG_MAX;
      parts.push(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
    if (rest) parts.push(rest);
    return parts;
  }

  function fatal(msg) { var e = new Error(msg); e.fatal = true; return e; }
  function cancelErr() { var e = new Error('cancelled'); e.cancelled = true; return e; }

  async function postBatch(texts, src, tgt) {
    var attempt = 0, lastErr = null;
    while (attempt < 3) {
      attempt++;
      if (S.cancel) throw cancelErr();
      var ctl = new AbortController();
      S.ctl = ctl;
      var timer = setTimeout(function () { ctl.abort(); }, 45000);
      try {
        var res = await fetch(BASE_URL + '/api/translate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: texts, targetLanguage: tgt, sourceLanguage: src }),
          signal: ctl.signal
        });
        clearTimeout(timer);
        var raw = await res.text(), data;
        try { data = JSON.parse(raw); } catch (e) { throw fatal('Unexpected server response. Make sure the backend has been redeployed.'); }
        if (res.status === 429) throw fatal(data.error || 'Too many requests. Please wait a few minutes and try again.');
        if (!res.ok || data.error) {
          if (res.status >= 400 && res.status < 500) throw fatal(data.error || 'The request was rejected.');
          throw new Error(data.details || data.error || 'Server error');
        }
        if (!Array.isArray(data.translations) || data.translations.length !== texts.length) throw new Error('Incomplete response from the server');
        return data;
      } catch (e) {
        clearTimeout(timer);
        if (S.cancel) throw cancelErr();
        if (e && e.fatal) throw e;
        lastErr = e;
        if (attempt < 3) await sleep(900 * attempt);
      }
    }
    if (!navigator.onLine) throw new Error("You're offline. Reconnect and try again.");
    if (lastErr && lastErr.name === 'AbortError') throw new Error('The server took too long to respond. Please try again.');
    throw new Error((lastErr && lastErr.message) || 'Translation failed');
  }

  async function translateDoc() {
    var doc = S.doc;
    if (!doc || S.state === 'working' || S.state === 'reading') return;
    var tgt = selTgt.value, srcSel = selSrc.value;
    if (srcSel !== 'auto' && srcSel === tgt) { S.error = 'Choose two different languages.'; render(); return; }
    var plan = planUnits(doc.items);
    if (plan.chars > MAX_CHARS) { S.error = 'This file has ' + plan.chars.toLocaleString() + ' characters to translate. The limit is ' + MAX_CHARS.toLocaleString() + '.'; render(); return; }
    S.state = 'working'; S.cancel = false; S.result = null; S.sessionId = null; S.error = '';
    S.progress = { done: 0, total: plan.chars, part: 0, parts: 0, label: '' };
    render();
    var t0 = Date.now(), detected = null;
    try {
      var segs = [];
      plan.uniq.forEach(function (key) { var pieces = splitLong(key); pieces.forEach(function (p, i) { segs.push({ key: key, i: i, n: pieces.length, text: p }); }); });
      var batches = [], cur = [], curChars = 0;
      segs.forEach(function (sg) {
        if (cur.length >= BATCH_STRINGS || (cur.length && curChars + sg.text.length > BATCH_CHARS)) { batches.push(cur); cur = []; curChars = 0; }
        cur.push(sg); curChars += sg.text.length;
      });
      if (cur.length) batches.push(cur);
      S.progress.parts = batches.length;
      updateProgress();
      var out = Object.create(null), src = srcSel === 'auto' ? null : srcSel;
      for (var b = 0; b < batches.length; b++) {
        var batch = batches[b];
        var data = await postBatch(batch.map(function (s) { return s.text; }), src || 'auto', tgt);
        if (b === 0 && !src) {
          var det = data.detectedLanguage ? String(data.detectedLanguage).split('-')[0].toLowerCase() : null;
          if (det && det !== 'und') {
            detected = det; src = det;
            if (det === tgt) throw fatal('This document looks like it is already in ' + (NAME[det] || det.toUpperCase()) + '. Choose a different "To" language.');
          }
        }
        batch.forEach(function (sg, k) {
          if (!out[sg.key]) out[sg.key] = new Array(sg.n);
          out[sg.key][sg.i] = data.translations[k];
          S.progress.done += sg.text.length;
        });
        S.progress.part = b + 1;
        updateProgress();
      }
      var sep = (tgt === 'ja' || tgt === 'zh') ? '' : ' ';
      var results = Object.create(null);
      Object.keys(out).forEach(function (k) { results[k] = out[k].join(sep); });
      doc.items.forEach(function (it) { it.tr = (!it.skip && results[it.text] != null) ? results[it.text] : it.text; });
      S.result = { tgt: tgt, src: src || 'auto', detected: detected, seconds: Math.max(1, Math.round((Date.now() - t0) / 1000)), chars: plan.chars };
      S.state = 'done';
      render();
      saveHistory();
    } catch (e) {
      if (e && e.cancelled) { S.state = 'ready'; S.error = ''; render(); toast('Translation cancelled'); return; }
      S.state = 'ready';
      S.error = (e && e.message) || 'Translation failed.';
      render();
    }
  }

  function cancelTranslate() {
    S.cancel = true;
    if (S.ctl) { try { S.ctl.abort(); } catch (e) {} }
  }

  /* ---------- building files ---------- */
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function applyRuns(it, preserve) {
    if (!it.ts) return;
    if (it.tr == null || it.tr === it.text) {
      for (var i = 0; i < it.ts.length; i++) it.ts[i].textContent = it.orig[i];
    } else {
      it.ts[0].textContent = it.tr;
      if (preserve) it.ts[0].setAttributeNS(NS_XML, 'xml:space', 'preserve');
      for (var j = 1; j < it.ts.length; j++) it.ts[j].textContent = '';
    }
  }

  async function buildOffice(doc, mime, preserve) {
    doc.items.forEach(function (it) { applyRuns(it, preserve); });
    var ser = new XMLSerializer();
    doc.parts.forEach(function (p) {
      var s = ser.serializeToString(p.xml).replace(/^<\?xml[^>]*\?>\s*/, '');
      doc.zip.file(p.name, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s);
    });
    return doc.zip.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });
  }

  function plainText(items, which) {
    return items.filter(vis).map(function (it) {
      var t = which === 'orig' ? it.text : (it.tr != null ? it.tr : it.text);
      return it.type === 'slide' ? '--- ' + t + ' ---' : t;
    }).join('\n\n');
  }

  function srtText(items) {
    var n = 0;
    return items.map(function (it) { n++; return n + '\n' + it.meta.time + '\n' + (it.tr != null ? it.tr : it.text); }).join('\n\n') + '\n';
  }

  async function flatDocx(items, lang) {
    if (typeof JSZip === 'undefined') throw new Error('Document tools did not load. Check your connection and refresh the page.');
    var ea = lang === 'ja' ? 'MS Mincho' : 'SimSun';
    var fonts = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="' + ea + '" w:cs="Mangal"/>';
    function runs(text, bold, half) {
      var rpr = '<w:rPr>' + fonts + (bold ? '<w:b/><w:bCs/>' : '') + '<w:sz w:val="' + half + '"/><w:szCs w:val="' + half + '"/></w:rPr>';
      return String(text).split('\n').map(function (line, i) {
        return (i ? '<w:r>' + rpr + '<w:br/></w:r>' : '') + '<w:r>' + rpr + '<w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r>';
      }).join('');
    }
    var body = items.filter(vis).map(function (it) {
      var t = it.tr != null ? it.tr : it.text;
      if (it.type === 'h1') return '<w:p><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:jc w:val="left"/></w:pPr>' + runs(t, true, 36) + '</w:p>';
      if (it.type === 'h2' || it.type === 'slide') return '<w:p><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/><w:jc w:val="left"/></w:pPr>' + runs(t, true, 30) + '</w:p>';
      if (it.type === 'li') return '<w:p><w:pPr><w:spacing w:after="80" w:line="340" w:lineRule="auto"/><w:ind w:left="500" w:hanging="260"/><w:jc w:val="both"/></w:pPr>' + runs('\u2022 ' + t, false, 24) + '</w:p>';
      return '<w:p><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>' + runs(t, false, 24) + '</w:p>';
    }).join('');
    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + NS_W + '"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', documentXml);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  function paperEl(items, lang) {
    var paper = el('div', 'dxp'), ul = null;
    paper.setAttribute('lang', lang);
    items.filter(vis).forEach(function (it) {
      var t = it.tr != null ? it.tr : it.text;
      if (it.type === 'li') { if (!ul) { ul = el('ul'); paper.appendChild(ul); } ul.appendChild(el('li', '', t)); return; }
      ul = null;
      var tag = it.type === 'h1' ? 'h1' : ((it.type === 'h2' || it.type === 'slide') ? 'h2' : 'p');
      var n = el(tag, '', t);
      if (tag === 'p') n.style.whiteSpace = 'pre-line';
      paper.appendChild(n);
    });
    return paper;
  }

  function pdfBlob(items, lang) {
    if (typeof html2pdf === 'undefined') return Promise.reject(new Error('PDF tools did not load. Use "Print / Save as PDF" instead, or refresh the page.'));
    var chars = items.reduce(function (n, it) { return n + String(it.tr || '').length; }, 0);
    var opt2 = {
      margin: [18, 18, 18, 18],
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: chars > 20000 ? 1.5 : 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['h1', 'h2', 'li', 'p'] }
    };
    return new Promise(function (resolve, reject) {
      html2pdf().set(opt2).from(paperEl(items, lang)).toPdf().get('pdf').then(function (pdf) { resolve(pdf.output('blob')); }).catch(reject);
    });
  }

  function printHtml(items, lang, title) {
    var body = '', open = false;
    items.filter(vis).forEach(function (it) {
      var t = esc(it.tr != null ? it.tr : it.text).replace(/\n/g, '<br>');
      if (it.type === 'li') { if (!open) { body += '<ul>'; open = true; } body += '<li>' + t + '</li>'; return; }
      if (open) { body += '</ul>'; open = false; }
      if (it.type === 'h1') body += '<h1>' + t + '</h1>';
      else if (it.type === 'h2' || it.type === 'slide') body += '<h2>' + t + '</h2>';
      else body += '<p>' + t + '</p>';
    });
    if (open) body += '</ul>';
    return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + PRINT_CSS + '</style></head><body>' + body + '</body></html>';
  }

  function printItems(items, lang, title) {
    var f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
    f.onload = function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not open the print dialog.', 'error'); }
      setTimeout(function () { f.remove(); }, 60000);
    };
    f.srcdoc = printHtml(items, lang, title);
    document.body.appendChild(f);
  }

  async function download(kind, b) {
    var doc = S.doc, r = S.result;
    if (!doc || !r) return;
    var label = b ? b.textContent : '';
    if (b) { b.disabled = true; b.lastChild.textContent = 'Preparing\u2026'; }
    try {
      var base = baseName(doc.name) + '-' + r.tgt;
      if (kind === 'txt') saveBlob(new Blob([plainText(doc.items)], { type: 'text/plain;charset=utf-8' }), base + '.txt');
      else if (kind === 'docx-flat') saveBlob(await flatDocx(doc.items, r.tgt), base + '.docx');
      else if (doc.kind === 'docx') saveBlob(await buildOffice(doc, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', true), base + '.docx');
      else if (doc.kind === 'pptx') saveBlob(await buildOffice(doc, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', false), base + '.pptx');
      else if (doc.kind === 'srt') saveBlob(new Blob([srtText(doc.items)], { type: 'application/x-subrip;charset=utf-8' }), base + '.srt');
      else if (doc.kind === 'txt') saveBlob(new Blob([plainText(doc.items)], { type: 'text/plain;charset=utf-8' }), base + '.txt');
      else saveBlob(await pdfBlob(doc.items, r.tgt), base + '.pdf');
    } catch (e) {
      toast('Could not create the file: ' + ((e && e.message) || e), 'error');
    } finally {
      if (b) { b.disabled = false; b.lastChild.textContent = label; }
    }
  }

  /* ---------- history ---------- */
  async function saveHistory() {
    var doc = S.doc, r = S.result;
    if (!doc || !r) return;
    var keepEl = $('dxKeep');
    S.savedFailed = !(keepEl && keepEl.checked);
    if (S.savedFailed) { refreshSaveBtn(true); return; }
    var o = plainText(doc.items, 'orig'), t = plainText(doc.items);
    if (o.length > 100000 || t.length > 100000) { toast('Translated. This document is too large to keep in History.'); refreshSaveBtn(true); return; }
    try {
      var res = await fetch(BASE_URL + '/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: doc.name, sourceLanguage: r.detected || r.src, targetLanguage: r.tgt, originalText: o, translatedText: t })
      });
      var data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
      if (S.result === r) { S.sessionId = data.sessionId; refreshSaveBtn(); }
      loadRecent();
    } catch (e) {
      if (S.result === r) { S.sessionId = null; refreshSaveBtn(true); }
      toast("Translated, but it couldn't be saved to History.", 'error');
    }
  }

  function refreshSaveBtn(failed) {
    var b = $('dxSave');
    if (!b) return;
    var span = b.lastChild;
    if (!S.sessionId) { b.disabled = true; span.textContent = failed ? 'Not saved' : 'Saving\u2026'; b.classList.remove('saved'); return; }
    b.disabled = false;
    var on = typeof isSaved === 'function' && isSaved(S.sessionId);
    b.classList.toggle('saved', on);
    span.textContent = on ? 'Saved' : 'Save';
  }

  async function loadRecent() {
    var box = $('dxRecent'), list = $('dxRecentList');
    if (!box || !list) return;
    try {
      var res = await fetch(BASE_URL + '/api/sessions');
      var data = await res.json();
      var docs = (data.sessions || []).filter(function (s) { return s.type === 'document'; }).slice(0, 5);
      list.innerHTML = '';
      box.hidden = docs.length === 0;
      docs.forEach(function (s) {
        var row = el('div', 'dx-rrow');
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.appendChild(el('div', 'dx-rname', s.fileName || 'Document'));
        var d = s.createdAt ? new Date(s.createdAt) : null;
        var when = d && !isNaN(d.getTime()) ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
        var to = s.targetLanguages && s.targetLanguages[0] ? (NAME[s.targetLanguages[0]] || s.targetLanguages[0]) : '';
        row.appendChild(el('div', 'dx-rmeta', [to, when].filter(Boolean).join(' \u00b7 ')));
        function open() { if (typeof openFromSaved === 'function') openFromSaved(s.sessionId); }
        row.addEventListener('click', open);
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(); } });
        list.appendChild(row);
      });
    } catch (e) { box.hidden = true; }
  }

  /* ---------- screens ---------- */
  function updateProgress() {
    var f = $('dxFill'), t = $('dxProgText');
    if (!f || !t) return;
    var pr = S.progress, pct = pr.total ? Math.min(100, Math.round(pr.done / pr.total * 100)) : 0;
    f.style.width = pct + '%';
    t.firstChild.textContent = pr.label || ('Translating\u2026 part ' + Math.min(pr.part + 1, pr.parts || 1) + ' of ' + (pr.parts || 1));
    t.lastChild.textContent = pct + '%';
    var track = f.parentNode;
    track.setAttribute('aria-valuenow', String(pct));
  }

  function renderDrop() {
    var d = el('div', 'dx-drop');
    d.setAttribute('role', 'button');
    d.tabIndex = 0;
    d.setAttribute('aria-label', 'Choose a file to translate');
    var up = el('div', 'dx-up'); up.innerHTML = I.up;
    d.appendChild(up);
    d.appendChild(el('h3', '', 'Drop a file here, or click to browse'));
    d.appendChild(el('p', '', 'Up to 15 MB and 60,000 characters'));
    var chips = el('div', 'dx-chips');
    ['DOCX', 'PPTX', 'PDF', 'TXT', 'SRT'].forEach(function (c) { chips.appendChild(el('span', '', c)); });
    d.appendChild(chips);
    d.appendChild(el('p', '', 'Word and PowerPoint keep their formatting. PDFs are rebuilt as clean text.'));
    var sample = el('button', 'dx-linkbtn', 'Try a sample document');
    sample.type = 'button';
    sample.addEventListener('click', function (e) { e.stopPropagation(); handleFile(new File([SAMPLE], 'VoiceCast-sample.txt', { type: 'text/plain' })); });
    d.appendChild(sample);
    d.addEventListener('click', function () { fileInput.click(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fileInput.click(); } });
    var wrap = el('div');
    wrap.appendChild(d);
    if (S.error) wrap.appendChild(el('div', 'dx-err', S.error));
    return wrap;
  }

  function renderCard(mode) {
    var d = S.doc, k = KIND[d.kind] || KIND.txt;
    var wrap = el('div');
    var c = el('div', 'dx-card');
    var badge = el('div', 'dx-badge', d.kind.toUpperCase());
    badge.style.background = k.color;
    var info = el('div', 'dx-info');
    info.appendChild(el('div', 'dx-name', d.name));
    info.appendChild(el('div', 'dx-meta', mode === 'reading' ? 'Reading file\u2026' : fmtBytes(d.size) + ' \u00b7 ' + k.label + (d.meta ? ' \u00b7 ' + d.meta : '')));
    c.appendChild(badge);
    c.appendChild(info);
    if (mode === 'reading' || mode === 'working') c.appendChild(el('span', 'dx-spin'));
    if (mode === 'ready') {
      var x = el('button', 'dx-x'); x.type = 'button'; x.innerHTML = I.x; x.title = 'Remove file'; x.setAttribute('aria-label', 'Remove file');
      x.addEventListener('click', newFile);
      c.appendChild(x);
    }
    wrap.appendChild(c);
    return wrap;
  }

  function renderReady() {
    var d = S.doc, wrap = renderCard('ready');
    var note = (d.kind === 'docx' || d.kind === 'pptx') ? 'Formatting, images and tables are kept.' : (d.kind === 'srt' ? 'Timings are kept.' : (d.kind === 'pdf' ? "The translation is rebuilt as clean text. The original layout can't be kept." : 'Paragraphs are kept.'));
    wrap.appendChild(el('p', 'dx-note', d.plan.chars.toLocaleString() + ' characters to translate. ' + note));
    if (S.error) wrap.appendChild(el('div', 'dx-err', S.error));
    var act = el('div', 'dx-actions');
    var go = btn('Translate document', 'dx-btn', translateDoc, I.go);
    go.disabled = d.plan.chars > MAX_CHARS;
    act.appendChild(go);
    act.appendChild(btn('Choose another file', 'dx-btn ghost', newFile));
    wrap.appendChild(act);
    return wrap;
  }

  function renderWorking() {
    var wrap = renderCard('working');
    var p = el('div', 'dx-prog');
    var track = el('div', 'dx-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    var fill = el('div', 'dx-fill'); fill.id = 'dxFill';
    track.appendChild(fill);
    p.appendChild(track);
    var txt = el('div', 'dx-prog-text'); txt.id = 'dxProgText';
    txt.appendChild(el('span')); txt.appendChild(el('span'));
    p.appendChild(txt);
    wrap.appendChild(p);
    var act = el('div', 'dx-actions');
    act.appendChild(btn('Cancel', 'dx-btn ghost', cancelTranslate));
    act.appendChild(el('span', 'dx-note', 'Keep this tab open until it finishes.'));
    wrap.appendChild(act);
    setTimeout(updateProgress, 0);
    return wrap;
  }

  function cellFor(which, it, text, lang) {
    var c = el('div', 'dx-cell ' + which);
    if (lang && lang !== 'auto') c.setAttribute('lang', lang);
    if (it.type === 'cue' && it.meta) c.appendChild(el('div', 'dx-time', it.meta.time));
    var cls = it.type === 'h1' ? 'dx-h1' : (it.type === 'h2' ? 'dx-h2' : (it.type === 'li' ? 'dx-li' : (it.type === 'slide' ? 'dx-slide' : 'dx-p')));
    c.appendChild(el('div', cls, text));
    return c;
  }

  function renderDone() {
    var d = S.doc, r = S.result;
    var wrap = el('div');
    var head = el('div', 'dx-rhead');
    var left = el('div');
    left.appendChild(el('div', 'dx-rtitle', d.name));
    var from = r.detected || r.src;
    left.appendChild(el('div', 'dx-rsub', (from && from !== 'auto' ? (NAME[from] || from.toUpperCase()) + (r.detected ? ' (detected)' : '') : 'Auto-detected') + ' \u2192 ' + NAME[r.tgt] + ' \u00b7 ' + d.meta + ' \u00b7 ' + r.chars.toLocaleString() + ' characters \u00b7 ' + r.seconds + 's'));
    head.appendChild(left);
    var seg = el('div', 'dx-seg');
    [['both', 'Side by side'], ['tr', 'Translation'], ['or', 'Original']].forEach(function (v) {
      var b = el('button', v[0] === S.view ? 'active' : '', v[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        S.view = v[0];
        rows.className = 'dx-rows v-' + S.view;
        Array.prototype.forEach.call(seg.children, function (x) { x.classList.toggle('active', x === b); });
      });
      seg.appendChild(b);
    });
    head.appendChild(seg);
    wrap.appendChild(head);

    var rows = el('div', 'dx-rows v-' + S.view);
    var cols = el('div', 'dx-cols');
    cols.appendChild(el('span', 'o', 'Original'));
    cols.appendChild(el('span', 't', 'Translation \u00b7 ' + NAME[r.tgt]));
    rows.appendChild(cols);
    d.items.filter(vis).forEach(function (it) {
      var row = el('div', 'dx-row' + (it.type === 'slide' ? ' slide' : ''));
      row.appendChild(cellFor('o', it, it.text, from));
      row.appendChild(cellFor('t', it, it.tr != null ? it.tr : it.text, r.tgt));
      rows.appendChild(row);
    });
    wrap.appendChild(rows);

    var act = el('div', 'dx-actions');
    var primary = { docx: 'Download DOCX', pptx: 'Download PPTX', srt: 'Download SRT', txt: 'Download TXT', pdf: 'Download PDF' }[d.kind];
    act.appendChild(btn(primary, 'dx-btn', function (e, b) { download('main', b); }, I.dl));
    if (d.kind === 'pdf') act.appendChild(btn('Download DOCX', 'dx-btn ghost', function (e, b) { download('docx-flat', b); }, I.dl));
    if (d.kind === 'pdf' || d.kind === 'docx' || d.kind === 'txt') act.appendChild(btn('Print / Save as PDF', 'dx-btn ghost', function () { printItems(d.items, r.tgt, baseName(d.name) + ' (' + NAME[r.tgt] + ')'); }, I.print));
    if (d.kind !== 'txt') act.appendChild(btn('Plain text', 'dx-btn ghost', function (e, b) { download('txt', b); }, I.dl));
    act.appendChild(btn('Copy', 'dx-btn ghost', function (e, b) {
      copyText(plainText(d.items), function () { var s = b.lastChild, old = s.textContent; s.textContent = 'Copied'; setTimeout(function () { s.textContent = old; }, 1300); });
    }, I.copy));
    var sv = btn('Saving\u2026', 'dx-btn ghost', function () {
      if (!S.sessionId || typeof toggleSaved !== 'function') return;
      var on = toggleSaved(S.sessionId);
      refreshSaveBtn();
      toast(on ? 'Saved. Find it under Saved.' : 'Removed from Saved');
    }, I.mark);
    sv.id = 'dxSave';
    sv.disabled = true;
    act.appendChild(sv);
    wrap.appendChild(act);

    var more = el('div', 'dx-actions');
    more.appendChild(btn('Translate to another language', 'dx-btn ghost', translateAgain));
    more.appendChild(btn('New file', 'dx-btn ghost', newFile));
    wrap.appendChild(more);
    setTimeout(function () { refreshSaveBtn(!S.sessionId && S.savedFailed); }, 0);
    return wrap;
  }

  function render() {
    var busy = S.state === 'working' || S.state === 'reading';
    selSrc.disabled = busy; selTgt.disabled = busy;
    stage.innerHTML = '';
    if (S.state === 'empty') stage.appendChild(renderDrop());
    else if (S.state === 'reading') stage.appendChild(renderCard('reading'));
    else if (S.state === 'ready') stage.appendChild(renderReady());
    else if (S.state === 'working') stage.appendChild(renderWorking());
    else stage.appendChild(renderDone());
  }

  function newFile() { S.doc = null; S.result = null; S.sessionId = null; S.error = ''; S.state = 'empty'; render(); }
  function translateAgain() { S.result = null; S.sessionId = null; S.error = ''; S.state = 'ready'; render(); }

  async function handleFile(file) {
    if (!file || S.state === 'working' || S.state === 'reading') return;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!EXTRACT[ext]) { toast(unsupportedMsg(ext), 'error'); return; }
    if (file.size === 0) { toast('This file is empty.', 'error'); return; }
    if (file.size > MAX_BYTES) { toast('This file is ' + fmtBytes(file.size) + '. The limit is 15 MB.', 'error'); return; }
    S.error = ''; S.result = null; S.sessionId = null;
    S.doc = { name: file.name, size: file.size, kind: ext, items: null };
    S.state = 'reading';
    render();
    try {
      var parsed = await EXTRACT[ext](file);
      var plan = planUnits(parsed.items);
      if (!plan.uniq.length) throw new Error('No translatable text was found in this file.');
      S.doc = { name: file.name, size: file.size, kind: ext, items: parsed.items, meta: parsed.meta, plan: plan, zip: parsed.zip || null, parts: parsed.parts || null };
      if (plan.chars > MAX_CHARS) S.error = 'This file has ' + plan.chars.toLocaleString() + ' characters to translate. The limit is ' + MAX_CHARS.toLocaleString() + '. Try a shorter file or split it.';
      S.state = 'ready';
    } catch (e) {
      S.doc = null;
      S.state = 'empty';
      S.error = (e && e.message) ? e.message : 'This file could not be read.';
    }
    render();
  }

  /* ---------- start ---------- */
  function init() {
    stage = $('dxStage'); selSrc = $('dxSrc'); selTgt = $('dxTgt');
    selSrc.appendChild(opt('auto', 'Detect language'));
    LANGS.forEach(function (l) { selSrc.appendChild(opt(l[0], l[1])); selTgt.appendChild(opt(l[0], l[1])); });
    var st = readSettings();
    selSrc.value = 'auto';
    selTgt.value = hasOpt(selTgt, st.defaultTarget) ? st.defaultTarget : 'en';
    var keepBox = $('dxKeep');
    keepBox.checked = st.saveDocs === true;
    keepBox.addEventListener('change', function () {
      var cur = readSettings();
      cur.saveDocs = keepBox.checked;
      try { localStorage.setItem('voicecast_settings', JSON.stringify(cur)); } catch (e) {}
    });
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'dxFile';
    fileInput.accept = '.docx,.pptx,.pdf,.txt,.srt';
    fileInput.hidden = true;
    fileInput.addEventListener('change', function () { var f = fileInput.files[0]; fileInput.value = ''; handleFile(f); });
    root.appendChild(fileInput);
    selSrc.addEventListener('change', function () { if (S.error && S.state === 'ready') { S.error = ''; render(); } });
    selTgt.addEventListener('change', function () { if (S.error && S.state === 'ready') { S.error = ''; render(); } });

    function activeView() { return root.classList.contains('active'); }
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
    ['dragenter', 'dragover'].forEach(function (ev) {
      window.addEventListener(ev, function (e) { if (activeView() && hasFiles(e)) { e.preventDefault(); root.classList.add('dx-over'); } });
    });
    window.addEventListener('dragleave', function (e) { if (!e.relatedTarget) root.classList.remove('dx-over'); });
    window.addEventListener('drop', function (e) {
      if (!activeView() || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      root.classList.remove('dx-over');
      handleFile(e.dataTransfer.files[0]);
    });

    if (typeof switchTab === 'function') {
      var prevSwitch = switchTab;
      switchTab = function (name) { prevSwitch(name); if (name === 'documents') loadRecent(); };
    }
    render();
    if (activeView()) loadRecent();
  }
  init();
})();
