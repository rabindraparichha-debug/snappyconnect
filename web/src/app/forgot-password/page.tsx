'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button, Input, Label } from '@/components/ui';
import { Logo } from '@/components/Logo';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setMessage(res.message);
    } catch {
      // The endpoint never reveals whether an account exists; a network error
      // shouldn't either.
      setMessage('If that email has an account, a reset link is on its way.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-lg font-semibold text-slate-900">Forgot your password?</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your email and we&apos;ll send you a link to set a new one.
          </p>

          {message ? (
            <p className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </p>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            <Link href="/login" className="font-medium text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
