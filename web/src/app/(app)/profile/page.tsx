'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, setSession, getToken } from '@/lib/api';
import type { User } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { Badge, Button, Card, Input, Label, Spinner } from '@/components/ui';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [vmGreeting, setVmGreeting] = useState('');
  const [vmRing, setVmRing] = useState(25);
  const [vmMessage, setVmMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [vmSaving, setVmSaving] = useState(false);

  useEffect(() => {
    api<User>('/auth/me')
      .then((me) => {
        setUser(me);
        setVmGreeting(me.providerConfig?.voicemailGreeting ?? '');
        setVmRing(Number(me.providerConfig?.ringSeconds) || 25);
        const token = getToken();
        if (token) setSession(token, me); // refresh cached profile
      })
      .finally(() => setLoading(false));
  }, []);

  async function saveVoicemail(e: FormEvent) {
    e.preventDefault();
    setVmMessage(null);
    setVmSaving(true);
    try {
      const updated = await api<User>('/profile/voicemail', {
        method: 'PATCH',
        body: { voicemailGreeting: vmGreeting, ringSeconds: vmRing },
      });
      setUser(updated);
      const token = getToken();
      if (token) setSession(token, updated);
      setVmMessage({ ok: true, text: 'Voicemail settings saved.' });
    } catch (err) {
      setVmMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setVmSaving(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ ok: false, text: 'New passwords do not match.' });
      return;
    }
    setSaving(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setMessage({ ok: true, text: 'Password updated.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Update failed' });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
      <p className="mt-1 text-sm text-slate-500">Your account details and security.</p>

      <Card className="mt-6 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-700">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
          <div className="ml-auto">
            <Badge value={user.status} />
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
          <ProfileField label="Role" value={user.role} capitalize />
          <ProfileField label="Mobile Number" value={user.mobileNumber ?? '—'} />
          <ProfileField label="Country" value={user.country ?? '—'} />
          <ProfileField
            label="Calling Provider"
            value={user.provider ? PROVIDER_LABELS[user.provider] : 'Unassigned'}
          />
          {user.provider === 'grandstream' && (
            <ProfileField label="PBX Extension" value={user.providerConfig?.extension ?? '—'} />
          )}
        </dl>
      </Card>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold text-slate-900">My Numbers &amp; Lines</h2>
        <p className="mt-1 text-sm text-slate-500">
          What candidates see when you call, and how calls reach you.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {user.regions?.includes('usa') && (
            <>
              <ProfileField
                label="USA Direct Line"
                value={
                  user.providerConfig?.telnyxNumber ??
                  'Shared company number (ask an admin for a personal line)'
                }
              />
              <ProfileField
                label="Board-Line Extension"
                value={
                  user.providerConfig?.ivrDigit
                    ? `Callers press ${user.providerConfig.ivrDigit} to reach you`
                    : '—'
                }
              />
            </>
          )}
          {user.regions?.includes('uae') && (
            <ProfileField
              label="UAE Extension"
              value={user.providerConfig?.sipUsername ?? 'Not assigned — contact an admin'}
            />
          )}
          {user.regions?.includes('india') && (
            <ProfileField label="India" value="Calls use your own phone (native dialer)" />
          )}
          {!user.regions?.length && (
            <ProfileField label="Calling Access" value="No regions assigned yet" />
          )}
        </dl>
      </Card>

      {user.regions?.includes('usa') && (
        <Card className="mt-6 p-6">
          <h2 className="text-base font-semibold text-slate-900">My Voicemail</h2>
          <p className="mt-1 text-sm text-slate-500">
            What callers hear when you can&apos;t answer, and how long your line rings first.
          </p>
          <form onSubmit={saveVoicemail} className="mt-4 space-y-4">
            <div>
              <Label>Voicemail greeting</Label>
              <textarea
                value={vmGreeting}
                onChange={(e) => setVmGreeting(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Hi, you've reached [your name] at SnappyHires. Please leave a message and I'll call you back."
                className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-600"
              />
              <p className="mt-1 text-xs text-slate-400">
                Read aloud to callers by text-to-speech. Leave blank for the standard greeting.
              </p>
            </div>
            <div className="flex items-end gap-3">
              <div>
                <Label>Ring for</Label>
                <select
                  value={vmRing}
                  onChange={(e) => setVmRing(Number(e.target.value))}
                  className="mt-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600"
                >
                  {[15, 20, 25, 30, 40, 50, 60].map((s) => (
                    <option key={s} value={s}>
                      {s} seconds
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={vmSaving}>
                {vmSaving ? 'Saving…' : 'Save voicemail'}
              </Button>
              {vmMessage && (
                <p className={`text-sm ${vmMessage.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {vmMessage.text}
                </p>
              )}
            </div>
          </form>
        </Card>
      )}

      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold text-slate-900">Change Password</h2>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <div>
            <Label>Current Password</Label>
            <Input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>New Password</Label>
              <Input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          {message && (
            <p
              className={`rounded-lg px-3 py-2 text-sm ${
                message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              {message.text}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Updating…' : 'Update Password'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function ProfileField({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 text-sm font-medium text-slate-900 ${capitalize ? 'capitalize' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
