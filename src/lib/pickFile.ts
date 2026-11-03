import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

/** 웹 전용 파일 선택. 라이브러리의 웹 구현이 고른 뒤 입력칸을 지우다 오류를 내는 경우가 있어 직접 처리한다 */
function pickOnWeb(types: string[]) {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = types.join(',');
    input.style.display = 'none';
    const done = (f: File | null) => {
      input.remove(); // 이미 없어도 오류 나지 않는다
      resolve(f);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

function fileToBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * PDF·이미지 파일 하나를 골라 base64(머리말 없이)로 돌려준다. 취소하면 null.
 * 웹: 고른 파일을 브라우저에서 읽는다. 크기 상한을 넘으면 tooLarge.
 */
export async function pickFileBase64(types: string[], maxBytes: number): Promise<
  { kind: 'ok'; base64: string; mediaType: string; name: string } | { kind: 'cancel' } | { kind: 'tooLarge' }
> {
  if (Platform.OS === 'web') {
    const file = await pickOnWeb(types);
    if (!file) return { kind: 'cancel' };
    if (file.size > maxBytes) return { kind: 'tooLarge' };
    const mediaType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    return { kind: 'ok', base64: await fileToBase64(file), mediaType, name: file.name };
  }
  const res = await DocumentPicker.getDocumentAsync({ type: types, multiple: false, base64: true });
  if (res.canceled || !res.assets?.[0]) return { kind: 'cancel' };
  const a = res.assets[0];
  if (a.size && a.size > maxBytes) return { kind: 'tooLarge' };
  const mediaType = a.mimeType ?? (a.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  let base64 = (a as { base64?: string }).base64 ?? (a.uri.startsWith('data:') ? a.uri.slice(a.uri.indexOf(',') + 1) : '');
  if (!base64) {
    const blob = await (await fetch(a.uri)).blob();
    base64 = await fileToBase64(blob);
  }
  base64 = base64.replace(/^data:[^,]+,/, '');
  return { kind: 'ok', base64, mediaType, name: a.name };
}
