import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { HOME_PATH } from '../routes';
import type { TenantFeatures } from '../types';

export interface Item {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match exact route only, or allow child routes */
  end?: boolean;
}

export interface MenuGroup {
  id: string;
  title: string;
  icon: ReactNode;
  items: Item[];
  visible: boolean;
}

/* Lucide outlines at stroke-width 1.5, inlined as SVG. No runtime web fonts. */
const icon = (path: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const icons = {
  target: icon(<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
  clipboard: icon(<><rect width="8" height="4" x="8" y="2" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>),
  layers: icon(<><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>),
  sprout: icon(<><path d="M7 20h10" /><path d="M12 20V8" /><path d="M12 8C12 5 9 3 6 4c0 3 3 5 6 4Z" /><path d="M12 10c0-3 3-5 6-4 0 3-3 5-6 4Z" /></>),
  message: icon(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></>),
  users: icon(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  activity: icon(<><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>),
  lifeBuoy: icon(<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><path d="m4.9 4.9 4.2 4.2m5.8 5.8 4.2 4.2M4.9 19.1l4.2-4.2m5.8-5.8 4.2-4.2" /></>),
  briefcase: icon(<><rect width="20" height="14" x="2" y="7" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  calendar: icon(<><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>),
  chart: icon(<><path d="M3 3v18h18" /><path d="M7 16v-5M12 16V8M17 16v-3" /></>),
  library: icon(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>),
  settings: icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16 4.6h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>),
  gauge: icon(<><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></>),
  checklist: icon(<><path d="M11 4h9" /><path d="M11 12h9" /><path d="M11 20h9" /><path d="m3 5 1.5 1.5L7 4" /><path d="m3 13 1.5 1.5L7 12" /><path d="m3 21 1.5 1.5L7 20" /></>),
  inbox: icon(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" /></>),
  fileText: icon(<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M15 2v5h5" /><path d="M9 13h6M9 17h4" /></>),
  bell: icon(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
  banknote: icon(<><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></>),
  clock: icon(<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>),
  calendarDays: icon(<><rect width="18" height="18" x="3" y="4" rx="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></>),
  building: icon(<><rect width="16" height="20" x="4" y="2" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" /></>),
};

/**
 * Builds organized functional navigation groups:
 * 1. KPIs & Performance (My Goals, KPI Library, Metrics, Evaluations, Reviews, Review cycles, Competencies, Development, PIPs, Feedback, Analytics)
 * 2. Time & Attendance (Attendance & DTR, Biometric Kiosk, Leave Management)
 * 3. Payroll & Compensation (PH Payroll RA 10963, My Payslips)
 * 4. Core HR (HR Console, Team, Unit, Monitoring, Requests, Reports, Setup, Notifications)
 */
export function buildGroups(
  roles: string[],
  hasReports: boolean,
  features?: TenantFeatures,
): MenuGroup[] {
  const isManager = roles.includes('manager') || hasReports;
  const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');

  // When `features` is undefined (e.g. initial load or legacy unit tests),
  // default performance flags to true; once loaded, respect exact tenant flags.
  const hasPerformance = features ? !!features.feature_performance : true;
  const hasKpis = features ? !!features.feature_kpis : true;
  const hasPeerReviews = features ? !!features.feature_peer_reviews : true;
  const hasCompetenciesPip = features ? !!features.feature_competencies_pip : true;
  const hasGoals = hasPerformance || hasKpis;
  const hasAnyPerformance =
    hasPerformance || hasKpis || hasPeerReviews || hasCompetenciesPip;

  // 1. KPI & Performance Management
  const kpiItems: Item[] = [];
  if (hasGoals) {
    kpiItems.push({ to: HOME_PATH, label: 'My Goals', icon: icons.target, end: true });
  }
  if ((isHr || isManager) && hasKpis) {
    kpiItems.push({ to: '/kpis', label: 'KPI Library', icon: icons.library });
    kpiItems.push({ to: '/metrics', label: 'Task Metrics', icon: icons.checklist });
  }
  if ((isHr || isManager) && hasGoals) {
    kpiItems.push({ to: '/evaluations', label: 'Evaluations', icon: icons.gauge });
  }
  if (hasPerformance) {
    kpiItems.push({ to: '/reviews', label: 'Reviews', icon: icons.clipboard });
    if (isHr) {
      kpiItems.push({ to: '/review-admin', label: 'Review Cycles', icon: icons.calendar });
    }
  }
  if (hasCompetenciesPip) {
    kpiItems.push({ to: '/competencies', label: 'Competencies', icon: icons.layers });
  }
  if (hasCompetenciesPip || hasPerformance) {
    kpiItems.push({ to: '/development', label: 'Development', icon: icons.sprout });
  }
  if ((isManager || isHr) && hasCompetenciesPip) {
    kpiItems.push({ to: '/pips', label: 'Improvement Plans (PIPs)', icon: icons.lifeBuoy });
  }
  if (hasPeerReviews) {
    kpiItems.push({ to: '/feedback', label: '360° Feedback', icon: icons.message });
  }
  if (isHr && hasAnyPerformance) {
    kpiItems.push({ to: '/analytics', label: 'Analytics', icon: icons.chart });
  }

  // 2. Time, Attendance & Leaves
  const timeItems: Item[] = [];
  if (features?.feature_time_attendance) {
    timeItems.push({ to: '/attendance', label: 'Attendance & DTR', icon: icons.clock });
    timeItems.push({ to: '/kiosk', label: 'Biometric Kiosk', icon: icons.clock });
  }
  if (features?.feature_leave_management) {
    timeItems.push({ to: '/leaves', label: 'Leave Management', icon: icons.calendarDays });
  }

  // 3. Payroll & Payslips
  const payrollItems: Item[] = [];
  if (features?.feature_ph_payroll) {
    if (isHr || isManager) {
      payrollItems.push({ to: '/payroll', label: 'PH Payroll (RA 10963)', icon: icons.banknote });
    }
    payrollItems.push({ to: '/my-payslips', label: 'My Payslips', icon: icons.banknote });
  }

  // 4. Core HR & Personnel
  const coreHrItems: Item[] = [
    { to: '/ess', label: 'Self-Service & Bulletin', icon: icons.inbox },
  ];
  if (isHr || isManager) {
    coreHrItems.push({ to: '/executive-dashboard', label: 'Executive Outflow', icon: icons.chart });
  }
  if (isHr) {
    coreHrItems.push({ to: '/employees', label: 'Employee Directory', icon: icons.users });
    coreHrItems.push({ to: '/offboarding', label: 'Offboarding & Final Pay', icon: icons.briefcase });
    if (hasGoals) {
      coreHrItems.push({ to: '/hr', label: 'HR Console & Directory', icon: icons.briefcase });
    }
  }
  if (isManager || isHr) {
    coreHrItems.push({ to: '/team', label: 'Team Hierarchy', icon: icons.users });
    if (hasGoals) {
      coreHrItems.push({ to: '/unit', label: 'My Unit', icon: icons.layers });
      coreHrItems.push({ to: '/monitoring', label: 'Workforce Monitoring', icon: icons.activity });
    }
    if (hasAnyPerformance) {
      coreHrItems.push({ to: '/requests', label: 'Employee Requests', icon: icons.inbox });
    }
    coreHrItems.push({ to: '/reports', label: 'Personnel Reports', icon: icons.fileText });
  }
  coreHrItems.push({ to: '/notifications', label: 'Notifications', icon: icons.bell });
  if (isHr) {
    coreHrItems.push({ to: '/setup', label: 'System Setup', icon: icons.settings });
  }

  const groups: MenuGroup[] = [
    {
      id: 'kpi_performance',
      title: 'Goals & KPIs',
      icon: icons.target,
      visible: kpiItems.length > 0,
      items: kpiItems,
    },
    {
      id: 'time_attendance',
      title: 'Time & Attendance',
      icon: icons.clock,
      visible: timeItems.length > 0,
      items: timeItems,
    },
    {
      id: 'payroll_statutory',
      title: 'Payroll & Payslips',
      icon: icons.banknote,
      visible: payrollItems.length > 0,
      items: payrollItems,
    },
    {
      id: 'core_hr',
      title: 'Core HR',
      icon: icons.building,
      visible: coreHrItems.length > 0,
      items: coreHrItems,
    },
  ];

  return groups.filter((g) => g.visible);
}

export function Sidebar({
  roles,
  hasReports,
  features,
  orgName,
}: {
  roles: string[];
  hasReports: boolean;
  features?: TenantFeatures;
  orgName?: string;
}) {
  const location = useLocation();
  const groups = buildGroups(roles, hasReports, features);

  // Track expanded/collapsed state for each menu group
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      initial[group.id] = true; // Default expanded so all sub-features are visible
    }
    return initial;
  });

  // Automatically expand group if user navigates into one of its child routes
  useEffect(() => {
    for (const group of groups) {
      const isChildActive = group.items.some((item) =>
        item.end
          ? location.pathname === item.to
          : location.pathname.startsWith(item.to)
      );
      if (isChildActive && !openGroups[group.id]) {
        setOpenGroups((prev) => ({ ...prev, [group.id]: true }));
      }
    }
  }, [location.pathname, groups]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  return (
    <nav className="hr-sidebar no-print" aria-label="Main Navigation">
      <div className="hr-brand">
        <span style={{ fontWeight: 800, color: 'var(--color-accent)' }}>⚡</span>{' '}
        {orgName ? orgName : 'HR Enterprise'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {groups.map((group) => {
          const isOpen = openGroups[group.id] ?? true;
          const hasActiveChild = group.items.some((item) =>
            item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)
          );

          return (
            <div key={group.id} className="hr-navgroup">
              {/* Parent Expandable Menu Item */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`hr-nav-group-header${hasActiveChild ? ' has-active-child' : ''}`}
                aria-expanded={isOpen}
              >
                <div className="hr-nav-group-title">
                  <span style={{ color: hasActiveChild ? 'var(--color-accent)' : 'inherit', display: 'flex', alignItems: 'center' }}>
                    {group.icon}
                  </span>
                  <span>{group.title}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="hr-nav-badge">{group.items.length}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transition: 'transform 0.2s ease',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      opacity: 0.65,
                    }}
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>

              {/* Sub-features list */}
              {isOpen && (
                <div className="hr-nav-sublist">
                  {group.items.map((subItem) => (
                    <NavLink
                      key={subItem.to}
                      to={subItem.to}
                      end={subItem.end}
                      className={({ isActive }) => `hr-navsublink${isActive ? ' is-active' : ''}`}
                    >
                      <span style={{ opacity: 0.8, display: 'flex', alignItems: 'center' }}>{subItem.icon}</span>
                      <span>{subItem.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
