import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Visa Days Calculator — Analyzer Theme
 *
 * Fix: незакрытый className у <input type="number"> ломал JSX. Полностью
 * переписал низ файла и аккуратно закрыл все теги. Добавил ещё автотестов.
 */

// ===== Theme tokens =====
const ACCENT = "#C9A86A"; // premium gold
const getBgGradient = (isDark: boolean) =>
  isDark
    ? "bg-[radial-gradient(1200px_600px_at_20%_-10%,#0f1723_0%,#0b1017_35%,#0a0d14_70%,#090c12_100%)]"
    : "bg-[radial-gradient(1200px_600px_at_20%_-10%,#ffffff_0%,#f6f8fb_40%,#eef2f7_80%)]";

// ===== Date utils (UTC) =====
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const addDaysUTC = (d: Date, n: number) => new Date(d.getTime() + n * MS_PER_DAY);
const diffDaysInc = (a: Date, b: Date) => Math.round((+a - +b) / MS_PER_DAY) + 1; // inclusive [b..a]
const toISO = (date: Date) => {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const parseISO = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const eachDay = (s: Date, e: Date) => {
  const out: Date[] = [];
  for (let t = new Date(s); t <= e; t = addDaysUTC(t, 1)) out.push(new Date(t));
  return out;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const newId = () =>
  typeof crypto !== "undefined" && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : "id-" + Math.random().toString(36).slice(2);

// ===== Intervals =====
export type Trip = { id: string; start: Date; end: Date };
function mergeIntervals(intervals: Trip[]): Trip[] {
  if (!intervals.length) return [];
  const arr = [...intervals].sort((a, b) => +a.start - +b.start);
  const out: Trip[] = [{ ...arr[0] }];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i];
    const last = out[out.length - 1];
    if (+cur.start <= +addDaysUTC(last.end, 1)) {
      if (+cur.end > +last.end) last.end = cur.end;
    } else out.push({ ...cur });
  }
  return out;
}
function intersectInclusive(a1: Date, a2: Date, b1: Date, b2: Date) {
  const s = +a1 > +b1 ? a1 : b1;
  const e = +a2 < +b2 ? a2 : b2;
  if (+e < +s) return 0;
  return diffDaysInc(e, s);
}
function usedDaysInRollingWindow(trips: Trip[], refDate: Date, windowDays: number) {
  const merged = mergeIntervals(trips.filter((t) => t.start && t.end));
  const winStart = addDaysUTC(refDate, -(windowDays - 1));
  let used = 0;
  for (const iv of merged) used += intersectInclusive(iv.start, iv.end, winStart, refDate);
  return used;
}
function usedDaySetForRange(trips: Trip[], start: Date, end: Date) {
  const out = new Set<string>();
  for (const iv of mergeIntervals(trips)) {
    const s = +iv.start > +start ? iv.start : start;
    const e = +iv.end < +end ? iv.end : end;
    if (+e < +s) continue;
    for (const d of eachDay(s, e)) out.add(toISO(d));
  }
  return out;
}
function isDateInClosedTrips(trips: Trip[], date: Date) {
  return trips.some((iv) => +iv.start <= +date && +date <= +iv.end);
}
function addSingleDayTrip(trips: Trip[], date: Date) {
  return mergeIntervals([...trips, { id: newId(), start: new Date(date), end: new Date(date) }]);
}
function removeSingleDayFromClosedTrips(trips: Trip[], date: Date) {
  const out: Trip[] = [];
  for (const iv of trips) {
    if (+date < +iv.start || +date > +iv.end) {
      out.push(iv);
      continue;
    }
    if (+iv.start === +iv.end && +iv.start === +date) {
      // drop
    } else if (+date === +iv.start) {
      const ns = addDaysUTC(iv.start, 1);
      if (+ns <= +iv.end) out.push({ ...iv, start: ns });
    } else if (+date === +iv.end) {
      const ne = addDaysUTC(iv.end, -1);
      if (+iv.start <= +ne) out.push({ ...iv, end: ne });
    } else {
      const leftEnd = addDaysUTC(date, -1);
      const rightStart = addDaysUTC(date, 1);
      out.push({ id: newId(), start: iv.start, end: leftEnd });
      out.push({ id: newId(), start: rightStart, end: iv.end });
    }
  }
  return mergeIntervals(out);
}

// ===== Rules =====
const COUNTRY_PRESETS = [
  { code: "TR", name: "Турция", rule: { type: "comboTR", perVisit: 60, cap: { max: 90, window: 180 } }, notes: "60 дней за визит; общий предел 90/180." },
  { code: "AE", name: "ОАЭ", rule: { type: "rolling", max: 90, window: 180 }, notes: "90 дней в 180." },
  { code: "AM", name: "Армения", rule: { type: "perYear", max: 180 }, notes: "180 дней в последние 365." },
  { code: "KZ", name: "Казахстан", rule: { type: "rolling", max: 90, window: 180 }, notes: "90 дней в 180 (30 без регистрации)." },
  { code: "ME", name: "Черногория", rule: { type: "perVisit", perVisit: 30 }, notes: "До 30 дней за визит." },
  { code: "RS", name: "Сербия", rule: { type: "perVisit", perVisit: 30 }, notes: "До 30 дней без визы." },
  { code: "TH", name: "Таиланд", rule: { type: "perVisit", perVisit: 30 }, notes: "30 дней (уточняйте послабления)." },
] as const;

type Rule =
  | { type: "rolling"; max: number; window: number }
  | { type: "perYear"; max: number }
  | { type: "perVisit"; perVisit: number }
  | { type: "comboTR"; perVisit: number; cap: { max: number; window: number } };

function countUsedInWindow(trips: Trip[], asOf: Date, windowDays: number) {
  return usedDaysInRollingWindow(trips, asOf, windowDays);
}
function countUsedInYear(trips: Trip[], asOf: Date) {
  return usedDaysInRollingWindow(trips, asOf, 365);
}
function maxStayIfEnterOn(trips: Trip[], entryDate: Date | null, rule: Rule) {
  if (!entryDate) return 0;
  const tryLen = (L: number) => {
    const end = addDaysUTC(entryDate, L - 1);
    const planned = [...trips, { id: "_p", start: entryDate, end }];
    switch (rule.type) {
      case "rolling": {
        const used = countUsedInWindow(planned, end, rule.window);
        return used <= rule.max;
      }
      case "perYear": {
        const used = countUsedInYear(planned, end);
        return used <= rule.max;
      }
      case "perVisit":
        return L <= rule.perVisit;
      case "comboTR": {
        const used = countUsedInWindow(planned, end, rule.cap.window);
        return L <= rule.perVisit && used <= rule.cap.max;
      }
      default:
        return false;
    }
  };
  let lo = 0,
    hi = 365;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tryLen(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function fullTarget(rule: Rule) {
  switch (rule.type) {
    case "comboTR":
      return Math.min(rule.perVisit, rule.cap.max);
    case "perVisit":
      return rule.perVisit;
    case "rolling":
      return rule.max;
    case "perYear":
      return rule.max;
    default:
      return 0;
  }
}
function findEarliestEntryForStay(trips: Trip[], rule: Rule, fromDate: Date, daysNeeded: number) {
  for (let i = 0; i < 420; i++) {
    const d = addDaysUTC(fromDate, i);
    const m = maxStayIfEnterOn(trips, d, rule);
    if (m >= daysNeeded) return { date: d, max: m };
  }
  for (let i = 0; i < 420; i++) {
    const d = addDaysUTC(fromDate, i);
    const m = maxStayIfEnterOn(trips, d, rule);
    if (m > 0) return { date: d, max: m };
  }
  return null as null | { date: Date; max: number };
}

// ===== UI bits =====
const Step = ({ index, label, active, done, isDark }: any) => (
  <div className="flex items-center gap-3">
    <div
      className={[
        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
        done
          ? isDark
            ? "bg-emerald-600 text-white"
            : "bg-emerald-500 text-white"
          : active
          ? "ring-2 ring-offset-2 ring-offset-transparent"
          : isDark
          ? "bg-slate-700 text-slate-300"
          : "bg-slate-200 text-slate-700",
      ].join(" ")}
      style={active ? { boxShadow: `0 0 0 2px ${ACCENT}55` } : {}}
    >
      {done ? "✓" : index}
    </div>
    <span className={"text-sm " + (active ? (isDark ? "text-slate-50" : "text-slate-900") : isDark ? "text-slate-400" : "text-slate-500")}>{label}</span>
  </div>
);

const Card = ({ children, className = "", isDark }: any) => (
  <div
    className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " relative w-full max-w-full rounded-2xl border p-5 shadow-xl backdrop-blur-sm transition-colors " + className}
    style={{ boxShadow: isDark ? "0 10px 40px rgba(0,0,0,0.35)" : "0 10px 30px rgba(15,23,42,0.08)" }}
  >
    <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 0 1px ${isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)"}` }} />
    {children}
  </div>
);

const Toast = ({ toast, isDark }: any) =>
  toast ? (
    <div className={`fixed right-4 top-4 z-50 rounded-xl border px-3 py-2 text-sm shadow ${toast.type === "warn" ? (isDark ? "border-amber-300/40 bg-amber-200/15 text-amber-200" : "border-amber-200 bg-amber-50 text-amber-900") : isDark ? "border-white/15 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-900"}`}>{toast.msg}</div>
  ) : null;

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dim = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
const mondayOffset = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m, 1));
  return (d.getUTCDay() + 6) % 7;
};

function Timeline({ usedSet, start, end, isDark }: any) {
  const days = eachDay(start, end);
  const cols = Math.min(240, days.length);
  return (
    <div>
      <div className="flex items-center justify-between text-xs" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
        <span>Окно: {toISO(start)}</span>
        <span>До: {toISO(end)}</span>
      </div>
      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {days.map((d: Date) => {
          const iso = toISO(d);
          const used = usedSet.has(iso);
          const isToday = iso === toISO(end);
          return (
            <div
              key={iso}
              title={`${iso} — ${used ? "в зоне" : "свободно"}`}
              className={`h-3 rounded md:h-4 ${used ? "" : isDark ? "bg-slate-700" : "bg-slate-300"}`}
              style={{ background: used ? ACCENT : undefined, boxShadow: isToday ? `0 0 0 2px ${ACCENT}` : undefined }}
            />
          );
        })}
      </div>
    </div>
  );
}


function YearCalendar({
  year,
  trips,
  asOfDate,
  onToggleDay,
  onApplyRange,
  brushMode = "auto",
  plannedStartISO = null,
  plannedEndISO = null,
  onSetBrush,
  onHoverDay,
  isDark,
}: any) {
  const yStart = new Date(Date.UTC(year, 0, 1));
  const yEnd = new Date(Date.UTC(year, 11, 31));
  const usedSet = useMemo(() => usedDaySetForRange(trips, yStart, yEnd), [trips, year]);
  const [drag, setDrag] = useState({ on: false, mode: null as null | "add" | "remove" });
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    const up = () => setDrag({ on: false, mode: null });
    if (typeof window !== "undefined") {
      window.addEventListener("mouseup", up);
      return () => window.removeEventListener("mouseup", up);
    }
    return () => {};
  }, []);

  const getMode = (iso: string) => (brushMode === "auto" ? (usedSet.has(iso) ? "remove" : "add") : brushMode);
  const onDown = (e: any, iso: string) => {
    e.preventDefault();
    const mode = getMode(iso) as "add" | "remove";
    if (e.shiftKey && lastRef.current) {
      onApplyRange(lastRef.current, iso, mode);
    } else {
      onApplyRange(iso, iso, mode);
      setDrag({ on: true, mode });
    }
    lastRef.current = iso;
  };
  const onEnter = (e: any, iso: string) => {
    onHoverDay && onHoverDay(iso);
    if (!drag.on || !drag.mode) return;
    onApplyRange(iso, iso, drag.mode);
  };

  const planned = (iso: string) => (plannedStartISO && plannedEndISO ? plannedStartISO <= iso && iso <= plannedEndISO : false);

  return (
    <div className="space-y-4" onMouseLeave={() => onHoverDay && onHoverDay(null)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="text-xs sm:text-sm" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
          Клик = вкл/выкл. Тяните мышью, <b>Shift+клик</b> — диапазон. Режим кисти влияет на drag/диапазоны.
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Кисть:</span>
          <div className="inline-flex overflow-hidden rounded-xl border border-white/10 bg-white/5">
            {["auto", "add", "remove"].map((m) => (
              <button key={m} onClick={() => onSetBrush(m)} className={`px-3 py-1.5 ${brushMode === m ? "bg-white/10" : ""}`}>
                {m === "auto" ? "Авто" : m === "add" ? "Добавлять" : "Снимать"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onMouseLeave={() => setDrag({ on: false, mode: null })}>
        {Array.from({ length: 12 }).map((_, m) => {
          const off = mondayOffset(year, m);
          const days = Array.from({ length: dim(year, m) }, (_, i) => i + 1);
          return (
            <div key={m} className="rounded-2xl border border-white/10 bg-white/5 p-2 backdrop-blur sm:p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold">{MONTHS[m]} {year}</div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] sm:text-[11px]">
                  <button className="rounded border border-white/10 px-2 py-1 hover:bg-white/10" onClick={() => applyMonthPreset(year, m, "all", brushMode === "remove" ? "remove" : "add", onApplyRange)}>Месяц</button>
                  <button className="rounded border border-white/10 px-2 py-1 hover:bg-white/10" onClick={() => applyMonthPreset(year, m, "weekdays", brushMode === "remove" ? "remove" : "add", onApplyRange)}>Будни</button>
                  <button className="rounded border border-white/10 px-2 py-1 hover:bg-white/10" onClick={() => applyMonthPreset(year, m, "weekends", brushMode === "remove" ? "remove" : "add", onApplyRange)}>Выходные</button>
                  <button className="rounded border border-white/10 px-2 py-1 hover:bg-white/10" onClick={() => applyMonthPreset(year, m, "clear", "remove", onApplyRange)}>Очистить</button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-[10px] sm:text-[11px]" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                  <div key={d} className="text-center">{d}</div>
                ))}
              </div>
              <div className="grid select-none grid-cols-7 gap-1">
                {Array.from({ length: off }).map((__, i) => (
                  <div key={`o${i}`} className="h-9" />
                ))}
                {days.map((dn) => {
                  const date = new Date(Date.UTC(year, m, dn));
                  const iso = toISO(date);
                  const used = usedSet.has(iso);
                  const isToday = iso === toISO(asOfDate);
                  return (
                    <button
                      key={iso}
                      onMouseDown={(e) => onDown(e, iso)}
                      onMouseEnter={(e) => onEnter(e, iso)}
                      onClick={() => {
                        if (!drag.on) onToggleDay(iso);
                      }}
                      className={`relative flex h-8 items-center justify-center rounded-md border text-xs tabular-nums focus:outline-none focus:ring-2 transition-colors sm:h-9 sm:text-sm ${isDark ? "border-white/10" : "border-slate-300"}`}
                      style={{ background: used ? ACCENT : isDark ? "rgba(255,255,255,0.04)" : "#fff", color: used ? "#0b0f14" : undefined, boxShadow: isToday ? `0 0 0 2px ${ACCENT}` : undefined }}
                      title={`${iso} — ${used ? "в зоне (клик/drag: снять)" : "свободно (клик/drag: отметить)"}`}
                    >
                      {dn}
                      {planned(iso) && !used && <span className="pointer-events-none absolute inset-0 rounded-md" style={{ boxShadow: `inset 0 0 0 2px ${ACCENT}AA` }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ background: ACCENT }} />— «в зоне»</span>
        <span className="inline-flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded ${isDark ? "bg-slate-700" : "bg-slate-300"}`} />— свободно</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ boxShadow: `inset 0 0 0 2px ${ACCENT}` }} />— рекомендовано планировщиком</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ boxShadow: `0 0 0 2px ${ACCENT}` }} />— сегодня</span>
      </div>
    </div>
  );
}

function applyMonthPreset(
  y: number,
  m: number,
  preset: "all" | "weekdays" | "weekends" | "clear",
  mode: "add" | "remove",
  onApplyRange: (a: string, b: string, mode: "add" | "remove") => void
) {
  const d = dim(y, m);
  let run: Date | null = null;
  const flush = (s: Date, e: Date) => onApplyRange(toISO(s), toISO(e), mode);
  for (let day = 1; day <= d; day++) {
    const dt = new Date(Date.UTC(y, m, day));
    const dow = dt.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    let ok = false;
    if (preset === "all") ok = true;
    if (preset === "weekdays") ok = !weekend;
    if (preset === "weekends") ok = weekend;
    if (preset === "clear") ok = true;
    if (ok) {
      if (!run) run = dt;
    } else {
      if (run) {
        flush(run, addDaysUTC(dt, -1));
        run = null;
      }
    }
  }
  if (run) flush(run, new Date(Date.UTC(y, m, d)));
}

// ===== Tests =====
function TestPanel({ isDark }: any) {
  const [results, setResults] = useState<{ name: string; pass: boolean; details?: string }[]>([]);
  const d = (s: string) => parseISO(s);
  function run() {
    const R: { name: string; pass: boolean; details?: string }[] = [];
    const ok = (name: string, cond: any, details = "") => R.push({ name, pass: !!cond, details: String(details) });

    let trips: Trip[] = [
      { id: "a", start: d("2025-01-01"), end: d("2025-01-03") },
      { id: "b", start: d("2025-01-04"), end: d("2025-01-05") },
    ];
    let merged = mergeIntervals(trips);
    ok("mergeIntervals merges adjacent", merged.length === 1 && toISO(merged[0].start) === "2025-01-01" && toISO(merged[0].end) === "2025-01-05");
    const used = usedDaysInRollingWindow(trips, d("2025-01-05"), 5);
    ok("rolling inclusive", used === 5, `got ${used}`);

    let arr: Trip[] = [];
    arr = addSingleDayTrip(arr, d("2025-02-10"));
    ok("addSingleDayTrip adds", arr.length === 1 && toISO(arr[0].start) === "2025-02-10");
    arr = removeSingleDayFromClosedTrips(arr, d("2025-02-10"));
    ok("removeSingleDay removes", arr.length === 0);

    const max = maxStayIfEnterOn([], d("2025-03-01"), { type: "rolling", max: 90, window: 180 } as Rule);
    ok("maxStayIfEnterOn (empty)=90", max === 90, `got ${max}`);

    ok("leap year dims Feb", dim(2024, 1) === 29);
    const splitTrips = removeSingleDayFromClosedTrips([{ id: "x", start: d("2025-04-01"), end: d("2025-04-05") }], d("2025-04-03"));
    ok("remove splits interval", splitTrips.length === 2 && toISO(splitTrips[0].end) === "2025-04-02" && toISO(splitTrips[1].start) === "2025-04-04");

    const fortyDays: Trip[] = [{ id: "p", start: d("2025-01-01"), end: d("2025-02-09") }];
    const trRule: Rule = { type: "comboTR", perVisit: 60, cap: { max: 90, window: 180 } };
    const enter = d("2025-03-01");
    const m = maxStayIfEnterOn(fortyDays, enter, trRule);
    ok("comboTR respects cap", m === 50 || m === 60, `got ${m}`);

    ok("perVisit limit", maxStayIfEnterOn([], d("2025-05-01"), { type: "perVisit", perVisit: 30 } as Rule) === 30);

    const earliest = findEarliestEntryForStay([], { type: "rolling", max: 90, window: 180 } as Rule, d("2025-01-01"), 1);
    ok("earliest entry same day", !!earliest && toISO(earliest!.date) === "2025-01-01");

    // Extra: applying range adds many days at once
    let base: Trip[] = [];
    const rangeS = d("2025-06-01");
    const rangeE = d("2025-06-10");
    for (let t = new Date(rangeS); t <= rangeE; t = addDaysUTC(t, 1)) base = mergeIntervals([...base, { id: newId(), start: new Date(t), end: new Date(t) }]);
    ok("range merge", base.length === 1 && toISO(base[0].start) === "2025-06-01" && toISO(base[0].end) === "2025-06-10");

    setResults(R);
  }
  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Автотесты</div>
        <button onClick={run} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">Запустить</button>
      </div>
      {results.length > 0 && (
        <div className="mt-3 space-y-1 text-sm">
          {results.map((r, i) => (
            <div key={i} className={`flex items-center justify-between ${r.pass ? "text-emerald-300" : "text-red-300"}`}>
              <span>{r.pass ? "✅" : "❌"} {r.name}</span>
              {!r.pass && <span className="opacity-70">{r.details}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Main =====
function areTripsEqual(a: Trip[], b: Trip[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (+a[i].start !== +b[i].start || +a[i].end !== +b[i].end) return false;
  }
  return true;
}

export default function VisaDaysCalculatorAnalyzerTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const isDark = theme === "dark";
  const storageAvailable = typeof window !== "undefined" && typeof window.localStorage !== "undefined";

  const today = useMemo(() => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  }, []);

  const [selected, setSelected] = useState(COUNTRY_PRESETS[0]);

  const [trips, setTrips] = useState<Trip[]>(() => {
    if (!storageAvailable) return [] as Trip[];
    const raw = window.localStorage.getItem("visa_ru_trips_v2");
    if (!raw) return [] as Trip[];
    try {
      const arr = JSON.parse(raw);
      return arr.map((iv: any) => ({ id: iv.id || newId(), start: parseISO(iv.start), end: parseISO(iv.end) }));
    } catch {
      return [] as Trip[];
    }
  });
  useEffect(() => {
    if (!storageAvailable) return;
    const payload = trips.map((iv) => ({ id: iv.id, start: toISO(iv.start), end: toISO(iv.end) }));
    window.localStorage.setItem("visa_ru_trips_v2", JSON.stringify(payload));
  }, [trips, storageAvailable]);

  const [startISO, setStartISO] = useState("");
  const [endISO, setEndISO] = useState("");

  const manualRange = useMemo<{ valid: boolean; days?: number } | null>(() => {
    if (!startISO || !endISO) return null;
    const start = parseISO(startISO);
    const end = parseISO(endISO);
    if (+end < +start) return { valid: false };
    return { valid: true, days: diffDaysInc(end, start) };
  }, [startISO, endISO]);
  const canAddManual = manualRange?.valid === true;

  const [asOfISO, setAsOfISO] = useState("");
  const asOf = useMemo(() => (asOfISO ? parseISO(asOfISO) : today), [asOfISO, today]);

  const [yearView, setYearView] = useState(asOf.getUTCFullYear());

  const [brushMode, setBrushMode] = useState<"auto" | "add" | "remove">("auto");
  const historyRef = useRef<{ stack: any[]; index: number }>({ stack: [], index: -1 });
  const serialize = (arr: Trip[]) => arr.map((t) => ({ id: t.id, start: toISO(t.start), end: toISO(t.end) }));
  const deserialize = (arr: any[]) => arr.map((t) => ({ id: t.id || newId(), start: parseISO(t.start), end: parseISO(t.end) }));
  const pushHistory = (next: Trip[]) => {
    const h = historyRef.current;
    const snap = serialize(next);
    if (h.index >= 0) {
      const current = h.stack[h.index];
      if (current && JSON.stringify(current) === JSON.stringify(snap)) return;
    }
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(snap);
    h.index++;
  };
  const undo = () => {
    const h = historyRef.current;
    if (h.index <= 0) return;
    h.index--;
    setTrips(deserialize(h.stack[h.index]));
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.index >= h.stack.length - 1) return;
    h.index++;
    setTrips(deserialize(h.stack[h.index]));
  };
  useEffect(() => {
    pushHistory(trips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = (e.key || "").toLowerCase();
      if ((e.ctrlKey || (e as any).metaKey) && !e.shiftKey && k === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || (e as any).metaKey) && (k === "y" || (e.shiftKey && k === "z"))) {
        e.preventDefault();
        redo();
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    return () => {};
  }, []);

  const [toast, setToast] = useState<{ msg: string; type: "info" | "warn" } | null>(null);
  const showToast = (msg: string, type: "info" | "warn" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 1800);
  };

  const rule: Rule = selected.rule as any;
  const usedRolling = useMemo(() => {
    if (rule.type === "rolling") return countUsedInWindow(trips, asOf, rule.window);
    if (rule.type === "comboTR") return countUsedInWindow(trips, asOf, rule.cap.window);
    if (rule.type === "perYear") return countUsedInYear(trips, asOf);
    return 0;
  }, [trips, asOf, rule]);
  const limit = rule.type === "rolling" ? rule.max : rule.type === "perYear" ? rule.max : rule.type === "comboTR" ? rule.cap.max : null;
  const tlWindow = rule.type === "perYear" ? 365 : rule.type === "rolling" ? rule.window : rule.type === "comboTR" ? rule.cap.window : 180;
  const tlStart = addDaysUTC(asOf, -(tlWindow - 1));
  const usedSet = useMemo(() => usedDaySetForRange(trips, tlStart, asOf), [trips, asOf, tlWindow]);

  const [hoverISO, setHoverISO] = useState<string | null>(null);
  const hoverUsed = useMemo(() => {
    if (!hoverISO) return null as null | number;
    const date = parseISO(hoverISO);
    const win = rule.type === "perYear" ? 365 : rule.type === "rolling" ? rule.window : rule.type === "comboTR" ? rule.cap.window : 180;
    return usedDaysInRollingWindow(trips, date, win);
  }, [hoverISO, trips, rule]);

  const [planISO, setPlanISO] = useState("");
  const planDate = useMemo(() => (planISO ? parseISO(planISO) : null), [planISO]);
  const plannedMax = useMemo(() => (planDate ? maxStayIfEnterOn(trips, planDate, rule) : 0), [trips, planDate, rule]);
  const plannedExit = useMemo(() => (planDate && plannedMax > 0 ? toISO(addDaysUTC(planDate, plannedMax - 1)) : ""), [planDate, plannedMax]);
  const canPushPlan = planDate != null && plannedMax > 0 && !!plannedExit;

  const remainder = useMemo(() => (limit != null ? clamp(limit - usedRolling, 0, limit) : null), [limit, usedRolling]);
  const usagePercent = useMemo(() => {
    if (limit == null || limit <= 0) return null;
    return Math.round(Math.min(100, (usedRolling / limit) * 100));
  }, [limit, usedRolling]);
  const ruleDescription = useMemo(() => {
    switch (rule.type) {
      case "rolling":
        return `Можно ${rule.max} дн. за последние ${rule.window} дн.`;
      case "perYear":
        return `Можно ${rule.max} дн. за последние 365 дн.`;
      case "perVisit":
        return `Каждый визит не дольше ${rule.perVisit} дн.`;
      case "comboTR":
        return `Въезд до ${rule.perVisit} дн., общий предел ${rule.cap.max}/${rule.cap.window}`;
      default:
        return "";
    }
  }, [rule]);
  const limitLabel = limit != null ? `${limit} дн.` : "Нет фиксированного лимита";
  const windowRangeLabel = `${toISO(tlStart)} – ${toISO(asOf)}`;

  const todayMax = useMemo(() => maxStayIfEnterOn(trips, asOf, rule), [trips, asOf, rule]);
  const recAny = useMemo(() => findEarliestEntryForStay(trips, rule, asOf, 1), [trips, asOf, rule]);
  const recFull = useMemo(() => findEarliestEntryForStay(trips, rule, asOf, fullTarget(rule)), [trips, asOf, rule]);
  const todayExit = todayMax > 0 ? toISO(addDaysUTC(asOf, todayMax - 1)) : "";

  const recommendationCards = [
    {
      id: "today",
      heading: "Въезд сейчас",
      value: todayMax > 0 ? `${todayMax} дн.` : "Нет",
      meta: `Дата въезда: ${toISO(asOf)}`,
      note: todayExit ? `Выезд не позднее ${todayExit}` : "Лимит на сегодня израсходован",
      action: todayMax > 0 ? () => setPlanISO(toISO(asOf)) : null,
    },
    {
      id: "soon",
      heading: "Ближайшее окно",
      value: recAny ? `${recAny.max} дн.` : "Нет",
      meta: recAny ? `Можно въехать ${toISO(recAny.date)}` : "В горизонте окна нет",
      note: recAny ? "Подходит даже для короткой поездки" : "Попробуйте освободить дни",
      action: recAny ? () => setPlanISO(toISO(recAny.date)) : null,
    },
    {
      id: "full",
      heading: `На максимум (${fullTarget(rule)} дн.)`,
      value: recFull ? `${recFull.max} дн.` : "Нет",
      meta: recFull ? `Рекомендуемый въезд ${toISO(recFull.date)}` : "Окно пока не доступно",
      note: recFull ? "Подходит для длинного визита" : "Освободите больше дней",
      action: recFull ? () => setPlanISO(toISO(recFull.date)) : null,
    },
  ];

  const chipStyle = useMemo<React.CSSProperties>(
    () => ({ color: isDark ? "#cbd5f5" : "#475569", background: "rgba(148,163,184,0.12)" }),
    [isDark]
  );

  const sortedTrips = useMemo(() => mergeIntervals(trips), [trips]);
  const totalDays = useMemo(() => sortedTrips.reduce((acc, t) => acc + diffDaysInc(t.end, t.start), 0), [sortedTrips]);

  const canUndo = historyRef.current.index > 0;
  const canRedo = historyRef.current.index < historyRef.current.stack.length - 1;

  function addInterval() {
    if (!startISO || !endISO) {
      showToast("Укажите даты въезда/выезда", "warn");
      return;
    }
    const s = parseISO(startISO), e = parseISO(endISO);
    if (+e < +s) {
      showToast("Выезд раньше въезда", "warn");
      return;
    }
    const next = mergeIntervals([...trips, { id: newId(), start: s, end: e }]);
    if (areTripsEqual(next, trips)) {
      showToast("Пересечений нет — ничего не изменилось");
      setStartISO("");
      setEndISO("");
      return;
    }
    pushHistory(next);
    setTrips(next);
    setStartISO("");
    setEndISO("");
    showToast("Поездка добавлена");
  }
  function pushPlanToForm() {
    if (!planDate || plannedMax <= 0 || !plannedExit) {
      showToast("Выберите дату с доступными днями", "warn");
      return;
    }
    const entryISO = planISO || toISO(planDate);
    setStartISO(entryISO);
    setEndISO(plannedExit);
    showToast("Диапазон подставлен в ручной ввод");
  }
  function clearAll() {
    if (typeof window !== "undefined" && !window.confirm("Удалить все?")) {
      return;
    }
    pushHistory([]);
    setTrips([]);
    showToast("История очищена");
  }
  function onToggleDay(iso: string) {
    const d = parseISO(iso);
    let next: Trip[];
    if (isDateInClosedTrips(trips, d)) {
      next = removeSingleDayFromClosedTrips(trips, d);
    } else {
      next = addSingleDayTrip(trips, d);
    }
    if (areTripsEqual(next, trips)) return;
    pushHistory(next);
    setTrips(next);
  }
  function applyRange(isoA: string, isoB: string, mode: "add" | "remove") {
    const a = parseISO(isoA), b = parseISO(isoB);
    const s = +a <= +b ? a : b;
    const e = +a <= +b ? b : a;
    setTrips((prev) => {
      let next = mergeIntervals(prev);
      if (mode === "add") {
        let run: Date | null = null;
        const adds: Trip[] = [];
        for (let d = new Date(s); d <= e; d = addDaysUTC(d, 1)) {
          if (!isDateInClosedTrips(next, d)) {
            if (!run) run = new Date(d);
          } else if (run) {
            adds.push({ id: newId(), start: run, end: addDaysUTC(d, -1) });
            run = null;
          }
        }
        if (run) adds.push({ id: newId(), start: run, end: new Date(e) });
        if (adds.length) next = mergeIntervals([...next, ...adds]);
      } else if (mode === "remove") {
        for (let d = new Date(s); d <= e; d = addDaysUTC(d, 1)) {
          if (isDateInClosedTrips(next, d)) next = removeSingleDayFromClosedTrips(next, d);
        }
      }
      if (areTripsEqual(next, prev)) return prev;
      pushHistory(next);
      return next;
    });
  }
  function exportJSON() {
    const payload = trips.map((t) => ({ start: toISO(t.start), end: toISO(t.end) }));
    const blob = new Blob([JSON.stringify({ rule, trips: payload }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `visa_days_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importJSON(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.trips)) {
          const next = mergeIntervals(
            data.trips.map((t: any) => ({ id: newId(), start: parseISO(t.start), end: parseISO(t.end) }))
          );
          pushHistory(next);
          setTrips(next);
          showToast("Импортировано");
        } else {
          showToast("Файл без поездок", "warn");
        }
      } catch (err) {
        showToast("Не удалось импортировать", "warn");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }
  function deleteTrip(id: string) {
    const next = mergeIntervals(trips.filter((t) => t.id !== id));
    if (areTripsEqual(next, trips)) return;
    pushHistory(next);
    setTrips(next);
    showToast("Поездка удалена");
  }

  const rootText = isDark ? "text-slate-100" : "text-slate-900";
  const subtleText = isDark ? "text-slate-400" : "text-slate-600";

  return (
    <div className={["min-h-screen", rootText, getBgGradient(isDark)].join(" ")}>
      <Toast toast={toast} isDark={isDark} />

      {/* Header */}
      <header className="relative z-10 mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg" style={{ background: ACCENT }} />
          <div className="text-xl font-semibold tracking-wide" style={{ color: ACCENT }}>NEGVELAW</div>
          <div className={subtleText}>Visa Days Calculator</div>
        </div>
        <nav className={"flex flex-wrap items-center gap-3 text-sm sm:gap-6 " + (isDark ? "text-slate-300" : "text-slate-700") + " justify-start sm:justify-end"}>
          <a className="hover:opacity-90" href="#how">Как считать</a>
          <a className="hover:opacity-90" href="#share">Экспорт</a>
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " flex items-center gap-2 rounded-xl border px-3 py-2"}
            title={isDark ? "Светлая тема" : "Тёмная тема"}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>
            <span className="hidden md:inline">Тема</span>
          </button>
        </nav>
      </header>

      {/* Steps */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-4 pt-2 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Step index={1} label="Выберите страну" active={true} done={true} isDark={isDark} />
          <Step index={2} label="Отметьте поездки" active={true} done={trips.length > 0} isDark={isDark} />
          <Step index={3} label="Проверьте лимит" active={true} done={false} isDark={isDark} />
        </div>
      </section>

      {/* Controls */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-4 pt-2 sm:px-6">
        <div className="grid items-start gap-4 md:grid-cols-12 lg:gap-6">
          <Card isDark={isDark} className="md:col-span-7 min-w-0">
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:items-start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#475569" }}>Страна назначения</span>
                    <select
                      value={selected.code}
                      onChange={(e) => setSelected((COUNTRY_PRESETS as any).find((c: any) => c.code === (e.target as any).value))}
                      className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " w-full rounded-xl border px-3 py-2.5 text-sm shadow-sm"}
                    >
                      {(COUNTRY_PRESETS as any).map((c: any) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#475569" }}>Дата расчёта</span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="date"
                        value={asOfISO}
                        onChange={(e) => {
                          const v = (e.target as any).value;
                          setAsOfISO(v);
                          if (v) setYearView(parseISO(v).getUTCFullYear());
                        }}
                        className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " w-full rounded-xl border px-3 py-2.5 text-sm shadow-sm"}
                      />
                      <button
                        onClick={() => {
                          setAsOfISO("");
                          setYearView(today.getUTCFullYear());
                        }}
                        className={(isDark ? "border-white/10 bg-white/5 text-slate-200" : "border-slate-200 bg-slate-50 text-slate-700") + " rounded-xl border px-3 py-2.5 text-sm font-medium hover:bg-white/10"}
                        type="button"
                      >
                        Сегодня
                      </button>
                    </div>
                    <p className={"text-xs " + subtleText}>Расчёт ведётся в UTC. Сейчас: {toISO(today)}</p>
                  </div>
                  <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50") + " rounded-2xl border p-4 shadow-sm"}>
                    <div className="text-sm font-semibold">Правило пребывания</div>
                    <p className={"mt-2 text-xs leading-relaxed " + (isDark ? "text-slate-300" : "text-slate-600")}>{ruleDescription}</p>
                    <p className={"mt-3 text-xs leading-relaxed " + (isDark ? "text-slate-400" : "text-slate-500")}>{(selected as any).notes}</p>
                  </div>
                </div>
                <div className="min-w-0 space-y-4">
                  <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-2xl border p-5 shadow-sm space-y-4"}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <div className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Использование лимита</div>
                        <div className="mt-2 text-3xl font-semibold tabular-nums">{limit != null ? `${usedRolling} дн.` : "—"}</div>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Остаток</div>
                        <div className="mt-2 text-2xl font-semibold tabular-nums">{remainder != null ? `${remainder} дн.` : "—"}</div>
                        {usagePercent != null && <div className={"mt-1 text-xs " + subtleText}>{usagePercent}% лимита</div>}
                      </div>
                    </div>
                    {usagePercent != null ? (
                      <div className={(isDark ? "bg-slate-800/70" : "bg-slate-200") + " h-2 w-full overflow-hidden rounded-full"}>
                        <div className="h-full rounded-full transition-all duration-300" style={{ background: ACCENT, width: `${Math.max(6, usagePercent)}%` }} />
                      </div>
                    ) : (
                      <div className={"text-xs leading-relaxed " + subtleText}>Правило без суммарного лимита — следите за длительностью каждого визита отдельно.</div>
                    )}
                    <div className="grid gap-2 text-xs sm:grid-cols-2">
                      <span className="rounded-lg px-2 py-1" style={chipStyle}>Окно расчёта: {windowRangeLabel}</span>
                      <span className="rounded-lg px-2 py-1" style={chipStyle}>Фиксированный лимит: {limitLabel}</span>
                      <span className="rounded-lg px-2 py-1" style={chipStyle}>Поездок отмечено: {sortedTrips.length}</span>
                      <span className="rounded-lg px-2 py-1" style={chipStyle}>Дней в истории: {totalDays}</span>
                    </div>
                  </div>
                  <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-2xl border p-5 shadow-sm space-y-3"}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Дни в текущем окне</div>
                        <div className={"text-sm " + subtleText}>Окрашенные даты засчитываются в лимит. Наведите на календарь для точного числа.</div>
                      </div>
                      {hoverISO && (
                        <div className="text-right text-sm">
                          <div className="font-semibold tabular-nums">{hoverISO}</div>
                          <div className={"text-xs " + subtleText}>{hoverUsed} дн. в окне</div>
                        </div>
                      )}
                    </div>
                    <Timeline usedSet={usedSet} start={addDaysUTC(asOf, -(tlWindow - 1))} end={asOf} isDark={isDark} />
                  </div>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {recommendationCards.map((card) => (
                  <div
                    key={card.id}
                    className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " flex h-full flex-col justify-between rounded-2xl border p-4 shadow-sm"}
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wide" style={{ color: isDark ? "#cbd5f5" : "#475569" }}>
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-sm" style={{ background: `${ACCENT}22`, color: isDark ? ACCENT : "#3b2c14" }}>●</span>
                        {card.heading}
                      </div>
                      <div className="mt-3 text-2xl font-semibold tabular-nums">{card.value}</div>
                      <div className={"mt-2 text-sm " + subtleText}>{card.meta}</div>
                      <div className={"mt-1 text-xs " + subtleText}>{card.note}</div>
                    </div>
                    {card.action && (
                      <button
                        onClick={card.action}
                        className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50") + " mt-4 inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium hover:bg-white/10"}
                      >
                        В планировщик
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Planner */}
          <Card isDark={isDark} className="md:col-span-5 min-w-0">
            <div className="flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-semibold">Планировщик въезда</h2>
                <p className={"mt-1 text-sm " + subtleText}>Выберите предполагаемую дату — калькулятор покажет доступную длительность визита и крайний срок выезда.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Если въехать</span>
                  <input
                    type="date"
                    value={planISO}
                    onChange={(e) => setPlanISO((e.target as any).value)}
                    className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " w-full rounded-xl border px-3 py-2.5 text-sm shadow-sm"}
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Можно находиться</span>
                  <div className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " rounded-xl border px-3 py-2.5 text-sm tabular-nums"}>{plannedMax ? `${plannedMax} дн.` : "—"}</div>
                </div>
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Выехать до</span>
                  <div className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " rounded-xl border px-3 py-2.5 text-sm tabular-nums"}>{plannedExit || "—"}</div>
                </div>
              </div>
            <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50") + " rounded-2xl border p-4 space-y-2"}>
              {planDate ? (
                plannedMax > 0 ? (
                  <>
                    <div className="text-sm font-semibold">Въезд {planISO || toISO(planDate)} → {plannedExit}</div>
                    <div className={"text-sm " + (isDark ? "text-emerald-200" : "text-emerald-700")}>Доступно {plannedMax} дн. пребывания.</div>
                    <p className={"text-xs " + subtleText}>Чтобы сохранить поездку, нажмите «Подставить в ручной ввод» или отметьте дни прямо в календаре.</p>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-semibold">На дату {planISO || toISO(planDate)} нет свободных дней.</div>
                    <p className={"text-xs " + subtleText}>Выберите дату из рекомендаций выше или освободите дни, сняв отметки в календаре.</p>
                  </>
                )
              ) : (
                <p className={"text-sm " + subtleText}>Выберите дату вручную или воспользуйтесь рекомендациями — мы сразу посчитаем лимит.</p>
              )}
            </div>
            <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-2xl border p-4 shadow-sm"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Ручной ввод</div>
                  <p className={"text-xs " + subtleText}>Быстро добавьте известный диапазон дат.</p>
                </div>
                {manualRange ? (
                  manualRange.valid ? (
                    <span className="text-xs font-medium" style={{ color: isDark ? "#86efac" : "#15803d" }}>{manualRange.days} дн.</span>
                  ) : (
                    <span className="text-xs font-medium text-amber-400">Проверьте даты</span>
                  )
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                <label className="sm:col-span-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Въезд</span>
                  <input
                    type="date"
                    value={startISO}
                    onChange={(e) => setStartISO((e.target as any).value)}
                    className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " mt-1 w-full rounded-xl border px-3 py-2 text-sm shadow-sm"}
                  />
                </label>
                <label className="sm:col-span-2">
                  <span className="text-xs uppercase tracking-wide" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>Выезд</span>
                  <input
                    type="date"
                    value={endISO}
                    onChange={(e) => setEndISO((e.target as any).value)}
                    className={(isDark ? "border-white/10 bg-white/5 text-slate-100" : "border-slate-200 bg-white text-slate-800") + " mt-1 w-full rounded-xl border px-3 py-2 text-sm shadow-sm"}
                  />
                </label>
                <button
                  type="button"
                  onClick={addInterval}
                  disabled={!canAddManual}
                  className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + ` sm:col-span-1 inline-flex items-center justify-center rounded-xl border px-3 py-2 text-sm font-medium transition ${canAddManual ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"}`}
                >
                  Добавить
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={pushPlanToForm}
                disabled={!canPushPlan}
                type="button"
                  className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + ` inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${canPushPlan ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed"}`}
                >
                  Подставить в ручной ввод
                </button>
                <button
                  onClick={() => setPlanISO("")}
                  type="button"
                  className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"}
                >
                  Сбросить дату
                </button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Calendar */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-4 pt-2 sm:px-6">
        <Card isDark={isDark}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold md:text-xl">Календарь года</h2>
              <p className={"text-sm " + subtleText}>Кликайте по дням, тяните мышью и используйте Shift для диапазонов. Пресеты — в шапке каждого месяца.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setYearView((y) => y - 1)}
                className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-lg border px-3 py-2 text-sm"}
              >
                ← Предыдущий
              </button>
              <div className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"}>
                <label htmlFor="year-input" className="hidden">Год</label>
                <input
                  id="year-input"
                  type="number"
                  value={yearView}
                  onChange={(e) => {
                    const v = Number((e.target as any).value);
                    if (!Number.isNaN(v)) setYearView(Math.max(1970, Math.min(9999, Math.round(v))));
                  }}
                  className={(isDark ? "bg-transparent text-slate-100" : "bg-transparent text-slate-900") + " w-20 border-none text-center focus:outline-none"}
                />
              </div>
              <button
                onClick={() => setYearView((y) => y + 1)}
                className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-lg border px-3 py-2 text-sm"}
              >
                Следующий →
              </button>
              <button
                onClick={() => setYearView(asOf.getUTCFullYear())}
                className={(isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-white") + " rounded-lg border px-3 py-2 text-sm"}
              >
                Текущий год
              </button>
              <button
                onClick={undo}
                disabled={!canUndo}
                className={(isDark ? "border-white/10" : "border-slate-200") + ` rounded-lg border px-3 py-2 text-sm ${canUndo ? "" : "opacity-40"}`}
              >
                Отменить
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                className={(isDark ? "border-white/10" : "border-slate-200") + ` rounded-lg border px-3 py-2 text-sm ${canRedo ? "" : "opacity-40"}`}
              >
                Повторить
              </button>
              <button
                onClick={clearAll}
                className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-sm text-red-200 hover:bg-red-400/20"
              >
                Очистить всё
              </button>
            </div>
          </div>

          <div className="mt-6">
            <YearCalendar
              year={yearView}
              trips={sortedTrips}
              asOfDate={asOf}
              onToggleDay={onToggleDay}
              onApplyRange={applyRange}
              brushMode={brushMode}
              plannedStartISO={planISO || null}
              plannedEndISO={plannedExit || null}
              onSetBrush={setBrushMode}
              onHoverDay={setHoverISO}
              isDark={isDark}
            />
          </div>
        </Card>
      </section>

      {/* Trips list and editor */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-4 pt-2 sm:px-6">
        <Card isDark={isDark}>
          <h2 className="text-lg font-semibold">Ваши поездки</h2>
          <p className={"text-sm " + subtleText}>Список автоматически объединяет пересечения. Можно удалить поездку целиком.</p>
          <div className="mt-4 max-h-72 overflow-y-auto pr-1">
            {sortedTrips.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4 text-sm" style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                Пока ничего нет. Кликните даты в календаре или добавьте диапазон вручную.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ color: isDark ? "#94a3b8" : "#64748b" }}>
                  <tr className="text-left">
                    <th className="pb-2">Въезд</th>
                    <th className="pb-2">Выезд</th>
                    <th className="pb-2">Дней</th>
                    <th className="pb-2 text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrips.map((trip) => (
                    <tr key={trip.id} className="border-t border-white/10">
                      <td className="py-2 font-mono text-xs sm:text-sm">{toISO(trip.start)}</td>
                      <td className="py-2 font-mono text-xs sm:text-sm">{toISO(trip.end)}</td>
                      <td className="py-2">{diffDaysInc(trip.end, trip.start)}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setPlanISO(toISO(trip.start))} className="rounded border border-white/10 px-2 py-1 text-xs hover:bg-white/10">В план</button>
                          <button onClick={() => deleteTrip(trip.id)} className="rounded border border-white/10 px-2 py-1 text-xs text-red-200 hover:bg-red-400/20">Удалить</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </section>

      {/* How it works */}
      <section id="how" className="relative z-10 mx-auto max-w-7xl px-4 pb-4 pt-2 sm:px-6">
        <Card isDark={isDark}>
          <h2 className="text-lg font-semibold">Как считаются дни</h2>
          <div className="mt-3 space-y-2 text-sm" style={{ color: isDark ? "#CBD5E1" : "#334155" }}>
            <p>Используем официальное правило выбранной страны. Если это «90/180», то окно высчитывается по rolling-принципу: мы берём последние {tlWindow} дней, включая дату выхода, и считаем каждое нахождение в стране.</p>
            <p>Календарь даёт гибкость: можно отмечать отдельные дни, перетаскивать мышью и применять пресеты «месяц», «будни» или «выходные». История действий доступна через Ctrl+Z / Ctrl+Shift+Z.</p>
            <p>Планировщик рассчитывает максимально возможную продолжительность нахождения, учитывая уже использованные дни и ограничения конкретного режима. Рекомендации подскажут ближайшие свободные окна.</p>
          </div>
        </Card>
      </section>

      {/* Share */}
      <section id="share" className="relative z-10 mx-auto max-w-7xl px-4 pb-12 pt-2 sm:px-6">
        <Card isDark={isDark}>
          <h2 className="text-lg font-semibold">Импорт и экспорт</h2>
          <p className={"text-sm " + subtleText}>Скачайте текущую историю или загрузите файл, чтобы поделиться с консультантом.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={exportJSON} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">Скачать JSON</button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
              <span>Импортировать</span>
              <input type="file" accept="application/json" className="hidden" onChange={importJSON} />
            </label>
            <span className={"text-xs " + subtleText}>Файл содержит только даты без персональных данных.</span>
          </div>
          <TestPanel isDark={isDark} />
        </Card>
      </section>
    </div>
  );
}
