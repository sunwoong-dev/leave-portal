import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { calcTotalLeave } from "@/lib/leaveCalc";

const USERS_COL = "leave_portal_users";

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return parts.map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  return name.slice(0, 2).toUpperCase();
}

// 아이디/이름 중복체크 + 계정 생성을 서버로 옮김 — 예전엔 클라이언트가 로그인 전에 직접 Firestore를
// 읽어서 중복체크를 했는데, 그러려면 비인증 상태에서도 users 컬렉션을 읽을 수 있어야 해서 보안
// 규칙을 강하게 걸 수가 없었다. 로그인 API와 동일한 패턴(firebase-admin, 규칙 영향 안 받음)으로 맞춤.
export async function POST(req: NextRequest) {
  try {
    const { username, password, name, joinDate } = (await req.json()) as {
      username?: string;
      password?: string;
      name?: string;
      joinDate?: string;
    };
    if (!username || !password || !name) {
      return NextResponse.json({ ok: false, code: "invalid_input" }, { status: 400 });
    }

    const app = getAdminApp();
    const db = getFirestore(app);
    const [usernameSnap, nameSnap] = await Promise.all([
      db.collection(USERS_COL).where("username", "==", username).limit(1).get(),
      db.collection(USERS_COL).where("name", "==", name).limit(1).get(),
    ]);
    if (!usernameSnap.empty) {
      return NextResponse.json({ ok: false, code: "username_taken" }, { status: 409 });
    }
    if (!nameSnap.empty) {
      return NextResponse.json({ ok: false, code: "name_taken" }, { status: 409 });
    }

    const initialBalance = joinDate ? calcTotalLeave(joinDate) : 15;
    const docRef = await db.collection(USERS_COL).add({
      username,
      name,
      joinDate: joinDate ?? "",
      password: hashPassword(password),
      isManager: false,
      initials: makeInitials(name),
      totalLeave: initialBalance,
      leaveBalance: initialBalance,
    });

    return NextResponse.json({ ok: true, userId: docRef.id });
  } catch (err) {
    console.error("[auth/signup]", err);
    return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
  }
}
