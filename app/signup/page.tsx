"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { calcTotalLeave, getLeaveTypeLabel } from "@/lib/leaveCalc";
import Link from "next/link";

export default function SignupPage() {
  const { signup, state } = useStore();
  const router = useRouter();

  const [form, setForm] = useState({ name: "", username: "", joinDate: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state.currentUser) router.replace("/dashboard");
  }, [state.currentUser, router]);

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("이름을 입력해주세요."); return; }
    if (!form.username.trim()) { setError("아이디를 입력해주세요."); return; }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username)) {
      setError("아이디는 영문, 숫자, 밑줄(_)만 사용하여 3~20자로 입력해주세요.");
      return;
    }
    if (!form.joinDate) { setError("입사일을 입력해주세요."); return; }
    if (form.password.length < 6) { setError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (form.password !== form.confirmPassword) { setError("비밀번호가 일치하지 않습니다."); return; }

    setLoading(true);
    try {
      const result = await signup(form.username.trim(), form.password, {
        name: form.name.trim(),
        username: form.username.trim(),
        joinDate: form.joinDate,
      });
      if (result.ok) {
        router.push("/dashboard");
      } else {
        setError(result.error ?? "회원가입에 실패했습니다.");
      }
    } catch {
      setError("회원가입 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const preview = form.joinDate
    ? { days: calcTotalLeave(form.joinDate), label: getLeaveTypeLabel(form.joinDate) }
    : null;

  const inputCls = "w-full px-3 py-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition bg-white";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-container px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10">
          <div className="text-center mb-7">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-3">
              <span className="material-symbols-outlined text-white text-2xl">person_add</span>
            </div>
            <h1 className="text-xl font-bold text-primary">회원가입</h1>
            <p className="text-xs text-on-surface-variant mt-1">계정 정보를 입력해주세요</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">이름 *</label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="홍길동" className={inputCls} />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">아이디 *</label>
              <input type="text" value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="영문, 숫자, 밑줄 3~20자" className={inputCls} autoComplete="username" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">입사일 *</label>
              <input type="date" value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} className={inputCls} max={new Date().toISOString().split("T")[0]} />
              {preview && (
                <p className="text-xs text-primary mt-1.5 font-medium">
                  → {preview.label} {preview.days}일 부여
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">비밀번호 * (6자 이상)</label>
              <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••" className={inputCls} autoComplete="new-password" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">비밀번호 확인 *</label>
              <input type="password" value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} placeholder="••••••" className={inputCls} autoComplete="new-password" />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-error-container rounded-lg text-sm text-error">
                <span className="material-symbols-outlined text-lg">error</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 mt-1"
            >
              {loading
                ? <><span className="material-symbols-outlined animate-spin text-xl">progress_activity</span> 가입 중...</>
                : <><span className="material-symbols-outlined text-xl">how_to_reg</span> 회원가입</>
              }
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-outline-variant text-center">
            <p className="text-sm text-on-surface-variant">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="text-primary font-bold hover:underline">로그인</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
