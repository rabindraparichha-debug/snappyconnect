'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card } from '@/components/ui';

interface SupportConfig {
  aiEnabled: boolean;
  numbers: string[];
  boardLineNumber: string | null;
  companyName: string;
  greeting: string;
  instructions: string;
  operatorUserId: string | null;
  aiAvailable: boolean;
}

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

/**
 * Support line: an AI operator answers first and hands the caller to the
 * operator (set in the board-line menu below) when a person is needed.
 */
export function SupportLineCard() {
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [numbers, setNumbers] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [greeting, setGreeting] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function show(next: SupportConfig) {
    setConfig(next);
    setAiEnabled(next.aiEnabled);
    setNumbers(next.numbers.join('\n'));
    setCompanyName(next.companyName);
    setGreeting(next.greeting);
    setInstructions(next.instructions);
  }

  useEffect(() => {
    api<SupportConfig>('/numbers/support')
      .then(show)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the support line'));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      show(
        await api<SupportConfig>('/numbers/support', {
          method: 'POST',
          body: {
            aiEnabled,
            numbers: numbers.split(/[\n,]/).map((n) => n.trim()).filter(Boolean),
            companyName,
            greeting,
            instructions,
          },
        }),
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return error ? (
      <Card className="mt-5 p-5">
        <p className="text-sm text-red-600">{error}</p>
      </Card>
    ) : null;
  }

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Support line (AI operator)</h2>
        <span className="text-xs text-slate-500">
          {numbers.trim()
            ? 'Answers the numbers listed below'
            : config.boardLineNumber
              ? `Answers the board line ${config.boardLineNumber}`
              : 'No board line set yet'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        When on, an AI operator answers these numbers first instead of the menu. It hands the caller
        to the operator chosen in the board-line menu when they ask for a person or it cannot help,
        and to a named team member when the caller asks for one. If the AI cannot take a call, the
        usual menu answers.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={aiEnabled}
          onChange={(e) => setAiEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        AI operator answers first
      </label>
      {!config.aiAvailable && (
        <p className="mt-1 text-xs text-amber-600">
          The AI voice platform key is not set on this server, so the AI cannot answer yet.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Company name</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Support numbers (one per line)
          </label>
          <textarea
            rows={2}
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            placeholder={config.boardLineNumber ?? '+1…'}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-slate-500">Leave empty to use the board line.</p>
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">Greeting</label>
        <textarea
          rows={2}
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          placeholder={`Thank you for calling ${companyName || 'us'}. This is the AI assistant. How can I help you today?`}
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">
          Spoken word for word. The caller is always told they are speaking with an AI.
        </p>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          What the AI knows
        </label>
        <textarea
          rows={8}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Products and who they are for, opening hours, how to apply, what to do for common questions…"
          className={FIELD}
        />
        <p className="mt-1 text-xs text-slate-500">
          The AI answers only from this. Anything not covered is handed to a person.{' '}
          {instructions.length.toLocaleString()} / 60,000 characters.
        </p>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save support line'}
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </Card>
  );
}
