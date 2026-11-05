/**
 * 앱을 새로 열면 웰컴 화면부터 보여 주기 위한 표시. 입장 버튼을 눌렀을 때만 켠다.
 * 웹은 탭 단위(sessionStorage)라 같은 탭의 새로고침에서는 로그인이 유지되고, 새 탭·브라우저를 다시 열면 웰컴으로 간다.
 * 앱(네이티브)은 메모리 값이라 앱을 완전히 껐다 켜면 웰컴으로 간다.
 * 시간표·이수 기록 같은 저장 데이터는 지우지 않는다.
 */
const KEY = 'ksu:v1:enteredThisLaunch';
let memory = false;

const tabStore = () => {
  try {
    return typeof window !== 'undefined' ? (window.sessionStorage ?? null) : null;
  } catch {
    return null;
  }
};

export function hasEntered() {
  try {
    return memory || tabStore()?.getItem(KEY) === '1';
  } catch {
    return memory;
  }
}

export function markEntered(on: boolean) {
  memory = on;
  try {
    if (on) tabStore()?.setItem(KEY, '1');
    else tabStore()?.removeItem(KEY);
  } catch {
    // 저장소를 쓸 수 없으면 메모리 값만 쓴다
  }
}
