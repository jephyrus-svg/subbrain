import { describe, expect, it } from 'vitest';
import { promptLang, systemPrompt, SYSTEM_PROMPT_EN } from '../src/classifier/prompt.ts';

describe('classification prompt language', () => {
  it('defaults to English and switches to Korean with SUBBRAIN_LANG=ko', () => {
    const prev = process.env.SUBBRAIN_LANG;
    delete process.env.SUBBRAIN_LANG;
    expect(promptLang()).toBe('en');
    expect(systemPrompt()).toBe(SYSTEM_PROMPT_EN);
    process.env.SUBBRAIN_LANG = 'ko';
    expect(promptLang()).toBe('ko');
    expect(systemPrompt()).toMatch(/[가-힣]/);
    if (prev === undefined) delete process.env.SUBBRAIN_LANG; else process.env.SUBBRAIN_LANG = prev;
  });
  it('English prompt keeps the same JSON contract', () => {
    for (const k of ['conversation_outcome', 'same_task_candidates', 'handoff_target', '{projects_with_aliases}', '{recent_tasks}', '{today}']) expect(SYSTEM_PROMPT_EN).toContain(k);
    expect(SYSTEM_PROMPT_EN).not.toMatch(/[가-힣]/);
  });
});
