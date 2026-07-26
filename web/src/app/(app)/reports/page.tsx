'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { Card, Spinner } from '@/components/ui';

interface TeamStats {
  totalCalls: number;
  connectedCalls: number;
  connectionRate: number;
  averageDurationSeconds: number;
  totalTalkTimeSeconds: number;
  byRecruiter: { userId: string; totalCalls: number; connectedCalls: number; talkTimeSeconds: number }[];
  byRegion: { value: string; count: number }[];
  byStatus: { value: string; count: number }[];
  byDirection: { value: string; count: number }[];
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  totalCalls: number;
  connectedCalls: number;
  talkTimeSeconds: number;
  uniqueContacts: number;
  connectionRate: number;
}

interface TrendPoint {
  period: string;
  total: number;
  connected: number;
  missed: number;
  talkTimeSeconds: number;
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

const STATUS_COLORS: Record<string, string> = {
  completed: '#059669',
  answered: '#059669',
  missed: '#D97706',
  no_answer: '#D97706',
  busy: '#E11D48',
  failed: '#EF4444',
  canceled: '#6B7280',
  initiated: '#94A3B8',
  ringing: '#3B82F6',
  in_progress: '#3B82F6',
};

const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  answered: 'Answered',
  missed: 'Missed',
  no_answer: 'No Answer',
  busy: 'Busy',
  failed: 'Failed',
  canceled: 'Canceled',
  initiated: 'Initiated',
  ringing: 'Ringing',
  in_progress: 'In Progress',
};

export default function ReportsPage() {
  const user = getStoredUser();
  const isAdmin = user?.role === 'admin';

  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const fetchData = (fromDate: string, toDate: string) => {
    setLoading(true);
    setError(null);
    const q = { from: fromDate, to: toDate };
    const endpoint = isAdmin ? '/analytics/team' : '/analytics/recruiter';
    const trendEndpoint = isAdmin ? '/analytics/team/trend' : '/analytics/recruiter/trend';

    const fetches: Promise<any>[] = [
      api(endpoint, { query: q }),
      api(trendEndpoint, { query: { ...q, granularity: 'day' } }),
    ];
    if (isAdmin) {
      fetches.push(api('/analytics/team/leaderboard', { query: { ...q, limit: 20 } }));
    }

    Promise.all(fetches)
      .then(([s, t, lb]) => {
        setStats(s);
        setTrend(t);
        if (lb) setLeaderboard(lb);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchData(from, to);
  }, []);

  const handleApply = () => fetchData(from, to);
  const handlePreset = (days: number) => {
    const d = new Date();
    const toDate = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() - days);
    const fromDate = d.toISOString().slice(0, 10);
    setFrom(fromDate);
    setTo(toDate);
    fetchData(fromDate, toDate);
  };

  const handleExportPdf = () => {
    const el = reportRef.current;
    if (!el) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>SnappyConnect Report</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1e293b; }
h1 { font-size: 20px; margin-bottom: 4px; }
h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; }
.subtitle { color: #64748b; font-size: 13px; margin-bottom: 20px; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
.stat-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
.stat-label { font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
.stat-value { font-size: 22px; font-weight: 700; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
th { text-align: left; padding: 8px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; font-size: 11px; text-transform: uppercase; color: #64748b; }
td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
.bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.bar-label { width: 100px; font-size: 12px; text-align: right; color: #475569; }
.bar-track { flex: 1; height: 18px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; }
.bar-value { width: 40px; font-size: 12px; font-weight: 600; }
@media print { body { padding: 0; } }
</style></head><body>`);

    printWindow.document.write(`<h1>SnappyConnect — Call Report</h1>`);
    printWindow.document.write(`<p class="subtitle">${from} to ${to}</p>`);

    if (stats) {
      printWindow.document.write(`<div class="grid">`);
      const cards = [
        { label: 'Total Calls', value: stats.totalCalls },
        { label: 'Connected', value: stats.connectedCalls },
        { label: 'Connection Rate', value: `${stats.connectionRate}%` },
        { label: 'Avg Duration', value: formatDuration(stats.averageDurationSeconds) },
        { label: 'Total Talk Time', value: formatDuration(stats.totalTalkTimeSeconds) },
        { label: 'Unique Contacts', value: leaderboard.reduce((s, e) => s + e.uniqueContacts, 0) },
      ];
      for (const c of cards) {
        printWindow.document.write(`<div class="stat-card"><div class="stat-label">${c.label}</div><div class="stat-value">${c.value}</div></div>`);
      }
      printWindow.document.write(`</div>`);

      if (stats.byStatus?.length) {
        const max = Math.max(...stats.byStatus.map((s) => s.count), 1);
        printWindow.document.write(`<h2>By Status</h2>`);
        for (const s of stats.byStatus) {
          const pct = ((s.count / max) * 100).toFixed(0);
          const color = STATUS_COLORS[s.value] ?? '#94A3B8';
          printWindow.document.write(`<div class="bar-row"><div class="bar-label">${STATUS_LABELS[s.value] ?? s.value}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="bar-value">${s.count}</div></div>`);
        }
      }
    }

    if (leaderboard.length > 0) {
      printWindow.document.write(`<h2>Team Leaderboard</h2><table><thead><tr><th>#</th><th>Recruiter</th><th>Total</th><th>Connected</th><th>Rate</th><th>Talk Time</th><th>Contacts</th></tr></thead><tbody>`);
      for (const e of leaderboard) {
        printWindow.document.write(`<tr><td>${e.rank}</td><td>${e.name}</td><td>${e.totalCalls}</td><td>${e.connectedCalls}</td><td>${e.connectionRate}%</td><td>${formatDuration(e.talkTimeSeconds)}</td><td>${e.uniqueContacts}</td></tr>`);
      }
      printWindow.document.write(`</tbody></table>`);
    }

    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div ref={reportRef}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isAdmin ? 'Team-wide' : 'Your'} calling analytics with export.
          </p>
        </div>
        <button
          onClick={handleExportPdf}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          <PrintIcon className="h-4 w-4" />
          Export PDF
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Date range controls */}
      <Card className="mt-6 flex flex-wrap items-center gap-3 p-4">
        <label className="text-sm font-medium text-slate-600">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <label className="text-sm font-medium text-slate-600">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button
          onClick={handleApply}
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Apply
        </button>
        <span className="mx-1 text-slate-300">|</span>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => handlePreset(p.days)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {p.label}
          </button>
        ))}
      </Card>

      {/* Summary stats */}
      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label="Total Calls" value={stats.totalCalls} />
          <StatCard label="Connected" value={stats.connectedCalls} />
          <StatCard label="Connection Rate" value={`${stats.connectionRate}%`} accent="emerald" />
          <StatCard label="Avg Duration" value={formatDuration(stats.averageDurationSeconds)} accent="blue" />
          <StatCard label="Talk Time" value={formatDuration(stats.totalTalkTimeSeconds)} accent="blue" />
        </div>
      )}

      {/* Trend chart */}
      {trend.length > 1 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Daily Trend</h2>
          <Card className="mt-3 p-5">
            <TrendChart data={trend} />
          </Card>
        </>
      )}

      {/* Breakdowns */}
      {stats && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* Status breakdown */}
          {stats.byStatus?.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Calls by Status</h3>
              <BarBreakdown data={stats.byStatus.map((s) => ({
                label: STATUS_LABELS[s.value] ?? s.value,
                value: s.count,
                color: STATUS_COLORS[s.value] ?? '#94A3B8',
              }))} />
            </Card>
          )}

          {/* Direction breakdown */}
          {stats.byDirection?.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Calls by Direction</h3>
              <BarBreakdown data={stats.byDirection.map((d) => ({
                label: d.value === 'outbound' ? 'Outbound' : 'Inbound',
                value: d.count,
                color: d.value === 'outbound' ? '#2563EB' : '#7C3AED',
              }))} />
            </Card>
          )}

          {/* Region breakdown */}
          {stats.byRegion?.length > 0 && (
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">Calls by Region</h3>
              <BarBreakdown data={stats.byRegion.filter((r) => r.value).map((r) => ({
                label: (r.value ?? 'Unknown').toUpperCase(),
                value: r.count,
                color: r.value === 'india' ? '#F59E0B' : r.value === 'usa' ? '#2563EB' : r.value === 'uae' ? '#059669' : '#94A3B8',
              }))} />
            </Card>
          )}
        </div>
      )}

      {/* Leaderboard */}
      {isAdmin && leaderboard.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-semibold text-slate-900">Team Leaderboard</h2>
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
    </div>
  );
}

// ---------- Sub-components ----------

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[accent ?? ''] ?? 'bg-white border-slate-200'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function BarBreakdown({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-24 text-right text-xs font-medium text-slate-600">{d.label}</span>
          <div className="flex-1">
            <div className="h-5 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full rounded transition-all duration-500"
                style={{ width: `${(d.value / max) * 100}%`, backgroundColor: d.color }}
              />
            </div>
          </div>
          <span className="w-10 text-right text-xs font-bold tabular-nums text-slate-700">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length < 2) return null;

  const maxVal = Math.max(...data.map((d) => d.total), 1);
  const w = 700;
  const h = 200;
  const pad = { top: 10, right: 10, bottom: 28, left: 36 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const xStep = chartW / (data.length - 1);
  const scale = (v: number) => chartH - (v / maxVal) * chartH;

  const makePath = (key: 'total' | 'connected' | 'missed') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${pad.left + i * xStep},${pad.top + scale(d[key])}`).join(' ');

  const totalPath = makePath('total');
  const connPath = makePath('connected');
  const missedPath = makePath('missed');

  const areaPath = totalPath + ` L${pad.left + (data.length - 1) * xStep},${pad.top + chartH} L${pad.left},${pad.top + chartH} Z`;

  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: 220 }}>
        {yTicks.map((v) => {
          const y = pad.top + scale(v);
          return (
            <g key={v}>
              <line x1={pad.left} y1={y} x2={w - pad.right} y2={y} stroke="#E2E8F0" strokeWidth="1" />
              <text x={pad.left - 4} y={y + 3} textAnchor="end" fontSize="10" fill="#94A3B8">{v}</text>
            </g>
          );
        })}
        <path d={areaPath} fill="#3B82F6" opacity="0.06" />
        <path d={totalPath} fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinejoin="round" />
        <path d={connPath} fill="none" stroke="#059669" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 3" />
        <path d={missedPath} fill="none" stroke="#D97706" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="2 3" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={pad.left + i * xStep} cy={pad.top + scale(d.total)} r="3" fill="#3B82F6" />
          </g>
        ))}
        {data.filter((_, i) => i % Math.ceil(data.length / 7) === 0 || i === data.length - 1).map((d) => {
          const idx = data.indexOf(d);
          const x = pad.left + idx * xStep;
          const label = new Date(d.period).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return <text key={idx} x={x} y={h - 4} textAnchor="middle" fontSize="10" fill="#94A3B8">{label}</text>;
        })}
      </svg>
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-blue-500" /> Total
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-emerald-500" /> Connected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded border-t border-dashed border-amber-500" /> Missed
        </span>
      </div>
    </div>
  );
}

function PrintIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m0 0a48.159 48.159 0 018.5 0m-8.5 0V6.375c0-.621.504-1.125 1.125-1.125h6.75c.621 0 1.125.504 1.125 1.125v1.659" />
    </svg>
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
