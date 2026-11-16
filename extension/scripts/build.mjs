// esbuild로 dist/(압축해제된 확장 프로그램 폴더)를 만든다: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'icons'), { recursive: true });
for (const f of ['manifest.json', 'popup.html', 'popup.css']) cpSync(join(root, 'static', f), join(out, f));

// 아이콘: 종이색 바탕 위 남색 고리(외부 파일 없이 PNG 직접 생성)
function png(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const c = (size - 1) / 2, rO = size * 0.42, rI = size * 0.27;
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c); const i = y * (size * 4 + 1) + 1 + x * 4;
      const ring = d <= rO && d >= rI; const disc = d < size * 0.48;
      const [r, g, b, a] = ring ? [63, 88, 114, 255] : disc ? [246, 242, 234, 255] : [0, 0, 0, 0];
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  const crc = (buf) => { let k, cr = ~0; for (const by of buf) { cr ^= by; for (k = 0; k < 8; k++) cr = cr & 1 ? (cr >>> 1) ^ 0xedb88320 : cr >>> 1; } return ~cr >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cb]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(join(out, 'icons', `${s}.png`), png(s));

const common = { bundle: true, target: 'chrome120', sourcemap: 'linked', logLevel: 'info', legalComments: 'none' };
const entries = [
  { entryPoints: [join(root, 'src/background/index.ts')], outfile: join(out, 'background.js'), format: 'esm' },
  { entryPoints: [join(root, 'src/content/main.ts')], outfile: join(out, 'content.js'), format: 'iife' },
  { entryPoints: [join(root, 'src/popup/popup.ts')], outfile: join(out, 'popup.js'), format: 'esm' },
];
if (process.argv.includes('--watch')) {
  for (const e of entries) await (await context({ ...common, ...e })).watch();
  console.log('watching… (확장 프로그램 페이지에서 새로고침 버튼을 눌러 반영)');
} else {
  for (const e of entries) await build({ ...common, ...e });
  if (!existsSync(join(out, 'background.js'))) process.exit(1);
  console.log('built →', out);
}
