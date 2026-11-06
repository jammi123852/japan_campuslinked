import { useCourseName } from '@/data/useCourseName';
import { officialText } from '@/lib/officialText';
import { useTr } from '@/lib/translate';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, Screen, T } from '@/components/ui';
import { deptKeyOf, SourceLine } from '@/features/official/SourceLine';
import type { CategoryId } from '@/features/official/types';
import { orgLabel } from '@/data/faculties';
import { categoryLabel, ruleLabel } from '@/features/official/courseLogic';
import { pickRule } from '@/features/records/gradLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

/** 학과·코스 안내. 공식 소개(홍보)와 이수 규정을 나눠 보여 준다. 주소: /department */
export default function DepartmentScreen() {
  const { profile } = useApp();
  const { t, locale } = useI18n();
  const tr = useTr();
  const cn = useCourseName();
  const official = useOfficial();
  const [year, setYear] = useState<number | null>(profile?.admissionYear ?? null);

  if (official.kind === 'loading') return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />;
  if (official.kind !== 'ok') {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="warning" text={official.kind === 'missing' ? t.official.missing : t.official.loadError} />
      </Screen>
    );
  }
  const data = official.data;
  const mine = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const key = mine && data.departments[mine] ? mine : 'rikou/joho-kagaku';
  const d = data.departments[key];
  const picked = pickRule(d.rules, year, year === profile?.admissionYear ? profile?.courseName : null);
  const rule = picked?.rule;

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.dept.supported} />
      <T variant="display" header testID="dept-title">
        {orgLabel(d.faculty, locale)} {orgLabel(d.department, locale)}
      </T>
      {!deptKeyOf(profile?.facultyId, profile?.departmentId) ? (
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
          ({t.dept.mine}: {profile?.facultyId ?? '-'} / {profile?.departmentId ?? '-'} — {t.dept.supported})
        </T>
      ) : null}
      <Gap size={space.md} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
        {d.pageUrl ? <Button testID="dept-page" label={t.dept.openOfficialPage} variant="tertiary" size="md" icon="open-outline" onPress={() => Linking.openURL(d.pageUrl!)} /> : null}
        <Button testID="dept-courses" label={t.dept.courseList} variant="tertiary" size="md" icon="search" onPress={() => router.push({ pathname: '/search', params: { mode: 'official' } })} />
      </View>
      {d.closedNote ? <Notice tone="warning" text={t.dept.closed(tr(d.closedNote))} /> : null}

      {d.intro ? (
        <>
          <Block>
            <BlockHeader title={t.dept.courses} />
            <Notice tone="warning" text={t.dept.promoNote} />
            {d.courses.map((c) => (
              <View key={c.id} style={{ paddingVertical: space.sm }}>
                <T variant="headline">{tr(c.ja)}</T>
                <T variant="sub" tone="secondary">
                  {tr(d.intro!.courses[c.id])}
                </T>
              </View>
            ))}
            {d.programs?.map((p) => (
              <T key={p} variant="caption" tone="tertiary">
                {t.dept.programs}: {tr(p)}
              </T>
            ))}
            <SourceLine data={data} id="P077" />
          </Block>
          <Gap />
          <Block>
            <BlockHeader title={t.dept.flow} />
            {Object.entries(d.intro.flow).map(([y, text]) => (
              <Row key={y} title={t.common.grade(Number(y))} subtitle={tr(text)} />
            ))}
            <T variant="caption" tone="tertiary">
              {tr(d.intro.note)}
            </T>
          </Block>
          <Gap />
        </>
      ) : null}

      {d.curriculum.length ? (
      <Block>
        <BlockHeader title={t.dept.curriculum} />
        <T variant="caption" tone="tertiary" style={{ marginBottom: space.sm }}>
          {t.dept.curriculumNote}
        </T>
        {d.curriculum.map((a) => (
          <View key={a.area} style={{ paddingVertical: space.sm }} testID={`curr-${a.area}`}>
            <T variant="headline">{tr(a.area)}</T>
            {Object.entries(a.years).map(([y, names]) => (
              <View key={y} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.xs }}>
                <Pill text={t.common.grade(Number(y))} />
                <View style={{ width: space.sm }} />
                {names.map((n) => (
                  <Chip key={n} label={cn(n)} onPress={() => router.push({ pathname: '/search', params: { mode: 'official', q: n.split('・')[0].replace(/[ⅠⅡⅢⅣ]$/, '') } })} />
                ))}
              </View>
            ))}
          </View>
        ))}
        <SourceLine data={data} id={d.curriculumSource.id} page={d.curriculumSource.page} />
      </Block>
      ) : null}
      <Gap />

      {d.courseSelection ? (
        <>
          <Block>
            <BlockHeader title={t.dept.selection} />
            <T variant="body" style={{ marginBottom: space.sm }}>
              {tr(d.courseSelection.text)}
            </T>
            <T variant="sub" tone="secondary">
              {t.dept.unknownLabel}: {d.courseSelection.unknown.join(', ')}
            </T>
            <SourceLine data={data} id={d.courseSelection.source.id} page={d.courseSelection.source.page} />
          </Block>
          <Gap />
        </>
      ) : null}

      <Block>
        <BlockHeader title={t.dept.rules} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm }}>
          {[2023, 2024, 2025, 2026].map((y) => (
            <Chip key={y} testID={`dept-year-${y}`} label={`${y} (${String(y % 100)}R)`} selected={year === y} onPress={() => setYear(y)} />
          ))}
        </View>
        {!rule ? (
          <EmptyText text={t.dept.rulesNone} />
        ) : (
          <View testID="dept-rule">
            {rule.partial ? <Notice tone="warning" text={t.grad.partial} /> : null}
            {(Object.entries(rule.categories) as [CategoryId, { min: number; exact?: boolean }][]).map(([id, c]) => (
              <Row key={id} title={categoryLabel(id, rule, t.records.categories, locale)} right={<T variant="body" tone="secondary">{t.dept.min(c.min, !!c.exact)}</T>} />
            ))}
            {(rule.pools ?? []).map((p) => (
              <Row key={p.id} title={ruleLabel(p.label, locale)} right={<T variant="body" tone="secondary">{t.dept.min(p.min, false)}</T>} />
            ))}
            {rule.flex ? <Row title={t.grad.flex} subtitle={t.dept.flexLine(rule.flex.min)} /> : null}
            <Row title={t.grad.total} right={<T variant="headline">{t.dept.total(rule.total)}</T>} />
            {rule.promotion3 ? <Row title={t.grad.promotion} subtitle={t.grad.promotionLine(rule.promotion3.credits, rule.promotion3.courses.map(cn).join('·'), officialText(rule.promotion3.scope, locale))} /> : null}
            {rule.thesisStart ? <Row title={t.grad.thesis} subtitle={t.grad.thesisLine(0, rule.thesisStart.credits, rule.thesisStart.courses.map(cn).join('·')).replace(/\s*\(.*?\)/, '')} /> : null}
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
              {officialText(rule.appliesNote, locale, '')}
            </T>
            <SourceLine data={data} id={rule.source.id} page={rule.source.page} />
          </View>
        )}
        <Button label={t.grad.open} variant="text" size="md" icon="school-outline" onPress={() => router.push('/graduation')} />
      </Block>
      <Gap />

      {d.intro ? (
        <>
          <Block>
            <BlockHeader title={t.dept.qualifications} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {d.intro.qualifications.map((q) => (
                <Chip key={q} label={tr(q)} />
              ))}
            </View>
            <T variant="caption" tone="tertiary">
              {t.dept.qualificationsNote}
            </T>
            <SourceLine data={data} id="P077" />
          </Block>
          <Gap />
        </>
      ) : null}

      <Block flush>
        <View style={{ paddingHorizontal: gutter, paddingTop: space.md }}>
          <BlockHeader title={t.dept.otherTitle} />
        </View>
        <View style={{ paddingHorizontal: gutter, paddingBottom: space.sm }}>
          {data.departmentIndex
            .filter((x) => x.id !== 'P077')
            .map((x) => (
              <Row
                key={x.id}
                title={cn(x.name)}
                numberOfLines={2}
                chevron
                onPress={() => Linking.openURL(x.url)}
                subtitle={[x.courses ? x.courses.map((n) => tr(n)).join(' / ') : t.dept.coursesUnknown, x.closedNote ? t.dept.closed(tr(x.closedNote)) : ''].filter(Boolean).join(' · ')}
              />
            ))}
        </View>
      </Block>
    </Screen>
  );
}
