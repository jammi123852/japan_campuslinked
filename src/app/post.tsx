import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Row, Screen, T, TextField } from '@/components/ui';
import { lectureRoute, useAnyLecture } from '@/features/official/useAnyLecture';
import { apiErrorText, formatPostTime, type LoadState } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import { ContentText } from '@/components/ContentText';
import { confirmDestructive } from '@/lib/confirm';
import { useContentText } from '@/lib/contentTranslate';
import { addComment, deleteComment, deletePost, getPost, newClientId, updateComment, type CommentItem, type PostSummary } from '@/lib/api';
import { refreshBookmarkTitle, removeBookmark, toggleBookmark, useSaved } from '@/services/savedRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/**
 * 게시글 상세. 주소는 /post?id=123 — 정적 웹 빌드에서도 post.html 하나로 직접 접속·새로고침이 된다.
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const postId = Number(id);
  const { profile, session } = useApp();
  const saved = useSaved(session);
  const { t, locale } = useI18n();
  const [state, setState] = useState<LoadState<{ post: PostSummary; comments: CommentItem[] }>>({ kind: 'loading' });
  const [comment, setComment] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [clientId, setClientId] = useState(newClientId);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const titleText = useContentText(state.kind === 'ok' ? state.data.post.title : '');

  const validId = Number.isInteger(postId) && postId > 0;
  const [tick, setTick] = useState(0);
  /** 다시 불러오기 (실시간 동기화 대신 사용자가 새로고침) */
  const load = useCallback(() => setTick((x) => x + 1), []);

  // 수정 화면에서 돌아오면 최신 내용을 다시 읽는다
  useFocusEffect(load);

  useEffect(() => {
    if (!validId) return;
    let alive = true;
    getPost(postId)
      .then((data) => {
        if (!alive) return;
        setState({ kind: 'ok', data });
        // 북마크해 둔 글이면 저장된 제목을 최신으로 맞춘다 (북마크가 없으면 아무것도 바꾸지 않음)
        if (session) refreshBookmarkTitle(session, data.post.id, data.post.title).catch(() => undefined);
      })
      .catch((error: unknown) => alive && setState({ kind: 'error', error }));
    return () => {
      alive = false;
    };
  }, [postId, validId, tick, session]);

  const send = async () => {
    if (sending) return;
    const text = comment.trim();
    if (!text) return setCommentError(t.community.errComment);
    if ([...text].length > 500) return setCommentError(t.community.errCommentLong);
    setSending(true);
    setCommentError(null);
    try {
      await addComment(profile?.nickname ?? 'guest', postId, { body: text, anonymous, clientId });
      setComment('');
      setClientId(newClientId());
      load();
    } catch (err) {
      setCommentError(`${apiErrorText(t, err)} ${t.community.keptInput}`);
    } finally {
      setSending(false);
    }
  };

  const lecture = useAnyLecture(state.kind === 'ok' ? state.data.post.lectureId : null);
  const nickname = profile?.nickname ?? 'guest';

  /** 삭제·수정은 서버가 성공을 돌려준 뒤에만 화면을 바꾼다 */
  const removePost = (commentCount: number) =>
    confirmDestructive(t.community.deletePostTitle, t.community.deletePostBody(commentCount), { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      setActing(true);
      setActionError(null);
      try {
        await deletePost(nickname, postId);
        if (session) await removeBookmark(session, postId).catch(() => undefined);
        if (router.canGoBack()) router.back();
        else router.replace('/community');
      } catch (err) {
        setActionError(apiErrorText(t, err));
      } finally {
        setActing(false);
      }
    });
  const removeComment = (id: number) =>
    confirmDestructive(t.community.deleteCommentTitle, t.community.deleteCommentBody, { ok: t.common.ok, cancel: t.common.cancel }, async () => {
      setActing(true);
      setActionError(null);
      try {
        await deleteComment(nickname, id);
        load();
      } catch (err) {
        setActionError(apiErrorText(t, err));
      } finally {
        setActing(false);
      }
    });
  const saveComment = async () => {
    if (!editing || acting) return;
    const text = editing.body.trim();
    if (!text) return setActionError(t.community.errComment);
    setActing(true);
    setActionError(null);
    try {
      await updateComment(nickname, editing.id, text);
      setEditing(null);
      load();
    } catch (err) {
      setActionError(`${apiErrorText(t, err)} ${t.community.keptInput}`);
    } finally {
      setActing(false);
    }
  };

  if (!validId) {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="danger" text={t.community.postNotFound} />
      </Screen>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Screen layout="reading" edges={['bottom']}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} accessibilityLabel={t.community.loading} />
      </Screen>
    );
  }
  if (state.kind === 'error') {
    const notFound = (state.error as { status?: number }).status === 404;
    return (
      <Screen layout="reading" edges={['bottom']}>
        <Notice tone="danger" text={notFound ? t.community.postNotFound : apiErrorText(t, state.error)} />
        {!notFound && <Button testID="retry-post" label={t.community.retry} variant="tertiary" onPress={load} />}
      </Screen>
    );
  }

  const { post, comments } = state.data;
  const bookmarked = saved.bookmarks.some((b) => b.postId === post.id);

  return (
    <Screen layout="reading"
      edges={['bottom']}
      footerBackground={colors.surface}
      footer={
        <>
          {commentError && <Notice tone="danger" text={commentError} />}
          <TextField
            testID="comment-input"
            label={t.community.commentLabel}
            value={comment}
            onChangeText={setComment}
            placeholder={t.community.commentPlaceholder}
            maxLength={500}
            onSubmitEditing={send}
            right={
              <View style={{ width: 76 }}>
                <Button testID="comment-submit" label={t.community.commentSubmit} size="input" onPress={send} loading={sending} />
              </View>
            }
          />
          <View style={{ flexDirection: 'row', marginTop: -space.md }}>
            <Chip testID="comment-anon" label={t.community.commentAnonymous} selected={anonymous} onPress={() => setAnonymous(!anonymous)} />
          </View>
        </>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
        <Pill text={t.community.categories[post.category]} tone="accent" />
        {post.isSample ? <Pill text={t.community.sample} tone="warning" /> : null}
        {post.isDemo ? <Pill text={t.demoContent.badge} tone="warning" /> : null}
        {post.updatedAt ? <Pill text={t.community.edited} /> : null}
      </View>
      <T variant="display" header testID="post-title-view">
        {titleText.text}
      </T>
      <T variant="sub" tone="secondary" style={{ marginTop: space.xs, marginBottom: space.md }}>
        {post.author ?? t.community.anonymous}  {formatPostTime(post.createdAt, locale)}
      </T>
      <View style={{ flexDirection: 'row', marginBottom: space.sm }}>
        <Chip
          testID="toggle-bookmark"
          onGray
          icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
          label={t.saved.bookmarkAdd}
          accessibilityLabel={bookmarked ? t.saved.bookmarkRemove : t.saved.bookmarkAdd}
          selected={bookmarked}
          onPress={() => session && toggleBookmark(session, { id: post.id, title: post.title })}
        />
        {post.mine ? (
          <>
            <Chip testID="post-edit" onGray icon="create-outline" label={t.common.edit} onPress={() => router.push({ pathname: '/post-new', params: { editId: String(post.id) } })} />
            <Chip testID="post-delete" onGray icon="trash-outline" label={t.common.delete} onPress={() => removePost(comments.length)} />
          </>
        ) : null}
      </View>
      {actionError ? <Notice tone="danger" text={actionError} /> : null}
      <Block>
        <ContentText text={post.body} testID="post-body-view" />
        {lecture?.title ? (
          <Row
            title={`${t.community.linkedLecture}: ${lecture.title}`}
            chevron
            onPress={() => router.push(lectureRoute(lecture.id))}
          />
        ) : null}
      </Block>

      <Gap />
      <Block>
        <BlockHeader title={t.community.comments(comments.length)} />
        {comments.length === 0 ? (
          <EmptyText text={t.community.noComments} />
        ) : (
          comments.map((c) => (
            <View key={c.id} style={{ paddingVertical: space.md }} testID={`comment-${c.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
                <T variant="sub" style={{ fontWeight: '600' }}>
                  {c.author ?? t.community.anonymous}
                </T>
                {c.isPostAuthor ? <Pill text={t.community.writer} tone="accent" /> : null}
                {c.updatedAt ? <Pill text={t.community.edited} /> : null}
                <T variant="caption" tone="tertiary">
                  {formatPostTime(c.createdAt, locale)}
                </T>
              </View>
              {editing?.id === c.id ? (
                <View>
                  <TextField testID={`comment-edit-input-${c.id}`} label={t.community.commentLabel} value={editing.body} onChangeText={(v) => setEditing({ id: c.id, body: v })} maxLength={500} />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button testID={`comment-edit-save-${c.id}`} label={t.common.save} size="md" onPress={saveComment} loading={acting} />
                    <Button testID={`comment-edit-cancel-${c.id}`} label={t.common.cancel} size="md" variant="tertiary" onPress={() => setEditing(null)} />
                  </View>
                </View>
              ) : (
                <>
                  <ContentText text={c.body} testID={`comment-body-${c.id}`} />
                  {c.mine ? (
                    <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.xs }}>
                      <Button testID={`comment-edit-${c.id}`} label={t.common.edit} variant="text" size="md" onPress={() => setEditing({ id: c.id, body: c.body })} />
                      <Button testID={`comment-delete-${c.id}`} label={t.common.delete} variant="dangerText" size="md" onPress={() => removeComment(c.id)} />
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ))
        )}
        <Button testID="refresh-comments" label={t.community.refresh} variant="text" size="md" icon="refresh" onPress={load} />
      </Block>
    </Screen>
  );
}
