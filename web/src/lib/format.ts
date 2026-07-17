export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  answered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  in_progress: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  ringing: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  initiated: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  missed: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  no_answer: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  busy: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  canceled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
