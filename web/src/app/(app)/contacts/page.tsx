'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CallLog, ContactTimeline, Paginated } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Spinner } from '@/components/ui';

const LIMIT = 20;

export default function ContactsPage() {
  const [data, setData] = useState<Paginated<ContactTimeline> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [history, setHistory] = useState<CallLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<Paginated<ContactTimeline>>('/calls/contacts', {
        query: { q, page, limit: LIMIT },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [q, page]);

  useEffect(() => {
    const timeout = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, q]);

  async function openTimeline(phone: string) {
    setSelectedPhone(phone);
    setHistoryLoading(true);
    try {
      const calls = await api<CallLog[]>(`/calls/contacts/${encodeURIComponent(phone)}`);
      setHistory(calls);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Contacts</h1>
      <p className="mt-1 text-sm text-slate-500">
        All phone numbers you&apos;ve called, grouped with communication history.
      </p>

      <Card className="mt-5 p-4">
        <Input
          placeholder="Search phone number or contact name…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
      </Card>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Contact list */}
        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-7 w-7" />
            </div>
          ) : !data || data.items.length === 0 ? (
            <EmptyState title="No contacts found" subtitle="Call history will appear here." />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.items.map((contact) => (
                <button
                  key={contact.phoneNumber}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    selectedPhone === contact.phoneNumber ? 'bg-brand-50' : ''
                  }`}
                  onClick={() => openTimeline(contact.phoneNumber)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {contact.contactName || contact.phoneNumber}
                      </p>
                      {contact.contactName && (
                        <p className="text-xs text-slate-400">{contact.phoneNumber}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">{contact.totalCalls} calls</p>
                      <p className="text-xs text-slate-400">
                        {contact.connectedCalls} connected
                      </p>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                    <span>Talk: {formatDuration(contact.totalTalkTime)}</span>
                    <span>Last: {formatDateTime(contact.lastCallAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {data && data.total > LIMIT && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
              <span>Page {page} / {totalPages}</span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Prev
                </Button>
                <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Timeline */}
        <Card className="overflow-hidden">
          {!selectedPhone ? (
            <EmptyState title="Select a contact" subtitle="Click a contact to see their call timeline." />
          ) : historyLoading ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-7 w-7" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState title="No calls" subtitle="No call history with this contact." />
          ) : (
            <div>
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  Timeline: {history[0]?.contactName || selectedPhone}
                </h3>
                <p className="text-xs text-slate-500">{history.length} calls</p>
              </div>
              <div className="divide-y divide-slate-100">
                {history.map((call) => (
                  <div key={call.id} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${
                          call.direction === 'outbound' ? 'bg-blue-500' : 'bg-violet-500'
                        }`} />
                        <span className="text-sm font-medium text-slate-900 capitalize">
                          {call.direction}
                        </span>
                        <Badge value={call.status} />
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatDuration(call.durationSeconds)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(call.startedAt ?? call.createdAt)}
                      {' · '}
                      {PROVIDER_LABELS[call.provider] ?? call.provider}
                    </p>
                    {call.notes && (
                      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        {call.notes}
                      </p>
                    )}
                    {call.recordingUrl && (
                      <audio controls className="mt-1 h-8 w-full" src={call.recordingUrl} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
