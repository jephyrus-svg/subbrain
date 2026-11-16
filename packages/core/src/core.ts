/** 코어 컨텍스트: DB · 설정 · 작업 큐 · 볼트 · 분류기 선택 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { LlmProvider, StaleThresholds } from '@subbrain/shared';
import { DEFAULT_MODEL, DEFAULT_PORT, MOCK_MODEL, PROVIDER_ENV_KEY } from '@subbrain/shared/constants';
import { Db, json } from './db/db.ts';
import { SettingsStore } from './services/settings.ts';
import { JobQueue } from './queue/jobs.ts';
import { VaultWriter } from './vault/vault.ts';
import { mergeThresholds } from './rules/rules.ts';
import { RuleClassifier } from './classifier/rule-classifier.ts';
import { AiSdkClassifier } from './classifier/ai-sdk-classifier.ts';
import type { Classifier } from './classifier/provider.ts';
import { nowIso } from './util/time.ts';
import { L } from './util/lang.ts';

export interface CoreOptions {
  home?: string;            // 데이터 폴더 (기본 ~/.subbrain, SUBBRAIN_HOME)
  dbPath?: string;          // 기본 <home>/subbrain.db, ':memory:' 가능
  vaultPath?: string;       // 기본 ~/SubBrain (SUBBRAIN_VAULT)
  port?: number;
  devOrigins?: string[];
  vaultAutoWrite?: boolean; // 쓰기 후 볼트 노트 자동 갱신 (기본 true)
}

export class Core {
  readonly db: Db;
  readonly settings: SettingsStore;
  readonly queue: JobQueue;
  readonly vault: VaultWriter;
  readonly home: string;
  readonly port: number;
  readonly startedAt = nowIso();
  readonly startedMs = Date.now();
  readonly buildTarget: 'personal' | 'sellable' = process.env.SUBBRAIN_BUILD === 'sellable' ? 'sellable' : 'personal';
  classifierOverride: Classifier | null = null; // 테스트용

  constructor(opts: CoreOptions = {}) {
    this.home = opts.home ?? process.env.SUBBRAIN_HOME ?? join(homedir(), '.subbrain');
    this.port = opts.port ?? (Number(process.env.SUBBRAIN_PORT) || DEFAULT_PORT);
    this.db = new Db(opts.dbPath ?? join(this.home, 'subbrain.db'));
    const devOrigins = opts.devOrigins ?? (process.env.SUBBRAIN_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    this.settings = new SettingsStore(this.db, join(this.home, 'secrets.json'), {
      vaultPath: opts.vaultPath ?? process.env.SUBBRAIN_VAULT ?? join(homedir(), 'SubBrain'), port: this.port, devOrigins,
    });
    this.queue = new JobQueue(this.db);
    this.vault = new VaultWriter(this, opts.vaultAutoWrite ?? true);
  }

  thresholdsFor(projectThresholdsJson: string | null | undefined): StaleThresholds {
    return mergeThresholds(this.settings.get().thresholds, json<Partial<StaleThresholds> | null>(projectThresholdsJson ?? null, null));
  }

  /** LLM이 설정돼 있으면 AI SDK 분류기, 아니면 규칙 분류기 */
  classifier(): Classifier {
    if (this.classifierOverride) return this.classifierOverride;
    const s = this.settings.get().llm;
    if (s.provider && s.apiKeySet) {
      return new AiSdkClassifier({ provider: s.provider, model: s.model ?? DEFAULT_MODEL[s.provider], apiKey: this.settings.getApiKey(s.provider), baseUrl: s.baseUrl });
    }
    return new RuleClassifier();
  }
  llmConfigured(): boolean { const s = this.settings.get().llm; return Boolean(s.provider && s.apiKeySet); }
  /**
   * 사람이 읽는 LLM 상태 한 줄(시작 로그·설정 변경 로그). 키 값은 절대 넣지 않는다.
   * 1.1.0: 제공자를 아직 안 골랐을 때 "키 없음"이라고 잘못 말하던 문제 수정 — 제공자 미선택 / 키 없음 / 사용 중을 구분한다.
   */
  llmStatusLine(): string {
    const s = this.settings.get().llm;
    if (!s.provider) {
      const envs: string[] = (Object.keys(PROVIDER_ENV_KEY) as LlmProvider[]).filter((p) => { const k = PROVIDER_ENV_KEY[p]; return k && process.env[k]; });
      if (process.env.SUBBRAIN_LLM_API_KEY) envs.push('SUBBRAIN_LLM_API_KEY');
      return L(`LLM: 제공자 미선택${envs.length ? ` (환경변수 키 감지: ${envs.join(', ')} — 설정에서 제공자를 고르면 사용)` : ''} → 규칙 분류기(${MOCK_MODEL})`, `LLM: no provider selected${envs.length ? ` (found key env vars: ${envs.join(', ')} — pick a provider in Settings to use them)` : ''} → rule classifier (${MOCK_MODEL})`);
    }
    const model = s.model ?? DEFAULT_MODEL[s.provider];
    if (!s.apiKeySet) return L(`LLM: ${s.provider} 선택됨, API 키 없음 → 규칙 분류기(${MOCK_MODEL})`, `LLM: ${s.provider} selected but no API key → rule classifier (${MOCK_MODEL})`);
    return L(`LLM: ${s.provider} · ${model}${s.model ? '' : ' (기본 모델)'} · 키 출처 ${this.settings.apiKeySource(s.provider) ?? (s.provider === 'ollama' ? '불필요' : '-')}`, `LLM: ${s.provider} · ${model}${s.model ? '' : ' (default model)'} · key from ${this.settings.apiKeySource(s.provider) ?? (s.provider === 'ollama' ? 'not needed' : '-')}`);
  }

  rawDir(): string {
    const s = this.settings.get().vault;
    return s.rawLocation === 'inside_vault' && s.path && this.vault.ownsVault() ? join(s.path, 'raw') : join(this.home, 'raw'); // 1.10.1 남의 볼트면 home/raw
  }
  close(): void { this.db.close(); }
}
