// 목록·칩에 쓰는 작은 객체 표식: 프로젝트=색 구, 과제=상태 표식, 나머지=원판 + 선 아이콘 (그래프와 같은 모양)
import { Icon, type IconName } from '../components/Icons';
import { Sphere, StatusGlyph } from '../components/Marks';
import { TYPE_META, type ObjectType, type OObject } from './model';

export const TYPE_ICON: Record<Exclude<ObjectType, 'project' | 'task'>, IconName> = {
  person: 'o-person', decision: 'o-decision', tool: 'o-tool', artifact: 'o-artifact', place: 'o-place', organization: 'o-organization', topic: 'o-topic',
};

export function TypeGlyph({ type, o, size = 18 }: { type: ObjectType; o?: OObject; size?: number }) {
  if (type === 'project') return <span className="og sph" style={{ width: size, height: size }}><Sphere color={o?.color ?? '#D08A66'} size={Math.round(size * 0.66)} /></span>;
  if (type === 'task') return <span className="og sph" style={{ width: size, height: size }}>{o ? <StatusGlyph v={o.visual} /> : <i className="ps tk" style={{ ['--c' as string]: '#7F9CC4' }} />}</span>;
  return (
    <span className={`og t-${type}${o?.status === 'suggested' ? ' og-sug' : ''}`} style={{ width: size, height: size, color: TYPE_META[type].tint }} title={TYPE_META[type].label}>
      <Icon name={TYPE_ICON[type]} size={Math.round(size * 0.62)} />
    </span>
  );
}
