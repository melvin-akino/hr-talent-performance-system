/**
 * Philippine Labor Code Statutory Overtime & Premium Pay Calculator.
 * References:
 * - Presidential Decree No. 442 (Labor Code of the Philippines) Articles 83-94
 * - DOLE Handbook on Workers' Statutory Monetary Benefits
 */

export interface OvertimeCalculationInput {
  hourlyRate: number;
  regularOtHours?: number; // Normal workday in excess of 8 hrs (125%)
  restDayHours?: number; // Rest day or Special Day first 8 hrs (130%)
  restDayOtHours?: number; // Rest day in excess of 8 hrs (169%)
  regularHolidayHours?: number; // Regular holiday first 8 hrs (200%)
  regularHolidayOtHours?: number; // Regular holiday in excess of 8 hrs (260%)
  nightDiffHours?: number; // 10:00 PM to 6:00 AM (10% additional)
  tardinessMinutes?: number; // Late arrival deduction
  undertimeMinutes?: number; // Early departure deduction
}

export interface OvertimeCalculationResult {
  regularOtPay: number;
  restDayPremiumPay: number;
  restDayOtPay: number;
  regularHolidayPay: number;
  regularHolidayOtPay: number;
  nightDiffPay: number;
  totalOvertimeAndPremiumPay: number;
  tardinessDeduction: number;
  undertimeDeduction: number;
  totalAttendanceDeductions: number;
  netAttendanceImpact: number;
}

export const PH_RATES = {
  REGULAR_OT_MULTIPLIER: 1.25, // Art. 87: +25%
  REST_DAY_MULTIPLIER: 1.30, // Art. 93: +30%
  REST_DAY_OT_MULTIPLIER: 1.69, // 130% * 130%
  REGULAR_HOLIDAY_MULTIPLIER: 2.00, // Art. 94: 200%
  REGULAR_HOLIDAY_OT_MULTIPLIER: 2.60, // 200% * 130%
  NIGHT_DIFF_RATE: 0.10, // Art. 86: 10% premium
};

/**
 * Calculates Philippine statutory overtime, premium pay, night differential, and tardiness deductions.
 */
export function calculatePhilippineAttendancePay(
  input: OvertimeCalculationInput,
): OvertimeCalculationResult {
  const rate = Math.max(0, input.hourlyRate);
  const minuteRate = rate / 60;

  // 1. Regular Overtime (125%)
  const regularOtHours = Math.max(0, input.regularOtHours || 0);
  const regularOtPay =
    Math.round(rate * PH_RATES.REGULAR_OT_MULTIPLIER * regularOtHours * 100) / 100;

  // 2. Rest Day / Special Non-Working Day (130% for first 8 hrs)
  const restDayHours = Math.max(0, input.restDayHours || 0);
  const restDayPremiumPay =
    Math.round(rate * (PH_RATES.REST_DAY_MULTIPLIER - 1.0) * restDayHours * 100) / 100;

  // 3. Rest Day Overtime (169%)
  const restDayOtHours = Math.max(0, input.restDayOtHours || 0);
  const restDayOtPay =
    Math.round(rate * PH_RATES.REST_DAY_OT_MULTIPLIER * restDayOtHours * 100) / 100;

  // 4. Regular Holiday Premium (First 8 hrs worked = additional 100% since basic covers 100%)
  const regularHolidayHours = Math.max(0, input.regularHolidayHours || 0);
  const regularHolidayPay =
    Math.round(rate * (PH_RATES.REGULAR_HOLIDAY_MULTIPLIER - 1.0) * regularHolidayHours * 100) / 100;

  // 5. Regular Holiday Overtime (260%)
  const regularHolidayOtHours = Math.max(0, input.regularHolidayOtHours || 0);
  const regularHolidayOtPay =
    Math.round(rate * PH_RATES.REGULAR_HOLIDAY_OT_MULTIPLIER * regularHolidayOtHours * 100) / 100;

  // 6. Night Shift Differential (10% additional)
  const nightDiffHours = Math.max(0, input.nightDiffHours || 0);
  const nightDiffPay =
    Math.round(rate * PH_RATES.NIGHT_DIFF_RATE * nightDiffHours * 100) / 100;

  // Total Additions
  const totalOvertimeAndPremiumPay = Math.round(
    (regularOtPay +
      restDayPremiumPay +
      restDayOtPay +
      regularHolidayPay +
      regularHolidayOtPay +
      nightDiffPay) *
      100,
  ) / 100;

  // 7. Tardiness & Undertime Deductions
  const tardinessMinutes = Math.max(0, input.tardinessMinutes || 0);
  const tardinessDeduction = Math.round(minuteRate * tardinessMinutes * 100) / 100;

  const undertimeMinutes = Math.max(0, input.undertimeMinutes || 0);
  const undertimeDeduction = Math.round(minuteRate * undertimeMinutes * 100) / 100;

  const totalAttendanceDeductions = Math.round(
    (tardinessDeduction + undertimeDeduction) * 100,
  ) / 100;

  const netAttendanceImpact = Math.round(
    (totalOvertimeAndPremiumPay - totalAttendanceDeductions) * 100,
  ) / 100;

  return {
    regularOtPay,
    restDayPremiumPay,
    restDayOtPay,
    regularHolidayPay,
    regularHolidayOtPay,
    nightDiffPay,
    totalOvertimeAndPremiumPay,
    tardinessDeduction,
    undertimeDeduction,
    totalAttendanceDeductions,
    netAttendanceImpact,
  };
}
