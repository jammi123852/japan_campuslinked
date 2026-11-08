/**
 * 캠퍼스 지도: 강의실 번호 해석·장소 찾기 (순수 함수).
 * 근거를 구분한다. official = 학교 안내의 번호 규칙, inferred = 공식 설명은 못 찾았지만 번호 형태로 추정, data = 공식 강의 자료에 건물이 적힘.
 * 건물 안 층별 평면은 자료가 없어 건물·층까지만 알려 준다.
 */
export interface CampusBuilding {
  id: string;
  mark: string;
  ko: string;
  ja: string;
  x: number;
  y: number;
  groupKo: string;
  groupJa: string;
  facilities: { ko: string; ja: string }[];
  aliases: string[];
}
export interface CampusData {
  map: { src: string; width: number; height: number; source: string; reuse: string };
  links: { search: string; map: string };
  buildings: CampusBuilding[];
}
export type RoomBasis = 'official' | 'inferred' | 'data';
export interface RoomInfo {
  raw: string;
  buildingId: string;
  wing: string | null;
  floor: number | null;
  number: string | null;
  basis: RoomBasis;
}

const clean = (s: string) => s.normalize('NFKC').trim().toUpperCase();

/** 4~5자리 숫자 번호의 앞자리(건물) 중 지도에 있는 것 */
const NUMERIC: Record<string, string> = { '1': 'b1', '3': 'b3', '8': 'b8', '12': 'b12', '15': 'b15', '17': 'b17', '18': 'b18', '19': 'b19' };

function parseOne(raw: string): RoomInfo | null {
  const s = clean(raw);
  let m = /^([NS])(\d)(\d{2})[A-Z]{0,2}$/.exec(s);
  if (m) return { raw, buildingId: 'b1', wing: m[1], floor: Number(m[2]), number: m[3], basis: 'official' };
  m = /^2([WE])(\d)(\d{2})[A-Z]{0,2}$/.exec(s);
  if (m) return { raw, buildingId: 'b2', wing: m[1], floor: Number(m[2]), number: m[3], basis: 'official' };
  if (/^OA(教室)?\d?/.test(s)) return { raw, buildingId: 'b1', wing: null, floor: 6, number: null, basis: 'official' };
  if (/^(パソコン教室|パソコン|パソ)\d?/.test(s)) return { raw, buildingId: 'chuo', wing: null, floor: 4, number: null, basis: /^パソコン教室/.test(s) ? 'official' : 'inferred' };
  if (/^42(番教室)?(\(.*\))?$/.test(s)) return { raw, buildingId: 'chuo', wing: null, floor: 4, number: '42', basis: 'data' };
  if (/アリーナ/.test(s)) return { raw, buildingId: 'arena', wing: null, floor: null, number: null, basis: 'official' };
  if (/^工房/.test(s)) return { raw, buildingId: 'koubou', wing: null, floor: null, number: null, basis: 'inferred' };
  m = /^(\d{1,2})(\d)(\d{2})[A-Z]{0,2}$/.exec(s);
  if (m && NUMERIC[m[1]]) return { raw, buildingId: NUMERIC[m[1]], wing: null, floor: Number(m[2]), number: m[3], basis: 'inferred' };
  return null;
}

/** 강의실 표기 해석. 'デザ実1/15201'·'8209、8213' 처럼 여러 개면 위치를 아는 첫 번째를 쓴다. 모르면 null (추측하지 않음) */
export function parseRoom(raw: string | null | undefined): RoomInfo | null {
  if (!raw) return null;
  for (const part of raw.split(/[/／、,・\s]+/).filter(Boolean)) {
    const r = parseOne(part);
    if (r) return { ...r, raw };
  }
  return parseOne(raw);
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s·・]+/g, '');

export interface PlaceHit {
  building: CampusBuilding;
  room: RoomInfo | null;
  /** 찾는 말이 들어 있는 시설 */
  facility: { ko: string; ja: string } | null;
}

/** 강의실 번호·건물 이름·시설 이름으로 찾는다. 없는 장소를 만들지 않는다 */
export function findPlaces(data: CampusData, query: string): PlaceHit[] {
  const q = norm(query.replace(/(어디|위치|찾아|알려|강의실|건물|どこ|場所|教室|にある|는|은|이|가|줘|야|예요|에요|\?|？)/g, ' '));
  if (!q) return [];
  const byId = new Map(data.buildings.map((b) => [b.id, b]));
  const room = parseRoom(query.normalize('NFKC').trim()) ?? parseRoom((query.normalize('NFKC').match(/[A-Za-z0-9]+[A-Za-z0-9]*/g) ?? []).find((x) => /\d/.test(x)));
  if (room) {
    const b = byId.get(room.buildingId);
    if (b) return [{ building: b, room, facility: null }];
  }
  const hits: PlaceHit[] = [];
  for (const b of data.buildings) {
    const fac = b.facilities.find((f) => norm(f.ko).includes(q) || norm(f.ja).includes(q)) ?? null;
    const name = [b.ko, b.ja, ...b.aliases].some((n) => norm(n).includes(q) || (q.length >= 2 && q.includes(norm(n)) && norm(n).length >= 2));
    if (fac || name) hits.push({ building: b, room: null, facility: fac ?? b.facilities.find((f) => b.aliases.some((a) => norm(a).length >= 2 && q.includes(norm(a)) && (norm(f.ko).includes(norm(a)) || norm(f.ja).includes(norm(a))))) ?? null });
  }
  return hits.slice(0, 6);
}
