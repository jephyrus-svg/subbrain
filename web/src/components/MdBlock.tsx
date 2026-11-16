/**
 * 대화 본문 마크다운 렌더러 (안전: HTML 문자열을 쓰지 않고 React 요소만 만든다 → 원문 HTML은 글자 그대로 보임)
 * 지원: 제목(#~######) · 문단/줄바꿈 · 굵게/기울임 · `인라인 코드` · ``` 코드 블록 · 목록(-,*,+,1.)·중첩 · 인용(>) · 표(|) · 구분선(---) · 링크([t](http…), 맨 URL)
 * 링크는 http/https/mailto 만 허용 (javascript: 등은 글자로 둔다), 새 탭 + noopener.
 */
import { Fragment, type ReactNode } from 'react';

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

// 인라인: 코드 > 링크 > 굵게 > 기울임 > 맨 URL
export function inline(src: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []; let i = 0; let buf = ''; let k = 0;
  const flush = () => { if (!buf) return; buf.split('\n').forEach((t, j) => { if (j) out.push(<br key={`${key}br${k++}`} />); if (t) out.push(t); }); buf = ''; };
  const push = (n: ReactNode) => { flush(); out.push(<Fragment key={`${key}${k++}`}>{n}</Fragment>); };
  while (i < src.length) {
    const c = src[i]!, rest = src.slice(i);
    if (c === '\\' && i + 1 < src.length && /[\\`*_[\]#>|~-]/.test(src[i + 1]!)) { buf += src[i + 1]; i += 2; continue; }
    if (c === '`') { const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest); if (m) { push(<code className="mdc">{m[2]!.trim()}</code>); i += m[0].length; continue; } }
    if (c === '[') { const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest); if (m) { const u = m[2]!; push(SAFE_URL.test(u) ? <a href={u} target="_blank" rel="noopener noreferrer nofollow">{inline(m[1]!, `${key}l${k}`)}</a> : <span className="mdnolink">{inline(m[1]!, `${key}n${k}`)}</span>); i += m[0].length; continue; } }
    if ((c === '*' || c === '_') && src[i + 1] === c) { const m = c === '*' ? /^\*\*(?=\S)([\s\S]*?\S)\*\*/.exec(rest) : /^__(?=\S)([\s\S]*?\S)__/.exec(rest); if (m) { push(<b>{inline(m[1]!, `${key}b${k}`)}</b>); i += m[0].length; continue; } }
    if (c === '~' && src[i + 1] === '~') { const m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest); if (m) { push(<s>{inline(m[1]!, `${key}s${k}`)}</s>); i += m[0].length; continue; } }
    if ((c === '*' || c === '_') && !/\w/.test(src[i - 1] ?? ' ')) { const m = c === '*' ? /^\*(?=\S)([^*\n]*?\S)\*(?!\*)/.exec(rest) : /^_(?=\S)([^_\n]*?\S)_(?!\w)/.exec(rest); if (m) { push(<em>{inline(m[1]!, `${key}e${k}`)}</em>); i += m[0].length; continue; } }
    if (c === 'h' || c === 'm') { const m = /^(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/i.exec(rest); if (m && !/\w/.test(src[i - 1] ?? ' ')) { push(<a href={m[1]} target="_blank" rel="noopener noreferrer nofollow">{m[1]}</a>); i += m[0].length; continue; } }
    buf += c; i++;
  }
  flush();
  return out;
}

const withBreaks = (lines: string[], key: string) => inline(lines.map((l) => l.replace(/\s+$/, '')).join('\n'), key);
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;

export function blocks(src: string, key = 'm'): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = []; let i = 0; let k = 0;
  const K = () => `${key}${k++}`;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    // 코드 블록
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push(<pre key={K()} className="mdpre">{fence[2] ? <span className="mdlang">{fence[2]}</span> : null}<code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { const lv = Math.min(4, h[1]!.length + 1); const Tag = `h${lv}` as 'h2'; out.push(<Tag key={K()} className="mdh">{inline(h[2]!, K())}</Tag>); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push(<hr key={K()} className="mdhr" />); i++; continue; }
    if (/^\s{0,3}>/.test(line)) {
      const q: string[] = []; while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''));
      out.push(<blockquote key={K()} className="mdq">{blocks(q.join('\n'), K())}</blockquote>); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = cells(line); i += 2; const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      out.push(<div key={K()} className="mdtw"><table className="mdt"><thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}th${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const lm = LIST.exec(line);
    if (lm) {
      const base = lm[1]!.length; const ordered = /\d/.test(lm[2]!); const items: string[][] = [];
      while (i < lines.length) {
        const l = lines[i]!; const m = LIST.exec(l);
        if (m && m[1]!.length <= base + 1 && /\d/.test(m[2]!) === ordered) { items.push([m[3]!]); i++; continue; }
        if (m && m[1]!.length <= base + 1) break;               // 다른 종류 목록
        if (l.trim() && (/^\s/.test(l) || (m && m[1]!.length > base)) && items.length) { items[items.length - 1]!.push(l.replace(new RegExp(`^\\s{0,${base + 4}}`), '')); i++; continue; }
        if (!l.trim() && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!) && items.length) { i++; continue; }
        break;
      }
      const start = ordered ? parseInt(lm[2]!, 10) : undefined;
      const lis = items.map((it, j) => <li key={j}>{it.length > 1 ? blocks(it.join('\n'), `${key}li${j}_`) : inline(it[0]!, `${key}li${j}_`)}</li>);
      out.push(ordered ? <ol key={K()} className="mdl" start={start}>{lis}</ol> : <ul key={K()} className="mdl">{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^\s*(```|~~~)/.test(lines[i]!) && !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]!) && !LIST.exec(lines[i]!) && !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i]!) && !(lines[i]!.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!))) para.push(lines[i++]!);
    if (!para.length) { para.push(lines[i++]!); }
    out.push(<p key={K()} className="mdp">{withBreaks(para, K())}</p>);
  }
  return out;
}

export function MdBlock({ src }: { src: string }) {
  return <div className="md">{blocks(src ?? '')}</div>;
}
