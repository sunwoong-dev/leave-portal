import type { LeaveGrant, LeaveRequest, LeaveType } from "./types";

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
 * "총 연차"/"잔여" 산술에 쓰는 값 — 만료 안 된 부여의 액면가 합계.
 * 사용 여부는 반영하지 않는다(사용분은 이미 usedLeave/leaveBalance 쪽에서 차감되므로,
 * 여기서 또 빼면 이중차감이 된다). 오직 "만료로 소멸"됐을 때만 줄어든다.
 */
export function grantCeilingTotal(grants: LeaveGrant[], userId: string, asOf: Date = new Date()): number {
  return grants
    .filter((g) => g.userId === userId && g.days > 0 && !isGrantExpired(g, asOf))
    .reduce((sum, g) => sum + g.days, 0);
}

/**
 * "+N일 부여" 뱃지 노출 여부/문구 전용 — 산술(총 연차·잔여)에는 절대 쓰지 않는다.
 * 일부만 소진돼도 문구는 원래 부여량 그대로 유지되고, 완전히 소진(잔여 0)되거나
 * 만료됐을 때만 사라진다(부분 소진 상태를 어중간하게 보여주지 않음).
 */
export function activeGrantBalance(grants: LeaveGrant[], userId: string, asOf: Date = new Date()): number {
  return grants
    .filter((g) => g.userId === userId && g.days > 0 && !isGrantExpired(g, asOf) && effectiveRemaining(g) > 0)
    .reduce((sum, g) => sum + g.days, 0);
}

/** 만료 안 된 부여의 "아직 남은" 일수 합계 — grantCeilingTotal(액면가)과의 차이가 곧 부여 소진량 */
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
 * "사용 연차" 계산 — 정규 연차(totalLeave) 소진분과 부여(grant) 소진분을 서로 다른 기준으로 집계한다.
 *
 * 정규 소진분: 연차 연도 시작일(yearStart) 이후 신청분만 집계한다. totalLeave는 매 근속 갱신(입사
 * 주년일)마다 리셋되므로, 그 이전 신청은 이미 지난 연도에 정산되어 이번 연도 잔여와 무관하다.
 *
 * 부여 소진분: 신청일이 아니라 각 부여 건의 remainingDays로 직접 판단한다. 부여는 부여일 기준 자체
 * 만료 주기(1년)를 갖고 있어 근속 갱신일과 어긋날 수 있는데, 부여 소진 신청이 근속 갱신일보다
 * "이전"이라 yearStart 필터에 걸리지 않더라도 이미 소진된 부여를 놓치면 안 되기 때문이다.
 * (예: 근속 갱신 직전에 받은 부여 휴가를 갱신 전에 다 썼는데, 갱신 후 화면에는 여전히 안 쓴 것처럼
 * 보이는 문제 — 부여의 remainingDays로 판단하면 이 시점차를 원천적으로 피할 수 있다.)
 */
export function calcUsedLeave(
  requests: LeaveRequest[],
  grants: LeaveGrant[],
  userId: string,
  yearStart: string,
  asOf: Date = new Date(),
): number {
  const regularUsed = requests
    .filter((r) => r.userId === userId && r.status === "approved" && !NO_DEDUCTION_TYPES.includes(r.type) && r.startDate >= yearStart)
    .reduce((sum, r) => sum + (r.days - grantDeductionDays(r)), 0);

  const grantUsed = grantCeilingTotal(grants, userId, asOf) - grantRemainingTotal(grants, userId, asOf);

  return regularUsed + grantUsed;
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

/** 만료됐는데 아직 정리 안 된(remainingDays > 0) 부여 목록 — 로그인 시 leaveBalance 회수용 */
export function findExpiredUnclaimedGrants(grants: LeaveGrant[], userId: string, asOf: Date = new Date()): LeaveGrant[] {
  return grants.filter((g) => g.userId === userId && g.days > 0 && effectiveRemaining(g) > 0 && isGrantExpired(g, asOf));
}
