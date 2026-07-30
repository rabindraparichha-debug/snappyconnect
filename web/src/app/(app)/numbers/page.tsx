'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Paginated, User } from '@/lib/types';
import { Button, Card, EmptyState, Input, Modal, Select, Spinner } from '@/components/ui';

interface AccountNumber {
  phoneNumber: string;
  connectionId: string | null;
  assignedTo: { id: string; name: string; email: string } | null;
  isBoardLine: boolean;
  isDefaultCallerId: boolean;
}

interface AvailableNumber {
  phoneNumber: string;
  upfrontCost: string;
  monthlyCost: string;
}

/** Popular metros first — a recognisable area code lifts answer rates. */
const AREA_CODES = [
  { code: '332', label: '332 — New York, NY' },
  { code: '646', label: '646 — New York, NY' },
  { code: '469', label: '469 — Dallas, TX' },
  { code: '512', label: '512 — Austin, TX' },
  { code: '470', label: '470 — Atlanta, GA' },
  { code: '312', label: '312 — Chicago, IL' },
];

export default function NumbersPage() {
  const [numbers, setNumbers] = useState<AccountNumber[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [buyOpen, setBuyOpen] = useState(false);
  const [areaCode, setAreaCode] = useState('332');
  const [available, setAvailable] = useState<AvailableNumber[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [assigning, setAssigning] = useState<AccountNumber | null>(null);
  const [assignUserId, setAssignUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nums, userList] = await Promise.all([
        api<AccountNumber[]>('/numbers'),
        api<Paginated<User>>('/users', { query: { limit: 100 } }),
      ]);
      setNumbers(nums);
      setUsers(userList.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load numbers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function searchNumbers() {
    setSearching(true);
    setAvailable(null);
    setError(null);
    try {
      setAvailable(await api<AvailableNumber[]>('/numbers/available', { query: { areaCode } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function buy(phoneNumber: string) {
    setBusy(phoneNumber);
    try {
      await api('/numbers/buy', { method: 'POST', body: { areaCode, phoneNumber } });
      setBuyOpen(false);
      setAvailable(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setBusy(null);
    }
  }

  async function assign() {
    if (!assigning || !assignUserId) return;
    setBusy(assigning.phoneNumber);
    try {
      await api(`/users/${assignUserId}/telnyx-line`, {
        method: 'POST',
        body: { phoneNumber: assigning.phoneNumber },
      });
      setAssigning(null);
      setAssignUserId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setBusy(null);
    }
  }

  async function unassign(number: AccountNumber) {
    if (!number.assignedTo) return;
    if (!window.confirm(`Remove ${number.phoneNumber} from ${number.assignedTo.name}?`)) return;
    setBusy(number.phoneNumber);
    try {
      await api(`/users/${number.assignedTo.id}/telnyx-line`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unassign');
    } finally {
      setBusy(null);
    }
  }

  async function makeBoardLine(number: AccountNumber) {
    if (
      !window.confirm(
        `Make ${number.phoneNumber} the board line? Callers will hear the extension menu.`,
      )
    )
      return;
    setBusy(number.phoneNumber);
    try {
      await api('/numbers/board-line', {
        method: 'POST',
        body: { phoneNumber: number.phoneNumber },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the board line');
    } finally {
      setBusy(null);
    }
  }

  const withDigits = users.filter((u) => u.providerConfig?.ivrDigit);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Phone Numbers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Buy numbers, give recruiters direct lines, and choose the board line.
          </p>
        </div>
        <Button onClick={() => setBuyOpen(true)}>Buy number</Button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <Card className="mt-5">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : !numbers || numbers.length === 0 ? (
          <EmptyState title="No numbers yet" subtitle="Buy your first US number to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Number</Th>
                  <Th>Used for</Th>
                  <Th>Assigned to</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {numbers.map((n) => (
                  <tr key={n.phoneNumber} className="hover:bg-slate-50">
                    <Td>
                      <span className="font-medium text-slate-900">{n.phoneNumber}</span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {n.isBoardLine && <Tag tone="brand">Board line (IVR)</Tag>}
                        {n.isDefaultCallerId && <Tag tone="slate">Default caller ID</Tag>}
                        {n.assignedTo && <Tag tone="emerald">Direct line</Tag>}
                        {!n.isBoardLine && !n.isDefaultCallerId && !n.assignedTo && (
                          <span className="text-slate-400">Spare</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {n.assignedTo ? (
                        <div>
                          <p className="font-medium text-slate-900">{n.assignedTo.name}</p>
                          <p className="text-xs text-slate-400">{n.assignedTo.email}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {n.assignedTo ? (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy === n.phoneNumber}
                            onClick={() => unassign(n)}
                          >
                            Unassign
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy === n.phoneNumber}
                            onClick={() => {
                              setAssigning(n);
                              setAssignUserId('');
                            }}
                          >
                            Assign to user
                          </Button>
                        )}
                        {!n.isBoardLine && (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy === n.phoneNumber}
                            onClick={() => makeBoardLine(n)}
                          >
                            {busy === n.phoneNumber ? 'Working…' : 'Make board line'}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Board-line menu</h2>
        <p className="mt-1 text-xs text-slate-500">
          Callers to the board line hear these options. Set a user&apos;s digit in Users → Edit →
          Board-line menu digit.
        </p>
        {withDigits.length === 0 ? (
          <p className="mt-3 text-sm text-amber-600">
            No extensions yet — callers will be told no agents are configured.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {withDigits
              .sort((a, b) =>
                String(a.providerConfig?.ivrDigit).localeCompare(String(b.providerConfig?.ivrDigit)),
              )
              .map((u) => (
                <li key={u.id} className="flex items-center gap-3 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-50 text-xs font-bold text-brand-700">
                    {u.providerConfig?.ivrDigit}
                  </span>
                  <span className="font-medium text-slate-800">{u.name}</span>
                  <span className="text-xs text-slate-400">
                    {u.providerConfig?.telnyxNumber
                      ? `rings ${u.providerConfig.telnyxNumber}`
                      : u.mobileNumber
                        ? `rings ${u.mobileNumber}`
                        : 'no destination — assign a direct line'}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {/* Buy */}
      <Modal open={buyOpen} title="Buy a US number" onClose={() => setBuyOpen(false)} wide>
        <div className="col-span-full">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Area code</label>
              <Select value={areaCode} onChange={(e) => setAreaCode(e.target.value)}>
                {AREA_CODES.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={searchNumbers} disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>

          {available && (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
              {available.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No numbers found in {areaCode}.</p>
              ) : (
                available.map((a) => (
                  <div
                    key={a.phoneNumber}
                    className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 last:border-0"
                  >
                    <div>
                      <p className="font-medium text-slate-900">{a.phoneNumber}</p>
                      <p className="text-xs text-slate-500">
                        ${a.upfrontCost} up front · ${a.monthlyCost}/month
                      </p>
                    </div>
                    <Button
                      className="!px-3 !py-1.5 text-xs"
                      disabled={busy === a.phoneNumber}
                      onClick={() => buy(a.phoneNumber)}
                    >
                      {busy === a.phoneNumber ? 'Buying…' : 'Buy'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Assign */}
      <Modal
        open={assigning !== null}
        title={`Assign ${assigning?.phoneNumber ?? ''}`}
        onClose={() => setAssigning(null)}
      >
        <div className="col-span-full">
          <p className="mb-3 text-sm text-slate-600">
            Calls to this number will ring the user&apos;s browser, and their outbound calls will
            show it as caller ID.
          </p>
          <Select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
            <option value="">Select a user…</option>
            {users
              .filter((u) => !u.providerConfig?.telnyxNumber)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
          </Select>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssigning(null)}>
              Cancel
            </Button>
            <Button onClick={assign} disabled={!assignUserId || busy !== null}>
              {busy ? 'Assigning…' : 'Assign'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'brand' | 'slate' | 'emerald' }) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-slate-600">{children}</td>;
}
