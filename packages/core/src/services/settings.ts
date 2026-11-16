/** 설정 저장소 — settings 테이블(JSON) + API 키 파일(0600). 키는 어떤 응답에도 나가지 않는다. */
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LlmProvider, Settings, UpdateSettingsBody } from '@subbrain/shared';
import { DEFAULT_SETTINGS, PROMPT_VERSION, PROVIDER_ENV_KEY } from '@subbrain/shared/constants';
import { SettingsSchema } from '@subbrain/shared/schemas';
import type { Db } from '../db/db.ts';
import { validateThresholds } from '../rules/rules.ts';
import { invalid } from '../util/errors.ts';

type Stored = Omit<Settings, 'llm'> & { llm: Omit<Settings['llm'], 'apiKeySet'> };

export class SettingsStore {
  constructor(private db: Db, private secretsPath: string, private defaults: { vaultPath: string; port: number; devOrigins: string[] }) {}

  private stored(): Stored {
    const row = this.db.get<{ value_json: string }>("SELECT value_json FROM settings WHERE key='settings'");
    const base: Settings = structuredClone(DEFAULT_SETTINGS);
    base.vault.path = this.defaults.vaultPath;
    base.server.port = this.defaults.port;
    base.server.devOrigins = [...new Set([...base.server.devOrigins, ...this.defaults.devOrigins])];
    const saved = row ? (JSON.parse(row.value_json) as Partial<Settings>) : {};
    const merged = deepMerge(base, saved) as Settings;
    const { apiKeySet: _ignored, ...llm } = merged.llm;
    return { ...merged, llm };
  }

  get(): Settings {
    const s = this.stored();
    const settings: Settings = { ...s, llm: { ...s.llm, apiKeySet: s.llm.provider ? this.getApiKey(s.llm.provider) !== null || s.llm.provider === 'ollama' : false } };
    // promptVersion은 코드가 정한다(저장된 옛 값 'cls-v1'이 남아 있어도 지금 프롬프트 버전을 보여 준다)
    if (settings.classification) settings.classification = { ...settings.classification, promptVersion: PROMPT_VERSION };
    return settings;
  }

  patch(body: UpdateSettingsBody): { settings: Settings; thresholdsChanged: boolean; vaultPathChanged: boolean } {
    const before = this.get();
    const cleaned = structuredClone(body) as UpdateSettingsBody;
    if (cleaned.llm) delete (cleaned.llm as Partial<Settings['llm']>).apiKeySet;
    const next = deepMerge(before, cleaned) as Settings;
    next.llm.apiKeySet = before.llm.apiKeySet;
    const parsed = SettingsSchema.safeParse(next);
    if (!parsed.success) throw invalid('설정 값이 올바르지 않아요.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    const tErr = validateThresholds(next.thresholds);
    if (tErr) throw invalid('방치 기준 일수 순서가 맞지 않아요.', [{ path: 'thresholds', message: tErr }]);
    const { apiKeySet: _k, ...llm } = next.llm;
    this.db.run("INSERT INTO settings(key,value_json) VALUES ('settings',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", JSON.stringify({ ...next, llm }));
    const after = this.get();
    return {
      settings: after,
      thresholdsChanged: JSON.stringify(before.thresholds) !== JSON.stringify(after.thresholds),
      vaultPathChanged: before.vault.path !== after.vault.path,
    };
  }

  // ── API 키: MVP는 ~/.subbrain/secrets.json(권한 0600). OS 키체인(§12.1)은 TODO
  private readSecrets(): Partial<Record<LlmProvider, string>> {
    if (!existsSync(this.secretsPath)) return {};
    try { return JSON.parse(readFileSync(this.secretsPath, 'utf8')) as Partial<Record<LlmProvider, string>>; } catch { return {}; }
  }
  setApiKey(provider: LlmProvider, key: string): void {
    const s = this.readSecrets();
    s[provider] = key;
    mkdirSync(dirname(this.secretsPath), { recursive: true });
    writeFileSync(this.secretsPath, JSON.stringify(s), { mode: 0o600 });
    chmodSync(this.secretsPath, 0o600);
  }
  /** 키가 어디서 왔는지(값은 절대 돌려주지 않음) */
  apiKeySource(provider: LlmProvider): 'secrets.json' | string | null {
    if (this.readSecrets()[provider]) return 'secrets.json';
    const env = PROVIDER_ENV_KEY[provider];
    if (env && process.env[env]) return env;
    return provider !== 'ollama' && process.env.SUBBRAIN_LLM_API_KEY ? 'SUBBRAIN_LLM_API_KEY' : null;
  }
  getApiKey(provider: LlmProvider): string | null {
    const fromFile = this.readSecrets()[provider];
    if (fromFile) return fromFile;
    const env = PROVIDER_ENV_KEY[provider];
    if (env && process.env[env]) return process.env[env]!;
    // 1.10.1 공통 환경변수(고른 제공자에 씀). 순서: secrets.json → 제공자별 환경변수 → SUBBRAIN_LLM_API_KEY. ollama는 키 불필요
    return provider !== 'ollama' && process.env.SUBBRAIN_LLM_API_KEY ? process.env.SUBBRAIN_LLM_API_KEY : null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
export function deepMerge(a: unknown, b: unknown): unknown {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a[k]) ? deepMerge(a[k], v) : v === undefined ? a[k] : v;
  return out;
}
