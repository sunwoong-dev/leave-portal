import { NextRequest, NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { addYearsToDateStr, todayLocalStr } from "@/lib/dateUtils";

const USERS_COL = "leave_portal_users";
const REQUESTS_COL = "leave_portal_requests";
const GRANTS_COL = "leave_portal_grants";
const NOTIF_COL = "leave_portal_notifications";
const NOTIF_LOGS_COL = "leave_portal_notification_logs";

const RETENTION_YEARS = 3;

// 퇴사일로부터 3년이 지난 직원의 데이터를 완전히 파기 (연차 신청/부여 이력 포함).
// Vercel Cron이 매일 호출 — vercel.json 참고. 다른 경로로는 CRON_SECRET 없이 호출 불가.
async function deleteByField(db: FirebaseFirestore.Firestore, col: string, field: string, userId: string) {
  const snap = await db.collection(col).where(field, "==", userId).get();
  if (snap.empty) return 0;
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  try {
    const app = getAdminApp();
    const db = getFirestore(app);
    const auth = getAuth(app);

    // resignationDate가 없는 문서는 "<=" 범위 비교에 걸리지 않으므로 재직자는 자동 제외됨
    const cutoff = addYearsToDateStr(todayLocalStr(), -RETENTION_YEARS);
    const snap = await db.collection(USERS_COL).where("resignationDate", "<=", cutoff).get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, purged: 0 });
    }

    const results: Array<{ userId: string; requests: number; grants: number; notifications: number; notificationLogs: number }> = [];

    for (const userDoc of snap.docs) {
      const userId = userDoc.id;
      const [requests, grants, notifications, notificationLogs] = await Promise.all([
        deleteByField(db, REQUESTS_COL, "userId", userId),
        deleteByField(db, GRANTS_COL, "userId", userId),
        deleteByField(db, NOTIF_COL, "userId", userId),
        deleteByField(db, NOTIF_LOGS_COL, "toUserId", userId),
      ]);
      await userDoc.ref.delete();
      await auth.deleteUser(userId).catch(() => {});
      results.push({ userId, requests, grants, notifications, notificationLogs });
    }

    console.log(`[cron/purge-resigned] 퇴사 3년 경과 데이터 파기 완료: ${results.length}명`, results);
    return NextResponse.json({ ok: true, purged: results.length, details: results });
  } catch (err) {
    console.error("[cron/purge-resigned]", err);
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
