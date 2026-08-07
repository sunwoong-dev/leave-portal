"use client";

export default function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle ml-1">
      <span
        className="w-4 h-4 rounded-full bg-outline-variant text-white text-[10px] font-bold flex items-center justify-center cursor-help select-none hover:bg-primary transition-colors"
        aria-label="계산 방식 설명"
      >
        ?
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute z-50 hidden group-hover:block top-full left-0 mt-2 w-72 max-w-[min(18rem,90vw)] p-3 rounded-lg bg-gray-900 text-white text-[11px] leading-relaxed shadow-xl whitespace-pre-line break-keep text-left font-normal"
      >
        <span className="absolute bottom-full left-2 border-4 border-transparent border-b-gray-900" />
        {text}
      </span>
    </span>
  );
}
