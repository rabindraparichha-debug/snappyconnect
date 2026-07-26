'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getStoredUser } from '@/lib/api';
import type { Region } from '@/lib/types';
import { Button, Card, EmptyState, Input, Label, Modal, Select, Spinner } from '@/components/ui';

type ScheduledCallStatus = 'pending' | 'completed' | 'canceled' | 'missed';

interface ScheduledCall {
  id: string;
  phoneNumber: string;
  contactName: string | null;
  scheduledAt: string;
  notes: string | null;
  region: Region | null;
  status: ScheduledCallStatus;
  user?: { id: string; name: string } | null;
}

const STATUS_STYLES: Record<ScheduledCallStatus, string> = {
  pending: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  canceled: 'bg-slate-100 text-slate-500',
  missed: 'bg-rose-100 text-rose-700',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SchedulePage() {
  const user = getStoredUser();
  const [items, setItems] = useState<ScheduledCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledCall | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    phoneNumber: '',
    contactName: '',
    date: '',
    time: '09:00',
    notes: '',
    region: '' as string,
  });

  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<ScheduledCall[]>('/scheduled-calls', {
        query: {
          from: monthStart.toISOString().slice(0, 10),
          to: monthEnd.toISOString().slice(0, 10),
        },
      });
      setItems(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate(day?: string) {
    setEditing(null);
    setForm({
      phoneNumber: '',
      contactName: '',
      date: day ?? new Date().toISOString().slice(0, 10),
      time: '09:00',
      notes: '',
      region: '',
    });
    setModalOpen(true);
  }

  function openEdit(item: ScheduledCall) {
    const d = new Date(item.scheduledAt);
    setEditing(item);
    setForm({
      phoneNumber: item.phoneNumber,
      contactName: item.contactName ?? '',
      date: d.toISOString().slice(0, 10),
      time: d.toTimeString().slice(0, 5),
      notes: item.notes ?? '',
      region: item.region ?? '',
    });
    setModalOpen(true);
  }

  async function save() {
    if (!form.phoneNumber.trim() || !form.date) return;
    setSaving(true);
    const scheduledAt = new Date(`${form.date}T${form.time}`).toISOString();
    const body = {
      phoneNumber: form.phoneNumber.trim(),
      contactName: form.contactName.trim() || undefined,
      scheduledAt,
      notes: form.notes.trim() || undefined,
      region: form.region || undefined,
    };
    try {
      if (editing) {
        await api(`/scheduled-calls/${editing.id}`, { method: 'PATCH', body });
      } else {
        await api('/scheduled-calls', { method: 'POST', body });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(item: ScheduledCall, status: ScheduledCallStatus) {
    try {
      await api(`/scheduled-calls/${item.id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  async function remove(item: ScheduledCall) {
    try {
      await api(`/scheduled-calls/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  // Build calendar grid
  const firstWeekday = monthStart.getDay();
  const daysInMonth = monthEnd.getDate();
  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = new Date(month.getFullYear(), month.getMonth(), d).toLocaleDateString('en-CA');
    cells.push({ day: d, iso });
  }

  const byDay = items.reduce<Record<string, ScheduledCall[]>>((acc, item) => {
    const key = new Date(item.scheduledAt).toLocaleDateString('en-CA');
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  const todayIso = new Date().toLocaleDateString('en-CA');
  const dayItems = selectedDay ? byDay[selectedDay] ?? [] : items;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Schedule</h1>
          <p className="mt-1 text-sm text-slate-500">
            Plan calls ahead and get reminded when they are due.
          </p>
        </div>
        <Button onClick={() => openCreate()}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Schedule Call
        </Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {/* Month navigation */}
      <Card className="mt-6 p-4">
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Previous month"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.24a.75.75 0 0 1 0-1.06l4.25-4.24a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
          <h2 className="text-base font-semibold text-slate-900">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Next month"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.24a.75.75 0 0 1 0 1.06l-4.25 4.24a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="pb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {d}
                </div>
              ))}
              {cells.map((cell, i) => {
                if (!cell) return <div key={`empty-${i}`} />;
                const dayCalls = byDay[cell.iso] ?? [];
                const isToday = cell.iso === todayIso;
                const isSelected = cell.iso === selectedDay;
                return (
                  <button
                    key={cell.iso}
                    onClick={() => setSelectedDay(isSelected ? null : cell.iso)}
                    onDoubleClick={() => openCreate(cell.iso)}
                    className={`min-h-[68px] rounded-lg border p-1.5 text-left transition ${
                      isSelected
                        ? 'border-brand-400 bg-brand-50'
                        : isToday
                        ? 'border-brand-200 bg-white'
                        : 'border-slate-100 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className={`text-xs font-semibold ${isToday ? 'text-brand-600' : 'text-slate-600'}`}>
                      {cell.day}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {dayCalls.slice(0, 2).map((c) => (
                        <div
                          key={c.id}
                          className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${STATUS_STYLES[c.status]}`}
                        >
                          {new Date(c.scheduledAt).toTimeString().slice(0, 5)} {c.contactName ?? c.phoneNumber}
                        </div>
                      ))}
                      {dayCalls.length > 2 && (
                        <p className="px-1 text-[10px] text-slate-400">+{dayCalls.length - 2} more</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Click a day to filter · double-click to schedule a call on that day
            </p>
          </>
        )}
      </Card>

      {/* List */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {selectedDay
            ? new Date(`${selectedDay}T00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
            : 'All scheduled calls this month'}
        </h2>
        {selectedDay && (
          <button onClick={() => setSelectedDay(null)} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Clear filter
          </button>
        )}
      </div>

      <Card className="mt-3 overflow-hidden">
        {dayItems.length === 0 ? (
          <EmptyState title="Nothing scheduled" subtitle="Use Schedule Call to plan your next conversation." />
        ) : (
          <div className="divide-y divide-slate-100">
            {dayItems.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-50">
                  <span className="text-[10px] font-medium uppercase text-slate-400">
                    {new Date(item.scheduledAt).toLocaleDateString(undefined, { month: 'short' })}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {new Date(item.scheduledAt).getDate()}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {item.contactName || item.phoneNumber}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(item.scheduledAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    {item.contactName ? ` · ${item.phoneNumber}` : ''}
                    {user?.role === 'admin' && item.user ? ` · ${item.user.name}` : ''}
                  </p>
                  {item.notes && <p className="mt-0.5 truncate text-xs text-slate-400">{item.notes}</p>}
                </div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[item.status]}`}>
                  {item.status}
                </span>
                <div className="flex items-center gap-1">
                  {item.status === 'pending' && (
                    <button
                      onClick={() => setStatus(item, 'completed')}
                      title="Mark completed"
                      className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(item)}
                    title="Edit"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M2.7 14.5 2 18l3.5-.7 9.2-9.2-2.8-2.8-9.2 9.2ZM17.3 5.3a1.5 1.5 0 0 0 0-2.1l-.5-.5a1.5 1.5 0 0 0-2.1 0l-1 1 2.6 2.6 1-1Z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => remove(item)}
                    title="Delete"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M8.75 1a1 1 0 0 0-.95.68L7.42 3H4a1 1 0 0 0 0 2h12a1 1 0 1 0 0-2h-3.42l-.38-1.32A1 1 0 0 0 11.25 1h-2.5ZM5 6.5h10l-.7 10.1a1.5 1.5 0 0 1-1.5 1.4H7.2a1.5 1.5 0 0 1-1.5-1.4L5 6.5Z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Scheduled Call' : 'Schedule a Call'}
        onClose={() => setModalOpen(false)}
      >
        <div className="space-y-3">
          <div>
            <Label>Phone Number</Label>
            <Input
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
              placeholder="+1 555 000 1234"
            />
          </div>
          <div>
            <Label>Contact Name</Label>
            <Input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Region</Label>
            <Select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
              <option value="">Auto-detect</option>
              <option value="india">India</option>
              <option value="usa">USA</option>
              <option value="uae">UAE</option>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="What is this call about?"
              className="block w-full rounded-lg border-0 px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.phoneNumber.trim()}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Schedule'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
