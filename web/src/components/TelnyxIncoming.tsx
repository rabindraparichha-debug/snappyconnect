'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const capable = Boolean(
    user && (user.provider === 'telnyx' || user.regions?.includes('usa')),
  );

  useEffect(() => {
    if (!capable) return;
    let client: any;
    let disposed = false;

    const handler = (notification: any) => {
      if (notification.type !== 'callUpdate' || !notification.call) return;
      const call = notification.call;
      if (call.direction !== 'inbound') return;

      switch (call.state) {
        case 'ringing':
          setIncoming(call);
          setCaller(
            call.options?.remoteCallerNumber ?? call.options?.callerNumber ?? 'Unknown caller',
          );
          startedAtRef.current = new Date().toISOString();
          break;
        case 'active':
          setInCall(true);
          if (!answeredAtRef.current) {
            answeredAtRef.current = Date.now();
            timerRef.current = setInterval(() => {
              setElapsed(Math.floor((Date.now() - (answeredAtRef.current ?? Date.now())) / 1000));
            }, 1000);
          }
          break;
        case 'hangup':
        case 'destroy':
          finishCall(call);
          break;
        default:
          break;
      }
    };

    getTelnyxClient()
      .then((c) => {
        if (disposed) {
          return;
        }
        client = c;
        c.on('telnyx.notification', handler);
      })
      .catch(() => {
        /* not reachable for calls; outbound dialing will surface errors */
      });

    return () => {
      disposed = true;
      try {
        client?.off('telnyx.notification', handler);
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capable, user?.id]);

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

    api('/calls/log', {
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
    }).catch(() => {
      /* logging failure shouldn't break the UI */
    });
  }

  async function answer() {
    if (!incoming) return;
    try {
      const client = await getTelnyxClient();
      if (audioRef.current) client.remoteElement = audioRef.current;
      incoming.answer();
    } catch {
      /* noop */
    }
  }

  function decline() {
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
