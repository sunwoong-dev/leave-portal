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
      return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 400 });
    }

    const app = getAdminApp();
    const db = getFirestore(app);
    const snap = await db.collection(USERS_COL).where("username", "==", username).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ ok: false, error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    const userDoc = snap.docs[0];
    if (userDoc.data().password !== hashPassword(password)) {
      return NextResponse.json({ ok: false, error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    await userDoc.ref.delete();
    // 이 계정으로 한 번도 새 로그인 방식으로 로그인한 적이 없으면 Auth 유저가 없을 수 있음 — 무시
    await getAuth(app).deleteUser(userDoc.id).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/delete-account]", err);
    return NextResponse.json({ ok: false, error: "탈퇴 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
