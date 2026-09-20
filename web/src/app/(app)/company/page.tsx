'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type { OwnTenant } from '@/lib/types';
import { REGION_LABELS, isPlatformOperator } from '@/lib/types';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

const STATUS_COPY: Record<string, { label: string; tone: string; detail: string }> = {
  active: {
    label: 'Active',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    detail: 'Calling and messaging are available.',
  },
  suspended: {
    label: 'Suspended',
    tone: 'bg-amber-50 text-amber-800 ring-amber-600/20',
    detail: 'Sign-in is blocked while the account is suspended. Contact support to restore it.',
  },
  canceled: {
    label: 'Closed',
    tone: 'bg-rose-50 text-rose-700 ring-rose-600/20',
    detail: 'This account has been closed. History is retained but calling is off.',
  },
};

/**
 * The signed-in user's own company: plan, seat usage and the numbers set aside
 * for them. Read-only by design — name, seats and numbers are commercial terms,
 * so they are changed by the platform operator on the Customers screen rather
 * than self-served here.
 */
export default function CompanyPage() {
  const me = getStoredUser();
  const [tenant, setTenant] = useState<OwnTenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTenant(await api<OwnTenant>('/tenants/me'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !tenant) {
    return <EmptyState title="Company unavailable" subtitle={error ?? 'No company is linked to this account.'} />;
  }

  const status = STATUS_COPY[tenant.status] ?? STATUS_COPY.active;
  const { used, limit } = tenant.seats;
  const unmetered = limit === 0;
  // Guard the divide: an unmetered plan has no denominator to fill a bar with.
  const pct = unmetered ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const atCapacity = !unmetered && used >= limit;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{tenant.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your SnappyConnect account
          {isPlatformOperator(me?.role) ? ' (you are signed in as the platform operator)' : ''}.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Plan</h3>
          <dl className="space-y-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-slate-500">Status</dt>
              <dd className="text-right">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${status.tone}`}
                >
                  {status.label}
                </span>
                <p className="mt-1 max-w-xs text-xs text-slate-500">{status.detail}</p>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Account ID</dt>
              <dd className="font-mono text-xs text-slate-700">{tenant.slug}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Billing contact</dt>
              <dd className="text-slate-700">{tenant.billingEmail || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Calling regions</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {tenant.regions.length === 0 ? (
                  <span className="text-slate-400">None</span>
                ) : (
                  tenant.regions.map((r) => <Badge key={r} value={REGION_LABELS[r] ?? r} />)
                )}
              </dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Seats</h3>
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-slate-900">{used}</span>
              <span className="text-sm text-slate-500">
                {unmetered ? 'active users (no seat limit)' : `of ${limit} seats in use`}
              </span>
            </div>
            {!unmetered && (
              <>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${atCapacity ? 'bg-amber-500' : 'bg-sky-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {atCapacity
                    ? 'All seats are in use. Deactivate a user, or ask us to raise the seat count, before adding another.'
                    : `${limit - used} seat${limit - used === 1 ? '' : 's'} available.`}
                </p>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-700">Phone numbers</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Numbers set aside for your account. A recruiter&apos;s direct line is assigned from these.
        </p>
        {tenant.reservedNumbers.length === 0 ? (
          <p className="text-sm text-slate-500">
            No numbers are reserved specifically for your account yet. Contact support to have one
            assigned.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {tenant.reservedNumbers.map((number) => (
              <li key={number} className="flex items-center justify-between py-2">
                <span className="font-mono text-slate-800">{number}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
