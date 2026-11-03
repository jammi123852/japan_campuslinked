import { useState } from 'react';

import { Button, Notice, Screen, T, TextField } from '@/components/ui';
import { checkSchoolEmail, SCHOOL_EMAIL_DOMAINS, SCHOOL_EMAIL_DOMAINS_VERIFIED } from '@/config/school';
import { useI18n } from '@/i18n';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 발표용 학교 메일 입장: 형식·허용 도메인만 확인하고 데모로 들어간다 (인증 메일·재학 확인 없음) */
export default function SchoolEntryScreen() {
  const { startPersonal } = useApp();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const enter = async () => {
    const r = checkSchoolEmail(email);
    if (!r.ok) {
      setError(r.reason === 'format' ? t.schoolEntry.errFormat : t.schoolEntry.errDomain(SCHOOL_EMAIL_DOMAINS.join(', ')));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await startPersonal(email.trim().toLowerCase());
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={<Button testID="school-enter" label={t.schoolEntry.enter} onPress={enter} loading={loading} />}
    >
      <T variant="body" tone="secondary" style={{ marginBottom: space.lg }}>
        {t.schoolEntry.lead}
      </T>
      <Notice tone="warning" text={t.schoolEntry.notice} />
      <TextField
        testID="school-email"
        label={t.schoolEntry.email}
        value={email}
        onChangeText={setEmail}
        placeholder={`name@${SCHOOL_EMAIL_DOMAINS[0]}`}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="email-address"
        autoComplete="email"
        onSubmitEditing={enter}
        error={error}
      />
      {!SCHOOL_EMAIL_DOMAINS_VERIFIED && (
        <T variant="caption" tone="tertiary">
          {t.schoolEntry.domainsUnverified}
        </T>
      )}
    </Screen>
  );
}
