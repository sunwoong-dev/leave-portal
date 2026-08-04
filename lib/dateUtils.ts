// Date.toISOString()은 UTC 기준이라, KST(UTC+9)에서는 자정~오전 9시 사이에
// 날짜가 하루 밀려 표시되는 문제가 있었음. 항상 로컬(브라우저) 시간대 기준으로
// YYYY-MM-DD를 만들기 위한 공용 헬퍼 — "오늘 날짜"/캘린더 날짜 문자열은 전부 이걸로 통일.
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayLocalStr(): string {
  return toLocalDateStr(new Date());
}

// "YYYY-MM-DD" 문자열에 연 단위를 더해 다시 "YYYY-MM-DD"로 반환 (퇴사자 데이터 3년 보관 기한 계산용)
export function addYearsToDateStr(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setFullYear(dt.getFullYear() + years);
  return toLocalDateStr(dt);
}
