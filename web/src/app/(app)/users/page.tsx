'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type { CallingProvider, Paginated, Region, User } from '@/lib/types';
import { PROVIDER_LABELS, REGION_HINTS, REGION_LABELS, REGIONS } from '@/lib/types';
import { Badge, Button, Card, EmptyState, Input, Label, Modal, Select, Spinner } from '@/components/ui';

interface UserForm {
  name: string;
  email: string;
  password: string;
  mobileNumber: string;
  country: string;
  role: 'admin' | 'user';
  provider: '' | CallingProvider;
  telnyxCredentialId: string;
  ivrDigit: string;
  grandstreamExtension: string;
  sipUsername: string;
  sipPassword: string;
  regions: Region[];
}

const EMPTY_FORM: UserForm = {
  name: '',
  email: '',
  password: '',
  mobileNumber: '',
  country: '',
  role: 'user',
  provider: '',
  telnyxCredentialId: '',
  ivrDigit: '',
  grandstreamExtension: '',
  sipUsername: '',
  sipPassword: '',
  regions: [],
};

export default function UsersPage() {
  const me = getStoredUser();
  const [data, setData] = useState<Paginated<User> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [provisioning, setProvisioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<Paginated<User>>('/users', {
        query: { search, status: statusFilter, provider: providerFilter, limit: 100 },
      });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, providerFilter]);

  useEffect(() => {
    const timeout = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, search]);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(user: User) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      mobileNumber: user.mobileNumber ?? '',
      country: user.country ?? '',
      role: user.role,
      provider: user.provider ?? '',
      telnyxCredentialId: user.providerConfig?.telnyxCredentialId ?? '',
      ivrDigit: user.providerConfig?.ivrDigit ?? '',
      grandstreamExtension: user.providerConfig?.extension ?? '',
      sipUsername: user.providerConfig?.sipUsername ?? '',
      sipPassword: user.providerConfig?.sipPassword ?? '',
      regions: user.regions ?? [],
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const providerConfig: Record<string, string> = {};
    // Keep provisioned line details (number/connection) that the UI doesn't edit.
    if (editing?.providerConfig?.telnyxNumber) {
      providerConfig.telnyxNumber = editing.providerConfig.telnyxNumber;
      providerConfig.telnyxConnectionId = editing.providerConfig.telnyxConnectionId;
    }
    if (form.telnyxCredentialId) {
      providerConfig.telnyxCredentialId = form.telnyxCredentialId;
    }
    if (form.ivrDigit.trim()) {
      providerConfig.ivrDigit = form.ivrDigit.trim();
    }
    if (form.provider === 'grandstream' && form.grandstreamExtension) {
      providerConfig.extension = form.grandstreamExtension.trim();
    }
    if (form.provider === 'asterisk') {
      if (form.sipUsername) providerConfig.sipUsername = form.sipUsername.trim();
      if (form.sipPassword) providerConfig.sipPassword = form.sipPassword.trim();
    }

    const body: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      mobileNumber: form.mobileNumber || undefined,
      country: form.country || undefined,
      role: form.role,
      provider: form.provider || undefined,
      regions: form.regions,
      providerConfig: Object.keys(providerConfig).length ? providerConfig : undefined,
    };
    if (form.password) body.password = form.password;

    try {
      if (editing) {
        await api(`/users/${editing.id}`, { method: 'PATCH', body });
      } else {
        if (!form.password) throw new Error('Password is required for new users');
        await api('/users', { method: 'POST', body });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  /**
   * Gives the user their own US number so inbound calls ring their browser.
   * Reuses a spare number on the account, otherwise buys one ($1/month).
   */
  async function provisionLine(user: User) {
    setProvisioning(user.id);
    setError(null);
    try {
      // Never offer to buy just because the lookup failed — surface that error.
      const spare = await api<string[]>('/users/telnyx/available-numbers');
      const chosen = spare[0];
      const message = chosen
        ? `Assign ${chosen} to ${user.name} as their direct line?`
        : `No spare numbers on the account. Buy a new US number (about $1 up front, $1/month) for ${user.name}?`;
      if (!window.confirm(message)) return;

      await api(`/users/${user.id}/telnyx-line`, {
        method: 'POST',
        body: chosen ? { phoneNumber: chosen } : {},
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not assign a number');
    } finally {
      setProvisioning(null);
    }
  }

  async function toggleStatus(user: User) {
    const next = user.status === 'active' ? 'inactive' : 'active';
    await api(`/users/${user.id}/status`, { method: 'PATCH', body: { status: next } });
    await load();
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api(`/users/${deleting.id}`, { method: 'DELETE' });
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage accounts, status and calling provider assignments.
          </p>
        </div>
        <Button onClick={openAdd}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add User
        </Button>
      </div>

      <Card className="mt-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search name, email or mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="">All providers</option>
            <option value="telnyx">Telnyx (USA)</option>
            <option value="grandstream">Grandstream PBX (UAE)</option>
            <option value="native_dialer">Native Dialer (India)</option>
            <option value="asterisk">In-App SIP (UAE)</option>
          </Select>
        </div>
      </Card>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-rose-700">{error}</p>
          <p className="mt-1 text-xs text-rose-500">Only administrators can manage users.</p>
        </div>
      )}

      {!error && <Card className="mt-4 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No users found" subtitle="Add your first user to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Name</Th>
                  <Th>Mobile</Th>
                  <Th>Country</Th>
                  <Th>Provider</Th>
                  <Th>Direct line</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <Td>
                      <p className="font-medium text-slate-900">{user.name}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </Td>
                    <Td>{user.mobileNumber ?? '—'}</Td>
                    <Td>{user.country ?? '—'}</Td>
                    <Td>
                      {user.regions?.length ? (
                        <span className="flex flex-wrap gap-1">
                          {user.regions.map((r) => (
                            <span
                              key={r}
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                            >
                              {REGION_LABELS[r]}
                            </span>
                          ))}
                        </span>
                      ) : user.provider ? (
                        PROVIDER_LABELS[user.provider]
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </Td>
                    <Td>
                      {user.providerConfig?.telnyxNumber ? (
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-slate-700">
                            {user.providerConfig.telnyxNumber}
                          </span>
                          {user.providerConfig.ivrDigit && (
                            <span
                              title="Board-line menu digit"
                              className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700"
                            >
                              ext {user.providerConfig.ivrDigit}
                            </span>
                          )}
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 text-xs"
                          disabled={provisioning === user.id}
                          onClick={() => provisionLine(user)}
                        >
                          {provisioning === user.id ? 'Assigning…' : 'Assign number'}
                        </Button>
                      )}
                    </Td>
                    <Td className="capitalize">{user.role}</Td>
                    <Td>
                      <Badge value={user.status} />
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1" onClick={() => openEdit(user)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1"
                          onClick={() => toggleStatus(user)}
                          disabled={user.id === me?.id}
                        >
                          {user.status === 'active' ? 'Deactivate' : 'Activate'}
                        </Button>
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 !text-rose-600 hover:!bg-rose-50"
                          onClick={() => setDeleting(user)}
                          disabled={user.id === me?.id}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>}

      {/* Add / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add User'}
        wide
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Name</Label>
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <Label>{editing ? 'New Password (leave blank to keep)' : 'Password'}</Label>
            <Input
              type="password"
              minLength={8}
              required={!editing}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <Label>Mobile Number</Label>
            <Input
              type="tel"
              value={form.mobileNumber}
              onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })}
            />
          </div>
          <div>
            <Label>Country</Label>
            <Select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="">Select country…</option>
              <option value="USA">USA</option>
              <option value="UAE">UAE</option>
              <option value="India">India</option>
              <option value="Other">Other</option>
            </Select>
          </div>
          <div>
            <Label>Role</Label>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <div>
            <Label>Calling Provider</Label>
            <Select
              value={form.provider}
              onChange={(e) => setForm({ ...form, provider: e.target.value as UserForm['provider'] })}
            >
              <option value="">Unassigned</option>
              <option value="telnyx">Telnyx (USA)</option>
              <option value="grandstream">Grandstream PBX (UAE)</option>
              <option value="native_dialer">Native Dialer (India)</option>
              <option value="asterisk">In-App SIP (UAE)</option>
            </Select>
          </div>
          {(form.provider === 'telnyx' || form.regions.includes('usa')) && (
            <>
              <div>
                <Label>Telnyx Credential ID (optional)</Label>
                <Input
                  placeholder="Uses global credential if empty"
                  value={form.telnyxCredentialId}
                  onChange={(e) => setForm({ ...form, telnyxCredentialId: e.target.value })}
                />
              </div>
              <div>
                <Label>Board-line menu digit (optional)</Label>
                <Input
                  placeholder="1-9 — callers press this to reach them"
                  value={form.ivrDigit}
                  onChange={(e) => setForm({ ...form, ivrDigit: e.target.value })}
                />
              </div>
            </>
          )}

          <div className="col-span-full">
            <Label>Calling regions</Label>
            <p className="mb-2 text-xs text-slate-500">
              Which regions this user can call from in the app. Leave empty to use only the
              provider above.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {REGIONS.map((region) => {
                const checked = form.regions.includes(region);
                return (
                  <label
                    key={region}
                    className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors ${
                      checked
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={checked}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          regions: e.target.checked
                            ? [...form.regions, region]
                            : form.regions.filter((r) => r !== region),
                        })
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        {REGION_LABELS[region]}
                      </span>
                      <span className="block text-xs text-slate-500">{REGION_HINTS[region]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {(form.provider === 'grandstream' || form.regions.includes('uae')) && (
            <div>
              <Label>Wave Extension (optional)</Label>
              <Input
                placeholder="e.g. 1021 — uses shared extension if empty"
                value={form.grandstreamExtension}
                onChange={(e) => setForm({ ...form, grandstreamExtension: e.target.value })}
              />
            </div>
          )}

          {(form.provider === 'asterisk' || form.regions.includes('uae')) && (
            <>
              <div>
                <Label>SIP Username</Label>
                <Input
                  placeholder="e.g. 2001"
                  value={form.sipUsername}
                  onChange={(e) => setForm({ ...form, sipUsername: e.target.value })}
                />
              </div>
              <div>
                <Label>SIP Password</Label>
                <Input
                  type="password"
                  placeholder="From the Asterisk server accounts"
                  value={form.sipPassword}
                  onChange={(e) => setForm({ ...form, sipPassword: e.target.value })}
                />
              </div>
            </>
          )}

          {formError && (
            <p className="col-span-full rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </p>
          )}

          <div className="col-span-full mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create User'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete user?">
        <p className="text-sm text-slate-600">
          This permanently deletes <span className="font-semibold">{deleting?.name}</span>. Their
          call history is kept but unlinked. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </Modal>
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
