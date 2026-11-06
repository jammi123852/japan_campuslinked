import { router } from 'expo-router';
import { useTr } from '@/lib/translate';
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, EmptyText, Gap, Notice, Pill, Screen, Segmented, T } from '@/components/ui';
import { periodKey } from '@/features/academic/academicLogic';
import { SourceLine } from '@/features/official/SourceLine';
import type { ScholarshipAnswerKey } from '@/features/official/types';
import { useOfficial } from '@/features/official/useOfficial';
import { eligibility, isClosed, type Answers } from '@/features/scholarship/scholarshipLogic';
import { useI18n } from '@/i18n';
import { academicNow } from '@/lib/dates';
import { saveScholarshipAnswers, useScholarshipAnswers } from '@/services/careerRepository';
import { addChecklistItem } from '@/services/checklistRepository';
import { usePeriod } from '@/services/periodRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

const QUESTIONS: ScholarshipAnswerKey[] = ['undergrad', 'international', 'gradEntrant', 'support'];
type Choice = 'yes' | 'no' | 'unknown';
const toChoice = (v: boolean | null | undefined): Choice => (v == null ? 'unknown' : v ? 'yes' : 'no');
const fromChoice = (c: Choice): boolean | null => (c === 'unknown' ? null : c === 'yes');

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.sm }}>
      <T variant="caption" tone="tertiary" style={{ fontWeight: '700' }}>
        {label}
      </T>
      {children}
    </View>
  );
}

/** 장학금 공지. 입력한 답변만으로 대상 후보를 나누며, 모르면 추가 확인 필요. 주소: /scholarship */
export default function ScholarshipScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const tr = useTr();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const answers = useScholarshipAnswers(session);
  const [msg, setMsg] = useState<{ id: string; text: string } | null>(null);

  if (official.kind === 'loading' || !session) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} />;
  if (official.kind !== 'ok' || !od) {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="warning" text={official.kind === 'missing' ? t.official.missing : t.official.loadError} />
      </Screen>
    );
  }

  const now = academicNow();
  const list = od.scholarships ?? [];
  const answer = (k: ScholarshipAnswerKey, c: Choice) => {
    const next: Answers = { ...answers, [k]: fromChoice(c) };
    saveScholarshipAnswers(session, next);
  };

  return (
    <Screen layout="reading" edges={['bottom']}>
      <Notice text={t.scholarship.lead} />
      <T variant="caption" tone="tertiary" style={{ marginBottom: space.md }}>
        {t.scholarship.scope}
      </T>

      <Block testID="scholarship-questions">
        <BlockHeader title={t.scholarship.qTitle} />
        <T variant="caption" tone="tertiary">
          {t.scholarship.qNote}
        </T>
        {QUESTIONS.map((k) => (
          <View key={k} style={{ marginTop: space.md }}>
            <T variant="sub" style={{ marginBottom: space.xs }}>
              {t.scholarship.q[k]}
            </T>
            <Segmented
              label={t.scholarship.q[k]}
              testIDPrefix={`sch-q-${k}`}
              value={toChoice(answers[k])}
              onChange={(c: Choice) => answer(k, c)}
              options={[
                { value: 'yes', label: t.scholarship.yes },
                { value: 'no', label: t.scholarship.no },
                { value: 'unknown', label: t.scholarship.unknown },
              ]}
            />
          </View>
        ))}
        <T variant="caption" tone="tertiary" style={{ marginTop: space.sm }}>
          {t.scholarship.device}
        </T>
      </Block>

      {list.length === 0 ? <EmptyText text={t.official.noResult} /> : null}
      {list.map((s) => {
        const closed = isClosed(s, now.date, now.minutes);
        const e = eligibility(s, answers);
        const url = od.sources[s.source.id]?.url;
        return (
          <View key={s.id}>
            <Gap />
            <Block testID={`scholarship-${s.id}`}>
              <View style={styles.pills}>
                <Pill text={closed ? t.scholarship.closed : t.scholarship.open_} tone={closed ? 'neutral' : 'success'} />
                <Pill text={t.scholarship.verdict[e.verdict]} tone={e.verdict === 'candidate' ? 'accent' : e.verdict === 'not' ? 'danger' : 'warning'} />
                <Pill text={s.provider} />
              </View>
              <T variant="headline" style={{ marginTop: space.sm }}>
                {tr(s.title)}
              </T>
              <T variant="sub" tone="secondary" style={{ marginTop: space.xs }}>
                {tr(s.summary)}
              </T>
              {closed ? (
                <>
                  <Gap size={space.sm} />
                  <Notice tone="warning" text={t.scholarship.closedNote} />
                </>
              ) : null}
              {e.unmet.length ? (
                <T variant="caption" tone="danger" style={{ marginTop: space.sm }}>
                  {t.scholarship.unmetList(e.unmet.map((k) => t.scholarship.q[k]).join(' / '))}
                </T>
              ) : null}
              {e.unknown.length ? (
                <T variant="caption" tone="secondary" style={{ marginTop: space.sm }}>
                  {t.scholarship.unknownList(e.unknown.map((k) => t.scholarship.q[k]).join(' / '))}
                </T>
              ) : null}
              <Section label={s.conditionsRule === 'all' ? t.scholarship.conditionsAll : t.scholarship.conditions}>
                {s.conditions.map((c, i) => (
                  <T key={c} variant="sub" style={{ paddingVertical: 2 }}>
                    {tr(c)}
                    {s.judgedBySchool.includes(i) ? ` [${t.scholarship.judgedBySchool}]` : ''}
                  </T>
                ))}
                {s.judgedBySchool.length ? (
                  <T variant="caption" tone="tertiary">
                    {t.scholarship.judgedNote}
                  </T>
                ) : null}
              </Section>
              <Section label={t.scholarship.documents}>
                {s.documents.map((d) => (
                  <T key={d} variant="sub" style={{ paddingVertical: 2 }}>
                    • {tr(d)}
                  </T>
                ))}
              </Section>
              <Section label={t.scholarship.method}>
                <T variant="sub">{tr(s.method)}</T>
              </Section>
              <Section label={t.scholarship.deadline}>
                <T variant="sub">{tr(s.deadlineText)}</T>
              </Section>
              {s.events.length ? (
                <Section label={t.scholarship.events}>
                  {s.events.map((ev) => (
                    <T key={ev.date} variant="sub" style={{ paddingVertical: 2 }}>
                      {ev.date} {ev.time} {tr(ev.place)} ({tr(ev.note)})
                    </T>
                  ))}
                </Section>
              ) : null}
              <Section label={t.scholarship.contact}>
                <T variant="sub">{tr(s.contact)}</T>
              </Section>
              <SourceLine data={od} id={s.source.id} />
              <Gap size={space.sm} />
              {url ? <Button testID={`sch-open-${s.id}`} label={t.scholarship.sourceOpen} variant="text" size="md" icon="open-outline" onPress={() => Linking.openURL(url)} /> : null}
              {per.period ? (
                <Button
                  testID={`sch-add-${s.id}`}
                  label={t.checklist.addToList}
                  variant="tertiary"
                  size="md"
                  icon="checkbox-outline"
                  onPress={async () => {
                    const r = await addChecklistItem(session, { periodKey: periodKey(per.period!), kind: 'scholarship', ref: s.id, title: s.title });
                    setMsg({ id: s.id, text: r === 'added' ? t.checklist.added : t.checklist.exists });
                  }}
                />
              ) : null}
              {msg?.id === s.id ? (
                <>
                  <Gap size={space.sm} />
                  <Notice text={msg.text} />
                </>
              ) : null}
            </Block>
          </View>
        );
      })}
      <Gap />
      <Button label={t.checklist.open} variant="secondary" size="md" icon="checkbox-outline" onPress={() => router.push('/checklist')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
});
