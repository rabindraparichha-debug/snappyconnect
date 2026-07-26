'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { getFromNumber, getTelnyxClient } from '@/lib/telnyx-client';
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
  const finishedRef = useRef(false);
  const handlerRef = useRef<((notification: any) => void) | null>(null);
  const dialStartedAtRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      detachHandler();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detachHandler() {
    if (clientRef.current && handlerRef.current) {
      try {
        clientRef.current.off('telnyx.notification', handlerRef.current);
      } catch {
        /* noop */
      }
    }
    handlerRef.current = null;
  }

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

  /** USA numbers dial in-browser via Telnyx when the user has USA access. */
  function shouldUseTelnyx(target: string): boolean {
    if (user?.provider === 'telnyx') return true;
    const usaAccess = user?.regions?.includes('usa');
    const n = target.replace(/[\s\-().]/g, '');
    return Boolean(usaAccess) && (n.startsWith('+1') || /^1\d{10}$/.test(n));
  }

  async function placeCall() {
    const target = number.trim();
    if (!target) return;
    setMessage('');
    setElapsed(0);

    if (shouldUseTelnyx(target)) {
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
    setMessage('Requesting microphone access…');
    dialStartedAtRef.current = new Date().toISOString();
    try {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // mic prompt may fail in some browsers; Telnyx SDK will retry internally
      }

      setMessage('Connecting to Telnyx…');
      const client = await getTelnyxClient();
      finishedRef.current = false;
      clientRef.current = client;
      if (audioRef.current) client.remoteElement = audioRef.current;

      setMessage(`Dialing ${target}…`);
      callRef.current = client.newCall({
        destinationNumber: target,
        callerNumber: getFromNumber(),
        audio: true,
        video: false,
      });
      const myCallId = callRef.current?.id;

      const handler = (notification: any) => {
        if (notification.type !== 'callUpdate' || !notification.call) return;
        const call = notification.call;
        // The shared client also carries other calls (e.g. incoming) — only
        // react to the one this panel placed.
        if (myCallId && call.id !== myCallId) return;
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
      };
      handlerRef.current = handler;
      client.on('telnyx.notification', handler);
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not start the call');
    }
  }

  async function finishTelnyxCall(target: string) {
    // hangup and destroy both arrive for one call — log it once.
    if (finishedRef.current) return;
    finishedRef.current = true;
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
    detachHandler();
    clientRef.current = null;
  }

  function hangup() {
    try {
      callRef.current?.hangup();
    } catch {
      /* noop */
    }
    if (!clientRef.current) {
      // Non-WebRTC call (PBX / native dialer): nothing more to wait for.
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
          <Button variant="danger" onClick={hangup} className="w-full">
            Hang up
          </Button>
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

      {(user?.regions?.length ?? 0) > 0 ? (
        <p className="mt-3 text-center text-xs text-slate-400">
          {user!.regions.map(r => r.toUpperCase()).join(' · ')} — +1 dials in-browser
          {user!.regions.includes('uae') ? ', UAE rings your SIP line' : ''}
          {user!.regions.includes('india') ? ', India queues to mobile' : ''}
        </p>
      ) : user?.provider ? (
        <p className="mt-3 text-center text-xs text-slate-400">
          Calling via{' '}
          {user.provider === 'telnyx'
            ? 'Telnyx (browser)'
            : user.provider === 'grandstream'
              ? 'Grandstream PBX (your extension will ring)'
              : user.provider === 'asterisk'
                ? 'the SnappyConnect mobile app (in-app SIP dialer)'
                : 'your mobile phone (native dialer)'}
        </p>
      ) : (
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
