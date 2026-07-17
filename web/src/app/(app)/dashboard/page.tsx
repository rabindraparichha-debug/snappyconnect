'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { CallLog, DashboardStats, Paginated } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<DashboardStats>('/dashboard/stats'),
      api<Paginated<CallLog>>('/calls', { query: { limit: 5 } }),
    ])
      .then(([statsData, calls]) => {
        setStats(statsData);
        setRecent(calls.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const cards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0 },
    { label: 'Active Users', value: stats?.activeUsers ?? 0 },
    { label: "Today's Calls", value: stats?.todaysCalls ?? 0 },
    { label: 'Answered Calls', value: stats?.answeredCalls ?? 0 },
    { label: 'Missed Calls', value: stats?.missedCalls ?? 0 },
    {
      label: 'Total Call Duration',
      value: formatDuration(stats?.totalCallDurationSeconds ?? 0),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Today&apos;s calling activity at a glance.</p>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.label} className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {card.label}
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{card.value}</p>
          </Card>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-semibold text-slate-900">Recent Calls</h2>
      <Card className="mt-3 overflow-hidden">
        {recent.length === 0 ? (
          <EmptyState title="No calls yet" subtitle="Calls will appear here once you start dialing." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Number</Th>
                  <Th>Provider</Th>
                  <Th>Direction</Th>
                  <Th>Duration</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {recent.map((call) => (
                  <tr key={call.id}>
                    <Td>{formatDateTime(call.startedAt ?? call.createdAt)}</Td>
                    <Td>{call.user?.name ?? '—'}</Td>
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
