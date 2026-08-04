"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { LeaveType, DeadlineStatus, LEAVE_TYPE_LABELS, DEADLINE_STATUS_LABELS } from "@/lib/types";
import { isHoliday } from "@/lib/holidays";
import { toLocalDateStr, todayLocalStr } from "@/lib/dateUtils";

const todayStr = todayLocalStr();

function isHalfDay(t: LeaveType) {
  return t === "half-am" || t === "half-pm";
}

function calcDays(start: string, end: string, type: LeaveType): number {
  if (!start || !end || end < start) return 0;
  let n = 0;
  const cur = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  while (cur <= e) {
    const dow = cur.getDay();
    const ds = toLocalDateStr(cur);
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return isHalfDay(type) ? n * 0.5 : n;
}

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

const FORM_LEAVE_OPTIONS: [LeaveType, string][] = [
  ["annual", "연차"],
  ["half-am", "오전 반차"],
  ["half-pm", "오후 반차"],
  ["other", "기타"],
];

const CHECKLIST = [
  {
    key: "checkResearchNote" as const,
    label: "연구노트 최신화 완료",
    desc: "수행 중인 과제의 연구 기록물이 정리되었습니까?",
  },
  {
    key: "checkGanttChart" as const,
    label: "간트차트 일정 업데이트 완료",
    desc: "일정 관리 툴의 본인 태스크가 업데이트 되었습니까?",
  },
  {
    key: "checkStakeholder" as const,
    label: "관련 부서/담당자 사전 공유 완료",
    desc: "관련 부서담당자에게 부재 일정을 공유하였습니까?",
  },
];

function RequestFormInner() {
  const { state, usedLeave, grantedDays, addLeave, showNotification } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = state.currentUser;

  const preDate = searchParams.get("date") ?? todayStr;

  const [step, setStep] = useState(1);

  // Step 1
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState(preDate);
  const [endDate, setEndDate] = useState(preDate);

  // Step 2
  const [projectName, setProjectName] = useState("");
  const [progress, setProgress] = useState(0);
  const [deadlineStatus, setDeadlineStatus] = useState<DeadlineStatus>("on_track");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");

  // Step 3
  const [checks, setChecks] = useState({
    checkResearchNote: false,
    checkGanttChart: false,
    checkStakeholder: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  if (!user) return null;

  const half = isHalfDay(leaveType);
  const days = calcDays(startDate, endDate, leaveType);
  const remaining = user.leaveBalance;

  function validateStep1() {
    const e: Record<string, string> = {};
    if (!startDate) e.startDate = "시작일을 선택해주세요.";
    if (endDate && endDate < startDate) e.endDate = "종료일은 시작일 이후여야 합니다.";
    if (days > remaining) e.days = `잔여 연차(${remaining}일)가 부족합니다.`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2() {
    const e: Record<string, string> = {};
    if (!projectName.trim()) e.projectName = "프로젝트명을 입력해주세요.";
    if (!handoverNotes.trim()) e.handoverNotes = "인수인계 사항을 입력해주세요.";
    if (!emergencyContact.trim()) e.emergencyContact = "비상 연락망을 입력해주세요.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleNext() {
    setErrors({});
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleBack() {
    if (step === 1) router.back();
    else { setErrors({}); setStep((s) => s - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
  }

  async function handleSubmit() {
    if (!user) return;
    if (!checks.checkResearchNote || !checks.checkGanttChart || !checks.checkStakeholder) {
      setErrors({ checklist: "모든 확인 사항을 체크해주세요." });
      return;
    }
    setSubmitting(true);
    await addLeave({
      userId: user.id,
      userName: user.name,
      department: "",
      role: "",
      initials: user.initials,
      type: leaveType,
      startDate,
      endDate,
      days,
      reason: handoverNotes,
      status: "pending",
      projectName,
      progress,
      deadlineStatus,
      handoverNotes,
      emergencyContact,
      checkResearchNote: checks.checkResearchNote,
      checkGanttChart: checks.checkGanttChart,
      checkStakeholder: checks.checkStakeholder,
    });
    setSubmitting(false);
    showNotification("휴가 신청서가 제출되었습니다.");
    router.push("/dashboard");
  }

  // ── styles ──────────────────────────────────────────────
  const inputCls = "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 bg-white transition";
  const errInputCls = "border-red-300 focus:ring-red-200 focus:border-red-400";

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex flex-col max-w-lg mx-auto">

      {/* ── Header ── */}
      <div className="bg-white sticky top-0 z-20 border-b border-gray-100">
        <div className="flex items-center h-14 px-4 gap-3">
          <button
            onClick={handleBack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition"
          >
            <span className="material-symbols-outlined text-xl text-gray-600">arrow_back</span>
          </button>
          <h1 className="flex-1 text-center font-bold text-base text-gray-800">휴가 신청서</h1>
          <div className="w-8" />
        </div>

        {/* Step progress bar */}
        <div className="px-6 pb-3 flex items-center gap-0">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors ${
                s < step ? "bg-blue-600 text-white" :
                s === step ? "bg-[#1a2b4a] text-white" :
                "bg-gray-200 text-gray-400"
              }`}>
                {s < step
                  ? <span className="material-symbols-outlined text-sm">check</span>
                  : s
                }
              </div>
              {s < 3 && (
                <div className={`flex-1 h-0.5 mx-1 transition-colors ${s < step ? "bg-blue-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
          <span className="ml-3 text-xs text-gray-400 flex-shrink-0">{step} / 3</span>
        </div>
      </div>

      {/* ── Form Content ── */}
      <div className="flex-1 px-4 py-5 space-y-4 pb-32">

        {/* ───── STEP 1 ───── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-l-4 border-[#1a2b4a]">
              <h2 className="font-bold text-sm text-gray-800">1. 기본 정보</h2>
            </div>
            <div className="px-5 pb-5 space-y-5">

              {/* 신청인 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">신청인</label>
                <div className="px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-sm font-medium text-gray-700">
                  {user.name}
                </div>
              </div>

              {/* 휴가 종류 */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">휴가 종류</label>
                <div className="grid grid-cols-2 gap-2">
                  {FORM_LEAVE_OPTIONS.map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setLeaveType(v); setErrors({}); }}
                      className={`py-3 rounded-xl text-sm font-semibold border-2 transition-all active:scale-95 ${
                        leaveType === v
                          ? "bg-[#1a2b4a] text-white border-[#1a2b4a] shadow-sm"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* 휴가 기간 */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">휴가 기간</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setErrors({}); }}
                  className={`${inputCls} ${errors.startDate ? errInputCls : ""}`}
                />
                {errors.startDate && <p className="text-xs text-red-500 mt-1">{errors.startDate}</p>}

                <div className="flex items-center justify-center my-2">
                  <span className="text-gray-400 text-sm font-medium">~</span>
                </div>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => { setEndDate(e.target.value); setErrors({}); }}
                  className={`${inputCls} ${errors.endDate ? errInputCls : ""}`}
                />
                {errors.endDate && <p className="text-xs text-red-500 mt-1">{errors.endDate}</p>}

                <div className="flex justify-end mt-2">
                  <span className="text-sm text-gray-500">
                    총 일수: <span className="font-bold text-[#1a2b4a]">{days}일</span>
                  </span>
                </div>
                {errors.days && (
                  <div className="flex items-center gap-1.5 mt-1 p-2.5 bg-red-50 rounded-lg">
                    <span className="material-symbols-outlined text-red-500 text-sm">warning</span>
                    <p className="text-xs text-red-500">{errors.days}</p>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ───── STEP 2 ───── */}
        {step === 2 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-l-4 border-[#1a2b4a] flex items-center gap-2">
              <h2 className="font-bold text-sm text-gray-800">2. 업무 진척도 및 인수인계</h2>
              <span className="text-xs text-red-400">(필수 작성)</span>
            </div>
            <div className="px-5 pb-5 space-y-5">

              {/* 프로젝트명 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">담당 프로젝트명</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => { setProjectName(e.target.value); setErrors((er) => ({ ...er, projectName: "" })); }}
                  placeholder="진행 중인 프로젝트명을 입력하세요"
                  className={`${inputCls} ${errors.projectName ? errInputCls : ""}`}
                />
                {errors.projectName && <p className="text-xs text-red-500 mt-1">{errors.projectName}</p>}
              </div>

              {/* 진행률 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">현재 진행률 (%)</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(progress)}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "");
                      setProgress(raw === "" ? 0 : Math.min(100, Math.max(0, parseInt(raw, 10))));
                    }}
                    className={`${inputCls} pr-9`}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">%</span>
                </div>
              </div>

              {/* 마감 기한 */}
              <div>
                <label className="block text-xs text-gray-500 mb-2">마감 기한 준수 여부</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(DEADLINE_STATUS_LABELS) as [DeadlineStatus, string][]).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDeadlineStatus(v)}
                      className={`py-2.5 rounded-xl text-xs font-semibold border-2 transition-all active:scale-95 ${
                        deadlineStatus === v
                          ? "bg-[#1a2b4a] text-white border-[#1a2b4a]"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* 인수인계 사항 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">주요 인수인계 사항</label>
                <textarea
                  value={handoverNotes}
                  onChange={(e) => { setHandoverNotes(e.target.value); setErrors((er) => ({ ...er, handoverNotes: "" })); }}
                  rows={4}
                  placeholder="부재 시 대행할 업무의 상세 내용 및 확인 경로를 입력하세요"
                  className={`${inputCls} resize-none ${errors.handoverNotes ? errInputCls : ""}`}
                />
                {errors.handoverNotes && <p className="text-xs text-red-500 mt-1">{errors.handoverNotes}</p>}
              </div>

              {/* 비상 연락망 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">비상 연락망</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={emergencyContact}
                  placeholder="010-0000-0000"
                  maxLength={13}
                  onChange={(e) => {
                    setEmergencyContact(formatPhone(e.target.value));
                    setErrors((er) => ({ ...er, emergencyContact: "" }));
                  }}
                  className={`${inputCls} ${errors.emergencyContact ? errInputCls : ""}`}
                />
                {errors.emergencyContact && <p className="text-xs text-red-500 mt-1">{errors.emergencyContact}</p>}
              </div>

            </div>
          </div>
        )}

        {/* ───── STEP 3 ───── */}
        {step === 3 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-l-4 border-[#1a2b4a]">
              <h2 className="font-bold text-sm text-gray-800">3. 신청인 확인 사항</h2>
            </div>
            <div className="px-5 pb-5 space-y-3">
              {CHECKLIST.map((item) => {
                const checked = checks[item.key];
                return (
                  <label
                    key={item.key}
                    className={`flex items-start gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                      checked ? "border-[#1a2b4a] bg-[#1a2b4a]/5" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                      checked ? "bg-[#1a2b4a] border-[#1a2b4a]" : "border-gray-300 bg-white"
                    }`}>
                      {checked && <span className="material-symbols-outlined text-white text-sm">check</span>}
                    </div>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={(e) => {
                        setChecks((c) => ({ ...c, [item.key]: e.target.checked }));
                        setErrors((er) => ({ ...er, checklist: "" }));
                      }}
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{item.desc}</p>
                    </div>
                  </label>
                );
              })}

              {errors.checklist && (
                <div className="flex items-center gap-2 p-3 bg-red-50 rounded-xl">
                  <span className="material-symbols-outlined text-red-500 text-sm">warning</span>
                  <p className="text-xs text-red-500">{errors.checklist}</p>
                </div>
              )}

              <div className="pt-4 mt-2 border-t border-gray-100 text-center">
                <p className="text-xs text-gray-500 leading-relaxed">
                  위와 같이 휴가를 신청하며,<br />
                  부재 중 업무 공백이 발생하지 않도록 조치하겠습니다.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-[#1a2b4a] px-4 py-4 z-20">
        {step < 3 ? (
          <button
            onClick={handleNext}
            className="w-full py-4 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 active:opacity-80 transition"
          >
            다음
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-4 text-white font-bold text-base rounded-xl flex items-center justify-center gap-2 active:opacity-80 transition disabled:opacity-60"
          >
            {submitting ? (
              <><span className="material-symbols-outlined animate-spin text-xl">progress_activity</span> 제출 중...</>
            ) : (
              "신청하기"
            )}
          </button>
        )}
      </div>

    </div>
  );
}

export default function LeaveRequestPage() {
  return (
    <Suspense>
      <RequestFormInner />
    </Suspense>
  );
}
