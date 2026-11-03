import { ProfileForm } from '@/components/ProfileForm';
import { useState } from 'react';

import { Button, Gap, Notice } from '@/components/ui';
import { seedShowcase } from '@/features/official/showcase';
import { loadOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { saveErrorText } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';

export default function OnboardingScreen() {
  const { session, updateProfile, signOut, setSession } = useApp();
  const { t } = useI18n();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState(false);
  // 발표용: 학과 선택 화면에서 저장해 둔 데모 학생(실제 시간표 기록)으로 바로 들어간다
  const startDemo = async () => {
    setDemoBusy(true);
    setDemoError(false);
    try {
      const o = await loadOfficial();
      if (o.kind !== 'ok') return setDemoError(true);
      await setSession(await seedShowcase(o.data));
    } catch {
      setDemoError(true);
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <ProfileForm
      mode="steps"
      topSlot={session?.mode === 'demo' ? <Notice text={t.profile.demoNote} /> : null}
      lastSlot={
        <>
          <Gap size={8} />
          <Button testID="onboarding-demo-last" label={t.profile.demoPlay} variant="secondary" icon="play-circle-outline" onPress={startDemo} loading={demoBusy} />
          {demoError ? <Notice tone="danger" text={t.profile.demoVersionError} /> : null}
        </>
      }
      bottomSlot={
        <>
          <Button testID="onboarding-demo" label={t.profile.demoVersion} variant="secondary" icon="play-circle-outline" onPress={startDemo} loading={demoBusy} />
          {demoError ? <Notice tone="danger" text={t.profile.demoVersionError} /> : null}
          <Gap size={8} />
          <Button label={t.profile.backToLogin} variant="text" size="md" onPress={signOut} />
        </>
      }
      onSubmit={async (input) => {
        const r = await updateProfile(input);
        // 성공하면 루트 가드가 홈으로 보낸다
        return r.ok ? null : saveErrorText(t, r);
      }}
    />
  );
}
