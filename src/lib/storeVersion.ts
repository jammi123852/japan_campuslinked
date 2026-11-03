import { useEffect, useState } from 'react';

/**
 * 기기 저장소가 바뀌었음을 구독 중인 화면에 알리는 버전 번호 (timetableRepository 와 같은 방식).
 * 저장 함수가 bump() 하면, useVersion() 을 의존성으로 쓰는 화면이 다시 읽는다.
 */
export function createVersion() {
  let version = 0;
  const listeners = new Set<(v: number) => void>();
  return {
    bump() {
      version += 1;
      listeners.forEach((l) => l(version));
    },
    useVersion() {
      const [v, setV] = useState(version);
      useEffect(() => {
        listeners.add(setV);
        return () => {
          listeners.delete(setV);
        };
      }, []);
      return v;
    },
  };
}
