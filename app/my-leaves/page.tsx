"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave } from "@/lib/leaveCalc";
import { LEAVE_TYPE_LABELS, STATUS_LABELS, LeaveStatus } from "@/lib/types";
import { generateLeavePDF } from "@/lib/pdfGenerator";
import { toLocalDateStr } from "@/lib/dateUtils";

const STATUS_STYLES: Record<LeaveStatus, string> = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
};

export default function MyLeavesPage() {
  const router = useRouter();
  const { state, deleteLeave, showNotification } = useStore();
  const user = state.currentUser;

  useEffect(() => {
    if (user && !user.isManager) router.replace("/dashboard");
  }, [user, router]);

  const [activeTab, setActiveTab] = useState<"history" | "detail">("history");
  const [statusFilter, setStatusFilter] = useState<"all" | LeaveStatus>("all");
  const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(`${new Date().getFullYear()}-12-31`);
  const [draftStartDate, setDraftStartDate] = useState(startDate);
  const [draftEndDate, setDraftEndDate] = useState(endDate);
  const endDateInitialized = useRef(false);
  const [page, setPage] = useState(1);
  const [allUsersTotalLeave, setAllUsersTotalLeave] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfLoading, setPdfLoading] = useState(false);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(10);

  useEffect(() => {
    const el = tableContainerRef.current;
    if (!el) return;
    const ROW_H = 49;
    const measure = () => setPerPage(Math.max(5, Math.floor(el.clientHeight / ROW_H)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      const total = snap.docs
        .filter((d) => !d.data().resignationDate)
        .reduce((sum, d) => sum + calcTotalLeave((d.data().joinDate as string) ?? ""), 0);
      setAllUsersTotalLeave(total);
    });
  }, []);

  // 우측 날짜 기본값 = 현재 신청되어있는 가장 마지막 연/월/반차 날짜 (최초 1회만 적용)
  const NORMAL_LEAVE_TYPES = ["annual", "monthly", "half-am", "half-pm"];
  const latestLeaveDate = useMemo(() => {
    const relevant = state.leaveRequests.filter((r) => NORMAL_LEAVE_TYPES.includes(r.type));
    if (relevant.length === 0) return null;
    return relevant.reduce((max, r) => (r.startDate > max ? r.startDate : max), relevant[0].startDate);
  }, [state.leaveRequests]);

  useEffect(() => {
    if (!endDateInitialized.current && latestLeaveDate) {
      setEndDate(latestLeaveDate);
      setDraftEndDate(latestLeaveDate);
      endDateInitialized.current = true;
    }
  }, [latestLeaveDate]);

  function handleSearch() {
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setPage(1);
  }

  const selectedYear = startDate.slice(0, 4);

  const allApprovedDays = useMemo(() => {
    return state.leaveRequests
      .filter((r) => r.status === "approved" && r.startDate.startsWith(selectedYear))
      .reduce((sum, r) => sum + r.days, 0);
  }, [state.leaveRequests, selectedYear]);

  const utilizationRate = allUsersTotalLeave > 0
    ? Math.min(100, Math.round((allApprovedDays / allUsersTotalLeave) * 100))
    : 0;

  const monthlyData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const approved = state.leaveRequests.filter(
        (r) => r.status === "approved" && r.startDate.startsWith(`${selectedYear}-${mm}`)
      );
      const halfCount = approved.filter((r) => r.type === "half-am" || r.type === "half-pm").length;
      const fullCount = approved.filter((r) => r.type !== "half-am" && r.type !== "half-pm").length;
      const halfDays = approved.filter((r) => r.type === "half-am" || r.type === "half-pm").reduce((s, r) => s + r.days, 0);
      const annualDays = approved.filter((r) => r.type !== "half-am" && r.type !== "half-pm").reduce((s, r) => s + r.days, 0);
      const count = approved.length;
      return { month: `${i + 1}월`, halfCount, fullCount, halfDays, annualDays, total: halfDays + annualDays, count };
    });
  }, [state.leaveRequests, selectedYear]);

  const maxCount = Math.max(...monthlyData.map((m) => m.count), 1);
  const yTicks = useMemo(() => {
    if (maxCount <= 6) return Array.from({ length: maxCount + 1 }, (_, i) => i);
    const step = Math.ceil(maxCount / 5);
    const ticks: number[] = [];
    for (let v = 0; v <= maxCount; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] !== maxCount) ticks.push(maxCount);
    return ticks;
  }, [maxCount]);

  const myRequests = useMemo(() => {
    return state.leaveRequests
      .filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        if (startDate && r.startDate < startDate) return false;
        if (endDate && r.startDate > endDate) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [state.leaveRequests, statusFilter, startDate, endDate]);

  if (!user) return null;

  const totalPages = Math.max(1, Math.ceil(myRequests.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const paginated = myRequests.slice((currentPage - 1) * perPage, currentPage * perPage);

  const approvedCount = state.leaveRequests.filter((r) => r.status === "approved").length;
  const pendingCount = state.leaveRequests.filter((r) => r.status === "pending").length;
  const rejectedCount = state.leaveRequests.filter((r) => r.status === "rejected").length;

  async function handleDelete(id: string) {
    if (confirm("해당 휴가 신청을 취소하시겠습니까?")) {
      await deleteLeave(id);
      showNotification("휴가 신청이 취소되었습니다.", "success");
    }
  }

  async function handleExport() {
    if (selectedIds.size === 0) {
      showNotification("PDF로 저장할 신청 건을 먼저 선택해주세요.", "error");
      return;
    }
    const reqs = myRequests.filter((r) => selectedIds.has(r.id));
    setPdfLoading(true);
    try {
      // 브라우저 다운로드 다이얼로그/DOM 조작이 겹치지 않도록 하나씩 순서대로 생성
      for (const req of reqs) {
        await generateLeavePDF(req);
      }
    } catch {
      showNotification("PDF 생성 중 오류가 발생했습니다.", "error");
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] overflow-hidden flex flex-col p-4 md:p-6 gap-3">
        {/* Header */}
        <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-primary">휴가 사용 통계 및 이력</h2>
            <p className="text-sm text-on-surface-variant">조직 내 휴가 사용 현황을 분석하고 상세 이력을 관리합니다.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex-shrink-0 flex gap-1 bg-surface-container-low p-1 rounded-xl w-fit">
          {([
            { key: "history", label: "Team Stats", icon: "bar_chart" },
            { key: "detail", label: "Leave History", icon: "table_rows" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === tab.key ? "bg-white text-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
            >
              <span className="material-symbols-outlined text-lg">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── 팀 통계 탭 ── */}
        {activeTab === "history" && (
          <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
            {/* 통계 — 원래 크기 유지 */}
            <div className="flex-shrink-0 grid grid-cols-12 gap-5">
              <div className="col-span-12 lg:col-span-4 grid gap-4">
                <div className="bg-white p-6 rounded-xl border border-outline-variant shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">평균 휴가 소진율</span>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">전체 직원 기준 · {startDate} ~ {endDate}</p>
                    </div>
                    <div className="bg-secondary/10 p-2 rounded-lg flex-shrink-0">
                      <span className="material-symbols-outlined text-secondary text-xl">trending_up</span>
                    </div>
                  </div>
                  <span className="text-5xl font-bold text-primary">{utilizationRate}%</span>
                  <div className="w-full bg-surface-container h-2 rounded-full mt-4 overflow-hidden">
                    <div className="bg-secondary h-full rounded-full transition-all" style={{ width: `${utilizationRate}%` }} />
                  </div>
                  <p className="text-xs text-on-surface-variant mt-2">총 연차 {allUsersTotalLeave}일 중 {allApprovedDays}일 사용</p>
                </div>
                <div className="bg-white p-6 rounded-xl border border-outline-variant shadow-sm">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-4">신청 요약</span>
                  <ul className="space-y-3">
                    <li className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-green-300" />
                        <span className="text-sm font-medium text-green-800">승인 완료</span>
                      </div>
                      <span className="font-bold text-green-700">{approvedCount}건</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-yellow-200" />
                        <span className="text-sm font-medium text-yellow-800">검토 중</span>
                      </div>
                      <span className="font-bold text-yellow-700">{pendingCount}건</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full bg-red-200" />
                        <span className="text-sm font-medium text-red-700">반려됨</span>
                      </div>
                      <span className="font-bold text-red-600">{rejectedCount}건</span>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="col-span-12 lg:col-span-8 bg-white p-6 rounded-xl border border-outline-variant shadow-sm flex flex-col">
                <div className="flex-shrink-0 flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-lg font-bold text-primary">월별 휴가 사용 트렌드</h4>
                    <p className="text-xs text-on-surface-variant">{selectedYear}년 전체 직원 승인 신청 건수 기준</p>
                  </div>
                  <div className="flex items-center gap-3 text-sm font-medium">
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-300 border border-emerald-400" />연차</span>
                    <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-amber-200 border border-amber-300" />반차</span>
                  </div>
                </div>
                {/* 차트 본체 */}
                <div className="flex-1 min-h-0 flex flex-col gap-0">
                  {/* Y축 + 바 영역 */}
                  <div className="flex-1 min-h-0 flex gap-1">
                    {/* Y축 레이블 — 바 영역과 동일 높이의 relative 컨테이너, 값 위치에 absolute 배치 */}
                    <div className="relative w-6 flex-shrink-0">
                      {yTicks.map((v) => (
                        <span
                          key={v}
                          className="absolute right-0 text-[10px] text-on-surface-variant leading-none"
                          style={{
                            top: `${(1 - v / maxCount) * 100}%`,
                            transform: v === 0 ? "translateY(-100%)" : v === maxCount ? "translateY(0)" : "translateY(-50%)",
                          }}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                    {/* 바 영역 (격자 포함) */}
                    <div className="flex-1 relative border-b border-gray-300 min-h-0">
                      {/* 격자선 — 각 tick 값의 실제 비율 위치에 배치 */}
                      {yTicks.filter((v) => v > 0).map((v) => (
                        <div
                          key={v}
                          className={`absolute left-0 right-0 border-t ${v === maxCount ? "border-gray-300" : "border-dashed border-gray-200"}`}
                          style={{ top: `${(1 - v / maxCount) * 100}%` }}
                        />
                      ))}
                      {/* 바들 */}
                      <div className="absolute inset-0 flex items-end justify-between gap-1 px-0.5">
                        {monthlyData.map((m) => (
                          <div key={m.month} className="flex-1 h-full flex items-end relative">
                            <div
                              className="w-full rounded-t overflow-visible flex flex-col cursor-pointer hover:brightness-95 transition-all relative"
                              style={{ height: `${(m.count / maxCount) * 100}%` }}
                              title={`${m.month}: ${m.count}건 (연차/월차 ${m.fullCount}건 ${m.annualDays}일 / 반차 ${m.halfCount}건 ${m.halfDays}일)`}
                            >
                              {m.count > 0 && (
                                <span className="absolute -top-5 left-0 right-0 text-center text-[10px] font-bold text-on-surface-variant leading-none">{m.count}건</span>
                              )}
                              <div className="w-full bg-amber-200 flex-shrink-0 rounded-t"
                                style={{ height: m.count > 0 ? `${(m.halfCount / m.count) * 100}%` : "0%" }} />
                              <div className="w-full bg-emerald-300 flex-1" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* X축 월 레이블 — Y축 너비만큼 왼쪽 패딩으로 바 영역과 정렬 */}
                  <div className="flex gap-1 pt-1.5 pl-7">
                    {monthlyData.map((m) => (
                      <span key={m.month} className="flex-1 text-center text-xs font-medium text-on-surface-variant">{m.month}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Leave History 탭 ── */}
        {activeTab === "detail" && (
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="flex-shrink-0 px-5 py-4 border-b border-outline-variant flex items-center justify-between flex-wrap gap-3 bg-surface-bright">
              <div>
                <h4 className="text-base font-bold text-primary">Leave History</h4>
                <p className="text-base text-on-surface-variant mt-0.5">전체 직원 신청 내역</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 border border-outline-variant rounded-lg px-2 py-1.5 bg-white text-xs">
                  <input type="date" value={draftStartDate} onChange={(e) => setDraftStartDate(e.target.value)} className="border-none focus:ring-0 p-0 bg-transparent text-xs" />
                  <span className="text-on-surface-variant">~</span>
                  <input type="date" value={draftEndDate} onChange={(e) => setDraftEndDate(e.target.value)} className="border-none focus:ring-0 p-0 bg-transparent text-xs" />
                </div>
                <button
                  onClick={handleSearch}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-primary text-primary rounded-lg text-xs font-semibold hover:bg-primary/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">search</span>
                  조회
                </button>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as LeaveStatus | "all"); setPage(1); }}
                  className="border border-outline-variant rounded-lg text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="all">전체 상태</option>
                  <option value="approved">승인됨</option>
                  <option value="pending">검토중</option>
                  <option value="rejected">반려됨</option>
                </select>
                <button
                  onClick={() => handleExport()}
                  disabled={pdfLoading}
                  className={`flex items-center gap-1 px-2.5 py-1.5 border rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${selectedIds.size > 0
                    ? "border-primary text-primary hover:bg-primary/10"
                    : "border-outline-variant hover:bg-surface-container-low"
                    }`}
                >
                  <span className="material-symbols-outlined text-base">picture_as_pdf</span>
                  {pdfLoading ? "생성 중..." : selectedIds.size > 0 ? `PDF (${selectedIds.size})` : "PDF"}
                </button>
              </div>
            </div>
            <div ref={tableContainerRef} className="flex-1 min-h-0 overflow-hidden">
              <table className="w-full text-left min-w-[640px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-bright text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-3 border-b border-outline-variant w-8"></th>
                    <th className="px-5 py-3 border-b border-outline-variant">신청일</th>
                    <th className="px-5 py-3 border-b border-outline-variant">이름</th>
                    <th className="px-5 py-3 border-b border-outline-variant">휴가 종류</th>
                    <th className="px-5 py-3 border-b border-outline-variant">기간</th>
                    <th className="px-5 py-3 border-b border-outline-variant text-center">일수</th>
                    <th className="px-5 py-3 border-b border-outline-variant">인수인계 사항</th>
                    <th className="px-5 py-3 border-b border-outline-variant">상태</th>
                    <th className="px-5 py-3 border-b border-outline-variant text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant border-b border-outline-variant">
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-on-surface-variant text-sm">
                        <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">search_off</span>
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  ) : paginated.map((r) => {
                    const isSelected = selectedIds.has(r.id);
                    return (
                      <tr
                        key={r.id}
                        onClick={() => toggleSelect(r.id)}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-primary/10" : "hover:bg-primary/5"}`}
                      >
                        <td className="pl-5 pr-2 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <span
                            onClick={() => toggleSelect(r.id)}
                            className={`block w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary" : "border-outline-variant"}`}
                          />
                        </td>
                        <td className="px-5 py-3.5 text-sm font-bold text-on-surface-variant">{toLocalDateStr(new Date(r.createdAt))}</td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-on-surface">{r.userName}</td>
                        <td className="px-5 py-3.5 text-sm font-medium">{LEAVE_TYPE_LABELS[r.type]}</td>
                        <td className="px-5 py-3.5 text-sm text-on-surface-variant">{r.startDate} ~ {r.endDate}</td>
                        <td className="px-5 py-3.5 text-sm text-center font-bold">{r.days}</td>
                        <td className="px-5 py-3.5 text-sm text-on-surface-variant max-w-xs truncate">{r.reason}</td>
                        <td className="px-5 py-3.5">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                        </td>
                        <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          {r.status === "pending" ? (
                            <button onClick={() => handleDelete(r.id)} className="text-xs text-error hover:underline font-medium">취소</button>
                          ) : (
                            <span className="text-xs text-on-surface-variant">처리완료</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex-shrink-0 px-5 py-3 bg-surface-bright flex items-center justify-between border-t border-outline-variant flex-wrap gap-3">
              <p className="text-sm text-on-surface-variant font-medium">
                전체 {myRequests.length}건 중 {myRequests.length === 0 ? 0 : (currentPage - 1) * perPage + 1}~{Math.min(currentPage * perPage, myRequests.length)} 표시
              </p>
              <div className="flex gap-1.5">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">chevron_left</span>
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${p === currentPage ? "bg-primary text-white" : "hover:bg-white"}`}>{p}</button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </AppLayout>
  );
}
