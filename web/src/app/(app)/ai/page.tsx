'use client';

import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button, Card, Spinner } from '@/components/ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Write a follow-up message after a no-answer call',
  'Give me 5 cold-calling tips for recruiting',
  'Draft interview questions for a senior developer',
  'How to handle a candidate who wants more salary?',
];

export default function AiPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text?: string) {
    const content = (text || input).trim();
    if (!content || loading) return;

    setInput('');
    setError(null);
    const newMessages: Message[] = [...messages, { role: 'user', content }];
    setMessages(newMessages);
    setLoading(true);

    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      const res = await api<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: { messages: newMessages },
      });
      setMessages([...newMessages, { role: 'assistant', content: res.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed');
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  function clear() {
    setMessages([]);
    setError(null);
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Assistant</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your recruiting copilot — ask anything about candidates, calls, or best practices.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" onClick={clear}>
            Clear chat
          </Button>
        )}
      </div>

      {/* Messages */}
      <Card className="mt-4 flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-brand-600">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                </svg>
              </div>
              <p className="mb-4 text-sm text-slate-500">Try one of these:</p>
              <div className="grid max-w-md gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === 'user'
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">
                    <Spinner className="h-4 w-4" />
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-slate-200 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the AI assistant…"
              className="flex-1 rounded-lg border-0 px-3 py-2.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600"
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              Send
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
