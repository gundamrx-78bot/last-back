# jejuax-back — 제주AX단 AI 활용 진단 API

진단 agent API 서버입니다. 화면은 `jejuax-front` 저장소에 있습니다.

## 실행
```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY, FRONT_ORIGIN 을 직접 채웁니다 (저장소에 올리지 않기)
npm run dev                  # http://localhost:4000
npm run typecheck
```
키가 없으면 규칙 기반 결과만 돌려줍니다(AI 없이도 동작).

## API
| 주소 | 설명 |
|---|---|
| `POST /api/diagnosis` | 진단 입력(JSON)을 받아 SSE(`data: {...}`)로 진행 단계와 보고서를 보낸다 |
| `OPTIONS /api/diagnosis` | CORS 사전 확인 |

`FRONT_ORIGIN`에 적힌 주소에서 온 요청만 브라우저에서 허용됩니다. 프론트를 배포하면 그 도메인을 쉼표로 추가하세요.

## 구조
| 경로 | 역할 |
|---|---|
| `app/api/diagnosis/route.ts` | 입력 검증, 한도, SSE 스트리밍, CORS |
| `lib/cors.ts` | 허용 주소 확인 |
| `lib/agent/` | Claude 도구 사용 루프(run), 도구(tools), 보고서 검증(report) |
| `lib/courses.ts` | 접수 상태·정보 부족·적합도 규칙 (LLM이 아닌 코드가 판정) |
| `data/` | `taxonomy.json`, `courses.json`, `events.json` |

## 원칙
- 교육 추천 가능 여부(마감, 유료 구독, 직군·단계)는 규칙이 판정하고 agent는 그 결과로 판단·설명한다.
- 키는 서버 환경변수에만 둔다. 입력 원문은 저장·로그하지 않는다. 사용자 서술은 `<user_text>` 안의 데이터로만 전달한다.
- 보고서 모양을 바꾸면 `jejuax-front/lib/types.ts`의 `Report`도 같이 고친다.
