import { ThemeToggle } from './components/ds';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HOME_PATH } from './routes';
import { useQuery } from '@tanstack/react-query';
import { api, completeSigninIfCallback, currentUser, signInAndReturnHere, logout } from './auth';
import { PeriodProvider, usePeriod } from './PeriodContext';
import type { Employee } from './types';
import { ErrorNote, Spinner } from './components/ui';
import { ScrollToTop } from './components/ScrollToTop';
import { Sidebar } from './components/Sidebar';
import { HelpButton, HelpDrawer } from './components/HelpDrawer';

import Login from './pages/auth/Login';
import SuperadminLogin from './pages/superadmin/SuperadminLogin';
import SuperadminDashboard from './pages/superadmin/SuperadminDashboard';
import PayrollDashboard from './pages/payroll/PayrollDashboard';
import ExecutiveDashboard from './pages/ExecutiveDashboard';
import EmployeeDirectory from './pages/EmployeeDirectory';
import EssPortal from './pages/EssPortal';
import OffboardingDashboard from './pages/OffboardingDashboard';

import MyGoals from './pages/MyGoals';
import GoalDetail from './pages/GoalDetail';
import NewGoal from './pages/NewGoal';
import Team from './pages/Team';
import HrConsole from './pages/HrConsole';
import KpiLibrary from './pages/KpiLibrary';
import Metrics from './pages/Metrics';
import Evaluations from './pages/Evaluations';
import EmployeeHistory from './pages/EmployeeHistory';
import EmployeeGoals from './pages/EmployeeGoals';
import Monitoring from './pages/Monitoring';
import UnitDashboard from './pages/UnitDashboard';
import Pips from './pages/Pips';
import Reviews from './pages/Reviews';
import ReviewForm from './pages/ReviewForm';
import ReviewAdmin from './pages/ReviewAdmin';
import Competencies from './pages/Competencies';
import Setup from './pages/Setup';
import Feedback from './pages/Feedback';
import Notifications from './pages/Notifications';
import Development from './pages/Development';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import Requests from './pages/Requests';
import AttendanceDashboard from './pages/attendance/AttendanceDashboard';
import KioskTerminal from './pages/attendance/KioskTerminal';
import LeavesDashboard from './pages/leaves/LeavesDashboard';
import MyPayslips from './pages/payroll/MyPayslips';

export default function App() {
  const location = useLocation();
  if (location.pathname === '/kiosk') {
    return <KioskTerminal />;
  }

  const isAuthRoute =
    location.pathname === '/login' ||
    location.pathname === '/superadmin/login' ||
    location.pathname.startsWith('/superadmin');

  if (isAuthRoute) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/superadmin/login" element={<SuperadminLogin />} />
        <Route path="/superadmin" element={<SuperadminDashboard />} />
      </Routes>
    );
  }

  return (
    <PeriodProvider>
      <TenantApp />
    </PeriodProvider>
  );
}

function TenantApp() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await completeSigninIfCallback();
        const user = await currentUser();
        if (!user) {
          signInAndReturnHere();
          return;
        }
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="p-6"><ErrorNote error={new Error(error)} /></div>;
  if (!ready) return <Spinner label="Signing in…" />;

  return <Shell />;
}

/**
 * Resolves the router's state after the OIDC callback.
 */
function CallbackRedirect() {
  const target = window.location.pathname + window.location.search;
  return <Navigate to={target.startsWith('/callback') ? '/' : target} replace />;
}

function HomePage({
  me,
  isLoading,
  isManager,
}: {
  me?: Employee;
  isLoading: boolean;
  isManager: boolean;
}) {
  if (isLoading) return <Spinner />;
  const f = me?.features;
  const hasGoals = f ? !!(f.feature_performance || f.feature_kpis) : true;
  if (hasGoals) return <MyGoals />;

  const roles = me?.roles ?? [];
  const isHr = roles.includes('hr_admin') || roles.includes('hr_partner');
  if (f?.feature_time_attendance) return <Navigate to="/attendance" replace />;
  if (f?.feature_leave_management) return <Navigate to="/leaves" replace />;
  if (f?.feature_ph_payroll) {
    return <Navigate to={isHr || isManager ? '/executive-dashboard' : '/my-payslips'} replace />;
  }
  if (isHr) return <Navigate to="/employees" replace />;
  if (isManager) return <Navigate to="/team" replace />;
  return <Navigate to="/notifications" replace />;
}

function Shell() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const { period, periods, setPeriodId } = usePeriod();
  const [helpOpen, setHelpOpen] = useState(false);

  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Employee[]>('/employees/me/reports'),
  });
  const isManager = (reports.data?.length ?? 0) > 0;
  const features = me.data?.features;
  const hasGoals = features ? !!(features.feature_performance || features.feature_kpis) : true;

  return (
    <div className="hr-app">
      <Sidebar
        roles={me.data?.roles ?? []}
        hasReports={isManager}
        features={features}
        orgName={me.data?.organization?.name}
      />

      <main className="hr-main">
        <div className="hr-topbar no-print">
          <div className="hr-topbar-right">
            {hasGoals && periods.length > 0 && (
              <select
                className="input"
                style={{ width: 'auto' }}
                value={period?.id ?? ''}
                onChange={(e) => setPeriodId(e.target.value)}
                aria-label="Goal period"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.state})</option>
                ))}
              </select>
            )}
            <ThemeToggle />
            <HelpButton onClick={() => setHelpOpen(true)} />
            <span style={{ fontSize: 15 }}>
              {me.data ? `${me.data.firstName} ${me.data.lastName}` : '…'}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => void logout()}
            >
              Sign out
            </button>
          </div>
        </div>

        <ScrollToTop />
        <Routes>
          <Route path="/callback" element={<CallbackRedirect />} />
          <Route
            path={HOME_PATH}
            element={<HomePage me={me.data} isLoading={me.isLoading} isManager={isManager} />}
          />
          <Route path="/" element={<Navigate to={HOME_PATH} replace />} />
          <Route path="/my-payslips" element={<MyPayslips />} />
          <Route path="/payroll" element={<PayrollDashboard />} />
          <Route path="/attendance" element={<AttendanceDashboard />} />
          <Route path="/kiosk" element={<KioskTerminal />} />
          <Route path="/leaves" element={<LeavesDashboard />} />
          <Route path="/goals/new" element={<NewGoal />} />
          <Route path="/goals/:id" element={<GoalDetail />} />
          <Route path="/employees" element={<EmployeeDirectory />} />
          <Route path="/executive-dashboard" element={<ExecutiveDashboard />} />
          <Route path="/ess" element={<EssPortal />} />
          <Route path="/offboarding" element={<OffboardingDashboard />} />
          <Route path="/employees/:employeeId/goals" element={<EmployeeGoals />} />
          <Route path="/employees/:employeeId/history" element={<EmployeeHistory />} />
          <Route path="/team" element={<Team />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/reviews/:id" element={<ReviewForm />} />
          <Route path="/review-admin" element={<ReviewAdmin />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/competencies" element={<Competencies />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="/development" element={<Development />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/unit" element={<UnitDashboard />} />
          <Route path="/pips" element={<Pips />} />
          <Route path="/hr" element={<HrConsole />} />
          <Route path="/kpis" element={<KpiLibrary />} />
          <Route path="/metrics" element={<Metrics />} />
          <Route path="/evaluations" element={<Evaluations />} />
          <Route path="*" element={<p className="text-muted">Page not found.</p>} />
        </Routes>
      </main>

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)}
                  roles={me.data?.roles ?? []}
                  features={features} />
    </div>
  );
}
