'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Card, EmptyState, Input, Select, Spinner } from '@/components/ui';

type AuditAction =
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'user_status_changed'
  | 'settings_updated'
  | 'dnc_removed'
  | 'password_changed';

interface AuditEntry {
  id: string;
  action: AuditAction;
  summary: string;
  actorEmail: string | null;
  targetLabel: string | null;
  ipAddress: string | null;
  createdAt: string;
  actor?: { name: string } | null;
}

const ACTION_LABELS: Record<AuditAction, string> = {
  user_created: 'User created',
  user_updated: 'User updated',
  user_deleted: 'User deleted',
  user_status_changed: 'Status changed',
  settings_updated: 'Settings updated',
  dnc_removed: 'DNC removed',
  password_changed: 'Password changed',
};

const ACTION_STYLES: Record<AuditAction, string> = {
  user_created: 'bg-emerald-100 text-emerald-700',
  user_updated: 'bg-blue-100 text-blue-700',
  user_deleted: 'bg-rose-100 text-rose-700',
  user_status_changed: 'bg-amber-100 text-amber-700',
  settings_updated: 'bg-violet-100 text-violet-700',
  dnc_removed: 'bg-rose-100 text-rose-700',
  password_changed: 'bg-slate-200 text-slate-700',
};

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api<AuditEntry[]>('/audit', { query: { action, q, limit: 200 } }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the audit log');
    } finally {
      setLoading(false);
    }
  }, [action, q]);

  useEffect(() => {
    const timeout = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, q]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
      <p className="mt-1 text-sm text-slate-500">
        Who changed accounts, settings, and suppression records — and when.
      </p>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <Card className="mt-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search actor, target or description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="sm:col-span-2"
          />
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {(Object.keys(ACTION_LABELS) as AuditAction[]).map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            subtitle="Admin actions such as user and settings changes will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Actor</Th>
                  <Th>Description</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</Td>
                    <Td>
                      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${ACTION_STYLES[e.action] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {e.actor?.name ?? e.actorEmail ?? '—'}
                    </Td>
                    <Td className="text-slate-700">{e.summary}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-400">{e.ipAddress ?? '—'}</Td>
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
