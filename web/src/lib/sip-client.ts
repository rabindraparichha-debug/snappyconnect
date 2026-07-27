import { api } from './api';

/**
 * Browser softphone for UAE (Asterisk) users — the web counterpart of the
 * mobile app's in-app SIP dialer. Registers the user's own SIP account over an
 * encrypted WebSocket (plain SIP is blocked by UAE ISPs) so calls go straight
 * out through Asterisk instead of the PBX ringing a separate app first.
 *
 * One registration is shared per browser session, matching the Telnyx client:
 * two registrations on the same SIP account would fight over the same line.
 */

export interface SipConfig {
  /** Asterisk's own port — used by the mobile app, which tolerates its self-signed cert. */
  wssUrl: string;
  /** Browser-facing URL behind a trusted certificate. Falls back to wssUrl server-side. */
  webWssUrl?: string;
  sipDomain: string;
  sipUsername: string;
  sipPassword: string;
  displayName: string;
}

interface SipSession {
  ua: any;
  config: SipConfig;
}

let sessionPromise: Promise<SipSession> | null = null;

/** Registered SIP user agent, connecting and registering on first use. */
export async function getSipClient(): Promise<SipSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const config = await api<SipConfig>('/calls/asterisk/config');
    const { UserAgent, Registerer } = await import('sip.js');

    const uri = UserAgent.makeURI(`sip:${config.sipUsername}@${config.sipDomain}`);
    if (!uri) throw new Error('Could not build a SIP address from your account details.');

    const ua: any = new UserAgent({
      uri,
      // Never Asterisk's raw port: browsers reject its self-signed certificate.
      transportOptions: { server: config.webWssUrl || config.wssUrl },
      authorizationUsername: config.sipUsername,
      authorizationPassword: config.sipPassword,
      displayName: config.displayName,
      userAgentString: 'SnappyConnect Web',
      // Audio only — the Dinstar SIM trunk carries no video.
      sessionDescriptionHandlerFactoryOptions: {
        constraints: { audio: true, video: false },
      },
    });

    await ua.start();

    const registerer = new Registerer(ua);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('SIP registration timed out — check the Asterisk WSS URL.')),
        15000,
      );
      registerer.stateChange.addListener((state: string) => {
        if (state === 'Registered') {
          clearTimeout(timeout);
          resolve();
        } else if (state === 'Terminated') {
          clearTimeout(timeout);
          reject(new Error('SIP registration was rejected — check your SIP username and password.'));
        }
      });
      registerer.register().catch((err: any) => {
        clearTimeout(timeout);
        reject(new Error(err?.message ?? 'SIP registration failed'));
      });
    });

    ua.registerer = registerer;

    // A dropped transport invalidates the registration; the next caller
    // reconnects from scratch rather than dialing into a dead socket.
    ua.transport.onDisconnect = () => {
      sessionPromise = null;
    };

    return { ua, config };
  })();

  sessionPromise.catch(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

/**
 * Place an outbound call. The destination is passed through exactly as the
 * recruiter typed it — the Asterisk dialplan does the UAE normalisation, and
 * the mobile app relies on the same behaviour.
 */
export async function placeSipCall(
  destination: string,
  remoteAudio: HTMLAudioElement,
  handlers: {
    onProgress?: () => void;
    onAnswered?: () => void;
    onEnded?: (reason?: string) => void;
    onFailed?: (message: string) => void;
  },
): Promise<{ hangup: () => void; id: string }> {
  const { ua, config } = await getSipClient();
  const { Inviter, UserAgent, SessionState } = await import('sip.js');

  const target = UserAgent.makeURI(`sip:${destination}@${config.sipDomain}`);
  if (!target) throw new Error(`${destination} is not a number this line can dial.`);

  const inviter: any = new Inviter(ua, target, {
    sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
  });

  let settled = false;

  inviter.stateChange.addListener((state: string) => {
    switch (state) {
      case SessionState.Establishing:
        handlers.onProgress?.();
        break;
      case SessionState.Established: {
        // Attach the far end's audio once media is negotiated.
        const sdh: any = inviter.sessionDescriptionHandler;
        const pc: RTCPeerConnection | undefined = sdh?.peerConnection;
        if (pc) {
          const stream = new MediaStream();
          pc.getReceivers().forEach((r) => {
            if (r.track) stream.addTrack(r.track);
          });
          remoteAudio.srcObject = stream;
          remoteAudio.play().catch(() => {
            /* autoplay policies vary; the call itself is unaffected */
          });
        }
        handlers.onAnswered?.();
        break;
      }
      case SessionState.Terminated:
        if (!settled) {
          settled = true;
          remoteAudio.srcObject = null;
          handlers.onEnded?.();
        }
        break;
      default:
        break;
    }
  });

  try {
    await inviter.invite();
  } catch (err) {
    settled = true;
    const message = err instanceof Error ? err.message : 'The call could not be placed.';
    handlers.onFailed?.(message);
    throw new Error(message);
  }

  return {
    id: inviter.request?.callId ?? `sip-${Date.now()}`,
    hangup: () => {
      try {
        // Only an established session can BYE; anything earlier must CANCEL.
        if (inviter.state === SessionState.Established) inviter.bye();
        else inviter.cancel();
      } catch {
        /* already gone */
      }
    },
  };
}

export function resetSipClient() {
  sessionPromise?.then(({ ua }) => {
    try {
      ua.registerer?.unregister();
      ua.stop();
    } catch {
      /* noop */
    }
  });
  sessionPromise = null;
}
