// 퇴사 처리 시 이름을 비가역적으로 부분 마스킹. 예: "문선웅" -> "문*웅", "홍길" -> "홍*"
// 관리자가 퇴사자 목록에서 누구인지 어느 정도 식별은 가능하되, 원본 전체 이름은 DB에 남기지 않음.
// 복직 처리 시엔 원본을 복원할 수 없으므로 관리자가 직접 이름을 재입력해야 함.
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 1) return "*";
  if (trimmed.length === 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${"*".repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`;
}
