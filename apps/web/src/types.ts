/**
 * API response shapes.
 *
 * Numerics arrive as strings, not numbers. PostgreSQL NUMERIC exceeds the
 * precision of a JS double, and `pg` serialises it as text to avoid silent
 * rounding. Parse at the point of display; never store the parsed value back.
 */

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  workEmail: string | null;
  positionTitle: string | null;
  departmentName: string | null;
  /**
   * Role codes the signed-in user holds. Returned by /employees/me only, and
   * used solely to decide which navigation groups to render — never as an
   * authorization check, which is RLS's job on the server.
   */
  roles?: string[];
}

export type GoalState =
  | 'draft' | 'pending_approval' | 'active' | 'achieved' | 'missed' | 'cancelled';

export type CheckinStatus = 'on_track' | 'at_risk' | 'off_track';

export type Direction = 'higher_is_better' | 'lower_is_better';

export type MeasureType =
  | 'numeric' | 'percentage' | 'currency' | 'ratio' | 'milestone' | 'boolean';

export interface GoalTarget {
  id: string;
  sequence: number;
  measureName: string;
  measureType: MeasureType;
  direction: Direction;
  unit: string | null;
  baselineValue: string | null;
  targetValue: string;
  stretchValue: string | null;
  actualValue: string | null;
  actualAsOf: string | null;
  attainmentPct: string | null;
}

export interface Goal {
  id: string;
  goalPeriodId: string;
  employeeId: string;
  employeeName: string;
  title: string;
  description: string | null;
  weight: string;
  dueOn: string | null;
  state: GoalState;
  parentGoalId: string | null;
  kpiDefinitionId: string | null;
  kpiDefinitionVersion: number | null;
  kpiCode: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  attainmentPct: string | null;
  latestStatus: CheckinStatus | null;
  latestCheckinAt: string | null;
  targets?: GoalTarget[];
}

export interface Checkin {
  id: string;
  reportedValue: string | null;
  progressPct: string | null;
  statusFlag: CheckinStatus;
  comment: string | null;
  evidenceUrl: string | null;
  periodEnding: string;
  createdAt: string;
  checkedInBy: string;
}

export interface GoalPeriod {
  id: string;
  name: string;
  periodType: 'annual' | 'semi_annual' | 'quarterly' | 'custom';
  startsOn: string;
  endsOn: string;
  state: 'draft' | 'open' | 'locked' | 'closed';
  lockedAt: string | null;
  closedAt: string | null;
}

export interface KpiDefinition {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string | null;
  category: string | null;
  measureType: MeasureType;
  direction: Direction;
  unit: string | null;
  defaultWeight: string | null;
  isActive: boolean;
  publishedAt: string | null;
}

export interface EmployeeDashboard {
  summary: {
    totalGoals: number;
    draft: number;
    pendingApproval: number;
    active: number;
    totalWeight: string;
    weightedAttainment: string | null;
  };
  needsCheckin: {
    id: string;
    title: string;
    dueOn: string | null;
    lastCheckinOn: string | null;
    daysSinceCheckin: number;
  }[];
}

export interface ManagerDashboard {
  team: {
    employeeId: string;
    employeeName: string;
    goalCount: number;
    totalWeight: string;
    attainment: string | null;
    offTrack: number;
    atRisk: number;
    awaitingApproval: number;
  }[];
  atRisk: {
    id: string;
    title: string;
    employeeName: string;
    status: CheckinStatus;
    comment: string | null;
    asOf: string;
  }[];
  pendingApproval: {
    id: string;
    title: string;
    weight: string;
    employeeName: string;
    submittedAt: string;
  }[];
}

export interface HrDashboard {
  coverage: {
    employeesVisible: number;
    employeesWithGoals: number;
    employeesWithoutGoals: number;
  };
  byState: { state: GoalState; count: number }[];
  byDepartment: {
    department: string;
    employeesWithGoals: number;
    goalCount: number;
    attainment: string | null;
  }[];
  weightIssues: {
    employeeId: string;
    employeeName: string;
    totalWeight: string;
    goalCount: number;
  }[];
}

/* ── task metrics ─────────────────────────────────────────────────────── */

export type TaskNature = 'administrative' | 'field' | 'technical';

export interface TaskIndicator {
  id: string;
  name: string;
  nature: TaskNature;
  description: string | null;
  isActive: boolean;
  defaultPoints: string;
  usedInLines: number;
}

export interface ScorecardSummary {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
  lineCount: number;
  targetPoints: string;
  holders: number;
}

export interface ScorecardLine {
  id: string;
  points: string;
  criteria: string | null;
  sequence: number;
  taskIndicatorId: string;
  indicatorName: string;
  nature: TaskNature;
}

export interface ScorecardDetail {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  departmentName: string | null;
  targetPoints: string;
  items: ScorecardLine[];
  holders: {
    id: string;
    employeeId: string;
    name: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
}

export type EvaluationState = 'draft' | 'submitted' | 'acknowledged';

export interface EvaluationSummary {
  id: string;
  employeeId: string;
  employeeName: string;
  scorecardId: string;
  scorecardName: string;
  state: EvaluationState;
  periodStart: string;
  periodEnd: string;
  targetPoints: string;
  awardedPoints: string | null;
  evaluatorId: string;
  evaluatorName: string;
  submittedAt: string | null;
  lineCount: number;
  unassessed: number;
}

export interface EvaluationLine {
  id: string;
  indicatorName: string;
  criteria: string | null;
  nature: TaskNature;
  pointsAvailable: string;
  pointsAwarded: string | null;
  note: string | null;
  sequence: number;
}

export interface EvaluationDetail {
  id: string;
  employeeId: string;
  employeeName: string;
  scorecardName: string;
  state: EvaluationState;
  periodStart: string;
  periodEnd: string;
  targetPoints: string;
  awardedPoints: string | null;
  note: string | null;
  evaluatorName: string;
  evaluatorId: string;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  lines: EvaluationLine[];
}

export type EvaluationOpenOutcome =
  | 'opened' | 'already_open' | 'no_scorecard' | 'empty_scorecard' | 'not_permitted';

export interface BatchOpenRow {
  employeeId: string;
  employeeName: string;
  scorecardId: string | null;
  evaluationId: string | null;
  outcome: EvaluationOpenOutcome;
}
