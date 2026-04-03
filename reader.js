/* ═══════════════════════════════════════════════════════════════
   ePUB 閱讀器 — reader.js
   支援 ePUB 2 / ePUB 3，中文直排/橫排
   ═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {

/* ── CSS injected into Shadow DOM chapter display ────────────── */
/* Note: Google Fonts are loaded in the parent page <head>; fonts are global so no @import needed here */
var INJECTED_STYLE = [
  ':host{--rd-bg:{{BG}};--rd-text:{{TEXT}};--rd-link:{{LINK}};--rd-sz:{{SZ}}px;',
  '  font-size:var(--rd-sz);display:block;width:100%;height:100%;',
  '  background:var(--rd-bg);overflow:auto;box-sizing:border-box;}',
  '#bd{',
  '  font-family:"Noto Serif TC","標楷體",Georgia,serif;',
  '  line-height:1.85;letter-spacing:0.04em;',
  '  max-width:720px;margin:0 auto;',
  '  padding:1.8rem 2.5rem;',
  '  background:var(--rd-bg);',
  '  color:var(--rd-text);',
  '  word-break:break-word;overflow-wrap:break-word;min-height:100%;',
  '}',
  '#bd.v-layout{',
  '  writing-mode:vertical-rl;',
  '  -webkit-writing-mode:vertical-rl;',
  '  max-width:none;',
  '  height:100%;',
  '  padding:1.5rem 1.8rem;',
  '  overflow-x:auto;overflow-y:hidden;',
  '}',
  'h1,h2,h3,h4,h5,h6{',
  '  font-family:"Noto Serif TC","標楷體",serif;',
  '  font-weight:700;line-height:1.45;margin-bottom:.7em;',
  '  color:var(--rd-text);',
  '}',
  'p{margin-bottom:.85em;text-align:justify;}',
  'img{max-width:100%;height:auto;display:block;margin:1em auto;border-radius:4px;}',
  '#bd.v-layout img{max-height:80vh;max-width:none;width:auto;}',
  'a{color:var(--rd-link);}',
  'a:hover{opacity:.8;}',
  'blockquote{border-left:3px solid var(--rd-link);padding-left:1em;margin-left:0;opacity:.85;}',
  '#bd.v-layout blockquote{border-left:none;border-top:3px solid var(--rd-link);',
  '  padding-left:0;padding-top:.5em;}',
  'table{border-collapse:collapse;width:100%;}',
  'th,td{border:1px solid rgba(128,128,128,.3);padding:.4em .6em;}',
  'pre,code{font-family:monospace;font-size:.9em;background:rgba(0,0,0,.05);',
  '  border-radius:3px;padding:.1em .3em;}',
  'pre code{padding:0;background:transparent;}',
  'pre{padding:.8em 1em;overflow-x:auto;}',
  '::-webkit-scrollbar{width:6px;height:6px;}',
  '::-webkit-scrollbar-track{background:transparent;}',
  '::-webkit-scrollbar-thumb{background:rgba(128,128,128,.4);border-radius:3px;}',
].join('\n');

/* ── Application State ───────────────────────────────────────── */
var S = {
  zip:             null,
  opfPath:         '',
  opfDir:          '',
  manifest:        {},  // id → {href, mediaType}
  spine:           [],  // [{id, href}]
  toc:             [],  // [{label, href, depth}]
  dataMap:         {},  // absZipPath → data URI (images/fonts)
  cssMap:          {},  // absZipPath → inlined CSS text
  currentIdx:      0,
  bookTitle:       '',
  scrollMemory:    {},
  fontSize:        18,
  layout:          'horizontal',
  theme:           'day',
};

/* ── DOM References ──────────────────────────────────────────── */
var $ = function(id) { return document.getElementById(id); };
var EL = {
  dropZone:     $('drop-zone'),
  fileInput:    $('file-input'),
  fileInputNew: $('file-input-new'),
  btnOpen:      $('btn-open'),
  btnOpenNew:   $('btn-open-new'),
  topBar:       $('top-bar'),
  bookTitle:    $('book-title-display'),
  btnPrev:      $('btn-prev'),
  btnNext:      $('btn-next'),
  progressLbl:  $('progress-label'),
  btnFontDec:   $('btn-font-dec'),
  btnFontInc:   $('btn-font-inc'),
  fontDisplay:  $('font-size-display'),
  btnLayout:    $('btn-layout-toggle'),
  btnTocToggle: $('btn-toc-toggle'),
  btnTocClose:  $('btn-toc-close'),
  tocSidebar:   $('toc-sidebar'),
  tocList:      $('toc-list'),
  tocBackdrop:  $('toc-backdrop'),
  readerArea:   $('reader-area'),
  iframe:       $('chapter-display'),
  loading:      $('loading-overlay'),
  loadingMsg:   $('loading-msg'),
  errorToast:   $('error-toast'),
};

/* ── Utilities ───────────────────────────────────────────────── */

/** Normalise a/b/../c → a/c */
function normPath(p) {
  if (!p) return '';
  var parts = p.split('/');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === '.' || parts[i] === '') { continue; }
    if (parts[i] === '..') { if (out.length) out.pop(); }
    else out.push(parts[i]);
  }
  return out.join('/');
}

/** Resolve a relative href against a base file path */
function resolveHref(baseFile, rel) {
  if (!rel) return '';
  if (/^[a-z][a-z0-9+\-.]*:/i.test(rel)) return rel; // absolute URL
  var frag = '';
  if (rel.indexOf('#') >= 0) {
    frag = rel.slice(rel.indexOf('#'));
    rel  = rel.slice(0, rel.indexOf('#'));
  }
  if (!rel) return frag;
  var baseDir = baseFile.substring(0, baseFile.lastIndexOf('/') + 1);
  return normPath(baseDir + rel) + frag;
}

var MIME = {
  jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png',
  gif:'image/gif',  webp:'image/webp', svg:'image/svg+xml',
  css:'text/css',
  woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf',
  js:'application/javascript',
  html:'text/html', xhtml:'application/xhtml+xml',
};
function getMime(p) {
  var ext = (p.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}
function parseHtml(text) {
  return new DOMParser().parseFromString(text, 'text/html');
}

/* ── Resource Helpers (data URI — avoids blob:null origin issues) ── */

async function ensureDataUri(zipPath) {
  if (!zipPath || S.dataMap[zipPath] !== undefined) return;
  var entry = S.zip.file(zipPath);
  if (!entry) { S.dataMap[zipPath] = ''; return; }
  var b64 = await entry.async('base64');
  S.dataMap[zipPath] = 'data:' + getMime(zipPath) + ';base64,' + b64;
}

async function processCssText(cssZipPath) {
  if (S.cssMap[cssZipPath] !== undefined) return S.cssMap[cssZipPath];
  var entry = S.zip.file(cssZipPath);
  if (!entry) { S.cssMap[cssZipPath] = ''; return ''; }
  var text = await entry.async('string');
  var cssDir = cssZipPath.substring(0, cssZipPath.lastIndexOf('/') + 1);
  var urlRe = /url\((['"]?)([^'"\)]+)\1\)/g;
  var m;
  var copy = text;
  while ((m = urlRe.exec(copy)) !== null) {
    var raw = m[2];
    if (!raw || raw.startsWith('data:') || /^[a-z]+:/i.test(raw)) continue;
    await ensureDataUri(normPath(cssDir + raw.split('#')[0]));
  }
  var rewritten = text.replace(/url\((['"]?)([^'"\)]+)\1\)/g, function(full, q, raw) {
    if (!raw || raw.startsWith('data:') || /^[a-z]+:/i.test(raw)) return full;
    var abs = normPath(cssDir + raw.split('#')[0]);
    return S.dataMap[abs] ? 'url(' + q + S.dataMap[abs] + q + ')' : full;
  });
  S.cssMap[cssZipPath] = rewritten;
  return rewritten;
}

async function buildResourceMap(chapterHref) {
  var entry = S.zip.file(chapterHref);
  if (!entry) return;
  var html = await entry.async('string');
  var doc  = parseHtml(html);
  var chapterDir = chapterHref.substring(0, chapterHref.lastIndexOf('/') + 1);

  var toProcess = [];
  doc.querySelectorAll('img[src],source[src]').forEach(function(el) {
    toProcess.push({ type:'img', rel: el.getAttribute('src') });
  });
  doc.querySelectorAll('image').forEach(function(el) {
    var h = el.getAttribute('href') || el.getAttribute('xlink:href');
    if (h) toProcess.push({ type:'img', rel: h });
  });
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    toProcess.push({ type:'css', rel: el.getAttribute('href') });
  });
  doc.querySelectorAll('[style]').forEach(function(el) {
    var s = el.getAttribute('style');
    var m; var re = /url\(['"]?([^'"\)]+)['"]?\)/g;
    while ((m = re.exec(s)) !== null) toProcess.push({ type:'img', rel: m[1] });
  });

  for (var i = 0; i < toProcess.length; i++) {
    var item = toProcess[i];
    if (!item.rel || /^data:/.test(item.rel) || /^[a-z]+:\/\//i.test(item.rel)) continue;
    var abs = normPath(chapterDir + item.rel.split('#')[0]);
    if (item.type === 'css') await processCssText(abs);
    else                      await ensureDataUri(abs);
  }
}

/* ── ePUB Parsing ────────────────────────────────────────────── */

async function parseContainer() {
  var xml = parseXml(await S.zip.file('META-INF/container.xml').async('string'));
  var rf  = xml.querySelector('rootfile[full-path]');
  if (!rf) throw new Error('找不到 OPF 路徑（container.xml 損壞）');
  S.opfPath = rf.getAttribute('full-path');
  S.opfDir  = S.opfPath.substring(0, S.opfPath.lastIndexOf('/') + 1);
}

async function parseOpf() {
  var opfText = await S.zip.file(S.opfPath).async('string');
  var xml = parseXml(opfText);

  // Title
  var titleEl = xml.querySelector('title') || xml.querySelector('dc\\:title');
  S.bookTitle = titleEl ? titleEl.textContent.trim() : '（未知書名）';

  // Manifest
  S.manifest = {};
  xml.querySelectorAll('manifest > item, manifest item').forEach(function(item) {
    var id   = item.getAttribute('id');
    var href = item.getAttribute('href');
    var mt   = item.getAttribute('media-type') || '';
    if (id && href) {
      S.manifest[id] = {
        href:      normPath(S.opfDir + href),
        mediaType: mt,
        props:     item.getAttribute('properties') || '',
      };
    }
  });

  // Spine — use regex on raw text for reliable direction detection
  S.spine = [];
  S.bookDirection = /page-progression-direction\s*=\s*["']rtl["']/i.test(opfText) ? 'rtl' : 'ltr';
  xml.querySelectorAll('spine > itemref, spine itemref').forEach(function(ref) {
    var idref = ref.getAttribute('idref');
    if (idref && S.manifest[idref]) {
      S.spine.push({ id: idref, href: S.manifest[idref].href });
    }
  });
  if (S.spine.length === 0) throw new Error('spine 為空，無法讀取');
}

async function parseToc() {
  S.toc = [];

  // ── ePUB3 NAV ──
  var navItem = null;
  Object.values(S.manifest).forEach(function(m) {
    if (m.props && m.props.indexOf('nav') >= 0) navItem = m;
  });
  if (navItem) {
    try {
      var navHtml = await S.zip.file(navItem.href).async('string');
      var navDoc  = parseHtml(navHtml);
      var navDir  = navItem.href.substring(0, navItem.href.lastIndexOf('/') + 1);
      // Find toc nav element
      var tocNav = navDoc.querySelector('[epub\\:type="toc"]')
                || navDoc.querySelector('nav');
      if (tocNav) {
        walkNavOl(tocNav.querySelector('ol'), 0, navDir);
      }
    } catch(e) { /* fall through to NCX */ }
  }

  // ── ePUB2 NCX fallback ──
  if (S.toc.length === 0) {
    var ncxItem = null;
    Object.values(S.manifest).forEach(function(m) {
      if (m.mediaType === 'application/x-dtbncx+xml') ncxItem = m;
    });
    // Also check spine toc attribute
    if (!ncxItem) {
      try {
        var opfXml = parseXml(await S.zip.file(S.opfPath).async('string'));
        var tocId  = (opfXml.querySelector('spine') || {}).getAttribute
          ? opfXml.querySelector('spine').getAttribute('toc') : null;
        if (tocId && S.manifest[tocId]) ncxItem = S.manifest[tocId];
      } catch(e) {}
    }
    if (ncxItem) {
      try {
        var ncxXml = parseXml(await S.zip.file(ncxItem.href).async('string'));
        var ncxDir = ncxItem.href.substring(0, ncxItem.href.lastIndexOf('/') + 1);
        ncxXml.querySelectorAll('navMap > navPoint').forEach(function(pt) {
          walkNavPoint(pt, 0, ncxDir);
        });
      } catch(e) {}
    }
  }

  // Fallback: use spine items as TOC
  if (S.toc.length === 0) {
    S.spine.forEach(function(item, i) {
      S.toc.push({ label: '第 ' + (i + 1) + ' 章', href: item.href, depth: 0 });
    });
  }
}

function walkNavOl(ol, depth, navDir) {
  if (!ol) return;
  Array.from(ol.children).forEach(function(li) {
    if (li.tagName.toLowerCase() !== 'li') return;
    var a = li.querySelector('a') || li.querySelector('span');
    if (a) {
      var rel  = (a.getAttribute('href') || '').split('#')[0];
      var href = rel ? normPath(navDir + rel) : null;
      S.toc.push({ label: a.textContent.trim(), href: href, depth: depth });
    }
    var nested = li.querySelector('ol');
    if (nested) walkNavOl(nested, depth + 1, navDir);
  });
}

function walkNavPoint(pt, depth, ncxDir) {
  var labelEl = pt.querySelector('navLabel text, navLabel > text');
  var contentEl = pt.querySelector('content[src]');
  if (labelEl && contentEl) {
    var src  = contentEl.getAttribute('src') || '';
    var rel  = src.split('#')[0];
    var href = rel ? normPath(ncxDir + rel) : null;
    S.toc.push({ label: labelEl.textContent.trim(), href: href, depth: depth });
  }
  Array.from(pt.children).forEach(function(child) {
    if (child.tagName === 'navPoint') walkNavPoint(child, depth + 1, ncxDir);
  });
}

/* ── Layout Auto-Detection ──────────────────────────────────── */

async function detectLayoutFromContent() {
  var verticalRe = /(-epub-|-webkit-)?writing-mode\s*:\s*vertical/i;

  // 1. Scan all CSS files in manifest
  var cssItems = Object.values(S.manifest).filter(function(m) {
    return m.mediaType === 'text/css' || m.href.toLowerCase().endsWith('.css');
  });
  for (var i = 0; i < cssItems.length; i++) {
    try {
      var entry = S.zip.file(cssItems[i].href);
      if (!entry) continue;
      var text = await entry.async('string');
      if (verticalRe.test(text)) return 'vertical';
    } catch(e) {}
  }

  // 2. Check style blocks / style attributes in first chapter
  if (S.spine.length > 0) {
    try {
      var chapEntry = S.zip.file(S.spine[0].href);
      if (chapEntry) {
        var chapHtml = await chapEntry.async('string');
        if (verticalRe.test(chapHtml)) return 'vertical';
      }
    } catch(e) {}
  }

  return 'horizontal';
}

/* ── Rendering ───────────────────────────────────────────────── */

function buildInjectedStyleContent() {
  var cs   = getComputedStyle(document.documentElement);
  var bg   = cs.getPropertyValue('--bg-content').trim() || '#fff';
  var text = cs.getPropertyValue('--text-main').trim()  || '#2c2c2c';
  var link = cs.getPropertyValue('--link').trim()       || '#4a8fa8';
  return INJECTED_STYLE
    .replace(/\{\{BG\}\}/g,   bg)
    .replace(/\{\{TEXT\}\}/g, text)
    .replace(/\{\{LINK\}\}/g, link)
    .replace(/\{\{SZ\}\}/g,   String(S.fontSize));
}

function buildChapterShadow(html, chapterHref) {
  var doc     = parseHtml(html);
  var chapDir = chapterHref.substring(0, chapterHref.lastIndexOf('/') + 1);

  // Images → data URIs
  doc.querySelectorAll('img[src]').forEach(function(el) {
    var rel = el.getAttribute('src');
    if (!rel || /^data:/.test(rel) || /^[a-z]+:\/\//i.test(rel)) return;
    var abs = normPath(chapDir + rel);
    if (S.dataMap[abs]) el.setAttribute('src', S.dataMap[abs]);
  });
  doc.querySelectorAll('image').forEach(function(el) {
    var rel = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
    if (!rel || /^data:/.test(rel) || /^[a-z]+:\/\//i.test(rel)) return;
    var abs = normPath(chapDir + rel.split('#')[0]);
    if (S.dataMap[abs]) { el.setAttribute('href', S.dataMap[abs]); el.setAttribute('xlink:href', S.dataMap[abs]); }
  });

  // Internal chapter links → epub://chapter/N
  doc.querySelectorAll('a[href]').forEach(function(a) {
    var raw = a.getAttribute('href');
    if (!raw || raw.charAt(0) === '#' || /^[a-z]+:/i.test(raw)) return;
    var fragIdx = raw.indexOf('#');
    var rel  = fragIdx >= 0 ? raw.slice(0, fragIdx) : raw;
    var frag = fragIdx >= 0 ? raw.slice(fragIdx)    : '';
    var abs  = normPath(chapDir + rel);
    var idx  = S.spine.findIndex(function(s) { return s.href === abs; });
    if (idx >= 0) a.setAttribute('href', 'epub://chapter/' + idx + frag);
  });

  // Collect chapter CSS texts
  var cssParts = [];
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
    var rel = el.getAttribute('href');
    if (!rel || /^[a-z]+:\/\//i.test(rel)) return;
    var abs = normPath(chapDir + rel.split('#')[0]);
    if (S.cssMap[abs]) cssParts.push(S.cssMap[abs]);
  });
  doc.querySelectorAll('style').forEach(function(el) {
    cssParts.push(el.textContent);
  });

  // Body content
  var bodyEl = doc.querySelector('body');
  var bodyHtml = bodyEl ? bodyEl.innerHTML : doc.documentElement.innerHTML;

  return { cssParts: cssParts, bodyHtml: bodyHtml };
}

function renderToShadow(chapterData) {
  var host = EL.iframe;
  var sr = host.shadowRoot || host.attachShadow({ mode: 'open' });

  // Build shadow DOM content
  var rdStyle = document.createElement('style');
  rdStyle.id = '_rd_style';
  rdStyle.textContent = buildInjectedStyleContent();

  var chapStyle = document.createElement('style');
  chapStyle.id = '_ch_style';
  chapStyle.textContent = chapterData.cssParts.join('\n');

  var bd = document.createElement('div');
  bd.id = 'bd';
  applyLayoutToBd(bd, S.layout);
  bd.innerHTML = chapterData.bodyHtml;
  console.log('[render] layout:', S.layout, 'bd.style.writingMode:', bd.style.writingMode);

  // Clear and rebuild
  sr.innerHTML = '';
  sr.appendChild(rdStyle);
  sr.appendChild(chapStyle);
  sr.appendChild(bd);

  // Intercept chapter links
  sr.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.startsWith('epub://chapter/')) {
      e.preventDefault();
      var n = parseInt(href.replace('epub://chapter/', '').split('#')[0]);
      if (!isNaN(n)) loadChapter(n);
    }
  }, { once: false });
}

function getScrollEl() {
  if (S.layout === 'vertical') {
    var sr = EL.iframe.shadowRoot;
    return sr ? sr.getElementById('bd') : null;
  }
  return EL.iframe;
}

async function loadChapter(idx) {
  if (idx < 0 || idx >= S.spine.length) return;

  // Save current scroll position
  var sc = getScrollEl();
  if (sc) S.scrollMemory[S.currentIdx] = S.layout === 'vertical' ? sc.scrollLeft : sc.scrollTop;
  // Mark new chapter as unvisited so it starts at beginning
  if (!S.scrollMemory.hasOwnProperty(idx)) S.scrollMemory[idx] = undefined;

  S.currentIdx = idx;

  await buildResourceMap(S.spine[idx].href);

  var entry = S.zip.file(S.spine[idx].href);
  if (!entry) { updateProgressUI(); return; }
  var rawHtml = await entry.async('string');
  var chapterData = buildChapterShadow(rawHtml, S.spine[idx].href);
  renderToShadow(chapterData);

  // Restore scroll — vertical-rl: scrollLeft=0 = BEGINNING (right edge), negative = further left
  var sc2 = getScrollEl();
  if (sc2) {
    if (S.layout === 'vertical') {
      sc2.scrollLeft = S.scrollMemory.hasOwnProperty(idx) ? S.scrollMemory[idx] : 0;
    } else {
      sc2.scrollTop = S.scrollMemory[idx] || 0;
    }
  }

  updateProgressUI();
}

function applyStyle() {
  var sr = EL.iframe.shadowRoot;
  if (!sr) return;
  var s = sr.getElementById('_rd_style');
  if (s) s.textContent = buildInjectedStyleContent();
}

function applyLayoutToBd(bd, layout) {
  if (layout === 'vertical') {
    bd.classList.add('v-layout');
    bd.style.writingMode        = 'vertical-rl';
    bd.style.webkitWritingMode  = 'vertical-rl';
    bd.style.width              = '100%';   // constrain width so overflow-x clips
    bd.style.height             = '100%';
    bd.style.maxWidth           = 'none';
    bd.style.overflowX          = 'auto';
    bd.style.overflowY          = 'hidden';
    bd.style.padding            = '1.5rem 1.8rem';
  } else {
    bd.classList.remove('v-layout');
    bd.style.writingMode        = '';
    bd.style.webkitWritingMode  = '';
    bd.style.width              = '';
    bd.style.height             = '';
    bd.style.maxWidth           = '';
    bd.style.overflowX          = '';
    bd.style.overflowY          = '';
  }
}

function applyLayout() {
  var sr = EL.iframe.shadowRoot;
  if (!sr) return;
  var bd = sr.getElementById('bd');
  if (!bd) return;
  applyLayoutToBd(bd, S.layout);
}

/* ── UI Updates ─────────────────────────────────────────────── */

function updateProgressUI() {
  var total = S.spine.length;
  var cur   = S.currentIdx + 1;
  EL.progressLbl.textContent = '第 ' + cur + ' 章 / 共 ' + total + ' 章';
  EL.btnPrev.disabled = (S.currentIdx <= 0);
  EL.btnNext.disabled = (S.currentIdx >= total - 1);
  document.title = S.bookTitle + ' — ePUB 閱讀器';

  // Highlight TOC
  EL.tocList.querySelectorAll('a').forEach(function(a) {
    a.classList.remove('active');
  });
  var active = EL.tocList.querySelector('a[data-spine-idx="' + S.currentIdx + '"]');
  if (active) {
    active.classList.add('active');
    active.scrollIntoView({ block: 'nearest' });
  }
}

function renderToc() {
  EL.tocList.innerHTML = '';
  if (S.toc.length === 0) {
    EL.tocList.innerHTML = '<p style="padding:1rem;color:var(--text-muted);font-size:.85rem;">無目錄</p>';
    return;
  }
  S.toc.forEach(function(entry) {
    var a = document.createElement('a');
    a.textContent = entry.label;
    a.href = '#';
    var spineIdx = entry.href
      ? S.spine.findIndex(function(s) { return s.href === entry.href; })
      : -1;
    if (spineIdx < 0 && S.toc.indexOf(entry) < S.spine.length) {
      spineIdx = S.toc.indexOf(entry);
    }
    a.setAttribute('data-spine-idx', String(Math.max(0, spineIdx)));
    var d = Math.min(entry.depth, 3);
    if (d > 0) a.className = 'toc-d' + d;

    a.addEventListener('click', function(e) {
      e.preventDefault();
      var idx = parseInt(a.getAttribute('data-spine-idx'));
      if (!isNaN(idx)) loadChapter(idx);
      closeSidebar();
    });
    EL.tocList.appendChild(a);
  });
}

/* ── Sidebar ────────────────────────────────────────────────── */

function openSidebar() {
  EL.tocSidebar.classList.add('is-open');
  EL.tocBackdrop.removeAttribute('hidden');
  EL.btnTocToggle.setAttribute('aria-expanded', 'true');
  // Pin on desktop
  if (window.innerWidth >= 900) document.body.classList.add('sidebar-pinned');
}
function closeSidebar() {
  EL.tocSidebar.classList.remove('is-open');
  EL.tocBackdrop.setAttribute('hidden', '');
  EL.btnTocToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('sidebar-pinned');
}
function toggleSidebar() {
  if (EL.tocSidebar.classList.contains('is-open')) closeSidebar();
  else openSidebar();
}

/* ── Settings ───────────────────────────────────────────────── */

function setFontSize(px, noRerender) {
  S.fontSize = Math.max(12, Math.min(32, px));
  EL.fontDisplay.textContent = S.fontSize;
  if (!noRerender) applyStyle();
  savePrefs();
}

function setTheme(name) {
  document.body.className = document.body.className
    .replace(/\btheme-\S+/, '').trim() + ' theme-' + name;
  S.theme = name;
  document.querySelectorAll('.theme-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-theme') === name);
  });
  applyStyle();
  savePrefs();
}

function toggleLayout() {
  S.layout = (S.layout === 'horizontal') ? 'vertical' : 'horizontal';
  EL.btnLayout.textContent = S.layout === 'vertical' ? '直→橫' : '橫→直';
  document.body.dataset.layout = S.layout;
  applyLayout();
  savePrefs();
}

function reloadCurrentChapter() {
  var sc = getScrollEl();
  if (sc) S.scrollMemory[S.currentIdx] = S.layout === 'vertical' ? sc.scrollLeft : sc.scrollTop;
  loadChapter(S.currentIdx);
}

/* ── Preferences (localStorage) ────────────────────────────── */

function savePrefs() {
  try {
    localStorage.setItem('epub-reader-prefs',
      JSON.stringify({ fontSize: S.fontSize, theme: S.theme, layout: S.layout }));
  } catch(e) {}
}

function loadPrefs() {
  try {
    var p = JSON.parse(localStorage.getItem('epub-reader-prefs') || '{}');
    if (p.fontSize) setFontSize(p.fontSize, true);
    if (p.theme)    setTheme(p.theme);
    if (p.layout) {
      S.layout = p.layout;
      EL.btnLayout.textContent = S.layout === 'vertical' ? '直→橫' : '橫→直';
      document.body.dataset.layout = S.layout;
    }
  } catch(e) {}
}

/* ── Loading / Error UI ─────────────────────────────────────── */

function showLoading(msg) {
  EL.loadingMsg.textContent = msg || '載入中…';
  EL.loading.removeAttribute('hidden');
}
function hideLoading() { EL.loading.setAttribute('hidden', ''); }

var errorTimer = null;
function showError(msg) {
  EL.errorToast.textContent = msg;
  EL.errorToast.removeAttribute('hidden');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(function() {
    EL.errorToast.setAttribute('hidden', '');
  }, 5000);
}

/* ── Load ePUB ──────────────────────────────────────────────── */

async function loadEpub(file) {
  showLoading('正在解析「' + file.name + '」…');
  try {
    // Reset
    S.dataMap = {}; S.cssMap = {};
    S.spine = []; S.toc = []; S.scrollMemory = {};
    S.currentIdx = 0;

    S.zip = await JSZip.loadAsync(file);
    await parseContainer();
    await parseOpf();
    await parseToc();

    // Show reader UI
    EL.dropZone.setAttribute('hidden', '');
    EL.topBar.removeAttribute('hidden');
    EL.tocSidebar.removeAttribute('hidden');
    EL.readerArea.removeAttribute('hidden');

    EL.bookTitle.textContent = S.bookTitle;
    EL.bookTitle.title       = S.bookTitle;

    // Auto-detect layout: check spine direction, then scan CSS for writing-mode
    var autoLayout = (S.bookDirection === 'rtl') ? 'vertical' : 'horizontal';
    if (autoLayout === 'horizontal') {
      autoLayout = await detectLayoutFromContent();
    }
    console.log('[epub] bookDirection:', S.bookDirection, '→ layout:', autoLayout);
    S.layout = autoLayout;
    EL.btnLayout.textContent = S.layout === 'vertical' ? '直→橫' : '橫→直';
    document.body.dataset.layout = S.layout;

    renderToc();
    hideLoading();
    await loadChapter(0);

  } catch(err) {
    hideLoading();
    showError('無法開啟：' + (err.message || err));
    console.error('[ePUB Reader]', err);
  }
}

/* ── Drop Zone & File Input ─────────────────────────────────── */

function initDropZone() {
  EL.dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    EL.dropZone.classList.add('drag-over');
  });
  EL.dropZone.addEventListener('dragleave', function() {
    EL.dropZone.classList.remove('drag-over');
  });
  EL.dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    EL.dropZone.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.epub')) loadEpub(file);
    else showError('請選擇 .epub 格式的檔案');
  });
  EL.btnOpen.addEventListener('click', function() { EL.fileInput.click(); });
  EL.fileInput.addEventListener('change', function() {
    if (EL.fileInput.files[0]) loadEpub(EL.fileInput.files[0]);
    EL.fileInput.value = '';
  });
  // Also allow drop on whole page when reader is open
  document.addEventListener('dragover', function(e) { e.preventDefault(); });
  document.addEventListener('drop', function(e) {
    e.preventDefault();
    if (!S.zip) return; // handled by dropzone
    var file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.epub')) loadEpub(file);
  });
}

/* ── Control Bindings ───────────────────────────────────────── */

function bindControls() {
  EL.btnPrev.addEventListener('click', function() { loadChapter(S.currentIdx - 1); });
  EL.btnNext.addEventListener('click', function() { loadChapter(S.currentIdx + 1); });

  EL.btnTocToggle.addEventListener('click', toggleSidebar);
  EL.btnTocClose.addEventListener('click', closeSidebar);
  EL.tocBackdrop.addEventListener('click', closeSidebar);

  EL.btnFontDec.addEventListener('click', function() { setFontSize(S.fontSize - 2); });
  EL.btnFontInc.addEventListener('click', function() { setFontSize(S.fontSize + 2); });

  EL.btnLayout.addEventListener('click', toggleLayout);

  document.querySelectorAll('.theme-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { setTheme(btn.getAttribute('data-theme')); });
  });

  EL.btnOpenNew.addEventListener('click', function() { EL.fileInputNew.click(); });
  EL.fileInputNew.addEventListener('change', function() {
    if (EL.fileInputNew.files[0]) loadEpub(EL.fileInputNew.files[0]);
    EL.fileInputNew.value = '';
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch(e.key) {
      case 'ArrowLeft':  case 'ArrowUp':    if (S.spine.length) { e.preventDefault(); loadChapter(S.currentIdx - 1); } break;
      case 'ArrowRight': case 'ArrowDown':  if (S.spine.length) { e.preventDefault(); loadChapter(S.currentIdx + 1); } break;
      case 'Escape':  closeSidebar(); break;
      case 't': case 'T':  if (S.spine.length) toggleSidebar(); break;
      case 'v': case 'V':  if (S.spine.length) toggleLayout(); break;
      case 'o': case 'O':  EL.fileInputNew.click(); break;
    }
  });
}

/* ── Page Turn ──────────────────────────────────────────────── */

function pageTurn(dir) {
  // dir: 1 = forward in book, -1 = backward
  if (!S.spine.length) return;
  var sc = getScrollEl();
  if (!sc) return;

  if (S.layout === 'vertical') {
    // Chrome vertical-rl: scrollLeft=0 = BEGINNING (rightmost), scrollLeft<0 = further left = END
    // forward  = toward end   = decrease scrollLeft (more negative), scrollBy left: -pageW
    // backward = toward start = increase scrollLeft (toward 0),      scrollBy left: +pageW
    var pageW   = sc.clientWidth;
    var minLeft = -(sc.scrollWidth - sc.clientWidth);  // most negative = end
    var atEnd   = sc.scrollLeft <= minLeft + 10;
    var atStart = sc.scrollLeft >= -10;
    if (dir === 1) {  // forward (right half click)
      if (atEnd)   { if (S.currentIdx < S.spine.length - 1) loadChapter(S.currentIdx + 1); }
      else         sc.scrollBy({ left: -pageW, behavior: 'smooth' });
    } else {          // backward (left half click)
      if (atStart) { if (S.currentIdx > 0) loadChapter(S.currentIdx - 1); }
      else         sc.scrollBy({ left: pageW,  behavior: 'smooth' });
    }
  } else {
    var pageH   = sc.clientHeight;
    var atEnd   = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 10;
    var atStart = sc.scrollTop <= 10;
    if (dir === 1) {
      if (atEnd)   { if (S.currentIdx < S.spine.length - 1) loadChapter(S.currentIdx + 1); }
      else         sc.scrollBy({ top: pageH,  behavior: 'smooth' });
    } else {
      if (atStart) { if (S.currentIdx > 0) loadChapter(S.currentIdx - 1); }
      else         sc.scrollBy({ top: -pageH, behavior: 'smooth' });
    }
  }
}

function initPageTurn() {
  EL.iframe.addEventListener('click', function(e) {
    if (!S.spine.length) return;
    if (e.defaultPrevented) return;
    // Ignore clicks on links (check composed path through shadow DOM)
    var path = e.composedPath ? e.composedPath() : [];
    for (var i = 0; i < path.length; i++) {
      if (path[i].tagName && path[i].tagName.toLowerCase() === 'a') return;
    }
    var rect = EL.iframe.getBoundingClientRect();
    var relX = e.clientX - rect.left;
    // Right half = forward, left half = backward
    pageTurn(relX > rect.width * 0.5 ? 1 : -1);
  });
}

/* ── Entry Point ────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
  loadPrefs();
  initDropZone();
  bindControls();
  initPageTurn();
});

})();
