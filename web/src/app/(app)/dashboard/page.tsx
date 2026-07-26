'use client';

import { useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type {
  CallLog,
  DashboardStats,
  FollowUp,
  LeaderboardEntry,
  Paginated,
  RecruiterStats,
  TrendPoint,
} from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

export default function DashboardPage() {
  const user = getStoredUser();
  const isAdmin = user?.role === 'admin';

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recent, setRecent] = useState<CallLog[]>([]);
  const [recruiter, setRecruiter] = useState<RecruiterStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetches: Promise<any>[] = [
      api<DashboardStats>('/dashboard/stats'),
      api<Paginated<CallLog>>('/calls', { query: { limit: 5 } }),
      api<RecruiterStats>('/analytics/recruiter'),
      api<TrendPoint[]>('/analytics/recruiter/trend', { query: { granularity: 'day' } }),
      api<FollowUp[]>('/calls/follow-ups', { query: { limit: 5 } }),
    ];
    if (isAdmin) {
      fetches.push(api<LeaderboardEntry[]>('/analytics/team/leaderboard', { query: { limit: 5 } }));
    }

    Promise.all(fetches)
      .then(([s, c, r, t, fu, lb]) => {
        setStats(s);
        setRecent(c.items);
        setRecruiter(r);
        setTrend(t);
        setFollowUps(fu);
        if (lb) setLeaderboard(lb);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const overviewCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0 },
    { label: 'Active Users', value: stats?.activeUsers ?? 0 },
    { label: "Today's Calls", value: stats?.todaysCalls ?? 0 },
    { label: 'Answered Calls', value: stats?.answeredCalls ?? 0 },
    { label: 'Missed Calls', value: stats?.missedCalls ?? 0 },
    { label: 'Total Duration', value: formatDuration(stats?.totalCallDurationSeconds ?? 0) },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">Today&apos;s calling activity at a glance.</p>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Overview cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {overviewCards.map((card) => (
          <Card key={card.label} className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{card.value}</p>
          </Card>
        ))}
      </div>

      {/* Recruiter performance */}
      {recruiter && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Your Performance</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label="Connection Rate" value={`${recruiter.connectionRate}%`} accent="emerald" />
            <StatCard label="Avg Duration" value={formatDuration(recruiter.averageDurationSeconds)} accent="blue" />
            <StatCard label="Total Talk Time" value={formatDuration(recruiter.totalTalkTimeSeconds)} accent="blue" />
            <StatCard label="Unique Contacts" value={recruiter.uniqueCandidatesContacted} accent="violet" />
            <StatCard label="Productivity" value={`${recruiter.productivityScore}/100`} accent={recruiter.productivityScore >= 60 ? 'emerald' : 'amber'} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniCard label="Today" value={recruiter.callsToday} />
            <MiniCard label="This Week" value={recruiter.callsThisWeek} />
            <MiniCard label="This Month" value={recruiter.callsThisMonth} />
            <MiniCard label="Avg/Hour" value={recruiter.avgCallsPerHour} />
          </div>
        </>
      )}

      {/* Call Trend Chart */}
      {trend.length > 1 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Call Trend (30 days)</h2>
          <Card className="mt-3 p-5">
            <TrendChart data={trend} />
          </Card>
        </>
      )}

      {/* Outcome breakdown */}
      {recruiter && recruiter.totalCalls > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Call Outcomes</h3>
            <OutcomeBar data={[
              { label: 'Connected', value: recruiter.connectedCalls, color: '#059669' },
              { label: 'Missed', value: recruiter.missedCalls, color: '#D97706' },
              { label: 'Busy', value: recruiter.busyCalls, color: '#E11D48' },
              { label: 'Rejected', value: recruiter.rejectedCalls, color: '#6B7280' },
            ]} total={recruiter.totalCalls} />
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Direction Split</h3>
            <OutcomeBar data={[
              { label: 'Outbound', value: recruiter.outboundCalls, color: '#2563EB' },
              { label: 'Inbound', value: recruiter.inboundCalls, color: '#7C3AED' },
            ]} total={recruiter.totalCalls} />
          </Card>
        </div>
      )}

      {/* Leaderboard (admin) */}
      {isAdmin && leaderboard.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Top Recruiters</h2>
          <Card className="mt-3 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>#</Th>
                    <Th>Recruiter</Th>
                    <Th>Total Calls</Th>
                    <Th>Connected</Th>
                    <Th>Rate</Th>
                    <Th>Talk Time</Th>
                    <Th>Contacts</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {leaderboard.map((entry) => (
                    <tr key={entry.userId}>
                      <Td>
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          entry.rank === 1 ? 'bg-amber-100 text-amber-700'
                          : entry.rank === 2 ? 'bg-slate-200 text-slate-700'
                          : entry.rank === 3 ? 'bg-orange-100 text-orange-700'
                          : 'bg-slate-100 text-slate-500'
                        }`}>
                          {entry.rank}
                        </span>
                      </Td>
                      <Td>
                        <p className="font-medium text-slate-900">{entry.name}</p>
                        <p className="text-xs text-slate-400">{entry.email}</p>
                      </Td>
                      <Td className="font-semibold tabular-nums">{entry.totalCalls}</Td>
                      <Td className="tabular-nums">{entry.connectedCalls}</Td>
                      <Td className="tabular-nums">{entry.connectionRate}%</Td>
                      <Td className="tabular-nums">{formatDuration(entry.talkTimeSeconds)}</Td>
                      <Td className="tabular-nums">{entry.uniqueContacts}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Follow-up reminders */}
      {followUps.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Upcoming Follow-ups</h2>
          <Card className="mt-3 overflow-hidden">
            <div className="divide-y divide-slate-100">
              {followUps.map((fu) => {
                const isToday = fu.followUpDate?.slice(0, 10) === new Date().toISOString().slice(0, 10);
                const isPast = fu.followUpDate && new Date(fu.followUpDate) < new Date(new Date().toISOString().slice(0, 10));
                return (
                  <div key={fu.id} className="flex items-center gap-4 px-4 py-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      isPast ? 'bg-rose-100 text-rose-700' : isToday ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {isPast ? '!' : isToday ? 'T' : new Date(fu.followUpDate).getDate()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {fu.contactName || fu.phoneNumber}
                      </p>
                      {fu.notes && (
                        <p className="truncate text-xs text-slate-500">{fu.notes}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-semibold ${
                        isPast ? 'text-rose-600' : isToday ? 'text-amber-600' : 'text-slate-500'
                      }`}>
                        {isPast ? 'Overdue' : isToday ? 'Today' : new Date(fu.followUpDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-xs text-slate-400">{fu.phoneNumber}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* Recent calls */}
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
                    <Td><Badge value={call.status} /></Td>
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

// ---------- Sub-components ----------

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[accent] ?? colors.blue}`}>
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </Card>
  );
}

function OutcomeBar({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded-full bg-slate-100">
        {data.filter(d => d.value > 0).map((d) => (
          <div
            key={d.label}
            className="transition-all duration-500"
            style={{ width: `${(d.value / total) * 100}%`, backgroundColor: d.color }}
            title={`${d.label}: ${d.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {data.map((d) => (
          <span key={d.label} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            {d.label}: {d.value}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) return null;

  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const w = 700;
  const h = 180;
  const pad = { top: 10, right: 10, bottom: 24, left: 32 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const xStep = chartW / (data.length - 1);
  const scale = (v: number) => chartH - (v / maxVal) * chartH;

  const totalPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${pad.left + i * xStep},${pad.top + scale(d.total)}`).join(' ');
  const connPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${pad.left + i * xStep},${pad.top + scale(d.connected)}`).join(' ');

  const areaPath = totalPath + ` L${pad.left + (data.length - 1) * xStep},${pad.top + chartH} L${pad.left},${pad.top + chartH} Z`;

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 200 }}>
        {yTicks.map((v) => {
          const y = pad.top + scale(v);
          return (
            <g key={v}>
              <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="#E2E8F0" strokeWidth="1" />
              <text x={pad.left - 4} y={y + 3} textAnchor="end" fontSize="10" fill="#94A3B8">{v}</text>
            </g>
          );
        })}
        <path d={areaPath} fill="#3B82F6" opacity="0.08" />
        <path d={totalPath} fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinejoin="round" />
        <path d={connPath} fill="none" stroke="#059669" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
        {data.map((d, i) => {
          const x = pad.left + i * xStep;
          return (
            <g key={i}>
              <circle cx={x} cy={pad.top + scale(d.total)} r="3" fill="#3B82F6" />
              <circle cx={x} cy={pad.top + scale(d.connected)} r="2.5" fill="#059669" />
            </g>
          );
        })}
        {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0 || i === data.length - 1).map((d, _, arr) => {
          const idx = data.indexOf(d);
          const x = pad.left + idx * xStep;
          const label = new Date(d.period).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <text key={idx} x={x} y={h - 4} textAnchor="middle" fontSize="10" fill="#94A3B8">{label}</text>
          );
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-blue-500" /> Total Calls
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-emerald-500" /> Connected
        </span>
      </div>
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
