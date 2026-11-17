/**
 * Republic Act No. 10963 - Tax Reform for Acceleration and Inclusion (TRAIN Law)
 * Revised Withholding Tax Calculator (effective January 1, 2023 onwards).
 *
 * Statutory reference: BIR Revenue Regulations No. 11-2018 / Revised Withholding Tax Table.
 */

export interface TrainTaxResult {
  taxableIncome: number;
  withholdingTax: number;
  bracket: number;
  formula: string;
}

/**
 * Calculates Philippine semi-monthly (quindena) withholding tax.
 *
 * @param taxableIncome Net taxable income for the quindena (Gross Taxable Earnings minus SSS, PHIC, HDMF EE contributions)
 * @param isMinimumWage If true, employee is a statutory Minimum Wage Earner (MWE) exempt from withholding tax
 */
export function calculateSemiMonthlyWithholdingTax(
  taxableIncome: number,
  isMinimumWage = false,
): TrainTaxResult {
  if (isMinimumWage || taxableIncome <= 10416.67) {
    return {
      taxableIncome: Math.max(0, taxableIncome),
      withholdingTax: 0,
      bracket: 1,
      formula: '0.00 (Tax exempt under TRAIN law bracket 1 / MWE)',
    };
  }

  // Bracket 2: Over ₱10,416.67 to ₱16,666.67 -> 15% in excess of ₱10,416.67
  if (taxableIncome <= 16666.67) {
    const excess = taxableIncome - 10416.67;
    const tax = Math.round(excess * 0.15 * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 2,
      formula: '15% over ₱10,416.67',
    };
  }

  // Bracket 3: Over ₱16,666.67 to ₱33,333.33 -> ₱937.50 + 20% in excess of ₱16,666.67
  if (taxableIncome <= 33333.33) {
    const excess = taxableIncome - 16666.67;
    const tax = Math.round((937.50 + excess * 0.20) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 3,
      formula: '₱937.50 + 20% over ₱16,666.67',
    };
  }

  // Bracket 4: Over ₱33,333.33 to ₱83,333.33 -> ₱4,270.83 + 25% in excess of ₱33,333.33
  if (taxableIncome <= 83333.33) {
    const excess = taxableIncome - 33333.33;
    const tax = Math.round((4270.83 + excess * 0.25) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 4,
      formula: '₱4,270.83 + 25% over ₱33,333.33',
    };
  }

  // Bracket 5: Over ₱83,333.33 to ₱333,333.33 -> ₱16,770.83 + 30% in excess of ₱83,333.33
  if (taxableIncome <= 333333.33) {
    const excess = taxableIncome - 83333.33;
    const tax = Math.round((16770.83 + excess * 0.30) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 5,
      formula: '₱16,770.83 + 30% over ₱83,333.33',
    };
  }

  // Bracket 6: Over ₱333,333.33 -> ₱91,770.83 + 35% in excess of ₱333,333.33
  const excess = taxableIncome - 333333.33;
  const tax = Math.round((91770.83 + excess * 0.35) * 100) / 100;
  return {
    taxableIncome,
    withholdingTax: tax,
    bracket: 6,
    formula: '₱91,770.83 + 35% over ₱333,333.33',
  };
}

/**
 * Calculates Philippine monthly withholding tax.
 */
export function calculateMonthlyWithholdingTax(
  taxableIncome: number,
  isMinimumWage = false,
): TrainTaxResult {
  if (isMinimumWage || taxableIncome <= 20833.33) {
    return {
      taxableIncome: Math.max(0, taxableIncome),
      withholdingTax: 0,
      bracket: 1,
      formula: '0.00 (Tax exempt under TRAIN law bracket 1 / MWE)',
    };
  }

  // Bracket 2: ₱20,833.33 to ₱33,333.33 -> 15% in excess of ₱20,833.33
  if (taxableIncome <= 33333.33) {
    const excess = taxableIncome - 20833.33;
    const tax = Math.round(excess * 0.15 * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 2,
      formula: '15% over ₱20,833.33',
    };
  }

  // Bracket 3: ₱33,333.33 to ₱66,666.67 -> ₱1,875.00 + 20% in excess of ₱33,333.33
  if (taxableIncome <= 66666.67) {
    const excess = taxableIncome - 33333.33;
    const tax = Math.round((1875.00 + excess * 0.20) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 3,
      formula: '₱1,875.00 + 20% over ₱33,333.33',
    };
  }

  // Bracket 4: ₱66,666.67 to ₱166,666.67 -> ₱8,541.67 + 25% in excess of ₱66,666.67
  if (taxableIncome <= 166666.67) {
    const excess = taxableIncome - 66666.67;
    const tax = Math.round((8541.67 + excess * 0.25) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 4,
      formula: '₱8,541.67 + 25% over ₱66,666.67',
    };
  }

  // Bracket 5: ₱166,666.67 to ₱666,666.67 -> ₱33,541.67 + 30% in excess of ₱166,666.67
  if (taxableIncome <= 666666.67) {
    const excess = taxableIncome - 166666.67;
    const tax = Math.round((33541.67 + excess * 0.30) * 100) / 100;
    return {
      taxableIncome,
      withholdingTax: tax,
      bracket: 5,
      formula: '₱33,541.67 + 30% over ₱166,666.67',
    };
  }

  // Bracket 6: Over ₱666,666.67 -> ₱183,541.67 + 35% in excess of ₱666,666.67
  const excess = taxableIncome - 666666.67;
  const tax = Math.round((183541.67 + excess * 0.35) * 100) / 100;
  return {
    taxableIncome,
    withholdingTax: tax,
    bracket: 6,
    formula: '₱183,541.67 + 35% over ₱666,666.67',
  };
}

/**
 * Calculates Philippine annual tax liability under the TRAIN Law (RA 10963) graduated table.
 * Used for annual year-end tax adjustments and BIR Form 2316 Certificate generation.
 */
export function calculateAnnualWithholdingTax(
  annualTaxableIncome: number,
  isMinimumWage = false,
): TrainTaxResult {
  if (isMinimumWage || annualTaxableIncome <= 250000) {
    return {
      taxableIncome: Math.max(0, annualTaxableIncome),
      withholdingTax: 0,
      bracket: 1,
      formula: '0.00 (Exempt under ₱250,000 / MWE)',
    };
  }

  // Bracket 2: ₱250,000 to ₱400,000 -> 15% in excess of ₱250,000
  if (annualTaxableIncome <= 400000) {
    const excess = annualTaxableIncome - 250000;
    const tax = Math.round(excess * 0.15 * 100) / 100;
    return {
      taxableIncome: annualTaxableIncome,
      withholdingTax: tax,
      bracket: 2,
      formula: '15% over ₱250,000',
    };
  }

  // Bracket 3: ₱400,000 to ₱800,000 -> ₱22,500 + 20% in excess of ₱400,000
  if (annualTaxableIncome <= 800000) {
    const excess = annualTaxableIncome - 400000;
    const tax = Math.round((22500 + excess * 0.20) * 100) / 100;
    return {
      taxableIncome: annualTaxableIncome,
      withholdingTax: tax,
      bracket: 3,
      formula: '₱22,500 + 20% over ₱400,000',
    };
  }

  // Bracket 4: ₱800,000 to ₱2,000,000 -> ₱102,500 + 25% in excess of ₱800,000
  if (annualTaxableIncome <= 2000000) {
    const excess = annualTaxableIncome - 800000;
    const tax = Math.round((102500 + excess * 0.25) * 100) / 100;
    return {
      taxableIncome: annualTaxableIncome,
      withholdingTax: tax,
      bracket: 4,
      formula: '₱102,500 + 25% over ₱800,000',
    };
  }

  // Bracket 5: ₱2,000,000 to ₱8,000,000 -> ₱402,500 + 30% in excess of ₱2,000,000
  if (annualTaxableIncome <= 8000000) {
    const excess = annualTaxableIncome - 2000000;
    const tax = Math.round((402500 + excess * 0.30) * 100) / 100;
    return {
      taxableIncome: annualTaxableIncome,
      withholdingTax: tax,
      bracket: 5,
      formula: '₱402,500 + 30% over ₱2,000,000',
    };
  }

  // Bracket 6: Over ₱8,000,000 -> ₱2,202,500 + 35% in excess of ₱8,000,000
  const excess = annualTaxableIncome - 8000000;
  const tax = Math.round((2202500 + excess * 0.35) * 100) / 100;
  return {
    taxableIncome: annualTaxableIncome,
    withholdingTax: tax,
    bracket: 6,
    formula: '₱2,202,500 + 35% over ₱8,000,000',
  };
}
