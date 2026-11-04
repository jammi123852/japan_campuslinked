import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { Button, Chip, Notice, Screen, Segmented, T, TextField } from '@/components/ui';
import { LECTURES } from '@/data/lectures';
import { useAnyLecture } from '@/features/official/useAnyLecture';
import { apiErrorText } from '@/features/community/usePosts';
import { useI18n } from '@/i18n';
import { createPost, getPost, newClientId, POST_CATEGORIES, updatePost, type PostCategory } from '@/lib/api';
import { refreshBookmarkTitle } from '@/services/savedRepository';
import { useApp } from '@/state/AppContext';
import { colors, gutter, space } from '@/theme/tokens';

type Errors = Partial<Record<'title' | 'body', string>>;

export default function PostNewScreen() {
  const { profile, session } = useApp();
  const navigation = useNavigation();
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ lectureId?: string; editId?: string }>();
  const editId = params.editId ? Number(params.editId) : null;
  const presetInfo = useAnyLecture(params.lectureId);
  const preset = params.lectureId && presetInfo ? params.lectureId : null;
  const [category, setCategory] = useState<PostCategory>('class_question');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [lectureId, setLectureId] = useState<string | null>(preset);
  const [anonymous, setAnonymous] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 같은 글을 다시 보내도(재시도) 서버가 한 번만 저장하도록 작성 화면마다 고정 id
  const [clientId] = useState(newClientId);
  const nickname = profile?.nickname ?? 'guest';
  const [loadFailed, setLoadFailed] = useState(false);

  useLayoutEffect(() => {
    if (editId) navigation.setOptions({ title: t.community.editTitle });
  }, [navigation, editId, t]);

  // 수정: 서버의 현재 글을 불러온다. 다른 사람 글이면 저장을 막는다(서버도 확인)
  useEffect(() => {
    if (!editId) return;
    let alive = true;
    getPost(editId)
      .then(({ post }) => {
        if (!alive) return;
        if (!post.mine) return setLoadFailed(true);
        setCategory(post.category);
        setTitle(post.title);
        setBody(post.body);
        setLectureId(post.lectureId);
        setAnonymous(post.anonymous);
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [editId]);

  const submit = async () => {
    if (saving) return;
    const e: Errors = {};
    if (!title.trim()) e.title = t.community.errTitle;
    else if ([...title.trim()].length > 80) e.title = t.community.errTitleLong;
    if (!body.trim()) e.body = t.community.errBody;
    else if ([...body.trim()].length > 2000) e.body = t.community.errBodyLong;
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSaving(true);
    setSubmitError(null);
    try {
      if (editId) {
        await updatePost(nickname, editId, { category, title: title.trim(), body: body.trim(), lectureId });
        if (session) await refreshBookmarkTitle(session, editId, title.trim()).catch(() => undefined);
        // 상세 화면으로 돌아가면 그 화면이 최신 글을 다시 읽는다 (화면을 쌓지 않음)
        if (router.canGoBack()) router.back();
        else router.replace({ pathname: '/post', params: { id: String(editId) } });
        return;
      }
      const { post } = await createPost(nickname, { category, title: title.trim(), body: body.trim(), lectureId, anonymous, clientId });
      router.replace({ pathname: '/post', params: { id: String(post.id) } });
    } catch (err) {
      // 실패하면 입력 내용은 그대로 두고 다시 시도할 수 있게 한다
      setSubmitError(`${apiErrorText(t, err)} ${t.community.keptInput}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen layout="reading"
      edges={['bottom']}
      background={colors.surface}
      footer={
        <>
          {submitError && <Notice tone="danger" text={submitError} />}
          <Button testID="submit-post" label={saving ? t.community.submitting : submitError ? t.community.retry : t.community.submit} onPress={submit} loading={saving} />
        </>
      }
    >
      {loadFailed ? <Notice tone="danger" text={t.community.editNotAllowed} /> : null}
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginBottom: space.sm }}>
        {t.community.category}
      </T>
      <Segmented<PostCategory>
        label={t.community.category}
        testIDPrefix="post-cat"
        value={category}
        onChange={setCategory}
        options={POST_CATEGORIES.map((c) => ({ value: c, label: t.community.categories[c] }))}
      />
      <T variant="sub" tone="secondary" style={{ fontWeight: '600', marginTop: space.xl, marginBottom: space.xs }}>
        {t.community.lectureOptional}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hScroll} contentContainerStyle={styles.hScrollContent}>
        <Chip testID="post-lecture-none" label={t.community.noLecture} selected={lectureId == null} onPress={() => setLectureId(null)} />
        {preset && presetInfo?.official ? <Chip testID="post-lecture-official" label={presetInfo.title ?? preset} selected={lectureId === preset} onPress={() => setLectureId(preset)} /> : null}
        {LECTURES.map((l) => (
          <Chip key={l.id} testID={`post-lecture-${l.id}`} label={l.name[locale]} selected={lectureId === l.id} onPress={() => setLectureId(l.id)} />
        ))}
      </ScrollView>

      <TextField testID="post-title" label={t.community.titleLabel} value={title} onChangeText={setTitle} maxLength={80} error={errors.title} />
      <TextField
        testID="post-body"
        label={t.community.bodyLabel}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        textAlignVertical="top"
        style={{ height: 160, paddingTop: space.md }}
        error={errors.body}
      />
      {editId ? null : <Segmented<'anon' | 'nick'>
        label={t.community.postAnonymous}
        testIDPrefix="post-as"
        value={anonymous ? 'anon' : 'nick'}
        onChange={(v) => setAnonymous(v === 'anon')}
        options={[
          { value: 'anon', label: t.community.postAnonymous },
          { value: 'nick', label: t.community.postAs(nickname) },
        ]}
      />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hScroll: { marginHorizontal: -gutter, marginBottom: space.lg },
  hScrollContent: { paddingHorizontal: gutter },
});
