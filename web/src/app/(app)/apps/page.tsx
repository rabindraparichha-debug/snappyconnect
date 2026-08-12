'use client';

import { Card } from '@/components/ui';

const APPS = [
  {
    icon: '📱',
    title: 'iPhone / iPad',
    blurb:
      'Install TestFlight from the App Store first (Apple’s official test-app installer), then tap the button and choose Install. Updates arrive automatically.',
    href: 'https://testflight.apple.com/join/aZpaWX6K',
    cta: 'Get for iOS',
  },
  {
    icon: '🤖',
    title: 'Android',
    blurb:
      'Download and open the APK to install. If Android warns about unknown apps, allow installs from your browser for this one file — it comes only from this official page.',
    href: '/downloads/snappyconnect.apk',
    cta: 'Download APK',
  },
  {
    icon: '💻',
    title: 'Web app',
    blurb:
      'You’re using it right now — nothing to install. Tip: in Chrome’s menu choose “Cast, save and share → Install page as app” to give it its own icon and window.',
    href: '/dashboard',
    cta: 'Open dashboard',
  },
  {
    icon: '🧩',
    title: 'Chrome extension — click-to-call',
    blurb:
      'Adds a call button next to phone numbers on any website. Unzip, open chrome://extensions, switch on Developer mode, click “Load unpacked” and pick the unzipped folder, then sign in from the toolbar icon.',
    href: '/downloads/snappyconnect-extension.zip',
    cta: 'Download extension',
  },
];

export default function DownloadsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Get the Apps</h1>
      <p className="mt-1 text-sm text-slate-500">
        SnappyConnect on every device — same account everywhere.
      </p>

      <div className="mt-6 space-y-4">
        {APPS.map((app) => (
          <Card key={app.title} className="p-5">
            <div className="flex items-start gap-4">
              <span className="text-3xl">{app.icon}</span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">{app.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{app.blurb}</p>
                <a
                  href={app.href}
                  target={app.href.startsWith('http') ? '_blank' : undefined}
                  rel="noreferrer"
                  className="mt-3 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {app.cta}
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Sharing with someone who isn&apos;t signed in? Send them{' '}
        <a href="https://call.snappyhires.com/downloads/" className="underline">
          call.snappyhires.com/downloads
        </a>
        .
      </p>
    </div>
  );
}
