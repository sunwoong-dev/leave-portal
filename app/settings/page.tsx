"use client";

import { useEffect, useMemo, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useStore } from "@/lib/store";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where, updateDoc, doc, deleteField, type DocumentReference } from "firebase/firestore";
import { PASSWORD_MIN_LENGTH, ALLOWED_SPECIAL_CHARS, checkPasswordPolicy } from "@/lib/passwordPolicy";

async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const MAX_SIGNATURE_BYTES = 400 * 1024; // base64 데이터 URL 기준 (Firestore 문서 크기 고려)

export default function SettingsPage() {
  const { state, usedLeave, grantedDays, showNotification, updateSignature } = useStore();
  const user = state.currentUser;
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [sigSaving, setSigSaving] = useState(false);

  const [storedHash, setStoredHash] = useState<string | null>(null);
  const [userDocRef, setUserDocRef] = useState<DocumentReference | null>(null);
  const [currentPwValid, setCurrentPwValid] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDocs(query(collection(db, "leave_portal_users"), where("username", "==", user.username))).then((snap) => {
      if (snap.empty) return;
      setStoredHash(snap.docs[0].data().password as string);
      setUserDocRef(snap.docs[0].ref);
    });
  }, [user?.username]);

  useEffect(() => {
    let cancelled = false;
    if (!currentPw || !storedHash) { setCurrentPwValid(false); return; }
    hashPassword(currentPw).then((h) => {
      if (!cancelled) setCurrentPwValid(h === storedHash);
    });
    return () => { cancelled = true; };
  }, [currentPw, storedHash]);

  const newPwPolicy = useMemo(() => checkPasswordPolicy(newPw), [newPw]);
  const newPwValid = newPw.length > 0 && newPwPolicy.valid;
  const confirmPwValid = confirmPw.length > 0 && confirmPw === newPw;
  const canSubmitPwChange = currentPwValid && newPwValid && confirmPwValid && !pwSaving;

  if (!user) return null;

  async function handleChangePw(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitPwChange || !userDocRef) return;
    setPwSaving(true);
    try {
      const newHashed = await hashPassword(newPw);
      await updateDoc(userDocRef, { password: newHashed, mustChangePassword: deleteField() });
      showNotification("비밀번호가 변경되었습니다.");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch {
      showNotification("비밀번호 변경 중 오류가 발생했습니다.", "error");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleSignatureUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showNotification("이미지 파일만 업로드할 수 있습니다.", "error");
      return;
    }
    setSigSaving(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (dataUrl.length > MAX_SIGNATURE_BYTES) {
        showNotification("서명 이미지 용량이 너무 큽니다. 더 작은 이미지를 사용해주세요.", "error");
        return;
      }
      await updateSignature(dataUrl);
      showNotification("서명이 등록되었습니다.");
    } catch {
      showNotification("서명 등록 중 오류가 발생했습니다.", "error");
    } finally {
      setSigSaving(false);
    }
  }

  async function handleSignatureRemove() {
    if (!confirm("등록된 서명을 삭제하시겠습니까?")) return;
    setSigSaving(true);
    try {
      await updateSignature(null);
      showNotification("서명이 삭제되었습니다.");
    } catch {
      showNotification("서명 삭제 중 오류가 발생했습니다.", "error");
    } finally {
      setSigSaving(false);
    }
  }

  const inputCls = "w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition bg-white";

  return (
    <AppLayout>
      <div className="p-5 md:p-10 max-w-3xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-on-surface">설정</h2>
          <p className="text-sm text-on-surface-variant mt-1">비밀번호, 연차 현황, 서명 이미지를 관리합니다.</p>
        </div>

        {/* Signature */}
        <section className="bg-white rounded-xl border border-outline-variant shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant bg-surface-bright">
            <h3 className="font-bold text-base text-on-surface">서명 이미지</h3>
            <p className="text-xs text-on-surface-variant mt-0.5">등록해두면 휴가신청서 PDF 출력 시 서명란에 자동으로 삽입됩니다. 배경 색상 없이 서명 누끼로 업로드하시면 됩니다.</p>
          </div>
          <div className="p-6 flex items-center gap-6">
            <div className="w-40 h-20 border border-dashed border-outline-variant rounded-lg flex items-center justify-center bg-surface-container-low overflow-hidden shrink-0">
              {user.signatureImage ? (
                <img src={user.signatureImage} alt="서명 미리보기" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-xs text-on-surface-variant">서명 없음</span>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className={`inline-flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold cursor-pointer hover:bg-surface-container-low transition ${sigSaving ? "opacity-50 pointer-events-none" : ""}`}>
                <span className="material-symbols-outlined text-lg">upload</span>
                {user.signatureImage ? "서명 다시 업로드" : "서명 업로드"}
                <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} disabled={sigSaving} />
              </label>
              {user.signatureImage && (
                <button
                  type="button"
                  onClick={handleSignatureRemove}
                  disabled={sigSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-error hover:underline disabled:opacity-50"
                >
                  서명 삭제
                </button>
              )}
            </div>
          </div>
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
              <div className="relative">
                <input
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="현재 비밀번호 입력"
                  className={`${inputCls} pr-9`}
                />
                {currentPw && (
                  <span className={`material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg ${currentPwValid ? "text-green-600" : "text-error"}`}>
                    {currentPwValid ? "check_circle" : "cancel"}
                  </span>
                )}
              </div>
              {currentPw && !currentPwValid && (
                <p className="text-xs text-error mt-1">현재 비밀번호가 올바르지 않습니다.</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">새 비밀번호</label>
              <div className="relative">
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder={`${PASSWORD_MIN_LENGTH}자 이상, 영문+숫자+특수문자 포함`}
                  className={`${inputCls} pr-9`}
                />
                {newPw && (
                  <span className={`material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg ${newPwValid ? "text-green-600" : "text-error"}`}>
                    {newPwValid ? "check_circle" : "cancel"}
                  </span>
                )}
              </div>
              {newPw && (
                <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <li className={newPwPolicy.longEnough ? "text-green-600" : "text-on-surface-variant"}>· {PASSWORD_MIN_LENGTH}자 이상</li>
                  <li className={newPwPolicy.hasLetter ? "text-green-600" : "text-on-surface-variant"}>· 영문 포함</li>
                  <li className={newPwPolicy.hasDigit ? "text-green-600" : "text-on-surface-variant"}>· 숫자 포함</li>
                  <li className={newPwPolicy.hasSpecial ? "text-green-600" : "text-on-surface-variant"}>· 특수문자 포함</li>
                  {!newPwPolicy.onlyAllowedChars && (
                    <li className="col-span-2 text-error">· 사용 가능한 문자만 입력해주세요 (영문/숫자/{ALLOWED_SPECIAL_CHARS})</li>
                  )}
                </ul>
              )}
            </div>
            <div>
              <label className="block text-xs font-bold text-on-surface-variant mb-1.5">새 비밀번호 확인</label>
              <div className="relative">
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="새 비밀번호 재입력"
                  className={`${inputCls} pr-9`}
                />
                {confirmPw && (
                  <span className={`material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg ${confirmPwValid ? "text-green-600" : "text-error"}`}>
                    {confirmPwValid ? "check_circle" : "cancel"}
                  </span>
                )}
              </div>
              {confirmPw && !confirmPwValid && (
                <p className="text-xs text-error mt-1">비밀번호가 일치하지 않습니다.</p>
              )}
            </div>
            <div className="flex justify-end">
              <button type="submit" disabled={!canSubmitPwChange} className="flex items-center gap-2 px-5 py-2.5 bg-secondary text-white font-bold rounded-xl hover:opacity-90 text-sm disabled:opacity-50 disabled:pointer-events-none">
                <span className="material-symbols-outlined text-lg">{pwSaving ? "progress_activity" : "lock_reset"}</span>
                {pwSaving ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </AppLayout>
  );
}
