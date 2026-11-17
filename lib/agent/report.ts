import { z } from "zod";
import { COURSES, LEVEL, STUCK } from "../data";
import { applyState, summarize } from "../courses";
import { consistency, hasForeignScript, ruleLevel } from "../intake";

// 길이·개수 초과로 보고서를 거절하면 모델이 같은 실수를 반복하며 비용만 늘어난다.
// 그래서 형식이 틀린 것(타입·필수값)만 거절하고, 너무 긴 문장·너무 많은 항목은 코드가 잘라 낸다.
const str = (n: number) => z.string().trim().min(1).transform((s) => (s.length > n ? s.slice(0, n - 1) + "…" : s));
const arr = <T extends z.ZodTypeAny>(item: T, max: number, min = 0) =>
  z.preprocess((v) => (Array.isArray(v) ? v.slice(0, max) : typeof v === "string" ? [v] : v), z.array(item).min(min));
// 문자열 목록: 빈 값·문자열이 아닌 값은 버리고 개수·길이를 제한한다.
const strList = (n: number, max: number) =>
  z.preprocess((v) => {
    const a = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
    return a.filter((x) => typeof x === "string" && x.trim()).slice(0, max).map((x) => (x as string).trim().slice(0, n));
  }, z.array(z.string()));

export const ReportInput = z.object({
  level: z.number().int().min(0).max(4),
  primaryStuck: z.string(), // 허용 코드가 아니면 finalizeReport 에서 코드가 정한 기본 막힘으로 바꾼다
  confidence: z.enum(["high", "medium", "low"]),
  // 실습 과제 채점(요청 문장이 있을 때만): 항목별 충족 여부와 근거 인용
  taskRubric: z.object({
    purpose: z.boolean(), context: z.boolean(), conditions: z.boolean(), criteria: z.boolean(), verify: z.boolean(),
    quote: z.string().optional(),
  }).optional(),
  summary: str(800),
  evidence: arr(str(350), 6, 1),
  blockers: arr(z.object({ title: str(100), why: str(450), fix: str(450) }), 3, 1),
  recommendations: arr(z.object({
    courseId: str(80), verdict: z.enum(["recommend", "conditional"]), reason: str(500), cautions: strList(300, 4),
  }), 3),
  roadmap: arr(z.object({ title: str(100), detail: str(450), minutes: z.number().nullish() }), 6, 2),
  firstPractice: z.object({ title: str(120), prompt: str(700).optional() }),
  dataGaps: strList(300, 8),
});
export type ReportInput = z.infer<typeof ReportInput>;

export const taskScoreOf = (t?: ReportInput["taskRubric"]) =>
  t ? [t.purpose, t.context, t.conditions, t.criteria, t.verify].filter(Boolean).length : null;

/** 모델이 낸 보고서를 검증하고, 교육 정보는 모델 문장이 아닌 실제 데이터로 채운다.
 *  단계는 코드가 계산한 규칙 단계(행동 단계 + 과제 점수)를 기준으로, 모델 판단은 ±1단계까지만 허용한다. */
export function finalizeReport(r: ReportInput, ctx: { behavior: number; hasTask: boolean; defaultStuck: string }) {
  const stuckCode = r.primaryStuck in STUCK && r.primaryStuck !== "other" ? r.primaryStuck : ctx.defaultStuck;
  if (hasForeignScript(JSON.stringify(r))) throw new Error("report contains foreign script");
  const taskScore = ctx.hasTask ? taskScoreOf(r.taskRubric) : null;
  if (ctx.hasTask && taskScore == null) throw new Error("taskRubric 이 필요해요(과제 요청 문장이 있어요)");
  const rule = ruleLevel(ctx.behavior, taskScore);
  const lv = Math.max(0, Math.max(rule - 1, Math.min(4, Math.min(rule + 1, r.level))));
  const dropped: string[] = [];
  const seen = new Set<string>();
  const recommendations = r.recommendations.flatMap((rec) => {
    const c = COURSES.find((x) => x.id === rec.courseId);
    if (!c || seen.has(c.id) || applyState(c) === "closed") { dropped.push(rec.courseId); return []; } // 없는 교육·마감된 교육은 코드가 한 번 더 거른다
    seen.add(c.id);
    return [{ ...rec, course: summarize(c) }];
  });
  return {
    level: { code: String(lv), name: LEVEL[String(lv)].name, next: LEVEL[String(lv)].next ?? "" },
    ruleLevel: { code: String(rule), name: LEVEL[String(rule)].name },
    behaviorLevel: ctx.behavior,
    taskScore,
    consistency: consistency(ctx.behavior, taskScore),
    primaryStuck: { code: stuckCode, name: STUCK[stuckCode].name },
    confidence: r.confidence, summary: r.summary, evidence: r.evidence, blockers: r.blockers,
    recommendations,
    roadmap: r.roadmap.map((s) => ({ title: s.title, detail: s.detail, ...(s.minutes ? { minutes: Math.max(5, Math.round(s.minutes)) } : {}) })),
    firstPractice: r.firstPractice, dataGaps: r.dataGaps,
    droppedCourseIds: dropped,
  };
}
export type Report = ReturnType<typeof finalizeReport>;
