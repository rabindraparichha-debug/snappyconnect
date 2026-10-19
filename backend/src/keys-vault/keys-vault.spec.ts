/** Run with `npm test`. Central keys vault: fetch, encrypted copy, settings overlay, AI fail-over. */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { KeysVaultService } from './keys-vault.service';
import { SettingsService } from '../settings/settings.service';
import { AiService } from '../ai/ai.service';
import { encryptString, decryptString } from '../common/crypto.util';

const dir = mkdtempSync(path.join(tmpdir(), 'kv-'));
const cacheFile = path.join(dir, '.keys-vault.enc');
const seen: { url: string; key: string; body?: any }[] = [];

type ClaudeKey = { id: string; secret: string; model?: string };

function installFetch(opts: { hubDown?: boolean; usageDown?: boolean; backupModel?: string; claude?: ClaudeKey[] } = {}) {
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const key = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? init?.headers?.['x-api-key'] ?? '').replace('Bearer ', '');
    seen.push({ url, key, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.includes('/api/platform-keys/v1/keys')) {
      if (opts.hubDown) throw new Error('hub down');
      return new Response(JSON.stringify({ refresh_seconds: 300, keys: {
        OPENAI_API_KEY: [
          { id: 'k1', provider: 'openai', label: 'Main', secret: 'sk-bad', config: {} },
          { id: 'k2', provider: 'openai', label: 'Backup', secret: 'sk-good', config: opts.backupModel ? { model: opts.backupModel } : {} },
        ],
        TELNYX_API_KEY: [{ id: 't1', provider: 'telnyx', label: 'Calls', secret: 'KEY-vault', config: {} }],
        ...(opts.claude ? { ANTHROPIC_API_KEY: opts.claude.map((c) => ({ id: c.id, provider: 'anthropic', label: c.id, secret: c.secret, config: c.model ? { model: c.model } : {} })) } : {}),
      } }), { status: 200 });
    }
    if (url.includes('/api/platform-keys/v1/usage')) {
      if (opts.usageDown) return new Response('down', { status: 503 });
    }
    if (url.includes('/api/platform-keys/v1/usage')) return new Response('{"accepted":1}', { status: 200 });
    if (url === 'https://api.anthropic.com/v1/messages') {
      if (key === 'ant-bad') return new Response('{"type":"error","error":{"type":"authentication_error"}}', { status: 401 });
      if (key === 'ant-busy') return new Response('{"type":"error","error":{"type":"rate_limit_error"}}', { status: 429 });
      if (key === 'ant-down') return new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 });
      if (key === 'ant-slow') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'from Claude' }], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 });
    }
    if (key === 'sk-bad') return new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 });
    if (key === 'sk-down') return new Response('overloaded', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { status: 200 });
  };
}

const configOf = (env: Record<string, string>) => ({ get: (k: string, d?: any) => env[k] ?? d }) as any;

/** In-memory settings repository holding one encrypted row per namespace. */
function settingsWith(vault: KeysVaultService | undefined, rows: Record<string, Record<string, any>>) {
  const encKey = 'test-settings-key';
  const store = new Map<string, string>(Object.entries(rows).map(([k, v]) => [k, encryptString(JSON.stringify(v), encKey)]));
  const repo = {
    findOne: async ({ where: { key } }: any) => (store.has(key) ? { key, value: store.get(key) } : null),
    save: async (row: any) => { store.set(row.key, row.value); return row; },
    create: (row: any) => row,
  };
  const svc = new SettingsService(repo as any, configOf({ SETTINGS_ENCRYPTION_KEY: encKey }), vault);
  return { svc, stored: (k: string) => JSON.parse(decryptString(store.get(k)!, encKey)) };
}

describe('KeysVaultService', () => {
  beforeEach(() => { seen.length = 0; installFetch(); rmSync(cacheFile, { force: true }); });

  it('is inert without a token', async () => {
    const v = new KeysVaultService(configOf({ KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    assert.equal(v.enabled(), false);
    assert.equal(seen.length, 0);
    assert.deepEqual(v.keys('OPENAI_API_KEY', 'sk-own'), ['sk-own']);
  });

  it('fetches in dashboard order and writes an encrypted copy that a restart can read with the hub down', async () => {
    const env = { KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile };
    const v = new KeysVaultService(configOf(env));
    await v.fetchNow();
    assert.deepEqual(v.keys('OPENAI_API_KEY', 'sk-own'), ['sk-bad', 'sk-good', 'sk-own']);
    assert.ok(existsSync(cacheFile));
    assert.ok(!readFileSync(cacheFile, 'utf8').includes('sk-good'));
    installFetch({ hubDown: true });
    const restarted = new KeysVaultService(configOf(env));
    (restarted as any).snapshot = (restarted as any).readCopy();
    await restarted.fetchNow();
    assert.equal(restarted.pool('OPENAI_API_KEY').length, 2);
  });
});

describe('wants + task names', () => {
  beforeEach(() => { seen.length = 0; installFetch(); rmSync(cacheFile, { force: true }); });

  it('sends every name asked for, sorted, de-duplicated and URL-encoded', async () => {
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    assert.ok(seen[0].url.endsWith('/api/platform-keys/v1/keys?wants=ANTHROPIC_API_KEY,OPENAI_API_KEY,TELNYX_API_KEY'));
    v.key('ZED_KEY', 'own'); v.keys('A B'); v.pool('ZED_KEY');
    seen.length = 0;
    await v.fetchNow();
    assert.ok(seen[0].url.endsWith('?wants=A%20B,ANTHROPIC_API_KEY,OPENAI_API_KEY,TELNYX_API_KEY,ZED_KEY'));
  });

  it('keeps usage per task and retries it after a failed report', async () => {
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    v.report('sk-good', { ok: true, model: 'gpt-4o-mini', inputTokens: 5 }, 'assistant_chat');
    v.report('sk-good', { ok: true, model: 'gpt-4o-mini', inputTokens: 7 }, 'other_task');
    v.report('sk-good', { ok: true, model: 'gpt-4o-mini', inputTokens: 1 }, 'Bad Task!');
    installFetch({ usageDown: true });
    await v.flushUsage();
    v.report('sk-good', { ok: true, model: 'gpt-4o-mini', inputTokens: 5 }, 'assistant_chat');
    installFetch();
    seen.length = 0;
    await v.flushUsage();
    const reports = seen.find((s) => s.url.endsWith('/usage'))!.body.reports;
    assert.equal(reports.length, 3);
    const chat = reports.find((r: any) => r.task === 'assistant_chat');
    assert.equal(chat.calls, 2);
    assert.equal(chat.input_tokens, 10);
    assert.equal(reports.find((r: any) => r.task === 'other_task').calls, 1);
    assert.ok(reports.some((r: any) => !('task' in r)));
  });
});

describe('settings overlay', () => {
  beforeEach(() => { seen.length = 0; installFetch(); rmSync(cacheFile, { force: true }); });

  it('uses the vault Telnyx key but never saves it', async () => {
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    const { svc, stored } = settingsWith(v, { telnyx: { apiKey: 'KEY-stored', connectionId: 'c1' } });
    assert.equal((await svc.getProviderSettings('telnyx')).apiKey, 'KEY-vault');
    assert.equal((await svc.getProviderSettings('telnyx')).connectionId, 'c1');
    await svc.updateProviderSettings('telnyx', { connectionId: 'c2', apiKey: '••••ault' });
    assert.deepEqual(stored('telnyx'), { apiKey: 'KEY-stored', connectionId: 'c2' });
  });

  it('without a vault, the stored key is used', async () => {
    const { svc } = settingsWith(undefined, { telnyx: { apiKey: 'KEY-stored' } });
    assert.equal((await svc.getProviderSettings('telnyx')).apiKey, 'KEY-stored');
  });
});

describe('AI fail-over', () => {
  beforeEach(() => { seen.length = 0; installFetch(); rmSync(cacheFile, { force: true }); });

  it('a rejected key gives way to the next and both are reported', async () => {
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    const { svc } = settingsWith(v, { ai: { apiKey: 'sk-stored', model: 'gpt-4o-mini' } });
    seen.length = 0;
    const out = await new AiService(svc, v).chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out.reply, 'OK');
    assert.deepEqual(seen.map((s) => s.key), ['sk-bad', 'sk-good']);
    await v.flushUsage();
    const reports = seen.find((s) => s.url.endsWith('/usage'))!.body.reports;
    assert.equal(reports.find((r: any) => r.key_id === 'k1').status, 'invalid');
    assert.equal(reports.find((r: any) => r.key_id === 'k2').input_tokens, 10);
  });

  it('a vault key with its own model uses it; one without keeps the code\'s; cost follows the model used', async () => {
    installFetch({ backupModel: 'gpt-4o' });
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    const { svc } = settingsWith(v, { ai: { apiKey: 'sk-stored', model: 'gpt-4o-mini' } });
    seen.length = 0;
    await new AiService(svc, v).chat([{ role: 'user', content: 'hi' }]);
    assert.equal(seen[0].body.model, 'gpt-4o-mini');
    assert.equal(seen[1].body.model, 'gpt-4o');
    await v.flushUsage();
    const reports = seen.find((s) => s.url.endsWith('/usage'))!.body.reports;
    const k2 = reports.find((r: any) => r.key_id === 'k2');
    assert.equal(k2.task, 'assistant_chat');
    assert.equal(reports.find((r: any) => r.key_id === 'k1').task, 'assistant_chat');
    assert.equal(k2.cost_usd, Number(((10 * 2.5 + 2 * 10) / 1_000_000).toFixed(6)));
  });

  it('a provider outage does not burn the next key', async () => {
    const { svc } = settingsWith(undefined, { ai: { apiKey: 'sk-down' } });
    await assert.rejects(new AiService(svc).chat([{ role: 'user', content: 'hi' }]));
    assert.deepEqual(seen.map((s) => s.key), ['sk-down']);
  });

  it('without a vault the stored key and base URL are used as before', async () => {
    const { svc } = settingsWith(undefined, { ai: { apiKey: 'sk-stored', baseUrl: 'https://llm.example.com/v1', model: 'm1' } });
    await new AiService(svc).chat([{ role: 'user', content: 'hi' }]);
    assert.equal(seen[0].url, 'https://llm.example.com/v1/chat/completions');
    assert.equal(seen[0].body.model, 'm1');
  });
});

describe('Claude (vault ANTHROPIC_API_KEY)', () => {
  beforeEach(() => { seen.length = 0; rmSync(cacheFile, { force: true }); });

  async function setup(claude: ClaudeKey[] | undefined, ai: Record<string, any> = { apiKey: 'sk-stored', model: 'gpt-4o-mini' }) {
    installFetch({ claude });
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    const { svc } = settingsWith(v, { ai });
    seen.length = 0;
    return { v, ai: new AiService(svc, v) };
  }
  const calls = () => seen.filter((s) => !s.url.includes('/api/platform-keys/'));

  it('answers with Claude before any OpenAI key, using the key\'s model and the Messages API shape', async () => {
    const { ai } = await setup([{ id: 'a1', secret: 'ant-good', model: 'claude-sonnet-5-5' }]);
    const out = await ai.chat([{ role: 'assistant', content: 'Hi! How can I help?' }, { role: 'user', content: 'hi' }, { role: 'user', content: 'again' }]);
    assert.deepEqual(out, { reply: 'Hello from Claude' });
    assert.equal(calls().length, 1);
    const [c] = calls();
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(c.key, 'ant-good');
    assert.equal(c.body.model, 'claude-sonnet-5-5');
    assert.ok(c.body.system.startsWith('You are SnappyConnect AI Assistant'));
    assert.deepEqual(c.body.messages, [{ role: 'user', content: 'hi\n\nagain' }]);
    assert.ok(c.body.max_tokens > 0);
  });

  it('sends anthropic-version and defaults to claude-haiku-5-5 when the key has no model', async () => {
    const { ai } = await setup([{ id: 'a1', secret: 'ant-good' }]);
    let headers: any;
    const inner = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string, init?: any) => { if (url.includes('anthropic')) headers = init.headers; return inner(url, init); };
    await ai.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(headers['anthropic-version'], '2023-06-01');
    assert.equal(headers['x-api-key'], 'ant-good');
    assert.equal(calls()[0].body.model, 'claude-haiku-5-5');
  });

  it('fails over across Anthropic keys in vault order; 401 is reported invalid', async () => {
    const { v, ai } = await setup([{ id: 'a1', secret: 'ant-bad' }, { id: 'a2', secret: 'ant-busy' }, { id: 'a3', secret: 'ant-good' }]);
    const out = await ai.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out.reply, 'Hello from Claude');
    assert.deepEqual(calls().map((s) => s.key), ['ant-bad', 'ant-busy', 'ant-good']);
    await v.flushUsage();
    const reports = seen.find((s) => s.url.endsWith('/usage'))!.body.reports;
    assert.equal(reports.find((r: any) => r.key_id === 'a1').status, 'invalid');
    assert.equal(reports.find((r: any) => r.key_id === 'a2').status, 'rate_limited');
  });

  it('when every Claude key fails (401, overloaded, timeout) the OpenAI path answers', async () => {
    const { ai } = await setup([{ id: 'a1', secret: 'ant-bad' }, { id: 'a2', secret: 'ant-down' }, { id: 'a3', secret: 'ant-slow' }]);
    const out = await ai.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out.reply, 'OK');
    assert.deepEqual(calls().map((s) => s.key), ['ant-bad', 'ant-down', 'ant-slow', 'sk-bad', 'sk-good']);
  });

  it('the admin\'s custom_llm still goes first', async () => {
    installFetch({ claude: [{ id: 'a1', secret: 'ant-good' }] });
    const v = new KeysVaultService(configOf({ KEYS_VAULT_TOKEN: 'spk_test', KEYS_VAULT_CACHE: cacheFile }));
    await v.fetchNow();
    (v as any).snapshot.keys.CUSTOM_LLM = [{ id: 'c1', provider: 'custom_llm', label: 'Own', secret: 'sk-custom', config: { base_url: 'https://llm.example.com/v1/', model: 'm1' } }];
    const { svc } = settingsWith(v, { ai: { apiKey: 'sk-stored' } });
    seen.length = 0;
    const out = await new AiService(svc, v).chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out.reply, 'OK');
    assert.deepEqual(calls().map((s) => s.url), ['https://llm.example.com/v1/chat/completions']);
  });

  it('with no Anthropic key in the vault no Claude request is made', async () => {
    const { ai } = await setup(undefined);
    await ai.chat([{ role: 'user', content: 'hi' }]);
    assert.ok(!seen.some((s) => s.url.includes('anthropic')));
    assert.deepEqual(calls().map((s) => s.key), ['sk-bad', 'sk-good']);
  });

  it('reports usage at the Claude model with Claude\'s token counts and task assistant_chat', async () => {
    const { v, ai } = await setup([{ id: 'a1', secret: 'ant-good', model: 'claude-opus-5-5' }]);
    await ai.chat([{ role: 'user', content: 'hi' }]);
    await v.flushUsage();
    const reports = seen.find((s) => s.url.endsWith('/usage'))!.body.reports;
    const a1 = reports.find((r: any) => r.key_id === 'a1');
    assert.equal(a1.task, 'assistant_chat');
    assert.equal(a1.input_tokens, 100);
    assert.equal(a1.output_tokens, 20);
    assert.equal(a1.cost_usd, Number(((100 * 4 + 20 * 20) / 1_000_000).toFixed(6)));
  });
});
