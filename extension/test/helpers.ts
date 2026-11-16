import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Window } from 'happy-dom';

export const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
/** 저장한 HTML을 주어진 주소의 페이지처럼 띄운다 */
export function page(name: string, url: string) {
  const win = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  win.document.write(fixture(name));
  return { win, doc: win.document as unknown as Document, url: new URL(url) };
}
