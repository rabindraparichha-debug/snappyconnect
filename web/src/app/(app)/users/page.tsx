'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type { CallingProvider, Paginated, User } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
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
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const providerConfig: Record<string, string> = {};
    if (form.provider === 'telnyx' && form.telnyxCredentialId) {
      providerConfig.telnyxCredentialId = form.telnyxCredentialId;
    }

    const body: Record<string, unknown> = {
      name: form.name,
      email: form.email,
      mobileNumber: form.mobileNumber || undefined,
      country: form.country || undefined,
      role: form.role,
      provider: form.provider || undefined,
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
          </Select>
        </div>
      </Card>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <Card className="mt-4 overflow-hidden">
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
                    <Td>{user.provider ? PROVIDER_LABELS[user.provider] : <span className="text-slate-400">Unassigned</span>}</Td>
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
      </Card>

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
            </Select>
          </div>
          {form.provider === 'telnyx' && (
            <div>
              <Label>Telnyx Credential ID (optional)</Label>
              <Input
                placeholder="Uses global credential if empty"
                value={form.telnyxCredentialId}
                onChange={(e) => setForm({ ...form, telnyxCredentialId: e.target.value })}
              />
            </div>
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
