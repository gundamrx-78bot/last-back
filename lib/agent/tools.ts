import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { COURSES_CHECKED_AT, EVENTS_CHECKED_AT, LEVEL, STUCK, JOB, TAX } from "../data";
import { checkFit, getEvents, searchCourses } from "../courses";
import { ReportInput } from "./report";

type Tool = Anthropic.Beta.Messages.BetaTool;

export const TOOL_DEFS: Tool[] = [
  {
    name: "get_rule_baseline",
    description: "제주AX단 분류 기준표에서 막힘 유형·활용 단계·직군에 해당하는 원인, 해결 방향, 첫 실습, 응급처치 팁, 직군별 예시를 가져온다. 진단의 출발점으로 가장 먼저 호출한다.",
    input_schema: {
      type: "object",
      properties: { stuck: { type: "string" }, level: { type: "string", enum: ["0", "1", "2", "3", "4"] }, job: { type: "string" } },
      required: ["stuck", "level", "job"],
    },
  },
  {
    name: "search_courses",
    description: "외부 교육기관(제주한라대·제주콘텐츠진흥원·제주고용복지플러스센터 등)과 제주AX단이 등록한 교육 목록을 조회한다. 기본은 접수 마감이 지난 교육을 제외한다. jobMatch 'unknown'은 직군 정보가 없다는 뜻이지 맞는다는 뜻이 아니다.",
    input_schema: {
      type: "object",
      properties: {
        job: { type: "string", description: "직군 코드" },
        mode: { type: "string", enum: ["online", "offline", "hybrid", "any"] },
        keyword: { type: "string" },
        includeClosed: { type: "boolean" },
      },
    },
  },
  {
    name: "get_events",
    description: "제주AX단 행사 일정 달력(교육·공고의 접수 시작/마감일)을 기간·키워드로 조회한다. 달력 날짜는 접수일이라 수업일과 다를 수 있다.",
    input_schema: {
      type: "object",
      properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" }, keyword: { type: "string" } },
    },
  },
  {
    name: "check_course_fit",
    description: "교육 하나가 이 사용자에게 맞는지 규칙으로 판정한다(접수 마감, 유료 구독 필요, 직군·단계 불일치, 정보 부족). 추천하기 전에 후보마다 호출한다.",
    input_schema: {
      type: "object",
      properties: { courseId: { type: "string" }, job: { type: "string" }, level: { type: "integer", minimum: 0, maximum: 4 }, paid: { type: "boolean" } },
      required: ["courseId", "job", "level", "paid"],
    },
  },
  {
    name: "submit_report",
    description: "최종 진단 보고서를 제출한다. 조사를 마친 뒤 마지막에 한 번만 호출한다. courseId는 search_courses 결과에 있는 id만 쓴다.",
    input_schema: {
      type: "object",
      properties: {
        level: { type: "integer", minimum: 0, maximum: 4, description: "진단한 활용 단계" },
        primaryStuck: { type: "string", enum: ["bad", "what", "tool", "stop", "trust", "repeat", "secure", "alone"], description: "가장 큰 막힘 유형 코드. 막힘 점검이 없으면 입력으로 판단해 가장 가까운 코드 하나를 고른다" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        taskRubric: {
          type: "object",
          description: "실습 과제(요청 문장)가 있을 때만 채점한다. 각 항목을 충족하면 true. quote에는 근거가 된 사용자 문장 일부를 인용한다.",
          properties: {
            purpose: { type: "boolean", description: "무엇을 만들어야 하는지 분명하다" },
            context: { type: "boolean", description: "누구에게, 어떤 상황에서 쓰는지 적었다" },
            conditions: { type: "boolean", description: "분량·형식·말투 중 하나 이상을 정했다" },
            criteria: { type: "boolean", description: "원하는 결과의 기준이나 예시를 줬다" },
            verify: { type: "boolean", description: "초안부터 받기·근거 요청 등 고쳐 가는 방식을 요청했다" },
            quote: { type: "string" },
          },
          required: ["purpose", "context", "conditions", "criteria", "verify"],
        },
        summary: { type: "string", description: "해요체 2~3문장 진단 요약" },
        evidence: { type: "array", items: { type: "string" }, description: "사용자의 어떤 답변이 이 진단의 근거인지" },
        blockers: { type: "array", items: { type: "object", properties: { title: { type: "string" }, why: { type: "string" }, fix: { type: "string" } }, required: ["title", "why", "fix"] } },
        recommendations: { type: "array", items: { type: "object", properties: { courseId: { type: "string" }, verdict: { type: "string", enum: ["recommend", "conditional"] }, reason: { type: "string" }, cautions: { type: "array", items: { type: "string" } } }, required: ["courseId", "verdict", "reason", "cautions"] } },
        roadmap: { type: "array", description: "배울 순서. 2~4개 단계", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, minutes: { type: "integer" } }, required: ["title", "detail"] } },
        firstPractice: { type: "object", properties: { title: { type: "string" }, prompt: { type: "string", description: "AI에 그대로 붙여 넣을 완성된 질문 문장(빈칸 표시 금지)" } }, required: ["title"] },
        dataGaps: { type: "array", items: { type: "string" }, description: "추천 근거로 쓰기에 데이터에 없던 정보" },
      },
      required: ["level", "primaryStuck", "confidence", "summary", "evidence", "blockers", "recommendations", "roadmap", "firstPractice", "dataGaps"],
    },
  },
];

/** 화면에 보여 줄 단계 이름 (모델의 내부 추론이 아니라 '어떤 조사를 하는지') */
export const STEP_LABEL: Record<string, string> = {
  get_rule_baseline: "분류 기준표로 막힘 원인 확인",
  search_courses: "외부 교육기관 교육 목록 조회",
  get_events: "행사 일정 달력 조회",
  check_course_fit: "교육 적합도 규칙 판정",
  submit_report: "진단 보고서 작성",
};

const J = (v: unknown) => JSON.stringify(v);

export type ToolOutcome = { content: string; isError?: boolean; report?: ReportInput };

export function runTool(name: string, input: unknown): ToolOutcome {
  const bad = (m: string): ToolOutcome => ({ content: m, isError: true });
  switch (name) {
    case "get_rule_baseline": {
      const a = z.object({ stuck: z.string(), level: z.string(), job: z.string() }).safeParse(input);
      if (!a.success || !STUCK[a.data.stuck] || !LEVEL[a.data.level]) return bad("허용되지 않은 코드값이에요. stuck은 bad·what·tool·stop·trust·repeat·secure·alone 중, level은 0~4 중 하나를 쓰세요.");
      const s = STUCK[a.data.stuck], l = LEVEL[a.data.level];
      return { content: J({ stuck: { name: s.name, cause: s.cause, how: s.how, first: s.first, tips: s.tips, promptTemplate: s.prompt }, level: { name: l.name, next: l.next }, jobExamples: TAX.jobExamples[a.data.job] ?? null, note: "기준표는 인터뷰 전 가설 v1이에요." }) };
    }
    case "search_courses": {
      const a = z.object({ job: z.string().optional(), mode: z.string().optional(), keyword: z.string().max(60).optional(), includeClosed: z.boolean().optional() }).safeParse(input);
      if (!a.success) return bad("잘못된 입력");
      return { content: J({ checkedAt: COURSES_CHECKED_AT, results: searchCourses(a.data) }) };
    }
    case "get_events": {
      const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
      const a = z.object({ from: d, to: d, keyword: z.string().max(60).optional() }).safeParse(input);
      if (!a.success) return bad("날짜는 YYYY-MM-DD 형식이에요.");
      return { content: J({ checkedAt: EVENTS_CHECKED_AT, items: getEvents(a.data) }) };
    }
    case "check_course_fit": {
      const a = z.object({ courseId: z.string(), job: z.string(), level: z.number().int().min(0).max(4), paid: z.boolean() }).safeParse(input);
      if (!a.success) return bad("잘못된 입력");
      const r = checkFit(a.data.courseId, a.data);
      return r.found ? { content: J(r) } : bad("그런 교육 id는 없어요. search_courses 결과의 id를 쓰세요.");
    }
    case "submit_report": {
      const a = ReportInput.safeParse(input);
      if (!a.success) console.log("[agent] report invalid:", a.error.issues.map((i) => `${i.path.join(".")}:${i.code}`).join(", ")); // 내용은 남기지 않는다
      if (!a.success) return bad("보고서 형식 오류: " + a.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") + " — 고쳐서 다시 제출하세요.");
      return { content: "접수됐어요.", report: a.data };
    }
    default:
      return bad("알 수 없는 도구");
  }
}
