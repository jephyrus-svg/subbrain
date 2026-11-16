import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Data mode: mock (sample JSON in the browser, no core) by default; `--mode live` (pnpm dev:live / build:live) talks to the core.
// 모의(mock) 모드가 기본. 라이브 모드는 `pnpm dev:live`·`pnpm build:live` 또는 화면 왼쪽 아래 전환 링크.
// 라이브 요청은 /api → 코어(127.0.0.1:4545)로 프록시한다 (CORS 불필요).
// 코어 주소는 SUBBRAIN_CORE로 바꿀 수 있다(예: http://127.0.0.1:4555), 포트는 `vite --port 5174`
const CORE = process.env.SUBBRAIN_CORE ?? 'http://127.0.0.1:4545';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { 'import.meta.env.VITE_DATA_MODE': JSON.stringify(process.env.VITE_DATA_MODE ?? (mode === 'live' ? 'live' : 'mock')) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: CORE, changeOrigin: false },
    },
    watch: { ignored: ['**/screenshots/**', '**/.shots/**'] },
  },
  preview: {
    host: '127.0.0.1', port: 4173,
    proxy: { '/api': { target: CORE, changeOrigin: false } },
  },
  // 모의 모드 라우터 청크(엔진 캡처 상세 세트 JSON ≈ 690 kB, gzip 86 kB)는 모의 모드에서만 늦게 불러온다
  build: { chunkSizeWarningLimit: 800 },
}));
