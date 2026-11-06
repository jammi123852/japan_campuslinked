import { router } from 'expo-router';
import { useCourseName } from '@/data/useCourseName';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';

import { Block, Button, Chip, Columns, EmptyText, Notice, Pill, Row, T, TextField, useWide } from '@/components/ui';
import { useApp } from '@/state/AppContext';
import { useI18n } from '@/i18n';
import { colors, gutter, space } from '@/theme/tokens';
import { EMPTY_OFFICIAL_FILTERS, searchOfficial, type OfficialFilters } from '../academic/academicLogic';
import { deptCodeOf, TRACKS } from './courseLogic';
import type { OfficialPublicMin } from './types';
import { useOfficial } from './useOfficial';
import { SearchSummary } from './SearchSummary';

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  const wide = useWide();
  return (
    <View style={{ marginBottom: space.sm }}>
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.xs }}>
        {label}
      </T>
      {wide ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{children}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter }}>
          {children}
        </ScrollView>
      )}
    </View>
  );
}

/** 공개 빌드: 자료 사용 허가를 확인하기 전까지 과목 데이터를 넣지 않는다. 공식 링크는 그대로 연결 */
export function PublicMinNotice({ pm }: { pm: OfficialPublicMin | null }) {
  const { t } = useI18n();
  return (
    <Block testID="official-public-min">
      <Notice tone="warning" text={t.official.missing} />
      {(pm?.links ?? []).map((l) => (
        <Button key={l.id} testID={`official-link-${l.id}`} label={t.official.officialLinks[l.id] ?? l.title} variant="tertiary" size="md" icon="open-outline" onPress={() => Linking.openURL(l.url)} />
      ))}
      <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
        {t.official.publicHeldBack}
      </T>
    </Block>
  );
}

const PAGE = 60;
const DEPT_GROUPS: { faculty: string; codes: string[] }[] = [
  { faculty: '国際文化学部', codes: ['KK', 'KN'] }, { faculty: '人間科学部', codes: ['HP', 'HC', 'HS'] }, { faculty: '経済学部', codes: ['EE'] }, { faculty: '商学部', codes: ['CB'] }, { faculty: '地域共創学部', codes: ['DT', 'DR'] },
  { faculty: '理工学部', codes: ['RS', 'RK', 'RC', 'RM', 'RE'] }, { faculty: '生命科学部', codes: ['LL'] }, { faculty: '建築都市工学部', codes: ['UA', 'UH', 'UC'] }, { faculty: '芸術学部', codes: ['AA', 'AP', 'AD', 'AE', 'AS'] },
];

/** 검색 탭의 '공식 강의' 모드: 전 학부 2026 개설 분반 검색 */
export function OfficialSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const { t } = useI18n();
  const cn = useCourseName();
  const { profile } = useApp();
  const state = useOfficial();
  const mine = deptCodeOf(profile?.facultyId, profile?.departmentId);
  const [f, setF] = useState<OfficialFilters>({ ...EMPTY_OFFICIAL_FILTERS, query: initialQuery, dept: mine, cohortYear: mine ? (profile?.admissionYear ?? null) : null });
  const [limit, setLimit] = useState(PAGE);
  const wide = useWide();
  const [showFilters, setShowFilters] = useState(false);
  const set = (p: Partial<OfficialFilters>) => {
    setLimit(PAGE);
    setF((prev) => ({ ...prev, ...p }));
  };
  const results = useMemo(() => (state.kind === 'ok' ? searchOfficial(state.data.courses, f) : []), [state, f]);

  if (state.kind === 'loading') return <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xl }} accessibilityLabel={t.official.loading} />;
  if (state.kind === 'missing') return <PublicMinNotice pm={state.publicMin} />;
  if (state.kind !== 'ok') return <Notice tone="warning" text={t.official.loadError} />;

  return (
    <Columns
      side="left"
      sideWidth={360}
      first={
        <Block>
          <TextField testID="official-search" label={t.lectures.searchLabel} value={f.query} onChangeText={(query) => set({ query })} placeholder={t.official.searchPlaceholder} autoCorrect={false} />
          {!wide ? <Button testID="of-toggle-filters" label={showFilters ? t.official.filtersHide : t.official.filtersShow} variant="text" size="md" icon="options-outline" onPress={() => setShowFilters((v) => !v)} /> : null}
          {wide || showFilters ? (
          <>
          <FilterRow label={t.official.filterDept}>
            {mine ? <Chip testID="of-dept-mine" label={t.official.deptMine} selected={f.dept === mine} onPress={() => set({ dept: mine })} /> : null}
            <Chip testID="of-dept-all" label={t.lectures.all} selected={f.dept == null} onPress={() => set({ dept: null })} />
            {DEPT_GROUPS.flatMap((g) => g.codes).filter((c) => c !== mine).map((c) => (
              <Chip key={c} testID={`of-dept-${c}`} label={t.official.deptNames[c] ?? c} selected={f.dept === c} onPress={() => set({ dept: c })} />
            ))}
          </FilterRow>
          <FilterRow label={t.official.filterTrack}>
            <Chip testID="of-track-all" label={t.lectures.all} selected={f.track == null} onPress={() => set({ track: null })} />
            {TRACKS.map((x) => (
              <Chip key={x} testID={`of-track-${x}`} label={t.official.tracks[x]} selected={f.track === x} onPress={() => set({ track: x })} />
            ))}
          </FilterRow>
          {profile?.admissionYear ? (
            <FilterRow label={t.official.filterCohort}>
              <Chip testID="of-cohort-all" label={t.lectures.all} selected={f.cohortYear == null} onPress={() => set({ cohortYear: null })} />
              <Chip testID="of-cohort-mine" label={t.official.cohortMine(profile.admissionYear)} selected={f.cohortYear === profile.admissionYear} onPress={() => set({ cohortYear: profile.admissionYear })} />
            </FilterRow>
          ) : null}
          <FilterRow label={t.official.filterTerm}>
            <Chip testID="of-term-all" label={t.lectures.all} selected={f.term == null} onPress={() => set({ term: null })} />
            {(['前期', '後期'] as const).map((x) => (
              <Chip key={x} testID={`of-term-${x}`} label={t.period.terms[x]} selected={f.term === x} onPress={() => set({ term: x })} />
            ))}
          </FilterRow>
          <FilterRow label={t.official.filterYear}>
            <Chip testID="of-year-all" label={t.lectures.all} selected={f.year == null} onPress={() => set({ year: null })} />
            {[1, 2, 3, 4].map((y) => (
              <Chip key={y} testID={`of-year-${y}`} label={t.common.grade(y)} selected={f.year === y} onPress={() => set({ year: y })} />
            ))}
          </FilterRow>
          <FilterRow label={t.lectures.filterWeekday}>
            <Chip testID="of-day-all" label={t.lectures.all} selected={f.weekday == null} onPress={() => set({ weekday: null })} />
            {[0, 1, 2, 3, 4].map((d) => (
              <Chip key={d} testID={`of-day-${d}`} label={t.common.weekdays[d]} selected={f.weekday === d} onPress={() => set({ weekday: d })} />
            ))}
          </FilterRow>
          <FilterRow label={t.official.filterMark}>
            <Chip testID="of-mark-all" label={t.lectures.all} selected={f.mark == null} onPress={() => set({ mark: null })} />
            <Chip testID="of-mark-req" label={t.official.markAny} selected={f.mark === 'required_any'} onPress={() => set({ mark: 'required_any' })} />
            <Chip testID="of-mark-el" label={t.official.markElective} selected={f.mark === 'elective'} onPress={() => set({ mark: 'elective' })} />
          </FilterRow>
          </>
          ) : null}
        </Block>
      }
      second={
        <>
          <T variant="headline" testID="official-count" style={{ marginBottom: space.sm }}>
            {t.official.count(results.length)}
          </T>
          <SearchSummary results={results} query={f.query} />
          <Notice text={t.official.scope} />
          <Block flush>
            <View style={{ paddingHorizontal: gutter }}>
              {results.length === 0 ? (
                <EmptyText text={t.official.noResult} />
              ) : (
                results.slice(0, limit).map((c) => (
                  <Row
                    key={c.id}
                    testID={`official-${c.id}`}
                    title={cn(c.name)}
                    numberOfLines={2}
                    chevron
                    onPress={() => router.push({ pathname: '/course', params: { id: c.id } })}
                    subtitle={
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
                        <Pill text={`${c.term ? t.period.terms[c.term] : t.official.termUnknown} ${c.quarters.join('·')}`} />
                        {c.track && c.track !== 'major' ? <Pill text={t.official.tracks[c.track]} /> : null}
                        {c.mark ? <Pill text={t.official.marks[c.mark]} tone="accent" /> : null}
                        <T variant="sub" tone="tertiary">
                          {[c.credits != null ? `${c.credits}${t.official.creditsUnit}` : '', c.section ? `[${c.section}]` : '', c.instructor ?? '', c.offTimetable && !c.meetings.length ? t.official.offTimetable : '', c.meetings.map((m) => t.lectures.meeting(t.common.weekdays[m.weekday], m.period)).join(', ')].filter(Boolean).join('  ')}
                        </T>
                      </View>
                    }
                  />
                ))
              )}
              {results.length > limit ? <Button testID="official-more" label={t.official.more(results.length - limit)} variant="text" size="md" onPress={() => setLimit((n) => n + PAGE)} /> : null}
            </View>
          </Block>
        </>
      }
    />
  );
}
