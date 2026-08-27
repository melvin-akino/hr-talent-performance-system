import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Grouped navigation: Mine / My team / Company.
 *
 * Replaces the flat thirteen-tab row. The grouping answers "which hat am I
 * wearing" — acting on your own record and acting on someone else's are
 * different things with different consequences, and the old row made them look
 * identical.
 *
 * Group visibility is driven by the caller's roles, but **this is not an
 * authorization boundary**. RLS is. Someone who forces a hidden route sees
 * empty results, not other people's data. Hiding is about not offering a
 * console to somebody who has no rows for it.
 */

interface Item {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match child routes too — /reviews should stay lit on /reviews/:id. */
  end?: boolean;
}

interface Group {
  title: string;
  items: Item[];
  visible: boolean;
}

/* Lucide outlines at stroke-width 1.5, inlined as SVG. The design system
   specifies no icon font and the office LAN has no internet, so nothing here
   may be fetched at runtime. */
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
  bell: icon(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
};

export function buildGroups(roles: string[], hasReports: boolean): Group[] {
  const isManager = roles.includes('manager') || hasReports;
  const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');

  return [
    {
      title: 'Mine',
      visible: true,
      items: [
        { to: '/', label: 'My goals', icon: icons.target, end: true },
        { to: '/reviews', label: 'Reviews', icon: icons.clipboard },
        { to: '/competencies', label: 'Competencies', icon: icons.layers },
        { to: '/development', label: 'Development', icon: icons.sprout },
        { to: '/feedback', label: 'Feedback', icon: icons.message },
        { to: '/notifications', label: 'Notifications', icon: icons.bell },
      ],
    },
    {
      title: 'My team',
      visible: isManager || isHr,
      items: [
        { to: '/team', label: 'Team', icon: icons.users },
        { to: '/monitoring', label: 'Monitoring', icon: icons.activity },
        { to: '/evaluations', label: 'Evaluations', icon: icons.gauge },
        // Everyone can reach a PIP by URL — an employee on a plan must be able
        // to read it — but only managers are offered the list.
        { to: '/pips', label: 'PIPs', icon: icons.lifeBuoy },
      ],
    },
    {
      title: 'Company',
      visible: isHr,
      items: [
        { to: '/hr', label: 'HR console', icon: icons.briefcase },
        { to: '/review-admin', label: 'Review cycles', icon: icons.calendar },
        { to: '/analytics', label: 'Analytics', icon: icons.chart },
        { to: '/kpis', label: 'KPI library', icon: icons.library },
        { to: '/metrics', label: 'Task metrics', icon: icons.checklist },
        { to: '/setup', label: 'Setup', icon: icons.settings },
      ],
    },
  ].filter((g) => g.visible);
}

export function Sidebar({ roles, hasReports }: { roles: string[]; hasReports: boolean }) {
  const groups = buildGroups(roles, hasReports);

  return (
    <nav className="hr-sidebar no-print" aria-label="Main">
      <div className="hr-brand">HR System</div>
      {groups.map((group) => (
        <div key={group.title} className="hr-navgroup">
          <div className="hr-navgroup-title">{group.title}</div>
          {group.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `hr-navlink${isActive ? ' is-active' : ''}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
