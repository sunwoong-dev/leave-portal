// 더미 데이터 제거됨 — 실제 데이터는 Firebase에서 관리

export const MONTHLY_STATS = [
  { month: "1월", current: 0, previous: 0 },
  { month: "2월", current: 0, previous: 0 },
  { month: "3월", current: 0, previous: 0 },
  { month: "4월", current: 0, previous: 0 },
  { month: "5월", current: 0, previous: 0 },
  { month: "6월", current: 0, previous: 0 },
  { month: "7월", current: 0, previous: 0 },
  { month: "8월", current: 0, previous: 0 },
  { month: "9월", current: 0, previous: 0 },
  { month: "10월", current: 0, previous: 0 },
  { month: "11월", current: 0, previous: 0 },
  { month: "12월", current: 0, previous: 0 },
];

export const DEPT_STATS: { name: string; percent: number; color: string }[] = [];

// 추석은 음력 기준이라 매년 양력 날짜가 다름 — 연도별 룩업
const CHUSEOK: Record<number, [string, string]> = {
  2024: ["SEP", "17"],
  2025: ["OCT", "06"],
  2026: ["SEP", "25"],
  2027: ["OCT", "15"],
  2028: ["OCT", "03"],
  2029: ["SEP", "22"],
  2030: ["SEP", "12"],
};

const [chuseokMonth, chuseokDay] = CHUSEOK[new Date().getFullYear()] ?? ["SEP", "17"];

export const HOLIDAYS = [
  { month: "JUN", day: "06", name: "현충일", en: "Memorial Day" },
  { month: "AUG", day: "15", name: "광복절", en: "National Liberation Day" },
  { month: chuseokMonth, day: chuseokDay, name: "추석", en: "Chuseok Holiday" },
  { month: "OCT", day: "03", name: "개천절", en: "National Foundation Day" },
  { month: "DEC", day: "25", name: "크리스마스", en: "Christmas" },
];
