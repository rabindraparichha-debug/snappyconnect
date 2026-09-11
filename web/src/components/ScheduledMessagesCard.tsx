'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { Button, Card } from '@/components/ui';

interface Batch {
  id: string;
  message: string;
  scheduledAt: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  owner?: string;
}

interface Limits {
  maxContacts: number;
  maxMessageChars: number;
  dailyPerUser: number;
  dripIntervalSec: number;
  windowStartHour: number;
  windowEndHour: number;
}

/** The auto-appended opt-out notice counts toward billed length. */
const STOP_SUFFIX_CHARS = 25;
const GSM_SEGMENT = 153;

/**
 * Scheduled bulk texting, deliberately constrained: capped batch size and
 * message length, dripped over an hour, only inside US calling hours.
 */
export function ScheduledMessagesCard() {
  const user = getStoredUser();
  const [limits, setLimits] = useState<Limits | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState('');
  const [contactsText, setContactsText] = useState('');
  const [startAt, setStartAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api<Batch[]>('/sms/batches').then(setBatches).catch(() => setBatches([]));
  }, []);

  useEffect(() => {
    api<Limits>('/sms/batches/limits').then(setLimits).catch(() => null);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const contacts = useMemo(
    () =>
      contactsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [phone, ...name] = line.split(',');
          return { phone: phone.trim(), name: name.join(',').trim() || undefined };
        }),
    [contactsText],
  );

  const segments = Math.max(1, Math.ceil((message.length + STOP_SUFFIX_CHARS) / GSM_SEGMENT));
  const estCost = ((segments * contacts.length * 1.2) / 100).toFixed(2);
  const overContacts = limits ? contacts.length > limits.maxContacts : false;
  const dripMinutes = limits ? Math.ceil((contacts.length * limits.dripIntervalSec) / 60) : 0;

  async function create() {
    if (!message.trim() || !contacts.length || !startAt) {
      setNote({ ok: false, text: 'Message, contacts and a start time are all required.' });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      await api('/sms/batches', {
        method: 'POST',
        body: { message: message.trim(), startAt: new Date(startAt).toISOString(), contacts },
      });
      setNote({ ok: true, text: `Scheduled ${contacts.length} messages.` });
      setMessage('');
      setContactsText('');
      setStartAt('');
      load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'Scheduling failed' });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(batch: Batch) {
    if (!window.confirm('Cancel the remaining messages in this batch?')) return;
    try {
      await api(`/sms/batches/${batch.id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'Cancel failed' });
    }
  }

  if (!user?.regions?.includes('usa')) return null;

  return (
    <Card className="mt-6 p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        Scheduled Messages
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Text up to {limits?.maxContacts ?? 50} contacts, dripped out slowly instead of all at
        once. Sends only 8:00–21:00 US Eastern; opted-out numbers are skipped automatically.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Message — use {'{{name}}'} for the contact&apos;s name
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, limits?.maxMessageChars ?? 250))}
            rows={5}
            placeholder={'Hi {{name}}, I came across your profile and wanted to reach out about a job opportunity. Are you open to a quick chat?'}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-600"
          />
          <p className="mt-1 text-xs text-slate-400">
            {message.length}/{limits?.maxMessageChars ?? 250} characters · ≈{segments} segment
            {segments > 1 ? 's' : ''}/message ("Reply STOP to opt out" is added automatically)
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Contacts — one per line: number, name
          </label>
          <textarea
            value={contactsText}
            onChange={(e) => setContactsText(e.target.value)}
            rows={5}
            placeholder={'+15551234567, John\n+15559876543, Maria'}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-brand-500 dark:border-slate-600"
          />
          <p className={`mt-1 text-xs ${overContacts ? 'text-red-600' : 'text-slate-400'}`}>
            {contacts.length}/{limits?.maxContacts ?? 50} contacts
            {contacts.length > 0 && ` · sends over ~${dripMinutes} min · est. cost ~$${estCost}`}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div>
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Start at</label>
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
          />
        </div>
        <Button onClick={create} disabled={busy || overContacts} className="self-end">
          {busy ? 'Scheduling…' : '📨 Schedule batch'}
        </Button>
        {note && (
          <p className={`self-end text-sm ${note.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {note.text}
          </p>
        )}
      </div>

      {batches.length > 0 && (
        <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200 pt-2 dark:divide-slate-700 dark:border-slate-700">
          {batches.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-800 dark:text-slate-200">{b.message}</p>
                <p className="text-xs text-slate-400">
                  {new Date(b.scheduledAt).toLocaleString()}
                  {b.owner ? ` · ${b.owner}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-500">
                {b.sent}/{b.total} sent
                {b.skipped > 0 && ` · ${b.skipped} skipped`}
                {b.failed > 0 && ` · ${b.failed} failed`}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {b.status}
              </span>
              {(b.status === 'scheduled' || b.status === 'sending') && (
                <Button
                  variant="secondary"
                  className="!px-2 !py-1 text-xs shrink-0"
                  onClick={() => cancel(b)}
                >
                  Cancel
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
