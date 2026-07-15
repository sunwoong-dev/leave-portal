import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const USERS_COL = "leave_portal_users";
const NOTIF_COL = "leave_portal_notifications";
const NOTIF_LOGS_COL = "leave_portal_notification_logs";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not set");
  const serviceAccount = JSON.parse(raw);
  return initializeApp({ credential: cert(serviceAccount) });
}

export async function POST(req: NextRequest) {
  try {
    const { toUserId, title, body, type, requestId } = (await req.json()) as {
      toUserId: string;
      title: string;
      body: string;
      type: string;
      requestId?: string;
    };

    const app = getAdminApp();
    const db = getFirestore(app);

    // Save in-app notification
    await db.collection(NOTIF_COL).add({
      userId: toUserId,
      title,
      body,
      type,
      requestId: requestId ?? null,
      read: false,
      createdAt: new Date().toISOString(),
    });

    // Send FCM push if token exists
    const sentAt = new Date().toISOString();
    const userSnap = await db.collection(USERS_COL).doc(toUserId).get();
    const fcmToken = userSnap.data()?.fcmToken as string | undefined;

    // 발송 로그 시작 (성공률/지연시간 측정용)
    const logRef = await db.collection(NOTIF_LOGS_COL).add({
      toUserId,
      type,
      requestId: requestId ?? null,
      title,
      body,
      hadToken: !!fcmToken,
      sendSuccess: false,
      sentAt,
    });

    if (!fcmToken) {
      await logRef.update({ sendError: "no_fcm_token" });
      return NextResponse.json({ ok: true, pushed: false });
    }

    const startedAt = Date.now();
    try {
      await getMessaging(app).send({
        token: fcmToken,
        notification: { title, body },
        data: { logId: logRef.id, sentAt },
        webpush: {
          notification: { title, body, icon: "/icon-192.png" },
          fcmOptions: { link: "/dashboard" },
        },
      });
      await logRef.update({ sendSuccess: true, serverLatencyMs: Date.now() - startedAt });
    } catch (sendErr) {
      await logRef.update({
        sendSuccess: false,
        sendError: String(sendErr),
        serverLatencyMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notify]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
