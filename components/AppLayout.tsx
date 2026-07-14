"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && hydrated && !state.currentUser) {
      router.replace("/login");
    }
  }, [mounted, hydrated, state.currentUser, router]);

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
