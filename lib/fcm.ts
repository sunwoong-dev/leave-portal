"use client";

import { getMessaging, getToken, onMessage, MessagePayload } from "firebase/messaging";
import app from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

export async function requestPermissionAndGetToken(): Promise<string | null> {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    return token || null;
  } catch {
    return null;
  }
}

export function onForegroundMessage(callback: (payload: MessagePayload) => void) {
  if (typeof window === "undefined") return () => {};
  try {
    const messaging = getMessaging(app);
    return onMessage(messaging, callback);
  } catch {
    return () => {};
  }
}
