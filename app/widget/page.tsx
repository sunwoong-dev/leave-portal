"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { LEAVE_TYPE_LABELS } from "@/lib/types";
import { isHoliday, getHolidayName } from "@/lib/holidays";

const DOW_SHORT = ["일", "월", "화", "수", "목", "금", "토"];

const USER_PALETTE = [
  { bg: "#dbeafe", text: "#1d4ed8" },
  { bg: "#f3e8ff", text: "#7e22ce" },
  { bg: "#d1fae5", text: "#065f46" },
  { bg: "#fce7f3", text: "#be185d" },
  { bg: "#e0f2fe", text: "#0369a1" },
  { bg: "#fff7ed", text: "#c2410c" },
  { bg: "#eef2ff", text: "#4338ca" },
  { bg: "#ccfbf1", text: "#0f766e" },
  { bg: "#fdf4ff", text: "#a21caf" },
  { bg: "#fef9c3", text: "#a16207" },
  { bg: "#ecfccb", text: "#3f6212" },
  { bg: "#ffe4e6", text: "#be123c" },
];

const USER_COLOR_OVERRIDES: Record<string, number> = {
  "문선웅": 9,
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

export default function WidgetPage() {
  const { state, hydrated } = useStore();
  const router = useRouter();
  const user = state.currentUser;

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const leaveDateMap = useMemo(() => {
    const map: Record<string, Array<{ name: string; userId: string; type: string; status: string }>> = {};
    state.leaveRequests.filter((r) => r.status !== "rejected").forEach((r) => {
      const cur = new Date(r.startDate + "T00:00:00");
      const end = new Date(r.endDate + "T00:00:00");
      while (cur <= end) {
        const dow = cur.getDay();
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
        if (dow !== 0 && dow !== 6 && !isHoliday(key)) {
          if (!map[key]) map[key] = [];
          if (!map[key].some((e) => e.userId === r.userId))
            map[key].push({ name: r.userName, userId: r.userId, type: r.type, status: r.status });
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    return map;
  }, [state.leaveRequests]);

  if (!hydrated) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#1a2b4a]">
        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    router.replace("/login");
    return null;
  }

  if (!user.isManager) {
    router.replace("/dashboard");
    return null;
  }

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

  // 선택된 날짜 포맷 (모달 헤더용)
  function fmtSelected(ds: string) {
    const [y, m, d] = ds.split("-");
    const dow = new Date(Number(y), Number(m) - 1, Number(d)).getDay();
    return `${Number(m)}월 ${Number(d)}일 (${DOW_SHORT[dow]})`;
  }

  const selectedLeaves = selectedDate ? (leaveDateMap[selectedDate] ?? []) : [];

  // 범례: 이번 달에 휴가 있는 사람만
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const monthUserIds = Array.from(
    new Set(
      Object.entries(leaveDateMap)
        .filter(([k]) => k.startsWith(monthPrefix))
        .flatMap(([, v]) => v.map((l) => l.userId))
    )
  );

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden" style={{ fontFamily: "inherit" }}>

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={prevMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition">
          <span className="material-symbols-outlined text-gray-500">chevron_left</span>
        </button>
        <span className="font-bold text-gray-800 text-base">{viewYear}년 {viewMonth + 1}월</span>
        <button onClick={nextMonth} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition">
          <span className="material-symbols-outlined text-gray-500">chevron_right</span>
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 px-2 pt-2">
        {DOW_SHORT.map((d, i) => (
          <div key={d} className={`text-center text-xs font-bold py-1 ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-gray-400"}`}>
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 px-2 flex-1">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dow = new Date(viewYear, viewMonth, day).getDay();
          const isWeekend = dow === 0 || dow === 6;
          const isToday = ds === todayStr;
          const isHol = isHoliday(ds);
          const leaves = leaveDateMap[ds] ?? [];
          const hasLeave = leaves.length > 0;
          const isSelected = ds === selectedDate;

          return (
            <div
              key={day}
              title={getHolidayName(ds) ?? undefined}
              onClick={() => hasLeave ? setSelectedDate(ds === selectedDate ? null : ds) : undefined}
              className={`flex flex-col items-center py-1 rounded-lg transition
                ${hasLeave ? "cursor-pointer hover:bg-gray-50" : ""}
                ${isSelected ? "bg-gray-100" : ""}`}
            >
              <span className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                ${isToday ? "bg-[#1a2b4a] text-white font-bold" : isWeekend || isHol ? "text-red-400" : "text-gray-700"}`}>
                {day}
              </span>
              {hasLeave && !isWeekend && !isHol && (
                <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center" style={{ maxWidth: "32px" }}>
                  {leaves.slice(0, 4).map((l, idx) => {
                    const c = getUserColor(l.userId, l.name);
                    return <div key={idx} className="w-2 h-2 rounded-full" style={{ backgroundColor: c.bg, border: `1.5px solid ${c.text}` }} />;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 범례 */}
      {monthUserIds.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 flex flex-wrap gap-x-3 gap-y-1">
          {monthUserIds.slice(0, 8).map((uid) => {
            const name = Object.values(leaveDateMap).flat().find((l) => l.userId === uid)?.name ?? "";
            return (
              <div key={uid} className="flex items-center gap-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getUserColor(uid, name).bg, border: `1.5px solid ${getUserColor(uid, name).text}` }} />
                <span className="text-[11px] text-gray-500">{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* 날짜 클릭 모달 */}
      {selectedDate && (
        <div className="absolute inset-0 bg-black/30 flex items-end" onClick={() => setSelectedDate(null)}>
          <div className="bg-white w-full rounded-t-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100">
              <span className="font-bold text-gray-800">{fmtSelected(selectedDate)}</span>
              <button onClick={() => setSelectedDate(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100">
                <span className="material-symbols-outlined text-gray-400 text-lg">close</span>
              </button>
            </div>
            <div className="divide-y divide-gray-50 max-h-52 overflow-y-auto">
              {selectedLeaves.map((l, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getUserColor(l.userId, l.name).bg, border: `2px solid ${getUserColor(l.userId, l.name).text}` }} />
                  <span className="font-semibold text-gray-800 flex-1">{l.name}</span>
                  <span className="text-sm text-gray-400">{LEAVE_TYPE_LABELS[l.type as keyof typeof LEAVE_TYPE_LABELS] ?? l.type}</span>
                  {l.status === "pending" && (
                    <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-bold">검토중</span>
                  )}
                </div>
              ))}
            </div>
            <div className="h-4" />
          </div>
        </div>
      )}
    </div>
  );
}
