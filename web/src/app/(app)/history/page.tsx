'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';
import type { CallLog, Paginated } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner } from '@/components/ui';

const LIMIT = 20;

export default function HistoryPage() {
  const [data, setData] = useState<Paginated<CallLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<Paginated<CallLog>>('/calls', {
        query: { q, provider, direction, status, from, to, page, limit: LIMIT },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call history');
    } finally {
      setLoading(false);
    }
  }, [q, provider, direction, status, from, to, page]);

  useEffect(() => {
    const timeout = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, q]);

  async function exportCsv() {
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
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `call-history-${new Date().toISOString().slice(0, 10)}.csv`;
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

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

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
                  <Th>Date &amp; Time</Th>
                  <Th>User</Th>
                  <Th>Phone Number</Th>
                  <Th>Provider</Th>
                  <Th>Direction</Th>
                  <Th>Duration</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50">
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
                    <Td className="font-medium text-slate-900">{call.phoneNumber}</Td>
                    <Td>{PROVIDER_LABELS[call.provider] ?? call.provider}</Td>
                    <Td className="capitalize">{call.direction}</Td>
                    <Td>{formatDuration(call.durationSeconds)}</Td>
                    <Td>
                      <Badge value={call.status} />
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
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </th>
  );
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-slate-600 ${className ?? ''}`}>{children}</td>;
}
