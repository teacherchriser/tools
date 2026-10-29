import { writeFileSync } from 'node:fs';

// ====== CONFIGURACIÓN ======
const SHEET_CSV_URL = 'https://script.google.com/macros/s/AKfycbz-CrAPMLI9jDGIL07qaMKjYbgc5HuZabdidImAJ5eI91Q6uQF76jiGBN1SlTQJTStXbQ/exec';
const SITE_URL      = 'https://teacherchriser.github.io/tools/newsroom/upn.html';
const TITLE         = 'The PCS Paper';
const DESCRIPTION   = 'Written by our students, for our students';
const MAX_ITEMS     = 30;
const DATE_ORDER    = 'dmy'; // 'dmy' (28/10/2026) o 'mdy' (10/28/2026)
const TZ            = -5;    // Bogotá = UTC-5
// ===========================

const KEYS = {
  picture:  ['picture','image','photo','foto','imagen','upload','archivo','file','subir','cargar'],
  headline: ['headline','title','titular','titulo','heading','encabezado'],
  authors:  ['author','autor','written by','name','nombre','reporter','periodista','integrante','equipo'],
  content:  ['news','content','story','article','noticia','contenido','texto','body','report']
};

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esc  = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function parseCSV(t) {
  t = t.replace(/^\uFEFF/, '');
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i+1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; }
    else f += c;
  }
  if (f !== '' || r.length) { r.push(f); rows.push(r); }
  return rows.filter(x => x.some(v => v.trim()));
}

function detect(head, rows) {
  const map = {}, used = {};
  const col = i => rows.map(r => (r[i] || '').trim()).filter(Boolean);
  const avg = i => { const c = col(i); return c.length ? c.reduce((a, v) => a + v.length, 0) / c.length : 0; };
  const urlR = i => { const c = col(i); return c.length ? c.filter(v => /https?:\/\//.test(v)).length / c.length : 0; };
  const ign = i => /timestamp|marca temporal|e-?mail|correo|puntuac|score/.test(norm(head[i]));
  ['picture','headline','authors','content'].forEach(f => {
    let best = -1, bs = 0;
    head.forEach((h, i) => {
      if (used[i] || ign(i)) return;
      const n = norm(h); let s = 0;
      KEYS[f].forEach(k => { const p = n.search(new RegExp('\\b' + k)); if (p > -1) s = Math.max(s, p === 0 ? 2 : 1); });
      if (f === 'picture' && urlR(i) > 0.5) s = 3;
      if (s > bs) { bs = s; best = i; }
    });
    if (best >= 0) { map[f] = best; used[best] = 1; }
  });
  const rest = [];
  head.forEach((h, i) => { if (!used[i] && !ign(i) && avg(i) > 0 && urlR(i) < 0.5) rest.push(i); });
  rest.sort((a, b) => avg(b) - avg(a));
  ['content','headline','authors'].forEach(f => { if (map[f] === undefined && rest.length) { const i = rest.shift(); map[f] = i; used[i] = 1; } });
  return map;
}

function picUrl(v) {
  v = String(v || '').split(/[\s,;]+/).filter(x => /^https?:\/\//.test(x))[0];
  if (!v) return '';
  if (/drive\.google\.com|docs\.google\.com/.test(v)) {
    const m = v.match(/[?&]id=([\w-]+)/) || v.match(/\/d\/([\w-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200';
  }
  return v;
}

function parseDate(v, i) {
  const m = String(v || '').match(/(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3]; let y, mo, d;
    if (a > 31) { y = a; mo = b; d = c; }
    else {
      y = c;
      if (a > 12) { d = a; mo = b; }
      else if (b > 12) { mo = a; d = b; }
      else if (DATE_ORDER === 'dmy') { d = a; mo = b; }
      else { mo = a; d = b; }
    }
    return new Date(Date.UTC(y, mo - 1, d, (+m[4] || 0) - TZ, +m[5] || 0, +m[6] || 0));
  }
  return new Date(Date.UTC(2000, 0, 1, 0, i));
}

const res = await fetch(SHEET_CSV_URL);
if (!res.ok) throw new Error('No se pudo leer el Sheet: HTTP ' + res.status);
const rows = parseCSV(await res.text());
const head = rows.shift();
const map = detect(head, rows);
const tsCol = head.findIndex(h => /timestamp|marca temporal/.test(norm(h)));

const items = rows.map((r, i) => {
  const get = f => map[f] === undefined ? '' : String(r[map[f]] || '').trim();
  let title = get('headline'); const content = get('content');
  if (!title && !content) return null;
  if (!title) title = content.split(/\s+/).slice(0, 8).join(' ') + '…';
  return {
    title, content,
    authors: get('authors').replace(/\s*[\r\n]+\s*/g, ', '),
    pic: picUrl(get('picture')),
    date: parseDate(tsCol >= 0 ? r[tsCol] : '', i),
    id: 'story-' + (i + 2)
  };
}).filter(Boolean).reverse().slice(0, MAX_ITEMS);

const itemXml = s => {
  let html = s.pic ? `<p><img src="${s.pic}" alt="" style="max-width:100%"></p>` : '';
  html += s.content.split(/\n+/).filter(p => p.trim()).map(p => `<p>${esc(p.trim())}</p>`).join('');
  if (s.authors) html += `<p><em>By ${esc(s.authors)}</em></p>`;
  return '<item>' +
    `<title>${esc(s.title)}</title>` +
    `<link>${esc(SITE_URL)}</link>` +
    `<guid isPermaLink="false">${esc(SITE_URL + '#' + s.id)}</guid>` +
    `<pubDate>${s.date.toUTCString()}</pubDate>` +
    (s.authors ? `<dc:creator>${esc(s.authors)}</dc:creator>` : '') +
    `<description><![CDATA[${html.replace(/]]>/g, ']]&gt;')}]]></description>` +
    '</item>';
};

const last = items.length ? items[0].date : new Date(0);
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>' +
  `<title>${esc(TITLE)}</title><link>${esc(SITE_URL)}</link>` +
  `<description>${esc(DESCRIPTION)}</description><language>en</language>` +
  `<lastBuildDate>${last.toUTCString()}</lastBuildDate>` +
  items.map(itemXml).join('') +
  '</channel></rss>\n';

writeFileSync('feed.xml', xml);
console.log('feed.xml listo con ' + items.length + ' noticias');
