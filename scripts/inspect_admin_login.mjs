// 읽기 전용 조사: admin 계정 문서 상태 + 로그인 시도 기록. 비밀번호 해시는 출력하지 않는다.
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not set");
const app = initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore(app);

console.log("=== admin 문서 상태 (password 제외) ===");
const snap = await db.collection("leave_portal_users").where("username", "==", "admin").get();
console.log(`admin 문서 수: ${snap.size}`);
let adminUid;
for (const d of snap.docs) {
  adminUid = d.id;
  const { password, ...rest } = d.data();
  console.log(JSON.stringify({
    id: d.id,
    createTime: d.createTime?.toDate().toISOString(),
    updateTime: d.updateTime?.toDate().toISOString(), // 문서가 마지막으로 수정된 시각 (비밀번호 변경 포함)
    hasPassword: !!password,
    ...rest,
  }, null, 2));
}

if (adminUid) {
  console.log("\n=== Firebase Auth: admin 메타데이터 ===");
  try {
    const u = await getAuth(app).getUser(adminUid);
    console.log(JSON.stringify({ disabled: u.disabled, ...u.metadata }, null, 2));
  } catch (e) {
    console.log("Auth 조회 실패:", e.message);
  }
}

console.log("\n=== 로그인 시도 기록: username=admin (최신순) ===");
const adminLogs = await db.collection("leave_portal_login_logs").where("username", "==", "admin").get();
const rows = adminLogs.docs.map((d) => d.data()).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
console.log(`총 ${rows.length}건`);
rows.slice(0, 80).forEach((r) => console.log(`${r.at}  ok=${r.ok}  code=${r.code}  ip=${r.ip}  ua=${(r.userAgent || "").slice(0, 60)}`));

console.log("\n=== 전체 로그인 시도 최근 100건 요약 (username 별) ===");
const all = await db.collection("leave_portal_login_logs").orderBy("at", "desc").limit(100).get();
const byUser = {};
all.docs.forEach((d) => {
  const r = d.data();
  const k = `${r.username ?? "(null)"} / ${r.code}`;
  byUser[k] = (byUser[k] || 0) + 1;
});
console.log(JSON.stringify(byUser, null, 2));
console.log(`최근 100건 범위: ${all.docs.at(-1)?.data().at} ~ ${all.docs[0]?.data().at}`);

process.exit(0);
