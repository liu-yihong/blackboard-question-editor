/*
 * Blackboard question pool package (.zip) for Ultra "Question banks → Import from file"
 * and Original "Pools → Import".
 *
 * The package is what Blackboard Learn writes when you export a pool:
 *   .bb-package-info   one line: cx.package.info.version=6.0
 *   imsmanifest.xml    one resource of type assessment/x-bb-qti-pool
 *   res00001.dat       the pool, in Blackboard's QTI 1.2 dialect
 * Item layouts follow real Learn exports (Moodle's and senkyoshi's Blackboard
 * import fixtures, and R/exams' exams2blackboard).
 */
(function () {
  'use strict';
  const BQ = (globalThis.BQ = globalThis.BQ || {});

  const BB_TYPE = {
    MC: 'Multiple Choice', MA: 'Multiple Answer', TF: 'True/False', ESS: 'Essay', MAT: 'Matching',
    FIB: 'Fill in the Blank', FIB_PLUS: 'Fill in the Blank Plus', NUM: 'Numeric'
  };

  /* ---------- helpers ---------- */

  const xml = (s) => String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function newId() {
    const b = new Uint8Array(16);
    (globalThis.crypto && crypto.getRandomValues) ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function makeFormatter(settings) {
    const html = (settings && settings.format) !== 'plain';
    const math = (settings && settings.math) || 'unicode';
    return {
      /** HTML for a mat_formattedtext block. */
      rich: (s) => (html ? BQ.rt.toHtml(s, { math }) : BQ.rt.escapeHtml(BQ.rt.toPlain(s, { math }))).trim(),
      /** Plain text for answers the student types. */
      plain: (s) => BQ.rt.toPlain(s, { math: 'unicode' }).replace(/\s+/g, ' ').trim()
    };
  }

  const formatted = (tag, html) =>
    '<' + tag + ' class="FORMATTED_TEXT_BLOCK"><material><mat_extension><mat_formattedtext type="HTML">' +
    xml(html) + '</mat_formattedtext></mat_extension></material></' + tag + '>';

  const fib = (ident, kind, rows, num) =>
    '<' + (num ? 'response_num' : 'response_str') + ' ident="' + xml(ident) + '" rcardinality="Single" rtiming="No">' +
    '<render_fib charset="us-ascii" columns="127" encoding="UTF_8" fibtype="' + kind + '" maxchars="0" maxnumber="0" minnumber="0" prompt="Box" rows="' + rows + '"/>' +
    '</' + (num ? 'response_num' : 'response_str') + '>';

  const SET_MAX = '<setvar action="Set" variablename="SCORE">SCORE.max</setvar>';
  const FB_CORRECT = '<displayfeedback feedbacktype="Response" linkrefid="correct"/>';
  const INCORRECT =
    '<respcondition title="incorrect"><conditionvar><other/></conditionvar>' +
    '<setvar action="Set" variablename="SCORE">0.0</setvar>' +
    '<displayfeedback feedbacktype="Response" linkrefid="incorrect"/></respcondition>';
  const EMPTY_FEEDBACK = ['correct', 'incorrect'].map(id =>
    '<itemfeedback ident="' + id + '" view="All"><flow_mat class="Block">' + formatted('flow_mat', '') + '</flow_mat></itemfeedback>').join('');

  /* ---------- one question → one <item> ---------- */

  function item(q, F, points) {
    const pts = points.toFixed(1);
    let response = '';
    let extraBlocks = '';
    let conditions = '';
    let extraFeedback = '';
    let responseType = 'Single';

    switch (q.type) {
      case 'MC':
      case 'MA': {
        const multi = q.type === 'MA';
        if (multi) responseType = 'Multiple';
        const ids = q.options.map(newId);
        response = '<response_lid ident="response" rcardinality="' + (multi ? 'Multiple' : 'Single') + '" rtiming="No">' +
          '<render_choice maxnumber="0" minnumber="0" shuffle="Yes">' +
          q.options.map((o, i) => '<flow_label class="Block"><response_label ident="' + ids[i] + '" rarea="Ellipse" rrange="Exact" shuffle="Yes">' +
            formatted('flow_mat', F.rich(o.text)) + '</response_label></flow_label>').join('') +
          '</render_choice></response_lid>';
        if (multi) {
          conditions = '<respcondition title="correct"><conditionvar><and>' +
            q.options.map((o, i) => {
              const v = '<varequal case="No" respident="response">' + ids[i] + '</varequal>';
              return o.correct ? v : '<not>' + v + '</not>';
            }).join('') +
            '</and></conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        } else {
          const k = q.options.findIndex(o => o.correct);
          conditions = '<respcondition title="correct"><conditionvar><varequal case="No" respident="response">' + ids[k] +
            '</varequal></conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        }
        break;
      }
      case 'TF': {
        const label = (v) => '<flow_label class="Block"><response_label ident="' + v + '" rarea="Ellipse" rrange="Exact" shuffle="Yes">' +
          '<flow_mat class="Block"><material><mattext charset="us-ascii" texttype="text/plain" xml:space="default">' + v +
          '</mattext></material></flow_mat></response_label></flow_label>';
        response = '<response_lid ident="response" rcardinality="Single" rtiming="No"><render_choice maxnumber="0" minnumber="0" shuffle="No">' +
          label('true') + label('false') + '</render_choice></response_lid>';
        conditions = '<respcondition title="correct"><conditionvar><varequal case="No" respident="response">' + (q.tf ? 'true' : 'false') +
          '</varequal></conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        break;
      }
      case 'ESS': {
        response = fib('response', 'String', 8);
        conditions = '<respcondition title="correct"><conditionvar/>' + SET_MAX + FB_CORRECT + '</respcondition>';
        if (BQ.rt.toPlain(q.sample).trim()) {
          extraFeedback = '<itemfeedback ident="solution" view="All"><solution feedbackstyle="Complete" view="All"><solutionmaterial>' +
            '<flow_mat class="Block"><material><mat_extension><mat_formattedtext type="HTML">' + xml(F.rich(q.sample)) +
            '</mat_formattedtext></mat_extension></material></flow_mat></solutionmaterial></solution></itemfeedback>';
        }
        break;
      }
      case 'MAT': {
        // Each prompt has its own response_lid listing one label per match (in match order);
        // the correct label is the one at the same position as the prompt's own match.
        const lids = q.pairs.map(newId);
        const labels = q.pairs.map(() => q.pairs.map(newId));
        response = q.pairs.map((p, i) => '<flow class="Block">' + formatted('flow', F.rich(p.left)) +
          '<response_lid ident="' + lids[i] + '" rcardinality="Single" rtiming="No"><render_choice maxnumber="0" minnumber="0" shuffle="Yes"><flow_label class="Block">' +
          labels[i].map(id => '<response_label ident="' + id + '" rarea="Ellipse" rrange="Exact" shuffle="Yes"/>').join('') +
          '</flow_label></render_choice></response_lid></flow>').join('');
        extraBlocks = '<flow class="RIGHT_MATCH_BLOCK">' +
          q.pairs.map(p => '<flow class="Block">' + formatted('flow', F.rich(p.right)) + '</flow>').join('') + '</flow>';
        conditions = q.pairs.map((p, i) => '<respcondition><conditionvar><varequal case="No" respident="' + lids[i] + '">' + labels[i][i] +
          '</varequal></conditionvar>' + FB_CORRECT + '</respcondition>').join('');
        break;
      }
      case 'FIB': {
        response = fib('response', 'String', 1);
        conditions = q.answers.map(F.plain).filter(Boolean).map(a => {
          const t = newId();
          return '<respcondition title="' + t + '"><conditionvar><varequal case="No" respident="response">' + xml(a) +
            '</varequal></conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        }).join('');
        break;
      }
      case 'FIB_PLUS': {
        const names = BQ.blanksInText(q.text);
        response = names.map(n => fib(n, 'String', 0)).join('');
        conditions = '<respcondition title="correct"><conditionvar><and>' +
          names.map(n => {
            const b = q.blanks.find(x => x.name === n) || { answers: [] };
            return '<or>' + b.answers.map(F.plain).filter(Boolean)
              .map(a => '<varequal case="No" respident="' + xml(n) + '">' + xml(a) + '</varequal>').join('') + '</or>';
          }).join('') +
          '</and></conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        break;
      }
      case 'NUM': {
        const ans = parseFloat(q.num.answer);
        const tol = String(q.num.tolerance).trim() ? Math.abs(parseFloat(q.num.tolerance)) : 0;
        const num = (v) => String(Number(v.toPrecision(15)));
        response = fib('response', 'Decimal', 0, true);
        conditions = '<respcondition title="correct"><conditionvar>' +
          '<vargte respident="response">' + num(ans - tol) + '</vargte>' +
          '<varlte respident="response">' + num(ans + tol) + '</varlte>' +
          '<varequal case="No" respident="response">' + num(ans) + '</varequal>' +
          '</conditionvar>' + SET_MAX + FB_CORRECT + '</respcondition>';
        break;
      }
    }

    return '<item maxattempts="0"><itemmetadata>' +
      '<bbmd_asi_object_id>' + newId() + '</bbmd_asi_object_id><bbmd_asitype>Item</bbmd_asitype>' +
      '<bbmd_assessmenttype>Pool</bbmd_assessmenttype><bbmd_sectiontype>Subsection</bbmd_sectiontype>' +
      '<bbmd_questiontype>' + BB_TYPE[q.type] + '</bbmd_questiontype><bbmd_is_from_cartridge>false</bbmd_is_from_cartridge>' +
      '<bbmd_is_disabled>false</bbmd_is_disabled><bbmd_negative_points_ind>N</bbmd_negative_points_ind>' +
      '<bbmd_canvas_fullcrdt_ind>false</bbmd_canvas_fullcrdt_ind><bbmd_all_fullcredit_ind>false</bbmd_all_fullcredit_ind>' +
      '<bbmd_numbertype>none</bbmd_numbertype><bbmd_partialcredit>false</bbmd_partialcredit>' +
      '<bbmd_orientationtype>vertical</bbmd_orientationtype><bbmd_is_extracredit>false</bbmd_is_extracredit>' +
      '<qmd_absolutescore_max>' + pts + '</qmd_absolutescore_max><qmd_weighting>0.0</qmd_weighting><qmd_instructornotes/>' +
      '<qmd_itemtype>Logical Identifier</qmd_itemtype><qmd_responsetype>' + responseType + '</qmd_responsetype>' +
      '</itemmetadata>' +
      '<presentation><flow class="Block"><flow class="QUESTION_BLOCK">' + formatted('flow', F.rich(q.text)) + '</flow>' +
      '<flow class="RESPONSE_BLOCK">' + response + '</flow>' + extraBlocks + '</flow></presentation>' +
      '<resprocessing scoremodel="SumOfScores"><outcomes><decvar defaultval="0.0" maxvalue="' + pts + '" minvalue="0.0" varname="SCORE" vartype="Decimal"/></outcomes>' +
      conditions + INCORRECT + '</resprocessing>' + EMPTY_FEEDBACK + extraFeedback + '</item>';
  }

  /* ---------- the pool file ---------- */

  function poolXml(title, items) {
    const meta = (asitype) =>
      '<bbmd_asi_object_id>' + newId() + '</bbmd_asi_object_id><bbmd_asitype>' + asitype + '</bbmd_asitype>' +
      '<bbmd_assessmenttype>Pool</bbmd_assessmenttype><bbmd_sectiontype>Subsection</bbmd_sectiontype>' +
      '<bbmd_questiontype>Multiple Choice</bbmd_questiontype><bbmd_is_from_cartridge>false</bbmd_is_from_cartridge>' +
      '<bbmd_is_disabled>false</bbmd_is_disabled><bbmd_negative_points_ind>N</bbmd_negative_points_ind>' +
      '<bbmd_canvas_fullcrdt_ind>false</bbmd_canvas_fullcrdt_ind><bbmd_all_fullcredit_ind>false</bbmd_all_fullcredit_ind>' +
      '<bbmd_numbertype>none</bbmd_numbertype><bbmd_partialcredit/><bbmd_orientationtype>vertical</bbmd_orientationtype>' +
      '<bbmd_is_extracredit>false</bbmd_is_extracredit><qmd_absolutescore_max>0.0</qmd_absolutescore_max>' +
      '<qmd_weighting>0.0</qmd_weighting><qmd_instructornotes/>';
    const empty = (tag, attrs) => '<' + tag + (attrs || '') + '><flow_mat class="Block"><material><mat_extension><mat_formattedtext type="HTML"></mat_formattedtext></mat_extension></material></flow_mat></' + tag + '>';
    return '<?xml version="1.0" encoding="UTF-8"?>\n<questestinterop><assessment title="' + xml(title) + '">' +
      '<assessmentmetadata>' + meta('Assessment') + '</assessmentmetadata>' +
      empty('rubric', ' view="All"') + empty('presentation_material') +
      '<section><sectionmetadata>' + meta('Section') + '</sectionmetadata>\n' + items.join('\n') +
      '\n</section></assessment></questestinterop>\n';
  }

  function manifestXml(title) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<manifest identifier="man00001" xmlns:bb="http://www.blackboard.com/content-packaging/">' +
      '<organizations/><resources>' +
      '<resource bb:file="res00001.dat" bb:title="' + xml(title) + '" identifier="res00001" type="assessment/x-bb-qti-pool" xml:base="res00001"/>' +
      '</resources></manifest>\n';
  }

  /* ---------- a minimal zip writer (stored, no compression) ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** files: [{ name, text }] → Uint8Array of a .zip */
  function zip(files, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = f.bytes || enc.encode(f.text);
      const crc = crc32(data);
      const head = (sig, central) => {
        const b = new DataView(new ArrayBuffer(central ? 46 : 30));
        let p = 0;
        const u32 = (v) => { b.setUint32(p, v, true); p += 4; };
        const u16 = (v) => { b.setUint16(p, v, true); p += 2; };
        u32(sig);
        if (central) u16(20);           // version made by
        u16(20);                        // version needed
        u16(0x0800);                    // UTF-8 names
        u16(0);                         // stored
        u16(dosTime); u16(dosDate);
        u32(crc); u32(data.length); u32(data.length);
        u16(name.length); u16(0);
        if (central) { u16(0); u16(0); u16(0); u32(0); u32(offset); }
        return new Uint8Array(b.buffer);
      };
      const local = head(0x04034b50, false);
      locals.push(local, name, data);
      centrals.push(head(0x02014b50, true), name);
      offset += local.length + name.length + data.length;
    });
    const cdSize = centrals.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0));
    let p = 0;
    parts.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  /**
   * Build the pool package.
   * opts: { title, points (default 1), includeInvalid }
   * Returns { bytes: Uint8Array, xml, included, skipped: [{index, errors}] }
   */
  function exportPool(questions, settings, opts) {
    opts = opts || {};
    const F = makeFormatter(settings);
    const points = opts.points > 0 ? Number(opts.points) : 1;
    const title = String(opts.title || '').trim() || 'Question bank';
    const items = [];
    const skipped = [];
    questions.forEach((q, index) => {
      const v = BQ.validate(q);
      if (v.errors.length && !opts.includeInvalid) { skipped.push({ index, errors: v.errors }); return; }
      items.push(item(q, F, points));
    });
    const dat = poolXml(title, items);
    const bytes = zip([
      { name: '.bb-package-info', text: 'cx.package.info.version=6.0\n' },
      { name: 'imsmanifest.xml', text: manifestXml(title) },
      { name: 'res00001.dat', text: dat }
    ]);
    return { bytes, xml: dat, included: items.length, skipped };
  }

  BQ.pool = { exportPool, zip, crc32 };
})();
