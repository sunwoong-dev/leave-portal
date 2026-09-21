"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { LeaveType, LEAVE_TYPE_LABELS } from "@/lib/types";
import { todayLocalStr } from "@/lib/dateUtils";
import { calcDays } from "@/components/LeaveRequestModal";

const BULK_TYPES: LeaveType[] = ["annual", "half-am", "half-pm", "reservist", "sick", "other"];

export default function BulkLeaveModal({ onClose }: { onClose: () => void }) {
  const { state, addBulkLeave, showNotification } = useStore();
  const [type, setType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState(todayLocalStr());
  const [endDate, setEndDate] = useState(todayLocalStr());
  const [submitting, setSubmitting] = useState(false);

  const days = calcDays(startDate, endDate, type, state.holidays);
  const invalid = !startDate || !endDate || endDate < startDate || days === 0;

  async function handleSubmit() {
    if (invalid || submitting) return;
    if (!window.confirm(`전직원에게 ${LEAVE_TYPE_LABELS[type]} ${days}일(${startDate} ~ ${endDate})을 일괄 사용 처리합니다.\n승인 즉시 각 직원의 연차가 차감됩니다. 진행할까요?`)) return;
    setSubmitting(true);
    try {
      await addBulkLeave(type, startDate, endDate, days);
      showNotification("전직원 휴가가 일괄 처리되었습니다.");
      onClose();
    } catch {
      showNotification("일괄 처리 중 오류가 발생했습니다. 일부 직원만 차감되었을 수 있으니 Leave History를 확인해주세요.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full px-4 py-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright flex items-center justify-between">
          <h3 className="font-bold text-base text-on-surface">전직원 일괄 신청</h3>
          <button onClick={onClose} className="p-1 hover:bg-surface-container-high rounded-full transition">
            <span className="material-symbols-outlined text-xl text-on-surface-variant">close</span>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">휴가 유형</label>
            <select value={type} onChange={(e) => setType(e.target.value as LeaveType)} className={inputCls}>
              {BULK_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-on-surface-variant mb-1.5">휴가 기간</label>
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} className={inputCls} />
            <div className="text-center text-gray-400 text-sm my-1">~</div>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            <p className="text-right text-sm text-on-surface-variant mt-2">총 일수: <span className="font-bold text-primary">{days}일</span></p>
            {days === 0 && startDate && <p className="text-xs text-error mt-1">주말·공휴일만 선택되어 사용 일수가 0일입니다.</p>}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition">취소</button>
          <button onClick={handleSubmit} disabled={invalid || submitting} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50">
            {submitting ? "처리 중..." : "일괄 신청"}
          </button>
        </div>
      </div>
    </div>
  );
}
