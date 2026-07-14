"use client";

import { useState, useRef, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { db } from "@/lib/firebase";
import { collection, getDocs, addDoc } from "firebase/firestore";
import { LeaveType, DeadlineStatus, LEAVE_TYPE_LABELS, DEADLINE_STATUS_LABELS } from "@/lib/types";
import { isHoliday } from "@/lib/holidays";
import type { ParsedLeaveData } from "@/lib/pdfImport";

const LEAVE_OPTIONS: [LeaveType, string][] = [
  ["annual", "연차"],
  ["monthly", "월차"],
  ["half-am", "오전 반차"],
  ["half-pm", "오후 반차"],
  ["other", "기타"],
];

const DEADLINE_OPTIONS: [DeadlineStatus, string][] = [
  ["completed", "완료"],
  ["on_track", "진행 중"],
  ["delayed", "지연 중"],
];

function calcDays(start: string, end: string, type: LeaveType): number {
  if (!start || !end || end < start) return 0;
  const half = type === "half-am" || type === "half-pm";
  let n = 0;
  const cur = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  while (cur <= e) {
    const dow = cur.getDay();
    const ds = cur.toISOString().split("T")[0];
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return half ? n * 0.5 : n;
}

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

interface Employee {
  id: string;
  name: string;
  initials: string;
  department: string;
  role: string;
}

export default function ImportPage() {
  const { state, showNotification } = useStore();
  const user = state.currentUser;

  const [tab, setTab] = useState<"manual" | "pdf">("manual");
  const [employees, setEmployees] = useState<Employee[]>([]);

  // form fields
  const [selectedUserId, setSelectedUserId] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [projectName, setProjectName] = useState("");
  const [progress, setProgress] = useState(0);
  const [deadlineStatus, setDeadlineStatus] = useState<DeadlineStatus>("on_track");
  const [handoverNotes, setHandoverNotes] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [checkResearchNote, setCheckResearchNote] = useState(true);
  const [checkGanttChart, setCheckGanttChart] = useState(true);
  const [checkStakeholder, setCheckStakeholder] = useState(true);
  const [adjustBalance, setAdjustBalance] = useState(false);

  // PDF
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedLeaveData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.isManager) return;
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      setEmployees(
        snap.docs
          .filter((d) => !d.data().isManager)
          .map((d) => ({
            id: d.id,
            name: d.data().name as string,
            initials: (d.data().initials as string) ?? (d.data().name as string).slice(0, 2),
            department: (d.data().department as string) ?? "",
            role: (d.data().role as string) ?? "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      );
    });
  }, [user?.isManager]);

  // 과거 데이터 입력 기능: 로컬 개발 환경에서만 동작 (프로덕션에서는 직접 URL 접근도 차단)
  if (process.env.NODE_ENV === "production") return null;
  if (!user?.isManager) return null;

  const days = calcDays(startDate, endDate, leaveType);
  const selectedEmp = employees.find((e) => e.id === selectedUserId);

  async function handlePdfParse() {
    if (!pdfFile) return;
    setPdfParsing(true);
    try {
      const { extractTextFromPDF, parseLeavePDF } = await import("@/lib/pdfImport");
      const text = await extractTextFromPDF(pdfFile);
      const data = await parseLeavePDF(text);
      setParsed(data);
      if (data.userName) {
        const match = employees.find((e) => e.name === data.userName);
        if (match) setSelectedUserId(match.id);
      }
      if (data.startDate) setStartDate(data.startDate);
      if (data.endDate) setEndDate(data.endDate ?? data.startDate ?? "");
      if (data.type) setLeaveType(data.type);
      if (data.reason) setReason(data.reason);
      if (data.projectName) setProjectName(data.projectName);
      if (data.progress !== undefined) setProgress(data.progress);
      if (data.handoverNotes) setHandoverNotes(data.handoverNotes);
      if (data.emergencyContact) setEmergencyContact(data.emergencyContact);
      showNotification("PDF 파싱 완료. 내용을 확인하고 저장하세요.");
      setTab("manual");
    } catch {
      showNotification("PDF 파싱 중 오류가 발생했습니다.", "error");
    } finally {
      setPdfParsing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!selectedUserId) { showNotification("직원을 선택해주세요.", "error"); return; }
    if (!startDate || !endDate) { showNotification("날짜를 입력해주세요.", "error"); return; }
    if (endDate < startDate) { showNotification("종료일이 시작일보다 앞설 수 없습니다.", "error"); return; }
    if (days <= 0) { showNotification("유효한 날짜를 선택해주세요. (주말·공휴일 제외)", "error"); return; }
    if (!reason.trim()) { showNotification("사유를 입력해주세요.", "error"); return; }

    const emp = employees.find((e) => e.id === selectedUserId);
    if (!emp) return;

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, "leave_portal_requests"), {
        userId: selectedUserId,
        userName: emp.name,
        department: emp.department || "",
        role: emp.role || "",
        initials: emp.initials,
        type: leaveType,
        startDate,
        endDate,
        days,
        reason: reason.trim(),
        status: "approved",
        createdAt: startDate + "T09:00:00.000Z",
        reviewedBy: `${user.name} (과거 데이터 입력)`,
        reviewedAt: now,
        projectName: projectName || "",
        progress: progress || 0,
        deadlineStatus,
        handoverNotes: handoverNotes || "",
        emergencyContact: emergencyContact || "",
        checkResearchNote,
        checkGanttChart,
        checkStakeholder,
      });

      showNotification(`${emp.name}님의 과거 휴가 데이터가 저장되었습니다.`);

      // 폼 초기화
      setSelectedUserId("");
      setLeaveType("annual");
      setStartDate("");
      setEndDate("");
      setReason("");
      setProjectName("");
      setProgress(0);
      setDeadlineStatus("on_track");
      setHandoverNotes("");
      setEmergencyContact("");
      setCheckResearchNote(true);
      setCheckGanttChart(true);
      setCheckStakeholder(true);
      setParsed(null);
      setPdfFile(null);
    } catch {
      showNotification("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition bg-white";
  const labelCls = "block text-xs font-bold text-on-surface-variant mb-1.5";

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">과거 데이터 입력</h2>
          <p className="text-sm text-on-surface-variant mt-1">이 시스템 도입 이전의 휴가 내역을 등록합니다. 승인 완료 상태로 저장됩니다.</p>
        </div>

        {/* 탭 */}
        <div className="flex gap-2 border-b border-outline-variant">
          {([["manual", "직접 입력"], ["pdf", "PDF 업로드"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors -mb-px ${
                tab === key ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* PDF 업로드 탭 */}
        {tab === "pdf" && (
          <div className="bg-white rounded-xl border border-outline-variant shadow-sm p-6 space-y-4">
            <p className="text-sm text-on-surface-variant">PDF를 업로드하면 내용을 자동으로 파싱하여 아래 폼에 채워드립니다. 파싱 후 내용을 확인하고 저장하세요.</p>
            <div
              className="border-2 border-dashed border-outline-variant rounded-xl p-10 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f?.type === "application/pdf") setPdfFile(f);
              }}
            >
              <span className="material-symbols-outlined text-4xl text-on-surface-variant opacity-40 block mb-2">upload_file</span>
              {pdfFile ? (
                <p className="text-sm font-semibold text-primary">{pdfFile.name}</p>
              ) : (
                <p className="text-sm text-on-surface-variant">PDF 파일을 여기에 드래그하거나 클릭하여 선택</p>
              )}
              <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} />
            </div>
            {pdfFile && (
              <button
                onClick={handlePdfParse}
                disabled={pdfParsing}
                className="w-full py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50 text-sm"
              >
                {pdfParsing ? "파싱 중..." : "PDF 파싱 후 폼 채우기"}
              </button>
            )}
          </div>
        )}

        {/* 직접 입력 폼 */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {parsed && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">info</span>
              PDF에서 파싱된 내용이 채워졌습니다. 내용을 확인하고 저장하세요.
            </div>
          )}

          {/* 직원 선택 */}
          <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-variant bg-surface-bright">
              <h3 className="font-bold text-sm text-on-surface">직원 정보</h3>
            </div>
            <div className="p-5">
              <label className={labelCls}>직원 선택 *</label>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className={inputCls}>
                <option value="">-- 직원 선택 --</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
          </section>

          {/* 휴가 정보 */}
          <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-variant bg-surface-bright">
              <h3 className="font-bold text-sm text-on-surface">휴가 정보</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>휴가 종류 *</label>
                <div className="flex flex-wrap gap-2">
                  {LEAVE_OPTIONS.map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setLeaveType(val)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        leaveType === val ? "bg-primary text-white border-primary" : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>시작일 *</label>
                  <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>종료일 *</label>
                  <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                </div>
              </div>

              {startDate && endDate && (
                <div className="bg-primary/5 rounded-lg px-4 py-2 text-sm font-semibold text-primary">
                  산정 일수: <span className="text-base font-bold">{days}일</span>
                  <span className="text-xs text-on-surface-variant font-normal ml-2">(주말·공휴일 제외)</span>
                </div>
              )}

              <div>
                <label className={labelCls}>사유 *</label>
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="휴가 사유를 입력해주세요" className={inputCls} />
              </div>
            </div>
          </section>

          {/* 업무 인수인계 */}
          <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-variant bg-surface-bright">
              <h3 className="font-bold text-sm text-on-surface">업무 인수인계</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>프로젝트명</label>
                  <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="진행 중인 프로젝트명" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>진행률 (%)</label>
                  <input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>마감 현황</label>
                <div className="flex gap-2 flex-wrap">
                  {DEADLINE_OPTIONS.map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDeadlineStatus(val)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        deadlineStatus === val ? "bg-secondary text-white border-secondary" : "border-outline-variant text-on-surface hover:bg-surface-container-low"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>인수인계 사항</label>
                <textarea value={handoverNotes} onChange={(e) => setHandoverNotes(e.target.value)} rows={3} placeholder="업무 인수인계 내용을 입력하세요" className={inputCls + " resize-none"} />
              </div>

              <div>
                <label className={labelCls}>비상 연락망</label>
                <input
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(formatPhone(e.target.value))}
                  placeholder="010-0000-0000"
                  maxLength={13}
                  inputMode="numeric"
                  className={inputCls}
                />
              </div>
            </div>
          </section>

          {/* 확인 사항 */}
          <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-outline-variant bg-surface-bright">
              <h3 className="font-bold text-sm text-on-surface">확인 사항</h3>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: "연구노트 최신화", key: checkResearchNote, set: setCheckResearchNote },
                { label: "간트차트 업데이트", key: checkGanttChart, set: setCheckGanttChart },
                { label: "관련 부서 공유", key: checkStakeholder, set: setCheckStakeholder },
              ].map(({ label, key, set }) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer select-none">
                  <input type="checkbox" checked={key} onChange={(e) => set(e.target.checked)} className="w-4 h-4 accent-primary" />
                  <span className="text-sm text-on-surface">{label}</span>
                </label>
              ))}
            </div>
          </section>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-lg">{submitting ? "progress_activity" : "save"}</span>
            {submitting ? "저장 중..." : "승인 완료로 저장"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
