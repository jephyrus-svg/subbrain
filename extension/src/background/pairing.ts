// 페어링(계약 §14.3 인증): 웹앱에서 받은 6자리 코드 → POST /pairing/complete → 토큰(한 번만 보임)을 storage.local에.
import { EXT_VERSION } from '../shared/contract';
import { CoreError, type CoreClient } from './api';
import { saveSettings, type KV, type Pairing } from './settings';

/** "418 207" · "418-207" · "418207" 모두 받음. [확인 필요] 코어가 공백 포함 형식을 기대하는지 — 일단 숫자 6개로 보냄 */
export const normalizeCode = (c: string) => c.replace(/\D/g, '');

export async function pair(d: { kv: KV; core: (base: string) => CoreClient; extensionId: string }, code: string, coreUrl: string): Promise<{ ok: true; pairing: Pairing } | { ok: false; message: string }> {
  const digits = normalizeCode(code);
  if (digits.length !== 6) return { ok: false, message: '6자리 숫자 코드를 넣어 주세요' };
  const st = await saveSettings(d.kv, { coreUrl });
  try {
    const r = await d.core(st.coreUrl).completePairing({ code: digits, client: { kind: 'extension', name: 'SubBrain Chrome', version: EXT_VERSION, extensionId: d.extensionId } });
    const p: Pairing = { token: r.token, client: r.client, pairedAt: new Date().toISOString() };
    await d.kv.set('pairing', p);
    return { ok: true, pairing: p };
  } catch (e) {
    if (!(e instanceof CoreError)) return { ok: false, message: String(e) };
    const m: Record<number, string> = {
      0: `코어(${st.coreUrl})에 연결하지 못했어요. 서브브레인이 켜져 있는지 확인해 주세요.`,
      501: '이 코어 버전에는 아직 확장 페어링이 없어요(501). 코어를 업데이트한 뒤 다시 해 주세요.',
      403: '코어가 이 확장의 출처(Origin)를 받아들이지 않았어요(Origin ≠ chrome-extension://<확장 id>).',
      400: '코드 모양이 틀렸어요(6자리 숫자).',
      401: '코드가 맞지 않거나 만료됐어요(5분). 웹앱 "기기 연결"에서 새 코드를 받아 주세요. 5번 틀리면 그 코드는 없어져요.',
      404: '코드가 틀렸거나 만료됐어요(5분). 웹앱에서 새 코드를 받아 주세요.',
      410: '코드가 만료됐어요. 웹앱에서 새 코드를 받아 주세요.',
      429: '잠시 뒤에 다시 해 주세요.',
    };
    return { ok: false, message: m[e.status] ?? e.message };
  }
}
