import type { LeaveRequest } from "./types";
import { db } from "./firebase";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { getLeaveTypeLabel } from "./leaveCalc";

interface ApplicantInfo {
  signatureImage?: string;
  joinDate?: string;
}

async function getApplicantInfo(req: LeaveRequest): Promise<ApplicantInfo> {
  if (!req.userId) return {};
  const snap = await getDoc(doc(db, "leave_portal_users", req.userId));
  if (!snap.exists()) return {};
  const data = snap.data();
  return {
    signatureImage: data.signatureImage as string | undefined,
    joinDate: data.joinDate as string | undefined,
  };
}

async function getReviewerSignature(req: LeaveRequest): Promise<string | undefined> {
  if (req.status !== "approved") return undefined;
  if (req.reviewedById) {
    const snap = await getDoc(doc(db, "leave_portal_users", req.reviewedById));
    return snap.exists() ? (snap.data().signatureImage as string | undefined) : undefined;
  }
  // 구버전 데이터 호환: reviewedById가 없으면 이름으로 매니저 조회
  if (!req.reviewedBy) return undefined;
  const name = req.reviewedBy.replace(/\s*\(자동승인\)$/, "");
  const snap = await getDocs(
    query(collection(db, "leave_portal_users"), where("name", "==", name), where("isManager", "==", true))
  );
  return snap.empty ? undefined : (snap.docs[0].data().signatureImage as string | undefined);
}

function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

function fmtISODate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function chk(checked: boolean): string {
  return checked ? "(●)" : "( )";
}

function buildFormHTML(req: LeaveRequest, applicantJoinDate?: string, applicantSignature?: string, reviewerSignature?: string): string {
  // 연차/월차는 신청 당시(startDate) 기준 근속 개월수로 판정 — 신청서 자체엔 "annual" 하나로만 저장되기 때문
  const isAnnualCategory = req.type === "annual" || req.type === "monthly";
  const leaveTypeAtRequest = applicantJoinDate ? getLeaveTypeLabel(applicantJoinDate, new Date(req.startDate)) : "연차";
  const isAnnual = isAnnualCategory && leaveTypeAtRequest === "연차";
  const isMonthly = isAnnualCategory && leaveTypeAtRequest === "월차";
  const isHalf = req.type === "half-am" || req.type === "half-pm";
  const halfLabel = req.type === "half-am" ? "오전 반차" : req.type === "half-pm" ? "오후 반차" : "반차";
  const isReservist = req.type === "reservist";
  const isSick = req.type === "sick";
  const isOther = req.type === "other";

  const isCompleted = req.deadlineStatus === "completed";
  const isOnTrack = req.deadlineStatus === "on_track";
  const isDelayed = req.deadlineStatus === "delayed";

  const checkResearch = req.checkResearchNote ?? false;
  const checkGantt = req.checkGanttChart ?? false;
  const checkStakeholder = req.checkStakeholder ?? false;

  const LBL = `border:1px solid #888; background:#eeeeee; padding:12px 14px; text-align:center; font-weight:bold; width:140px; vertical-align:middle; font-size:13px; letter-spacing:1px; line-height:1.4;`;
  const VAL = `border:1px solid #888; padding:12px 16px; vertical-align:middle; font-size:13px; line-height:1.6;`;
  const SEC = `border:1px solid #888; background:#d8d8d8; padding:10px 16px; font-weight:bold; font-size:13px; letter-spacing:1px; text-align:left; vertical-align:middle;`;

  return `
    <div style="
      font-family: 'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif;
      width: 794px;
      min-height: 1123px;
      background: white;
      color: #000;
      padding: 64px 72px;
      box-sizing: border-box;
      position: relative;
      line-height: 1.6;
    ">
      <!-- Corner brackets -->
      <div style="position:absolute;top:24px;left:24px;width:14px;height:14px;border-top:2px solid #000;border-left:2px solid #000;"></div>
      <div style="position:absolute;top:24px;right:24px;width:14px;height:14px;border-top:2px solid #000;border-right:2px solid #000;"></div>
      <div style="position:absolute;bottom:24px;left:24px;width:14px;height:14px;border-bottom:2px solid #000;border-left:2px solid #000;"></div>
      <div style="position:absolute;bottom:24px;right:24px;width:14px;height:14px;border-bottom:2px solid #000;border-right:2px solid #000;"></div>

      <!-- 제목 + 결재란 -->
      <div style="display:flex; align-items:center; margin-bottom:28px;">
        <!-- 좌측 스페이서 (결재란 너비와 동일하게 맞춰 제목을 정중앙으로) -->
        <div style="width:178px; flex-shrink:0;"></div>

        <!-- 제목 (정중앙) -->
        <div style="flex:1; text-align:center;">
          <h1 style="
            font-size:22px;
            font-weight:bold;
            margin:0;
            letter-spacing:5px;
            text-decoration:underline;
            text-underline-offset:7px;
            line-height:1;
          ">휴 가 &nbsp; 신 청 서</h1>
        </div>

        <!-- 결재란 -->
        <div style="width:178px; flex-shrink:0; display:flex; justify-content:flex-end;">
          <table style="border-collapse:collapse; font-size:12px;">
            <tr>
              <td rowspan="2" style="border:1px solid #555; text-align:center; vertical-align:middle; padding:0 7px; font-weight:bold; writing-mode:vertical-lr; letter-spacing:4px; background:#e2e2e2; font-size:12px;">결재</td>
              <th style="border:1px solid #555; background:#e2e2e2; text-align:center; padding:6px 0; width:74px; font-weight:bold; letter-spacing:3px; vertical-align:middle;">팀 장</th>
              <th style="border:1px solid #555; background:#e2e2e2; text-align:center; padding:6px 0; width:74px; font-weight:bold; letter-spacing:3px; vertical-align:middle;">이 사</th>
            </tr>
            <tr>
              <td style="border:1px solid #555; height:64px; width:74px; text-align:center; vertical-align:middle;">
                ${reviewerSignature ? `<img src="${reviewerSignature}" style="max-height:56px; max-width:64px; object-fit:contain;" />` : ""}
              </td>
              <td style="border:1px solid #555; height:64px; width:74px;"></td>
            </tr>
          </table>
        </div>
      </div>

      <!-- 본문 표 -->
      <table style="width:100%; border-collapse:collapse;">
        <tbody>

          <!-- 기본 정보 -->
          <tr>
            <th colspan="2" style="${SEC}">기본 정보</th>
          </tr>

          <tr>
            <th style="${LBL}">신 &nbsp; 청 &nbsp; 인</th>
            <td style="${VAL}">${req.userName}</td>
          </tr>

          <tr>
            <th style="${LBL}">휴가 종류</th>
            <td style="${VAL}">
              ${chk(isAnnual)} 연차 &nbsp;&nbsp;
              ${chk(isMonthly)} 월차 &nbsp;&nbsp;
              ${chk(isHalf)} ${halfLabel} &nbsp;&nbsp;
              ${chk(isReservist)} 예비군 &nbsp;&nbsp;
              ${chk(isSick)} 병가 &nbsp;&nbsp;
              ${chk(isOther)} 기타
            </td>
          </tr>

          <tr>
            <th style="${LBL}">휴가 기간</th>
            <td style="${VAL}">
              ${fmtDate(req.startDate)} &nbsp;~&nbsp; ${fmtDate(req.endDate)}
              &nbsp;&nbsp;<span style="color:#555;">(총 ${req.days}일간)</span>
            </td>
          </tr>

          <!-- 업무 진척도 -->
          <tr>
            <th colspan="2" style="${SEC}; border-top:2px solid #777;">업무 진척도 및 인수인계</th>
          </tr>

          <tr>
            <th style="${LBL}">담당 프로젝트</th>
            <td style="${VAL}">${req.projectName ?? ""}</td>
          </tr>

          <tr>
            <th style="${LBL}">현재 진행률</th>
            <td style="${VAL}">${req.progress ?? ""}%&nbsp;<span style="color:#666; font-size:12px;">(간트차트 기준)</span></td>
          </tr>

          <tr>
            <th style="${LBL}">마감 기한<br>준수 여부</th>
            <td style="${VAL}">
              ${chk(isCompleted)} 완료 &nbsp;&nbsp;
              ${chk(isOnTrack)} 진행 중(기한 내 가능) &nbsp;&nbsp;
              ${chk(isDelayed)} 지연 중
            </td>
          </tr>

          <tr>
            <th style="${LBL}">인수인계 사항</th>
            <td style="${VAL}; min-height:60px;">${(req.handoverNotes ?? "").replace(/\n/g, "<br>") || "&nbsp;"}</td>
          </tr>

          <tr>
            <th style="${LBL}">비상 연락망</th>
            <td style="${VAL}">${req.emergencyContact ?? ""}</td>
          </tr>

          <!-- 확인 사항 -->
          <tr>
            <th colspan="2" style="${SEC}; border-top:2px solid #777;">신청인 확인 사항</th>
          </tr>

          <tr>
            <td colspan="2" style="${VAL}; color:#000; line-height:2.3;">
              ${chk(checkResearch)}&nbsp; 연구노트 최신화 완료<br>
              ${chk(checkGantt)}&nbsp; 간트차트 일정 업데이트 완료<br>
              ${chk(checkStakeholder)}&nbsp; 관련 부서/담당자 사전 공유 완료
            </td>
          </tr>

        </tbody>
      </table>

      <!-- 마무리 문구 -->
      <p style="margin:28px 0 0 0; font-size:13px; text-align:center; line-height:1.8;">
        위와 같이 휴가를 신청하며, 부재 중 업무 공백이 발생하지 않도록 조치하겠습니다.
      </p>

      <!-- 서명 -->
      <div style="text-align:right; margin-top:52px; font-size:13px; line-height:2.6;">
        <p style="margin:0;">신청일: ${fmtISODate(req.createdAt)}</p>
        <p style="margin:0;">신청인: ${req.userName}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="position:relative; display:inline-block; width:48px; height:48px; vertical-align:middle;">
          <span style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center;">(인)</span>
          ${applicantSignature ? `<img src="${applicantSignature}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:contain; pointer-events:none;" />` : ""}
        </span></p>
      </div>
    </div>
  `;
}

export async function generateLeavePDF(req: LeaveRequest): Promise<void> {
  const [{ default: jsPDF }, { default: html2canvas }, applicantInfo, reviewerSignature] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
    getApplicantInfo(req),
    getReviewerSignature(req),
  ]);

  const wrapper = document.createElement("div");
  wrapper.style.position = "absolute";
  wrapper.style.left = "-9999px";
  wrapper.style.top = "0";
  wrapper.innerHTML = buildFormHTML(req, applicantInfo.joinDate, applicantInfo.signatureImage, reviewerSignature);
  document.body.appendChild(wrapper);

  try {
    const el = wrapper.firstElementChild as HTMLElement;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const ratio = canvas.width / canvas.height;
    const imgH = pw / ratio;

    if (imgH <= ph) {
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, imgH);
    } else {
      const imgW = ph * ratio;
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pw - imgW) / 2, 0, imgW, ph);
    }

    pdf.save(`휴가신청서_${req.userName}_${req.startDate}.pdf`);
  } finally {
    document.body.removeChild(wrapper);
  }
}
