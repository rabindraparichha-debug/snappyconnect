'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { DISPOSITION_LABELS, DISPOSITION_COLORS } from '@/lib/types';
import type { CallDisposition } from '@/lib/types';
import { DialerPanel } from '@/components/DialerPanel';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';

interface ContactItem {
  id: string;
  phoneNumber: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  status: string;
}

interface Progress {
  total: number;
  pending: number;
  called: number;
  skipped: number;
  blocked: number;
}

interface ContactList {
  id: string;
  name: string;
  description: string | null;
}

export default function PowerDialerPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-8 w-8" /></div>}>
      <PowerDialer />
    </Suspense>
  );
}

function PowerDialer() {
  const params = useSearchParams();
  const listId = params.get('list');

  const [list, setList] = useState<ContactList | null>(null);
  const [current, setCurrent] = useState<ContactItem | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');

  const loadNext = useCallback(async () => {
    if (!listId) return;
    setLoading(true);
    try {
      const [next, prog] = await Promise.all([
        api<ContactItem | null>(`/contact-lists/${listId}/next`),
        api<Progress>(`/contact-lists/${listId}/progress`),
      ]);
      setCurrent(next);
      setProgress(prog);
      setNotes(next?.notes ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the next contact');
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    if (!listId) {
      setLoading(false);
      return;
    }
    api<ContactList[]>('/contact-lists')
      .then((all) => setList(all.find((l) => l.id === listId) ?? null))
      .catch(() => setList(null));
    loadNext();
  }, [listId, loadNext]);

  /** Record the outcome on the list item, then pull up the next contact. */
  async function advance(status: 'called' | 'skipped', disposition?: CallDisposition) {
    if (!current) return;
    setSaving(true);
    try {
      await api(`/contact-lists/items/${current.id}`, {
        method: 'PATCH',
        body: { status, notes: notes.trim() || undefined },
      });
      // The disposition belongs on the call record, which the dialer logs by
      // number — so only tag it when there is a call to tag.
      if (disposition) {
        const recent = await api<{ items: Array<{ id: string }> }>('/calls', {
          query: { q: current.phoneNumber, limit: 1 },
        });
        const callId = recent.items[0]?.id;
        if (callId) {
          await api(`/calls/${callId}`, { method: 'PATCH', body: { disposition } });
        }
      }
      await loadNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!listId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Power Dialer</h1>
        <Card className="mt-6">
          <EmptyState
            title="No list selected"
            subtitle="Pick a list from Contact Lists and hit Power Dial to start working through it."
          />
          <div className="flex justify-center pb-6">
            <Link
              href="/lists"
              className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Go to Contact Lists
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const pct = progress && progress.total > 0
    ? Math.round(((progress.called + progress.skipped) / progress.total) * 100)
    : 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Power Dialer</h1>
          <p className="mt-1 text-sm text-slate-500">
            {list ? list.name : 'Working through your list'}
          </p>
        </div>
        <Link href="/lists" className="text-sm font-medium text-brand-600 hover:text-brand-700">
          Back to lists
        </Link>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Progress */}
      {progress && (
        <Card className="mt-6 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">
              {progress.called + progress.skipped} of {progress.total} worked
            </span>
            <span className="text-slate-400">{progress.pending} remaining</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Called: {progress.called}</span>
            <span>Skipped: {progress.skipped}</span>
            {progress.blocked > 0 && <span className="text-rose-600">On DNC: {progress.blocked}</span>}
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-24"><Spinner className="h-8 w-8" /></div>
      ) : !current ? (
        <Card className="mt-6">
          <EmptyState
            title="List complete"
            subtitle="Every contact in this list has been called or skipped."
          />
          <div className="flex justify-center gap-2 pb-6">
            <Link
              href="/lists"
              className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Back to lists
            </Link>
          </div>
        </Card>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Current contact */}
          <Card className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Now calling</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              {current.name || current.phoneNumber}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{current.phoneNumber}</p>
            {current.email && <p className="text-sm text-slate-500">{current.email}</p>}

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="What came out of this call?"
                className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
              />
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Log outcome and move on
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(DISPOSITION_LABELS) as CallDisposition[]).map((d) => (
                  <button
                    key={d}
                    disabled={saving}
                    onClick={() => advance('called', d)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-80 disabled:opacity-50 ${DISPOSITION_COLORS[d]}`}
                  >
                    {DISPOSITION_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <Button variant="secondary" disabled={saving} onClick={() => advance('skipped')}>
                Skip
              </Button>
              <Button disabled={saving} onClick={() => advance('called')}>
                Mark called
              </Button>
            </div>
          </Card>

          {/* Dialer, pre-filled with this contact */}
          <Card className="p-5">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Dialer</p>
            <DialerPanel key={current.id} initialNumber={current.phoneNumber} />
          </Card>
        </div>
      )}
    </div>
  );
}
