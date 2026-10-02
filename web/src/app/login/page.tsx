'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, api, setSession } from '@/lib/api';
import type { User } from '@/lib/types';

/*
 * The shared SnappyHires sign-in sheet (same look as
 * accounts.snappyhires.com/account/login), with the Calling platform hero.
 *
 * Every colour below is a literal hex value on purpose: globals.css remaps the
 * slate/white utilities for the app's dark theme, and this page must render
 * identically to every other product's sign-in sheet in either theme.
 *
 * Auth is unchanged: email + password posts to /auth/login, and every
 * shared-account button ends at the existing /auth/snappyhires/start route,
 * whose callback hands the session back here as #sso=<token> (or ?sso_error=).
 */

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

const BRAND_ID = 'calling';
const ACCOUNTS = 'https://accounts.snappyhires.com';

type ProviderId = 'google' | 'apple' | 'linkedin_oidc' | 'azure';
const PRIMARY: ProviderId[] = ['google', 'apple', 'linkedin_oidc'];
const MORE: ProviderId[] = ['azure'];
const PROVIDER_LABEL: Record<ProviderId, string> = {
  google: 'Google',
  apple: 'Apple',
  linkedin_oidc: 'LinkedIn',
  azure: 'Microsoft',
};

/** Absolute URL of this product's existing "Continue with SnappyHires" start route. */
function snappyStartUrl(): string {
  return new URL(`${API_URL}/auth/snappyhires/start`, window.location.origin).toString();
}

/** The shared login's hand-off: remembers the provider/brand, then bounces to our start route. */
function preferUrl(idp?: ProviderId): string {
  const q = new URLSearchParams();
  if (idp) q.set('idp', idp);
  q.set('brand', BRAND_ID);
  q.set('return', snappyStartUrl());
  return `${ACCOUNTS}/account/prefer?${q.toString()}`;
}

/* ───────────────────────────── hero ───────────────────────────── */

type Tile = {
  name: string;
  accent: string;
  kicker: string;
  headline: string;
  detail: string;
  mobile?: string;
  tablet?: string;
  desktop: string;
  rotate: string;
};

// The universe collage from the shared sheet (illustrative content).
const TILES: Tile[] = [
  { name: 'Hireish', accent: '#0d9488', kicker: 'New job', headline: 'Electrician', detail: 'Dubai · AED 3.5k/mo', mobile: 'left-[3%] top-[4%]', tablet: 'md:left-[4%] md:top-[5%]', desktop: 'lg:left-[7%] lg:top-[7%]', rotate: '-rotate-6' },
  { name: 'Calling', accent: '#16a34a', kicker: 'On a call', headline: '04:12', detail: 'To a candidate', desktop: 'lg:left-[37%] lg:top-[2%]', rotate: 'rotate-2' },
  { name: 'Staffio', accent: '#ea580c', kicker: 'Crew request', headline: '12 masons', detail: 'Abu Dhabi · Monday', mobile: 'right-[3%] top-[3%]', tablet: 'md:right-[4%] md:top-[4%]', desktop: 'lg:right-[6%] lg:top-[9%]', rotate: 'rotate-6' },
  { name: 'SnappyHires ATS', accent: '#2563eb', kicker: 'Pipeline', headline: '8 · 3 · 1', detail: 'Screened · Submitted · Offer', tablet: 'md:left-[1%] md:top-[40%]', desktop: 'lg:left-[-7%] lg:top-[55%]', rotate: 'rotate-3' },
  { name: 'Snappy Careers', accent: '#7c3aed', kicker: 'Your CV score', headline: '92 / 100', detail: '3 interviews this week', tablet: 'md:right-[1%] md:top-[38%]', desktop: 'lg:right-[-7%] lg:top-[53%]', rotate: '-rotate-3' },
  { name: 'CRM', accent: '#db2777', kicker: 'Deal won', headline: '$12,400', detail: 'Acme Staffing', mobile: 'left-[5%] bottom-[-7%]', tablet: 'md:left-[6%] md:bottom-[-4%]', desktop: 'lg:left-[7%] lg:bottom-[8%]', rotate: '-rotate-[4deg]' },
  { name: 'Finance', accent: '#ca8a04', kicker: 'Invoice paid', headline: 'AED 18.4k', detail: 'INV-2041 · today', desktop: 'lg:left-[37%] lg:bottom-[3%]', rotate: 'rotate-2' },
  { name: 'WorkHub', accent: '#0891b2', kicker: 'Today', headline: '9 of 10 in', detail: 'First in 09:02', mobile: 'right-[5%] bottom-[-5%]', tablet: 'md:right-[6%] md:bottom-[-3%]', desktop: 'lg:right-[6%] lg:bottom-[10%]', rotate: 'rotate-[5deg]' },
];

// BRANDS.calling from the shared sheet.
const BRAND = {
  name: 'Calling platform',
  /** Hero title and card labels — fits one line on a 375px phone. */
  short: 'Calling',
  /** The universe tile that IS this product, dropped so it never shows twice. */
  tile: 'Calling',
  letter: 'C',
  accent: '#16a34a',
  tagline: 'Cloud calling across three countries — dialer, IVR and AI voice agents.',
  cards: [
    { kicker: 'On a call', headline: '04:12', detail: 'To a candidate' },
    { kicker: 'Calls today', headline: '146', detail: '61% answered' },
    { kicker: 'AI agent', headline: '9 booked', detail: 'Interviews' },
    { kicker: 'Local numbers', headline: 'US·UAE·IN', detail: 'Caller ID' },
  ],
};

/**
 * The universe collage with this product's four cards in the phone-visible
 * slots. The universe "Calling" tile is dropped (its slot stays empty) so the
 * product never shows twice.
 */
const HERO_TILES: Tile[] = (() => {
  let i = 0;
  return TILES.filter((t) => t.mobile || t.name !== BRAND.tile).map((t) =>
    t.mobile ? { ...t, ...BRAND.cards[i++], name: BRAND.short, accent: BRAND.accent } : t,
  );
})();

function tileVisibility(t: Tile): string {
  return t.mobile ? '' : t.tablet ? 'hidden md:block' : 'hidden lg:block';
}

function Hero() {
  return (
    <div className="relative h-[380px] overflow-hidden bg-[#f8fafc] bg-[radial-gradient(ellipse_at_top_left,#fbcfe8_0%,transparent_45%),radial-gradient(ellipse_at_top_right,#fde68a_0%,transparent_45%),radial-gradient(ellipse_at_bottom_left,#bfdbfe_0%,transparent_50%),radial-gradient(ellipse_at_bottom_right,#c7d2fe_0%,transparent_50%)] md:h-[440px] lg:sticky lg:top-0 lg:h-screen">
      {HERO_TILES.map((t, i) => (
        <div
          key={`${t.name}-${i}`}
          aria-hidden
          className={`absolute ${t.mobile ?? ''} ${tileVisibility(t)} ${t.tablet ?? ''} ${t.desktop} ${t.rotate} w-[38%] max-w-[176px] rounded-2xl bg-[#fff] p-2 shadow-xl shadow-slate-900/10 ring-1 ring-black/5 md:max-w-[200px] lg:w-[29%] lg:max-w-[220px] lg:p-2.5`}
        >
          <div
            className="relative overflow-hidden rounded-xl px-3 py-2.5 text-white lg:px-3.5 lg:py-3"
            style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}b3)` }}
          >
            <span aria-hidden className="absolute -right-4 -top-6 h-16 w-16 rounded-full bg-white/15" />
            <span aria-hidden className="absolute -bottom-8 right-6 h-14 w-14 rounded-full bg-white/10" />
            <div className="relative truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-white/80">{t.kicker}</div>
            <div className="relative mt-0.5 truncate whitespace-nowrap text-lg font-black leading-tight lg:text-xl">{t.headline}</div>
            <div className="relative truncate whitespace-nowrap text-[11px] text-white/85">{t.detail}</div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 px-1 pb-0.5 text-[12px] font-semibold text-[#1e293b] lg:text-[13px]">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: t.accent }} />
            {t.name}
          </div>
        </div>
      ))}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 pb-4 text-center">
        <span
          aria-hidden
          className="inline-flex h-16 w-16 items-center justify-center rounded-[22%] text-[31px] font-black text-white shadow-xl"
          style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.accent}b3)`, boxShadow: `0 18px 40px -12px ${BRAND.accent}80` }}
        >
          {BRAND.letter}
        </span>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-[#020617] lg:mt-6 lg:text-6xl">{BRAND.short}</h1>
        <p className="mt-3 max-w-xs text-[15px] leading-snug text-[#334155] lg:max-w-sm lg:text-lg">
          {BRAND.tagline}
          <br className="hidden md:inline" />
          <span className="hidden text-[#64748b] md:inline">Sign in with your SnappyHires account.</span>
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────── marks ───────────────────────────── */

function ProviderMark({ id }: { id: ProviderId }) {
  if (id === 'google') {
    return (
      <svg aria-hidden width="20" height="20" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" />
        <path fill="#FBBC05" d="M10.4 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.8-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
    );
  }
  if (id === 'apple') {
    return (
      <svg aria-hidden width="18" height="20" viewBox="0 0 384 470" fill="currentColor">
        <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
      </svg>
    );
  }
  if (id === 'linkedin_oidc') {
    return (
      <svg aria-hidden width="20" height="20" viewBox="0 0 24 24">
        <rect width="24" height="24" rx="4" fill="#0A66C2" />
        <path fill="#fff" d="M7.1 9.5H4.6V19h2.5V9.5zM5.9 8.4a1.45 1.45 0 1 0 0-2.9 1.45 1.45 0 0 0 0 2.9zM19.4 13.8c0-2.6-1.4-4.5-4-4.5-1.3 0-2.2.7-2.6 1.4V9.5h-2.4V19h2.5v-5c0-1.3.6-2.2 1.7-2.2 1.1 0 1.5.8 1.5 2.1V19h2.5l-.2-5.2z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 21 21">
      <path fill="#F25022" d="M0 0h10v10H0z" />
      <path fill="#7FBA00" d="M11 0h10v10H11z" />
      <path fill="#00A4EF" d="M0 11h10v10H0z" />
      <path fill="#FFB900" d="M11 11h10v10H11z" />
    </svg>
  );
}

function MailMark() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/* ───────────────────────────── sheet ───────────────────────────── */

const pill =
  'flex w-full items-center justify-center gap-3 rounded-full border border-[#cbd5e1] bg-[#fff] px-5 py-3.5 text-[15px] font-semibold text-[#0f172a] transition hover:border-[#94a3b8] hover:bg-[#f8fafc] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60';
const field =
  'mt-1.5 w-full rounded-xl border border-[#cbd5e1] bg-[#fff] px-4 py-3 text-[15px] text-[#0f172a] outline-none ring-indigo-500 transition focus:ring-2';
const primary =
  'w-full rounded-full bg-[#020617] px-5 py-3.5 text-[15px] font-semibold text-white transition hover:bg-[#1e293b] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60';
const link = 'font-medium text-[#4f46e5] hover:text-[#4338ca] focus:outline-none focus-visible:underline';

type View = 'choose' | 'more' | 'email';

function Sheet() {
  const router = useRouter();
  const [view, setView] = useState<View>('choose');
  const [enabled, setEnabled] = useState<Set<ProviderId> | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);

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
    setSsoBusy(true);
    localStorage.setItem('sc_token', ssoToken);
    api<User>('/auth/me')
      .then((user) => {
        setSession(ssoToken, user);
        router.replace('/dashboard');
      })
      .catch(() => {
        localStorage.removeItem('sc_token');
        setError(SSO_ERRORS.failed);
        setSsoBusy(false);
      });
  }, [router]);

  // Which shared-account providers are switched on — buttons only for those.
  useEffect(() => {
    let cancelled = false;
    fetch(`${ACCOUNTS}/account/providers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { providers?: Partial<Record<ProviderId, boolean>> } | null) => {
        if (cancelled) return;
        const on = new Set<ProviderId>();
        for (const id of [...PRIMARY, ...MORE]) if (s?.providers?.[id]) on.add(id);
        if (!s?.providers) on.add('google'); // unreachable: Google is known-live
        setEnabled(on);
      })
      .catch(() => !cancelled && setEnabled(new Set<ProviderId>(['google'])));
    return () => {
      cancelled = true;
    };
  }, []);

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

  function go(idp?: ProviderId) {
    setError(null);
    window.location.assign(preferUrl(idp));
  }

  function back() {
    setView('choose');
    setError(null);
  }

  const primaryProviders = PRIMARY.filter((p) => enabled?.has(p));
  const moreProviders = MORE.filter((p) => enabled?.has(p));

  return (
    <div>
      {view !== 'choose' && (
        <button
          type="button"
          onClick={back}
          className="-mt-1 mb-3 flex items-center gap-1.5 rounded text-[15px] font-medium text-[#4f46e5] hover:text-[#4338ca] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span aria-hidden>‹</span> Back
        </button>
      )}

      {view === 'choose' && (
        <>
          <h2 className="text-center text-[22px] font-bold tracking-tight text-[#020617]">Sign in to Calling</h2>
          {ssoBusy ? (
            <div role="status" className="mt-6 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-center text-sm text-[#475569]">
              Signing you in…
            </div>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                {enabled === null ? (
                  <div className="h-[52px] animate-pulse rounded-full bg-[#f1f5f9] motion-reduce:animate-none" />
                ) : (
                  primaryProviders.map((id) => (
                    <button key={id} type="button" onClick={() => go(id)} className={pill}>
                      <ProviderMark id={id} />
                      Continue with {PROVIDER_LABEL[id]}
                    </button>
                  ))
                )}
                <button type="button" onClick={() => { setView('email'); setError(null); }} className={pill}>
                  <MailMark />
                  Continue with email
                </button>
              </div>
              {moreProviders.length > 0 && (
                <div className="mt-5 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setView('more')}
                    className="rounded-full border border-[#cbd5e1] px-5 py-2 text-sm font-semibold text-[#1e293b] hover:bg-[#f8fafc] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    View more
                  </button>
                </div>
              )}
              <div className="mt-5 text-center text-sm">
                <button type="button" onClick={() => go()} className={link}>
                  Use your SnappyHires account
                </button>
              </div>
            </>
          )}
        </>
      )}

      {view === 'more' && (
        <>
          <h2 className="text-center text-[22px] font-bold tracking-tight text-[#020617]">More sign-in options</h2>
          <div className="mt-6 space-y-3">
            {moreProviders.map((id) => (
              <button key={id} type="button" onClick={() => go(id)} className={pill}>
                <ProviderMark id={id} />
                Continue with {PROVIDER_LABEL[id]}
              </button>
            ))}
          </div>
        </>
      )}

      {view === 'email' && (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-center text-[22px] font-bold tracking-tight text-[#020617]">Sign in with email</h2>
          <label className="block text-sm font-medium text-[#334155]">
            Email
            <input
              className={field}
              type="email"
              autoComplete="email"
              required
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium text-[#334155]">
            <span className="flex items-center justify-between">
              Password
              <Link href="/forgot-password" className={`text-xs ${link}`}>
                Forgot password?
              </Link>
            </span>
            <input
              className={field}
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" disabled={loading} className={primary}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="text-center text-xs text-[#64748b]">
            Admins and users sign in here with the credentials provided by their administrator.
          </div>
        </form>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">
          {error}
        </div>
      )}

      <div className="mt-7 text-center text-xs leading-relaxed text-[#64748b]">
        Calling uses your SnappyHires account — one login for Hireish, Staffio, Snappy Careers, the ATS and more.
        <br />
        By continuing you agree to our{' '}
        <a href="https://hire.snappyhires.com/privacy" className="underline underline-offset-2 hover:text-[#334155]">
          Privacy Policy
        </a>
        .
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="signin-sheet min-h-screen bg-[#fff] lg:grid lg:grid-cols-[1.1fr_1fr]">
      <Hero />
      <section className="relative -mt-7 rounded-t-[28px] bg-[#fff] px-6 pb-10 pt-8 lg:mt-0 lg:flex lg:min-h-screen lg:items-center lg:rounded-none lg:px-16">
        <div className="mx-auto w-full max-w-[420px]">
          <Sheet />
        </div>
      </section>
    </main>
  );
}
