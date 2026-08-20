'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { CallRecorder } from '@/lib/call-recorder';
import { ensureNotificationPermission, notifyIncomingCall, Ringer } from '@/lib/ringer';
import { getTelnyxClient } from '@/lib/telnyx-client';
import type { User } from '@/lib/types';
import { Button } from '@/components/ui';

/**
 * App-wide incoming-call handling for Telnyx (USA) users. Registers the
 * shared WebRTC client on mount so return calls to the user's number ring
 * in the browser, and shows an Answer/Decline card on any page.
 */
export function TelnyxIncoming({ user }: { user: User | null }) {
  const [incoming, setIncoming] = useState<any>(null);
  const [inCall, setInCall] = useState(false);
  const [caller, setCaller] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const answeredAtRef = useRef<number | null>(null);
  const startedAtRef = useRef<string | null>(null);
  const loggedIdsRef = useRef<Set<string>>(new Set());
  const recorderRef = useRef<CallRecorder | null>(null);
  const ringerRef = useRef(new Ringer());
  const desktopNoteRef = useRef<Notification | null>(null);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const capable = Boolean(
    user && (user.provider === 'telnyx' || user.regions?.includes('usa')),
  );

  useEffect(() => {
    if (!capable) return;
    let attachedClient: any = null;
    let disposed = false;

    // Recruiters must hear incoming calls, not just see a card: ask for
    // desktop-notification permission up front (login click satisfies the
    // gesture requirement for audio later).
    ensureNotificationPermission();

    const handler = (notification: any) => {
      if (notification.type !== 'callUpdate' || !notification.call) return;
      const call = notification.call;
      if (call.direction !== 'inbound') return;

      switch (call.state) {
        case 'ringing': {
          setIncoming(call);
          const from =
            call.options?.remoteCallerNumber ?? call.options?.callerNumber ?? 'Unknown caller';
          setCaller(from);
          startedAtRef.current = new Date().toISOString();
          ringerRef.current.start();
          desktopNoteRef.current = notifyIncomingCall(from);
          break;
        }
        case 'active':
          stopAlerting();
          setInCall(true);
          startRecording(call);
          if (!answeredAtRef.current) {
            answeredAtRef.current = Date.now();
            timerRef.current = setInterval(() => {
              setElapsed(Math.floor((Date.now() - (answeredAtRef.current ?? Date.now())) / 1000));
            }, 1000);
          }
          break;
        case 'hangup':
        case 'destroy':
          stopAlerting();
          finishCall(call);
          break;
        default:
          break;
      }
    };

    /**
     * Keep the registration alive. A dropped socket (laptop sleep, network
     * blip, expired session) previously left the recruiter unreachable until
     * a manual reload; now every check reconnects and re-attaches the handler.
     */
    const ensureConnected = async () => {
      try {
        const client = await getTelnyxClient();
        if (disposed || client === attachedClient) return;
        try {
          attachedClient?.off('telnyx.notification', handler);
        } catch {
          /* noop */
        }
        client.on('telnyx.notification', handler);
        attachedClient = client;
      } catch {
        /* offline — the next tick retries */
      }
    };

    void ensureConnected();
    const keepAlive = setInterval(ensureConnected, 45_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ensureConnected();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      clearInterval(keepAlive);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        attachedClient?.off('telnyx.notification', handler);
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capable, user?.id]);

  function stopAlerting() {
    ringerRef.current.stop();
    desktopNoteRef.current?.close();
    desktopNoteRef.current = null;
  }

  useEffect(() => {
    if (!capable) return;
    api<{ browserRecording: boolean }>('/calls/recording-policy')
      .then((policy) => setRecordingEnabled(policy.browserRecording))
      .catch(() => setRecordingEnabled(false));
  }, [capable]);

  /** Free browser-side recording, same as the outbound dialer. */
  function startRecording(call: any) {
    if (recorderRef.current || !recordingEnabled) return;
    const remote: MediaStream | null =
      call?.remoteStream ?? (audioRef.current?.srcObject as MediaStream | null) ?? null;
    const recorder = new CallRecorder();
    if (recorder.start(call?.localStream ?? null, remote)) {
      recorderRef.current = recorder;
    }
  }

  function finishCall(call: any) {
    const id: string = call?.id ?? 'unknown';
    if (loggedIdsRef.current.has(id)) return;
    loggedIdsRef.current.add(id);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const answered = answeredAtRef.current !== null;
    const duration = answered
      ? Math.floor((Date.now() - (answeredAtRef.current as number)) / 1000)
      : 0;
    answeredAtRef.current = null;

    setIncoming(null);
    setInCall(false);
    setElapsed(0);

    const recorder = recorderRef.current;
    recorderRef.current = null;

    void (async () => {
      const audio = await recorder?.stop().catch(() => null);
      try {
        const log = await api<{ id: string }>('/calls/log', {
          method: 'POST',
          body: {
            phoneNumber: caller || 'unknown',
            direction: 'inbound',
            status: answered ? 'completed' : 'missed',
            durationSeconds: duration,
            startedAt: startedAtRef.current ?? undefined,
            endedAt: new Date().toISOString(),
            externalId: call?.telnyxIDs?.telnyxLegId ?? id,
          },
        });
        if (audio && log?.id) await CallRecorder.upload(log.id, audio);
      } catch {
        /* logging failure shouldn't break the UI */
      }
    })();
  }

  async function answer() {
    if (!incoming) return;
    stopAlerting();
    try {
      const client = await getTelnyxClient();
      if (audioRef.current) client.remoteElement = audioRef.current;
      incoming.answer();
    } catch {
      /* noop */
    }
  }

  function decline() {
    stopAlerting();
    try {
      incoming?.hangup();
    } catch {
      /* noop */
    }
  }

  function hangupActive() {
    try {
      incoming?.hangup();
    } catch {
      /* noop */
    }
  }

  if (!capable) return null;

  return (
    <>
      <audio ref={audioRef} autoPlay />
      {incoming && !inCall && (
        <div className="fixed bottom-6 left-1/2 z-50 w-80 -translate-x-1/2 rounded-2xl bg-slate-900 p-5 text-white shadow-2xl">
          <div className="mb-4 flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Incoming call</p>
              <p className="text-lg font-semibold">{caller}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={answer} className="w-full bg-emerald-600 hover:bg-emerald-700">
              Answer
            </Button>
            <Button variant="danger" onClick={decline} className="w-full">
              Decline
            </Button>
          </div>
        </div>
      )}
      {inCall && (
        <div className="fixed bottom-6 left-1/2 z-50 flex w-80 -translate-x-1/2 items-center justify-between rounded-2xl bg-slate-900 p-4 text-white shadow-2xl">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">In call</p>
            <p className="text-sm font-semibold">
              {caller} · {elapsed}s
            </p>
          </div>
          <Button variant="danger" onClick={hangupActive}>
            End
          </Button>
        </div>
      )}
    </>
  );
}
