"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";

// 로그인 없이 접근 가능한 경로 — 로그아웃 상태에서 이 경로들은 리다이렉트하지 않음
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password"];

/**
 * 페이지 컴포넌트가 자체적으로 `if (!user) return null`로 조기 반환하면
 * 그 안에 있는 AppLayout이 아예 마운트되지 않아, AppLayout에만 있던 리다이렉트 로직도
 * 함께 실행되지 않는 문제가 있었음. 이 컴포넌트는 각 페이지보다 상위(Providers)에서
 * 항상 마운트되므로, 페이지의 조기 반환과 무관하게 로그인 여부를 검사할 수 있음.
 */
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!hydrated) return;
    if (!state.currentUser && !PUBLIC_PATHS.includes(pathname)) {
      // 비회원이 /dashboard, /my-leaves 등 특정 링크로 바로 들어왔을 때, 로그인 후
      // 그 링크로 되돌아갈 수 있도록 원래 경로를 next 파라미터로 실어 보냄
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [hydrated, state.currentUser, pathname, router]);

  return <>{children}</>;
}
