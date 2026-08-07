/** 소수 둘째 자리 반올림해서 첫째 자리까지. 화면에 두 값을 더하거나 뺀 걸 표시할 때 항상
 * 이걸 거쳐야 한다 — 각 값 자체는 반올림돼 있어도 그 둘을 다시 연산하면 부동소수점 오차로
 * 16.7 - 11 이 5.699999999999999 처럼 나올 수 있다. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function getCompletedMonths(joinDate: string, asOfDate: Date = new Date()): number {
  if (!joinDate) return 0;

  const join = new Date(joinDate);
  let months =
    (asOfDate.getFullYear() - join.getFullYear()) * 12 +
    (asOfDate.getMonth() - join.getMonth());

  if (asOfDate.getDate() < join.getDate()) months--;
  return Math.max(0, months);
}

/**
 * 회계연도(매년 1/1) 기준 연차 산정. 월차와 연차는 서로 다른 풀이라 전환기(입사 다음 회계연도)엔
 * 두 풀이 동시에 존재할 수 있어 합산해서 반환한다.
 * - 월차 풀: 근속 1년 미만 동안만 존재 (만근 매월 1일, 최대 11일, 개인 입사일 기준). 근속 1년
 *   되는 날 미사용분까지 통째로 소멸 — 그 이후엔 이 함수가 자동으로 0을 반환한다.
 * - 연차 풀: 입사 다음 회계연도(hireYear+1)부터 매년 1/1에 생성. 첫 해는
 *   15 × (입사연도 재직일수/365) 비례연차(소수 첫째자리 반올림), 이후는 15 + 2년마다 1일 가산(최대 25).
 */
export function calcTotalLeave(joinDate: string, asOfDate: Date = new Date()): number {
  if (!joinDate) return 15;

  const months = getCompletedMonths(joinDate, asOfDate);
  const monthlyPart = months < 12 ? Math.min(months, 11) : 0;

  const join = new Date(joinDate + "T00:00:00");
  const hireYear = join.getFullYear();
  const fiscalYear = asOfDate.getFullYear();

  let annualPart = 0;
  if (fiscalYear > hireYear) {
    const yearsEquiv = fiscalYear - hireYear;
    const base = Math.min(15 + Math.floor((yearsEquiv - 1) / 2), 25);
    if (fiscalYear === hireYear + 1) {
      const yearEnd = new Date(hireYear, 11, 31);
      const daysWorked = Math.floor((yearEnd.getTime() - join.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      annualPart = base * (daysWorked / 365);
    } else {
      annualPart = base;
    }
  }

  return round1(monthlyPart + annualPart);
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
 * 현재 "연차"(회계연도 풀) 집계 시작일 반환 (YYYY-MM-DD). 월차 사용/소멸 여부와 무관하게, 연차 풀이
 * 아직 한 번도 생성되지 않은 입사 당해년도만 입사일을 기준으로 삼고, 그 다음부터는 매년 1/1.
 */
export function currentLeaveYearStart(joinDate: string, asOfDate: Date = new Date()): string {
  if (!joinDate) return "1970-01-01";
  const join = new Date(joinDate + "T00:00:00");
  if (asOfDate.getFullYear() === join.getFullYear()) return joinDate;
  return `${asOfDate.getFullYear()}-01-01`;
}

/**
 * 다음 연차 갱신(회계연도 시작일, 1/1)까지 남은 일수.
 * 입사 당해년도(아직 연차 풀이 한 번도 생성 안 됨)면 해당 없음(null).
 */
export function daysUntilLeaveRenewal(joinDate: string, asOfDate: Date = new Date()): number | null {
  if (!joinDate) return null;
  const join = new Date(joinDate + "T00:00:00");
  if (asOfDate.getFullYear() === join.getFullYear()) return null;
  const nextRenewal = new Date(asOfDate.getFullYear() + 1, 0, 1);
  const diffMs = nextRenewal.getTime() - asOfDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
