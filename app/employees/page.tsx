"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useStore, makeInitials } from "@/lib/store";
import { maskName } from "@/lib/piiMask";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave, currentLeaveYearStart, daysUntilLeaveRenewal, round1 } from "@/lib/leaveCalc";
import { grantRemainingTotal, calcUsedLeave } from "@/lib/grantLedger";
import { todayLocalStr as todayStr } from "@/lib/dateUtils";

interface EmpStat {
  id: string;
  name: string;
  username: string;
  initials: string;
  joinDate: string;
  totalLeave: number;
  grantedDays: number;
  usedDays: number;
  remaining: number;
  resignationDate?: string;
}

export default function EmployeesPage() {
  const router = useRouter();
  const { state, setResignation, reinstateEmployee, showNotification } = useStore();
  const user = state.currentUser;

  useEffect(() => {
    if (user && !user.isManager) router.replace("/dashboard");
  }, [user, router]);

  const [activeTab, setActiveTab] = useState<"active" | "resigned">("active");
  const [baseEmps, setBaseEmps] = useState<Array<{ id: string; name: string; username: string; initials: string; joinDate: string; totalLeave: number; resignationDate?: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [resignTarget, setResignTarget] = useState<{ id: string; name: string } | null>(null);
  const [resignDate, setResignDate] = useState(todayStr());
  const [reinstateTarget, setReinstateTarget] = useState<{ id: string; name: string } | null>(null);
  const [rejoinDate, setRejoinDate] = useState(todayStr());
  const [rejoinName, setRejoinName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.isManager) return;
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      setBaseEmps(snap.docs
        .filter((d) => d.data().username !== "admin")
        .map((d) => {
          const data = d.data();
          const joinDate = (data.joinDate as string) ?? "";
          const storedTotal = data.totalLeave as number | undefined;
          return {
            id: d.id,
            name: data.name as string,
            username: data.username as string,
            initials: (data.initials as string) ?? (data.name as string).slice(0, 2),
            joinDate,
            totalLeave: joinDate ? calcTotalLeave(joinDate) : (storedTotal ?? 15),
            resignationDate: data.resignationDate as string | undefined,
          };
        }));
      setLoading(false);
    });
  }, [user?.isManager]);

  const empStats: EmpStat[] = useMemo(() => baseEmps
    .map((emp) => {
      const granted = grantRemainingTotal(state.leaveGrants, emp.id);
      const yearStart = currentLeaveYearStart(emp.joinDate);
      const used = calcUsedLeave(state.leaveRequests, emp.id, emp.joinDate, yearStart);
      return { ...emp, grantedDays: granted, usedDays: used, remaining: round1(emp.totalLeave + granted - used) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  [baseEmps, state.leaveGrants, state.leaveRequests]);

  const activeEmps = useMemo(() => empStats.filter((e) => !e.resignationDate), [empStats]);
  const resignedEmps = useMemo(() => empStats.filter((e) => e.resignationDate), [empStats]);
  const visibleEmps = activeTab === "active" ? activeEmps : resignedEmps;

  if (!user || !user.isManager) return null;

  const totalGrantedAll = round1(activeEmps.reduce((s, e) => s + e.totalLeave + e.grantedDays, 0));
  const totalUsedAll = round1(activeEmps.reduce((s, e) => s + e.usedDays, 0));

  async function handleConfirmResign() {
    if (!resignTarget) return;
    setSaving(true);
    try {
      await setResignation(resignTarget.id, resignDate);
      setBaseEmps((prev) => prev.map((e) => (e.id === resignTarget.id ? { ...e, resignationDate: resignDate, name: maskName(e.name) } : e)));
      showNotification(`${resignTarget.name}님을 퇴사 처리했습니다.`);
      setResignTarget(null);
    } catch {
      showNotification("퇴사 처리 중 오류가 발생했습니다.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmReinstate() {
    if (!reinstateTarget) return;
    const name = rejoinName.trim();
    if (!name) { showNotification("이름을 입력해주세요.", "error"); return; }
    setSaving(true);
    try {
      await reinstateEmployee(reinstateTarget.id, rejoinDate, name);
      setBaseEmps((prev) => prev.map((e) => (e.id === reinstateTarget.id
        ? { ...e, resignationDate: undefined, joinDate: rejoinDate, name, initials: makeInitials(name) }
        : e)));
      showNotification(`${name}님을 복직 처리했습니다. 비밀번호는 1234로 초기화되었습니다.`);
      setReinstateTarget(null);
    } catch {
      showNotification("복직 처리 중 오류가 발생했습니다.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-on-surface">직원 연차 현황</h2>
            <p className="text-sm text-on-surface-variant mt-1">전체 직원의 연차 보유 및 사용 현황입니다.</p>
          </div>
          {activeTab === "active" && activeEmps.length > 0 && (
            <div className="flex items-center gap-6 text-sm">
              <div className="text-center">
                <p className="text-xs text-on-surface-variant">총 연차 합계</p>
                <p className="font-bold text-lg text-primary">{totalGrantedAll}일</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-on-surface-variant">전체 사용</p>
                <p className="font-bold text-lg text-secondary">{totalUsedAll}일</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-on-surface-variant">전체 잔여</p>
                <p className="font-bold text-lg text-on-surface">{round1(totalGrantedAll - totalUsedAll)}일</p>
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
          {([
            { key: "active", label: "직원 현황", icon: "groups", count: activeEmps.length },
            { key: "resigned", label: "퇴사자 현황", icon: "person_remove", count: resignedEmps.length },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab.key ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
            >
              <span className="material-symbols-outlined text-lg">{tab.icon}</span>
              {tab.label}
              <span className="text-xs opacity-70">({tab.count})</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-on-surface-variant">불러오는 중...</div>
          ) : visibleEmps.length === 0 ? (
            <div className="py-16 text-center text-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">group</span>
              {activeTab === "active" ? "등록된 직원이 없습니다." : "퇴사자가 없습니다."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead className="bg-surface-container-low text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 border-b border-outline-variant">직원</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">총 연차</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">사용</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">잔여</th>
                    <th className="px-6 py-4 border-b border-outline-variant">사용률</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {visibleEmps.map((emp) => {
                    const total = round1(emp.totalLeave + emp.grantedDays);
                    const pct = Math.min(100, Math.round((emp.usedDays / Math.max(1, total)) * 100));
                    return (
                      <tr key={emp.id} className={`transition-colors ${activeTab === "resigned" ? "opacity-60" : "hover:bg-surface-container-low"}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                              {emp.initials}
                            </div>
                            <div>
                              <p className="font-semibold text-sm text-on-surface">{emp.name} <span className="font-normal text-on-surface-variant">@{emp.username}</span></p>
                              {emp.joinDate && <p className="text-xs text-on-surface-variant">입사 {emp.joinDate}</p>}
                              {activeTab === "resigned" && <p className="text-xs text-error font-medium">퇴사 {emp.resignationDate}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <p className="font-bold text-sm text-on-surface">{total}일</p>
                          {emp.grantedDays > 0 && (
                            <p className="text-[10px] text-green-600">+{emp.grantedDays}일 부여</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <p className="font-bold text-sm text-secondary">{emp.usedDays}일</p>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <p className={`font-bold text-sm ${emp.remaining <= 3 ? "text-error" : emp.remaining <= 5 ? "text-yellow-600" : "text-primary"}`}>
                            {emp.remaining}일
                          </p>
                          {activeTab === "active" && (() => {
                            const d = daysUntilLeaveRenewal(emp.joinDate);
                            return d !== null && d >= 0 && d <= 30 ? (
                              <p className="text-[10px] text-primary">{d}일 후 연차 갱신</p>
                            ) : null;
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden min-w-[80px]">
                              <div
                                className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-error" : pct >= 50 ? "bg-yellow-400" : "bg-secondary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-on-surface-variant w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {activeTab === "resigned" ? (
                            <button onClick={() => { setReinstateTarget({ id: emp.id, name: emp.name }); setRejoinDate(todayStr()); setRejoinName(emp.name); }} className="text-xs text-primary hover:underline font-medium">복직 처리</button>
                          ) : (
                            <button onClick={() => { setResignTarget({ id: emp.id, name: emp.name }); setResignDate(todayStr()); }} className="text-xs text-error hover:underline font-medium">퇴사 처리</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 퇴사 처리 확인 모달 */}
      {resignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-error text-xl">person_remove</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-on-surface">퇴사 처리</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">{resignTarget.name}님을 퇴사 처리합니다.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-on-surface-variant">
                퇴사자는 직원 목록에서 제외되고, 연차가 더 이상 자동으로 늘어나지 않으며 로그인도 막힙니다. 이름은 부분 마스킹 처리되고 서명 이미지는 삭제됩니다. 연차 신청/부여 이력은 퇴사일로부터 3년간 보관 후 자동 파기되며, 그 전까지는 언제든 복직 처리할 수 있습니다.
              </p>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">퇴사일</label>
                <input
                  type="date"
                  value={resignDate}
                  onChange={(e) => setResignDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition"
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setResignTarget(null)}
                disabled={saving}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmResign}
                disabled={saving || !resignDate}
                className="flex-1 py-2.5 bg-error text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? "처리 중..." : "퇴사 처리"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 복직 처리 확인 모달 */}
      {reinstateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">person_add</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-on-surface">복직 처리</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">{reinstateTarget.name}님을 재입사로 처리합니다.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-on-surface-variant">
                재입사일을 기준으로 근속·연차가 새로 시작됩니다(과거 신청/부여 이력은 그대로 보존됨). 비밀번호는 <span className="font-bold text-on-surface">1234</span>로 초기화되며, 로그인 후 설정에서 변경할 수 있습니다.
              </p>
              <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2">
                퇴사 처리 시 이름이 마스킹되어 원본이 저장되어 있지 않습니다. 이름을 다시 입력해주세요.
              </p>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">이름</label>
                <input
                  type="text"
                  value={rejoinName}
                  onChange={(e) => setRejoinName(e.target.value)}
                  placeholder="실명 입력"
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">재입사일</label>
                <input
                  type="date"
                  value={rejoinDate}
                  onChange={(e) => setRejoinDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setReinstateTarget(null)}
                disabled={saving}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleConfirmReinstate}
                disabled={saving || !rejoinDate || !rejoinName.trim()}
                className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? "처리 중..." : "복직 처리"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
