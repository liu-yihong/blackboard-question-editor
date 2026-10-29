/*
 * Blackboard tab-delimited question files ("Upload questions from file").
 * Format reference: Anthology help, "Upload or Import Questions" (Ultra).
 *   - one question per row, no header row, no blank lines
 *   - first field is the type code; fields separated by TAB
 *   - correct / incorrect / true / false in English
 *   - recommended maximum 250 questions per file
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const MAX_PER_FILE = 250;
  const KNOWN = new Set(['MC', 'MA', 'TF', 'ESS', 'MAT', 'FIB', 'FIB_PLUS', 'NUM']);
  const ALIASES = { FMB: 'FIB_PLUS', 'FIB+': 'FIB_PLUS', ESSAY: 'ESS', MATCH: 'MAT', SR: 'ESS' };
  const UNSUPPORTED = {
    ORD: 'Ordering', JUMBLED_SENTENCE: 'Jumbled sentence', OP: 'Opinion scale / Likert', FIL: 'File response',
    QUIZ_BOWL: 'Quiz bowl', EOQ: 'Either/or', HS: 'Hot spot', CALC: 'Calculated formula'
  };

  /* ---------- reading ---------- */

  /** Quote-aware delimited parser (Excel quotes cells that contain tabs, quotes or line breaks). */
  function parseDelimited(text, delim) {
    const rows = [];
    const n = text.length;
    let i = 0;
    let line = 1;
    const nextStop = (k) => {
      while (k < n && text[k] !== delim && text[k] !== '\n' && text[k] !== '\r') k++;
      return k;
    };
    while (i < n) {
      const startLine = line;
      const cells = [];
      for (;;) {
        let cell;
        if (text[i] === '"') {
          let j = i + 1, buf = '', closed = false, extra = 0;
          while (j < n) {
            if (text[j] === '"') {
              if (text[j + 1] === '"') { buf += '"'; j += 2; continue; }
              closed = true; j++; break;
            }
            if (text[j] === '\n') extra++;
            buf += text[j++];
          }
          if (closed && (j >= n || text[j] === delim || text[j] === '\n' || text[j] === '\r')) {
            cell = buf.replace(/\r\n?/g, '\n');
            i = j;
            line += extra;
          } else {
            const end = nextStop(i);
            cell = text.slice(i, end);
            i = end;
          }
        } else {
          const end = nextStop(i);
          cell = text.slice(i, end);
          i = end;
        }
        cells.push(cell);
        if (i >= n) break;
        if (text[i] === delim) { i++; continue; }
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
        line++;
        break;
      }
      rows.push({ line: startLine, cells });
    }
    return rows;
  }

  function detectDelimiter(text, filename) {
    if (/\.csv$/i.test(filename || '')) return ',';
    if (text.indexOf('\t') >= 0) return '\t';
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    return /^\s*"?[A-Z_]{2,8}"?\s*,/.test(first) ? ',' : '\t';
  }

  function typeCode(cell) {
    const c = String(cell || '').trim().toUpperCase().replace(/\s+/g, '');
    return ALIASES[c] || c;
  }

  /** Does this text look like Blackboard rows rather than prose? */
  function looksLikeBb(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return false;
    const hits = lines.filter(l => /^\s*"?(MC|MA|TF|ESS|MAT|FIB|FIB_PLUS|NUM|SR|ORD|FMB)"?\s*[\t,]/i.test(l)).length;
    return hits > 0 && hits >= lines.length * 0.5;
  }

  /** rows: [{line, cells}] → { questions, issues, lines } */
  function parseRows(rows) {
    const questions = [];
    const issues = [];
    const lines = [];
    const conv = BQ.rt.htmlToMarkup;
    let seen = 0;
    rows.forEach(({ line, cells }) => {
      cells = cells.map(c => (c == null ? '' : String(c)));
      while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
      if (!cells.length) return;
      const first = seen++ === 0;
      if (first) cells[0] = cells[0].replace(/^﻿/, '');
      const raw = cells[0].trim().toUpperCase();
      const code = typeCode(cells[0]);
      if (!KNOWN.has(code)) {
        if (first && /type|question/i.test(cells.slice(0, 3).join(' '))) return; // header row
        if (UNSUPPORTED[code]) {
          issues.push({ line, level: 'warning', message: UNSUPPORTED[code] + ' questions can’t be uploaded to Ultra from a file, so this row was skipped.' });
        } else {
          issues.push({ line, level: 'error', message: '“' + cells[0].trim().slice(0, 24) + '” is not a question type. Rows must start with MC, MA, TF, ESS, MAT, FIB, FIB_PLUS or NUM.' });
        }
        return;
      }
      const f = cells.slice(1);
      const q = BQ.emptyQuestion(code);
      q.text = conv(f[0] || '');
      const rest = f.slice(1);
      switch (code) {
        case 'MC':
        case 'MA': {
          let bad = false;
          for (let k = 0; k < rest.length; k += 2) {
            const flag = String(rest[k + 1] || '').trim().toLowerCase();
            if (flag !== 'correct' && flag !== 'incorrect') bad = true;
            q.options.push({ text: conv(rest[k] || ''), correct: flag === 'correct' });
          }
          if (bad) issues.push({ line, level: 'warning', message: 'Each answer should be followed by “correct” or “incorrect”. Check the choices of this question.' });
          break;
        }
        case 'TF': {
          const v = String(rest[0] || '').trim().toLowerCase();
          q.tf = v === 'true' ? true : v === 'false' ? false : null;
          if (q.tf === null) issues.push({ line, level: 'warning', message: 'True/False answer should be “true” or “false”.' });
          break;
        }
        case 'ESS':
          q.sample = conv(rest[0] || '');
          if (raw === 'SR') issues.push({ line, level: 'info', message: 'Short answer was converted to Essay, because Ultra file upload has no short-answer type.' });
          break;
        case 'MAT':
          for (let k = 0; k < rest.length; k += 2) q.pairs.push({ left: conv(rest[k] || ''), right: conv(rest[k + 1] || '') });
          if (rest.length % 2) issues.push({ line, level: 'warning', message: 'A matching prompt has no match after it.' });
          break;
        case 'FIB':
          q.answers = rest.map(s => BQ.rt.decodeEntities(s).trim()).filter(Boolean);
          break;
        case 'FIB_PLUS': {
          let group = null;
          rest.forEach(cell => {
            const v = BQ.rt.decodeEntities(cell).trim();
            if (!v) { group = null; return; }
            if (!group) { group = { name: v.replace(/^\[|\]$/g, ''), answers: [] }; q.blanks.push(group); } else group.answers.push(v);
          });
          break;
        }
        case 'NUM':
          q.num.answer = String(rest[0] || '').trim();
          q.num.tolerance = String(rest[1] || '').trim();
          break;
      }
      questions.push(q);
      lines.push(line);
    });
    return { questions, issues, lines };
  }

  function parse(text, opts) {
    text = String(text || '').replace(/^﻿/, '');
    const delim = detectDelimiter(text, opts && opts.filename);
    return parseRows(parseDelimited(text, delim));
  }

  /* ---------- writing ---------- */

  function makeFormatter(settings) {
    const html = (settings && settings.format) !== 'plain';
    const math = (settings && settings.math) || 'unicode';
    const clean = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, html ? '<br>' : ' ').trim();
    return {
      rich: (s) => clean(html ? BQ.rt.toHtml(s, { math }) : BQ.rt.toPlain(s, { math })),
      plain: (s) => clean(BQ.rt.toPlain(s, { math: 'unicode' }))
    };
  }

  function toRow(q, settings) {
    const F = makeFormatter(settings);
    const out = [q.type, F.rich(q.text)];
    switch (q.type) {
      case 'MC':
      case 'MA':
        q.options.forEach(o => out.push(F.rich(o.text), o.correct ? 'correct' : 'incorrect'));
        break;
      case 'TF':
        out.push(q.tf ? 'true' : 'false');
        break;
      case 'ESS':
        if (BQ.rt.toPlain(q.sample)) out.push(F.rich(q.sample));
        break;
      case 'MAT':
        q.pairs.forEach(p => out.push(F.rich(p.left), F.rich(p.right)));
        break;
      case 'FIB':
        q.answers.map(F.plain).filter(Boolean).forEach(a => out.push(a));
        break;
      case 'FIB_PLUS': {
        const names = BQ.blanksInText(q.text);
        const groups = names.map(n => {
          const b = q.blanks.find(x => x.name === n) || { answers: [] };
          return [n].concat(b.answers.map(F.plain).filter(Boolean)).join('\t');
        });
        return out.join('\t') + '\t' + groups.join('\t\t');
      }
      case 'NUM':
        out.push(String(q.num.answer).trim());
        if (String(q.num.tolerance).trim()) out.push(String(q.num.tolerance).trim());
        break;
    }
    return out.join('\t');
  }

  /**
   * Build the upload file(s).
   * Returns { rows, parts: [text], included, skipped: [{index, errors}], text }
   */
  function exportTxt(questions, settings, opts) {
    const includeInvalid = opts && opts.includeInvalid;
    const rows = [];
    const skipped = [];
    questions.forEach((q, index) => {
      const v = BQ.validate(q);
      if (v.errors.length && !includeInvalid) { skipped.push({ index, errors: v.errors }); return; }
      rows.push(toRow(q, settings));
    });
    const parts = [];
    for (let k = 0; k < rows.length; k += MAX_PER_FILE) parts.push(rows.slice(k, k + MAX_PER_FILE).join('\r\n') + '\r\n');
    return { rows, parts, included: rows.length, skipped, text: rows.length ? rows.join('\r\n') + '\r\n' : '' };
  }

  /** Spreadsheet template (CSV) with the Blackboard column layout and one example per type. */
  function csvTemplate() {
    const rows = [
      ['Type', 'Question', 'Answer 1 / match / accepted answer', 'correct|incorrect / match', 'Answer 2', 'correct|incorrect', 'Answer 3', 'correct|incorrect', 'Answer 4', 'correct|incorrect'],
      ['MC', 'Which type of information system records day-to-day transactions such as order entry and payroll?', 'Decision support system', 'incorrect', 'Transaction processing system', 'correct', 'Executive information system', 'incorrect', 'Expert system', 'incorrect'],
      ['MA', 'Which of these are dimensions of data quality?', 'Accuracy', 'correct', 'Timeliness', 'correct', 'Number of cups of tea the analyst drank', 'incorrect', 'Completeness', 'correct'],
      ['TF', 'A data warehouse is usually optimized for analysis rather than for processing daily transactions.', 'true'],
      ['ESS', 'Pick one of Porter’s five forces and explain how a new information system could change it. Use a real or realistic company as your example.', 'Names the force, describes the system, and connects the two with a concrete business example (for example, an online ordering platform raising switching costs for customers).'],
      ['MAT', 'Match each security goal to its meaning.', 'Confidentiality', 'Only authorized people can see the data', 'Integrity', 'Data is accurate and has not been altered', 'Availability', 'Systems and data are there when they are needed'],
      ['FIB', 'SQL stands for Structured ____ Language.', 'Query'],
      ['FIB_PLUS', 'A [x] uniquely identifies each row in a table, and a [y] links one table to another.', 'x', 'primary key', '', 'y', 'foreign key'],
      ['NUM', 'Professor Liu forgot to switch off a cloud server that costs 25 cents per hour. What did 30 days (720 hours) of running nonstop cost him, in dollars?', '180', '0']
    ];
    const q = (c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
    return rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }

  BQ.bb = { parse, parseRows, parseDelimited, detectDelimiter, looksLikeBb, toRow, exportTxt, csvTemplate, MAX_PER_FILE };
})();
