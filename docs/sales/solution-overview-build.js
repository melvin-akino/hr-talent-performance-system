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

/* ── Product / Solution Overview (generic, for prospective clients) ──── */

const children = [];

const SUB = (t) => new Paragraph({
  spacing: { before: 200, after: 80 },
  children: [new TextRun({ text: t, size: 20, bold: true, color: ACCENT })],
});

/** Capability row: name + what it does. */
const CAP = (rows) => TBL(['Capability', 'What it does'], rows, [3000, 7080]);

/* ── Cover ───────────────────────────────────────────────────────── */
children.push(new Paragraph({ spacing: { before: 1000, after: 60 },
  children: [new TextRun({ text: 'Summit Logic Solutions', size: 24, color: MUTED })] }));
children.push(new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({
    text: 'Performance and Talent Management System',
    size: 48, bold: true, color: ACCENT,
  })],
}));
children.push(new Paragraph({
  spacing: { after: 360 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: ACCENT, space: 8 } },
  children: [new TextRun({
    text: 'Solution Overview and Technical Summary',
    size: 28, color: MUTED,
  })],
}));

children.push(P(
  'An on-premise performance management system for mid-sized and large '
  + 'organisations: targets and KPIs, evaluations, peer input, competencies, '
  + 'improvement plans and development — installed on your own server, with '
  + 'your data staying inside your own network.',
  { size: 22 },
));

children.push(SPACER());
children.push(TBL(
  ['', ''],
  [
    [['Prepared for', { bold: true }], ' '],
    [['Prepared by', { bold: true }], 'Summit Logic Solutions'],
    [['Document', { bold: true }], 'Solution overview and technical summary, version 1.0'],
    [['Date', { bold: true }], ' '],
  ],
  [2400, 7680],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 1. The problem ──────────────────────────────────────────────── */
children.push(H1('1. The problem this solves'));

children.push(P(
  'Most organisations of 200 people and above run performance management on '
  + 'some combination of a subscription service, spreadsheets and email. That '
  + 'arrangement usually works until one of four things happens.',
));

children.push(TBL(
  ['What goes wrong', 'What it costs'],
  [
    [['Your rules cannot be enforced', { bold: true }],
     'You have a scoring model written down. The tools cannot apply it, so it lives in the heads of whoever is running the cycle — and it is applied slightly differently each round.'],
    [['History is scattered', { bold: true }],
     'A person’s evaluations, improvement plans, promotions and assessments are in different files. When a rating is disputed, assembling the story takes days.'],
    [['Nobody knows where the cycle has reached', { bold: true }],
     'Chasing is done by asking. The answer to "why has this not closed" is an investigation rather than a screen.'],
    [['Your data is somebody else’s asset', { bold: true }],
     'Performance records — among the most sensitive information an employer holds — sit on a platform you do not control, under terms you did not write.'],
  ],
  [3000, 7080],
));

children.push(SPACER());
children.push(P(
  'This system addresses all four. It runs on hardware you own. It enforces '
  + 'your rules rather than reminding people of them. It holds a complete '
  + 'history per person. And it shows the state of any cycle at any moment.',
));

children.push(H2('1.1 Who it suits'));
children.push(BULLET('Organisations of roughly 200 to 1,500 staff, with a structured performance process they already run and want enforced properly.'));
children.push(BULLET('Groups with several companies, divisions or branches that need to be kept separate from one another.'));
children.push(BULLET('Organisations with a policy, regulatory or cultural reason to keep employee data on their own premises.'));
children.push(BULLET('Organisations with a defined scoring model — weighted forms, point allocations, rating bands — that generic tools cannot express.'));

children.push(H2('1.2 Who it does not suit'));
children.push(P(
  'Worth being direct about, because a bad fit costs both sides more than a '
  + 'lost sale.',
));
children.push(BULLET('Organisations wanting a single system for payroll, leave, timekeeping and performance. This does one of those four and integrates with the rest.'));
children.push(BULLET('Organisations with no in-house IT capability at all. An on-premise system needs somebody who patches a server and checks a backup.'));
children.push(BULLET('Organisations under about 100 staff, where the process is informal enough that a spreadsheet is genuinely adequate.'));
children.push(BULLET('Organisations that want a cloud subscription with no server of their own. That is a different product.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 2. The distinguishing design ────────────────────────────────── */
children.push(H1('2. What makes it different'));

children.push(BOX('Access is enforced beneath the software, not inside it', [
  'Almost every business system puts the check at the door. The software works out what you are entitled to see, then shows you that. It is simple and it is standard — and it means that a fault in the software, or somebody reaching the information by another route, removes the protection entirely.',
  'This system puts the rule on each individual record instead. When the software asks for information, it asks as you, and only records you are entitled to come back. There is no route — a screen, a report, a download, or a direct request by the application itself — that returns a record you may not see.',
  'For performance data, where a supervisor in one division must never see another division’s appraisals, this is the difference between a policy and a guarantee.',
], 'EAF0F6', ACCENT));

children.push(SPACER());
children.push(P(
  'Three consequences worth understanding, because they are what a technical '
  + 'evaluator will test:',
));
children.push(RBULLET([['A software fault cannot leak records.', { bold: true }],
  [' The records never leave the store, so there is nothing to leak.', {}]]));
children.push(RBULLET([['Opening a record you may not see returns "not found", not "not allowed".', { bold: true }],
  [' Saying "not allowed" would confirm the record exists, which for an appraisal is itself a disclosure.', {}]]));
children.push(RBULLET([['Replacing the software would not remove the rules.', { bold: true }],
  [' They sit underneath it, in the store, and are enforced against every connection including the application’s own.', {}]]));

children.push(H2('2.1 The other design commitments'));
children.push(TBL(
  ['Commitment', 'What it means for you'],
  [
    [['Nothing is ever deleted', { bold: true }],
     'Somebody leaving closes their record. Their history remains, because other people’s past evaluations refer to them as a reviewer.'],
    [['Everything is dated', { bold: true }],
     'Reporting lines, positions and employment records each apply from a date. An appraisal from three years ago shows the supervisor who held the role then, not the current one.'],
    [['Rules are versioned; results are frozen', { bold: true }],
     'A cycle keeps the form and rules it was issued under. Revising a form next year cannot alter a rating already given.'],
    [['Corrections are distinct from changes', { bold: true }],
     'Fixing something that was always wrong is a different act from recording something that became true on a date. Collapsing the two silently rewrites history.'],
    [['Every change is attributed', { bold: true }],
     'Who did it and when, in a record that can be added to and never edited.'],
    [['Refusals are explained', { bold: true }],
     'When the system declines an action it says why, and where a figure is incomplete it says so rather than showing a misleading total.'],
  ],
  [3000, 7080],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 3. Capabilities ─────────────────────────────────────────────── */
children.push(H1('3. What the system does'));

children.push(P(
  'Everything in this section is built and working today. Section 8 sets out '
  + 'what is on the roadmap and not yet built, separately and explicitly.',
));

children.push(H2('3.1 Organisation and people'));
children.push(CAP([
  ['Group structure', 'Six levels — holdings, group, division, department or area, branch or brand — with each unit knowing what kind of unit it is. Several companies in one installation, with no visibility between them.'],
  ['Rank ladder', 'Your own ranks in your own numbering, linked to positions, and used by rules that depend on seniority.'],
  ['Reporting lines', 'Dated, so history stays correct when people move.'],
  ['Bulk loading', 'Load staff from a spreadsheet, with a preview that reports exactly what it would do and writes nothing until confirmed. Safe to repeat.'],
  ['Employment events', 'Hire, promote, transfer, regularise, separate — each with the date it took effect, including backdated and future-dated entries.'],
  ['Corrections', 'A separate action from a change, so fixing an error does not rewrite past evaluations.'],
]));

children.push(H2('3.2 Targets and KPIs'));
children.push(CAP([
  ['Target setting', 'Measures, baselines, goals and weights, for a defined period.'],
  ['Weight enforcement', 'A person’s weights must total 100%. The period cannot be closed until they do, and the exceptions are listed.'],
  ['KPI library', 'Reusable definitions so targets are written consistently across the organisation.'],
  ['Progress updates', 'Periodic check-ins against each target, with automatic attainment calculation.'],
  ['Approval chain', 'Supervisor approval, with the option of a second approval by HR, switchable per period. Targets can be returned with a reason.'],
  ['Task scorecards', 'Per-role scorecards of task indicators, each with its nature recorded, and periodic evaluation against them.'],
]));

children.push(H2('3.3 Evaluations'));
children.push(CAP([
  ['Evaluation types', 'Probationary, annual, semi-annual, project or term-based, and KPI — expressed as configuration rather than as five separate features, so a sixth costs nothing.'],
  ['Form builder', 'Sections, questions, rating scales, point allocations and weights, built by your HR team without supplier involvement.'],
  ['Point-weighted scoring', 'A score out of 100 calculated from weighted line items, rather than an overall rating typed in by the reviewer. Different point allocations can apply to different staff classifications.'],
  ['Form assignment', 'Different forms for different employment types and positions, resolved automatically when the cycle is created.'],
  ['Approval chain', 'Self, supervisor, department head, moderation, release — with the department head able to approve, revise or return.'],
  ['Completion gate', 'A cycle cannot be finalised while any part of any evaluation is outstanding, and the system names who it is waiting on.'],
  ['Confidentiality', 'An evaluation in progress is invisible to its subject until released, including in exports.'],
  ['Acknowledgement', 'The employee’s receipt of their result is recorded.'],
]));

children.push(H2('3.4 Peer and multi-source input'));
children.push(CAP([
  ['Panel rules', 'Define how a peer panel is drawn — by rank distance and organisational unit — as configuration.'],
  ['Automatic sampling', 'The panel is drawn according to those rules, invitations are issued, and a replacement is drawn when somebody declines.'],
  ['Eligibility', 'Reviewers who have not worked with the subject are filtered out rather than asked.'],
  ['Peer instrument', 'A separate weighted instrument for peer responses.'],
  ['Colleague feedback', 'Requested feedback outside the formal cycle, kept distinct from evaluation.'],
]));

children.push(H2('3.5 Competencies, development and improvement'));
children.push(CAP([
  ['Competency library', 'Versioned, so changing it never alters past assessments.'],
  ['Position requirements', 'The competencies and levels each position requires.'],
  ['Gap analysis', 'Required against assessed, per person and per unit.'],
  ['Development plans', 'Actions, owners and target dates.'],
  ['Career paths', 'Routes between positions with typical durations.'],
  ['Improvement plans', 'Reasons, expected outcomes, milestones and check-ins, with a recorded outcome required before closure and no editing afterwards. Visible only to the employee, their supervisor and HR.'],
]));

children.push(H2('3.6 Reporting and visibility'));
children.push(CAP([
  ['Individual history', 'One view of a person’s evaluations, task results, improvement plans, assessments and employment events, in date order.'],
  ['Search and export', 'Performance history by person, type, period, unit or result, with spreadsheet download. Searches are shareable as a link, and each recipient sees it through their own access.'],
  ['Dashboards by level', 'Employee, supervisor, department head, area or regional head, and HR — one screen each, scoped automatically.'],
  ['Analysis', 'Rating distribution, nine-box grid, and a comparison showing which supervisors rate generously and which strictly.'],
  ['Moderation record', 'What the moderation meeting actually changed, so its effect is visible rather than assumed.'],
  ['Exception lists', 'Missing targets, weights that do not total 100%, targets with no recent update, cycles that cannot close.'],
  ['Requests and approvals', 'A department head can request an extra competency, a one-off evaluation or a score adjustment; the decision and its reason are recorded against the request.'],
]));

children.push(H2('3.7 Communication'));
children.push(CAP([
  ['Notifications', 'More than 20 built-in message types covering assignment, approval, results, acknowledgement and reminders.'],
  ['Deadline reminders', 'An hourly scan against real deadlines, sending once per deadline per person.'],
  ['Delivery', 'Inside the system and by email through your own mail server, so nothing leaves your network.'],
  ['Preferences', 'Each person chooses immediate delivery, a daily summary, or none.'],
  ['Reliability', 'Messages are queued and retried, so a brief mail outage delays rather than loses them.'],
  ['Wording', 'Message text is editable per organisation.'],
]));

children.push(H2('3.8 Administration'));
children.push(CAP([
  ['Self-administration', 'Org structure, ranks, positions, forms, rating scales, roles and help content are all maintained by your HR team.'],
  ['In-system help', 'Opens on the screen the user is looking at, searchable in plain language, with diagrams for the concepts people get stuck on.'],
  ['Your own policy guidance', 'HR can publish company policy inside the system, clearly distinguished from how the software behaves.'],
  ['Readiness check', 'A single command reports what would fail if a department started using the system tomorrow, with a specific remedy for each finding.'],
]));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 4. Deliberate exclusions ────────────────────────────────────── */
children.push(H1('4. What it deliberately does not do'));

children.push(P(
  'These exclusions are design decisions rather than gaps. Each one is stated '
  + 'here because a buyer is entitled to know the boundary before signing, not '
  + 'after.',
));

children.push(TBL(
  ['Excluded', 'Why'],
  [
    [['Payroll', { bold: true }],
     'A different discipline with different regulatory obligations. The system integrates with payroll; it does not replace it.'],
    [['Timekeeping', { bold: true }],
     'Where attendance affects a score, the system receives a count for the period rather than daily records. This keeps it from becoming a timekeeping system by accident.'],
    [['Leave management', { bold: true }],
     'Same reasoning.'],
    [['Recruitment', { bold: true }],
     'Same reasoning.'],
    [['Salary information', { bold: true }],
     'There is no salary field anywhere. A performance system is opened by many supervisors; holding pay data in it widens the consequences of any mistake for no functional benefit.'],
    [['Government identifiers', { bold: true }],
     'No tax, social security or health insurance numbers are stored. The system has no use for them, and their absence materially reduces your exposure under data protection law.'],
    [['File and document storage', { bold: true }],
     'Evidence is referenced by link to wherever your documents already live. This removes file sizing, file backup and malware scanning from the project entirely.'],
  ],
  [2600, 7480],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ══ 5. Technical summary ═══════════════════════════════════════════ */
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
  children: [new TextRun({ text: 'Technical Summary', size: 32, bold: true, color: ACCENT })],
}));
children.push(H1('5. How it is built and run'));

children.push(P(
  'Written to be readable without a technical background. Your IT team will '
  + 'find enough here to form a view; the proper names for each component are '
  + 'in the glossary.',
));

children.push(H2('5.1 Shape'));
children.push(P(
  'One server inside your network. Five components, each doing one job, all of '
  + 'them widely used and openly licensed. Nothing central to the system was '
  + 'invented by us, which matters for your ability to have it maintained by '
  + 'somebody else in future.',
));
children.push(TBL(
  ['Component', 'Role'],
  [
    [['The store', { bold: true }], 'Holds all information, and enforces the access rules described in Section 2.'],
    [['The application', { bold: true }], 'The business logic: approvals, cycle progression, reminders, calculations.'],
    [['The screens', { bold: true }], 'What staff use, in an ordinary web browser. Nothing is installed on their computers.'],
    [['Sign-in', { bold: true }], 'Connects to your existing staff directory.'],
    [['The front door', { bold: true }], 'Encrypts traffic within your network.'],
  ],
  [2400, 7680],
));

children.push(H2('5.2 Sign-in and accounts'));
children.push(P(
  'A standard sign-in component sits between the system and your staff '
  + 'directory. Staff use the username and password they already have; the '
  + 'system never sees a password and stores none. Disabling somebody’s '
  + 'directory account removes their access here without any HR action, which '
  + 'closes the most common gap in leaver processes.',
));
children.push(P(
  'Multi-factor authentication, single sign-on and conditional access are '
  + 'whatever your directory already enforces — the system inherits your '
  + 'policy rather than competing with it.',
));

children.push(H2('5.3 Hosting and capacity'));
children.push(TBL(
  ['Topic', 'Detail'],
  [
    [['Sizing', { bold: true }],
     'For up to approximately 1,000 staff: 8 processor cores, 32 GB memory, 500 GB mirrored storage, on a current Linux server. This is sized for the busiest week of the year rather than an average day.'],
    [['Data volume', { bold: true }],
     'Text and numbers only, with no documents or images. Several years of history for a thousand staff fits comfortably in a few gigabytes.'],
    [['Network', { bold: true }],
     'Runs on your internal network and continues working with your internet connection down. Remote access is normally via your existing VPN.'],
    [['Client devices', { bold: true }],
     'Any modern browser. The screens work on phones and tablets as well as desktops.'],
  ],
  [2200, 7880],
));

children.push(H2('5.4 Installation, updates and recovery'));
children.push(TBL(
  ['Topic', 'How it works'],
  [
    [['Installation', { bold: true }], 'One command on one server.'],
    [['Updates', { bold: true }],
     'Finished packages are prepared elsewhere and handed to the server, which never builds anything and needs no internet access. About one minute of planned downtime, outside working hours.'],
    [['Failed update', { bold: true }],
     'The previous version is still present and restores in seconds. Structural changes to the store move forward only, so the procedure takes a backup immediately beforehand every time.'],
    [['Backups', { bold: true }],
     'Nightly, compressed, encrypted, verified readable, retained 30 days, written away from the server.'],
    [['Recovery testing', { bold: true }],
     'A drill script restores the latest backup into a scratch area, confirms the data arrived, and reports the elapsed time — your real recovery time rather than an assumed one. Recommended monthly.'],
    [['Data loss exposure', { bold: true }],
     'With nightly backups alone, a total failure loses up to one day. Continuous copying reduces this to minutes at the cost of additional storage, and we recommend deciding this explicitly before go-live.'],
  ],
  [2200, 7880],
));

children.push(H2('5.5 Assurance'));
children.push(BULLET('Automated tests run against a real copy of the store rather than a simulation — the only way an access rule can actually be verified. Currently 742 tests of the logic, 138 of the screens, and 14 that drive the system end to end as a user would.'));
children.push(BULLET('Every security test confirms it is not running with administrator privileges before it trusts its own result.'));
children.push(BULLET('Structural changes to the store are fingerprinted, so an edit to an already-applied change stops the next deployment rather than causing silent drift.'));
children.push(BULLET('All queries are constructed so that user input can never be interpreted as an instruction, and would in any case run under an account subject to every record-level rule.'));

children.push(H2('5.6 What the design avoids'));
children.push(P(
  'Each of these is a component we chose not to add, because every additional '
  + 'part is another thing to configure, patch, monitor and recover.',
));
children.push(BULLET('No separate queueing, caching or search components — background work runs inside the store, so there is one thing to back up and one thing that can fail.'));
children.push(BULLET('No file storage, and therefore no file backup, sizing or malware scanning.'));
children.push(BULLET('No dependence on any internet service at run time.'));
children.push(BULLET('No cloud account and no third-party subscription that could stop working.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 6. What the client provides ─────────────────────────────────── */
children.push(H1('6. What you would need to provide'));

children.push(P(
  'On-premise means you own the environment. This is the honest list, and it '
  + 'is worth reviewing with your IT team before proceeding rather than '
  + 'discovering it during implementation.',
));

children.push(TBL(
  ['Item', 'Detail'],
  [
    [['A server', { bold: true }], 'To the specification in Section 5.3, with battery backup and automatic safe shutdown, and mirrored disks.'],
    [['Backup destination', { bold: true }], 'Somewhere off the server for nightly copies to land, and a check that they arrive.'],
    [['Directory access', { bold: true }], 'Roughly half a day with whoever administers your staff directory, to connect sign-in.'],
    [['Mail relay', { bold: true }], 'Permission for the system to send messages through your existing mail server.'],
    [['A named owner', { bold: true }], 'Somebody responsible for patching the server and the supporting components on an agreed schedule, and for responding to alerts.'],
    [['Certificates', { bold: true }], 'A certificate for the internal address, and a calendar reminder before expiry. An expired certificate takes the system down.'],
    [['A current staff file', { bold: true }], 'Covering the pilot population, with work email addresses that match your directory.'],
    [['HR decisions', { bold: true }], 'Your scoring model, forms, bands and rules, confirmed in writing. Where your own documentation can be read two ways, we will ask rather than guess.'],
  ],
  [2400, 7680],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 7. Implementation ───────────────────────────────────────────── */
children.push(H1('7. How an implementation runs'));

children.push(P(
  'Indicative shape. Durations depend on how settled your process is and how '
  + 'quickly decisions can be made — which is usually the constraint, not the '
  + 'build.',
));

children.push(TBL(
  ['Stage', 'What happens', 'Typical driver of delay'],
  [
    [['1. Discovery', { bold: true }],
     'We read your existing performance documentation and map it to the system. Where it can be read two ways, we issue a written question rather than choosing.',
     'Getting written answers to those questions.'],
    [['2. Configuration', { bold: true }],
     'Org structure, ranks, positions, forms, scoring, rating scales and roles are set up. Most of this is configuration, not development.',
     'Availability of the people who own the process.'],
    [['3. Environment', { bold: true }],
     'Server prepared, system installed, sign-in connected to your directory, mail relay configured, backups scheduled.',
     'Directory access and server provisioning.'],
    [['4. Data load', { bold: true }],
     'Staff loaded from your file in preview first, then applied. Mismatches between your directory and your staff file are reported before go-live rather than discovered at it.',
     'Quality of the staff file.'],
    [['5. Pilot', { bold: true }],
     'One department runs a real cycle end to end. This is where process assumptions get tested against reality.',
     'Cycle timing — a pilot needs a real cycle to run against.'],
    [['6. Rollout', { bold: true }],
     'Remaining departments added. A restore is tested on your hardware and the recovery time recorded before go-live.',
     'Nothing, usually. By this point the work is repetition.'],
  ],
  [1800, 5480, 2800],
));

children.push(SPACER());
children.push(BOX('The usual critical path', [
  [['In every implementation of this kind, the schedule is set by ', {}],
   ['how quickly the client can answer questions about their own process', { bold: true }],
   [', not by development. Where a source document contradicts itself — a band that skips a value, a figure that appears differently in two places — we will not pick the likelier reading. Building a guess into everyone’s rating is considerably harder to detect afterwards than a delay.', {}]],
  [['We recommend naming a single decision-maker for these questions at the start. It is the highest-leverage thing a client can do.', {}]],
], 'EAF0F6', ACCENT));

children.push(H2('7.1 Configuration versus development'));
children.push(P(
  'Worth establishing early, because it determines what a change costs you '
  + 'later.',
));
children.push(TBL(
  ['Configured by your HR team', 'Requires development'],
  [
    ['Org structure, units and levels', 'A new kind of calculation, such as a different composite scoring model'],
    ['Ranks, positions and requirements', 'Integration with another system'],
    ['Evaluation forms, sections, questions', 'A new workflow stage that does not exist today'],
    ['Rating scales and point allocations', 'Changes to the access model itself'],
    ['Evaluation types and their rules', ''],
    ['Peer panel rules', ''],
    ['Roles and who holds them', ''],
    ['Message wording and help content', ''],
  ],
  [5040, 5040],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 8. Maturity ─────────────────────────────────────────────────── */
children.push(H1('8. Product maturity — stated plainly'));

children.push(BOX('Read this before deciding', [
  [['This is a young product.', { bold: true }],
   [' It is complete and tested in the areas listed in Section 3, and it is in pilot with its first client. It does not have a decade of production deployments behind it, and a document that implied otherwise would be the wrong basis for a decision.', {}]],
  [['We would rather state this and lose a sale than have it discovered six months in. It also cuts the other way: an early client gets genuine influence over the roadmap, direct access to the people who build it, and a supplier for whom their success is not a rounding error.', {}]],
], 'F4EFE6', WARN));

children.push(H2('8.1 Not yet built'));
children.push(TBL(
  ['Area', 'Status'],
  [
    ['Multi-component composite scoring — combining several weighted sources into one result',
     'Designed, not built. Weighted scoring within a single form is built and working.'],
    ['Incentive and qualification bands applied to a final score',
     'Designed, not built.'],
    ['Evaluations scheduled from each individual’s own dates, such as probation months three and four',
     'Designed, not built. Calendar-based cycles are built and working.'],
    ['Structured promotion programmes with stages and minimum durations',
     'Specified, not started.'],
    ['Attendance figures received from a payroll system',
     'Boundary agreed — a count per period, never daily records. Integration not built.'],
    ['Configurable anonymity for peer responses',
     'Designed, not built. This must be decided before peer review goes live, as it cannot be changed quietly afterwards.'],
    ['A documented, supported interface for other systems to connect to',
     'Not built. Integration today is by spreadsheet or at the database.'],
  ],
  [4200, 5880],
));

children.push(H2('8.2 Assurance not yet obtained'));
children.push(BULLET('No independent penetration test has been carried out. Internal review and automated testing only. We would support and recommend an independent assessment before go-live, commissioned by the client.'));
children.push(BULLET('Sign-in has been proven against a test directory, and has not yet been connected to a production staff directory. Half a day is budgeted for this during implementation.'));
children.push(BULLET('A full restore has been tested on our own infrastructure. A restore on client hardware is treated as a go-live condition rather than an optional step.'));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 9. Commercial ───────────────────────────────────────────────── */
children.push(H1('9. Commercial and contractual notes'));

children.push(P(
  'Pricing is quoted per engagement and is not included here. The points below '
  + 'are the ones prospective clients raise most often, and we prefer to answer '
  + 'them before they are asked.',
));

children.push(TBL(
  ['Question', 'Position'],
  [
    [['Who owns the data?', { bold: true }],
     'You do, unambiguously. It is on your hardware in a standard, widely-used database, in an open format, with no proprietary encoding and nothing reporting back to us.'],
    [['What if you cease trading?', { bold: true }],
     'The technical answer is that your data is yours and readable by any competent team. The commercial answer — source code ownership, escrow, handover terms — belongs in the agreement, and we are willing to discuss all three.'],
    [['Is there a subscription?', { bold: true }],
     'The system does not phone home and does not stop working. Any ongoing arrangement covers support, updates and enhancement, and is a commercial choice rather than a technical dependency.'],
    [['Can we get our data out?', { bold: true }],
     'Spreadsheet export throughout, and direct database access underneath. Exports through the system carry only what the person running them may see.'],
    [['What support is included?', { bold: true }],
     'Quoted per engagement. Patching of the server and its supporting components is normally the client’s responsibility — see Section 6 — and should be agreed explicitly either way.'],
  ],
  [2600, 7480],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── 10. Glossary ────────────────────────────────────────────────── */
children.push(H1('10. Glossary'));

children.push(TBL(
  ['Term', 'Meaning'],
  [
    ['On-premise', 'Installed on your own server in your own building, rather than accessed over the internet from a supplier.'],
    ['Row-level security', 'The technical name for the approach in Section 2 — the access rule sits on each individual record rather than at the door. Provided by PostgreSQL, the database this system uses.'],
    ['PostgreSQL', 'The database the system stores information in. Open, free, and one of the most widely deployed in the world.'],
    ['Active Directory', 'The Microsoft service most organisations already use to hold staff accounts and passwords. The system connects to it for sign-in.'],
    ['Single sign-on', 'Staff use their existing account rather than a separate username and password for this system.'],
    ['Effective dating', 'Recording the date from which something applied, so past records stay correct when circumstances change.'],
    ['Versioning', 'Keeping earlier editions of a form or rule, so results issued under an earlier edition are never altered.'],
    ['Audit trail', 'A record of who changed what and when, which can be added to but never edited.'],
    ['Moderation', 'The meeting where ratings are compared across units so that a rating does not depend on who the supervisor happens to be. Also called calibration.'],
    ['Nine-box', 'A three-by-three grid placing people by performance against potential. A standard talent review view.'],
    ['Recovery point', 'How much work would be lost in a total failure. With nightly backups, up to one day.'],
    ['Recovery time', 'How long until the system is running again after a failure. Measured by a restore drill rather than assumed.'],
    ['Penetration test', 'An independent security firm attempting to break in, to find weaknesses before somebody hostile does.'],
  ],
  [2600, 7480],
));

children.push(new Paragraph({ children: [new PageBreak()] }));

/* ── Appendix ────────────────────────────────────────────────────── */
children.push(H1('Appendix — Capability checklist'));

children.push(P(
  'For completing a requirements matrix or a tender response. '
  + '✓ built and working today. ○ on the roadmap, not yet built. '
  + '— deliberately out of scope.',
));

const CK = (rows) => TBL(['', 'Capability'], rows, [700, 9380]);

children.push(SUB('Organisation and people'));
children.push(CK([
  ['✓', 'Multi-level organisational structure, multiple companies, no cross-visibility'],
  ['✓', 'Rank ladder in the client’s own numbering, linked to positions'],
  ['✓', 'Dated reporting lines and employment history'],
  ['✓', 'Bulk staff import with preview, safe to repeat'],
  ['✓', 'Hire, promote, transfer, regularise, separate — with effective dates, backdated or future'],
  ['✓', 'Corrections handled separately from changes'],
]));

children.push(SUB('Targets, evaluations and scoring'));
children.push(CK([
  ['✓', 'Weighted targets with enforced 100% total, reusable KPI library, progress updates'],
  ['✓', 'Two-stage target approval with optional HR gate, and return-with-reason'],
  ['✓', 'Five evaluation types as configuration'],
  ['✓', 'Form builder with sections, scales, points and weights'],
  ['✓', 'Score out of 100 calculated from weighted line items'],
  ['✓', 'Different point allocations by staff classification'],
  ['✓', 'Self, supervisor, department head, moderation, release'],
  ['✓', 'Completion gate, with the blocking party named'],
  ['✓', 'Evaluation invisible to its subject until released'],
  ['○', 'Composite scoring across several weighted sources'],
  ['○', 'Incentive and qualification bands'],
  ['○', 'Scheduling from each individual’s own dates'],
]));

children.push(SUB('Peer input, competencies and development'));
children.push(CK([
  ['✓', 'Configurable peer panel rules, automatic drawing, eligibility filtering, replacement on decline'],
  ['✓', 'Separate weighted peer instrument'],
  ['✓', 'Versioned competency library, position requirements, gap analysis'],
  ['✓', 'Development plans and career paths'],
  ['✓', 'Improvement plans with milestones, required outcome, restricted visibility'],
  ['○', 'Configurable anonymity for peer responses'],
  ['○', 'Structured promotion programmes with stages and dwell times'],
]));

children.push(SUB('Reporting, communication and administration'));
children.push(CK([
  ['✓', 'Individual history across all sources in one view'],
  ['✓', 'Search and export by person, type, period, unit or result'],
  ['✓', 'Dashboards for every level, scoped automatically'],
  ['✓', 'Rating distribution, nine-box, rater comparison, moderation record'],
  ['✓', 'Exception lists and requests-with-approval'],
  ['✓', 'More than 20 notification types, deadline reminders, per-person preferences, retry on failure'],
  ['✓', 'Full self-administration by HR, in-system help, company policy publishing, readiness check'],
  ['○', 'Documented interface for third-party system integration'],
]));

children.push(SUB('Platform and assurance'));
children.push(CK([
  ['✓', 'On-premise, works with the internet down, no third-party dependency at run time'],
  ['✓', 'Access enforced at record level beneath the application'],
  ['✓', 'Complete audit trail, nothing deleted, versioned rules with frozen results'],
  ['✓', 'Sign-in through the client’s existing staff directory'],
  ['✓', 'Encrypted nightly backups, verified readable, with a restore drill'],
  ['✓', 'Browser-based, mobile-capable, nothing installed on staff computers'],
  ['—', 'Payroll, timekeeping, leave, recruitment'],
  ['—', 'Salary data and government identification numbers'],
  ['—', 'Document and file storage'],
]));
/* ── document ────────────────────────────────────────────────────── */

const doc = new Document({
  creator: 'Summit Logic Solutions',
  title: 'Performance and Talent Management System — Solution Overview',
  description: 'Solution overview and technical summary',
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
              'Summit Logic Solutions · Performance and Talent Management System · ',
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
