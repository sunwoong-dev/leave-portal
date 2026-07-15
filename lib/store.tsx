"use client";

import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import { User, LeaveRequest, LeaveGrant, AppNotification } from "./types";
import { db } from "./firebase";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, deleteField,
  onSnapshot, getDocs, getDoc, query, where, increment,
} from "firebase/firestore";
import { calcTotalLeave, currentLeaveYearStart } from "./leaveCalc";

const USERS_COL = "leave_portal_users";
const REQUESTS_COL = "leave_portal_requests";
const GRANTS_COL = "leave_portal_grants";
const SESSION_KEY = "leave_portal_session";

// 병가/예비군은 유급 처리되어 연차에서 차감하지 않음
const NO_DEDUCTION_TYPES = ["sick", "reservist"];

const NOTIF_COL = "leave_portal_notifications";
const NOTIF_LOGS_COL = "leave_portal_notification_logs";

interface State {
  currentUser: User | null;
  leaveRequests: LeaveRequest[];
  leaveGrants: LeaveGrant[];
  appNotifications: AppNotification[];
  notification: { message: string; type: "success" | "error" } | null;
}

type Action =
  | { type: "LOGIN"; payload: User }
  | { type: "LOGOUT" }
  | { type: "SET_LEAVE_REQUESTS"; payload: LeaveRequest[] }
  | { type: "SET_LEAVE_GRANTS"; payload: LeaveGrant[] }
  | { type: "SET_APP_NOTIFICATIONS"; payload: AppNotification[] }
  | { type: "SET_NOTIFICATION"; payload: { message: string; type: "success" | "error" } | null }
  | { type: "UPDATE_USER_BALANCE"; payload: number }
  | { type: "UPDATE_USER_SIGNATURE"; payload: string | undefined };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "LOGIN":
      return { ...state, currentUser: action.payload };
    case "LOGOUT":
      return { ...state, currentUser: null, appNotifications: [] };
    case "SET_LEAVE_REQUESTS":
      return { ...state, leaveRequests: action.payload };
    case "SET_LEAVE_GRANTS":
      return { ...state, leaveGrants: action.payload };
    case "SET_APP_NOTIFICATIONS":
      return { ...state, appNotifications: action.payload };
    case "SET_NOTIFICATION":
      return { ...state, notification: action.payload };
    case "UPDATE_USER_BALANCE":
      if (!state.currentUser) return state;
      return { ...state, currentUser: { ...state.currentUser, leaveBalance: action.payload } };
    case "UPDATE_USER_SIGNATURE":
      if (!state.currentUser) return state;
      return { ...state, currentUser: { ...state.currentUser, signatureImage: action.payload } };
    default:
      return state;
  }
}

const INITIAL_STATE: State = {
  currentUser: null,
  leaveRequests: [],
  leaveGrants: [],
  appNotifications: [],
  notification: null,
};

export interface SignupData {
  name: string;
  username: string;
  joinDate: string;
}

interface StoreContextType {
  state: State;
  hydrated: boolean;
  usedLeave: number;
  grantedDays: number;
  unreadCount: number;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, data: SignupData) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  deleteAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
  addLeave: (req: Omit<LeaveRequest, "id" | "createdAt">) => Promise<void>;
  updateLeaveRequest: (id: string, updates: Partial<Omit<LeaveRequest, "id" | "createdAt">>) => Promise<void>;
  addGrant: (userId: string, userName: string, days: number, reason: string) => Promise<void>;
  updateLeaveStatus: (id: string, status: "approved" | "rejected", note?: string) => Promise<void>;
  deleteLeave: (id: string) => Promise<void>;
  updateSignature: (imageDataUrl: string | null) => Promise<void>;
  showNotification: (message: string, type?: "success" | "error") => void;
  markNotificationsRead: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

function makeInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return parts.map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  return name.slice(0, 2).toUpperCase();
}

async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildUser(id: string, data: Record<string, unknown>): User {
  const joinDate = (data.joinDate as string) ?? "";
  const storedTotal = data.totalLeave as number | undefined;
  const totalLeave = joinDate ? calcTotalLeave(joinDate) : (storedTotal ?? 15);
  return {
    id,
    username: data.username as string,
    name: data.name as string,
    joinDate,
    totalLeave,
    leaveBalance: (data.leaveBalance as number) ?? totalLeave, // Firestore에 없으면 totalLeave로 임시 초기화
    isManager: (data.isManager as boolean) ?? false,
    initials: (data.initials as string) ?? makeInitials(data.name as string),
    signatureImage: data.signatureImage as string | undefined,
  };
}

// leaveBalance가 Firestore에 없는 기존 유저를 마이그레이션
async function migrateLeaveBalance(userId: string, totalLeave: number): Promise<number> {
  const [grantsSnap, requestsSnap] = await Promise.all([
    getDocs(query(collection(db, GRANTS_COL), where("userId", "==", userId))),
    getDocs(query(collection(db, REQUESTS_COL), where("userId", "==", userId))),
  ]);
  const totalGranted = grantsSnap.docs.reduce((s, d) => s + ((d.data().days as number) ?? 0), 0);
  const totalUsed = requestsSnap.docs
    .filter((d) => d.data().status === "approved")
    .reduce((s, d) => s + ((d.data().days as number) ?? 0), 0);
  const balance = totalLeave + totalGranted - totalUsed;
  await updateDoc(doc(db, USERS_COL, userId), { leaveBalance: balance, totalLeave });
  return balance;
}

// 연수에 따른 연차 일수 (1년차=15, 3년차=16, 5년차=17 ... 최대 25)
function annualLeaveForYear(year: number): number {
  return Math.min(15 + Math.floor((year - 1) / 2), 25);
}

// 입사일 기준 완성된 개월 수 계산
function completedMonths(joinDate: string): number {
  const join = new Date(joinDate);
  const now = new Date();
  let m = (now.getFullYear() - join.getFullYear()) * 12 + (now.getMonth() - join.getMonth());
  if (now.getDate() < join.getDate()) m--;
  return Math.max(0, m);
}

/**
 * 로그인/복원 시 호출. leaveBalance를 갱신하고 새 값을 반환.
 * currentLeaveBalance: Firestore에서 읽은 현재 잔여 연차
 *
 * [월차 구간 (months < 12)]
 *   완성 개월 증가분만큼 leaveBalance += delta (월차는 누적 사용 가능)
 *
 * [연차 구간 (months >= 12)]
 *   연도 전환 시 잔여 연차는 연차수당으로 정산 → leaveBalance = 새 연도 연차 수 (SET)
 *   연도가 바뀌지 않았으면 balance 유지.
 *   기존 유저(annualLeaveYearGenerated 없음): 현 상태 기록만, balance 불변.
 *     단, storedTotal <= 11이면 월차→연차 전환 케이스 → SET 처리.
 */
async function syncTotalLeave(
  userId: string,
  joinDate: string,
  storedTotal: number | undefined,
  storedAnnualYear: number | undefined,
  currentLeaveBalance: number,
): Promise<number> {
  if (!joinDate) return currentLeaveBalance;

  const months = completedMonths(joinDate);
  const currentAnnualLeave = calcTotalLeave(joinDate);

  // ── 월차 구간 ──
  if (months < 12) {
    const earned = Math.min(months, 11);
    if (storedTotal === undefined) {
      await updateDoc(doc(db, USERS_COL, userId), { totalLeave: earned });
      return currentLeaveBalance;
    }
    if (earned > storedTotal) {
      const delta = earned - storedTotal;
      await updateDoc(doc(db, USERS_COL, userId), { totalLeave: earned, leaveBalance: increment(delta) });
      return currentLeaveBalance + delta;
    }
    return currentLeaveBalance;
  }

  // ── 연차 구간 (1년 이상) ──
  const completedYears = Math.floor(months / 12);
  const newAnnualLeave = annualLeaveForYear(completedYears);

  if (storedAnnualYear === undefined) {
    if (storedTotal !== undefined && storedTotal <= 12) {
      // 월차 구간에서 막 넘어온 신규 유저: 잔여 월차 정산 → 해당 연도 연차로 SET
      await updateDoc(doc(db, USERS_COL, userId), {
        totalLeave: newAnnualLeave,
        annualLeaveYearGenerated: completedYears,
        leaveBalance: newAnnualLeave,
      });
      return newAnnualLeave;
    }
    // 기존 유저(이미 연차 구간): balance 변경 없이 현 상태 기록만
    await updateDoc(doc(db, USERS_COL, userId), {
      totalLeave: currentAnnualLeave,
      annualLeaveYearGenerated: completedYears,
    });
    return currentLeaveBalance;
  }

  if (completedYears > storedAnnualYear) {
    // 새 연도 도달: 전년도 잔여 연차 연차수당 정산 → 이번 연도 연차 수로 SET
    await updateDoc(doc(db, USERS_COL, userId), {
      totalLeave: newAnnualLeave,
      annualLeaveYearGenerated: completedYears,
      leaveBalance: newAnnualLeave,
    });
    return newAnnualLeave;
  }

  // 같은 연도 내: totalLeave 표시값만 갱신 (연수 변화 없음)
  if (currentAnnualLeave !== storedTotal) {
    await updateDoc(doc(db, USERS_COL, userId), { totalLeave: currentAnnualLeave });
  }
  return currentLeaveBalance;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  // 세션 복원
  useEffect(() => {
    async function restore() {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as User;
          const joinDate = stored.joinDate ?? "";
          const totalLeave = joinDate ? calcTotalLeave(joinDate) : (stored.totalLeave ?? 15);
          // Firestore에서 최신 leaveBalance 가져오기
          const userDoc = await getDoc(doc(db, USERS_COL, stored.id));
          let leaveBalance = stored.leaveBalance ?? totalLeave;
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.leaveBalance !== undefined) {
              leaveBalance = data.leaveBalance as number;
              // 입사일 기준 연차 자동 갱신
              leaveBalance = await syncTotalLeave(
                stored.id, joinDate,
                data.totalLeave as number | undefined,
                data.annualLeaveYearGenerated as number | undefined,
                leaveBalance,
              );
            } else {
              // 마이그레이션
              leaveBalance = await migrateLeaveBalance(stored.id, totalLeave);
            }
          }
          const user: User = { ...stored, totalLeave, leaveBalance };
          dispatch({ type: "LOGIN", payload: user });
          localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        }
      } catch {
        localStorage.removeItem(SESSION_KEY);
      }
      setHydrated(true);
    }
    restore();
  }, []);

  // 현재 로그인 유저의 leaveBalance 실시간 동기화
  useEffect(() => {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    const unsubscribe = onSnapshot(doc(db, USERS_COL, userId), (docSnap) => {
      if (docSnap.exists()) {
        const lb = docSnap.data().leaveBalance as number | undefined;
        if (lb !== undefined) {
          dispatch({ type: "UPDATE_USER_BALANCE", payload: lb });
          try {
            const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as User;
            localStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored, leaveBalance: lb }));
          } catch {}
        }
      }
    });
    return () => unsubscribe();
  }, [state.currentUser?.id]);

  // 실시간 휴가 신청 목록
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, REQUESTS_COL), (snap) => {
      const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveRequest[];
      dispatch({ type: "SET_LEAVE_REQUESTS", payload: requests });
    });
    return () => unsubscribe();
  }, []);

  // 실시간 연차 부여 목록
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, GRANTS_COL), (snap) => {
      const grants = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveGrant[];
      dispatch({ type: "SET_LEAVE_GRANTS", payload: grants });
    });
    return () => unsubscribe();
  }, []);

  // FCM 토큰 등록
  useEffect(() => {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    import("./fcm").then(({ requestPermissionAndGetToken }) => {
      requestPermissionAndGetToken().then((token) => {
        if (token) updateDoc(doc(db, USERS_COL, userId), { fcmToken: token }).catch(() => {});
      });
    });
  }, [state.currentUser?.id]);

  // FCM 포그라운드 메시지 (앱 열려있을 때)
  useEffect(() => {
    if (!state.currentUser) return;
    let unsub: (() => void) | undefined;
    import("./fcm").then(({ onForegroundMessage }) => {
      unsub = onForegroundMessage((payload) => {
        const title = payload.notification?.title;
        if (title) dispatch({ type: "SET_NOTIFICATION", payload: { message: title, type: "success" } });
        // 발송 로그에 수신 확인 기록 (성공률/지연시간 측정용)
        const logId = payload.data?.logId;
        const sentAtStr = payload.data?.sentAt;
        if (logId) {
          const receivedAt = new Date().toISOString();
          const deliveryLatencyMs = sentAtStr ? Date.now() - new Date(sentAtStr).getTime() : undefined;
          updateDoc(doc(db, NOTIF_LOGS_COL, logId), {
            receivedAt,
            receivedVia: "foreground",
            ...(deliveryLatencyMs !== undefined && { deliveryLatencyMs }),
          }).catch(() => {});
        }
      }) as unknown as () => void;
    });
    return () => { unsub?.(); };
  }, [state.currentUser?.id]);

  // 인앱 알림 실시간 구독
  useEffect(() => {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    const unsubscribe = onSnapshot(
      query(collection(db, NOTIF_COL), where("userId", "==", userId)),
      (snap) => {
        const notifs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() })) as AppNotification[];
        notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        dispatch({ type: "SET_APP_NOTIFICATIONS", payload: notifs });
      }
    );
    return () => unsubscribe();
  }, [state.currentUser?.id]);

  // 토스트 자동 소멸
  useEffect(() => {
    if (state.notification) {
      const t = setTimeout(() => dispatch({ type: "SET_NOTIFICATION", payload: null }), 3500);
      return () => clearTimeout(t);
    }
  }, [state.notification]);

  async function login(username: string, password: string): Promise<void> {
    const hashed = await hashPassword(password);
    const snap = await getDocs(query(collection(db, USERS_COL), where("username", "==", username)));
    if (snap.empty) throw Object.assign(new Error(), { code: "not_found" });
    const data = snap.docs[0].data();
    if (data.password !== hashed) throw Object.assign(new Error(), { code: "wrong_password" });
    let user = buildUser(snap.docs[0].id, data);
    // leaveBalance가 없는 기존 유저 마이그레이션
    if (data.leaveBalance === undefined) {
      user.leaveBalance = await migrateLeaveBalance(user.id, user.totalLeave);
    } else {
      // 입사일 기준 totalLeave 자동 증가 반영
      const newBalance = await syncTotalLeave(
        user.id, user.joinDate ?? "",
        data.totalLeave as number | undefined,
        data.annualLeaveYearGenerated as number | undefined,
        user.leaveBalance,
      );
      user = { ...user, leaveBalance: newBalance };
    }
    dispatch({ type: "LOGIN", payload: user });
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  async function signup(
    username: string,
    password: string,
    data: SignupData
  ): Promise<{ ok: boolean; error?: string }> {
    const [usernameSnap, nameSnap] = await Promise.all([
      getDocs(query(collection(db, USERS_COL), where("username", "==", username))),
      getDocs(query(collection(db, USERS_COL), where("name", "==", data.name))),
    ]);
    if (!usernameSnap.empty) return { ok: false, error: "이미 사용 중인 아이디입니다." };
    if (!nameSnap.empty) return { ok: false, error: "이미 사용 중인 이름입니다." };

    const hashed = await hashPassword(password);
    const initialBalance = data.joinDate ? calcTotalLeave(data.joinDate) : 15;
    const newDoc = {
      username,
      name: data.name,
      joinDate: data.joinDate,
      password: hashed,
      isManager: false,
      initials: makeInitials(data.name),
      totalLeave: initialBalance,
      leaveBalance: initialBalance,
    };
    const ref = await addDoc(collection(db, USERS_COL), newDoc);
    const user = buildUser(ref.id, { ...newDoc });
    dispatch({ type: "LOGIN", payload: user });
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return { ok: true };
  }

  function logout() {
    dispatch({ type: "LOGOUT" });
    localStorage.removeItem(SESSION_KEY);
  }

  async function deleteAccount(password: string): Promise<{ ok: boolean; error?: string }> {
    if (!state.currentUser) return { ok: false, error: "로그인 상태가 아닙니다." };
    const hashed = await hashPassword(password);
    const snap = await getDocs(query(collection(db, USERS_COL), where("username", "==", state.currentUser.username)));
    if (snap.empty) return { ok: false, error: "사용자를 찾을 수 없습니다." };
    const data = snap.docs[0].data();
    if (data.password !== hashed) return { ok: false, error: "비밀번호가 올바르지 않습니다." };
    await deleteDoc(doc(db, USERS_COL, snap.docs[0].id));
    dispatch({ type: "LOGOUT" });
    localStorage.removeItem(SESSION_KEY);
    return { ok: true };
  }

  async function sendPushToUser(toUserId: string, title: string, body: string, type: string, requestId?: string) {
    try {
      await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toUserId, title, body, type, requestId }),
      });
    } catch {}
  }

  async function addLeave(req: Omit<LeaveRequest, "id" | "createdAt">) {
    const now = new Date().toISOString();
    const isManagerSelf = state.currentUser?.isManager ?? false;
    const docRef = await addDoc(collection(db, REQUESTS_COL), {
      ...req,
      createdAt: now,
      ...(isManagerSelf && {
        status: "approved",
        reviewedBy: `${state.currentUser!.name} (자동승인)`,
        reviewedById: state.currentUser!.id,
        reviewedAt: now,
      }),
    });
    // 관리자 본인 연차는 자동 승인이므로 즉시 차감 (병가/예비군은 차감 제외)
    if (isManagerSelf) {
      if (!NO_DEDUCTION_TYPES.includes(req.type)) {
        await updateDoc(doc(db, USERS_COL, state.currentUser!.id), {
          leaveBalance: increment(-req.days),
        });
      }
    } else {
      // 일반 유저 신청 → 모든 관리자에게 알림
      const managersSnap = await getDocs(query(collection(db, USERS_COL), where("isManager", "==", true)));
      managersSnap.forEach((m) => {
        sendPushToUser(
          m.id,
          "새 휴가 신청",
          `${req.userName}님이 ${req.days}일간 휴가를 신청했습니다. (${req.startDate} ~ ${req.endDate})`,
          "new_request",
          docRef.id
        );
      });
    }
  }

  async function updateLeaveRequest(id: string, updates: Partial<Omit<LeaveRequest, "id" | "createdAt">>) {
    await updateDoc(doc(db, REQUESTS_COL, id), updates as Record<string, unknown>);
  }

  async function addGrant(userId: string, userName: string, days: number, reason: string) {
    await addDoc(collection(db, GRANTS_COL), {
      userId,
      userName,
      days,
      reason,
      grantedBy: state.currentUser?.name ?? "관리자",
      grantedAt: new Date().toISOString(),
    });
    // 해당 유저의 잔여 연차 즉시 반영
    await updateDoc(doc(db, USERS_COL, userId), { leaveBalance: increment(days) });
  }

  async function updateLeaveStatus(id: string, status: "approved" | "rejected", note?: string) {
    const updates: Record<string, unknown> = {
      status,
      reviewedBy: state.currentUser?.name ?? "관리자",
      reviewedById: state.currentUser?.id ?? null,
      reviewedAt: new Date().toISOString(),
    };
    if (note) updates.reviewNote = note;
    await updateDoc(doc(db, REQUESTS_COL, id), updates);

    const req = state.leaveRequests.find((r) => r.id === id);
    if (req) {
      // 승인 시 잔여 연차 차감 (병가/예비군은 유급 처리되어 차감 제외)
      if (status === "approved" && !NO_DEDUCTION_TYPES.includes(req.type)) {
        await updateDoc(doc(db, USERS_COL, req.userId), { leaveBalance: increment(-req.days) });
      }
      // 신청자에게 결과 알림 (관리자 본인 신청 제외)
      if (req.userId !== state.currentUser?.id) {
        const isApproved = status === "approved";
        sendPushToUser(
          req.userId,
          isApproved ? "휴가 승인" : "휴가 반려",
          `${req.startDate} ~ ${req.endDate} (${req.days}일) 휴가가 ${isApproved ? "승인" : "반려"}되었습니다.`,
          status,
          id
        );
      }
    }
  }

  async function deleteLeave(id: string) {
    // 승인된 휴가 삭제 시 잔여 연차 복원 (병가/예비군은 차감된 적이 없으므로 복원 제외)
    const req = state.leaveRequests.find((r) => r.id === id);
    if (req?.status === "approved" && req.userId && !NO_DEDUCTION_TYPES.includes(req.type)) {
      await updateDoc(doc(db, USERS_COL, req.userId), { leaveBalance: increment(req.days) });
    }
    await deleteDoc(doc(db, REQUESTS_COL, id));
  }

  async function updateSignature(imageDataUrl: string | null) {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    await updateDoc(doc(db, USERS_COL, userId), { signatureImage: imageDataUrl ?? deleteField() });
    dispatch({ type: "UPDATE_USER_SIGNATURE", payload: imageDataUrl ?? undefined });
    try {
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") as User;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...stored, signatureImage: imageDataUrl ?? undefined }));
    } catch {}
  }

  function showNotification(message: string, type: "success" | "error" = "success") {
    dispatch({ type: "SET_NOTIFICATION", payload: { message, type } });
  }

  async function markNotificationsRead() {
    const unread = state.appNotifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => updateDoc(doc(db, NOTIF_COL, n.id), { read: true })));
  }

  // 사용된 연차 합산 (표시용) — 병가/예비군 제외, 현재 연차 연도 이후 사용분만 집계
  const usedLeave = state.currentUser
    ? (() => {
        const yearStart = currentLeaveYearStart(state.currentUser!.joinDate ?? "");
        return state.leaveRequests
          .filter((r) => r.userId === state.currentUser!.id && r.status === "approved" && !NO_DEDUCTION_TYPES.includes(r.type) && r.startDate >= yearStart)
          .reduce((sum, r) => sum + r.days, 0);
      })()
    : 0;

  // 추가 부여된 연차 합산 (표시용)
  const grantedDays = state.currentUser
    ? state.leaveGrants
        .filter((g) => g.userId === state.currentUser!.id)
        .reduce((sum, g) => sum + g.days, 0)
    : 0;

  const unreadCount = state.appNotifications.filter((n) => !n.read).length;

  return (
    <StoreContext.Provider value={{ state, hydrated, usedLeave, grantedDays, unreadCount, login, signup, logout, deleteAccount, addLeave, updateLeaveRequest, addGrant, updateLeaveStatus, deleteLeave, updateSignature, showNotification, markNotificationsRead }}>
      {children}
      {state.notification && (
        <div className={`fixed bottom-8 right-8 px-6 py-4 rounded-xl shadow-xl flex items-center gap-3 z-50 transition-all duration-300 ${
          state.notification.type === "success"
            ? "bg-white border border-outline-variant"
            : "bg-error-container border border-error"
        }`}>
          <span className={`material-symbols-outlined ${state.notification.type === "success" ? "text-green-600" : "text-error"}`}>
            {state.notification.type === "success" ? "check_circle" : "error"}
          </span>
          <p className="text-sm font-semibold text-on-surface">{state.notification.message}</p>
        </div>
      )}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
