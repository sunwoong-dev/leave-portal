"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useState } from "react";

const baseNavItems = [
  { href: "/dashboard", icon: "dashboard", label: "Dashboard" },
  { href: "/settings", icon: "settings", label: "Settings" },
];
const managerNavItems = [
  { href: "/employees", icon: "group", label: "Employees" },
  { href: "/my-leaves", icon: "bar_chart", label: "Team Overview" },
  // 과거 데이터 입력 기능: 로컬 개발 환경에서만 노출 (프로덕션 배포에는 포함하지 않음)
  ...(process.env.NODE_ENV !== "production"
    ? [{ href: "/import", icon: "upload_file", label: "Import History" }]
    : []),
];

export default function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, logout } = useStore();
  const user = state.currentUser;

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="px-6 py-8">
        <h1 className="text-lg font-bold text-primary leading-tight">Workforce Logistics</h1>
        <p className="text-xs text-on-surface-variant mt-1 font-semibold opacity-70">Admin Portal</p>
      </div>

      <nav className="px-4 space-y-1 flex-1">
        {[...baseNavItems, ...(user?.isManager ? managerNavItems : [])].map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-secondary-container text-on-secondary-container font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-6 mt-auto">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container border border-outline-variant">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.initials ?? "??"}
          </div>
          <div className="overflow-hidden flex-1">
            <p className="text-sm font-bold text-on-surface truncate">{user?.name ?? ""}</p>
            <p className="text-xs text-on-surface-variant truncate">@{user?.username}</p>
          </div>
          <button onClick={handleLogout} className="text-on-surface-variant hover:text-error transition-colors" title="로그아웃">
            <span className="material-symbols-outlined text-xl">logout</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full w-64 border-r border-outline-variant bg-surface z-40">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={onClose} />
          <aside className="relative flex flex-col w-64 h-full border-r border-outline-variant bg-surface z-50">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
