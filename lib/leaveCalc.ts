function getCompletedMonths(joinDate: string, asOfDate: Date = new Date()): number {
  if (!joinDate) return 0;

  const join = new Date(joinDate);
  let months =
    (asOfDate.getFullYear() - join.getFullYear()) * 12 +
    (asOfDate.getMonth() - join.getMonth());

  if (asOfDate.getDate() < join.getDate()) months--;
  return Math.max(0, months);
}

export function calcTotalLeave(joinDate: string, asOfDate: Date = new Date()): number {
  if (!joinDate) return 15;

  const months = getCompletedMonths(joinDate, asOfDate);

  if (months < 12) {
    return Math.min(months, 11);
  }

  const years = Math.floor(months / 12);
  return Math.min(15 + Math.floor((years - 1) / 2), 25);
}

/** 입사일 기준 레이블 반환 (예: "3년 2개월차") */
export function getTenureLabel(joinDate: string): string {
  if (!joinDate) return "";

  const months = getCompletedMonths(joinDate, new Date());
  const years = Math.floor(months / 12);
  const remainMonths = months % 12;

  if (years === 0) return `${remainMonths}개월차`;
  if (remainMonths === 0) return `${years}년차`;
  return `${years}년 ${remainMonths}개월차`;
}

/** 월차/연차 구분 레이블 (asOfDate 기준 — 기본값은 오늘) */
export function getLeaveTypeLabel(joinDate: string, asOfDate: Date = new Date()): "월차" | "연차" {
  if (!joinDate) return "연차";
  const months = getCompletedMonths(joinDate, asOfDate);
  return months < 12 ? "월차" : "연차";
}

/**
 * 현재 연차 연도의 시작일 반환 (YYYY-MM-DD)
 * - 월차 구간 (< 12개월): 입사일 (전체 이력 집계)
 * - 연차 구간 (≥ 12개월): 가장 최근 입사 주년일
 */
export function currentLeaveYearStart(joinDate: string): string {
  if (!joinDate) return "1970-01-01";
  const months = getCompletedMonths(joinDate);
  if (months < 12) return joinDate;
  const years = Math.floor(months / 12);
  const join = new Date(joinDate + "T00:00:00");
  const start = new Date(join.getFullYear() + years, join.getMonth(), join.getDate());
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
}
