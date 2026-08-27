# Vibee V3 — 다이어그램 가독성 개선 + Codex 어댑터 연동 계획

## 0. 문서 상태와 기준선

- 상태: **설계 완료, 구현 착수 전 계획 문서.**
- 선행 문서:
  - `docs/v1_plan.md` / `docs/v1_impl.md` — V1 설계 및 구현
  - `docs/v2_plan.md` / `docs/v2_impl.md` — V2 설계 및 구현 (Runtime Architecture 시각화 고도화)
- V3는 V2의 스키마/검증기/geometry/렌더러/2단계 파이프라인을 **폐기하지 않고 그 위에 세 가지 국소 개선**을 얹는다: 다이어그램 출력 언어, 연결선 라벨의 렌더링 가독성, Codex 어댑터의 실제 구현. 새 스키마 버전이나 파이프라인 구조 변경은 없다.
- 이 문서는 구현 전에 고정한다. 구현 완료 후 실제 변경점과 검증 결과는 `docs/v3_impl.md`에 별도로 기록한다.

---

## 1. 배경

실제 분석 결과물(Damoat 프로젝트, Coolify 런타임 아키텍처)을 스크린샷으로 확인한 결과 세 가지 문제가 나타났다.

1. **다이어그램 라벨이 영어로 출력됨.** 컴포넌트 이름("Web UI", "Authentication")과 연결선 라벨("verify request", "fetch data")은 AI가 자유 텍스트로 저작하는 필드인데, `apps/bridge/src/prompt.ts`/`apps/bridge/src/prompts/*.ts` 어디에도 출력 언어 지시가 없어 기본값(영어)으로 생성됐다. 반면 웹 앱의 UI 크롬(`ArchitectureInspector.tsx`의 "역할", `AnalyzingConsole.tsx`의 "분석 중..." 등)은 이미 하드코딩된 한국어다 — 앱은 한국어 전용인데 AI가 생성하는 다이어그램 콘텐츠만 언어가 어긋나 있었다.
2. **연결선과 화살표가 겹쳐 보여 가독성이 떨어짐.** `packages/architecture-view/src/render.ts`의 `renderConnection()`을 직접 확인한 결과, 연결선 라벨은 배경 없는 `<text>`로만 그려진다. CSS에는 `.av-connection-label-bg { fill: var(--av-bg); opacity: 0.85; }`가 이미 정의돼 있었지만 실제로 이 클래스를 쓰는 `<rect>`를 그리는 코드가 없는 **죽은 CSS**였다. 그 결과 라벨 텍스트가 선/다른 라벨과 그대로 겹쳐 보인다. 추가로 `geometry.ts`의 `MAX_PORT_SPACING`(14px)이 좁아 한 컴포넌트의 같은 변에 여러 연결선이 몰릴 때 화살표가 다닥다닥 붙어 보인다.
3. **Codex 연동이 스텁 상태.** `apps/bridge/src/agents/codex/adapter.ts`는 `AgentAdapter` 인터페이스만 구현한 스텁으로, `docs/v1_plan.md`에 "이번 라운드는 Codex CLI를 스텁으로만 둔다"고 명시된 대로 모든 메서드가 `NotImplementedError`를 던진다. 이번 라운드에서 실제 연동을 요청받았고, 로컬에 `codex` CLI(v0.149.0, 로그인 완료)와 공식 `@openai/codex-sdk`가 사용 가능함을 확인했다.

---

## 2. 목표

1. AI가 생성하는 다이어그램의 모든 사람이 읽는 텍스트(런타임 semantic model의 actor/responsibility/state/external 이름·설명, 최종 architecture document의 `title`/`label`/`sublabel`/boundary `label`/connection `label`/`cards`)를 한국어로 작성하도록 프롬프트를 수정한다.
2. 연결선 라벨에 불투명 배경을 그려 선/다른 라벨과 겹쳐도 읽을 수 있게 하고, 포트 간격을 넓혀 한 변에 몰리는 연결선이 덜 뭉치게 한다.
3. `codex` 에이전트 어댑터를 `@openai/codex-sdk` 기반으로 실제 구현해, 웹 UI에서 Claude와 동일하게 선택·사용할 수 있게 한다.

## 3. 비목표 (이번 라운드에서 명시적으로 제외)

- 완전한 edge-bundling/경로 교차 회피(선끼리 서로 피해 그리는 알고리즘) — 훨씬 큰 geometry 변경이 필요해 이번 스코프에서 제외. `duplicate-connection`/`label-collision` 진단은 계속 경고로만 남는다.
- 다국어(언어 선택 UI) 지원 — 앱 UI가 이미 한국어 전용으로 하드코딩돼 있으므로, 다이어그램 언어도 한국어로 고정한다. 언어 토글은 만들지 않는다.
- 이미 `.vibee/`에 커밋된 기존(영어) 다이어그램의 소급 번역 — LLM이 생성한 콘텐츠라 재분석 전까지는 그대로 영어로 남는다.
- Codex의 파일 단위 세밀한 권한 제어(Claude의 `decideToolUse`에 대응하는 경로별 Write/Edit 차단)를 그대로 재현하는 것 — Codex SDK에는 이런 API가 없다. 대신 `sandboxMode: "read-only"`로 모든 쓰기를 원천 차단하는 더 단순하고 강한 보장을 쓴다.

---

## 4. 설계

### 4.1 다이어그램 출력 언어 (`apps/bridge/src/prompt.ts`)

`buildArchitectureViewPrompt()` 템플릿에 새 섹션을 추가해 두 단계(Stage 1 semantic model, Stage 2 architecture document) 전체의 사람이 읽는 텍스트 필드를 한국어로 작성하도록 명시한다. `architecture-composition-contract.ts`가 삽입하는 예시 JSON(`packages/architecture-view/src/examples.ts`가 로드하는 `examples/runtime/*.json`)은 영어로 돼 있으므로, "예시는 구조/문법만 보여주는 것이며 실제 라벨은 예시 문구를 베끼지 말고 한국어로 작성할 것"이라는 단서를 함께 넣는다. `sources[]`의 파일 경로/코드 식별자는 번역 대상이 아님을 명시한다. 예시 JSON 파일 자체는 변경하지 않는다.

### 4.2 연결선 라벨/화살표 가독성 (`packages/architecture-view/src/render.ts`, `geometry.ts`)

- `renderConnection()`에서 `conn.label`이 있을 때 기존 `.av-connection-label-bg` 클래스를 실제로 사용하는 `<rect>`를 라벨 `<text>` 앞에 추가한다. 크기는 `labelDisplayWidth`/`labelMaskWidth`(geometry.ts)를 재사용해 텍스트 폭에 맞춰 산출한다. `<g class="av-connection">` 내부에 그려 기존 draw order(boundaries → connections → components)는 변하지 않는다.
- `geometry.ts`의 `MAX_PORT_SPACING`을 14 → 20~22 정도로 늘려 한 변에 몰리는 연결선의 화살표/선 간격을 넓힌다.
- 두 변경 모두 렌더 시점 계산이라, 기존에 저장된 문서를 재분석하지 않아도 다음 `GET /api/architecture-view` 호출부터 즉시 반영된다(`apps/bridge/src/index.ts`가 요청마다 SVG를 새로 렌더링하며 캐시하지 않음).

### 4.3 Codex 어댑터 (`apps/bridge/src/agents/codex/adapter.ts`)

`apps/bridge/src/agents/claude/adapter.ts`의 구조를 그대로 따라간다(동일한 `AgentAdapter` 인터페이스, 동일한 이벤트 흐름). `apps/bridge/package.json`에 `@openai/codex-sdk` 의존성을 추가한다.

- **`checkReady()`**: `codex --version`(설치 확인) + `codex login status`(exit 0 → 인증됨; 이 머신에서 실측 확인). `ENOENT` 시 `installed:false`.
- **`listModels()`**: `~/.codex/models_cache.json`(CLI가 채워두는 로컬 캐시, `{slug, display_name, ...}[]`)을 읽어 매핑하고, 파일이 없는 새 환경을 대비한 하드코딩 폴백 목록을 둔다.
- **`startTask()`**: `new Codex()` → `codex.startThread({ workingDirectory, skipGitRepoCheck: true, sandboxMode: "read-only", approvalPolicy: "never", webSearchEnabled: false, model? })` → `thread.runStreamed(prompt, { signal })`. MCP는 `config.mcp_servers.vibee = { command: nodeExecutable(), args: [mcpServerEntryPath()], env }`로 등록 — `packages/mcp-server`는 stdio 기반이라 수정 없이 그대로 재사용 가능(로컬 `~/.codex/config.toml`의 `[mcp_servers.*]` 포맷과 동일함을 확인함).
  - `ThreadEvent` → `AgentEvent` 매핑: `item.completed`(`agent_message`) → `agent.message.delta`; `item.completed`(`mcp_tool_call`, `server==="vibee"`) → `mcp.tool.called`(`tool: "${server}__${tool}"`, 웹 UI의 `toolLabel()`이 마지막 `"__"` 뒤 이름만 매칭하므로 Claude의 `mcp__vibee__*` 접두사와 호환됨을 확인함); `turn.completed.usage` → `agent.usage`; `turn.failed`/`error` → `task.error`. `command_execution`(셸 명령 기반 탐색) → `agent.file.explored`로의 1:1 매핑 API는 없어 이번 범위에서는 생략(웹 UI에서 부가 정보일 뿐 필수 아님).
- **`stopTask()`**: task별 `AbortController` 맵 유지 후 `abort()`. **`resetSession()`**: Claude와 동일하게 no-op.
- `apps/bridge/src/index.ts`는 이미 `agent === "claude" ? claudeAdapter : codexAdapter`로 두 어댑터를 동일 취급하므로 수정 불필요.

---

## 5. 검증 계획

1. `npm run typecheck --workspaces`
2. `npm run test --workspace @vibee/architecture-view` (`render.test.ts`/`geometry.test.ts`)
3. `npm run bridge` + `npm run web`로 `fixtures/sample-app`을 Claude로 실제 분석해 라벨이 한국어로 나오는지, 연결선 라벨 배경이 그려지는지 브라우저에서 확인
4. 동일 환경에서 `agent: "codex"`로 분석 실행해 `checkReady`부터 `architecture-view.committed`까지 실제로 도달하는지 확인

---

## 6. 핵심 파일

- `apps/bridge/src/prompt.ts` — 언어 지시 추가
- `packages/architecture-view/src/render.ts` — 연결선 라벨 배경 rect
- `packages/architecture-view/src/geometry.ts` — `MAX_PORT_SPACING` 조정
- `apps/bridge/src/agents/codex/adapter.ts` — Codex 실연동
- `apps/bridge/package.json` — `@openai/codex-sdk` 의존성
