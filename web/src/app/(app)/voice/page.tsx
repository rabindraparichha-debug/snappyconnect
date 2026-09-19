'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, API_URL, getStoredUser, getToken } from '@/lib/api';
import { Button, Card, Input, Label, Select, Spinner } from '@/components/ui';

interface VoiceRequest {
  id: string;
  name: string;
  status: 'pending' | 'approved' | 'rejected';
  voiceId: string | null;
  note: string | null;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

interface Voice {
  id: string;
  name: string;
}

const DIALECTS = [
  { value: 'us', label: 'American' },
  { value: 'uk', label: 'British' },
  { value: 'au', label: 'Australian' },
  { value: 'in', label: 'Indian' },
];

export default function VoicePage() {
  const isAdmin = getStoredUser()?.role === 'admin';
  const [requests, setRequests] = useState<VoiceRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await api<VoiceRequest[]>('/voice-requests'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load voice requests');
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject', body?: Record<string, string>) {
    setBusy(id);
    try {
      await api(`/voice-requests/${id}/${action}`, { method: 'POST', body: body ?? {} });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} that request`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api(`/voice-requests/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that request');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900">My AI Voice</h1>
      <p className="mt-1 text-sm text-slate-500">
        Record a short sample and, once an admin approves it, the AI agent can call in your own
        voice — optionally with a different English accent.
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <SubmitCard onSubmitted={load} />

      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold text-slate-900">
          {isAdmin ? 'Requests' : 'My requests'}
        </h2>
        {requests === null ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6" />
          </div>
        ) : requests.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">Nothing submitted yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{r.name}</p>
                  <p className="text-xs text-slate-500">
                    {r.user ? `${r.user.name} · ` : ''}
                    {new Date(r.createdAt).toLocaleString()}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <StatusChip status={r.status} />
                {isAdmin && r.status === 'pending' && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={busy === r.id}
                      onClick={() => act(r.id, 'approve', { provider: 'cartesia' })}
                    >
                      {busy === r.id ? 'Working…' : 'Approve'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy === r.id}
                      onClick={() => act(r.id, 'reject', { note: 'Not approved.' })}
                    >
                      Reject
                    </Button>
                  </>
                )}
                <Button variant="ghost" disabled={busy === r.id} onClick={() => remove(r.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && <AccentCard />}
    </div>
  );
}

function StatusChip({ status }: { status: VoiceRequest['status'] }) {
  const styles: Record<VoiceRequest['status'], string> = {
    pending: 'bg-amber-50 text-amber-700',
    approved: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-rose-50 text-rose-700',
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>
      {status === 'pending' ? 'Waiting for approval' : status}
    </span>
  );
}

function SubmitCard({ onSubmitted }: { onSubmitted: () => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name.trim() || 'My voice');
      await api('/voice-requests', { method: 'POST', body: form });
      setDone(true);
      setFile(null);
      setName('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the sample');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h2 className="text-base font-semibold text-slate-900">Submit a sample</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        15–30 seconds of natural speech, one speaker, no background noise. Only submit a recording
        of yourself, or of someone who has agreed to it.
      </p>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Voice name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My voice" />
        </div>
        <div>
          <Label>Sample (mp3, wav, m4a)</Label>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </div>
        <div className="sm:col-span-2 flex items-center justify-end gap-3">
          {done && <span className="text-sm font-medium text-emerald-600">Submitted ✓</span>}
          {error && <span className="text-sm text-rose-600">{error}</span>}
          <Button type="submit" disabled={busy || !file}>
            {busy ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Admin-only: make an accent variant of an approved voice, and hear it. */
function AccentCard() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [dialect, setDialect] = useState('us');
  const [gender, setGender] = useState('female');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api<Voice[]>('/ai-calls/voices')
      .then((list) => {
        setVoices(list);
        if (list[0]) setVoiceId(list[0].id);
      })
      .catch(() => setVoices([]));
  }, []);

  async function createVariant() {
    if (!voiceId || !name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ voice_id: string }>(`/ai-calls/voices/${voiceId}/accent`, {
        method: 'POST',
        body: { name: name.trim(), dialect, gender },
      });
      setMessage(`Created ${name.trim()} — ${res.voice_id}`);
      setName('');
      setVoices(await api<Voice[]>('/ai-calls/voices'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create the variant');
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    if (!voiceId) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/ai-calls/voices/${voiceId}/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Preview failed');
      const url = URL.createObjectURL(await res.blob());
      if (audioRef.current) {
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not play a preview');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <h2 className="text-base font-semibold text-slate-900">Accents</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        Make an accent variant of an existing voice — same person, different English accent. Useful
        when a client's candidates are all in one country.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Voice</Label>
          <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Accent</Label>
          <Select value={dialect} onChange={(e) => setDialect(e.target.value)}>
            {DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Original speaker</Label>
          <Select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
        </div>
        <div>
          <Label>New voice name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lipsa — British"
          />
        </div>
        <div className="sm:col-span-2 flex items-center justify-end gap-3">
          {message && <span className="text-sm text-slate-600">{message}</span>}
          <Button variant="secondary" onClick={preview} disabled={busy || !voiceId}>
            Hear it
          </Button>
          <Button onClick={createVariant} disabled={busy || !voiceId || !name.trim()}>
            {busy ? 'Working…' : 'Create accent'}
          </Button>
        </div>
      </div>
      <audio ref={audioRef} className="mt-3 w-full" controls />
    </Card>
  );
}
