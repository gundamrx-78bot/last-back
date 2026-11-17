import { COURSES, EVENTS, type Course, JOB } from "./data";

export const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export type ApplyState = "closed" | "not_open_yet" | "open" | "unknown";

/** 접수 상태. 날짜 정보가 없으면 'unknown' — 단정하지 않는다. */
export function applyState(c: Course, today = kstToday()): ApplyState {
  if (c.applyCloseAt && c.applyCloseAt < today) return "closed";
  if (c.applyOpenAt && c.applyOpenAt > today) return "not_open_yet";
  if (c.applyOpenAt || c.applyCloseAt) return "open";
  return "unknown";
}

/** 추천 판단에 쓰기에 비어 있는 정보 목록 */
export function infoGaps(c: Course): string[] {
  const g: string[] = [];
  if (!c.prerequisites) g.push("대상·선수 조건");
  if (c.levelFrom == null && c.levelTo == null) g.push("대상 활용 단계");
  if (!c.outcomes?.length) g.push("수업 후 할 수 있는 것");
  if (!c.difficulty) g.push("난이도");
  if (!c.cost) g.push("비용");
  if (!c.jobTags?.length) g.push("대상 직군");
  return g;
}

export function summarize(c: Course, today = kstToday()) {
  return {
    id: c.id, title: c.title, org: c.org, mode: c.mode, region: c.region,
    applyState: applyState(c, today), applyOpenAt: c.applyOpenAt, applyCloseAt: c.applyCloseAt,
    classDate: c.scheduleNote ?? c.startAt?.slice(0, 10) ?? null,
    venue: [c.venueName, c.venueDetail].filter(Boolean).join(" ") || null,
    cost: c.cost, needsPaidSubscription: c.needsPaid, jobTags: c.jobTags,
    prerequisites: c.prerequisites, infoGaps: infoGaps(c), source: c.source, link: c.link ?? null,
  };
}

export function searchCourses(a: { job?: string; mode?: string; keyword?: string; includeClosed?: boolean }) {
  const today = kstToday();
  const kw = a.keyword?.trim().toLowerCase();
  return COURSES.filter((c) => {
    if (!a.includeClosed && applyState(c, today) === "closed") return false;
    if (a.mode && a.mode !== "any" && c.mode !== a.mode && c.mode !== "hybrid") return false;
    if (kw && !`${c.title} ${c.org ?? ""} ${c.field ?? ""}`.toLowerCase().includes(kw)) return false;
    return true;
  }).map((c) => ({
    ...summarize(c, today),
    // 직군 태그가 비어 있으면 '모름'이지 '무관'이 아니다.
    jobMatch: a.job ? (c.jobTags.length ? c.jobTags.includes(a.job) : "unknown") : undefined,
  }));
}

export function getEvents(a: { from?: string; to?: string; keyword?: string; limit?: number }) {
  const today = kstToday();
  const from = a.from ?? today;
  const to = a.to ?? new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
  const kw = a.keyword?.trim().toLowerCase();
  return EVENTS.filter((e) => e.date >= from && e.date <= to && (!kw || e.title.toLowerCase().includes(kw)))
    .slice(0, Math.min(a.limit ?? 30, 40))
    .map((e) => ({ date: e.date, kind: e.kind, title: e.title, venue: e.venue, time: e.time, link: e.link ?? null }));
}

/** 규칙 기반 적합도. LLM이 아니라 코드가 판정한다(같은 입력이면 같은 결과). */
export function checkFit(id: string, p: { job: string; level: number; paid: boolean }) {
  const c = COURSES.find((x) => x.id === id);
  if (!c) return { found: false as const };
  const state = applyState(c);
  const reasons: string[] = [];
  let verdict: "recommend" | "conditional" | "exclude" = "recommend";
  if (state === "closed") { verdict = "exclude"; reasons.push(`접수가 ${c.applyCloseAt}에 마감됐어요.`); }
  if (c.needsPaid && !p.paid) { verdict = "exclude"; reasons.push("유료 AI 구독이 필요한 교육인데 구독하지 않는다고 답했어요."); }
  const jobMatch = c.jobTags.length ? c.jobTags.includes(p.job) : null;
  if (jobMatch === false) { if (verdict !== "exclude") verdict = "conditional"; reasons.push(`대상 직군 태그(${c.jobTags.map((t) => JOB[t]?.name ?? t).join(", ")})에 ${JOB[p.job]?.name ?? p.job}이(가) 없어요.`); }
  if (c.levelFrom != null && p.level < c.levelFrom) { if (verdict !== "exclude") verdict = "conditional"; reasons.push(`권장 시작 단계(${c.levelFrom})보다 낮아요.`); }
  if (c.levelTo != null && p.level > c.levelTo) { if (verdict !== "exclude") verdict = "conditional"; reasons.push(`대상 단계(${c.levelTo})보다 높아요.`); }
  const gaps = infoGaps(c);
  if (verdict === "recommend" && (gaps.includes("대상 활용 단계") || state === "unknown")) { verdict = "conditional"; reasons.push("대상 단계나 접수 일정 정보가 없어 단정할 수 없어요."); }
  return { found: true as const, id, verdict, applyState: state, jobMatch, reasons, infoGaps: gaps };
}
