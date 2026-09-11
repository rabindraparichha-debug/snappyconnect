import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { Readable } from 'stream';
import { join } from 'path';

/**
 * Call recordings live in two places: a local working directory on the app
 * server (fast to write and serve) and a long-term archive on the storage VPS,
 * which has the disk space for years of audio. A timer rsyncs local → archive
 * and prunes old local copies; anything no longer local is streamed back from
 * the archive on demand, so playback never breaks.
 */
@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  readonly localDir = process.env.RECORDINGS_DIR || '/opt/snappyconnect/recordings';
  private readonly archiveHost = process.env.RECORDINGS_ARCHIVE_HOST || '';
  private readonly archiveDir = process.env.RECORDINGS_ARCHIVE_DIR || '/data/recordings';
  private readonly archiveKey = process.env.RECORDINGS_ARCHIVE_KEY || '/root/.ssh/id_storage';

  constructor() {
    if (!existsSync(this.localDir)) {
      mkdirSync(this.localDir, { recursive: true });
    }
  }

  /** Public URL the web app uses to play a recording. */
  urlFor(filename: string): string {
    return `/api/v1/calls/recordings/${filename}`;
  }

  static filenameFromUrl(url: string | null): string | null {
    if (!url) return null;
    return url.split('/').pop() ?? null;
  }

  localPath(filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    return join(this.localDir, safe);
  }

  existsLocally(filename: string): boolean {
    const path = this.localPath(filename);
    return existsSync(path) && statSync(path).size > 0;
  }

  /** Pull a provider-hosted recording (Telnyx) into local storage. */
  async downloadTo(filename: string, sourceUrl: string): Promise<boolean> {
    try {
      const res = await fetch(sourceUrl);
      if (!res.ok || !res.body) {
        this.logger.warn(`Recording download failed (${res.status}) for ${filename}`);
        return false;
      }
      await new Promise<void>((resolve, reject) => {
        const file = createWriteStream(this.localPath(filename));
        Readable.fromWeb(res.body as any)
          .pipe(file)
          .on('finish', () => resolve())
          .on('error', reject);
      });
      return true;
    } catch (err) {
      this.logger.warn(`Recording download error for ${filename}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Stream a recording that has already been pruned locally straight from the
   * archive over SSH, so old calls stay playable in the admin UI.
   */
  archiveStream(filename: string): Readable | null {
    if (!this.archiveHost) return null;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const child = spawn(
      'ssh',
      [
        '-i',
        this.archiveKey,
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=accept-new',
        this.archiveHost,
        `cat ${this.archiveDir}/${safe}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stderr.on('data', (chunk) =>
      this.logger.warn(`Archive read ${safe}: ${String(chunk).trim()}`),
    );
    return child.stdout;
  }

  contentType(filename: string): string {
    if (filename.endsWith('.mp3')) return 'audio/mpeg';
    if (filename.endsWith('.ogg')) return 'audio/ogg';
    return 'audio/wav';
  }
}
