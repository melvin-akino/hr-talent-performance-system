import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import type { EmployeeSummary } from '../../types';
import { ErrorNote, Spinner } from '../../components/ui';
import { Btn, Card, Tag } from '../../components/ds';

interface RoleAssignment {
  id: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  effectiveFrom: string;
}

interface AppRole {
  id: string;
  code: string;
  name: string;
}

export default function RolesAdmin() {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [roleId, setRoleId] = useState('');

  const assignments = useQuery({
    queryKey: ['admin', 'role-assignments'],
    queryFn: () => api<RoleAssignment[]>('/admin/role-assignments'),
  });

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<AppRole[]>('/roles'),
  });

  const employees = useQuery({
    queryKey: ['employees', 'roles-select'],
    queryFn: () => api<EmployeeSummary[]>('/employees?limit=200'),
  });

  const assign = useMutation({
    mutationFn: () => api('/admin/role-assignments', { method: 'POST', body: { employeeId, roleId } }),
    onSuccess: () => {
      setEmployeeId('');
      setRoleId('');
      void qc.invalidateQueries({ queryKey: ['admin', 'role-assignments'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/role-assignments/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'role-assignments'] }),
  });

  if (assignments.isLoading) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card kicker="Assign System Role">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8, alignItems: 'end' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Employee</label>
            <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select Employee...</option>
              {(employees.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.lastName}, {e.firstName} ({e.employeeNo})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Role</label>
            <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Select Role...</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Btn
              variant="primary"
              disabled={!employeeId || !roleId || assign.isPending}
              onClick={() => assign.mutate()}
            >
              {assign.isPending ? 'Assigning...' : '+ Assign Role'}
            </Btn>
          </div>
        </div>
        <ErrorNote error={assign.error || revoke.error} />
      </Card>

      <Card kicker="Active Role Grants">
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Role Code</th>
                <th>Role Name</th>
                <th>Effective Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(assignments.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.employeeName}</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-neutral-600)' }}>{a.employeeNo}</div>
                  </td>
                  <td><code>{a.roleCode}</code></td>
                  <td><Tag tone={a.roleCode === 'hr_admin' ? 'accent' : 'outline'}>{a.roleName}</Tag></td>
                  <td>{a.effectiveFrom}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Btn
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(a.id)}
                    >
                      Revoke
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
