import { Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { useContentText } from '@/lib/contentTranslate';
import { colors, space } from '@/theme/tokens';

/** 실제 콘텐츠 본문: 선택 언어로 번역해 보여 주고 원문을 바로 볼 수 있다. 번역이 필요 없으면 글자만 그린다 */
export function ContentText({ text, variant = 'body', tone, testID }: { text: string; variant?: 'body' | 'sub' | 'caption' | 'display' | 'headline'; tone?: 'secondary' | 'tertiary'; testID?: string }) {
  const { t } = useI18n();
  const c = useContentText(text);
  return (
    <View>
      <T variant={variant} tone={tone} testID={testID}>
        {c.text}
      </T>
      {c.needed ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: 2 }}>
          {c.state === 'done' ? (
            <Pressable accessibilityRole="button" testID={testID ? `${testID}-original` : undefined} onPress={c.toggle} hitSlop={8}>
              <T variant="caption" style={{ color: colors.accent, fontWeight: '600' }}>
                {c.showOriginal ? t.contentTr.showTranslated : t.contentTr.showOriginal}
              </T>
            </Pressable>
          ) : c.state === 'failed' ? (
            <Pressable accessibilityRole="button" testID={testID ? `${testID}-retry` : undefined} onPress={c.retry} hitSlop={8}>
              <T variant="caption" tone="danger">{t.contentTr.failed}</T>
            </Pressable>
          ) : (
            <T variant="caption" tone="tertiary">{t.contentTr.translating}</T>
          )}
        </View>
      ) : null}
    </View>
  );
}
