import type { LeaveGrant, LeaveRequest, LeaveType } from "./types";
import { calcTotalLeave, currentLeaveYearStart, getCompletedMonths, round1 } from "./leaveCalc";

/**
 * 부여(양수) 연차의 만료일 계산.
 * 규칙: 부여일로부터 "정확히 1년" 후를 만료 기준으로 하되, 마지막 날은 만료일-1일까지 포함.
 * 예) 2026-04-01 부여 → 2027-04-01 - 1일 = 2027-03-31까지 사용 가능, 그 다음날부터 소멸.
 */
export function grantExpiryDate(grantedAt: string): Date {
  const d = new Date(grantedAt);
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isGrantExpired(grant: LeaveGrant, asOf: Date = new Date()): boolean {
  if (grant.days <= 0) return false; // 차감 기록은 만료 대상 아님
  return asOf.getTime() > grantExpiryDate(grant.grantedAt).getTime();
}

function effectiveRemaining(grant: LeaveGrant): number {
  return grant.remainingDays ?? grant.days;
}

/**
 * "총 연차"/"잔여"/"+N일 부여" 뱃지에 공통으로 쓰는 값 — 만료 안 된 부여의 "지금 남은" 일수 합계.
 * 월차와 똑같이 다룬다: 다 쓴 부여는 총/사용/잔여 어디에도 흔적을 남기지 않고 그냥 사라진다
 * (사용분은 calcUsedLeave에 잡히지 않음 — 총에서도 안 잡히니 서로 상쇄해서 0으로 떨어짐).
 */
export function grantRemainingTotal(grants: LeaveGrant[], userId: string, asOf: Date = new Date()): number {
  return grants
    .filter((g) => g.userId === userId && g.days > 0 && !isGrantExpired(g, asOf))
    .reduce((sum, g) => sum + effectiveRemaining(g), 0);
}

const NO_DEDUCTION_TYPES: LeaveType[] = ["sick", "reservist"];

function grantDeductionDays(req: LeaveRequest): number {
  return (req.grantDeductions ?? []).reduce((sum, d) => sum + d.days, 0);
}

/**
 * 부여를 제외한 나머지(=netDays, 부여로 못 채운 분)를 월차 → 연차 순으로 가상 배분한다.
 * 전체 우선순위는 월차 > 부여 > 연차 — 부여 소비 계획(applyLeaveDeduction)이 이 함수로 먼저
 * "월차로 감당 가능한 만큼"을 뺀 나머지에 대해서만 부여를 소비하도록 짜여 있어, 여기 들어오는
 * netDays는 이미 그 순서가 반영된 값이다. 월차 풀은 신청 시점의 근속 개월수로 그때그때의 캡
 * (최대 11)을 계산하고, 근속 1년 도달 이후 신청은 캡이 0(월차 소멸)이라 자동으로 연차 쪽에
 * 잡힌다 — 별도 "소멸 처리" 없이 자연히 성립.
 */
export function simulateBaseConsumption(
  requests: LeaveRequest[],
  userId: string,
  joinDate: string,
  yearStart: string,
): { monthlyUsed: number; annualUsedThisYear: number } {
  const sorted = requests
    .filter((r) => r.userId === userId && r.status === "approved" && !NO_DEDUCTION_TYPES.includes(r.type))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  let monthlyUsed = 0;
  let annualUsedThisYear = 0;
  for (const r of sorted) {
    const netDays = r.days - grantDeductionDays(r);
    if (netDays <= 0) continue;
    const tenureMonths = getCompletedMonths(joinDate, new Date(r.startDate));
    const monthlyCap = tenureMonths < 12 ? Math.min(tenureMonths, 11) : 0;
    const availableMonthly = Math.max(0, monthlyCap - monthlyUsed);
    const fromMonthly = Math.min(availableMonthly, netDays);
    monthlyUsed += fromMonthly;
    const remainder = netDays - fromMonthly;
    if (r.startDate >= yearStart) annualUsedThisYear += remainder;
  }
  return { monthlyUsed, annualUsedThisYear };
}

/**
 * "사용 연차" 계산 — 월차/연차 소진분만 집계한다(전체 우선순위: 월차 > 부여 > 연차).
 * 부여 소진분은 여기 안 잡힌다 — 부여는 월차처럼 "다 쓰면 총에서도 같이 사라지는" 취급이라,
 * 총(grantRemainingTotal)에서 이미 안 보이는 이상 사용량에도 남길 필요가 없다(안 그러면
 * 총 0인데 사용만 남아 "마이너스처럼" 보이는 이상한 그림이 됨).
 *
 * 월차 소진분은 월차가 아직 살아있는 동안(근속 1년 미만)만 포함하고 소멸 후에는 제외한다 —
 * 이미 쓴 월차가 소멸 시점에 연차에서 또 깎이는 이중 차감을 막기 위함(부여와 동일한 원리).
 */
export function calcUsedLeave(
  requests: LeaveRequest[],
  userId: string,
  joinDate: string,
  yearStart: string,
  asOf: Date = new Date(),
): number {
  const { monthlyUsed, annualUsedThisYear } = simulateBaseConsumption(requests, userId, joinDate, yearStart);
  const monthlyExpired = getCompletedMonths(joinDate, asOf) >= 12;
  return (monthlyExpired ? 0 : monthlyUsed) + annualUsedThisYear;
}

/** "총 연차(월차+연차) + 부여 잔여 - 월차/연차 사용"을 한 번에 계산 — leaveBalance에 그대로 SET하는 값. */
export function calcRemainingLeave(
  requests: LeaveRequest[],
  grants: LeaveGrant[],
  userId: string,
  joinDate: string,
  asOf: Date = new Date(),
): number {
  const totalLeave = calcTotalLeave(joinDate, asOf);
  const yearStart = currentLeaveYearStart(joinDate, asOf);
  const used = calcUsedLeave(requests, userId, joinDate, yearStart, asOf);
  const granted = grantRemainingTotal(grants, userId, asOf);
  return round1(totalLeave + granted - used);
}

export interface GrantConsumption {
  grantId: string;
  days: number;
}

/**
 * 휴가 승인 시 소비할 부여 연차를 오래된 것부터(FIFO) 계획.
 * 부여分으로 충당 못하는 나머지는 개인 연차(leaveBalance)에서 그대로 차감됨(호출부에서 처리).
 */
export function planGrantConsumption(
  grants: LeaveGrant[],
  userId: string,
  daysNeeded: number,
  asOf: Date = new Date()
): GrantConsumption[] {
  if (daysNeeded <= 0) return [];
  const active = grants
    .filter((g) => g.userId === userId && g.days > 0 && !isGrantExpired(g, asOf) && effectiveRemaining(g) > 0)
    .sort((a, b) => a.grantedAt.localeCompare(b.grantedAt));

  const plan: GrantConsumption[] = [];
  let remaining = daysNeeded;
  for (const g of active) {
    if (remaining <= 0) break;
    const avail = effectiveRemaining(g);
    const take = Math.min(avail, remaining);
    if (take > 0) {
      plan.push({ grantId: g.id, days: take });
      remaining -= take;
    }
  }
  return plan;
}

