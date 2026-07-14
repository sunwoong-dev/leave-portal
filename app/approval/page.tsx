"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { LEAVE_TYPE_LABELS } from "@/lib/types";
import { db } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { calcTotalLeave } from "@/lib/leaveCalc";

interface SimpleUser { id: string; name: string; joinDate: string; totalLeave: number; isManager: boolean; }

const STATUS_STYLES = {
  pending: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};
const STATUS_LABELS = { pending: "대기 중", approved: "승인됨", rejected: "반려됨" };

export default function ApprovalPage() {
  const router = useRouter();
  const { state, updateLeaveStatus, addGrant, showNotification } = useStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commentOpen, setCommentOpen] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({});

  // 연차 부여 상태
  const [employees, setEmployees] = useState<SimpleUser[]>([]);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantDays, setGrantDays] = useState(1);
  const [grantReason, setGrantReason] = useState("");
  const [grantLoading, setGrantLoading] = useState(false);

  const user = state.currentUser;
  const isManager = user?.isManager ?? false;

  useEffect(() => {
    if (user && !isManager) router.replace("/dashboard");
  }, [user, isManager, router]);

  // 직원 목록 로드 (관리자용)
  useEffect(() => {
    if (!isManager) return;
    getDocs(collection(db, "leave_portal_users")).then((snap) => {
      const list: SimpleUser[] = snap.docs
        .map((d) => {
          const data = d.data();
          const joinDate = (data.joinDate as string) ?? "";
          const storedTotal = data.totalLeave as number | undefined;
          return {
            id: d.id,
            name: data.name as string,
            joinDate,
            totalLeave: joinDate ? calcTotalLeave(joinDate) : (storedTotal ?? 15),
            isManager: (data.isManager as boolean) ?? false,
          };
        })
        .filter((u) => !u.isManager);
      setEmployees(list);
      if (list.length > 0) setGrantUserId(list[0].id);
    });
  }, [isManager]);

  const requests = useMemo(() => {
    if (!user) return [];
    return state.leaveRequests
      .filter((r) => (isManager ? r.userId !== user.id : r.userId === user.id))
      .filter((r) => r.status === "pending")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [state.leaveRequests, isManager, user?.id, user]);

  if (!user) return null;

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    if (selected.size === requests.length) setSelected(new Set());
    else setSelected(new Set(requests.map((r) => r.id)));
  }

  async function handleApprove(id: string) {
    await updateLeaveStatus(id, "approved");
    showNotification("휴가 신청이 승인되었습니다.");
    setCommentOpen(null);
  }
  async function handleReject(id: string) {
    const note = rejectNote[id] || "";
    if (!note.trim()) { showNotification("반려 사유를 입력해주세요.", "error"); return; }
    await updateLeaveStatus(id, "rejected", note);
    showNotification("휴가 신청이 반려되었습니다.");
    setCommentOpen(null);
    setRejectNote((p) => ({ ...p, [id]: "" }));
  }
  async function handleBulkApprove() {
    if (!selected.size) { showNotification("선택된 항목이 없습니다.", "error"); return; }
    await Promise.all([...selected].map((id) => updateLeaveStatus(id, "approved")));
    showNotification(`${selected.size}건의 신청이 일괄 승인되었습니다.`);
    setSelected(new Set());
  }
  async function handleBulkReject() {
    if (!selected.size) { showNotification("선택된 항목이 없습니다.", "error"); return; }
    await Promise.all([...selected].map((id) => updateLeaveStatus(id, "rejected", "일괄 반려 처리")));
    showNotification(`${selected.size}건이 일괄 반려 처리되었습니다.`);
    setSelected(new Set());
  }

  async function handleGrant() {
    if (!grantUserId) { showNotification("직원을 선택해주세요.", "error"); return; }
    if (grantDays === 0) { showNotification("0일은 입력할 수 없습니다.", "error"); return; }
    if (!grantReason.trim()) { showNotification("사유를 입력해주세요.", "error"); return; }
    const emp = employees.find((e) => e.id === grantUserId);
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

  return (
    <AppLayout>
      <div className="p-5 md:p-8 max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-on-surface">휴가 승인 관리</h2>
            <p className="text-sm text-on-surface-variant mt-1">
              검토 대기 중인 휴가 신청 {requests.length}건입니다.
            </p>
          </div>
          {isManager && requests.length > 0 && (
            <div className="flex gap-3">
              <button onClick={handleBulkReject} className="flex items-center gap-2 px-4 py-2 border border-primary text-primary rounded-lg hover:bg-primary-fixed text-sm font-bold transition-colors">
                <span className="material-symbols-outlined text-lg">close</span> 선택 반려
              </button>
              <button onClick={handleBulkApprove} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:shadow-lg text-sm font-bold transition-all">
                <span className="material-symbols-outlined text-lg">done_all</span> 선택 승인
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-12 gap-5">
          {/* Table */}
          <div className="col-span-12 lg:col-span-8">
            <div className="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left min-w-[560px]">
                  <thead className="bg-surface-container-low text-xs font-bold text-on-surface-variant uppercase">
                    <tr>
                      {isManager && (
                        <th className="p-4 border-b border-outline-variant w-10">
                          <input type="checkbox" checked={selected.size === requests.length && requests.length > 0} onChange={toggleSelectAll} className="rounded" />
                        </th>
                      )}
                      <th className="p-4 border-b border-outline-variant">직원 정보</th>
                      <th className="p-4 border-b border-outline-variant">휴가 종류</th>
                      <th className="p-4 border-b border-outline-variant">기간</th>
                      <th className="p-4 border-b border-outline-variant text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant border-b border-outline-variant">
                    {requests.length === 0 ? (
                      <tr>
                        <td colSpan={isManager ? 5 : 4} className="py-16 text-center text-on-surface-variant text-sm">
                          <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">task_alt</span>
                          검토 대기 중인 신청이 없습니다.
                        </td>
                      </tr>
                    ) : requests.map((r) => (
                      <>
                        <tr key={r.id} className="hover:bg-surface-container transition-colors">
                          {isManager && (
                            <td className="p-4">
                              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded" />
                            </td>
                          )}
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-primary-fixed flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                {r.initials}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-on-surface">{r.userName}</p>
                                <p className="text-xs text-on-surface-variant">{r.department} · {r.role}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-sm text-on-surface">{LEAVE_TYPE_LABELS[r.type]}</td>
                          <td className="p-4">
                            <p className="text-sm text-on-surface">{r.startDate} ~ {r.endDate}</p>
                            <p className="text-xs text-on-surface-variant">({r.days}일)</p>
                          </td>
                          <td className="p-4 text-right">
                            {isManager && (
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => setCommentOpen(commentOpen === r.id ? null : r.id)}
                                  className="p-1.5 text-on-surface-variant hover:text-primary transition-colors"
                                  title="상세보기/반려"
                                >
                                  <span className="material-symbols-outlined text-lg">chat_bubble_outline</span>
                                </button>
                                <button onClick={() => handleApprove(r.id)} className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:opacity-90 transition">승인</button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {commentOpen === r.id && (
                          <tr key={`comment-${r.id}`} className="bg-surface-container-low">
                            <td colSpan={isManager ? 5 : 4} className="px-6 py-4">
                              <div className="flex items-start gap-4">
                                <div className="flex-1 space-y-2">
                                  <p className="text-xs text-on-surface-variant bg-surface-container p-3 rounded-lg">
                                    <span className="font-bold">신청 사유:</span> {r.reason}
                                  </p>
                                  <textarea
                                    value={rejectNote[r.id] ?? ""}
                                    onChange={(e) => setRejectNote((p) => ({ ...p, [r.id]: e.target.value }))}
                                    placeholder="반려 사유를 입력해주세요 (반려 시 필수)"
                                    rows={2}
                                    className="w-full p-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                                  />
                                </div>
                                <div className="flex flex-col gap-2 pt-1">
                                  <button onClick={() => handleApprove(r.id)} className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:opacity-90">승인하기</button>
                                  <button onClick={() => handleReject(r.id)} className="px-4 py-2 border border-error text-error text-xs font-bold rounded-lg hover:bg-error-container/20">반려하기</button>
                                  <button onClick={() => setCommentOpen(null)} className="px-4 py-2 text-on-surface-variant text-xs hover:underline">취소</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right Panel — 연차 조정 */}
          {isManager && (
            <div className="col-span-12 lg:col-span-4">
              <div className="bg-white border border-outline-variant rounded-xl p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-primary text-xl">card_giftcard</span>
                  <h4 className="text-base font-bold text-on-surface">연차 조정</h4>
                </div>
                <p className="text-xs text-on-surface-variant mb-4">직원의 연차를 부여하거나 차감합니다.</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">직원 선택</label>
                    <select
                      value={grantUserId}
                      onChange={(e) => setGrantUserId(e.target.value)}
                      className="w-full border border-outline-variant rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name} (잔여 {
                          e.totalLeave
                          + state.leaveGrants.filter((g) => g.userId === e.id).reduce((s, g) => s + g.days, 0)
                          - state.leaveRequests.filter((r) => r.userId === e.id && r.status === "approved").reduce((s, r) => s + r.days, 0)
                        }일)</option>
                      ))}
                      {employees.length === 0 && <option disabled>직원 없음</option>}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">
                      일수
                      <span className={`ml-2 font-bold ${grantDays > 0 ? "text-primary" : "text-error"}`}>
                        {grantDays > 0 ? `+${grantDays}일 부여` : `${grantDays}일 차감`}
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setGrantDays((d) => d > -30 ? d - 1 : d)}
                        className="w-9 h-9 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold text-lg flex items-center justify-center flex-shrink-0"
                      >−</button>
                      <input
                        type="number"
                        value={grantDays}
                        onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v !== 0 && v >= -30 && v <= 30) setGrantDays(v); }}
                        className="flex-1 border border-outline-variant rounded-xl text-sm px-3 py-2.5 text-center focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        onClick={() => setGrantDays((d) => d < 30 ? d + 1 : d)}
                        className="w-9 h-9 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold text-lg flex items-center justify-center flex-shrink-0"
                      >+</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-on-surface-variant mb-1">사유</label>
                    <textarea
                      value={grantReason}
                      onChange={(e) => setGrantReason(e.target.value)}
                      placeholder={grantDays > 0 ? "예: 6월 주말 출근 보상" : "예: 연차 선사용 처리"}
                      rows={2}
                      className="w-full border border-outline-variant rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                    />
                  </div>
                  <button
                    onClick={handleGrant}
                    disabled={grantLoading}
                    className={`w-full py-2.5 text-white text-sm font-bold rounded-xl hover:opacity-90 transition disabled:opacity-50 ${grantDays < 0 ? "bg-error" : "bg-primary"}`}
                  >
                    {grantLoading ? "처리 중..." : grantDays > 0 ? "연차 부여하기" : "연차 차감하기"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
