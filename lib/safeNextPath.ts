/**
 * 로그인 후 원래 가려던 경로로 돌려보내기 위한 ?next= 값 검증.
 * "/"로 시작하는 같은 출처의 상대경로만 허용 — "//evil.com"이나 "https://evil.com" 같은
 * 오픈 리다이렉트로 악용될 수 있는 값은 전부 거부한다.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("://")) return null;
  return next;
}
