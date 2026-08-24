// 공공데이터포털 "한국천문연구원_특일 정보" API 클라이언트 (서버 전용 — HOLIDAY_API_SERVICE_KEY 사용).
// 설/추석처럼 음력 기반이라 하드코딩 목록(lib/holidays.ts)으로는 유지보수가 안 되는 공휴일을
// 천문학적 계산으로 받아온다. 정부가 아직 발표 안 한 먼 미래 연도는 totalCount 0으로 응답한다.
const API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo";

// 근로자의 날(노동절)은 관공서 공휴일이 아니라 근로기준법상 유급휴일이라 이 앱이 지금까지
// "출근일"로 다뤄왔음 — 하드코딩 목록에도 없었으므로 API 연동 후에도 동일하게 취급하기 위해 제외.
const EXCLUDE_NAMES = new Set(["노동절"]);

interface HolidayApiItem {
  locdate: number;
  dateName: string;
  isHoliday: "Y" | "N";
}

function toDateStr(locdate: number): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** 지정 연도의 공휴일을 { "YYYY-MM-DD": "이름" } 형태로 반환. 미공개 연도는 빈 객체. */
export async function fetchHolidaysForYear(year: number): Promise<Record<string, string>> {
  const key = process.env.HOLIDAY_API_SERVICE_KEY;
  if (!key) throw new Error("HOLIDAY_API_SERVICE_KEY 환경변수가 설정되어 있지 않습니다.");

  // serviceKey는 data.go.kr이 발급한 시점에 이미 URL 인코딩되어 있으므로(Encoding 키) 재인코딩하지
  // 않도록 URLSearchParams 밖에서 직접 붙인다 — 재인코딩하면 %2B 등이 다시 인코딩돼 키가 깨진다.
  const params = new URLSearchParams({ solYear: String(year), numOfRows: "100", pageNo: "1", _type: "json" });
  const url = `${API_URL}?serviceKey=${key}&${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`공휴일 API 호출 실패 (${year}년): HTTP ${res.status}`);

  const json = await res.json();
  const header = json?.response?.header;
  if (header?.resultCode !== "00") {
    throw new Error(`공휴일 API 오류 (${year}년): ${header?.resultMsg ?? "알 수 없는 오류"}`);
  }

  const rawItems = json?.response?.body?.items;
  const items: HolidayApiItem[] = !rawItems || rawItems === ""
    ? []
    : Array.isArray(rawItems.item)
      ? rawItems.item
      : rawItems.item
        ? [rawItems.item]
        : [];

  const holidays: Record<string, string> = {};
  for (const item of items) {
    if (item.isHoliday !== "Y") continue;
    if (EXCLUDE_NAMES.has(item.dateName)) continue;
    holidays[toDateStr(item.locdate)] = item.dateName;
  }
  return holidays;
}
