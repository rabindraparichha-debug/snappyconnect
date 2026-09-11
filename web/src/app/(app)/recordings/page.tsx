'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';
import type { CallLog, Paginated } from '@/lib/types';
import { PROVIDER_LABELS } from '@/lib/types';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Button, Card, EmptyState, Input, Select, Spinner } from '@/components/ui';

const LIMIT = 20;

interface RecordingSettings {
  browserRecording: boolean;
  usaEnabled: boolean;
  uaeEnabled: boolean;
}

export default function RecordingsPage() {
  const [data, setData] = useState<Paginated<CallLog> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [provider, setProvider] = useState('');
  const [page, setPage] = useState(1);

  const [settings, setSettings] = useState<RecordingSettings | null>(null);
  const [savingSetting, setSavingSetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<Paginated<CallLog>>('/calls', {
        query: { q, provider, hasRecording: 'true', page, limit: LIMIT },
      });
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [q, provider, page]);

  useEffect(() => {
    const timeout = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timeout);
  }, [load, q]);

  useEffect(() => {
    api<RecordingSettings>('/numbers/recording')
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  async function updateSetting(body: Record<string, boolean>) {
    setSavingSetting(true);
    try {
      setSettings(await api<RecordingSettings>('/numbers/recording', { method: 'POST', body }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the recording setting');
    } finally {
      setSavingSetting(false);
    }
  }

  /** Recordings sit behind auth, so fetch them with the token as a blob. */
  async function fetchRecording(call: CallLog): Promise<Blob | null> {
    if (!call.recordingUrl) return null;
    const path = call.recordingUrl.replace(/^\/api\/v1/, '');
    const res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      setError(res.status === 404 ? 'That recording is no longer available' : 'Could not load the recording');
      return null;
    }
    return res.blob();
  }

  async function togglePlay(call: CallLog) {
    if (playing === call.id) {
      setPlaying(null);
      return;
    }
    const blob = await fetchRecording(call);
    if (!blob) return;
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setPlaying(call.id);
  }

  async function download(call: CallLog) {
    const blob = await fetchRecording(call);
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const stamp = String(call.startedAt ?? call.createdAt).slice(0, 10);
    link.download = `${call.phoneNumber}-${stamp}.${
      call.recordingUrl?.endsWith('.mp3') ? 'mp3' : 'wav'
    }`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Call Recordings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every recorded call, playable here and archived on your storage server.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {settings && (
        <Card className="mt-5 p-5">
          <h2 className="text-sm font-semibold text-slate-900">Recording settings</h2>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  In-app recording (USA calls) — free
                </p>
                <p className="text-xs text-slate-500">
                  Captured in the recruiter&apos;s browser and uploaded here. No carrier charges.
                  Only records calls made from the web app while the tab stays open.
                </p>
              </div>
              <Button
                variant={settings.browserRecording ? 'danger' : 'primary'}
                disabled={savingSetting}
                onClick={() => updateSetting({ browserRecording: !settings.browserRecording })}
              >
                {savingSetting ? 'Saving…' : settings.browserRecording ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  Carrier recording (USA calls) — paid
                </p>
                <p className="text-xs text-slate-500">
                  Telnyx records every call server-side (about $0.002/min plus storage). Catches
                  calls the browser can&apos;t — closed tabs, mobile app. Leave off unless you need
                  that.
                </p>
              </div>
              <Button
                variant={settings.usaEnabled ? 'danger' : 'secondary'}
                disabled={savingSetting}
                onClick={() => updateSetting({ usaEnabled: !settings.usaEnabled })}
              >
                {savingSetting ? 'Saving…' : settings.usaEnabled ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
              <div>
                <p className="text-sm font-medium text-slate-800">UAE calls (PBX) — free</p>
                <p className="text-xs text-slate-500">
                  Recorded on your own server by the PBX. Always on, no per-minute cost.
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Active
              </span>
            </div>
          </div>
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Some US states and the UAE require telling callers they are being recorded — add a line
            to your call opening or the board-line greeting.
          </p>
        </Card>
      )}

      <Card className="mt-5 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            placeholder="Search number or user…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All regions</option>
            <option value="telnyx">USA (Telnyx)</option>
            <option value="asterisk">UAE (PBX)</option>
            <option value="grandstream">UAE (Grandstream)</option>
          </Select>
        </div>
      </Card>

      <Card className="mt-5">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No recordings yet"
            subtitle="Recorded calls appear here a minute or two after they end."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.items.map((call) => (
              <div key={call.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {call.phoneNumber}
                      {call.contactName && (
                        <span className="ml-2 text-sm font-normal text-slate-400">
                          {call.contactName}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTime(call.startedAt ?? call.createdAt)} ·{' '}
                      {formatDuration(call.durationSeconds)} ·{' '}
                      {PROVIDER_LABELS[call.provider] ?? call.provider} · {call.direction}
                      {call.user && ` · ${call.user.name}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="!px-3 !py-1.5 text-xs"
                      onClick={() => togglePlay(call)}
                    >
                      {playing === call.id ? 'Hide player' : 'Play'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1.5 text-xs"
                      onClick={() => download(call)}
                    >
                      Download
                    </Button>
                  </div>
                </div>
                {playing === call.id && audioUrl && (
                  <audio controls autoPlay className="mt-3 w-full" src={audioUrl} />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {data && data.total > LIMIT && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Page {page} of {totalPages} · {data.total} recordings
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
