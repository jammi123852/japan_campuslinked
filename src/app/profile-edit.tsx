import { router } from 'expo-router';

import { ProfileForm } from '@/components/ProfileForm';
import { useI18n } from '@/i18n';
import { saveErrorText } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';

export default function ProfileEditScreen() {
  const { profile, updateProfile } = useApp();
  const { t } = useI18n();

  return (
    <ProfileForm
      mode="single"
      initial={profile}
      onSubmit={async (input) => {
        const r = await updateProfile(input);
        if (!r.ok) return saveErrorText(t, r);
        if (router.canGoBack()) router.back();
        else router.replace('/mypage');
        return null;
      }}
    />
  );
}
