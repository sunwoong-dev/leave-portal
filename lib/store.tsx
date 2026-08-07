"use client";

import React, { createContext, useContext, useEffect, useReducer, useState } from "react";
import { User, LeaveRequest, LeaveGrant, AppNotification } from "./types";
import { db, auth } from "./firebase";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, deleteField,
  onSnapshot, getDocs, getDoc, query, where, increment,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithCustomToken, signOut as firebaseSignOut } from "firebase/auth";
import { calcTotalLeave, currentLeaveYearStart, getCompletedMonths } from "./leaveCalc";
import { grantRemainingTotal, planGrantConsumption, calcUsedLeave, calcRemainingLeave, simulateBaseConsumption } from "./grantLedger";
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

/**
 * leaveBalance를 처음부터 다시 계산해서 SET(증분 아님). 부여/신청 이력을 매번 새로 읽어
 * "부여 > 월차 > 연차" 우선순위로 소진분을 배분하므로, 월차 소멸·회계연도 갱신·부여 만료 등
 * 어떤 전환 시점이든 항상 정확하다 — 증분(increment) 방식과 달리 이중 차감/이중 소멸이 없다.
 * 로그인, 휴가 승인/삭제/취소, 부여 지급 등 잔액에 영향을 주는 모든 시점에 호출한다.
 */
async function recomputeLeaveBalance(userId: string, joinDate: string): Promise<number> {
  if (!joinDate) {
    const snap = await getDoc(doc(db, USERS_COL, userId));
    return (snap.data()?.leaveBalance as number | undefined) ?? 15;
  }
  const [grantsSnap, requestsSnap] = await Promise.all([
    getDocs(query(collection(db, GRANTS_COL), where("userId", "==", userId))),
    getDocs(query(collection(db, REQUESTS_COL), where("userId", "==", userId))),
  ]);
  const grants = grantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveGrant[];
  const requests = requestsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as LeaveRequest[];
  const totalLeave = calcTotalLeave(joinDate);
  const balance = calcRemainingLeave(requests, grants, userId, joinDate);
  await updateDoc(doc(db, USERS_COL, userId), { totalLeave, leaveBalance: balance });
  return balance;
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
  const user = buildUser(uid, data);
  const leaveBalance = await recomputeLeaveBalance(uid, user.joinDate ?? "");
  return { ...user, leaveBalance };
}

async function fetchJoinDate(userId: string): Promise<string> {
  const snap = await getDoc(doc(db, USERS_COL, userId));
  return (snap.data()?.joinDate as string | undefined) ?? "";
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

  // 휴가 승인 시 우선순위(월차 > 부여 > 연차)대로 소비. 월차는 소멸일(입사 1년 후)이 부여
  // 소멸일(부여일+1년, 입사일 이후 시점이라 항상 더 늦음)보다 항상 먼저라 월차부터 태우는 게
  // 손해가 없다 — 이 신청 시점에 아직 감당 가능한 월차가 있으면 그만큼은 부여를 건드리지 않고,
  // 월차로 못 채우는 나머지만 부여 소비 계획을 세운다. 최종 잔액 반영은 재계산에 맡긴다.
  async function applyLeaveDeduction(requestId: string, userId: string, days: number, startDate: string) {
    const joinDate = await fetchJoinDate(userId);
    const priorRequests = state.leaveRequests.filter((r) => r.userId === userId && r.startDate < startDate);
    const { monthlyUsed } = simulateBaseConsumption(priorRequests, userId, joinDate, "");
    const tenureMonths = getCompletedMonths(joinDate, new Date(startDate));
    const monthlyCap = tenureMonths < 12 ? Math.min(tenureMonths, 11) : 0;
    const monthlyAvailable = Math.max(0, monthlyCap - monthlyUsed);
    const daysForGrant = Math.max(0, days - monthlyAvailable);

    const plan = planGrantConsumption(state.leaveGrants, userId, daysForGrant);
    await Promise.all(
      plan.map((p) => updateDoc(doc(db, GRANTS_COL, p.grantId), { remainingDays: increment(-p.days) }))
    );
    if (plan.length > 0) {
      await updateDoc(doc(db, REQUESTS_COL, requestId), { grantDeductions: plan });
    }
    await recomputeLeaveBalance(userId, joinDate);
  }

  // 승인 취소/삭제 시 차감을 정확히 되돌림. 요청 문서가 이미 삭제/반려된 뒤에 호출해야
  // 재계산이 해당 신청을 다시 세지 않는다(deleteLeave가 순서를 보장).
  async function reverseLeaveDeduction(req: LeaveRequest) {
    if (req.grantDeductions && req.grantDeductions.length > 0) {
      await Promise.all(
        req.grantDeductions.map((gd) => updateDoc(doc(db, GRANTS_COL, gd.grantId), { remainingDays: increment(gd.days) }))
      );
    }
    await recomputeLeaveBalance(req.userId, await fetchJoinDate(req.userId));
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
        await applyLeaveDeduction(docRef.id, state.currentUser!.id, req.days, req.startDate);
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
    await recomputeLeaveBalance(userId, await fetchJoinDate(userId));
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
        await applyLeaveDeduction(id, req.userId, req.days, req.startDate);
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
    // 문서를 먼저 지운 뒤에 재계산해야 삭제된 신청이 다시 집계되지 않는다.
    const req = state.leaveRequests.find((r) => r.id === id);
    await deleteDoc(doc(db, REQUESTS_COL, id));
    if (req?.status === "approved" && req.userId && !NO_DEDUCTION_TYPES.includes(req.type)) {
      await reverseLeaveDeduction(req);
    }
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

  // 사용된 연차 합산 (표시용) — 병가/예비군 제외, 월차/연차만 집계 (부여는 다 쓰면 총에서도
  // 같이 사라지는 취급이라 사용량에 남기지 않음 — grantedDays가 그 잔여를 직접 반영)
  const usedLeave = state.currentUser
    ? calcUsedLeave(
        state.leaveRequests, state.currentUser.id,
        state.currentUser.joinDate ?? "", currentLeaveYearStart(state.currentUser.joinDate ?? ""),
      )
    : 0;

  // "총 연차"/"잔여"/"+N일 부여" 뱃지 공통 — 만료 안 된 부여의 "지금 남은" 일수 합계.
  // 다 쓴 부여는 0으로 떨어져 총/뱃지 어디에도 안 보인다(월차 소멸과 동일한 취급).
  const grantedDays = state.currentUser
    ? grantRemainingTotal(state.leaveGrants, state.currentUser.id)
    : 0;

  const unreadCount = state.appNotifications.filter((n) => !n.read).length;

  return (
    <StoreContext.Provider value={{ state, hydrated, usedLeave, grantedDays, unreadCount, login, signup, logout, deleteAccount, addLeave, updateLeaveRequest, addGrant, updateLeaveStatus, deleteLeave, updateSignature, setResignation, reinstateEmployee, showNotification, markNotificationsRead }}>
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
