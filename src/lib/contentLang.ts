/** 글의 언어 판별 (순수 함수). 한글이 있으면 ko, 가나·한자가 있으면 ja, 숫자·영어뿐이면 null(번역 안 함) */
export function detectContentLang(text: string | null | undefined): 'ko' | 'ja' | null {
  if (!text) return null;
  let hangul = 0;
  let kana = 0;
  let kanji = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0xac00 && c <= 0xd7a3) hangul += 1;
    else if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0xff66 && c <= 0xff9d)) kana += 1;
    else if (c >= 0x4e00 && c <= 0x9fff) kanji += 1;
  }
  if (hangul === 0 && kana === 0 && kanji === 0) return null;
  // 한국어 글 속 일본 과목명처럼 섞인 경우 많은 쪽을 따른다
  return hangul >= kana + kanji ? 'ko' : 'ja';
}
