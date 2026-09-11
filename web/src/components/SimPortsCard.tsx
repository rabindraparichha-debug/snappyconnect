'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button, Card, Input, Select, Spinner } from '@/components/ui';

interface SimExtension {
  exten: string;
  userId: string | null;
  userName: string | null;
  missingSipPassword: boolean;
}

interface SimPort {
  port: number;
  label: string;
  extensions: SimExtension[];
}

interface SimPortsResponse {
  pinningReady: boolean;
  ports: SimPort[];
}

/**
 * The Dinstar's eight SIM slots and the three recruiter extensions that dial
 * out on each. Assigning a recruiter here both gives them their SIP line and
 * pins their outbound calls to that SIM.
 *
 * Pinning only reaches the SIM if the UCM has an `_8X.` outbound route to the
 * GSM trunk; without it a pinned call is answered 404 while an unpinned one
 * completes over the shared pool. That is why pinning is a switch rather than
 * being implied by assigning someone.
 */
export function SimPortsCard({ users }: { users: User[] }) {
  const [data, setData] = useState<SimPortsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await api<SimPortsResponse>('/numbers/sim-ports');
      setData(res);
      setLabels(Object.fromEntries(res.ports.map((p) => [p.port, p.label])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load SIM ports');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<SimPortsResponse>) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      setData(res);
      setLabels(Object.fromEntries(res.ports.map((p) => [p.port, p.label])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  const assign = (exten: string, userId: string) =>
    run(exten, () =>
      api<SimPortsResponse>('/numbers/sim-ports/assign', {
        method: 'POST',
        body: { exten, userId },
      }),
    );

  const unassign = (exten: string) =>
    run(exten, () =>
      api<SimPortsResponse>(`/numbers/sim-ports/assign/${exten}`, { method: 'DELETE' }),
    );

  const saveLabel = (port: number) =>
    run(`label-${port}`, () =>
      api<SimPortsResponse>('/numbers/sim-ports/label', {
        method: 'POST',
        body: { port, label: labels[port] ?? '' },
      }),
    );

  const togglePinning = (enabled: boolean) =>
    run('pinning', () =>
      api<SimPortsResponse>('/numbers/sim-ports/pinning', {
        method: 'POST',
        body: { enabled },
      }),
    );

  if (!data) {
    return (
      <Card className="p-6">
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      </Card>
    );
  }

  // A recruiter can only hold one line, so hide anyone already placed.
  const taken = new Set(
    data.ports.flatMap((p) => p.extensions.map((e) => e.userId).filter(Boolean) as string[]),
  );

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Dinstar SIM ports (UAE)</h2>
          <p className="mt-1 text-sm text-slate-500">
            Eight SIM slots, three recruiter extensions on each. Assigning gives the recruiter
            their SIP line and ties their outbound calls to that SIM.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={data.pinningReady}
            disabled={busy === 'pinning'}
            onChange={(e) => togglePinning(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          SIM pinning active
        </label>
      </div>

      {!data.pinningReady && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Pinning is off, so calls go out over the shared SIM pool — this is the path that works
          today. Assignments below are saved either way. Only switch pinning on once the UCM has
          an <code className="font-mono">_8X.</code> outbound route to the GSM trunk and the
          Dinstar has its per-port rules, otherwise outbound calls will fail with 404.
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {data.ports.map((port) => (
          <div key={port.port} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                {port.port}
              </span>
              <Input
                value={labels[port.port] ?? ''}
                placeholder="SIM number (optional)"
                onChange={(e) =>
                  setLabels((prev) => ({ ...prev, [port.port]: e.target.value }))
                }
                className="!py-1.5 text-sm"
              />
              <Button
                variant="secondary"
                className="!px-2.5 !py-1.5 text-xs"
                disabled={busy === `label-${port.port}` || labels[port.port] === port.label}
                onClick={() => saveLabel(port.port)}
              >
                Save
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {port.extensions.map((ext) => (
                <div key={ext.exten} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 font-mono text-xs text-slate-500">
                    {ext.exten}
                  </span>
                  {ext.userId ? (
                    <>
                      <span className="flex-1 truncate text-sm text-slate-800">
                        {ext.userName}
                        {ext.missingSipPassword && (
                          <span
                            className="ml-1 text-amber-600"
                            title="No SIP password set — this recruiter cannot register until an admin sets one in Users."
                          >
                            ⚠
                          </span>
                        )}
                      </span>
                      <Button
                        variant="secondary"
                        className="!px-2.5 !py-1.5 text-xs"
                        disabled={busy === ext.exten}
                        onClick={() => unassign(ext.exten)}
                      >
                        Release
                      </Button>
                    </>
                  ) : (
                    <Select
                      value=""
                      disabled={busy === ext.exten}
                      onChange={(e) => e.target.value && assign(ext.exten, e.target.value)}
                      className="!py-1.5 text-sm"
                    >
                      <option value="">Unassigned…</option>
                      {users
                        .filter((u) => !taken.has(u.id))
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
