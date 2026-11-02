/*
 * Reading Blackboard question pool packages (.zip) back into the editor.
 *
 * Accepts what Blackboard Learn writes when you export a question bank or pool
 * (Ultra "Manage banks → Export", Original "Pools → Export") and what
 * js/bbpool.js writes. The questions live in the .dat file that imsmanifest.xml
 * lists as assessment/x-bb-qti-pool (or a test, assessment/x-bb-qti-test), in
 * Blackboard's QTI 1.2 dialect. Pictures live under csfiles/ and are referenced
 * from the HTML as …bbcswebdav/xid-N_1.
 *
 * Ultra quirks this handles:
 *   - Single-answer multiple choice is exported as "Multiple Answer" with one
 *     correct choice and a single_correct_answer=true marker.
 *   - True/False is exported as "Either/Or" with true_false.true / true_false.false.
 *   - The ids in the scoring rules don't always match the ids on the choices;
 *     then the rules list the choices in order, so position is used instead.
 *   - Pictures added in the Ultra editor are written as links
 *     (<a href="…bbcswebdav/xid-N_1" data-bbfile='{"render":"inline",…}'>), not <img>.
 *
 * The zip is read with the browser's own DecompressionStream, so no library is needed.
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  /* ---------- a minimal zip reader ---------- */

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unzip files. Try a current version of Chrome, Edge, Firefox or Safari.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** ArrayBuffer → Map(name → { size, read(): Promise<Uint8Array> }) */
  function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This is not a .zip file, or it is damaged.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('This .zip file is damaged.');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const xlen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      files.set(name, {
        size,
        read: async () => {
          if (flags & 1) throw new Error('This .zip file is password-protected.');
          const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
          const raw = u8.subarray(start, start + csize);
          if (method === 0) return raw;
          if (method === 8) return inflateRaw(raw);
          throw new Error('This .zip file uses a compression method the editor can’t read.');
        }
      });
    }
    return files;
  }

  const utf8 = (bytes) => new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');

  /* ---------- small DOM helpers ---------- */

  const kids = (el, tag) => (el ? Array.from(el.children).filter(c => !tag || c.localName === tag) : []);
  const all = (el, tag) => (el ? Array.from(el.getElementsByTagName(tag)) : []);
  const first = (el, tag) => (el ? el.getElementsByTagName(tag)[0] || null : null);
  const textOf = (el) => (el ? el.textContent : '');
  const flowByClass = (el, cls) => all(el, 'flow').find(f => f.getAttribute('class') === cls) || null;

  /** Raw HTML of a formatted block (or plain text turned into HTML). */
  function rawHtml(el) {
    if (!el) return '';
    const f = first(el, 'mat_formattedtext');
    if (f) return f.textContent || '';
    const t = first(el, 'mattext');
    if (!t) return '';
    const type = (t.getAttribute('texttype') || '').toLowerCase();
    return type === 'text/html' ? t.textContent : BQ.rt.escapeHtml(t.textContent || '');
  }

  /* ---------- HTML → editor markup ---------- */

  const XID_RE = /bbcswebdav\/(?:[^"'\s>]*\/)?(xid-\d+_\d+)/i;

  function attrsOf(s) {
    const out = {};
    String(s).replace(/([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g, (m, k, v, a, b, c) => {
      out[k.toLowerCase()] = BQ.rt.decodeEntities(a != null ? a : b != null ? b : c);
      return m;
    });
    return out;
  }

  /**
   * Ultra's editor embeds a picture as a link rather than an <img>:
   *   <a href="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-N_1"
   *      data-bbfile='{"render":"inline","mimeType":"image/png","alternativeText":"…"}'>…</a>
   * Rewrite those as <img> so they are imported like any other picture.
   * Links to other files (a PDF, say) are left alone.
   */
  function embeddedPicturesToImg(s) {
    return s.replace(/<a\b([^>]*)>[\s\S]*?<\/a>/gi, (m, a) => {
      const at = attrsOf(a);
      if (!at['data-bbfile'] || !XID_RE.test(at.href || '')) return m;
      let j;
      try { j = JSON.parse(at['data-bbfile']); } catch (e) { return m; }
      const mime = String(j.mimeType || '');
      const isPicture = mime ? /^image\//i.test(mime) : j.render === 'inline';
      if (!isPicture) return m;
      const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return '<img src="' + esc(at.href) + '" data-bbfile="' + esc(at['data-bbfile']) + '"' +
        (at.style ? ' style="' + esc(at.style) + '"' : '') + '>';
    });
  }

  /**
   * Turn Blackboard's HTML into the editor's markup.
   * pics: Map(xid → picture name) for pictures found in the package.
   * missing: Set collecting xids whose picture wasn't in the package.
   */
  function toMarkup(html, pics, missing) {
    let s = String(html || '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = embeddedPicturesToImg(s);
    // pictures: point them at the project's copy
    s = s.replace(/<img\b([^>]*)>/gi, (m, a) => {
      const at = attrsOf(a);
      const xm = XID_RE.exec(at.src || '');
      let alt = at.alt || '';
      if (!alt && at['data-bbfile']) {
        try { const j = JSON.parse(at['data-bbfile']); alt = j.alternativeText || j.linkName || ''; } catch (e) { /* not JSON */ }
      }
      let name = xm && pics.get(xm[1].toLowerCase());
      if (!name && BQ.rt.isLocalImage(at.src || '')) name = at.src; // already a project name
      if (!name) {
        if (xm) missing.add(xm[1]);
        return alt ? ' [picture: ' + BQ.rt.escapeHtml(alt) + '] ' : ' [picture] ';
      }
      let width = at.width && /^\d+$/.test(at.width) ? at.width : '';
      const sw = /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(at.style || '');
      if (!width && sw) width = sw[1];
      let align = at.align || '';
      if (!align && /float\s*:\s*(left|right)/i.test(at.style || '')) align = /float\s*:\s*(left|right)/i.exec(at.style)[1];
      return '<img src="' + name + '" alt="' + BQ.rt.escapeHtml(alt).replace(/"/g, '&quot;') + '"' +
        (width ? ' width="' + width + '"' : '') + (/^(left|right|center|middle)$/i.test(align) ? ' align="' + align.toLowerCase() + '"' : '') + '>';
    });
    const pre = [];
    s = s.replace(/<pre\b[\s\S]*?<\/pre>/gi, (m) => '\u0001' + (pre.push(m) - 1) + '\u0001');
    s = s.replace(/\s+/g, ' ');
    // LaTeX source written as \( … \) or \[ … \] goes back to the editor's $ … $
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, t) => '$$' + t.trim() + '$$').replace(/\\\(([\s\S]+?)\\\)/g, (m, t) => '$' + t.trim() + '$');
    s = s.replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (m, a, body) => pipeTable(a, body) || m);
    // drop wrappers that carry only styling
    s = s.replace(/<\/?(span|font)\b[^>]*>/gi, '');
    // paragraphs and divs become line breaks
    s = s.replace(/<(p|div|h[1-6])\b[^>]*>/gi, '\n').replace(/<\/(p|div|h[1-6])>/gi, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<(\/?)(strong|b|em|i|u|sub|sup|code|table|thead|tbody|tr|ul|ol|li)\b[^>]*>/gi, '<$1$2>');
    s = s.replace(/\u0001(\d+)\u0001/g, (m, n) => pre[+n]);
    s = s.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    s = s.replace(/&nbsp;/g, ' ');
    return BQ.rt.htmlToMarkup(s).replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  /**
   * A simple HTML table → the editor's | a | b | rows (with a |---| rule for a heading
   * row or column alignment, and {table align=…} for a centered or right table).
   * Returns null for tables that don't fit that form (merged cells, lines inside cells).
   */
  function pipeTable(tableAttrs, body) {
    if (/<table\b/i.test(body) || /\b(colspan|rowspan)\s*=\s*["']?[2-9]/i.test(body)) return null;
    const rows = [];
    let ok = true;
    body.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (m, r) => {
      const cells = [];
      r.replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (m2, tag, a, c) => {
        const st = attrsOf(a).style || '';
        const al = (/text-align\s*:\s*(left|center|right)/i.exec(st) || [])[1] || (attrsOf(a).align || '').toLowerCase();
        let text = c.replace(/<\/?(p|div|span|font)\b[^>]*>/gi, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (/<br\b|\|/i.test(text)) ok = false;
        text = BQ.rt.htmlToMarkup(text).trim();
        cells.push({ head: tag.toLowerCase() === 'th', align: /^(center|right)$/.test(al) ? al : 'left', text });
      });
      if (cells.length) rows.push(cells);
      return m;
    });
    if (!ok || !rows.length) return null;
    const cols = Math.max.apply(null, rows.map(r => r.length));
    const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => (r[i] ? r[i].text : '')).join(' | ') + ' |';
    const aligns = Array.from({ length: cols }, (_, i) => (rows[0][i] ? rows[0][i].align : 'left'));
    const rule = '|' + aligns.map(a => (a === 'center' ? ':---:' : a === 'right' ? '---:' : '---')).join('|') + '|';
    const head = rows[0].every(c => c.head);
    const out = rows.map(line);
    if (head) out.splice(1, 0, rule);
    else if (aligns.some(a => a !== 'left')) out.unshift(rule);
    const st = attrsOf(tableAttrs).style || '';
    const ml = /margin-left\s*:\s*auto/i.test(st);
    const mr = /margin-right\s*:\s*auto/i.test(st);
    const pos = ml && mr ? 'center' : ml ? 'right' : (attrsOf(tableAttrs).align || '').toLowerCase();
    if (pos === 'center' || pos === 'right') out.unshift('{table align=' + pos + '}');
    return '<p>' + out.join('<br>') + '</p>';
  }

  /* ---------- pictures ---------- */

  function sniffType(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
    const head = new TextDecoder().decode(b.subarray(0, 300));
    if (/<svg\b/i.test(head) || (/^\s*<\?xml/.test(head) && /<svg\b/i.test(new TextDecoder().decode(b.subarray(0, 2000))))) return 'image/svg+xml';
    return null;
  }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /** Load the pictures the questions refer to. Returns { pics: Map(xid → name), images: {name: {type,data}} } */
  async function loadPictures(files, xids) {
    const pics = new Map();
    const images = {};
    if (!xids.size) return { pics, images };
    // index the package's files by xid: csfiles/…/__xid-N_1, …/name__xid-N_1.png, res00001/xid-N_1
    const byXid = new Map();
    for (const [name] of files) {
      const m = /(?:^|\/|__)(xid-\d+_\d+)(\.[A-Za-z0-9]+)?$/i.exec(name);
      if (m && !/\.xml$/i.test(name)) {
        const k = m[1].toLowerCase();
        if (!byXid.has(k) || /^csfiles\//.test(name)) byXid.set(k, name);
      }
    }
    const used = new Set();
    for (const xid of xids) {
      const path = byXid.get(xid);
      if (!path) continue;
      const bytes = await files.get(path).read();
      const type = sniffType(bytes);
      if (!type) continue;
      // a readable name: the editor's own "name__xid", or the name Blackboard keeps in the .xml beside the file
      let base = '';
      const own = /([^/]+)__xid-\d+_\d+(?:\.[A-Za-z0-9]+)?$/i.exec(path);
      if (own) base = own[1];
      else if (files.has(path + '.xml')) {
        const lom = utf8(await files.get(path + '.xml').read());
        const id = /<identifier>([^<]*)<\/identifier>/i.exec(lom);
        if (id) base = BQ.rt.decodeEntities(id[1]).split('#').pop().split('/').pop();
      }
      base = base.replace(/\.[A-Za-z0-9]{2,4}$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 60) || 'picture';
      let name;
      for (let n = 1; ; n++) {
        name = (n === 1 ? base : base + '-' + n) + '.' + EXT[type];
        if (!used.has(name.toLowerCase())) break;
      }
      used.add(name.toLowerCase());
      pics.set(xid, name);
      images[name] = { type, data: toBase64(bytes) };
    }
    return { pics, images };
  }

  /* ---------- scoring rules ---------- */

  const isIncorrectRule = (rc) => rc.getAttribute('title') === 'incorrect' || !!first(rc, 'other');
  /** Does this rule give full marks? */
  function givesFull(rc) {
    if (rc.getAttribute('title') === 'correct') return true;
    return kids(rc, 'setvar').some(sv => (sv.getAttribute('variablename') || 'SCORE').toUpperCase() === 'SCORE' && /SCORE\.max/i.test(sv.textContent));
  }
  const ruleSets = (rc, name) => kids(rc, 'setvar').filter(sv => sv.getAttribute('variablename') === name).map(sv => sv.textContent.trim());
  /** varequal elements in a rule, split into wanted and not-wanted. */
  function equals(rc) {
    const want = [];
    const notWant = [];
    all(rc, 'varequal').forEach(v => {
      let p = v.parentElement;
      let negated = false;
      while (p && p !== rc) { if (p.localName === 'not') negated = !negated; p = p.parentElement; }
      (negated ? notWant : want).push(v);
    });
    return { want, notWant };
  }

  /* ---------- one <item> → one question ---------- */

  const TYPE_MAP = {
    'multiple choice': 'MC', 'multiple answer': 'MA', 'true/false': 'TF', 'either/or': 'EO',
    'essay': 'ESS', 'short response': 'ESS', 'matching': 'MAT', 'fill in the blank': 'FIB',
    'fill in the blank plus': 'FIB_PLUS', 'numeric': 'NUM'
  };
  const UNSUPPORTED = {
    'ordering': 'Ordering', 'jumbled sentence': 'Jumbled sentence', 'calculated': 'Calculated formula',
    'hot spot': 'Hot spot', 'quiz bowl': 'Quiz bowl', 'opinion scale': 'Opinion scale / Likert',
    'file upload': 'File upload', 'calculated numeric': 'Calculated numeric'
  };

  function readItem(item, ctx) {
    const meta = first(item, 'itemmetadata');
    const rawType = textOf(first(meta, 'bbmd_questiontype')).trim();
    const key = rawType.toLowerCase();
    const warn = (level, message) => ctx.issues.push({ question: ctx.n, level, message });
    let code = TYPE_MAP[key];
    if (!code) {
      warn('warning', (UNSUPPORTED[key] || '“' + (rawType || 'Unknown') + '”') + ' questions aren’t supported by the editor, so this one was skipped.');
      return null;
    }
    const pts = parseFloat(textOf(first(meta, 'qmd_absolutescore_max')));
    if (pts > 0) ctx.points.push(pts);
    const md = (html) => toMarkup(html, ctx.pics, ctx.missing);

    const pres = first(item, 'presentation');
    const qblock = flowByClass(pres, 'QUESTION_BLOCK');
    const rblock = flowByClass(pres, 'RESPONSE_BLOCK');
    const rules = all(first(item, 'resprocessing'), 'respcondition');
    const fullRules = rules.filter(rc => !isIncorrectRule(rc) && givesFull(rc));

    const q = BQ.newQuestion(code === 'EO' ? 'TF' : code);
    q.text = md(rawHtml(qblock));

    switch (code) {
      case 'MC':
      case 'MA': {
        const labels = all(rblock, 'response_label');
        q.options = labels.map(l => ({ text: md(rawHtml(l)), correct: false }));
        const ids = labels.map(l => l.getAttribute('ident'));
        let rule = fullRules.find(rc => all(rc, 'varequal').length) || null;
        let correctIdx = [];
        if (rule) {
          const { want, notWant } = equals(rule);
          const wantIds = want.map(v => v.textContent.trim());
          correctIdx = wantIds.map(id => ids.indexOf(id)).filter(i => i >= 0);
          if (!correctIdx.length && wantIds.length) {
            // ids don't line up (Ultra): the rule lists every choice, in order
            const seq = all(rule, 'varequal');
            if (seq.length === labels.length) correctIdx = seq.map((v, i) => (notWant.includes(v) ? -1 : i)).filter(i => i >= 0);
          }
        } else {
          // Original view MC with partial credit: one rule per choice; the one that sets 100% is correct
          rules.forEach(rc => {
            const v = first(rc, 'varequal');
            const i = v ? ids.indexOf(v.textContent.trim()) : -1;
            if (i >= 0 && ruleSets(rc, 'SCORE').some(x => /^(100(\.0+)?|SCORE\.max)$/i.test(x))) correctIdx.push(i);
          });
        }
        correctIdx.forEach(i => { q.options[i].correct = true; });
        if (!correctIdx.length) warn('warning', 'The correct answer couldn’t be read. Mark it in the editor.');
        if (code === 'MA' && correctIdx.length === 1 && rule && ruleSets(rule, 'single_correct_answer').includes('true')) q.type = 'MC';
        else q.type = correctIdx.length > 1 ? 'MA' : code;
        if (code === 'MC' && correctIdx.length > 1) q.type = 'MA';
        break;
      }
      case 'TF':
      case 'EO': {
        const v = fullRules.map(rc => first(rc, 'varequal')).find(Boolean);
        const val = v ? v.textContent.trim().toLowerCase() : '';
        const kind = (val.split('.')[0] || '').replace('_', '/');
        if (/(^|\.)(true|yes|agree|right)$/.test(val)) q.tf = true;
        else if (/(^|\.)(false|no|disagree|wrong)$/.test(val)) q.tf = false;
        else warn('warning', 'The correct answer couldn’t be read. Choose True or False in the editor.');
        if (code === 'EO' && kind && kind !== 'true/false' && val.includes('.')) {
          warn('info', 'Either/Or (' + kind.replace(/\b\w/g, c => c.toUpperCase()) + ') was imported as True/False, the closest type the editor has.');
        }
        break;
      }
      case 'ESS': {
        if (key === 'short response') warn('info', 'Short response was imported as Essay.');
        const sol = all(item, 'itemfeedback').find(f => f.getAttribute('ident') === 'solution');
        q.sample = sol ? md(rawHtml(sol)) : '';
        break;
      }
      case 'MAT': {
        // prompts: RESPONSE_BLOCK > flow.Block, each with a response_lid and its text
        const prompts = kids(rblock, 'flow').filter(f => first(f, 'response_lid')).map(f => {
          const lid = first(f, 'response_lid');
          const textFlow = kids(f, 'flow').find(x => !first(x, 'response_lid')) || f;
          return { ident: lid.getAttribute('ident'), labels: all(lid, 'response_label').map(l => l.getAttribute('ident')), text: md(rawHtml(textFlow)) };
        });
        const rightBlock = flowByClass(pres, 'RIGHT_MATCH_BLOCK');
        const rights = kids(rightBlock, 'flow').map(f => md(rawHtml(f)));
        const matchOf = new Array(prompts.length).fill(-1);
        rules.filter(rc => !isIncorrectRule(rc)).forEach(rc => {
          all(rc, 'varequal').forEach(v => {
            const resp = v.getAttribute('respident');
            const label = v.textContent.trim();
            let pi = prompts.findIndex(p => p.ident === resp);
            if (pi < 0 || !prompts[pi].labels.includes(label)) pi = prompts.findIndex(p => p.labels.includes(label));
            if (pi >= 0) matchOf[pi] = prompts[pi].labels.indexOf(label);
          });
        });
        q.pairs = prompts.map((p, i) => ({ left: p.text, right: matchOf[i] >= 0 && rights[matchOf[i]] != null ? rights[matchOf[i]] : '' }));
        const missingMatch = matchOf.filter(i => i < 0).length;
        if (missingMatch) warn('warning', missingMatch + ' matching prompt(s) had no readable match. Fill them in the editor.');
        const usedR = new Set(matchOf.filter(i => i >= 0));
        const extras = rights.filter((r, i) => !usedR.has(i) && BQ.rt.toPlain(r).trim());
        if (extras.length) {
          warn('warning', 'Extra answer' + (extras.length > 1 ? 's' : '') + ' with no prompt (' + extras.map(r => '“' + BQ.rt.summary(r, 30) + '”').join(', ') +
            ') ' + (extras.length > 1 ? 'were' : 'was') + ' left out, because the editor’s matching questions pair every answer with a prompt.');
        }
        break;
      }
      case 'FIB': {
        const ans = [];
        rules.filter(rc => !isIncorrectRule(rc)).forEach(rc => {
          if (!givesFull(rc) && !ruleSets(rc, 'SCORE').length) return;
          all(rc, 'varequal').forEach(v => { const t = v.textContent.trim(); if (t && !ans.includes(t)) ans.push(t); });
        });
        q.answers = ans.length ? ans : [''];
        if (!ans.length) warn('warning', 'No accepted answers were found. Add them in the editor.');
        break;
      }
      case 'FIB_PLUS': {
        const names = all(rblock, 'response_str').map(r => r.getAttribute('ident'));
        const byName = new Map(names.map(n => [n, []]));
        fullRules.forEach(rc => all(rc, 'varequal').forEach(v => {
          const n = v.getAttribute('respident');
          const t = v.textContent.trim();
          if (!byName.has(n)) byName.set(n, []);
          if (t && !byName.get(n).includes(t)) byName.get(n).push(t);
        }));
        q.blanks = Array.from(byName, ([name, answers]) => ({ name, answers }));
        BQ.syncBlanks(q);
        if (!BQ.blanksInText(q.text).length) warn('warning', 'The question text has no [blank] markers. Add them where the blanks go.');
        break;
      }
      case 'NUM': {
        const rule = fullRules[0];
        const val = (tag) => { const e = rule && first(rule, tag); return e ? parseFloat(e.textContent) : NaN; };
        const eq = val('varequal');
        const lo = val('vargte');
        const hi = val('varlte');
        const fmt = (x) => String(Number(x.toPrecision(12)));
        if (!isNaN(lo) && !isNaN(hi)) {
          q.num.answer = fmt(isNaN(eq) ? (lo + hi) / 2 : eq);
          const tol = Math.max(Math.abs(hi - parseFloat(q.num.answer)), Math.abs(parseFloat(q.num.answer) - lo));
          q.num.tolerance = tol ? fmt(tol) : '';
        } else if (!isNaN(eq)) q.num.answer = fmt(eq);
        else warn('warning', 'The numeric answer couldn’t be read. Enter it in the editor.');
        break;
      }
    }

    if (BQ.takesFeedback(q)) {
      all(item, 'itemfeedback').forEach(f => {
        const id = f.getAttribute('ident');
        if (id === 'correct' || id === 'incorrect') q.feedback[id] = md(rawHtml(f));
      });
    }
    return q;
  }

  /* ---------- the package ---------- */

  function parseXml(text, what) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The ' + what + ' inside this .zip couldn’t be read.');
    return doc;
  }

  /**
   * Read a question bank .zip.
   * Returns { questions, issues: [{question?, level, message}], kind, title, images }
   */
  async function read(buf) {
    const files = unzip(buf);
    // which .dat files hold questions
    let dats = [];
    if (files.has('imsmanifest.xml')) {
      const man = parseXml(utf8(await files.get('imsmanifest.xml').read()), 'manifest');
      all(man, 'resource').forEach(r => {
        const type = r.getAttribute('type') || '';
        const file = r.getAttribute('bb:file') || r.getAttributeNS('http://www.blackboard.com/content-packaging/', 'file');
        if (/^assessment\/x-bb-qti-(pool|test|survey)/.test(type) && file && files.has(file)) dats.push(file);
      });
    }
    if (!dats.length) {
      for (const [name, f] of files) {
        if (/\.(dat|xml)$/i.test(name) && f.size < 50e6 && /<questestinterop\b/.test(utf8(await f.read()).slice(0, 4000))) dats.push(name);
      }
    }
    if (!dats.length) {
      throw new Error(files.has('imsmanifest.xml')
        ? 'This .zip has no Blackboard question bank in it. Export the bank from Blackboard (Manage banks, or Pools in Original view), or use one made by this editor.'
        : 'This .zip isn’t a Blackboard question bank. Import a bank exported from Blackboard, or one made by this editor.');
    }

    const docs = [];
    let allText = '';
    for (const d of dats) {
      const text = utf8(await files.get(d).read());
      allText += text;
      docs.push(parseXml(text, 'question file'));
    }
    // pictures referenced anywhere in the questions (the HTML is escaped inside the XML)
    const xids = new Set();
    allText.replace(/bbcswebdav\/(?:[^"'\s&<>]*\/)?(xid-\d+_\d+)/gi, (m, x) => { xids.add(x.toLowerCase()); return m; });
    const { pics, images } = await loadPictures(files, xids);

    const questions = [];
    const issues = [];
    const titles = [];
    const ctx = { pics, missing: new Set(), issues, points: [], n: 0 };
    docs.forEach(doc => {
      all(doc, 'assessment').forEach(a => { const t = (a.getAttribute('title') || '').trim(); if (t) titles.push(t); });
      all(doc, 'item').forEach(item => {
        ctx.n++;
        try {
          const q = readItem(item, ctx);
          if (q) questions.push(q);
        } catch (e) {
          issues.push({ question: ctx.n, level: 'error', message: 'This question couldn’t be read, so it was skipped (' + (e.message || e) + ').' });
        }
      });
    });
    if (ctx.missing.size) issues.push({ level: 'warning', message: ctx.missing.size + ' picture(s) weren’t in the .zip, so their descriptions were kept instead.' });
    const odd = ctx.points.filter(p => Math.abs(p - 1) > 1e-9);
    if (odd.length) {
      const vals = Array.from(new Set(odd.map(p => String(Number(p.toFixed(2)))))).slice(0, 5);
      issues.push({ level: 'info', message: odd.length + ' question(s) were worth ' + vals.join(', ') + ' points in Blackboard. The editor doesn’t keep points; its question bank gives each question 1 point.' });
    }
    return { questions, issues, kind: 'Blackboard question bank', title: titles[0] || '', images };
  }

  BQ.poolRead = { read, unzip, toMarkup };
})();
