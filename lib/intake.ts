import { z } from "zod";
import { JOB } from "./data";

const code = (m: Record<string, unknown>) => z.string().refine((v) => v in m, "허용되지 않은 값");

export const TOOLS_USED = ["chatgpt", "gemini", "claude", "copilot", "canva_etc", "coding", "none"] as const;
/** 막힘 점검 D1~D8의 순서 = 막힘 코드 (taxonomy.json 의 stuck 코드와 같다) */
export const STUCK_ORDER = ["bad", "what", "tool", "stop", "trust", "repeat", "secure", "alone"] as const;

// 진단 체크리스트 v2 (docs/진단체크리스트_v1.md + 가상 응답자 테스트 후 규칙 수정)
// 필수: job, paid, firstUse. firstUse가 "never"면 b/d/taskText 없이도 진단된다(입문 경로).
export const IntakeSchema = z.object({
  job: code(JOB).optional(),                       // 직군 코드(없으면 jobText 에서 추정)
  jobText: z.string().trim().max(100).default(""), // 하시는 일(서술)
  paid: z.enum(["yes", "no"]),
  firstUse: z.enum(["never", "lt1m", "m1to6", "m6to12", "gte1y"]),
  tools: z.array(z.enum(TOOLS_USED)).max(7).default([]),
  // 활용 행동 6문항: [재질문, 업무 문서 초안, 맥락 알림, 사실 확인, 반복 업무 흐름, 도구 제작]
  b: z.array(z.enum(["yes", "no", "unsure"])).length(6).optional(),
  taskText: z.string().trim().max(600).default(""),                   // C 실습 과제(요청 문장)
  d: z.array(z.number().int().min(1).max(4)).length(8).optional(),    // D1~D8 막힘 점수
  weeklyMinutes: z.enum(["30", "60", "120", "240"]).optional(),
  budget: z.enum(["subscribed", "free", "if_supported"]).optional(),
  goalType: z.enum(["docs", "content", "automation", "build", "unsure"]).optional(),
  mode: z.enum(["online", "offline", "any"]).default("any"),
  stuckDetail: z.string().trim().max(200).default(""),
});
export type Intake = z.infer<typeof IntakeSchema>;

/** 규칙 기반 계산(LLM이 아니라 코드가 판정: 같은 답이면 같은 결과) */
export function derive(i: Intake) {
  const b = i.b ?? [];
  const yes = (idx: number[]) => idx.filter((k) => b[k] === "yes").length;
  // 단계 n 달성: 1단계 재질문 예 / 2단계 [문서 초안·맥락 알림·사실 확인] 중 2개 이상 / 3단계 반복 업무 흐름 예 / 4단계 도구 제작 예
  const ok = [yes([0]) === 1, yes([1, 2, 3]) >= 2, yes([4]) === 1, yes([5]) === 1];
  let behavior = 0;
  if (i.firstUse !== "never") {
    if (ok[0]) behavior = 1;
    if (ok[0] && ok[1]) behavior = 2;
    if (ok[0] && ok[1] && ok[2]) behavior = 3;
    if (ok[0] && ok[1] && ok[2] && ok[3]) behavior = 4;
  }
  const unsure = b.filter((x) => x === "unsure").length;
  const d = i.d;
  // 상위 2개 막힘(동점이면 번호가 작은 쪽)
  const topStuck = d ? [...STUCK_ORDER.keys()].sort((x, y) => d[y] - d[x] || x - y).slice(0, 2).map((k) => STUCK_ORDER[k]) : [];
  return { behavior, ok, unsure, topStuck: topStuck as string[] };
}

/** 직군 코드: 코드가 직접 오면 그대로, 아니면 서술에서 키워드로 추정(틀릴 수 있어 agent가 서술을 보고 다시 판단한다) */
export function jobOf(i: { job?: string; jobText: string }): string {
  if (i.job) return i.job;
  const t = i.jobText;
  if (/사무|행정|총무|회계|인사|비서|공무원|경리/.test(t)) return "office";
  if (/카페|식당|가게|자영업|소상공|쇼핑몰|매장|사장|펜션|미용|장사/.test(t)) return "shop";
  if (/강사|교사|선생|학원|교육|교수|튜터/.test(t)) return "edu";
  if (/디자|콘텐츠|유튜|영상|마케|SNS|작가|사진|편집/.test(t)) return "content";
  if (/개발|IT|프로그|엔지니어|서버|코딩|데이터/.test(t)) return "dev";
  return "etc";
}

/** 과제 점수(0~5)와 행동 단계로 규칙 단계를 정한다.
 *  과제는 '상한'이 아니라 행동이 과제보다 2단계 이상 높게 나올 때만 낮춘다(가상 응답자 테스트에서 상한 방식이 3단계 사용자를 낮췄음). */
export function ruleLevel(behavior: number, taskScore: number | null) {
  if (taskScore == null) return behavior;
  const tl = taskScore <= 1 ? 1 : taskScore <= 3 ? 2 : 3;
  return behavior - tl >= 2 ? tl + 1 : behavior;
}

export function consistency(behavior: number, taskScore: number | null): "과제 없음" | "일치" | "행동>과제" | "과제>행동" {
  if (taskScore == null) return "과제 없음";
  const tl = taskScore <= 1 ? 1 : taskScore <= 3 ? 2 : 3;
  if (behavior - tl >= 2) return "행동>과제";
  if (taskScore >= 4 && behavior <= 1) return "과제>행동";
  return "일치";
}

export const maskPII = (s: string) =>
  s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[이메일]").replace(/0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, "[전화번호]");

/** 한자·키릴·가나가 섞인 출력은 거른다(기존 프로젝트 규칙) */
export const hasForeignScript = (t: string) => /[一-鿿Ѐ-ӿ぀-ヿ]/.test(t);
