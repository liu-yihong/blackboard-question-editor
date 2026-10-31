/*
 * Visual fields: the question, choice, matching and feedback boxes.
 *
 * The fields are WYSIWYG: bold, italic, superscript, subscript, code and math are
 * shown the way students will see them. The value is still the editor's markup
 * (**bold**, _italic_, $math$, [blank] …), so Form and Text mode share one
 * representation. When the DOM is read back, a short marker such as _x_ is only
 * written when it renders exactly like the formatting on screen; otherwise the
 * field writes the equivalent tag (<em>x</em>), so what you see always matches
 * the Student view and the export. Typed characters that would otherwise be read
 * as markup (*, _, $, ^, ~, `) are escaped with a backslash.
 *
 * Tables and pictures are shown the way students will see them and edited in place:
 *   - a table is a grid of editable cells with buttons to add or remove rows
 *     and columns; it is stored as | a | b | rows;
 *   - a picture is shown as the picture; clicking it opens settings for its
 *     description (alt text), size and alignment; it is stored as
 *     <img src="name.png" alt="…" width="…" align="…">.
 *
 *   const f = BQ.richField({ value, multiline, placeholder, label, onInput, onKeyDown,
 *                            imageUrl(name), pickPicture(cb), onPastePicture(field, file) });
 *   f.value               current markup (get / set)
 *   f.wrapSelection(before, after, placeholder)
 *   f.insertText(text, selectFrom, selectTo)
 *   f.saveSelection()     remember the caret before a dialog takes focus
 *   f.insertTable(rows, cols, heading)
 *   f.insertPicture(name, { width })
 *   f.format(kind)        'bold' | 'italic' | 'sup' | 'sub' | 'code' | 'math'
 *   f.formatState()       { bold, italic, sup, sub, code } at the caret
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const IMG_TAG_RE = /<img\b((?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?)\s*\/?>/gi;
  const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  const TABLE_LINE = /^\s*\|.*\|\s*$/;
  const TABLE_RULE = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;
  const TABLE_ALIGN_LINE = /^\s*\{table\s+align\s*=\s*(left|center|right)\s*\}\s*$/i;
  const ALIGNS = ['inline', 'left', 'center', 'right'];
  const MAX_ROWS = 30, MAX_COLS = 12;

  function el(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) kid.forEach(k => k && e.append(k)); else e.append(kid);
    }
    return e;
  }
  const decode = (s) => (BQ.rt ? BQ.rt.decodeEntities(s) : s);
  const attrQ = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---------- markup ⇄ pieces ---------- */

  function readAttrs(s) {
    const out = {};
    (s || '').replace(ATTR_RE, (m, k, v) => { out[k.toLowerCase()] = v == null ? '' : v.replace(/^["']|["']$/g, ''); return ''; });
    return out;
  }
  function pictureMarkup(p) {
    let t = '<img src="' + p.src + '" alt="' + attrQ(p.alt || '') + '"';
    if (p.width) t += ' width="' + p.width + '"';
    if (p.align && p.align !== 'inline') t += ' align="' + p.align + '"';
    return t + '>';
  }
  /** Split on | that is not escaped as \|; cells keep other markup as typed. */
  function splitCells(line) {
    const s = line.trim().replace(/^\|/, '').replace(/(^|[^\\])\|$/, '$1');
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }
  function tableMarkup(t) {
    const cols = Math.max(1, ...t.rows.map(r => r.length));
    const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => String(r[i] || '').replace(/\s*\n\s*/g, ' ').replace(/(^|[^\\])\|/g, '$1\\|').trim() || ' ').join(' | ') + ' |';
    const out = [];
    if (t.align && t.align !== 'left') out.push('{table align=' + t.align + '}');
    t.rows.forEach((r, i) => {
      out.push(line(r));
      if (i === 0 && t.head) out.push('|' + Array(cols).fill('---').join('|') + '|');
    });
    if (t.rows.length === 1 && !t.head) out.push(line(Array(cols).fill('')));
    return out.join('\n');
  }
  /** Markup → [{t:'text', s} | {t:'table', rows, head}] (tables need two or more | lines, as when rendering). */
  function splitTables(value) {
    const lines = String(value || '').split('\n');
    const segs = [];
    let text = null;
    const flush = () => { if (text !== null) { segs.push({ t: 'text', s: text.join('\n') }); text = null; } };
    for (let i = 0; i < lines.length; i++) {
      if (TABLE_LINE.test(lines[i]) && i + 1 < lines.length && TABLE_LINE.test(lines[i + 1])) {
        let j = i;
        while (j < lines.length && TABLE_LINE.test(lines[j])) j++;
        const rows = lines.slice(i, j);
        const head = rows.length > 1 && TABLE_RULE.test(rows[1]);
        let align = 'left';
        const am = text && text.length ? TABLE_ALIGN_LINE.exec(text[text.length - 1]) : null;
        if (am) { align = am[1].toLowerCase(); text.pop(); if (!text.length) text = null; }
        flush();
        segs.push({ t: 'table', head, align, rows: rows.filter((r, k) => !(head && k === 1)).map(splitCells) });
        i = j - 1;
      } else {
        (text = text || []).push(lines[i]);
      }
    }
    flush();
    return segs;
  }

  /* ---------- inline formatting: markup → DOM ---------- */

  const ZWSP = '​';
  function mathHtml(tex, display) {
    const k = globalThis.katex;
    if (k && typeof k.renderToString === 'function') {
      try {
        const html = k.renderToString(tex, { output: 'mathml', displayMode: !!display, throwOnError: false, strict: 'ignore' });
        const m = /<math[\s\S]*<\/math>/.exec(html);
        if (m) return m[0];
      } catch (e) { /* fall through */ }
    }
    return BQ.rt.escapeHtml(BQ.rt.texToUnicode(tex));
  }
  function mathChip(tex, display) {
    const c = el('span', {
      class: 'rf-math' + (display ? ' rf-math-display' : ''), contenteditable: 'false', 'data-kind': 'math',
      'data-tex': tex, 'data-display': display ? '1' : null, title: 'Math: ' + tex + ' (click to edit)'
    });
    c.innerHTML = mathHtml(tex, display);
    return c;
  }
  /** Inline markup (no tables, no project pictures) → a fragment of formatted nodes. */
  function inlineFragment(s) {
    const box = document.createElement('div');
    box.innerHTML = BQ.rt.toHtml(String(s || ''), { math: 'mathml' });
    box.querySelectorAll('math').forEach(m => {
      const ann = m.querySelector('annotation');
      const tex = (ann ? ann.textContent : m.textContent).trim();
      m.replaceWith(mathChip(tex, m.getAttribute('display') === 'block'));
    });
    // a caret stop after code that ends a line, so typing there isn't stuck inside it
    box.querySelectorAll('code').forEach(c => {
      if (!c.nextSibling || (c.nextSibling.nodeType === 1 && c.nextSibling.localName === 'br')) c.after(document.createTextNode(ZWSP));
    });
    const frag = document.createDocumentFragment();
    while (box.firstChild) frag.append(box.firstChild);
    return frag;
  }

  /* ---------- inline formatting: DOM → markup ---------- */

  const ENTITY_AT = /^&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/;
  const ESCAPABLE = '\\*_$^~`[]=;|<&#';
  const isWord = (c) => !!c && /[\p{L}\p{N}_]/u.test(c);
  /** Escape typed text so it reads back literally (and stays readable in Text mode). */
  function escText(s) {
    let o = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i], p = s[i - 1] || '', n = s[i + 1] || '';
      if (c === '\\') o += !n || ESCAPABLE.includes(n) ? '\\\\' : c;
      else if (c === '$' || c === '`' || c === '^' || c === '~') o += '\\' + c;
      else if (c === '*') o += p === '*' || n === '*' || !n || !p ? '\\*' : c;
      else if (c === '_') o += p === '_' || n === '_' || (isWord(p) && isWord(n)) ? c : '\\_';
      else if (c === '<') o += !n || /[a-zA-Z\/]/.test(n) ? '\\<' : c;
      else if (c === '&') o += ENTITY_AT.test(s.slice(i)) ? '\\&' : c;
      else o += c;
    }
    return o;
  }
  const cleanText = (s) => s.replace(/​/g, '').replace(/ /g, ' ');
  const INLINE_TAG = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', strike: 's', del: 's', sup: 'sup', sub: 'sub' };
  /** Formatting carried by an element's own style (pasted from Word or Google Docs, or made by the browser). */
  function styleTags(n) {
    const st = n.style;
    if (!st) return [];
    const out = [];
    const fw = st.fontWeight;
    if (fw && (/bold/.test(fw) || +fw >= 600)) out.push('strong');
    if (st.fontStyle === 'italic') out.push('em');
    if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) out.push('u');
    if (st.verticalAlign === 'super') out.push('sup');
    else if (st.verticalAlign === 'sub') out.push('sub');
    return out;
  }
  const notBold = (n) => n.style && n.style.fontWeight && (/normal/.test(n.style.fontWeight) || +n.style.fontWeight < 600);

  /**
   * Serialize the children of `node` to markup.
   *   inline: true  → one line (table cells, single-line fields): line breaks become spaces
   *   isRoot        → the field itself: its last <br> is the browser's placeholder
   */
  function serializeChildren(node, o) {
    o = o || {};
    let out = '';
    let emitted = false;
    let afterBlock = false;
    const add = (s) => {
      if (!s) return;
      if (afterBlock) { out += '\n'; afterBlock = false; }
      out += s;
      emitted = true;
    };
    const block = (s) => {
      if (emitted) out += '\n';
      out += s;
      emitted = true;
      afterBlock = true;
    };
    const sub = (n) => serializeChildren(n, { inline: o.inline, pictureMarkup: o.pictureMarkup, tableMarkup: o.tableMarkup });
    const wrap = (tags, inner) => {
      if (!inner.trim()) return inner;
      const lead = /^\s*/.exec(inner)[0], trail = /\s*$/.exec(inner)[0];
      let mid = inner.trim();
      for (let i = tags.length - 1; i >= 0; i--) mid = '<' + tags[i] + '>' + mid + '</' + tags[i] + '>';
      return lead + mid + trail;
    };
    const walk = (parent, isRoot) => {
      const kids = Array.from(parent.childNodes);
      kids.forEach((k, i) => {
        if (k.nodeType === 3) { add(escText(cleanText(k.data))); return; }
        if (k.nodeType !== 1) return;
        const kind = k.dataset && k.dataset.kind;
        const t = k.localName;
        if (kind === 'img') { if (o.pictureMarkup) add(o.pictureMarkup(k)); return; }
        if (kind === 'table') { if (o.tableMarkup && !o.inline) block(o.tableMarkup(k)); return; }
        if (kind === 'math') {
          const tex = k.getAttribute('data-tex') || '';
          if (tex.trim()) { const d = k.getAttribute('data-display') && !o.inline ? '$$' : '$'; add(d + tex.trim() + d); }
          return;
        }
        if (t === 'br') {
          if (isRoot && i === kids.length - 1) return; // the browser's placeholder for the last line
          add(o.inline ? ' ' : '\n');
          return;
        }
        if (t === 'math') { const a = k.querySelector('annotation'); add('$' + (a ? a.textContent : k.textContent).trim() + '$'); return; }
        if (t === 'style' || t === 'script' || t === 'meta' || t === 'title' || t === 'button' || t === 'input') return;
        if (t === 'img') {
          const src = (k.getAttribute('src') || '').trim();
          if (/^https?:/i.test(src)) add('<img src="' + attrQ(src) + '" alt="' + attrQ(k.getAttribute('alt') || '') + '"' + (/^\d+$/.test(k.getAttribute('width') || '') ? ' width="' + k.getAttribute('width') + '"' : '') + '>');
          return;
        }
        if (t === 'code' || t === 'kbd' || t === 'samp' || t === 'tt') {
          const txt = cleanText(k.textContent);
          if (!txt) return;
          add(!/[`\n]/.test(txt) && !out.endsWith('\\') ? '`' + txt + '`' : '<code>' + escText(txt.replace(/\n/g, ' ')) + '</code>');
          return;
        }
        if (t === 'table') {
          // a table pasted from another program
          const rows = Array.from(k.querySelectorAll('tr')).map(tr => Array.from(tr.children).filter(c => /^t[dh]$/.test(c.localName)));
          if (!rows.length) return;
          if (o.inline) { add(rows.map(r => r.map(c => sub(c).trim()).join(' ')).join(' ')); return; }
          const head = rows[0].every(c => c.localName === 'th');
          block(tableMarkup({ head, align: 'left', rows: rows.map(r => r.map(c => sub(c).replace(/\s+/g, ' ').trim())) }));
          return;
        }
        if (t === 'ul' || t === 'ol') {
          const items = Array.from(k.children).filter(c => c.localName === 'li').map(li => sub(li).trim()).filter(Boolean);
          if (!items.length) return;
          if (o.inline) { add(items.join('; ')); return; }
          block('<' + t + '>' + items.map(x => '<li>' + x.replace(/\n/g, '<br>') + '</li>').join('') + '</' + t + '>');
          return;
        }
        if (t === 'a') {
          const href = (k.getAttribute('href') || '').trim();
          const inner = sub(k);
          add(/^(https?:|mailto:)/i.test(href) && inner.trim() ? '<a href="' + attrQ(href) + '">' + inner + '</a>' : inner);
          return;
        }
        let tags = [];
        if (INLINE_TAG[t] && !(INLINE_TAG[t] === 'strong' && notBold(k))) tags.push(INLINE_TAG[t]);
        styleTags(k).forEach(x => { if (!tags.includes(x)) tags.push(x); });
        if (tags.length) { add(wrap(tags, sub(k))); return; }
        if (/^(div|p|h[1-6]|blockquote|pre|li|tr)$/.test(t)) {
          if (emitted && !out.endsWith('\n')) add(o.inline ? ' ' : '\n');
          walk(k, false);
          if (/^(p|h[1-6]|blockquote|pre)$/.test(t) && k.nextSibling && !o.inline) add('\n');
          return;
        }
        walk(k, false);
      });
    };
    walk(node, !!o.isRoot);
    return o.inline ? out.replace(/\n/g, ' ') : out;
  }

  /* Prefer the short markers (**x**, _x_, ^x^, ~x~) wherever they render exactly like the tag. */
  const MARKER = { strong: '**', em: '_', sup: '^', sub: '~' };
  const SHORTABLE = /<(strong|em|sup|sub)>((?:(?!<\/?(?:strong|em|sup|sub)>)[\s\S])*?)<\/\1>/g;
  const normBox = typeof document !== 'undefined' ? document.createElement('template') : null;
  function rendered(markup) {
    normBox.innerHTML = BQ.rt.toHtml(markup, { math: 'latex' });
    return normBox.innerHTML;
  }
  function prettify(markup) {
    if (!/<(strong|em|sup|sub)>/.test(markup)) return markup;
    const want = rendered(markup);
    const keep = [];
    const restore = (x) => {
      for (let k = 0; k < 20 && /\u0001/.test(x); k++) x = x.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
      return x;
    };
    let s = markup;
    for (let guard = 0; guard < 200; guard++) {
      SHORTABLE.lastIndex = 0;
      const m = SHORTABLE.exec(s);
      if (!m) break;
      const mk = MARKER[m[1]];
      const cand = s.slice(0, m.index) + mk + m[2] + mk + s.slice(m.index + m[0].length);
      if (m[2].trim() && rendered(restore(cand)) === want) { s = cand; continue; }
      // keep the tag: park it behind a token so the scan moves on
      keep.push(m[0]);
      s = s.slice(0, m.index) + '\u0001' + (keep.length - 1) + '\u0001' + s.slice(m.index + m[0].length);
    }
    s = restore(s);
    return rendered(s) === want ? s : markup;
  }

  /* ---------- the field ---------- */

  function richField(opts) {
    opts = opts || {};
    const multiline = !!opts.multiline;
    const root = el('div', {
      class: 'rf rt ' + (multiline ? 'rf-multi' : 'rf-single') + (opts.className ? ' ' + opts.className : ''),
      contenteditable: 'true', role: 'textbox', 'aria-multiline': multiline ? 'true' : 'false',
      'aria-label': opts.label || null, 'data-placeholder': opts.placeholder || '', spellcheck: 'true'
    });
    root.isRichField = true;
    root.multiline = multiline;
    let saved = null;
    let lastValue = '';

    /* ----- building ----- */
    function textNodes(s, parent) {
      if (s) parent.append(inlineFragment(s));
    }
    function inlinePieces(s, parent) {
      let last = 0;
      String(s).replace(IMG_TAG_RE, (m, attrs, off) => {
        const a = readAttrs(attrs);
        if (!BQ.rt || !BQ.rt.isLocalImage(a.src)) return m;
        textNodes(s.slice(last, off), parent);
        parent.append(pictureWidget({ src: a.src.trim(), alt: decode(a.alt || ''), width: /^\d+$/.test(a.width || '') ? +a.width : null, align: ALIGNS.includes(a.align) ? a.align : 'inline' }));
        last = off + m.length;
        return m;
      });
      textNodes(s.slice(last), parent);
    }
    function setValue(v) {
      root.replaceChildren();
      const segs = multiline ? splitTables(v) : [{ t: 'text', s: String(v || '').replace(/\n/g, ' ') }];
      segs.forEach(seg => (seg.t === 'table' ? root.append(tableWidget(seg)) : inlinePieces(seg.s, root)));
      ensureTail();
      lastValue = getValue();
      markEmpty();
    }

    /* ----- reading ----- */
    const serOpts = {
      pictureMarkup: (k) => pictureMarkup(pictureData(k)),
      tableMarkup: (k) => tableMarkup(tableData(k))
    };
    function getValue() {
      return prettify(serializeChildren(root, Object.assign({ isRoot: true, inline: !multiline }, serOpts)));
    }
    Object.defineProperty(root, 'value', { get: getValue, set: setValue });

    /** Keep an editable spot after a trailing table or picture, so the caret can reach the end. */
    function ensureTail() {
      const last = root.lastChild;
      if (last && last.nodeType === 1 && last.dataset && last.dataset.kind) root.append(el('br'));
    }
    function markEmpty() {
      const empty = !root.querySelector('[data-kind]') && !root.textContent.replace(/​/g, '');
      root.toggleAttribute('data-empty', empty);
    }
    function changed() {
      ensureTail();
      markEmpty();
      const v = getValue();
      if (v === lastValue) return;
      lastValue = v;
      if (opts.onInput) opts.onInput(v);
    }
    root.addEventListener('input', changed);

    /* ----- caret helpers ----- */
    function rangeInside() {
      const sel = getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      return root.contains(r.startContainer) ? r : null;
    }
    function caretToEnd() {
      root.focus();
      const r = document.createRange();
      r.selectNodeContents(root);
      r.collapse(false);
      if (root.lastChild && root.lastChild.tagName === 'BR') r.setStartBefore(root.lastChild), r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    function ensureCaret() {
      if (!rangeInside()) caretToEnd();
    }
    root.focusEnd = caretToEnd;
    root.saveSelection = () => { const r = rangeInside(); saved = r ? r.cloneRange() : null; };
    function restoreSelection() {
      if (saved && root.contains(saved.startContainer)) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(saved);
      } else caretToEnd();
      saved = null;
    }
    /** Place a block or inline widget at the caret (outside any table cell). */
    function insertNodeAtCaret(node) {
      let r = rangeInside();
      if (!r) { caretToEnd(); r = rangeInside(); }
      const cell = r && r.startContainer.nodeType && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode).closest('[data-kind="table"]');
      if (cell && root.contains(cell)) { r = document.createRange(); r.setStartAfter(cell); r.collapse(true); }
      r.deleteContents();
      r.insertNode(node);
      ensureTail();
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(after);
    }

    /* ----- text editing API used by the toolbar ----- */
    root.wrapSelection = (before, after, placeholder) => {
      root.focus();
      ensureCaret();
      const sel = getSelection();
      const inner = sel.toString() || placeholder || '';
      document.execCommand('insertText', false, before + inner + after);
      selectBack(after.length + inner.length, after.length);
    };
    root.insertText = (text, from, to) => {
      root.focus();
      ensureCaret();
      document.execCommand('insertText', false, text);
      if (from != null) selectBack(text.length - from, text.length - (to == null ? from : to));
    };
    /** Select from `startBack` to `endBack` characters before the caret (within one text node). */
    function selectBack(startBack, endBack) {
      const sel = getSelection();
      if (!sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      const n = r.endContainer, off = r.endOffset;
      if (n.nodeType !== 3 || off < startBack) return;
      const nr = document.createRange();
      nr.setStart(n, off - startBack);
      nr.setEnd(n, off - endBack);
      sel.removeAllRanges();
      sel.addRange(nr);
    }

    /* ----- formatting commands (toolbar and shortcuts) ----- */
    const COMMANDS = { bold: 'bold', italic: 'italic', sup: 'superscript', sub: 'subscript' };
    function caretElement() {
      const r = rangeInside();
      if (!r) return null;
      const n = r.startContainer;
      return n.nodeType === 1 ? n : n.parentNode;
    }
    root.format = (kind) => {
      if (kind === 'math') { openMathPanel(null); return; }
      if (!rangeInside()) {
        if (saved && root.contains(saved.startContainer)) restoreSelection(); else caretToEnd();
      }
      if (kind === 'code') { toggleCode(); return; }
      const cmd = COMMANDS[kind];
      if (!cmd) return;
      const host = (caretElement() || root).closest('td,th,.rf');
      if (host && document.activeElement !== host) host.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
      document.execCommand(cmd, false, null);
      changed();
    };
    root.formatState = () => {
      const st = { bold: false, italic: false, sup: false, sub: false, code: false };
      const e = caretElement();
      if (!e) return st;
      for (const k in COMMANDS) { try { st[k] = document.queryCommandState(COMMANDS[k]); } catch (x) { /* ignore */ } }
      st.code = !!(e.closest('code') && root.contains(e.closest('code')));
      return st;
    };
    function toggleCode() {
      const r = rangeInside();
      if (!r) return;
      const start = caretElement();
      const code = start && start.closest('code');
      const sel = getSelection();
      if (code && root.contains(code)) {
        const t = document.createTextNode(cleanText(code.textContent));
        code.replaceWith(t);
        const nr = document.createRange();
        nr.selectNodeContents(t);
        sel.removeAllRanges(); sel.addRange(nr);
      } else if (r.collapsed) {
        const c = el('code', null, ZWSP);
        r.insertNode(c);
        const nr = document.createRange();
        nr.setStart(c.firstChild, 1); nr.collapse(true);
        sel.removeAllRanges(); sel.addRange(nr);
      } else {
        const c = el('code', null, r.toString());
        r.deleteContents();
        r.insertNode(c);
        if (!c.nextSibling) c.after(document.createTextNode(ZWSP));
        const nr = document.createRange();
        nr.selectNodeContents(c);
        sel.removeAllRanges(); sel.addRange(nr);
      }
      changed();
    }

    /* ----- math: shown rendered, edited in a small panel ----- */
    function openMathPanel(chip) {
      closePanel();
      const r0 = rangeInside();
      const range = r0 ? r0.cloneRange() : (saved && root.contains(saved.startContainer) ? saved.cloneRange() : null);
      const selText = !chip && range && !range.collapsed ? range.toString().trim() : '';
      const input = el('input', { type: 'text', class: 'inp rf-mono', placeholder: 'For example: \\frac{a}{b} or x^2', 'aria-label': 'Math in LaTeX', spellcheck: 'false', autocomplete: 'off' });
      input.value = chip ? chip.getAttribute('data-tex') : selText;
      const disp = el('input', { type: 'checkbox' });
      disp.checked = !!(chip && chip.getAttribute('data-display'));
      const prev = el('div', { class: 'rf-mprev', 'aria-live': 'polite' });
      const preview = () => {
        const v = input.value.trim();
        if (v) prev.innerHTML = mathHtml(v, disp.checked);
        else prev.replaceChildren(el('span', { class: 'rf-mhint', text: 'The math shows here the way students will see it.' }));
      };
      input.addEventListener('input', preview);
      disp.addEventListener('change', preview);
      let result = chip;
      const caretAfter = (node) => {
        root.focus();
        const nr = document.createRange();
        const nx = node && node.isConnected ? node.nextSibling : null;
        if (nx && nx.nodeType === 3) nr.setStart(nx, nx.data[0] === ZWSP ? 1 : 0);
        else if (node && node.isConnected) nr.setStartAfter(node);
        else { caretToEnd(); return; }
        nr.collapse(true);
        const sel = getSelection();
        sel.removeAllRanges(); sel.addRange(nr);
      };
      const commit = () => {
        const tex = input.value.trim();
        if (!tex) { if (chip) { chip.remove(); result = null; changed(); } closePanel(true); return; }
        const c = mathChip(tex, multiline && disp.checked);
        if (chip) chip.replaceWith(c);
        else {
          root.focus();
          let r = range && root.contains(range.startContainer) ? range : null;
          if (!r) { caretToEnd(); r = getSelection().getRangeAt(0); }
          r.deleteContents();
          r.insertNode(c);
        }
        if (!c.nextSibling || c.nextSibling.nodeType !== 3) c.after(document.createTextNode(ZWSP));
        result = c;
        ensureTail();
        changed();
        closePanel(true);
      };
      const panel = el('div', { class: 'rf-panel', role: 'dialog', 'aria-label': 'Math' },
        el('div', { class: 'rf-panel-title', text: chip ? 'Edit math' : 'Insert math' }),
        el('label', { class: 'rf-plabel' }, el('span', { text: 'LaTeX' }), input),
        multiline ? el('label', { class: 'rf-check' }, disp, ' On its own line') : null,
        prev,
        el('div', { class: 'rf-panel-actions' },
          chip ? el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: () => { chip.remove(); result = null; changed(); closePanel(true); } }) : null,
          el('button', { type: 'button', class: 'btn small', text: 'Cancel', onclick: () => closePanel(true) }),
          el('button', { type: 'button', class: 'btn small primary', text: chip ? 'Update' : 'Insert', onclick: commit })));
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(true); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
      });
      document.body.append(panel);
      const anchor = chip || null;
      const place = () => {
        let rect = anchor && anchor.isConnected ? anchor.getBoundingClientRect() : null;
        if (!rect && range) { const rr = range.getBoundingClientRect(); if (rr.width || rr.height) rect = rr; }
        if (!rect) rect = root.getBoundingClientRect();
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        let top = rect.bottom + 8;
        if (top + ph > innerHeight - 8 && rect.top - ph - 8 > 8) top = rect.top - ph - 8;
        panel.style.top = Math.max(8, top) + 'px';
        panel.style.left = Math.min(Math.max(8, rect.left), innerWidth - pw - 8) + 'px';
      };
      preview();
      place();
      if (chip) chip.classList.add('selected');
      const outside = (e) => { if (!panel.contains(e.target) && !(chip && chip.contains(e.target))) closePanel(); };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      addEventListener('scroll', place, true);
      addEventListener('resize', place);
      activePanel = {
        panel, w: chip || root,
        refocus: () => {
          if (result && result.isConnected) caretAfter(result);
          else if (range && root.contains(range.startContainer)) { root.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); }
          else caretToEnd();
        },
        cleanup: () => { document.removeEventListener('mousedown', outside, true); removeEventListener('scroll', place, true); removeEventListener('resize', place); if (chip) chip.classList.remove('selected'); }
      };
      input.focus();
      input.select();
    }
    root.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.rf-math')) e.preventDefault(); });
    root.addEventListener('click', (e) => {
      const m = e.target.closest && e.target.closest('.rf-math');
      if (m && root.contains(m)) { e.preventDefault(); openMathPanel(m); }
    });

    /* ----- keyboard, paste, drop ----- */
    root.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'u') e.preventDefault(); // no underline: Blackboard's upload format has no marker for it
        const kind = { b: 'bold', i: 'italic', m: 'math' }[k];
        if (kind) { e.preventDefault(); root.format(kind); return; }
        if (e.key === '`') { e.preventDefault(); root.format('code'); return; }
      }
      if (opts.onKeyDown) opts.onKeyDown(e);
      if (e.defaultPrevented) return;
      const inCell = e.target !== root && e.target.closest && e.target.closest('td,th');
      if (e.key === 'Enter' && !inCell) {
        e.preventDefault();
        if (multiline && !mod) {
          // a line break, plus a placeholder <br> when it lands at the very end
          document.execCommand('insertLineBreak');
          changed();
        }
      }
    });
    /** Insert markup at the caret, shown formatted. Tables and pictures rebuild the field. */
    function insertMarkup(markup, inCell) {
      if (!multiline || inCell) markup = markup.replace(/\s*\n\s*/g, ' ');
      if (!markup) return;
      if (multiline && !inCell && (/(^|\n)\s*\|.*\|\s*\n\s*\|/.test(markup) || /<img\b/i.test(markup))) {
        const token = 'RFPASTE' + Math.random().toString(36).slice(2) + 'Z';
        document.execCommand('insertText', false, token);
        const v = getValue();
        setValue(v.indexOf(token) >= 0 ? v.replace(token, () => markup) : v + markup);
        caretToEnd();
      } else if (!/[\\*_$^~`<&\n]/.test(markup)) {
        document.execCommand('insertText', false, markup);
      } else {
        const box = document.createElement('div');
        box.append(inlineFragment(markup));
        document.execCommand('insertHTML', false, box.innerHTML);
      }
      changed();
    }
    root.insertMarkup = (markup) => { root.focus(); ensureCaret(); insertMarkup(markup, !!(caretElement() && caretElement().closest('td,th'))); };
    root.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      const files = Array.from((cd && cd.files) || []).filter(f => /^image\//.test(f.type));
      e.preventDefault();
      const inCell = !!(caretElement() && caretElement().closest('td,th'));
      const html = (cd && cd.getData('text/html')) || '';
      let text = ((cd && cd.getData('text/plain')) || '').replace(/\r\n?/g, '\n');
      if (files.length && !text.trim()) {
        if (inCell) { flashNote(root, 'Pictures go outside the table. Click below the table and paste again.'); return; }
        if (opts.onPastePicture) opts.onPastePicture(root, files[0]);
        return;
      }
      if (html.trim()) {
        // keep the formatting this editor supports; drop the rest
        const box = document.createElement('div');
        box.innerHTML = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|script|meta|title|head|xml)\b[\s\S]*?<\/\1>/gi, '');
        box.querySelectorAll('img:not([data-kind] img)').forEach(i => i.remove());
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach(t => { if (!t.parentNode.closest('pre')) t.data = t.data.replace(/[\t\n\r ]+/g, ' '); });
        const mk = prettify(serializeChildren(box, Object.assign({ inline: !multiline || inCell }, serOpts))).replace(/^\s+|\s+$/g, '');
        if (mk || !text) { insertMarkup(mk, inCell); return; }
      }
      // plain text is read as markup, as in Text mode (so **bold** or $x^2$ pasted from there keeps its formatting)
      insertMarkup(text, inCell);
    });
    root.addEventListener('drop', (e) => {
      // dropped text arrives as plain text; dropped files are handled by the app
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) return;
      const text = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      caretFromPoint(e.clientX, e.clientY);
      document.execCommand('insertText', false, multiline ? text : text.replace(/\s*\n\s*/g, ' '));
    });
    root.caretFromPoint = caretFromPoint;
    function caretFromPoint(x, y) {
      let r = null;
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
      }
      if (r && root.contains(r.startContainer)) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return true;
      }
      return false;
    }

    /* ----- tables ----- */
    function tableData(w) {
      const rows = Array.from(w.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(c => prettify(serializeChildren(c, { inline: true })).trim()));
      return { rows, head: w.dataset.head === 'true', align: w.dataset.align || 'left' };
    }
    function cellEl(tag, text) {
      const c = el(tag, { contenteditable: 'true', spellcheck: 'true' });
      if (text) c.append(inlineFragment(text));
      return c;
    }
    function tableWidget(t) {
      const rows = t.rows.length ? t.rows : [['', '']];
      const cols = Math.max(1, ...rows.map(r => r.length));
      const table = el('table', { class: 'rf-grid' });
      rows.forEach((r, i) => {
        const tr = el('tr');
        for (let c = 0; c < cols; c++) tr.append(cellEl(i === 0 && t.head ? 'th' : 'td', r[c]));
        table.append(tr);
      });
      const talign = ['left', 'center', 'right'].includes(t.align) ? t.align : 'left';
      const w = el('div', { class: 'rf-table talign-' + talign, contenteditable: 'false', 'data-kind': 'table', 'data-head': t.head ? 'true' : 'false', 'data-align': talign });
      const alignBtns = ['left', 'center', 'right'].map(a => el('button', {
        type: 'button', class: 'rf-tbtn rf-talign', 'aria-pressed': String(a === talign),
        title: 'Align the table ' + a, 'aria-label': 'Align the table ' + a, text: a[0].toUpperCase() + a.slice(1),
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => {
          e.preventDefault();
          w.dataset.align = a;
          w.className = w.className.replace(/\btalign-\w+/, 'talign-' + a);
          alignBtns.forEach(b => b.setAttribute('aria-pressed', String(b.textContent.toLowerCase() === a)));
          done();
        }
      }));
      let current = null;
      const where = () => {
        const cell = current && w.contains(current) ? current : table.rows[table.rows.length - 1].cells[0];
        return { row: cell.parentNode.rowIndex, col: cell.cellIndex };
      };
      const focusCell = (r, c) => {
        const row = table.rows[Math.max(0, Math.min(r, table.rows.length - 1))];
        const cell = row.cells[Math.max(0, Math.min(c, row.cells.length - 1))];
        cell.focus();
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      };
      const done = () => { updateCount(); changed(); };
      const addRow = (at) => {
        const tr = el('tr');
        for (let c = 0; c < table.rows[0].cells.length; c++) tr.append(cellEl('td', ''));
        const ref = table.rows[at];
        if (ref) ref.parentNode.insertBefore(tr, ref); else table.rows[table.rows.length - 1].parentNode.append(tr);
        done();
      };
      const addCol = (at) => {
        Array.from(table.rows).forEach((tr, i) => {
          const c = cellEl(i === 0 && w.dataset.head === 'true' ? 'th' : 'td', '');
          tr.insertBefore(c, tr.cells[at] || null);
        });
        done();
      };
      const btn = (label, title, fn, cls) => el('button', {
        type: 'button', class: 'rf-tbtn' + (cls ? ' ' + cls : ''), title, 'aria-label': title, text: label,
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => { e.preventDefault(); fn(); }
      });
      const headBox = el('input', { type: 'checkbox', checked: t.head || null, 'aria-label': 'First row is a heading row' });
      headBox.addEventListener('change', () => {
        w.dataset.head = headBox.checked ? 'true' : 'false';
        Array.from(table.rows[0].cells).forEach(c => {
          const n = cellEl(headBox.checked ? 'th' : 'td', '');
          while (c.firstChild) n.append(c.firstChild);
          c.replaceWith(n);
        });
        done();
      });
      const count = el('span', { class: 'rf-tcount' });
      const updateCount = () => { count.textContent = table.rows.length + ' × ' + table.rows[0].cells.length; };
      const bar = el('div', { class: 'rf-tbar' },
        el('span', { class: 'rf-tlabel', text: 'Table' }), count,
        btn('+ Row', 'Add a row below the current cell', () => { const p = where(); if (table.rows.length >= MAX_ROWS) return; addRow(p.row + 1); focusCell(p.row + 1, p.col); }),
        btn('+ Column', 'Add a column right of the current cell', () => { const p = where(); if (table.rows[0].cells.length >= MAX_COLS) return; addCol(p.col + 1); focusCell(p.row, p.col + 1); }),
        btn('− Row', 'Remove the current row', () => {
          const p = where();
          if (table.rows.length <= 1) return;
          table.rows[p.row].remove();
          if (p.row === 0 && w.dataset.head === 'true') headBox.checked = false, w.dataset.head = 'false';
          done(); focusCell(p.row, p.col);
        }),
        btn('− Column', 'Remove the current column', () => {
          const p = where();
          if (table.rows[0].cells.length <= 1) return;
          Array.from(table.rows).forEach(tr => tr.cells[p.col] && tr.cells[p.col].remove());
          done(); focusCell(p.row, p.col);
        }),
        el('label', { class: 'rf-thead', onmousedown: (e) => e.stopPropagation() }, headBox, ' Heading row'),
        el('span', { class: 'rf-tgroup', role: 'group', 'aria-label': 'Table alignment' }, alignBtns),
        btn('Delete table', 'Delete this table', () => {
          const next = w.nextSibling;
          w.remove();
          if (next && next.tagName === 'BR' && !next.nextSibling && !root.querySelector('[data-kind="table"]:last-child')) { /* keep placeholder */ }
          changed();
          root.focus();
        }, 'danger'));
      w.append(bar, el('div', { class: 'rf-tscroll' }, table));
      updateCount();
      w.addEventListener('focusin', (e) => { if (e.target.matches('td,th')) { current = e.target; w.classList.add('active'); } });
      w.addEventListener('focusout', (e) => { if (!w.contains(e.relatedTarget)) w.classList.remove('active'); });
      w.addEventListener('keydown', (e) => {
        const cell = e.target.closest && e.target.closest('td,th');
        if (!cell) return;
        const r = cell.parentNode.rowIndex, c = cell.cellIndex;
        const nCols = table.rows[0].cells.length;
        if (e.key === 'Tab') {
          e.preventDefault();
          if (e.shiftKey) { if (c > 0) focusCell(r, c - 1); else if (r > 0) focusCell(r - 1, nCols - 1); return; }
          if (c < nCols - 1) focusCell(r, c + 1);
          else if (r < table.rows.length - 1) focusCell(r + 1, 0);
          else if (table.rows.length < MAX_ROWS) { addRow(r + 1); focusCell(r + 1, 0); }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (r < table.rows.length - 1) focusCell(r + 1, c);
          else if (table.rows.length < MAX_ROWS) { addRow(r + 1); focusCell(r + 1, c); }
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey) {
          const nr = r + (e.key === 'ArrowDown' ? 1 : -1);
          if (nr >= 0 && nr < table.rows.length) { e.preventDefault(); focusCell(nr, c); }
        }
      });
      w.focusFirst = () => focusCell(0, 0);
      return w;
    }
    root.insertTable = (rows, cols, head, align) => {
      rows = Math.max(1, Math.min(MAX_ROWS, rows | 0));
      cols = Math.max(1, Math.min(MAX_COLS, cols | 0));
      restoreSelection();
      const w = tableWidget({ head: !!head, align, rows: Array.from({ length: rows }, () => Array(cols).fill('')) });
      insertNodeAtCaret(w);
      changed();
      w.focusFirst();
    };

    /* ----- pictures ----- */
    function pictureData(w) {
      return { src: w.dataset.src, alt: w.dataset.alt || '', width: w.dataset.width ? +w.dataset.width : null, align: w.dataset.align || 'inline' };
    }
    function applyPicture(w, p) {
      w.dataset.src = p.src;
      w.dataset.alt = p.alt || '';
      if (p.width) w.dataset.width = String(p.width); else delete w.dataset.width;
      w.dataset.align = p.align || 'inline';
      w.className = 'rf-img align-' + (p.align || 'inline');
      const url = opts.imageUrl ? opts.imageUrl(p.src) : null;
      const img = w.querySelector('img');
      const missing = w.querySelector('.rf-missing');
      if (url) {
        if (missing) missing.remove();
        img.hidden = false;
        if (img.getAttribute('src') !== url) img.src = url;
        img.alt = p.alt || '';
        img.style.width = p.width ? p.width + 'px' : '';
      } else {
        img.hidden = true;
        if (!missing) w.append(el('span', { class: 'rf-missing', text: 'Missing picture: ' + p.src }));
      }
      w.title = (p.alt ? p.alt + ' · ' : '') + 'Click to change the description, size or alignment';
    }
    function pictureWidget(p) {
      const w = el('span', { contenteditable: 'false', 'data-kind': 'img', tabindex: '0', role: 'button', 'aria-label': 'Picture' + (p.alt ? ': ' + p.alt : '') + '. Press Enter for settings.' },
        el('img', { draggable: 'false' }));
      applyPicture(w, p);
      w.addEventListener('mousedown', (e) => e.preventDefault());
      w.addEventListener('click', (e) => { e.preventDefault(); openPicturePanel(w); });
      w.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openPicturePanel(w); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); w.remove(); changed(); root.focus(); }
      });
      return w;
    }
    root.insertPicture = (name, o) => {
      restoreSelection();
      const w = pictureWidget({ src: name, alt: '', width: o && o.width ? o.width : null, align: 'inline' });
      insertNodeAtCaret(w);
      changed();
      openPicturePanel(w, true);
    };

    function openPicturePanel(w, isNew) {
      closePanel();
      const p = pictureData(w);
      const img = w.querySelector('img');
      const natural = () => (img && img.naturalWidth) || p.width || 400;
      const set = (patch) => { Object.assign(p, patch); applyPicture(w, p); changed(); sizeLabel(); };
      const alt = el('input', { type: 'text', class: 'inp', value: p.alt, placeholder: 'For example: Bar chart of sales by region, 2020–2025' });
      alt.value = p.alt;
      alt.addEventListener('input', () => set({ alt: alt.value }));
      const pct = () => Math.round(((p.width || natural()) / natural()) * 100);
      const range = el('input', { type: 'range', min: '5', max: '100', step: '1', 'aria-label': 'Size' });
      const label = el('span', { class: 'rf-size-label' });
      const sizeLabel = () => {
        const wpx = p.width || natural();
        const hpx = img && img.naturalWidth ? Math.round(wpx * img.naturalHeight / img.naturalWidth) : null;
        label.textContent = wpx + (hpx ? ' × ' + hpx : '') + ' px (' + Math.min(100, pct()) + '%)';
        range.value = String(Math.min(100, pct()));
      };
      range.addEventListener('input', () => {
        const v = +range.value;
        set({ width: v >= 100 ? null : Math.max(16, Math.round(natural() * v / 100)) });
      });
      const preset = (txt, px) => el('button', { type: 'button', class: 'btn small', text: txt, onclick: () => set({ width: px && px < natural() ? px : null }) });
      const alignBtns = ALIGNS.map(a => el('button', {
        type: 'button', 'aria-pressed': String(p.align === a), text: { inline: 'In line', left: 'Left', center: 'Center', right: 'Right' }[a],
        title: a === 'inline' ? 'Sits in the line of text' : 'On its own line, ' + a + ' aligned',
        onclick: () => { set({ align: a }); alignBtns.forEach(b => b.setAttribute('aria-pressed', String(b === alignBtns[ALIGNS.indexOf(a)]))); }
      }));
      const panel = el('div', { class: 'rf-panel', role: 'dialog', 'aria-label': 'Picture settings' },
        el('div', { class: 'rf-panel-title', text: isNew ? 'Picture added' : 'Picture' }),
        el('label', { class: 'rf-plabel' }, el('span', { text: 'Description for screen readers' }), alt),
        el('div', { class: 'rf-plabel' }, el('span', { text: 'Size' }), el('div', { class: 'rf-size' }, range, label),
          el('div', { class: 'rf-presets' }, preset('Small', 200), preset('Medium', 360), preset('Large', 560), preset('Original', 0))),
        el('div', { class: 'rf-plabel' }, el('span', { text: 'Alignment' }), el('div', { class: 'tf rf-align', role: 'group', 'aria-label': 'Alignment' }, alignBtns)),
        el('div', { class: 'rf-panel-actions' },
          el('button', { type: 'button', class: 'btn small', text: 'Replace…', onclick: () => {
            if (!opts.pickPicture) return;
            opts.pickPicture((name) => { if (name) { set({ src: name }); img.addEventListener('load', sizeLabel, { once: true }); } });
          } }),
          el('button', { type: 'button', class: 'btn small danger', text: 'Remove', onclick: () => { closePanel(); w.remove(); changed(); root.focus(); } }),
          el('button', { type: 'button', class: 'btn small primary', text: 'Done', onclick: () => closePanel(true) })));
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(true); }
        if (e.key === 'Enter' && e.target === alt) { e.preventDefault(); closePanel(true); }
      });
      document.body.append(panel);
      const place = () => {
        const r = w.getBoundingClientRect();
        const pw = panel.offsetWidth, ph = panel.offsetHeight;
        let top = r.bottom + 8;
        if (top + ph > innerHeight - 8 && r.top - ph - 8 > 8) top = r.top - ph - 8;
        const left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
        panel.style.top = Math.max(8, top) + 'px';
        panel.style.left = left + 'px';
      };
      if (img && !img.complete) img.addEventListener('load', () => { sizeLabel(); place(); }, { once: true });
      sizeLabel();
      place();
      w.classList.add('selected');
      const outside = (e) => { if (!panel.contains(e.target) && !w.contains(e.target)) closePanel(); };
      const onScroll = () => place();
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
      addEventListener('scroll', onScroll, true);
      addEventListener('resize', onScroll);
      activePanel = { panel, w, cleanup: () => { document.removeEventListener('mousedown', outside, true); removeEventListener('scroll', onScroll, true); removeEventListener('resize', onScroll); w.classList.remove('selected'); } };
      alt.focus();
      alt.select();
    }
    function closePanel(refocus) {
      if (!activePanel) return;
      const a = activePanel;
      activePanel = null;
      a.cleanup();
      a.panel.remove();
      if (refocus && a.refocus) a.refocus();
      else if (refocus && a.w.isConnected) {
        root.focus();
        const r = document.createRange();
        r.setStartAfter(a.w);
        r.collapse(true);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }

    setValue(opts.value || '');
    return root;
  }
  let activePanel = null;

  function flashNote(anchor, text) {
    const n = el('div', { class: 'rf-note', role: 'status', text });
    anchor.parentNode.insertBefore(n, anchor.nextSibling);
    setTimeout(() => n.remove(), 3500);
  }

  BQ.richField = richField;
  BQ.richFieldParts = { splitTables, splitCells, tableMarkup, pictureMarkup };
})();
