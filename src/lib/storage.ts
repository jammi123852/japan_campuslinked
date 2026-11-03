import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 端末ローカル保存。キーはユーザーIDごとに名前空間を分け、
 * 同じ端末で別アカウント/デモに切り替えてもデータが混ざらないようにする。
 */
const PREFIX = 'ksu:v1';

export const StorageKeys = {
  session: `${PREFIX}:session`,
  profile: (userId: string) => `${PREFIX}:${userId}:profile`,
  userData: (userId: string, name: string) => `${PREFIX}:${userId}:data:${name}`,
};

export async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw == null ? null : (JSON.parse(raw) as T);
  } catch (e) {
    console.warn(`[storage] read failed: ${key}`, e);
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeKey(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/** 指定ユーザーの名前空間に属するキーをすべて削除する */
export async function clearUserNamespace(userId: string): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((k) => k.startsWith(`${PREFIX}:${userId}:`));
  if (mine.length > 0) await AsyncStorage.multiRemove(mine);
}
