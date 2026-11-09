/** 공개 데모 빌드 여부. `EXPO_PUBLIC_STATIC_DEMO=1` 로 빌드할 때만 켜진다 (scripts/deploy-demo-pages.sh) */
export const STATIC_DEMO = process.env.EXPO_PUBLIC_STATIC_DEMO === '1';
