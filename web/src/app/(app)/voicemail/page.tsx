'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, API_URL, getToken } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';

interface Voicemail {
  id: string;
  fromNumber: string;
  recordingUrl: string | null;
  durationSeconds: number;
  read: boolean;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

export default function VoicemailPage() {
  const [items, setItems] = useState<Voicemail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<Voicemail[]>('/voicemails'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voicemail');
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Audio sits behind auth, so fetch it with the token as a blob. */
  async function fetchAudio(item: Voicemail): Promise<Blob | null> {
    if (!item.recordingUrl) return null;
    const path = item.recordingUrl.replace(/^\/api\/v1/, '');
    const url = path.startsWith('http') ? path : `${API_URL}${path}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) {
      setError('That message is no longer available');
      return null;
    }
    return res.blob();
  }

  async function togglePlay(item: Voicemail) {
    if (playing === item.id) {
      setPlaying(null);
      return;
    }
    const blob = await fetchAudio(item);
    if (!blob) return;
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setPlaying(item.id);
    // Hearing it is what "read" means, so mark it without a second click.
    if (!item.read) await setRead(item, true);
  }

  async function setRead(item: Voicemail, read: boolean) {
    try {
      await api(`/voicemails/${item.id}/read`, { method: 'PATCH', body: { read } });
      setItems((prev) =>
        (prev ?? []).map((v) => (v.id === item.id ? { ...v, read } : v)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the message');
    }
  }

  async function remove(item: Voicemail) {
    try {
      await api(`/voicemails/${item.id}`, { method: 'DELETE' });
      setItems((prev) => (prev ?? []).filter((v) => v.id !== item.id));
      if (playing === item.id) setPlaying(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the message');
    } finally {
      setConfirming(null);
    }
  }

  async function download(item: Voicemail) {
    const blob = await fetchAudio(item);
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `voicemail-${item.fromNumber}-${item.createdAt.slice(0, 10)}.mp3`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const unread = (items ?? []).filter((v) => !v.read).length;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Voicemail</h1>
      <p className="mt-1 text-sm text-slate-500">
        Messages left when a call went unanswered.
        {unread > 0 && <span className="ml-1 font-medium text-brand-700">{unread} new.</span>}
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {items === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No voicemail"
          subtitle="When a caller leaves a message, it appears here."
        />
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    {!item.read && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-brand-600"
                        aria-label="Unread"
                      />
                    )}
                    {item.fromNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(item.createdAt)} · {formatDuration(item.durationSeconds)}
                    {item.user ? ` · for ${item.user.name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => togglePlay(item)}>
                    {playing === item.id ? 'Stop' : 'Play'}
                  </Button>
                  <Button variant="ghost" onClick={() => download(item)}>
                    Download
                  </Button>
                  <Button variant="ghost" onClick={() => setRead(item, !item.read)}>
                    {item.read ? 'Mark unread' : 'Mark read'}
                  </Button>
                  {confirming === item.id ? (
                    <>
                      <Button
                        variant="ghost"
                        className="!text-rose-600"
                        onClick={() => remove(item)}
                      >
                        Delete for good
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirming(item.id)}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              {playing === item.id && audioUrl && (
                <audio controls autoPlay className="mt-3 w-full" src={audioUrl} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
