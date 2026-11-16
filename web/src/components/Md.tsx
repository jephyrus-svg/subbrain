import { mdPieces } from '../lib/format';
/** *기울임* → 밑줄 강조(em), **굵게** → b */
export function Md({ src }: { src: string }) {
  return <>{mdPieces(src).map((p, k) => (p.t === 'em' ? <em key={k}>{p.s}</em> : p.t === 'b' ? <b key={k}>{p.s}</b> : <span key={k}>{p.s}</span>))}</>;
}
