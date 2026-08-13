'use client';

import { useEffect, useRef, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import { CallRecorder } from '@/lib/call-recorder';
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
 * Turn a getUserMedia failure into an instruction a recruiter can act on.
 * "Blocked" and "no microphone plugged in" need opposite fixes, and a bare
 * "access required" sends people to re-grant a permission they already have.
 */
function describeMicError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone found — plug one in (or connect a headset) and try again.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone is in use by another app (Zoom, Teams…). Close it and try again.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Your microphone could not be opened. Pick a different input under the padlock in the address bar, or reconnect your headset.';
  }
  // Chrome raises NotAllowedError both when the site permission is denied and
  // when the browser itself lacks OS-level microphone access.
  return (
    'Microphone blocked. Allow it from the padlock in the address bar, and check that your ' +
    `browser has microphone access in system privacy settings. (${name || 'unknown error'})`
  );
}

interface CallScript {
  id: string;
  title: string;
  body: string;
  region: string | null;
}

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
  const [scripts, setScripts] = useState<CallScript[]>([]);
  const [openScriptId, setOpenScriptId] = useState<string | null>(null);
  const [recordingEnabled, setRecordingEnabled] = useState(false);

  const clientRef = useRef<any>(null);
  const callRef = useRef<any>(null);
  const answeredAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const handlerRef = useRef<((notification: any) => void) | null>(null);
  const dialStartedAtRef = useRef<string | null>(null);
  const isSipCallRef = useRef(false);
  const [micState, setMicState] = useState<'unknown' | 'granted' | 'prompt' | 'denied'>('unknown');

  // Know the microphone situation the moment the dialer opens, and track it
  // live, so problems surface as a banner before the first call — not as a
  // dead-sounding call.
  useEffect(() => {
    let status: PermissionStatus | undefined;
    (async () => {
      try {
        status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        if (!status) return;
        const apply = () => setMicState(status!.state as 'granted' | 'prompt' | 'denied');
        apply();
        status.onchange = apply;
      } catch {
        // Permissions API unsupported (Safari): the pre-call check still runs.
      }
    })();
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  /**
   * Get a working microphone (with device fallback) or throw with an
   * actionable message. Shared by every call path and the enable banner.
   */
  async function ensureMicrophone(): Promise<string | undefined> {
    try {
      const { acquireMicrophone } = await import('@/lib/sip-client');
      const deviceId = await acquireMicrophone();
      setMicState('granted');
      return deviceId;
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setMicState('denied');
      throw new Error(describeMicError(err));
    }
  }

  async function enableMicClicked() {
    setMessage('');
    try {
      await ensureMicrophone();
      setMessage('Microphone ready — you can place calls.');
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Microphone unavailable');
    }
  }
  const recorderRef = useRef<CallRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(false);

  useEffect(() => {
    setNumber(initialNumber);
  }, [initialNumber]);

  useEffect(() => {
    api<CallScript[]>('/scripts')
      .then(setScripts)
      .catch(() => setScripts([]));
  }, []);

  useEffect(() => {
    api<{ browserRecording: boolean }>('/calls/recording-policy')
      .then((policy) => setRecordingEnabled(policy.browserRecording))
      .catch(() => setRecordingEnabled(false));
  }, []);

  // Click-to-call pre-fills the number and stops there. Dialling on arrival
  // was tried and reverted: the page is opened programmatically, so there is
  // no user gesture behind it and the browser refuses the microphone even when
  // the recruiter has granted it. Their press of Call carries the gesture.

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

  /**
   * Keypad entry. Holding "0" types "+" instead, the way phone dialers do —
   * recruiters need it for international numbers (+91…, +971…).
   */
  function pressKey(key: string) {
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    setNumber((n) => n + key);
  }

  function startHold(key: string) {
    if (key !== '0') return;
    heldRef.current = false;
    holdRef.current = setTimeout(() => {
      heldRef.current = true;
      setNumber((n) => n + '+');
    }, 400);
  }

  function cancelHold() {
    if (holdRef.current) clearTimeout(holdRef.current);
    holdRef.current = null;
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

    // Telnyx calls are placed in-browser and never hit the server-side guard,
    // so the suppression list is checked here for every route.
    try {
      const { blocked } = await api<{ blocked: boolean }>('/dnc/check', {
        query: { phoneNumber: target },
      });
      if (blocked) {
        setState('error');
        setMessage('This number is on the Do Not Call list.');
        return;
      }
    } catch {
      // A failed check shouldn't strand the recruiter; `initiate` still guards
      // the server-side routes.
    }

    if (shouldUseTelnyx(target)) {
      await placeTelnyxCall(target);
    } else if (shouldUseSip(target)) {
      await placeUaeSipCall(target);
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

  /**
   * The UAE trunk carries UAE numbers and every international destination —
   * it is the only carrier path licensed for the latter. Calls dial in-browser
   * over SIP rather than Asterisk ringing the recruiter's line back first.
   *
   * Telnyx is checked before this, so USA numbers never reach here. India keeps
   * its native-dialer path for recruiters who have India access.
   */
  function shouldUseSip(target: string): boolean {
    const uaeAccess = user?.regions?.includes('uae') || user?.provider === 'asterisk';
    if (!uaeAccess) return false;
    const n = target.replace(/[\s\-().]/g, '');
    if (user?.regions?.includes('india') && /^(\+91|0091|91)\d{10}$/.test(n)) return false;
    return true;
  }

  async function placeUaeSipCall(target: string) {
    setState('connecting');
    setMessage('Requesting microphone access…');
    dialStartedAtRef.current = new Date().toISOString();
    finishedRef.current = false;
    isSipCallRef.current = true;

    try {
      const micDeviceId = await ensureMicrophone();

      setMessage('Connecting to your SIP line…');
      const { placeSipCall } = await import('@/lib/sip-client');

      setMessage(`Dialing ${target}…`);
      const call = await placeSipCall(target, audioRef.current as HTMLAudioElement, {
        onProgress: () => {
          setState('ringing');
          setMessage(`Ringing ${target}…`);
        },
        onAnswered: () => {
          if (!answeredAtRef.current) startTimer();
          setState('active');
          setMessage('In call');
        },
        onEnded: () => finishSipCall(target),
        onFailed: (msg) => {
          setState('error');
          setMessage(msg);
        },
      }, micDeviceId);
      // Reuse callRef so the shared Hang up button drives this call too.
      callRef.current = call;
    } catch (err) {
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Could not start the call');
    }
  }

  async function finishSipCall(target: string) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopTimer();
    const answered = answeredAtRef.current !== null;
    const duration = answered
      ? Math.floor((Date.now() - (answeredAtRef.current as number)) / 1000)
      : 0;

    setState('ended');
    setMessage(answered ? `Call ended (${duration}s)` : 'Call ended — not answered');

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
          region: 'uae',
          source: 'web',
        },
      });
    } catch {
      /* logging failure shouldn't break the UI */
    }

    answeredAtRef.current = null;
    callRef.current = null;
    isSipCallRef.current = false;
  }

  async function placeTelnyxCall(target: string) {
    setState('connecting');
    setMessage('Requesting microphone access…');
    dialStartedAtRef.current = new Date().toISOString();
    try {
      // A failed microphone must stop the call with a real explanation —
      // swallowing it here produced instant dead calls logged as no_answer,
      // with the recruiter never told why.
      await ensureMicrophone();

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
            startRecording(call);
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

  /**
   * Capture the call in the browser (free) rather than paying the carrier to
   * record. Needs both streams, so it starts once the call is answered.
   */
  function startRecording(call: any) {
    if (recorderRef.current || !recordingEnabled) return;
    const remote: MediaStream | null =
      call?.remoteStream ?? (audioRef.current?.srcObject as MediaStream | null) ?? null;
    const local: MediaStream | null = call?.localStream ?? null;
    const recorder = new CallRecorder();
    if (recorder.start(local, remote)) {
      recorderRef.current = recorder;
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

    // Telnyx says WHY a call ended (rejected, busy, invalid number…) — an
    // unanswered instant failure is a different problem from ringing out,
    // and hiding the cause made those indistinguishable.
    const cause: string | undefined =
      callRef.current?.cause ?? callRef.current?.hangupCause ?? undefined;
    const failedInstantly = !answered && duration === 0 && cause &&
      !['NORMAL_CLEARING', 'ORIGINATOR_CANCEL'].includes(cause);

    setState('ended');
    setMessage(
      answered
        ? `Call ended (${duration}s)`
        : failedInstantly
          ? `Call failed — carrier says: ${cause}. The number may be blocking or unreachable.`
          : 'Call ended — not answered',
    );

    const externalId =
      callRef.current?.telnyxIDs?.telnyxLegId ?? callRef.current?.id ?? undefined;

    // Stop the recorder first so the audio is ready to attach to the log.
    const audio = await recorderRef.current?.stop().catch(() => null);
    recorderRef.current = null;

    try {
      const log = await api<{ id: string }>('/calls/log', {
        method: 'POST',
        body: {
          phoneNumber: target,
          direction: 'outbound',
          status: answered ? 'completed' : 'no_answer',
          durationSeconds: duration,
          startedAt: dialStartedAtRef.current ?? undefined,
          endedAt: new Date().toISOString(),
          externalId,
          notes: cause && cause !== 'NORMAL_CLEARING' ? `Hangup cause: ${cause}` : undefined,
        },
      });
      if (audio && log?.id) {
        setMessage('Saving recording…');
        const saved = await CallRecorder.upload(log.id, audio);
        setMessage(
          saved
            ? `Call ended (${duration}s) · recording saved`
            : `Call ended (${duration}s) · recording could not be saved`,
        );
      }
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
    if (!clientRef.current && !isSipCallRef.current) {
      // Non-WebRTC call (PBX / native dialer): nothing more to wait for.
      // Telnyx and SIP both settle in their own end-of-call handlers.
      setState('idle');
      setMessage('');
    }
  }

  const busy = state === 'connecting' || state === 'ringing' || state === 'active';

  return (
    <div className="w-full">
      <audio ref={audioRef} autoPlay />

      {micState === 'prompt' && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          <span>Calls need your microphone.</span>
          <Button onClick={enableMicClicked} className="!px-3 !py-1.5 text-xs shrink-0">
            Enable microphone
          </Button>
        </div>
      )}
      {micState === 'denied' && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-200">
          Microphone access is blocked, so calls can&apos;t work. Click the padlock in the
          address bar → allow Microphone, then reload. On Mac also check System Settings →
          Privacy &amp; Security → Microphone for your browser.
        </div>
      )}

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
            onClick={() => pressKey(key)}
            onPointerDown={() => startHold(key)}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onContextMenu={(e) => key === '0' && e.preventDefault()}
            title={key === '0' ? 'Hold for +' : undefined}
            className="relative rounded-lg bg-slate-100 py-2.5 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-40"
          >
            {key}
            {key === '0' && (
              <span className="absolute right-2 top-1.5 text-[10px] font-medium text-slate-400">
                +
              </span>
            )}
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

      {scripts.length > 0 && (state === 'ringing' || state === 'active') && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Talk Tracks</p>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {scripts.map((s) => (
              <div key={s.id} className="rounded-lg bg-slate-50">
                <button
                  onClick={() => setOpenScriptId(openScriptId === s.id ? null : s.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700"
                >
                  <span className="truncate">{s.title}</span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', openScriptId === s.id && 'rotate-180')}
                  >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06 0L10 10.94l3.71-3.73a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.23 8.27a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>
                {openScriptId === s.id && (
                  <p className="whitespace-pre-wrap px-3 pb-2 text-xs leading-relaxed text-slate-600">
                    {s.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(user?.regions?.length ?? 0) > 0 ? (
        <p className="mt-3 text-center text-xs text-slate-400">
          {user!.regions.map(r => r.toUpperCase()).join(' · ')} — +1 dials in-browser
          {user!.regions.includes('uae') ? ', UAE dials in-browser over SIP' : ''}
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
                ? 'your SIP line (browser softphone)'
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
