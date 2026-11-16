// 팝업(한국어): 페어링 · 사이트별 상태 · 마지막 전송 · 잠시 멈춤 · 따라잡기 속도와 계정 위험 안내
import { SITE_LABEL, SITES, type SiteAi } from '../shared/contract';
import type { PopupRequest } from '../shared/messages';
import { DEFAULT_SETTINGS, SPEED_LABEL, type Settings } from '../background/settings';
import type { SiteState } from '../background/state';

interface Status {
  ok: true; settings: Settings; buffered: number; coreReachable: boolean; openCatchupTabs: number;
  pairing: { tokenId: string; pairedAt: string; needsRepair: boolean } | null;
  sites: Record<SiteAi, SiteState>; adapters: Record<SiteAi, { name: string; version: string; domVersion: string }>;
}
const ask = <T,>(m: PopupRequest) => chrome.runtime.sendMessage(m) as Promise<T>;
const $ = (s: string) => document.querySelector(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function ago(iso: string | null): string {
  if (!iso) return '아직 없음';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '방금'; if (s < 3600) return `${Math.floor(s / 60)}분 전`; if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
const HEALTH: Record<string, string> = { ok: '정상', degraded: '주의', broken: '고장' };
const RESULT: Record<string, string> = { accepted: '저장됨', duplicate: '이미 있음', partial: '답 받는 중(조각)', stale: '옛 내용이라 무시됨', buffered: '보관 중', dropped: '버림', skipped: '바뀐 것 없음' };

function siteHtml(ai: SiteAi, s: SiteState): string {
  const h = s.health;
  const healthTxt = !h ? '사이트를 아직 안 열었어요' : h.errorCode === 'LOGGED_OUT' ? '로그인 필요' : h.errorCode === 'CHALLENGE' ? '봇 확인 화면' : HEALTH[h.health];
  const bad = h?.checks.filter((c) => !c.ok).map((c) => c.detail ?? c.name) ?? [];
  const q = s.catchup.queue.length;
  return `<div class="site">
    <div class="row"><span class="dot ${h?.health ?? ''}"></span><span class="nm">${SITE_LABEL[ai]}</span><span class="st">${esc(healthTxt ?? '')}</span></div>
    <div class="kv">마지막 전송 <b>${ago(s.lastSentAt)}</b>${s.lastTitle ? ` · ${esc(s.lastTitle.slice(0, 22))}` : ''}${s.lastResult ? ` · ${esc(RESULT[s.lastResult] ?? s.lastResult)}` : ''} · 오늘 ${s.sentToday.date === new Date().toISOString().slice(0, 10) ? s.sentToday.n : 0}번</div>
    ${s.lastError ? `<div class="kv" style="color:var(--warn)">${esc(s.lastError)}</div>` : ''}
    ${bad.length ? `<div class="kv">확인할 것: ${esc(bad.join(' · '))}</div>` : ''}
    <div class="kv">따라잡기 ${q ? `<b>남은 ${q}개</b>` : '대기 없음'} · 마지막 확인 ${ago(s.catchup.lastScanAt)}${s.catchup.lastNote ? ` · ${esc(s.catchup.lastNote)}` : ''}
      <button class="link" data-catchup="${ai}">지금 따라잡기</button></div>
  </div>`;
}

async function render() {
  let st: Status;
  try { st = await ask<Status>({ type: 'status' }); } catch (e) { $('#app').innerHTML = `<p class="err">확장 서비스 워커와 연결하지 못했어요: ${esc(String(e))}</p>`; return; }
  const conn = $('#conn');
  conn.textContent = st.coreReachable ? '코어 연결됨' : '코어 꺼짐'; conn.className = `conn ${st.coreReachable ? 'ok' : 'bad'}`;
  const s = st.settings;
  const paired = st.pairing && !st.pairing.needsRepair;
  const pairing = paired ? `<section><h2>페어링</h2><div class="row"><span class="muted">${esc(s.coreUrl)} · ${ago(st.pairing!.pairedAt)} 연결 (${esc(st.pairing!.tokenId)})</span><button class="link" id="unpair" style="margin-left:auto">해제</button></div></section>`
    : `<section><h2>${st.pairing?.needsRepair ? '다시 페어링해 주세요' : '로컬 엔진과 페어링'}</h2>
      <p class="muted">서브브레인 웹앱에서 받은 6자리 연결 코드를 넣어 주세요(5분 동안 유효).</p>
      <label class="f" for="core">엔진 주소</label><input type="text" id="core" value="${esc(s.coreUrl)}" placeholder="${DEFAULT_SETTINGS.coreUrl}">
      <label class="f" for="code">코드</label><input type="text" id="code" class="code" inputmode="numeric" maxlength="7" placeholder="000 000" autocomplete="off">
      <div class="row" style="margin-top:8px"><button class="pri" id="pair">연결</button><span id="perr" class="err" style="margin:0"></span></div></section>`;
  $('#app').innerHTML = `${pairing}
    <section>
      <label class="sw"><input type="checkbox" id="paused" ${s.paused ? '' : 'checked'}><i></i><span>${s.paused ? '잠시 멈춤 — 아무것도 읽거나 보내지 않아요' : '수집 켜짐'}</span></label>
      ${st.buffered ? `<p class="muted" style="margin-top:6px">엔진에 아직 못 보낸 대화 ${st.buffered}개를 보관 중 <button class="link" id="flush">지금 보내기</button></p>` : ''}
    </section>
    <section><h2>사이트 상태</h2>${SITES.map((ai) => siteHtml(ai, st.sites[ai])).join('')}</section>
    <section>
      <h2>놓친 대화 따라잡기</h2>
      <label class="f" for="mode">방식</label>
      <select id="mode">
        <option value="background" ${s.catchupMode === 'background' ? 'selected' : ''}>자동 · ${s.scanEveryHours}시간마다 뒤에서 확인(비활성 탭을 스스로 열고 닫음)</option>
        <option value="visit" ${s.catchupMode === 'visit' ? 'selected' : ''}>사이드바를 볼 때만(놓친 대화를 비활성 탭으로 엶)</option>
        <option value="off" ${s.catchupMode === 'off' ? 'selected' : ''}>끄기 · 내가 연 대화만(기본)</option>
      </select>
      <label class="f" for="speed">속도</label>
      <select id="speed">${([60, 30, 20] as const).map((v) => `<option value="${v}" ${s.catchupIntervalSec === v ? 'selected' : ''}>${SPEED_LABEL[v]}</option>`).join('')}</select>
      <p class="muted" style="margin-top:6px">한 번에 탭 하나, 시간당 최대 ${s.catchupMaxPerHour}개. 엔진이 정한 상한(분당 6개)보다 빨라지지 않아요.</p>
    </section>
    <section class="risk">
      <h2>계정 위험 — 솔직하게</h2>
      <p><b>내가 연 대화 읽기</b>는 화면을 읽기만 해서 위험이 낮아요. 그래도 ChatGPT·Claude 약관의 “자동 추출” 조항에 해당한다고 볼 여지는 있어요.</p>
      <p><b>뒤에서 따라잡기</b>는 내가 없을 때 탭을 열고 대화를 하나씩 엽니다. 천천히 열어도 계정 경고·제한 가능성을 0으로 만들 수는 없어요(중간 위험). 빠르게 할수록 위험이 커져요.</p>
      <p>로그인 화면이나 봇 확인이 뜨면 바로 멈추고, 비밀번호는 저장하지 않으며, 사이트 내부 API는 쓰지 않아요.</p>
    </section>`;
  $('#paused').addEventListener('change', async (e) => { await ask({ type: 'set-settings', patch: { paused: !(e.target as HTMLInputElement).checked } }); void render(); });
  $('#mode').addEventListener('change', async (e) => { await ask({ type: 'set-settings', patch: { catchupMode: (e.target as HTMLSelectElement).value as Settings['catchupMode'] } }); void render(); });
  $('#speed').addEventListener('change', async (e) => { await ask({ type: 'set-settings', patch: { catchupIntervalSec: Number((e.target as HTMLSelectElement).value) as Settings['catchupIntervalSec'] } }); void render(); });
  document.querySelector('#flush')?.addEventListener('click', async () => { await ask({ type: 'flush' }); void render(); });
  document.querySelector('#unpair')?.addEventListener('click', async () => { if (confirm('이 확장과 엔진의 연결을 끊을까요? 엔진 쪽 토큰은 웹앱에서 폐기해 주세요.')) { await ask({ type: 'unpair' }); void render(); } });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-catchup]')) b.addEventListener('click', async () => { b.disabled = true; b.textContent = '여는 중…'; await ask({ type: 'catchup-now', sourceAi: b.dataset.catchup as SiteAi }); setTimeout(() => void render(), 800); });
  const pb = document.querySelector<HTMLButtonElement>('#pair');
  pb?.addEventListener('click', async () => {
    pb.disabled = true; $('#perr').textContent = '';
    const r = await ask<{ ok: boolean; message?: string }>({ type: 'pair', code: (document.querySelector('#code') as HTMLInputElement).value, coreUrl: (document.querySelector('#core') as HTMLInputElement).value });
    pb.disabled = false;
    if (!r.ok) $('#perr').textContent = r.message ?? '연결하지 못했어요'; else void render();
  });
}
void render();
