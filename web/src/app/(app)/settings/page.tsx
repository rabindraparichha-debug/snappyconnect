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
    key: 'asterisk',
    title: 'Asterisk SIP Server (UAE — in-app dialer)',
    description:
      'Self-hosted Asterisk on the VPS. The mobile app registers each user’s own SIP account over an encrypted WebSocket and dials in-app.',
    fields: [
      {
        key: 'wssUrl',
        label: 'WSS URL',
        placeholder: 'wss://145.223.18.237:8089/ws',
        hint: 'Asterisk WebSocket (TLS) endpoint the mobile app connects to.',
      },
      {
        key: 'domain',
        label: 'SIP Domain (optional)',
        placeholder: 'Defaults to the WSS host',
      },
      {
        key: 'amiUsername',
        label: 'AMI Username',
        placeholder: 'snappyconnect',
        hint: 'Manager account used for click-to-call and automatic call history.',
      },
      { key: 'amiPassword', label: 'AMI Password', secret: true },
      { key: 'amiHost', label: 'AMI Host', placeholder: '127.0.0.1' },
      { key: 'amiPort', label: 'AMI Port', placeholder: '5038' },
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
  {
    key: 'ai',
    title: 'AI Assistant',
    description:
      'Configure the AI assistant that helps recruiters with messaging, interview prep, and more. Supports any OpenAI-compatible API.',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-…' },
      {
        key: 'model',
        label: 'Model',
        placeholder: 'gpt-4o-mini',
        hint: 'Model ID. Defaults to gpt-4o-mini. Works with OpenAI, Groq, OpenRouter, etc.',
      },
      {
        key: 'baseUrl',
        label: 'Base URL (optional)',
        placeholder: 'https://api.openai.com/v1',
        hint: 'Override for non-OpenAI providers (e.g. https://api.groq.com/openai/v1).',
      },
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

      {error && (
        <div className="mt-6 rounded-lg bg-rose-50 px-4 py-8 text-center">
          <p className="text-sm font-medium text-rose-700">{error}</p>
          <p className="mt-1 text-xs text-rose-500">Only administrators can manage provider settings.</p>
        </div>
      )}

      {!error && (
        <div className="mt-6 space-y-6">
          {SECTIONS.map((section) => (
            <SettingsSection
              key={section.key}
              section={section}
              initial={settings[section.key] ?? {}}
            />
          ))}
          <CallScriptsSection />
          <WebhooksSection />
        </div>
      )}
    </div>
  );
}

const WEBHOOK_EVENTS = [
  { value: 'call.completed', label: 'Call logged' },
  { value: 'sms.received', label: 'SMS received' },
  { value: 'disposition.set', label: 'Disposition set' },
] as const;

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  hasSecret: boolean;
  active: boolean;
  lastFiredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
}

function WebhooksSection() {
  const [hooks, setHooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', url: '', events: [] as string[], secret: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  async function load() {
    try {
      setHooks(await api<WebhookConfig[]>('/webhooks-config'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditingId('new');
    setDraft({ name: '', url: '', events: ['call.completed'], secret: '' });
  }

  function startEdit(h: WebhookConfig) {
    setEditingId(h.id);
    setDraft({ name: h.name, url: h.url, events: [...h.events], secret: '' });
  }

  async function save() {
    if (!draft.name.trim() || !draft.url.trim() || draft.events.length === 0) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      url: draft.url.trim(),
      events: draft.events,
    };
    // Leaving the secret blank on an edit keeps whatever is already stored.
    if (draft.secret.trim() || editingId === 'new') body.secret = draft.secret.trim();
    try {
      if (editingId === 'new') {
        await api('/webhooks-config', { method: 'POST', body });
      } else {
        await api(`/webhooks-config/${editingId}`, { method: 'PATCH', body });
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(h: WebhookConfig) {
    try {
      await api(`/webhooks-config/${h.id}`, { method: 'PATCH', body: { active: !h.active } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  async function test(h: WebhookConfig) {
    setTesting(h.id);
    try {
      await api(`/webhooks-config/${h.id}/test`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed');
    } finally {
      setTesting(null);
    }
  }

  async function remove(h: WebhookConfig) {
    try {
      await api(`/webhooks-config/${h.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  function toggleEvent(value: string) {
    setDraft((d) => ({
      ...d,
      events: d.events.includes(value) ? d.events.filter((e) => e !== value) : [...d.events, value],
    }));
  }

  const editor = (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div>
        <Label>Name</Label>
        <Input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="ATS sync"
        />
      </div>
      <div>
        <Label>Endpoint URL</Label>
        <Input
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="https://your-crm.example.com/hooks/snappyconnect"
        />
      </div>
      <div>
        <Label>Events</Label>
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((ev) => (
            <button
              key={ev.value}
              type="button"
              onClick={() => toggleEvent(ev.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                draft.events.includes(ev.value)
                  ? 'bg-brand-600 text-white ring-brand-600'
                  : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {ev.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Signing Secret</Label>
        <Input
          type="password"
          value={draft.secret}
          onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
          placeholder={editingId === 'new' ? 'Optional' : 'Leave blank to keep current'}
        />
        <p className="mt-1 text-xs text-slate-400">
          Payloads are signed as <code>X-SnappyConnect-Signature: sha256=&lt;hmac&gt;</code>.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
        <Button
          onClick={save}
          disabled={saving || !draft.name.trim() || !draft.url.trim() || draft.events.length === 0}
        >
          {saving ? 'Saving...' : 'Save Webhook'}
        </Button>
      </div>
    </div>
  );

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Webhooks</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Push call and message events to your ATS or CRM as they happen.
          </p>
        </div>
        <Button onClick={startNew} disabled={editingId === 'new'}>New Webhook</Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {editingId === 'new' && editor}

          {hooks.length === 0 && editingId !== 'new' && (
            <p className="py-6 text-center text-sm text-slate-400">
              No webhooks configured.
            </p>
          )}

          {hooks.map((h) =>
            editingId === h.id ? (
              <div key={h.id}>{editor}</div>
            ) : (
              <div key={h.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{h.name}</p>
                      {!h.active && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          Paused
                        </span>
                      )}
                      {h.hasSecret && (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                          Signed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{h.url}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {h.events.map((e) => (
                        <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {WEBHOOK_EVENTS.find((w) => w.value === e)?.label ?? e}
                        </span>
                      ))}
                    </div>
                    {h.lastFiredAt && (
                      <p className={`mt-1.5 text-xs ${h.lastError ? 'text-rose-600' : 'text-emerald-600'}`}>
                        Last delivery {h.lastError ? `failed — ${h.lastError}` : `OK (${h.lastStatusCode})`}
                        {' · '}
                        {new Date(h.lastFiredAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => test(h)}
                      disabled={testing === h.id}
                      title="Send test delivery"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M3.1 2.3a1 1 0 0 0-1.4 1.2l1.8 5.5H10a1 1 0 1 1 0 2H3.5l-1.8 5.5a1 1 0 0 0 1.4 1.2l15-7a1 1 0 0 0 0-1.8l-15-7Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => toggleActive(h)}
                      title={h.active ? 'Pause' : 'Resume'}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      {h.active ? (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M6 4h3v12H6V4Zm5 0h3v12h-3V4Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path d="M6.3 3.8A1 1 0 0 0 5 4.7v10.6a1 1 0 0 0 1.5.9l9-5.3a1 1 0 0 0 0-1.7l-9-5.4Z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => startEdit(h)}
                      title="Edit"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M2.7 14.5 2 18l3.5-.7 9.2-9.2-2.8-2.8-9.2 9.2ZM17.3 5.3a1.5 1.5 0 0 0 0-2.1l-.5-.5a1.5 1.5 0 0 0-2.1 0l-1 1 2.6 2.6 1-1Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => remove(h)}
                      title="Delete"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M8.75 1a1 1 0 0 0-.95.68L7.42 3H4a1 1 0 0 0 0 2h12a1 1 0 1 0 0-2h-3.42l-.38-1.32A1 1 0 0 0 11.25 1h-2.5ZM5 6.5h10l-.7 10.1a1.5 1.5 0 0 1-1.5 1.4H7.2a1.5 1.5 0 0 1-1.5-1.4L5 6.5Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

interface CallScript {
  id: string;
  title: string;
  body: string;
  region: string | null;
  active: boolean;
  sortOrder: number;
}

function CallScriptsSection() {
  const [scripts, setScripts] = useState<CallScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', region: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await api<CallScript[]>('/scripts', { query: { all: 'true' } });
      setScripts(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scripts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setEditingId('new');
    setDraft({ title: '', body: '', region: '' });
  }

  function startEdit(s: CallScript) {
    setEditingId(s.id);
    setDraft({ title: s.title, body: s.body, region: s.region ?? '' });
  }

  async function save() {
    if (!draft.title.trim() || !draft.body.trim()) return;
    setSaving(true);
    const body = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      region: draft.region || undefined,
    };
    try {
      if (editingId === 'new') {
        await api('/scripts', { method: 'POST', body });
      } else {
        await api(`/scripts/${editingId}`, { method: 'PATCH', body });
      }
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: CallScript) {
    try {
      await api(`/scripts/${s.id}`, { method: 'PATCH', body: { active: !s.active } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  async function remove(s: CallScript) {
    try {
      await api(`/scripts/${s.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Call Scripts</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Talk tracks recruiters can open from the dialer while a call is live.
          </p>
        </div>
        <Button onClick={startNew} disabled={editingId === 'new'}>New Script</Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {editingId === 'new' && (
            <ScriptEditor draft={draft} setDraft={setDraft} onSave={save} onCancel={() => setEditingId(null)} saving={saving} />
          )}

          {scripts.length === 0 && editingId !== 'new' && (
            <p className="py-6 text-center text-sm text-slate-400">
              No scripts yet. Add one so recruiters have a talk track to follow.
            </p>
          )}

          {scripts.map((s) =>
            editingId === s.id ? (
              <ScriptEditor
                key={s.id}
                draft={draft}
                setDraft={setDraft}
                onSave={save}
                onCancel={() => setEditingId(null)}
                saving={saving}
              />
            ) : (
              <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{s.title}</p>
                      {s.region && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                          {s.region}
                        </span>
                      )}
                      {!s.active && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{s.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => toggleActive(s)}
                      title={s.active ? 'Deactivate' : 'Activate'}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      {s.active ? (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.58l-1.3-1.3a1 1 0 0 0-1.4 1.42l2 2a1 1 0 0 0 1.4 0l4-4Z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM7 9a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H7Z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={() => startEdit(s)}
                      title="Edit"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M2.7 14.5 2 18l3.5-.7 9.2-9.2-2.8-2.8-9.2 9.2ZM17.3 5.3a1.5 1.5 0 0 0 0-2.1l-.5-.5a1.5 1.5 0 0 0-2.1 0l-1 1 2.6 2.6 1-1Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => remove(s)}
                      title="Delete"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M8.75 1a1 1 0 0 0-.95.68L7.42 3H4a1 1 0 0 0 0 2h12a1 1 0 1 0 0-2h-3.42l-.38-1.32A1 1 0 0 0 11.25 1h-2.5ZM5 6.5h10l-.7 10.1a1.5 1.5 0 0 1-1.5 1.4H7.2a1.5 1.5 0 0 1-1.5-1.4L5 6.5Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  );
}

function ScriptEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  saving,
}: {
  draft: { title: string; body: string; region: string };
  setDraft: (d: { title: string; body: string; region: string }) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div>
        <Label>Title</Label>
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Opening pitch — senior developer roles"
        />
      </div>
      <div>
        <Label>Region</Label>
        <select
          value={draft.region}
          onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          className="block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        >
          <option value="">All regions</option>
          <option value="india">India</option>
          <option value="usa">USA</option>
          <option value="uae">UAE</option>
        </select>
      </div>
      <div>
        <Label>Script</Label>
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          rows={6}
          placeholder={'Hi, this is [name] from SnappyHires...\n\n1. Confirm they have a minute\n2. Describe the role\n3. Ask about notice period'}
          className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave} disabled={saving || !draft.title.trim() || !draft.body.trim()}>
          {saving ? 'Saving...' : 'Save Script'}
        </Button>
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
