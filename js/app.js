/* Blackboard Question Editor: user interface. No framework, no build step. */
(function () {
  'use strict';
  const BQ = globalThis.BQ;
  const STORE_KEY = 'bbqe:project:v1';
  const UI_KEY = 'bbqe:ui:v1';
  const XLSX_URL = (document.querySelector('meta[name="bbqe-xlsx"]') || {}).content || 'vendor/xlsx.full.min.js';

  /* ---------- tiny DOM helpers ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(k => append(el, k)); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  const ICON = {
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevronR: '<path d="M9 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  const svg = (name) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>';
  function iconBtn(icon, label, onclick, cls) {
    return h('button', { type: 'button', class: 'icon-btn' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, html: svg(icon), onclick });
  }
  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); };
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  };

  /* ---------- state ---------- */
  const DEFAULT_SETTINGS = { format: 'html', math: 'unicode', fileName: '' };
  let project = null;
  let view = 'form';
  let textStale = true;   // text mode needs regenerating from the model
  let formStale = false;  // form needs re-rendering from the model
  let lastParse = null;   // last text-mode parse (for line numbers)
  const collapsed = new Set();
  let showPreviews = true;
  let activeField = null;

  function makeProject(title, questions, settings) {
    return { title: title || '', questions: questions || [], settings: Object.assign({}, DEFAULT_SETTINGS, settings || {}) };
  }

  const OLD_SAMPLE_TITLES = ['Example: Week 3 quiz on cell biology'];
  const isOldSample = (p) => OLD_SAMPLE_TITLES.includes(p.title) || /Professor Roy|coffee (machine|roaster)/.test(JSON.stringify(p.questions));
  function sampleProject() {
    const text = [
      '1. Which enterprise system integrates finance, HR, procurement and manufacturing data in one shared database?',
      'a. Customer relationship management (CRM)', '*b. Enterprise resource planning (ERP)', 'c. Supply chain management (SCM)', 'd. Transaction processing system (TPS)', '',
      '2. Select **all** of the five components of an information system.',
      '*a. Hardware', '*b. Software', '*c. Data', '*d. Procedures', '*e. People', 'f. The department tea kettle _(Professor Liu may disagree)_', '',
      '3. In a relational database, the same foreign key value can appear in many rows of the referencing table.', 'Answer: True', '',
      '4. Clicking “Add question” 200 times in a web form is an efficient business process.', 'Answer: False', '',
      '5. A local tea shop wants to start selling loose-leaf tea online. Recommend whether it should build a custom ordering system or subscribe to a SaaS e-commerce platform. Use _total cost of ownership_ and strategic fit in your answer.',
      'Sample: Recommends SaaS for a small firm: low upfront cost, vendor handles security and updates, faster launch. Notes when custom would win: unique processes that create competitive advantage.', '',
      '6. Match each phase of the systems development life cycle (SDLC) to its main activity.',
      'a. Planning = Define the scope and check feasibility', 'b. Analysis = Gather requirements and model business processes', 'c. Design = Specify the database, interface and architecture', 'd. Implementation = Build, test and go live', 'e. Maintenance = Fix and improve the system after launch', '',
      '7. Organizing tables to reduce redundancy and avoid update anomalies is called ____.',
      'Answer: normalization; normalisation; data normalization', '',
      '8. In SQL, the [w] clause filters rows before grouping, and the [h] clause filters groups after `GROUP BY`.',
      'w: WHERE; where', 'h: HAVING; having', '',
      '9. A CRM upgrade costs 80,000 dollars and adds 100,000 dollars in profit. Using $\\text{ROI} = \\frac{\\text{gain} - \\text{cost}}{\\text{cost}} \\times 100$, what is the ROI in percent?',
      'Answer: 25', 'Tolerance: 0.5'
    ].join('\n');
    return makeProject('Example: Intro to MIS, Week 5 quiz', BQ.plain.parse(text).questions);
  }

  function loadInitial() {
    const raw = store.get(STORE_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.questions) && !isOldSample(p)) return makeProject(p.title, p.questions.map(BQ.normalizeQuestion), p.settings);
      } catch (e) { /* fall through */ }
    }
    return sampleProject();
  }

  /* ---------- change tracking & autosave ---------- */
  const autosave = debounce(() => {
    const ok = store.set(STORE_KEY, JSON.stringify(project));
    const el = $('#save-status');
    if (ok) {
      const t = new Date();
      el.textContent = 'Saved in this browser ' + t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      el.title = 'Your work is kept in this browser. Use Save project to keep a copy you can move or share.';
    } else {
      el.textContent = 'Not saved. Use Save project.';
      el.title = 'This browser is blocking storage, so your work is not kept automatically.';
    }
  }, 600);
  const refreshPanel = debounce(updatePanel, 120);

  function changed(source) {
    if (source !== 'text') textStale = true;
    autosave();
    refreshPanel();
  }

  /* ---------- rich-text toolbar & shortcuts ---------- */
  function wrapSelection(el, before, after, placeholder) {
    if (!el) return;
    after = after == null ? before : after;
    const s = el.selectionStart, e = el.selectionEnd, v = el.value;
    const sel = v.slice(s, e) || placeholder || '';
    el.value = v.slice(0, s) + before + sel + after + v.slice(e);
    el.focus();
    el.setSelectionRange(s + before.length, s + before.length + sel.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function insertText(el, text, selectFrom, selectTo) {
    const s = el.selectionStart, e = el.selectionEnd, v = el.value;
    el.value = v.slice(0, s) + text + v.slice(e);
    el.focus();
    el.setSelectionRange(s + (selectFrom == null ? text.length : selectFrom), s + (selectTo == null ? text.length : selectTo));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const FORMATS = {
    bold: ['**', '**', 'bold text'],
    italic: ['_', '_', 'italic text'],
    sup: ['^', '^', '2'],
    sub: ['~', '~', '2'],
    code: ['`', '`', 'code'],
    math: ['$', '$', 'x^2']
  };
  function toolbar(card, q, mainField) {
    const target = () => (activeField && card.contains(activeField) ? activeField : mainField);
    const b = (label, title, fn, cls) => h('button', {
      type: 'button', title, 'aria-label': title, class: cls || null,
      onmousedown: (e) => e.preventDefault(),
      onclick: fn, html: label
    });
    const fmt = (k) => () => { const f = FORMATS[k]; wrapSelection(target(), f[0], f[1], f[2]); };
    const kids = [
      b('<b>B</b>', 'Bold (Ctrl+B)', fmt('bold')),
      b('<i>I</i>', 'Italic (Ctrl+I)', fmt('italic')),
      b('x<sup>2</sup>', 'Superscript', fmt('sup')),
      b('x<sub>2</sub>', 'Subscript', fmt('sub')),
      h('span', { class: 'sep' }),
      b('<span style="font-family:var(--font-mono)">{ }</span>', 'Code', fmt('code')),
      b('∑ math', 'Math (LaTeX, Ctrl+M)', fmt('math'))
    ];
    if (q.type === 'FIB_PLUS') {
      kids.push(b('+ blank', 'Insert a blank, like [blank1]', () => {
        const names = BQ.blanksInText(q.text);
        let n = names.length + 1;
        while (names.includes('blank' + n)) n++;
        const name = 'blank' + n;
        insertText(mainField, '[' + name + ']', 1, 1 + name.length);
      }, 'tb-right'));
    } else if (q.type === 'FIB') {
      kids.push(b('+ ____', 'Insert a blank line to show where the answer goes', () => insertText(mainField, '____'), 'tb-right'));
    }
    return h('div', { class: 'rt-toolbar', role: 'toolbar', 'aria-label': 'Formatting' }, kids);
  }
  document.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('.rt')) activeField = e.target;
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveProject(); return; }
    if (e.key === 'Escape' && $('.modal-backdrop')) { closeModal(); return; }
    const t = e.target;
    if (!t.matches || !t.matches('.rt')) return;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { b: 'bold', i: 'italic', m: 'math' };
      if (map[k]) { e.preventDefault(); const f = FORMATS[map[k]]; wrapSelection(t, f[0], f[1], f[2]); return; }
      if (e.key === 'Enter') {
        const card = t.closest('.qcard');
        if (card) { e.preventDefault(); const q = findQ(card.dataset.id); addQuestion(q ? q.type : 'MC', indexOf(card.dataset.id) + 1); }
      }
    }
  });

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, 40) + 'px';
  }

  /* ---------- question cards ---------- */
  const findQ = (id) => project.questions.find(q => q.id === id);
  const indexOf = (id) => project.questions.findIndex(q => q.id === id);

  function renderList() {
    const list = $('#qlist');
    list.replaceChildren();
    if (!project.questions.length) {
      list.append(h('div', { class: 'empty' },
        h('strong', null, 'No questions yet'),
        'Add one with the buttons below, or switch to Text and paste a quiz you already wrote.'));
    }
    project.questions.forEach((q, i) => list.append(buildCard(q, i)));
    formStale = false;
  }

  function rerenderCard(q, focusSel) {
    const old = document.getElementById('card-' + q.id);
    if (!old) return renderList();
    const card = buildCard(q, indexOf(q.id));
    old.replaceWith(card);
    if (focusSel) { const f = card.querySelector(focusSel); if (f) f.focus(); }
  }

  function buildCard(q, i) {
    const isCollapsed = collapsed.has(q.id);
    const card = h('article', { class: 'qcard' + (isCollapsed ? ' collapsed' : ''), id: 'card-' + q.id, 'data-id': q.id, 'aria-label': 'Question ' + (i + 1) });

    const handle = h('span', { class: 'drag', title: 'Drag to reorder', draggable: 'true', 'aria-hidden': 'true', text: '⋮⋮' });
    handle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-bbqe-id', q.id);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setDragImage(card, 20, 20); } catch (err) { /* ignore */ }
      card.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-bbqe-id')) return;
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      card.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/x-bbqe-id');
      if (!id || id === q.id) return;
      e.preventDefault();
      const from = indexOf(id);
      const [moved] = project.questions.splice(from, 1);
      project.questions.splice(indexOf(q.id), 0, moved);
      renderList();
      changed();
    });

    const typeSel = h('select', { class: 'qtype', 'aria-label': 'Question type', onchange: (e) => {
      BQ.changeType(q, e.target.value);
      rerenderCard(q, '.qtype');
      changed();
    } }, BQ.TYPES.map(t => h('option', { value: t.code, selected: t.code === q.type }, t.label)));

    const head = h('header', { class: 'qhead' },
      handle,
      h('span', { class: 'qnum', text: String(i + 1) }),
      typeSel,
      h('span', { class: 'qstatus', 'data-role': 'status' }),
      h('span', { class: 'qsummary', 'data-role': 'summary', text: BQ.rt.summary(q.text) }),
      h('div', { class: 'qtools' },
        iconBtn('up', 'Move up', () => move(q, -1), 'mv'),
        iconBtn('down', 'Move down', () => move(q, 1), 'mv'),
        iconBtn('copy', 'Duplicate', () => duplicate(q)),
        iconBtn('trash', 'Delete', () => removeQ(q), 'del'),
        iconBtn(isCollapsed ? 'chevronR' : 'chevron', isCollapsed ? 'Expand' : 'Collapse', () => toggleCollapse(q))
      ));
    card.append(head);

    const body = h('div', { class: 'qbody' });
    card.append(body);
    if (!isCollapsed) {
      const ta = h('textarea', {
        class: 'qtext rt', rows: '2', 'aria-label': 'Question text', placeholder: placeholderFor(q.type), value: q.text,
        oninput: (e) => {
          q.text = e.target.value;
          autoGrow(e.target);
          if (q.type === 'FIB_PLUS') { BQ.syncBlanks(q); refreshBlanks(card, q); }
          touch(card, q);
        }
      });
      body.append(h('div', null,
        h('div', { class: 'field-label' }, h('span', null, 'Question'), h('span', { class: 'hint', text: hintFor(q.type) })),
        h('div', { class: 'rt-box' }, toolbar(card, q, ta), ta)));
      requestAnimationFrame(() => autoGrow(ta));
      body.append(typeEditor(card, q));
      body.append(h('ul', { class: 'qissues', 'data-role': 'issues' }));
      body.append(h('div', { class: 'qpreview', 'data-role': 'preview', hidden: !showPreviews }));
    }
    updateCardMeta(card, q);
    return card;
  }

  function placeholderFor(type) {
    return {
      MC: 'Which of the following…', MA: 'Select all that apply…', TF: 'A statement that is true or false',
      ESS: 'Ask an open question…', MAT: 'Match each item to…', FIB: 'SQL stands for Structured ____ Language.',
      FIB_PLUS: 'A [pk] identifies each row, and a [fk] links tables.', NUM: 'Calculate…'
    }[type];
  }
  function hintFor(type) {
    return {
      MC: 'Select a letter to mark the correct answer', MA: 'Select every correct letter',
      FIB_PLUS: 'Write blanks as [name]', NUM: 'Students type a number', MAT: 'Blackboard shuffles the matches'
    }[type] || '';
  }

  function touch(card, q) {
    updateCardMeta(card, q);
    changed();
  }

  function updateCardMeta(card, q) {
    const v = BQ.validate(q);
    const st = card.querySelector('[data-role="status"]');
    if (v.errors.length) { st.className = 'qstatus err'; st.textContent = v.errors.length === 1 ? '1 to fix' : v.errors.length + ' to fix'; }
    else if (v.warnings.length) { st.className = 'qstatus warn'; st.textContent = 'Check'; }
    else { st.className = 'qstatus ok'; st.textContent = 'Ready'; }
    card.classList.toggle('has-error', v.errors.length > 0);
    const sum = card.querySelector('[data-role="summary"]');
    if (sum) sum.textContent = BQ.rt.summary(q.text) || '(no question text yet)';
    const list = card.querySelector('[data-role="issues"]');
    if (list) {
      list.replaceChildren(
        ...v.errors.map(m => h('li', { class: 'err', text: m })),
        ...v.warnings.map(m => h('li', { class: 'warn', text: m })));
    }
    const pv = card.querySelector('[data-role="preview"]');
    if (pv && showPreviews) pv.innerHTML = previewHtml(q);
  }

  /* ----- per-type editors ----- */
  function typeEditor(card, q) {
    switch (q.type) {
      case 'MC': case 'MA': return choicesEditor(card, q);
      case 'TF': return tfEditor(card, q);
      case 'ESS': return essayEditor(card, q);
      case 'MAT': return matchingEditor(card, q);
      case 'FIB': return fibEditor(card, q);
      case 'FIB_PLUS': return h('div', { 'data-role': 'blanks' }, blanksEditor(card, q));
      case 'NUM': return numEditor(card, q);
    }
    return h('div');
  }

  function section(label, hint, kids) {
    return h('div', null, h('div', { class: 'field-label' }, h('span', null, label), hint ? h('span', { class: 'hint', text: hint }) : null), kids);
  }

  function choicesEditor(card, q) {
    const rows = h('div', { class: 'rows' });
    const redraw = (focusIndex) => {
      rows.replaceChildren(...q.options.map((o, idx) => choiceRow(card, q, o, idx, redraw)));
      if (focusIndex != null) { const inp = rows.querySelectorAll('input')[focusIndex]; if (inp) inp.focus(); }
    };
    redraw();
    const add = h('button', { type: 'button', class: 'btn small ghost add-row', html: svg('plus') + ' Add choice', onclick: () => {
      q.options.push({ text: '', correct: false });
      redraw(q.options.length - 1);
      touch(card, q);
    } });
    return section(q.type === 'MC' ? 'Answer choices' : 'Answer choices (one or more correct)', 'Enter adds the next choice', [rows, add]);
  }
  function choiceRow(card, q, o, idx, redraw) {
    const bubble = h('button', {
      type: 'button', class: 'bubble' + (q.type === 'MA' ? ' square' : ''), 'aria-pressed': String(!!o.correct),
      'aria-label': 'Mark choice ' + BQ.letter(idx) + ' as correct', title: o.correct ? 'Correct answer' : 'Mark as correct', text: BQ.letter(idx),
      onclick: () => {
        if (q.type === 'MC') q.options.forEach((x, k) => { x.correct = k === idx ? !x.correct : false; });
        else o.correct = !o.correct;
        card.querySelectorAll('.bubble').forEach((b, k) => {
          b.setAttribute('aria-pressed', String(!!q.options[k].correct));
          b.title = q.options[k].correct ? 'Correct answer' : 'Mark as correct';
        });
        touch(card, q);
      }
    });
    const inp = h('input', {
      type: 'text', class: 'inp rt', value: o.text, 'aria-label': 'Choice ' + BQ.letter(idx), placeholder: 'Choice ' + BQ.letter(idx),
      oninput: (e) => { o.text = e.target.value; touch(card, q); },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          q.options.splice(idx + 1, 0, { text: '', correct: false });
          redraw(idx + 1);
          touch(card, q);
        } else if (e.key === 'Backspace' && !o.text && q.options.length > 2) {
          e.preventDefault();
          q.options.splice(idx, 1);
          redraw(Math.max(0, idx - 1));
          touch(card, q);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const all = card.querySelectorAll('.rows input');
          const t = all[idx + (e.key === 'ArrowDown' ? 1 : -1)];
          if (t) { e.preventDefault(); t.focus(); }
        }
      }
    });
    const del = iconBtn('x', 'Remove choice ' + BQ.letter(idx), () => {
      q.options.splice(idx, 1);
      redraw();
      touch(card, q);
    }, 'row-x');
    return h('div', { class: 'row' }, bubble, inp, del);
  }

  function tfEditor(card, q) {
    const mk = (val, label) => h('button', {
      type: 'button', 'aria-pressed': String(q.tf === val), text: label,
      onclick: (e) => {
        q.tf = val;
        e.target.parentNode.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === e.target)));
        touch(card, q);
      }
    });
    return section('Correct answer', null, h('div', { class: 'tf', role: 'group', 'aria-label': 'Correct answer' }, mk(true, 'True'), mk(false, 'False')));
  }

  function essayEditor(card, q) {
    const ta = h('textarea', {
      class: 'sample rt', rows: '2', value: q.sample, 'aria-label': 'Sample answer', placeholder: 'Optional. An example answer for graders.',
      oninput: (e) => { q.sample = e.target.value; autoGrow(e.target); touch(card, q); }
    });
    requestAnimationFrame(() => autoGrow(ta));
    return section('Sample answer', 'Optional', h('div', { class: 'rt-box' }, ta));
  }

  function matchingEditor(card, q) {
    const rows = h('div', { class: 'rows' });
    const redraw = (focus) => {
      rows.replaceChildren(...q.pairs.map((p, idx) => {
        const mk = (side, ph) => h('input', {
          type: 'text', class: 'inp rt', value: p[side], placeholder: ph + ' ' + (idx + 1), 'aria-label': ph + ' ' + (idx + 1),
          oninput: (e) => { p[side] = e.target.value; touch(card, q); },
          onkeydown: (e) => {
            if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (side === 'left') { rows.querySelectorAll('input')[idx * 2 + 1].focus(); return; }
              q.pairs.splice(idx + 1, 0, { left: '', right: '' });
              redraw((idx + 1) * 2);
              touch(card, q);
            }
          }
        });
        return h('div', { class: 'row pair' }, mk('left', 'Prompt'), h('span', { class: 'pair-sep', text: '→' }), mk('right', 'Match'),
          iconBtn('x', 'Remove pair ' + (idx + 1), () => { q.pairs.splice(idx, 1); redraw(); touch(card, q); }, 'row-x'));
      }));
      if (focus != null) { const i = rows.querySelectorAll('input')[focus]; if (i) i.focus(); }
    };
    redraw();
    const add = h('button', { type: 'button', class: 'btn small ghost add-row', html: svg('plus') + ' Add pair', onclick: () => {
      q.pairs.push({ left: '', right: '' });
      redraw((q.pairs.length - 1) * 2);
      touch(card, q);
    } });
    return section('Pairs', 'Each match must be different', [rows, add]);
  }

  function listEditor(card, q, arr, label, placeholder) {
    const rows = h('div', { class: 'rows' });
    const redraw = (focus) => {
      rows.replaceChildren(...arr.map((a, idx) => h('div', { class: 'row' },
        h('input', {
          type: 'text', class: 'inp', value: a, placeholder, 'aria-label': label + ' ' + (idx + 1),
          oninput: (e) => { arr[idx] = e.target.value; touch(card, q); },
          onkeydown: (e) => {
            if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); arr.splice(idx + 1, 0, ''); redraw(idx + 1); touch(card, q); }
            else if (e.key === 'Backspace' && !arr[idx] && arr.length > 1) { e.preventDefault(); arr.splice(idx, 1); redraw(Math.max(0, idx - 1)); touch(card, q); }
          }
        }),
        iconBtn('x', 'Remove ' + label.toLowerCase(), () => { arr.splice(idx, 1); if (!arr.length) arr.push(''); redraw(); touch(card, q); }, 'row-x'))));
      if (focus != null) { const i = rows.querySelectorAll('input')[focus]; if (i) i.focus(); }
    };
    redraw();
    const add = h('button', { type: 'button', class: 'btn small ghost add-row', html: svg('plus') + ' Add another', onclick: () => { arr.push(''); redraw(arr.length - 1); touch(card, q); } });
    return [rows, add];
  }

  function fibEditor(card, q) {
    if (!q.answers.length) q.answers.push('');
    return section('Accepted answers', 'Any one of these is marked correct', listEditor(card, q, q.answers, 'Accepted answer', 'e.g. photosynthesis'));
  }

  function blanksEditor(card, q) {
    BQ.syncBlanks(q);
    if (!q.blanks.length) {
      return section('Blanks', null, h('p', { class: 'note', html: 'Write each blank into the question as <code>[name]</code>, for example <code>In SQL, [w] filters rows and [h] filters groups.</code> or use <b>+ blank</b>. A row for its answers appears here.' }));
    }
    return section('Accepted answers per blank', 'Separate alternatives with ;', h('div', { class: 'rows' }, q.blanks.map(b => h('div', { class: 'blank-row' },
      h('span', { class: 'blank-name', text: '[' + b.name + ']' }),
      h('input', {
        type: 'text', class: 'inp', value: b.answers.join('; '), placeholder: 'answer; another accepted spelling', 'aria-label': 'Answers for blank ' + b.name,
        oninput: (e) => { b.answers = BQ.plain.splitList(e.target.value); touch(card, q); }
      })))));
  }
  function refreshBlanks(card, q) {
    const holder = card.querySelector('[data-role="blanks"]');
    if (!holder) return;
    const names = q.blanks.map(b => b.name).join('|');
    if (holder.dataset.names === names) return;
    const focused = document.activeElement;
    const keep = focused && holder.contains(focused) ? focused.getAttribute('aria-label') : null;
    holder.replaceChildren(blanksEditor(card, q));
    holder.dataset.names = names;
    if (keep) { const el = holder.querySelector('[aria-label="' + keep + '"]'); if (el) el.focus(); }
  }

  function numEditor(card, q) {
    const hint = h('span', { class: 'hint' });
    const upd = () => {
      const a = parseFloat(q.num.answer), t = parseFloat(q.num.tolerance);
      if (!BQ.isNumber(q.num.answer)) hint.textContent = '';
      else if (BQ.isNumber(q.num.tolerance) && t > 0) {
        const dec = Math.max(decimals(q.num.answer), decimals(q.num.tolerance));
        hint.textContent = 'Accepts any answer from ' + (a - t).toFixed(dec) + ' to ' + (a + t).toFixed(dec) + '.';
      } else hint.textContent = 'Accepts exactly ' + q.num.answer.trim() + '.';
    };
    const mk = (key, label, ph) => h('label', { class: 'num-field' },
      h('span', { class: 'field-label', text: label }),
      h('input', { type: 'text', inputmode: 'decimal', class: 'inp', value: q.num[key], placeholder: ph, oninput: (e) => { q.num[key] = e.target.value; upd(); touch(card, q); } }));
    upd();
    return h('div', { class: 'num-grid' }, mk('answer', 'Correct answer', 'e.g. 3.14'), mk('tolerance', 'Tolerance ±', 'optional, e.g. 0.01'), hint);
  }
  const decimals = (s) => { const m = /\.(\d+)/.exec(String(s)); return m ? Math.min(m[1].length, 10) : 0; };

  /* ----- student-view preview ----- */
  function previewHtml(q) {
    const T = (s) => BQ.rt.toHtml(s || '', { math: 'preview' });
    const esc = BQ.rt.escapeHtml;
    let text = T(q.text) || '<span class="pv-empty">Question text</span>';
    if (q.type === 'FIB_PLUS') text = text.replace(/\[([A-Za-z][A-Za-z0-9_-]{0,39})\]/g, '<span class="pv-blank">$1</span>');
    let body = '';
    const empty = '<span class="pv-empty">empty</span>';
    switch (q.type) {
      case 'MC':
      case 'MA':
        body = '<ol class="pv-opts">' + q.options.map((o, i) =>
          '<li class="' + (o.correct ? 'is-correct' : '') + '"><span class="pv-mark' + (q.type === 'MA' ? ' sq' : '') + '">' + BQ.letter(i) + '</span><span>' + (T(o.text) || empty) + '</span></li>').join('') + '</ol>';
        break;
      case 'TF':
        body = '<ol class="pv-opts">' + [true, false].map(v => '<li class="' + (q.tf === v ? 'is-correct' : '') + '"><span class="pv-mark">' + (v ? 'T' : 'F') + '</span><span>' + (v ? 'True' : 'False') + '</span></li>').join('') + '</ol>';
        break;
      case 'ESS':
        body = '<div class="pv-box" style="width:100%;height:48px"></div>' + (q.sample.trim() ? '<p class="pv-key">Sample answer: ' + T(q.sample) + '</p>' : '');
        break;
      case 'MAT':
        body = '<table class="pv-mat"><tbody>' + q.pairs.map(p => '<tr><td>' + (T(p.left) || empty) + '</td><td class="arrow">→</td><td class="pv-key">' + (T(p.right) || empty) + '</td></tr>').join('') + '</tbody></table>';
        break;
      case 'FIB': {
        const a = q.answers.map(s => s.trim()).filter(Boolean);
        body = '<span class="pv-box"></span> <span class="pv-key">' + (a.length ? 'Accepts: ' + a.map(esc).join(', ') : '') + '</span>';
        break;
      }
      case 'FIB_PLUS':
        body = '<div class="pv-key">' + q.blanks.map(b => '[' + esc(b.name) + '] ' + (b.answers.length ? b.answers.map(esc).join(', ') : '–')).join(' · ') + '</div>';
        break;
      case 'NUM': {
        const t = String(q.num.tolerance).trim();
        body = '<span class="pv-box" style="width:110px"></span> <span class="pv-key">' + (q.num.answer.trim() ? 'Answer: ' + esc(q.num.answer.trim()) + (t && parseFloat(t) > 0 ? ' ± ' + esc(t) : '') : '') + '</span>';
        break;
      }
    }
    return '<div class="pv-label">Student view · correct answers highlighted</div><div class="pv-q">' + text + '</div>' + body;
  }

  /* ----- list operations ----- */
  function addQuestion(type, at) {
    const q = BQ.newQuestion(type);
    if (at == null || at > project.questions.length) at = project.questions.length;
    project.questions.splice(at, 0, q);
    if (view !== 'form') setView('form');
    renderList();
    changed();
    const card = document.getElementById('card-' + q.id);
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const ta = card.querySelector('.qtext');
      if (ta) ta.focus({ preventScroll: true });
    }
  }
  function move(q, dir) {
    const i = indexOf(q.id), j = i + dir;
    if (j < 0 || j >= project.questions.length) return;
    project.questions.splice(i, 1);
    project.questions.splice(j, 0, q);
    renderList();
    changed();
    const btn = document.querySelector('#card-' + q.id + ' .icon-btn[aria-label="' + (dir < 0 ? 'Move up' : 'Move down') + '"]');
    if (btn) btn.focus();
  }
  function duplicate(q) {
    const c = BQ.cloneQuestion(q);
    project.questions.splice(indexOf(q.id) + 1, 0, c);
    renderList();
    changed();
    flash(c.id);
    toast('Question duplicated.');
  }
  function removeQ(q) {
    const i = indexOf(q.id);
    project.questions.splice(i, 1);
    renderList();
    changed();
    toast('Question ' + (i + 1) + ' deleted.', 'Undo', () => {
      project.questions.splice(i, 0, q);
      renderList();
      changed();
      flash(q.id);
    });
  }
  function toggleCollapse(q) {
    if (collapsed.has(q.id)) collapsed.delete(q.id); else collapsed.add(q.id);
    rerenderCard(q, '.qtools .icon-btn:last-child');
  }
  function flash(id) {
    const card = document.getElementById('card-' + id);
    if (!card) return;
    card.scrollIntoView({ block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }

  /* ---------- text mode ---------- */
  function setView(v) {
    view = v;
    $('#tab-form').setAttribute('aria-selected', String(v === 'form'));
    $('#tab-text').setAttribute('aria-selected', String(v === 'text'));
    $('#form-view').hidden = v !== 'form';
    $('#text-view').hidden = v !== 'text';
    $('#btn-collapse').hidden = v !== 'form';
    $('#opt-previews').parentNode.hidden = v !== 'form';
    if (v === 'text') {
      const ta = $('#plain');
      if (textStale) {
        ta.value = BQ.plain.serialize(project.questions);
        textStale = false;
        lastParse = BQ.plain.parse(ta.value);
      }
      renderDiag();
    } else if (formStale) {
      renderList();
    }
    try { store.set(UI_KEY, JSON.stringify({ view: v, showPreviews })); } catch (e) { /* ignore */ }
  }

  const onTextInput = debounce(() => {
    const ta = $('#plain');
    const res = BQ.plain.parse(ta.value);
    if (res.convertedFromBb) {
      ta.value = BQ.plain.serialize(res.questions);
      lastParse = BQ.plain.parse(ta.value);
      toast('Converted Blackboard rows into text format.');
    } else lastParse = res;
    project.questions = lastParse.questions;
    formStale = true;
    changed('text');
    renderDiag();
  }, 300);

  function renderDiag() {
    const box = $('#text-diag');
    if (!lastParse) { box.replaceChildren(); return; }
    const items = [];
    lastParse.issues.forEach(is => items.push({ line: is.line, level: is.level === 'error' ? 'err' : is.level === 'info' ? 'info' : 'warn', text: is.message }));
    lastParse.questions.forEach((q, i) => {
      const v = BQ.validate(q);
      v.errors.forEach(m => items.push({ line: lastParse.lines[i], level: 'err', text: 'Q' + (i + 1) + ' (' + BQ.TYPE_LABEL[q.type] + '): ' + m }));
    });
    items.sort((a, b) => a.line - b.line);
    if (!items.length) {
      const n = lastParse.questions.length;
      box.replaceChildren(h('p', { class: 'ok-line', text: n ? n + (n === 1 ? ' question' : ' questions') + ' read, no problems found.' : 'Start typing, or paste a quiz.' }));
      return;
    }
    box.replaceChildren(h('ul', null, items.slice(0, 60).map(it => h('li', { class: it.level },
      h('button', { type: 'button', onclick: () => jumpToLine(it.line) }, h('span', { class: 'ln', text: 'Line ' + it.line }), it.text)))));
  }

  function jumpToLine(line) {
    const ta = $('#plain');
    const lines = ta.value.split('\n');
    let start = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    const end = start + (lines[line - 1] || '').length;
    ta.focus();
    ta.setSelectionRange(start, end);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.scrollTop = Math.max(0, (line - 4) * lh);
    ta.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- check & export panel ---------- */
  function updatePanel() {
    const qs = project.questions;
    const vals = qs.map(q => BQ.validate(q));
    const bad = vals.filter(v => v.errors.length).length;
    const ready = qs.length - bad;
    const line = $('#sum-line');
    line.replaceChildren(h('span', { class: 'big', text: String(qs.length) }), qs.length === 1 ? 'question' : 'questions',
      qs.length ? ' · ' + (bad ? ready + ' ready, ' + bad + ' to fix' : 'all ready') : '');
    const counts = {};
    qs.forEach(q => { counts[q.type] = (counts[q.type] || 0) + 1; });
    $('#sum-types').replaceChildren(...BQ.TYPES.filter(t => counts[t.code]).map(t => h('span', { class: 'chip', title: t.label, text: t.code + ' ' + counts[t.code] })));

    const list = $('#issue-list');
    const items = [];
    vals.forEach((v, i) => {
      v.errors.forEach(m => items.push(h('li', { class: 'err' }, h('button', { type: 'button', onclick: () => goTo(i) }, h('span', { class: 'qref', text: 'Q' + (i + 1) + ' ' }), m))));
      v.warnings.forEach(m => items.push(h('li', { class: 'warn' }, h('button', { type: 'button', onclick: () => goTo(i) }, h('span', { class: 'qref', text: 'Q' + (i + 1) + ' ' }), m))));
    });
    if (qs.length > BQ.bb.MAX_PER_FILE) {
      items.unshift(h('li', { class: 'warn' }, h('button', { type: 'button' }, 'More than ' + BQ.bb.MAX_PER_FILE + ' questions: the download is split into several files, because Blackboard recommends at most ' + BQ.bb.MAX_PER_FILE + ' per upload.')));
    }
    if (items.length) list.replaceChildren(...items);
    else list.replaceChildren(qs.length ? h('li', null, h('p', { class: 'all-good', text: 'No problems found.' })) : '');

    const ex = BQ.bb.exportTxt(qs, project.settings);
    const dl = $('#btn-download');
    dl.textContent = ex.parts.length > 1 ? 'Download ' + ex.parts.length + ' .txt files' : 'Download .txt' + (ex.included ? ' (' + ex.included + ')' : '');
    dl.disabled = !ex.included;
    $('#btn-copy').disabled = !ex.included;
    if ($('#raw-details').open) renderRaw(ex);
    const fn = $('#file-name');
    if (document.activeElement !== fn) fn.value = fileBase();
  }
  function renderRaw(ex) {
    const pre = $('#raw-out');
    pre.replaceChildren();
    ex = ex || BQ.bb.exportTxt(project.questions, project.settings);
    if (!ex.text) { pre.textContent = '(empty)'; return; }
    ex.rows.forEach(r => {
      r.split('\t').forEach((cell, k) => {
        if (k) pre.append(h('span', { class: 'tab', text: '→\t' }));
        pre.append(cell);
      });
      pre.append('\n');
    });
  }
  function goTo(i) {
    if (view === 'text' && lastParse) { jumpToLine(lastParse.lines[i] || 1); return; }
    const q = project.questions[i];
    if (!q) return;
    if (collapsed.has(q.id)) { collapsed.delete(q.id); rerenderCard(q); }
    flash(q.id);
    const card = document.getElementById('card-' + q.id);
    const ta = card && card.querySelector('.qtext');
    if (ta) ta.focus({ preventScroll: true });
  }

  function slug(s) {
    return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  }
  function fileBase() {
    return project.settings.fileName || slug(project.title) || 'blackboard-questions';
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function doDownload(includeInvalid) {
    const ex = BQ.bb.exportTxt(project.questions, project.settings, { includeInvalid });
    if (ex.skipped.length && !includeInvalid) {
      openModal({
        title: ex.skipped.length === 1 ? '1 question needs fixing' : ex.skipped.length + ' questions need fixing',
        body: [
          h('p', null, 'Blackboard rejects questions with these problems, so they will be left out of the file. The other ' + ex.included + ' will be included.'),
          h('ul', null, ex.skipped.slice(0, 12).map(s => h('li', null, 'Q' + (s.index + 1) + ': ' + s.errors[0])))
        ],
        actions: [
          { label: 'Fix them first', onclick: () => { closeModal(); goTo(ex.skipped[0].index); } },
          { label: 'Download ' + ex.included, primary: true, disabled: !ex.included, onclick: () => { closeModal(); saveTxt(ex); } }
        ]
      });
      return;
    }
    saveTxt(ex);
  }
  function saveTxt(ex) {
    const base = fileBase();
    if (ex.parts.length <= 1) {
      download(base + '.txt', ex.text);
      toast('Downloaded ' + base + '.txt with ' + ex.included + (ex.included === 1 ? ' question.' : ' questions.'));
    } else {
      ex.parts.forEach((p, i) => setTimeout(() => download(base + '-part' + (i + 1) + '.txt', p), i * 400));
      toast('Downloaded ' + ex.parts.length + ' files. Upload them one at a time.');
    }
  }

  async function copyTxt() {
    const ex = BQ.bb.exportTxt(project.questions, project.settings);
    try {
      await navigator.clipboard.writeText(ex.text);
      toast('Copied ' + ex.included + (ex.included === 1 ? ' question.' : ' questions.') + ' Paste into a text editor and save as .txt.');
    } catch (e) {
      const d = $('#raw-details');
      d.open = true;
      renderRaw(ex);
      const pre = $('#raw-out');
      const r = document.createRange();
      r.selectNodeContents(pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      pre.focus();
      toast('Press Ctrl+C (or ⌘C) to copy the selected text.');
    }
  }

  function testFile() {
    const qs = BQ.plain.parse([
      '1. Formatting test: **bold**, _italic_, x^2^, H~2~O, and a line break.',
      'This is the second line.',
      '*a. **Bold choice** (correct)', 'b. Plain choice', '',
      '2. Math test: $\\frac{a}{b} + \\sqrt{x^2+1} \\le \\pi r^2$',
      '*a. $\\alpha \\cdot \\beta$ (correct)', 'b. alpha times beta', '',
      '3. Special characters: café, naïve, 5 < 7, R&D, “curly quotes”, 30 °C.',
      'Answer: True'
    ].join('\n')).questions;
    const ex = BQ.bb.exportTxt(qs, project.settings);
    download('formatting-test.txt', ex.text);
    openModal({
      title: 'Try the test file once',
      body: [
        h('p', null, 'Upload formatting-test.txt into a practice test in Blackboard Ultra and look at the three questions.'),
        h('ul', null,
          h('li', null, 'If you see tags such as <strong> or <br>, switch Formatting to Plain text.'),
          h('li', null, 'If the equations look wrong, switch Math to Unicode text.'),
          h('li', null, 'If accented letters look garbled, tell your Blackboard support team the file is UTF-8.')),
        h('p', { class: 'fineprint' }, 'If nothing downloaded, this page is running inside a preview that blocks downloads. Open the hosted version instead.')
      ],
      actions: [{ label: 'Done', primary: true, onclick: closeModal }]
    });
  }

  /* ---------- project files & import ---------- */
  function saveProject() {
    const data = { app: 'blackboard-question-editor', version: 1, savedAt: new Date().toISOString(), project };
    const name = fileBase() + '.bbq.json';
    download(name, JSON.stringify(data, null, 2), 'application/json');
    toast('Saved ' + name + '. Open it later with Open project.');
  }

  function loadProject(p) {
    project = makeProject(p.title, (p.questions || []).map(BQ.normalizeQuestion), p.settings);
    collapsed.clear();
    applyProjectToUi();
    changed();
  }

  function applyProjectToUi() {
    $('#set-title').value = project.title;
    $('#fmt-' + (project.settings.format === 'plain' ? 'plain' : 'html')).checked = true;
    $('#math-' + (['unicode', 'mathml', 'latex'].includes(project.settings.math) ? project.settings.math : 'unicode')).checked = true;
    $('#file-name').value = fileBase();
    textStale = true;
    if (view === 'text') setView('text'); else renderList();
    updatePanel();
  }

  function readFileText(file) {
    return file.arrayBuffer().then(buf => {
      let text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('\uFFFD')) {
        try { text = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* keep utf-8 */ }
      }
      return text;
    });
  }

  let xlsxPromise = null;
  function loadXlsx() {
    if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const s = h('script', { src: XLSX_URL });
        s.onload = () => (globalThis.XLSX ? resolve(globalThis.XLSX) : reject(new Error('Spreadsheet reader failed to load.')));
        s.onerror = () => { xlsxPromise = null; reject(new Error('Could not load the spreadsheet reader. Save the sheet as CSV and open that instead.')); };
        document.head.append(s);
      });
    }
    return xlsxPromise;
  }

  /** Parse text that may be Blackboard rows, CSV, or a plain-text quiz. */
  function parseAny(text, filename) {
    if (/\.(csv|tsv)$/i.test(filename || '') || BQ.bb.looksLikeBb(text)) {
      return Object.assign({ kind: 'Blackboard rows' }, BQ.bb.parse(text, { filename }));
    }
    const p = BQ.plain.parse(text);
    if (p.questions.length) return Object.assign({ kind: 'text quiz' }, p);
    const b = BQ.bb.parse(text, { filename });
    return Object.assign({ kind: 'Blackboard rows' }, b);
  }

  async function openFile(file) {
    try {
      if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(await readFileText(file));
        const p = data && (data.project || data);
        if (!p || !Array.isArray(p.questions)) throw new Error('This file is not a saved project. To add questions from it, use Import questions.');
        const apply = () => { loadProject(p); toast('Opened ' + file.name + '.'); };
        if (project.questions.length) {
          openModal({
            title: 'Open ' + file.name + '?',
            body: [h('p', null, 'This replaces the ' + project.questions.length + ' questions you are editing now. Save a project file first if you want to keep them.')],
            actions: [{ label: 'Cancel', onclick: closeModal }, { label: 'Open', primary: true, onclick: () => { closeModal(); apply(); } }]
          });
        } else apply();
        return;
      }
      let res;
      if (/\.xlsx?$/i.test(file.name)) {
        const X = await loadXlsx();
        const wb = X.read(await file.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map((cells, i) => ({ line: i + 1, cells: cells.map(String) }));
        res = Object.assign({ kind: 'spreadsheet rows' }, BQ.bb.parseRows(rows));
      } else {
        res = parseAny(await readFileText(file), file.name);
      }
      showImportResult(res, file.name);
    } catch (err) {
      openModal({ title: 'Couldn’t open ' + file.name, body: [h('p', null, err.message || String(err))], actions: [{ label: 'OK', primary: true, onclick: closeModal }] });
    }
  }

  function importSummary(res, name) {
    const n = res.questions.length;
    const problems = res.issues.filter(i => i.level !== 'info');
    const invalid = res.questions.filter(q => BQ.validate(q).errors.length).length;
    return h('div', { class: 'result' },
      h('p', null, n ? 'Found ' + n + (n === 1 ? ' question' : ' questions') + ' in ' + name + ' (read as ' + res.kind + ').' : 'No questions found in ' + name + '.'),
      invalid ? h('p', null, invalid + ' of them need fixing after import; they are flagged in the editor.') : null,
      res.issues.length ? h('ul', null, res.issues.slice(0, 10).map(i => h('li', null, 'Line ' + i.line + ': ' + i.message)), res.issues.length > 10 ? h('li', null, '…and ' + (res.issues.length - 10) + ' more') : null) : null,
      problems.length && !n ? h('p', null, 'Check that each row starts with a type code such as MC, or that each question starts with a number like “1.”') : null);
  }

  function importActions(res) {
    const n = res.questions.length;
    return [
      { label: 'Cancel', onclick: closeModal },
      { label: 'Replace all', disabled: !n, onclick: () => { closeModal(); project.questions = res.questions; collapsed.clear(); afterImport(n, 'Replaced with'); } },
      { label: 'Add to end', primary: true, disabled: !n, onclick: () => { closeModal(); project.questions = project.questions.concat(res.questions); afterImport(n, 'Added'); } }
    ];
  }
  function afterImport(n, verb) {
    textStale = true;
    if (view === 'text') setView('text'); else renderList();
    changed();
    toast(verb + ' ' + n + (n === 1 ? ' question.' : ' questions.'));
  }

  function showImportResult(res, name) {
    openModal({ title: 'Import questions', body: [importSummary(res, name)], actions: importActions(res) });
  }

  function pasteRowsModal() {
    const ta = h('textarea', { 'aria-label': 'Rows to import', placeholder: 'MC\tWhich system records daily transactions?\tDSS\tincorrect\tTPS\tcorrect…', spellcheck: 'false' });
    const out = h('div');
    const actionsHolder = h('div', { class: 'modal-actions' });
    let res = { questions: [], issues: [], kind: '' };
    const update = () => {
      res = ta.value.trim() ? parseAny(ta.value, '') : { questions: [], issues: [], kind: '' };
      out.replaceChildren(ta.value.trim() ? importSummary(res, 'the pasted text') : h('p', { class: 'fineprint', text: 'Waiting for rows…' }));
      actionsHolder.replaceChildren(...buildActions(importActions(res)));
    };
    ta.addEventListener('input', debounce(update, 200));
    openModal({
      title: 'Paste questions',
      wide: true,
      body: [
        h('p', null, 'Select the rows in your spreadsheet, copy, and paste them here. Use one row per question in the Blackboard layout: type code in the first column, question in the second, then answers. A plain-text quiz works here too.'),
        h('p', null, h('button', { type: 'button', class: 'linkish', onclick: () => { download('blackboard-questions-template.csv', BQ.bb.csvTemplate(), 'text/csv;charset=utf-8'); toast('Template downloaded. Open it in Excel or Google Sheets.'); } }, 'Download a spreadsheet template (.csv) with one example of each type')),
        ta, out
      ],
      customActions: actionsHolder
    });
    update();
    ta.focus();
  }

  /* ---------- modal & toast ---------- */
  let lastFocus = null;
  function buildActions(actions) {
    return actions.map(a => h('button', { type: 'button', class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''), disabled: !!a.disabled, onclick: a.onclick, text: a.label }));
  }
  function openModal(o) {
    closeModal();
    lastFocus = document.activeElement;
    const titleId = 'm-' + Math.random().toString(36).slice(2);
    const modal = h('div', { class: 'modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('h2', { id: titleId, text: o.title }), o.body,
      o.customActions || h('div', { class: 'modal-actions' }, buildActions(o.actions || [])));
    const bd = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === bd) closeModal(); } }, modal);
    $('#modal-root').append(bd);
    const f = modal.querySelector('textarea, input, .btn.primary, .btn');
    if (f) f.focus();
  }
  function closeModal() {
    const root = $('#modal-root');
    if (!root.firstChild) return;
    root.replaceChildren();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function toast(msg, actionLabel, action) {
    const root = $('#toast-root');
    const t = h('div', { class: 'toast', role: 'status' }, h('span', { text: msg }));
    if (actionLabel) t.append(h('button', { type: 'button', text: actionLabel, onclick: () => { t.remove(); action(); } }));
    root.append(t);
    while (root.children.length > 3) root.firstChild.remove();
    setTimeout(() => t.remove(), actionLabel ? 8000 : 4500);
  }

  function helpModal() {
    const row = (code, label, ex) => h('tr', null, h('td', null, h('code', { text: code })), h('td', { text: label }), h('td', null, h('code', { text: ex })));
    openModal({
      title: 'How this works',
      wide: true,
      body: [
        h('p', null, 'Write questions here, then download a .txt file and use ', h('b', null, 'Upload questions from file'), ' inside a Blackboard Ultra test. The file follows Blackboard’s tab-delimited format, so it also works in the Original course view.'),
        h('h3', null, 'Two ways to write'),
        h('ul', null,
          h('li', null, h('b', null, 'Form'), ': one card per question. Select a letter bubble to mark the correct answer. Press Enter in a choice to add the next one, and Ctrl+Enter (⌘+Enter) to start a new question of the same type.'),
          h('li', null, h('b', null, 'Text'), ': type or paste a whole quiz, for example from Word. The cheat sheet under the editor shows every type. Both views edit the same questions.')),
        h('h3', null, 'Formatting inside any field'),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'help-table' }, h('tbody', null,
          h('tr', null, h('th', null, 'Type this'), h('th', null, 'To get')),
          h('tr', null, h('td', null, h('code', { text: '**bold**' })), h('td', null, 'bold (Ctrl+B)')),
          h('tr', null, h('td', null, h('code', { text: '_italic_' })), h('td', null, 'italic (Ctrl+I)')),
          h('tr', null, h('td', null, h('code', { text: 'x^2^  H~2~O' })), h('td', null, 'superscript, subscript')),
          h('tr', null, h('td', null, h('code', { text: '$\\frac{1}{2}$  $$E=mc^2$$' })), h('td', null, 'math in LaTeX (Ctrl+M); preview shows it rendered')),
          h('tr', null, h('td', null, h('code', { text: '\\*  \\_  \\$' })), h('td', null, 'a literal *, _ or $'))))),
        h('h3', null, 'Question types Blackboard Ultra can upload'),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'help-table' }, h('tbody', null,
          h('tr', null, h('th', null, 'Code'), h('th', null, 'Type'), h('th', null, 'Text-mode tag')),
          row('MC', 'Multiple choice', '[MC]'), row('MA', 'Multiple answer', '[MA]'), row('TF', 'True / False', '[TF]'),
          row('ESS', 'Essay', '[ESS] or Type: E'), row('MAT', 'Matching', '[MAT] or Type: MT'), row('FIB', 'Fill in the blank', '[FIB] or Type: F'),
          row('FIB_PLUS', 'Fill in multiple blanks', '[FMB]'), row('NUM', 'Numeric', '[NUM]')))),
        h('h3', null, 'Good to know'),
        h('ul', null,
          h('li', null, 'Blackboard skips any question with an error and uploads the rest. This editor flags those problems before you download.'),
          h('li', null, 'Points, feedback and images can’t be set in an upload file. Add them in Blackboard afterwards.'),
          h('li', null, 'Blackboard recommends at most 250 questions per file; larger sets download as several files.'),
          h('li', null, 'Open project opens a project you saved earlier. Import questions reads Blackboard .txt files (to edit an old upload), CSV or Excel sheets in the same layout, and plain-text quizzes. You can also drop any of these files onto the page.'),
          h('li', null, 'Your work is saved in this browser automatically. Use Save project to keep a copy, move to another computer, or share with a colleague.')),
        h('p', { class: 'fineprint' }, 'Independent open-source tool. Not affiliated with or endorsed by Anthology Inc. or Blackboard.')
      ],
      actions: [{ label: 'Close', primary: true, onclick: closeModal }]
    });
  }

  /* ---------- credits ---------- */
  function creditsModal() {
    const item = (name, url, what) => h('li', null,
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: name }),
      h('span', { class: 'what', text: what }));
    const group = (title, items) => [h('h3', { text: title }), h('ul', { class: 'credits-list' }, items)];
    openModal({
      title: 'Credits',
      wide: true,
      body: [
        h('p', null, 'This editor stands on the shoulders of documentation writers, earlier tool builders and open-source projects. Thank you.'),
        group('File format and Blackboard behaviour', [
          item('Anthology: Upload or Import Questions (Ultra)', 'https://help.anthology.com/blackboard/instructor/en/assessments/questions/reuse-questions/upload-or-import-questions.html',
            'The tab-delimited format for all 8 question types, the 250-question guidance, and the note that uploaded questions start at 0 points.'),
          item('Anthology: QTI Packages and Question Banks', 'https://help.anthology.com/blackboard/instructor/en/assessments/questions/reuse-questions/qti-packages.html',
            'Which formats Ultra question banks can import, used to decide on the .txt export.'),
          item('Teesside University, UConn and University of Texas Permian Basin guides', 'https://eatsupport.tees.ac.uk/staff/knowledgebase/bbu-tests-upload-questions-from-a-file/',
            'Step-by-step instructor guides for uploading question files to Ultra and building them in Excel.')
        ]),
        group('Earlier tools that inspired the design', [
          item('Oklahoma Christian University Blackboard Test Generator', 'https://support.oc.edu/hc/en-us/articles/360027700892-Tests-Quizzes-Blackboard-Test-Quiz-Question-Generator-OC',
            'The “paste a quiz from Word” idea and the numbered, asterisk-marked text format. Its source code originated at Algonquin College. Text mode reads its “Type:” lines.'),
          item('NWTC Blackboard Test Question Generator', 'https://www.stockton.edu/ctld/documents/blackboard-test-question-generator.pdf',
            'Using # lines as comments.'),
          item('Newcastle University Blackboard Quiz Maker', 'https://teaching.ncl.ac.uk/bms/bb/help.html',
            'The “quiz markdown” approach of writing whole quizzes in a text editor.')
        ]),
        group('Open-source software and fonts', [
          item('KaTeX', 'https://katex.org/', 'Renders LaTeX math in previews and MathML exports. MIT licence.'),
          item('SheetJS Community Edition', 'https://sheetjs.com/', 'Reads Excel files on import. Apache 2.0 licence.'),
          item('Noto Emoji', 'https://github.com/googlefonts/noto-emoji', 'The memo emoji used as the logo and browser icon. Apache 2.0 licence, by Google.'),
          item('svgmoji', 'https://github.com/svgmoji/svgmoji', 'Packaging of the Noto Emoji artwork as SVG files. MIT licence.'),
          item('IBM Plex', 'https://github.com/IBM/plex', 'Fallback typeface, served from this site only when a device has none of the usual system fonts. SIL Open Font License.'),
          item('Fontsource', 'https://fontsource.org/', 'Packaging of the IBM Plex font files.')
        ]),
        group('Styles', [
          item('System.css by sakofchit', 'https://github.com/sakofchit/system.css', 'Inspired the System (classic Mac) style.'),
          item('98.css by Jordan Scales', 'https://github.com/jdan/98.css', 'Inspired the Windows 98 style.'),
          item('XP.css by botoxparty', 'https://github.com/botoxparty/XP.css', 'Inspired the Windows XP style.'),
          item('7.css by khang-nd', 'https://github.com/khang-nd/7.css', 'Inspired the Windows 7 style.'),
          item('Pico CSS', 'https://picocss.com/', 'Inspired the Pico style.'),
          item('MVP.css by Andy Brewer', 'https://andybrewer.github.io/mvp/', 'Inspired the MVP style.'),
          item('new.css', 'https://newcss.net/', 'Inspired the new.css style, set in the Inter typeface (SIL Open Font License), served from this site.'),
          item('Sakura by oxalorg', 'https://github.com/oxalorg/sakura', 'Inspired the Sakura style.')
        ]),
        h('p', { class: 'fineprint' }, 'Each style is re-created in this page’s own CSS rather than loading those frameworks, so the editor keeps working the same way in every look. All of them are MIT-licensed projects.'),
        group('Built with', [
          item('Claude by Anthropic', 'https://www.anthropic.com/claude', 'AI assistant that researched existing tools and wrote the first version of this code with the project owner.'),
          item('GitHub Pages', 'https://pages.github.com/', 'Free static hosting.')
        ]),
        h('p', { class: 'fineprint' }, 'Blackboard is a trademark of Anthology Inc. This is an independent project and is not affiliated with or endorsed by Anthology.')
      ],
      actions: [{ label: 'Close', primary: true, onclick: closeModal }]
    });
  }

  /* ---------- hover hints ---------- */
  function initTips() {
    const tip = h('div', { class: 'tip', role: 'tooltip', id: 'tip', hidden: true });
    document.body.append(tip);
    let cur = null, timer = null;
    const show = (el) => {
      if (el.disabled) { const box = el.closest('[data-tip]:not([disabled]):not(button)'); if (!box) return; el = box; }
      if (!el.dataset.tip) return;
      cur = el;
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
      let top = r.bottom + 8;
      if (top + t.height > innerHeight - 8) top = r.top - t.height - 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    const hide = () => { clearTimeout(timer); cur = null; tip.hidden = true; };
    document.querySelectorAll('[data-tip]').forEach(el => {
      if (el.dataset.tip) el.setAttribute('aria-description', el.dataset.tip);
      el.addEventListener('mouseenter', () => { clearTimeout(timer); timer = setTimeout(() => show(el), 350); });
      el.addEventListener('mouseleave', hide);
      el.addEventListener('focus', () => { if (el.matches(':focus-visible')) show(el); });
      el.addEventListener('blur', hide);
      el.addEventListener('click', hide);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) hide(); });
    addEventListener('scroll', hide, { passive: true });
  }

  /* ---------- appearance (Day / Night / Auto) ---------- */
  const THEME_KEY = 'bbqe:theme';
  const SKIN_KEY = 'bbqe:skin';
  const SKINS = ['studio', 'system', 'win98', 'xp', 'win7', 'pico', 'mvp', 'new', 'sakura'];
  const LIGHT_ONLY = new Set(['system', 'win98', 'xp', 'win7']);
  let themeChoice = 'auto';
  let skin = 'studio';
  function setTheme(choice, save) {
    if (choice !== 'light' && choice !== 'dark') choice = 'auto';
    themeChoice = choice;
    const lightOnly = LIGHT_ONLY.has(skin);
    const effective = lightOnly ? 'light' : choice;
    if (effective === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', effective);
    document.querySelectorAll('[data-theme-choice]').forEach(b => {
      b.setAttribute('aria-pressed', String(!lightOnly && b.dataset.themeChoice === choice));
      b.disabled = lightOnly;
    });
    const sw = $('.theme-switch');
    if (sw) sw.dataset.tip = lightOnly ? 'This style has a light look only. Day and Night work with Studio and the clean styles.' : '';
    if (save) store.set(THEME_KEY, choice);
  }
  function setSkin(name, save) {
    skin = SKINS.includes(name) ? name : 'studio';
    document.documentElement.setAttribute('data-skin', skin);
    const sel = $('#skin');
    if (sel) sel.value = skin;
    setTheme(themeChoice, false);
    if (save) store.set(SKIN_KEY, skin);
  }

  /* ---------- wire up ---------- */
  function init() {
    project = loadInitial();
    try {
      const ui = JSON.parse(store.get(UI_KEY) || '{}');
      if (typeof ui.showPreviews === 'boolean') showPreviews = ui.showPreviews;
      if (ui.view === 'text') view = 'text';
    } catch (e) { /* ignore */ }
    $('#opt-previews').checked = showPreviews;

    const addbar = $('#addbar');
    BQ.TYPES.forEach(t => addbar.append(h('button', { type: 'button', class: 'btn small', text: t.label, onclick: () => addQuestion(t.code) })));

    $('#set-title').addEventListener('input', (e) => { project.title = e.target.value; changed('title'); });
    $('#tab-form').addEventListener('click', () => setView('form'));
    $('#tab-text').addEventListener('click', () => setView('text'));
    $('#tab-form').addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { setView('text'); $('#tab-text').focus(); } });
    $('#tab-text').addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { setView('form'); $('#tab-form').focus(); } });
    $('#plain').addEventListener('input', onTextInput);
    $('#opt-previews').addEventListener('change', (e) => {
      showPreviews = e.target.checked;
      document.querySelectorAll('[data-role="preview"]').forEach(pv => {
        pv.hidden = !showPreviews;
        if (showPreviews) { const q = findQ(pv.closest('.qcard').dataset.id); if (q) pv.innerHTML = previewHtml(q); }
      });
      store.set(UI_KEY, JSON.stringify({ view, showPreviews }));
    });
    $('#btn-collapse').addEventListener('click', () => {
      const all = project.questions.every(q => collapsed.has(q.id));
      if (all) collapsed.clear(); else project.questions.forEach(q => collapsed.add(q.id));
      $('#btn-collapse').textContent = all ? 'Collapse all' : 'Expand all';
      renderList();
    });

    $('#btn-new').addEventListener('click', () => {
      openModal({
        title: 'Start a new project?',
        body: [h('p', null, 'This clears the ' + project.questions.length + ' questions you are editing. Save a project file first if you want to keep them.')],
        actions: [
          { label: 'Cancel', onclick: closeModal },
          { label: 'Save project first', onclick: () => { saveProject(); } },
          { label: 'Start new', primary: true, onclick: () => { closeModal(); loadProject(makeProject('', [BQ.newQuestion('MC')], project.settings)); $('#set-title').focus(); } }
        ]
      });
    });
    const pickFile = (accept) => { const fi = $('#file-input'); fi.accept = accept; fi.click(); };
    $('#btn-open').addEventListener('click', () => pickFile('.json'));
    $('#btn-import').addEventListener('click', () => pickFile('.txt,.tsv,.csv,.xlsx,.xls'));
    initTips();
    $('#file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) openFile(f);
    });
    $('#btn-paste').addEventListener('click', pasteRowsModal);
    $('#btn-save').addEventListener('click', saveProject);
    $('#btn-help').addEventListener('click', helpModal);
    $('#btn-credits').addEventListener('click', creditsModal);
    document.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeChoice, true)));
    themeChoice = store.get(THEME_KEY) || 'auto';
    setSkin(store.get(SKIN_KEY) || 'studio', false);
    $('#skin').addEventListener('change', (e) => {
      setSkin(e.target.value, true);
      const label = e.target.options[e.target.selectedIndex].text;
      toast('Style: ' + label + (LIGHT_ONLY.has(skin) ? '. This one has a light look only.' : '.'));
    });


    document.querySelectorAll('input[name="fmt"]').forEach(r => r.addEventListener('change', (e) => { project.settings.format = e.target.value; changed('settings'); }));
    document.querySelectorAll('input[name="math"]').forEach(r => r.addEventListener('change', (e) => {
      project.settings.math = e.target.value;
      if (e.target.value === 'mathml' && project.settings.format === 'plain') {
        project.settings.format = 'html';
        $('#fmt-html').checked = true;
        toast('MathML needs HTML formatting, so Formatting was switched to HTML.');
      }
      if (e.target.value === 'mathml' && !globalThis.katex) toast('The math renderer did not load, so math will be exported as Unicode text.');
      changed('settings');
    }));
    $('#file-name').addEventListener('input', (e) => {
      project.settings.fileName = slugKeep(e.target.value);
      changed('settings');
    });
    $('#btn-download').addEventListener('click', () => doDownload(false));
    $('#btn-copy').addEventListener('click', copyTxt);
    $('#btn-testfile').addEventListener('click', testFile);
    $('#raw-details').addEventListener('toggle', (e) => { if (e.target.open) renderRaw(); });

    // drop a file anywhere to open it
    document.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      openFile(e.dataTransfer.files[0]);
    });

    applyProjectToUi();
    setView(view);
    autosave();
  }
  const slugKeep = (s) => String(s || '').replace(/\.txt$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim();

  // Show the editor once it is drawn (css/app.css hides it while the page has the bqe-loading class).
  const start = () => { try { init(); } finally { document.documentElement.classList.remove('bqe-loading'); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
