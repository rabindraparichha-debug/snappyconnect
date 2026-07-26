'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { SmsLog, SmsThread } from '@/lib/types';
import { Button, Card, EmptyState, Input, Spinner, cn } from '@/components/ui';

/** Shared team inbox for the USA (Telnyx) number: read replies and send SMS. */
export default function SmsPage() {
  const [threads, setThreads] = useState<SmsThread[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsLog[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [newNumber, setNewNumber] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      const result = await api<SmsThread[]>('/sms/threads');
      setThreads(result);
      setError(null);
      setSelected((current) => current ?? result[0]?.phoneNumber ?? null);
    } catch (err) {
      setThreads([]);
      setError(err instanceof Error ? err.message : 'Failed to load messages');
    }
  }, []);

  const loadThread = useCallback(async (number: string) => {
    setLoadingThread(true);
    try {
      setMessages(await api<SmsLog[]>(`/sms/threads/${encodeURIComponent(number)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    // New replies arrive by webhook, so poll while the inbox is open.
    const timer = setInterval(loadThreads, 15000);
    return () => clearInterval(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (selected) loadThread(selected);
  }, [selected, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const to = selected ?? newNumber.trim();
    const body = draft.trim();
    if (!to || !body) return;

    setSending(true);
    setError(null);
    try {
      await api('/sms/send', { method: 'POST', body: { to, body } });
      setDraft('');
      setComposeOpen(false);
      setNewNumber('');
      setSelected(to);
      await Promise.all([loadThread(to), loadThreads()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <p className="mt-1 text-sm text-slate-500">
            Shared SMS inbox for your USA number — replies from candidates land here.
          </p>
        </div>
        <Button
          onClick={() => {
            setComposeOpen(true);
            setSelected(null);
            setMessages([]);
          }}
        >
          New message
        </Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Conversation list */}
        <Card className="overflow-hidden">
          {threads === null ? (
            <div className="flex justify-center py-16">
              <Spinner className="h-6 w-6" />
            </div>
          ) : threads.length === 0 ? (
            <EmptyState title="No messages yet" subtitle="Send one to start a conversation." />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {threads.map((thread) => (
                <li key={thread.phoneNumber}>
                  <button
                    onClick={() => {
                      setComposeOpen(false);
                      setSelected(thread.phoneNumber);
                    }}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors hover:bg-slate-50',
                      selected === thread.phoneNumber && 'bg-indigo-50',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {thread.phoneNumber}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">
                        {formatWhen(thread.lastAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {thread.direction === 'outbound' && (
                        <span className="text-slate-400">You: </span>
                      )}
                      {thread.lastMessage}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Thread */}
        <Card className="flex min-h-[60vh] flex-col">
          {composeOpen ? (
            <div className="border-b border-slate-100 p-4">
              <Input
                type="tel"
                autoFocus
                placeholder="Recipient number, e.g. +1 555 000 1234"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
              />
            </div>
          ) : selected ? (
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">{selected}</p>
              <p className="text-xs text-slate-400">{messages.length} messages</p>
            </div>
          ) : null}

          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {loadingThread ? (
              <div className="flex justify-center py-10">
                <Spinner className="h-6 w-6" />
              </div>
            ) : !selected && !composeOpen ? (
              <EmptyState
                title="Select a conversation"
                subtitle="Or start a new message to a candidate."
              />
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex',
                    message.direction === 'outbound' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm',
                      message.direction === 'outbound'
                        ? 'rounded-br-md bg-indigo-600 text-white'
                        : 'rounded-bl-md bg-slate-100 text-slate-800',
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    <p
                      className={cn(
                        'mt-1 text-[10px]',
                        message.direction === 'outbound' ? 'text-indigo-200' : 'text-slate-400',
                      )}
                    >
                      {formatWhen(message.createdAt)}
                      {message.direction === 'outbound' && ` · ${message.status}`}
                      {message.user && ` · ${message.user.name}`}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {(selected || composeOpen) && (
            <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
              <Input
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" disabled={sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function formatWhen(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}
