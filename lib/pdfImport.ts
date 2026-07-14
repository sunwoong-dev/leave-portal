import type { DeadlineStatus, LeaveType } from "./types";

export interface ParsedLeaveData {
  userName?: string;
  startDate?: string;
  endDate?: string;
  type?: LeaveType;
  days?: number;
  reason?: string;
  projectName?: string;
  progress?: number;
  deadlineStatus?: DeadlineStatus;
  handoverNotes?: string;
  emergencyContact?: string;
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str ?? "" : "")).join(" "));
  }

  return pages.join("\n");
}

export async function parseLeavePDF(text: string): Promise<ParsedLeaveData> {
  const result: ParsedLeaveData = {};

  // 신청인
  const nameMatch = text.match(/신청인[:\s]+([가-힣]{2,5})/);
  if (nameMatch) result.userName = nameMatch[1];

  // 날짜 (YYYY-MM-DD 또는 YYYY.MM.DD)
  const dates = [...text.matchAll(/(\d{4}[-./]\d{2}[-./]\d{2})/g)].map((m) =>
    m[1].replace(/[./]/g, "-")
  );
  if (dates.length >= 1) result.startDate = dates[0];
  if (dates.length >= 2) result.endDate = dates[1];

  // 휴가 종류
  if (/반차|오전.*반차|AM/i.test(text)) result.type = "half-am";
  else if (/오후.*반차|PM/i.test(text)) result.type = "half-pm";
  else if (/월차/i.test(text)) result.type = "monthly";
  else if (/연차/i.test(text)) result.type = "annual";

  // 일수
  const daysMatch = text.match(/(\d+(?:\.\d+)?)\s*일/);
  if (daysMatch) result.days = parseFloat(daysMatch[1]);

  // 사유
  const reasonMatch = text.match(/사유[:\s]+([\s\S]+?)(?:\n|프로젝트|담당자)/);
  if (reasonMatch) result.reason = reasonMatch[1].trim().slice(0, 100);

  // 프로젝트명
  const projectMatch = text.match(/프로젝트[명:\s]+([\s\S]+?)(?:\n|진행)/);
  if (projectMatch) result.projectName = projectMatch[1].trim().slice(0, 50);

  // 진행률
  const progressMatch = text.match(/진행률?[:\s]+(\d+)/);
  if (progressMatch) result.progress = parseInt(progressMatch[1]);

  // 비상연락망
  const phoneMatch = text.match(/(\d{3}[-\s]?\d{3,4}[-\s]?\d{4})/);
  if (phoneMatch) result.emergencyContact = phoneMatch[1].replace(/\s/g, "-");

  return result;
}
