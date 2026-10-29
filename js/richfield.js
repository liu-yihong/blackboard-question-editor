/*
 * Visual fields: the question, choice, matching and feedback boxes.
 *
 * Text stays as the editor's markup (**bold**, $math$, [blank] …), so Form and
 * Text mode still share one representation. Tables and pictures are shown the
 * way students will see them and edited in place:
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
      String(s).split('\n').forEach((part, i) => {
        if (i) parent.append(el('br'));
        if (part) parent.append(document.createTextNode(part));
      });
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
    function getValue() {
      let out = '';
      let emitted = false;
      let afterBlock = false;
      const add = (s) => {
        if (!s) return;
        if (afterBlock) { out += '\n'; afterBlock = false; }
        out += s;
        emitted = true;
      };
      const walk = (node, isRoot) => {
        const kids = Array.from(node.childNodes);
        kids.forEach((k, i) => {
          if (k.nodeType === 3) { add(k.data.replace(/ /g, ' ').replace(/​/g, '')); return; }
          if (k.nodeType !== 1) return;
          const kind = k.dataset && k.dataset.kind;
          if (kind === 'img') { add(pictureMarkup(pictureData(k))); return; }
          if (kind === 'table') {
            if (emitted) out += '\n';
            out += tableMarkup(tableData(k));
            emitted = true;
            afterBlock = true;
            return;
          }
          if (k.tagName === 'BR') {
            if (isRoot && i === kids.length - 1) return; // the browser's placeholder for the last line
            add('\n');
            return;
          }
          if (k.tagName === 'DIV' || k.tagName === 'P') {
            if (emitted && !out.endsWith('\n')) add('\n');
            walk(k, false);
            return;
          }
          walk(k, false);
        });
      };
      walk(root, true);
      return multiline ? out : out.replace(/\n/g, ' ');
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

    /* ----- keyboard, paste, drop ----- */
    root.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && /^[biu]$/i.test(e.key)) {
        // the app turns Ctrl+B / Ctrl+I into **markup**; never let the browser add <b> or <u>
        if (e.key.toLowerCase() === 'u') e.preventDefault();
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
    root.addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => /^image\//.test(f.type));
      e.preventDefault();
      if (files.length) {
        const inCell = e.target.closest && e.target.closest('td,th');
        if (inCell) { flashNote(root, 'Pictures go outside the table. Click below the table and paste again.'); return; }
        if (opts.onPastePicture) opts.onPastePicture(root, files[0]);
        return;
      }
      let text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      text = text.replace(/\r\n?/g, '\n');
      const inCell = e.target.closest && e.target.closest('td,th');
      if (!multiline || inCell) text = text.replace(/\s*\n\s*/g, ' ');
      document.execCommand('insertText', false, text);
      if (multiline && !inCell && (/(^|\n)\s*\|.*\|\s*\n\s*\|/.test(text) || /<img\b/i.test(text))) {
        setValue(getValue());
        caretToEnd();
      }
      changed();
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
      const rows = Array.from(w.querySelectorAll('tr')).map(tr => Array.from(tr.children).map(c => c.textContent.replace(/ /g, ' ').replace(/​/g, '')));
      return { rows, head: w.dataset.head === 'true', align: w.dataset.align || 'left' };
    }
    function cellEl(tag, text) {
      const c = el(tag, { contenteditable: 'true', spellcheck: 'true' });
      c.textContent = text || '';
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
          const n = cellEl(headBox.checked ? 'th' : 'td', c.textContent);
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
      if (refocus && a.w.isConnected) {
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
