importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-messaging-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDdCsrA_KeMwfATAHb-UQ63qfmxhUfALtk",
  authDomain: "stitch-a57f3.firebaseapp.com",
  projectId: "stitch-a57f3",
  storageBucket: "stitch-a57f3.firebasestorage.app",
  messagingSenderId: "461921219558",
  appId: "1:461921219558:web:71c6228f252d7204f49c27",
});

const messaging = firebase.messaging();
const firestore = firebase.firestore();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {};

  // 발송 로그에 수신 확인 기록 (성공률/지연시간 측정용)
  const data = payload.data ?? {};
  if (data.logId) {
    const receivedAt = new Date().toISOString();
    const deliveryLatencyMs = data.sentAt ? Date.now() - new Date(data.sentAt).getTime() : undefined;
    firestore.collection('leave_portal_notification_logs').doc(data.logId).update({
      receivedAt,
      receivedVia: 'background',
      ...(deliveryLatencyMs !== undefined ? { deliveryLatencyMs } : {}),
    }).catch(() => {});
  }

  if (!title) return;
  self.registration.showNotification(title, {
    body: body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes("leave-portal") && "focus" in c);
      if (existing) return existing.focus();
      return clients.openWindow("/dashboard");
    })
  );
});
