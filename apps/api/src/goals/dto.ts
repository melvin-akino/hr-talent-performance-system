import { z } from 'zod';

/**
 * Request contracts. Shared shape definitions so validation lives in one place
 * rather than being re-expressed per controller.
 */

export const measureType = z.enum([
  'numeric', 'percentage', 'currency', 'ratio', 'milestone', 'boolean',
]);
export const direction = z.enum(['higher_is_better', 'lower_is_better']);
export const checkinStatus = z.enum(['on_track', 'at_risk', 'off_track']);

export const createKpiDefinition = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  measureType,
  direction: direction.default('higher_is_better'),
  unit: z.string().trim().optional(),
  defaultWeight: z.number().positive().max(100).optional(),
});

export const createGoalPeriod = z.object({
  name: z.string().trim().min(1),
  periodType: z.enum(['annual', 'semi_annual', 'quarterly', 'custom']),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const goalTargetInput = z.object({
  measureName: z.string().trim().min(1),
  measureType,
  direction: direction.default('higher_is_better'),
  unit: z.string().trim().optional(),
  baselineValue: z.number().optional(),
  targetValue: z.number(),
  stretchValue: z.number().optional(),
});

export const createGoal = z.object({
  goalPeriodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  kpiDefinitionId: z.string().uuid().optional(),
  parentGoalId: z.string().uuid().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  weight: z.number().positive().max(100),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // At least one measure: a KPI goal with nothing to measure is a wish.
  targets: z.array(goalTargetInput).min(1),
});

export const updateGoal = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  weight: z.number().positive().max(100).optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createCheckin = z.object({
  goalTargetId: z.string().uuid().optional(),
  reportedValue: z.number().optional(),
  progressPct: z.number().optional(),
  statusFlag: checkinStatus,
  comment: z.string().trim().max(4000).optional(),
  evidenceUrl: z.string().url().max(2048).optional(),
  periodEnding: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** When present, also updates the target's actual value. */
  updateActual: z.boolean().default(false),
});

export type CreateKpiDefinition = z.infer<typeof createKpiDefinition>;
export type CreateGoalPeriod = z.infer<typeof createGoalPeriod>;
export type CreateGoal = z.infer<typeof createGoal>;
export type UpdateGoal = z.infer<typeof updateGoal>;
export type CreateCheckin = z.infer<typeof createCheckin>;
