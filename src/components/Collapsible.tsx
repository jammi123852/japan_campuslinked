import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { colors } from '@/theme/tokens';

/** 긴 공식 원문 접기·펼치기. 짧은 글에는 버튼을 만들지 않는다 */
export function Collapsible({ text, lines = 6, variant = 'body', tone, testID, threshold = 220 }: { text: string; lines?: number; variant?: 'body' | 'sub' | 'caption'; tone?: 'secondary' | 'tertiary'; testID?: string; threshold?: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const long = [...text].length > threshold;
  return (
    <View>
      <T variant={variant} tone={tone} numberOfLines={long && !open ? lines : undefined} testID={testID}>
        {text}
      </T>
      {long ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} testID={testID ? `${testID}-toggle` : undefined} onPress={() => setOpen(!open)} hitSlop={8} style={{ marginTop: 4, minHeight: 28, justifyContent: 'center' }}>
          <T variant="sub" style={{ color: colors.accent, fontWeight: '600' }}>
            {open ? t.common.collapse : t.common.expand}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}
