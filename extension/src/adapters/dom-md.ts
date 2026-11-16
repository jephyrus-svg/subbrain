// 화면 DOM → 마크다운(설계서 5.4①-B). Turndown 대신 작은 변환기: 이 확장이 만나는 요소만 다룬다.
// - 코드 블록: <code>의 textContent 그대로(문법 강조 span 무시), 언어는 class "language-x"·data-language·머리글에서
// - 수식: KaTeX <annotation encoding="application/x-tex"> 원본 TeX → $…$ / $$…$$
// - 표: GFM 표(병합 셀이 있으면 HTML 그대로)
// - 이미지: ![대체 텍스트] 자리표시자(파일은 저장하지 않음)
// - 버튼·아이콘 등 UI 요소는 걷어낸다(strip 선택자)

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'FIGURE']);

export function toMarkdown(root: Element, strip: string[]): string {
  const el = root.cloneNode(true) as Element;
  // 수식은 걷어내기 전에 TeX로 바꿔 둔다(KaTeX 안의 aria-hidden 요소가 strip에 걸리므로)
  for (const k of [...el.querySelectorAll('.katex-display, .katex, math')]) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!tex) continue;
    const display = k.classList.contains('katex-display') || k.closest('.katex-display') !== null || k.getAttribute('display') === 'block';
    if (k.closest('.katex-display') && !k.classList.contains('katex-display')) continue; // 바깥 display가 처리
    const t = el.ownerDocument.createElement('span');
    t.setAttribute('data-sb-tex', display ? 'block' : 'inline');
    t.textContent = tex;
    k.replaceWith(t);
  }
  // 코드 블록 머리글의 언어 이름(pre 바깥 작은 글자)은 본문이 아님 → 걷어냄
  for (const pre of [...el.querySelectorAll('pre')]) {
    const code = pre.querySelector('code') ?? pre;
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9).toLowerCase();
    if (!lang) continue;
    let box: Element | null = pre.parentElement;
    for (let up = 0; up < 2 && box && box !== el; up++) {
      for (const x of [...box.querySelectorAll('*')]) if (!x.contains(pre) && !pre.contains(x) && x.children.length === 0 && !/^(P|LI|H[1-6]|TD|TH|CODE)$/.test(x.tagName) && (x.textContent ?? '').trim().toLowerCase() === lang) x.remove();
      box = box.parentElement;
    }
  }
  for (const s of strip) for (const x of [...el.querySelectorAll(s)]) {
    if (x.closest('pre') && x.tagName !== 'BUTTON') continue; // 코드 안의 aria-hidden 줄번호 등은 유지할 필요 없음 → 아래 code에서 textContent만 씀
    x.remove();
  }
  return tidy(blocks(el));
}

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function blocks(node: Node, ctx: { list?: { ordered: boolean; n: number }; depth: number } = { depth: 0 }): string {
  let out = '';
  for (const ch of [...node.childNodes]) out += block(ch, ctx);
  return out;
}

function block(n: Node, ctx: { list?: { ordered: boolean; n: number }; depth: number }): string {
  if (n.nodeType === 3) return escapeInline(n.textContent ?? '');
  if (n.nodeType !== 1) return '';
  const e = n as Element; const tag = e.tagName;
  if (e.getAttribute('data-sb-tex')) return e.getAttribute('data-sb-tex') === 'block' ? `\n\n$$\n${e.textContent}\n$$\n\n` : `$${e.textContent}$`;
  switch (tag) {
    case 'BR': return '  \n';
    case 'HR': return '\n\n---\n\n';
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return `\n\n${'#'.repeat(+tag[1]!)} ${inline(e).trim()}\n\n`;
    case 'P': return `\n\n${inline(e).trim()}\n\n`;
    case 'PRE': return codeBlock(e);
    case 'BLOCKQUOTE': return '\n\n' + tidy(blocks(e, ctx)).split('\n').map((l) => `> ${l}`.trimEnd()).join('\n') + '\n\n';
    case 'UL': case 'OL': {
      const lctx = { list: { ordered: tag === 'OL', n: Number(e.getAttribute('start') ?? 1) }, depth: ctx.list ? ctx.depth + 1 : 0 };
      let s = '';
      for (const li of [...e.children]) if (li.tagName === 'LI') {
        const mark = lctx.list.ordered ? `${lctx.list.n++}. ` : '- ';
        const body = tidy(blocks(li, lctx));
        // 안쪽 목록은 바깥 항목의 이어지는 줄로 들여쓴다(깊이마다 2칸)
        s += mark + body.split('\n').map((l, i) => (i === 0 ? l : l ? '  ' + l : '')).join('\n') + '\n';
      }
      return (ctx.list ? '\n' : '\n\n') + s + (ctx.list ? '' : '\n');
    }
    case 'TABLE': return table(e);
    case 'IMG': return `![${e.getAttribute('alt') ?? '이미지'}]`;
    default:
      if (BLOCK.has(tag)) { const inner = blocks(e, ctx); return /\n/.test(inner) ? `\n\n${inner}\n\n` : inner.trim() ? `\n\n${inner}\n\n` : ''; }
      return inlineEl(e);
  }
}

function inline(e: Element): string {
  let s = '';
  for (const ch of [...e.childNodes]) s += ch.nodeType === 3 ? escapeInline(ch.textContent ?? '') : ch.nodeType === 1 ? (BLOCK.has((ch as Element).tagName) ? block(ch, { depth: 0 }) : inlineEl(ch as Element)) : '';
  return s;
}

function inlineEl(e: Element): string {
  if (e.getAttribute('data-sb-tex')) return block(e, { depth: 0 });
  // 2026-10-16b: ChatGPT 새 화면은 굵은 글씨를 <span data-d-default-strong>로 그림
  if (e.hasAttribute('data-d-default-strong')) { const t = inline(e); return t.trim() ? `**${t.trim()}**${/\s$/.test(t) ? ' ' : ''}` : t; }
  switch (e.tagName) {
    case 'STRONG': case 'B': { const t = inline(e); return t.trim() ? `**${t}**` : t; }
    case 'EM': case 'I': { const t = inline(e); return t.trim() ? `*${t}*` : t; }
    case 'DEL': case 'S': return `~~${inline(e)}~~`;
    case 'CODE': { const t = e.textContent ?? ''; const f = t.includes('`') ? '``' : '`'; return `${f}${t}${f}`; }
    case 'A': { const href = e.getAttribute('href'); const t = inline(e).trim(); return href && !href.startsWith('javascript:') ? `[${t || href}](${href})` : t; }
    case 'BR': return '  \n';
    case 'IMG': return `![${e.getAttribute('alt') ?? '이미지'}]`;
    default: return inline(e);
  }
}

function codeBlock(pre: Element): string {
  const code = pre.querySelector('code') ?? pre;
  const cls = [...code.classList, ...pre.classList].find((c) => c.startsWith('language-'));
  const lang = (cls?.slice(9) ?? code.getAttribute('data-language') ?? pre.getAttribute('data-language') ?? '').trim();
  const text = (code.textContent ?? '').replace(/\n$/, '');
  const fence = text.includes('```') ? '````' : '```';
  return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
}

function table(t: Element): string {
  if (t.querySelector('[colspan]:not([colspan="1"]), [rowspan]:not([rowspan="1"])')) return `\n\n${t.outerHTML}\n\n`;
  const rows = [...t.querySelectorAll('tr')].map((r) => [...r.children].map((c) => inline(c).trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')));
  if (!rows.length) return '';
  const w = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(w - r.length).fill('')];
  const [head, ...rest] = rows;
  return '\n\n' + [`| ${pad(head!).join(' | ')} |`, `| ${Array(w).fill('---').join(' | ')} |`, ...rest.map((r) => `| ${pad(r).join(' | ')} |`)].join('\n') + '\n\n';
}

/** 화면 글자는 그대로 둔다(사용자가 쓴 *, _ 를 이스케이프하면 해시·검색에 섞이므로). 공백만 정리 */
function escapeInline(s: string): string {
  return s.replace(/[ \t\r\n]+/g, ' ');
}

/** 사용자 메시지: 쓴 그대로(줄바꿈 유지). 문단(<p>)·<br>로 나뉜 경우도 줄바꿈으로 */
export function plainText(root: Element, strip: string[]): string {
  const el = root.cloneNode(true) as Element;
  for (const s of strip) for (const x of [...el.querySelectorAll(s)]) x.remove();
  const doc = el.ownerDocument;
  for (const br of [...el.querySelectorAll('br')]) br.replaceWith(doc.createTextNode('\n'));
  const blocks = [...el.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, pre, blockquote')];
  for (const b of blocks) if (b.nextSibling || b.parentElement !== el || b !== el.lastElementChild) b.after(doc.createTextNode('\n'));
  return (el.textContent ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
