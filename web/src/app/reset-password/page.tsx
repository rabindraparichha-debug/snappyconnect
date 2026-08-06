'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { Logo } from '@/components/Logo';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      setDone(true);
      setTimeout(() => router.replace('/login'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This link is missing its reset code. Request a new one from{' '}
        <Link href="/forgot-password" className="font-medium underline">
          forgot password
        </Link>
        .
      </p>
    );
  }

  if (done) {
    return (
      <p className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Password updated — taking you to sign in…
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <Label>New password</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <p className="mt-1 text-xs text-slate-400">At least 8 characters.</p>
      </div>
      <div>
        <Label>Confirm password</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">Choose a new password</h1>
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6" />
              </div>
            }
          >
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
