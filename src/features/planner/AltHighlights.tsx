import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';

import type { Highlights } from './builderLogic';

/** 시간표 대안의 장점·아쉬운 점. 앱 계산값으로 고른 것이며 AI 문장이 아니다 */
export function AltHighlights({ h, testID }: { h: Highlights; testID?: string }) {
  const { t } = useI18n();
  if (!h.pros.length && !h.cons.length) return null;
  const row = (icon: 'checkmark-circle' | 'alert-circle-outline', color: string, text: string, key: string) => (
    <View key={key} style={{ flexDirection: 'row', gap: space.xs, paddingVertical: 1 }}>
      <Ionicons name={icon} size={15} color={color} style={{ marginTop: 2 }} />
      <T variant="sub" style={{ flex: 1 }}>{text}</T>
    </View>
  );
  return (
    <View testID={testID} style={{ marginTop: space.xs }}>
      {h.pros.length ? <T variant="sub" style={{ fontWeight: '700' }}>{t.builder.prosTitle}</T> : null}
      {h.pros.map((p) => row('checkmark-circle', colors.successText, t.builder.pro[p.key](p.n), p.key))}
      {h.cons.length ? <T variant="sub" style={{ fontWeight: '700', marginTop: space.xs }}>{t.builder.consTitle}</T> : null}
      {h.cons.map((c) => row('alert-circle-outline', colors.warningText, t.builder.con[c.key](c.n), c.key))}
      <T variant="caption" tone="tertiary" style={{ marginTop: 2 }}>{t.builder.highlightNote}</T>
    </View>
  );
}
