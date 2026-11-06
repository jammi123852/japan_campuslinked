import { useCourseName } from '@/data/useCourseName';
import { useTr } from '@/lib/translate';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, EmptyText, Gap, IconButton, Notice, Pill, Screen, T, TextField } from '@/components/ui';
import { periodKey } from '@/features/academic/academicLogic';
import { usePeriodLabel } from '@/features/academic/PeriodBar';
import { coursesForKeyword, parseKeywords, rankActivities } from '@/features/career/careerLogic';
import { deptKeyOf, SourceLine } from '@/features/official/SourceLine';
import { coursesForDept, deptCodeOf } from '@/features/official/courseLogic';
import { useOfficial } from '@/features/official/useOfficial';
import { CertFinder } from '@/features/career/CertFinder';
import { useI18n } from '@/i18n';
import { saveCareer, useCareer } from '@/services/careerRepository';
import { addChecklistItem } from '@/services/checklistRepository';
import { usePeriod } from '@/services/periodRepository';
import { savePlannerSettings, usePlannerSettings } from '@/services/plannerRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 진로 탐색. 직업별 공식 필수 자격은 근거가 없어 만들지 않고, 학교 자료에서 찾은 것만 모은다. 주소: /career */
export default function CareerScreen() {
  const { session, profile } = useApp();
  const { t } = useI18n();
  const tr = useTr();
  const cn = useCourseName();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const label = usePeriodLabel();
  const planner = usePlannerSettings(session);
  const career = useCareer(session);
  const [jobs, setJobs] = useState('');
  const [interests, setInterests] = useState('');
  const [exp, setExp] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // 입력을 시작한 뒤에는 저장소 값으로 되돌리지 않는다 (저장·재읽기 사이에 글자가 사라지는 것 방지)
  const touched = useRef({ jobs: false, interests: false });
  useEffect(() => {
    if (!touched.current.jobs) setJobs(career.jobs);
  }, [career.jobs]);
  useEffect(() => {
    if (!touched.current.interests) setInterests(planner.interests);
  }, [planner.interests]);

  if (official.kind === 'loading' || !session) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />;

  const deptKey = deptKeyOf(profile?.facultyId, profile?.departmentId);
  const dept = od && deptKey ? od.departments[deptKey] : null;
  const keywords = parseKeywords(interests);
  const jobList = parseKeywords(jobs);
  const activities = od && deptKey ? rankActivities((od.activities ?? []).filter((a) => a.dept === deptKey), keywords) : [];
  const period = per.today?.period ?? per.period;

  const addToChecklist = async (title: string) => {
    if (!period) return false;
    const r = await addChecklistItem(session, { periodKey: periodKey(period), kind: 'career', ref: null, title });
    setMsg(r === 'added' ? t.checklist.added : t.checklist.exists);
    return true;
  };

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.career.lead} />
      {official.kind !== 'ok' ? <Notice tone="warning" text={official.kind === 'missing' ? t.official.missing : t.official.loadError} /> : null}
      {official.kind === 'ok' && !deptKey ? <Notice tone="warning" text={t.career.noDept} /> : null}

      <Block testID="career-jobs">
        <BlockHeader title={t.career.jobs} />
        <TextField testID="career-jobs-input" label={t.career.jobs} value={jobs} onChangeText={(v) => {
            touched.current.jobs = true;
            setJobs(v);
            saveCareer(session, { ...career, jobs: v });
          }} placeholder={t.career.jobsPh} />
        {jobList.map((j) => (
          <T key={j} variant="sub" tone="secondary" testID="career-job-evidence" style={{ paddingVertical: 2 }}>
            {t.career.jobsEvidence(j)}
          </T>
        ))}
        {jobList.length ? (
          <T variant="caption" tone="tertiary">
            {t.career.jobsEvidenceNote}
          </T>
        ) : null}
        <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
          {t.career.device}
        </T>
      </Block>
      <Gap />
      <CertFinder period={period} initialJob={jobList[0] ?? ''} />
      <Gap />

      {dept?.intro ? (
        <>
          <Block testID="career-quals">
            <BlockHeader title={t.career.qualTitle} />
            <Notice tone="warning" text={t.career.qualNote} />
            <View style={styles.pills}>
              {dept.intro.qualifications.map((q) => (
                <Pill key={q} text={tr(q)} />
              ))}
            </View>
            {od ? <SourceLine data={od} id={dept.intro.source.id} /> : null}
          </Block>
          <Gap />
        </>
      ) : null}

      <Block testID="career-courses">
        <BlockHeader title={t.career.coursesTitle} />
        <TextField
          testID="career-keywords"
          label={t.career.keywords}
          value={interests}
          onChangeText={(v) => {
            touched.current.interests = true;
            setInterests(v);
            savePlannerSettings(session, { ...planner, interests: v });
          }}
          placeholder={t.career.keywordsPh}
        />
        <T variant="caption" tone="tertiary">
          {t.career.keywordsNote}
        </T>
        {keywords.length === 0 ? <EmptyText text={t.career.coursesNone} /> : null}
        {od && deptKey
          ? keywords.map((k) => {
              const hits = coursesForKeyword(coursesForDept(od.courses, deptCodeOf(profile?.facultyId, profile?.departmentId)), k);
              return (
                <View key={k} style={styles.line} testID="career-keyword-result">
                  {hits.length === 0 ? (
                    <T variant="sub" tone="secondary">
                      {t.career.coursesNoHit(k)}
                    </T>
                  ) : (
                    <>
                      {hits.map((c) => (
                        <Button key={c.id} label={cn(c.name)} variant="text" size="md" onPress={() => router.push({ pathname: '/course', params: { id: c.id } })} />
                      ))}
                      <Button label={t.career.searchMore(k)} variant="tertiary" size="md" icon="search-outline" onPress={() => router.push({ pathname: '/search', params: { mode: 'official', q: k } })} />
                    </>
                  )}
                </View>
              );
            })
          : null}
      </Block>
      <Gap />

      {deptKey ? (
        <>
          <Block testID="career-activities">
            <BlockHeader title={t.career.activitiesTitle} />
            <T variant="caption" tone="tertiary">
              {t.career.activitiesNote}
            </T>
            {activities.length === 0 ? <EmptyText text={t.official.noResult} /> : null}
            {activities.map(({ activity: a, hits }) => (
              <View key={a.id} style={styles.line} testID={`career-activity-${a.id}`}>
                <T variant="caption" tone="tertiary">
                  {tr(a.kind)}
                </T>
                <T variant="body" style={{ fontWeight: '600' }}>
                  {tr(a.name)}
                </T>
                <T variant="sub" tone="secondary">
                  {tr(a.text)}
                </T>
                {hits.length ? (
                  <T variant="caption" tone="accent">
                    {t.career.activityHit(hits.join(', '))}
                  </T>
                ) : null}
                <T variant="caption" tone="tertiary">
                  {t.career.activityUnknown(a.unknown.join(', '))}
                </T>
                {od ? <SourceLine data={od} id={a.source.id} /> : null}
                {period ? <Button testID={`career-add-${a.id}`} label={t.checklist.addToList} variant="tertiary" size="md" icon="checkbox-outline" onPress={() => addToChecklist(a.name)} /> : null}
              </View>
            ))}
          </Block>
          <Gap />
        </>
      ) : null}

      <Block testID="career-exp">
        <BlockHeader title={t.career.expTitle} />
        {career.experiences.length === 0 ? <EmptyText text={t.career.expNone} /> : null}
        {career.experiences.map((e) => (
          <View key={e.id} style={styles.expRow}>
            <T variant="sub" style={{ flex: 1 }}>
              {tr(e.text)}
            </T>
            <IconButton icon="trash-outline" label={t.career.expDelete} onPress={() => saveCareer(session, { ...career, experiences: career.experiences.filter((x) => x.id !== e.id) })} />
          </View>
        ))}
        <TextField testID="career-exp-input" label={t.career.expAdd} value={exp} onChangeText={setExp} placeholder={t.career.expPh} maxLength={120} />
        <Button
          testID="career-exp-add"
          label={t.career.expAdd}
          variant="secondary"
          size="md"
          icon="add"
          disabled={!exp.trim()}
          onPress={() => {
            const now = new Date().toISOString();
            saveCareer(session, { ...career, experiences: [...career.experiences, { id: `exp-${Date.now().toString(36)}`, text: exp.trim(), createdAt: now }] });
            setExp('');
          }}
        />
      </Block>
      <Gap />

      <Block testID="career-next">
        <BlockHeader title={t.career.nextTitle} />
        {period ? (
          <T variant="caption" tone="tertiary" style={{ marginBottom: space.xs }}>
            {t.career.nextPeriod(label(period))}
          </T>
        ) : (
          <EmptyText text={t.period.unset} />
        )}
        <TextField testID="career-next-input" label={t.career.nextTitle} value={next} onChangeText={setNext} placeholder={t.career.nextPh} maxLength={80} />
        <Button
          testID="career-next-add"
          label={t.checklist.addToList}
          variant="secondary"
          size="md"
          icon="checkbox-outline"
          disabled={!period || !next.trim()}
          onPress={async () => {
            if (await addToChecklist(next.trim())) setNext('');
          }}
        />
        {msg ? (
          <>
            <Gap size={space.sm} />
            <Notice text={msg} />
          </>
        ) : null}
        <Gap size={space.sm} />
        <Button label={t.checklist.open} variant="text" size="md" onPress={() => router.push('/checklist')} />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
  line: { paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.divider },
  expRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
});
