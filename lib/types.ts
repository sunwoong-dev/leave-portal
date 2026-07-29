export type LeaveType = "annual" | "monthly" | "half-am" | "half-pm" | "other" | "reservist" | "sick";
export type LeaveStatus = "pending" | "approved" | "rejected";
export type DeadlineStatus = "completed" | "on_track" | "delayed";

export interface User {
  id: string;
  username: string;
  name: string;
  joinDate: string;
  totalLeave: number;    // joinDate 기준 기본 연차 (표시용)
  leaveBalance: number;  // 실제 잔여 연차 — Firestore에 저장, 승인/부여/차감 시 즉시 갱신
  isManager: boolean;
  initials: string;
  fcmToken?: string;
  signatureImage?: string; // base64 데이터 URL — 등록 시 PDF 서명란에 자동 삽입
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: "new_request" | "approved" | "rejected";
  requestId?: string;
  read: boolean;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  userName: string;
  department: string;
  role: string;
  initials: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  // 업무 인수인계
  projectName?: string;
  progress?: number;
  deadlineStatus?: DeadlineStatus;
  handoverNotes?: string;
  emergencyContact?: string;
  // 확인 사항
  checkResearchNote?: boolean;
  checkGanttChart?: boolean;
  checkStakeholder?: boolean;
  // 검토
  reviewedBy?: string;
  reviewedById?: string;
  reviewedAt?: string;
  reviewNote?: string;
  // 이 신청 승인 시 부여 연차(LeaveGrant)에서 차감된 내역 (취소 시 정확히 복원하기 위함)
  grantDeductions?: { grantId: string; days: number }[];
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "연차",
  monthly: "월차",
  "half-am": "오전 반차",
  "half-pm": "오후 반차",
  other: "기타",
  reservist: "예비군",
  sick: "병가",
};

export const DEADLINE_STATUS_LABELS: Record<DeadlineStatus, string> = {
  completed: "완료",
  on_track: "진행 중",
  delayed: "지연 중",
};

export const STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "검토중",
  approved: "승인됨",
  rejected: "반려됨",
};

export interface NotificationLog {
  id: string;
  toUserId: string;
  type: string;
  requestId?: string;
  title: string;
  body: string;
  hadToken: boolean;       // 수신자에게 FCM 토큰이 있었는지
  sendSuccess: boolean;    // 서버 -> FCM 발송 API 호출 성공 여부
  sendError?: string;
  serverLatencyMs?: number; // FCM 발송 API 호출에 걸린 시간
  sentAt: string;
  receivedAt?: string;      // 클라이언트가 실제로 수신한 시각 (수신 확인된 경우만 존재)
  receivedVia?: "foreground" | "background";
  deliveryLatencyMs?: number; // receivedAt - sentAt
}

export interface LeaveGrant {
  id: string;
  userId: string;
  userName: string;
  days: number;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  // 양수 부여(추가 지급)의 잔여 미사용분. 없으면 days와 동일(레거시 데이터 기본값).
  // 소진되거나 만료되면 0으로 줄어듦. 음수(차감) 기록에는 의미 없음.
  remainingDays?: number;
}
