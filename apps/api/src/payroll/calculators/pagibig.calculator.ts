/**
 * Home Development Mutual Fund (HDMF / Pag-IBIG Fund).
 * Circular No. 460 (effective February 2024 onwards).
 *
 * Maximum Fund Salary (MFS): ₱10,000
 * Mandatory Contribution:
 * - If basic salary <= ₱1,500: EE 1.0%, ER 2.0%
 * - If basic salary > ₱1,500: EE 2.0% (max ₱200), ER 2.0% (max ₱200)
 */

export interface PagIbigResult {
  monthlySalary: number;
  fundSalary: number; // Clamped at ₱10,000
  eeRate: number;
  erRate: number;
  mandatoryEe: number;
  mandatoryEr: number;
  voluntaryEe: number;
  totalEe: number;
  totalEr: number;
  totalContribution: number;
}

export const PAGIBIG_MAX_FUND_SALARY = 10000;

/**
 * Calculates monthly Pag-IBIG statutory contributions.
 *
 * @param monthlySalary Basic monthly salary
 * @param voluntaryEe Additional voluntary employee contribution (e.g., MP2 or voluntary Pag-IBIG upgrade)
 */
export function calculatePagIbigContribution(
  monthlySalary: number,
  voluntaryEe = 0,
): PagIbigResult {
  const salary = Math.max(0, monthlySalary);
  const fundSalary = Math.min(salary, PAGIBIG_MAX_FUND_SALARY);

  let eeRate = 0.02;
  const erRate = 0.02;

  if (salary <= 1500) {
    eeRate = 0.01;
  }

  const mandatoryEe = Math.round(fundSalary * eeRate * 100) / 100;
  const mandatoryEr = Math.round(fundSalary * erRate * 100) / 100;

  const validVoluntaryEe = Math.max(0, voluntaryEe);
  const totalEe = Math.round((mandatoryEe + validVoluntaryEe) * 100) / 100;
  const totalEr = mandatoryEr;
  const totalContribution = Math.round((totalEe + totalEr) * 100) / 100;

  return {
    monthlySalary: salary,
    fundSalary,
    eeRate,
    erRate,
    mandatoryEe,
    mandatoryEr,
    voluntaryEe: validVoluntaryEe,
    totalEe,
    totalEr,
    totalContribution,
  };
}

/**
 * Apportions Pag-IBIG deduction for semi-monthly (quindena) payroll.
 */
export function apportionPagIbigQuindena(
  monthlyResult: PagIbigResult,
  quindena: 'first' | 'second' | 'split' = 'split',
): { ee: number; er: number } {
  if (quindena === 'first') {
    return { ee: 0, er: 0 };
  }
  if (quindena === 'second') {
    return { ee: monthlyResult.totalEe, er: monthlyResult.totalEr };
  }
  return {
    ee: Math.round((monthlyResult.totalEe / 2) * 100) / 100,
    er: Math.round((monthlyResult.totalEr / 2) * 100) / 100,
  };
}
