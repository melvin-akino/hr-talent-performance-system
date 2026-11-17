/**
 * Republic Act No. 11223 - Universal Health Care Act.
 * PhilHealth Statutory Premium Calculator (effective 5.0% premium rate: 2.5% EE, 2.5% ER).
 * Monthly income floor: ₱10,000 (₱500 total, ₱250 EE, ₱250 ER)
 * Monthly income ceiling: ₱100,000 (₱5,000 total, ₱2,500 EE, ₱2,500 ER)
 */

export interface PhilHealthResult {
  monthlySalary: number;
  coveredSalary: number; // Clamped between floor and ceiling
  totalPremium: number;
  eeShare: number;
  erShare: number;
}

export const PHILHEALTH_MIN_FLOOR = 10000;
export const PHILHEALTH_MAX_CEILING = 100000;
export const PHILHEALTH_TOTAL_RATE = 0.05;
export const PHILHEALTH_EE_RATE = 0.025;
export const PHILHEALTH_ER_RATE = 0.025;

/**
 * Calculates monthly PhilHealth statutory contribution.
 *
 * @param monthlySalary Employee's monthly basic salary
 */
export function calculatePhilHealthContribution(monthlySalary: number): PhilHealthResult {
  const salary = Math.max(0, monthlySalary);
  const coveredSalary = Math.min(Math.max(salary, PHILHEALTH_MIN_FLOOR), PHILHEALTH_MAX_CEILING);

  const totalPremium = Math.round(coveredSalary * PHILHEALTH_TOTAL_RATE * 100) / 100;
  const eeShare = Math.round(coveredSalary * PHILHEALTH_EE_RATE * 100) / 100;
  // ER share is equal or balance
  const erShare = Math.round((totalPremium - eeShare) * 100) / 100;

  return {
    monthlySalary: salary,
    coveredSalary,
    totalPremium,
    eeShare,
    erShare,
  };
}

/**
 * Apportions PhilHealth deduction for semi-monthly (quindena) payroll.
 */
export function apportionPhilHealthQuindena(
  monthlyResult: PhilHealthResult,
  quindena: 'first' | 'second' | 'split' = 'split',
): { ee: number; er: number } {
  if (quindena === 'first') {
    return { ee: 0, er: 0 };
  }
  if (quindena === 'second') {
    return { ee: monthlyResult.eeShare, er: monthlyResult.erShare };
  }
  return {
    ee: Math.round((monthlyResult.eeShare / 2) * 100) / 100,
    er: Math.round((monthlyResult.erShare / 2) * 100) / 100,
  };
}
