// shared 패키지는 @types/node가 없어 목 생성용 최소 선언만 둔다(dump.ts는 Node로 실행)
declare module 'node:fs' { export function readFileSync(path: URL, encoding: 'utf8'): string }
