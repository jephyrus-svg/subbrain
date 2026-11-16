import { tt, ttf } from '../i18n';
import { useCallback } from 'react';
import type { ContinueTarget, SourceAi } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { errorText } from '../api/client';
import { useToast } from '../components/Toast';
import { copyText, openExternal } from './clipboard';
import { aiLabel } from './format';

/** "…에서 이어서" · "맥락 프롬프트 복사" · "다른 AI로…" 공통 동작 (GET /tasks/:id/resume-prompt) */
export function useResume() {
  const toast = useToast();
  const copyPrompt = useCallback(async (taskId: string, targetAi?: SourceAi) => {
    try {
      const r = await api.resumePrompt(taskId, targetAi);
      const ok = await copyText(r.prompt);
      toast.show(ok ? ttf("{0}용 맥락 프롬프트를 복사했어요", aiLabel(r.targetAi)) : tt("복사하지 못했어요"), { err: !ok });
      return r;
    } catch (e) { toast.show(errorText(e), { err: true }); return null; }
  }, [toast]);
  /** 원래 대화가 있으면 그 대화로, 없으면 프롬프트를 복사하고 새 대화를 연다 */
  const continueIn = useCallback(async (taskId: string, target: SourceAi, cont?: ContinueTarget | null) => {
    if (cont && cont.sourceAi === target) { openExternal(cont.url); return; }
    const r = await copyPrompt(taskId, target);
    if (!r) return;
    if (r.continue) openExternal(r.continue.url);
    else { openExternal(r.newChatUrl); toast.show(ttf("새 {0} 대화를 열었어요 — 복사한 프롬프트를 붙여 넣으세요", aiLabel(target))); }
  }, [copyPrompt, toast]);
  return { copyPrompt, continueIn };
}
