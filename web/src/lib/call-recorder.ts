import { API_URL, getToken } from './api';

/**
 * Records a WebRTC call in the browser: the recruiter's microphone and the
 * far end's audio are mixed into one track and captured with MediaRecorder,
 * then uploaded to SnappyConnect when the call ends.
 *
 * This keeps recording free — the carrier never touches it — at the cost of
 * only capturing calls made from a browser that stays open until hang-up.
 */
export class CallRecorder {
  private context: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopped: Promise<Blob> | null = null;

  /** True when this browser can record (all modern desktop/mobile browsers). */
  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioContext !== 'undefined'
    );
  }

  private static mimeType(): string | undefined {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
  }

  /**
   * @param local  the recruiter's microphone stream
   * @param remote the far end's stream (from the SDK or the audio element)
   */
  start(local: MediaStream | null, remote: MediaStream | null): boolean {
    if (!CallRecorder.isSupported() || (!local && !remote)) return false;
    try {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();

      for (const stream of [local, remote]) {
        if (stream && stream.getAudioTracks().length > 0) {
          context.createMediaStreamSource(stream).connect(destination);
        }
      }

      const mimeType = CallRecorder.mimeType();
      const recorder = new MediaRecorder(
        destination.stream,
        mimeType ? { mimeType } : undefined,
      );
      this.chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };

      this.stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
      });

      recorder.start(5000); // flush every 5s so long calls stay in memory-safe chunks
      this.context = context;
      this.recorder = recorder;
      return true;
    } catch {
      return false;
    }
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Stop capturing and return the audio, or null if nothing was recorded. */
  async stop(): Promise<Blob | null> {
    if (!this.recorder || this.recorder.state === 'inactive') return null;
    this.recorder.stop();
    const blob = await this.stopped;
    try {
      await this.context?.close();
    } catch {
      /* noop */
    }
    this.context = null;
    this.recorder = null;
    return blob && blob.size > 0 ? blob : null;
  }

  /** Attach the audio to a call log so it shows up in Recordings. */
  static async upload(callLogId: string, blob: Blob): Promise<boolean> {
    try {
      const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
      const form = new FormData();
      form.append('file', blob, `call-${callLogId}.${extension}`);
      const res = await fetch(`${API_URL}/calls/log/${callLogId}/recording`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
