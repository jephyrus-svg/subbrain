/**
 * 설계서 §7.5 비밀정보 가리기 — 보내기 전 정규식으로 [REDACTED:종류].
 * 순서가 중요: 긴 패턴(키·카드) → 짧은 패턴(전화).
 */
const RULES: Array<[kind: string, re: RegExp, keep?: (m: string, ...g: string[]) => string]> = [
  // 1.5.0 로컬 세션 로그(실제로 평문 키가 있었음) — 환경변수 꼴은 이름은 남기고 값만 가림
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ['secret_env', /\b([A-Z][A-Z0-9_]*(?:API_?KEY|_KEY|TOKEN|SECRET|PASSWORD|PASSWD|_PWD|CREDENTIALS?))(\s*[=:]\s*["']?)(?!\[REDACTED)([^\s"'`,;]{8,})/g, (_m, name: string, sep: string) => `${name}${sep}`],
  ['secret_env', /(["']?\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password)["']?\s*[:=]\s*["'])(?!\[REDACTED)([^"'\s]{8,})(?=["'])/gi, (_m, pre: string) => pre],  // JSON·코드 안 "api_key": "…"
  ['token', /\bBearer\s+(?!\[REDACTED)[A-Za-z0-9._~+/-]{20,}=*/g],
  ['token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],          // JWT
  ['token', /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g],
  ['token', /\bya29\.[A-Za-z0-9_-]{20,}/g],                                      // Google OAuth 접근 토큰
  ['token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['token', /\bhf_[A-Za-z0-9]{30,}\b/g],                                          // Hugging Face
  ['api_key', /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],                       // Stripe
  ['api_key', /\bgsk_[A-Za-z0-9]{40,}\b/g],                                       // Groq
  ['api_key', /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g],     // OpenAI·Anthropic 류
  ['api_key', /\bxai-[A-Za-z0-9]{20,}\b/g],
  ['api_key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],                                // Google API 키
  ['aws_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],                              // GitHub 토큰
  ['token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],                            // Slack 토큰
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['rrn', /\b\d{6}\s?-\s?[1-8]\d{6}\b/g],                                   // 주민등록번호 형식
  ['card', /\b(?:\d{4}[ -]?){3}\d{4}\b/g],                                   // 카드번호 형식
  ['phone', /(?<!\d)(?:\+82[ -]?)?0?1[016789][ -]?\d{3,4}[ -]?\d{4}(?!\d)/g], // 휴대전화
  ['phone', /(?<!\d)0(?:2|[3-6][1-5])[ -]?\d{3,4}[ -]?\d{4}(?!\d)/g],         // 지역번호
];

export function redactSecrets(text: string): { text: string; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  let out = text;
  for (const [kind, re, keep] of RULES) {
    out = out.replace(re, (m: string, ...g: string[]) => { counts[kind] = (counts[kind] ?? 0) + 1; return `${keep ? keep(m, ...g) : ''}[REDACTED:${kind}]`; });
  }
  return { text: out, counts };
}
