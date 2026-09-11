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
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [dialed, setDialed] = useState('');

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
    setMuted(false);
    setHeld(false);
    setShowKeypad(false);
    setDialed('');

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

  function toggleMute() {
    try {
      if (muted) incoming?.unmuteAudio();
      else incoming?.muteAudio();
      setMuted(!muted);
    } catch {
      /* noop */
    }
  }

  function toggleHold() {
    try {
      if (held) incoming?.unhold();
      else incoming?.hold();
      setHeld(!held);
    } catch {
      /* noop */
    }
  }

  function sendDigit(digit: string) {
    try {
      incoming?.dtmf(digit);
      setDialed((d) => (d + digit).slice(-16));
    } catch {
      /* noop */
    }
  }

  function formatElapsed(totalSeconds: number): string {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
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
        <div className="fixed bottom-6 left-1/2 z-50 w-80 -translate-x-1/2 rounded-2xl bg-slate-900 p-4 text-white shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">
                {held ? 'On hold' : 'In call'}
              </p>
              <p className="text-sm font-semibold">
                {caller} · {formatElapsed(elapsed)}
              </p>
            </div>
            <span className="relative flex h-2.5 w-2.5">
              <span
                className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  held ? 'bg-amber-400' : 'animate-ping bg-emerald-400'
                }`}
              />
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  held ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
            </span>
          </div>
          {showKeypad && (
            <div className="mb-3">
              {dialed && (
                <p className="mb-1 text-center font-mono text-sm tracking-widest text-slate-300">
                  {dialed}
                </p>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                  <button
                    key={digit}
                    onClick={() => sendDigit(digit)}
                    className="rounded-lg bg-slate-800 py-2 text-sm font-semibold hover:bg-slate-700"
                  >
                    {digit}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
              className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold ${
                muted ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {muted ? (
                  <>
                    <line x1="2" y1="2" x2="22" y2="22" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </>
                )}
              </svg>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={toggleHold}
              title={held ? 'Resume' : 'Hold'}
              className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold ${
                held ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {held ? (
                  <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
                ) : (
                  <>
                    <line x1="9" y1="4" x2="9" y2="20" />
                    <line x1="15" y1="4" x2="15" y2="20" />
                  </>
                )}
              </svg>
              {held ? 'Resume' : 'Hold'}
            </button>
            <button
              onClick={() => setShowKeypad((v) => !v)}
              title="Keypad"
              className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold ${
                showKeypad ? 'bg-white text-slate-900' : 'bg-slate-800 hover:bg-slate-700'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                {[5, 12, 19].flatMap((cy) =>
                  [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" />),
                )}
              </svg>
              Keypad
            </button>
            <button
              onClick={hangupActive}
              title="End call"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 text-xs font-semibold hover:bg-red-700"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" transform="rotate(135 12 12)" />
              </svg>
              End
            </button>
          </div>
        </div>
      )}
    </>
  );
}
