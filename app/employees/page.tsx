"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave, currentLeaveYearStart } from "@/lib/leaveCalc";

interface EmpStat {
  id: string;
  name: string;
  initials: string;
  joinDate: string;
  totalLeave: number;
  grantedDays: number;
  usedDays: number;
  remaining: number;
}

export default function EmployeesPage() {
  const router = useRouter();
  const { state } = useStore();
  const user = state.currentUser;

  useEffect(() => {
    if (user && !user.isManager) router.replace("/dashboard");
  }, [user, router]);

  const [baseEmps, setBaseEmps] = useState<Array<{ id: string; name: string; initials: string; joinDate: string; totalLeave: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.isManager) return;
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      setBaseEmps(snap.docs
        .filter((d) => !(d.data().isManager as boolean))
        .map((d) => {
          const data = d.data();
          const joinDate = (data.joinDate as string) ?? "";
          const storedTotal = data.totalLeave as number | undefined;
          return {
            id: d.id,
            name: data.name as string,
            initials: (data.initials as string) ?? (data.name as string).slice(0, 2),
            joinDate,
            totalLeave: joinDate ? calcTotalLeave(joinDate) : (storedTotal ?? 15),
          };
        }));
      setLoading(false);
    });
  }, [user?.isManager]);

  const empStats: EmpStat[] = useMemo(() => baseEmps
    .map((emp) => {
      const granted = state.leaveGrants.filter((g) => g.userId === emp.id).reduce((s, g) => s + g.days, 0);
      const NO_DEDUCTION = ["sick", "reservist"];
      const yearStart = currentLeaveYearStart(emp.joinDate);
      const used = state.leaveRequests.filter((r) => r.userId === emp.id && r.status === "approved" && !NO_DEDUCTION.includes(r.type) && r.startDate >= yearStart).reduce((s, r) => s + r.days, 0);
      return { ...emp, grantedDays: granted, usedDays: used, remaining: emp.totalLeave + granted - used };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  [baseEmps, state.leaveGrants, state.leaveRequests]);

  if (!user || !user.isManager) return null;

  const totalGrantedAll = empStats.reduce((s, e) => s + e.totalLeave + e.grantedDays, 0);
  const totalUsedAll = empStats.reduce((s, e) => s + e.usedDays, 0);

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-on-surface">직원 연차 현황</h2>
            <p className="text-sm text-on-surface-variant mt-1">전체 직원의 연차 보유 및 사용 현황입니다.</p>
          </div>
          {empStats.length > 0 && (
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
                <p className="font-bold text-lg text-on-surface">{totalGrantedAll - totalUsedAll}일</p>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-on-surface-variant">불러오는 중...</div>
          ) : empStats.length === 0 ? (
            <div className="py-16 text-center text-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">group</span>
              등록된 직원이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[560px]">
                <thead className="bg-surface-container-low text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 border-b border-outline-variant">직원</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">총 연차</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">사용</th>
                    <th className="px-6 py-4 border-b border-outline-variant text-center">잔여</th>
                    <th className="px-6 py-4 border-b border-outline-variant">사용률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {empStats.map((emp) => {
                    const total = emp.totalLeave + emp.grantedDays;
                    const pct = Math.min(100, Math.round((emp.usedDays / Math.max(1, total)) * 100));
                    return (
                      <tr key={emp.id} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                              {emp.initials}
                            </div>
                            <div>
                              <p className="font-semibold text-sm text-on-surface">{emp.name}</p>
                              {emp.joinDate && <p className="text-xs text-on-surface-variant">입사 {emp.joinDate}</p>}
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
                          {emp.remaining <= 3 && (
                            <p className="text-[10px] text-error">소진 임박</p>
                          )}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
