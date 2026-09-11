import { api } from './api';

/**
 * One shared TelnyxRTC connection per browser session. Registering a single
 * client (rather than one per dialer) keeps the user reachable for incoming
 * calls anywhere in the app, and avoids two registrations fighting over the
 * same telephony credential.
 */
let clientPromise: Promise<any> | null = null;
let cachedFromNumber: string | undefined;

export function getFromNumber(): string | undefined {
  return cachedFromNumber;
}

export async function getTelnyxClient(): Promise<any> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const { token, login, password, fromNumber } = await api<{
      token?: string;
      login?: string;
      password?: string;
      fromNumber?: string;
    }>('/calls/telnyx/token', { method: 'POST' });
    cachedFromNumber = fromNumber;
    const { TelnyxRTC } = await import('@telnyx/webrtc');
    // Telnyx only delivers inbound calls to sessions signed in with the SIP
    // username/password of the connection — token sessions get SIP 480.
    const client: any = new TelnyxRTC(
      login && password ? { login, password } : { login_token: token },
    );

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: any) => {
        cleanup();
        reject(new Error(err?.message ?? 'Telnyx connection error'));
      };
      const cleanup = () => {
        client.off('telnyx.ready', onReady);
        client.off('telnyx.error', onError);
      };
      client.on('telnyx.ready', onReady);
      client.on('telnyx.error', onError);
      client.connect();
    });

    // A dropped socket invalidates the session; the next caller reconnects
    // with a freshly minted token.
    client.on('telnyx.socket.close', () => {
      clientPromise = null;
    });
    return client;
  })();
  clientPromise.catch(() => {
    clientPromise = null;
  });
  return clientPromise;
}

export function resetTelnyxClient() {
  clientPromise?.then((client) => {
    try {
      client.disconnect();
    } catch {
      /* noop */
    }
  });
  clientPromise = null;
}
