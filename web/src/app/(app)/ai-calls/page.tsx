'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { Button, Card, Input, Label } from '@/components/ui';

interface LiveCall {
  platformCallId: string;
  phone: string;
  contactName: string | null;
  seconds: number;
  takenOver: boolean;
}

/**
 * Recruiter-facing AI calling: dispatch a call, watch it live, listen in, or
 * take over from the AI mid-conversation.
 */
export default function AiCallsPage() {
  const user = getStoredUser();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [dispatchMsg, setDispatchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const [live, setLive] = useState<LiveCall[]>([]);
  const [liveMsg, setLiveMsg] = useState('');
  const [joined, setJoined] = useState<string | null>(null);
  const roomRef = useRef<any>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  const loadLive = useCallback(() => {
    api<LiveCall[]>('/ai-calls/active').then(setLive).catch(() => setLive([]));
  }, []);

  useEffect(() => {
    loadLive();
    const t = setInterval(loadLive, 5000);
    return () => {
      clearInterval(t);
      roomRef.current?.disconnect?.();
    };
  }, [loadLive]);

  async function dispatch() {
    if (!phone.trim()) return;
    setDispatching(true);
    setDispatchMsg(null);
    try {
      const res = await api<{ message: string }>('/ai-calls', {
        method: 'POST',
        body: {
          phoneNumber: phone.trim(),
          contactName: name.trim() || undefined,
          goalPrompt: goal.trim() || undefined,
        },
      });
      setDispatchMsg({ ok: true, text: res.message });
      setPhone('');
      setName('');
      setTimeout(loadLive, 3000);
    } catch (err) {
      setDispatchMsg({ ok: false, text: err instanceof Error ? err.message : 'Dispatch failed' });
    } finally {
      setDispatching(false);
    }
  }

  async function join(call: LiveCall, publish: boolean) {
    setLiveMsg(publish ? 'Going live…' : 'Connecting…');
    try {
      const token = await api<{ url: string; token: string }>(
        `/ai-calls/${call.platformCallId}/listen-token`,
        { method: 'POST', body: { publish } },
      );
      const { Room, RoomEvent } = await import('livekit-client');
      if (roomRef.current) {
        try {
          await roomRef.current.disconnect();
        } catch {
          /* already gone */
        }
      }
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (track.kind === 'audio' && dockRef.current) {
          const el = track.attach();
          el.autoplay = true;
          dockRef.current.appendChild(el);
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        setJoined(null);
        setLiveMsg('');
        if (dockRef.current) dockRef.current.innerHTML = '';
      });
      await room.connect(token.url, token.token);
      if (publish) await room.localParticipant.setMicrophoneEnabled(true);
      setJoined(call.platformCallId);
      setLiveMsg(
        publish
          ? '🔴 You are LIVE — the candidate can hear you.'
          : '🎧 Listening — no one can hear you.',
      );
    } catch (err) {
      setLiveMsg(err instanceof Error ? err.message : 'Could not join the call');
    }
  }

  async function takeOver(call: LiveCall) {
    if (!window.confirm('Stop the AI and take this call yourself?')) return;
    try {
      await api(`/ai-calls/${call.platformCallId}/takeover`, { method: 'POST' });
      await join(call, true);
      loadLive();
    } catch (err) {
      setLiveMsg(err instanceof Error ? err.message : 'Takeover failed');
    }
  }

  function leave() {
    roomRef.current?.disconnect?.();
    roomRef.current = null;
    setJoined(null);
    setLiveMsg('');
    if (dockRef.current) dockRef.current.innerHTML = '';
  }

  const canUse = user?.regions?.includes('usa') || user?.regions?.includes('uae');

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">AI Calls</h1>
      <p className="mt-1 text-sm text-slate-500">
        The AI agent dials, introduces itself, and holds the conversation — you can listen in
        or take over at any moment. Outcomes and transcripts land in Call History.
      </p>

      {!canUse && (
        <Card className="mt-6 p-6">
          <p className="text-sm text-slate-500">
            AI calling needs USA or UAE access — ask an admin to enable a region for you.
          </p>
        </Card>
      )}

      {canUse && (
        <>
          <Card className="mt-6 p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Start an AI call
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Number</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1… or +971…"
                />
              </div>
              <div>
                <Label>Their name (optional)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
              </div>
            </div>
            <div className="mt-3">
              <Label>What should the agent achieve? (optional)</Label>
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Confirm interest in the warehouse role and book a callback"
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={dispatch} disabled={dispatching || !phone.trim()}>
                {dispatching ? 'Dispatching…' : '🤖 Start AI call'}
              </Button>
              {dispatchMsg && (
                <p className={`text-sm ${dispatchMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                  {dispatchMsg.text}
                </p>
              )}
            </div>
          </Card>

          <Card className="mt-6 p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Live now
            </h2>
            {live.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No AI calls in progress.</p>
            ) : (
              <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
                {live.map((c) => (
                  <div key={c.platformCallId} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {c.contactName || c.phone}
                      </p>
                      <p className="text-xs text-slate-400">
                        {c.phone} · {Math.floor(c.seconds / 60)}m {c.seconds % 60}s
                        {c.takenOver && ' · taken over'}
                      </p>
                    </div>
                    {joined === c.platformCallId ? (
                      <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={leave}>
                        🔇 Leave
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="secondary"
                          className="!px-3 !py-1.5 text-xs"
                          onClick={() => join(c, false)}
                        >
                          🎧 Listen
                        </Button>
                        {!c.takenOver && (
                          <Button
                            className="!px-3 !py-1.5 text-xs"
                            onClick={() => takeOver(c)}
                          >
                            🎙 Take over
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {liveMsg && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{liveMsg}</p>}
            <div ref={dockRef} />
          </Card>
        </>
      )}
    </div>
  );
}
