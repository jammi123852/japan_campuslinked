import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Block, Button, Gap, Notice, Pill, Screen, Segmented, SourceBadge, T } from '@/components/ui';
import { LOCALES, useI18n, type Locale } from '@/i18n';
import { seedShowcase, useShowcase } from '@/features/official/showcase';
import { loadOfficial } from '@/features/official/useOfficial';
import { STATIC_DEMO } from '@/lib/demo/staticDemo';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useApp } from '@/state/AppContext';
import { colors, radius, space } from '@/theme/tokens';

/** 첫 화면에 보여 주는 실제 홈 구성 요소 미리보기 (누를 수 없음, 샘플 표시) */
function TodayPreview() {
  const { t } = useI18n();
  const [c1, c2] = t.sample.classes;
  const [r1, r2] = t.sample.rooms;
  const rows = [
    { period: 2, name: c1, room: r1, state: t.home.now, focus: true },
    { period: 4, name: c2, room: r2, state: null, focus: false },
  ];
  return (
    <Block style={{ paddingVertical: space.lg }}>
      <View style={styles.previewHead}>
        <T variant="headline">{t.home.today}</T>
        <SourceBadge source={{ kind: 'demo' }} />
      </View>
      {rows.map((r) => (
        <View key={r.period} style={[styles.previewRow, r.focus && { backgroundColor: colors.accentSoft }]}>
          <T variant="headline" tone={r.focus ? 'accent' : 'primary'} style={{ width: 56, fontWeight: '700' }}>
            {t.common.period(r.period)}
          </T>
          <View style={{ flex: 1 }}>
            <T variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
              {r.name}
            </T>
            <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', marginTop: 2 }}>
              {r.state ? <Pill text={r.state} tone="accent" /> : null}
              <T variant="sub" tone="tertiary">
                {r.room}
              </T>
            </View>
          </View>
        </View>
      ))}
    </Block>
  );
}

export default function WelcomeScreen() {
  const { startDemo, startPersonal, setSession } = useApp();
  const showcase = useShowcase();
  const { t, locale, setLocale } = useI18n();
  const [starting, setStarting] = useState(false);

  const onDemo = async () => {
    setStarting(true);
    try {
      await startDemo();
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen layout="reading"
      edges={['top', 'bottom']}
      footer={
        <>
          {/* 실제로 쓰는 개인 모드가 주 버튼. 데모 체험은 별도로 그대로 둔다 */}
          <Button
            testID="start-personal"
            label={t.auth.startPersonal}
            onPress={async () => {
              setStarting(true);
              try {
                await startPersonal();
              } finally {
                setStarting(false);
              }
            }}
            loading={starting}
          />
          <T variant="caption" tone="tertiary" style={{ marginTop: space.xs, marginBottom: space.sm, textAlign: 'center' }}>
            {t.auth.personalNote}
          </T>
          {showcase ? (
            <>
              <Button
                testID="start-showcase"
                label={STATIC_DEMO ? t.staticDemo.start : t.showcase.start}
                variant="secondary"
                loading={starting}
                onPress={async () => {
                  setStarting(true);
                  try {
                    const o = await loadOfficial();
                    if (o.kind === 'ok') setSession(await seedShowcase(o.data));
                  } finally {
                    setStarting(false);
                  }
                }}
              />
              <Gap size={space.sm} />
            </>
          ) : null}
          <Button
            testID="start-demo"
            label={t.auth.startDemo}
            variant="secondary"
            onPress={onDemo}
            loading={starting}
          />
          <Gap size={space.sm} />
          <Button testID="go-school-entry" label={t.schoolEntry.button} variant="secondary" onPress={() => router.push('/school-entry')} />
          {/* Supabase 를 쓰지 않으므로 연결 전에는 이메일 로그인·회원가입 버튼을 숨긴다 (코드는 유지) */}
          {isSupabaseConfigured ? (
          <>
          <Gap size={space.sm} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                testID="go-sign-in"
                label={t.auth.signInEmail}
                variant={isSupabaseConfigured ? 'primary' : 'tertiary'}
                onPress={() => router.push('/sign-in')}
                disabled={!isSupabaseConfigured}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                testID="go-sign-up"
                label={t.auth.signUp}
                variant="tertiary"
                onPress={() => router.push('/sign-up')}
                disabled={!isSupabaseConfigured}
              />
            </View>
          </View>
          </>
          ) : null}
          <T variant="caption" tone="secondary" style={{ marginTop: space.lg, textAlign: 'center' }}>
            {t.auth.noKslife}
          </T>
        </>
      }
    >
      <View style={{ paddingTop: space.huge }}>
        <T variant="display" header>
          {t.common.appName}
        </T>
        <T variant="title" style={{ marginTop: space.sm, fontWeight: '600' }}>
          {t.auth.welcomeLead}
        </T>
        <T variant="sub" tone="secondary" style={{ marginTop: space.sm }}>
          {t.common.unofficial}
        </T>
        <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>
          {t.auth.pilotNote}
        </T>
        <View style={{ marginTop: space.md }}>
          <Segmented<Locale> label={t.mypage.language} testIDPrefix="welcome-locale" value={locale} onChange={setLocale} options={LOCALES} />
        </View>
      </View>
      {STATIC_DEMO ? (
        <View style={{ marginTop: space.lg }} testID="static-demo-notice">
          <Notice text={t.staticDemo.notice} />
        </View>
      ) : null}
      <Gap size={space.xxl} />
      <TodayPreview />
    </Screen>
  );
}

const styles = StyleSheet.create({
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginHorizontal: -space.md,
    borderRadius: radius.control,
  },
});
