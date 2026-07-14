"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useRouter } from "next/navigation";

export default function Header({
  onMenuClick,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "검색...",
}: {
  onMenuClick?: () => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
}) {
  const { state, logout, deleteAccount, unreadCount, markNotificationsRead } = useStore();
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const router = useRouter();

  const user = state.currentUser;
  const notifications = state.appNotifications.slice(0, 20);

  function openDeleteModal() {
    setShowProfile(false);
    setDeletePassword("");
    setDeleteError("");
    setShowDeleteModal(true);
  }

  async function handleDeleteAccount() {
    if (!deletePassword) { setDeleteError("비밀번호를 입력해주세요."); return; }
    setDeleteLoading(true);
    setDeleteError("");
    const result = await deleteAccount(deletePassword);
    setDeleteLoading(false);
    if (!result.ok) {
      setDeleteError(result.error ?? "오류가 발생했습니다.");
      return;
    }
    router.replace("/login");
  }

  function handleLogout() {
    logout();
    router.push("/login");
  }

  function handleBellClick() {
    setShowNotif((v) => !v);
    if (!showNotif && unreadCount > 0) {
      markNotificationsRead();
    }
  }

  function notifIcon(type: string) {
    if (type === "new_request") return "event_note";
    if (type === "approved") return "check_circle";
    return "cancel";
  }

  function notifColor(type: string) {
    if (type === "new_request") return "text-primary";
    if (type === "approved") return "text-green-600";
    return "text-error";
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffM = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffM < 1) return "방금";
    if (diffM < 60) return `${diffM}분 전`;
    if (diffM < 1440) return `${Math.floor(diffM / 60)}시간 전`;
    return `${Math.floor(diffM / 1440)}일 전`;
  }

  return (
    <>
      <header className="fixed left-0 md:left-64 right-0 top-0 h-16 bg-surface-bright border-b border-outline-variant flex items-center justify-between px-4 md:px-10 z-30">
        <div className="flex items-center gap-4">
          <button onClick={onMenuClick} className="md:hidden p-2 text-on-surface-variant hover:text-primary">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h2 className="text-xl font-extrabold text-primary hidden md:block">Leave Portal</h2>
          {onSearchChange !== undefined && (
            <div className="relative ml-0 md:ml-4">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">search</span>
              <input
                type="text"
                value={searchQuery ?? ""}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-48 md:w-72 bg-surface-container border border-outline-variant rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* 알림 벨 */}
          <div className="relative">
            <button
              onClick={handleBellClick}
              className="p-2 text-on-surface-variant hover:text-primary transition-colors relative"
            >
              <span className="material-symbols-outlined">notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {showNotif && (
              <div className="absolute right-0 top-12 w-80 bg-white border border-outline-variant rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
                  <p className="font-bold text-sm text-on-surface">알림</p>
                  {notifications.length > 0 && (
                    <span className="text-xs text-on-surface-variant">{notifications.length}개</span>
                  )}
                </div>

                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <span className="material-symbols-outlined text-3xl text-on-surface-variant opacity-30 block mb-2">notifications_off</span>
                    <p className="text-sm text-on-surface-variant">새 알림이 없습니다</p>
                  </div>
                ) : (
                  <ul className="max-h-80 overflow-y-auto divide-y divide-outline-variant">
                    {notifications.map((n) => (
                      <li
                        key={n.id}
                        className={`px-4 py-3 hover:bg-surface-container-low cursor-pointer transition-colors ${!n.read ? "bg-primary/5" : ""}`}
                        onClick={() => { router.push("/dashboard"); setShowNotif(false); }}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`material-symbols-outlined text-xl mt-0.5 flex-shrink-0 ${notifColor(n.type)}`}>
                            {notifIcon(n.type)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold text-on-surface ${!n.read ? "text-primary" : ""}`}>{n.title}</p>
                            <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{n.body}</p>
                            <p className="text-xs text-on-surface-variant opacity-60 mt-1">{fmtTime(n.createdAt)}</p>
                          </div>
                          {!n.read && (
                            <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 프로필 드롭다운 */}
          <div className="relative">
            <button
              onClick={() => setShowProfile(!showProfile)}
              className="p-2 text-on-surface-variant hover:text-primary transition-colors"
            >
              <span className="material-symbols-outlined">account_circle</span>
            </button>
            {showProfile && (
              <div className="absolute right-0 top-12 w-56 bg-white border border-outline-variant rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-outline-variant">
                  <p className="font-bold text-sm text-on-surface">{user?.name}</p>
                  <p className="text-xs text-on-surface-variant">@{user?.username}</p>
                </div>
                <button
                  className="w-full text-left px-4 py-3 text-sm hover:bg-surface-container-low flex items-center gap-2 text-on-surface-variant"
                  onClick={handleLogout}
                >
                  <span className="material-symbols-outlined text-lg">logout</span> 로그아웃
                </button>
                <button
                  className="w-full text-left px-4 py-3 text-sm hover:bg-error-container/30 flex items-center gap-2 text-error border-t border-outline-variant"
                  onClick={openDeleteModal}
                >
                  <span className="material-symbols-outlined text-lg">person_remove</span> 회원탈퇴
                </button>
              </div>
            )}
          </div>
        </div>

        {(showNotif || showProfile) && (
          <div className="fixed inset-0 z-40" onClick={() => { setShowNotif(false); setShowProfile(false); }} />
        )}
      </header>

      {/* 회원탈퇴 확인 모달 */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="px-6 py-5 border-b border-outline-variant">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-error text-xl">warning</span>
                </div>
                <div>
                  <h3 className="font-bold text-base text-on-surface">회원탈퇴</h3>
                  <p className="text-xs text-on-surface-variant mt-0.5">탈퇴 후에는 복구가 불가합니다.</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-on-surface-variant">
                탈퇴를 진행하려면 현재 비밀번호를 입력해주세요.
              </p>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant mb-1.5">비밀번호</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleDeleteAccount()}
                  placeholder="현재 비밀번호 입력"
                  className="w-full px-3 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition"
                  autoFocus
                />
                {deleteError && <p className="text-xs text-error mt-1.5 font-medium">{deleteError}</p>}
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface-variant hover:bg-surface-container-low transition"
              >
                취소
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="flex-1 py-2.5 bg-error text-white rounded-xl text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {deleteLoading ? "처리 중..." : "탈퇴하기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
