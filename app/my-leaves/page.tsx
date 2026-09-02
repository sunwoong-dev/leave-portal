"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave } from "@/lib/leaveCalc";
import { LEAVE_TYPE_LABELS, STATUS_LABELS, LeaveStatus, LeaveRequest } from "@/lib/types";
import { generateLeavePDF } from "@/lib/pdfGenerator";
import { toLocalDateStr, todayLocalStr } from "@/lib/dateUtils";
import * as XLSX from "xlsx";

const STATUS_STYLES: Record<LeaveStatus, string> = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
};

export default function MyLeavesPage() {
  const router = useRouter();
  const { state, deleteLeave, reopenRejectedLeave, revokeApprovedLeave, showNotification } = useStore();
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
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<LeaveRequest | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeSaving, setRevokeSaving] = useState(false);

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

  async function handleConfirmCancel() {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) { showNotification("취소 사유를 입력해주세요.", "error"); return; }
    setCancelSaving(true);
    try {
      await deleteLeave(cancelTarget.id, cancelReason);
      showNotification("휴가 신청이 취소되었습니다.", "success");
      setCancelTarget(null);
      setCancelReason("");
    } finally {
      setCancelSaving(false);
    }
  }

  // 휴가 시작일이 지나지 않은 건만 관리자가 상태를 되돌리거나 뒤집을 수 있게 허용
  function canOverride(r: LeaveRequest) {
    return r.startDate > todayLocalStr();
  }

  async function handleReopen(r: LeaveRequest) {
    setReopeningId(r.id);
    try {
      await reopenRejectedLeave(r.id);
      showNotification("재검토 대기로 되돌렸습니다.", "success");
    } finally {
      setReopeningId(null);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    if (!revokeReason.trim()) { showNotification("반려 사유를 입력해주세요.", "error"); return; }
    setRevokeSaving(true);
    try {
      await revokeApprovedLeave(revokeTarget.id, revokeReason);
      showNotification("승인을 취소하고 반려 처리했습니다.", "success");
      setRevokeTarget(null);
      setRevokeReason("");
    } finally {
      setRevokeSaving(false);
    }
  }

  function handleExportExcel() {
    if (myRequests.length === 0) {
      showNotification("내보낼 신청 건이 없습니다.", "error");
      return;
    }
    const header = ["신청일", "이름", "휴가 종류", "시작일", "종료일", "일수", "인수인계 사항", "상태", "처리자"];
    const rows = myRequests.map((r) => [
      toLocalDateStr(new Date(r.createdAt)),
      r.userName,
      LEAVE_TYPE_LABELS[r.type],
      r.startDate,
      r.endDate,
      r.days,
      r.reason ?? "",
      STATUS_LABELS[r.status],
      r.reviewedBy ?? "",
    ]);
    // 문자열 셀로 직접 써넣으므로(엑셀이 텍스트를 읽고 나서 재해석하는 CSV와 달리) 날짜가
    // 날짜 일련번호로 자동 변환되면서 열이 좁아 "#######"로 뜨는 문제가 애초에 없다.
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws["!cols"] = header.map((h, i) => {
      if (h === "인수인계 사항") {
        const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i]).length));
        return { wch: Math.min(Math.max(maxLen + 2, 20), 60) };
      }
      const maxLen = Math.max(h.length, ...rows.map((r) => String(r[i]).length));
      return { wch: maxLen + 2 };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "휴가 신청 내역");
    XLSX.writeFile(wb, `휴가_신청_내역_${todayLocalStr()}.xlsx`);
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
      <div className="min-h-[calc(100vh-4rem)] overflow-y-auto md:h-[calc(100vh-4rem)] md:overflow-hidden flex flex-col p-4 md:p-6 gap-3">
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
          <div className="flex flex-col gap-4 md:flex-1 md:min-h-0 md:overflow-hidden">
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
                {/* 차트 본체 — lg 미만에서는 통계 카드와 같은 grid 행이 아니라(세로로 쌓임) 기준 높이가
                    없어지므로 고정 높이를 직접 줌. lg 이상에서는 기존처럼 grid stretch로 왼쪽 카드
                    높이에 맞춰 자동으로 채움. */}
                <div className="h-56 lg:h-auto lg:flex-1 lg:min-h-0 flex flex-col gap-0">
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
          <div className="flex flex-col bg-white rounded-xl border border-outline-variant shadow-sm md:flex-1 md:min-h-0 md:overflow-hidden">
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
                <button
                  onClick={handleExportExcel}
                  title="현재 조회 조건에 맞는 전체 내역을 Excel로 내보냅니다"
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-low transition-colors"
                >
                  <span className="material-symbols-outlined text-base">table_view</span>
                  Excel
                </button>
              </div>
            </div>
            <div ref={tableContainerRef} className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
              {/* 모바일 카드형 목록 */}
              <div className="md:hidden divide-y divide-outline-variant">
                {paginated.length === 0 ? (
                  <div className="py-16 text-center text-on-surface-variant text-sm">
                    <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">search_off</span>
                    검색 결과가 없습니다.
                  </div>
                ) : paginated.map((r) => {
                  const isSelected = selectedIds.has(r.id);
                  return (
                    <div
                      key={r.id}
                      onClick={() => toggleSelect(r.id)}
                      className={`px-4 py-3.5 space-y-2 cursor-pointer transition-colors ${isSelected ? "bg-primary/10" : "active:bg-primary/5"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            onClick={(e) => { e.stopPropagation(); toggleSelect(r.id); }}
                            className={`block w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 cursor-pointer transition-colors ${isSelected ? "border-primary bg-primary" : "border-outline-variant"}`}
                          />
                          <span className="text-sm font-semibold text-on-surface truncate">{r.userName}</span>
                          <span className="text-xs font-medium text-on-surface-variant flex-shrink-0">{LEAVE_TYPE_LABELS[r.type]}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex-shrink-0 ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                      </div>
                      <div className="text-xs text-on-surface-variant flex items-center gap-3">
                        <span>신청일 <span className="font-bold text-on-surface">{toLocalDateStr(new Date(r.createdAt))}</span></span>
                        <span>{r.startDate} ~ {r.endDate}</span>
                        <span className="font-bold text-on-surface">{r.days}일</span>
                      </div>
                      {r.reason && <p className="text-xs text-on-surface-variant truncate">{r.reason}</p>}
                      {r.status === "pending" && (
                        <div className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { setCancelTarget(r); setCancelReason(""); }} className="text-xs text-error hover:underline font-medium">취소</button>
                        </div>
                      )}
                      {r.status === "rejected" && canOverride(r) && (
                        <div className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleReopen(r)} disabled={reopeningId === r.id} className="text-xs text-primary hover:underline font-medium disabled:opacity-50">
                            {reopeningId === r.id ? "처리 중..." : "되돌리기"}
                          </button>
                        </div>
                      )}
                      {r.status === "approved" && canOverride(r) && (
                        <div className="text-right" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { setRevokeTarget(r); setRevokeReason(""); }} className="text-xs text-error hover:underline font-medium">반려로 변경</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 데스크톱 테이블 */}
              <table className="hidden md:table w-full text-left min-w-[640px]">
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
                            <button onClick={() => { setCancelTarget(r); setCancelReason(""); }} className="text-xs text-error hover:underline font-medium">취소</button>
                          ) : r.status === "rejected" && canOverride(r) ? (
                            <button onClick={() => handleReopen(r)} disabled={reopeningId === r.id} className="text-xs text-primary hover:underline font-medium disabled:opacity-50">
                              {reopeningId === r.id ? "처리 중..." : "되돌리기"}
                            </button>
                          ) : r.status === "approved" && canOverride(r) ? (
                            <button onClick={() => { setRevokeTarget(r); setRevokeReason(""); }} className="text-xs text-error hover:underline font-medium">반려로 변경</button>
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
                <button onClick={() => setPage(1)} disabled={currentPage === 1} title="처음" className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">first_page</span>
                </button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} title="이전" className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">chevron_left</span>
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${p === currentPage ? "bg-primary text-white" : "hover:bg-white"}`}>{p}</button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} title="다음" className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">chevron_right</span>
                </button>
                <button onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} title="끝" className="p-1.5 border border-outline-variant rounded-lg hover:bg-white transition-colors disabled:opacity-30">
                  <span className="material-symbols-outlined text-base">last_page</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 신청 취소 확인 모달 */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-error text-xl">cancel</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-on-surface">휴가 신청 취소</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">{cancelTarget.userName}님의 {cancelTarget.startDate} ~ {cancelTarget.endDate} 신청을 취소합니다.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">취소 사유</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="취소 사유를 입력해주세요 (필수)"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition resize-none"
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => { setCancelTarget(null); setCancelReason(""); }}
                disabled={cancelSaving}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-50"
              >
                돌아가기
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelSaving || !cancelReason.trim()}
                className="flex-1 py-2.5 bg-error text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {cancelSaving ? "처리 중..." : "취소 확정"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 승인 취소(반려로 변경) 확인 모달 */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-error text-xl">undo</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-on-surface">승인 취소 → 반려 처리</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">{revokeTarget.userName}님의 {revokeTarget.startDate} ~ {revokeTarget.endDate} 승인건을 반려로 변경합니다. 차감됐던 연차는 복원됩니다.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">반려 사유</label>
                <textarea
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  placeholder="반려 사유를 입력해주세요 (필수)"
                  rows={3}
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition resize-none"
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => { setRevokeTarget(null); setRevokeReason(""); }}
                disabled={revokeSaving}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-50"
              >
                돌아가기
              </button>
              <button
                onClick={handleConfirmRevoke}
                disabled={revokeSaving || !revokeReason.trim()}
                className="flex-1 py-2.5 bg-error text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {revokeSaving ? "처리 중..." : "반려 확정"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
