/** 글자 2-gram 유사도 — 한국어(띄어쓰기·조사 흔들림)에 단어 단위보다 잘 맞는다. 임베딩 없이 쓰는 가벼운 사전 필터(계약 §16 1.1.0). */
const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '');

export function bigrams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  if (t.length === 1) out.add(t);
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
/** Dice 계수 0..1 */
export function dice(a: string | Set<string>, b: string | Set<string>): number {
  const A = typeof a === 'string' ? bigrams(a) : a, B = typeof b === 'string' ? bigrams(b) : b;
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}
/** 짧은 이름끼리 같은 것을 가리키는지: 정규화 후 같음 / 한쪽이 다른 쪽을 포함(2글자 이상) / Dice ≥ 0.6 */
export function sameName(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x))) return true;
  return dice(x, y) >= 0.6;
}

// ───────── 1.2.0 프로젝트 이름 비교: 한↔영 음차 별칭 + 일반어 제거 후 핵심 단어 겹침 ─────────
/**
 * 음차·번역 별칭(작은 사전). 왼쪽 → 오른쪽(대표형). 한국어로 흔히 음차되는 고유명사·외래어는 영어 대표형으로,
 * 영어 일반명사는 한국어 대표형으로 모은다. 모르는 단어는 그대로 둔다(임베딩 없이 쓰는 가벼운 규칙).
 */
export const NAME_ALIASES: Record<string, string> = {
  헤르메스: 'hermes', 에르메스: 'hermes', 클로드: 'claude', 제미나이: 'gemini', 제미니: 'gemini', 챗지피티: 'chatgpt', 챗gpt: 'chatgpt', 지피티: 'gpt',
  그록: 'grok', 노션: 'notion', 옵시디언: 'obsidian', 깃허브: 'github', 도커: 'docker', 파이썬: 'python', 리액트: 'react', 넥스트: 'next',
  유튜브: 'youtube', 인스타: 'instagram', 인스타그램: 'instagram', 블로그: 'blog', 브런치: 'brunch', 쇼츠: 'shorts', 커서: 'cursor', 슬랙: 'slack',
  에이전트: 'agent', 에이아이: 'ai', 인공지능: 'ai', 사스: 'saas', 앱: 'app', 어플: 'app', 애플리케이션: 'app', 웹: 'web', 웹사이트: 'website', 사이트: 'website',
  시스템: 'system', 플랫폼: 'platform', 프로젝트: 'project', 서비스: 'service', 툴: 'tool', 봇: 'bot', 챗봇: 'bot', 에이피아이: 'api', 엠씨피: 'mcp', 브이피에스: 'vps',
  logistics: '물류', delivery: '배송', shipping: '배송', florist: '꽃집', flower: '꽃집', bakery: '빵집', coffee: '커피', travel: '여행', trip: '여행',
  install: '설치', installation: '설치', setup: '설치', development: '개발', dev: '개발', guide: '사용법', tutorial: '사용법', management: '관리', idea: '아이디어', ideas: '아이디어',
};
/** 핵심 단어에서 뺄 일반어(대표형 기준). 'AI 에이전트', 'SaaS', '설치' 같은 말은 프로젝트를 구별하지 못한다 */
export const GENERIC_NAME_TOKENS = new Set([
  'ai', 'agent', 'saas', 'app', 'web', 'website', 'system', 'platform', 'project', 'service', 'tool', 'bot', 'api', 'program', 'the', 'and', 'for', 'of', 'my', 'new',
  '설치', '개발', '준비', '사용법', '만들기', '프로그램', '도구', '관리', '운영', '기획', '공부', '연구', '시작', '아이디어', '프로젝트', '작업', '정리', '계획', '구축', '제작', '설정', '환경',
]);
/** 붙여 쓴 한국어 합성어의 일반어 꼬리를 떼어 낸다('배송관리' → '배송'+'관리') */
const GENERIC_SUFFIXES = ['관리', '시스템', '설치', '개발', '준비', '사용법', '만들기', '프로그램', '프로젝트', '플랫폼', '서비스', '운영', '기획', '구축', '제작'];

export function nameTokens(name: string): string[] {
  const raw = name.toLowerCase().normalize('NFKC')
    .replace(/([\p{Script=Hangul}])([a-z0-9])/gu, '$1 $2').replace(/([a-z0-9])([\p{Script=Hangul}])/gu, '$1 $2') // 'saas준비' → 'saas 준비'
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (let t of raw) {
    t = NAME_ALIASES[t] ?? t;
    const suf = /\p{Script=Hangul}/u.test(t) ? GENERIC_SUFFIXES.find((s) => t.endsWith(s) && t.length - s.length >= 2) : undefined;
    if (suf) { const stem = t.slice(0, -suf.length); out.push(NAME_ALIASES[stem] ?? stem, suf); } else out.push(t);
  }
  return out;
}
export function coreNameTokens(name: string): string[] {
  return [...new Set(nameTokens(name).filter((t) => !GENERIC_NAME_TOKENS.has(t)))];
}

/**
 * 두 프로젝트 이름이 같은 프로젝트를 가리키는지(1.2.0). 다음 중 하나면 같다고 본다:
 *  1) sameName(정규화 같음 / 포함 / 2-gram Dice ≥ 0.6)
 *  2) 별칭·일반어 처리 후 핵심 단어: 작은 쪽이 큰 쪽에 다 들어가고(작은 쪽 2개 이상이거나 큰 쪽이 2개 이하)
 *  3) 핵심 단어를 이어 붙인 문자열이 같거나 한쪽이 다른 쪽을 포함(각 3글자 이상, '꽃집배송' ↔ '꽃집 배송')
 *  4) 핵심 단어 겹침 2개 이상이면서 겹침 계수(∩/min) ≥ 0.67
 * 예: '꽃집 배송 SaaS' ≈ '꽃집 배송 AI 에이전트', 'Obsidian Agent 설치' ≈ '옵시디언 AI'. '꽃집 배송 SaaS' ≠ '택배 배송관리 시스템'.
 */
export function similarProjectName(a: string, b: string): boolean {
  if (sameName(a, b)) return true;
  const A = coreNameTokens(a), B = coreNameTokens(b);
  if (!A.length || !B.length) return false;
  const [small, large] = A.length <= B.length ? [A, B] : [B, A];
  const L = new Set(large);
  const inter = small.filter((t) => L.has(t)).length;
  if (inter === small.length && (small.length >= 2 || large.length <= 2)) return true;
  const ja = A.join(''), jb = B.join('');
  if (Math.min(ja.length, jb.length) >= 3 && (ja === jb || ja.includes(jb) || jb.includes(ja))) return true;
  return inter >= 2 && inter / small.length >= 0.67;
}
