"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/lib/store";
import { safeNextPath } from "@/lib/safeNextPath";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, state } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next")) ?? "/dashboard";
  const justReset = searchParams.get("reset") === "1";

  useEffect(() => {
    if (state.currentUser) router.replace(nextPath);
  }, [state.currentUser, router, nextPath]);

  useEffect(() => {
    const saved = localStorage.getItem("leave_portal_autofill");
    if (saved) {
      const { u, p } = JSON.parse(saved);
      setUsername(u ?? "");
      setPassword(p ?? "");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim()) { setError("아이디를 입력해주세요."); return; }
    if (!password.trim()) { setError("비밀번호를 입력해주세요."); return; }
    setLoading(true);
    try {
      await login(username.trim(), password);
      localStorage.setItem("leave_portal_autofill", JSON.stringify({ u: username.trim(), p: password }));
      router.push(nextPath);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "not_found" || code === "wrong_password") {
        setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      } else if (code === "resigned") {
        setError("퇴사 처리된 계정입니다. 복직 처리가 필요하면 관리자에게 문의해주세요.");
      } else {
        setError("로그인 중 오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary to-primary-container px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8 md:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary mb-4">
              <span className="material-symbols-outlined text-white text-3xl">event_available</span>
            </div>
            <h1 className="text-2xl font-bold text-primary">Workforce Logistics</h1>
            <p className="text-sm text-on-surface-variant mt-1">사내 연차 관리 시스템</p>
          </div>

          {justReset && !error && (
            <div className="flex items-center gap-2 p-3 mb-5 bg-green-50 rounded-lg text-sm text-green-700">
              <span className="material-symbols-outlined text-lg">check_circle</span>
              비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">아이디</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl">person</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(""); }}
                  placeholder="아이디를 입력하세요"
                  className="w-full pl-10 pr-4 py-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5 uppercase tracking-wider">비밀번호</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl">lock</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="비밀번호를 입력하세요"
                  className="w-full pl-10 pr-4 py-3 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  autoComplete="current-password"
                />
              </div>
              <div className="text-right mt-1.5">
                <Link href="/forgot-password" className="text-xs text-on-surface-variant hover:text-primary hover:underline">비밀번호를 잊으셨나요?</Link>
              </div>
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
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <><span className="material-symbols-outlined animate-spin text-xl">progress_activity</span> 로그인 중...</>
              ) : (
                <><span className="material-symbols-outlined text-xl">login</span> 로그인</>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-outline-variant text-center">
            <p className="text-sm text-on-surface-variant">
              계정이 없으신가요?{" "}
              <Link href="/signup" className="text-primary font-bold hover:underline">회원가입</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
