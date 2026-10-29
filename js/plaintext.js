/*
 * Text mode: write or paste a whole quiz as plain text (for example, copied from Word).
 *
 *   1. Which organelle makes most of a cell's ATP?
 *   a. Nucleus
 *   *b. Mitochondrion          ← asterisk marks the correct answer
 *   c. Ribosome
 *
 *   2. [TF] Prokaryotes have a nucleus.
 *   Answer: False
 *
 * The question type is detected from the content; put a tag such as [ESS], [MAT],
 * [FIB], [FMB] or [NUM] right after the number to choose it yourself. "Type: E" lines
 * used by the popular OCU / Algonquin test generator are understood too.
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const TAGS = {
    MC: 'MC', MA: 'MA', TF: 'TF', 'T/F': 'TF', ESS: 'ESS', E: 'ESS', ESSAY: 'ESS', SR: 'ESS',
    MAT: 'MAT', MT: 'MAT', MATCH: 'MAT', MATCHING: 'MAT', FIB: 'FIB', F: 'FIB', FMB: 'FIB_PLUS',
    FIB_PLUS: 'FIB_PLUS', 'FIB+': 'FIB_PLUS', NUM: 'NUM', N: 'NUM', NUMERIC: 'NUM'
  };
  const SERIAL_TAG = { MC: 'MC', MA: 'MA', TF: 'TF', ESS: 'ESS', MAT: 'MAT', FIB: 'FIB', FIB_PLUS: 'FMB', NUM: 'NUM' };

  const RE_QUESTION = /^(\d{1,4})[.)](?:\s+(.*))?$/;
  const RE_OPTION = /^(\*)?\s*([a-zA-Z])[.)](?:\s+(.*))?$/;
  const RE_OPTION_STAR_AFTER = /^([a-zA-Z])[.)]\s*\*\s*(.*)$/;
  const RE_TYPE = /^type\s*:\s*(\S+)\s*$/i;
  const RE_ANSWER = /^(?:answers?|ans|correct answers?|key)\s*:\s*(.*)$/i;
  const RE_TOL = /^(?:tolerance|tol|plus\s*or\s*minus)\s*:\s*(.*)$/i;
  const RE_SAMPLE = /^(?:sample(?:\s+answer)?|example(?:\s+answer)?|model\s+answer|feedback)\s*:\s*(.*)$/i;
  const RE_IGNORED = /^(?:title|points?|pts|score)\s*:/i;
  const RE_BLANK_LINE = /^([A-Za-z][A-Za-z0-9_-]{0,39})\s*:\s*(.*)$/;
  const RE_TAG = /^\[([A-Za-z/+_]{1,9})\]\s*/;

  function mapTag(t) {
    return TAGS[String(t || '').trim().toUpperCase()] || null;
  }

  /** Split "a; b; c" (or a | b) honouring \; escapes. */
  function splitList(s) {
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && (s[i + 1] === ';' || s[i + 1] === '|')) { cur += s[i + 1]; i++; continue; }
      if (c === ';' || c === '|') { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }

  /** Split "left = right" on the first " = " (or " / ") outside $math$. */
  function splitPair(s) {
    s = String(s);
    if (/^=\s/.test(s) || s === '=') return ['', s.slice(1).trim()];
    if (/\s=$/.test(s)) return [s.slice(0, -1).trim(), ''];
    let inMath = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '$') inMath = !inMath;
      if (!inMath && (s.startsWith(' = ', i) || s.startsWith(' => ', i) || s.startsWith(' / ', i))) {
        const sepLen = s.startsWith(' => ', i) ? 4 : 3;
        return [s.slice(0, i).trim(), s.slice(i + sepLen).trim()];
      }
    }
    return null;
  }

  const plainLower = (s) => BQ.rt.toPlain(s || '').trim().toLowerCase();

  function detectType(d) {
    if (d.options.length) {
      if (d.options.every(o => splitPair(o.text))) return 'MAT';
      const words = d.options.map(o => plainLower(o.text));
      if (d.options.length === 2 && words.includes('true') && words.includes('false')) return 'TF';
      return d.options.filter(o => o.correct).length > 1 ? 'MA' : 'MC';
    }
    if (Object.keys(d.blanks).length) return 'FIB_PLUS';
    if (d.answer != null) {
      const a = plainLower(d.answer);
      if (a === 'true' || a === 'false' || a === 't' || a === 'f') return 'TF';
      if (d.tolerance != null) return 'NUM';
      const parts = splitList(d.answer);
      if (parts.length === 1 && (BQ.isNumber(parts[0]) || /^[-+]?[\d.]+\s*(±|\+\/-|\+-)\s*[\d.]+$/.test(parts[0]))) return 'NUM';
      return 'FIB';
    }
    return 'ESS';
  }

  function build(d) {
    const type = d.forced || detectType(d);
    const q = BQ.emptyQuestion(type);
    q.text = d.text.replace(/\s+$/, '');
    switch (type) {
      case 'MC':
      case 'MA':
        q.options = d.options.map(o => ({ text: o.text, correct: o.correct }));
        break;
      case 'TF': {
        let v = null;
        if (d.answer != null) {
          const a = plainLower(d.answer);
          v = a === 'true' || a === 't' ? true : a === 'false' || a === 'f' ? false : null;
        } else if (d.options.length) {
          const c = d.options.find(o => o.correct);
          if (c) { const w = plainLower(c.text); v = w === 'true' ? true : w === 'false' ? false : null; }
        }
        q.tf = v;
        break;
      }
      case 'ESS':
        q.sample = d.sample || (d.answer != null ? d.answer : '');
        break;
      case 'MAT':
        q.pairs = d.options.map(o => {
          const p = splitPair(o.text) || [o.text, ''];
          return { left: p[0], right: p[1] };
        });
        break;
      case 'FIB':
        if (d.answer != null) q.answers = splitList(d.answer);
        else q.answers = d.options.map(o => BQ.rt.toPlain(o.text)).filter(Boolean);
        break;
      case 'FIB_PLUS':
        q.blanks = BQ.blanksInText(q.text).map(n => ({ name: n, answers: d.blanks[n] != null ? splitList(d.blanks[n]) : [] }));
        break;
      case 'NUM': {
        let a = d.answer != null ? d.answer.trim() : '';
        let tol = d.tolerance != null ? d.tolerance.trim() : '';
        const m = /^([-+]?[\d.eE+-]+?)\s*(?:±|\+\/-|\+-)\s*([\d.eE+-]+)$/.exec(a);
        if (m) { a = m[1]; if (!tol) tol = m[2]; }
        q.num = { answer: a, tolerance: tol };
        break;
      }
    }
    return q;
  }

  /** Parse text mode → { questions, lines, issues, convertedFromBb } */
  function parse(text) {
    text = String(text || '');
    if (BQ.bb.looksLikeBb(text)) {
      const r = BQ.bb.parse(text);
      return { questions: r.questions, lines: r.lines, issues: r.issues, convertedFromBb: true };
    }
    const src = text.replace(/\r\n?/g, '\n').split('\n');
    const questions = [];
    const lines = [];
    const issues = [];
    let d = null;
    let target = null; // { obj, key } receiving continuation lines
    let pendingType = null;
    let gap = false;

    const finish = () => {
      if (!d) return;
      questions.push(build(d));
      lines.push(d.line);
      d = null;
      target = null;
    };
    const append = (extra) => {
      if (!target) return false;
      const cur = target.obj[target.key] || '';
      target.obj[target.key] = cur ? cur + (gap ? '\n\n' : '\n') + extra : extra;
      return true;
    };

    src.forEach((raw, idx) => {
      const ln = idx + 1;
      const t = raw.trim();
      if (!t) { gap = true; return; }
      const wasGap = gap;
      gap = false;
      if (/^(#|\/\/)/.test(t)) return;

      // escaped line: always a continuation
      if (t[0] === '\\' && /^\\(\d|[a-zA-Z][.)]|\*|[A-Za-z][\w-]*\s*:)/.test(t)) {
        gap = wasGap;
        if (!append(t.slice(1))) issues.push({ line: ln, level: 'warning', message: 'This line is outside any question and was ignored.' });
        gap = false;
        return;
      }
      let m;
      if ((m = RE_TYPE.exec(t))) {
        const ty = mapTag(m[1]);
        if (!ty) { issues.push({ line: ln, level: 'warning', message: '“' + m[1] + '” is not a type I know. Use MC, MA, TF, E, MT, F, FMB or NUM.' }); return; }
        if (d && !d.options.length && d.answer == null) d.forced = ty;
        else pendingType = ty;
        return;
      }
      if ((m = RE_QUESTION.exec(t))) {
        finish();
        let body = m[2] || '';
        let forced = pendingType;
        pendingType = null;
        const tm = RE_TAG.exec(body);
        if (tm && mapTag(tm[1])) { forced = mapTag(tm[1]); body = body.slice(tm[0].length); }
        d = { line: ln, text: body, options: [], answer: null, tolerance: null, sample: null, blanks: {}, forced };
        target = { obj: d, key: 'text' };
        return;
      }
      if (!d) {
        if (RE_IGNORED.test(t)) return;
        issues.push({ line: ln, level: 'warning', message: 'This line is outside any question and was ignored. Start each question with a number, like “1.”' });
        return;
      }
      if ((m = RE_OPTION.exec(t)) || (m = RE_OPTION_STAR_AFTER.exec(t))) {
        const star = m.length === 4 ? !!m[1] : true;
        const body = m.length === 4 ? (m[3] || '') : (m[2] || '');
        const opt = { text: body, correct: star };
        d.options.push(opt);
        target = { obj: opt, key: 'text' };
        return;
      }
      if ((m = RE_ANSWER.exec(t))) { d.answer = m[1]; target = { obj: d, key: 'answer' }; return; }
      if ((m = RE_TOL.exec(t))) { d.tolerance = m[1]; target = null; return; }
      if ((m = RE_SAMPLE.exec(t))) { d.sample = m[1]; target = { obj: d, key: 'sample' }; return; }
      if (RE_IGNORED.test(t)) {
        if (/^(points?|pts|score)\s*:/i.test(t)) issues.push({ line: ln, level: 'info', message: 'Points can’t be set in an upload file. Blackboard sets them to 0 (or the test default); adjust them after uploading.' });
        return;
      }
      if ((m = RE_BLANK_LINE.exec(t)) && BQ.blanksInText(d.text).includes(m[1])) {
        d.blanks[m[1]] = m[2];
        target = { obj: d.blanks, key: m[1] };
        return;
      }
      gap = wasGap;
      append(t);
      gap = false;
    });
    finish();
    return { questions, lines, issues, convertedFromBb: false };
  }

  /* ---------- writing text mode ---------- */

  function escapeLine(line) {
    const t = line.trimStart();
    if (RE_QUESTION.test(t) || RE_OPTION.test(t) || RE_OPTION_STAR_AFTER.test(t) || RE_ANSWER.test(t) || RE_TOL.test(t) ||
        RE_SAMPLE.test(t) || RE_TYPE.test(t) || RE_BLANK_LINE.test(t) || /^(#|\/\/)/.test(t)) return '\\' + t;
    return line;
  }
  function multiline(first, rest) {
    const ls = String(rest || '').split('\n');
    return [first + ls[0]].concat(ls.slice(1).map(l => (l.trim() ? escapeLine(l) : ''))).join('\n');
  }
  const joinList = (arr) => arr.map(a => String(a).replace(/;/g, '\\;').trim()).filter(Boolean).join('; ');

  function block(q, n, tag) {
    const out = [multiline(n + '. ' + (tag ? '[' + tag + '] ' : ''), q.text)];
    const L = (i) => (i < 26 ? String.fromCharCode(97 + i) : 'z');
    switch (q.type) {
      case 'MC':
      case 'MA':
        q.options.forEach((o, i) => out.push(multiline((o.correct ? '*' : '') + L(i) + '. ', o.text)));
        break;
      case 'TF':
        out.push('Answer: ' + (q.tf === true ? 'True' : q.tf === false ? 'False' : ''));
        break;
      case 'ESS':
        if (q.sample && q.sample.trim()) out.push(multiline('Sample: ', q.sample));
        break;
      case 'MAT':
        q.pairs.forEach((p, i) => out.push(L(i) + '. ' + String(p.left).replace(/\n/g, ' ') + ' = ' + String(p.right).replace(/\n/g, ' ')));
        break;
      case 'FIB':
        out.push('Answer: ' + joinList(q.answers));
        break;
      case 'FIB_PLUS':
        BQ.blanksInText(q.text).forEach(name => {
          const b = q.blanks.find(x => x.name === name);
          out.push(name + ': ' + joinList(b ? b.answers : []));
        });
        break;
      case 'NUM':
        out.push('Answer: ' + String(q.num.answer).trim());
        if (String(q.num.tolerance).trim()) out.push('Tolerance: ' + String(q.num.tolerance).trim());
        break;
    }
    return out.join('\n');
  }

  function serialize(questions) {
    return questions.map((q, i) => {
      let b = block(q, i + 1, null);
      const back = parse(b).questions[0];
      if (!back || back.type !== q.type) b = block(q, i + 1, SERIAL_TAG[q.type]);
      return b;
    }).join('\n\n') + (questions.length ? '\n' : '');
  }

  BQ.plain = { parse, serialize, splitList, splitPair };
})();
