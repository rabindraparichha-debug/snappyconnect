import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { KeysVaultService, verdictOf } from '../keys-vault/keys-vault.service';

type Endpoint = { key: string; baseUrl: string; model: string };

/** Task names reported to the keys vault, one per AiService operation. */
const TASK_CHAT = 'assistant_chat';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_DEFAULT_MODEL = 'claude-haiku-5-5';
const CLAUDE_TIMEOUT_MS = 30_000;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are SnappyConnect AI Assistant — a helpful recruiting and communication expert embedded in the SnappyConnect calling platform used by SnappyHires recruiters.

You help recruiters with:
- Crafting professional candidate outreach messages
- Preparing interview questions for various roles
- Writing follow-up messages after calls
- Summarizing job descriptions
- Suggesting talking points before calls
- General recruiting best practices
- Tips for effective cold calling and candidate engagement

Keep responses concise, professional, and actionable. When asked about call data or analytics, explain that you can help interpret patterns but cannot directly access the database.`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly settingsService: SettingsService,
    @Optional() private readonly vault?: KeysVaultService,
  ) {}

  /**
   * Endpoints in fail-over order: the central vault's OpenAI-compatible
   * endpoints (custom_llm, with their own base URL and model), then its
   * OPENAI_API_KEY keys, then the key saved in Settings → AI Assistant.
   * A vault key with config.model set uses that model; one without keeps the
   * code's (Settings → AI Assistant model, else gpt-4o-mini).
   * Claude (vault ANTHROPIC_API_KEY) sits between custom_llm and OpenAI — see chat().
   */
  private async endpoints(): Promise<{ custom: Endpoint[]; openAi: Endpoint[] }> {
    const settings = await this.settingsService.getProviderSettings('ai' as any);
    const storedBase = settings?.baseUrl || 'https://api.openai.com/v1';
    const storedModel = settings?.model || 'gpt-4o-mini';
    const openAiModel = /api\.openai\.com/.test(storedBase) ? storedModel : 'gpt-4o-mini';
    const custom: Endpoint[] = [];
    for (const k of this.vault?.byProvider('custom_llm') ?? []) {
      const base = typeof k.config.base_url === 'string' ? k.config.base_url.replace(/\/+$/, '') : '';
      const model = typeof k.config.model === 'string' ? k.config.model : '';
      if (base && model) custom.push({ key: k.secret, baseUrl: base, model });
    }
    const openAi: Endpoint[] = [];
    for (const k of this.vault?.pool('OPENAI_API_KEY') ?? []) openAi.push({ key: k.secret, baseUrl: 'https://api.openai.com/v1', model: this.vault!.modelFor(k.secret, openAiModel) });
    if (settings?.apiKey && ![...custom, ...openAi].some((e) => e.key === settings.apiKey)) openAi.push({ key: settings.apiKey, baseUrl: storedBase, model: storedModel });
    return { custom, openAi };
  }

  /** Vault ANTHROPIC_API_KEY keys in dashboard order; model = the key's config.model, else claude-haiku-5-5. */
  private claudeKeys(): { key: string; model: string }[] {
    return (this.vault?.pool('ANTHROPIC_API_KEY') ?? []).map((k) => ({ key: k.secret, model: this.vault!.modelFor(k.secret, CLAUDE_DEFAULT_MODEL) }));
  }

  async chat(messages: ChatMessage[]): Promise<{ reply: string }> {
    const { custom, openAi } = await this.endpoints();
    const claude = this.claudeKeys();
    if (custom.length + claude.length + openAi.length === 0) {
      throw new BadRequestException(
        'AI is not configured. An admin needs to add an API key in Settings → AI Assistant.',
      );
    }

    // 1. The admin's own OpenAI-compatible endpoints (custom_llm).
    const first = await this.tryOpenAiCompatible(custom, messages);
    if (first.reply !== undefined) return { reply: first.reply };
    if (first.stop) throw new BadRequestException('AI service returned an error. Check your API key and model settings.');

    // 2. Claude — every Anthropic key in turn; if all fail, OpenAI takes over.
    const fromClaude = await this.tryClaude(claude, messages);
    if (fromClaude !== undefined) return { reply: fromClaude };

    // 3. OpenAI vault keys, then the key saved in Settings.
    const last = await this.tryOpenAiCompatible(openAi, messages);
    if (last.reply !== undefined) return { reply: last.reply };
    throw new BadRequestException('AI service returned an error. Check your API key and model settings.');
  }

  /**
   * Each key in turn: a rejected, out-of-credit or rate-limited key hands the
   * question to the next one; a provider outage stops here (another key on
   * the same provider would fail the same way) — `stop` tells chat() not to
   * try further endpoints, exactly as before Claude was added.
   */
  private async tryOpenAiCompatible(endpoints: Endpoint[], messages: ChatMessage[]): Promise<{ reply?: string; stop?: boolean }> {
    for (const ep of endpoints) {
      let res: Response;
      try {
        res = await fetch(`${ep.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.key}` },
          body: JSON.stringify({
            model: ep.model,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
            max_tokens: 1024,
            temperature: 0.7,
          }),
        });
      } catch (err) {
        this.vault?.report(ep.key, { ok: false, error: err }, TASK_CHAT);
        this.logger.error('AI API request failed', err);
        throw new BadRequestException('Failed to reach AI service. Check your API configuration.');
      }

      if (res.ok) {
        const data = await res.json();
        this.vault?.report(ep.key, { ok: true, model: ep.model, inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens }, TASK_CHAT);
        return { reply: data?.choices?.[0]?.message?.content ?? 'No response from AI.' };
      }

      const errText = await res.text();
      const error = Object.assign(new Error(errText.slice(0, 300)), { status: res.status });
      this.vault?.report(ep.key, { ok: false, error }, TASK_CHAT);
      this.logger.error(`AI API error (${res.status}): ${errText.slice(0, 500)}`);
      if (verdictOf(error) === 'error') return { stop: true };
    }
    return {};
  }

  /**
   * Claude Messages API (plain fetch, no streaming, no tools — the assistant
   * chat uses neither). Any failure — 401/403 (reported as invalid), 429,
   * 5xx, a timeout, a model the key cannot use — moves to the next Anthropic
   * key, and after the last one chat() carries on to OpenAI. Undefined = no answer.
   */
  private async tryClaude(keys: { key: string; model: string }[], messages: ChatMessage[]): Promise<string | undefined> {
    if (keys.length === 0) return undefined;
    const { system, turns } = toClaudeMessages(messages);
    if (turns.length === 0) return undefined; // nothing from the user to answer
    for (const k of keys) {
      try {
        const res = await fetch(ANTHROPIC_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': k.key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: k.model, system, messages: turns, max_tokens: 1024 }),
          signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw Object.assign(new Error(errText.slice(0, 300)), { status: res.status });
        }
        const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
        this.vault?.report(k.key, { ok: true, model: k.model, inputTokens: data?.usage?.input_tokens, outputTokens: data?.usage?.output_tokens }, TASK_CHAT);
        const text = (data?.content ?? []).filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('');
        return text || 'No response from AI.';
      } catch (err) {
        this.vault?.report(k.key, { ok: false, error: err }, TASK_CHAT);
        const status = (err as { status?: number })?.status;
        this.logger.error(`Claude API error (${status ?? (err instanceof Error ? err.name : 'network')}): ${(err instanceof Error ? err.message : String(err)).slice(0, 500)}`);
      }
    }
    return undefined;
  }
}

/**
 * OpenAI-style chat → Claude Messages: system prompts go to `system`; the
 * conversation must open with the user, so a leading assistant greeting is
 * dropped, and back-to-back turns of one role are joined.
 */
export function toClaudeMessages(messages: ChatMessage[]): { system: string; turns: { role: 'user' | 'assistant'; content: string }[] } {
  const system = [SYSTEM_PROMPT, ...messages.filter((m) => m.role === 'system').map((m) => m.content)].join('\n\n');
  const turns: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'system' || !m.content) continue;
    if (turns.length === 0 && m.role !== 'user') continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else turns.push({ role: m.role, content: m.content });
  }
  return { system, turns };
}
