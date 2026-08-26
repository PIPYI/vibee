# app/ 구현 중 발견한 버그·수정 기록

`product/mvp-app` 브랜치에서 프로토타입을 실제 앱으로 옮기고 브라우저로 직접 테스트하면서
찾은 문제들이다. `docs/product_flow_decisions.md`가 "무엇을 만들지"의 결정을 담는 곳이라면,
이 문서는 "포팅·구현 과정에서 뭐가 깨졌고 어떻게 고쳤는지"를 담는다.

체크된 항목은 코드로 고치고 typecheck/build, 대부분은 실제 agent turn까지 돌려 확인했다.

## Design(인터뷰)

- [x] **대화창이 좁은 왼쪽 패널에 있었다.** 큰 오른쪽 뷰어가 아니라 좌측 컨텍스트 패널에
      질문/답변 UI가 들어 있어서 화면이 이상하게 좁았다. `DesignPanel`(설정만)과
      `DesignMain`(대화+초안)으로 분리했다.
- [x] **"인터뷰 시작" 버튼이 새 프로젝트에서도 안 보였다.** `started` 판단이 bridge의
      전역 task 목록 개수를 기준으로 했는데, 이건 다른 프로젝트의 완료 기록까지 다
      섞여 있는 목록이다. 인터뷰 전용 `interview.projectPath` 필드를 새로 만들어 기준으로
      삼았다(아래 "다른 기능을 쓰면 대화가 사라져 보임" 항목과 같은 근본 원인의 2단계 수정).
- [x] **설계 초안이 나온 뒤 답변 입력창이 사라졌다.** 대기 질문이 없으면 입력창 자체가
      안 보여서, "이건 아닌데" 하고 자유롭게 정정하는 3단계 흐름이 막혔다. 질문 유무와
      상관없이 입력창을 항상 띄우도록 고쳤다.
- [x] **`/api/state`가 설계 존재 여부를 알려주지 않았다.** `appContext.design`은
      `?design=full`을 줘야만 채워지는 필드인데, 프론트가 이걸로 "설계가 있는지"를
      판단해서 — 실제로 서버에 설계가 저장돼 있어도 화면엔 영원히 "없음"으로 보였다.
      항상 채워지는 가벼운 요약 필드 `designDigest`로 바꿨다.
- [x] **인터뷰 질문이 영어로 나왔다.** 프롬프트에 언어 지시가 아예 없었다(byoa 원본부터
      그랬다 — 처음부터 한국어 사용자를 상대하는 이 앱에서 새로 넣었다). `question`/`why`/
      `hints`를 한국어로 쓰라는 지시를 추가했다.
- [x] **hints(예시 답변)와 progress(진행도)가 화면에 안 보였다.** 데이터는 오는데 렌더링을
      안 하고 있었다. "예) A / B / C", "N개 중 M번째"로 추가했다.
- [x] **없는 프로젝트 디렉토리를 입력하면 인터뷰가 시작조차 안 됐다.**
      `canonicalizeProjectPath`가 존재하지 않는 경로를 그냥 거부했다. `mkdir(recursive:
      true)`를 추가해서, 새 앱을 처음 시작하는 경우 디렉터리를 만들어주게 했다.
- [x] **ENTITY(저장되는 것)가 사람용 설명(narrative)에 한 번도 안 보였다.** byoa 원본부터
      있던 허점이다 — `app_design.md`(agent용)에는 ENTITY가 다 실리는데 narrative에는
      아예 없어서, "저장되는 것들 사이에 관계가 없다"는 gap 경고가 떠도 사용자는 뭘 보고
      뭘 고쳐야 할지 알 수 없었다. `DesignEntity`에 `note` 필드를 추가하고(MCP tool
      스키마·인터뷰 프롬프트도 같이), narrative에 "## 무엇을 저장하나요" 절을 새로 넣었다.
- [x] **Markdown이 렌더링되지 않았다.** narrative를 그냥 `<div>`에 넣고 있어서 `#`, `**`
      같은 마크다운 기호가 화면에 글자 그대로 보였다. byoa의 작은 자체 Markdown 렌더러
      (`Markdown.tsx`, 외부 라이브러리 없음)를 그대로 이식했다.
- [x] **"고쳐 쓰라고 있는 초안"이라는 안내 문구가 빠져 있었다.** byoa 원본은 초안 아래에
      "읽어 보시고 틀린 것이 있으면 입력창에 말씀하세요"를 항상 보여주는데, 포팅 과정에서
      통째로 빠졌다. 되살렸다(입력창 위치가 바뀌어서 "아래 입력창에"로 문구만 조정).

## 여러 기능에 걸친 문제

- [x] **다른 기능(Drift 등)을 쓰면 Design의 진행 중이던 대화가 사라져 보였다.** bridge는
      프로젝트 상태를 하나만 들고 있는데, Design/Drift/Architecture/Wiki 네 기능이
      전부 액션마다 공유 필드(`appContext.projectPath`)를 자기 걸로 덮어쓴다. Design의
      "시작했는지" 판단이 이 공유 필드에 의존했던 탓에, 다른 기능을 쓰는 사이 값이 바뀌면
      Design으로 돌아왔을 때 대화 데이터는 멀쩡한데 화면만 "시작 전" 상태로 보였다.
      인터뷰 전용 `interview.projectPath` 필드를 따로 둬서 더는 다른 기능에 휘둘리지
      않게 했다.
- [x] **Codex용 MCP 서버가 아예 등록돼 있지 않았다.** `npm run mcp:register`
      (`scripts/_shared.mjs`, `register-codex-mcp.mjs`, `unregister-codex-mcp.mjs`)가
      byoa에서 app/으로 포팅되며 빠졌다. 그 결과 Codex가 이름이 같은 예전 byoa-spike
      MCP 서버로 조용히 잘못 라우팅되고 있었다 — `ask_user`/`get_app_context` 호출이
      이 앱의 bridge에 도착한 적이 없었다. 스크립트를 이식하고 `vci-app`으로 등록했다.
- [x] **WebSocket이 재연결되지 않았다.** "bridge가 죽으면 사용자가 다시 띄우고
      새로고침한다"는 byoa식 전제였는데, 개발 중에는 bridge를 자주 재시작하면서 브라우저
      탭은 그대로 열어두는 경우가 흔해서, 재시작할 때마다 실시간 업데이트가 조용히
      끊겼다. `subscribeEvents`에 자동 재연결(1초 간격)을 추가했다 — 재연결하면 bridge가
      현재 버퍼를 그대로 다시 보내주므로 놓친 이벤트도 따로 복구할 필요가 없다.
- [x] **`.project-intel/` 숨김 디렉터리 때문에 결과물을 찾기 어려웠다.** `design.json`,
      `reviews.json`, `architecture.{json,md}`를 프로젝트 루트로(`app_design.md`,
      `AGENTS.md`와 같은 레벨) 옮겼다. `wiki/`만 자기 디렉터리를 유지하되 숨김은 아니게
      했다(용어별 파일이 계속 늘어나는 구조라 루트에 flat하게 두면 지저분해지고, 사용자의
      기존 `wiki/` 폴더와 이름이 겹칠 위험도 있었다). `architecture.ts`의 스캔 제외
      목록, Drift의 git log 필터, resolutionPrompt의 경로 문구도 같이 갱신했다.
- [x] **Drift/Architecture의 resolutionPrompt(옆 coding agent에게 넘기는 프롬프트)가
      영어였다.** 정적 템플릿 문자열을 한국어로 번역했다(Architecture는 원래부터
      한국어였음 — Drift만 영어였다).
- [x] **Drift 리뷰의 summary/detail이 영어로 나왔다.** `buildReviewPrompt`에 언어 지시가
      없었다. 한국어로 쓰라는 지시를 추가했다.
- [x] **신뢰도/심각도가 영어 원문(`high`/`low`/`medium`) 그대로 표시됐다.** Drift의
      confidence("높음"/"낮음"), Architecture의 severity("높음"/"중간"/"낮음")를
      한글 라벨로 매핑했다.
- [x] **resolutionPrompt를 복사하기 번거로웠다.** "박스를 클릭하면 전체 선택" 방식이었는데,
      byoa 원본처럼 "프롬프트 복사" 버튼(Clipboard API)으로 바꿨다(Drift·Architecture
      둘 다).

## 감사(byoa 대조)로 찾은 프론트엔드 누락

Drift/Architecture/Wiki를 byoa-mcp-spike와 코드 레벨로 대조해서 찾았다. 백엔드
(프롬프트·라우트)는 전부 일치했고, 프론트엔드에서만 다음이 빠져 있었다:

- [x] **Drift**: findings 위 안내문("무엇이 맞는지는 이 앱이 정하지 않습니다...")이
      통째로 빠짐 → 추가.
- [x] **Architecture**: 각 finding의 `suggestion`(다음 행동)·`evidence`(근거)가
      데이터는 오는데 화면에 안 그려짐 → 추가.
- [x] **Wiki**: 키워드 후보의 `sample`(인용 문장)이 안 보임 → 툴팁으로 추가.
- [x] **Wiki**: "키워드 0건"과 "아직 안 찾음"을 구분 못 함 → "설명할 만한 말이
      없었습니다" 명시.
- [x] **Wiki**: 근거(`where`)가 비었을 때 아무 말도 안 함(byoa는 "근거가 비면 일반론이란
      뜻이다. 그 사실을 감추지 않는다"는 의도적 설계) → "이 프로젝트 안에서 근거를 찾지
      못했습니다" 명시.

## 새로 만든 기능

- [x] **Drift "피드백 받기"** — finding 하나를 옆 coding agent로 고친 뒤, 전체 리뷰를
      다시 돌리지 않고 그 커밋 하나만 그 기준 하나에 대해 다시 확인하는 기능. 새 MCP
      tool 2개(`get_drift_verify_context`/`verify_drift_fix`), 새 라우트
      (`/api/drift/verify`, `/internal/drift-verify-context`, `/internal/drift-verify`),
      새 프롬프트(`buildDriftVerifyPrompt`), 프론트 버튼+인라인 결과 표시.
      실제 Claude Code에게 진짜 resolutionPrompt를 먹여서 코드를 고치게 하고(`src/
      payment.js` 삭제, `src/rental.js` 원복), "피드백 받기"가 "해결됨"을 정확히
      판정하는 것까지 end-to-end로 확인했다.
- [x] **"프롬프트 → 피드백 → 다시 프롬프트" 루프와 그 종료 기준.** "피드백 받기"가
      "아직 위반"이라고 하면 그걸로 끝이었다 — 같은 프롬프트를 또 복사해봐야 agent가 뭘
      놓쳤는지 모른 채 반복만 하게 된다. 그래서 위반이 남아 있으면 지난 발견 + 이번
      확인 결과를 합친 새 프롬프트(`renderRetryResolutionPrompt`)를 서버가 만들어
      `nextPrompt`로 같이 보내고, 프론트는 다음 "피드백 받기"에 이걸 쓴다. 몇 번째
      시도인지는 버튼에 보여주되(`N번째 시도`), 이 앱은 "판단은 안 하고 보여주기만
      한다"는 원칙에 맞춰 **강제 종료 기준은 두지 않았다** — 끝나는 조건은 agent 스스로
      "해결됐다"고 판단하는 것(`resolved: true`) 하나뿐이고, 그러면 그 finding이 열린
      목록(아래 항목 참고)에서 빠진다. 위반→고침→재확인→해결을 2라운드로 실제 Claude
      Code와 함께 돌려서 확인했다(1차: 안 고치고 확인 → 아직 위반 + 새 프롬프트 생성 →
      그 프롬프트로 실제로 고침 → 2차 확인 → 해결됨). 부분 수정(파일 하나는 고치고
      다른 하나는 안 고침)도 "부분적으로만 해결됨"으로 정확히 잡아내는 것까지 확인했다.
- [x] **`npm run drift:fixture`** — Drift를 테스트하려면 인터뷰 인계 + 그 이후 커밋이
      필요한데, 실제 프로젝트에는 보통 이게 없다. byoa의 검증용 fixture 스크립트를
      이식했다: 커밋 3개(인계 → DEC-1 위반 → 무해)짜리 프로젝트를 `tmp/drift-fixture`에
      만든다. 실행할 때마다 완전히 새로 만든다.
- [x] **해결 안 된 finding이 다음 전체 리뷰에서 조용히 사라짐.** 전체 리뷰는 "각 커밋을
      자기 diff로만 판단한다"는 규칙을 지킨다 — 그런데 DEC-1을 어긴 커밋이 이미 리뷰돼서
      `lastReviewedSha`가 그 뒤로 넘어가면, **그 뒤에 오는 어떤 새 커밋의 diff에도 옛
      위반이 다시 나타나지 않으니** 다음 리뷰가 findings 0건을 정직하게 보고하는 순간
      화면에서 그 finding이 통째로 없어져 버렸다(실제로는 안 고쳐졌는데도). 실제로
      "위반 커밋 → 관련 없는 새 커밋 → 다시 리뷰"로 재현해서 확인했다. `reviews.json`에
      `resolutions`(피드백 받기가 해결됐다고 확인한 것만)를 새로 저장하고, 화면에 보여줄
      목록을 "이번 리뷰가 새로 찾은 것"이 아니라 **"지금까지 나온 finding 중 resolutions에
      없는 것 전부"**(`openFindings`)로 바꿨다. `/api/review`·`/internal/drift`·
      `/internal/drift-verify` 세 곳 모두 이 목록을 계산해서 응답/이벤트에 싣는다. 위반
      등록 → 무관한 커밋으로 재리뷰(사라지지 않음 확인) → 완전히 고치고 피드백 받기
      (목록에서 빠짐 확인)까지 3단계로 재현해서 검증했다.
      (참고로 "그럼 전체 리뷰 자체가 필요한가"도 논의했는데, 결론은 필요하다는 쪽 —
      전체 리뷰는 몰랐던 새 위반을 "발견"하는 유일한 경로이고, 피드백 받기는 이미 아는
      finding 하나를 "확인"만 할 수 있어서 새 걸 못 찾는다. 리뷰 범위(지난 리뷰 이후
      커밋들, 보통 agent 세션 하나 분량)도 이미 맞게 돼 있어서 바꿀 필요 없었다.)
- [x] **"피드백 받기"가 부분 수정을 실제로 "해결됨"이라고 잘못 판정한 사례.** 브라우저에서
      `sonnet/low`로 확인했을 때, `payment.js`는 그대로 두고 `rental.js`의 호출부만 지운
      부분 수정을 "위반 없음"으로 잘못 판정했다(같은 시나리오를 다른 세션에서 여러 번
      정확히 "아직 위반"으로 잡아냈던 것과 대조적). 원인: 이 turn에는 Read 도구가 없고,
      주는 정보는 **확인 대상 커밋 하나의 diff뿐**이다. 그 diff가 `rental.js`만 건드리고
      `payment.js`는 언급하지 않으니, agent가 "그 파일이 지금도 남아있는지"를 diff만으로는
      확인할 방법이 없어 추론에 의존해야 했고, 이번엔 그 추론이 틀렸다. `get_drift_verify_
      context`가 diff와 함께 원래 지목된 파일들의 **현재 실제 내용**(`currentFiles`, 삭제됐으면
      null)을 같이 주도록 고쳤다 — 추론이 아니라 직접 확인하게 만든 것. 같은 조건
      (`sonnet/low`, 동일 부분 수정 시나리오)으로 재현 후 재검증해서, 고친 뒤에는 정확히
      "아직 위반 — payment.js가 남아있다"고 판정하는 것을 확인했다.
- [x] **"리뷰 시작"을 누르자마자 turn이 끝나기도 전에 "위반 없음"이 떴다.** `openFindings`를
      먼저 보여주는 방식으로 바꾸면서 생긴 회귀다 — fixture를 막 리셋한 직후라 baseline
      `openFindings`가 `[]`였는데, 그걸 "확인해서 없음"으로 잘못 해석해서 turn이 실제로는
      아직 도는 중인데(패널엔 "agent가 검토하는 중..."이 떠 있는데도) 메인 화면엔 "위반
      없음"이 먼저 떠버렸다. `state.running`을 같이 봐서, turn이 도는 중이면 "agent가
      확인하는 중입니다…"를 보여주고, 진짜 끝난 뒤 없으면 그때 "위반 없음"을 보여주도록
      고쳤다.

## Architecture(구조·기술부채) 테스트

- [x] **`npm run architecture:fixture`** — byoa의 검증용 fixture 스크립트를 이식했다.
      세 검출 대상을 각각 하나씩 심는다: `src/app.js`(회원/책/대출 세 책임이 섞임 —
      다만 파일 크기 자체는 작다), `member.js`/`borrower.js`(이름 정규화 로직 중복),
      `store.js`(TODO 표시 후 커밋 5개가 더 쌓임). `design.json`은 프로젝트 루트에
      직접 쓴다(`.project-intel/` 아님 — 위 "여러 기능에 걸친 문제" 절의 평탄화 반영).
      `withDesign: false` 옵션으로 인터뷰를 거치지 않은 진입 경로(질문 7의 fallback)도
      같은 스크립트에서 만들 수 있다.
- [x] **세 카테고리 다 실제 Claude로 검증** (`app/tmp/architecture-fixture`). `duplicated-
      logic`과 `stale-temporary-workaround`를 정확히 잡았고, 특히 중복 로직 쪽은 단순
      스타일 문제가 아니라 "실제 코드 경로(app.js)로 등록한 회원은 key가 없어서
      findBorrower로 절대 못 찾는다"는 **진짜 버그**까지 짚어냈다. `oversized-module`은
      "파일 크기 자체가 작아서 근거를 못 찾았다"고 정직하게 findings에서 뺐다(억지로
      만들어내지 않음 — 문서의 "근거 없으면 finding 내지 마라" 원칙대로).
- [x] **design.json 없는 fallback도 검증** (`app/tmp/architecture-fixture-no-design`).
      같은 두 finding을 `designIds: []`로, `limitations`에 "design.json이 없어 코드만
      보고 판단했다"는 문구를 정확히 넣어서 재현했다 — 질문 7에서 정한 fallback이 코드
      레벨에서도 그대로 동작한다.
- [x] **`oversized-module` 단독 검증** (`app/tmp/oversized-test`) — 위 fixture는 파일이
      작아서 이 카테고리가 안 뜨길래, 회원/책/대출에 알림·통계·관리자 기능까지 얹은
      246줄짜리 단일 파일을 따로 만들어 돌렸다. "app.js 하나에 6개의 서로 다른 책임이
      뒤섞여 있음"으로 정확히 잡혔고, `designIds`도 REQ-1/2/3·ENT-1/2/3 전부 정확히
      매핑됐다.

## Wiki 테스트

Wiki는 git 커밋이 아니라 **실제 코딩 agent 세션의 대화 기록**을 분석 대상으로 삼는다.
Drift/Architecture처럼 파일만 손으로 심어서는 테스트할 게 없다 — 진짜 대화가 있어야
한다. byoa도 같은 이유로 fixture 스크립트 대신 실제 turn을 한 번 돌려 대화를 만드는
방식(`scripts/wiki.mjs`)을 썼는데, 그건 이 앱에 없는 `mode: "task"`(유일한 쓰기 모드,
검증 장치일 뿐 제품 경로가 아님)로 대화를 만들었다. app/은 쓰기 모드가 아예 없으므로,
대신 **실제 `claude` CLI를 독립적으로 한 번 돌려서** 진짜 세션 기록을 만들었다 —
Wiki는 "우리 앱이 시작한 대화든 옆에서 CLI로 직접 한 대화든 함께" 본다는 문서의 원칙
그대로다.

- [x] **`app/tmp/wiki-fixture`** — 빈 in-memory store 하나를 두고, 실제 `claude -p`에게
      "검색 기능을 캐시까지 써서 만들고, 비전공자에게 설명하듯 알려줘"를 시켰다. 진짜
      코드 변경(`searchItems`, `searchCache`, `nameIndex`)과 진짜 설명 대화가
      `~/.claude/projects/`에 세션으로 남았다.
- [x] **키워드 후보 추출**: "캐시", "커밋", "브랜치", "서브에이전트", "in-memory store",
      "haiku 모델" 6개를 뽑았다. 전부 실제로 비전공자가 낯설어할 개발/AI 용어이고, 이
      프로젝트의 주제어(예: "물건", "검색")는 하나도 안 뽑혔다 — 판단 기반 추출이
      의도대로 동작한다. ("서브에이전트"/"haiku 모델"이 나온 건 이 세션이 최상위
      `CLAUDE.md`의 "코딩 작업은 서브에이전트에 맡긴다" 규칙을 그대로 주워서 실제로
      위임을 언급했기 때문 — fixture를 이 저장소 안에 둬서 생긴 부수 효과인데, 오히려
      추출 다양성 검증에 도움이 됐다.)
- [x] **위키 페이지 생성**: "캐시"를 골라 페이지를 만들었다. `inThisProject`가 일반론이
      아니라 **실제 코드**(`src/store.js`의 `searchCache`, 정확한 줄 번호, `searchItems`/
      `addItem` 함수)를 근거로 설명했고, 평가성 표현(비효율적이다·이렇게 하는 게 낫다
      등)은 전혀 없었다 — "순수 학습용" 원칙대로. `wiki/캐시.json`+`.md`가 루트의
      `wiki/` 디렉터리에 정확히 생겼고, 소스 코드는 안 건드렸다.
- [x] **이미 만든 페이지 인식**: 키워드 후보를 다시 뽑으니 `existing: ["캐시"]`로
      정확히 잡혔다 — WikiPanel의 "이미 있는 페이지" 표시가 근거로 삼는 값이다.

### '내 위키' 영구 저장 (신규 기능)

기존 `wiki/<slug>.json`+`.md`는 "미리보기 캐시"로 그대로 두고, 사용자가 "내 위키로 추가"를
누른 것만 모으는 별도 저장소 `.wiki/wiki.json`(원본)+`.wiki/wiki.md`(파생물)를 프로젝트당
하나 둔다 — `design.json`/`app_design.md`와 같은 패턴. 이 기능으로 두 가지가 바뀐다:
같은 용어를 후보군에서 다시 골라도 agent turn을 다시 돌리지 않고, "내 위키"에 쌓인 페이지는
프로젝트를 다시 열었을 때 후보를 고르기 전에도 기본으로 보인다.

- [x] **재생성 회피**: `wiki/캐시.json`이 이미 있는 상태에서 `/api/wiki`에 같은 용어를
      다시 보내니, task도 만들지 않고 31ms만에 캐시된 페이지를 그대로 돌려줬다 (재시작
      직후라 활성 task 0개였는데 호출 후에도 0개 그대로 — turn이 전혀 안 돈다는 뜻).
- [x] **내 위키 추가/조회**: `/api/wiki/my/add`로 "캐시"와 "서브에이전트"를 추가하니
      `.wiki/wiki.json`에 순서대로 쌓였고, `.wiki/wiki.md`는 각 페이지를 `##` 절로 낮춰
      이어붙인 하나의 문서로 렌더링됐다 (LLM 없이, `renderWikiMarkdown`을 재사용).
- [x] **멱등성**: 같은 용어를 다시 추가해도 배열 길이가 늘지 않고 같은 자리에서
      최신 내용으로 갱신됐다 (`['캐시', '서브에이전트']` 순서 유지).
- [x] **아직 생성 안 된 용어 거부**: `wiki/<slug>.json`이 없는 용어를 `/api/wiki/my/add`에
      보내면 404 + "먼저 이 용어의 페이지를 만들어야 합니다" — 미리보기 없이 내 위키에
      바로 넣을 수 없다.
- [x] **기본 표시**: `useWikiFeature`가 `projectPath`마다 `/api/wiki/my`를 불러오고,
      `WikiMain`은 `page`(고른 후보 미리보기)가 없고 `myWiki`가 비어있지 않으면 후보를
      고르기 전에도 "내 위키" 전체를 기본으로 보여준다. 미리보기 화면에는 "내 위키로
      추가"/"내 위키에 있음" 버튼과 "← 내 위키로 돌아가기"를 달았다.
- [x] **색인**: 개념 이름으로 그 절로 이동하는 색인을 뒀다. `[[wikilink]]`는 Obsidian
      전용이라 GitHub·VS Code 미리보기에서는 그냥 텍스트로 보여서 안 썼다 — `.md`는
      `[term](#slug)` + 절 앞 `<a id="slug">` 앵커, 앱 뷰어는 같은 slug로 `href="#slug"` +
      `id="slug"`를 쓴다. slug 함수(`wikiSlug`)를 `wiki.ts`로 옮겨 파일명·앵커 두 곳이
      어긋나지 않게 했다. fixture로 4개 용어 재생성해 `.wiki/wiki.md`에
      `#in-memory-store`, `#haiku-모델` 같은 앵커가 정확히 걸리는 것을 확인했다. 앱
      뷰어 쪽은 나무위키 우측 목차처럼 평소엔 점으로만 있다가 마우스를 올리면 개념
      이름이 펼쳐지는 플로팅 형태(`.toc-fab`)로 바꿨다 — `.md`의 인라인 목록은 그대로
      둔다(파일에는 hover 개념이 없으므로).
- [x] **접이식 목차**: 플로팅 목차와 별개로, "내 위키" 제목 바로 아래 문서 흐름 안에
      나무위키식 접이식 목차 박스(`CollapsibleToc`, `.toc-box`)를 뒀다. 기본은 펼침
      상태(`open: true`)이고 헤더를 누르면 화살표가 `⌄`↔`‹`로 바뀌며 접힌다.
- [x] **맨 위/아래 이동 버튼**: 위키 문서가 길어지면(개념을 여러 개 추가할수록) 스크롤이
      길어지므로, 나무위키식으로 화면 우하단에 떠 있는 ↑/↓ 버튼을 추가했다. 실제로
      스크롤되는 대상은 `window`가 아니라 `styles.css`의 `.main`(`overflow-y: auto`)이라,
      `document.querySelector(".main")`을 찾아 `scrollTo`한다 — 앱 전체가 이 레이아웃
      하나뿐이라 셀렉터 하나로 충분하다.

## 버그는 아니지만 알아둘 것

- **Codex 사용량 한도.** 이 세션 동안 Codex(`gpt-5.6-sol`)가 사용량 한도에 걸려
  "try again at Aug 27th 12:51 AM" 에러를 반복해서 냈다. 앱 문제가 아니라 Codex
  자체의 API 한도다 — 안 되면 우선 Claude로 바꿔서 테스트한다.
- **"인터뷰 시작"은 성공 여부와 상관없이 기존 산출물부터 지운다.** 새 인터뷰를 시작하면
  `clearGeneratedArtifacts`가 `app_design.md`/`design.json`/`AGENTS.md`/`CLAUDE.md`/
  `wiki/`를 먼저 지우고 나서 turn을 돌린다. 그 turn이 사용량 한도 같은 이유로 바로
  실패해도 이미 지워진 뒤다. 원래 byoa부터 있던 동작이고(agent readiness는 미리 확인하지만
  API 사용량 한도는 실제로 turn을 돌려보기 전엔 알 수 없다), 지금은 그대로 두기로 했다 —
  다만 **Drift fixture(`tmp/drift-fixture`) 같은 다른 기능 테스트용 프로젝트 경로로
  실수로 "인터뷰 시작"을 누르면 그 프로젝트가 통째로 초기화된다**는 점은 테스트할 때
  주의해야 한다. (`npm run drift:fixture`로 다시 만들면 된다.)
- **한 번 재현 안 된 이슈**: Drift가 git log를 파싱하다 `git show ... c`처럼 커밋 sha가
  한 글자로 잘린 채 넘어가는 에러가 한 번 있었다. 소스 코드 자체(구분자)는 멀쩡했고
  `apps/bridge/dist`를 완전히 지우고 다시 빌드하니 사라졌다 — 원인은 못 밝혔다(빌드
  산출물이 일시적으로 꼬였던 것으로 추정). 또 발생하면 `rm -rf apps/bridge/dist &&
  npm run build -w @vci/bridge`로 대응한다.

## 아직 안 건드린 것

- **Drift 관계 문장에 내부 id가 그대로 섞여 나옴.** 예: "E1(주인)이 등록함". `relations`가
  구조화된 데이터가 아니라 agent가 쓰는 자유 텍스트라 id를 이름으로 자동 치환할 수
  없다. 사용자가 원하면 다룰 것.
