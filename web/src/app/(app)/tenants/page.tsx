'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Region, Tenant, TenantSeats, TenantStatus } from '@/lib/types';
import { REGIONS, REGION_LABELS } from '@/lib/types';
import { Button, Card, EmptyState, Input, Label, Modal, Spinner } from '@/components/ui';

interface TenantForm {
  name: string;
  slug: string;
  externalRef: string;
  billingEmail: string;
  seatLimit: string;
  regions: Region[];
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

const EMPTY_FORM: TenantForm = {
  name: '',
  slug: '',
  externalRef: '',
  billingEmail: '',
  seatLimit: '',
  regions: [],
  adminName: '',
  adminEmail: '',
  adminPassword: '',
};

const STATUS_TONE: Record<TenantStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  suspended: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  canceled: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

/** "Acme Recruiting Inc." -> "acme-recruiting-inc" */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * Platform operator's view of every customer: provision an account, adjust what
 * it bought, suspend it, and hand it numbers off the shared Telnyx account.
 */
export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [seats, setSeats] = useState<Record<string, TenantSeats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TenantForm>(EMPTY_FORM);
  // Once the operator edits the slug themselves, stop overwriting it from the name.
  const [slugTouched, setSlugTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [numberDraft, setNumberDraft] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api<Tenant[]>('/tenants');
      setTenants(list);
      setError(null);
      // Seat usage is a count per tenant, so it is fetched alongside rather
      // than blocking the list; a failure here must not blank the page.
      const usage = await Promise.all(
        list.map(async (t) => {
          try {
            return [t.id, await api<TenantSeats>(`/tenants/${t.id}/seats`)] as const;
          } catch {
            return [t.id, { used: 0, limit: t.seatLimit }] as const;
          }
        }),
      );
      setSeats(Object.fromEntries(usage));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setSlugTouched(false);
    setFormError(null);
    setModalOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api<Tenant>('/tenants', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          slug: (slugTouched ? form.slug : slugify(form.name)).trim(),
          externalRef: form.externalRef.trim() || undefined,
          billingEmail: form.billingEmail.trim() || undefined,
          seatLimit: form.seatLimit ? Number(form.seatLimit) : 0,
          regions: form.regions,
          adminName: form.adminName.trim(),
          adminEmail: form.adminEmail.trim(),
          adminPassword: form.adminPassword,
        },
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create the customer');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(tenant: Tenant, status: TenantStatus) {
    setRowBusy(tenant.id);
    setRowError(null);
    try {
      await api(`/tenants/${tenant.id}/status`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to change status');
    } finally {
      setRowBusy(null);
    }
  }

  async function reserveNumber(tenant: Tenant) {
    const phoneNumber = numberDraft.trim();
    if (!phoneNumber) return;
    setRowBusy(tenant.id);
    setRowError(null);
    try {
      await api(`/tenants/${tenant.id}/numbers`, { method: 'POST', body: { phoneNumber } });
      setNumberDraft('');
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to reserve the number');
    } finally {
      setRowBusy(null);
    }
  }

  async function releaseNumber(tenant: Tenant, phoneNumber: string) {
    setRowBusy(tenant.id);
    setRowError(null);
    try {
      await api(`/tenants/${tenant.id}/numbers/${encodeURIComponent(phoneNumber)}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Failed to release the number');
    } finally {
      setRowBusy(null);
    }
  }

  function toggleRegion(region: Region) {
    setForm((f) => ({
      ...f,
      regions: f.regions.includes(region)
        ? f.regions.filter((r) => r !== region)
        : [...f.regions, region],
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Each customer is an isolated account: their own users, call history, numbers and
            suppression list.
          </p>
        </div>
        <Button onClick={openAdd}>Add customer</Button>
      </div>

      {rowError && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-600/20">
          {rowError}
        </div>
      )}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <EmptyState title="Could not load customers" subtitle={error} />
      ) : !tenants || tenants.length === 0 ? (
        <EmptyState title="No customers yet" subtitle="Add one to get started." />
      ) : (
        <div className="space-y-3">
          {tenants.map((tenant) => {
            const usage = seats[tenant.id] ?? { used: 0, limit: tenant.seatLimit };
            const open = expanded === tenant.id;
            const busy = rowBusy === tenant.id;
            return (
              <Card key={tenant.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-slate-900">
                        {tenant.name}
                      </h3>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONE[tenant.status]}`}
                      >
                        {tenant.status === 'canceled' ? 'closed' : tenant.status}
                      </span>
                      {tenant.slug === 'default' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          platform
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">{tenant.slug}</p>
                    <p className="mt-2 text-sm text-slate-600">
                      {usage.limit === 0
                        ? `${usage.used} active user${usage.used === 1 ? '' : 's'} · no seat limit`
                        : `${usage.used} of ${usage.limit} seats used`}
                      {tenant.regions.length > 0 &&
                        ` · ${tenant.regions.map((r) => REGION_LABELS[r] ?? r).join(', ')}`}
                      {tenant.externalRef && ` · ATS ref ${tenant.externalRef}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setExpanded(open ? null : tenant.id);
                        setNumberDraft('');
                        setRowError(null);
                      }}
                    >
                      {open ? 'Hide numbers' : `Numbers (${tenant.reservedNumbers.length})`}
                    </Button>
                    {tenant.status === 'active' ? (
                      <Button
                        variant="secondary"
                        disabled={busy || tenant.slug === 'default'}
                        onClick={() => setStatus(tenant, 'suspended')}
                        // Suspending the platform tenant would lock the operator
                        // out of the very screen used to undo it.
                        title={
                          tenant.slug === 'default'
                            ? 'The platform account cannot be suspended'
                            : undefined
                        }
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button variant="secondary" disabled={busy} onClick={() => setStatus(tenant, 'active')}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                </div>

                {open && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <p className="text-xs text-slate-500">
                      Numbers on the shared Telnyx account reserved for this customer. With none
                      reserved, they are offered any unassigned number on the account.
                    </p>
                    <ul className="mt-3 divide-y divide-slate-100 text-sm">
                      {tenant.reservedNumbers.length === 0 ? (
                        <li className="py-2 text-slate-400">No numbers reserved.</li>
                      ) : (
                        tenant.reservedNumbers.map((number) => (
                          <li key={number} className="flex items-center justify-between py-2">
                            <span className="font-mono text-slate-800">{number}</span>
                            <button
                              className="text-xs font-medium text-rose-600 hover:text-rose-700 disabled:opacity-50"
                              disabled={busy}
                              onClick={() => releaseNumber(tenant, number)}
                            >
                              Release
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <div className="min-w-[14rem] flex-1">
                        <Label>Reserve a number</Label>
                        <Input
                          value={numberDraft}
                          onChange={(e) => setNumberDraft(e.target.value)}
                          placeholder="+13325551234"
                        />
                      </div>
                      <Button disabled={busy || !numberDraft.trim()} onClick={() => reserveNumber(tenant)}>
                        Reserve
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={modalOpen} title="Add customer" onClose={() => setModalOpen(false)} wide>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Company name</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Recruiting Inc."
              />
            </div>
            <div>
              <Label>Account ID</Label>
              <Input
                required
                value={slugTouched ? form.slug : slugify(form.name)}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm({ ...form, slug: e.target.value });
                }}
                placeholder="acme-recruiting"
              />
              <p className="mt-1 text-xs text-slate-500">
                Lowercase letters, digits and hyphens. Permanent once created.
              </p>
            </div>
            <div>
              <Label>Billing email</Label>
              <Input
                type="email"
                value={form.billingEmail}
                onChange={(e) => setForm({ ...form, billingEmail: e.target.value })}
              />
            </div>
            <div>
              <Label>Seat limit</Label>
              <Input
                type="number"
                min={0}
                value={form.seatLimit}
                onChange={(e) => setForm({ ...form, seatLimit: e.target.value })}
                placeholder="0 for unlimited"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>ATS company reference</Label>
              <Input
                value={form.externalRef}
                onChange={(e) => setForm({ ...form, externalRef: e.target.value })}
                placeholder="Optional — the company id in your ATS"
              />
            </div>
          </div>

          <div>
            <Label>Calling regions</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {REGIONS.map((region) => (
                <button
                  key={region}
                  type="button"
                  onClick={() => toggleRegion(region)}
                  className={`rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset ${
                    form.regions.includes(region)
                      ? 'bg-sky-50 text-sky-700 ring-sky-600/30'
                      : 'bg-white text-slate-600 ring-slate-300'
                  }`}
                >
                  {REGION_LABELS[region] ?? region}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-4">
            <h4 className="text-sm font-semibold text-slate-700">First administrator</h4>
            <p className="mb-3 mt-1 text-xs text-slate-500">
              Created with the account so somebody can sign in. They can add the rest of the team.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input
                  required
                  value={form.adminName}
                  onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  required
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Temporary password</Label>
                <Input
                  required
                  minLength={8}
                  value={form.adminPassword}
                  onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                  placeholder="At least 8 characters"
                />
              </div>
            </div>
          </div>

          {formError && <p className="text-sm text-rose-600">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
