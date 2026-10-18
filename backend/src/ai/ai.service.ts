import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { KeysVaultService, verdictOf } from '../keys-vault/keys-vault.service';

type Endpoint = { key: string; baseUrl: string; model: string };

/** Task names reported to the keys vault, one per AiService operation. */
const TASK_CHAT = 'assistant_chat';

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
   */
  private async endpoints(): Promise<Endpoint[]> {
    const settings = await this.settingsService.getProviderSettings('ai' as any);
    const storedBase = settings?.baseUrl || 'https://api.openai.com/v1';
    const storedModel = settings?.model || 'gpt-4o-mini';
    const openAiModel = /api\.openai\.com/.test(storedBase) ? storedModel : 'gpt-4o-mini';
    const list: Endpoint[] = [];
    for (const k of this.vault?.byProvider('custom_llm') ?? []) {
      const base = typeof k.config.base_url === 'string' ? k.config.base_url.replace(/\/+$/, '') : '';
      const model = typeof k.config.model === 'string' ? k.config.model : '';
      if (base && model) list.push({ key: k.secret, baseUrl: base, model });
    }
    for (const k of this.vault?.pool('OPENAI_API_KEY') ?? []) list.push({ key: k.secret, baseUrl: 'https://api.openai.com/v1', model: this.vault!.modelFor(k.secret, openAiModel) });
    if (settings?.apiKey && !list.some((e) => e.key === settings.apiKey)) list.push({ key: settings.apiKey, baseUrl: storedBase, model: storedModel });
    return list;
  }

  async chat(messages: ChatMessage[]): Promise<{ reply: string }> {
    const endpoints = await this.endpoints();
    if (endpoints.length === 0) {
      throw new BadRequestException(
        'AI is not configured. An admin needs to add an API key in Settings → AI Assistant.',
      );
    }

    // Each key in turn: a rejected, out-of-credit or rate-limited key hands the
    // question to the next one; a provider outage stops here (another key on
    // the same provider would fail the same way).
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
      if (verdictOf(error) === 'error') break;
    }
    throw new BadRequestException('AI service returned an error. Check your API key and model settings.');
  }
}
