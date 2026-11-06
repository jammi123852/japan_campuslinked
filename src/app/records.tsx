import { useCourseName } from '@/data/useCourseName';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, Screen, T, TextField } from '@/components/ui';
import { entryInPeriod } from '@/features/academic/academicLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { deptKeyOf } from '@/features/official/SourceLine';
import { categoryLabel, officialCourseById, suggestCategory } from '@/features/official/courseLogic';
import type { GradRule } from '@/features/official/types';
import { pickRule } from '@/features/records/gradLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { applyGrade, computeGpa, countedRecords, GRADES, RECORD_STATUSES, type CourseRecord, type RecordCategory, type RecordStatus } from '@/features/records/gradLogic';
import { useI18n } from '@/i18n';
import { confirmDestructive } from '@/lib/confirm';
import { deleteRecord, newRecordId, upsertRecord, upsertRecords, useRecords } from '@/services/recordsRepository';
import { usePeriod } from '@/services/periodRepository';
import { loadEditableTimetable } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, radius, space } from '@/theme/tokens';

const CATEGORIES: RecordCategory[] = ['senmon_required', 'senmon_elective', 'intro', 'kiso_other', 'english', 'foreign_other', 'unknown', 'outside'];

/** 이 학생 규칙의 영역 + 공통 영역. 규칙이 없으면 기본 목록 */
function categoryChoices(rule: GradRule | null | undefined): RecordCategory[] {
  if (!rule) return CATEGORIES;
  const hasPools = (rule.pools ?? []).length > 0;
  return [...Object.keys(rule.categories), ...(hasPools ? ['senmon_other', 'foreign_other'] : []), 'unknown', 'outside'] as RecordCategory[];
}
const STATUS_TONE: Record<RecordStatus, 'neutral' | 'accent' | 'success' | 'danger' | 'warning'> = {
  planned: 'neutral',
  enrolled: 'accent',
  passed: 'success',
  failed: 'danger',
  withdrawn: 'neutral',
  review: 'warning',
};

function HScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter, marginBottom: space.md }} contentContainerStyle={{ paddingHorizontal: gutter }}>
      {children}
    </ScrollView>
  );
}

/** 한 기록 편집 (상태·학점·영역). 이수 완료는 사용자가 확인 버튼으로만 바꾼다 */
function RecordEditor({ r, onDone, rule }: { r: CourseRecord; onDone: () => void; rule: GradRule | null | undefined }) {
  const { session } = useApp();
  const { t, locale } = useI18n();
  const [name, setName] = useState(r.name);
  const [credits, setCredits] = useState(r.credits == null ? '' : String(r.credits));
  const [category, setCategory] = useState<RecordCategory>(r.category);
  const [status, setStatus] = useState<RecordStatus>(r.status);
  const [err, setErr] = useState<string | null>(null);
  const save = async (passed?: boolean) => {
    if (!session) return;
    if (!name.trim()) return setErr(t.records.errName);
    const c = credits.trim() === '' ? null : Number(credits);
    if (c != null && (!Number.isFinite(c) || c < 0 || c > 20)) return setErr(t.records.errCredits);
    const now = new Date().toISOString();
    const nextStatus = passed ? 'passed' : status;
    await upsertRecord(session, {
      ...r,
      name: name.trim(),
      credits: c,
      category,
      status: nextStatus,
      // '이수 완료'는 확인 버튼을 눌렀을 때만 확인 시각을 남긴다. 다른 상태로 바꾸면 확인 시각을 지운다
      confirmedAt: passed ? now : nextStatus === 'passed' ? r.confirmedAt : null,
      updatedAt: now,
    });
    onDone();
  };
  return (
    <View style={{ paddingVertical: space.md }} testID={`record-editor-${r.id}`}>
      {err ? <Notice tone="danger" text={err} /> : null}
      {r.suggestedCategory && category === 'unknown' ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice text={t.records.suggested(categoryLabel(r.suggestedCategory, rule, t.records.categories, locale))} />
          <Button testID="rec-apply-suggest" label={t.records.applySuggested} variant="tertiary" size="md" onPress={() => setCategory(r.suggestedCategory as RecordCategory)} />
        </View>
      ) : null}
      <TextField testID="rec-name" label={t.records.name} value={name} onChangeText={setName} maxLength={80} />
      <TextField testID="rec-credits" label={t.records.credits} value={credits} onChangeText={setCredits} keyboardType="numeric" maxLength={4} placeholder={t.records.creditsUnknown} />
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.xs }}>
        {t.records.category}
      </T>
      <HScroll>
        {categoryChoices(rule).map((c) => (
          <Chip key={c} testID={`rec-cat-${c}`} label={categoryLabel(c, rule, t.records.categories, locale)} selected={category === c} onPress={() => setCategory(c)} />
        ))}
      </HScroll>
      <T variant="caption" tone="tertiary" style={{ marginTop: -space.sm, marginBottom: space.md }}>
        {t.records.categoryHint}
      </T>
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.xs }}>
        {t.records.status}
      </T>
      <HScroll>
        {RECORD_STATUSES.filter((s) => s !== 'passed' || r.status === 'passed').map((s) => (
          <Chip key={s} testID={`rec-status-${s}`} label={t.records.statuses[s]} selected={status === s} onPress={() => setStatus(s)} />
        ))}
      </HScroll>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button testID="rec-save" label={t.records.save} size="md" onPress={() => save()} />
        {r.status !== 'passed' ? <Button testID="rec-confirm-passed" label={t.records.confirmPassed} icon="checkmark-circle-outline" variant="secondary" size="md" onPress={() => save(true)} /> : null}
        <Button label={t.records.close} variant="text" size="md" onPress={onDone} />
        <Button
          testID="rec-delete"
          label={t.records.delete}
          variant="dangerText"
          size="md"
          onPress={() =>
            confirmDestructive(t.records.deleteConfirmTitle, t.records.deleteConfirmBody(r.name), { ok: t.common.ok, cancel: t.common.cancel }, async () => {
              if (session) await deleteRecord(session, r.id);
              onDone();
            })
          }
        />
      </View>
    </View>
  );
}

/** 학기별 수강·이수 기록. 주소: /records */
export default function RecordsScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const official = useOfficial();
  const { profile } = useApp();
  const { locale } = useI18n();
  const cn = useCourseName();
  const odRules = official.kind === 'ok' ? official.data : null;
  const dk = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const rulePicked = pickRule(odRules && dk ? odRules.departments[dk]?.rules : undefined, profile?.admissionYear, profile?.courseName);
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const label = usePeriodLabel();
  const { records } = useRecords(session);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const dupes = countedRecords(records, 'actual').duplicates;
  const gpa = computeGpa(records);

  const importFromTimetable = async () => {
    if (!session || !per.period) return;
    const { entries } = await loadEditableTimetable(session, t);
    const inPeriod = entries.filter((e) => entryInPeriod(e, per.period!) === 'yes');
    const seen = new Set<string>();
    const now = new Date().toISOString();
    const isNow = per.today && per.today.period.year === per.period.year && per.today.period.quarter === per.period.quarter;
    const add: CourseRecord[] = [];
    for (const e of inPeriod) {
      const k = e.lectureId ?? `${e.courseName}`;
      if (seen.has(k)) continue; // 여러 요일·교시 수업은 기록 하나
      seen.add(k);
      if (records.some((r) => (e.lectureId ? r.officialId === e.lectureId : r.name === e.courseName && r.year === per.period!.year))) continue;
      const oc = od ? officialCourseById(od, e.lectureId) : undefined;
      add.push({
        id: newRecordId(),
        year: e.term?.year ?? per.period.year,
        quarters: e.term?.quarters ?? [per.period.quarter],
        name: e.courseName,
        code: oc?.code ?? oc?.syllabus?.code ?? null,
        section: oc?.section ?? null,
        credits: oc?.credits || oc?.syllabus?.credits || null,
        category: 'unknown',
        suggestedCategory: oc ? suggestCategory(oc, rulePicked?.rule) : null,
        status: isNow ? 'enrolled' : 'planned',
        confirmedAt: null,
        officialId: e.lectureId ?? null,
        note: '',
        createdAt: now,
        updatedAt: now,
      });
    }
    if (add.length) await upsertRecords(session, add);
    setMsg(add.length ? t.records.importDone(add.length) : t.records.importNone);
  };

  const addManual = async () => {
    if (!session) return;
    const now = new Date().toISOString();
    const r: CourseRecord = {
      id: newRecordId(),
      year: per.period?.year ?? null,
      quarters: per.period ? [per.period.quarter] : [],
      name: t.records.name,
      code: null,
      section: null,
      credits: null,
      category: 'unknown',
      status: 'planned',
      confirmedAt: null,
      officialId: null,
      note: '',
      createdAt: now,
      updatedAt: now,
    };
    await upsertRecord(session, r);
    setEditing(r.id);
  };

  const groups = new Map<string, CourseRecord[]>();
  for (const r of [...records].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name))) {
    const k = r.year ? `${r.year} ${r.quarters.join('·')}` : '-';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.records.lead} />
      {gpa.gpa != null ? (
        <Block testID="rec-gpa">
          <T variant="sub" tone="secondary">{t.records.gpaTitle}</T>
          <T variant="display" header>{gpa.gpa.toFixed(2)}</T>
          <T variant="caption" tone="tertiary">{t.records.gpaBasis(gpa.courses, gpa.credits)}</T>
        </Block>
      ) : null}
      {gpa.gpa != null ? <Gap /> : null}
      <Block>
        {per.period ? (
          <Button testID="rec-import" label={t.records.importTimetable(label(per.period))} icon="download-outline" variant="secondary" onPress={importFromTimetable} />
        ) : (
          <EmptyText text={t.period.unset} />
        )}
        <Gap size={space.sm} />
        <Button testID="rec-add" label={t.records.add} icon="add" variant="tertiary" onPress={addManual} />
        {records.some((r) => r.category === 'unknown' && r.suggestedCategory) ? (
          <Button
            testID="rec-apply-all-suggest"
            label={t.records.applyAllSuggested(records.filter((r) => r.category === 'unknown' && r.suggestedCategory).length)}
            variant="tertiary"
            onPress={() => {
              if (session) upsertRecords(session, records.filter((r) => r.category === 'unknown' && r.suggestedCategory).map((r) => ({ ...r, category: r.suggestedCategory as RecordCategory, updatedAt: new Date().toISOString() })));
            }}
          />
        ) : null}
        {msg ? (
          <>
            <Gap size={space.sm} />
            <Notice text={msg} />
          </>
        ) : null}
        <Button label={t.grad.open} variant="text" size="md" icon="school-outline" onPress={() => router.push('/graduation')} />
      </Block>
      {dupes.length ? (
        <>
          <Gap />
          <Notice tone="warning" text={t.records.duplicateWarn(dupes.join(', '))} />
        </>
      ) : null}
      <Gap />
      <T variant="caption" tone="secondary" style={{ marginBottom: space.sm }}>
        {t.records.endReview}
      </T>
      {records.length === 0 ? (
        <Block>
          <EmptyText text={t.records.empty} />
        </Block>
      ) : (
        [...groups.entries()].map(([g, list]) => (
          <View key={g}>
            <Block flush>
              <View style={{ paddingHorizontal: gutter, paddingTop: space.md }}>
                <BlockHeader title={g} />
              </View>
              <View style={{ paddingHorizontal: gutter, paddingBottom: space.sm }}>
                {list.map((r) =>
                  editing === r.id ? (
                    <RecordEditor key={r.id} rule={rulePicked?.rule} r={r} onDone={() => setEditing(null)} />
                  ) : (
                    <View key={r.id} testID={`record-wrap-${r.id}`}>
                    <Row
                      testID={`record-${r.id}`}
                      title={cn(r.name)}
                      numberOfLines={2}
                      chevron
                      onPress={() => setEditing(r.id)}
                      subtitle={
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs, alignItems: 'center' }}>
                          <Pill text={t.records.statuses[r.status]} tone={STATUS_TONE[r.status]} />
                          <Pill text={categoryLabel(r.category, rulePicked?.rule, t.records.categories, locale)} tone={r.category === 'unknown' ? 'warning' : 'neutral'} />
                          <T variant="sub" tone="tertiary">
                            {r.credits == null ? t.records.creditsUnknown : `${r.credits}${t.official.credits}`}
                          </T>
                          {r.officialId ? (
                            <T variant="caption" tone="tertiary">
                              {t.records.fromOfficial}
                            </T>
                          ) : null}
                        </View>
                      }
                    />
                    {/* 받은 성적: 여기서 바로 고른다 (S~C 이수 완료, D·E 불합격) */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingBottom: space.sm }} testID={`rec-grade-${r.id}`}>
                      <T variant="caption" tone="tertiary" style={{ marginRight: space.xs }}>{t.records.grade}</T>
                      {GRADES.map((g) => (
                        <Pressable
                          key={g}
                          testID={`rec-grade-${r.id}-${g}`}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: r.grade === g }}
                          accessibilityLabel={t.records.gradeLabel(g)}
                          onPress={() => session && upsertRecord(session, applyGrade(r, g, new Date().toISOString()))}
                          style={{ flex: 1, maxWidth: 44, height: 36, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', backgroundColor: r.grade === g ? colors.accent : colors.fill }}
                        >
                          <T variant="sub" style={{ fontWeight: '700', color: r.grade === g ? colors.surface : colors.textSecondary }}>{g}</T>
                        </Pressable>
                      ))}
                    </View>
                    {r.status === 'passed' && r.category === 'unknown' && r.suggestedCategory ? (
                      <Button
                        testID={`rec-apply-cat-${r.id}`}
                        label={t.records.applySuggestedTo(categoryLabel(r.suggestedCategory, rulePicked?.rule, t.records.categories, locale))}
                        variant="tertiary"
                        size="md"
                        onPress={() => session && upsertRecord(session, { ...r, category: r.suggestedCategory as RecordCategory, updatedAt: new Date().toISOString() })}
                      />
                    ) : null}
                    </View>
                  ),
                )}
              </View>
            </Block>
            <Gap />
          </View>
        ))
      )}
      <T variant="caption" tone="secondary">
        {t.records.device}
      </T>
    </Screen>
  );
}
