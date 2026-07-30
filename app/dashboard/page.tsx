"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import AppLayout from "@/components/AppLayout";
import { LEAVE_TYPE_LABELS, STATUS_LABELS, LeaveRequest } from "@/lib/types";
import { isHoliday, getHolidayName } from "@/lib/holidays";
import LeaveRequestModal from "@/components/LeaveRequestModal";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave, daysUntilLeaveRenewal } from "@/lib/leaveCalc";
import { grantCeilingTotal } from "@/lib/grantLedger";

interface SimpleUser { id: string; name: string; totalLeave: number; }
const STATUS_STYLES = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_KO = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// 유저별 고유 색상 팔레트 (12색)
const USER_PALETTE = [
  { bg: "#dbeafe", text: "#1d4ed8" },  // blue
  { bg: "#f3e8ff", text: "#7e22ce" },  // purple
  { bg: "#d1fae5", text: "#065f46" },  // emerald
  { bg: "#fce7f3", text: "#be185d" },  // pink
  { bg: "#e0f2fe", text: "#0369a1" },  // sky
  { bg: "#fff7ed", text: "#c2410c" },  // orange
  { bg: "#eef2ff", text: "#4338ca" },  // indigo
  { bg: "#ccfbf1", text: "#0f766e" },  // teal
  { bg: "#fdf4ff", text: "#a21caf" },  // fuchsia
  { bg: "#fef9c3", text: "#a16207" },  // yellow
  { bg: "#ecfccb", text: "#3f6212" },  // lime
  { bg: "#ffe4e6", text: "#be123c" },  // rose
];

const USER_COLOR_OVERRIDES: Record<string, number> = {
  "문선웅": 9, // yellow
};

function getUserColor(userId: string, name?: string) {
  if (name !== undefined && USER_COLOR_OVERRIDES[name] !== undefined) {
    return USER_PALETTE[USER_COLOR_OVERRIDES[name]];
  }
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash | 0;
  }
  return USER_PALETTE[Math.abs(hash) % USER_PALETTE.length];
}

export default function DashboardPage() {
  const { state, usedLeave, grantedDays, unusedGrantDays, updateLeaveStatus, addGrant, deleteLeave, showNotification } = useStore();
  const user = state.currentUser;
  if (!user) return null;

  const todayObj = new Date();
  const todayStr = todayObj.toISOString().split("T")[0];

  const [viewYear, setViewYear] = useState(todayObj.getFullYear());
  const [viewMonth, setViewMonth] = useState(todayObj.getMonth());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState<string | undefined>();
  const [modalEndDate, setModalEndDate] = useState<string | undefined>();
  const [detailReq, setDetailReq] = useState<LeaveRequest | null>(null);
  const [editReq, setEditReq] = useState<LeaveRequest | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [quickRejectOpen, setQuickRejectOpen] = useState<string | null>(null);
  const [quickRejectNote, setQuickRejectNote] = useState<Record<string, string>>({});

  // 연차 조정 (관리자용)
  const [grantEmployees, setGrantEmployees] = useState<SimpleUser[]>([]);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantDays, setGrantDays] = useState(1);
  const [grantReason, setGrantReason] = useState("");
  const [grantLoading, setGrantLoading] = useState(false);

  // Drag selection (user calendar)
  const dragRef = useRef<{ start: string; current: string } | null>(null);
  const [dragRange, setDragRange] = useState<{ start: string; end: string } | null>(null);

  // All requests modal
  const [showAllModal, setShowAllModal] = useState(false);
  const [allFilter, setAllFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [calendarExpanded, setCalendarExpanded] = useState(false);

  const totalWithGrants = user.totalLeave + grantedDays;
  const remaining = totalWithGrants - usedLeave;
  const usedPct = Math.min(100, Math.round((usedLeave / Math.max(1, totalWithGrants)) * 100));

  // Team calendar map — 관리자/유저 모두 전체 팀 휴가 표시
  const LEAVE_SHORT: Record<string, string> = {
    annual: "연차", monthly: "월차", "half-am": "오전", "half-pm": "오후",
    reservist: "예비군", sick: "병가", other: "기타",
  };

  const teamLeaveDateMap = useMemo(() => {
    const map: Record<string, Array<{ name: string; userId: string; status: "approved" | "pending"; type: string }>> = {};
    state.leaveRequests.filter((r) => r.status !== "rejected").forEach((r) => {
      const cur = new Date(r.startDate + "T00:00:00");
      const end = new Date(r.endDate + "T00:00:00");
      while (cur <= end) {
        const dow = cur.getDay();
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        if (dow !== 0 && dow !== 6 && !isHoliday(key)) {
          if (!map[key]) map[key] = [];
          if (!map[key].some((e) => e.userId === r.userId))
            map[key].push({ name: r.userName, userId: r.userId, status: r.status as "approved" | "pending", type: r.type });
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [state.leaveRequests]);

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }

  // Global mouseup cancel for drag
  useEffect(() => {
    function cancel() {
      if (dragRef.current) { dragRef.current = null; setDragRange(null); }
    }
    window.addEventListener("mouseup", cancel);
    return () => window.removeEventListener("mouseup", cancel);
  }, []);

  // Escape 키로 확대 달력 닫기
  useEffect(() => {
    if (!calendarExpanded) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setCalendarExpanded(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calendarExpanded]);

  useEffect(() => {
    if (!user.isManager) return;
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      const list: SimpleUser[] = snap.docs
        .filter((d) => !(d.data().isManager as boolean) && !d.data().resignationDate)
        .map((d) => {
          const data = d.data();
          const joinDate = (data.joinDate as string) ?? "";
          return {
            id: d.id,
            name: data.name as string,
            totalLeave: joinDate ? calcTotalLeave(joinDate) : ((data.totalLeave as number) ?? 15),
          };
        });
      list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      setGrantEmployees(list);
      if (list.length > 0) setGrantUserId(list[0].id);
    });
  }, [user.isManager]);

  async function handleGrant() {
    if (!grantUserId) { showNotification("직원을 선택해주세요.", "error"); return; }
    if (grantDays === 0) { showNotification("0일은 입력할 수 없습니다.", "error"); return; }
    if (!grantReason.trim()) { showNotification("사유를 입력해주세요.", "error"); return; }
    const emp = grantEmployees.find((e) => e.id === grantUserId);
    if (!emp) return;
    setGrantLoading(true);
    try {
      await addGrant(grantUserId, emp.name, grantDays, grantReason);
      showNotification(grantDays > 0 ? `${emp.name}님에게 ${grantDays}일 연차가 부여되었습니다.` : `${emp.name}님의 연차 ${Math.abs(grantDays)}일이 차감되었습니다.`);
      setGrantDays(1);
      setGrantReason("");
    } finally {
      setGrantLoading(false);
    }
  }

  function handleDateMouseDown(dateStr: string) {
    const dow = new Date(dateStr + "T00:00:00").getDay();
    if (dateStr < todayStr || dow === 0 || dow === 6 || isHoliday(dateStr)) return;
    dragRef.current = { start: dateStr, current: dateStr };
    setDragRange({ start: dateStr, end: dateStr });
  }
  function handleDateMouseEnter(dateStr: string) {
    if (!dragRef.current) return;
    dragRef.current.current = dateStr;
    const s = dragRef.current.start;
    setDragRange(s <= dateStr ? { start: s, end: dateStr } : { start: dateStr, end: s });
  }
  function handleDateMouseUp(dateStr: string) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragRange(null);
    const dow = new Date(dateStr + "T00:00:00").getDay();
    if (dow === 0 || dow === 6 || isHoliday(dateStr)) return;
    const rangeStart = drag.start <= dateStr ? drag.start : dateStr;
    const rangeEnd = drag.start <= dateStr ? dateStr : drag.start;
    setModalDate(rangeStart);
    setModalEndDate(rangeStart === rangeEnd ? undefined : rangeEnd);
    setModalOpen(true);
  }

  const myRequests = state.leaveRequests
    .filter((r) => r.userId === user.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  const pendingRequests = useMemo(() => {
    if (!user.isManager) return [];
    return state.leaveRequests
      .filter((r) => r.userId !== user.id && r.status === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [state.leaveRequests, user.id, user.isManager]);

  async function handleCancelRequest(req: LeaveRequest) {
    await deleteLeave(req.id);
    showNotification("휴가 신청이 취소되었습니다.");
    setDetailReq(null);
    setCancelConfirmId(null);
  }

  async function handleQuickApprove(id: string) {
    await updateLeaveStatus(id, "approved");
    showNotification("휴가 신청이 승인되었습니다.");
    setQuickRejectOpen(null);
  }
  async function handleQuickReject(id: string) {
    const note = quickRejectNote[id] ?? "";
    if (!note.trim()) { showNotification("반려 사유를 입력해주세요.", "error"); return; }
    await updateLeaveStatus(id, "rejected", note);
    showNotification("휴가 신청이 반려되었습니다.");
    setQuickRejectOpen(null);
    setQuickRejectNote((p) => ({ ...p, [id]: "" }));
  }

  // ── Calendar shared UI ──
  function renderCalendar(isAdmin: boolean) {
    return (
      <div className="h-full flex flex-col bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
        <div className="flex-shrink-0 px-4 py-3 border-b border-outline-variant bg-surface-bright flex items-center justify-between">
          <h3 className="text-base font-bold text-on-surface">{isAdmin ? "팀 휴가 달력" : "휴가 달력"}</h3>
          <div className="flex items-center gap-1">
            <button onClick={prevMonth} className="w-7 h-7 rounded-full hover:bg-surface-container-high transition flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-on-surface-variant">chevron_left</span>
            </button>
            <span className="font-bold text-sm w-24 text-center text-on-surface">{viewYear}년 {MONTH_KO[viewMonth]}</span>
            <button onClick={nextMonth} className="w-7 h-7 rounded-full hover:bg-surface-container-high transition flex items-center justify-center">
              <span className="material-symbols-outlined text-lg text-on-surface-variant">chevron_right</span>
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col p-3">
          <div className="flex-shrink-0 grid grid-cols-7 mb-1">
            {DOW.map((d, i) => (
              <div key={d} className={`text-center text-xs font-bold py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-on-surface-variant"}`}>{d}</div>
            ))}
          </div>
          <div className="flex-1 grid grid-cols-7 gap-0.5 auto-rows-fr">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dow = new Date(viewYear, viewMonth, day).getDay();
              const isWeekend = dow === 0 || dow === 6;
              const isSun = dow === 0;
              const isToday = dateStr === todayStr;
              const leaves = teamLeaveDateMap[dateStr] ?? [];
              const showLeaves = leaves.slice(0, 2);
              const extra = leaves.length - showLeaves.length;

              const holidayName = getHolidayName(dateStr);
              const isPublicHoliday = holidayName !== null;

              if (isAdmin) {
                return (
                  <div key={day} title={holidayName ?? undefined} className={`min-h-16 p-1 rounded-lg border transition-colors ${isToday ? "border-primary bg-primary/5" : "border-transparent"} ${isWeekend || isPublicHoliday ? "bg-red-50/60" : "hover:bg-surface-container-low"}`}>
                    <span className={`text-xs font-medium leading-none block mb-0.5 ${isToday ? "font-bold text-primary" : isSun || isPublicHoliday ? "text-red-400" : dow === 6 ? "text-blue-400" : "text-on-surface"}`}>{day}</span>
                    {isPublicHoliday && <div className="text-[8px] text-red-400 leading-tight truncate">{holidayName}</div>}
                    {showLeaves.map((emp, idx) => {
                      const c = getUserColor(emp.userId, emp.name);
                      const isPending = emp.status === "pending";
                      return isPending ? (
                        <div key={idx} style={{ border: `1.5px solid ${c.text}`, color: c.text }} className="text-xs font-medium px-1.5 py-0.5 rounded mb-0.5 truncate leading-tight italic bg-white/80">{emp.name} <span className="opacity-70">· {LEAVE_SHORT[emp.type] ?? emp.type}</span></div>
                      ) : (
                        <div key={idx} style={{ backgroundColor: c.bg, color: c.text }} className="text-xs font-semibold px-2 py-1 rounded mb-0.5 truncate leading-tight">{emp.name} <span className="opacity-70 font-normal">· {LEAVE_SHORT[emp.type] ?? emp.type}</span></div>
                      );
                    })}
                    {extra > 0 && <div className="text-[11px] text-on-surface-variant px-0.5">외 {extra}명</div>}
                  </div>
                );
              }

              // User calendar — 팀 달력 방식 + 드래그 지원
              const isPast = dateStr < todayStr;
              const blocked = isWeekend || isPast || isPublicHoliday;
              const inDrag = !blocked && dragRange && dateStr >= dragRange.start && dateStr <= dragRange.end;

              return (
                <button key={day}
                  onMouseDown={() => !blocked && handleDateMouseDown(dateStr)}
                  onMouseEnter={() => handleDateMouseEnter(dateStr)}
                  onMouseUp={() => !blocked && handleDateMouseUp(dateStr)}
                  disabled={blocked}
                  title={holidayName ?? (isPast ? "지난 날짜" : isWeekend ? "주말" : `${dateStr} 휴가 신청`)}
                  className={`min-h-16 p-1 rounded-lg border transition-colors text-left w-full select-none
                    ${inDrag ? "bg-primary/15 border-primary" : isToday ? "border-primary bg-primary/5" : "border-transparent"}
                    ${isPast || isWeekend || isPublicHoliday ? "opacity-40 bg-red-50/40" : "hover:bg-surface-container-low cursor-pointer"}`}
                >
                  <span className={`text-xs font-medium leading-none block mb-0.5 ${inDrag ? "font-bold text-primary" : isSun || isPublicHoliday ? "text-red-400" : dow === 6 ? "text-blue-400" : isToday ? "font-bold text-primary" : "text-on-surface"}`}>{day}</span>
                  {isPublicHoliday && <div className="text-[8px] text-red-400 leading-tight truncate">{holidayName}</div>}
                  {showLeaves.map((emp, idx) => {
                    const c = getUserColor(emp.userId, emp.name);
                    const isPending = emp.status === "pending";
                    return isPending ? (
                      <div key={idx} style={{ border: `1.5px solid ${c.text}`, color: c.text }} className="text-xs font-medium px-1.5 py-0.5 rounded mb-0.5 truncate leading-tight italic bg-white/80">{emp.name} <span className="opacity-70">· {LEAVE_SHORT[emp.type] ?? emp.type}</span></div>
                    ) : (
                      <div key={idx} style={{ backgroundColor: c.bg, color: c.text }} className="text-xs font-semibold px-2 py-1 rounded mb-0.5 truncate leading-tight">{emp.name} <span className="opacity-70 font-normal">· {LEAVE_SHORT[emp.type] ?? emp.type}</span></div>
                    );
                  })}
                  {extra > 0 && <div className="text-[11px] text-on-surface-variant px-0.5">외 {extra}명</div>}
                </button>
              );
            })}
          </div>
          <div className="flex-shrink-0 flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-on-surface-variant">
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-100 inline-block" />승인됨</div>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border border-indigo-400 bg-white inline-block" /><span className="italic">검토중</span></div>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm ring-2 ring-primary inline-block bg-white" />오늘</div>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-50 border border-red-200 inline-block" /><span className="text-red-400">공휴일</span></div>
          </div>
        </div>
      </div>
    );
  }

  // 달력 확대 모달 (관리자/유저 공용)
  const calendarModal = calendarExpanded ? (
    <div
      className="fixed inset-0 z-[60] flex"
    >
      <div className="relative w-full h-full flex flex-col bg-[#f0f2f5] overflow-hidden">
        <button
          onClick={() => setCalendarExpanded(false)}
          className="absolute top-3 right-3 z-10 w-8 h-8 bg-white rounded-full shadow flex items-center justify-center hover:bg-gray-100 transition"
          title="닫기 (Esc)"
        >
          <span className="material-symbols-outlined text-xl text-gray-500">close</span>
        </button>
        {renderCalendar(user.isManager)}
      </div>
    </div>
  ) : null;

  // ── ADMIN DASHBOARD ──
  if (user.isManager) {
    return (
      <AppLayout>
        <div className="h-[calc(100vh-4rem)] overflow-hidden flex flex-col p-4 md:p-6 gap-4">
          {/* Header */}
          <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-on-surface">대시보드</h2>
              <p className="text-sm text-on-surface-variant">팀 휴가 현황을 확인합니다.</p>
            </div>
            <div className="flex items-center gap-2 self-start">
              <button
                onClick={() => window.open("/widget", "leave-widget", "width=400,height=650,left=20,top=20,resizable=yes,scrollbars=no")}
                className="flex items-center gap-2 px-4 py-2.5 border border-outline-variant bg-white text-on-surface rounded-xl font-bold text-sm hover:bg-surface-container-low transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-xl">widgets</span>
                위젯
              </button>
              <button
                onClick={() => { setModalDate(undefined); setModalEndDate(undefined); setModalOpen(true); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all active:scale-95"
              >
                <span className="material-symbols-outlined text-xl">add_circle</span>
                신규 휴가 신청
              </button>
            </div>
          </div>

          {/* Calendar + Right panel — fills remaining height */}
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
            <div className="flex-[2] min-h-0 min-w-0 cursor-zoom-in" onDoubleClick={() => setCalendarExpanded(true)}>{renderCalendar(true)}</div>

            {/* Right panel: Quick Approve + Recent */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col gap-4">

              {/* 빠른 승인 */}
              <div className="flex-1 min-h-0 bg-white rounded-xl border border-outline-variant shadow-sm flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-4 py-3 border-b border-outline-variant flex justify-between items-center bg-surface-bright">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg text-primary">task_alt</span>
                    <h3 className="text-base font-bold text-on-surface">빠른 승인</h3>
                    {pendingRequests.length > 0 && (
                      <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded-full">{pendingRequests.length}</span>
                    )}
                  </div>
                  <a href="/approval" className="text-xs text-primary font-medium hover:underline">전체 보기</a>
                </div>
                {pendingRequests.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant gap-1">
                    <span className="material-symbols-outlined text-3xl opacity-30">check_circle</span>
                    <p className="text-xs">대기 중인 신청이 없습니다.</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-outline-variant [&>*:last-child]:border-b [&>*:last-child]:border-outline-variant">
                    {pendingRequests.map((r) => (
                      <div key={r.id}>
                        <div className="px-4 py-2.5 flex items-center gap-2.5">
                          <div
                            className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setDetailReq(r)}
                          >
                            <div className="w-7 h-7 rounded-full bg-primary-fixed flex items-center justify-center text-primary text-[10px] font-bold flex-shrink-0">{r.initials}</div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-on-surface truncate">{r.userName}</p>
                              <p className="text-[11px] text-on-surface-variant truncate">{LEAVE_TYPE_LABELS[r.type]} · {r.startDate}{r.startDate !== r.endDate ? ` ~ ${r.endDate}` : ""} ({r.days}일)</p>
                            </div>
                          </div>
                          <button onClick={() => handleQuickApprove(r.id)} className="px-2.5 py-1 bg-primary text-white text-[11px] font-bold rounded-lg hover:opacity-90 transition flex-shrink-0">승인</button>
                          <button
                            onClick={() => setQuickRejectOpen(quickRejectOpen === r.id ? null : r.id)}
                            className="px-2.5 py-1 border border-error text-error text-[11px] font-bold rounded-lg hover:bg-error/5 transition flex-shrink-0"
                          >반려</button>
                        </div>
                        {quickRejectOpen === r.id && (
                          <div className="px-4 pb-3 flex flex-col gap-2">
                            <textarea
                              value={quickRejectNote[r.id] ?? ""}
                              onChange={(e) => setQuickRejectNote((p) => ({ ...p, [r.id]: e.target.value }))}
                              placeholder="반려 사유를 입력해주세요"
                              rows={2}
                              className="w-full p-2 border border-outline-variant rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                            />
                            <div className="flex gap-2">
                              <button onClick={() => handleQuickReject(r.id)} className="px-3 py-1.5 bg-error text-white text-[11px] font-bold rounded-lg hover:opacity-90">반려 확정</button>
                              <button onClick={() => setQuickRejectOpen(null)} className="px-3 py-1.5 text-on-surface-variant text-[11px] hover:underline">취소</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 연차 조정 */}
              <div className="flex-1 min-h-0 bg-white rounded-xl border border-outline-variant shadow-sm flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-4 py-3 border-b border-outline-variant flex items-center gap-2 bg-surface-bright">
                  <span className="material-symbols-outlined text-lg text-primary">card_giftcard</span>
                  <h3 className="text-base font-bold text-on-surface">연차 조정</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">직원 선택</label>
                    <select
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(e.target.value)}
                      className="w-full border border-outline-variant rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {grantEmployees.map((e) => {
                        const granted = grantCeilingTotal(state.leaveGrants, e.id);
                        const used = state.leaveRequests.filter((r) => r.userId === e.id && r.status === "approved").reduce((s, r) => s + r.days, 0);
                        return <option key={e.id} value={e.id}>{e.name} (잔여 {e.totalLeave + granted - used}일)</option>;
                      })}
                      {grantEmployees.length === 0 && <option disabled>직원 없음</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">
                      일수 <span className={`ml-1 font-bold ${grantDays > 0 ? "text-primary" : "text-error"}`}>{grantDays > 0 ? `+${grantDays}일 부여` : `${grantDays}일 차감`}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setGrantDays((d) => d > -30 ? Math.round((d - 0.5) * 2) / 2 : d)} className="w-8 h-8 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold text-lg flex items-center justify-center flex-shrink-0">−</button>
                      <input
                        type="number"
                        step="0.5"
                        value={grantDays}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!isNaN(v) && v !== 0 && v >= -30 && v <= 30 && Number.isInteger(v * 2)) setGrantDays(v);
                        }}
                        className="flex-1 border border-outline-variant rounded-xl text-sm px-3 py-2 text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button onClick={() => setGrantDays((d) => d < 30 ? Math.round((d + 0.5) * 2) / 2 : d)} className="w-8 h-8 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold text-lg flex items-center justify-center flex-shrink-0">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">사유</label>
                    <textarea
                      value={grantReason}
                      onChange={(e) => setGrantReason(e.target.value)}
                      placeholder={grantDays > 0 ? "예: 6월 주말 출근 보상" : "예: 연차 선사용 처리"}
                      rows={2}
                      className="w-full border border-outline-variant rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleGrant}
                    disabled={grantLoading}
                    className={`w-full py-2 text-white text-sm font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50 ${grantDays < 0 ? "bg-error" : "bg-primary"}`}
                  >
                    {grantLoading ? "처리 중..." : grantDays > 0 ? "연차 부여하기" : "연차 차감하기"}
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>

        <LeaveRequestModal
          open={modalOpen || !!editReq}
          initialDate={modalDate}
          initialEndDate={modalEndDate}
          editRequest={editReq ?? undefined}
          onClose={() => { setModalOpen(false); setEditReq(null); setDragRange(null); }}
        />
        {detailReq && (
          <LeaveDetailModal
            req={detailReq}
            onClose={() => { setDetailReq(null); setCancelConfirmId(null); }}
            onEdit={() => { setEditReq(detailReq); setDetailReq(null); }}
            onCancel={() => setCancelConfirmId(cancelConfirmId ? null : detailReq.id)}
            cancelConfirm={cancelConfirmId === detailReq.id}
            onCancelConfirm={() => handleCancelRequest(detailReq)}
          />
        )}
        {calendarModal}
      </AppLayout>
    );
  }

  // ── USER DASHBOARD ──
  return (
    <AppLayout>
      <div className="h-[calc(100vh-4rem)] overflow-hidden flex flex-col p-4 md:p-6 gap-4">
        {/* Header */}
        <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-on-surface">대시보드</h2>
            <p className="text-sm text-on-surface-variant">{user.name}님의 실시간 휴가 현황입니다.</p>
          </div>
          <button
            onClick={() => { setModalDate(undefined); setModalEndDate(undefined); setModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-xl font-bold text-sm hover:shadow-lg transition-all active:scale-95 self-start"
          >
            <span className="material-symbols-outlined text-xl">add_circle</span>
            신규 휴가 신청
          </button>
        </div>

        {/* Compact Stats */}
        <div className="flex-shrink-0 grid grid-cols-3 gap-3">
          <div className="bg-white flex items-center gap-3 p-3 rounded-xl border border-outline-variant shadow-sm">
            <div className="p-2 bg-primary-fixed rounded-lg flex-shrink-0">
              <span className="material-symbols-outlined text-primary text-lg">event_available</span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-on-surface-variant font-semibold leading-tight">총 연차</p>
              <p className="text-2xl font-bold text-primary leading-tight">{totalWithGrants}<span className="text-xs font-medium text-on-surface-variant ml-0.5">일</span></p>
              {unusedGrantDays > 0 && <p className="text-[10px] text-green-600 leading-tight">+{unusedGrantDays}일 부여</p>}
            </div>
          </div>
          <div className="bg-white flex items-center gap-3 p-3 rounded-xl border border-outline-variant shadow-sm">
            <div className="p-2 bg-secondary-fixed-dim rounded-lg flex-shrink-0">
              <span className="material-symbols-outlined text-secondary text-lg">pending_actions</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-on-surface-variant font-semibold leading-tight">사용 휴가</p>
              <p className="text-2xl font-bold text-secondary leading-tight">{usedLeave}<span className="text-xs font-medium text-on-surface-variant ml-0.5">일</span></p>
              <div className="mt-1 h-1 bg-surface-container rounded-full overflow-hidden">
                <div className="h-full bg-secondary rounded-full transition-all" style={{ width: `${usedPct}%` }} />
              </div>
            </div>
          </div>
          <div className="bg-white flex items-center gap-3 p-3 rounded-xl border border-outline-variant shadow-sm">
            <div className="p-2 bg-tertiary-fixed rounded-lg flex-shrink-0">
              <span className="material-symbols-outlined text-on-tertiary-fixed-variant text-lg">schedule</span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-on-surface-variant font-semibold leading-tight">남은 휴가</p>
              <p className={`text-2xl font-bold leading-tight ${remaining <= 3 ? "text-error" : "text-on-tertiary-fixed-variant"}`}>{remaining}<span className="text-xs font-medium text-on-surface-variant ml-0.5">일</span></p>
              {(() => {
                const d = daysUntilLeaveRenewal(user.joinDate ?? "");
                return d !== null && d >= 0 && d <= 30 ? (
                  <p className="text-[10px] text-primary leading-tight">{d}일 후 연차 갱신</p>
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Calendar + Recent — fills remaining height */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          <div className="flex-[2] min-h-0 min-w-0 cursor-zoom-in" onDoubleClick={() => setCalendarExpanded(true)}>{renderCalendar(false)}</div>

          {/* Recent requests */}
          <div className="flex-1 min-h-0 min-w-0 bg-white rounded-xl border border-outline-variant shadow-sm flex flex-col overflow-hidden">
            <div className="flex-shrink-0 px-4 py-3 border-b border-outline-variant bg-surface-bright flex items-center justify-between">
              <h3 className="text-base font-bold text-on-surface">최근 신청 내역</h3>
              {myRequests.length > 0 && (
                <button
                  onClick={() => setShowAllModal(true)}
                  className="text-xs text-primary font-semibold hover:underline flex items-center gap-0.5"
                >
                  전체보기
                  <span className="material-symbols-outlined text-sm">chevron_right</span>
                </button>
              )}
            </div>
            {myRequests.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-30">event_busy</span>
                <p className="text-sm">신청 내역이 없습니다.</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-outline-variant [&>*:last-child]:border-b [&>*:last-child]:border-outline-variant">
                {myRequests.map((r) => (
                  <div key={r.id} className="px-4 py-3 hover:bg-surface-container-low transition-colors cursor-pointer" onClick={() => setDetailReq(r)}>
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1 ${r.status === "approved" ? "bg-green-500" : r.status === "pending" ? "bg-yellow-500" : "bg-red-400"}`} />
                        <span className="font-semibold text-sm text-on-surface">{LEAVE_TYPE_LABELS[r.type]}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant ml-3.5">{r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`} · {r.days}일</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <LeaveRequestModal
        open={modalOpen || !!editReq}
        initialDate={modalDate}
        initialEndDate={modalEndDate}
        editRequest={editReq ?? undefined}
        onClose={() => { setModalOpen(false); setEditReq(null); setDragRange(null); }}
      />
      {detailReq && (
        <LeaveDetailModal
          req={detailReq}
          onClose={() => { setDetailReq(null); setCancelConfirmId(null); }}
          onEdit={() => { setEditReq(detailReq); setDetailReq(null); }}
          onCancel={() => setCancelConfirmId(cancelConfirmId ? null : detailReq.id)}
          cancelConfirm={cancelConfirmId === detailReq.id}
          onCancelConfirm={() => handleCancelRequest(detailReq)}
        />
      )}
      {calendarModal}

      {/* 전체 신청 내역 모달 */}
      {showAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAllModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col overflow-hidden" style={{ maxHeight: "85dvh" }} onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface-bright">
              <div>
                <h3 className="font-bold text-base text-on-surface">전체 신청 내역</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">총 {state.leaveRequests.filter((r) => r.userId === user.id).length}건</p>
              </div>
              <button onClick={() => setShowAllModal(false)} className="p-1.5 hover:bg-surface-container-high rounded-full transition">
                <span className="material-symbols-outlined text-xl text-on-surface-variant">close</span>
              </button>
            </div>

            {/* 상태 필터 탭 */}
            <div className="flex-shrink-0 flex gap-1 px-4 pt-3 pb-2 border-b border-outline-variant">
              {(["all", "pending", "approved", "rejected"] as const).map((f) => {
                const labels = { all: "전체", pending: "검토중", approved: "승인됨", rejected: "반려됨" };
                const counts = {
                  all: state.leaveRequests.filter((r) => r.userId === user.id).length,
                  pending: state.leaveRequests.filter((r) => r.userId === user.id && r.status === "pending").length,
                  approved: state.leaveRequests.filter((r) => r.userId === user.id && r.status === "approved").length,
                  rejected: state.leaveRequests.filter((r) => r.userId === user.id && r.status === "rejected").length,
                };
                return (
                  <button
                    key={f}
                    onClick={() => setAllFilter(f)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      allFilter === f ? "bg-primary text-white" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {labels[f]}
                    <span className={`text-[10px] font-bold ${allFilter === f ? "opacity-80" : "opacity-60"}`}>{counts[f]}</span>
                  </button>
                );
              })}
            </div>

            {/* 목록 */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-outline-variant">
              {(() => {
                const filtered = state.leaveRequests
                  .filter((r) => r.userId === user.id && (allFilter === "all" || r.status === allFilter))
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-30">event_busy</span>
                      <p className="text-sm">해당 내역이 없습니다.</p>
                    </div>
                  );
                }
                return filtered.map((r) => (
                  <div
                    key={r.id}
                    className="px-5 py-3.5 hover:bg-surface-container-low transition-colors cursor-pointer"
                    onClick={() => { setDetailReq(r); setShowAllModal(false); }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.status === "approved" ? "bg-green-500" : r.status === "pending" ? "bg-yellow-500" : "bg-red-400"}`} />
                        <span className="font-semibold text-sm text-on-surface">{LEAVE_TYPE_LABELS[r.type]}</span>
                        <span className="text-xs text-on-surface-variant">{r.days}일</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant ml-3.5">
                      {r.startDate === r.endDate ? r.startDate : `${r.startDate} ~ ${r.endDate}`}
                    </p>
                    {r.status === "rejected" && r.reviewNote && (
                      <p className="text-xs text-error ml-3.5 mt-0.5 truncate">반려 사유: {r.reviewNote}</p>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function LeaveDetailModal({ req, onClose, onEdit, onCancel, cancelConfirm, onCancelConfirm }: {
  req: LeaveRequest;
  onClose: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  cancelConfirm?: boolean;
  onCancelConfirm?: () => void;
}) {
  const statusStyles = {
    approved: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    rejected: "bg-red-100 text-red-700",
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-outline-variant bg-surface-bright flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary text-sm font-bold">{req.initials}</div>
            <div>
              <p className="font-bold text-sm text-on-surface">{req.userName}</p>
              <p className="text-xs text-on-surface-variant">{LEAVE_TYPE_LABELS[req.type]}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-container-high rounded-full transition">
            <span className="material-symbols-outlined text-xl text-on-surface-variant">close</span>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-on-surface-variant mb-1">기간</p>
              <p className="text-sm font-semibold text-on-surface">{req.startDate === req.endDate ? req.startDate : `${req.startDate} ~ ${req.endDate}`}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{req.days}일</p>
            </div>
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${statusStyles[req.status]}`}>{STATUS_LABELS[req.status]}</span>
          </div>
          {req.projectName && (
            <div className="p-3 bg-surface-container-low rounded-xl space-y-1">
              <p className="text-xs font-bold text-on-surface-variant">프로젝트</p>
              <p className="text-sm text-on-surface">{req.projectName}</p>
              {req.progress !== undefined && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${req.progress}%` }} />
                  </div>
                  <span className="text-xs text-on-surface-variant">{req.progress}%</span>
                </div>
              )}
            </div>
          )}
          {req.handoverNotes && (
            <div>
              <p className="text-xs font-bold text-on-surface-variant mb-1">인수인계 사항</p>
              <p className="text-sm text-on-surface bg-surface-container-low rounded-xl p-3 leading-relaxed">{req.handoverNotes}</p>
            </div>
          )}
          {req.emergencyContact && (
            <div>
              <p className="text-xs font-bold text-on-surface-variant mb-1">비상 연락망</p>
              <p className="text-sm text-on-surface">{req.emergencyContact}</p>
            </div>
          )}
          {req.status === "rejected" && req.reviewNote && (
            <div className="p-3 bg-error-container/20 border border-error/20 rounded-xl">
              <p className="text-xs font-bold text-error mb-1">반려 사유</p>
              <p className="text-sm text-on-surface">{req.reviewNote}</p>
            </div>
          )}
          {req.reviewedBy && <p className="text-xs text-on-surface-variant">처리: {req.reviewedBy}</p>}
        </div>
        <div className="px-6 pb-5 space-y-2">
          {/* 취소 확인 단계 */}
          {cancelConfirm ? (
            <div className="p-3 bg-error/5 border border-error/20 rounded-xl space-y-2">
              <p className="text-sm font-semibold text-error text-center">정말 취소하시겠어요?</p>
              {req.status === "approved" && (
                <p className="text-xs text-on-surface-variant text-center">승인된 휴가가 취소되어 연차가 복원됩니다.</p>
              )}
              <div className="flex gap-2">
                <button onClick={onCancelConfirm} className="flex-1 py-2 bg-error text-white text-sm font-bold rounded-xl hover:opacity-90 transition">취소 확정</button>
                <button onClick={() => onCancel?.()} className="flex-1 py-2 border border-outline-variant text-sm text-on-surface-variant rounded-xl hover:bg-surface-container-low transition">돌아가기</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              {req.status === "pending" && onEdit && req.endDate >= new Date().toISOString().split("T")[0] && (
                <button onClick={onEdit} className="flex-1 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:opacity-90 transition flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-base">edit</span>수정
                </button>
              )}
              {(req.status === "pending" || req.status === "approved") && onCancel && req.endDate >= new Date().toISOString().split("T")[0] && (
                <button onClick={onCancel} className="flex-1 py-2.5 border border-error text-error text-sm font-bold rounded-xl hover:bg-error/5 transition flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-base">cancel</span>취소
                </button>
              )}
              <button onClick={onClose} className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition">닫기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
