// 알림 발송 성공률 / 지연시간 통계 조회 (읽기 전용)
// 사용법: node scripts/notification-stats.mjs
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDdCsrA_KeMwfATAHb-UQ63qfmxhUfALtk",
  authDomain: "stitch-a57f3.firebaseapp.com",
  projectId: "stitch-a57f3",
  storageBucket: "stitch-a57f3.firebasestorage.app",
  messagingSenderId: "461921219558",
  appId: "1:461921219558:web:71c6228f252d7204f49c27",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const snap = await getDocs(collection(db, "leave_portal_notification_logs"));
const logs = snap.docs.map((d) => d.data());

const total = logs.length;
const withToken = logs.filter((l) => l.hadToken).length;
const sendSucceeded = logs.filter((l) => l.sendSuccess).length;
const delivered = logs.filter((l) => l.receivedAt).length;
const latencies = logs
  .filter((l) => typeof l.deliveryLatencyMs === "number")
  .map((l) => l.deliveryLatencyMs);

console.log(`총 발송 시도: ${total}건`);
console.log(`FCM 토큰 보유: ${withToken}건 (${total ? Math.round((withToken / total) * 100) : 0}%)`);
console.log(`서버 발송 성공률: ${sendSucceeded}/${total} (${total ? Math.round((sendSucceeded / total) * 100) : 0}%)`);
console.log(`클라이언트 수신 확인률: ${delivered}/${sendSucceeded} (${sendSucceeded ? Math.round((delivered / sendSucceeded) * 100) : 0}% of 발송성공)`);

if (latencies.length > 0) {
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`평균 수신 지연시간: ${Math.round(avg)}ms`);
  console.log(`중앙값 수신 지연시간: ${median}ms`);
  console.log(`최대 수신 지연시간: ${Math.max(...latencies)}ms`);
} else {
  console.log("수신 지연시간 데이터 없음 (아직 수신 확인된 알림이 없습니다)");
}

process.exit(0);
