/**
 * Classic dual-tone telephone ring, synthesised with WebAudio so there is no
 * audio asset to load. US ring cadence: 2 seconds on, 4 seconds off.
 *
 * Browsers allow this once the page has seen any user gesture — logging in
 * counts — so recruiters hear incoming calls without pre-enabling anything.
 */
export class Ringer {
  private context: AudioContext | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopBurst: (() => void) | null = null;

  start(): void {
    if (this.context) return;
    try {
      this.context = new AudioContext();
      const burst = () => this.ringBurst();
      burst();
      this.interval = setInterval(burst, 6000);
    } catch {
      this.context = null;
    }
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.stopBurst?.();
    this.stopBurst = null;
    this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private ringBurst(): void {
    const ctx = this.context;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    gain.connect(ctx.destination);

    // 440 Hz + 480 Hz is the North American ringback pair.
    const oscillators = [440, 480].map((frequency) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start();
      return osc;
    });

    // Amplitude-modulate lightly so it reads as a phone, not a test tone.
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.setValueAtTime(0.02, now + 1);
    gain.gain.setValueAtTime(0.08, now + 1.2);

    const stop = () => {
      for (const osc of oscillators) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          /* already stopped */
        }
      }
      gain.disconnect();
    };
    this.stopBurst = stop;
    setTimeout(stop, 2000);
  }
}

/** Ask once for desktop-notification permission; safe to call repeatedly. */
export function ensureNotificationPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => undefined);
  }
}

/** Desktop notification that fronts the app when clicked. */
export function notifyIncomingCall(caller: string): Notification | null {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
  try {
    const notification = new Notification('Incoming call', {
      body: `${caller} is calling — click to answer`,
      tag: 'snappyconnect-incoming',
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
    return notification;
  } catch {
    return null;
  }
}
