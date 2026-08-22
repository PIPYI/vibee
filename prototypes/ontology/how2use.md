# 사용법

이 문서는 **기능2(코드 시각화) 프로토타입을 실제로 써 보는 법**이다. 아키텍처는
[docs/ontology/ontology_schema.md](../../docs/ontology/ontology_schema.md), 구현
결정은 [docs/ontology/implementation_plan.md](../../docs/ontology/implementation_plan.md),
구현 중 관찰·검증 기록은 [FINDINGS.md](./FINDINGS.md)에 있다. MCP 채널만 따로
진단하고 싶으면 [TESTING.md](./TESTING.md)를 본다.

---

## 0. 준비물

- Node.js 20 이상
- `codex` 또는 `claude` CLI 중 **하나만 있어도 된다.** 이 저장소는 codex-cli 0.149.0으로
  검증되었다(FINDINGS.md 참고). claude는 이 시점에 로컬 검증 환경이 없어 정적으로만
  확인되었으므로, 처음 써 본다면 codex를 권한다.

```bash
# Codex 를 쓸 경우
npm i -g @openai/codex && codex login

# Claude 를 쓸 경우
npm i -g @anthropic-ai/claude-code && claude    # 첫 실행에서 로그인
```

```bash
cd prototypes/ontology
npm install
npm run build
```

---

## 1. (Codex만) MCP 서버 전역 등록

Claude는 등록이 필요 없다 — 매 요청마다 bridge가 SDK로 직접 서버를 붙여 준다. Codex는
CLI가 자기 설정 파일(`~/.codex/config.toml`)을 갖고 있으므로 한 번 등록해 둔다.

```bash
npm run mcp:register
npm run mcp:status        # onto 가 enabled 로 보이는지 확인
```

`.onto/bridge.json`을 지우거나 bridge 포트를 바꿨다면 **다시 등록해야 한다** — 등록에
그 시점의 URL·토큰이 들어가기 때문이다. 실패하면 스크립트가 수동 등록용 TOML을
그대로 출력하니 `~/.codex/config.toml`에 붙여 넣으면 된다.

---

## 2. 두 프로세스를 띄운다

```bash
# 창 1 — bridge (HTTP + WS + MCP 위임)
npm run bridge
# "listening on http://127.0.0.1:43220" 이 나와야 한다

# 창 2 — 브라우저 뷰어
npm run web
# http://127.0.0.1:5173 을 연다
```

둘 다 떠 있어야 한다. bridge가 죽으면 화면은 그대로 보이지만 어떤 요청도 응답하지
않는다.

---

## 3. 브라우저에서 프로젝트를 연다

써 볼 프로젝트가 없다면 검증용 fixture를 하나 만든다(팔로우/승인 도메인, P0~P2 evidence
전부를 덮는 작은 앱):

```bash
npm run fixture     # tmp/fixture 에 만들고 git init 까지 해 둔다
```

브라우저 화면 위쪽의 **프로젝트 경로** 입력창에 절대경로 또는 이 디렉터리 기준
상대경로(예: `tmp/fixture`)를 넣고 **선택**을 누른다.

- **아직 한 번도 분석하지 않은 프로젝트라도** 선택하는 즉시 Evidence Index가 결정론적으로
  만들어지고, 파일/심볼 목록이 바로 뜬다(EvidenceExplorer). 아무 파일이나 클릭하면
  **agent 호출 없이 즉시** Trace가 렌더된다 — Semantic Memory가 없어도 코드 구조는
  볼 수 있다는 뜻이다(§6.6).
- Concept·Claim·Scenario 같은 "의미"를 보려면 **Analyze**를 눌러야 한다. agent(codex 또는
  claude, 화면에서 고를 수 있다)가 저장소를 탐색하며 `propose_evidence`·
  `submit_semantic_patch`로 실제 patch를 커밋한다. 첫 분석은 fixture 기준 수십 초~수 분
  걸린다(모델·effort에 따라 다르다).

### 화면 흐름

```text
Overview (분석 완료 후 자동으로 뜬다)
  ↓ item 클릭 (시나리오 pill 이 있는 것)
Scenario — swimlane, branch·loop 조건 라벨, stateChange 주석
  ↓ step 클릭
Step Detail — 관련 Concept, 근거(Grounding — kind·file:line, agent 제안이면 배지)
  ↓ "실제 코드 보기"
Trace — 그 step 을 anchor 로 한 hop 그래프. nonForward 엣지는 점선 호, cycle 은 테두리색
```

breadcrumb으로 아무 단계로나 돌아갈 수 있다(캐시된 IR을 다시 받지 않고 이미 받아 둔
state를 그대로 보여준다).

### 코드를 바꾼 뒤에는

파일을 수정하고(그대로 두거나 git commit) **Analyze를 다시 누르면** 된다. 전체
재분석이 아니라 **증분 갱신**이 돈다 — 바뀐 파일만 재인덱싱하고, agent에게는 "재검토할
기존 의미"와 "아직 의미가 없는 새 근거"를 구분해서 준다. 코드가 바뀌었는데 아직
분석이 안 따라간 View는 지워지지 않고 "코드가 변경되어 아직 반영되지 않았습니다"로
표시된다.

---

## 4. 커맨드라인에서 검증하기

브라우저 없이 배선이 도는지만 보고 싶을 때. `npm run bridge`가 떠 있어야 한다.

```bash
npm run acceptance             # MCP 채널 — agent-stream · bridge-endpoint 두 증거원
npm run acceptance codex       # agent 하나만

npm test                       # 유닛 + 통합 시험 (agent CLI 불필요, 170개)

npm run eval codex             # 실제 agent turn 3개(첫 분석 → 심볼 삭제 → 기능 추가) +
                                # View Planner + §46 안정성/§7.3 evidence-origin 관측

npm run eval:index-only codex  # §7.3 비교 arm — 저장소를 직접 탐색하게 하는 것과
                                # evidence 요약만 주는 것의 차이를 같은 fixture로 잰다
```

`npm run eval`과 `npm run eval:index-only`는 **fixture를 직접 만들고 커밋까지 하므로**
`tmp/fixture` 또는 임시 디렉터리를 건드린다 — 직접 작업 중인 프로젝트가 아니라 검증용
디렉터리에만 쓴다.

---

## 5. 상태가 어디 있는지

```text
<project>/.project-intel/
  HEAD                 지금 가리키는 generation
  gen/000042/           evidence.json · semantic-memory.json · grounding.json · versions.json
  intent.json           (기능1이 쓰는 입력 — 이 프로젝트 자체는 안 만든다)
  events.ndjson         버려진 proposal 등 append-only 로그
```

프로젝트 안에 있으므로 git으로 커밋해 팀과 공유하거나 되돌릴 수 있다(`.gitignore`에
넣고 싶다면 그렇게 해도 된다 — cache 성격의 `views/`는 애초에 재생성 가능하다).

정리하고 싶으면:

```bash
npm run mcp:unregister
rm -rf tmp/fixture .onto
```

`.onto/`는 bridge 설정(포트·토큰)이고, `<project>/.project-intel/`은 분석 상태다 —
후자를 지우면 그 프로젝트의 분석 이력이 전부 사라진다.

---

## 6. 막히면

- **MCP 채널 자체가 안 되는 것 같다** (agent가 tool을 안 부르거나, 불렀는데 bridge에
  안 닿는다) → [TESTING.md](./TESTING.md)가 두 증거원을 따로 진단하는 법을 다룬다.
- **codex 프로토콜이 또 바뀐 것 같다** (승인 정책, `thread/start` 응답 모양 등) →
  `npm run codex:probe` — 추측하지 않고 `codex app-server generate-ts`로 실제 스키마를
  받아 확인한다(FINDINGS.md Finding 1·2가 이 방식으로 두 번 잡았다).
- **결과를 보고할 때** `codex --version`(또는 `claude --version`), `npm run mcp:status`,
  실패한 명령의 전체 출력, bridge 창의 로그를 같이 준다. Codex라면
  `~/.codex/sessions/**/*.jsonl`의 마지막 파일에 tool 호출 원본이 그대로 남는다.
