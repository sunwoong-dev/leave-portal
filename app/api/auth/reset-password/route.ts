import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { checkPasswordPolicy } from "@/lib/passwordPolicy";

const USERS_COL = "leave_portal_users";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { name, username, joinDate, newPassword } = (await req.json()) as {
      name?: string;
      username?: string;
      joinDate?: string;
      newPassword?: string;
    };
    if (!name?.trim() || !username?.trim() || !joinDate || !newPassword) {
      return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400 });
    }
    if (!checkPasswordPolicy(newPassword).valid) {
      return NextResponse.json({ ok: false, code: "weak_password" }, { status: 400 });
    }

    const app = getAdminApp();
    const db = getFirestore(app);
    const snap = await db.collection(USERS_COL).where("username", "==", username.trim()).limit(1).get();
    if (snap.empty) {
      return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
    }

    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    // 이름/입사일까지 일치해야 본인으로 간주 — 아이디만으로는 재설정 불가
    if (userData.name !== name.trim() || userData.joinDate !== joinDate) {
      return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
    }
    if (userData.resignationDate) {
      return NextResponse.json({ ok: false, code: "resigned" }, { status: 403 });
    }

    await userDoc.ref.update({
      password: hashPassword(newPassword),
      mustChangePassword: FieldValue.delete(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/reset-password]", err);
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
