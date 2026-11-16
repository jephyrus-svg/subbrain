import { defineConfig } from 'vitest/config';

// node:sqlite(실험적 내장 모듈)는 번들하지 않고 Node가 직접 불러오도록 forks 풀 + 외부 처리
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: { deps: { external: [/^node:/] } },
  },
});
