import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, completeSigninIfCallback, currentUser, signInAndReturnHere, userManager } from './auth';
import { PeriodProvider, usePeriod } from './PeriodContext';
import type { Employee } from './types';
import { ErrorNote, Spinner } from './components/ui';
import { ScrollToTop } from './components/ScrollToTop';
import { Sidebar } from './components/Sidebar';
import { HelpButton, HelpDrawer } from './components/HelpDrawer';
import MyGoals from './pages/MyGoals';
import GoalDetail from './pages/GoalDetail';
import NewGoal from './pages/NewGoal';
import Team from './pages/Team';
import HrConsole from './pages/HrConsole';
import KpiLibrary from './pages/KpiLibrary';
import EmployeeGoals from './pages/EmployeeGoals';
import Monitoring from './pages/Monitoring';
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

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Handle the OIDC redirect leg before anything else renders. This is
        // idempotent — see completeSigninIfCallback().
        await completeSigninIfCallback();
        if (!(await currentUser())) {
          await signInAndReturnHere();
          return;
        }
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="p-6"><ErrorNote error={new Error(error)} /></div>;
  if (!ready) return <Spinner label="Signing in…" />;

  return (
    <PeriodProvider>
      <Shell />
    </PeriodProvider>
  );
}

/**
 * Resolves the router's state after the OIDC callback.
 *
 * By the time this renders, completeSigninIfCallback() has already replaced the
 * URL with the path the user was heading for. Reading it back from
 * `window.location` is what lets a deep link survive a sign-in — a link to a
 * specific review, which is how people arrive from a notification email.
 *
 * The guard matters: if the rewrite has not happened, navigating to /callback
 * again would loop.
 */
function CallbackRedirect() {
  const target = window.location.pathname + window.location.search;
  return <Navigate to={target.startsWith('/callback') ? '/' : target} replace />;
}

function Shell() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Employee>('/employees/me') });
  const { period, periods, setPeriodId } = usePeriod();
  const [helpOpen, setHelpOpen] = useState(false);

  // Nav is not an authorization boundary -- RLS is. A user who types /hr
  // without the grants simply sees empty or 404 results, which is correct.
  // Reports drive visibility of the Team tab purely to reduce clutter.
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<Employee[]>('/employees/me/reports'),
  });
  const isManager = (reports.data?.length ?? 0) > 0;

  return (
    <div className="hr-app">
      <Sidebar roles={me.data?.roles ?? []} hasReports={isManager} />

      <main className="hr-main">
        <div className="hr-topbar no-print">
          <div className="hr-topbar-right">
            {periods.length > 0 && (
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
            <HelpButton onClick={() => setHelpOpen(true)} />
            <span style={{ fontSize: 14 }}>
              {me.data ? `${me.data.firstName} ${me.data.lastName}` : '…'}
            </span>
            <button
              className="btn btn-ghost"
              onClick={() => void userManager.signoutRedirect()}
            >
              Sign out
            </button>
          </div>
        </div>

        <ScrollToTop />
        <Routes>
          {/* The OIDC redirect lands here. completeSigninIfCallback() rewrites
              the URL via history.replaceState, but that emits no popstate, so
              React Router still believes it is on /callback and would render
              "Page not found". This route resolves the router's own state —
              sending it to whatever replaceState just put in the address bar,
              which is where the user was originally heading. Hardcoding "/"
              here silently discarded that destination. */}
          <Route path="/callback" element={<CallbackRedirect />} />
          <Route path="/" element={<MyGoals />} />
          <Route path="/goals/new" element={<NewGoal />} />
          <Route path="/goals/:id" element={<GoalDetail />} />
          <Route path="/employees/:employeeId/goals" element={<EmployeeGoals />} />
          <Route path="/team" element={<Team />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/reviews/:id" element={<ReviewForm />} />
          <Route path="/review-admin" element={<ReviewAdmin />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/competencies" element={<Competencies />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/feedback" element={<Feedback />} />
          <Route path="/development" element={<Development />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/pips" element={<Pips />} />
          <Route path="/hr" element={<HrConsole />} />
          <Route path="/kpis" element={<KpiLibrary />} />
          <Route path="*" element={<p className="text-muted">Page not found.</p>} />
        </Routes>
      </main>

      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)}
                  roles={me.data?.roles ?? []} />
    </div>
  );
}

