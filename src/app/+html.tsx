import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * 웹 정적 빌드의 HTML 머리말 (웹에서만 쓰임, 앱에는 영향 없음).
 * 기본 머리말과 같은 항목에 링크 미리보기(Open Graph) 태그를 더한다.
 * SDK 58: 스크립트·스타일·파비콘은 headNodes/bodyNodes 로 들어오므로 반드시 그대로 렌더링한다(빠지면 빈 화면).
 * 미리보기 이미지는 전체 주소가 필요하므로 EXPO_PUBLIC_SITE_URL(예: https://campuslinked.io)을 넣고 빌드할 때만 이미지·주소 태그를 쓴다.
 */
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
const TITLE = 'CampusLinked';
const DESCRIPTION = '시간표·강의 후기·질문 게시판·마감을 한곳에서. 대학생을 위한 캠퍼스 앱 (발표용 데모, 가상 샘플 데이터)';

export default function Root({ children }: PropsWithChildren) {
  const { htmlAttributes, bodyAttributes, headNodes, bodyNodes } = useServerDocumentContext();
  return (
    <html lang="ko" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={TITLE} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:locale" content="ko_KR" />
        {SITE_URL ? (
          <>
            <meta property="og:url" content={`${SITE_URL}/`} />
            <meta property="og:image" content={`${SITE_URL}/og-image.png?v=2`} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta property="og:image:alt" content={TITLE} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:image" content={`${SITE_URL}/og-image.png?v=2`} />
          </>
        ) : null}
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        {/* A안 글꼴: 본문 Noto Sans JP/KR, 제목 Shippori Mincho/Noto Serif KR (Google Fonts, 글자 범위별로 필요한 조각만 내려받음) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&family=Noto+Serif+KR:wght@600;700&family=Shippori+Mincho:wght@600;700&display=swap"
        />
        <style>{'body{background-color:#FAFAF7}'}</style>
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
