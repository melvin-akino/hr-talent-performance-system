/**
 * Presidential Decree No. 851 & RA 10963 (TRAIN Law).
 * Philippine 13th-Month Pay Accrual and Payout Calculator.
 *
 * Statutory Rule:
 * 13th-Month Pay = Total Basic Salary Earned in Calendar Year / 12
 * Tax Exemption Cap: ₱90,000 (Combined with other bonuses/de minimis excess under NIRC Sec 32)
 */

export interface ThirteenthMonthAccrualResult {
  calendarYear: number;
  totalBasicEarned: number;
  accruedAmount: number;
  paidAmount: number;
  remainingBalance: number;
  taxExemptAmount: number;
  taxableAmount: number;
}

export const THIRTEENTH_MONTH_TAX_EXEMPT_CAP = 90000;

/**
 * Calculates per-payroll-cycle 13th month accrual.
 *
 * @param basicEarnedInCycle Basic salary earned in the current payroll cycle (excluding OT, allowances, etc.)
 */
export function calculateCycleThirteenthMonthAccrual(basicEarnedInCycle: number): number {
  if (basicEarnedInCycle <= 0) return 0;
  return Math.round((basicEarnedInCycle / 12) * 100) / 100;
}

/**
 * Calculates calendar year 13th-month final payout and taxability.
 *
 * @param totalBasicEarned Total basic wages earned during the calendar year
 * @param priorPaidAmount Any advances or mid-year 13th-month payouts already given
 * @param otherBonusesApplied Towards the ₱90,000 statutory tax exemption cap
 */
export function calculateThirteenthMonthPayout(
  totalBasicEarned: number,
  priorPaidAmount = 0,
  otherBonusesApplied = 0,
): ThirteenthMonthAccrualResult {
  const year = new Date().getFullYear();
  const accruedAmount = Math.round((Math.max(0, totalBasicEarned) / 12) * 100) / 100;
  const remainingBalance = Math.max(0, Math.round((accruedAmount - priorPaidAmount) * 100) / 100);

  // Available room under the ₱90,000 cap
  const availableExemptCap = Math.max(0, THIRTEENTH_MONTH_TAX_EXEMPT_CAP - otherBonusesApplied);
  const taxExemptAmount = Math.min(remainingBalance, availableExemptCap);
  const taxableAmount = Math.max(0, Math.round((remainingBalance - taxExemptAmount) * 100) / 100);

  return {
    calendarYear: year,
    totalBasicEarned,
    accruedAmount,
    paidAmount: priorPaidAmount,
    remainingBalance,
    taxExemptAmount,
    taxableAmount,
  };
}
