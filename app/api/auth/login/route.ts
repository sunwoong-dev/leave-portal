import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";

const USERS_COL = "leave_portal_users";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { username, password } = (await req.json()) as { username?: string; password?: string };
    if (!username || !password) {
      return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400 });
    }

    const app = getAdminApp();
    const db = getFirestore(app);
    const snap = await db.collection(USERS_COL).where("username", "==", username).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ ok: false, code: "not_found" }, { status: 401 });
    }

    const userDoc = snap.docs[0];
    if (userDoc.data().password !== hashPassword(password)) {
      return NextResponse.json({ ok: false, code: "wrong_password" }, { status: 401 });
    }

    // Firestore 문서 ID를 그대로 Firebase Auth uid로 사용 — 앱 전역에서 userId로 이미 쓰이는
    // 값과 동일하게 맞춰서 이후 Firestore 보안 규칙에서 request.auth.uid를 바로 대조할 수 있게 함
    const customToken = await getAuth(app).createCustomToken(userDoc.id);
    return NextResponse.json({ ok: true, customToken });
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
