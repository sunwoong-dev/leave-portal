"use client";
import { StoreProvider } from "@/lib/store";
import AuthGuard from "@/components/AuthGuard";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <AuthGuard>{children}</AuthGuard>
    </StoreProvider>
  );
}
