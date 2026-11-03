import { NativeModules, Platform } from 'react-native';

import type { OcrLine } from '@/features/timetableImport/parseTimetable';

/**
 * 기기 안 OCR (Google ML Kit, @react-native-ml-kit/text-recognition).
 * 사진은 기기 밖으로 나가지 않는다. 네이티브 모듈이라 Expo Go·웹에서는 동작하지 않고
 * 개발 빌드(npx expo run:android / eas build --profile development)에서만 쓸 수 있다.
 */

export type OcrScript = 'japanese' | 'korean';

export class OcrUnavailableError extends Error {
  constructor() {
    super('OCR native module is not available in this build');
    this.name = 'OcrUnavailableError';
  }
}

/** 이 빌드에 ML Kit 네이티브 모듈이 들어 있는지 */
export function isOcrAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  return NativeModules.TextRecognition != null;
}

export async function recognizeLines(imageUri: string, script: OcrScript): Promise<OcrLine[]> {
  if (!isOcrAvailable()) throw new OcrUnavailableError();
  // 네이티브 모듈이 없는 환경에서 import 시점에 터지지 않도록 필요할 때만 불러온다
  const mod = await import('@react-native-ml-kit/text-recognition');
  const TextRecognition = mod.default;
  const result = await TextRecognition.recognize(
    imageUri,
    script === 'japanese' ? mod.TextRecognitionScript.JAPANESE : mod.TextRecognitionScript.KOREAN,
  );
  const lines: OcrLine[] = [];
  for (const block of result.blocks) {
    for (const line of block.lines) {
      if (!line.frame) continue;
      lines.push({
        text: line.text,
        frame: { left: line.frame.left, top: line.frame.top, width: line.frame.width, height: line.frame.height },
      });
    }
  }
  return lines;
}
