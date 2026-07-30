"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import Sidebar from "./Sidebar";
import Header from "./Header";

export default function AppLayout({
  children,
  searchQuery,
  onSearchChange,
  searchPlaceholder,
}: {
  children: React.ReactNode;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
}) {
  const { state, hydrated } = useStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // 로그인 여부 자체는 AuthGuard(app/providers.tsx)가 리다이렉트를 전담하므로,
  // 여기서는 리다이렉트되기 전까지 보호된 화면이 잠깐 노출되지 않도록 렌더만 막는다.
  if (!mounted || !hydrated || !state.currentUser) return null;

  return (
    <div className="min-h-screen bg-surface-container-low">
      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
      <Header
        onMenuClick={() => setMobileMenuOpen(true)}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
      />
      <main className="md:ml-64 pt-16">
        {children}
      </main>
    </div>
  );
}
