import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Block, BlockHeader, Button, Gap, Notice, Pill, T } from '@/components/ui';
import { useI18n } from '@/i18n';
import { fetchMailDigest, type MailDigest, type MailNotice } from '@/lib/api';
import { space } from '@/theme/tokens';

const POLL_MS = 15_000;

/**
 * 연결된 메일의 주간 공지 확인 결과. 메일이 연결되지 않았거나 서버가 응답하지 않으면 null
 * (공개 사이트·연결 전에는 화면에 나타나지 않는다).
 */
export function useMailDigest() {
  const [digest, setDigest] = useState<MailDigest | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const next = await fetchMailDigest().catch(() => null);
      if (!alive) return;
      setDigest(next);
      // 첫 확인이 끝나면 결과가 바로 보이도록 그동안만 다시 읽는다
      if (next?.status === 'pending') timer = setTimeout(load, POLL_MS);
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return digest && digest.status !== 'not_configured' ? digest : null;
}


export function MailDigestCard({ digest, onOpen }: { digest: Exclude<MailDigest, { status: 'not_configured' }>; onOpen: (notice: MailNotice) => void }) {
  const { t, locale } = useI18n();
  const m = t.noticeAi.mail;
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'ko-KR');
  return (
    <Block testID="mail-digest">
      <BlockHeader title={m.title} />
      {digest.status === 'pending' ? <T variant="body">{m.pending}</T> : null}
      {digest.status === 'error' ? <Notice tone="danger" text={m.error[digest.errorCode] ?? m.error.unknown} /> : null}
      {digest.status === 'ok' ? (
        <>
          {digest.truncated ? <Notice tone="warning" text={m.truncated} /> : null}
          {digest.omitted > 0 ? <Notice tone="warning" text={m.omitted(digest.omitted)} /> : null}
          {digest.notices.length === 0 && !digest.truncated ? (
            <T variant="headline" testID="mail-digest-none">
              {m.none}
            </T>
          ) : null}
          {digest.notices.map((n) => (
            <View key={n.id} testID={`mail-notice-${n.id}`} style={{ paddingVertical: space.sm, gap: space.xs }}>
              <T variant="body" style={{ fontWeight: '600' }}>
                {n.subject || m.noSubject}
              </T>
              <T variant="caption" tone="tertiary">
                {n.date ? `${n.from} · ${day(n.date)}` : n.from}
              </T>
              {n.analysis ? <T variant="sub" tone="secondary">{n.analysis.summaryKo || n.analysis.summaryJa}</T> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' }}>
                {n.analysisStatus !== 'done' ? <Pill text={m.status[n.analysisStatus]} tone="warning" /> : null}
                {n.hasAttachment ? <Pill text={m.attachment} /> : null}
              </View>
              {n.analysis ? <Button testID={`mail-open-${n.id}`} label={m.open} variant="tertiary" size="md" onPress={() => onOpen(n)} /> : null}
            </View>
          ))}
          <Gap size={space.sm} />
          <T variant="caption" tone="tertiary">
            {m.range(day(digest.window.from), day(digest.window.to))}
          </T>
        </>
      ) : null}
      {digest.status === 'ok' || digest.status === 'error' ? (
        <T variant="caption" tone="tertiary">
          {m.schedule(day(digest.checkedAt), day(digest.nextCheckAt))}
        </T>
      ) : null}
    </Block>
  );
}
