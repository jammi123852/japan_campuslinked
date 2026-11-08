import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, View } from 'react-native';

import { Block, BlockHeader, Button, Chip, EmptyText, Gap, Notice, Pill, Screen, T, TextField, useWide } from '@/components/ui';
import { useCourseName } from '@/data/useCourseName';
import type { TimetableEntry } from '@/data/types';
import { entriesForPeriod } from '@/features/academic/academicLogic';
import { findPlaces, parseRoom, type CampusBuilding, type RoomInfo } from '@/features/campus/campusLogic';
import { campusBase, useCampus } from '@/features/campus/useCampus';
import { useOfficial } from '@/features/official/useOfficial';
import { useI18n } from '@/i18n';
import { usePeriod } from '@/services/periodRepository';
import { loadEditableTimetable, useTimetableVersion } from '@/services/timetableRepository';
import { useApp } from '@/state/AppContext';
import { colors, space } from '@/theme/tokens';

/** 캠퍼스 지도: 공식 바리어프리 맵 위에서 건물 설명을 보고 강의실·시설 위치를 찾는다. 주소: /campus?room=S201 · /campus?q=보건실 · /campus?building=b1 */
export default function CampusScreen() {
  const { session } = useApp();
  const { t, locale } = useI18n();
  const cn = useCourseName();
  const wide = useWide();
  const params = useLocalSearchParams<{ room?: string; q?: string; building?: string }>();
  const { loading, data } = useCampus();
  const official = useOfficial();
  const per = usePeriod(session, official.kind === 'ok' ? official.data : null);
  const version = useTimetableVersion();
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [query, setQuery] = useState(params.room ?? params.q ?? '');
  const [selected, setSelected] = useState<string | null>(params.building ?? null);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [unknownRoom, setUnknownRoom] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    loadEditableTimetable(session, t).then((r) => alive && setEntries(r.entries));
    return () => {
      alive = false;
    };
  }, [session, t, version]);

  const mapWidth = wide ? 900 : 760;
  const mapHeight = data ? Math.round((mapWidth * data.map.height) / data.map.width) : 0;
  const nameOf = (b: CampusBuilding) => (locale === 'ja' ? b.ja : b.ko);
  const hits = useMemo(() => (data && query.trim() ? findPlaces(data, query) : []), [data, query]);

  const focus = (b: CampusBuilding) => {
    setSelected(b.id);
    scroll.current?.scrollTo({ x: Math.max(0, (b.x / 100) * mapWidth - 160), animated: true });
  };
  const showRoom = (raw: string) => {
    if (!data) return;
    const r = parseRoom(raw);
    const b = r ? data.buildings.find((x) => x.id === r.buildingId) : null;
    setRoom(r);
    setUnknownRoom(b ? null : raw);
    if (b) focus(b);
    else setSelected(null);
  };

  // 주소로 들어온 강의실·검색어를 지도에 표시한다 (자료를 받은 뒤 한 번)
  const opened = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!data || opened.current) return;
    opened.current = true;
    if (params.room) showRoom(params.room);
    else if (params.q) {
      const first = findPlaces(data, params.q)[0];
      if (first) {
        setRoom(first.room);
        focus(first.building);
      }
    } else if (params.building) {
      const b = data.buildings.find((x) => x.id === params.building);
      if (b) focus(b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const current = data?.buildings.find((b) => b.id === selected) ?? null;
  const periodEntries = per.period ? entriesForPeriod(entries, per.period) : entries;
  const myRooms = [...new Map(periodEntries.filter((e) => e.room).map((e) => [`${e.courseName}|${e.room}`, e])).values()];

  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.huge }} accessibilityLabel={t.common.loading} />;
  if (!data) {
    return (
      <Screen edges={['bottom']}>
        <Notice tone="warning" text={t.campus.missing} />
        <Button testID="campus-official" label={t.campus.officialMap} variant="tertiary" onPress={() => Linking.openURL('https://www.kyusan-u.ac.jp/guide/summary/campus.html')} />
      </Screen>
    );
  }
  const floorText = (r: RoomInfo) => t.campus.roomLine(r.wing, r.floor, r.number);

  return (
    <Screen edges={['bottom']}>
      <Block testID="campus-search">
        <TextField
          testID="campus-query"
          label={t.campus.searchLabel}
          placeholder={t.campus.searchPh}
          value={query}
          autoCorrect={false}
          onChangeText={(v) => {
            setQuery(v);
            setRoom(null);
            setUnknownRoom(null);
          }}
        />
        {query.trim() && hits.length === 0 ? <T variant="sub" tone="secondary" testID="campus-noresult">{t.campus.noResult}</T> : null}
        {hits.map((h) => (
          <Pressable
            key={h.building.id}
            testID={`campus-hit-${h.building.id}`}
            accessibilityRole="button"
            onPress={() => {
              setRoom(h.room);
              focus(h.building);
            }}
            style={({ pressed }) => [{ paddingVertical: space.sm, minHeight: 44, borderTopWidth: 1, borderTopColor: colors.divider }, pressed && { opacity: 0.6 }]}
          >
            <T variant="body" style={{ fontWeight: '700' }}>{nameOf(h.building)}{h.room ? ` · ${floorText(h.room)}` : ''}</T>
            {h.facility ? <T variant="caption" tone="secondary">{locale === 'ja' ? h.facility.ja : h.facility.ko}</T> : null}
          </Pressable>
        ))}
        {myRooms.length ? (
          <View testID="campus-my-rooms" style={{ marginTop: space.sm }}>
            <T variant="sub" style={{ fontWeight: '700' }}>{t.campus.myRooms}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {myRooms.slice(0, 12).map((e) => (
                <Chip key={e.id} testID={`campus-my-${e.id}`} label={`${cn(e.courseName)} ${e.room}`} onPress={() => { setQuery(''); showRoom(e.room!); }} />
              ))}
            </View>
          </View>
        ) : null}
      </Block>
      <Gap />
      {unknownRoom ? <View testID="campus-room-unknown"><Notice tone="warning" text={t.campus.roomUnknown(unknownRoom)} /></View> : null}
      {current ? (
        <>
          <Block testID="campus-detail">
            <BlockHeader title={nameOf(current)} />
            <T variant="caption" tone="tertiary">{locale === 'ja' ? current.groupJa : current.groupKo}</T>
            {room && room.buildingId === current.id ? (
              <View testID="campus-room" style={{ marginTop: space.xs, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
                <T variant="body" tone="accent" style={{ fontWeight: '700' }}>{room.raw}: {nameOf(current)} {floorText(room)}</T>
                <Pill text={t.campus.basis[room.basis]} tone={room.basis === 'inferred' ? 'warning' : 'neutral'} />
              </View>
            ) : null}
            {current.facilities.length ? (
              <View style={{ marginTop: space.xs }}>
                {current.facilities.map((f) => <T key={f.ko} variant="sub">• {locale === 'ja' ? f.ja : f.ko}</T>)}
              </View>
            ) : null}
            <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.campus.noFloorPlan}</T>
          </Block>
          <Gap />
        </>
      ) : null}
      <Block flush testID="campus-map-block">
        <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator>
          <View testID="campus-map" style={{ width: mapWidth, height: mapHeight }}>
            <Image source={{ uri: `${campusBase()}${data.map.src}` }} accessibilityLabel={t.campus.mapAlt} style={{ width: mapWidth, height: mapHeight }} resizeMode="contain" />
            {data.buildings.map((b) => {
              const on = b.id === selected;
              return (
                <Pressable
                  key={b.id}
                  testID={`campus-marker-${b.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={nameOf(b)}
                  onPress={() => { setRoom(null); setUnknownRoom(null); focus(b); }}
                  style={{ position: 'absolute', left: `${b.x}%`, top: `${b.y}%`, width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.accent : colors.surface, borderWidth: 2, borderColor: colors.accent, zIndex: on ? 2 : 1 }}
                >
                  <T variant="caption" style={{ fontWeight: '700', color: on ? colors.surface : colors.accentSoftText }}>{b.mark}</T>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Block>
      <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.campus.mapHint}</T>
      {!current && !unknownRoom ? <EmptyText text={t.campus.pickHint} /> : null}
      <Gap />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        <Button testID="campus-official-search" label={t.campus.officialSearch} variant="tertiary" size="md" icon="open-outline" onPress={() => Linking.openURL(data.links.search)} />
        <Button testID="campus-official-map" label={t.campus.officialMap} variant="tertiary" size="md" icon="open-outline" onPress={() => Linking.openURL(data.links.map)} />
      </View>
      <T variant="caption" tone="tertiary" style={{ marginTop: space.xs }}>{t.campus.sourceNote}</T>
      <Gap />
    </Screen>
  );
}
