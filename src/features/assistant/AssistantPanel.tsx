import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { ContentText } from '@/components/ContentText';
import { Block, BlockHeader, Button, Chip, Notice, Pill, T, TextField, useWide } from '@/components/ui';
import { shiftQuarter } from '@/features/academic/PeriodBar';
import { useOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { ApiError, askAssistant, type AssistantCall, type AssistantReply } from '@/lib/api';
import { readJson, StorageKeys, writeJson } from '@/lib/storage';
import { usePeriod } from '@/services/periodRepository';
import { useApp } from '@/state/AppContext';
import { colors, radius, space } from '@/theme/tokens';

import { AssistantCard } from './AssistantCards';
import { localRoute } from './assistantLogic';
import { runTool, type Card, type ToolCtx } from './assistantTools';

interface Msg {
  id: string;
  q: string;
  status: 'done' | 'failed' | 'cancelled';
  kind?: 'answer' | 'unsupported' | 'need_input';
  /** AI 답변인지, AI 연결이 안 돼 앱 계산만 보여 주는지 */
  source?: 'ai' | 'app';
  answer?: string;
  whyMe?: string;
  unverified?: string[];
  cards?: Card[];
  errorCode?: string;
}

let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq += 1)}`;
const MAX_KEPT = 20;
const MAX_ROUNDS = 3;

/** 모델에게 다시 시킬 일 없이 지금 표시할 앱 기준 답 */
function localAnswer(calls: Partial<AssistantCall>[], t: ReturnType<typeof useI18n>['t']) {
  return calls.length ? t.assistant.appOnlyAnswer : '';
}

export function AssistantPanel() {
  const { session, profile } = useApp();
  const { t, locale } = useI18n();
  const official = useOfficial();
  const od = official.kind === 'ok' ? official.data : null;
  const per = usePeriod(session, od);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState<{ q: string; stage: string } | null>(null);
  const runRef = useRef(0);
  const lastSeen = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wide = useWide();
  const listRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const storageKey = session ? StorageKeys.userData(session.userId, 'assistant') : null;

  // 재접속해도 대화 결과가 남는다 (이 기기에만 저장)
  useEffect(() => {
    if (!storageKey) return;
    let alive = true;
    readJson<Msg[]>(storageKey).then((v) => alive && Array.isArray(v) && setMsgs(v));
    return () => {
      alive = false;
    };
  }, [storageKey]);
  const persist = useCallback(
    (next: Msg[]) => {
      if (storageKey) writeJson(storageKey, next.slice(-MAX_KEPT)).catch(() => undefined);
    },
    [storageKey],
  );
  const setAndSave = (fn: (m: Msg[]) => Msg[]) =>
    setMsgs((m) => {
      const next = fn(m);
      persist(next);
      return next;
    });

  const ctxOf = (signal?: AbortSignal): ToolCtx | null =>
    session && profile && od ? { session, profile, od, t, locale, today: per.today, period: per.period, shiftQuarter, signal } : null;

  const finish = (m: Msg, run: number) => {
    if (run !== runRef.current) return;
    setAndSave((list) => [...list, m]);
    setBusy(null);
  };

  /** AI 연결이 안 될 때: 키워드로 기능만 실행하고 그 사실을 표시한다. 답을 지어내지 않는다 */
  const fallback = async (q: string, run: number, ctx: ToolCtx, errorCode: string) => {
    const route = localRoute(q);
    if (route.kind === 'unsupported') return finish({ id: nextId(), q, status: 'done', kind: 'unsupported', source: 'app', errorCode }, run);
    const cards: Card[] = [];
    try {
      for (const call of route.calls) {
        const r = await runTool(call, ctx);
        cards.push(...r.cards);
      }
      finish({ id: nextId(), q, status: 'done', kind: 'answer', source: 'app', answer: localAnswer(route.calls, t), cards, errorCode }, run);
    } catch {
      finish({ id: nextId(), q, status: 'failed', errorCode }, run);
    }
  };

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    const ctl = new AbortController();
    const ctx = ctxOf(ctl.signal);
    if (!ctx) return;
    const run = ++runRef.current;
    abortRef.current = ctl;
    setBusy({ q, stage: t.assistant.stageThinking });
    const cards: Card[] = [];
    const toolResults: { tool: string; result: string }[] = [];
    const history = msgs.filter((m) => m.status === 'done' && m.answer).slice(-3).map((m) => ({ q: m.q, a: m.answer ?? '' }));
    try {
      let reply: AssistantReply | null = null;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        reply = await askAssistant(profile?.nickname ?? 'guest', { question: q, lang: locale, toolResults, history }, ctl.signal);
        if (run !== runRef.current) return;
        if (reply.kind !== 'call' || !reply.calls.length) break;
        for (const call of reply.calls) {
          setBusy({ q, stage: t.assistant.stageTool(t.assistant.tools[call.tool as keyof typeof t.assistant.tools] ?? call.tool) });
          let r: Awaited<ReturnType<typeof runTool>>;
          try {
            r = await runTool(call, ctx);
          } catch (e) {
            if (e instanceof ApiError && e.kind === 'aborted') throw e;
            r = { result: { error: 'tool_failed' }, cards: [] };
          }
          if (run !== runRef.current) return;
          cards.push(...r.cards);
          toolResults.push({ tool: call.tool, result: JSON.stringify(r.result) });
        }
        setBusy({ q, stage: t.assistant.stageWriting });
      }
      if (!reply) return;
      // AI 가 되물어도 고르는 화면이 있는 기능이면 바로 보여 준다 (예시 질문이 대답만 하고 끝나지 않게)
      if (reply.kind === 'need_input' && !cards.length) {
        const route = localRoute(q);
        if (route.kind === 'calls' && ['compare_courses', 'search_notices'].includes(route.calls[0].tool ?? '')) cards.push(...(await runTool(route.calls[0], ctx)).cards);
      }
      // 라운드 상한에 닿아도 앱 계산 결과는 보여 준다
      const kind = reply.kind === 'call' ? 'answer' : reply.kind;
      finish({ id: nextId(), q, status: 'done', kind, source: 'ai', answer: reply.kind === 'call' ? t.assistant.appOnlyAnswer : reply.answer, whyMe: reply.whyMe, unverified: reply.unverified, cards }, run);
    } catch (e) {
      if (run !== runRef.current) return;
      if (e instanceof ApiError && e.kind === 'aborted') return;
      const code = e instanceof ApiError ? (e.code ?? e.kind) : 'unknown';
      // 키 없음·AI 오류·서버 연결 실패: 앱 계산으로 이어 간다
      await fallback(q, run, ctx, code);
    }
  };

  const send = () => {
    const q = input;
    setInput('');
    ask(q);
  };
  const cancel = () => {
    const q = busy?.q ?? '';
    runRef.current += 1;
    abortRef.current?.abort();
    setBusy(null);
    setAndSave((list) => [...list, { id: nextId(), q, status: 'cancelled' }]);
    setInput(q);
  };
  const replaceCard = (msgId: string, index: number, next: Card) => setAndSave((list) => list.map((m) => (m.id === msgId ? { ...m, cards: (m.cards ?? []).map((c, i) => (i === index ? next : c)) } : m)));
  const clear = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    setBusy(null);
    setAndSave(() => []);
  };

  const ctx = ctxOf();
  const unavailable = official.kind === 'missing' || official.kind === 'error';
  return (
    <Block testID="assistant-panel" style={{ marginBottom: space.xxl }}>
      <BlockHeader title={t.assistant.title} right={msgs.length ? <Button testID="assistant-clear" label={t.assistant.clear} variant="text" size="md" onPress={clear} /> : undefined} />
      <T variant="sub" tone="secondary" style={{ marginBottom: space.sm }}>{t.assistant.lead}</T>
      {unavailable ? <Notice tone="warning" text={t.assistant.noOfficial} /> : null}
      {msgs.length || busy ? (
      <ScrollView
        ref={listRef}
        testID="assistant-scroll"
        nestedScrollEnabled
        style={{ maxHeight: wide ? 520 : 440, marginBottom: space.md }}
        contentContainerStyle={{ paddingRight: space.sm }}
      >
      {msgs.map((m) => {
        // 계획 카드가 다시 계산돼 답변 때와 달라졌거나, 문장의 숫자가 앱 계산과 다르면 문장을 보여 주지 않는다
        const planCards = (m.cards ?? []).filter((c): c is Extract<Card, { type: 'plan' }> => c.type === 'plan');
        const answerHidden = planCards.some((c) => c.answerStale || c.answerMismatch);
        return (
        <View
          key={m.id}
          testID={`assistant-msg-${m.id}`}
          style={{ marginBottom: space.lg }}
          onLayout={(e) => {
            // 새 답변은 시작 부분이 보이게 스크롤한다 (긴 카드의 끝으로 가지 않게)
            if (m.id === msgs[msgs.length - 1].id && lastSeen.current !== m.id) {
              lastSeen.current = m.id;
              listRef.current?.scrollTo({ y: e.nativeEvent.layout.y, animated: false });
            }
          }}
        >
          <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.accentSoft, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.sm }}>
            <T variant="body" testID="assistant-q">{m.q}</T>
          </View>
          {m.status === 'cancelled' ? <T variant="sub" tone="tertiary" testID="assistant-cancelled">{t.assistant.cancelled}</T> : null}
          {m.status === 'failed' ? (
            <View>
              <Notice tone="danger" text={t.assistant.failed} />
              <Button testID="assistant-retry" label={t.community.retry} variant="tertiary" size="md" onPress={() => ask(m.q)} />
            </View>
          ) : null}
          {m.status === 'done' && m.kind === 'unsupported' ? (
            <View testID="assistant-unsupported">
              <T variant="body" style={{ fontWeight: '700' }}>{t.assistant.unsupported}</T>
              <T variant="sub" tone="secondary" style={{ marginTop: space.xs }}>{t.assistant.capabilities}</T>
            </View>
          ) : null}
          {m.status === 'done' && m.kind !== 'unsupported' ? (
            <View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.xs }}>
                <Pill text={m.source === 'ai' ? t.assistant.badgeAi : t.assistant.badgeApp} tone={m.source === 'ai' ? 'accent' : 'neutral'} />
              </View>
              {m.source === 'app' ? <T variant="caption" tone="tertiary" testID="assistant-fallback-note">{t.assistant.fallbackNote}</T> : null}
              {answerHidden ? (
                <View testID="assistant-answer-stale">
                  <Notice tone="warning" text={planCards.some((c) => c.answerStale) ? t.assistant.answerStale : t.assistant.answerMismatch} />
                </View>
              ) : m.answer ? <ContentText text={m.answer} testID="assistant-answer" /> : null}
              {m.whyMe && !answerHidden ? (
                <View style={{ marginTop: space.sm }}>
                  <T variant="sub" style={{ fontWeight: '700' }}>{t.assistant.whyMe}</T>
                  <ContentText text={m.whyMe} variant="sub" />
                </View>
              ) : null}
            </View>
          ) : null}
          {ctx && m.status === 'done'
            ? (m.cards ?? []).map((c, i) => (
                <View key={i} style={{ marginTop: space.md, padding: space.md, borderWidth: 1, borderColor: colors.divider, borderRadius: radius.control, backgroundColor: colors.bg }}>
                  <AssistantCard card={c} ctx={ctx} answer={m.answer} onReplace={(n) => replaceCard(m.id, i, n)} />
                </View>
              ))
            : null}
          {m.unverified?.length && !answerHidden ? (
            <View style={{ marginTop: space.sm }} testID="assistant-unverified">
              <T variant="sub" style={{ fontWeight: '700' }}>{t.assistant.unverifiedTitle}</T>
              {m.unverified.map((u, i) => <ContentText key={i} text={`• ${u}`} variant="sub" tone="secondary" />)}
            </View>
          ) : null}
        </View>
        );
      })}
      {busy ? (
        <View testID="assistant-busy" style={{ marginBottom: space.md }} onLayout={() => listRef.current?.scrollToEnd({ animated: false })}>
          <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.accentSoft, borderRadius: radius.control, paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.sm }}>
            <T variant="body">{busy.q}</T>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <ActivityIndicator color={colors.accent} accessibilityLabel={t.common.loading} />
            <T variant="sub" tone="secondary" testID="assistant-stage" style={{ flexShrink: 1 }}>{busy.stage}</T>
            <Button testID="assistant-cancel" label={t.common.cancel} variant="tertiary" size="md" onPress={cancel} />
          </View>
        </View>
      ) : null}
      </ScrollView>
      ) : null}
      <TextField
        testID="assistant-input"
        label={t.assistant.inputLabel}
        value={input}
        onChangeText={setInput}
        placeholder={t.assistant.placeholder}
        maxLength={2000}
        multiline
        style={{ minHeight: 48, paddingTop: space.sm }}
        onSubmitEditing={send}
        right={
          <View style={{ width: 76 }}>
            <Button testID="assistant-send" label={t.assistant.send} size="input" onPress={send} disabled={!input.trim() || !!busy || !ctx} />
          </View>
        }
      />
      {msgs.length === 0 && !busy ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.xs }}>
          {t.assistant.examples.map((ex, i) => (
            <Chip key={ex} testID={`assistant-ex-${i}`} label={ex} onPress={() => (ctx ? ask(ex) : undefined)} />
          ))}
        </View>
      ) : null}
      <T variant="caption" tone="tertiary" style={{ marginTop: -space.sm }}>{t.assistant.dataNote}</T>
    </Block>
  );
}
