import { useState } from 'react';

import { Button, Notice, Screen, T, TextField } from '@/components/ui';
import { useI18n } from '@/i18n';
import { authMessageText } from '@/i18n/messages';
import * as auth from '@/services/auth';
import { colors, space } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setInfo(null);
    if (!email.trim()) return setError(t.auth.errEmailRequired);
    setError(null);
    setLoading(true);
    const result = await auth.requestPasswordReset(email);
    setLoading(false);
    if (!result.ok) setError(authMessageText(t, result.message));
    else if (result.message) setInfo(authMessageText(t, result.message));
  };

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={
        <>
          {error && <Notice tone="danger" text={error} />}
          {info && <Notice tone="info" text={info} />}
          <Button label={t.auth.resetAction} onPress={submit} loading={loading} disabled={!auth.isSupabaseConfigured} />
        </>
      }
    >
      {!auth.isSupabaseConfigured && <Notice tone="warning" text={t.auth.notConfiguredReset} />}
      <T variant="body" tone="tertiary" style={{ marginBottom: space.xxl }}>
        {t.auth.resetLead}
      </T>
      <TextField label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoCorrect={false}
        autoComplete="email"
        spellCheck={false} />
    </Screen>
  );
}
