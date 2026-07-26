'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, Input, Label, Modal, Select, Spinner } from '@/components/ui';

type ItemStatus = 'pending' | 'called' | 'skipped' | 'blocked';

interface ContactList {
  id: string;
  name: string;
  description: string | null;
  totalContacts: number;
  calledContacts: number;
  createdAt: string;
  owner?: { id: string; name: string } | null;
}

interface ContactItem {
  id: string;
  phoneNumber: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  status: ItemStatus;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  invalid: number;
  blocked: number;
}

const STATUS_STYLES: Record<ItemStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  called: 'bg-emerald-100 text-emerald-700',
  skipped: 'bg-amber-100 text-amber-700',
  blocked: 'bg-rose-100 text-rose-700',
};

export default function ListsPage() {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ContactList | null>(null);
  const [items, setItems] = useState<ContactItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newList, setNewList] = useState({ name: '', description: '' });
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLists(await api<ContactList[]>('/contact-lists'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load lists');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openList = useCallback(async (list: ContactList) => {
    setSelected(list);
    setItemsLoading(true);
    try {
      setItems(await api<ContactItem[]>(`/contact-lists/${list.id}/items`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contacts');
    } finally {
      setItemsLoading(false);
    }
  }, []);

  async function createList() {
    if (!newList.name.trim()) return;
    try {
      await api('/contact-lists', {
        method: 'POST',
        body: { name: newList.name.trim(), description: newList.description.trim() || undefined },
      });
      setCreateOpen(false);
      setNewList({ name: '', description: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create list');
    }
  }

  async function removeList(list: ContactList) {
    try {
      await api(`/contact-lists/${list.id}`, { method: 'DELETE' });
      if (selected?.id === list.id) setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete list');
    }
  }

  async function resetList(list: ContactList) {
    try {
      await api(`/contact-lists/${list.id}/reset`, { method: 'POST' });
      await load();
      await openList(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset list');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contact Lists</h1>
          <p className="mt-1 text-sm text-slate-500">
            Import candidates from a CSV and work through them with the power dialer.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          New List
        </Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Lists */}
        <div className="space-y-2 lg:col-span-1">
          {lists.length === 0 ? (
            <Card>
              <EmptyState title="No lists yet" subtitle="Create one, then import a CSV of candidates." />
            </Card>
          ) : (
            lists.map((list) => {
              const pct = list.totalContacts > 0
                ? Math.round((list.calledContacts / list.totalContacts) * 100)
                : 0;
              const active = selected?.id === list.id;
              return (
                <Card
                  key={list.id}
                  className={`cursor-pointer p-4 transition ${active ? 'ring-2 ring-brand-400' : 'hover:bg-slate-50'}`}
                >
                  <div onClick={() => openList(list)}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{list.name}</p>
                      <span className="shrink-0 text-xs text-slate-400">
                        {list.calledContacts}/{list.totalContacts}
                      </span>
                    </div>
                    {list.description && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">{list.description}</p>
                    )}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  {active && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => setImportOpen(true)}
                      >
                        Import CSV
                      </Button>
                      {list.totalContacts > 0 && (
                        <Link
                          href={`/dialer?list=${list.id}`}
                          className="inline-flex items-center rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Power Dial
                        </Link>
                      )}
                      <Button
                        variant="secondary"
                        className="px-2 py-1 text-xs"
                        onClick={() => resetList(list)}
                      >
                        Reset
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2 py-1 text-xs"
                        onClick={() => removeList(list)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>

        {/* Contacts in the selected list */}
        <div className="lg:col-span-2">
          {!selected ? (
            <Card>
              <EmptyState
                title="Select a list"
                subtitle="Pick a list on the left to see the candidates in it."
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">{selected.name}</h2>
                <span className="text-xs text-slate-400">{items.length} contacts</span>
              </div>
              {itemsLoading ? (
                <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
              ) : items.length === 0 ? (
                <EmptyState title="No contacts yet" subtitle="Import a CSV to fill this list." />
              ) : (
                <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {item.name || item.phoneNumber}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {item.name ? item.phoneNumber : ''}
                          {item.email ? `${item.name ? ' · ' : ''}${item.email}` : ''}
                        </p>
                        {item.notes && <p className="truncate text-xs text-slate-400">{item.notes}</p>}
                      </div>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[item.status]}`}>
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <Modal open={createOpen} title="New Contact List" onClose={() => setCreateOpen(false)}>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input
              value={newList.name}
              onChange={(e) => setNewList({ ...newList, name: e.target.value })}
              placeholder="Senior React devs — Dubai"
            />
          </div>
          <div>
            <Label>Description</Label>
            <Input
              value={newList.description}
              onChange={(e) => setNewList({ ...newList, description: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createList} disabled={!newList.name.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      {selected && (
        <ImportModal
          open={importOpen}
          listId={selected.id}
          onClose={() => setImportOpen(false)}
          onDone={async () => {
            setImportOpen(false);
            await load();
            await openList(selected);
          }}
        />
      )}
    </div>
  );
}

function ImportModal({
  open,
  listId,
  onClose,
  onDone,
}: {
  open: boolean;
  listId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState({ phone: '', name: '', email: '', notes: '' });
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCsv('');
    setHeaders([]);
    setFileName('');
    setMapping({ phone: '', name: '', email: '', notes: '' });
    setResult(null);
    setError(null);
  }

  async function onFile(file: File) {
    const text = await file.text();
    const firstLine = text.split(/\r?\n/)[0] ?? '';
    // Header preview only — the server does the real RFC-4180 parse.
    const cols = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    setCsv(text);
    setFileName(file.name);
    setHeaders(cols);
    setResult(null);
    setError(null);

    // Pre-select the obvious columns so most imports are one click.
    const find = (...needles: string[]) =>
      cols.find((c) => needles.some((n) => c.toLowerCase().includes(n))) ?? '';
    setMapping({
      phone: find('phone', 'mobile', 'number', 'contact'),
      name: find('name'),
      email: find('email'),
      notes: find('note', 'comment', 'remark'),
    });
  }

  async function runImport() {
    if (!mapping.phone) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api<ImportResult>(`/contact-lists/${listId}/import`, {
        method: 'POST',
        body: {
          csv,
          phoneColumn: mapping.phone,
          nameColumn: mapping.name || undefined,
          emailColumn: mapping.email || undefined,
          notesColumn: mapping.notes || undefined,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Import Contacts from CSV"
      wide
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {result ? (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultTile label="Imported" value={result.imported} tone="emerald" />
            <ResultTile label="Duplicates" value={result.duplicates} tone="slate" />
            <ResultTile label="Invalid" value={result.invalid} tone="amber" />
            <ResultTile label="On DNC" value={result.blocked} tone="rose" />
          </div>
          {result.blocked > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              Numbers on the Do Not Call list were imported but marked blocked — the power dialer will skip them.
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => {
                reset();
                onDone();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <Label>CSV File</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-600 ring-1 ring-inset ring-slate-300 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium file:text-slate-700"
            />
            {fileName && (
              <p className="mt-1 text-xs text-slate-500">
                {fileName} · {headers.length} columns detected
              </p>
            )}
          </div>

          {headers.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Map columns
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Phone Number (required)</Label>
                  <Select
                    value={mapping.phone}
                    onChange={(e) => setMapping({ ...mapping, phone: e.target.value })}
                  >
                    <option value="">Select a column…</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Name</Label>
                  <Select
                    value={mapping.name}
                    onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                  >
                    <option value="">Skip</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Email</Label>
                  <Select
                    value={mapping.email}
                    onChange={(e) => setMapping({ ...mapping, email: e.target.value })}
                  >
                    <option value="">Skip</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Notes</Label>
                  <Select
                    value={mapping.notes}
                    onChange={(e) => setMapping({ ...mapping, notes: e.target.value })}
                  >
                    <option value="">Skip</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </Select>
                </div>
              </div>
            </>
          )}

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button onClick={runImport} disabled={importing || !mapping.phone}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResultTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  const tones: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-600',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
  };
  return (
    <div className={`rounded-lg p-3 text-center ${tones[tone]}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}
