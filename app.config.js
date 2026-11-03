// app.json 을 기본으로 쓰고, 발표용 웹 배포 때만 아래 환경변수로 웹 출력을 바꾼다.
// 개발 서버(npx expo start)에는 영향이 없다.
//   KSU_WEB_DEPLOY=1        경로마다 HTML 을 만드는 정적 출력(output: "static")
//   KSU_WEB_BASE_URL=/repo  GitHub Pages 처럼 하위 경로에서 서비스할 때의 기준 경로
// 배포 절차는 docs/HANDOFF.md 참고.
module.exports = ({ config }) => {
  if (process.env.KSU_WEB_DEPLOY !== '1') return config;
  return {
    ...config,
    web: { ...config.web, output: 'static' },
    experiments: {
      ...config.experiments,
      ...(process.env.KSU_WEB_BASE_URL ? { baseUrl: process.env.KSU_WEB_BASE_URL } : {}),
    },
  };
};
