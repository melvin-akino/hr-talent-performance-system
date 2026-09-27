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

/* ── Business Requirements Document + Technical Design ───────────────── */

const children = [];

const STATUS = {
  done: ['Delivered', { bold: true }],
  part: ['Partly delivered', { bold: true }],
  none: ['Not started', {}],
  block: ['Awaiting your decision', { bold: true, color: WARN }],
};

/** Numbered requirement row helper. */
const REQ = (id, need, status) => [id, need, status];

/** A requirement table. */
const REQTBL = (rows) => TBL(
  ['Ref', 'Requirement', 'Status'],
  rows,
  [900, 7000, 2180],
);

const SUB = (t) => new Paragraph({
  spacing: { before: 200, after: 80 },
  children: [new TextRun({ text: t, size: 20, bold: true, color: ACCENT })],
});

/* ── Cover ───────────────────────────────────────────────────────── */
children.push(new Paragraph({ spacing: { before: 1200, after: 60 },
  children: [new TextRun({ text: 'Guanzon Group', size: 24, color: MUTED })] }));
children.push(new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({
    text: 'Performance and Talent Management System',
    size: 48, bold: true, color: ACCENT,
  })],
}));
children.push(new Paragraph({
  spacing: { after: 400 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: ACCENT, space: 8 } },
  children: [new TextRun({
    text: 'Business Requirements Document, with Technical Design',
    size: 28, color: MUTED,
  })],
}));

children.push(TBL(
  ['', ''],
  [
    [['Prepared for', { bold: true }], 'Human Capital Management, Guanzon Group'],
    [['Prepared by', { bold: true }], 'Summit Logic Solutions'],
    [['Version', { bold: true }], '1.0'],
    [['Date', { bold: true }], '28 September 2026'],
    [['Status', { bold: true }], 'For review'],
    [['Basis', { bold: true }],
     'Your 5-page performance management outline, your KPI workbook (HCM TO and hcm kpi sheets), and the working system as built to date.'],
  ],
  [2400, 7680],
));

children.push(SPACER());
children.push(BOX('How to read this document', [
  [['Sections 1 to 6 are the ', {}], ['business requirements', { bold: true }],
   [' — what the system must do, written in HR terms, with the delivery status of each one.', {}]],
  [['Section 7 is the ', {}], ['technical design', { bold: true }],
   [' — how it is built. It is written to be readable without a technical background. Your IT team will find enough there to judge it, and you will not need to translate it for them.', {}]],
  [['Sections 8 to 11 cover ', {}], ['delivery status, assumptions, the decisions we still need from you, and the risks', { bold: true }],
   ['. Section 10 is the one that affects your timeline.', {}]],
], 'EAF0F6', ACCENT));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 1. Purpose ──────────────────────────────────────────────────── */
children.push(H1('1. Purpose and background'));

children.push(H2('1.1 Why this system exists'));
children.push(P(
  'Guanzon Group currently runs performance management through a third-party '
  + 'service together with spreadsheets and email. That arrangement has three '
  + 'costs: your performance records sit outside your control, the scoring rules '
  + 'described in your own documentation cannot be enforced by the tools, and '
  + 'the history of a person’s evaluations is spread across files rather than '
  + 'held in one place.',
));
children.push(P(
  'This system replaces that arrangement with software installed on your own '
  + 'server. It holds targets, monthly progress, evaluations, peer input, skills '
  + 'assessments, improvement plans and development records for every employee, '
  + 'and it enforces your own rules about who may see and do what.',
));

children.push(H2('1.2 What we are trying to achieve'));
children.push(REQTBL([
  ['1.1', 'Performance records stay inside Guanzon, on hardware you own, with no dependence on an outside service continuing to trade.', STATUS.done],
  ['1.2', 'One place holds a person’s full performance history, from hiring to the present.', STATUS.done],
  ['1.3', 'The rules in your own documentation are enforced by the system, not remembered by people.', STATUS.part],
  ['1.4', 'Managers and HCM can see the state of an evaluation round at any time, without asking.', STATUS.done],
  ['1.5', 'Every rating, approval and change is recorded against a named person and a date.', STATUS.done],
  ['1.6', 'Nobody can see a record they are not entitled to see, whatever route they take to it.', STATUS.done],
]));

children.push(H2('1.3 Audience for this document'));
children.push(P(
  'Written for HR decision-makers. Section 7 is written so that a technical '
  + 'reader gets a fair picture and a non-technical reader is not excluded. '
  + 'Where a technical term is unavoidable it is explained where it first '
  + 'appears, and all of them are collected in the glossary at Section 12.',
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 2. Scope ────────────────────────────────────────────────────── */
children.push(H1('2. Scope'));

children.push(H2('2.1 In scope'));
children.push(BULLET('Setting, approving and tracking targets and KPIs, with monthly progress updates.'));
children.push(BULLET('Evaluations of all five types described in your documentation: probationary, annual, semi-annual, project or term-based, and KPI.'));
children.push(BULLET('The full approval chain: self, supervisor, Department Head, moderation by HCM, and release to the employee.'));
children.push(BULLET('Peer evaluation, including how the panel is chosen and who is eligible.'));
children.push(BULLET('Skills and competency assessment, gap analysis and development plans.'));
children.push(BULLET('Performance improvement plans, with milestones and recorded outcomes.'));
children.push(BULLET('Employee records for performance purposes: position, rank, department, reporting line, and employment history.'));
children.push(BULLET('Reporting, individual history, dashboards by level, and automatic reminders.'));
children.push(BULLET('Administration by your own HCM team: forms, rating scales, org structure, ranks, roles and help content.'));

children.push(H2('2.2 Out of scope'));
children.push(P('These are deliberately excluded, and the system is designed on the assumption that other systems continue to own them.'));
children.push(REQTBL([
  ['2.1', 'Payroll of any kind — salaries, payslips, government contributions, final pay.', ['Excluded', {}]],
  ['2.2', 'Timekeeping — daily time records, clock-in, overtime, shift scheduling.', ['Excluded', {}]],
  ['2.3', 'Leave management — filing, balances, approvals.', ['Excluded', {}]],
  ['2.4', 'Recruitment and applicant tracking.', ['Excluded', {}]],
  ['2.5', 'Storage of documents and files. Evidence is referenced by link to wherever your documents already live.', ['Excluded', {}]],
  ['2.6', 'Storage of salary figures or government identification numbers of any kind.', ['Excluded by design', { bold: true }]],
]));

children.push(SPACER());
children.push(BOX('Why salary and government IDs are excluded on purpose', [
  'A performance system is opened by many supervisors across the group. Holding salary figures or SSS, PhilHealth, Pag-IBIG and TIN numbers in the same place would widen the consequences of any mistake considerably, and the system has no use for them. Attendance arrives as a count for the period rather than as a daily record, for the same reason.',
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 3. Users ────────────────────────────────────────────────────── */
children.push(H1('3. Users and access levels'));

children.push(P(
  'Access is granted to a person deliberately. Being a member of the HCM '
  + 'department confers nothing by itself. Supervisor access is the one '
  + 'exception: it follows the reporting line, so moving somebody in the org '
  + 'chart moves their access with them.',
));

children.push(TBL(
  ['Level', 'Who holds it', 'What they can reach'],
  [
    [['Employee', { bold: true }], 'Everybody', 'Their own targets, updates, evaluations, skills, development plan and history.'],
    [['Supervisor', { bold: true }], 'Anybody with people reporting to them', 'Everything above, plus the same for the people who report to them: approving targets, logging updates, writing evaluations.'],
    [['Department Head', { bold: true }], 'Section and department heads', 'Their whole section including everything beneath it, and the approval step above the supervisor.'],
    [['Area / Regional Head, GM', { bold: true }], 'Defined, not yet assigned', 'Their area or region. Becomes meaningful when the pilot extends past one department.'],
    [['HR Partner', { bold: true }], 'HCM staff', 'The whole company, for HR work, without administering the system.'],
    [['HCM Administrator', { bold: true }], 'HCM Department Manager', 'Everything: evaluation rounds, moderation, forms, org structure, roles, imports, settings.'],
  ],
  [2100, 2600, 5380],
));

children.push(SPACER());
children.push(SUB('Note on combined roles'));
children.push(P(
  'One person may hold several levels at once, and in your structure the HCM '
  + 'Department Manager does — they are the Department Head for HCM and also '
  + 'administer the system. Levels add together and never subtract. In a branch '
  + 'the same two levels would be held by two different people, and no '
  + 'configuration would change.',
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 4. Functional requirements ──────────────────────────────────── */
children.push(H1('4. Functional requirements'));

children.push(P(
  'Numbered for reference. Status reflects the system as at the date of this '
  + 'document. Items marked "awaiting your decision" are held up by the open '
  + 'questions in Section 10, not by effort.',
));

children.push(H2('4.1 Organisation, people and structure'));
children.push(REQTBL([
  ['4.1.1', 'Hold the group structure at all six levels: Holdings, Group, Division, Department or Area, Branch or Brand.', STATUS.done],
  ['4.1.2', 'Hold the rank ladder using your own numbering, 6 to 11, where a lower number is more senior.', STATUS.done],
  ['4.1.3', 'Hold positions, and link each position to a rank.', STATUS.done],
  ['4.1.4', 'Hold reporting lines, dated, so that past evaluations still show who the supervisor was at the time.', STATUS.done],
  ['4.1.5', 'Load employees in bulk from a 201 spreadsheet, with a preview that changes nothing until confirmed.', STATUS.done],
  ['4.1.6', 'Add a single employee directly, without a spreadsheet.', STATUS.done],
  ['4.1.7', 'Record a promotion, transfer, regularisation or other change with the date it took effect, including backdated and future-dated entries.', STATUS.done],
  ['4.1.8', 'Correct a record that was wrong, separately from recording a change, so that a correction does not rewrite history.', STATUS.done],
  ['4.1.9', 'Record an employee leaving, keeping their history intact.', STATUS.done],
  ['4.1.10', 'Support more than one company in the group, with no visibility between them.', STATUS.done],
]));

children.push(H2('4.2 Targets and KPIs'));
children.push(REQTBL([
  ['4.2.1', 'Set targets for a period, each with a measure, a starting point, a goal and a weight.', STATUS.done],
  ['4.2.2', 'Require the weights of a person’s targets to total 100%, and refuse to close the period until they do.', STATUS.done],
  ['4.2.3', 'Maintain a reusable KPI library so targets are written consistently.', STATUS.done],
  ['4.2.4', 'Record monthly progress updates against each target.', STATUS.done],
  ['4.2.5', 'Route a target for supervisor approval, with the ability to send it back with a reason.', STATUS.done],
  ['4.2.6', 'Add an HCM approval step after the supervisor, switchable per period.', STATUS.done],
  ['4.2.7', 'Calculate attainment automatically from the target and the actual figure.', STATUS.done],
  ['4.2.8', 'Hold task indicators and per-role scorecards, with the nature of each task recorded.', STATUS.done],
  ['4.2.9', 'Convert quarterly task tallies into a KPI score using your banded table.', STATUS.block],
]));

children.push(H2('4.3 Evaluations'));
children.push(REQTBL([
  ['4.3.1', 'Support all five evaluation types as configuration rather than as five separate features.', STATUS.done],
  ['4.3.2', 'Run evaluation rounds on a calendar basis, with defined open and close dates.', STATUS.done],
  ['4.3.3', 'Run probationary evaluations at the 3rd and 4th month, counted from each individual’s own date, and average the two.', STATUS.block],
  ['4.3.4', 'Route each evaluation through self, supervisor, Department Head, moderation and release.', STATUS.done],
  ['4.3.5', 'Allow the Department Head to approve, revise or return an evaluation.', STATUS.done],
  ['4.3.6', 'Refuse to finalise a round while any part of any evaluation is unfinished, and show who it is waiting on.', STATUS.done],
  ['4.3.7', 'Keep an evaluation invisible to its subject until it is released.', STATUS.done],
  ['4.3.8', 'Record the employee’s acknowledgement of their result.', STATUS.done],
  ['4.3.9', 'Build evaluation forms in-house — sections, questions, rating scales and weights — without waiting for the supplier.', STATUS.done],
  ['4.3.10', 'Assign different forms by employment type and position, resolved automatically.', STATUS.done],
  ['4.3.11', 'Calculate a score out of 100 from weighted line items, rather than accepting a typed-in overall rating.', STATUS.block],
  ['4.3.12', 'Produce the KPI composite result: 30 attendance, 40 competency, 30 peer.', STATUS.block],
  ['4.3.13', 'Apply the incentive bands to a final score.', STATUS.block],
]));

children.push(H2('4.4 Peer evaluation'));
children.push(REQTBL([
  ['4.4.1', 'Define the rules by which a peer panel is drawn, based on rank distance and organisational unit.', STATUS.done],
  ['4.4.2', 'Draw the panel automatically according to those rules.', STATUS.done],
  ['4.4.3', 'Apply an eligibility test, so that somebody who has not worked with the subject is not asked.', STATUS.done],
  ['4.4.4', 'Use the 30-point peer instrument from your documentation.', STATUS.done],
  ['4.4.5', 'Invite peers automatically and re-draw when somebody declines.', STATUS.part],
  ['4.4.6', 'Apply the minimum and maximum panel size.', STATUS.block],
  ['4.4.7', 'Handle anonymity of peer responses according to your policy.', STATUS.block],
]));

children.push(H2('4.5 Competencies and development'));
children.push(REQTBL([
  ['4.5.1', 'Maintain a competency library, versioned, so that changing it does not alter past assessments.', STATUS.done],
  ['4.5.2', 'Define the competencies and levels each position requires.', STATUS.done],
  ['4.5.3', 'Record assessments and show the gap between required and assessed.', STATUS.done],
  ['4.5.4', 'Maintain individual development plans with actions and target dates.', STATUS.done],
  ['4.5.5', 'Maintain career paths between positions with typical durations.', STATUS.done],
  ['4.5.6', 'Collect colleague feedback on request, separately from formal evaluation.', STATUS.done],
  ['4.5.7', 'Run the MDP and Back Office promotion programmes as tracked stages with dwell times.', STATUS.none],
]));

children.push(H2('4.6 Performance improvement'));
children.push(REQTBL([
  ['4.6.1', 'Create an improvement plan with reasons, expected outcome, start and end dates.', STATUS.done],
  ['4.6.2', 'Set milestones and record check-ins against them.', STATUS.done],
  ['4.6.3', 'Require a recorded outcome before a plan can be closed.', STATUS.done],
  ['4.6.4', 'Keep the plan visible to the employee, their supervisor and HCM, and nobody else.', STATUS.done],
  ['4.6.5', 'Prevent a closed plan from being edited after the fact.', STATUS.done],
]));

children.push(H2('4.7 Reporting, history and dashboards'));
children.push(REQTBL([
  ['4.7.1', 'Show one employee’s full history in a single view — evaluations, task results, improvement plans, assessments and employment events.', STATUS.done],
  ['4.7.2', 'Search performance history by person, evaluation type, period, unit or result, and download the result.', STATUS.done],
  ['4.7.3', 'Provide dashboards for each level: employee, supervisor, Department Head, Area or Regional Head, and HCM.', STATUS.done],
  ['4.7.4', 'Show rating distribution, a nine-box grid, and a comparison of how different supervisors rate.', STATUS.done],
  ['4.7.5', 'Record what moderation changed, so the effect of the meeting is visible.', STATUS.done],
  ['4.7.6', 'Allow a Department Head to request an extra competency, a one-off evaluation or a scoring adjustment, and record the decision.', STATUS.done],
  ['4.7.7', 'Rank branches for annual bonus purposes.', STATUS.block],
]));

children.push(H2('4.8 Notifications and reminders'));
children.push(REQTBL([
  ['4.8.1', 'Notify people when work is assigned to them, when a result is released, and when an acknowledgement is needed.', STATUS.done],
  ['4.8.2', 'Send reminders as deadlines approach, once per deadline per person.', STATUS.done],
  ['4.8.3', 'Deliver both inside the system and by email through your own mail server.', STATUS.done],
  ['4.8.4', 'Let each person choose immediate delivery, a daily summary, or none.', STATUS.done],
  ['4.8.5', 'Retry delivery automatically rather than losing a message when mail is briefly unavailable.', STATUS.done],
  ['4.8.6', 'Allow HCM to edit the wording of messages for the company.', STATUS.done],
]));

children.push(H2('4.9 Administration and support'));
children.push(REQTBL([
  ['4.9.1', 'Allow HCM to administer org structure, ranks, positions, forms, scales and roles without supplier involvement.', STATUS.done],
  ['4.9.2', 'Provide in-system help that opens on the screen the user is looking at.', STATUS.done],
  ['4.9.3', 'Allow HCM to publish its own policy guidance inside the system, clearly marked as company policy.', STATUS.done],
  ['4.9.4', 'Provide a readiness check that reports what would fail before a department starts using the system.', STATUS.done],
  ['4.9.5', 'Restrict the setting of scoring parameters to named roles, narrower than general HCM administration.', STATUS.none],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 5. Non-functional ───────────────────────────────────────────── */
children.push(H1('5. Non-functional requirements'));

children.push(P(
  'These are the qualities the system must have regardless of which feature is '
  + 'being used. They are the requirements most often left unstated and most '
  + 'expensive to add later.',
));

children.push(H2('5.1 Security and access'));
children.push(REQTBL([
  ['5.1.1', 'Access must be enforced below the screens, so that no fault in the software can expose a record the user is not entitled to.', STATUS.done],
  ['5.1.2', 'Attempting to open a record you may not see must not reveal that the record exists.', STATUS.done],
  ['5.1.3', 'Nobody may approve their own target or evaluation.', STATUS.done],
  ['5.1.4', 'Nobody may request a change to their own record that requires approval.', STATUS.done],
  ['5.1.5', 'Staff must be able to sign in with their existing office account rather than a new password.', STATUS.part],
  ['5.1.6', 'Disabling somebody’s office account must remove their access without HR action.', STATUS.part],
]));

children.push(H2('5.2 Privacy and data protection'));
children.push(REQTBL([
  ['5.2.1', 'No government identification numbers are stored.', STATUS.done],
  ['5.2.2', 'No salary information is stored.', STATUS.done],
  ['5.2.3', 'Data remains on Guanzon-owned hardware inside the office network.', STATUS.done],
  ['5.2.4', 'Backups are encrypted, because a backup holds the complete performance record of every employee.', STATUS.done],
  ['5.2.5', 'An evaluation in progress is not visible to its subject until released.', STATUS.done],
  ['5.2.6', 'A request to adjust somebody’s score is not visible to that person while it is being decided.', STATUS.done],
]));

children.push(H2('5.3 Record keeping and audit'));
children.push(REQTBL([
  ['5.3.1', 'Every change records who made it and when, and cannot be altered afterwards.', STATUS.done],
  ['5.3.2', 'Nothing is ever deleted. Somebody leaving closes their record rather than removing it.', STATUS.done],
  ['5.3.3', 'A finalised result cannot be quietly edited; correcting one is a recorded act.', STATUS.done],
  ['5.3.4', 'Changing a form or a rule must not alter results already issued under the previous version.', STATUS.done],
]));

children.push(H2('5.4 Availability, backup and recovery'));
children.push(REQTBL([
  ['5.4.1', 'The system must work with the office internet connection down.', STATUS.done],
  ['5.4.2', 'A full backup is taken nightly, verified as readable, encrypted, and written away from the server.', STATUS.done],
  ['5.4.3', 'A restore must be tested on Guanzon hardware before go-live, and the time it takes recorded.', ['Go-live condition', { bold: true, color: WARN }]],
  ['5.4.4', 'Updates must not require more than a few minutes of planned downtime.', STATUS.done],
  ['5.4.5', 'The server must have battery backup with automatic safe shutdown, and mirrored disks.', ['Guanzon to provide', { bold: true }]],
]));

children.push(H2('5.5 Capacity and performance'));
children.push(REQTBL([
  ['5.5.1', 'Support up to approximately 1,000 employees on a single server.', STATUS.done],
  ['5.5.2', 'Remain usable when the whole organisation logs in at once at period close.', STATUS.done],
  ['5.5.3', 'Work on ordinary office computers through a web browser, with nothing to install.', STATUS.done],
  ['5.5.4', 'Remain usable on a phone or tablet screen.', STATUS.done],
]));

children.push(H2('5.6 Usability and support'));
children.push(REQTBL([
  ['5.6.1', 'An employee must be able to complete their part without training.', STATUS.done],
  ['5.6.2', 'Guidance must be available inside the screen where the question arises.', STATUS.done],
  ['5.6.3', 'The system must state clearly why it refused an action, rather than failing silently.', STATUS.done],
  ['5.6.4', 'Where a figure is incomplete, the screen must say so rather than showing a misleading total.', STATUS.done],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 6. Business rules ───────────────────────────────────────────── */
children.push(H1('6. Key business rules'));

children.push(P(
  'These are the rules the system enforces rather than merely recording. Each '
  + 'one comes from your own documentation or from a decision taken during the '
  + 'build. They are listed here because they change how your staff will work, '
  + 'and they are worth confirming.',
));

children.push(TBL(
  ['Rule', 'What it means in practice'],
  [
    [['Weights must total 100%', { bold: true }],
     'A target period cannot be closed while anybody’s weights do not add up. The exception list shows who, so it is a five-minute fix rather than a hunt.'],
    [['A round cannot be finalised with work outstanding', { bold: true }],
     'One unwritten evaluation holds up the whole round. The system names the person it is waiting on, so chasing is targeted.'],
    [['Nobody approves their own work', { bold: true }],
     'Applies to targets and evaluations, and cannot be overridden by any role, including the administrator.'],
    [['A lower rank number is more senior', { bold: true }],
     'Your own numbering is used exactly as written. Rank 6 is above rank 11. Every rank-based rule follows this direction.'],
    [['A correction is not a change', { bold: true }],
     'Fixing an error that was always wrong is separate from recording something that became true on a date. Collapsing the two would silently rewrite past evaluations.'],
    [['An approval records a decision, not the change itself', { bold: true }],
     'Approving a requested score adjustment does not move the score. Somebody makes the change on the screen that owns it, so the question "who changed this" always has an answer.'],
    [['Definitions are versioned; results are frozen', { bold: true }],
     'A round keeps the rules it was issued under. Changing a form or a definition next year never rewrites last year’s results.'],
    [['The staff file does not rearrange the org chart', { bold: true }],
     'An import will create new units but never move or relabel an existing one. Disagreements are reported for a person to settle.'],
    [['Attendance arrives as a count, not a record', { bold: true }],
     'The system receives the number of instances for the period. It does not hold daily time records and does not become a timekeeping system by accident.'],
  ],
  [3200, 6880],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ══ 7. TECHNICAL DESIGN ════════════════════════════════════════════ */
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Technical Design', size: 32, bold: true, color: ACCENT })],
}));
children.push(H1('7. How the system is built'));

children.push(P(
  'This section is written for a general reader. It gives your IT team enough '
  + 'to judge the design and gives you enough to discuss it with them.',
));

children.push(H2('7.1 Overall shape'));
children.push(P(
  'The system runs on a single server inside your office. Staff reach it through '
  + 'an ordinary web browser; there is nothing to install on their computers. '
  + 'Five separate parts run on that server, each doing one job.',
));

children.push(TBL(
  ['Part', 'What it does'],
  [
    [['The store', { bold: true }], 'Holds all the information. This is also where the access rules live — see 7.3.'],
    [['The application', { bold: true }], 'The logic: what happens when a target is approved, when a round is finalised, when a reminder is due.'],
    [['The screens', { bold: true }], 'What staff see in the browser.'],
    [['Sign-in', { bold: true }], 'Checks who somebody is. Connects to your existing office accounts.'],
    [['The front door', { bold: true }], 'Handles the secure connection, so traffic inside your network is encrypted.'],
  ],
  [2400, 7680],
));

children.push(SPACER());
children.push(P(
  'All five are widely used, open, freely licensed components. Nothing central '
  + 'to the system was invented by us, which matters for your ability to have it '
  + 'maintained by somebody else later.',
));

children.push(H2('7.2 The most important design decision'));

children.push(BOX('Access is enforced in the store, not in the screens', [
  'Most systems put the check at the door: the software works out what you are allowed to see and then shows you that. If the software has a fault, or if somebody reaches the information another way, the protection is gone.',
  'This system puts the rule on each individual record instead. The application asks for information as you, and the store returns only the records you are entitled to. There is no path — through a screen, a report, a download or a direct connection by the application — that returns a record you may not see.',
  'The practical consequence: a fault in the software cannot leak another department’s evaluations, because those records never leave the store in the first place.',
], 'EAF0F6', ACCENT));

children.push(SPACER());
children.push(P(
  'There are 146 such rules covering 57 categories of information. They are '
  + 'tested automatically against a real copy of the store every time anything '
  + 'changes — 742 tests on the logic, 138 on the screens, and 14 tests that '
  + 'drive the system end to end as a user would.',
));
children.push(P(
  'One consequence worth knowing: when somebody opens a record they are not '
  + 'entitled to, the system answers "not found" rather than "not allowed". '
  + 'Saying "you are not allowed to see this employee’s evaluation" would '
  + 'confirm that the evaluation exists, which is itself a disclosure.',
));

children.push(H2('7.3 Sign-in'));
children.push(P(
  'A standard sign-in component sits between the system and your existing '
  + 'office directory. Staff use the username and password they already have. '
  + 'The system never sees a password and stores none. When IT disables '
  + 'somebody’s office account, they lose access here with no action from HR.',
));
children.push(RP([
  ['Current state: ', { bold: true }],
  ['this is built and works against our own test directory. ', {}],
  ['It has not yet been connected to the Guanzon directory', { bold: true, color: WARN }],
  [' — that is a scheduled task requiring roughly half a day with your IT team, and it is listed as a dependency in Section 9.', {}],
]));

children.push(H2('7.4 Keeping history straight'));
children.push(P(
  'Performance records are read years later, often in a dispute. Three design '
  + 'choices protect that.',
));
children.push(RBULLET([['Everything is dated.', { bold: true }],
  [' A reporting line, a position and an employment record each have a period during which they applied. An evaluation from 2024 shows the supervisor who held the role in 2024, not the current one.', {}]]));
children.push(RBULLET([['Rules are versioned, and results are frozen against a version.', { bold: true }],
  [' An evaluation round keeps the form and the rules it was issued under. Revising a form next year cannot alter a rating already given.', {}]]));
children.push(RBULLET([['Nothing is deleted.', { bold: true }],
  [' Somebody leaving closes their record. Their history stays, because other people’s past evaluations refer to them as a reviewer.', {}]]));

children.push(H2('7.5 Messages and reminders'));
children.push(P(
  'Messages are placed in a queue inside the store rather than sent immediately. '
  + 'If your mail server is briefly unavailable the message waits and is retried, '
  + 'instead of being lost. Delivery is both inside the system and by email '
  + 'through your own mail server, so no message leaves your network. Each '
  + 'person can choose immediate delivery, a daily summary, or none.',
));
children.push(P(
  'A scan runs hourly against real deadlines. A reminder is sent once per '
  + 'deadline per person, not once per scan. There are more than 20 built-in '
  + 'message types, and their wording can be edited by HCM.',
));

children.push(H2('7.6 Loading and maintaining data'));
children.push(P(
  'Bulk loading is by spreadsheet, in two steps. The first step reports exactly '
  + 'what would be created, changed and skipped, and writes nothing. Only on '
  + 'confirmation is anything saved. The blank template is produced by the same '
  + 'component that reads the file, so the template can never drift out of step '
  + 'with what the system expects.',
));
children.push(P(
  'Repeating an import is safe: it matches on employee number and updates rather '
  + 'than duplicating. Contradictions within a file — the same unit under two '
  + 'different parents, or a person placed at two levels at once — are refused '
  + 'with the row identified, rather than resolved by guesswork.',
));

children.push(H2('7.7 Installation, updates and recovery'));
children.push(TBL(
  ['Topic', 'How it works'],
  [
    [['Installation', { bold: true }],
     'One command on one Linux server. Nothing is installed on staff computers.'],
    [['Updates', { bold: true }],
     'We prepare finished, sealed packages elsewhere and hand them to the server, which never has to build anything and never needs internet access. About one minute of planned downtime, scheduled outside working hours.'],
    [['If an update fails', { bold: true }],
     'The previous version is still present and is restored in seconds. Changes to the structure of the store only move forward, so the update procedure takes a backup immediately beforehand, every time.'],
    [['Backups', { bold: true }],
     'A full copy nightly, compressed, encrypted, checked for readability, kept 30 days, written away from the server.'],
    [['Recovery testing', { bold: true }],
     'A drill restores the most recent copy into a scratch area, confirms the information arrived, and reports how long it took — which is the real recovery time rather than an assumed one. To be run monthly.'],
  ],
  [2400, 7680],
));

children.push(SPACER());
children.push(BOX('How much could be lost', [
  [['With nightly backups alone, a total server failure would lose up to one day of work.', { bold: true }],
   [' If that is unacceptable for performance records — and that is a business judgement, not a technical one — continuous copying reduces it to minutes, at the cost of additional disk space. We recommend deciding this explicitly before go-live rather than discovering the answer afterwards.', {}]],
]));

children.push(H2('7.8 What the design deliberately avoids'));
children.push(P(
  'Each of these is a component we chose not to add. Every additional part is '
  + 'another thing to configure, patch, monitor and recover.',
));
children.push(BULLET('No separate queueing, caching or search components. Background work runs inside the store, so there is one thing to back up and one thing that can fail.'));
children.push(BULLET('No file storage. Evidence is a link to wherever your documents already live. This removes file sizing, file backup and virus scanning from the project entirely.'));
children.push(BULLET('No dependence on any internet service at run time. The system works with your connection down.'));
children.push(BULLET('No cloud account, no subscription to a third party, and nothing that stops working if a supplier does.'));

children.push(H2('7.9 What your IT team will need to own'));
children.push(REQTBL([
  ['7.1', 'Patching the server operating system and the supporting components, on a named schedule.', ['Guanzon IT', { bold: true }]],
  ['7.2', 'Off-server backup destination, and a check that copies arrive.', ['Guanzon IT', { bold: true }]],
  ['7.3', 'Battery backup with tested automatic shutdown, and mirrored disks.', ['Guanzon IT', { bold: true }]],
  ['7.4', 'Security certificates for the internal address, and a calendar reminder before expiry.', ['Guanzon IT', { bold: true }]],
  ['7.5', 'Monitoring and alerting — at minimum disk space, backup failure and system availability.', ['Guanzon IT', { bold: true }]],
  ['7.6', 'Remote access arrangements for staff working outside the office, if required.', ['Guanzon IT', { bold: true }]],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 8. Status ───────────────────────────────────────────────────── */
children.push(H1('8. Delivery status'));

children.push(P(
  'The system is in use on a demonstration installation with your organisational '
  + 'structure and invented staff. The figures below describe the system as built '
  + 'to date.',
));

children.push(TBL(
  ['Area', 'Status'],
  [
    ['Organisation, people, employment records, bulk loading', ['Delivered', { bold: true }]],
    ['Targets, KPIs, monthly updates, approval chain, HCM approval gate', ['Delivered', { bold: true }]],
    ['Evaluation rounds, forms, moderation, finalising, Department Head step', ['Delivered', { bold: true }]],
    ['Peer evaluation: rules, drawing the panel, eligibility, the 30-point instrument', ['Delivered', { bold: true }]],
    ['Competencies, development plans, career paths, colleague feedback', ['Delivered', { bold: true }]],
    ['Performance improvement plans', ['Delivered', { bold: true }]],
    ['Individual history, reporting and search, dashboards at every level', ['Delivered', { bold: true }]],
    ['Requests and approvals for exceptions', ['Delivered', { bold: true }]],
    ['Notifications, reminders, delivery preferences', ['Delivered', { bold: true }]],
    ['Administration, settings, in-system help, readiness check', ['Delivered', { bold: true }]],
    ['KPI composite scoring and incentive bands',
     [['Awaiting your decisions', { bold: true, color: WARN }], [' — Section 10', {}]]],
    ['Probationary scheduling from individual dates',
     [['Awaiting your decision', { bold: true, color: WARN }], [' — Section 10', {}]]],
    ['Peer panel sizing and anonymity',
     [['Awaiting your decisions', { bold: true, color: WARN }], [' — Section 10', {}]]],
    ['Attendance figures from payroll',
     [['Awaiting your decision', { bold: true, color: WARN }], [' — Section 10', {}]]],
    ['Promotion programmes (MDP and Back Office)', ['Specified, not started', {}]],
    ['Office directory sign-in', ['Built, not yet connected to yours', { bold: true }]],
  ],
  [6280, 3800],
));

children.push(SPACER());
children.push(SUB('Quality measures'));
children.push(BULLET('742 automated tests of the logic, run against a real copy of the store rather than a simulation — which is the only way a security rule can actually be verified.'));
children.push(BULLET('138 automated tests of the screens, and 14 that drive the whole system end to end as a user would.'));
children.push(BULLET('Every security test confirms it is not running with administrator privileges before it trusts its own result.'));
children.push(BULLET('No third-party penetration test has been carried out. If one is required before go-live, we would support it and recommend it be commissioned independently.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 9. Assumptions ──────────────────────────────────────────────── */
children.push(H1('9. Assumptions and dependencies'));

children.push(H2('9.1 Assumptions'));
children.push(REQTBL([
  ['9.1', 'Headcount is within approximately 1,000 employees for a single installation.', ['To confirm', {}]],
  ['9.2', 'Staff have access to an office computer or a phone with a browser.', ['Assumed', {}]],
  ['9.3', 'Guanzon operates an Active Directory or equivalent staff directory.', ['Assumed', {}]],
  ['9.4', 'Guanzon operates a mail server that can accept messages from an internal system.', ['Assumed', {}]],
  ['9.5', 'Work email addresses in the directory match those in the 201 file, or will be reconciled.', ['To confirm', { bold: true }]],
  ['9.6', 'The structure in the HCM workbook reflects the current organisation.', ['Assumed', {}]],
]));

children.push(H2('9.2 Dependencies on Guanzon'));
children.push(REQTBL([
  ['9.7', 'A server meeting the specification in Section 7, with battery backup and mirrored disks.', ['Required for go-live', { bold: true }]],
  ['9.8', 'Approximately half a day with the team that administers your staff directory.', ['Required', { bold: true }]],
  ['9.9', 'A named owner for patching and monitoring after go-live.', ['Required', { bold: true }]],
  ['9.10', 'A current 201 file covering the pilot population.', ['Required', { bold: true }]],
  ['9.11', 'Answers to the open decisions in Section 10.', ['Blocking', { bold: true, color: WARN }]],
  ['9.12', 'A tested restore on Guanzon hardware before go-live.', ['Required for go-live', { bold: true }]],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 10. Open decisions ──────────────────────────────────────────── */
children.push(H1('10. Decisions we need from you'));

children.push(BOX('This section determines the delivery date', [
  [['Twenty-one questions were issued on 28 August 2026 and remain unanswered.', { bold: true }],
   [' They are not requests for preference. Each one is a point where your own documentation can be read two different ways, and where building the wrong reading would produce incorrect ratings for real people.', {}]],
  [['Six of them block the KPI scoring — the central requirement of your specification and the one part the demonstration cannot show.', {}]],
], 'F4EFE6', WARN));

children.push(SPACER());
children.push(P('Summarised below. The full set was sent separately.'));

children.push(TBL(
  ['Decision needed', 'Why it matters', 'Blocks'],
  [
    ['Is a quarterly task tally measured against each role’s own target before the score bands are applied?',
     'As written, identical performance scores 35, 30 or 10 depending only on how the scorecard was worded. Area Coordinators fall outside the table entirely.',
     'KPI scoring'],
    ['What happens at exactly 70 points, and above 100?',
     'The bands say "below 70 not qualified" and then start at 71. Nothing covers 70 itself.',
     'Incentive bands'],
    ['The 81–90 band reads "80% or 30%". Which is it?',
     'The neighbouring bands suggest 30%, but we will not assume a figure that decides somebody’s incentive.',
     'Incentive bands'],
    ['How many peer reviewers — 2, 3, or 3 to 5?',
     'Three different figures appear across your documents.',
     'Peer evaluation'],
    ['Are peer responses anonymous, and to whom?',
     'This changes how the information is stored and cannot be altered quietly later.',
     'Peer evaluation'],
    ['Are probationary evaluations counted from the hiring date?',
     'And what happens if regularisation moves.',
     'Probationary type'],
    ['Which payroll system provides attendance, and in what form?',
     'Thirty of the hundred KPI points come from it.',
     'KPI scoring'],
    ['How do the numbered ranks map to the named ranks, and do they run group-wide?',
     'Peer selection and promotion rules both depend on the answer.',
     'Peer evaluation, promotions'],
    ['On what basis are branches ranked for annual bonuses?',
     'Average of staff scores, or a branch-level scorecard — these give different answers.',
     'Branch ranking'],
  ],
  [3600, 4680, 1800],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 11. Risks ───────────────────────────────────────────────────── */
children.push(H1('11. Risks'));

children.push(TBL(
  ['Risk', 'Effect', 'How it is managed'],
  [
    [['The open decisions remain unanswered', { bold: true }],
     'The KPI scoring cannot be built, and it is the centre of your specification. The delay is one-for-one: every week without answers is a week added.',
     'Raised at every review. Everything not dependent on an answer has been built first, so nothing else is waiting.'],
    [['Office directory connection proves difficult', { bold: true }],
     'Staff would need separate passwords at launch, which is a poor first impression and an administrative burden.',
     'Schedule the half-day with IT early in the pilot rather than at the end. A fallback of separate accounts exists but is not recommended.'],
    [['Email addresses do not match between the directory and the 201 file', { bold: true }],
     'Affected staff cannot sign in. Discovered at launch this looks like a system failure.',
     'The readiness check reports mismatches before go-live rather than after. Reconciliation is a planned task, not an incident.'],
    [['Backup never restored on Guanzon hardware', { bold: true }],
     'A backup that has never been restored is an assumption. Discovering it fails during an actual incident is the worst case.',
     'Listed as a go-live condition. A drill script is provided and should be run monthly thereafter.'],
    [['No named owner for patching', { bold: true }],
     'An unmaintained server is the most common way systems of this kind come to harm.',
     'Named during the pilot, with a schedule agreed. Listed as a dependency.'],
    [['Scope drifts toward payroll or timekeeping', { bold: true }],
     'The system becomes a different product, and the privacy position weakens as sensitive data is added.',
     'Exclusions stated in Section 2 and designed in — attendance arrives as a count, and no salary field exists.'],
    [['No independent security assessment', { bold: true }],
     'Assurance rests on our own testing.',
     'We recommend Guanzon commission an independent assessment before go-live. We will support it and address the findings.'],
  ],
  [2600, 3880, 3600],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 12. Glossary ────────────────────────────────────────────────── */
children.push(H1('12. Glossary'));

children.push(TBL(
  ['Term', 'Meaning in this document'],
  [
    ['Target period', 'The span over which targets are set and measured — usually the financial year.'],
    ['Evaluation round', 'A single assessment event: probationary, midyear, annual, or a one-off.'],
    ['Moderation', 'The meeting where ratings are compared across sections so that a rating does not depend on who the supervisor happens to be. Sometimes called calibration.'],
    ['Weight', 'How much one target contributes to a person’s overall result. A person’s weights total 100%.'],
    ['Attainment', 'How far a target was met, calculated from the target figure and the actual figure.'],
    ['Nine-box', 'A three-by-three grid placing people by performance against potential. A standard talent-review view.'],
    ['Competency', 'A defined skill or behaviour, assessed at a level, which a position requires to a stated standard.'],
    ['Effective dating', 'Recording the date from which something applied, so past records remain correct when circumstances change.'],
    ['Versioning', 'Keeping earlier editions of a form or rule, so that results issued under an earlier edition are never altered.'],
    ['Audit trail', 'A record of who changed what and when, which can be added to but never edited.'],
    ['Row-level security', 'The technical name for the approach in Section 7.2: the access rule sits on each individual record rather than at the door.'],
    ['On-premise', 'Installed on your own server in your own building, rather than accessed over the internet from a supplier.'],
    ['Active Directory', 'The Microsoft service most organisations already use to hold staff accounts and passwords.'],
    ['Recovery point', 'How much work would be lost in a total failure. With nightly backups, up to one day.'],
    ['Recovery time', 'How long it takes to be running again after a failure. Measured by the restore drill rather than assumed.'],
  ],
  [2600, 7480],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Appendix ────────────────────────────────────────────────────── */
children.push(H1('Appendix A — Traceability to your source documents'));

children.push(P(
  'Every requirement in Section 4 derives from one of the sources below. This '
  + 'table shows where each area came from, so that a reviewer can check our '
  + 'reading against the original.',
));

children.push(TBL(
  ['Requirement area', 'Source'],
  [
    ['Evaluation types I to V (4.3)', '5-page outline, section on evaluation types'],
    ['Scoring and point weights (4.2, 4.3)', '5-page outline point tables, and the hcm kpi sheet of the workbook'],
    ['KPI composite 30 / 40 / 30 (4.3.12)', 'Workbook, which supersedes the 5-page outline on the composition of the 40'],
    ['Task nature multipliers (4.2.8)', 'Workbook — the multiplier is the nature of the task, not an arbitrary weight'],
    ['Evaluation workflow steps 1 to 6 (4.3.4 – 4.3.6)', '5-page outline, workflow section'],
    ['Organisation levels (4.1.1)', 'Workbook HCM TO sheet, and the 5-page outline'],
    ['Rank numbering 6 to 11 (4.1.2)', 'Workbook HCM TO sheet'],
    ['Peer review rules and instrument (4.4)', '5-page outline peer review section, 30-point instrument'],
    ['Reporting and dashboards (4.7)', '5-page outline, reporting section'],
    ['Promotion programmes (4.5.7)', '5-page outline, MDP and Back Office tracks'],
    ['Attendance as 30 of 100 (4.3.12)', 'Workbook — boundary with payroll agreed during the build'],
  ],
  [4200, 5880],
));

children.push(SPACER());
children.push(BOX('A note on how we read your documents', [
  'Where your two source documents disagreed, we did not choose silently. Each disagreement became one of the questions in Section 10, and the requirement above is marked as awaiting a decision rather than built to a guess. The alternative — picking the reading that seemed most likely — would have produced a system that computes ratings confidently and possibly wrongly, which is considerably harder to detect than one that says it is waiting.',
], 'EAF0F6', ACCENT));

children.push(new Paragraph({ children: [new PageBreak()] }));

children.push(H1('Appendix B — Document control'));

children.push(TBL(
  ['Version', 'Date', 'Author', 'Change'],
  [
    ['1.0', '28 September 2026', 'Summit Logic Solutions', 'First issue for review.'],
  ],
  [1400, 2600, 3200, 2880],
));

children.push(SPACER());
children.push(SUB('Review and acceptance'));
children.push(P(
  'This document describes the system as built and the requirements it is built '
  + 'against. We ask that HCM review Sections 4 and 6 in particular — the '
  + 'functional requirements and the business rules — and confirm that our '
  + 'reading of your documentation matches your intent. Section 10 lists the '
  + 'points where we have deliberately not formed a reading, and those are the '
  + 'ones we need back in writing.',
));

children.push(SPACER());
children.push(TBL(
  ['', 'Name', 'Signature', 'Date'],
  [
    [['Reviewed by', { bold: true }], '', '', ''],
    [['Approved by', { bold: true }], '', '', ''],
  ],
  [2000, 3200, 2880, 2000],
));
/* ── document ────────────────────────────────────────────────────── */

const doc = new Document({
  creator: 'Summit Logic Solutions',
  title: 'Guanzon Group — Performance and Talent Management System — Business Requirements Document',
  description: 'Business requirements and technical design, for HCM review',
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
            children: [
              'Guanzon Group · Performance and Talent Management System · Business Requirements v1.0 · ',
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
