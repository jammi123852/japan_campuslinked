import { useState } from 'react';

import { Button, Notice, Screen, T, TextField } from '@/components/ui';
import { useI18n } from '@/i18n';
import { authMessageText } from '@/i18n/messages';
import * as auth from '@/services/auth';
import { useApp } from '@/state/AppContext';
import { colors } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpScreen() {
  const { setSession } = useApp();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setInfo(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t.auth.errEmailFormat);
    if (password.length < 8) return setError(t.auth.errPasswordLength);
    if (password !== confirm) return setError(t.auth.errPasswordMatch);
    setError(null);
    setLoading(true);
    const result = await auth.signUp(email, password);
    setLoading(false);
    if (!result.ok) return setError(authMessageText(t, result.message));
    if (result.session) await setSession(result.session);
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
          <Button label={t.auth.signUpAction} onPress={submit} loading={loading} disabled={!auth.isSupabaseConfigured} />
        </>
      }
    >
      {!auth.isSupabaseConfigured && <Notice tone="warning" text={t.auth.notConfiguredSignUp} />}
      <TextField label={t.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoCorrect={false}
        spellCheck={false} autoComplete="email" />
      <TextField label={t.auth.passwordNew} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <TextField label={t.auth.passwordConfirm} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
      <T variant="sub" tone="tertiary">
        {t.auth.signUpNote}
      </T>
    </Screen>
  );
}
