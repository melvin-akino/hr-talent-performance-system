const pptxgen = require('pptxgenjs');

/* ------------------------------------------------------------------ *
 * Palette — deep teal dominant, amber as the single sharp accent.
 * ------------------------------------------------------------------ */
const INK      = '10201C';
const MUTED    = '5C6E68';
const DARK     = '0A3D36';
const DARK_2   = '0E5248';
const TEAL     = '0B6E5F';
const TEAL_TINT= 'E3EDEA';
const AMBER    = 'B3761B';
const AMBER_TINT = 'F6EEDF';
const GROUND   = 'F3F6F5';
const WHITE    = 'FFFFFF';

const HEAD = 'Cambria';
const BODY = 'Calibri';

const W = 13.3, H = 7.5, M = 0.7;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Summit Logic Solutions';
pres.company = 'Summit Logic Solutions';
pres.title = 'Guanzon HCM — Performance Management';

/* Fresh object every call: pptxgenjs mutates options in place. */
const softShadow = () => ({ type: 'outer', color: '0A3D36', blur: 14, offset: 3, angle: 90, opacity: 0.10 });

function lightSlide(kicker, title, notes) {
  const s = pres.addSlide();
  s.background = { color: GROUND };
  if (kicker) {
    s.addText(kicker.toUpperCase(), {
      x: M, y: 0.45, w: 9, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: TEAL,
    });
  }
  s.addText(title, {
    x: M, y: 0.78, w: W - M * 2, h: 0.85, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 34, bold: true, color: INK,
  });
  if (notes) s.addNotes(notes);
  return s;
}

/** A white card. Nothing gets an edge stripe. */
function card(s, x, y, w, h) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: WHITE }, line: { color: 'E1E8E6', width: 0.75 },
    shadow: softShadow(),
  });
}

/** The repeated motif: a filled circle carrying a numeral or short glyph. */
function bead(s, x, y, label, color = TEAL, d = 0.46) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color }, line: { color } });
  s.addText(label, {
    x, y, w: d, h: d, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13, bold: true, color: WHITE,
    align: 'center', valign: 'middle',
  });
}

/* ================================================================== *
 * 1 — Title
 * ================================================================== */
{
  const s = pres.addSlide();
  s.background = { color: DARK };

  s.addShape(pres.ShapeType.ellipse, {
    x: 9.6, y: -1.6, w: 6.2, h: 6.2, fill: { color: DARK_2 }, line: { color: DARK_2 },
  });
  s.addShape(pres.ShapeType.ellipse, {
    x: 11.4, y: 4.4, w: 3.4, h: 3.4, fill: { color: TEAL }, line: { color: TEAL },
  });

  s.addText('GUANZON  ·  HUMAN CAPITAL MANAGEMENT', {
    x: M, y: 1.75, w: 9, h: 0.35, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, bold: true, charSpacing: 3, color: '8FBDB2',
  });
  s.addText('Performance management,\nbuilt to your specification', {
    x: M, y: 2.2, w: 8.6, h: 1.9, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 40, bold: true, color: WHITE, valign: 'top', lineSpacing: 46,
  });
  s.addText(
    'Your five evaluation types, your rank ladder, your peer-review rules — '
    + 'running on your own server.',
    {
      x: M, y: 4.25, w: 8.2, h: 0.9, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 16, color: 'BFD6D0', valign: 'top', lineSpacing: 24,
    },
  );
  s.addText('System demonstration', {
    x: M, y: 6.3, w: 6, h: 0.35, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13, color: '7FA9A0',
  });
  s.addNotes(
    'Opening frame. Two things to land: this was built from their own spec, not a '
    + 'generic HR product; and it runs on their infrastructure, not a vendor cloud. '
    + 'Everything shown today uses invented people on their real structure.',
  );
}

/* ================================================================== *
 * 2 — What is live
 * ================================================================== */
{
  const s = lightSlide('Where it stands', 'Built, tested and running today',
    'Set expectations early. These are working screens against a real database, not '
    + 'mock-ups. Mention that the permission rules are enforced in the database itself '
    + '— that is the claim the rest of the demo backs up.');

  const stats = [
    ['24', 'screens in daily use'],
    ['21', 'automatic notifications'],
    ['809', 'automated tests'],
    ['14', 'built-in help articles'],
  ];
  stats.forEach(([n, label], i) => {
    const x = M + i * 3.12;
    card(s, x, 1.95, 2.85, 1.55);
    s.addText(n, {
      x: x + 0.25, y: 2.12, w: 2.4, h: 0.72, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 40, bold: true, color: TEAL,
    });
    s.addText(label, {
      x: x + 0.25, y: 2.86, w: 2.4, h: 0.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: MUTED,
    });
  });

  const rows = [
    ['Goal and target setting, with HCM approval', 'Weighted targets, check-ins on a set cadence, revision trail'],
    ['The full evaluation route', 'Self, supervisor, Department Head, calibration, sign-off'],
    ['Peer review', '30-point instrument, random draw, the six-month eligibility question'],
    ['One history per employee', 'Evaluations, PIPs, competency, employment — one dated list'],
  ];
  rows.forEach(([h1, h2], i) => {
    const y = 3.85 + i * 0.78;
    bead(s, M, y, String(i + 1));
    s.addText(h1, {
      x: M + 0.68, y: y - 0.04, w: 5.4, h: 0.32, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 15, bold: true, color: INK,
    });
    s.addText(h2, {
      x: M + 0.68, y: y + 0.27, w: 11.2, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED,
    });
  });
}

/* ================================================================== *
 * 3 — The org chart and the rank ladder
 * ================================================================== */
{
  const s = lightSlide('Your structure', 'Your org chart, and your rank numbering',
    'This is the HCM department from their own workbook — five units, the real reporting '
    + 'lines, every person invented. Stress the rank direction: 6 outranks 11. Their '
    + 'numbering, not ours, and the system is written in those terms throughout.');

  card(s, M, 1.95, 6.0, 4.85);
  s.addText('Five units, as drawn', {
    x: M + 0.4, y: 2.2, w: 5.2, h: 0.4, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 19, bold: true, color: INK,
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: M + 0.4, y: 2.78, w: 5.2, h: 0.55, rectRadius: 0.05,
    fill: { color: TEAL }, line: { color: TEAL },
  });
  s.addText('Human Capital Management', {
    x: M + 0.4, y: 2.78, w: 5.2, h: 0.55, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 14, bold: true, color: WHITE, align: 'center', valign: 'middle',
  });

  ['Hiring & Selection', 'Compensation & Benefits', 'Employee Relations', 'Organizational Development']
    .forEach((name, i) => {
      const y = 3.5 + i * 0.66;
      s.addShape(pres.ShapeType.roundRect, {
        x: M + 0.85, y, w: 4.75, h: 0.52, rectRadius: 0.05,
        fill: { color: TEAL_TINT }, line: { color: 'CBDDD8', width: 0.75 },
      });
      s.addText(name, {
        x: M + 1.1, y, w: 4.4, h: 0.52, isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 13, color: INK, valign: 'middle',
      });
    });

  s.addText('28 people  ·  21 positions  ·  effective-dated, so history stays true', {
    x: M + 0.4, y: 6.35, w: 5.3, h: 0.32, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 11.5, italic: true, color: MUTED,
  });

  const lx = 7.2;
  card(s, lx, 1.95, W - lx - M, 4.85);
  s.addText('The rank ladder', {
    x: lx + 0.4, y: 2.2, w: 4, h: 0.4, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 19, bold: true, color: INK,
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: lx + 0.4, y: 2.72, w: W - lx - M - 0.8, h: 0.5, rectRadius: 0.05,
    fill: { color: AMBER_TINT }, line: { color: AMBER_TINT },
  });
  s.addText('A lower number is more senior', {
    x: lx + 0.6, y: 2.72, w: 4.4, h: 0.5, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13, bold: true, color: AMBER, valign: 'middle',
  });

  [['6', 'Department Manager'], ['7', 'Section Head'], ['9', 'Area Coordinator'],
   ['10', 'Junior Supervisor'], ['11', 'Team Leader / Associate']]
    .forEach(([no, name], i) => {
      const y = 3.34 + i * 0.58;
      bead(s, lx + 0.4, y - 0.02, no, i === 0 ? AMBER : TEAL, 0.42);
      s.addText(name, {
        x: lx + 1.0, y: y - 0.02, w: 4.2, h: 0.42, isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 13.5, color: INK, valign: 'middle',
      });
    });

  s.addText('Peer-review routing reads this ladder directly.', {
    x: lx + 0.4, y: 6.35, w: 4.8, h: 0.32, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 11.5, italic: true, color: MUTED,
  });
}

/* ================================================================== *
 * 4 — The permission boundary
 * ================================================================== */
{
  const s = lightSlide('What makes this different', 'Who can see what is not a setting — it is the database',
    'The most important slide. Demonstrate it live: sign in as a Section Head, show her '
    + 'people; sign in as another Section Head, show that the first group has vanished. '
    + 'In most systems this is a filter in the application. Here the database itself '
    + 'refuses, so there is no screen, no report and no export that can leak around it.');

  const cols = [
    ['Employee', 'Their own record, their own targets and results. Nothing else.', TEAL],
    ['Supervisor', 'Their own, plus everyone reporting to them. Not their peers’ teams.', TEAL],
    ['Dept. Head', 'The whole section, and the approval step before sign-off.', TEAL],
    ['HCM', 'The organisation, plus the setup nobody else may touch.', AMBER],
  ];
  cols.forEach(([role, text, c], i) => {
    const x = M + i * 3.12;
    card(s, x, 1.95, 2.85, 2.25);
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.25, y: 2.2, w: 0.36, h: 0.36, fill: { color: c }, line: { color: c },
    });
    s.addText(role, {
      x: x + 0.72, y: 2.18, w: 2, h: 0.4, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 15, bold: true, color: INK, valign: 'middle',
    });
    s.addText(text, {
      x: x + 0.25, y: 2.72, w: 2.4, h: 1.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 17,
    });
  });

  card(s, M, 4.5, W - M * 2, 1.95);
  s.addText('Why it matters to you', {
    x: M + 0.45, y: 4.75, w: 5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  s.addText(
    [
      { text: 'Appraisal data is the most sensitive thing HR holds. ', options: { bold: true } },
      { text: 'A supervisor who can open a colleague’s ratings — even once, even by '
        + 'accident — is a problem you cannot undo. Here the rule lives underneath every '
        + 'screen, every report and every export, so it holds even where nobody thought '
        + 'to check. We test it by trying to break in, not by trusting the screens.' },
    ],
    {
      x: M + 0.45, y: 5.2, w: W - M * 2 - 0.9, h: 1.0, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 20,
    },
  );
}

/* ================================================================== *
 * 5 — Getting the people in
 * ================================================================== */
{
  const s = lightSlide('Setting up', 'Your 201 files, loaded by your own staff',
    'Show the three steps live. The preview is the part to dwell on: it reports exactly '
    + 'what would change and writes nothing, so a mistyped supervisor is caught before '
    + 'anything lands. Re-uploading a corrected file updates rather than duplicating.');

  const steps = [
    ['1', 'Download the template', 'Carries the exact columns the system reads, with one example row. Extra columns in your own file are ignored and reported back.'],
    ['2', 'Upload and check', 'Reports what would happen and writes nothing: people added, units created, reporting lines, the rank ladder. Errors name the line and the reason.'],
    ['3', 'Apply', 'People, departments, positions and ranks in one go. Upload a corrected file later and it updates — it never duplicates.'],
  ];
  steps.forEach(([n, h1, h2], i) => {
    const x = M + i * 4.12;
    card(s, x, 1.95, 3.85, 2.75);
    bead(s, x + 0.35, 2.25, n, TEAL, 0.5);
    s.addText(h1, {
      x: x + 0.35, y: 2.92, w: 3.2, h: 0.35, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 17, bold: true, color: INK,
    });
    s.addText(h2, {
      x: x + 0.35, y: 3.35, w: 3.2, h: 1.2, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 17,
    });
    if (i < 2) {
      s.addShape(pres.ShapeType.chevron, {
        x: x + 3.95, y: 3.12, w: 0.28, h: 0.4,
        fill: { color: 'C5D5D0' }, line: { color: 'C5D5D0' },
      });
    }
  });

  card(s, M, 5.0, W - M * 2, 1.45);
  s.addText('No spreadsheet round-trips with us', {
    x: M + 0.45, y: 5.2, w: 6, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 17, bold: true, color: INK,
  });
  s.addText(
    'HCM does this without waiting on anyone technical. The same file shape works for '
    + 'the first load of 28 people and for a branch of 300.',
    {
      x: M + 0.45, y: 5.62, w: W - M * 2 - 0.9, h: 0.6, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );
}

/* ================================================================== *
 * 6 — Targets, with the HCM gate
 * ================================================================== */
{
  const s = lightSlide('Target setting', 'Targets pass two gates, not one',
    'Their §4.3: HCM sets the timeline, approves targets and may send them back. Point '
    + 'out that the second gate is switchable per period — some periods need HCM sign-off '
    + 'on every target, some do not, and that is a setting rather than a code change.');

  const flow = [
    ['Draft', 'The employee and supervisor agree targets and weights.', TEAL_TINT, INK],
    ['Supervisor approves', 'First gate. The target is now fixed for the period.', TEAL, WHITE],
    ['HCM approves', 'Second gate, switchable per period. HCM may approve or send back with a note.', AMBER, WHITE],
    ['Active', 'Check-ins run on the cadence you set — weekly through quarterly.', TEAL_TINT, INK],
  ];
  flow.forEach(([h1, h2, fill, fg], i) => {
    const x = M + i * 3.12;
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 2.0, w: 2.85, h: 0.62, rectRadius: 0.06,
      fill: { color: fill }, line: { color: fill === TEAL_TINT ? 'CBDDD8' : fill, width: 0.75 },
    });
    s.addText(h1, {
      x: x + 0.2, y: 2.0, w: 2.45, h: 0.62, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, bold: true, color: fg, valign: 'middle',
    });
    s.addText(h2, {
      x: x + 0.02, y: 2.78, w: 2.8, h: 1.1, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 17,
    });
    if (i < 3) {
      s.addShape(pres.ShapeType.chevron, {
        x: x + 2.92, y: 2.15, w: 0.16, h: 0.32,
        fill: { color: 'C5D5D0' }, line: { color: 'C5D5D0' },
      });
    }
  });

  card(s, M, 4.2, 6.0, 2.25);
  s.addText('Sent back, not rejected', {
    x: M + 0.4, y: 4.45, w: 5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 17, bold: true, color: INK,
  });
  s.addText(
    'When HCM returns a target it carries a note, both approvals clear, and the target '
    + 'goes back to draft. Nobody has to guess what changed or why.',
    {
      x: M + 0.4, y: 4.88, w: 5.2, h: 1.2, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );

  card(s, 7.2, 4.2, W - 7.2 - M, 2.25);
  s.addText('Check-ins that chase themselves', {
    x: 7.6, y: 4.45, w: 5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 17, bold: true, color: INK,
  });
  s.addText(
    'A goal whose check-in cadence has lapsed raises a reminder to the person holding it '
    + '— once per missed period, not once per day. Nobody has to run a report to find '
    + 'work that went quiet.',
    {
      x: 7.6, y: 4.88, w: 5.0, h: 1.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );
}

/* ================================================================== *
 * 7 — The evaluation route
 * ================================================================== */
{
  const s = lightSlide('The evaluation', 'Self, supervisor, Department Head, sign-off',
    'This is their §4.5 end to end. The Department Head step is the one they asked for '
    + 'and most products do not have: revise, approve or disapprove before anything is '
    + 'final. Sign-off waits for it — the result cannot be released around the DH.');

  const stages = [
    ['Self', 'The employee rates themselves first.'],
    ['Supervisor', 'Ratings plus a written recommendation.'],
    ['Department Head', 'Revises, approves or sends it back.'],
    ['Calibration', 'HCM compares across the section before anything is final.'],
    ['Sign-off', 'Released to the employee, who acknowledges it.'],
  ];
  stages.forEach(([h1, h2], i) => {
    const x = M + i * 2.48;
    const isDH = i === 2;
    card(s, x, 1.95, 2.28, 2.5);
    bead(s, x + 0.28, 2.2, String(i + 1), isDH ? AMBER : TEAL, 0.44);
    s.addText(h1, {
      x: x + 0.28, y: 2.82, w: 1.9, h: 0.6, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 15.5, bold: true, color: isDH ? AMBER : INK,
    });
    s.addText(h2, {
      x: x + 0.28, y: 3.45, w: 1.78, h: 0.9, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: MUTED, valign: 'top', lineSpacing: 16,
    });
  });

  card(s, M, 4.75, W - M * 2, 1.7);
  s.addText('Nothing is released early, and nothing is lost', {
    x: M + 0.45, y: 4.98, w: 8, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 17, bold: true, color: INK,
  });
  s.addText(
    'A result stays invisible to the employee until sign-off — including to them, on their '
    + 'own record. Forms are versioned, so a review answered last year still shows the '
    + 'questions as they were asked, not as they read today.',
    {
      x: M + 0.45, y: 5.4, w: W - M * 2 - 0.9, h: 0.85, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );
}

/* ================================================================== *
 * 8 — Peer review
 * ================================================================== */
{
  const s = lightSlide('Peer review', 'Drawn at random, from rules you set',
    'Their §6, almost entirely. Two points to make: the draw is random from a pool the '
    + 'rules define, so nobody picks their own reviewers; and the six-month question is '
    + 'asked before anyone rates, with a replacement drawn automatically on a no.');

  card(s, M, 1.95, 5.5, 2.6);
  s.addText('The 30-point instrument', {
    x: M + 0.4, y: 2.18, w: 4.6, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  [['Mastery', '5'], ['Demeanour — phone & messaging', '5'], ['Demeanour — in person', '5'],
   ['Customer service', '10'], ['Promptness', '5']].forEach(([k, v], i) => {
    const y = 2.62 + i * 0.30;
    s.addText(k, {
      x: M + 0.4, y, w: 4.1, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED,
    });
    s.addText(v, {
      x: M + 4.55, y, w: 0.5, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, bold: true, color: TEAL, align: 'right',
    });
  });
  s.addText('Total', {
    x: M + 0.4, y: 4.15, w: 4.1, h: 0.3, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12.5, bold: true, color: INK,
  });
  s.addText('30', {
    x: M + 4.55, y: 4.15, w: 0.5, h: 0.3, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12.5, bold: true, color: AMBER, align: 'right',
  });

  const rx = 6.7;
  card(s, rx, 1.95, W - rx - M, 2.6);
  s.addText('How reviewers are chosen', {
    x: rx + 0.4, y: 2.18, w: 5, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  [
    'Rules by job family, unit and rank distance — same rank, one up, two up',
    'Drawn at random from that pool; who drew and when is recorded',
    'Between three and five reviewers, averaged',
  ].forEach((t, i) => {
    const y = 2.68 + i * 0.56;
    s.addShape(pres.ShapeType.ellipse, {
      x: rx + 0.42, y: y + 0.08, w: 0.14, h: 0.14, fill: { color: TEAL }, line: { color: TEAL },
    });
    s.addText(t, {
      x: rx + 0.72, y, w: 4.6, h: 0.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 16,
    });
  });

  card(s, M, 4.8, W - M * 2, 1.65);
  s.addShape(pres.ShapeType.ellipse, {
    x: M + 0.45, y: 5.05, w: 0.42, h: 0.42, fill: { color: AMBER }, line: { color: AMBER },
  });
  s.addText('?', {
    x: M + 0.45, y: 5.05, w: 0.42, h: 0.42, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 16, bold: true, color: WHITE, align: 'center', valign: 'middle',
  });
  s.addText('The eligibility question, asked before anyone rates', {
    x: M + 1.05, y: 5.03, w: 8, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 17, bold: true, color: INK,
  });
  s.addText(
    '“Have you had any direct or indirect interaction with this person in the last six '
    + 'months?” A no thanks them and draws a replacement, so a panel is never filled by '
    + 'people with nothing to say.',
    {
      x: M + 1.05, y: 5.45, w: W - M * 2 - 1.5, h: 0.85, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );
}

/* ================================================================== *
 * 9 — Evaluation types
 * ================================================================== */
{
  const s = lightSlide('Configuration', 'Your five evaluation types are settings, not code',
    'Each of their five types is a row you can read and change on screen, not something '
    + 'we hard-coded. Worth saying plainly: when they answer the question about when the '
    + 'probationary clock starts, that is an edit on this screen, not a change request.');

  const types = [
    ['Probationary', 'Month 3 and 4 after hiring, averaged'],
    ['Annual', 'Once a year, on the calendar'],
    ['Semi-annual', 'Midyear and year-end, averaged'],
    ['Project / term', 'A named group, outside the calendar'],
    ['KPI', 'Quarterly, semi-annual or annual'],
  ];
  types.forEach(([name, rule], i) => {
    const y = 1.95 + i * 0.72;
    s.addShape(pres.ShapeType.roundRect, {
      x: M, y, w: 7.4, h: 0.6, rectRadius: 0.05,
      fill: { color: WHITE }, line: { color: 'E1E8E6', width: 0.75 },
    });
    bead(s, M + 0.18, y + 0.09, String(i + 1), TEAL, 0.42);
    s.addText(name, {
      x: M + 0.78, y, w: 2.5, h: 0.6, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14.5, bold: true, color: INK, valign: 'middle',
    });
    s.addText(rule, {
      x: M + 3.3, y, w: 3.9, h: 0.6, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'middle',
    });
  });

  card(s, 8.5, 1.95, W - 8.5 - M, 3.6);
  s.addText('Why this matters', {
    x: 8.9, y: 2.2, w: 3.4, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  s.addText(
    'Every type carries its own timing, how many evaluations make up a result, and '
    + 'whether they are averaged. HCM can read those rules on screen and change them.\n\n'
    + 'A cycle pins the rules it was issued under, so changing a type next year never '
    + 'rewrites the results of this one.',
    {
      x: 8.9, y: 2.65, w: 3.5, h: 2.6, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );

  card(s, M, 5.75, W - M * 2, 0.85);
  s.addText(
    [
      { text: 'Still with you: ', options: { bold: true, color: AMBER } },
      { text: 'when the probationary clock starts — hire date or regularisation — is one '
        + 'of the questions we need answered. The answer is a setting here, not a rebuild.' },
    ],
    {
      x: M + 0.45, y: 5.95, w: W - M * 2 - 0.9, h: 0.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: MUTED,
    },
  );
}

/* ================================================================== *
 * 10 — Where a cycle actually stands (native chart on real demo data)
 * ================================================================== */
{
  const s = lightSlide('Monitoring', 'You can see where a cycle has stalled',
    'These are the real figures from the loaded demo cycle. The shape of the funnel is '
    + 'the point: 44 submitted but only 21 rated tells HCM exactly where to push, without '
    + 'anyone compiling a status report.');

  s.addChart(
    pres.ChartType.bar,
    [{
      name: 'Review instances',
      labels: ['Created', 'Submitted', 'Rated', 'In calibration', 'Signed off'],
      values: [55, 44, 21, 5, 2],
    }],
    {
      x: M, y: 1.9, w: 7.4, h: 4.4,
      barDir: 'col',
      chartColors: [TEAL, TEAL, AMBER, '8FB3AB', '8FB3AB'],
      varyColors: true,
      showTitle: false,
      showLegend: false,
      showValue: true,
      dataLabelPosition: 'outEnd',
      dataLabelColor: INK,
      dataLabelFontSize: 13,
      dataLabelFontFace: BODY,
      catAxisLabelColor: MUTED,
      catAxisLabelFontSize: 12,
      catAxisLabelFontFace: BODY,
      valAxisLabelColor: MUTED,
      valAxisLabelFontSize: 11,
      valAxisHidden: true,
      valGridLine: { style: 'none' },
      catGridLine: { style: 'none' },
      barGapWidthPct: 55,
    },
  );

  card(s, 8.5, 1.95, W - 8.5 - M, 4.35);
  s.addText('What HCM does with it', {
    x: 8.9, y: 2.2, w: 3.4, h: 0.35, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  [
    ['Chase the right people', 'Reminders go to whoever is actually holding the work up — not a broadcast to everyone.'],
    ['See it by section', 'Distribution, rating spread and movement in calibration, per unit.'],
    ['Catch a harsh or soft rater', 'Rater comparison shows who scores consistently away from everyone else.'],
  ].forEach(([h1, h2], i) => {
    const y = 2.75 + i * 1.2;
    s.addText(h1, {
      x: 8.9, y, w: 3.5, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, bold: true, color: INK,
    });
    s.addText(h2, {
      x: 8.9, y: y + 0.32, w: 3.5, h: 0.85, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 17,
    });
  });
}

/* ================================================================== *
 * 11 — One history per employee
 * ================================================================== */
{
  const s = lightSlide('Records', 'One employee, one history',
    'Their §7.1. Everything that ever happened to a person, in date order, on one screen '
    + '— and it obeys the same permission rules, so a consolidated view cannot show what '
    + 'the underlying screen would have hidden.');

  const items = [
    ['Evaluations', 'Every review, the type it was, and the result once signed off'],
    ['Task evaluations', 'Scored against the role’s own scorecard, with the lines kept as they were'],
    ['Competency assessments', 'Against the framework version in force at the time'],
    ['Performance Improvement Plans', 'Opened, reviewed, and how they ended'],
    ['Employment events', 'Movement, position and section changes, effective-dated'],
  ];
  items.forEach(([h1, h2], i) => {
    const y = 1.95 + i * 0.82;
    s.addShape(pres.ShapeType.roundRect, {
      x: M, y, w: 7.6, h: 0.68, rectRadius: 0.05,
      fill: { color: WHITE }, line: { color: 'E1E8E6', width: 0.75 },
    });
    s.addShape(pres.ShapeType.ellipse, {
      x: M + 0.28, y: y + 0.27, w: 0.15, h: 0.15, fill: { color: TEAL }, line: { color: TEAL },
    });
    s.addText(h1, {
      x: M + 0.65, y: y + 0.05, w: 3.0, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, bold: true, color: INK,
    });
    s.addText(h2, {
      x: M + 0.65, y: y + 0.33, w: 6.6, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: MUTED,
    });
  });

  card(s, 8.7, 1.95, W - 8.7 - M, 4.1);
  s.addText('Built for the\nconversation', {
    x: 9.1, y: 2.2, w: 3.2, h: 0.9, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 20, bold: true, color: INK, valign: 'top', lineSpacing: 26,
  });
  s.addText(
    'When somebody is up for regularisation, promotion or a PIP, the whole picture is on '
    + 'one screen — not reassembled from four folders the night before.\n\n'
    + 'It is also the answer to “why was this decision made?” a year later.',
    {
      x: 9.1, y: 3.25, w: 3.3, h: 2.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: MUTED, valign: 'top', lineSpacing: 19,
    },
  );
}

/* ================================================================== *
 * 12 — Notifications
 * ================================================================== */
{
  const s = lightSlide('Follow-through', 'The system chases the work, not your staff',
    'Twenty-one events plus an hourly scan for things going quiet. The detail worth '
    + 'mentioning: a reminder is sent once per milestone, not once per scan — so people '
    + 'do not start ignoring them, which is how reminder systems usually fail.');

  const groups = [
    ['When work arrives', ['A review is assigned to you', 'You are invited to a peer panel', 'A target needs your approval']],
    ['When a date approaches', ['Your review closes in seven days', 'A check-in cadence has lapsed', 'An evaluation is still a draft']],
    ['When something concludes', ['Your result has been released', 'An evaluation was acknowledged', 'A panel could not be filled']],
  ];
  groups.forEach(([title, lines], i) => {
    const x = M + i * 4.12;
    card(s, x, 1.95, 3.85, 2.85);
    bead(s, x + 0.35, 2.2, String(i + 1), TEAL, 0.44);
    s.addText(title, {
      x: x + 0.35, y: 2.82, w: 3.2, h: 0.35, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 16.5, bold: true, color: INK,
    });
    lines.forEach((t, j) => {
      s.addText(t, {
        x: x + 0.35, y: 3.3 + j * 0.44, w: 3.2, h: 0.4, isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 12.5, color: MUTED,
      });
    });
  });

  card(s, M, 5.1, W - M * 2, 1.35);
  s.addText(
    [
      { text: 'Once per milestone, not once per scan.  ', options: { bold: true, color: INK } },
      { text: 'A second missed week sends a second nudge; a hundred checks inside that '
        + 'week send none. Messages queue durably and retry, so a mail server being down '
        + 'for an afternoon delays a notice rather than losing it.' },
    ],
    {
      x: M + 0.45, y: 5.35, w: W - M * 2 - 0.9, h: 0.9, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 20,
    },
  );
}

/* ================================================================== *
 * 13 — On your own server
 * ================================================================== */
{
  const s = lightSlide('Operations', 'It runs on your server, under your control',
    'The contrast with a cloud subscription. Their staff data never leaves their '
    + 'premises, people sign in with the account they already have, and every change is '
    + 'attributable. Be honest that the Active Directory link is configured but has not '
    + 'yet been pointed at their real directory.');

  const cards = [
    ['On your premises', 'Employee data stays on your hardware. No third party holds your appraisals, and no subscription decides whether you can still open them next year.'],
    ['The sign-in they already have', 'Staff use their existing company account. No new password to issue, forget or reset — and removing someone from the directory removes their access here.'],
    ['Every change attributable', 'Who changed what, and when. Results, approvals and overrides all leave a trail, which is what makes an appraisal defensible.'],
  ];
  cards.forEach(([h1, h2], i) => {
    const x = M + i * 4.12;
    card(s, x, 1.95, 3.85, 2.9);
    bead(s, x + 0.35, 2.25, String(i + 1), i === 0 ? AMBER : TEAL, 0.5);
    s.addText(h1, {
      x: x + 0.35, y: 2.92, w: 3.2, h: 0.4, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 17, bold: true, color: INK,
    });
    s.addText(h2, {
      x: x + 0.35, y: 3.4, w: 3.2, h: 1.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 17,
    });
  });

  card(s, M, 5.15, W - M * 2, 1.3);
  s.addText(
    [
      { text: 'Installed with one command, ', options: { bold: true, color: INK } },
      { text: 'and it checks itself afterwards: twenty-two readiness checks covering the '
        + 'org chart, permissions, forms, mail and sign-in — each one naming what to fix '
        + 'rather than simply failing.' },
    ],
    {
      x: M + 0.45, y: 5.42, w: W - M * 2 - 0.9, h: 0.8, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 20,
    },
  );
}

/* ================================================================== *
 * 14 — What is next
 * ================================================================== */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.ShapeType.ellipse, {
    x: 10.4, y: -1.2, w: 5.2, h: 5.2, fill: { color: DARK_2 }, line: { color: DARK_2 },
  });

  s.addText('WHAT COMES NEXT', {
    x: M, y: 0.75, w: 8, h: 0.35, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, bold: true, charSpacing: 3, color: '8FBDB2',
  });
  s.addText('The scoring model is the last big piece', {
    x: M, y: 1.15, w: 10.5, h: 0.8, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 32, bold: true, color: WHITE,
  });
  s.addText(
    'Everything shown today is built and running. What is not yet built is your KPI '
    + 'composite — the 30 / 40 / 30 split, the task multipliers, and the conversion of '
    + 'task points into a score. That is deliberate: three details in the workbook read '
    + 'two different ways, and guessing would be worse than asking.',
    {
      x: M, y: 2.15, w: 8.6, h: 1.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 15, color: 'BFD6D0', valign: 'top', lineSpacing: 22,
    },
  );

  const asks = [
    ['Is the quarterly task tally measured against each role’s own target?',
     'As the scorecards are drawn, identical performance can score 35, 30 or 10 depending only on how the scorecard was written.'],
    ['The incentive bands need two corrections',
     'Nothing covers exactly 70, and one row reads “80% or 30%”.'],
    ['When does the probationary clock start?',
     'Hire date or regularisation — and what happens when regularisation moves.'],
  ];
  asks.forEach(([q, why], i) => {
    const y = 3.95 + i * 1.0;
    bead(s, M, y, String(i + 1), AMBER, 0.44);
    s.addText(q, {
      x: M + 0.62, y: y - 0.03, w: 11.0, h: 0.33, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14.5, bold: true, color: WHITE,
    });
    s.addText(why, {
      x: M + 0.62, y: y + 0.31, w: 11.0, h: 0.4, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: '9FC2BA', valign: 'top', lineSpacing: 16,
    });
  });

  s.addText(
    'Twenty-one questions in total, written up and ready to send. Answers turn most of '
    + 'them into settings on screens you have already seen.',
    {
      x: M, y: 6.85, w: 11.5, h: 0.4, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, italic: true, color: '8FBDB2',
    },
  );
  s.addNotes(
    'Close here rather than on a feature. The ask is concrete and it is theirs to answer. '
    + 'Do not promise dates for the composite until R1 is answered — the normalisation '
    + 'question changes the shape of the calculation, not just its inputs.',
  );
}

pres.writeFile({ fileName: 'Guanzon-HCM-System-Demo.pptx' })
  .then((f) => console.log('wrote', f));
