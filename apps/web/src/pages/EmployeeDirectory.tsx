import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../auth';
import type { Employee, EmployeeSummary } from '../types';
import { ErrorNote, Spinner } from '../components/ui';
import { Card, EmptyState, PageHead, Section, Tag, Btn } from '../components/ds';

export default function EmployeeDirectory() {
  const [search, setSearch] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Employee>('/employees/me'),
  });
  const hasGoals = me.data?.features
    ? !!(me.data.features.feature_performance || me.data.features.feature_kpis)
    : true;

  const { data: employees = [], isLoading, error } = useQuery({
    queryKey: ['employees', 'directory'],
    queryFn: () => api<EmployeeSummary[]>('/employees?limit=200'),
  });

  const departments = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.departmentName) set.add(e.departmentName);
    });
    return Array.from(set).sort();
  }, [employees]);

  const branches = useMemo(() => {
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.branchName) set.add(e.branchName);
    });
    return Array.from(set).sort();
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const matchSearch =
        !search ||
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
        (e.employeeNo && e.employeeNo.toLowerCase().includes(search.toLowerCase())) ||
        (e.workEmail && e.workEmail.toLowerCase().includes(search.toLowerCase())) ||
        (e.positionTitle && e.positionTitle.toLowerCase().includes(search.toLowerCase()));

      const matchDept = selectedDept === 'ALL' || e.departmentName === selectedDept;
      const matchBranch = selectedBranch === 'ALL' || e.branchName === selectedBranch;
      const matchStatus = selectedStatus === 'ALL' || e.status === selectedStatus;

      return matchSearch && matchDept && matchBranch && matchStatus;
    });
  }, [employees, search, selectedDept, selectedBranch, selectedStatus]);

  const activeCount = employees.filter((e) => e.status === 'active').length;
  const probationaryCount = employees.filter((e) => e.status === 'probationary').length;

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  return (
    <Section>
      <PageHead title="Employee Directory & 201 Roster">
        <Btn
          variant={viewMode === 'table' ? 'primary' : 'secondary'}
          onClick={() => setViewMode('table')}
        >
          Table View
        </Btn>
        <Btn
          variant={viewMode === 'cards' ? 'primary' : 'secondary'}
          onClick={() => setViewMode('cards')}
        >
          Card View
        </Btn>
      </PageHead>

      {/* KPI Overview Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Card>
          <div className="card-kicker">TOTAL ROSTER</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-accent)' }}>
            {employees.length}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
            Registered personnel in tenant
          </div>
        </Card>
        <Card>
          <div className="card-kicker">ACTIVE EMPLOYEES</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-success, #16a34a)' }}>
            {activeCount}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
            Regularized & on active duty
          </div>
        </Card>
        <Card>
          <div className="card-kicker">PROBATIONARY</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-warning, #d97706)' }}>
            {probationaryCount}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
            Under 6-month evaluation
          </div>
        </Card>
        <Card>
          <div className="card-kicker">DEPARTMENTS / BRANCHES</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text)' }}>
            {departments.length} / {branches.length || 1}
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
            Operational functional units
          </div>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 'var(--space-3)',
            alignItems: 'end',
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Search Personnel
            </label>
            <input
              type="search"
              className="form-control"
              placeholder="Name, ID, Email, Role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Department
            </label>
            <select
              className="form-control"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="ALL">All Departments ({departments.length})</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Branch / Regional Hub
            </label>
            <select
              className="form-control"
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="ALL">All Branches ({branches.length})</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
              Employment Status
            </label>
            <select
              className="form-control"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="active">Active</option>
              <option value="probationary">Probationary</option>
              <option value="separated">Separated</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Content Rendering: Table vs Cards */}
      {filteredEmployees.length === 0 ? (
        <EmptyState title="No employees match your search criteria" />
      ) : viewMode === 'table' ? (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-divider)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px' }}>Employee</th>
                  <th style={{ padding: '10px 12px' }}>Role / Position</th>
                  <th style={{ padding: '10px 12px' }}>Department</th>
                  <th style={{ padding: '10px 12px' }}>Branch</th>
                  <th style={{ padding: '10px 12px' }}>Reporting Manager</th>
                  <th style={{ padding: '10px 12px' }}>Hired On</th>
                  <th style={{ padding: '10px 12px' }}>Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map((emp) => (
                  <tr
                    key={emp.id}
                    style={{ borderBottom: '1px solid var(--color-divider)' }}
                  >
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--color-accent)' }}>
                        {emp.firstName} {emp.lastName}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>
                        {emp.employeeNo} &bull; {emp.workEmail || 'No email'}
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontWeight: 500 }}>{emp.positionTitle || 'Unassigned'}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <Tag tone="outline">{emp.departmentName || 'General'}</Tag>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '0.9rem' }}>{emp.branchName || 'Main / HQ'}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--color-neutral-600)' }}>
                        {emp.supervisorName || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                      {emp.hiredOn ? new Date(emp.hiredOn).toLocaleDateString('en-PH') : '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <Tag tone={emp.status === 'active' ? 'accent' : 'neutral'}>
                        {emp.status}
                      </Tag>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Link
                          to={`/employees/${emp.id}/history`}
                          className="btn btn-secondary btn-sm"
                          title="View 201 File, Timeline & Vault"
                        >
                          201 File
                        </Link>
                        {hasGoals && (
                          <Link
                            to={`/employees/${emp.id}/goals`}
                            className="btn btn-secondary btn-sm"
                            title="View Goals & Objectives"
                          >
                            Goals
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Cards View */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {filteredEmployees.map((emp) => (
            <Card key={emp.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                      {emp.firstName} {emp.lastName}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)' }}>
                      {emp.employeeNo}
                    </div>
                  </div>
                  <Tag tone={emp.status === 'active' ? 'accent' : 'neutral'}>
                    {emp.status}
                  </Tag>
                </div>

                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-accent)', marginBottom: 4 }}>
                  {emp.positionTitle || 'Staff Member'}
                </div>

                <div style={{ fontSize: '0.85rem', marginBottom: 2 }}>
                  <strong>Dept:</strong> {emp.departmentName || 'General'}
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: 2 }}>
                  <strong>Branch:</strong> {emp.branchName || 'Main / HQ'}
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: 2 }}>
                  <strong>Manager:</strong> {emp.supervisorName || 'Executive Board'}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-neutral-600)', marginBottom: 8 }}>
                  <strong>Email:</strong> {emp.workEmail || '—'}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-3)',
                  paddingTop: 'var(--space-2)',
                  borderTop: '1px solid var(--color-divider)',
                }}
              >
                <Link
                  to={`/employees/${emp.id}/history`}
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1, textAlign: 'center' }}
                >
                  201 File & History
                </Link>
                {hasGoals && (
                  <Link
                    to={`/employees/${emp.id}/goals`}
                    className="btn btn-secondary btn-sm"
                    style={{ flex: 1, textAlign: 'center' }}
                  >
                    KPIs & Goals
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
