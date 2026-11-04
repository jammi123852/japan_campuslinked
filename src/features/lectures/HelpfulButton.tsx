import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError, setReviewHelpful, type SharedReview } from '@/lib/api';
import { useApp } from '@/state/AppContext';
import { colors, radius, space } from '@/theme/tokens';

/**
 * '이 후기가 유용했다' 반응 (강의 별점이 아니다). 수는 서버 응답만 표시한다.
 * 누르는 중에는 다음 요청을 보내지 않고, 실패하면 이전 표시로 돌아간다. 본인 후기에는 수만 보인다.
 */
export function HelpfulButton({ review, onChanged }: { review: SharedReview; onChanged?: () => void }) {
  const { profile } = useApp();
  const { t } = useI18n();
  const [state, setState] = useState({ id: review.id, count: review.helpfulCount ?? 0, on: !!review.helpedByMe });
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  // 목록을 다시 받으면 서버 값을 따른다
  const server = `${review.id}:${review.helpfulCount ?? 0}:${!!review.helpedByMe}`;
  const [seen, setSeen] = useState(server);
  if (seen !== server) {
    setSeen(server);
    setState({ id: review.id, count: review.helpfulCount ?? 0, on: !!review.helpedByMe });
  }
  const press = async () => {
    if (busy.current || review.mine) return;
    busy.current = true;
    setPending(true);
    setErr(null);
    try {
      const r = await setReviewHelpful(profile?.nickname ?? 'guest', review.id, !state.on);
      setState({ id: review.id, count: r.helpfulCount, on: r.helpedByMe });
      onChanged?.();
    } catch (e) {
      setErr(e instanceof ApiError && e.code === 'own_review' ? t.helpful.own : t.helpful.failed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (review.mine) {
    return <T variant="caption" tone="tertiary" testID={`helpful-count-${review.id}`}>{t.helpful.count(state.count)}</T>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
      <Pressable
        testID={`helpful-${review.id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: state.on, busy: pending }}
        accessibilityLabel={t.helpful.a11y(state.count, state.on)}
        onPress={press}
        style={({ pressed }) => [
          { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.control, borderWidth: state.on ? 2 : 1, borderColor: state.on ? colors.accent : colors.divider, backgroundColor: colors.surface },
          (pressed || pending) && { opacity: 0.6 },
        ]}
      >
        <Ionicons name={state.on ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={state.on ? colors.accent : colors.textSecondary} />
        <T variant="caption" tone={state.on ? 'accent' : 'secondary'} testID={`helpful-count-${review.id}`}>{t.helpful.count(state.count)}</T>
      </Pressable>
      {err ? <T variant="caption" tone="danger" testID={`helpful-error-${review.id}`}>{err}</T> : null}
    </View>
  );
}
