import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";

const USERS_COL = "leave_portal_users";
const LOGIN_LOGS_COL = "leave_portal_login_logs";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

// 로그인 시도는 성공/실패 모두 남긴다(무차별 대입 잠금은 안 걸지만, 최소한 흔적은 남게).
// 로그 실패로 로그인 자체가 막히면 안 되므로 에러는 삼킨다.
async function logAttempt(
  db: FirebaseFirestore.Firestore,
  req: NextRequest,
  username: string | undefined,
  ok: boolean,
  code: string,
) {
  try {
    await db.collection(LOGIN_LOGS_COL).add({
      username: username ?? null,
      ok,
      code,
      ip: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[auth/login] 로그 기록 실패", err);
  }
}

export async function POST(req: NextRequest) {
  const app = getAdminApp();
  const db = getFirestore(app);
  let username: string | undefined;
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    username = body.username;
    const { password } = body;
    if (!username || !password) {
      await logAttempt(db, req, username, false, "invalid_input");
      return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400 });
    }

    const snap = await db.collection(USERS_COL).where("username", "==", username).limit(1).get();
    if (snap.empty) {
      await logAttempt(db, req, username, false, "not_found");
      return NextResponse.json({ ok: false, code: "not_found" }, { status: 401 });
    }

    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    if (userData.password !== hashPassword(password)) {
      await logAttempt(db, req, username, false, "wrong_password");
      return NextResponse.json({ ok: false, code: "wrong_password" }, { status: 401 });
    }
    if (userData.resignationDate) {
      await logAttempt(db, req, username, false, "resigned");
      return NextResponse.json({ ok: false, code: "resigned" }, { status: 403 });
    }

    // Firestore 문서 ID를 그대로 Firebase Auth uid로 사용 — 앱 전역에서 userId로 이미 쓰이는
    // 값과 동일하게 맞춰서 이후 Firestore 보안 규칙에서 request.auth.uid를 바로 대조할 수 있게 함
    const customToken = await getAuth(app).createCustomToken(userDoc.id);
    await logAttempt(db, req, username, true, "ok");
    return NextResponse.json({ ok: true, customToken });
  } catch (err) {
    console.error("[auth/login]", err);
    await logAttempt(db, req, username, false, "server_error");
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
