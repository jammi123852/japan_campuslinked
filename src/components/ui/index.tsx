import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useState, useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';

import type { DataSourceKind, SourceMeta } from '@/data/types';
import { useI18n } from '@/i18n';
import { colors, CONTENT_MAX, CONTROL_HEIGHT, fonts, READING_MAX, gutter, MIN_TOUCH, radius, sourceColors, space, type, WIDE_MIN } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** RN-web 에서 Pressable 이 받는 hovered/focused 까지 포함한 상태 */
type PressState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

/** 웹: 마지막 입력이 키보드일 때만 포커스 링을 보인다 (:focus-visible 과 같은 효과) */
let keyboardModality = false;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (keyboardModality = true), true);
  window.addEventListener('pointerdown', () => (keyboardModality = false), true);
}

const focusRing = (s: PressState): ViewStyle | null =>
  Platform.OS === 'web' && s.focused && keyboardModality ? ({ outlineColor: colors.focus, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 } as ViewStyle) : null;

/**
 * 한국어는 어절 단위로 줄바꿈(웹 keep-all, iOS hangul-word). 일본어는 띄어쓰기가 없어 기본 줄바꿈을 쓴다.
 */
function useWrap() {
  const { locale } = useI18n();
  return locale === 'ko'
    ? {
        lineBreakStrategyIOS: 'hangul-word' as const,
        style: (Platform.OS === 'web' ? { wordBreak: 'keep-all', overflowWrap: 'anywhere' } : null) as unknown as TextStyle | null,
      }
    : { lineBreakStrategyIOS: 'standard' as const, style: null };
}

// ---------------------------------------------------------------- 넓은 화면(PC)

/**
 * 웹에서 화면 폭이 WIDE_MIN 이상이면 true (PC 배치: 왼쪽 메뉴 + 2단). 폰·앱은 항상 false.
 * 정적 HTML 은 폭을 모른 채 폰 배치로 만들어지므로, 첫 렌더는 false 로 맞추고(하이드레이션 불일치 방지)
 * 화면이 붙은 뒤 실제 폭으로 바꾼다.
 */
const noopSubscribe = () => () => {};

export function useWide() {
  const { width } = useWindowDimensions();
  // 서버·하이드레이션 중에는 false, 브라우저에 붙은 뒤에는 true
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return hydrated && Platform.OS === 'web' && width >= WIDE_MIN;
}

/**
 * 넓은 화면에서는 왼쪽·오른쪽 두 단, 좁은 화면에서는 위아래로 쌓는다.
 * side: 'left' 면 왼쪽 단이 고정 폭(sideWidth), 'right' 면 오른쪽 단이 고정 폭, 없으면 1:1.
 */
export function Columns({
  first,
  second,
  side,
  sideWidth = 360,
}: {
  first: ReactNode;
  second: ReactNode;
  side?: 'left' | 'right';
  sideWidth?: number;
}) {
  const wide = useWide();
  if (!wide) {
    return (
      <>
        {first}
        <Gap />
        {second}
      </>
    );
  }
  const fixed = { width: sideWidth, flexShrink: 0 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xxl }}>
      <View style={[{ flex: 1, minWidth: 0 }, side === 'left' && fixed]}>{first}</View>
      <View style={[{ flex: 1, minWidth: 0 }, side === 'right' && fixed]}>{second}</View>
    </View>
  );
}

// ---------------------------------------------------------------- Screen

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  background = colors.bg,
  contentStyle,
  footer,
  footerBackground,
  layout = 'wide',
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** 화면 하단에 고정되는 영역 (주 버튼 등) */
  footer?: ReactNode;
  /** 하단 영역 바탕 (입력칸이 있는 하단은 흰색) */
  footerBackground?: string;
  /** PC 폭에서 본문 최대 폭: wide(2단 화면) / reading(글쓰기·상세·설정, 760) */
  layout?: 'wide' | 'reading';
}) {
  const wide = useWide();
  // 넓은 화면: 본문을 가운데 최대 폭으로, 위아래 여백을 넉넉히
  const maxWidth = layout === 'reading' ? READING_MAX : CONTENT_MAX;
  const wideContent = wide ? { width: '100%' as const, maxWidth, alignSelf: 'center' as const, paddingHorizontal: space.huge, paddingTop: space.xxxl } : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={edges}>
      {/* 하단 고정 버튼이 키보드에 가려지지 않게 (iOS 는 padding, Android 는 시스템 resize) */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.screenContent, wideContent, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screenContent, { flex: 1 }, wideContent, contentStyle]}>{children}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { backgroundColor: footerBackground ?? background }, wide && { borderTopWidth: 1, borderTopColor: colors.divider }]}>
          <View style={wide ? { width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: space.huge - gutter } : null}>{footer}</View>
        </View>
      ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- Typography

type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger';
const TONE: Record<Tone, string> = {
  primary: colors.text,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  accent: colors.accent,
  danger: colors.dangerText,
};

export function T({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  numberOfLines,
  testID,
  header,
  live,
}: {
  variant?: keyof typeof type;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  testID?: string;
  header?: boolean;
  /** 검증 오류처럼 나중에 나타나는 문구는 스크린리더에 알린다 */
  live?: boolean;
}) {
  const wrap = useWrap();
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      lineBreakStrategyIOS={wrap.lineBreakStrategyIOS}
      accessibilityRole={header ? 'header' : undefined}
      accessibilityLiveRegion={live ? 'polite' : undefined}
      aria-live={live ? 'polite' : undefined}
      style={[type[variant] as TextStyle, { color: TONE[tone] }, wrap.style, style]}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'text' | 'dangerText';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  testID,
  size = 'lg',
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  testID?: string;
  /** lg 56 / input 52(입력칸 옆) / md 44 */
  size?: 'lg' | 'input' | 'md';
}) {
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: colors.surface, bgPressed: colors.accentSoft, fg: colors.navy, border: colors.accent },
    secondary: { bg: colors.accentSoft, bgPressed: colors.accentSoftPressed, fg: colors.accentSoftText },
    tertiary: { bg: colors.fill, bgPressed: colors.divider, fg: colors.textSecondary },
    text: { bg: 'transparent', bgPressed: colors.fill, fg: colors.textSecondary },
    dangerText: { bg: 'transparent', bgPressed: colors.dangerSoft, fg: colors.dangerText },
  }[variant] as { bg: string; bgPressed: string; fg: string; border?: string };
  const height = size === 'lg' ? CONTROL_HEIGHT : size === 'input' ? 52 : 44;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      aria-disabled={!!isDisabled}
      onPress={onPress}
      disabled={isDisabled}
      style={(s: PressState) => [
        styles.button,
        { minHeight: height, backgroundColor: s.pressed || s.hovered ? palette.bgPressed : palette.bg },
        palette.border ? { borderWidth: 2, borderColor: palette.border } : null,
        size !== 'lg' && { paddingHorizontal: space.lg },
        isDisabled && styles.buttonDisabled,
        s.pressed && { transform: [{ scale: 0.98 }] },
        focusRing(s),
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Ionicons aria-hidden name={icon} size={20} color={palette.fg} style={{ marginRight: space.sm }} />}
          <Text
            style={[size === 'md' ? (type.sub as TextStyle) : (type.headline as TextStyle), { color: palette.fg, fontWeight: variant === 'primary' ? '700' : '600' }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  badge,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={(s: PressState) => [styles.iconButton, s.pressed && { backgroundColor: colors.divider }, focusRing(s)]}
    >
      <Ionicons name={icon} size={24} color={colors.text} />
      {badge ? (
        <View style={styles.badgeDot}>
          <Text style={styles.badgeDotText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- TextField

export function TextField({
  label,
  error,
  hint,
  right,
  ...props
}: TextInputProps & { label: string; error?: string | null; hint?: string; right?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: space.xl }}>
      <T variant="sub" tone="secondary" style={{ marginBottom: space.sm, fontWeight: '600' }}>
        {label}
      </T>
      <View style={styles.inputRow}>
        <TextInput
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={label}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            styles.input,
            focused && { borderColor: colors.accent, backgroundColor: colors.surface },
            error ? { borderColor: colors.danger } : null,
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null,
            props.style,
          ]}
        />
        {right}
      </View>
      {error ? (
        <T variant="sub" tone="danger" style={{ marginTop: space.sm }} live>
          {error}
        </T>
      ) : hint ? (
        <T variant="sub" tone="tertiary" style={{ marginTop: space.sm }}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- Block (그룹 영역)

export function Block({ children, style, flush, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; flush?: boolean; testID?: string }) {
  return (
    <View testID={testID} style={[styles.block, flush && { paddingVertical: space.sm, paddingHorizontal: 0 }, style]}>
      {children}
    </View>
  );
}

export function BlockHeader({ title, right, testID }: { title: string; right?: ReactNode; testID?: string }) {
  return (
    <View style={styles.blockHeader}>
      <T variant="title" header testID={testID} style={{ flex: 1 }}>
        {title}
      </T>
      {right}
    </View>
  );
}

/** 블록 사이 간격 */
export function Gap({ size = space.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function EmptyText({ text }: { text: string }) {
  return (
    <T variant="sub" tone="tertiary" style={{ paddingVertical: space.md }}>
      {text}
    </T>
  );
}

// ---------------------------------------------------------------- Row

export function Row({
  title,
  subtitle,
  left,
  right,
  onPress,
  testID,
  chevron,
  selected,
  role,
  numberOfLines,
}: {
  title: string;
  subtitle?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
  chevron?: boolean;
  selected?: boolean;
  role?: 'radio' | 'button';
  numberOfLines?: number;
}) {
  const content = (
    <>
      {left ? <View style={{ marginRight: space.md }}>{left}</View> : null}
      <View style={{ flex: 1 }}>
        <T variant="body" numberOfLines={numberOfLines} style={selected ? { fontWeight: '600', color: colors.accent } : null}>
          {title}
        </T>
        {typeof subtitle === 'string' ? (
          <T variant="sub" tone="tertiary" style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : (
          subtitle
        )}
      </View>
      {right}
      {role === 'radio' ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={selected ? colors.accent : colors.textDisabled}
          style={{ marginLeft: space.md }}
        />
      ) : null}
      {chevron ? <Ionicons aria-hidden name="chevron-forward" size={20} color={colors.textDisabled} style={{ marginLeft: space.sm }} /> : null}
    </>
  );
  // 누를 수 없는 줄은 버튼이 아니라 일반 내용: 스크린리더가 '비활성'으로 읽지 않게 한다
  if (!onPress) {
    return (
      <View testID={testID} style={styles.rowItem}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole={role ?? 'button'}
      accessibilityState={role === 'radio' ? { checked: !!selected } : undefined}
      aria-checked={role === 'radio' ? !!selected : undefined}
      style={(s: PressState) => [
        styles.rowItem,
        s.pressed && { backgroundColor: colors.surfacePressed },
        focusRing(s),
      ]}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------- Chip / Segmented

export function Chip({
  label,
  selected,
  onPress,
  testID,
  icon,
  accessibilityLabel,
  onGray,
}: {
  /** 회색 바탕 위에 놓일 때 흰 칩으로 (회색 위 회색은 안 보임) */
  onGray?: boolean;
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      aria-pressed={onPress ? !!selected : undefined}
      style={(s: PressState) => [
        styles.chip,
        onGray && { backgroundColor: colors.surface },
        selected && styles.chipSelected,
        s.pressed && { opacity: 0.7 },
        focusRing(s),
      ]}
    >
      <Text style={[type.sub as TextStyle, { color: selected ? colors.navy : colors.text, fontWeight: selected ? '700' : '400' }]}>
        {label}
      </Text>
      {icon ? <Ionicons aria-hidden name={icon} size={16} color={colors.textTertiary} style={{ marginLeft: space.xs }} /> : null}
    </Pressable>
  );
}

export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
  label,
}: {
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
  testIDPrefix?: string;
  label: string;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}-${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => onChange(o.value)}
            style={(s: PressState) => [styles.segment, on && styles.segmentOn, focusRing(s)]}
          >
            <Text
              numberOfLines={1}
              style={[type.sub as TextStyle, { color: on ? colors.navy : colors.textSecondary, fontWeight: on ? '700' : '500' }]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- Badges

export function SourceBadge({ source }: { source: SourceMeta }) {
  const { t } = useI18n();
  const c = sourceColors[source.kind];
  const unverified = source.kind === 'official_public' && source.verification !== 'verified';
  const label = t.source[source.kind as DataSourceKind];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>
        {label}
        {unverified ? ` · ${t.source.needsReview}` : ''}
      </Text>
    </View>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'accent' | 'warning' | 'danger' | 'success' }) {
  const map = {
    neutral: { bg: colors.fill, fg: colors.textSecondary },
    accent: { bg: colors.accentSoft, fg: colors.accent },
    warning: { bg: colors.warningSoft, fg: colors.warningText },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText },
    success: { bg: colors.successSoft, fg: colors.successText },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- Notice (인라인 안내)

export function Notice({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' | 'danger' }) {
  const wrap = useWrap();
  const map = {
    info: { bg: colors.infoSoft, fg: colors.infoText, icon: 'information-circle' as IconName },
    warning: { bg: colors.warningSoft, fg: colors.warningText, icon: 'alert-circle' as IconName },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText, icon: 'close-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: map.bg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Ionicons aria-hidden name={map.icon} size={18} color={map.fg} style={{ marginRight: space.sm, marginTop: 1 }} />
      <Text lineBreakStrategyIOS={wrap.lineBreakStrategyIOS} style={[type.sub as TextStyle, { color: map.fg, flex: 1 }, wrap.style]}>
        {text}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- Planned (미구현 명시)

/** 아직 구현하지 않은 기능 안내. 누를 수 있는 요소는 두지 않는다. */
export function PlannedFeature({ stage, title, items }: { stage: 2 | 3; title: string; items: string[] }) {
  const { t } = useI18n();
  return (
    <Block>
      <View style={{ alignSelf: 'flex-start', marginBottom: space.md }}>
        <Pill text={t.common.plannedStage(stage)} />
      </View>
      <T variant="title" header style={{ marginBottom: space.md }}>
        {title}
      </T>
      {items.map((it) => (
        <View key={it} style={styles.plannedItem}>
          <View style={styles.plannedBullet} />
          <T variant="body" tone="secondary" style={{ flex: 1 }}>
            {it}
          </T>
        </View>
      ))}
    </Block>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: gutter, paddingTop: space.lg, paddingBottom: space.huge },
  footer: { paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: space.lg },
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    borderRadius: radius.control,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  iconButton: { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  badgeDotText: { color: colors.onAccent, fontSize: 10, fontWeight: '700', lineHeight: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderRadius: radius.control,
    paddingHorizontal: space.lg,
    backgroundColor: colors.fill,
    borderWidth: 1.5,
    borderColor: 'transparent',
    fontSize: type.body.fontSize,
    color: colors.text,
  },
  block: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.block,
    paddingHorizontal: gutter,
    paddingVertical: gutter,
  },
  blockHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm, minHeight: 32 },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: space.md,
    marginHorizontal: -gutter,
    paddingHorizontal: gutter,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    borderWidth: 1.5,
    borderColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: space.sm,
    marginBottom: space.sm,
  },
  chipSelected: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 2.5 },
  segmented: { flexDirection: 'row', backgroundColor: colors.fill, borderRadius: radius.control, padding: 4 },
  segment: { flex: 1, minHeight: 40, borderRadius: radius.segment, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs },
  segmentOn: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.accent },
  badge: { alignSelf: 'flex-start', borderRadius: radius.badge, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontFamily: fonts.sans },
  notice: { flexDirection: 'row', alignItems: 'flex-start', padding: space.md, borderRadius: radius.control, marginBottom: space.lg },
  plannedItem: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.sm },
  plannedBullet: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textTertiary, marginTop: 10, marginRight: space.md },
});
