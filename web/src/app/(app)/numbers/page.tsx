'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Paginated, User } from '@/lib/types';
import { Button, Card, EmptyState, Input, Modal, Select, Spinner } from '@/components/ui';
import { SimPortsCard } from '@/components/SimPortsCard';

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

interface Extension {
  digit: string;
  userId: string;
  name: string;
  email: string;
  ringsTo: string | null;
  voicemailGreeting: string;
  forwardTo: string;
  forwardEnabled: boolean;
  ringSeconds: number;
}

interface IvrConfig {
  boardLineNumber: string | null;
  greeting: string;
  operatorUserId: string | null;
  extensions: Extension[];
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

  // Board-line IVR: greeting, operator, and the extension list.
  const [ivr, setIvr] = useState<IvrConfig | null>(null);
  const [greeting, setGreeting] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [savingIvr, setSavingIvr] = useState(false);
  const [ivrSaved, setIvrSaved] = useState(false);
  const [newExtUser, setNewExtUser] = useState('');
  const [newExtDigit, setNewExtDigit] = useState('');

  // Per-recruiter answering rules: voicemail greeting and call forwarding.
  const [editingExt, setEditingExt] = useState<Extension | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // The number list comes from Telnyx and fails when credentials are missing;
    // greetings and extensions live in our own database, so they must still load.
    const [nums, userList, ivrConfig] = await Promise.allSettled([
      api<AccountNumber[]>('/numbers'),
      api<Paginated<User>>('/users', { query: { limit: 100 } }),
      api<IvrConfig>('/numbers/ivr'),
    ]);

    if (nums.status === 'fulfilled') setNumbers(nums.value);
    if (userList.status === 'fulfilled') setUsers(userList.value.items);
    if (ivrConfig.status === 'fulfilled') {
      setIvr(ivrConfig.value);
      setGreeting(ivrConfig.value.greeting);
      setOperatorId(ivrConfig.value.operatorUserId ?? '');
    }

    const failure = [nums, userList, ivrConfig].find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    setError(
      failure
        ? failure.reason instanceof Error
          ? failure.reason.message
          : 'Some settings could not be loaded'
        : null,
    );
    setLoading(false);
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

  async function saveIvr() {
    setSavingIvr(true);
    setError(null);
    try {
      const updated = await api<IvrConfig>('/numbers/ivr', {
        method: 'POST',
        body: { ivrGreeting: greeting, operatorUserId: operatorId || null },
      });
      setIvr(updated);
      setIvrSaved(true);
      setTimeout(() => setIvrSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the greeting');
    } finally {
      setSavingIvr(false);
    }
  }

  async function addExtension() {
    if (!newExtUser || !newExtDigit) return;
    setSavingIvr(true);
    setError(null);
    try {
      const updated = await api<IvrConfig>('/numbers/extensions', {
        method: 'POST',
        body: { userId: newExtUser, digit: newExtDigit },
      });
      setIvr(updated);
      setNewExtUser('');
      setNewExtDigit('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the extension');
    } finally {
      setSavingIvr(false);
    }
  }

  async function removeExtension(ext: Extension) {
    if (!window.confirm(`Remove extension ${ext.digit} (${ext.name})?`)) return;
    setSavingIvr(true);
    try {
      const updated = await api<IvrConfig>(`/numbers/extensions/${ext.userId}`, {
        method: 'DELETE',
      });
      setIvr(updated);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the extension');
    } finally {
      setSavingIvr(false);
    }
  }

  const usedDigits = new Set(ivr?.extensions.map((e) => e.digit) ?? []);
  const freeDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].filter((d) => !usedDigits.has(d));

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Board-line menu (IVR)</h2>
          {ivr?.boardLineNumber ? (
            <span className="text-xs text-slate-500">
              Callers to <span className="font-medium">{ivr.boardLineNumber}</span> hear this
            </span>
          ) : (
            <span className="text-xs text-amber-600">
              No board line set — use “Make board line” above
            </span>
          )}
        </div>

        {/* Greeting */}
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">Greeting</label>
          <textarea
            rows={3}
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            <code className="rounded bg-slate-100 px-1">{'{options}'}</code> is replaced with the
            live extension list (“For Alex, press 1.”). Callers who press nothing go to the
            operator.
          </p>
        </div>

        {/* Operator */}
        <div className="mt-4 max-w-sm">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Operator (answers when no digit is pressed)
          </label>
          <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
            <option value="">First extension (default)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.providerConfig?.telnyxNumber
                  ? ` — ${u.providerConfig.telnyxNumber}`
                  : u.mobileNumber
                    ? ` — ${u.mobileNumber}`
                    : ' — no number yet'}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveIvr} disabled={savingIvr}>
            {savingIvr ? 'Saving…' : 'Save greeting'}
          </Button>
          {ivrSaved && <span className="text-xs text-emerald-600">Saved</span>}
        </div>

        {/* Extensions */}
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Extensions</h3>
          {!ivr || ivr.extensions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No extensions yet — every caller goes straight to the operator.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {ivr.extensions.map((ext) => (
                <li key={ext.userId} className="flex items-center gap-3 py-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-brand-50 text-sm font-bold text-brand-700">
                    {ext.digit}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{ext.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {ext.ringsTo ? `rings ${ext.ringsTo}` : 'no destination — assign a number'}
                    </p>
                  </div>
                  {ext.forwardEnabled && ext.forwardTo && <Tag tone="brand">forwarding</Tag>}
                  {!ext.ringsTo && !ext.forwardEnabled && <Tag tone="slate">needs number</Tag>}
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 text-xs"
                    onClick={() => setEditingExt(ext)}
                  >
                    Answering rules
                  </Button>
                  <Button
                    variant="ghost"
                    className="!px-2 !py-1 text-xs"
                    disabled={savingIvr}
                    onClick={() => removeExtension(ext)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-600">User</label>
              <Select value={newExtUser} onChange={(e) => setNewExtUser(e.target.value)}>
                <option value="">Select a user…</option>
                {users
                  .filter((u) => !usedDigits.has(String(u.providerConfig?.ivrDigit ?? '')))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
              </Select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-slate-600">Digit</label>
              <Select value={newExtDigit} onChange={(e) => setNewExtDigit(e.target.value)}>
                <option value="">—</option>
                {freeDigits.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={addExtension} disabled={!newExtUser || !newExtDigit || savingIvr}>
              Add extension
            </Button>
          </div>
        </div>
      </Card>

      <SimPortsCard users={users} />

      {editingExt && (
        <AnsweringRulesModal
          ext={editingExt}
          onClose={() => setEditingExt(null)}
          onSaved={(updated) => {
            setIvr(updated);
            setEditingExt(null);
          }}
        />
      )}

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

/**
 * How one recruiter's incoming calls are answered: where they ring (their own
 * line, or forwarded abroad) and what callers hear if nobody picks up.
 */
function AnsweringRulesModal({
  ext,
  onClose,
  onSaved,
}: {
  ext: Extension;
  onClose: () => void;
  onSaved: (config: IvrConfig) => void;
}) {
  const [greeting, setGreeting] = useState(ext.voicemailGreeting);
  const [forwardTo, setForwardTo] = useState(ext.forwardTo);
  const [forwardEnabled, setForwardEnabled] = useState(ext.forwardEnabled);
  const [ringSeconds, setRingSeconds] = useState(String(ext.ringSeconds));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const updated = await api<IvrConfig>(`/numbers/extensions/${ext.userId}`, {
        method: 'PATCH',
        body: {
          voicemailGreeting: greeting,
          forwardTo,
          forwardEnabled,
          ringSeconds: Number(ringSeconds) || 25,
        },
      });
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the answering rules');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Answering rules — ${ext.name}`} onClose={onClose} wide>
      <div className="col-span-full space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Voicemail greeting
          </label>
          <textarea
            rows={3}
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            placeholder={`You have reached ${ext.name}. Please leave a message after the tone.`}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <p className="mt-1 text-xs text-slate-500">
            Read aloud to callers who reach {ext.name}&rsquo;s voicemail. Leave blank to use the
            standard wording shown above.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={forwardEnabled}
              onChange={(e) => setForwardEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                Forward calls to another number
              </span>
              <span className="block text-xs text-slate-500">
                Rings this number instead of {ext.name}&rsquo;s own line — use it to reach a
                recruiter on their India mobile.
              </span>
            </span>
          </label>

          {forwardEnabled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Forward to
                </label>
                <Input
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Ring for (seconds)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={60}
                  value={ringSeconds}
                  onChange={(e) => setRingSeconds(e.target.value)}
                />
              </div>
              <p className="sm:col-span-2 text-xs text-amber-700">
                Forwarding to a phone number is billed by Telnyx as an outbound call for the whole
                conversation. Forwarding to the recruiter&rsquo;s SnappyConnect app instead costs
                nothing.
              </p>
            </div>
          )}
        </div>

        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      </div>
    </Modal>
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
