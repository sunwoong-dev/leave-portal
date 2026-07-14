/**
 * PDF 휴가 신청서 → Firestore 임포트 스크립트 (Firebase 클라이언트 SDK)
 *
 * 사용법:
 *   node scripts/import-leave.mjs
 *
 * ⚠️  leaveBalance 는 건드리지 않음.
 *     과거 기록이 이미 잔여일수에 반영되어 있다면 그대로.
 *     아직 반영 안 됐다면 대시보드 '연차 조정'으로 수동 차감하세요.
 */

import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, getDocs, addDoc } from "firebase/firestore";
import * as fs from "fs";

// .env.local 에서 NEXT_PUBLIC 키 로드
const envPath = new URL("../.env.local", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
const env = {};
for (const line of envLines) {
  const eq = line.indexOf("=");
  if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      apiKey:            env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain:        env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId:         env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket:     env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId:             env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });

const db = getFirestore(app);
const USERS_COL    = "leave_portal_users";
const REQUESTS_COL = "leave_portal_requests";

// ── 사용자 이름으로 userId 조회 ───────────────────────────────────────────
async function findUserByName(name) {
  const snap = await getDocs(collection(db, USERS_COL));
  const matched = snap.docs.find((d) => d.data().name === name);
  if (!matched) throw new Error(`사용자 '${name}' 를 Firestore에서 찾을 수 없습니다.`);
  return { id: matched.id, ...matched.data() };
}

// ── PDF에서 파싱한 연차 기록 목록 ─────────────────────────────────────────
// 새 PDF 추가 시 이 배열에 항목을 추가하면 됩니다.
const records = [
  {
    userName:         "문선웅",
    type:             "half-pm",         // half-am | half-pm | annual | monthly | other
    startDate:        "2026-02-24",
    endDate:          "2026-02-24",
    days:             0.5,
    reason:           "오후 반차",
    projectName:      "WithCue",
    progress:         70,
    deadlineStatus:   "on_track",        // completed | on_track | delayed
    handoverNotes:    "특이사항 없음",
    emergencyContact: "010-4195-7355",
    checkResearchNote:  true,
    checkGanttChart:    true,
    checkStakeholder:   true,
    status:           "approved",
    createdAt:        "2026-02-13T00:00:00.000Z",
    reviewedBy:       "관리자 (기존 기록)",
    reviewedAt:       "2026-02-13T00:00:00.000Z",
  },
];

// ── 실행 ──────────────────────────────────────────────────────────────────
async function run() {
  for (const rec of records) {
    const user = await findUserByName(rec.userName);

    const docData = {
      userId:           user.id,
      userName:         user.name,
      department:       user.department ?? "",
      role:             user.role ?? "",
      initials:         user.initials ?? user.name.slice(0, 1),
      type:             rec.type,
      startDate:        rec.startDate,
      endDate:          rec.endDate,
      days:             rec.days,
      reason:           rec.reason,
      status:           rec.status,
      createdAt:        rec.createdAt,
      reviewedBy:       rec.reviewedBy,
      reviewedAt:       rec.reviewedAt,
      ...(rec.projectName      && { projectName:      rec.projectName }),
      ...(rec.progress != null  && { progress:         rec.progress }),
      ...(rec.deadlineStatus   && { deadlineStatus:    rec.deadlineStatus }),
      ...(rec.handoverNotes    && { handoverNotes:     rec.handoverNotes }),
      ...(rec.emergencyContact && { emergencyContact:  rec.emergencyContact }),
      ...(rec.checkResearchNote != null && { checkResearchNote: rec.checkResearchNote }),
      ...(rec.checkGanttChart   != null && { checkGanttChart:   rec.checkGanttChart }),
      ...(rec.checkStakeholder  != null && { checkStakeholder:  rec.checkStakeholder }),
    };

    const ref = await addDoc(collection(db, REQUESTS_COL), docData);
    console.log(`✅  ${rec.userName} / ${rec.startDate} / ${rec.type} → ${ref.id}`);
  }
  console.log("완료.");
  process.exit(0);
}

run().catch((e) => { console.error("❌", e.message); process.exit(1); });
