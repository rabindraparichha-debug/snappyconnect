'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type { InitiateCallResult } from '@/lib/types';
import { Button, Input, cn } from '@/components/ui';

type DialState =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'active'
  | 'ended'
  | 'queued'
  | 'error';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/**
 * Universal dialer. For Telnyx users the call is placed in-browser over
 * WebRTC; for Grandstream/Native Dialer users it asks the API to initiate
 * (PBX originate / queue to mobile) and shows the outcome.
 */
export function DialerPanel({ initialNumber = '' }: { initialNumber?: string }) {
  const user = getStoredUser();
  const [number, setNumber] = useState(initialNumber);
  const [state, setState] = useState<DialState>('idle');
  const [message, setMessage] = useState<string>('');
  const [elapsed, setElapsed] = useState(0);

  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const answeredAtRef = useRef<number | null>(null);
  const dialStartedAtRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        clientRef.current?.disconnect();
      } catch {
        /* noop */
      }
    };
  }, []);

  function startTimer() {
    answeredAtRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (answeredAtRef.current ?? Date.now())) / 1000));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  async function placeCall() {
    const target = number.trim();
    if (!target) return;
    setMessage('');
    setElapsed(0);

    if (user?.provider === 'telnyx') {
      await placeTelnyxCall(target);
    } else {
      // Grandstream / Native Dialer: the backend does the work.
      setState('connecting');
      try {
        const result = await api<InitiateCallResult>('/calls/initiate', {
          method: 'POST',
          body: { phoneNumber: target, source: 'web' },
        });
        setState('queued');
        setMessage(result.message);
      } catch (err) {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Call failed');
      }
    }
  }

  async function placeTelnyxCall(target: string) {
    setState('connecting');
    setMessage('Connecting to Telnyx…');
    dialStartedAtRef.current = new Date().toISOString();
    try {
      const { token } = await api<{ token: string }>('/calls/telnyx/token', { method: 'POST' });
      const { TelnyxRTC } = await import('@telnyx/webrtc');

      const client: any = new TelnyxRTC({ login_token: token });
      clientRef.current = client;
      if (audioRef.current) client.remoteElement = audioRef.current;

      client.on('telnyx.ready', () => {
        setMessage(`Dialing ${target}…`);
        callRef.current = client.newCall({
          destinationNumber: target,
          audio: true,
          video: false,
        });
      });

      client.on('telnyx.error', (err: any) => {
        setState('error');
        setMessage(err?.message ?? 'Telnyx connection error');
      });

      client.on('telnyx.notification', (notification: any) => {
        if (notification.type !== 'callUpdate' || !notification.call) return;
        const call = notification.call;
        callRef.current = call;
        switch (call.state) {
          case 'ringing':
          case 'trying':
          case 'requesting':
          case 'early':
            setState('ringing');
            setMessage(`Ringing ${target}…`);
            break;
          case 'active':
            if (!answeredAtRef.current) startTimer();
            setState('active');
            setMessage('In call');
            break;
          case 'hangup':
          case 'destroy':
            finishTelnyxCall(target);
            break;
          default:
            break;
        }
      });

      await client.connect();
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not start the call');
    }
  }

  async function finishTelnyxCall(target: string) {
    stopTimer();
    const answered = answeredAtRef.current !== null;
    const duration = answered
      ? Math.floor((Date.now() - (answeredAtRef.current as number)) / 1000)
      : 0;

    setState('ended');
    setMessage(answered ? `Call ended (${duration}s)` : 'Call ended — not answered');

    const externalId =
      callRef.current?.telnyxIDs?.telnyxLegId ?? callRef.current?.id ?? undefined;

    try {
      await api('/calls/log', {
        method: 'POST',
        body: {
          phoneNumber: target,
          direction: 'outbound',
          status: answered ? 'completed' : 'no_answer',
          durationSeconds: duration,
          startedAt: dialStartedAtRef.current ?? undefined,
          endedAt: new Date().toISOString(),
          externalId,
        },
      });
    } catch {
      /* logging failure shouldn't break the UI */
    }

    answeredAtRef.current = null;
    try {
      clientRef.current?.disconnect();
    } catch {
      /* noop */
    }
    clientRef.current = null;
  }

  function hangup() {
    try {
      callRef.current?.hangup();
    } catch {
      /* noop */
    }
    if (user?.provider !== 'telnyx') {
      setState('idle');
      setMessage('');
    }
  }

  const busy = state === 'connecting' || state === 'ringing' || state === 'active';

  return (
    <div className="w-full">
      <audio ref={audioRef} autoPlay />
      <div className="mb-3">
        <Input
          type="tel"
          placeholder="+1 555 000 1234"
          value={number}
          disabled={busy}
          onChange={(e) => setNumber(e.target.value)}
          className="text-center text-lg font-semibold tracking-wide"
        />
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            disabled={busy}
            onClick={() => setNumber((n) => n + key)}
            className="rounded-lg bg-slate-100 py-2.5 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-40"
          >
            {key}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={cn(
            'mb-3 rounded-lg px-3 py-2 text-center text-sm',
            state === 'error'
              ? 'bg-rose-50 text-rose-700'
              : state === 'active'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600',
          )}
        >
          {message}
          {state === 'active' && ` · ${elapsed}s`}
        </p>
      )}

      <div className="flex gap-2">
        {!busy ? (
          <Button onClick={placeCall} className="w-full bg-emerald-600 hover:bg-emerald-700">
            <PhoneIcon /> Call
          </Button>
        ) : (
          <>
            {user?.provider === 'telnyx' && (
              <Button variant="danger" onClick={hangup} className="w-full">
                Hang up
              </Button>
            )}
          </>
        )}
        {(state === 'ended' || state === 'queued' || state === 'error') && (
          <Button
            variant="secondary"
            onClick={() => {
              setState('idle');
              setMessage('');
            }}
          >
            Reset
          </Button>
        )}
      </div>

      {user?.provider && (
        <p className="mt-3 text-center text-xs text-slate-400">
          Calling via{' '}
          {user.provider === 'telnyx'
            ? 'Telnyx (browser)'
            : user.provider === 'grandstream'
              ? 'Grandstream PBX (your extension will ring)'
              : 'your mobile phone (native dialer)'}
        </p>
      )}
      {!user?.provider && (
        <p className="mt-3 text-center text-xs text-amber-600">
          No calling provider assigned — ask your administrator.
        </p>
      )}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}
