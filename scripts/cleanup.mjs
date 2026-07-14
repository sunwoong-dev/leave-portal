import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

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

async function deleteCollection(colName) {
  const snap = await getDocs(collection(db, colName));
  if (snap.empty) { console.log(`  ${colName}: 이미 비어 있음`); return; }
  await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, colName, d.id))));
  console.log(`  ${colName}: ${snap.size}개 삭제 완료`);
}

async function deleteNonAdminUsers() {
  const snap = await getDocs(collection(db, "leave_portal_users"));
  const nonAdmins = snap.docs.filter((d) => !d.data().isManager);
  if (nonAdmins.length === 0) { console.log("  leave_portal_users: 비관리자 없음"); return; }
  await Promise.all(nonAdmins.map((d) => deleteDoc(doc(db, "leave_portal_users", d.id))));
  const admins = snap.docs.filter((d) => d.data().isManager).map((d) => d.data().name);
  console.log(`  leave_portal_users: 비관리자 ${nonAdmins.length}명 삭제 / 관리자 [${admins.join(", ")}] 유지`);
}

console.log("🧹 데이터 정리 시작...");
await deleteNonAdminUsers();
await deleteCollection("leave_portal_requests");
await deleteCollection("leave_portal_grants");
console.log("✅ 완료");
process.exit(0);
