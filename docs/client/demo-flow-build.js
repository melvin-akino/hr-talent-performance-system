/* Builds the client demo meeting flow + HR setup FAQ as a .docx. */
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, PageBreak, Footer, PageNumber,
} = require('docx');
const fs = require('fs');

const ACCENT = '2C455D';
const MUTED = '5D5D60';
const WARN = '8A4B08';
const PAGE_W = 12240, MARGIN = 1080;
const CONTENT = PAGE_W - MARGIN * 2; // 10080 dxa

/* ── helpers ─────────────────────────────────────────────────────────── */

const H1 = (t) => new Paragraph({
  text: t, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 },
});
const H2 = (t) => new Paragraph({
  text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
});
const H3 = (t) => new Paragraph({
  text: t, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 },
});

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120 },
  children: [new TextRun({ text, size: 20, ...opts })],
});

/** Rich paragraph: array of [text, {bold?, italics?, color?}] */
const RP = (parts, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120 },
  indent: opts.indent,
  children: parts.map(([t, o = {}]) => new TextRun({ text: t, size: 20, ...o })),
});

const BULLET = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 60 },
  children: [new TextRun({ text, size: 20 })],
});

const RBULLET = (parts, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 60 },
  children: parts.map(([t, o = {}]) => new TextRun({ text: t, size: 20, ...o })),
});

const NUM = (text) => new Paragraph({
  numbering: { reference: 'steps', level: 0 },
  spacing: { after: 60 },
  children: [new TextRun({ text, size: 20 })],
});

const RNUM = (parts) => new Paragraph({
  numbering: { reference: 'steps', level: 0 },
  spacing: { after: 60 },
  children: parts.map(([t, o = {}]) => new TextRun({ text: t, size: 20, ...o })),
});

/** The "say this" line — an indented, italic, accented callout. */
const SAY = (text) => new Paragraph({
  spacing: { before: 80, after: 160 },
  indent: { left: 360 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
  children: [
    new TextRun({ text: 'Say: ', size: 20, bold: true, color: ACCENT }),
    new TextRun({ text, size: 20, italics: true }),
  ],
});

/** A shaded box for warnings / status. */
const BOX = (title, lines, fill = 'F4EFE6', titleColor = WARN) => new Table({
  width: { size: CONTENT, type: WidthType.DXA },
  columnWidths: [CONTENT],
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: CONTENT, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill },
      margins: { top: 140, bottom: 140, left: 180, right: 180 },
      children: [
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: title, bold: true, size: 20, color: titleColor })],
        }),
        ...lines.map((l) => Array.isArray(l)
          ? new Paragraph({
              spacing: { after: 60 },
              children: l.map(([t, o = {}]) => new TextRun({ text: t, size: 20, ...o })),
            })
          : new Paragraph({
              spacing: { after: 60 },
              children: [new TextRun({ text: l, size: 20 })],
            })),
      ],
    })],
  })],
});

const SPACER = () => new Paragraph({ spacing: { after: 160 }, children: [] });

/** Table with a header row. widths must sum to CONTENT. */
function TBL(headers, rows, widths) {
  /* A cell is a plain string, a single [text, opts] pair, or a list of pairs.
     Normalise all three to a list of pairs so there is one code path. */
  const pairs = (text) => {
    if (typeof text === 'string') return [[text, {}]];
    if (Array.isArray(text) && typeof text[0] === 'string') return [text];
    return text;
  };
  const cell = (text, w, opts = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: opts.head ? { type: ShadingType.CLEAR, fill: 'E8EDF2' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      spacing: { after: 0 },
      children: pairs(text).map(([s, o = {}]) =>
        new TextRun({ text: s, size: 18, bold: !!opts.head, ...o })),
    })],
  });
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, widths[i], { head: true })),
      }),
      ...rows.map((r) => new TableRow({
        children: r.map((c, i) => cell(c, widths[i])),
      })),
    ],
  });
}

/* ── content ─────────────────────────────────────────────────────────── */

const children = [];

/** A question with a plain answer, and optionally the precise wording. */
const faq = (q, a, extra) => {
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: q, size: 20, bold: true, color: ACCENT })],
  }));
  (Array.isArray(a) ? a : [a]).forEach((para) => {
    if (para === '') return;
    children.push(Array.isArray(para) ? RP(para) : P(para));
  });
  if (extra) extra.forEach((e) => children.push(e));
};

/* Normalise a string, a single [text, opts] pair, or a list of pairs into a
   list of pairs. Same ambiguity the table cells had; solved the same way. */
const asPairs = (v) => {
  if (typeof v === 'string') return [[v, {}]];
  if (Array.isArray(v) && typeof v[0] === 'string') return [v];
  return v;
};

/** Technical Q: what to say in plain words, then the exact version if pushed. */
const TQ = (q, say, precise) => {
  children.push(new Paragraph({
    spacing: { before: 220, after: 80 },
    children: [new TextRun({ text: q, size: 20, bold: true, color: ACCENT })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: 'Say: ', size: 20, bold: true }),
      ...asPairs(say).map(([t, o = {}]) => new TextRun({ text: t, size: 20, ...o })),
    ],
  }));
  if (precise) {
    children.push(new Paragraph({
      spacing: { after: 140 },
      indent: { left: 360 },
      children: [
        new TextRun({ text: 'If they want the exact terms: ', size: 18, italics: true, color: MUTED }),
        ...asPairs(precise).map(([t, o = {}]) =>
          new TextRun({ text: t, size: 18, color: MUTED, ...o })),
      ],
    }));
  }
};

// Title
children.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: 'Guanzon Human Capital Management', size: 22, color: MUTED })],
}));
children.push(new Paragraph({
  spacing: { after: 100 },
  children: [new TextRun({
    text: 'Performance & Talent System — Client Demo', size: 40, bold: true, color: ACCENT,
  })],
}));
children.push(new Paragraph({
  spacing: { after: 240 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({
    text: 'How to run the meeting, what to say, and how to answer the hard questions',
    size: 22, color: MUTED,
  })],
}));

children.push(RP([
  ['Prepared by ', {}], ['Summit Logic Solutions', { bold: true }],
  ['  ·  25 September 2026  ·  Demo site: ', {}],
  ['https://hr.summitlogicsolutions.com', { bold: true }],
], { after: 200 }));

children.push(BOX('Read this before you present', [
  [['The demo uses ', {}], ['your own company structure', { bold: true }],
   [' — five sections, ranks 6 to 11, your real reporting lines — but ', {}],
   ['all 28 people in it are made up', { bold: true }],
   ['. No real name from your workbook is in the system anywhere. Say this early. It answers the privacy question before anyone asks it.', {}]],
  [['Every demo login uses the same password, ', {}], ['test1234', { bold: true }],
   ['. That is fine for a demo and must never be true in real use, where staff sign in with their normal office password.', {}]],
  [['Two new features — ', {}], ['Reports', { bold: true }], [' and ', {}], ['Requests', { bold: true }],
   [' — are ', {}], ['finished but not yet installed on the demo site', { bold: true, color: WARN }],
   ['. Section 7 presents them as coming soon. Do not open them unless they have been installed before the meeting.', {}]],
]));

children.push(SPACER());

children.push(RP([
  ['This document has three parts. ', {}],
  ['Part One', { bold: true }], [' is the meeting itself, minute by minute. ', {}],
  ['Part Two', { bold: true }], [' answers the HR Manager’s questions about setting it up and running it. ', {}],
  ['Part Three', { bold: true }], [' answers the IT person’s questions ', {}],
  ['in plain English', { bold: true }],
  [', with the technical wording underneath each answer for when they push. You do not need a technical background to use it.', {}],
], { after: 200 }));

/* ── Section 1 ───────────────────────────────────────────────────── */
children.push(H1('1. The shape of the meeting'));

children.push(P(
  'One hour, built around three logins. Start with the person who can see the '
  + 'least and finish with the person who can see the most. Each one then adds '
  + 'to a picture the room has already built.',
));

children.push(TBL(
  ['#', 'Part of the meeting', 'Who you log in as', 'Time'],
  [
    ['1', 'Setting the scene', 'No screen yet', '5 min'],
    ['2', 'An ordinary employee', ['josefina.gonzaga', { bold: true }], '8 min'],
    ['3', 'A supervisor', ['crisanto.rivera', { bold: true }], '12 min'],
    ['4', 'The HR Manager', ['alonzo.dimalanta', { bold: true }], '18 min'],
    ['5', 'Proving the privacy rules', 'Two logins, back to back', '6 min'],
    ['6', 'What we have not built yet', 'No screen', '6 min'],
    ['7', 'What comes next, and what we need', 'No screen', '5 min'],
  ],
  [520, 4100, 3660, 1800],
));

children.push(SPACER());

children.push(BOX('One rule for the whole meeting', [
  [['Do not say “the screen hides that from you.” Say ', {}],
   ['“the system will not give it to them.”', { bold: true, italics: true }],
   [' Hiding is a screen being polite. In this product the rule sits ', {}],
   ['inside the database', { bold: true }],
   [', underneath every screen, every report and every download. That is the strongest thing you can say all day, and it holds up no matter what they ask next.', {}]],
], 'EAF0F6', ACCENT));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 2 ───────────────────────────────────────────────────── */
children.push(H1('2. Setting the scene (5 minutes, no screen)'));

children.push(H3('Four things to establish, in this order'));
children.push(RNUM([['What it replaces.', { bold: true }],
  [' Targets, monthly check-ins, evaluations, skills, improvement plans and development. It runs on ', {}],
  ['your own', { italics: true }], [' server, in your own office.', {}]]));
children.push(RNUM([['What it is not.', { bold: true }],
  [' Not payroll. Not timekeeping. Not leave. No salaries, no payslips, no daily time records, and no government ID numbers. We do not store a single salary figure anywhere.', {}]]));
children.push(RNUM([['Where it came from.', { bold: true }],
  [' Built from your own 5-page document and your KPI workbook. The structure on screen is yours. Only the people are invented.', {}]]));
children.push(RNUM([['What today is for.', { bold: true }],
  [' Showing what works now, and being clear about what is waiting on decisions only you can make.', {}]]));

children.push(SAY(
  'Everything you are about to see runs on one server inside your own office. '
  + 'Your staff’s review data never leaves the building. The structure on screen '
  + 'is your own chart from the HCM workbook. Every person in it is invented, '
  + 'because we were not going to put your staff’s names into a test system '
  + 'before you had signed anything.',
));

children.push(H3('Three things not to do in the first five minutes'));
children.push(BULLET('Do not open the charts and graphs yet. They look impressive and they mean nothing until people know whose information they are looking at.'));
children.push(BULLET('Do not bring up the KPI scoring yet. It is the one visible gap, and it belongs in Section 6 as a question for them, not an apology from you.'));
children.push(BULLET('Do not promise that the office login integration works. It is built and it has never been tested on a real office directory. That also belongs in Section 6.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 3 ───────────────────────────────────────────────────── */
children.push(H1('3. An ordinary employee — Josefina Gonzaga (8 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'josefina.gonzaga / test1234'],
    [['Who she is', { bold: true }], 'Associate in Screening. Rank 11, the most junior level. Nobody reports to her.'],
    [['What she can do', { bold: true }], 'Only things about herself.'],
    [['Why this matters', { bold: true }],
      'Most of your company is Josefina. If the system is annoying for her, it fails — no matter how good the HR screens are.'],
  ],
  [2200, 7880],
));

children.push(SPACER());
children.push(H3('Show these, in this order'));

children.push(RNUM([['Her targets.', { bold: true }],
  [' Each one has something being measured, a starting point, a goal and a weight. Point out that the weights add up to 100% — and that the system is what knows whether they do.', {}]]));
children.push(RNUM([['Open one target.', { bold: true }],
  [' Show a monthly update. This small habit is what the whole system runs on: a short note against a number, once a month.', {}]]));
children.push(RNUM([['Her self-evaluation.', { bold: true }],
  [' Show that once she submits it she cannot change it — and explain why that protects her as much as anyone.', {}]]));
children.push(RNUM([['Her skills.', { bold: true }],
  [' What her job requires, what she has been assessed at, and the gap between the two.', {}]]));
children.push(RNUM([['The help button.', { bold: true }],
  [' Open it on whatever screen you are on. It shows help for ', {}], ['that', { italics: true }],
  [' screen first. Type a plain-English question and show that it finds the answer.', {}]]));

children.push(SAY(
  'This is the whole system for most of your staff. They will open it maybe six '
  + 'times a year — when targets are set, once a month for an update, and at '
  + 'evaluation time. Everything here is built around that. They should never '
  + 'need training, and the help is inside the screen rather than in a manual '
  + 'nobody can find.',
));

children.push(H3('What she cannot do — show it, do not just say it'));

children.push(TBL(
  ['Do this in front of them', 'What happens', 'What to say'],
  [
    ['Look for Team, HR, Reports or Settings in her menu',
     'They are not there',
     'The menu simply does not offer them. That part is only tidiness — the real protection is the next row.'],
    ['Paste a colleague’s record address into the browser',
     ['“Not found”', { bold: true }],
     'Not “you are not allowed” — not found. As far as her login is concerned, that record does not exist. Saying “not allowed” would tell her it does.'],
    ['Look for her rating before it has been released',
     'It is not there',
     'An evaluation stays invisible to the person it is about until it is finalised. That includes any download.'],
  ],
  [3200, 2200, 4680],
));

children.push(SPACER());
children.push(BOX('Keep it short', [
  'Eight minutes, no more. Senior people get restless in the employee view. But do not skip it — every question in Section 5 depends on the room having seen what Josefina could not see.',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 4 ───────────────────────────────────────────────────── */
children.push(H1('4. A supervisor — Crisanto Rivera (12 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'crisanto.rivera / test1234'],
    [['Who he is', { bold: true }], 'Section Head for Employee Relations. Rank 7, with 8 people under him.'],
    [['What he can do', { bold: true }], 'Everything Josefina can, about himself — plus everything about his 8 people.'],
    [['Why this matters', { bold: true }],
      'A supervisor is an employee with a second job. Both roles sit on one login, and the system knows which one applies to which record.'],
  ],
  [2200, 7880],
));

children.push(SPACER());
children.push(H3('Show these, in this order'));

children.push(RNUM([['His own targets first.', { bold: true }],
  [' Five seconds. It makes the point that he is still an employee too.', {}]]));
children.push(RNUM([['His team.', { bold: true }],
  [' His 8 people, with how many have targets set and how they are doing. Find the one with a gap and stop there.', {}]]));
children.push(RNUM([['Approve a target.', { bold: true }],
  [' Better still, send one back with a reason. The reason travels with it and the employee is told — which is the part people do not expect.', {}]]));
children.push(RNUM([['The watch list.', { bold: true }],
  [' Who has not posted an update, whose targets have gone quiet, who has slipped twice in a row.', {}]]));
children.push(RNUM([['His section summary.', { bold: true }],
  [' How his section is doing overall, plus ', {}], ['what is waiting on him', { bold: true }],
  [' and ', {}], ['who he is holding up', { bold: true }], ['.', {}]]));
children.push(RNUM([['An evaluation he has to write.', { bold: true }],
  [' Show that what he writes about someone is not visible to that person while he is still working on it.', {}]]));

children.push(SAY(
  'Notice I have not changed screens. This is the same section summary a '
  + 'Department Head opens, and the same one an Area Head opens. Nobody built '
  + 'three versions of it. What changes is how far each person can see, and the '
  + 'system works that out — the screen does not.',
));

children.push(H3('The 60 seconds that proves the point'));
children.push(RP([
  ['If you have time, log in as ', {}], ['dalisay.zamora', { bold: true }],
  [' — also a Section Head, same rank, different section. ', {}],
  ['Same screen, different people.', { bold: true }],
  [' She sees her section and not Crisanto’s. Two people at exactly the same level, and neither can see into the other’s area.', {}],
]));

children.push(H3('What he cannot do'));
children.push(TBL(
  ['Try this', 'What happens', 'Why it matters'],
  [
    ['Approve his own target', 'Refused', 'Built into the system itself, not just the screen. There is no way to approve your own.'],
    ['Open someone in Dalisay’s section', ['“Not found”', { bold: true }], 'Same rank does not mean same reach. Access follows the section, not the job title.'],
    ['Open the HR screens or Settings', 'Not offered, and refused if forced', 'Running an evaluation round is an HR job, not a supervisor one.'],
  ],
  [2800, 2000, 5280],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 5 ───────────────────────────────────────────────────── */
children.push(H1('5. The HR Manager — Alonzo Dimalanta (18 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'alonzo.dimalanta / test1234'],
    [['Who he is', { bold: true }], 'Department Manager, Rank 6 — head of Human Capital Management.'],
    [['What he can do', { bold: true }], 'Everything, across the whole department. He also runs the system itself.'],
    [['Why this matters', { bold: true }],
      'This is the person deciding whether to buy. Everything here is about running the process, not taking part in it.'],
  ],
  [2200, 7880],
));

children.push(SPACER());

children.push(BOX('Say this out loud — do not let someone spot it first', [
  [['Alonzo wears four hats at once, including both ', {}], ['Department Head', { bold: true }],
   [' and ', {}], ['system administrator', { bold: true }],
   ['. That is correct for how your company is set up — in HCM, the Department Head ', {}],
   ['is', { italics: true }], [' the Department Manager. It is the one place in the demo where two approval steps land on the same person.', {}]],
  [['In a branch these would be two different people, and the system would not care — it works the same either way. ', {}],
   ['Say it before anyone notices.', { bold: true }],
   [' If someone spots it themselves it looks like a mistake. If you say it first, it shows that access is given to people, not baked into job titles.', {}]],
]));

children.push(SPACER());
children.push(H3('Show these, in this order'));

children.push(RNUM([['The HR overview.', { bold: true }],
  [' How the whole department is doing, and the problems: the person whose target weights do not add up, the targets nobody has updated.', {}]]));
children.push(RNUM([['Try to close the period — and let it refuse.', { bold: true }],
  [' The best 30 seconds in the whole meeting. It will not close while someone’s weights do not add to 100%. ', {}],
  ['Do not fix it first.', { bold: true }], [' Let it fail, then fix it, then close it.', {}]]));
children.push(RNUM([['Evaluation rounds.', { bold: true }],
  [' Open one, create the evaluations, show where each one has reached. Then try to finalise while someone has not finished, and let it refuse again.', {}]]));
children.push(RNUM([['Moderation.', { bold: true }],
  [' Ratings compared across sections, and a record of what the moderation meeting actually changed.', {}]]));
children.push(RNUM([['The charts.', { bold: true }],
  [' Rating spread, the nine-box grid, and ', {}], ['the comparison of raters', { bold: true }],
  [' — which supervisors mark generously and which mark harshly. HR people lean forward at this one.', {}]]));
children.push(RNUM([['Loading staff from a spreadsheet.', { bold: true }],
  [' Upload a file. ', {}], ['Preview first', { bold: true }],
  [' — it tells you exactly what it would do and changes nothing until you confirm.', {}]]));
children.push(RNUM([['Recording a promotion or transfer.', { bold: true }],
  [' Enter it with the date it took effect, then open that person’s history and show it sitting alongside their evaluations.', {}]]));
children.push(RNUM([['Settings.', { bold: true }],
  [' Departments, ranks, positions, evaluation forms, rating scales, and help articles HR writes themselves.', {}]]));

children.push(SAY(
  'Every refusal you just watched happens underneath the screen. If somebody '
  + 'went around the system and tried it another way, it would still refuse '
  + 'them. That is the difference between a rule and a reminder.',
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 6 ───────────────────────────────────────────────────── */
children.push(H1('6. Proving the privacy rules (6 minutes)'));

children.push(P(
  'This is the part that decides the meeting. Do it last, after they have seen '
  + 'all three logins, so they are comparing against something they remember.',
));

children.push(H3('The demonstration'));
children.push(NUM('Logged in as Alonzo, open somebody’s full record. Copy the address from the browser.'));
children.push(NUM('Log out. Log in as Josefina.'));
children.push(NUM('Paste the same address.'));
children.push(RNUM([['“Not found.”', { bold: true }],
  [' Not “you are not allowed”. As far as her login is concerned, that record is not there at all.', {}]]));

children.push(SAY(
  'That is not the screen being polite. The information never reached the '
  + 'screen. And we say “not found” on purpose — telling her “you are not '
  + 'allowed to see this record” would confirm the record exists, and for a '
  + 'performance record that is already a leak.',
));

children.push(H3('Three answers to have ready'));
children.push(TBL(
  ['If they ask', 'Answer'],
  [
    ['Can your developers see everything?',
     'The system logs into the database with a limited account that follows the same rules as everyone else. Only someone with full control of the server can go around them — and that is a person you employ, not a permission this software hands out.'],
    ['What if somebody changes the software?',
     'The rules are not in the software. They are in the database underneath it. You could replace the software entirely and the rules would still be there.'],
    ['Is there a record of who did what?',
     'Yes. Every change is recorded with the person’s name and the time — approvals, moderation changes, rating changes, uploads. Nothing is ever deleted; when someone leaves, their record is closed, not erased.'],
  ],
  [3000, 7080],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 7 ───────────────────────────────────────────────────── */
children.push(H1('7. What we have not built yet (6 minutes)'));

children.push(P(
  'Say this before they find it. A supplier who points out their own gaps gets '
  + 'believed about everything else.',
));

children.push(TBL(
  ['What is missing', 'Why', 'What we need from you'],
  [
    [['The KPI score calculation', { bold: true }],
     'The 30/40/30 split and the score bands. Three things in your workbook can be read two different ways — including one where the same performance scores 35, 30 or 10 depending only on how the scorecard was written. A scoring rule we guessed at would be worse than one that arrives late.',
     'Answers to 6 of the 21 questions.'],
    [['Office password sign-in', { bold: true }],
     'Built, and working against our own test setup. It has never been connected to a real office directory.',
     'Half a day with your IT team.'],
    [['Promotion tracks (MDP)', { bold: true }],
     'The stages and waiting times. Written down, not started.',
     'Confirmation of the stages and how long each lasts.'],
    [['Attendance', { bold: true }],
     'We take a count for the period, not a daily record. We are not building timekeeping.',
     'Which payroll system it comes from, and in what form.'],
  ],
  [2200, 5080, 2800],
));

children.push(SPACER());
children.push(BOX('Do not end the meeting without asking for this', [
  [['The 21 questions have been ready since 28 August and are still unanswered.', { bold: true }],
   [' Six of them are blocking the KPI scoring — the one part of your own specification the demo cannot show.', {}]],
  [['Get a name and a date against it before people leave the room. That single commitment is worth more to this project than anything else you could agree today.', {}]],
], 'F4EFE6', WARN));

children.push(SPACER());
children.push(H3('Coming next — finished, but not yet installed'));
children.push(RP([
  ['Both were finished this week and are waiting to be installed. ', {}],
  ['Do not demonstrate them unless that has happened before the meeting', { bold: true }],
  [' — promise them with a date, do not show them.', {}],
]));
children.push(RBULLET([['Reports.', { bold: true }],
  [' Search the evaluation history by person, type, period, section or result — for example, everyone whose improvement plan ended successfully. Downloads to a spreadsheet, and the search is saved in the link so a report can be sent rather than rebuilt.', {}]]));
children.push(RBULLET([['Requests.', { bold: true }],
  [' A Department Head asks for an extra skill to be assessed, a one-off evaluation, or a score to be adjusted. HR approves or declines with a reason, and the decision is kept with the request. ', {}],
  ['Approving records the decision — it does not quietly change the score', { bold: true }],
  [', so “who changed this” always has an answer.', {}]]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ══ PART TWO ════════════════════════════════════════════════════ */
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Part Two', size: 32, bold: true, color: ACCENT })],
}));
children.push(H1('8. The HR Manager’s questions'));

children.push(P(
  'These are the questions an HR Manager asks once they have decided they want '
  + 'it. The answers are written to be said out loud. Where the answer is “not '
  + 'yet”, it says so.',
));

children.push(H2('A. Getting our people into the system'));

faq('How do we load 2,000 employees without typing them all in?',
  [[['You upload a spreadsheet of your 201 file. ', {}],
    ['Download the blank template from inside the system', { bold: true }],
    [' rather than making your own — the template is produced by the same code that reads it, so the two can never disagree.', {}]],
   [['It happens in two steps. ', {}], ['Preview', { bold: true }],
    [' shows exactly what it would add, change and skip, and saves nothing. Only when you confirm does anything happen. You also cannot pick which company to load into — the system takes that from your own record.', {}]]]);

faq('What has to be in the spreadsheet?',
  'Employee number, name, work email, date hired, position and department. Everything else is optional and adds more as you supply it — section, area and branch build your org chart; rank sets the ladder; employment type decides which evaluation form applies.');

faq('If we upload the same file twice, do we get duplicates?',
  'No. It matches on employee number and updates instead of adding. That is deliberate — an upload you are afraid to repeat is one nobody dares correct.');

faq('What if the spreadsheet contradicts itself?',
  'It stops and tells you which row. Two examples: a person listed in both a section and an area — those are different kinds of unit, so the person is in one or the other — and the same unit appearing under two different parents. We refuse rather than guess.');

faq('Can an upload accidentally rearrange our org chart?',
  [[['No. A department that already exists is never moved or relabelled by an upload. Where the spreadsheet disagrees, it is reported so a person can decide in Settings. An upload that quietly reshapes your org chart is one you could never safely run twice.', {}]]]);

children.push(H2('B. Who can see and do what'));

faq('How does somebody get access?',
  [[['Two separate things. ', {}], ['Being in the HR department gives you nothing.', { bold: true }],
    [' Access comes from being given a role on purpose.', {}]],
   [['Supervisor access is the exception — it comes from your reporting lines, so moving someone in the org chart moves their access with them. That is the point: access you have to remember to remove is access that gets forgotten.', {}]]]);

faq('What roles are there?',
  '', [
    TBL(['Role', 'What it is for', 'How far they see'],
      [
        ['Employee', 'Their own record. Everybody has this.', 'Themselves only'],
        ['Supervisor', 'Their own people — approving targets, updates, evaluations.', 'The people under them'],
        ['Department Head', 'A section — the approval step above the supervisor.', 'Their section and everything below it'],
        ['HR Partner', 'HR work, without running the system.', 'The whole company'],
        ['HR Administrator', 'Everything — evaluation rounds, settings, forms, uploads.', 'The whole company'],
      ],
      [2200, 5180, 2700]),
    SPACER(),
    RP([['Area Head, Regional Head, GM and Scoring Administrator also exist but nobody holds them yet — because ', {}],
      ['creating a role must not hand it to anyone', { bold: true }],
      ['. They become useful when the pilot grows beyond one department.', {}]]),
  ]);

faq('Can one person have several roles?',
  'Yes, and in your company one does — the HCM Department Manager is also the Department Head and runs the system. Roles add together; they never take anything away. In a branch those would be different people and nothing would need changing.');

faq('Can a Department Head be limited to just their own section?',
  'Yes, and they have to be. If someone is given a section-level role without naming the section, the system refuses instead of granting something that quietly does nothing.');

faq('Can HR see everything?',
  [[['An HR Administrator sees the whole company — that is the job. What they cannot do is act ', {}],
    ['as', { italics: true }],
    [' someone else. They cannot write a supervisor’s evaluation for them, and they cannot approve their own targets. Everything they do is recorded under their name.', {}]]]);

faq('Do our staff need another username and password?',
  'No — the system is designed to sit behind your normal office login, so staff use the password they already have, and when IT disables someone’s account they lose access here automatically. It is built and works against our own test setup. It has not been connected to yours yet.');

children.push(H2('C. Periods, evaluation rounds and forms'));

faq('What is the difference between a target period and an evaluation round?',
  'A target period is when targets are set and measured — usually your financial year. An evaluation round is an assessment event inside it. One period can hold several rounds: probationary at months three and four, mid-year, year-end.');

faq('Can we design our own evaluation forms?',
  'Yes — sections, questions, rating scales and weights, all in Settings, without waiting for us. Forms are kept by version, and once published a version is frozen, so editing a form never changes an evaluation already written on it.');

faq('Can different staff get different forms?',
  'Yes, by employment type and position. Probationary, regular and project-based staff can each have their own form, and the right one is picked automatically when the round is created.');

faq('What stops a round from closing while people are still writing?',
  [[['Nothing closes with work outstanding — it refuses while any part of an evaluation is unfinished, and the section summary names who it is waiting for. “Why is this stuck?” is a screen, not an investigation.', {}]]]);

faq('Can we reopen something after it is finalised?',
  'A finalised result is final on purpose, and correcting it is a deliberate, recorded step rather than a quiet edit. That is what makes a rating defensible six months later when someone disputes it.');

children.push(H2('D. Day-to-day situations'));

faq('Somebody was promoted in the middle of the year. What do we do?',
  [[['Record it as a promotion with the date it took effect. Their history then shows the promotion sitting between their evaluations — so anyone reading it later can see that two strong evaluations were followed by a move.', {}]],
   [['There are four separate actions rather than one “edit” button — hire, change, correct, and leave — because ', {}],
    ['fixing a mistake and recording a change are not the same thing', { bold: true }],
    ['. A correction fixes something that was never true. A change records something that became true on a date.', {}]]]);

faq('We only heard about a transfer three weeks late. Can we backdate it?',
  'Yes, and that is normal rather than an exception. You can also enter one that takes effect next month. The system keeps the dates, so entering it late does not make the dates wrong.');

faq('What happens when somebody resigns?',
  'You record them as leaving, with the date. Nothing is deleted. Notifications stop and they drop out of future rounds, but their history stays — it has to, because other people’s past evaluations refer to them.');

faq('Someone has not posted an update in two months. Will we find out?',
  'Yes, in three places: the supervisor’s watch list, automatic reminders as deadlines approach, and the HR overview. We assume nobody logs in to check — so the system goes and tells them.');

children.push(H2('E. Reminders and messages'));

faq('Does it email people, or do they have to log in?',
  'Both — inside the system and by email, and each person can choose immediate, a once-a-day summary, or off. There are 23 kinds of message, covering assignments, approvals, results and deadline reminders.');

faq('Will it spam our staff?',
  'A deadline reminder goes out once per deadline per person, not every time the system checks. Anyone who prefers a summary gets one email a day.');

faq('Can we change the wording? Some of it should be in Filipino.',
  'Yes — the message wording is editable for your company, and HR can also publish its own help articles inside the system. That is where your own policy belongs, clearly marked as yours rather than as how the software works.');

children.push(H2('F. Getting information out'));

faq('Can we get our data out?',
  'Yes — you can download spreadsheets throughout, and it is your database on your server, so nothing is locked away. A download only ever contains what that person is allowed to see, so it is never a way around the access rules.');

faq('Can I list everyone whose improvement plan ended successfully?',
  [[['Yes — by person, type, period, section or result. ', {}],
    ['This was finished this week and is not on the demo site yet', { bold: true, color: WARN }],
    ['. The search is saved in the link, so you can send a report to someone instead of describing it — and they see it through their own access, which may show them fewer people than you saw.', {}]]]);

faq('Do you store salaries?',
  'No. There is no salary field anywhere. That was a decision, not an oversight — it keeps the most sensitive figure in HR out of a system that many managers can open.');

children.push(H2('G. Where it lives, and privacy'));

faq('Where is the data kept?',
  'On a server you own, inside your network. It does not go to any cloud provider, it does not leave the building, and it keeps working if your internet is down.');

faq('Who takes backups?',
  'Your IT team, on your schedule — it is an ordinary database. We provide the procedure and we will test a full restore with them during the pilot. Ask for that restore test by name: a backup nobody has ever restored is only a hope.');

faq('What about the Data Privacy Act?',
  'We store no government ID numbers — no SSS, PhilHealth, Pag-IBIG, TIN or birthdate — because the system has no use for them. What it holds is work email, position, reporting line and performance records, all recorded, all on your own hardware.');

faq('Can we try it with one department first?',
  'That is exactly what you are looking at — one department, on your real structure, with the rest of the group added when you are happy. The system handles several companies from the ground up, and separate companies cannot see each other.');

children.push(H2('H. Questions where the honest answer is “not yet”'));

children.push(P('Say these the same way as everything else. Someone will test at least one of them.'));

children.push(TBL(
  ['If they ask', 'Answer'],
  [
    ['Can it calculate our KPI score the way our workbook does?',
     'Not yet, and on purpose. Three things in your workbook can be read two ways — including one where identical performance scores 35, 30 or 10 depending only on how the scorecard was written. We would rather be late than build a guess into everyone’s rating.'],
    ['Does it work with our office logins?',
     'It is built for it and works against our own test setup. It has never been connected to yours. That is half a day with your IT team, and we would rather book it than claim it.'],
    ['Can it run the MDP promotion track?',
     'Not yet. The stages and waiting times are written down but not built — it is the next big piece after the scoring.'],
    ['Does it do payroll, leave or timekeeping?',
     'No, and it will not. It connects to them; it does not replace them.'],
    ['Are peer evaluations anonymous?',
     'That is one of the 21 questions, and it is one we cannot change quietly later — it changes how the information is stored. We need the answer before we build it, not after.'],
  ],
  [3200, 6880],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ══ PART THREE ══════════════════════════════════════════════════ */
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Part Three', size: 32, bold: true, color: ACCENT })],
}));
children.push(H1('9. The IT person in the room'));

children.push(P(
  'They are usually the quietest person there and the one whose opinion decides '
  + 'it afterwards. They are not judging features. They are working out whether '
  + 'this becomes their problem at 2am, and whether they could replace you later '
  + 'if they had to.',
));

children.push(BOX('How to use this section', [
  [['Each question below has a ', {}], ['plain answer you can say word for word', { bold: true }],
   ['. Underneath it, in smaller grey text, is the exact technical wording. ', {}],
   ['You do not need to understand the grey line to use it', { bold: true }],
   [' — read it out if they push for detail, and if they go further than that, write the question down and tell them we will come back with a precise answer. Nobody is offended by that. Everybody notices a bluff.', {}]],
  [['Three things below are genuinely not done. Volunteer all three before being asked — it buys more trust than any feature in the demo.', {}]],
], 'EAF0F6', ACCENT));

children.push(H2('A. What actually runs on the server'));

TQ('What is it built with?',
  [['Five standard, well-known pieces of software, all free and open, running on one Linux server. A database to hold the information, the application itself, the screens, a sign-in service, and something to handle the secure connection. Nothing unusual and nothing invented by us.', {}]],
  'PostgreSQL 16, Node 22 with NestJS, a React single-page front end, Keycloak for identity, and Caddy for TLS — five containers under Docker Compose on Ubuntu.');

TQ('Why did you not use one of the big frameworks that writes the database code for you?',
  [['Because the privacy rules live inside the database, and we need to be able to read exactly what is being asked of it. Tools that write that code for you hide it — convenient most of the time, and the wrong trade when the thing being hidden is the security.', {}]],
  'No ORM. Hand-written parameterised SQL against the pg driver, because there are 146 row-level security policies across 57 tables and they have to be reasoned about directly.');

TQ('What is NOT on the server, that I might expect?',
  [['No extra moving parts. No separate queue system, no caching server, no search engine, no file storage. Background work like emails and reminders is handled inside the database itself, so there is ', {}],
   ['one thing to back up and one thing that can break', { bold: true }],
   ['. There is also no file upload anywhere in the product — attaching evidence to a target means linking to wherever your documents already live.', {}]],
  'No broker, no Redis, no Elasticsearch, no object storage. A durable outbox table in Postgres drives notifications. No upload endpoint and no binary storage to size, back up or scan.');

children.push(H2('B. Installing, updating, and going back'));

TQ('How is it installed?',
  [['One command on one Linux server. There is nothing to install on anyone’s computer — staff just use a web browser.', {}]],
  'Docker Compose, five containers, single host.');

TQ('How do updates work, and how long are we down?',
  [['We build the new version on our machines and hand the server finished, sealed packages — it never has to build anything itself and never needs internet access. An update takes ', {}],
   ['about a minute of downtime', { bold: true }],
   [', scheduled for the evening. We prefer a predictable one-minute outage to a clever no-downtime trick that nobody can troubleshoot at 9pm.', {}]],
  'Images are built off-host and loaded, migrations run, containers restart. Roughly 60 seconds, deliberately scheduled rather than rolling.');

TQ('What if an update goes wrong?',
  [['The previous version is still on the server, so the software itself goes back in seconds. Changes to the ', {}],
   ['structure', { italics: true }],
   [' of the database only go forwards — you cannot un-bake a cake — so if one of those goes wrong we restore from the backup taken just before. That is why the update procedure takes a backup first, every time.', {}]],
  'Application rollback is instant. Migrations are forward-only by design, which removes a whole class of bad down-migration failures; recovery is restore-from-backup.');

TQ('How do you stop someone editing an old change and causing drift?',
  [['Every change to the database structure gets a fingerprint when it runs. If anyone edits one afterwards, the next update refuses to start and names the file. We would rather it stop loudly than run and behave oddly.', {}]],
  'Applied migrations are checksummed; a mismatch aborts the deployment.');

children.push(H2('C. Backups and losing data'));

TQ('What is the backup arrangement?',
  [['A full copy every night, compressed, encrypted, kept for 30 days, and written somewhere other than the server itself. The script ', {}],
   ['opens the copy afterwards to check it is actually readable', { bold: true }],
   [' — a half-written backup looks successful and is worthless.', {}],
   [' There is also a drill script that restores last night’s copy into a scratch space, checks the information arrived, and tells you how long it took. ', {}],
   ['That number is your real recovery time.', { italics: true }]],
  'Nightly pg_dump in custom format, GPG-encrypted, checksummed, 30-day retention, verified with pg_restore --list. Monthly restore drill script included.');

TQ('If the server died right now, how much would we lose?',
  [['With nightly backups alone, ', {}], ['up to a day’s work', { bold: true }],
   ['. Be straight about that. If losing a day is unacceptable — and for some HR information it is — the fix is continuous copying, which brings it down to minutes. It costs some disk space and it is your call. ', {}],
   ['Do not promise minutes and deliver a nightly backup.', { bold: true }]],
  'RPO is up to 24 hours on logical dumps alone. Continuous WAL archiving reduces it to minutes and is a configuration and storage decision.');

TQ('Have you ever actually restored one?',
  [['On our own systems, yes. ', {}], ['On yours, no — because yours does not exist yet.', { bold: true }],
   [' We would want a tested restore on your hardware written into the plan as a condition of going live, not left as an optional step. A backup nobody has restored is a guess.', {}]],
  null);

TQ('How big does this get?',
  [['Small. It is words and numbers — no documents, no photos, no files. A thousand staff with several years of history fits comfortably in a few gigabytes. Your disk sizing will be driven by the backups, not the data.', {}]],
  null);

TQ('Can we query it ourselves for our own reporting?',
  [['Yes — it is your database. You can point your own reporting tools at it. ', {}],
   ['One warning worth giving them before they ask:', { bold: true }],
   [' a tool that connects with full administrator access bypasses all the privacy rules. If they want a reporting connection, ask us for one that still follows the rules rather than handing out the master account.', {}]],
  'A superuser connection bypasses RLS entirely. We can supply a read-only role that remains subject to policy.');

children.push(H2('D. Sign-in and office accounts'));

TQ('How does sign-in with our office accounts work?',
  [['A standard sign-in service sits between the system and your existing office directory. Staff use the username and password they already have. ', {}],
   ['Our system never sees their password and never stores one.', { bold: true }],
   [' Disable someone in your directory and they lose access here, with HR doing nothing.', {}],
   [' Be precise about the state: it is built and works against our own test directory, and it has never been connected to a real one. Expect a bit of tuning. Budget half a day — do not budget zero.', {}]],
  'Keycloak with LDAP/Active Directory user federation, OIDC to the application. Group-to-role mapping and one or two attributes will need tuning.');

TQ('How do you know which login belongs to which employee?',
  [['The first time somebody signs in, their account is matched to the employee record with the same work email — and from then on it stays matched, regardless of what the email says later. If your directory and your 201 file disagree about someone’s email, that person cannot sign in and the message says exactly that. Worth planning for; it is a real task, not a rare edge case.', {}]],
  null);

TQ('Do you support two-factor authentication?',
  [['Whatever your office directory already enforces — which is exactly why we put a standard sign-in service in front rather than building our own. We inherit your security policy instead of competing with it.', {}]],
  null);

TQ('What happens when we terminate somebody?',
  [['Disable their office account and they cannot get back in. A session already open stays valid for a short time and then expires; if you need them out immediately, that can be forced. Separately, recording them as having left stops all notifications while keeping their history.', {}]],
  'Access tokens are short-lived; immediate cut-off is a session revocation in Keycloak.');

children.push(H2('E. Security'));

TQ('How is access actually enforced?',
  [['Most systems put a guard at the door and trust everyone inside the room. This one ', {}],
   ['puts a lock on every individual folder', { bold: true }],
   ['. Even if something went wrong with the software, another department’s records would not come out, because they never leave the filing cabinet in the first place. That is not true of a system that decides what to show you after it has already fetched everything.', {}]],
  '146 row-level security policies across 57 tables, FORCEd so even the table owner is subject to them. The application connects as a restricted role.');

TQ('What about someone typing a command into a form to attack the database?',
  [['We hand the database the question and the user’s text separately, so anything typed into a box can only ever be treated as text, never as an instruction. And even if that somehow failed, it would still be running under the limited account that is subject to every folder-level lock. Two independent layers.', {}]],
  'All queries parameterised; injection would still execute as the restricted role under RLS.');

TQ('How do you know those rules are right? They are easy to get wrong.',
  [['They are tested against a real database every time we change anything — not a simulated one, because a simulation cannot prove a security rule. ', {}],
   ['742 tests on the back end and 138 on the screens.', { bold: true }],
   [' Each security test also checks that it is not accidentally running with administrator powers before it believes its own result — that check exists because we once had tests pass for the wrong reason.', {}]],
  'Vitest with Testcontainers against real PostgreSQL. Every security suite asserts it is not connected as a superuser.');

TQ('Has it had a proper security test by an outside firm?',
  [['No.', { bold: true, color: WARN }],
   [' Our own review and automated testing only. If you want an outside test before going live, that is entirely reasonable and we would support it. We would rather you commissioned one than have us claim a clean bill of health we have not earned.', {}]],
  null);

TQ('Who patches it?',
  [['We keep the application current. Patching the server operating system and the supporting software is your side, and it needs a named owner and a schedule — agree that during the pilot. ', {}],
   ['An unpatched server in a back office is the most common way systems like this get into trouble.', { bold: true }]],
  'OS, Docker, PostgreSQL and Keycloak patching is customer-owned. Standard security headers are applied at the API; images are rebuilt each release.');

TQ('Is any of it exposed to the internet?',
  [['Not in the real setup. It sits on your internal network, and people working from home reach it through your VPN. ', {}],
   ['The demo you are looking at today is on the internet because it had to be for this meeting', { bold: true }],
   [' — that is a demo decision, not how it would be installed. Putting it online properly is a separate conversation with real requirements attached, and one to have deliberately rather than by accident.', {}]],
  null);

TQ('Can we see who did what?',
  [['Yes — there is a logbook that only ever gets added to. Every approval, every moderation change, every rating change, every upload, with the person’s name and the time. The system’s own activity logs come out in a standard format that goes wherever your existing log collection goes.', {}],
   [' Be honest about one thing: there is no monitoring dashboard included. If they want graphs and alerting, that is an addition to scope rather than something already there.', {}]],
  'Append-only audit table with actor and timestamp. Structured JSON logs to stdout. No Prometheus/Grafana shipped.');

children.push(H2('F. Running it day to day'));

TQ('How do we know it is healthy?',
  [['There are two addresses your monitoring can check automatically: one that answers “yes, it is running” and one that answers “yes, and it can actually reach its information”. The second is the useful one.', {}]],
  'Unauthenticated liveness and readiness endpoints; readiness reports degraded when the database is unreachable.');

faq('What should we set alerts on?',
  '', [
    RBULLET([['The disk filling up', { bold: true }], [' — the most common cause of failure for a system in an office, every time.', {}]]),
    RBULLET([['A backup failing', { bold: true }], [' — a backup that quietly stops working is discovered at the worst possible moment.', {}]]),
    RBULLET([['The system running but unable to reach its information', { bold: true }], ['.', {}]]),
    RBULLET([['The security certificate expiring', { bold: true }], [' — this takes everything down, and always on a weekend.', {}]]),
  ]);

TQ('Is there a way to check it is set up correctly, or do we find out the hard way?',
  [['There is a single command that answers “if a department started using this tomorrow, what would break?” It checks the live system and reports pass, warning, or fail, with a specific fix for each one. It confirms the folder-level locks are switched on for every table — because a system where they were never switched on would pass every other test and leak everything — and it fails if any demo account still exists.', {}],
   [' One detail worth mentioning to them: if a check ', {}], ['could not run', { italics: true }],
   [', it is reported as its own result rather than counted as a pass. A check that did not happen is not a check that succeeded.', {}]],
  'hr preflight: verifies RLS is enabled and FORCEd per table, reads the Keycloak realm for leftover local accounts, and reports PASS / WARN / FAIL / SKIP with remedies.');

TQ('Why do you keep mentioning power supplies?',
  [['Because a sudden power cut while the system is writing is the single most likely way to lose information in an office server room — more likely than any software fault. A battery backup that shuts the server down cleanly, and two mirrored disks rather than one. Say it even though it is their department; it shows you have run something in an office before.', {}]],
  null);

children.push(H2('G. Size and speed'));

TQ('What hardware do we need?',
  [['For up to about a thousand staff: ', {}],
   ['8 processor cores, 32 GB of memory, 500 GB of mirrored disk, on Ubuntu Linux', { bold: true }],
   ['. That is generous on purpose — it is sized for the busiest week of the year, not an average Tuesday.', {}],
   [' A useful thing to mention: ', {}],
   ['the demo you are using right now runs on a server with 1 GB of memory', { bold: true }],
   [', with everything on it. The specification above is comfort, not a minimum.', {}]],
  null);

TQ('What happens when everyone logs in at once at year-end?',
  [['That is exactly what the sizing is for. The heavy screens are summaries over tens of thousands of rows, which is small for a database of this kind. If it ever did get slow, the fix would be ordinary database tuning rather than a rebuild — because the reporting is plain, readable queries.', {}]],
  null);

TQ('Can it hold all the companies in the group?',
  [['Yes — it handles multiple companies from the ground up, and separate companies cannot see each other. For an in-office installation we would expect one company per installation, and the setup check warns you if it ever finds more than one, so an accidental second company is visible rather than silent.', {}]],
  null);

children.push(H2('H. Being tied to one supplier'));

children.push(P(
  'This is the question they most want to ask and are least comfortable asking '
  + 'in front of you. Answer it before they have to.'
));

TQ('What happens to us if Summit Logic disappears?',
  [['Your information sits in a standard, widely-used database on your own hardware, in a structure that is plain readable text with comments explaining why each rule is there. There is no secret format and nothing phoning home. Another competent team could pick it up.', {}],
   [' The commercial half of that — who owns the source code, escrow, handover — belongs in the contract, not in a demo. ', {}],
   ['Do not invent terms in the room.', { bold: true }],
   [' Say it is a fair question, that your information is yours and it is in an open format, and that the commercial side goes in the agreement.', {}]],
  null);

TQ('Can we get everything out?',
  [['Spreadsheet downloads throughout the system, and direct access to the database underneath. Downloads through the system only include what that person is allowed to see; direct access is yours to control.', {}]],
  null);

TQ('Is there a way to connect other systems to it?',
  [['The screens talk to the system over a standard web interface, so the connection points exist. What does not exist yet is a ', {}],
   ['documented, supported interface with its own credentials', { bold: true }],
   [' for other systems to use. Today a connection would go through the database or through spreadsheets. If they have something specific in mind, write it down as a requirement rather than saying it is available.', {}]],
  'A REST API exists and is what the SPA consumes. There is no versioned, documented public API with service credentials yet.');

children.push(H2('I. Do not say these'));

children.push(TBL(
  ['Do not say', 'Say instead'],
  [
    ['“It is completely secure.”',
     '“Access is enforced inside the database and tested against a real one. It has not had an outside security test. We would support one.”'],
    ['“Office sign-in is done.”',
     '“It is built and works against our test setup. It has never been connected to yours. Budget half a day with your IT team.”'],
    ['“Backups are taken care of.”',
     '“Nightly encrypted copies that are checked for readability, and a restore drill script. Nobody has restored one on your hardware — that should be a condition of going live.”'],
    ['“No downtime for updates.”',
     '“About a minute, in the evening. The software goes back in seconds if needed; database structure changes only go forward, which is why we back up first.”'],
    ['“It scales to any size.”',
     '“It is sized for a thousand staff on one server. Beyond that we would measure rather than guess.”'],
    ['“We can build that quickly.”',
     'Say nothing. Write it down and price it afterwards. A technical person remembers a casual estimate as a promise.'],
  ],
  [3400, 6680],
));

children.push(SPACER());
children.push(BOX('Ask them these, before they run out of questions', [
  'Turning it around at the end changes the tone of the conversation — and you need the answers anyway.',
  '•  Who will patch the server once this is live?',
  '•  Where do the backups get copied to, and who checks they arrived?',
  '•  Is there a battery backup on that server, and has the shutdown ever been tested?',
  '•  Who looks after your office directory, and can we book half a day with them?',
  '•  Do staff need access from outside the office — and is there already a VPN?',
  '•  Do you issue your own security certificates internally, or do we need to sort that out?',
], 'EAF0F6', ACCENT));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Glossary ────────────────────────────────────────────────────── */
children.push(H1('10. If someone uses one of these words'));

children.push(P(
  'The terms most likely to come up, and what each one means in one sentence. '
  + 'You are allowed to use the plain version; the room will follow you either way.',
));

children.push(TBL(
  ['Word they use', 'What it means'],
  [
    ['Row-level security / RLS', 'The lock is on each individual record rather than on the door. It is the reason one department cannot see another.'],
    ['Database', 'Where all the information is kept. One program, on your server.'],
    ['Migration', 'A change to the structure of the database — a new field, a new rule. They are numbered and only ever go forwards.'],
    ['Container / Docker', 'A sealed box holding a piece of software and everything it needs. The server just runs the boxes.'],
    ['RPO', '“How much work would we lose?” With nightly backups, up to a day.'],
    ['RTO', '“How long until we are back?” The restore drill measures it instead of guessing.'],
    ['Token', 'A short-lived day pass issued at sign-in. When it expires you need a new one, and a disabled account cannot get one.'],
    ['OIDC / SSO / federation', 'Staff sign in with their existing office account instead of a new password here.'],
    ['Active Directory / LDAP', 'The Microsoft system most offices already use to hold staff accounts and passwords.'],
    ['SQL injection', 'An old attack where someone types a command into a form hoping the database runs it. Prevented here in two independent ways.'],
    ['Audit log / audit trail', 'A logbook that can only be added to, never edited, recording who changed what and when.'],
    ['TLS / SSL / certificate', 'What makes the padlock appear in the browser. If it expires, everything stops — so it needs a calendar reminder.'],
    ['VPN', 'A secure tunnel into the office network, for people working from home.'],
    ['On-premise', 'On your own server in your own building, rather than on the internet.'],
  ],
  [2800, 7280],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Appendix ────────────────────────────────────────────────────── */
children.push(H1('Appendix — logins, and what is on the demo site'));

children.push(H3('The three logins, in the order you will use them'));
children.push(TBL(
  ['Login', 'Person', 'Rank', 'What they can reach'],
  [
    [['josefina.gonzaga', { bold: true }], 'Associate — Screening', 'R11', 'Herself only'],
    [['crisanto.rivera', { bold: true }], 'Section Head — Employee Relations (8 people)', 'R7', 'Himself and his section'],
    [['alonzo.dimalanta', { bold: true }], 'Department Manager — HCM', 'R6', 'The whole department, plus settings'],
  ],
  [2600, 4380, 900, 2200],
));
children.push(SPACER());
children.push(RP([['Optional fourth login, for the 60-second proof in Section 4: ', {}],
  ['dalisay.zamora', { bold: true }],
  [' — Section Head, Compensation & Benefits, R7. Same rank as Crisanto, different section.', {}]]));
children.push(RP([['Password for all of them: ', {}], ['test1234', { bold: true }],
  ['. Site: ', {}], ['https://hr.summitlogicsolutions.com', { bold: true }], ['.', {}]]));

children.push(SPACER());
children.push(H3('What is working on the demo site right now'));
children.push(TBL(
  ['Area', 'State'],
  [
    ['Targets, monthly updates, approvals', 'Working'],
    ['Evaluations, forms, moderation, finalising, Department Head approval', 'Working'],
    ['Skills, development plans, feedback, improvement plans', 'Working'],
    ['Charts, nine-box grid, rater comparison, spreadsheet download', 'Working'],
    ['Section summary for Department Heads and Area Heads', 'Working'],
    ['Loading staff from a spreadsheet, promotions and transfers, settings, in-system help', 'Working'],
    ['Reminders, daily summaries, deadline alerts', 'Working'],
    [['Reports', { bold: true }], [['Finished — ', {}], ['not installed yet', { bold: true, color: WARN }]]],
    [['Requests', { bold: true }], [['Finished — ', {}], ['not installed yet', { bold: true, color: WARN }]]],
    ['KPI score calculation, promotion tracks, office sign-in', 'Not built / not tested'],
  ],
  [6280, 3800],
));

children.push(SPACER());
children.push(BOX('Five minutes before anyone joins', [
  'Log in as each of the three accounts once. The first sign-in links the account to the employee record, and you do not want to find a problem live.',
  'Check the site loads with the padlock and no warning.',
  'Check the target period is still open — the refusal in Section 5 needs it open.',
  'Have the 21 questions open in another tab, ready to send before the meeting ends.',
  'Decide in advance whether Reports and Requests will be installed. If not, they stay in Section 7 and you do not open them.',
], 'EAF0F6', ACCENT));
/* ── document ────────────────────────────────────────────────────── */

const doc = new Document({
  creator: 'Summit Logic Solutions',
  title: 'Guanzon HCM — Client Demo: Meeting Flow, HR Questions and IT Questions',
  description: 'Role-by-role demo flow and HR Manager setup Q&A',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 20 } },
      heading1: {
        run: { font: 'Calibri', size: 30, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 360, after: 160 } },
      },
      heading2: {
        run: { font: 'Calibri', size: 25, bold: true, color: ACCENT },
        paragraph: { spacing: { before: 280, after: 120 } },
      },
      heading3: {
        run: { font: 'Calibri', size: 22, bold: true, color: '1D1F20' },
        paragraph: { spacing: { before: 200, after: 80 } },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 180 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 180 } } } },
        ],
      },
      {
        reference: 'steps',
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            children: ['Summit Logic Solutions  ·  Guanzon HCM demo  ·  ',
              PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
            size: 16, color: MUTED,
          })],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(process.argv[2], buf);
  console.log('written', process.argv[2], buf.length, 'bytes');
});
