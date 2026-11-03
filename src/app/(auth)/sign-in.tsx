import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Notice, Screen, TextField } from '@/components/ui';
import { useI18n } from '@/i18n';
import { authMessageText } from '@/i18n/messages';
import * as auth from '@/services/auth';
import { useApp } from '@/state/AppContext';
import { colors } from '@/theme/tokens';

export default function SignInScreen() {
  const { setSession } = useApp();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError(t.auth.errEmailPassword);
    setLoading(true);
    setError(null);
    const result = await auth.signIn(email, password);
    setLoading(false);
    if (!result.ok) setError(authMessageText(t, result.message));
    else if (result.session) await setSession(result.session);
  };

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={
        <>
          {error && <Notice tone="danger" text={error} />}
          <Button label={t.auth.signInAction} onPress={submit} loading={loading} disabled={!auth.isSupabaseConfigured} />
          <Button label={t.auth.forgot} variant="text" size="md" onPress={() => router.push('/reset-password')} />
        </>
      }
    >
      {!auth.isSupabaseConfigured && <Notice tone="warning" text={t.auth.notConfiguredLogin} />}
      <TextField
        label={t.auth.email}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        autoCorrect={false}
        spellCheck={false}
        textContentType="emailAddress"
      />
      <TextField
        label={t.auth.password}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        onSubmitEditing={submit}
      />
    </Screen>
  );
}
