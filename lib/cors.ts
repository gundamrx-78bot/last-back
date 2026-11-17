// 프론트(jejuax-front)가 다른 주소에서 이 API를 부를 수 있게 허용할 주소 목록. FRONT_ORIGIN 환경변수에 쉼표로 적는다.
const allowed = () =>
  (process.env.FRONT_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);

/** 허용된 주소에서 온 요청에만 CORS 헤더를 돌려준다. 그 외에는 헤더를 주지 않아 브라우저가 막는다. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowed().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function withCors(req: Request, res: Response): Response {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}
