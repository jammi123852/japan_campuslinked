import { Alert, Platform } from 'react-native';

/** 되돌릴 수 없는 동작 확인. 웹에서는 Alert.alert 버튼이 동작하지 않아 window.confirm 을 쓴다 */
export function confirmDestructive(
  title: string,
  message: string,
  labels: { ok: string; cancel: string },
  onOk: () => void,
) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n${message}`)) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: labels.cancel, style: 'cancel' },
    { text: labels.ok, style: 'destructive', onPress: onOk },
  ]);
}
