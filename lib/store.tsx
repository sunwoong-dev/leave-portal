"use client";

import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import { User, LeaveRequest, LeaveGrant, AppNotification } from "./types";
import { db, auth } from "./firebase";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, deleteField,
  onSnapshot, getDocs, getDoc, query, where, increment,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut } from "firebase/auth";
import { calcTotalLeave, currentLeaveYearStart } from "./leaveCalc";
import { activeGrantBalance, grantCeilingTotal, planGrantConsumption, findExpiredUnclaimedGrants, calcUsedLeave } from "./grantLedger";
import { maskName } from "./piiMask";

const USERS_COL = "leave_portal_users";
const REQUESTS_COL = "leave_portal_requests";
const GRANTS_COL = "leave_portal_grants";

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
  | { type: "UPDATE_USER_SIGNATURE"; payload: string | undefined }
  | { type: "UPDATE_MUST_CHANGE_PASSWORD"; payload: boolean };

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
    case "UPDATE_MUST_CHANGE_PASSWORD":
      if (!state.currentUser) return state;
      return { ...state, currentUser: { ...state.currentUser, mustChangePassword: action.payload } };
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
  unusedGrantDays: number;
  unreadCount: number;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string, data: SignupData) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  deleteAccount: (password: string) => Promise<{ ok: boolean; error?: string }>;
  addLeave: (req: Omit<LeaveRequest, "id" | "createdAt">) => Promise<void>;
  updateLeaveRequest: (id: string, updates: Partial<Omit<LeaveRequest, "id" | "createdAt">>) => Promise<void>;
  addGrant: (userId: string, userName: string, days: number, reason: string) => Promise<void>;
  updateLeaveStatus: (id: string, status: "approved" | "rejected", note?: string) => Promise<void>;
  deleteLeave: (id: string) => Promise<void>;
  updateSignature: (imageDataUrl: string | null) => Promise<void>;
  setResignation: (userId: string, date: string | null) => Promise<void>;
  reinstateEmployee: (userId: string, newJoinDate: string, newName: string) => Promise<void>;
  showNotification: (message: string, type?: "success" | "error") => void;
  markNotificationsRead: () => Promise<void>;
}

const StoreContext = createContext<StoreContextType | null>(null);

export function makeInitials(name: string): string {
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
    resignationDate: data.resignationDate as string | undefined,
    mustChangePassword: !!data.mustChangePassword,
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

// 만료됐지만 아직 정리 안 된 부여 연차를 leaveBalance에서 회수 (로그인/세션 복원 시 호출)
async function syncGrantExpiry(userId: string, currentLeaveBalance: number): Promise<number> {
  const grantsSnap = await getDocs(query(collection(db, GRANTS_COL), where("userId", "==", userId)));
  const grants = grantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveGrant[];
  const expired = findExpiredUnclaimedGrants(grants, userId);
  if (expired.length === 0) return currentLeaveBalance;

  let clawback = 0;
  await Promise.all(
    expired.map((g) => {
      const leftover = g.remainingDays ?? g.days;
      clawback += leftover;
      return updateDoc(doc(db, GRANTS_COL, g.id), { remainingDays: 0 });
    })
  );
  const newBalance = currentLeaveBalance - clawback;
  await updateDoc(doc(db, USERS_COL, userId), { leaveBalance: newBalance });
  return newBalance;
}

// Firebase Auth uid(=Firestore 문서 ID)로 앱에서 쓰는 User를 조립.
// 로그인 직후와 세션 복원(onAuthStateChanged) 양쪽에서 공유하는 단일 경로.
async function loadUserSession(uid: string): Promise<User | null> {
  const userDoc = await getDoc(doc(db, USERS_COL, uid));
  if (!userDoc.exists()) return null;
  const data = userDoc.data();
  if (data.resignationDate) {
    // 세션 유지 중에 관리자가 퇴사 처리한 경우도 즉시 강제 로그아웃
    await firebaseSignOut(auth).catch(() => {});
    return null;
  }
  let user = buildUser(uid, data);
  if (data.leaveBalance === undefined) {
    user.leaveBalance = await migrateLeaveBalance(uid, user.totalLeave);
  } else {
    const newBalance = await syncTotalLeave(
      uid, user.joinDate ?? "",
      data.totalLeave as number | undefined,
      data.annualLeaveYearGenerated as number | undefined,
      user.leaveBalance,
    );
    user = { ...user, leaveBalance: newBalance };
  }
  // 만료된 부여 연차 회수
  user = { ...user, leaveBalance: await syncGrantExpiry(uid, user.leaveBalance) };
  return user;
}

// 서버(API Route)에서 아이디/비밀번호를 검증하고 Firebase Auth Custom Token을 받아옴
async function requestCustomToken(username: string, password: string): Promise<string> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json()) as { ok: boolean; customToken?: string; code?: string };
  if (!data.ok || !data.customToken) {
    throw Object.assign(new Error(), { code: data.code ?? "unknown" });
  }
  return data.customToken;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Firebase Auth 세션 감지 — 앱 로드 시 자동 복원 + 로그인/로그아웃 상태 변화 반영.
  // Firebase SDK가 토큰 만료/갱신을 자체적으로 처리하므로 별도 만료 로직 불필요.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const user = await loadUserSession(firebaseUser.uid);
          if (user) dispatch({ type: "LOGIN", payload: user });
          else dispatch({ type: "LOGOUT" });
        } else {
          dispatch({ type: "LOGOUT" });
        }
      } catch {
        dispatch({ type: "LOGOUT" });
      }
      setHydrated(true);
    });
    return () => unsubscribe();
  }, []);

  // 현재 로그인 유저의 leaveBalance/비밀번호 변경 필요 여부 실시간 동기화
  useEffect(() => {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    const unsubscribe = onSnapshot(doc(db, USERS_COL, userId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lb = data.leaveBalance as number | undefined;
        if (lb !== undefined) dispatch({ type: "UPDATE_USER_BALANCE", payload: lb });
        dispatch({ type: "UPDATE_MUST_CHANGE_PASSWORD", payload: !!data.mustChangePassword });
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
    // 아이디/비밀번호 검증은 서버(API Route, firebase-admin)에서 수행 — 성공하면 Custom Token 발급
    const customToken = await requestCustomToken(username, password);
    const cred = await signInWithCustomToken(auth, customToken);
    const user = await loadUserSession(cred.user.uid);
    if (!user) throw Object.assign(new Error(), { code: "not_found" });
    dispatch({ type: "LOGIN", payload: user });
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
    await addDoc(collection(db, USERS_COL), newDoc);

    // 가입 직후 자동 로그인 — 방금 저장한 자격 증명으로 동일한 서버 검증 경로를 그대로 태움
    try {
      const customToken = await requestCustomToken(username, password);
      const cred = await signInWithCustomToken(auth, customToken);
      const user = await loadUserSession(cred.user.uid);
      if (user) dispatch({ type: "LOGIN", payload: user });
    } catch {
      // 계정 생성 자체는 성공했으므로, 자동 로그인만 실패해도 회원가입은 성공으로 처리(로그인 페이지에서 다시 로그인하면 됨)
    }
    return { ok: true };
  }

  async function logout(): Promise<void> {
    await firebaseSignOut(auth);
  }

  async function deleteAccount(password: string): Promise<{ ok: boolean; error?: string }> {
    if (!state.currentUser) return { ok: false, error: "로그인 상태가 아닙니다." };
    const res = await fetch("/api/auth/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: state.currentUser.username, password }),
    });
    const result = (await res.json()) as { ok: boolean; error?: string };
    if (!result.ok) return result;
    await firebaseSignOut(auth);
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

  // 휴가 승인 시 잔여 연차 차감. 부여받은 연차가 있으면 오래된 것부터 우선 소비.
  async function applyLeaveDeduction(requestId: string, userId: string, days: number) {
    const plan = planGrantConsumption(state.leaveGrants, userId, days);
    await Promise.all(
      plan.map((p) => updateDoc(doc(db, GRANTS_COL, p.grantId), { remainingDays: increment(-p.days) }))
    );
    await updateDoc(doc(db, USERS_COL, userId), { leaveBalance: increment(-days) });
    if (plan.length > 0) {
      await updateDoc(doc(db, REQUESTS_COL, requestId), { grantDeductions: plan });
    }
  }

  // 승인 취소/삭제 시 차감을 정확히 되돌림 (부여 연차에서 가져갔던 만큼 그대로 복원)
  async function reverseLeaveDeduction(req: LeaveRequest) {
    await updateDoc(doc(db, USERS_COL, req.userId), { leaveBalance: increment(req.days) });
    if (req.grantDeductions && req.grantDeductions.length > 0) {
      await Promise.all(
        req.grantDeductions.map((gd) => updateDoc(doc(db, GRANTS_COL, gd.grantId), { remainingDays: increment(gd.days) }))
      );
    }
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
        await applyLeaveDeduction(docRef.id, state.currentUser!.id, req.days);
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
      remainingDays: days, // 양수 부여만 의미 있음(만료·우선소비 추적용)
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
        await applyLeaveDeduction(id, req.userId, req.days);
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
      await reverseLeaveDeduction(req);
    }
    await deleteDoc(doc(db, REQUESTS_COL, id));
  }

  async function updateSignature(imageDataUrl: string | null) {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    await updateDoc(doc(db, USERS_COL, userId), { signatureImage: imageDataUrl ?? deleteField() });
    dispatch({ type: "UPDATE_USER_SIGNATURE", payload: imageDataUrl ?? undefined });
  }

  // 관리자가 직원을 퇴사 처리함. 데이터(연차 신청/부여 이력)는 삭제하지 않고 resignationDate만
  // 세팅 — 재직 여부만 이 필드로 구분하는 소프트 삭제 방식. 퇴사 중엔 로그인도 막힘(서버에서 체크).
  // 퇴사와 동시에 이름은 비가역 부분 마스킹("문선웅" -> "문*웅"), 서명 이미지/FCM 토큰은 더 이상
  // 필요 없는 민감 정보라 완전히 제거. resignationDate가 3년 지나면 별도 배치(cron)가 전체 삭제함.
  async function setResignation(userId: string, date: string | null) {
    if (!date) {
      await updateDoc(doc(db, USERS_COL, userId), { resignationDate: deleteField() });
      return;
    }
    const snap = await getDoc(doc(db, USERS_COL, userId));
    const currentName = snap.exists() ? (snap.data().name as string | undefined) : undefined;
    await updateDoc(doc(db, USERS_COL, userId), {
      resignationDate: date,
      ...(currentName ? { name: maskName(currentName) } : {}),
      signatureImage: deleteField(),
      fcmToken: deleteField(),
    });
  }

  // 복직 처리 = 완전히 새로 입사하는 것으로 취급: resignationDate 해제 + 입사일 새로 세팅
  // (이 시점에 3년 파기 타이머도 함께 초기화됨 — 파기 배치는 resignationDate 존재 여부로만 판단하므로)
  // + 연차를 새 입사일 기준 초기값으로 리셋(근속연수 이어받지 않음, 과거 신청/부여 기록은 그대로 보존)
  // + 퇴사 시 이름이 마스킹되어 원본을 복원할 수 없으므로, 관리자가 재입력한 실명으로 교체
  // + 오래 안 써서 비밀번호를 잊었을 가능성이 높으니 기본값("1234")으로 초기화, 로그인 후 설정에서 변경하면 됨.
  async function reinstateEmployee(userId: string, newJoinDate: string, newName: string) {
    const initialBalance = calcTotalLeave(newJoinDate);
    const defaultPasswordHash = await hashPassword("1234");
    const name = newName.trim();
    await updateDoc(doc(db, USERS_COL, userId), {
      resignationDate: deleteField(),
      joinDate: newJoinDate,
      name,
      initials: makeInitials(name),
      totalLeave: initialBalance,
      leaveBalance: initialBalance,
      annualLeaveYearGenerated: deleteField(),
      password: defaultPasswordHash,
      mustChangePassword: true,
    });
  }

  function showNotification(message: string, type: "success" | "error" = "success") {
    dispatch({ type: "SET_NOTIFICATION", payload: { message, type } });
  }

  async function markNotificationsRead() {
    const unread = state.appNotifications.filter((n) => !n.read);
    await Promise.all(unread.map((n) => updateDoc(doc(db, NOTIF_COL, n.id), { read: true })));
  }

  // 사용된 연차 합산 (표시용) — 병가/예비군 제외, 정규분은 현재 연차 연도만 집계하되
  // 부여(grant) 소진분은 grant 자체의 remainingDays로 판단 (연차 연도 경계와 무관하게 정확)
  const usedLeave = state.currentUser
    ? calcUsedLeave(state.leaveRequests, state.leaveGrants, state.currentUser.id, currentLeaveYearStart(state.currentUser.joinDate ?? ""))
    : 0;

  // "총 연차"/"잔여" 산술용 — 만료 안 된 부여의 액면가 합계(사용 여부 무관, 이중차감 방지)
  const grantedDays = state.currentUser
    ? grantCeilingTotal(state.leaveGrants, state.currentUser.id)
    : 0;

  // "+N일 부여" 뱃지 전용 — 완전히 소진되거나 만료되기 전까지만 표시(산술에는 쓰지 않음)
  const unusedGrantDays = state.currentUser
    ? activeGrantBalance(state.leaveGrants, state.currentUser.id)
    : 0;

  const unreadCount = state.appNotifications.filter((n) => !n.read).length;

  return (
    <StoreContext.Provider value={{ state, hydrated, usedLeave, grantedDays, unusedGrantDays, unreadCount, login, signup, logout, deleteAccount, addLeave, updateLeaveRequest, addGrant, updateLeaveStatus, deleteLeave, updateSignature, setResignation, reinstateEmployee, showNotification, markNotificationsRead }}>
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
