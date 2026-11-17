/**
 * Realistic Philippine Enterprise & SME Demo Seed Script
 *
 * Populates tenant "Apex Logistics PH" (APEX) with:
 * - 4 Regional Branches (BGC HQ, Cebu Hub, Davao Terminal, Clark Freeport)
 * - 7 Departments with positions and reporting hierarchy
 * - 20 Diverse Filipino Employees across executive, managerial, engineering, ops, and driver roles
 * - Government ID formats (TIN, SSS, PhilHealth, Pag-IBIG) & Banks (BPI, BDO, Metrobank, UnionBank)
 * - Working Shifts & Philippine Statutory 2026 Holiday Calendar
 * - Daily Time Records (DTR) with Overtime, Night Differential, and Tardiness
 * - Statutory & Discretionary Leave Balances, historical leaves, and pending demo requests
 * - 7 Payroll Runs (6 historical disbursed quindenas + 1 approved active cut-off ready for live demo)
 * - 140 Accurate Philippine Statutory Payslips (TRAIN Tax, SSS + WISP, PhilHealth 5%, Pag-IBIG, 13th-month)
 * - Goal Periods, Enterprise KPI Definitions, and Individual Performance Objectives
 * - Native User Credentials for all demo personas
 */

import { Client } from 'pg';
import { hashPassword } from '../common/crypto';
import {
  calculateSemiMonthlyWithholdingTax,
} from '../payroll/calculators/train-tax.calculator';
import {
  calculateSssContribution,
  apportionSssQuindena,
} from '../payroll/calculators/sss.calculator';
import {
  calculatePhilHealthContribution,
  apportionPhilHealthQuindena,
} from '../payroll/calculators/philhealth.calculator';
import {
  calculatePagIbigContribution,
  apportionPagIbigQuindena,
} from '../payroll/calculators/pagibig.calculator';
import {
  calculateCycleThirteenthMonthAccrual,
} from '../payroll/calculators/thirteenth-month.calculator';

const TARGET_ORG_CODE = 'APEX';
const DEFAULT_PASSWORD = 'ApexDemo2026!';
const ADMIN_PASSWORD = 'ApexAdmin2026!';

interface EmployeeSeedSpec {
  employeeNo: string;
  firstName: string;
  lastName: string;
  email: string;
  gender: 'M' | 'F';
  birthDate: string;
  hiredOn: string;
  deptCode: string;
  positionTitle: string;
  jobLevel: string;
  branchCode: string;
  managerEmpNo?: string;
  roleCode?: string;
  monthlyRate: number;
  isMinimumWage?: boolean;
  tin: string;
  sssNo: string;
  philhealthNo: string;
  pagibigNo: string;
  bankName: string;
  bankAccountNo: string;
  riceSubsidy?: number;
  clothingAllowance?: number;
  laundryAllowance?: number;
  medicalAllowance?: number;
  taxableAllowance?: number;
}

const EMPLOYEES: EmployeeSeedSpec[] = [
  {
    employeeNo: 'EMP-0001',
    firstName: 'Maria',
    lastName: 'Santos',
    email: 'admin@apexlogistics.ph',
    gender: 'F',
    birthDate: '1988-06-14',
    hiredOn: '2022-01-15',
    deptCode: 'HR',
    positionTitle: 'Human Resources Director',
    jobLevel: 'Director (Level 5)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0002',
    roleCode: 'hr_admin',
    monthlyRate: 88000,
    tin: '198-234-567-000',
    sssNo: '34-2918274-1',
    philhealthNo: '12-984719284-1',
    pagibigNo: '1284-9182-4712',
    bankName: 'BPI',
    bankAccountNo: '0012-9481-22',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 5000,
  },
  {
    employeeNo: 'EMP-0002',
    firstName: 'Eduardo',
    lastName: 'Mendoza',
    email: 'eduardo.mendoza@apexlogistics.ph',
    gender: 'M',
    birthDate: '1979-11-20',
    hiredOn: '2021-03-01',
    deptCode: 'EXEC',
    positionTitle: 'Managing Director & CEO',
    jobLevel: 'Executive (Level 6)',
    branchCode: 'BGC-HQ',
    monthlyRate: 185000,
    tin: '112-998-345-000',
    sssNo: '03-8827361-9',
    philhealthNo: '08-112948172-5',
    pagibigNo: '1192-3847-1928',
    bankName: 'BDO',
    bankAccountNo: '0048-2819-3829',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 10000,
  },
  {
    employeeNo: 'EMP-0003',
    firstName: 'Ramon',
    lastName: 'Bautista',
    email: 'ramon.bautista@apexlogistics.ph',
    gender: 'M',
    birthDate: '1982-04-12',
    hiredOn: '2021-06-15',
    deptCode: 'OPS',
    positionTitle: 'Vice President of Fleet & Operations',
    jobLevel: 'VP (Level 5)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0002',
    roleCode: 'manager',
    monthlyRate: 120000,
    tin: '204-819-283-000',
    sssNo: '33-9182746-2',
    philhealthNo: '14-827391824-3',
    pagibigNo: '1092-8374-9182',
    bankName: 'BPI',
    bankAccountNo: '0029-4829-19',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 6000,
  },
  {
    employeeNo: 'EMP-0004',
    firstName: 'Patricia',
    lastName: 'Tan',
    email: 'patricia.tan@apexlogistics.ph',
    gender: 'F',
    birthDate: '1985-08-25',
    hiredOn: '2021-08-01',
    deptCode: 'FIN',
    positionTitle: 'Chief Financial Officer',
    jobLevel: 'VP (Level 5)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0002',
    monthlyRate: 135000,
    tin: '219-384-918-000',
    sssNo: '34-8192736-5',
    philhealthNo: '19-283746192-8',
    pagibigNo: '1928-3746-1928',
    bankName: 'Metrobank',
    bankAccountNo: '0928-1928-38',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 6000,
  },
  {
    employeeNo: 'EMP-0005',
    firstName: 'Danilo',
    lastName: 'Reyes',
    email: 'danilo.reyes@apexlogistics.ph',
    gender: 'M',
    birthDate: '1987-03-09',
    hiredOn: '2022-02-01',
    deptCode: 'TECH',
    positionTitle: 'IT & Infrastructure Lead',
    jobLevel: 'Manager (Level 4)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0002',
    monthlyRate: 95000,
    tin: '281-928-374-000',
    sssNo: '34-1029384-7',
    philhealthNo: '11-827364519-2',
    pagibigNo: '1293-8471-9283',
    bankName: 'UnionBank',
    bankAccountNo: '1092-8374-8192',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 4000,
  },
  {
    employeeNo: 'EMP-0006',
    firstName: 'Beatrice',
    lastName: 'Dela Cruz',
    email: 'bea.delacruz@apexlogistics.ph',
    gender: 'F',
    birthDate: '1993-09-17',
    hiredOn: '2022-04-15',
    deptCode: 'HR',
    positionTitle: 'Senior HR & Payroll Specialist',
    jobLevel: 'Senior Specialist (Level 3)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0001',
    monthlyRate: 46000,
    tin: '293-847-192-000',
    sssNo: '34-9182736-4',
    philhealthNo: '15-928374619-4',
    pagibigNo: '1294-8172-9384',
    bankName: 'BPI',
    bankAccountNo: '0039-4819-28',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 2000,
  },
  {
    employeeNo: 'EMP-0007',
    firstName: 'Paolo',
    lastName: 'Reyes',
    email: 'paolo.reyes@apexlogistics.ph',
    gender: 'M',
    birthDate: '1992-12-05',
    hiredOn: '2022-07-01',
    deptCode: 'TECH',
    positionTitle: 'Senior Systems & Cloud Engineer',
    jobLevel: 'Senior Specialist (Level 3)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0005',
    monthlyRate: 78000,
    tin: '304-918-273-000',
    sssNo: '34-2918374-8',
    philhealthNo: '16-293847192-5',
    pagibigNo: '1394-8192-8374',
    bankName: 'BPI',
    bankAccountNo: '0049-5829-18',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 3000,
  },
  {
    employeeNo: 'EMP-0008',
    firstName: 'Maria Theresa',
    lastName: 'Gomez',
    email: 'tess.gomez@apexlogistics.ph',
    gender: 'F',
    birthDate: '1990-05-18',
    hiredOn: '2022-03-01',
    deptCode: 'FIN',
    positionTitle: 'Accounting & Tax Manager',
    jobLevel: 'Manager (Level 4)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0004',
    monthlyRate: 68000,
    tin: '319-283-746-000',
    sssNo: '34-1928374-9',
    philhealthNo: '17-384918273-6',
    pagibigNo: '1492-8374-1928',
    bankName: 'Metrobank',
    bankAccountNo: '0938-2918-47',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 2500,
  },
  {
    employeeNo: 'EMP-0009',
    firstName: 'Gabriel',
    lastName: 'Aquino',
    email: 'gabriel.aquino@apexlogistics.ph',
    gender: 'M',
    birthDate: '1986-10-30',
    hiredOn: '2022-05-01',
    deptCode: 'OPS',
    positionTitle: 'Dispatch & Fleet Operations Manager',
    jobLevel: 'Manager (Level 4)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0003',
    monthlyRate: 65000,
    tin: '328-192-837-000',
    sssNo: '34-9283746-1',
    philhealthNo: '18-492837192-7',
    pagibigNo: '1592-8374-2918',
    bankName: 'BDO',
    bankAccountNo: '0059-2819-4829',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 3500,
  },
  {
    employeeNo: 'EMP-0010',
    firstName: 'Angela',
    lastName: 'Soriano',
    email: 'angela.soriano@apexlogistics.ph',
    gender: 'F',
    birthDate: '1989-07-22',
    hiredOn: '2022-09-01',
    deptCode: 'SALES',
    positionTitle: 'Enterprise Accounts Director',
    jobLevel: 'Director (Level 5)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0002',
    monthlyRate: 85000,
    tin: '339-482-918-000',
    sssNo: '34-8273645-3',
    philhealthNo: '19-582938471-8',
    pagibigNo: '1692-8374-3829',
    bankName: 'BPI',
    bankAccountNo: '0058-2918-47',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 5000,
  },
  {
    employeeNo: 'EMP-0011',
    firstName: 'Joshua',
    lastName: 'Lim',
    email: 'joshua.lim@apexlogistics.ph',
    gender: 'M',
    birthDate: '1991-01-14',
    hiredOn: '2023-01-10',
    deptCode: 'WHSE',
    positionTitle: 'Warehouse Operations Supervisor',
    jobLevel: 'Supervisor (Level 3)',
    branchCode: 'CLK-HUB',
    managerEmpNo: 'EMP-0003',
    monthlyRate: 48000,
    tin: '348-192-837-000',
    sssNo: '34-7162534-9',
    philhealthNo: '20-693847192-9',
    pagibigNo: '1792-8374-4728',
    bankName: 'BDO',
    bankAccountNo: '0069-3829-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 2000,
  },
  {
    employeeNo: 'EMP-0012',
    firstName: 'Kristine Joy',
    lastName: 'Villanueva',
    email: 'kj.villanueva@apexlogistics.ph',
    gender: 'F',
    birthDate: '1995-11-03',
    hiredOn: '2023-03-01',
    deptCode: 'OPS',
    positionTitle: 'Logistics Control Coordinator',
    jobLevel: 'Specialist (Level 2)',
    branchCode: 'CEB-HUB',
    managerEmpNo: 'EMP-0009',
    monthlyRate: 35000,
    tin: '359-283-746-000',
    sssNo: '34-6253412-8',
    philhealthNo: '21-792837461-0',
    pagibigNo: '1892-8374-5829',
    bankName: 'UnionBank',
    bankAccountNo: '1102-9384-7192',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 1500,
  },
  {
    employeeNo: 'EMP-0013',
    firstName: 'Rafael',
    lastName: 'Mercado',
    email: 'rafael.mercado@apexlogistics.ph',
    gender: 'M',
    birthDate: '1994-04-19',
    hiredOn: '2023-04-01',
    deptCode: 'SALES',
    positionTitle: 'Enterprise Account Executive',
    jobLevel: 'Specialist (Level 2)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0010',
    monthlyRate: 38000,
    tin: '368-291-847-000',
    sssNo: '34-5341298-7',
    philhealthNo: '22-893847192-1',
    pagibigNo: '1992-8374-6928',
    bankName: 'BPI',
    bankAccountNo: '0068-3928-19',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 2500,
  },
  {
    employeeNo: 'EMP-0014',
    firstName: 'Carmela',
    lastName: 'Dizon',
    email: 'carmela.dizon@apexlogistics.ph',
    gender: 'F',
    birthDate: '1996-08-11',
    hiredOn: '2023-06-01',
    deptCode: 'FIN',
    positionTitle: 'Billing & AR Specialist',
    jobLevel: 'Associate (Level 2)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0008',
    monthlyRate: 32000,
    tin: '379-384-918-000',
    sssNo: '34-4231987-6',
    philhealthNo: '23-984719283-2',
    pagibigNo: '2092-8374-7829',
    bankName: 'Metrobank',
    bankAccountNo: '0948-3928-58',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 1000,
  },
  {
    employeeNo: 'EMP-0015',
    firstName: 'Mark Anthony',
    lastName: 'Castro',
    email: 'mark.castro@apexlogistics.ph',
    gender: 'M',
    birthDate: '1993-02-28',
    hiredOn: '2023-08-15',
    deptCode: 'TECH',
    positionTitle: 'IT Helpdesk & Networks Specialist',
    jobLevel: 'Specialist (Level 2)',
    branchCode: 'DVO-HUB',
    managerEmpNo: 'EMP-0005',
    monthlyRate: 42000,
    tin: '389-482-719-000',
    sssNo: '34-3129876-5',
    philhealthNo: '24-093847192-3',
    pagibigNo: '2192-8374-8928',
    bankName: 'UnionBank',
    bankAccountNo: '1112-8374-9182',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 1500,
  },
  {
    employeeNo: 'EMP-0016',
    firstName: 'Jun-Jun',
    lastName: 'Alcantara',
    email: 'junjun.alcantara@apexlogistics.ph',
    gender: 'M',
    birthDate: '1984-05-15',
    hiredOn: '2022-06-01',
    deptCode: 'OPS',
    positionTitle: 'Heavy Long-Haul Trailer Driver',
    jobLevel: 'Operator (Level 1)',
    branchCode: 'CLK-HUB',
    managerEmpNo: 'EMP-0009',
    monthlyRate: 26500,
    tin: '399-582-918-000',
    sssNo: '34-2987654-4',
    philhealthNo: '25-192837461-4',
    pagibigNo: '2292-8374-9829',
    bankName: 'BDO',
    bankAccountNo: '0078-4928-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 1000,
  },
  {
    employeeNo: 'EMP-0017',
    firstName: 'Rommel',
    lastName: 'Tolentino',
    email: 'rommel.tolentino@apexlogistics.ph',
    gender: 'M',
    birthDate: '1989-12-19',
    hiredOn: '2023-02-15',
    deptCode: 'OPS',
    positionTitle: 'Metro Delivery Van Driver',
    jobLevel: 'Operator (Level 1)',
    branchCode: 'BGC-HQ',
    managerEmpNo: 'EMP-0009',
    monthlyRate: 23500,
    tin: '409-682-918-000',
    sssNo: '34-1876543-3',
    philhealthNo: '26-293847192-5',
    pagibigNo: '2392-8374-0928',
    bankName: 'BDO',
    bankAccountNo: '0089-5829-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
    taxableAllowance: 1000,
  },
  {
    employeeNo: 'EMP-0018',
    firstName: 'Arnel',
    lastName: 'Magat',
    email: 'arnel.magat@apexlogistics.ph',
    gender: 'M',
    birthDate: '1992-07-04',
    hiredOn: '2023-05-01',
    deptCode: 'WHSE',
    positionTitle: 'Forklift & Stacker Operator',
    jobLevel: 'Operator (Level 1)',
    branchCode: 'CLK-HUB',
    managerEmpNo: 'EMP-0011',
    monthlyRate: 21000,
    tin: '419-782-918-000',
    sssNo: '34-0765432-2',
    philhealthNo: '27-394817293-6',
    pagibigNo: '2492-8374-1928',
    bankName: 'BDO',
    bankAccountNo: '0098-6829-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
  },
  {
    employeeNo: 'EMP-0019',
    firstName: 'Maricel',
    lastName: 'Pascual',
    email: 'maricel.pascual@apexlogistics.ph',
    gender: 'F',
    birthDate: '1997-03-21',
    hiredOn: '2023-09-01',
    deptCode: 'WHSE',
    positionTitle: 'Cargo Sorter & Scanner',
    jobLevel: 'Operator (Level 1)',
    branchCode: 'CEB-HUB',
    managerEmpNo: 'EMP-0011',
    monthlyRate: 19000,
    tin: '429-882-918-000',
    sssNo: '34-9654321-1',
    philhealthNo: '28-493817294-7',
    pagibigNo: '2592-8374-2918',
    bankName: 'BDO',
    bankAccountNo: '0108-7829-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
  },
  {
    employeeNo: 'EMP-0020',
    firstName: 'Noel',
    lastName: 'Bautista',
    email: 'noel.bautista@apexlogistics.ph',
    gender: 'M',
    birthDate: '1998-10-14',
    hiredOn: '2024-01-15',
    deptCode: 'WHSE',
    positionTitle: 'Warehouse Loader & Handler',
    jobLevel: 'Entry (Level 1)',
    branchCode: 'DVO-HUB',
    managerEmpNo: 'EMP-0011',
    monthlyRate: 18200,
    isMinimumWage: true, // RA 10963 Statutory Minimum Wage Earner Exemption
    tin: '439-982-918-000',
    sssNo: '34-8543210-0',
    philhealthNo: '29-593817295-8',
    pagibigNo: '2692-8374-3918',
    bankName: 'BDO',
    bankAccountNo: '0118-8829-1928',
    riceSubsidy: 2000,
    clothingAllowance: 500,
    laundryAllowance: 300,
    medicalAllowance: 833,
  },
];

async function main() {
  const connString =
    process.env.ADMIN_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://hr_migrator:devmigrator@127.0.0.1:15432/hr';

  console.log(`\n================================================================`);
  console.log(`Philippine Enterprise Demo Simulator & Seeder`);
  console.log(`Connecting to: ${connString.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`================================================================\n`);

  const client = new Client({ connectionString: connString });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Locate Target Organization
    let orgRes = await client.query(
      `SELECT id, code, name, slug FROM organization WHERE code = $1`,
      [TARGET_ORG_CODE],
    );

    if (orgRes.rows.length === 0) {
      orgRes = await client.query(
        `INSERT INTO organization (code, name, slug, status, plan_tier, max_employees)
         VALUES ($1, 'Apex Logistics PH', 'apex', 'active', 'enterprise', 100)
         RETURNING id, code, name, slug`,
        [TARGET_ORG_CODE],
      );
      console.log(`✓ Created new organization: Apex Logistics PH`);
    }

    const orgId = orgRes.rows[0].id;
    console.log(`✓ Located target organization: ${orgRes.rows[0].name} (${orgId})`);

    // Set RLS local context to bypass restrictions
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    await client.query(`SELECT set_config('app.is_superadmin', 'true', true)`);

    // 2. Enable All Modular Licenses in app.tenant_features
    await client.query(
      `INSERT INTO app.tenant_features (
         org_id, feature_core_hr, feature_performance, feature_kpis,
         feature_peer_reviews, feature_competencies_pip,
         feature_leave_management, feature_time_attendance,
         feature_ph_payroll, feature_bank_disbursement, feature_bir_statutory_gen,
         updated_by
       ) VALUES ($1, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, 'demo-seeder')
       ON CONFLICT (org_id) DO UPDATE SET
         feature_core_hr = TRUE,
         feature_performance = TRUE,
         feature_kpis = TRUE,
         feature_peer_reviews = TRUE,
         feature_competencies_pip = TRUE,
         feature_leave_management = TRUE,
         feature_time_attendance = TRUE,
         feature_ph_payroll = TRUE,
         feature_bank_disbursement = TRUE,
         feature_bir_statutory_gen = TRUE,
         updated_at = now()`,
      [orgId],
    );
    console.log(`✓ Enabled 100% of SaaS modules for ${TARGET_ORG_CODE}`);

    // 3. Seed Regional Branches
    const branches = [
      {
        code: 'BGC-HQ',
        name: 'Bonifacio Global City Headquarters',
        region: 'NCR',
        address: '28th Floor, High Street South Corporate Plaza, BGC, Taguig City',
        birRdo: '044',
        sssCode: '03-TAGUIG',
        philhealthCode: 'PH-TAGUIG-01',
        pagibigCode: 'HDMF-BGC-01',
        isHeadOffice: true,
      },
      {
        code: 'CEB-HUB',
        name: 'Cebu Regional Distribution Hub',
        region: 'Region VII (Central Visayas)',
        address: 'Warehouse Complex 4, Mandaue City, Cebu',
        birRdo: '080',
        sssCode: '07-MANDAUE',
        philhealthCode: 'PH-CEBU-02',
        pagibigCode: 'HDMF-CEB-01',
        isHeadOffice: false,
      },
      {
        code: 'DVO-HUB',
        name: 'Davao Sasa Port Terminal',
        region: 'Region XI (Davao Region)',
        address: 'Sasa Port Logistics Zone, Davao City',
        birRdo: '113',
        sssCode: '11-DAVAO',
        philhealthCode: 'PH-DVO-01',
        pagibigCode: 'HDMF-DVO-01',
        isHeadOffice: false,
      },
      {
        code: 'CLK-HUB',
        name: 'Clark Gateway Logistics Center',
        region: 'Region III (Central Luzon)',
        address: 'Bldg 3, Civil Aviation Complex, Clark Freeport Zone, Pampanga',
        birRdo: '021',
        sssCode: '03-CLARK',
        philhealthCode: 'PH-PAM-01',
        pagibigCode: 'HDMF-CLK-01',
        isHeadOffice: false,
      },
    ];

    const branchMap = new Map<string, string>();
    for (const b of branches) {
      const bRes = await client.query(
        `INSERT INTO branch (
           org_id, code, name, region, address, bir_rdo_code, sss_branch_code,
           philhealth_employer_no, pagibig_employer_no, is_head_office
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (org_id, code) DO UPDATE SET
           name = EXCLUDED.name,
           region = EXCLUDED.region,
           address = EXCLUDED.address,
           is_head_office = EXCLUDED.is_head_office
         RETURNING id`,
        [
          orgId,
          b.code,
          b.name,
          b.region,
          b.address,
          b.birRdo,
          b.sssCode,
          b.philhealthCode,
          b.pagibigCode,
          b.isHeadOffice,
        ],
      );
      branchMap.set(b.code, bRes.rows[0].id);
    }
    console.log(`✓ Provisioned 4 regional branches (BGC HQ, Cebu, Davao, Clark)`);

    // 4. Seed Departments
    const departments = [
      { code: 'EXEC', name: 'Executive Leadership' },
      { code: 'HR', name: 'People Operations & Culture' },
      { code: 'FIN', name: 'Finance & Treasury' },
      { code: 'OPS', name: 'Fleet & Logistics Operations' },
      { code: 'TECH', name: 'Technology & Cloud Infrastructure' },
      { code: 'WHSE', name: 'Warehousing & Fulfillment' },
      { code: 'SALES', name: 'Enterprise Accounts & Sales' },
    ];

    const deptMap = new Map<string, string>();
    for (const d of departments) {
      const dRes = await client.query(
        `INSERT INTO department (org_id, code, name, effective_from)
         VALUES ($1, $2, $3, '2021-01-01')
         ON CONFLICT (org_id, code, effective_from) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, d.code, d.name],
      );
      deptMap.set(d.code, dRes.rows[0].id);
    }
    console.log(`✓ Provisioned 7 enterprise departments`);

    // 5. Employment Types
    const empTypeRes = await client.query(
      `INSERT INTO employment_type (org_id, code, name)
       VALUES ($1, 'REG', 'Regular Full-Time')
       ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [orgId],
    );
    const regEmpTypeId = empTypeRes.rows[0].id;

    // 6. Seed Roles & Retrieve IDs
    await client.query('SELECT app.seed_baseline_roles($1)', [orgId]);
    const rolesRes = await client.query(`SELECT id, code FROM app_role WHERE org_id = $1`, [orgId]);
    const roleMap = new Map<string, string>();
    for (const r of rolesRes.rows) roleMap.set(r.code, r.id);

    // 7. Seed Employees, Positions, Employments & Compensation
    const empIdMap = new Map<string, string>();

    for (const spec of EMPLOYEES) {
      // Upsert Position
      const deptId = deptMap.get(spec.deptCode)!;
      const posRes = await client.query(
        `INSERT INTO position (org_id, department_id, title, job_level)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, title, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET job_level = EXCLUDED.job_level
         RETURNING id`,
        [orgId, deptId, spec.positionTitle, spec.jobLevel],
      );
      const posId = posRes.rows[0].id;

      // Upsert Employee
      const empRes = await client.query(
        `INSERT INTO employee (
           org_id, employee_no, first_name, last_name, work_email, hired_on, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'active')
         ON CONFLICT (org_id, employee_no) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           work_email = EXCLUDED.work_email,
           hired_on = EXCLUDED.hired_on,
           status = 'active'
         RETURNING id`,
        [
          orgId,
          spec.employeeNo,
          spec.firstName,
          spec.lastName,
          spec.email.toLowerCase(),
          spec.hiredOn,
        ],
      );
      const empId = empRes.rows[0].id;
      empIdMap.set(spec.employeeNo, empId);

      // Employment Placement
      await client.query(
        `INSERT INTO employment (
           org_id, employee_id, position_id, department_id, employment_type_id,
           status, effective_from
         ) VALUES ($1, $2, $3, $4, $5, 'regular', $6)
         ON CONFLICT DO NOTHING`,
        [orgId, empId, posId, deptId, regEmpTypeId, spec.hiredOn],
      );

      // User Credentials
      const userPass = spec.employeeNo === 'EMP-0001' ? ADMIN_PASSWORD : DEFAULT_PASSWORD;
      const passHash = hashPassword(userPass);
      await client.query(
        `INSERT INTO app.user_credential (
           employee_id, org_id, email, password_hash, is_verified, must_change_password
         ) VALUES ($1, $2, $3, $4, TRUE, FALSE)
         ON CONFLICT (employee_id) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           email = EXCLUDED.email`,
        [empId, orgId, spec.email.toLowerCase(), passHash],
      );

      // Compensation Profile
      const branchId = branchMap.get(spec.branchCode)!;
      const dailyRate = Math.round((spec.monthlyRate * 12) / 261 * 100) / 100; // 261 days factor (DOLE)
      const hourlyRate = Math.round((dailyRate / 8) * 100) / 100;

      await client.query(
        `INSERT INTO employee_compensation (
           employee_id, org_id, branch_id, monthly_rate, daily_rate, hourly_rate,
           pay_type, pay_frequency, is_minimum_wage, tin, sss_no, philhealth_no,
           pagibig_no, bank_name, bank_account_no, bank_account_name,
           rice_subsidy, clothing_allowance, laundry_allowance, medical_allowance,
           taxable_allowance
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'monthly', 'semi_monthly', $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19
         ) ON CONFLICT (employee_id) DO UPDATE SET
           branch_id = EXCLUDED.branch_id,
           monthly_rate = EXCLUDED.monthly_rate,
           daily_rate = EXCLUDED.daily_rate,
           hourly_rate = EXCLUDED.hourly_rate,
           is_minimum_wage = EXCLUDED.is_minimum_wage,
           tin = EXCLUDED.tin,
           sss_no = EXCLUDED.sss_no,
           philhealth_no = EXCLUDED.philhealth_no,
           pagibig_no = EXCLUDED.pagibig_no,
           bank_name = EXCLUDED.bank_name,
           bank_account_no = EXCLUDED.bank_account_no,
           bank_account_name = EXCLUDED.bank_account_name,
           rice_subsidy = EXCLUDED.rice_subsidy,
           clothing_allowance = EXCLUDED.clothing_allowance,
           laundry_allowance = EXCLUDED.laundry_allowance,
           medical_allowance = EXCLUDED.medical_allowance,
           taxable_allowance = EXCLUDED.taxable_allowance`,
        [
          empId,
          orgId,
          branchId,
          spec.monthlyRate,
          dailyRate,
          hourlyRate,
          spec.isMinimumWage ?? false,
          spec.tin,
          spec.sssNo,
          spec.philhealthNo,
          spec.pagibigNo,
          spec.bankName,
          spec.bankAccountNo,
          `${spec.firstName} ${spec.lastName}`,
          spec.riceSubsidy ?? 0,
          spec.clothingAllowance ?? 0,
          spec.laundryAllowance ?? 0,
          spec.medicalAllowance ?? 0,
          spec.taxableAllowance ?? 0,
        ],
      );

      // Role Assignment
      const roleCode = spec.roleCode || 'employee';
      const roleId = roleMap.get(roleCode);
      if (roleId) {
        await client.query(
          `INSERT INTO role_assignment (org_id, employee_id, role_id, effective_from)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [orgId, empId, roleId, spec.hiredOn],
        );
      }
    }
    console.log(`✓ Provisioned 20 Filipino Employees with complete compensation & credentials`);

    // 8. Reporting Lines (Manager Hierarchy)
    for (const spec of EMPLOYEES) {
      if (spec.managerEmpNo) {
        const empId = empIdMap.get(spec.employeeNo)!;
        const mgrId = empIdMap.get(spec.managerEmpNo)!;
        await client.query(
          `INSERT INTO reporting_line (
             org_id, employee_id, supervisor_employee_id, line_type, effective_from
           ) VALUES ($1, $2, $3, 'primary', $4)
           ON CONFLICT DO NOTHING`,
          [orgId, empId, mgrId, spec.hiredOn],
        );
      }
    }
    console.log(`✓ Wired organizational reporting hierarchy`);

    // 9. Working Shifts & Schedule
    const shifts = [
      { code: 'DAY', name: 'Regular Day Shift', start: '08:00:00', end: '17:00:00', night: false },
      { code: 'MID', name: 'Mid Shift (Fleet Ops)', start: '13:00:00', end: '22:00:00', night: false },
      { code: 'NIGHT', name: 'Graveyard Logistics Shift', start: '22:00:00', end: '06:00:00', night: true },
    ];
    const shiftMap = new Map<string, string>();
    for (const s of shifts) {
      const sRes = await client.query(
        `INSERT INTO attendance_shift (org_id, code, name, start_time, end_time, is_night_shift)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, s.code, s.name, s.start, s.end, s.night],
      );
      shiftMap.set(s.code, sRes.rows[0].id);
    }

    // 10. Official Philippine 2026 Holidays
    const holidays = [
      { name: "New Year's Day", date: '2026-01-01', type: 'regular', year: 2026 },
      { name: 'Chinese Lunar New Year', date: '2026-01-29', type: 'special_non_working', year: 2026 },
      { name: 'People Power Revolution Day', date: '2026-02-25', type: 'special_working', year: 2026 },
      { name: 'Maundy Thursday', date: '2026-04-02', type: 'regular', year: 2026 },
      { name: 'Good Friday', date: '2026-04-03', type: 'regular', year: 2026 },
      { name: 'Black Saturday', date: '2026-04-04', type: 'special_non_working', year: 2026 },
      { name: 'Araw ng Kagitingan', date: '2026-04-09', type: 'regular', year: 2026 },
      { name: 'Labor Day', date: '2026-05-01', type: 'regular', year: 2026 },
      { name: 'Independence Day', date: '2026-06-12', type: 'regular', year: 2026 },
      { name: 'Ninoy Aquino Day', date: '2026-08-21', type: 'special_non_working', year: 2026 },
      { name: 'National Heroes Day', date: '2026-08-31', type: 'regular', year: 2026 },
      { name: 'All Saints Day', date: '2026-11-01', type: 'special_non_working', year: 2026 },
      { name: 'Bonifacio Day', date: '2026-11-30', type: 'regular', year: 2026 },
      { name: 'Feast of the Immaculate Conception', date: '2026-12-08', type: 'special_non_working', year: 2026 },
      { name: 'Christmas Day', date: '2026-12-25', type: 'regular', year: 2026 },
      { name: 'Rizal Day', date: '2026-12-30', type: 'regular', year: 2026 },
    ];
    for (const h of holidays) {
      await client.query(
        `INSERT INTO holiday_calendar (org_id, name, holiday_date, holiday_type, year)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, branch_id, holiday_date) DO NOTHING`,
        [orgId, h.name, h.date, h.type, h.year],
      );
    }
    console.log(`✓ Configured 2026 Philippine Statutory Holiday Calendar`);

    // 11. Leave Types & Allocations
    const leaveTypes = [
      { code: 'VL', name: 'Vacation Leave', days: 15, statutory: false },
      { code: 'SL', name: 'Sick Leave', days: 15, statutory: false },
      { code: 'SIL', name: 'Service Incentive Leave (Art. 95)', days: 5, statutory: true },
      { code: 'SPL', name: 'Solo Parent Leave (RA 8972)', days: 7, statutory: true },
      { code: 'PL', name: 'Paternity Leave (RA 8187)', days: 7, statutory: true },
      { code: 'BL', name: 'Bereavement Leave', days: 3, statutory: false },
    ];
    const leaveTypeMap = new Map<string, string>();
    for (const lt of leaveTypes) {
      const ltRes = await client.query(
        `INSERT INTO leave_type (
           org_id, code, name, default_days_per_year, is_statutory, is_paid
         ) VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (org_id, code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, lt.code, lt.name, lt.days, lt.statutory],
      );
      leaveTypeMap.set(lt.code, ltRes.rows[0].id);
    }

    // Allocate leave balances for 2026
    for (const spec of EMPLOYEES) {
      const empId = empIdMap.get(spec.employeeNo)!;
      for (const lt of leaveTypes) {
        const ltId = leaveTypeMap.get(lt.code)!;
        await client.query(
          `INSERT INTO leave_allocation (
             org_id, employee_id, leave_type_id, year, allocated_days, used_days, pending_days
           ) VALUES ($1, $2, $3, 2026, $4, 0, 0)
           ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
          [orgId, empId, ltId, lt.days],
        );
      }
    }

    // Insert Real-Life Leave Requests (Historical approved + Pending for live demo)
    const adminEmpId = empIdMap.get('EMP-0001')!;
    const beaEmpId = empIdMap.get('EMP-0006')!;
    const paoloEmpId = empIdMap.get('EMP-0007')!;
    const rommelEmpId = empIdMap.get('EMP-0017')!;
    const noelEmpId = empIdMap.get('EMP-0020')!;

    const vlTypeId = leaveTypeMap.get('VL')!;
    const slTypeId = leaveTypeMap.get('SL')!;

    // Historical Approved Leaves (clean up prior seeds to avoid overlap trigger collision)
    await client.query(
      `DELETE FROM leave_request WHERE org_id = $1 AND employee_id IN ($2, $3, $4, $5)`,
      [orgId, beaEmpId, paoloEmpId, rommelEmpId, noelEmpId],
    );

    await client.query(
      `INSERT INTO leave_request (
         org_id, employee_id, leave_type_id, start_date, end_date, total_days,
         reason, status, approved_by, approved_at
       ) VALUES
       ($1, $2, $3, '2026-02-12', '2026-02-13', 2, 'Family anniversary celebration in Batangas', 'approved', $4, '2026-02-08 10:00:00Z'),
       ($1, $5, $6, '2026-03-05', '2026-03-06', 2, 'Acute gastroenteritis, medical certificate provided', 'approved', $4, '2026-03-05 14:30:00Z'),
       ($1, $7, $3, '2026-03-24', '2026-03-25', 2, 'Personal errand, renewal of PRC license', 'approved', $4, '2026-03-20 09:15:00Z')`,
      [orgId, beaEmpId, vlTypeId, adminEmpId, paoloEmpId, slTypeId, rommelEmpId],
    );

    // Pending Leaves for live demo (Supervisor can click Approve / Reject in demo!)
    await client.query(
      `INSERT INTO leave_request (
         org_id, employee_id, leave_type_id, start_date, end_date, total_days,
         reason, status
       ) VALUES
       ($1, $2, $3, '2026-04-22', '2026-04-24', 3, 'Scheduled family vacation to Boracay Island', 'pending'),
       ($1, $4, $5, '2026-04-18', '2026-04-18', 1, 'Flu and fever symptoms, consulting with HMO clinic', 'pending'),
       ($1, $6, $3, '2026-04-28', '2026-04-30', 3, 'Brother wedding in Davao City (acting as best man)', 'pending')`,
      [orgId, beaEmpId, vlTypeId, rommelEmpId, slTypeId, noelEmpId],
    );
    console.log(`✓ Seeded statutory leave allocations, historical approvals & pending requests`);

    // 12. Daily Time Records (DTR) for Current Cut-off (Apr 1 - Apr 15, 2026)
    const dayShiftId = shiftMap.get('DAY')!;
    const midShiftId = shiftMap.get('MID')!;
    const nightShiftId = shiftMap.get('NIGHT')!;

    for (let day = 1; day <= 15; day++) {
      const dateStr = `2026-04-${String(day).padStart(2, '0')}`;
      const dayOfWeek = new Date(dateStr).getDay();
      const isRestDay = dayOfWeek === 0; // Sunday

      for (const spec of EMPLOYEES) {
        const empId = empIdMap.get(spec.employeeNo)!;
        const branchId = branchMap.get(spec.branchCode)!;

        if (isRestDay) {
          await client.query(
            `INSERT INTO attendance_record (
               org_id, employee_id, branch_id, work_date, is_rest_day, total_hours_worked, status
             ) VALUES ($1, $2, $3, $4, TRUE, 0, 'approved')
             ON CONFLICT (employee_id, work_date) DO NOTHING`,
            [orgId, empId, branchId, dateStr],
          );
          continue;
        }

        const isDriverOrHandler = ['EMP-0016', 'EMP-0017', 'EMP-0018', 'EMP-0019', 'EMP-0020'].includes(spec.employeeNo);
        const shiftId = isDriverOrHandler && day % 2 === 0 ? nightShiftId : dayShiftId;
        const otHours = isDriverOrHandler && day % 3 === 0 ? 2.5 : 0;
        const nightDiff = shiftId === nightShiftId ? 6.0 : 0;
        const tardiness = !isDriverOrHandler && day === 7 ? 15 : 0;

        await client.query(
          `INSERT INTO attendance_record (
             org_id, employee_id, branch_id, shift_id, work_date,
             clock_in, clock_out, total_hours_worked, regular_hours,
             regular_ot_hours, night_diff_hours, tardiness_minutes, status
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6::timestamptz, $7::timestamptz, $8, 8.0, $9, $10, $11, 'approved'
           ) ON CONFLICT (employee_id, work_date) DO NOTHING`,
          [
            orgId,
            empId,
            branchId,
            shiftId,
            dateStr,
            `${dateStr} 07:55:00+08`,
            `${dateStr} ${17 + Math.floor(otHours)}:00:00+08`,
            8 + otHours,
            otHours,
            nightDiff,
            tardiness,
          ],
        );
      }
    }
    console.log(`✓ Populated biometric Daily Time Records (DTR) for current pay cycle`);

    // 13. Payroll Runs & Historical Payslips
    const payrollRuns = [
      {
        code: 'PAY-2026-01-Q1',
        title: 'January 2026 1st Quindena Payroll',
        start: '2026-01-01',
        end: '2026-01-15',
        payout: '2026-01-20',
        type: 'quindena_1',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-01-Q2',
        title: 'January 2026 2nd Quindena Payroll',
        start: '2026-01-16',
        end: '2026-01-31',
        payout: '2026-02-05',
        type: 'quindena_2',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-02-Q1',
        title: 'February 2026 1st Quindena Payroll',
        start: '2026-02-01',
        end: '2026-02-15',
        payout: '2026-02-20',
        type: 'quindena_1',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-02-Q2',
        title: 'February 2026 2nd Quindena Payroll',
        start: '2026-02-16',
        end: '2026-02-28',
        payout: '2026-03-05',
        type: 'quindena_2',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-03-Q1',
        title: 'March 2026 1st Quindena Payroll',
        start: '2026-03-01',
        end: '2026-03-15',
        payout: '2026-03-20',
        type: 'quindena_1',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-03-Q2',
        title: 'March 2026 2nd Quindena Payroll',
        start: '2026-03-16',
        end: '2026-03-31',
        payout: '2026-04-05',
        type: 'quindena_2',
        status: 'disbursed',
      },
      {
        code: 'PAY-2026-04-Q1',
        title: 'April 2026 1st Quindena Payroll',
        start: '2026-04-01',
        end: '2026-04-15',
        payout: '2026-04-20',
        type: 'quindena_1',
        status: 'approved', // Ready for disbursement demo
      },
    ];

    for (const run of payrollRuns) {
      const runRes = await client.query(
        `INSERT INTO payroll_run (
           org_id, code, title, period_start, period_end, payout_date, run_type, status,
           approved_by, approved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (org_id, code) DO UPDATE SET
           title = EXCLUDED.title,
           status = EXCLUDED.status
         RETURNING id`,
        [
          orgId,
          run.code,
          run.title,
          run.start,
          run.end,
          run.payout,
          run.type,
          run.status,
          adminEmpId,
        ],
      );
      const runId = runRes.rows[0].id;

      let runGross = 0;
      let runTaxable = 0;
      let runWithholdingTax = 0;
      let runSssEe = 0;
      let runSssEr = 0;
      let runPhicEe = 0;
      let runPhicEr = 0;
      let runHdmfEe = 0;
      let runHdmfEr = 0;
      let runNetPay = 0;

      for (const spec of EMPLOYEES) {
        const empId = empIdMap.get(spec.employeeNo)!;
        const branchId = branchMap.get(spec.branchCode)!;

        // Semi-monthly base calculations
        const basicPay = spec.monthlyRate / 2;
        const totalDeMinimis =
          ((spec.riceSubsidy ?? 0) +
            (spec.clothingAllowance ?? 0) +
            (spec.laundryAllowance ?? 0) +
            (spec.medicalAllowance ?? 0)) /
          2;
        const taxableAllowance = (spec.taxableAllowance ?? 0) / 2;

        const isDriver = ['EMP-0016', 'EMP-0017'].includes(spec.employeeNo);
        const overtimePay = isDriver ? 2200 : 0;
        const nightDiffPay = spec.employeeNo === 'EMP-0018' ? 950 : 0;

        const grossPay = basicPay + overtimePay + nightDiffPay + totalDeMinimis + taxableAllowance;

        // Statutory Deductions
        const sssMonthly = calculateSssContribution(spec.monthlyRate);
        const sssSplit = apportionSssQuindena(sssMonthly);

        const phicMonthly = calculatePhilHealthContribution(spec.monthlyRate);
        const phicSplit = apportionPhilHealthQuindena(phicMonthly);

        const hdmfMonthly = calculatePagIbigContribution(spec.monthlyRate);
        const hdmfSplit = apportionPagIbigQuindena(hdmfMonthly);

        const sssEe = Math.round((sssMonthly.regularEe / 2) * 100) / 100;
        const sssWispEe = Math.round((sssMonthly.wispEe / 2) * 100) / 100;
        const sssEr = Math.round((sssMonthly.regularEr / 2) * 100) / 100;
        const sssWispEr = Math.round((sssMonthly.wispEr / 2) * 100) / 100;
        const sssEcEr = Math.round((sssMonthly.ecEr / 2) * 100) / 100;

        const phicEe = phicSplit.ee;
        const phicEr = phicSplit.er;

        const hdmfEe = hdmfSplit.ee;
        const hdmfEr = hdmfSplit.er;

        const statutoryEeTotal = sssEe + sssWispEe + phicEe + hdmfEe;

        // Taxable income = Gross - De Minimis - Statutory EE
        const taxableIncome = Math.max(0, grossPay - totalDeMinimis - statutoryEeTotal);
        const taxCalc = calculateSemiMonthlyWithholdingTax(taxableIncome, spec.isMinimumWage ?? false);
        const withholdingTax = taxCalc.withholdingTax;

        const totalDeductions = statutoryEeTotal + withholdingTax;
        const netPay = grossPay - totalDeductions;
        const thirteenthAccrual = calculateCycleThirteenthMonthAccrual(basicPay);

        runGross += grossPay;
        runTaxable += taxableIncome;
        runWithholdingTax += withholdingTax;
        runSssEe += sssEe + sssWispEe;
        runSssEr += sssEr + sssWispEr + sssEcEr;
        runPhicEe += phicEe;
        runPhicEr += phicEr;
        runHdmfEe += hdmfEe;
        runHdmfEr += hdmfEr;
        runNetPay += netPay;

        await client.query(
          `INSERT INTO payroll_line_item (
             payroll_run_id, org_id, employee_id, branch_id, basic_pay,
             overtime_pay, night_diff_pay, de_minimis_allowances, taxable_allowances,
             gross_pay, sss_ee, sss_wisp_ee, philhealth_ee, pagibig_ee, taxable_income,
             withholding_tax, total_deductions, sss_er, sss_wisp_er, sss_ec_er,
             philhealth_er, pagibig_er, net_pay, thirteenth_month_accrual,
             bank_name, bank_account_no, disbursement_status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
           ) ON CONFLICT (payroll_run_id, employee_id) DO UPDATE SET
             gross_pay = EXCLUDED.gross_pay,
             net_pay = EXCLUDED.net_pay,
             withholding_tax = EXCLUDED.withholding_tax,
             disbursement_status = EXCLUDED.disbursement_status`,
          [
            runId,
            orgId,
            empId,
            branchId,
            basicPay,
            overtimePay,
            nightDiffPay,
            totalDeMinimis,
            taxableAllowance,
            grossPay,
            sssEe,
            sssWispEe,
            phicEe,
            hdmfEe,
            taxableIncome,
            withholdingTax,
            totalDeductions,
            sssEr,
            sssWispEr,
            sssEcEr,
            phicEr,
            hdmfEr,
            netPay,
            thirteenthAccrual,
            spec.bankName,
            spec.bankAccountNo,
            run.status === 'disbursed' ? 'paid' : 'pending',
          ],
        );

        // 13th month accrual record
        await client.query(
          `INSERT INTO thirteenth_month_accrual (
             org_id, employee_id, payroll_run_id, year, basic_earned, accrual_amount
           ) VALUES ($1, $2, $3, 2026, $4, $5)`,
          [orgId, empId, runId, basicPay, thirteenthAccrual],
        );
      }

      // Update Run Totals
      await client.query(
        `UPDATE payroll_run SET
           total_gross = $1,
           total_taxable = $2,
           total_withholding_tax = $3,
           total_sss_ee = $4,
           total_sss_er = $5,
           total_philhealth_ee = $6,
           total_philhealth_er = $7,
           total_pagibig_ee = $8,
           total_pagibig_er = $9,
           total_net_pay = $10,
           employee_count = $11
         WHERE id = $12`,
        [
          runGross,
          runTaxable,
          runWithholdingTax,
          runSssEe,
          runSssEr,
          runPhicEe,
          runPhicEr,
          runHdmfEe,
          runHdmfEr,
          runNetPay,
          EMPLOYEES.length,
          runId,
        ],
      );
    }
    console.log(`✓ Generated 7 Payroll Runs with 140 Philippine statutory payslips & accruals`);

    // 14. Goals, KPIs, and Performance Review Scaffolding
    const periodRes = await client.query(
      `INSERT INTO goal_period (org_id, name, period_type, starts_on, ends_on, state)
       VALUES ($1, 'CY 2026 Performance Goals', 'annual', '2026-01-01', '2026-12-31', 'open')
       ON CONFLICT (org_id, name) DO UPDATE SET state = 'open'
       RETURNING id`,
      [orgId],
    );
    const goalPeriodId = periodRes.rows[0].id;

    // KPI Definitions
    const kpis = [
      {
        code: 'KPI-OTD',
        name: 'On-Time Delivery SLA',
        category: 'Operations',
        type: 'percentage',
        unit: '%',
      },
      {
        code: 'KPI-CSAT',
        name: 'Client Satisfaction Index',
        category: 'Service Quality',
        type: 'percentage',
        unit: '%',
      },
      {
        code: 'KPI-EFF',
        name: 'Fleet Fuel Efficiency',
        category: 'Cost Control',
        type: 'numeric',
        unit: 'km/L',
      },
      {
        code: 'KPI-SAFE',
        name: 'Lost-Time Incident Rate',
        category: 'Safety',
        type: 'numeric',
        unit: 'incidents',
      },
      {
        code: 'KPI-REV',
        name: 'Enterprise Contract Acquisitions',
        category: 'Growth',
        type: 'currency',
        unit: 'PHP',
      },
    ];

    const kpiMap = new Map<string, string>();
    for (const k of kpis) {
      const kRes = await client.query(
        `INSERT INTO kpi_definition (
           org_id, code, version, name, category, measure_type, unit, is_active
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, TRUE)
         ON CONFLICT (org_id, code, version) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, k.code, k.name, k.category, k.type, k.unit],
      );
      kpiMap.set(k.code, kRes.rows[0].id);
    }

    // Individual Goals for Key Roles
    const sampleGoals = [
      {
        empNo: 'EMP-0003', // VP Ops
        kpiCode: 'KPI-OTD',
        title: 'Maintain 98.5% National Fleet On-Time Delivery Rate',
        weight: 40,
        due: '2026-12-31',
        state: 'active',
      },
      {
        empNo: 'EMP-0003',
        kpiCode: 'KPI-EFF',
        title: 'Optimize Route Logistics to Achieve 4.2 km/L Fleet Average',
        weight: 30,
        due: '2026-12-31',
        state: 'active',
      },
      {
        empNo: 'EMP-0005', // IT Lead
        kpiCode: 'KPI-CSAT',
        title: 'Deploy Real-Time GPS Tracking Mobile Portal for Clients',
        weight: 50,
        due: '2026-06-30',
        state: 'active',
      },
      {
        empNo: 'EMP-0010', // Sales Director
        kpiCode: 'KPI-REV',
        title: 'Generate ₱25M in New FMCG Logistics Contracts',
        weight: 50,
        due: '2026-12-31',
        state: 'active',
      },
      {
        empNo: 'EMP-0011', // Warehouse Supervisor
        kpiCode: 'KPI-SAFE',
        title: 'Achieve 365 Days Without Warehouse Lost-Time Incidents',
        weight: 35,
        due: '2026-12-31',
        state: 'active',
      },
    ];

    for (const g of sampleGoals) {
      const empId = empIdMap.get(g.empNo)!;
      const kpiId = kpiMap.get(g.kpiCode)!;
      await client.query(
        `INSERT INTO goal (
           org_id, goal_period_id, employee_id, kpi_definition_id, kpi_definition_version,
           title, weight, due_on, state, approved_by, approved_at
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, now())
         ON CONFLICT DO NOTHING`,
        [orgId, goalPeriodId, empId, kpiId, g.title, g.weight, g.due, g.state, adminEmpId],
      );
    }
    console.log(`✓ Provisioned performance periods, KPI definition library & strategic goals`);

    // 14. Enterprise Modules: Biometric Kiosk Credentials, Shifts, Loans, 201 Records & Merits
    const samplePinHash = await hashPassword('1234');
    for (const [empNo, empId] of empIdMap.entries()) {
      await client.query(
        `INSERT INTO app.terminal_credential (
           org_id, employee_id, kiosk_pin_hash, is_active
         ) VALUES ($1, $2, $3, true)
         ON CONFLICT (employee_id) DO UPDATE SET kiosk_pin_hash = EXCLUDED.kiosk_pin_hash`,
        [orgId, empId, samplePinHash],
      );
    }
    console.log(`✓ Enrolled all ${empIdMap.size} employees for Biometric / Kiosk Terminal with default PIN: 1234`);

    // Additional Specialized Shifts (Broken / Split Shift, Opening, Mid, Graveyard, Closing)
    const specializedShifts = [
      { code: 'OPEN', name: 'Opening Shift (06:00 - 15:00)', start: '06:00:00', end: '15:00:00', isBroken: false },
      { code: 'MID', name: 'Midday Shift (13:00 - 22:00)', start: '13:00:00', end: '22:00:00', isBroken: false },
      { code: 'CLOSE', name: 'Closing Shift (18:00 - 03:00)', start: '18:00:00', end: '03:00:00', isBroken: false },
      { code: 'GRAVE', name: 'Graveyard Night Shift (22:00 - 07:00)', start: '22:00:00', end: '07:00:00', isBroken: false },
      { code: 'SPLIT', name: 'Broken Shift (10-14 & 17-21)', start: '10:00:00', end: '14:00:00', isBroken: true, secStart: '17:00:00', secEnd: '21:00:00' },
    ];
    for (const s of specializedShifts) {
      await client.query(
        `INSERT INTO attendance_shift (
           org_id, code, name, start_time, end_time, grace_period_mins, is_broken_shift, second_start_time, second_end_time
         ) VALUES ($1, $2, $3, $4, $5, 15, $6, $7, $8)
         ON CONFLICT (org_id, code) DO NOTHING`,
        [orgId, s.code, s.name, s.start, s.end, s.isBroken, s.secStart || null, s.secEnd || null],
      );
    }
    console.log(`✓ Configured Opening, Mid, Graveyard, Closing, and Broken/Split work shifts`);

    // Sample Active Loans (SSS & Pag-IBIG)
    const emp6Id = empIdMap.get('EMP-0006');
    if (emp6Id) {
      await client.query(
        `INSERT INTO employee_loan (
           org_id, employee_id, loan_type, reference_no, principal_amount,
           monthly_amortization, amortization_per_cutoff, remaining_balance, total_terms_months, start_date, status
         ) VALUES ($1, $2, 'sss_salary', 'SSS-LN-2026-8812', 30000, 1350, 675, 27300, 24, '2026-01-01', 'active')
         ON CONFLICT DO NOTHING`,
        [orgId, emp6Id],
      );
    }

    const emp12Id = empIdMap.get('EMP-0012');
    if (emp12Id) {
      await client.query(
        `INSERT INTO employee_loan (
           org_id, employee_id, loan_type, reference_no, principal_amount,
           monthly_amortization, amortization_per_cutoff, remaining_balance, total_terms_months, start_date, status
         ) VALUES ($1, $2, 'pagibig_mpl', 'HDMF-MPL-2026-1044', 20000, 950, 475, 18100, 24, '2026-01-01', 'active')
         ON CONFLICT DO NOTHING`,
        [orgId, emp12Id],
      );
    }

    // Sample Service Charge Pool (RA 11360 for hospitality / fleet cafeteria)
    const runRes = await client.query(`SELECT id FROM payroll_run WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1`, [orgId]);
    if (runRes.rows.length > 0) {
      const activeRunId = runRes.rows[0].id;
      await client.query(
        `INSERT INTO service_charge_pool (
           org_id, payroll_run_id, total_pool_amount, staff_share_amount, management_share_amount,
           eligible_staff_count, per_employee_share
         ) VALUES ($1, $2, 250000, 212500, 37500, 20, 10625)
         ON CONFLICT DO NOTHING`,
        [orgId, activeRunId],
      );
    }

    // Sample Salary Grade Matrices across Regions
    const rankRes = await client.query(`SELECT id FROM job_rank WHERE org_id = $1 LIMIT 1`, [orgId]);
    if (rankRes.rows.length > 0) {
      const sampleRankId = rankRes.rows[0].id;
      const matrixRegions = ['NCR', 'Region VII', 'Region XI', 'Region III'];
      for (const reg of matrixRegions) {
        await client.query(
          `INSERT INTO salary_grade_matrix (
             org_id, job_rank_id, region, min_salary, mid_salary, max_salary, is_active
           ) VALUES ($1, $2, $3, 18000, 25000, 35000, true)
           ON CONFLICT DO NOTHING`,
          [orgId, sampleRankId, reg],
        );
      }
    }

    // Sample Official Business (OB) Trip
    const emp5Id = empIdMap.get('EMP-0005'); // Danilo Reyes
    if (emp5Id) {
      await client.query(
        `INSERT INTO business_trip_request (
           org_id, employee_id, destination, purpose, start_date, end_date,
           per_diem_amount, status, approved_by, approved_at
         ) VALUES ($1, $2, 'Clark Freeport Terminal Hub', 'Warehouse network and RFID sensor deployment', '2026-04-10', '2026-04-12', 750, 'approved', $3, now())
         ON CONFLICT DO NOTHING`,
        [orgId, emp5Id, adminEmpId],
      );
    }

    // Sample 201 Personnel Documents & Merits for EMP-0001 (Juan Dela Cruz)
    const emp1Id = empIdMap.get('EMP-0001');
    if (emp1Id) {
      await client.query(
        `INSERT INTO employee_document (
           org_id, employee_id, doc_type, title, file_url, file_name, uploaded_by
         ) VALUES
           ($1, $2, 'nbi_clearance', 'NBI Clearance 2026 (Clear / No Derogatory Record)', 'https://storage.googleapis.com/demo-docs/nbi-clearance-juan.pdf', 'nbi-clearance-juan.pdf', $3),
           ($1, $2, 'medical', 'Pre-employment Medical Exam — Fit To Work Category A', 'https://storage.googleapis.com/demo-docs/medical-fit-juan.pdf', 'medical-fit-juan.pdf', $3),
           ($1, $2, 'contract', 'Regular Employment Agreement — Signed DOLE Art 280', 'https://storage.googleapis.com/demo-docs/contract-juan.pdf', 'contract-juan.pdf', $3)
         ON CONFLICT DO NOTHING`,
        [orgId, emp1Id, adminEmpId],
      );

      await client.query(
        `INSERT INTO employee_merit_award (
           org_id, employee_id, award_title, award_type, awarded_on, issuer, description
         ) VALUES ($1, $2, 'Presidential Leadership Award 2025', 'merit', '2025-12-15', 'Apex Board of Directors', 'For spearheading nationwide hub expansions with zero service interruptions.')
         ON CONFLICT DO NOTHING`,
        [orgId, emp1Id],
      );
    }

    // Sample Meal Vouchers for Driver / Operations staff
    const emp19Id = empIdMap.get('EMP-0019');
    if (emp19Id) {
      await client.query(
        `INSERT INTO meal_voucher_log (
           org_id, employee_id, voucher_code, meal_type, issued_date, status
         ) VALUES ($1, $2, 'VCH-202604-001', 'duty_meal', CURRENT_DATE, 'issued')
         ON CONFLICT (org_id, voucher_code) DO NOTHING`,
        [orgId, emp19Id],
      );
    }

    console.log(`✓ Seeded statutory loans, service charge pools, salary grade matrices, OB trips, 201 records, and meal vouchers`);

    await client.query('COMMIT');

    console.log(`\n================================================================`);
    console.log(`Demo Simulation Seeding Completed Successfully!`);
    console.log(`================================================================`);
    console.log(`Summary:`);
    console.log(`  Tenant:            Apex Logistics PH (APEX)`);
    console.log(`  Branches:          4 (BGC HQ, Cebu Hub, Davao Terminal, Clark Freeport)`);
    console.log(`  Total Employees:   20 Filipino Staff Across 7 Departments`);
    console.log(`  Payroll Runs:      7 Cycles (6 Disbursed + 1 Ready for Live Demo)`);
    console.log(`  Payslips:          140 Accurate Philippine Statutory Payslips`);
    console.log(`  Leaves:            Allocated 2026 balances + 3 Pending Live Requests`);
    console.log(`\nDemo Logins:`);
    console.log(`  HR Administrator:  admin@apexlogistics.ph / ${ADMIN_PASSWORD}`);
    console.log(`  VP Operations:     ramon.bautista@apexlogistics.ph / ${DEFAULT_PASSWORD}`);
    console.log(`  IT & Systems:      danilo.reyes@apexlogistics.ph / ${DEFAULT_PASSWORD}`);
    console.log(`  Senior HR Spec:    bea.delacruz@apexlogistics.ph / ${DEFAULT_PASSWORD}`);
    console.log(`  Lead Engineer:     paolo.reyes@apexlogistics.ph / ${DEFAULT_PASSWORD}`);
    console.log(`  Logistics Driver:  junjun.alcantara@apexlogistics.ph / ${DEFAULT_PASSWORD}`);
    console.log(`================================================================\n`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Failed to seed demo tenant:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
