import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './auth';
import type { GoalPeriod } from './types';

/**
 * The selected goal period, shared across every screen.
 *
 * Almost every query in the app is scoped to a period, and having each page
 * pick its own would let the dashboard and the goal list disagree about which
 * year is being displayed -- a subtle and very confusing bug during a close.
 */
interface PeriodContextValue {
  period: GoalPeriod | null;
  periods: GoalPeriod[];
  setPeriodId: (id: string) => void;
  isLoading: boolean;
}

const Ctx = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [selectedId, setPeriodId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['goal-periods'],
    queryFn: () => api<GoalPeriod[]>('/goal-periods'),
  });

  const value = useMemo<PeriodContextValue>(() => {
    const periods = data ?? [];
    // Default to the newest period that is actually usable; fall back to the
    // newest of any state so a closed-only history still renders.
    const preferred =
      periods.find((p) => p.id === selectedId) ??
      periods.find((p) => p.state === 'open') ??
      periods.find((p) => p.state === 'locked') ??
      periods[0] ??
      null;
    return { period: preferred, periods, setPeriodId, isLoading };
  }, [data, selectedId, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePeriod must be used inside a PeriodProvider');
  return ctx;
}
