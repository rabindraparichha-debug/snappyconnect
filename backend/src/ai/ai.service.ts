import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

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

  constructor(private readonly settingsService: SettingsService) {}

  async chat(messages: ChatMessage[]): Promise<{ reply: string }> {
    const settings = await this.settingsService.getProviderSettings('ai' as any);
    const apiKey = settings?.apiKey;
    const model = settings?.model || 'gpt-4o-mini';
    const baseUrl = settings?.baseUrl || 'https://api.openai.com/v1';

    if (!apiKey) {
      throw new BadRequestException(
        'AI is not configured. An admin needs to add an API key in Settings → AI Assistant.',
      );
    }

    const body = {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 1024,
      temperature: 0.7,
    };

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`AI API error (${res.status}): ${err}`);
        throw new BadRequestException('AI service returned an error. Check your API key and model settings.');
      }

      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content ?? 'No response from AI.';
      return { reply };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('AI API request failed', err);
      throw new BadRequestException('Failed to reach AI service. Check your API configuration.');
    }
  }
}
