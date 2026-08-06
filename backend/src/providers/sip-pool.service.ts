import { promises as fs } from 'fs';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PoolLine {
  username: string;
  password: string;
}

/**
 * The pool of pre-provisioned Asterisk extensions (2001–2025), read straight
 * from pjsip.conf on this host so the app and the PBX can never disagree
 * about credentials. Used to hand each new UAE recruiter the next free
 * extension serially — nothing is ever created or purchased here.
 */
@Injectable()
export class SipPoolService {
  private readonly logger = new Logger(SipPoolService.name);
  private readonly confPath: string;
  private cache: PoolLine[] = [];
  private cacheMtime = 0;

  constructor(config: ConfigService) {
    this.confPath = config.get<string>(
      'ASTERISK_PJSIP_CONF',
      '/etc/asterisk/pjsip.conf',
    );
  }

  /** All pool extensions with credentials, ascending. Empty off-server. */
  async pool(): Promise<PoolLine[]> {
    let mtime: number;
    try {
      mtime = (await fs.stat(this.confPath)).mtimeMs;
    } catch {
      return []; // not on the PBX host (dev machine) — feature stays inert
    }
    if (mtime !== this.cacheMtime) {
      this.cache = this.parse(await fs.readFile(this.confPath, 'utf8'));
      this.cacheMtime = mtime;
      this.logger.log(`SIP pool loaded: ${this.cache.length} extensions`);
    }
    return this.cache;
  }

  /** Lowest-numbered extension not in `taken`, or null when exhausted. */
  async nextFree(taken: Set<string>): Promise<PoolLine | null> {
    for (const line of await this.pool()) {
      if (!taken.has(line.username)) return line;
    }
    return null;
  }

  /** Auth sections whose username is a 20XX recruiter extension. */
  private parse(conf: string): PoolLine[] {
    const lines: PoolLine[] = [];
    let section: Record<string, string> | null = null;

    const flush = () => {
      if (
        section?.type === 'auth' &&
        section.username &&
        /^20\d\d$/.test(section.username) &&
        section.password
      ) {
        lines.push({ username: section.username, password: section.password });
      }
    };

    for (const raw of conf.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        flush();
        section = {};
        continue;
      }
      if (!section || !line || line.startsWith(';')) continue;
      const eq = line.indexOf('=');
      if (eq > 0) {
        section[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }
    flush();
    return lines.sort((a, b) => Number(a.username) - Number(b.username));
  }
}
