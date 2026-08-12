'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Paginated, User } from '@/lib/types';
import { Button, Card, EmptyState, Input, Select, Spinner } from '@/components/ui';

interface NumberRow {
  phoneNumber: string;
  assignedTo: { id: string; name: string; email: string } | null;
}

/** Admin view of every Telnyx number: who holds it, assign, release, or buy. */
export default function NumbersPage() {
  const [rows, setRows] = useState<NumberRow[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Per-row user selection for the Assign action.
  const [assignee, setAssignee] = useState<Record<string, string>>({});

  const [buyUserId, setBuyUserId] = useState('');
  const [areaCode, setAreaCode] = useState('332');
  const [repairResult, setRepairResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [numbers, userPage] = await Promise.all([
        api<NumberRow[]>('/users/telnyx/numbers'),
        api<Paginated<User>>('/users', { query: { limit: '100' } }),
      ]);
      setRows(numbers);
      setUsers(userPage.items);
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Failed to load numbers');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A recruiter can hold one direct line at a time.
  const unassignedUsers = users.filter((u) => !u.providerConfig?.telnyxNumber);

  async function assign(phoneNumber: string) {
    const userId = assignee[phoneNumber];
    if (!userId) return;
    const user = users.find((u) => u.id === userId);
    if (!confirm(`Assign ${phoneNumber} to ${user?.name ?? 'this user'} as their direct line?`)) return;
    setBusy(phoneNumber);
    setError(null);
    try {
      await api(`/users/${userId}/telnyx-line`, { method: 'POST', body: { phoneNumber } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setBusy(null);
    }
  }

  async function release(row: NumberRow) {
    if (!row.assignedTo) return;
    if (!confirm(`Release ${row.phoneNumber} from ${row.assignedTo.name}? The number stays on the account.`)) return;
    setBusy(row.phoneNumber);
    setError(null);
    try {
      await api(`/users/${row.assignedTo.id}/telnyx-line`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed');
    } finally {
      setBusy(null);
    }
  }

  async function repairLines() {
    setBusy('repair');
    setError(null);
    setRepairResult(null);
    try {
      const result = await api<{ checked: number; repaired: number; failed: string[] }>(
        '/users/telnyx/repair-lines',
        { method: 'POST' },
      );
      const failures = result.failed.length ? ` Failed: ${result.failed.join('; ')}` : '';
      setRepairResult(
        result.repaired > 0
          ? `Fixed outbound calling on ${result.repaired} of ${result.checked} direct lines.${failures}`
          : `All ${result.checked} direct lines already have outbound calling enabled.${failures}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair failed');
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    if (!buyUserId) return;
    const user = users.find((u) => u.id === buyUserId);
    if (!confirm(`Buy a new number in area code ${areaCode} and assign it to ${user?.name ?? 'this user'}?`)) {
      return;
    }
    setBusy('buy');
    setError(null);
    try {
      await api(`/users/${buyUserId}/telnyx-line`, { method: 'POST', body: { areaCode } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Numbers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Telnyx numbers on the account — assign direct lines to recruiters or buy new ones.
          </p>
        </div>
        <Button variant="secondary" onClick={repairLines} disabled={busy === 'repair'}>
          {busy === 'repair' ? 'Checking lines…' : 'Fix outbound calling'}
        </Button>
      </div>

      {repairResult && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3">
          <p className="text-sm font-medium text-emerald-700">{repairResult}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-700">{error}</p>
          <p className="mt-1 text-xs text-rose-500">Only administrators can manage numbers.</p>
        </div>
      )}

      <Card className="mt-5 p-4">
        <p className="text-sm font-semibold text-slate-800">Buy a new number</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <p className="mb-1 text-xs text-slate-500">For user</p>
            <Select value={buyUserId} onChange={(e) => setBuyUserId(e.target.value)}>
              <option value="">Select a user…</option>
              {unassignedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">Area code</p>
            <Input
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="w-24"
            />
          </div>
          <Button onClick={buy} disabled={!buyUserId || areaCode.length !== 3 || busy === 'buy'}>
            {busy === 'buy' ? 'Buying…' : 'Buy & assign'}
          </Button>
        </div>
      </Card>

      <Card className="mt-4 overflow-x-auto">
        {rows === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No numbers on the account"
            subtitle="Buy one above, or check the Telnyx settings if numbers should be listed here."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase text-slate-400">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Assigned to</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.phoneNumber}>
                  <td className="px-4 py-3 font-semibold text-slate-800">{row.phoneNumber}</td>
                  <td className="px-4 py-3">
                    {row.assignedTo ? (
                      <span className="text-slate-700">
                        {row.assignedTo.name}
                        <span className="ml-1 text-xs text-slate-400">{row.assignedTo.email}</span>
                      </span>
                    ) : (
                      <span className="text-slate-400">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.assignedTo ? (
                      <Button
                        variant="secondary"
                        onClick={() => release(row)}
                        disabled={busy === row.phoneNumber}
                      >
                        {busy === row.phoneNumber ? 'Releasing…' : 'Release'}
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={assignee[row.phoneNumber] ?? ''}
                          onChange={(e) =>
                            setAssignee({ ...assignee, [row.phoneNumber]: e.target.value })
                          }
                        >
                          <option value="">Select a user…</option>
                          {unassignedUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          onClick={() => assign(row.phoneNumber)}
                          disabled={!assignee[row.phoneNumber] || busy === row.phoneNumber}
                        >
                          {busy === row.phoneNumber ? 'Assigning…' : 'Assign'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
