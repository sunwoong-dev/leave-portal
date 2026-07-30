"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN_LENGTH, ALLOWED_SPECIAL_CHARS, checkPasswordPolicy } from "@/lib/passwordPolicy";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", username: "", joinDate: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const pwPolicy = useMemo(() => checkPasswordPolicy(form.newPassword), [form.newPassword]);
  const pwValid = form.newPassword.length > 0 && pwPolicy.valid;
  const confirmPwValid = form.confirmPassword.length > 0 && form.confirmPassword === form.newPassword;

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("이름을 입력해주세요."); return; }
    if (!form.username.trim()) { setError("아이디를 입력해주세요."); return; }
    if (!form.joinDate) { setError("입사일을 입력해주세요."); return; }
    if (!pwValid) { setError(`새 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상, 영문+숫자+특수문자(${ALLOWED_SPECIAL_CHARS})를 포함해야 합니다.`); return; }
    if (!confirmPwValid) { setError("비밀번호가 일치하지 않습니다."); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          username: form.username.trim(),
          joinDate: form.joinDate,
          newPassword: form.newPassword,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push("/login?reset=1");
      } else if (data.code === "resigned") {
        setError("퇴사 처리된 계정입니다. 복직 처리가 필요하면 관리자에게 문의해주세요.");
      } else if (data.code === "not_found") {
        setError("입력하신 정보와 일치하는 계정을 찾을 수 없습니다. 이름, 아이디, 입사일을 다시 확인해주세요.");
      } else {
        setError("비밀번호 재설정 중 오류가 발생했습니다.");
      }
    } catch {
      setError("비밀번호 재설정 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls = "w-full px-3 py-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition bg-white";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-container px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10">
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-3">
              <span className="material-symbols-outlined text-white text-2xl">lock_reset</span>
            </div>
            <h1 className="text-xl font-bold text-primary">비밀번호 찾기</h1>
            <p className="text-xs text-on-surface-variant mt-1">이름, 아이디, 입사일이 일치하면 새 비밀번호를 설정할 수 있습니다</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">이름 *</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="홍길동" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">아이디 *</label>
              <input type="text" value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="가입 시 사용한 아이디" className={inputCls} autoComplete="username" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">입사일 *</label>
              <input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} className={inputCls} max={new Date().toISOString().split("T")[0]} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">새 비밀번호 *</label>
              <div className="relative">
                <input
                  type="password"
                  value={form.newPassword}
                  onChange={(e) => set("newPassword", e.target.value)}
                  placeholder={`${PASSWORD_MIN_LENGTH}자 이상, 영문+숫자+특수문자 포함`}
                  className={`${inputCls} pr-9`}
                  autoComplete="new-password"
                />
                {form.newPassword && (
                  <span className={`material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg ${pwValid ? "text-green-600" : "text-error"}`}>
                    {pwValid ? "check_circle" : "cancel"}
                  </span>
                )}
              </div>
              {form.newPassword && (
                <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <li className={pwPolicy.longEnough ? "text-green-600" : "text-on-surface-variant"}>· {PASSWORD_MIN_LENGTH}자 이상</li>
                  <li className={pwPolicy.hasLetter ? "text-green-600" : "text-on-surface-variant"}>· 영문 포함</li>
                  <li className={pwPolicy.hasDigit ? "text-green-600" : "text-on-surface-variant"}>· 숫자 포함</li>
                  <li className={pwPolicy.hasSpecial ? "text-green-600" : "text-on-surface-variant"}>· 특수문자 포함</li>
                  {!pwPolicy.onlyAllowedChars && (
                    <li className="col-span-2 text-error">· 사용 가능한 문자만 입력해주세요 (영문/숫자/{ALLOWED_SPECIAL_CHARS})</li>
                  )}
                </ul>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">새 비밀번호 확인 *</label>
              <div className="relative">
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set("confirmPassword", e.target.value)}
                  placeholder="새 비밀번호 재입력"
                  className={`${inputCls} pr-9`}
                  autoComplete="new-password"
                />
                {form.confirmPassword && (
                  <span className={`material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-lg ${confirmPwValid ? "text-green-600" : "text-error"}`}>
                    {confirmPwValid ? "check_circle" : "cancel"}
                  </span>
                )}
              </div>
              {form.confirmPassword && !confirmPwValid && (
                <p className="text-xs text-error mt-1">비밀번호가 일치하지 않습니다.</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-error-container rounded-lg text-sm text-error">
                <span className="material-symbols-outlined text-lg">error</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !pwValid || !confirmPwValid}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 mt-1"
            >
              {loading
                ? <><span className="material-symbols-outlined animate-spin text-xl">progress_activity</span> 변경 중...</>
                : <><span className="material-symbols-outlined text-xl">lock_reset</span> 비밀번호 재설정</>
              }
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-outline-variant text-center">
            <p className="text-sm text-on-surface-variant">
              <Link href="/login" className="text-primary font-bold hover:underline">로그인으로 돌아가기</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
