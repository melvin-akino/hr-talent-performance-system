const pptxgen = require('pptxgenjs');

/* Same palette and faces as the system deck — these are read together. */
const INK = '10201C', MUTED = '5C6E68', DARK = '0A3D36', DARK_2 = '0E5248';
const TEAL = '0B6E5F', TEAL_TINT = 'E3EDEA';
const AMBER = 'B3761B', AMBER_TINT = 'F6EEDF';
const GROUND = 'F3F6F5', WHITE = 'FFFFFF';
const HEAD = 'Cambria', BODY = 'Calibri';
const W = 13.3, M = 0.7;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'Summit Logic Solutions';
pres.company = 'Summit Logic Solutions';
pres.title = 'Guanzon HCM — What each role can do';

const softShadow = () => ({ type: 'outer', color: '0A3D36', blur: 14, offset: 3, angle: 90, opacity: 0.10 });

function lightSlide(kicker, title, notes) {
  const s = pres.addSlide();
  s.background = { color: GROUND };
  s.addText(kicker.toUpperCase(), {
    x: M, y: 0.45, w: 10, h: 0.3, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: TEAL,
  });
  s.addText(title, {
    x: M, y: 0.78, w: W - M * 2, h: 0.85, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 32, bold: true, color: INK,
  });
  if (notes) s.addNotes(notes);
  return s;
}

function card(s, x, y, w, h) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: WHITE }, line: { color: 'E1E8E6', width: 0.75 },
    shadow: softShadow(),
  });
}

/**
 * One role: who holds it, then two columns — what they can reach and what the
 * system refuses them. Both columns are drawn from the grant table, so the
 * right-hand column is not rhetoric: it is the absence of a grant.
 */
function rolePage(cfg) {
  const s = lightSlide(cfg.kicker, cfg.title, cfg.notes);

  card(s, M, 1.9, W - M * 2, 0.95);
  s.addShape(pres.ShapeType.roundRect, {
    x: M + 0.35, y: 2.1, w: 1.55, h: 0.55, rectRadius: 0.05,
    fill: { color: cfg.chipFill }, line: { color: cfg.chipFill },
  });
  s.addText(cfg.chip, {
    x: M + 0.35, y: 2.1, w: 1.55, h: 0.55, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12.5, bold: true, color: cfg.chipInk,
    align: 'center', valign: 'middle',
  });
  s.addText(cfg.who, {
    x: M + 2.15, y: 2.1, w: W - M * 2 - 2.6, h: 0.55, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13.5, color: MUTED, valign: 'middle',
  });

  const colW = (W - M * 2 - 0.4) / 2;
  [['CAN', cfg.can, TEAL, M], ['CANNOT', cfg.cannot, AMBER, M + colW + 0.4]]
    .forEach(([label, items, colour, x]) => {
      card(s, x, 3.05, colW, 3.5);
      s.addText(label, {
        x: x + 0.4, y: 3.28, w: 3, h: 0.32, isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 11, bold: true, charSpacing: 2, color: colour,
      });
      items.forEach((t, i) => {
        const y = 3.72 + i * 0.52;
        s.addShape(pres.ShapeType.ellipse, {
          x: x + 0.4, y: y + 0.11, w: 0.15, h: 0.15,
          fill: { color: colour }, line: { color: colour },
        });
        s.addText(t, {
          x: x + 0.72, y, w: colW - 1.1, h: 0.48, isTextBox: true, margin: 0,
          fontFace: BODY, fontSize: 12.5, color: MUTED, valign: 'top', lineSpacing: 16,
        });
      });
    });
  return s;
}

/* ================================================================== *
 * 1 — Title
 * ================================================================== */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.ShapeType.ellipse, {
    x: 9.9, y: -1.4, w: 5.8, h: 5.8, fill: { color: DARK_2 }, line: { color: DARK_2 },
  });
  s.addText('GUANZON  ·  HUMAN CAPITAL MANAGEMENT', {
    x: M, y: 1.95, w: 9, h: 0.35, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, bold: true, charSpacing: 3, color: '8FBDB2',
  });
  s.addText('What each role can do —\nand what it cannot', {
    x: M, y: 2.4, w: 8.6, h: 1.8, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 38, bold: true, color: WHITE, valign: 'top', lineSpacing: 44,
  });
  s.addText(
    'Every line in this pack is taken from the permission table the system '
    + 'actually enforces. The “cannot” column is not policy — it is the absence '
    + 'of a grant, and the database refuses it.',
    {
      x: M, y: 4.45, w: 8.4, h: 1.1, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 15, color: 'BFD6D0', valign: 'top', lineSpacing: 22,
    },
  );
  s.addNotes(
    'Companion to the system demo. Open by saying the cannot column is generated '
    + 'from the same table as the can column — nobody wrote it as a promise.',
  );
}

/* ================================================================== *
 * 2 — Rank vs role
 * ================================================================== */
{
  const s = lightSlide('How to read this', 'Rank and access are two different things',
    'Head this off before it causes confusion. Access comes from ROLE. Rank drives '
    + 'peer-review routing. The supervisor role is derived from the org chart — '
    + 'whoever has people reporting to them gets it — so it follows a transfer '
    + 'automatically, and HCM never maintains a second list.');

  const cols = [
    ['Rank decides who reviews whom', TEAL,
     'R6 to R11, your own numbering, lower being more senior. The peer-review rules read it directly: same rank, one up, two up. It does not by itself grant access to anything.'],
    ['Role decides what you can open', AMBER,
     'Employee, Supervisor, Department Head, HCM. This is what the database checks on every single row, on every screen, every report and every export.'],
  ];
  cols.forEach(([title, colour, text], i) => {
    const x = M + i * 6.25;
    card(s, x, 1.95, 5.85, 2.15);
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.4, y: 2.22, w: 0.38, h: 0.38, fill: { color: colour }, line: { color: colour },
    });
    s.addText(title, {
      x: x + 0.92, y: 2.2, w: 4.6, h: 0.42, isTextBox: true, margin: 0,
      fontFace: HEAD, fontSize: 17, bold: true, color: INK, valign: 'middle',
    });
    s.addText(text, {
      x: x + 0.4, y: 2.78, w: 5.05, h: 1.15, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: MUTED, valign: 'top', lineSpacing: 18,
    });
  });

  card(s, M, 4.35, W - M * 2, 2.1);
  s.addText('The supervisor role maintains itself', {
    x: M + 0.45, y: 4.6, w: 8, h: 0.38, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 18, bold: true, color: INK,
  });
  s.addText(
    'Nobody is marked a supervisor by hand. The system reads the reporting lines '
    + 'and grants it to whoever has people under them — so when somebody transfers, '
    + 'is promoted, or takes on a team, their access follows on its own. There is no '
    + 'second list for HCM to keep in step, and no leftover access when a team moves '
    + 'away from someone.',
    {
      x: M + 0.45, y: 5.05, w: W - M * 2 - 0.9, h: 1.2, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: MUTED, valign: 'top', lineSpacing: 20,
    },
  );
}

/* ================================================================== *
 * 3–6 — One page per role
 * ================================================================== */
rolePage({
  kicker: 'Role 1 of 4',
  title: 'Employee',
  chip: 'EMPLOYEE', chipFill: TEAL_TINT, chipInk: INK,
  who: 'Everyone has it — 28 of 28. Example: Josefina Gonzaga, Associate (R11), Hiring & Selection.',
  can: [
    'Open their own record, and only their own',
    'Set and update their own targets, and record progress against them',
    'Write and keep their own development plan',
    'Read their own PIP, and their own competency assessment',
    'Read a result once it has been signed off, and acknowledge it',
  ],
  cannot: [
    'Open any other person’s record — including a colleague at the same desk',
    'See their own evaluation before it is signed off',
    'See who was asked to review them on a peer panel',
    'Change a target after it has been approved (it goes back through approval)',
    'Reach any setup screen',
  ],
  notes: 'Sign in as josefina.gonzaga. Show that Team and the org-wide screens are '
    + 'simply not there — not greyed out, not empty: absent. Then show her own goals '
    + 'and her own history, which are complete.',
});

rolePage({
  kicker: 'Role 2 of 4',
  title: 'Supervisor',
  chip: 'SUPERVISOR', chipFill: TEAL, chipInk: WHITE,
  who: 'Derived from the org chart — 5 of 28 today. Example: Crisanto Rivera, Section Head (R7), Employee Relations, 8 reports.',
  can: [
    'Everything an employee can, on their own record',
    'See everyone beneath them in the chart, however many levels down',
    'Approve the targets of their people — the first of the two gates',
    'Write the evaluation of anyone reporting directly to them',
    'Open a PIP, and assess competencies, for their direct reports',
  ],
  cannot: [
    'See a colleague’s team — another Section Head’s people are invisible',
    'Approve or release an evaluation; that needs the Department Head',
    'Change the org chart, ranks, positions or forms',
    'Set or reset any scoring parameter',
    'Read the audit trail',
  ],
  notes: 'The demo that lands. Sign in as crisanto.rivera and show his eight people. '
    + 'Then sign in as dalisay.zamora — same rank, different section — and show that '
    + 'Crisanto’s eight have vanished. Nothing was configured to make that happen.',
});

rolePage({
  kicker: 'Role 3 of 4',
  title: 'Department Head',
  chip: 'DEPT HEAD', chipFill: TEAL, chipInk: WHITE,
  who: 'Configured, not yet assigned to anyone in the demo. Intended for Alonzo Dimalanta, Department Manager (R6).',
  can: [
    'See the whole department, across every section',
    'Revise, approve or send back an evaluation — your §4.5b',
    'Write and approve targets anywhere in the department',
    'Read PIPs and feedback across the department',
  ],
  cannot: [
    'Reach organisation-wide setup — forms, cycles, roles',
    'Set or reset scoring parameters',
    'Assign roles to people',
    'See another department',
  ],
  notes: 'BE STRAIGHT HERE: the role and its approval step are built and tested, but '
    + 'nobody is assigned to it in the demo tenant, so there is no login to show. Say '
    + 'that plainly and offer to assign it before the next session rather than '
    + 'clicking around it.',
});

rolePage({
  kicker: 'Role 4 of 4',
  title: 'HCM Administrator',
  chip: 'HCM', chipFill: AMBER, chipInk: WHITE,
  who: 'One person — Alonzo Dimalanta. Deliberately: this is the role that can change how everyone else is evaluated.',
  can: [
    'See every employee and every result in the organisation',
    'Approve targets as the second gate, and send them back with a note',
    'Approve and release evaluations',
    'Build forms and rating scales, open cycles and goal periods',
    'Load staff, edit the org chart, ranks and positions',
    'Assign roles, and read the full audit trail',
  ],
  cannot: [
    'Set or reset scoring parameters — a separate, narrower capability exists for that, per your §3.8',
    'See into another company’s data, at any level',
    'Delete a record so that it disappears; records close, and history stays',
    'Act without leaving a trail — every change is attributable',
  ],
  notes: 'The point to make: even the most powerful role in the system does not get '
    + 'the scoring parameters. Their own spec asked for that separation and it is '
    + 'built as its own capability.',
});

/* ================================================================== *
 * 7 — The matrix
 * ================================================================== */
{
  const s = lightSlide('At a glance', 'The same table the system checks',
    'Hand this out. It is generated from the grant table, so it is worth saying that '
    + 'it cannot drift from the running system without someone changing the grants.');

  const rows = [
    ['Their own record and targets', 'Y', 'Y', 'Y', 'Y'],
    ['Their team’s records', '—', 'Y', 'Y', 'Y'],
    ['The whole department', '—', '—', 'Y', 'Y'],
    ['The whole organisation', '—', '—', '—', 'Y'],
    ['Approve targets (first gate)', '—', 'Y', 'Y', 'Y'],
    ['Approve targets (HCM gate)', '—', '—', '—', 'Y'],
    ['Write an evaluation', '—', 'Y', 'Y', 'Y'],
    ['Approve / release an evaluation', '—', '—', 'Y', 'Y'],
    ['Open a PIP', '—', 'Y', 'Y', 'Y'],
    ['Forms, cycles, org chart, ranks', '—', '—', '—', 'Y'],
    ['Assign roles · read the audit trail', '—', '—', '—', 'Y'],
    ['Set scoring parameters', '—', '—', '—', '—'],
  ];

  const x0 = M, colX = [6.4, 8.0, 9.6, 11.3];
  ['Employee', 'Supervisor', 'Dept Head', 'HCM'].forEach((h, i) => {
    s.addText(h, {
      x: colX[i] - 0.55, y: 1.85, w: 1.5, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, bold: true, color: TEAL, align: 'center',
    });
  });

  rows.forEach(([label, ...vals], i) => {
    const y = 2.25 + i * 0.37;
    if (i % 2 === 0) {
      s.addShape(pres.ShapeType.rect, {
        x: x0 - 0.1, y: y - 0.04, w: W - M * 2 + 0.2, h: 0.36,
        fill: { color: WHITE }, line: { color: WHITE },
      });
    }
    s.addText(label, {
      x: x0, y, w: 5.4, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK, valign: 'middle',
    });
    vals.forEach((v, j) => {
      if (v === 'Y') {
        s.addShape(pres.ShapeType.ellipse, {
          x: colX[j] - 0.09, y: y + 0.07, w: 0.18, h: 0.18,
          fill: { color: TEAL }, line: { color: TEAL },
        });
      } else {
        s.addText('—', {
          x: colX[j] - 0.3, y, w: 0.6, h: 0.3, isTextBox: true, margin: 0,
          fontFace: BODY, fontSize: 12.5, color: 'B9C6C2', align: 'center', valign: 'middle',
        });
      }
    });
  });

  s.addText(
    'Scoring parameters sit with a separate capability that none of these four roles '
    + 'carries — exactly as your §3.8 asks.',
    {
      x: M, y: 6.85, w: W - M * 2, h: 0.35, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, italic: true, color: MUTED,
    },
  );
}

/* ================================================================== *
 * 8 — What nobody can do
 * ================================================================== */
{
  const s = lightSlide('The guardrails', 'Things nobody can do, whatever their role',
    'These are the ones that protect the process rather than the data. Each is '
    + 'enforced underneath the screens, so it holds on a report and an export too.');

  const items = [
    ['See a result before sign-off', 'Including the person it is about, on their own record. Calibration happens before anyone sees a number.'],
    ['See who reviewed them', 'A subject cannot open their own peer panel. The system refuses it at the row, not on the screen.'],
    ['See a task evaluation still in draft', 'The subject cannot see it until it is submitted — so an unfinished judgement is never half-read.'],
    ['Reach another company', 'Every check is scoped to one organisation first. No role, however senior, crosses that line.'],
    ['Make a record disappear', 'Departments and employment close with a date. History stays answerable a year later.'],
    ['Change anything silently', 'Who changed what, and when. That trail is what makes an appraisal defensible.'],
  ];
  items.forEach(([h1, h2], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * 6.25, y = 1.95 + row * 1.62;
    card(s, x, y, 5.85, 1.42);
    s.addShape(pres.ShapeType.ellipse, {
      x: x + 0.38, y: y + 0.28, w: 0.34, h: 0.34, fill: { color: AMBER }, line: { color: AMBER },
    });
    s.addText(h1, {
      x: x + 0.86, y: y + 0.24, w: 4.7, h: 0.4, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14.5, bold: true, color: INK, valign: 'middle',
    });
    s.addText(h2, {
      x: x + 0.86, y: y + 0.68, w: 4.7, h: 0.6, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: MUTED, valign: 'top', lineSpacing: 15,
    });
  });
}

/* ================================================================== *
 * 9 — The live walkthrough
 * ================================================================== */
{
  const s = pres.addSlide();
  s.background = { color: DARK };
  s.addShape(pres.ShapeType.ellipse, {
    x: 12.3, y: 0.35, w: 2.3, h: 2.3, fill: { color: DARK_2 }, line: { color: DARK_2 },
  });

  s.addText('THE LIVE WALKTHROUGH', {
    x: M, y: 0.7, w: 8, h: 0.35, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, bold: true, charSpacing: 3, color: '8FBDB2',
  });
  s.addText('Three sign-ins, in this order', {
    x: M, y: 1.1, w: 10.5, h: 0.7, isTextBox: true, margin: 0,
    fontFace: HEAD, fontSize: 32, bold: true, color: WHITE,
  });

  const steps = [
    ['josefina.gonzaga', 'Associate, R11',
     'Start at the bottom. Her own targets and history are complete; the team and setup screens are not there at all.'],
    ['crisanto.rivera', 'Section Head, R7 — 8 reports',
     'His eight people, their targets, the evaluations he owes. Approve a target to show the first gate.'],
    ['dalisay.zamora', 'Section Head, R7 — different section',
     'Same rank, same screens, and Crisanto’s eight have vanished. This is the moment worth pausing on.'],
  ];
  steps.forEach(([user, rank, what], i) => {
    const y = 2.15 + i * 1.35;
    s.addShape(pres.ShapeType.ellipse, {
      x: M, y, w: 0.5, h: 0.5, fill: { color: AMBER }, line: { color: AMBER },
    });
    s.addText(String(i + 1), {
      x: M, y, w: 0.5, h: 0.5, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 15, bold: true, color: WHITE, align: 'center', valign: 'middle',
    });
    s.addText(user, {
      x: M + 0.75, y: y - 0.02, w: 3.6, h: 0.35, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 16, bold: true, color: WHITE,
    });
    s.addText(rank, {
      x: M + 4.4, y: y + 0.02, w: 3.4, h: 0.3, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: '8FBDB2',
    });
    s.addText(what, {
      x: M + 0.75, y: y + 0.38, w: 10.4, h: 0.7, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: 'BFD6D0', valign: 'top', lineSpacing: 18,
    });
  });

  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 6.25, w: W - M * 2, h: 0.85, rectRadius: 0.06,
    fill: { color: DARK_2 }, line: { color: DARK_2 },
  });
  s.addText(
    [
      { text: 'One password for the whole demo: ', options: { color: 'BFD6D0' } },
      { text: 'test1234', options: { bold: true, color: WHITE } },
      { text: '.  Every person in it is invented — the structure is yours, the people are not.',
        options: { color: 'BFD6D0' } },
    ],
    {
      x: M + 0.4, y: 6.25, w: W - M * 2 - 0.8, h: 0.85, isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, valign: 'middle',
    },
  );

  s.addNotes(
    'Run these three in order and the point makes itself. Step 3 is the one to slow '
    + 'down for: same rank, same screens, different people — and nothing was '
    + 'configured to produce it. Do not skip saying the people are invented.',
  );
}

pres.writeFile({ fileName: 'Guanzon-HCM-Role-Permissions.pptx' })
  .then((f) => console.log('wrote', f));
