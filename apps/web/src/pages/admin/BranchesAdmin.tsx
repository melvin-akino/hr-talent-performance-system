import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../auth';
import { ErrorNote, Spinner } from '../../components/ui';
import { Btn, Card, Tag } from '../../components/ds';

interface Branch {
  id: string;
  code: string;
  name: string;
  region: string;
  address: string | null;
  bir_rdo_code: string | null;
  sss_branch_code: string | null;
  philhealth_employer_no: string | null;
  pagibig_employer_no: string | null;
  headcount: number;
}

export default function BranchesAdmin() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Branch>>({});
  const [newForm, setNewForm] = useState({
    code: '',
    name: '',
    region: 'NCR',
    address: '',
    birRdoCode: '',
    sssBranchCode: '',
  });

  const branches = useQuery({
    queryKey: ['branches', 'admin'],
    queryFn: () => api<Branch[]>('/branches'),
  });

  const create = useMutation({
    mutationFn: () => api('/branches', { method: 'POST', body: newForm }),
    onSuccess: () => {
      setNewForm({ code: '', name: '', region: 'NCR', address: '', birRdoCode: '', sssBranchCode: '' });
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api(`/branches/${id}`, { method: 'PATCH', body: data }),
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['branches'] }),
  });

  if (branches.isLoading) return <Spinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Card kicker="Branches & Regional Hubs">
        <ErrorNote error={branches.error || update.error || remove.error} />
        <div style={{ overflowX: 'auto', marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Branch Name</th>
                <th>Region</th>
                <th>BIR RDO</th>
                <th>Address</th>
                <th>Headcount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(branches.data ?? []).map((b) =>
                editingId === b.id ? (
                  <tr key={b.id}>
                    <td>
                      <input
                        className="input-sm"
                        style={{ width: 90 }}
                        value={editForm.code ?? b.code}
                        onChange={(e) => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td>
                      <input
                        className="input-sm"
                        value={editForm.name ?? b.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input-sm"
                        style={{ width: 90 }}
                        value={editForm.region ?? b.region}
                        onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input-sm"
                        style={{ width: 70 }}
                        value={editForm.bir_rdo_code ?? b.bir_rdo_code ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, bir_rdo_code: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input-sm"
                        value={editForm.address ?? b.address ?? ''}
                        onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      />
                    </td>
                    <td className="tabular-nums">{b.headcount}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Btn
                        variant="primary"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({
                            id: b.id,
                            data: {
                              code: editForm.code ?? b.code,
                              name: editForm.name ?? b.name,
                              region: editForm.region ?? b.region,
                              birRdoCode: editForm.bir_rdo_code ?? b.bir_rdo_code,
                              address: editForm.address ?? b.address,
                            },
                          })
                        }
                      >
                        Save
                      </Btn>{' '}
                      <Btn variant="ghost" onClick={() => setEditingId(null)}>Cancel</Btn>
                    </td>
                  </tr>
                ) : (
                  <tr key={b.id}>
                    <td><code>{b.code}</code></td>
                    <td><strong>{b.name}</strong></td>
                    <td><Tag tone="outline">{b.region}</Tag></td>
                    <td>{b.bir_rdo_code || '—'}</td>
                    <td style={{ fontSize: '0.85rem' }}>{b.address || '—'}</td>
                    <td className="tabular-nums">{b.headcount}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Btn
                        variant="ghost"
                        onClick={() => {
                          setEditingId(b.id);
                          setEditForm(b);
                        }}
                      >
                        Edit
                      </Btn>
                      {b.headcount === 0 && (
                        <Btn
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(b.id)}
                        >
                          Delete
                        </Btn>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card kicker="Add Regional Branch">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Code</label>
            <input
              className="input"
              placeholder="e.g., ILO-HUB"
              value={newForm.code}
              onChange={(e) => setNewForm({ ...newForm, code: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Branch Name</label>
            <input
              className="input"
              placeholder="e.g., Iloilo Logistics Hub"
              value={newForm.name}
              onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Region</label>
            <input
              className="input"
              placeholder="NCR / Region VI"
              value={newForm.region}
              onChange={(e) => setNewForm({ ...newForm, region: e.target.value })}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>BIR RDO Code</label>
            <input
              className="input"
              placeholder="044"
              value={newForm.birRdoCode}
              onChange={(e) => setNewForm({ ...newForm, birRdoCode: e.target.value })}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Address</label>
            <input
              className="input"
              placeholder="Complete branch street & city address"
              value={newForm.address}
              onChange={(e) => setNewForm({ ...newForm, address: e.target.value })}
            />
          </div>
        </div>
        <ErrorNote error={create.error} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Btn
            variant="primary"
            disabled={create.isPending || !newForm.code.trim() || !newForm.name.trim()}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Adding...' : '+ Add Branch'}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
