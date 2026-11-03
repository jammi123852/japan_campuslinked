/** 가져온 시간표 ↔ 공식 강의 대조 (순수 함수). 애매하면 연결하지 않는다 */
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** '情報科学実習Ⅱ([102])' → 과목명·분반 분리 */
export function splitSectionFromName(raw: string): { name: string; section: string } {
  // 과목명 글자(Ⅱ 등)는 그대로 두고 끝의 분반 표기만 뗀다
  const m = /^(.*?)[\s(（]*[\[［]\s*([0-9０-９]{2,4})\s*[\]］]\s*[)）]?\s*$/.exec(raw ?? '');
  if (m && m[1].trim()) return { name: m[1].trim(), section: m[2].normalize('NFKC') };
  return { name: raw ?? '', section: '' };
}

export function matchOfficialCourse(
  courses: { id: string; name: string; code?: string | null; section: string | null; meetings: { weekday: number; period: number }[] }[],
  q: { name: string; code?: string | null; section?: string | null; weekday: number; period: number | null },
): string | null {
  const n = norm(splitSectionFromName(q.name).name);
  if (!n) return null;
  const sameName = courses.filter((c) => norm(c.name) === n || (q.code && c.code === q.code));
  if (!sameName.length) return null;
  const atSlot = sameName.filter((c) => c.meetings.some((m) => m.weekday === q.weekday && m.period === q.period));
  const pool = atSlot.length ? atSlot : sameName;
  const bySection = q.section ? pool.filter((c) => (c.section ?? '').replace(/\D/g, '') === q.section!.replace(/\D/g, '')) : [];
  if (bySection.length === 1) return bySection[0].id;
  // 분반 표기가 없어도 그 시간에 하나뿐이면 연결
  return atSlot.length === 1 ? atSlot[0].id : null;
}
