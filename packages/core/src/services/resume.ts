/** 이어서 하기 맥락 프롬프트 (§5.4⑤ get_resume_prompt, §7.7). MVP는 규칙 템플릿으로 만든다(LLM 불필요). */
import type { Decision, ResumePromptResponse, SourceAi } from '@subbrain/shared';
import { NEW_CHAT_URL, SOURCE_AI_LABEL } from '@subbrain/shared/constants';
import type { Core } from '../core.ts';
import { nowIso } from '../util/time.ts';
import { continueTarget, effectiveNextStep, latestPrimary, loadTask, type TaskFull } from './tasks.ts';
import { loadDecisions } from './views.ts';
import { L } from '../util/lang.ts';

export function buildResumePrompt(t: TaskFull, decisions: Decision[], targetAi: SourceAi): string {
  const orig = latestPrimary(t)?.sourceAi ?? targetAi;
  const lines: string[] = [];
  const ctx = `${t.project ? `${t.project.name} — ` : ''}${t.title}${t.summary ? `. ${t.summary}` : ''}`;
  lines.push(L(`[맥락] ${ctx}${orig !== targetAi ? ` (${SOURCE_AI_LABEL[orig]}에서 하던 작업을 이어서 함)` : ''}`, `[Context] ${ctx}${orig !== targetAi ? ` (continuing work started in ${SOURCE_AI_LABEL[orig]})` : ''}`));
  const valid = decisions.filter((d) => d.valid).map((d) => d.text);
  if (valid.length) lines.push(L(`결정: ${valid.join(' / ')}`, `Decided: ${valid.join(' / ')}`));
  for (const d of t.summaryDetail.slice(0, 3)) lines.push(`- ${d}`);
  const open = t.openQuestions.filter((q) => !q.resolved).map((q) => q.text);
  if (open.length) lines.push(L(`남은 질문: ${open.join(' / ')}`, `Open questions: ${open.join(' / ')}`));
  const ns = effectiveNextStep(t);
  if (ns) lines.push(L(`다음 할 일: ${ns}`, `Next: ${ns}`));
  lines.push(L(`요청: ${ns ? '위 다음 할 일부터 이어서 도와줘.' : '지금까지 흐름을 이어서 다음 단계를 같이 정해 줘.'}`, `Ask: ${ns ? 'help me continue from the next step above.' : 'pick up where this left off and help me decide the next step.'}`));
  return lines.join('\n');
}

export function resumePrompt(core: Core, taskId: string, targetAi?: SourceAi): ResumePromptResponse | null {
  const t = loadTask(core, taskId);
  if (!t) return null;
  const lp = latestPrimary(t);
  const orig = lp?.sourceAi ?? 'chatgpt';
  const target = targetAi ?? orig;
  const same = target === orig;
  const cached = same && freshCached(t);
  return {
    taskId, targetAi: target,
    prompt: cached ? t.resumePrompt! : buildResumePrompt(t, loadDecisions(core, taskId), target),
    continue: same ? continueTarget(lp) : null, newChatUrl: NEW_CHAT_URL[target], generatedAt: nowIso(), cached,
  };
}

/** 저장된 프롬프트가 지금의 다음 할 일을 담고 있을 때만 그대로 쓴다(옛 형식·바뀐 다음 할 일이면 다시 만든다) */
export function freshCached(t: TaskFull): boolean {
  if (!t.resumePrompt) return false;
  const ns = effectiveNextStep(t);
  return !ns || t.resumePrompt.includes(L(`다음 할 일: ${ns}`, `Next: ${ns}`));
}
