// 읽기 전용 조사: 기노욱 계정 Firebase Auth 로그인 이력 + Cloud Logging(Admin Activity) 조회
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { GoogleAuth } from "google-auth-library";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not set");
const serviceAccount = JSON.parse(raw);
const projectId = serviceAccount.project_id;

const app = initializeApp({ credential: cert(serviceAccount) });

const TARGET_UID = "0Avgva4h03UOasXzjIfu"; // 기노욱 (leave_portal_users doc id == Auth uid)

console.log("=== Firebase Auth: 기노욱 계정 메타데이터 ===");
try {
  const user = await getAuth(app).getUser(TARGET_UID);
  console.log(JSON.stringify({
    uid: user.uid,
    disabled: user.disabled,
    metadata: user.metadata,
    providerData: user.providerData.map(p => ({ providerId: p.providerId })),
    customClaims: user.customClaims,
  }, null, 2));
} catch (e) {
  console.log("Auth 조회 실패:", e.message);
}

console.log("\n=== 비교용: 전체 유저 로그인 이력 (최근 로그인순, uid만) ===");
try {
  const list = await getAuth(app).listUsers(1000);
  const sorted = list.users
    .map(u => ({ uid: u.uid, lastSignInTime: u.metadata.lastSignInTime, creationTime: u.metadata.creationTime }))
    .sort((a, b) => new Date(b.lastSignInTime || 0) - new Date(a.lastSignInTime || 0));
  sorted.forEach(u => console.log(`${u.uid}  last=${u.lastSignInTime}  created=${u.creationTime}`));
} catch (e) {
  console.log("listUsers 실패:", e.message);
}

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/logging.read", "https://www.googleapis.com/auth/cloud-platform.read-only"],
});
const client = await auth.getClient();

async function queryLogs(label, filter) {
  console.log(`\n=== Cloud Logging: ${label} ===`);
  try {
    const res = await client.request({
      url: "https://logging.googleapis.com/v2/entries:list",
      method: "POST",
      data: {
        resourceNames: [`projects/${projectId}`],
        filter: `timestamp>="2026-01-01T00:00:00Z" AND ${filter}`,
        orderBy: "timestamp desc",
        pageSize: 100,
      },
    });
    const entries = res.data.entries || [];
    console.log(`결과 ${entries.length}건`);
    entries.forEach(e => {
      console.log(`- ${e.timestamp} actor=${e.protoPayload?.authenticationInfo?.principalEmail ?? "(비어있음/미인증)"} method=${e.protoPayload?.methodName} resource=${e.protoPayload?.resourceName ?? ""}`);
    });
  } catch (e) {
    console.log("조회 실패:", e.response?.data?.error?.message || e.message);
  }
}

await queryLogs("firebaserules(보안 규칙) 변경 이력", `protoPayload.serviceName="firebaserules.googleapis.com"`);
await queryLogs("identitytoolkit(Auth 계정) 삭제/변경 이력", `protoPayload.serviceName="identitytoolkit.googleapis.com" AND protoPayload.methodName:"Account"`);
await queryLogs(`기노욱 uid(${TARGET_UID}) 관련 전체 이력`, `protoPayload.resourceName:"${TARGET_UID}"`);

process.exit(0);
