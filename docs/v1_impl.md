# Vibee V1 — 구현 문서 (MVP)

## 0. 문서 상태와 기준선

- 상태: **구현 완료, 실제 Claude Agent SDK로 end-to-end 라이브 실행 1회 관찰 완료.**
- 선행 문서: `docs/v1_plan.md` (설계).
- 이 문서는 `v1_plan.md`를 사후에 고쳐쓰지 않는다. 계획과 실제 구현이 갈린 지점은 전부 아래 "계획과의 차이"에 명시한다.
- 원칙: 관찰된 것만 "확인됨"으로 쓴다. 브라우저에서 눈으로 보지 못한 것은 "미확인"으로 명시한다(archify/ontology 문서들의 "과장 금지" 관례를 그대로 따른다).

## 1. 실제로 만든 것

npm workspaces 모노레포, 5개 workspace, 순서대로 빌드됨: `packages/protocol` → `packages/architecture-view` → `packages/mcp-server` → `apps/bridge` → `apps/web`. `fixtures/sample-app`는 워크스페이스 밖의 독립된 스모크테스트 대상(사용자의 실제 프로젝트를 흉내낸 것)으로 별도 존재한다.

| 패키지 | 내용 |
|---|---|
| `@vibee/protocol` | `ArchitectureViewDocument` 등 공유 타입, `Diagnostic`/`hasError`, `AgentId`/`TaskMode`/`ModelOption`/`AgentEvent`, bridge 토큰/env 상수 |
| `@vibee/architecture-view` | 스키마(`architecture-view.schema.json`, 유일한 source of truth) + `geometry.ts`(포트분산/dogleg 라우팅/화살촉 단축/CJK 라벨폭/`calculateArchitectureLayout`) + `validator.ts`(schema→geometry→citation) + `render.ts`(z-order 고정 SVG 렌더러) + `citation.ts`(git 기반 근거 검증) |
| `@vibee/mcp-server` | stateless stdio MCP 서버. tool 2개: `validate_architecture_view`, `submit_architecture_view` |
| `@vibee/bridge` | Express+WS 서버. Claude Agent SDK 오케스트레이션(`agents/claude/adapter.ts`), Codex 스텁(`agents/codex/adapter.ts`), 프롬프트(`prompt.ts`), 검증왕복 캡(`state.ts`), 저장(`store.ts`) |
| `@vibee/web` | React 19 + Vite. `ProjectPicker` → `AnalyzingConsole` → `ArchitectureView`/`DiagnosticsPanel` |
| `fixtures/sample-app` | 프론트(정적 HTML/JS) + 백엔드(Express) + `node:sqlite` DB로 구성된 소형 노트 앱. vibee 자체 워크스페이스 밖에 독립적으로 존재 |

## 2. 검증 결과 (raw 수치)

### 2.1 단위 테스트 / 빌드 / 타입체크

전 워크스페이스 `npm run build`/`npm run typecheck` 클린(0 에러). `npm run test` 결과:

| 패키지 | 테스트 수 | 결과 |
|---|---:|---|
| `@vibee/protocol` | 4 | 4/4 통과 |
| `@vibee/architecture-view` | 26 | 26/26 통과 |
| `@vibee/mcp-server` | 10 | 10/10 통과 |
| `@vibee/bridge` | 15 | 15/15 통과 |
| **합계** | **55** | **55/55 통과** |

(mcp-server는 최초 4개였으나, §3의 버그 수정 과정에서 `coerceJsonStrings` 회귀 테스트 6개를 추가해 10개가 됐다.)

### 2.2 실제 SDK/라이브러리 버전 (사전 추정과 다르게 확인된 것)

`@modelcontextprotocol/sdk@1.30.0`, `@anthropic-ai/claude-agent-sdk@0.3.246`, `express@5.2.1`, `ws@8.21.3`. 둘 다 이 샌드박스에서 정상 설치·동작했다(스텁 처리 불필요).

### 2.3 실제 라이브 end-to-end 실행 1회 — `fixtures/sample-app` 대상

이 샌드박스에는 실제 Claude 자격증명이 있어, 계획 문서가 요구한 수동 스모크 테스트를 실제로 1회 실행했다.

```
탐색한 파일: 6개
  README.md, backend/package.json, backend/db.js, backend/server.js,
  frontend/index.html, frontend/app.js
MCP tool 호출: 3회 (validate_architecture_view ×2, submit_architecture_view ×1)
최종 상태: task.completed, architecture-view.committed 둘 다 수신
토큰 사용량(최종 result 메시지 기준): input 12 / output 4001 / cache_read 67568 / cache_write 18052
```

커밋된 문서: **컴포넌트 3개**(`frontend`/`backend`/`database`, 타입 각각 frontend/backend/database), **boundary 1개**(backend+database를 감싸는 `region`), **connection 2개**(`frontend→backend` variant `emphasis`, `backend→database` variant `default`), **card 1개**(요청 흐름 3단계 설명). 모든 컴포넌트에 실제 `sources[]`(파일 경로, 일부는 line/endLine 포함)가 붙어 있었고, `fixtures/sample-app`가 git 저장소가 아니므로 revision 없이 working-tree 인용 모드로 정상 동작했다(설계대로 — 이건 실패가 아니라 의도된 경로다). 최종 제출은 검증 오류 0개로 통과했다(2번째 validate 라운드에서 문제를 스스로 고치고 3번째 호출에서 submit).

SVG 출력 구조 확인(문자열 검사로): `<defs>` 정확히 1개, `data-theme="dark"` 규칙 존재, 잘 닫힌 단일 `<svg>...</svg>` 문서, 태그 균형 정상.

### 2.4 발견하고 고친 버그 — MCP tool 입력 스키마가 구조를 전달하지 못함

**증상**: 최초 구현에서는 `validate_architecture_view`/`submit_architecture_view`의 `inputSchema`가 `z.object({}).passthrough()`(완전히 빈 스키마)였다. 실제 Claude Agent SDK 턴으로 라이브 테스트했을 때, 도구 호출 시 `pos`/`size` 같은 배열·숫자 필드가 전부 문자열로 도착해 ajv 스키마 검증이 매번 실패했다 — 즉 MVP의 핵심 경로(분석→검증→제출)가 실제로는 한 번도 끝까지 성공하지 못했다.

**원인 추정**: 도구의 선언된 입력 스키마가 완전히 비어 있어("아무 객체나 허용") 모델/SDK의 tool-call 인자 직렬화 경로가 중첩 구조(배열/숫자)를 제대로 구성할 신호를 받지 못한 것으로 보인다. 확정된 근본 원인은 아니며("추정"으로 명시), 이 문서는 관찰된 증상과 적용한 수정, 그리고 수정 후 실제로 문제가 사라졌다는 사실만 확인한다.

**수정**: `packages/mcp-server/src/index.ts`에서 빈 스키마를 실제 필드 타입(문자열/숫자/배열/enum)을 갖춘 zod 스키마로 교체하되, 모든 레벨에 `.passthrough()`를 유지하고 `min/max/regex` 같은 제약은 걸지 않았다 — "진짜 엄격한 게이트는 서버사이드 ajv"라는 기존 설계 원칙을 지키면서 모델에게 구조 정보만 정확히 알려주기 위함이다. 추가로 `coerceJsonStrings()` 방어 로직을 두 tool 핸들러 앞단에 넣어, 값이 JSON으로 파싱 가능한 문자열로 도착하면 재귀적으로 파싱하도록 했다(증상 자체에 대한 안전망, 근본 원인 확정과 무관하게 유효한 보강).

**수정 후 검증**: 위 §2.3의 라이브 실행이 바로 이 수정 이후 실행이며, 실제로 처음부터 끝까지 성공했다. 수정 전 상태로는 몇 번을 재시도해도 성공 커밋에 도달하지 못했을 것이라는 점은 이번 세션에서 직접 관찰했다(수정 전 실행 로그 자체를 이 문서에 보존하진 않았다 — 정성적 관찰로만 기록).

## 3. 계획과의 차이 (`docs/v1_plan.md` 대비)

- **ajv import**: `ajv/dist/2020.js`의 named export `Ajv2020` 사용(default import는 NodeNext 인터롭에서 생성자로 쓸 수 없었음).
- **`routeConnection`의 `obstacles` 타입**: 계획의 `Rect[]`를 `Obstacle`(`Rect & {id: string}`)로 확장 — `crossedComponentIds`를 보고하려면 각 장애물의 id가 필요했다.
- **패키지 `test` 스크립트**: `node --test dist/test/`가 아니라 `node --test "dist/test/**/*.test.js"` — Node 24에서 디렉토리를 위치 인자로 주면 ESM 패키지에서 `MODULE_NOT_FOUND`가 났다.
- **MCP SDK 실제 API**: `McpServer` 생성자가 `(implementation, {instructions})` 형태(계획은 top-level이라고 추정) — `registerTool`의 `inputSchema`는 raw zod 객체 스키마를 직접 받음 —서브패스 import에 `.js` 필요(`@modelcontextprotocol/sdk/server/mcp.js` 등).
- **Claude Agent SDK 실제 API**: `tools` 옵션이 맞고 `allowedTools`가 아님(`allowedTools`는 승인 없이 자동 허용하는 별도 옵션). `supportedModels()`/`initializationResult()`/`close()` 같은 제어 메서드는 streaming-input 모드(async iterable prompt)에서만 동작 — 문자열 프롬프트로는 호출 불가. usage 필드는 snake_case(`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`). MCP tool 호출은 별도 블록 타입이 아니라 이름이 `mcp__<serverName>__<toolName>`인 일반 `tool_use` 블록으로 온다(계획은 이 네이밍을 추정만 했음 — 실제 라이브 테스트로 확인됨, `AnalyzingConsole.tsx`가 suffix 매칭으로 대응).
- **`@vibee/protocol`에 `AgentEvent` variant 1개 추가**: `{type: "architecture-view.committed", taskId}` — "에이전트 턴이 끝남"(`task.completed`, 성공 여부 무관)과 "문서가 실제로 커밋됨"은 다른 사건이라 분리가 필요했다.
- **웹 앱의 CORS 처리**: 계획에 없던 문제 — bridge가 CORS 헤더를 보내지 않고(수정 대상 아님) 브라우저에서 직접 fetch하면 막힌다. `vite.config.ts`가 `/api/*`를 dev 서버에서 bridge로 프록시하는 방식으로 해결(WS는 브라우저가 CORS를 적용하지 않아 영향 없음). **주의**: 이 해법은 `vite dev`에만 적용되고, 정적 프로덕션 빌드에는 프록시가 없다 — 이번 MVP는 로컬 개발 서버로만 검증했고, 정적 배포 시나리오는 미해결로 남긴다.
- **MCP tool 입력 스키마 버그**: §2.4에서 다룬 대로, 계획에는 없던 실제 실행 중 발견·수정.

## 4. 미확인 / 미결정 (과장 금지)

- **시각적 렌더링을 브라우저에서 직접 확인하지 않았다.** SVG 문자열의 구조적 속성(`<defs>` 1개, z-order, data-theme 존재, 태그 균형)은 코드로 검사했지만, 실제 화살촉 위치·라벨 겹침 없음·다크모드 전환이 "눈으로 보기에" 실제로 깔끔한지는 이 세션에서 확인하지 못했다. 사용자가 브라우저로 직접 확인해야 하는 부분이다.
- **한글(CJK) 라벨을 실제 AI가 생성한 다이어그램에서 검증하지 못했다.** `labelDisplayWidth`의 CJK 인지 폭 계산은 단위 테스트로는 확인했지만, 이번 라이브 실행의 fixture와 결과 라벨이 전부 영문이라 실전 검증은 아직이다.
- **validate/submit 6회 캡에 실제로 도달하는 경로를 라이브로 관찰하지 못했다.** 단위 테스트(`state.test.ts`)로만 확인했다 — 이번 라이브 실행은 3회(캡의 절반)만에 성공했다.
- **정적 프로덕션 빌드(비-dev-server) 배포 시나리오는 검증하지 않았다** — CORS 프록시가 dev 서버 전용이라는 점(§3) 참고.
- **MCP 입력 스키마 버그(§2.4)의 근본 원인은 추정이지 확정이 아니다.** 수정 후 실제로 문제가 사라졌다는 관찰은 확실하지만, "빈 스키마가 정확히 어느 계층에서 문자열화를 유발했는지"는 SDK 내부까지 추적하지 않았다.
- **Codex 어댑터는 여전히 스텁이다** — 계획대로 의도된 것이지 누락이 아니다.
- **`fixtures/sample-app`을 대상으로 한 라이브 실행은 1회뿐이다.** 계획의 완료 기준(§5)이 요구한 "1회 관찰"은 충족했지만, 반복 실행 시의 변동성(모델 비결정성)은 확인하지 않았다.

## 5. 로드맵 (변경 없음)

`docs/v1_plan.md` §7의 세 가지 로드맵 항목(비전공자 관점 사용자/시스템 흐름 시각화, 증분분석 토큰 절감, 화살표 클릭 시퀀스 다이어그램 드릴다운)은 이번 라운드에서 다루지 않았다. 계획 문서의 설계 내용이 그대로 유효하다.
