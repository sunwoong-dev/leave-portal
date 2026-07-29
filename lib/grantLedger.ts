import type { LeaveGrant } from "./types";

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
