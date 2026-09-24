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

// Title
children.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({
    text: 'Guanzon Human Capital Management', size: 22, color: MUTED,
  })],
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
    text: 'Meeting flow by access role, and an HR Manager setup Q&A',
    size: 22, color: MUTED,
  })],
}));

children.push(RP([
  ['Prepared by ', {}], ['Summit Logic Solutions', { bold: true }],
  ['  ·  25 September 2026  ·  Demo host: ', {}],
  ['https://hr.summitlogicsolutions.com', { bold: true }],
], { after: 200 }));

children.push(BOX('Before you present — read this first', [
  [['The demo tenant is ', {}], ['GGCHCM', { bold: true }],
   [': the client’s own HCM structure — five sections, ranks 6–11, their real reporting lines — with ', {}],
   ['28 invented people', { bold: true }],
   ['. No real name from their workbook exists anywhere in the system. Say this early; it answers the data-privacy question before it is asked.', {}]],
  [['Every login shares the password ', {}], ['test1234', { bold: true }],
   ['. That is deliberate for a demo and must never be true of a pilot — staff sign in through Active Directory there.', {}]],
  [['Two features built this week — ', {}], ['Reports', { bold: true }],
   [' and ', {}], ['Requests', { bold: true }],
   [' — are ', {}], ['not yet deployed to the demo host', { bold: true, color: WARN }],
   ['. Section 7 covers them as “next” rather than “now”. If they are deployed before the meeting, fold Section 7 into the HR Manager segment instead.', {}]],
]));

children.push(SPACER());

/* ── Section 0 ───────────────────────────────────────────────────── */
children.push(H1('1. The shape of the meeting'));

children.push(P(
  'Sixty minutes, built around three sign-ins. The order matters: it climbs from '
  + 'the person with the least access to the person with the most, so each role adds '
  + 'to a picture the audience has already seen rather than replacing it.',
));

children.push(TBL(
  ['#', 'Segment', 'Who is driving', 'Time'],
  [
    ['1', 'Framing — what this is and is not', 'Presenter, no screen', '5 min'],
    ['2', 'The employee', ['josefina.gonzaga', { bold: true }], '8 min'],
    ['3', 'The supervisor', ['crisanto.rivera', { bold: true }], '12 min'],
    ['4', 'The HR Manager', ['alonzo.dimalanta', { bold: true }], '18 min'],
    ['5', 'The security model — the moment that lands', 'Two sign-ins, side by side', '6 min'],
    ['6', 'What we have deliberately not built', 'Presenter, no screen', '6 min'],
    ['7', 'Shipping next, and what we need from you', 'Presenter', '5 min'],
  ],
  [520, 4100, 3660, 1800],
));

children.push(SPACER());

children.push(BOX('One rule for the whole session', [
  [['Never say “the system hides that from you.” Say ', {}],
   ['“the database will not return it.”', { bold: true, italics: true }],
   [' Hiding is a screen doing you a favour. This product enforces access in the ', {}],
   ['database', { bold: true }],
   [', underneath every screen, every report and every export — which is why a hidden menu item is a convenience here and not a permission. It is the single strongest thing you have to say, and it survives every follow-up question.', {}]],
], 'EAF0F6', ACCENT));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 2: framing ──────────────────────────────────────────── */
children.push(H1('2. Framing (5 minutes, no screen)'));

children.push(H3('What to establish, in this order'));
children.push(RNUM([['What it replaces.', { bold: true }],
  [' A performance and talent system: targets, check-ins, evaluations, competencies, improvement plans, development. It runs on ', {}],
  ['your', { italics: true }], [' server, on your own network.', {}]]));
children.push(RNUM([['What it is not.', { bold: true }],
  [' Not payroll, not timekeeping, not leave. No salaries, no payslips, no DTR, no statutory IDs — and no salary is stored anywhere in the database, by design.', {}]]));
children.push(RNUM([['Where it came from.', { bold: true }],
  [' Built against your own 5-pager and KPI workbook. The structure on screen is yours; only the people are invented.', {}]]));
children.push(RNUM([['What today is for.', { bold: true }],
  [' Showing what already works, and being precise about what is waiting on decisions only they can make.', {}]]));

children.push(SAY(
  'Everything you are about to see runs on one server inside your own office. '
  + 'Your review data never leaves the building. The structure on screen is your '
  + 'org chart from the HCM workbook — five sections, ranks 6 to 11, your real '
  + 'reporting lines. Every person in it is invented, because we were not going to '
  + 'put your staff’s names in a development database before you had signed anything.',
));

children.push(H3('Do not do these in the first five minutes'));
children.push(BULLET('Do not open the analytics screens. They are impressive and they mean nothing until the audience knows whose data they are looking at.'));
children.push(BULLET('Do not mention the KPI composite yet. It is the one visible gap and it belongs in Section 6, framed as a question for them, not an apology from you.'));
children.push(BULLET('Do not promise Active Directory works. It is built and it has never been tested against a real directory. Section 6.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 3: employee ─────────────────────────────────────────── */
children.push(H1('3. The employee — Josefina Gonzaga (8 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'josefina.gonzaga / test1234'],
    [['Who she is', { bold: true }], 'Associate — Screening. Rank 11, the bottom of the ladder. No reports.'],
    [['Roles held', { bold: true }], 'employee, and nothing else.'],
    [['The point of this segment', { bold: true }],
      'Most of the company is Josefina. If the product is unpleasant for her it fails, no matter how good the HR console is.'],
  ],
  [2400, 7680],
));

children.push(SPACER());
children.push(H3('Show, in this order'));

children.push(RNUM([['My goals.', { bold: true }],
  [' Her own targets for the period, each with a measure, a baseline, a target and a weight. Point out that the weights total 100% — and that the system is the thing that knows whether they do.', {}]]));
children.push(RNUM([['One goal, opened.', { bold: true }],
  [' Show a check-in. This is the habit the whole product depends on: a short note, monthly, against a number.', {}]]));
children.push(RNUM([['Reviews.', { bold: true }],
  [' Her self-review. Show that once submitted it cannot be edited — and say why that is a feature.', {}]]));
children.push(RNUM([['Competencies.', { bold: true }],
  [' Her assessed levels against what her position requires, and the gap between them.', {}]]));
children.push(RNUM([['Help.', { bold: true }],
  [' Open the help drawer on the screen you are already on. It opens on articles about ', {}],
  ['that', { italics: true }], [' screen. Search for something in Taglish-adjacent plain English and show it finds it.', {}]]));

children.push(SAY(
  'This is the whole product for most of your staff. They will open it perhaps '
  + 'six times a year — at target-setting, once a month for a check-in, and at '
  + 'review time. Everything we built for them is shaped around that: they should '
  + 'never need training to use it, and the help is in the screen rather than in a '
  + 'manual somebody has to find.',
));

children.push(H3('What she cannot do — show it, do not assert it'));

children.push(TBL(
  ['Try this in front of them', 'What happens', 'The line'],
  [
    ['Look for Team, HR console, Analytics, Setup in her sidebar',
     'They are not there',
     'Not offered — and that is only tidiness. The real gate is next.'],
    ['Paste a colleague’s record URL into the address bar',
     ['404 Not Found', { bold: true }],
     'Not “forbidden” — not found. The database filtered the row out before the screen ever saw it. A 403 would have confirmed the record exists.'],
    ['Look for her own rating before it is released',
     'It is not there',
     'An unreleased review is invisible to its subject until sign-off, including to an export.'],
  ],
  [3200, 2200, 4680],
));

children.push(SPACER());
children.push(BOX('Presenter trap', [
  'Do not linger. Eight minutes. The audience is senior and will get restless in the employee view — but skipping it entirely is worse, because every question in Section 5 depends on them having seen what Josefina could not see.',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 4: supervisor ───────────────────────────────────────── */
children.push(H1('4. The supervisor — Crisanto Rivera (12 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'crisanto.rivera / test1234'],
    [['Who he is', { bold: true }], 'Section Head — Employee Relations. Rank 7, with 8 people under him.'],
    [['Roles held', { bold: true }], 'employee, manager. He is still an employee — he has his own targets and his own review.'],
    [['The point of this segment', { bold: true }],
      'A supervisor is an employee with a second job. Both hats are on one login, and the system knows which one applies to which record.'],
  ],
  [2400, 7680],
));

children.push(SPACER());
children.push(H3('Show, in this order'));

children.push(RNUM([['His own goals first.', { bold: true }],
  [' Five seconds. It makes the point that he did not stop being an employee.', {}]]));
children.push(RNUM([['Team.', { bold: true }],
  [' His eight people, each with target coverage and attainment. Find the one with a gap and stop there.', {}]]));
children.push(RNUM([['Approving a target.', { bold: true }],
  [' Open something awaiting him. Approve it, or send it back with a reason — sending it back is the better demo, because the reason travels with it and the employee is told.', {}]]));
children.push(RNUM([['Monitoring.', { bold: true }],
  [' Who has not checked in, whose goals have gone quiet, who is trending down two check-ins running.', {}]]));
children.push(RNUM([['My unit.', { bold: true }],
  [' Coverage and review progress for his section, plus ', {}], ['what is waiting on him', { bold: true }],
  [' and ', {}], ['who he is blocking', { bold: true }], ['.', {}]]));
children.push(RNUM([['A review he has to write.', { bold: true }],
  [' Show the form, and show that his assessment of somebody is not visible to that person while he is drafting it.', {}]]));

children.push(SAY(
  'Notice that I have not changed screens — this is the same “My unit” page. '
  + 'It is the same page a Department Head opens, and the same page an Area Head '
  + 'opens. Nobody built three versions of it. What differs is how far each person '
  + 'can see, and the database decides that, not the page.',
));

children.push(H3('The scoping proof — worth 60 seconds'));
children.push(RP([
  ['If you have time, sign in as ', {}], ['dalisay.zamora', { bold: true }],
  [' — Section Head, Compensation & Benefits. ', {}],
  ['Same rank, same screen, different section.', { bold: true }],
  [' Her “My unit” shows her people and not Crisanto’s. Two peers at the same level, and neither can see into the other’s section.', {}],
]));

children.push(H3('What he cannot do'));
children.push(TBL(
  ['Try this', 'What happens', 'Why it matters to them'],
  [
    ['Approve his own target', 'Refused', 'A constraint in the database, not a rule in the screen. There is no code path that approves your own.'],
    ['Open somebody in Dalisay’s section', ['404', { bold: true }], 'Same rank does not mean same reach. Scope is by unit, not by seniority.'],
    ['Open the HR console, Setup, Review cycles', 'Not offered, and refused if forced', 'Running a cycle is an HR act, not a management one.'],
    ['See a peer review written about his own staff by someone else',
     'Depends on your answer to Q5', 'Flag it and move on — this is one of the open questions in Section 7.'],
  ],
  [2800, 2000, 5280],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 5: HR manager ───────────────────────────────────────── */
children.push(H1('5. The HR Manager — Alonzo Dimalanta (18 minutes)'));

children.push(TBL(
  ['', ''],
  [
    [['Login', { bold: true }], 'alonzo.dimalanta / test1234'],
    [['Who he is', { bold: true }], 'Department Manager, Rank 6 — head of Human Capital Management.'],
    [['Roles held', { bold: true }],
      [['employee, manager, hr_admin ', {}], ['and', { italics: true }], [' dept_head (scoped to HCM).', {}]]],
    [['The point of this segment', { bold: true }],
      'This is the buyer. Everything here is about running the process, not taking part in it.'],
  ],
  [2400, 7680],
));

children.push(SPACER());

children.push(BOX('Say this plainly — do not let anyone notice it instead', [
  [['Alonzo holds four roles at once, including both ', {}], ['Department Head', { bold: true }],
   [' and ', {}], ['HR administrator', { bold: true }],
   ['. That is organisationally correct in your structure — the HCM Department Head ', {}],
   ['is', { italics: true }], [' the Department Manager — and it is the one place in the demo where two approval steps sit with one person.', {}]],
  [['In a branch these would be two different people, and the system would not care: the permissions are identical either way. ', {}],
   ['State it before someone spots it.', { bold: true }],
   [' Discovered, it looks like a flaw; stated, it is a demonstration that roles are assigned to people rather than baked into job titles.', {}]],
]));

children.push(SPACER());
children.push(H3('Show, in this order'));

children.push(RNUM([['HR console.', { bold: true }],
  [' Coverage across the whole department, and the exceptions: the person whose weights total 80%, the goals nobody has checked in on.', {}]]));
children.push(RNUM([['Lock the period — and watch it refuse.', { bold: true }],
  [' The strongest 30 seconds in the segment. It will not lock while somebody’s weights do not total 100%. Do not fix it first.', {}]]));
children.push(RNUM([['Review cycles.', { bold: true }],
  [' Open a cycle, generate instances, show the state of the chain. Then attempt sign-off while a review is unsubmitted and let it refuse.', {}]]));
children.push(RNUM([['Calibration.', { bold: true }],
  [' Ratings compared across sections, and the record of what calibration actually moved.', {}]]));
children.push(RNUM([['Analytics.', { bold: true }],
  [' Rating distribution, nine-box, ', {}], ['rater comparison', { bold: true }],
  [' — which supervisor rates generously and which strictly, against the group. This is the slide HR people lean forward at.', {}]]));
children.push(RNUM([['Import staff.', { bold: true }],
  [' Upload a 201 CSV. ', {}], ['Preview first', { bold: true }],
  [' — show that it reports exactly what it would do and changes nothing until confirmed.', {}]]));
children.push(RNUM([['Employment actions.', { bold: true }],
  [' Record a promotion or a transfer with an effective date, then open that person’s history and show the event sitting in their timeline next to their evaluations.', {}]]));
children.push(RNUM([['Setup.', { bold: true }],
  [' Org units, ranks, positions, forms, rating scales, and HR-authored help articles.', {}]]));

children.push(SAY(
  'Every refusal you just watched is enforced underneath the screen. If somebody '
  + 'wrote a script against the database directly, it would refuse them too. That '
  + 'is the difference between a rule and a reminder.',
));

children.push(H3('The two refusals to demonstrate deliberately'));
children.push(RBULLET([['The period will not lock', { bold: true }],
  [' while a person’s goal weights do not total 100%. Let it fail in front of them, then fix the weights, then lock it. The sequence is the demo.', {}]]));
children.push(RBULLET([['A cycle will not sign off', { bold: true }],
  [' while any review is unsubmitted. Show ', {}], ['My unit', { bold: true }],
  [' naming who it is waiting on — the answer to “why is this stuck” is on screen instead of being a search.', {}]]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 6: security ─────────────────────────────────────────── */
children.push(H1('6. The security model (6 minutes)'));

children.push(P(
  'This is the segment that decides the meeting. Run it last, after they have seen '
  + 'all three roles, so the contrast is against something they remember.',
));

children.push(H3('The demonstration'));
children.push(NUM('Signed in as Alonzo, open a named person’s full record. Copy the URL.'));
children.push(NUM('Sign out. Sign in as josefina.gonzaga.'));
children.push(NUM('Paste the same URL.'));
children.push(RNUM([['404 Not Found.', { bold: true }],
  [' Not “you are not allowed” — as far as her session is concerned, the record is not there.', {}]]));

children.push(SAY(
  'That is not the page being polite. The row was filtered out by the database '
  + 'before the page ran. We answer 404 rather than 403 on purpose: telling her '
  + '“you are not allowed to see this record” would confirm the record exists, '
  + 'and for a performance record that is itself a leak.',
));

children.push(H3('The three sentences to have ready'));
children.push(TBL(
  ['If they ask', 'Answer'],
  [
    ['Can a developer see everything?',
     'The application connects as a restricted account that is subject to the same rules. Only a database administrator with server access can bypass them — and that is a person you hire, not a permission the software grants.'],
    ['What if someone changes the code?',
     'The rules are not in the code. They are in the database, underneath it. Replacing the application would not remove them.'],
    ['Is it audited?',
     'Every change is recorded with who made it and when — including who approved, who calibrated, and what moved a rating. Nothing is deleted; separation closes a record, it does not erase one.'],
  ],
  [3000, 7080],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Section 7: gaps ─────────────────────────────────────────────── */
children.push(H1('7. What we have deliberately not built (6 minutes)'));

children.push(P(
  'Lead with this rather than waiting to be caught by it. A supplier who names '
  + 'their own gaps is believed about everything else.',
));

children.push(TBL(
  ['Gap', 'Why it is not built', 'What we need'],
  [
    [['The KPI composite', { bold: true }],
     'The 30/40/30 split, the task-nature multipliers and the banded conversion. Three details in your workbook read two ways, and a scoring rule we guessed at would be worse than one that is late.',
     'Answers to six of the twenty-one questions.'],
    [['Active Directory sign-in', { bold: true }],
     'Built and working against our own identity server. It has never been pointed at a real directory.',
     'A test window with your IT team.'],
    [['Promotion programmes (MDP)', { bold: true }],
     'The stage machine with dwell times. Specified, not started.',
     'Confirmation of the stages and durations.'],
    [['Attendance', { bold: true }],
     'We take a count per period, not a record. We are not building timekeeping.',
     'Which payroll system exports it, and at what grain.'],
  ],
  [2200, 5080, 2800],
));

children.push(SPACER());
children.push(BOX('The ask — do not end the meeting without making it', [
  [['The twenty-one questions have been ready since 28 August and have not been answered.', { bold: true }],
   [' Six of them block the KPI composite, which is the one part of your specification the demo cannot show.', {}]],
  [['Put a name and a date against it before everyone leaves the room. That single commitment is worth more to the project than anything else agreed today.', {}]],
], 'F4EFE6', WARN));

children.push(SPACER());
children.push(H3('Shipping next — built, tested, not yet on the demo host'));
children.push(RP([
  ['Both were completed this week and are waiting on a deployment window. ', {}],
  ['Do not demonstrate them unless they have been deployed before the meeting', { bold: true }],
  [' — promise them as dated, not as done.', {}],
]));
children.push(RBULLET([['Reports.', { bold: true }],
  [' Filter evaluation history by person, source, evaluation type, period, unit or result — including “everyone whose improvement plan ended successfully”. Exports to CSV, and the filters live in the link, so a report can be sent rather than rebuilt.', {}]]));
children.push(RBULLET([['Requests.', { bold: true }],
  [' A Department Head asks for an extra competency, a special evaluation or a scoring adjustment; HCM approves or declines with a reason, and the decision is recorded against the request. ', {}],
  ['An approval records the decision — it does not silently change the score', { bold: true }],
  [', so “who changed this” always has an answer.', {}]]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ══ PART TWO ════════════════════════════════════════════════════ */
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Part Two', size: 32, bold: true, color: ACCENT })],
}));
children.push(H1('8. HR Manager — setup questions and FAQs'));

children.push(P(
  'These are the questions an HR Manager asks once they have decided they want it. '
  + 'Answers are written to be said out loud, not read from a manual. Where an '
  + 'answer is “not yet”, it says so.',
));

/* A. Getting people in */
children.push(H2('A. Getting our people in'));

const faq = (q, a, extra) => {
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: q, size: 20, bold: true, color: ACCENT })],
  }));
  (Array.isArray(a) ? a : [a]).forEach((para) => {
    children.push(Array.isArray(para) ? RP(para) : P(para));
  });
  if (extra) extra.forEach((e) => children.push(e));
};

faq('How do we load 2,000 employees without typing them in?',
  [[['A CSV import of your 201 file. ', {}],
    ['Download the blank template from inside the app', { bold: true }],
    [' rather than building your own — the template is generated from the code that reads it, so the two cannot drift apart.', {}]],
   [['The import runs in two steps: ', {}], ['Preview', { bold: true }],
    [' tells you exactly what it would create, change and skip, and writes nothing. Only when you confirm does anything land. Both steps run inside your own permissions, and there is no way to say which company to import into — it is read from your own record.', {}]]]);

faq('What has to be in the file?',
  'Employee number, name, work email, date hired, position, department. Everything else is optional and adds capability as you supply it — section, area and branch build your org chart; rank sets the ladder; employment type drives which evaluation applies.');

faq('Will a second import create duplicates?',
  'No. It matches on employee number and updates rather than inserts, so the same file can be re-run safely. That is deliberate: an import you cannot re-run is one nobody dares correct.');

faq('What happens if the file contradicts itself?',
  'It refuses and tells you which row. Two cases in particular: a row naming both a section and an area — same depth, different kind, so the person is in one or the other — and the same unit appearing under two different parents. We do not guess between them.');

faq('Can the import restructure our org chart?',
  [[['Only on creation. ', {}],
    ['A unit that already exists is never re-parented or re-levelled by an import', { bold: true }],
    [' — where the file disagrees, it is reported for a person to settle in Setup. A re-import that quietly reshapes your org chart is one nobody could safely run twice.', {}]]]);

/* B. Roles and access */
children.push(H2('B. Roles and access'));

faq('How does somebody get access?',
  [[['Two things, and they are separate. ', {}],
    ['Being in the HR department grants nothing.', { bold: true }],
    [' Access comes from a role assignment made deliberately.', {}]],
   [['Supervisor access is the exception: it is derived from your reporting lines, so moving someone in the org chart moves their access with them. That is the point — access that has to be remembered is access that gets forgotten on the way out.', {}]]]);

faq('What roles are there?',
  '', [
    TBL(['Role', 'What it is for', 'Scope'],
      [
        ['Employee', 'Their own record. Everyone has it.', 'Themselves'],
        ['Supervisor / Manager', 'Their reports: approving targets, check-ins, writing reviews.', 'Their reporting line'],
        ['Department Head', 'A section: the approval step above the supervisor.', 'One unit and everything under it'],
        ['HR Partner', 'HR work without system administration.', 'Company-wide, read and act'],
        ['HR Administrator', 'Running cycles, setup, forms, imports, the lot.', 'Company-wide'],
      ],
      [2200, 5180, 2700]),
    SPACER(),
    RP([['Area Head, Regional Head, GM and Scoring Administrator also exist and are unassigned — they are defined but held by nobody, because ', {}],
      ['defining a role must not confer it', { bold: true }],
      ['. They become meaningful when the pilot widens beyond one department.', {}]]),
  ]);

faq('Can one person hold several roles?',
  'Yes, and in your structure one does — the HCM Department Manager is also the Department Head and the system administrator. Permissions add up; they never subtract. In a branch those would be different people and nothing about the configuration would change.');

faq('Can a Department Head be scoped to just their section?',
  'Yes, and it is required. A department-scoped role assigned without naming a department is refused outright rather than granted as something powerless — a role that looks granted and does nothing is worse than an error.');

faq('Can HR see everything?',
  [[['An HR administrator sees the whole company, which is the job. What they cannot do is act ', {}],
    ['as', { italics: true }],
    [' somebody else: they cannot write a supervisor’s review for them, and they cannot approve their own targets. And every one of their actions is recorded against their name.', {}]]]);

faq('Do we have to use your login system?',
  'No — it is designed to sit behind your Active Directory, so staff use the password they already have and leavers lose access when IT disables the account, not when HR remembers. It is built and works against our own directory. It has not been tested against yours, and that is a scheduled task, not a completed one.');

/* C. Cycles and forms */
children.push(H2('C. Periods, cycles and forms'));

faq('What is the difference between a goal period and a review cycle?',
  'A goal period is when targets are set and measured — usually your financial year. A review cycle is an evaluation event inside it. One period can carry several cycles: probationary at month three and four, midyear, year-end.');

faq('Can we design our own forms?',
  'Yes. Sections, questions, rating scales and weights, built in Setup without a release. Forms are versioned, and a published version is frozen — editing a form never changes a review that has already been written against it.');

faq('Can different staff get different forms?',
  'Yes, by employment type and position. Probationary staff, regular staff and project-based staff can each have their own instrument, and the right one is resolved automatically when the cycle is generated.');

faq('What stops a cycle closing while people are still writing?',
  [[['Nothing closes with work outstanding — sign-off is refused while any part of a review is unsubmitted. ', {}],
    ['My unit', { bold: true }],
    [' names who it is waiting on, so “why is this stuck” is a screen rather than an investigation.', {}]]]);

faq('Can we reopen something after sign-off?',
  'A signed-off result is final by design, and correcting it is a deliberate, recorded act rather than an edit. That is what makes a rating defensible six months later when somebody disputes it.');

/* D. Day to day */
children.push(H2('D. Day-to-day operations'));

faq('Someone was promoted in the middle of the cycle. What do we do?',
  [[['Record it as a promotion with its effective date. Their history then shows the promotion sitting between their evaluations, which is what lets anyone reading it later see that two strong reviews were followed by a move.', {}]],
   [['Four separate actions exist rather than one “edit” button — hire, change, correct, separate — because ', {}],
    ['a correction and a change are not the same event', { bold: true }],
    ['. A correction fixes something that was never true. A change records something that became true on a date.', {}]]]);

faq('We only found out about a transfer three weeks late. Can we backdate it?',
  'Yes, and that is ordinary rather than an exception. You can also record one that takes effect next month. The system keeps dated periods, so recording it late does not falsify the dates.');

faq('What happens when somebody resigns?',
  'You separate them with a date. Nothing is deleted: notifications stop, they drop out of eligible populations, and their history stays intact — it has to, because past reviews of other people still reference them as a reviewer.');

faq('Someone forgot to check in for two months. Will we find out?',
  'Yes, in three places: the supervisor’s monitoring list, the automatic reminders as deadlines approach, and the HR console’s exceptions. The design assumption is that nobody logs in to look — so the system goes and tells them.');

/* E. Notifications */
children.push(H2('E. Notifications'));

faq('Does it email people, or do they have to log in?',
  'Both. In-app and email, with per-person preferences — immediate, a daily digest, or off. Twenty-three message types, covering assignment, approval, results, acknowledgement and deadline reminders.');

faq('Will it spam our staff?',
  'A deadline reminder fires once per milestone per person, not once per scan, and anybody who prefers a digest gets one message a day. The reminders run hourly against real deadlines rather than on a fixed schedule.');

faq('Can we change the wording? Some of it needs to be in Filipino.',
  'The templates are editable per company, and HR can also publish its own help articles inside the app — which is where your local policy belongs, clearly marked as yours rather than as how the software behaves.');

/* F. Reporting */
children.push(H2('F. Reporting and data'));

faq('Can we get the data out?',
  'Yes — CSV export throughout, and it is your database on your server, so nothing is locked away. Exports carry only what the person running them is allowed to see, which means an export is never a way around the access rules.');

faq('Can I report on everyone whose improvement plan ended successfully?',
  [[['Yes — by person, evaluation type, period, unit, or result. ', {}],
    ['This shipped this week and is not on the demo host yet', { bold: true, color: WARN }],
    ['; it is dated, not hypothetical. The filters live in the link, so a report can be sent to somebody rather than described to them — and they run it under their own access, which may return fewer rows than yours did.', {}]]]);

faq('Do you store salaries?',
  'No. There is no salary field anywhere in the database, and that was a decision rather than an omission — it keeps the most sensitive field in HR out of a system that many managers can reach.');

/* G. Hosting */
children.push(H2('G. Hosting, backup and privacy'));

faq('Where does the data live?',
  'On a server you own, inside your network. It does not go to a cloud provider, it does not leave the building, and it works with the internet down.');

faq('Who backs it up?',
  'Your IT, on your schedule — it is an ordinary PostgreSQL database. We will provide the procedure and test a restore with them during the pilot. Ask for that restore test explicitly; a backup nobody has restored is a hope.');

faq('What about the Data Privacy Act?',
  'No statutory identifiers are stored — no SSS, PhilHealth, Pag-IBIG, TIN or birthdate — because the system has no use for them. What it holds is work email, position, reporting line and performance records, all of it audited, and all of it on your own hardware.');

faq('Can we try it with one department first?',
  'That is exactly what you are looking at. A single department, on your real structure, with the rest of the group added when you are satisfied. The system is multi-company from the ground up — separate companies in the group cannot see each other, enforced the same way everything else is.');

/* H. Honest answers */
children.push(H2('H. Questions where the honest answer is “not yet”'));

children.push(P('Say these the same way as the rest. The audience will test at least one of them.'));

children.push(TBL(
  ['If they ask', 'Answer'],
  [
    ['Can it compute our KPI score the way our workbook does?',
     'Not yet, and deliberately. Three details in your workbook read two ways — including one where identical performance scores 35, 30 or 10 depending only on how the scorecard was written. We would rather be late than encode a guess into everyone’s rating.'],
    ['Does it work with our Active Directory?',
     'It is built for it and works against our own directory. It has never been tested against yours. That is a half-day with your IT team, and we would rather schedule it than assert it.'],
    ['Can it run the MDP promotion track?',
     'Not yet. The stages and dwell times are specified and not started — it is the next substantial piece after the scoring model.'],
    ['Does it do payroll, leave or timekeeping?',
     'No, and it will not. It integrates with them; it does not replace them.'],
    ['Are peer reviews anonymous?',
     'That is one of the twenty-one questions, and it is one we cannot retrofit quietly — it changes how the data is stored. We need the answer before we build it, not after.'],
  ],
  [3200, 6880],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Appendix ────────────────────────────────────────────────────── */
children.push(H1('Appendix — logins, and the state of the host'));

children.push(H3('The three logins, in demo order'));
children.push(TBL(
  ['Login', 'Person', 'Rank', 'Roles'],
  [
    [['josefina.gonzaga', { bold: true }], 'Associate — Screening', 'R11', 'employee'],
    [['crisanto.rivera', { bold: true }], 'Section Head — Employee Relations (8 reports)', 'R7', 'employee, manager'],
    [['alonzo.dimalanta', { bold: true }], 'Department Manager — HCM', 'R6', 'employee, manager, dept_head, hr_admin'],
  ],
  [2600, 4380, 900, 2200],
));
children.push(SPACER());
children.push(RP([['Optional fourth, for the scoping contrast in Section 4: ', {}],
  ['dalisay.zamora', { bold: true }],
  [' — Section Head, Compensation & Benefits, R7. Same rank as Crisanto, different section.', {}]]));
children.push(RP([['Password for all accounts: ', {}], ['test1234', { bold: true }],
  ['. Host: ', {}], ['https://hr.summitlogicsolutions.com', { bold: true }], ['.', {}]]));

children.push(SPACER());
children.push(H3('What is live on the demo host as of this morning'));
children.push(TBL(
  ['Area', 'State'],
  [
    ['Goals, check-ins, approvals, HCM target gate', 'Live'],
    ['Reviews, forms, calibration, sign-off, Department Head step', 'Live'],
    ['Competencies, development plans, feedback, PIPs', 'Live'],
    ['Analytics, nine-box, rater comparison, CSV export', 'Live'],
    ['My unit (Department Head / Area Head dashboard)', 'Live'],
    ['Staff importer, employment actions, Setup, in-app help', 'Live'],
    ['Notifications, digests, deadline reminders', 'Live'],
    [['Reports (filtered evaluation history)', { bold: true }],
     [['Built and tested — ', {}], ['not deployed', { bold: true, color: WARN }]]],
    [['Requests (extra competency / special eval / scoring adjustment)', { bold: true }],
     [['Built and tested — ', {}], ['not deployed', { bold: true, color: WARN }]]],
    ['KPI composite, MDP programmes, AD federation', 'Not built / not tested'],
  ],
  [6280, 3800],
));

children.push(SPACER());
children.push(BOX('Five-minute pre-flight, before anyone joins', [
  'Sign in as each of the three accounts once. First sign-in binds the account to the employee record, and you do not want to discover a mismatch live.',
  'Confirm the certificate is valid and the page loads over HTTPS without a warning.',
  'Open the one goal period and confirm it is unlocked — the lock refusal in Section 5 needs it open.',
  'Have the twenty-one questions document open in another tab, ready to send before the meeting ends.',
  'Decide in advance whether Reports and Requests will be deployed. If not, they stay in Section 7 as dated commitments and are not opened.',
], 'EAF0F6', ACCENT));

/* ── document ────────────────────────────────────────────────────── */

const doc = new Document({
  creator: 'Summit Logic Solutions',
  title: 'Guanzon HCM — Client Demo Meeting Flow and HR Setup FAQ',
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
