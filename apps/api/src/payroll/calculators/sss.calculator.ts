/**
 * Republic Act No. 11199 - Social Security Act of 2018.
 * SSS Contribution Table Calculator (14% contribution rate: 4.5% EE, 9.5% ER).
 * Includes regular SSS MSC (up to ₱20,000), WISP (above ₱20,000 up to ₱35,000),
 * and Employees' Compensation (EC) program.
 */

export interface SssContributionResult {
  monthlySalaryCredit: number; // Regular MSC (max 20,000)
  wispMonthlySalaryCredit: number; // WISP MSC (max 15,000)
  totalMonthlySalaryCredit: number; // Combined MSC (max 35,000)
  regularEe: number;
  regularEr: number;
  regularTotal: number;
  wispEe: number;
  wispEr: number;
  wispTotal: number;
  ecEr: number;
  totalEe: number;
  totalEr: number;
  totalContribution: number;
}

/**
 * Calculates Philippine SSS statutory contribution for a monthly basic salary.
 *
 * @param monthlySalary Employee monthly basic compensation
 */
export function calculateSssContribution(monthlySalary: number): SssContributionResult {
  const salary = Math.max(0, monthlySalary);

  // MSC Bracket calculation in ₱500 increments
  // Floor bracket: below ₱4,250 -> MSC = ₱4,000
  // Ceiling bracket: ₱34,750 and above -> MSC = ₱35,000
  let totalMsc: number;
  if (salary < 4250) {
    totalMsc = 4000;
  } else if (salary >= 34750) {
    totalMsc = 35000;
  } else {
    // Round to nearest 500 bracket:
    // e.g. 4250 - 4749.99 => 4500
    // formula: 4500 + Math.floor((salary - 4250) / 500) * 500
    const step = Math.floor((salary - 4250) / 500);
    totalMsc = 4500 + step * 500;
  }

  // Split between Regular SSS MSC (up to ₱20,000) and WISP (above ₱20,000 up to ₱35,000)
  const regularMsc = Math.min(totalMsc, 20000);
  const wispMsc = Math.max(0, totalMsc - 20000);

  // Regular SSS: 4.5% EE, 9.5% ER
  const regularEe = Math.round(regularMsc * 0.045 * 100) / 100;
  const regularEr = Math.round(regularMsc * 0.095 * 100) / 100;
  const regularTotal = Math.round((regularEe + regularEr) * 100) / 100;

  // WISP: 4.5% EE, 9.5% ER
  const wispEe = Math.round(wispMsc * 0.045 * 100) / 100;
  const wispEr = Math.round(wispMsc * 0.095 * 100) / 100;
  const wispTotal = Math.round((wispEe + wispEr) * 100) / 100;

  // EC (Employees' Compensation) - 100% Employer paid:
  // ₱10 for MSC below ₱15,000; ₱30 for MSC ₱15,000 and above
  const ecEr = totalMsc < 15000 ? 10.0 : 30.0;

  const totalEe = Math.round((regularEe + wispEe) * 100) / 100;
  const totalEr = Math.round((regularEr + wispEr + ecEr) * 100) / 100;
  const totalContribution = Math.round((totalEe + totalEr) * 100) / 100;

  return {
    monthlySalaryCredit: regularMsc,
    wispMonthlySalaryCredit: wispMsc,
    totalMonthlySalaryCredit: totalMsc,
    regularEe,
    regularEr,
    regularTotal,
    wispEe,
    wispEr,
    wispTotal,
    ecEr,
    totalEe,
    totalEr,
    totalContribution,
  };
}

/**
 * Apportions SSS deduction for semi-monthly (quindena) payroll.
 *
 * @param monthlyResult SSS monthly calculation result
 * @param quindena 'first' (1-15), 'second' (16-end), or 'split' (50% each)
 */
export function apportionSssQuindena(
  monthlyResult: SssContributionResult,
  quindena: 'first' | 'second' | 'split' = 'split',
): { ee: number; er: number; ec: number } {
  if (quindena === 'first') {
    return { ee: 0, er: 0, ec: 0 };
  }
  if (quindena === 'second') {
    return {
      ee: monthlyResult.totalEe,
      er: Math.round((monthlyResult.regularEr + monthlyResult.wispEr) * 100) / 100,
      ec: monthlyResult.ecEr,
    };
  }
  // Split 50/50
  return {
    ee: Math.round((monthlyResult.totalEe / 2) * 100) / 100,
    er: Math.round(((monthlyResult.regularEr + monthlyResult.wispEr) / 2) * 100) / 100,
    ec: Math.round((monthlyResult.ecEr / 2) * 100) / 100,
  };
}
