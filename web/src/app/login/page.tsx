'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, api, setSession } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button, Input, Label } from '@/components/ui';
import { Logo } from '@/components/Logo';

// Messages for a "Continue with SnappyHires" sign-in that did not complete.
const SSO_ERRORS: Record<string, string> = {
  no_account:
    'No SnappyConnect account uses this e-mail. Ask an admin for access, then continue with SnappyHires.',
  unverified:
    'Your SnappyHires account has no verified e-mail yet, so it cannot be linked. Sign in with your password instead.',
  expired: 'That sign-in request expired. Try again.',
  disabled: 'Sign-in with SnappyHires is not switched on for this server yet.',
  failed: 'Sign-in with SnappyHires did not complete. Try again.',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Back from the shared login: the API put our session token in the URL
  // fragment (never sent to any server). Store it exactly as a password login would.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const ssoToken = hash.get('sso');
    const ssoError = new URLSearchParams(window.location.search).get('sso_error');
    if (ssoToken || ssoError) window.history.replaceState(null, '', '/login');
    if (ssoError && ssoError !== 'cancelled') {
      setError(SSO_ERRORS[ssoError] ?? SSO_ERRORS.failed);
    }
    if (!ssoToken) return;
    setLoading(true);
    localStorage.setItem('sc_token', ssoToken);
    api<User>('/auth/me')
      .then((user) => {
        setSession(ssoToken, user);
        router.replace('/dashboard');
      })
      .catch(() => {
        localStorage.removeItem('sc_token');
        setError(SSO_ERRORS.failed);
        setLoading(false);
      });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken, user } = await api<{ accessToken: string; user: User }>(
        '/auth/login',
        { method: 'POST', body: { email, password } },
      );
      setSession(accessToken, user);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          <h1 className="text-xl font-bold text-slate-900">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your SnappyConnect account.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                required
                autoFocus
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            )}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <a
            href={`${API_URL}/auth/snappyhires/start`}
            className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Continue with SnappyHires
          </a>
          <p className="mt-4 text-center text-sm">
            <Link href="/forgot-password" className="text-brand-600 hover:underline">
              Forgot your password?
            </Link>
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          Admins and users sign in here with the credentials provided by their administrator.
        </p>
      </div>
    </div>
  );
}
