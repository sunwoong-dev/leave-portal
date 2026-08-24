import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { fetchHolidaysForYear } from "@/lib/holidayApi";

const HOLIDAYS_COL = "leave_portal_holidays";

// 정부/천문연이 아직 발표 안 한 먼 미래 연도까지 매일 재시도해도 비용이 거의 없어(연도당 API 호출
// 1회), 발표되는 즉시 다음 크론 사이클에 자동으로 채워진다. Vercel Cron이 매일 호출 — vercel.json 참고.
const YEARS_AHEAD = 4;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  try {
    const app = getAdminApp();
    const db = getFirestore(app);
    const currentYear = new Date().getFullYear();
    const synced: Record<string, number> = {};
    const skipped: number[] = [];

    for (let y = currentYear; y <= currentYear + YEARS_AHEAD; y++) {
      const holidays = await fetchHolidaysForYear(y);
      if (Object.keys(holidays).length === 0) {
        skipped.push(y);
        continue;
      }
      await db.collection(HOLIDAYS_COL).doc(String(y)).set({
        year: y,
        holidays,
        syncedAt: new Date().toISOString(),
      });
      synced[y] = Object.keys(holidays).length;
    }

    console.log("[cron/sync-holidays] 공휴일 동기화 완료", { synced, skipped });
    return NextResponse.json({ ok: true, synced, skipped });
  } catch (err) {
    console.error("[cron/sync-holidays]", err);
    return NextResponse.json({ ok: false, code: "server_error", error: String(err) }, { status: 500 });
  }
}
