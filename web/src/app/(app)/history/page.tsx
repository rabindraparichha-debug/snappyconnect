'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, API_URL, getToken } from '@/lib/api';
import type { CallDisposition, CallLog, Paginated } from '@/lib/types';
import { DISPOSITION_COLORS, DISPOSITION_LABELS, PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner } from '@/components/ui';

const LIMIT = 20;

const QUICK_NOTES = [
  'Candidate interested',
  'Left voicemail',
  'Schedule interview',
  'Send job description',
  'Not available now',
  'Will call back',
  'Offer discussed',
  'Wrong number',
];

export default function HistoryPage() {
  const router = useRouter();
  const [data, setData] = useState<Paginated<CallLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CallLog | null>(null);

  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [disposition, setDisposition] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Quick actions from a row: call back, or text the same number.
  const [messageTo, setMessageTo] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messageSent, setMessageSent] = useState(false);

  // Bulk selection
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkFollowUp, setBulkFollowUp] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<Paginated<CallLog>>('/calls', {
        query: { q, provider, direction, status, disposition, from, to, page, limit: LIMIT },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call history');
    } finally {
      setLoading(false);
    }
  }, [q, provider, direction, status, disposition, from, to, page]);

  useEffect(() => {
    const timeout = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, q]);

  async function exportCsv() {
    const url = new URL(API_URL + '/calls/export');
    for (const [key, value] of Object.entries({ q, provider, direction, status, disposition, from, to })) {
      if (value) url.searchParams.set(key, value);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      setError('Export failed');
      return;
    }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function toggleCheck(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!data) return;
    if (checked.size === data.items.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(data.items.map((c) => c.id)));
    }
  }

  async function bulkApply() {
    if (checked.size === 0) return;
    setBulkSaving(true);
    setBulkMsg(null);
    try {
      const body: Record<string, unknown> = { ids: [...checked] };
      if (bulkNotes) body.notes = bulkNotes;
      if (bulkFollowUp) body.followUpDate = bulkFollowUp;
      const res = await api<{ updated: number }>('/calls/bulk', {
        method: 'PATCH',
        body,
      });
      setBulkMsg(`Updated ${res.updated} calls`);
      setBulkNotes('');
      setBulkFollowUp('');
      setChecked(new Set());
      await load();
      setTimeout(() => setBulkMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed');
    } finally {
      setBulkSaving(false);
    }
  }

  /** Redial a number from history using the normal dialer flow. */
  function callBack(phoneNumber: string) {
    router.push(`/dial?number=${encodeURIComponent(phoneNumber)}`);
  }

  function openMessage(phoneNumber: string) {
    setMessageTo(phoneNumber);
    setMessageBody('');
    setMessageError(null);
    setMessageSent(false);
  }

  async function sendMessage() {
    if (!messageTo || !messageBody.trim()) return;
    setSending(true);
    setMessageError(null);
    try {
      await api('/sms/send', { method: 'POST', body: { to: messageTo, body: messageBody.trim() } });
      setMessageSent(true);
      setMessageBody('');
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  }

  async function exportSelected() {
    if (checked.size === 0) return;
    const url = new URL(API_URL + '/calls/export');
    for (const [key, value] of Object.entries({ q, provider, direction, status, from, to })) {
      if (value) url.searchParams.set(key, value);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      setError('Export failed');
      return;
    }
    const text = await res.text();
    const lines = text.split('\n');
    const header = lines[0];
    const selectedIds = checked;
    const filtered = lines.filter((line, i) => {
      if (i === 0) return true;
      const id = line.split(',')[0]?.replace(/"/g, '');
      return selectedIds.has(id);
    });
    const blob = new Blob([filtered.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `call-history-selected-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Call History</h1>
          <p className="mt-1 text-sm text-slate-500">
            Search, filter and export your call records.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export CSV
        </Button>
      </div>

      <Card className="mt-5 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Input
            placeholder="Search number or user…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            className="col-span-2 md:col-span-1"
          />
          <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
            <option value="">All providers</option>
            <option value="telnyx">Telnyx</option>
            <option value="grandstream">Grandstream PBX</option>
            <option value="native_dialer">Native Dialer</option>
            <option value="asterisk">In-App SIP (UAE)</option>
          </Select>
          <Select value={direction} onChange={(e) => { setDirection(e.target.value); setPage(1); }}>
            <option value="">All directions</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="answered">Answered</option>
            <option value="missed">Missed</option>
            <option value="no_answer">No answer</option>
            <option value="busy">Busy</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
          </Select>
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
      </Card>

      {/* Disposition filter */}
      <Card className="mt-3 p-3">
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs font-medium text-slate-500">Disposition:</span>
          {(['', ...Object.keys(DISPOSITION_LABELS)] as ('' | CallDisposition)[]).map((d) => (
            <button
              key={d}
              onClick={() => { setDisposition(d); setPage(1); }}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                disposition === d
                  ? 'bg-brand-600 text-white'
                  : d ? DISPOSITION_COLORS[d] : 'bg-slate-100 text-slate-600'
              } hover:opacity-80`}
            >
              {d ? DISPOSITION_LABELS[d] : 'All'}
            </button>
          ))}
        </div>
      </Card>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Bulk toolbar */}
      {checked.size > 0 && (
        <Card className="mt-4 border-brand-200 bg-brand-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-brand-700">
              {checked.size} selected
            </span>
            <Input
              placeholder="Add notes to all…"
              value={bulkNotes}
              onChange={(e) => setBulkNotes(e.target.value)}
              className="w-48"
            />
            <Input
              type="date"
              value={bulkFollowUp}
              onChange={(e) => setBulkFollowUp(e.target.value)}
              className="w-40"
            />
            <Button onClick={bulkApply} disabled={bulkSaving || (!bulkNotes && !bulkFollowUp)}>
              {bulkSaving ? 'Applying…' : 'Apply'}
            </Button>
            <Button variant="secondary" onClick={exportSelected}>
              Export selected
            </Button>
            <Button variant="ghost" onClick={() => setChecked(new Set())}>
              Clear
            </Button>
            {bulkMsg && <span className="text-sm font-medium text-emerald-600">{bulkMsg}</span>}
          </div>
        </Card>
      )}

      <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No calls found" subtitle="Try adjusting your search or filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      checked={data.items.length > 0 && checked.size === data.items.length}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                  </Th>
                  <Th>Date &amp; Time</Th>
                  <Th>User</Th>
                  <Th>Phone Number</Th>
                  <Th>Provider</Th>
                  <Th>Direction</Th>
                  <Th>Duration</Th>
                  <Th>Status</Th>
                  <Th></Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((call) => (
                  <tr
                    key={call.id}
                    className={`cursor-pointer hover:bg-slate-50 ${checked.has(call.id) ? 'bg-brand-50/50' : ''}`}
                    onClick={() => setSelected(call)}
                  >
                    <Td>
                      <input
                        type="checkbox"
                        checked={checked.has(call.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleCheck(call.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      />
                    </Td>
                    <Td>{formatDateTime(call.startedAt ?? call.createdAt)}</Td>
                    <Td>
                      {call.user ? (
                        <div>
                          <p className="font-medium text-slate-900">{call.user.name}</p>
                          <p className="text-xs text-slate-400">{call.user.email}</p>
                        </div>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <p className="font-medium text-slate-900">{call.phoneNumber}</p>
                      {call.contactName && (
                        <p className="text-xs text-slate-400">{call.contactName}</p>
                      )}
                    </Td>
                    <Td>{PROVIDER_LABELS[call.provider] ?? call.provider}</Td>
                    <Td className="capitalize">{call.direction}</Td>
                    <Td>{formatDuration(call.durationSeconds)}</Td>
                    <Td>
                      <Badge value={call.status} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {call.disposition && (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${DISPOSITION_COLORS[call.disposition]}`}>
                            {DISPOSITION_LABELS[call.disposition]}
                          </span>
                        )}
                        {call.notes && <Pill>Notes</Pill>}
                        {call.followUpDate && <Pill>Follow-up</Pill>}
                        {call.recordingUrl && <Pill>Rec</Pill>}
                      </div>
                    </Td>
                    <Td onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <button
                          title={`Call ${call.phoneNumber}`}
                          onClick={() => callBack(call.phoneNumber)}
                          className="rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                        </button>
                        <button
                          title={`Message ${call.phoneNumber}`}
                          onClick={() => openMessage(call.phoneNumber)}
                          className="rounded-md p-1.5 text-brand-600 transition-colors hover:bg-brand-50"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                          </svg>
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.total > LIMIT && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
          <p>
            Page {page} of {totalPages} · {data.total} calls
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {selected && (
        <CallDetailDrawer
          call={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updated) => {
            setSelected(updated);
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    items: prev.items.map((c) => (c.id === updated.id ? updated : c)),
                  }
                : prev,
            );
          }}
        />
      )}

      <Modal
        open={messageTo !== null}
        title={`Message ${messageTo ?? ''}`}
        onClose={() => setMessageTo(null)}
      >
        <div className="col-span-full">
          {messageSent ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-6 text-center">
              <p className="text-sm font-medium text-emerald-800">Message sent</p>
              <p className="mt-1 text-xs text-emerald-700">
                Replies appear in Messages and notify the team.
              </p>
              <Button variant="secondary" className="mt-4" onClick={() => setMessageTo(null)}>
                Close
              </Button>
            </div>
          ) : (
            <>
              <textarea
                autoFocus
                rows={4}
                maxLength={1600}
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder="Type your message…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-slate-400">{messageBody.length}/1600</span>
                {messageError && <span className="text-xs text-rose-600">{messageError}</span>}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMessageTo(null)}>
                  Cancel
                </Button>
                <Button onClick={sendMessage} disabled={sending || !messageBody.trim()}>
                  {sending ? 'Sending…' : 'Send SMS'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}

function CallDetailDrawer({
  call,
  onClose,
  onUpdate,
}: {
  call: CallLog;
  onClose: () => void;
  onUpdate: (call: CallLog) => void;
}) {
  const [notes, setNotes] = useState(call.notes ?? '');
  const [contactName, setContactName] = useState(call.contactName ?? '');
  const [followUpDate, setFollowUpDate] = useState(call.followUpDate?.slice(0, 10) ?? '');
  const [callDisposition, setCallDisposition] = useState(call.disposition ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      const updated = await api<CallLog>(`/calls/log/${call.id}`, {
        method: 'PATCH',
        body: {
          notes: notes || undefined,
          contactName: contactName || undefined,
          followUpDate: followUpDate || undefined,
          disposition: callDisposition || undefined,
        },
      });
      onUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Call Details</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Phone" value={call.phoneNumber} />
            <Detail label="Direction" value={call.direction} />
            <Detail label="Status" value={<Badge value={call.status} />} />
            <Detail label="Duration" value={formatDuration(call.durationSeconds)} />
            <Detail label="Provider" value={PROVIDER_LABELS[call.provider] ?? call.provider} />
            <Detail label="Region" value={call.region?.toUpperCase() ?? '—'} />
            <Detail label="Source" value={call.source ?? '—'} />
            <Detail label="Ring Time" value={`${call.ringTimeSeconds ?? 0}s`} />
            <Detail label="Started" value={formatDateTime(call.startedAt)} />
            <Detail label="Ended" value={formatDateTime(call.endedAt)} />
          </div>

          {call.user && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-medium text-slate-500">Recruiter</p>
              <p className="text-sm font-semibold text-slate-900">{call.user.name}</p>
              <p className="text-xs text-slate-400">{call.user.email}</p>
            </div>
          )}

          {call.recordingUrl && (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500">Recording</p>
              <audio controls className="w-full" src={call.recordingUrl} />
            </div>
          )}

          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Disposition</label>
              <Select
                value={callDisposition}
                onChange={(e) => setCallDisposition(e.target.value as CallDisposition | '')}
              >
                <option value="">No disposition</option>
                {Object.entries(DISPOSITION_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Contact Name</label>
              <Input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. John Smith"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Notes</label>
              <div className="mb-1.5 flex flex-wrap gap-1">
                {QUICK_NOTES.map((qn) => (
                  <button
                    key={qn}
                    type="button"
                    onClick={() => setNotes((prev) => (prev ? prev + '\n' + qn : qn))}
                    className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200"
                  >
                    {qn}
                  </button>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this call…"
                rows={3}
                className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Follow-up Date</label>
              <Input
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {saved && (
                <span className="text-sm font-medium text-emerald-600">Saved</span>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <p className="mb-1 text-xs font-medium text-slate-500">Do Not Call</p>
            <p className="mb-2 text-xs text-slate-400">
              Blocks {call.phoneNumber} from being dialled again.
            </p>
            <Button
              variant="secondary"
              disabled={blocking || blocked}
              onClick={async () => {
                setBlocking(true);
                try {
                  await api('/dnc', {
                    method: 'POST',
                    body: { phoneNumber: call.phoneNumber, reason: 'Added from call history' },
                  });
                  setBlocked(true);
                } catch (err) {
                  setBlockError(err instanceof Error ? err.message : 'Could not block this number');
                } finally {
                  setBlocking(false);
                }
              }}
            >
              {blocked ? 'On Do Not Call list' : blocking ? 'Blocking…' : 'Add to Do Not Call'}
            </Button>
            {blockError && <p className="mt-2 text-xs text-rose-600">{blockError}</p>}
          </div>

          {call.aiSummary && (
            <div className="border-t border-slate-200 pt-4">
              <p className="mb-1 text-xs font-medium text-slate-500">AI Summary</p>
              <p className="text-sm text-slate-700">{call.aiSummary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900 capitalize">{value}</p>
    </div>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
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
function Td({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <td className={`px-4 py-3 text-slate-600 ${className ?? ''}`} onClick={onClick}>
      {children}
    </td>
  );
}
