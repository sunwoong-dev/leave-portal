"use client";

import { useState, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { getTenureLabel, getLeaveTypeLabel } from "@/lib/leaveCalc";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, updateDoc, doc } from "firebase/firestore";

async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function SettingsPage() {
  const { state, usedLeave, grantedDays, showNotification, logout } = useStore();
  const user = state.currentUser;
  const [name, setName] = useState(user?.name ?? "");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [notifEmail, setNotifEmail] = useState(true);
  const [notifApproval, setNotifApproval] = useState(true);
  const [notifReminder, setNotifReminder] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (user) setName(user.name);
  }, [user?.name]);

  if (!user) return null;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { showNotification("이름을 입력해주세요.", "error"); return; }
    try {
      await updateDoc(doc(db, "leave_portal_users", user!.id), { name: name.trim() });
      showNotification("프로필이 저장되었습니다.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      showNotification("저장 중 오류가 발생했습니다.", "error");
    }
  }

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    if (!currentPw) { showNotification("현재 비밀번호를 입력해주세요.", "error"); return; }
    if (newPw.length < 6) { showNotification("새 비밀번호는 6자 이상이어야 합니다.", "error"); return; }
    if (newPw !== confirmPw) { showNotification("새 비밀번호가 일치하지 않습니다.", "error"); return; }
    setPwSaving(true);
    try {
      const snap = await getDocs(query(collection(db, "leave_portal_users"), where("username", "==", user!.username)));
      if (snap.empty) { showNotification("사용자 정보를 찾을 수 없습니다.", "error"); return; }
      const stored = snap.docs[0].data().password as string;
      const currentHashed = await hashPassword(currentPw);
      if (stored !== currentHashed) { showNotification("현재 비밀번호가 올바르지 않습니다.", "error"); return; }
      const newHashed = await hashPassword(newPw);
      await updateDoc(snap.docs[0].ref, { password: newHashed });
      showNotification("비밀번호가 변경되었습니다.");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch {
      showNotification("비밀번호 변경 중 오류가 발생했습니다.", "error");
    } finally {
      setPwSaving(false);
    }
  }

  function handleSaveNotif(e: React.FormEvent) {
    e.preventDefault();
    showNotification("알림 설정이 저장되었습니다.");
  }

  const inputCls = "w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition bg-white";
  const disabledCls = "opacity-60 cursor-not-allowed bg-surface-container-low";

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">설정</h2>
          <p className="text-sm text-on-surface-variant mt-1">계정 정보 및 알림 설정을 관리합니다.</p>
        </div>

        {/* Profile Card */}
        <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-bold text-base text-on-surface">프로필 정보</h3>
          </div>
          <form onSubmit={handleSaveProfile} className="p-6 space-y-5">
            <div className="flex items-center gap-5 mb-2">
              <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white text-2xl font-bold">
                {user.initials}
              </div>
              <div>
                <p className="font-bold text-on-surface">{user.name}</p>
                <p className="text-sm text-on-surface-variant">@{user.username}</p>
                {user.joinDate && (
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {getTenureLabel(user.joinDate)} · {getLeaveTypeLabel(user.joinDate)} {user.totalLeave}일
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">이름</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">아이디</label>
                <input type="text" value={user.username} disabled className={`${inputCls} ${disabledCls}`} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all text-sm">
                <span className="material-symbols-outlined text-lg">{saved ? "check" : "save"}</span>
                {saved ? "저장됨" : "저장하기"}
              </button>
            </div>
          </form>
        </section>

        {/* Leave Balance */}
        <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-bold text-base text-on-surface">연차 현황</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "총 연차", value: user.totalLeave + grantedDays, unit: "일", color: "text-primary" },
                { label: "사용 연차", value: usedLeave, unit: "일", color: "text-secondary" },
                { label: "잔여 연차", value: user.leaveBalance, unit: "일", color: user.leaveBalance <= 3 ? "text-error" : "text-on-tertiary-fixed-variant" },
              ].map((stat) => (
                <div key={stat.label} className="text-center p-4 bg-surface-container-low rounded-xl">
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-on-surface-variant mt-1">{stat.label} ({stat.unit})</p>
                </div>
              ))}
            </div>
            {grantedDays > 0 && (
              <p className="text-xs text-green-600 mt-3 font-medium">
                기본 {user.totalLeave}일 + 추가 부여 {grantedDays}일 = 총 {user.totalLeave + grantedDays}일
              </p>
            )}
            <div className="mt-3">
              <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                <span>사용률</span>
                <span>{Math.round((usedLeave / Math.max(1, user.totalLeave + grantedDays)) * 100)}%</span>
              </div>
              <div className="h-2 bg-surface-container rounded-full overflow-hidden">
                <div className="h-full bg-secondary rounded-full" style={{ width: `${(usedLeave / Math.max(1, user.totalLeave + grantedDays)) * 100}%` }} />
              </div>
            </div>
          </div>
        </section>

        {/* Password Change */}
        <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-bold text-base text-on-surface">비밀번호 변경</h3>
          </div>
          <form onSubmit={handleChangePw} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">현재 비밀번호</label>
              <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="현재 비밀번호 입력" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">새 비밀번호</label>
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="새 비밀번호 (4자 이상)" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">새 비밀번호 확인</label>
              <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="새 비밀번호 재입력" className={inputCls} />
              {newPw && confirmPw && newPw !== confirmPw && (
                <p className="text-xs text-error mt-1">비밀번호가 일치하지 않습니다.</p>
              )}
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={pwSaving} className="flex items-center gap-2 px-5 py-2.5 bg-secondary text-white font-bold rounded-xl hover:opacity-90 text-sm disabled:opacity-50">
                <span className="material-symbols-outlined text-lg">{pwSaving ? "progress_activity" : "lock_reset"}</span>
                {pwSaving ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </form>
        </section>

        {/* Notification Settings */}
        <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-bold text-base text-on-surface">알림 설정</h3>
          </div>
          <form onSubmit={handleSaveNotif} className="p-6 space-y-4">
            {[
              { label: "이메일 알림", desc: "승인/반려 결과를 이메일로 받습니다.", value: notifEmail, set: setNotifEmail },
              { label: "승인 상태 알림", desc: "휴가 신청 상태 변경 시 알림을 받습니다.", value: notifApproval, set: setNotifApproval },
              { label: "연차 소진 알림", desc: "잔여 연차가 5일 미만일 때 알림을 받습니다.", value: notifReminder, set: setNotifReminder },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-3 border-b border-outline-variant last:border-0">
                <div>
                  <p className="text-sm font-semibold text-on-surface">{item.label}</p>
                  <p className="text-xs text-on-surface-variant">{item.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => item.set(!item.value)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${item.value ? "bg-primary" : "bg-surface-container-high"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${item.value ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <button type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-bold rounded-xl hover:opacity-90 text-sm">
                <span className="material-symbols-outlined text-lg">notifications</span>
                알림 설정 저장
              </button>
            </div>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}
