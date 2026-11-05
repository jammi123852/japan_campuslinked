import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Row, Screen, Segmented, T } from '@/components/ui';
import { seedShowcase, SHOWCASE_USER_ID } from '@/features/official/showcase';
import { loadOfficial } from '@/features/official/useOfficial';
import { findDepartment, findFaculty, interestLabel, orgLabel } from '@/data/faculties';
import { LOCALES, useI18n, type Locale } from '@/i18n';
import { checkHealth } from '@/lib/api';
import { useSaved } from '@/services/savedRepository';
import { useApp } from '@/state/AppContext';
import { space } from '@/theme/tokens';

/** 웹에서는 Alert.alert 버튼이 동작하지 않아 confirm 을 쓴다 */
function confirm(title: string, message: string, labels: { ok: string; cancel: string }, onOk: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n${message}`)) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: labels.cancel, style: 'cancel' },
    { text: labels.ok, style: 'destructive', onPress: onOk },
  ]);
}

export default function MyPageScreen() {
  const { session, profile, signOut, resetDemo, resetPersonal, setSession } = useApp();
  const { t, locale, setLocale } = useI18n();
  const saved = useSaved(session);
  // 공유 서버(이 PC) 연결 상태
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    checkHealth().then((ok) => alive && setServerOk(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (!profile || !session) return null;

  const faculty = findFaculty(profile.facultyId);
  const dept = findDepartment(profile.facultyId, profile.departmentId);
  const isDemo = session.mode === 'demo';
  const courseText =
    profile.courseStatus === 'selected'
      ? (profile.courseName ?? '-')
      : profile.courseStatus === 'none'
        ? t.profile.courseNone
        : t.profile.courseUndecided;

  return (
    <Screen layout="reading">
      <T variant="display" header style={{ marginTop: space.sm, marginBottom: space.xxl }}>
        {t.mypage.title}
      </T>

      {/* 프로필 요약 */}
      <Block>
        <T variant="title" testID="mypage-nickname">
          {profile.nickname}
        </T>
        <T variant="body" tone="secondary" style={{ marginTop: space.xs }}>
          {orgLabel(faculty?.name, locale)} {orgLabel(dept?.name, locale)}
        </T>
        <T variant="sub" tone="tertiary" style={{ marginTop: 2 }}>
          {t.common.admission(profile.admissionYear)}, {t.common.grade(profile.currentGrade)}
        </T>
        <T variant="sub" tone="tertiary">
          {t.profile.course}: {courseText}
        </T>
        <Gap size={space.lg} />
        <Button testID="edit-profile" label={t.mypage.edit} variant="tertiary" size="md" onPress={() => router.push('/profile-edit')} />
      </Block>

      <Gap />
      <Block>
        <BlockHeader title={t.mypage.enrolled} />
        {profile.enrolledCourses.length === 0 ? (
          <EmptyText text={t.mypage.enrolledEmpty} />
        ) : (
          <View style={styles.wrap}>
            {profile.enrolledCourses.map((c) => (
              <Chip key={c} label={c} />
            ))}
          </View>
        )}
        <Gap size={space.lg} />
        <BlockHeader title={t.mypage.interests} />
        {profile.interests.length === 0 ? (
          <EmptyText text={t.mypage.interestsEmpty} />
        ) : (
          <View style={styles.wrap}>
            {profile.interests.map((id) => (
              <Chip key={id} label={interestLabel(id, t.interests)} />
            ))}
          </View>
        )}
      </Block>

      <Gap />
      <Block>
        <BlockHeader title={t.mypage.language} />
        <Gap size={space.xs} />
        <Segmented<Locale> label={t.mypage.language} testIDPrefix="locale" value={locale} onChange={setLocale} options={LOCALES} />
      </Block>

      <Gap />
      <Block flush>
        <View style={styles.pad}>
          <BlockHeader title={t.mypage.upcoming} />
        </View>
        <View style={styles.listPad}>
          <Row
            testID="open-saved"
            title={t.mypage.bookmarks}
            subtitle={t.saved.count(saved.favorites.length, saved.later.length, saved.bookmarks.length)}
            chevron
            onPress={() => router.push('/saved')}
          />
          <Row testID="open-notification-settings" title={t.mypage.notifications} subtitle={t.mypage.notificationsHint} chevron onPress={() => router.push('/notification-settings')} />
        </View>
      </Block>

      <Gap />
      <Block flush testID="mypage-academic">
        <View style={styles.pad}>
          <BlockHeader title={t.mypage.academic} />
        </View>
        <View style={styles.listPad}>
          <Row testID="open-records" title={t.records.title} subtitle={t.mypage.recordsHint} chevron onPress={() => router.push('/records')} />
          <Row testID="open-graduation" title={t.grad.open} subtitle={t.mypage.gradHint} chevron onPress={() => router.push('/graduation')} />
          <Row testID="open-campus" title={t.campus.open} subtitle={t.campus.hint} chevron onPress={() => router.push('/campus')} />
          <Row testID="open-plan-builder" title={t.builder.open} subtitle={t.builder.openHint} chevron onPress={() => router.push('/plan-builder')} />
          <Row testID="open-planner" title={t.planner.open} subtitle={t.mypage.plannerHint} chevron onPress={() => router.push('/planner')} />
          <Row testID="open-checklist" title={t.checklist.open} subtitle={t.mypage.checklistHint} chevron onPress={() => router.push('/checklist')} />
          <Row testID="open-notice" title={t.noticeAi.open} subtitle={t.mypage.noticeHint} chevron onPress={() => router.push('/notice')} />
          <Row testID="open-department" title={t.dept.open} subtitle={t.mypage.deptHint} chevron onPress={() => router.push('/department')} />
          <Row testID="open-career" title={t.career.open} subtitle={t.mypage.careerHint} chevron onPress={() => router.push('/career')} />
          <Row testID="open-scholarship" title={t.scholarship.open} subtitle={t.mypage.scholarshipHint} chevron onPress={() => router.push('/scholarship')} />
        </View>
      </Block>

      <Gap />
      <Block flush>
        <View style={styles.pad}>
          <BlockHeader title={t.mypage.account} />
        </View>
        <View style={styles.listPad}>
          <Row title={t.mypage.loginMode} subtitle={isDemo ? (session.email ? t.schoolEntry.mode(session.email) : t.mypage.demoMode) : t.mypage.emailMode(session.email ?? '-')} />
          <Row title={t.mypage.server} subtitle={serverOk == null ? t.common.loading : serverOk ? t.mypage.serverOn : t.mypage.serverOff} />
        </View>
      </Block>

      {/* 되돌리기 어려운 동작은 다른 요소와 떨어뜨려 둔다 */}
      <Gap size={space.huge} />
      {session?.userId === SHOWCASE_USER_ID ? (
        <Button
          testID="reset-showcase"
          label={t.showcase.reset}
          variant="tertiary"
          onPress={async () => {
            const o = await loadOfficial();
            if (o.kind === 'ok') {
              await setSession(await seedShowcase(o.data));
              router.replace('/');
            }
          }}
        />
      ) : null}
      <Button testID="sign-out" label={t.mypage.signOut} variant="text" onPress={signOut} />
      {isDemo && (
        <>
          <Gap size={space.lg} />
          <Notice text={t.mypage.demoSignOutNote} />
          <Button
            testID="reset-demo"
            label={t.mypage.resetDemo}
            variant="dangerText"
            onPress={() => confirm(t.mypage.resetConfirmTitle, t.mypage.resetConfirmBody, { ok: t.common.ok, cancel: t.common.cancel }, resetDemo)}
          />
        </>
      )}
      {session.mode === 'personal' && session.userId !== SHOWCASE_USER_ID ? (
        <>
          <Gap size={space.lg} />
          <Button
            testID="reset-personal"
            label={t.mypage.resetPersonal}
            variant="dangerText"
            onPress={() => confirm(t.mypage.resetPersonal, t.mypage.resetPersonalBody, { ok: t.common.ok, cancel: t.common.cancel }, resetPersonal)}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  pad: { paddingHorizontal: 20, paddingTop: space.md },
  listPad: { paddingHorizontal: 20, paddingBottom: space.sm },
});
