import { tt, ttf } from '../i18n';
// §8.12 대화 원문 — GET /conversations/:conversationId (메시지는 cursor 페이지)
// 1.3.0: ChatGPT 음성 대화 전사는 `Message.voice: true` → 메시지 옆에 작은 "음성" 표식
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Message } from '@subbrain/shared';
import { api } from '../api/endpoints';
import { useApi } from '../api/useApi';
import { errorText } from '../api/client';
import { Icon } from '../components/Icons';
import { AiMark } from '../components/Marks';
import { MdBlock } from '../components/MdBlock';
import { OutcomeBadge } from '../components/TaskBadges';
import { aiLabel, fullDateTime } from '../lib/format';
import '../styles/detail.css';

const WHO: Record<string, string> = { user: tt("나"), assistant: 'AI', system: tt("시스템"), tool: tt("도구") };

export function VoiceMark() {
  return <span className="vmk" title={tt("음성 대화에서 옮겨 적은 글(전사)")}>{tt("음성")}</span>;
}

export default function Conversation() {
  const { conversationId = '' } = useParams();
  const c = useApi(() => api.conversation(conversationId, { limit: 100 }), [conversationId]);
  const [more, setMore] = useState<{ items: Message[]; cursor: string | null; loading: boolean }>({ items: [], cursor: null, loading: false });
  const d = c.data;
  const cursor = more.items.length ? more.cursor : d?.messages.page.nextCursor ?? null;
  const items = d ? [...d.messages.items, ...more.items] : [];
  const loadMore = () => {
    if (!cursor) return;
    setMore((m) => ({ ...m, loading: true }));
    api.conversation(conversationId, { limit: 100, cursor }).then((r) => setMore((m) => ({ items: [...m.items, ...r.messages.items], cursor: r.messages.page.nextCursor, loading: false })), () => setMore((m) => ({ ...m, loading: false })));
  };
  const voiceCount = items.filter((m) => m.voice).length;

  if (c.error != null) return <div className="state" style={{ position: 'absolute', inset: '52px 0 0' }}><b>{tt("대화를 불러오지 못했어요")}</b><span>{errorText(c.error)}</span><button className="btn" onClick={c.reload}>{tt("다시 시도")}</button></div>;
  if (!d) return <div className="state" style={{ position: 'absolute', inset: '52px 0 0' }}>{tt("대화를 불러오는 중…")}</div>;
  return (
    <div className="convv scroll">
      <div className="cvin">
        <div className="cvh">
          <AiMark ai={d.sourceAi} />
          <div>
            <h1>{d.title}</h1>
            {d.outcome && <div className="cvo"><span className="l">{tt("대화 결과")}</span><OutcomeBadge o={d.outcome} />{d.outcome.evidence && <small>“{d.outcome.evidence}”</small>}</div>}
            <div className="cvm">
              {aiLabel(d.sourceAi)} {tt("· 메시지")} {d.messageCount} · {fullDateTime(d.updatedAt)}
              {voiceCount > 0 && <> · <VoiceMark /> {tt("전사 포함")}</>}
              {d.task && <> · <Link to={`/tasks/${encodeURIComponent(d.task.id)}`}>‘{d.task.title}’</Link></>}
              {d.sourceUrl && <> · <a href={d.sourceUrl} target="_blank" rel="noreferrer">{tt("원래 대화")} <Icon name="arrow" /></a></>}
            </div>
          </div>
        </div>
        {items.map((m) => (
          <div key={m.id} className={`q cvq${m.role === 'user' ? ' me' : ''}`}>
            <span className="who">{WHO[m.role] ?? m.role}</span>{m.voice === true && <VoiceMark />}
            {m.createdAt && <span className="cvt">{fullDateTime(m.createdAt)}</span>}
            <MdBlock src={m.contentMd} />
          </div>
        ))}
        {cursor && <button className="btn cvmore" disabled={more.loading} onClick={loadMore}>{more.loading ? tt("불러오는 중…") : tt("메시지 더 보기")}</button>}
      </div>
    </div>
  );
}
