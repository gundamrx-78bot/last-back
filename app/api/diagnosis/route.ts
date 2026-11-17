import { IntakeSchema } from "@/lib/intake";
import { runDiagnosisAgent } from "@/lib/agent/run";
import { corsHeaders, withCors } from "@/lib/cors";

export const runtime = "nodejs";
export const maxDuration = 120;

// 인스턴스 메모리 기반의 대략적인 한도(서버리스에서는 인스턴스마다 따로 센다)
const DAILY = Number(process.env.DAILY_AI_LIMIT || 300);
const PER_IP = Number(process.env.PER_IP_LIMIT || 5);
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, number[]>();
let day = "", total = 0;

function limited(ip: string) {
  const today = new Date().toDateString();
  if (today !== day) { day = today; total = 0; }
  if (total >= DAILY) return true;
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= PER_IP) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); total++;
  if (hits.size > 5000) hits.clear();
  return false;
}

const json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });

async function handle(req: Request) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 8192) return json(413, "too_large", "요청이 너무 깁니다.");
  let body: unknown;
  try { body = JSON.parse(await req.text()); } catch { return json(400, "bad_json", "JSON 형식이 아닙니다."); }
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) return json(400, "bad_value", "허용되지 않은 값이 있어요: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "));

  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (limited(ip)) return json(429, "rate_limit", "잠시 후 다시 시도해 주세요.");

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try { for await (const ev of runDiagnosisAgent(parsed.data)) send(ev); }
      catch { send({ type: "error", code: "internal", message: "진단 중 오류가 났어요." }); }
      send({ type: "done" });
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

export async function POST(req: Request) {
  return withCors(req, await handle(req));
}

// 브라우저가 다른 주소에서 호출하기 전에 보내는 사전 확인 요청
export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
