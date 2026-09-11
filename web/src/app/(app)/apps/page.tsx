'use client';

import { Card } from '@/components/ui';

interface AppEntry {
  icon: string;
  title: string;
  blurb: string;
  steps: string[];
  href: string;
  cta: string;
}

const APPS: AppEntry[] = [
  {
    icon: '📱',
    title: 'iPhone / iPad',
    blurb: 'Delivered through TestFlight, Apple’s official test-app installer. Updates arrive automatically.',
    steps: [
      'Install “TestFlight” from the App Store (free, made by Apple).',
      'Tap the button below and choose Install.',
      'Open SnappyConnect and sign in with the email and password your admin gave you.',
    ],
    href: 'https://testflight.apple.com/join/aZpaWX6K',
    cta: 'Get for iOS',
  },
  {
    icon: '🤖',
    title: 'Android',
    blurb: 'Installed directly from this page (not the Play Store), so Android asks one extra permission.',
    steps: [
      'Tap the button below to download the APK.',
      'Open the downloaded file. If Android warns about unknown apps, choose “Allow from this source” — the file comes only from this official page.',
      'Tap Install, then open the app.',
      'The server address is filled in for you (call.snappyhires.com). Just enter your email and password and sign in.',
      'When asked, allow Microphone and Notifications — calls need both.',
    ],
    href: '/downloads/snappyconnect.apk',
    cta: 'Download APK',
  },
  {
    icon: '💻',
    title: 'Web app',
    blurb: 'You’re using it right now — nothing to install. Keep a tab open to receive incoming calls at your desk.',
    steps: [
      'Bookmark call.snappyhires.com and sign in with your usual account.',
      'Click “Allow” when the browser asks about Notifications — that’s how you see incoming calls while working in other windows.',
      'Optional: in Chrome’s menu choose “Cast, save and share → Install page as app” to give SnappyConnect its own icon and window.',
    ],
    href: '/dashboard',
    cta: 'Open dashboard',
  },
  {
    icon: '🧩',
    title: 'Chrome extension — click-to-call',
    blurb: 'Adds a green call button next to phone numbers on any website — job boards, LinkedIn, spreadsheets.',
    steps: [
      'Download the ZIP below and unzip it (double-click the file) — remember where the folder lands.',
      'In Chrome, open chrome://extensions and switch on “Developer mode” (top-right toggle).',
      'Click “Load unpacked” and pick the unzipped folder.',
      'Click the SnappyConnect icon in the toolbar (pin it via the puzzle-piece menu if hidden). The server address is pre-filled — just sign in.',
      'Phone numbers on web pages now show a call button; clicking it dials through SnappyConnect.',
    ],
    href: '/downloads/snappyconnect-extension.zip',
    cta: 'Download extension',
  },
];

export default function DownloadsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Get the Apps</h1>
      <p className="mt-1 text-sm text-slate-500">
        SnappyConnect on every device — same account everywhere. Your sign-in details come from
        your admin.
      </p>

      <div className="mt-6 space-y-4">
        {APPS.map((app) => (
          <Card key={app.title} className="p-5">
            <div className="flex items-start gap-4">
              <span className="text-3xl">{app.icon}</span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-900 dark:text-slate-100">{app.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{app.blurb}</p>
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-400">
                  {app.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <a
                  href={app.href}
                  target={app.href.startsWith('http') ? '_blank' : undefined}
                  rel="noreferrer"
                  className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  {app.cta}
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Reinstalling after an update? Android: uninstall the old app first if the installer
        complains. Extension: download the new ZIP, then use the reload icon on
        chrome://extensions. Sharing with someone who isn&apos;t signed in? Send them{' '}
        <a href="https://call.snappyhires.com/downloads/" className="underline">
          call.snappyhires.com/downloads
        </a>
        .
      </p>
    </div>
  );
}
