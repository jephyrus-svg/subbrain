import { tt, ttf } from '../i18n';
import { useNavigate } from 'react-router-dom';

/** 그래프 도구 모음의 "과제 / 관계" 전환 (설계서 10.8 관계 모드 전환, 10.11) */
export function ModeSwitch({ mode }: { mode: 'task' | 'ontology' }) {
  const nav = useNavigate();
  return (
    <div className="modesw" role="group" aria-label={tt("그래프 보기 방식")}>
      <button className={mode === 'task' ? 'on' : ''} aria-pressed={mode === 'task'} title={tt("프로젝트·과제·주제만")} onClick={() => mode !== 'task' && nav('/')}>{tt("과제")}</button>
      <button className={mode === 'ontology' ? 'on' : ''} aria-pressed={mode === 'ontology'} title={tt("온톨로지 모드: 사람·도구·결정·자료와 그 관계")} onClick={() => mode !== 'ontology' && nav('/ontology')}>{tt("관계")}</button>
    </div>
  );
}
