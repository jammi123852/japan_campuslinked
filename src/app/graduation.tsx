import { officialText, weekdayPeriod } from '@/lib/officialText';
import { useCourseName } from '@/data/useCourseName';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, EmptyText, Gap, Notice, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { deptKeyOf, SourceLine } from '@/features/official/SourceLine';
import { categoryLabel, courseCohort, coursesForDept, deptCodeOf, ruleLabel, ruleVariantKeys } from '@/features/official/courseLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { computeProgress, pickRule, type Scenario } from '@/features/records/gradLogic';
import { orgShort } from '@/data/faculties';
import type { TimetableEntry } from '@/data/types';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { recommendForShort } from '@/features/planner/recommend';
import { useI18n } from '@/i18n';
import { usePeriod } from '@/services/periodRepository';
import { loadTimetable, useTimetableVersion } from '@/services/timetableRepository';
import { useRecords } from '@/services/recordsRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, radius, space } from '@/theme/tokens';

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={styles.track} accessibilityElementsHidden>
      <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
    </View>
  );
}

/** 졸업 준비: 검수한 규칙과 사용자가 확인한 이수 기록으로 프로그램이 계산한다. 주소: /graduation */
export default function GraduationScreen() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const official = useOfficial();
  const { records, loaded } = useRecords(session);
  const scenario: Scenario = 'actual';
  /** 위 버튼으로 나누는 보기: 전체 요건 / 남은 학점 / 채울 과목 */
  const [tab, setTab] = useState<'overview' | 'remaining' | 'courses'>('overview');
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const periodLabel = usePeriodLabel();
  const ttVersion = useTimetableVersion();
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  useEffect(() => {
    if (session) loadTimetable(session).then((x) => setTimetable(x ?? []));
  }, [session, ttVersion]);

  if (official.kind === 'loading' || !loaded) {
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />
      </Screen>
    );
  }
  const od = official.kind === 'ok' ? official.data : null;
  const deptKey = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const dept = od && deptKey ? od.departments[deptKey] : undefined;
  const picked = pickRule(dept?.rules, profile?.admissionYear, profile?.courseName);
  const variants = ruleVariantKeys(dept?.rules, profile?.admissionYear);
  const deptCode = deptCodeOf(profile?.facultyId, profile?.departmentId);
  const g = computeProgress(records, picked, scenario);
  // 지금 듣는 과목까지 모두 이수하면 남는 학점 (차이가 있을 때만 한 줄로 보여 준다)
  const withEnrolled = computeProgress(records, picked, 'current');
  const passedOrPlannedIds = new Set(records.filter((r) => r.status !== 'withdrawn' && r.status !== 'failed').map((r) => r.officialId));
  const passedNames = new Set(records.filter((r) => r.status !== 'withdrawn' && r.status !== 'failed').map((r) => r.name));
  const requiredMissing = od && dept
    ? [...new Map(coursesForDept(od.courses, deptCode).filter((c) => (c.depts ?? []).includes(deptCode ?? '') && c.mark === 'required' && courseCohort(c, profile?.admissionYear, deptCode) !== false && !passedOrPlannedIds.has(c.id) && !passedNames.has(c.name)).map((c) => [c.name, c])).values()]
    : [];

  const shortIds = g.categories.filter((c) => c.short > 0).map((c) => c.id as string).filter((id) => ['kiso_total', 'kiso_other', 'english', 'foreign_total', 'foreign_other'].includes(id));
  const reco =
    od && picked && per.period
      ? recommendForShort({ courses: coursesForDept(od.courses, deptCode), rule: picked.rule, shortCategories: shortIds, records, timetable, target: per.period, admissionYear: profile?.admissionYear ?? null, dept: deptCode, interests: profile?.interests ?? [] })
      : {};

  return (
    <Screen layout="reading" edges={['bottom']}>
      {official.kind !== 'ok' ? <Notice tone="warning" text={t.official.missing} /> : null}
      {picked && !g.noRule ? (
        <>
          <Segmented<'overview' | 'remaining' | 'courses'>
            label={t.grad.title}
            testIDPrefix="grad-tab"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: t.grad.tabs.overview },
              { value: 'remaining', label: t.grad.tabs.remaining },
              { value: 'courses', label: t.grad.tabs.courses },
            ]}
          />
          <Gap size={space.md} />
        </>
      ) : null}
      {/* 남은 학점: 아직 안 채운 것만 */}
      {tab === 'remaining' && picked && !g.noRule ? (
        <Block testID="grad-remaining">
          <T variant="sub" tone="secondary">
            {t.grad.remainingTitle}
          </T>
          <T variant="display" header style={{ marginTop: space.xs }}>
            {t.grad.remainingTotal(g.totalShort)}
          </T>
          {g.categories.filter((c) => c.short > 0).map((c) => (
            <T key={c.id} variant="body" tone="danger" style={{ marginTop: space.xs }}>
              {t.grad.remainingLine(categoryLabel(c.id, picked?.rule, t.records.categories, locale), c.short)}
            </T>
          ))}
          {g.flex && g.flex.short > 0 ? (
            <T variant="body" tone="danger" style={{ marginTop: space.xs }}>
              {t.grad.remainingLine(t.grad.flex.split(' (')[0], g.flex.short)}
            </T>
          ) : null}
          {withEnrolled.totalShort !== g.totalShort ? (
            <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
              {t.grad.remainingIfEnrolled(withEnrolled.totalShort)}
            </T>
          ) : null}
          {g.thesis && g.thesis.met === false && picked.rule.thesisStart ? (
            <Row title={t.grad.thesis} subtitle={t.grad.thesisLine(g.thesis.credits, g.thesis.need, picked.rule.thesisStart.courses.map(cn).join('·'))} right={<Pill text={t.grad.notMet} tone="danger" />} />
          ) : null}
        </Block>
      ) : null}

      {!profile?.admissionYear ? (
        <Notice tone="danger" text={t.grad.noProfileYear} />
      ) : !picked || !dept ? (
        <Block>
          <EmptyText text={t.grad.noRule} />
          <T variant="caption" tone="tertiary">
            {variants.length ? t.grad.pickVariant(variants.join(' / ')) : t.grad.noRuleDept}
          </T>
        </Block>
      ) : tab === 'overview' ? (
        <>
          <Block>
            <T variant="sub" tone="secondary">
              {t.grad.ruleFor(`${orgShort(dept.faculty, locale)} ${orgShort(dept.department, locale)}`, picked.key)}
            </T>
            <T variant="title" header testID="grad-verdict" style={{ marginTop: space.xs }}>
              {t.grad.verdicts[g.verdict]}
            </T>
            <T variant="headline" testID="grad-overview-total" style={{ marginTop: space.xs }}>
              {t.grad.tabs.filled(g.countedTotal, g.totalMin)}
            </T>
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
              {officialText(picked.rule.appliesNote, locale, '')}
            </T>
            {g.partialRule ? <Notice tone="warning" text={t.grad.partial} /> : null}
            <T variant="caption" tone="tertiary">
              {t.grad.verdictNote}
            </T>
            {od ? <SourceLine data={od} id={picked.rule.source.id} page={picked.rule.source.page} /> : null}
            {od && picked.rule.alsoSource ? <SourceLine data={od} id={picked.rule.alsoSource.id} page={picked.rule.alsoSource.page} /> : null}
          </Block>
          <Gap />
          <Block>
            {g.categories.map((c) => (
              <View key={c.id} style={{ paddingVertical: space.sm }} testID={`grad-cat-${c.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                  <T variant="body" style={{ flex: 1 }}>
                    {categoryLabel(c.id, picked?.rule, t.records.categories, locale)}
                    {c.exact ? ` (${t.grad.exact})` : ''}
                  </T>
                  <T variant="sub" tone={c.short > 0 ? 'danger' : 'secondary'} style={{ fontVariant: ['tabular-nums'] }}>
                    {t.grad.earned(c.earned, c.min)}
                  </T>
                </View>
                <Bar value={c.earned} max={c.min} />
                <T variant="caption" tone={c.short > 0 ? 'danger' : 'tertiary'}>
                  {c.short > 0 ? t.grad.short(c.short) : t.grad.ok}
                </T>
              </View>
            ))}
            {g.pools.map((p) => (
              <View key={p.id} style={{ paddingVertical: space.sm }} testID={`grad-pool-${p.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                  <T variant="body" style={{ flex: 1 }}>
                    {ruleLabel(p.label, locale)}
                  </T>
                  <T variant="sub" tone={p.short > 0 ? 'danger' : 'secondary'}>
                    {t.grad.earned(p.earned, p.min)}
                  </T>
                </View>
                <Bar value={p.earned} max={p.min} />
              </View>
            ))}
            {g.flex ? (
              <View style={{ paddingVertical: space.sm }} testID="grad-flex">
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                  <T variant="body" style={{ flex: 1 }}>
                    {t.grad.flex}
                  </T>
                  <T variant="sub" tone={g.flex.short > 0 ? 'danger' : 'secondary'}>
                    {t.grad.earned(g.flex.earned, g.flex.min)}
                  </T>
                </View>
                <Bar value={g.flex.earned} max={g.flex.min} />
              </View>
            ) : null}
            <View style={{ paddingVertical: space.sm }} testID="grad-total">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
                <T variant="headline" style={{ flex: 1 }}>
                  {t.grad.total}
                </T>
                <T variant="headline" tone={g.totalShort > 0 ? 'danger' : 'primary'}>
                  {t.grad.earned(g.countedTotal, g.totalMin)}
                </T>
              </View>
              <Bar value={g.countedTotal} max={g.totalMin} />
            </View>
            {g.unknownCredits > 0 ? <Notice tone="warning" text={t.grad.unknown(g.unknownCredits, g.unknownCourses.join(', '))} /> : null}
            {g.missingCreditCourses.length ? <Notice tone="warning" text={t.grad.missingCredits(g.missingCreditCourses.join(', '))} /> : null}
            {g.outsideCredits > 0 ? (
              <T variant="caption" tone="tertiary">
                {t.grad.outside(g.outsideCredits)}
              </T>
            ) : null}
            {g.duplicates.length ? <Notice tone="warning" text={t.records.duplicateWarn(g.duplicates.join(', '))} /> : null}
          </Block>
          <Gap />
          <Block>
            {g.thesis && picked.rule.thesisStart ? (
              <Row
                title={t.grad.thesis}
                subtitle={t.grad.thesisLine(g.thesis.credits, g.thesis.need, picked.rule.thesisStart.courses.map(cn).join('·'))}
                right={<Pill text={g.thesis.met === true ? t.grad.met : g.thesis.met === false ? t.grad.notMet : t.grad.undetermined} tone={g.thesis.met ? 'success' : g.thesis.met === false ? 'danger' : 'neutral'} />}
              />
            ) : null}
            {g.promotion3 && picked.rule.promotion3 ? (
              <Row
                title={t.grad.promotion}
                subtitle={`${t.grad.promotionLine(picked.rule.promotion3.credits, picked.rule.promotion3.courses.map(cn).join('·'), officialText(picked.rule.promotion3.scope, locale))} — ${t.grad.promotionUnknown}`}
                right={<Pill text={t.grad.undetermined} />}
              />
            ) : null}
            <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
              {dept.cap && t.grad.cap(dept.cap.yearly, dept.cap.half, dept.cap.yearlyHighGpa, dept.cap.highGpa)}
            </T>
            {od && dept.cap ? <SourceLine data={od} id={dept.cap.source.id} page={dept.cap.source.page} /> : null}
          </Block>
        </>
      ) : null}

      {tab === 'courses' && !shortIds.length && !requiredMissing.length ? (
        <Block>
          <EmptyText text={t.grad.tabs.coursesNone} />
        </Block>
      ) : null}
      {tab === 'courses' && shortIds.length && per.period ? (
        <>
          <Block testID="grad-reco">
            <BlockHeader title={t.grad.recoTitle} />
            <T variant="caption" tone="tertiary">{t.grad.recoPeriod(periodLabel(per.period))}</T>
            {shortIds.map((id) => (
              <View key={id} style={{ marginTop: space.md }} testID={`grad-reco-${id}`}>
                <T variant="sub" style={{ fontWeight: '700' }}>{categoryLabel(id, picked?.rule, t.records.categories, locale)}</T>
                {(reco[id] ?? []).length === 0 ? (
                  <EmptyText text={t.grad.recoNone} />
                ) : (
                  (reco[id] ?? []).map((r) => (
                    <Row
                      key={r.course.id}
                      testID={`grad-reco-course-${r.course.id}`}
                      title={`${cn(r.course.name)}${r.course.section ? ` [${r.course.section}]` : ''}`}
                      chevron
                      onPress={() => router.push({ pathname: '/course', params: { id: r.course.id } })}
                      subtitle={[r.course.instructor, weekdayPeriod(r.course.wp, locale), r.course.credits != null ? `${r.course.credits}${t.official.creditsUnit}` : '', r.conflicts.length ? t.grad.recoConflict(r.conflicts.join(', ')) : '', r.prereq ? t.grad.recoPrereq(r.prereq.slice(0, 40)) : ''].filter(Boolean).join(' · ')}
                    />
                  ))
                )}
              </View>
            ))}
            <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>{t.grad.recoNote}</T>
          </Block>
        </>
      ) : null}
      {tab === 'courses' && requiredMissing.length ? (
        <>
          <Gap />
          <Block flush>
            <View style={{ paddingHorizontal: gutter, paddingTop: space.md }}>
              <BlockHeader title={t.grad.requiredNotTaken} />
              <T variant="caption" tone="tertiary">
                {t.grad.requiredNote}
              </T>
            </View>
            <View style={{ paddingHorizontal: gutter, paddingBottom: space.sm }}>
              {requiredMissing.map((c) => (
                <Row key={c.id} title={cn(c.name)} subtitle={`${c.term ? t.period.terms[c.term] : ''} ${c.quarters.join('·')} · ${t.common.grade(c.year)}`} chevron onPress={() => router.push({ pathname: '/course', params: { id: c.id } })} />
              ))}
            </View>
          </Block>
        </>
      ) : null}
      <Gap />
      <Button testID="grad-to-records" label={t.grad.toRecords} variant="tertiary" onPress={() => router.push('/records')} />
      <Gap size={space.sm} />
      <Button testID="grad-to-planner" label={t.grad.toPlanner} variant="secondary" onPress={() => router.push('/planner')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.fill, marginVertical: space.xs, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.progress },
});
