'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, Input, Label, Spinner } from '@/components/ui';

type SettingsMap = Record<string, Record<string, any>>;

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
}

const SECTIONS: { key: string; title: string; description: string; fields: Field[] }[] = [
  {
    key: 'telnyx',
    title: 'Telnyx (USA)',
    description: 'Web/mobile calling over WebRTC and SMS for USA-based users.',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, placeholder: 'KEY017…' },
      {
        key: 'credentialId',
        label: 'Telephony Credential ID',
        hint: 'Default on-demand credential used to mint WebRTC tokens.',
      },
      { key: 'connectionId', label: 'Connection ID' },
      { key: 'fromNumber', label: 'Default From Number', placeholder: '+15550001234' },
      { key: 'messagingProfileId', label: 'Messaging Profile ID (SMS)' },
    ],
  },
  {
    key: 'grandstream',
    title: 'Grandstream PBX (UAE)',
    description: 'UCM PBX with a shared Wave extension. All UAE users call through this extension — one call at a time.',
    fields: [
      { key: 'host', label: 'PBX Host / IP', placeholder: '10.0.0.10' },
      { key: 'port', label: 'API Port', placeholder: '8089' },
      { key: 'username', label: 'API Username' },
      { key: 'password', label: 'API Password', secret: true },
      {
        key: 'extension',
        label: 'Shared Wave Extension',
        placeholder: '101',
        hint: 'The extension registered in Wave app. All UAE users share this extension for calling.',
      },
      {
        key: 'callerPrefix',
        label: 'Outbound Prefix (optional)',
        hint: 'Prepended to dialed numbers to match your outbound route, e.g. 9.',
      },
    ],
  },
  {
    key: 'dinstar',
    title: 'Dinstar Gateway (UAE)',
    description:
      'GSM/FXO gateway trunked to the Grandstream PBX. Stored for reference and monitoring.',
    fields: [
      { key: 'host', label: 'Gateway Host / IP' },
      { key: 'port', label: 'Port', placeholder: '80' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', secret: true },
      { key: 'notes', label: 'Notes', placeholder: 'Trunk name, SIM slots…' },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SettingsMap>('/settings/providers')
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Provider credentials are encrypted at rest. Secret fields show only their last characters —
        leave them unchanged to keep the stored value.
      </p>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 space-y-6">
        {SECTIONS.map((section) => (
          <SettingsSection
            key={section.key}
            section={section}
            initial={settings[section.key] ?? {}}
          />
        ))}
      </div>
    </div>
  );
}

function SettingsSection({
  section,
  initial,
}: {
  section: (typeof SECTIONS)[number];
  initial: Record<string, any>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const field of section.fields) v[field.key] = initial[field.key] ?? '';
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<Record<string, any>>(`/settings/providers/${section.key}`, {
        method: 'PUT',
        body: values,
      });
      const next: Record<string, string> = {};
      for (const field of section.fields) next[field.key] = updated[field.key] ?? '';
      setValues(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
      <p className="mt-0.5 text-sm text-slate-500">{section.description}</p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {section.fields.map((field) => (
          <div key={field.key} className={field.key === 'notes' ? 'sm:col-span-2' : undefined}>
            <Label>{field.label}</Label>
            <Input
              type={field.secret ? 'password' : 'text'}
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              autoComplete="off"
            />
            {field.hint && <p className="mt-1 text-xs text-slate-400">{field.hint}</p>}
          </div>
        ))}
        <div className="sm:col-span-2 flex items-center justify-end gap-3">
          {saved && <span className="text-sm font-medium text-emerald-600">Saved ✓</span>}
          {error && <span className="text-sm text-rose-600">{error}</span>}
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
