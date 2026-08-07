import type { LeaveGrant } from "./types";
import { getCompletedMonths, round1 } from "./leaveCalc";
import { grantExpiryDate, isGrantExpired } from "./grantLedger";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "총 연차" 툴팁 — 월차/연차/부여가 각각 어떻게 계산됐는지 사람이 읽을 수 있는 문장으로 설명 */
export function explainTotalLeave(joinDate: string, grants: LeaveGrant[], userId: string, asOf: Date = new Date()): string {
  if (!joinDate) return "입사일 정보가 없어 기본값(15일)이 적용됩니다.";

  const lines: string[] = [];
  const join = new Date(joinDate + "T00:00:00");
  const months = getCompletedMonths(joinDate, asOf);
  const hireYear = join.getFullYear();
  const fiscalYear = asOf.getFullYear();

  // 월차
  if (months < 12) {
    const earned = Math.min(months, 11);
    const anniversary = new Date(hireYear + 1, join.getMonth(), join.getDate());
    lines.push(`· 월차 ${earned}일 — 근속 ${months}개월째, 만근 시 매월 1일씩 발생(최대 11일). ${fmtDate(anniversary)}(입사 1년)에 미사용분까지 통째로 소멸.`);
  } else {
    lines.push(`· 월차 0일 — 입사 1년이 지나 이미 소멸됨(매달 쌓이던 월차는 근속 1년 시점에 남은 만큼 그대로 사라짐).`);
  }

  // 연차 (회계연도 기준)
  if (fiscalYear === hireYear) {
    lines.push(`· 연차 0일 — 아직 첫 회계연도(다음 해 1/1)가 지나지 않아 발생 전.`);
  } else {
    const yearsEquiv = fiscalYear - hireYear;
    const base = Math.min(15 + Math.floor((yearsEquiv - 1) / 2), 25);
    if (fiscalYear === hireYear + 1) {
      const yearEnd = new Date(hireYear, 11, 31);
      const daysWorked = Math.floor((yearEnd.getTime() - join.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const prorated = round1(base * (daysWorked / 365));
      lines.push(`· 연차 ${prorated}일 — 입사연도(${hireYear}년) 재직일수 ${daysWorked}일 ÷ 365 × 15일 비례 계산.`);
    } else {
      lines.push(`· 연차 ${base}일 — 근속 ${yearsEquiv}년차. 기본 15일 + 2년마다 1일 가산(최대 25일).`);
    }
  }

  // 부여 (다 쓴 건 표시 안 함 — 월차처럼 흔적 없이 사라짐)
  const activeGrants = grants.filter((g) => g.userId === userId && g.days > 0 && !isGrantExpired(g, asOf));
  for (const g of activeGrants) {
    const remaining = g.remainingDays ?? g.days;
    if (remaining <= 0) continue;
    lines.push(`· 부여 ${remaining}일 (${g.reason}) — ${fmtDate(grantExpiryDate(g.grantedAt))}까지 미사용 시 소멸.`);
  }

  lines.push(`매년 1월 1일(회계연도) 기준으로 갱신됩니다.`);
  return lines.join("\n");
}

/** "사용 연차" 툴팁 */
export function explainUsedLeave(used: number): string {
  return [
    `사용 ${used}일 — 실제로 연차(또는 아직 살아있는 월차)에서 빠진 날짜만 집계합니다.`,
    ``,
    `소진 우선순위: 월차 → 부여 → 연차 순으로 먼저 있는 것부터 씁니다(소멸 시기가 빠른 것부터).`,
    ``,
    `이미 소멸된 월차의 사용분, 이미 다 쓴 부여의 사용분은 "총 연차"에서도 같이 빠지기 때문에 여기 사용량에는 다시 잡히지 않습니다(이중 차감 방지).`,
  ].join("\n");
}

/** "잔여 연차" 툴팁 */
export function explainRemaining(): string {
  return `잔여 = 총 연차 − 사용 연차.\n총 연차·사용 연차 각각의 계산 기준은 옆의 물음표를 참고하세요.`;
}
