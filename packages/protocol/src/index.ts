/**
 * 브라우저 · local bridge · MCP server가 공유하는 wire 타입.
 *
 * 브라우저 번들이 이 모듈을 import 하므로 Node 내장 모듈을 쓰면 안 된다.
 * 파일시스템·설정 관련 헬퍼는 `@vci/protocol/node`에 둔다.
 */

export const BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_PORT = 44120;

/** 사용자의 Codex 설정에 이 MCP server가 등록될 이름. */
export const MCP_SERVER_NAME = "vci-app";

/** `/internal/*` 요청에 loopback 공유 비밀을 실어 보내는 헤더. */
export const BRIDGE_TOKEN_HEADER = "x-vci-token";

export type AgentId = "codex" | "claude";

export type SelectedItem = {
  id: string;
  label: string;
};

/**
 * agent가 `get_app_context` MCP tool을 호출했을 때 보게 되는 값.
 * docs/BYOA_MCP_INTEGRATION_SPIKE.md §9의 형태를 따른다.
 */
export type AppContext = {
  projectPath: string;
  prompt: string;
  selectedItem: SelectedItem | null;
  /** 인터뷰 spike용. agent가 지금까지의 문답을 여기서 읽는다. */
  interview: InterviewState;
  /**
   * 지금까지 저장된 설계 초안. **기본으로는 비어 있다** — `get_app_context`를
   * `includeDesign: true`로 부를 때만 채워진다.
   *
   * 초안은 다 자란 것이 12,000자가 넘는다. 그런데 그것을 써낸 agent는 같은 대화 안에
   * 이미 그 내용을 갖고 있다. 매 turn 돌려주면 자기가 방금 쓴 문서를 다시 받아 문맥에
   * 쌓는 셈이고, turn 수만큼 중복이 곱해진다 (SPIKE_FINDINGS.md §14).
   *
   * 정말 필요한 경우는 하나다 — 다른 곳에서 시작한 세션을 이어받아 초안을 고칠 때.
   * 그때만 `includeDesign`으로 지불한다.
   */
  design: DesignDoc | null;
  /**
   * 초안이 있는지, 무엇으로 이루어져 있는지만 알려주는 요약. 항상 채워진다.
   * agent는 이것을 보고 초안 전체가 필요한지 스스로 판단한다.
   */
  designDigest: DesignDigest | null;
  metadata: {
    source: "vci-app";
    timestamp: string;
  };
};

/** `DesignDoc`을 통째로 싣지 않고도 "무엇이 있는지"를 알려주는 요약. */
export type DesignDigest = {
  title: string;
  summary: string;
  counts: {
    actors: number;
    reqs: number;
    surfaces: number;
    entities: number;
    flows: number;
    rules: number;
    decisions: number;
  };
  /** 이미 쓰인 id들. 새 단위를 붙일 때 번호가 겹치지 않게 하는 용도다. */
  ids: string[];
};

/** agent가 `show_result` MCP tool로 앱에 되돌려 보내는 payload (§10). */
export type ShowResultInput = {
  title: string;
  summary: string;
  status: "success" | "warning" | "error";
  filesChanged?: string[];
  details?: string[];
};

// ---------- 설계 산출물 (docs/requirements_flow.md §4.1, §4.11) ----------

/**
 * 이 항목이 사용자의 말에서 나온 것인지, agent가 대신 채운 것인지 (§4.8).
 * 비전공자에게 "제가 정한 것"을 표시해 주기 위한 정보이며, 나중에 DEC의 근거가 된다.
 */
export type DesignSource = "user" | "ai";

export type DesignActor = { id: string; name: string; note?: string };

/** 무엇을 할 수 있는가 (= 유스케이스). */
export type DesignReq = { id: string; name: string; source: DesignSource; note?: string };

/** 어디서 하는가 (= 화면). REQ에서 도출되며 사용자에게 직접 묻지 않는다 (§4.7). */
export type DesignSurface = {
  id: string;
  name: string;
  /** 이 화면에서 할 수 있는 REQ id들. */
  shows: string[];
  source: DesignSource;
  note?: string;
};

/** 무엇이 저장되는가 + 관계 + 가질 수 있는 상태. */
export type DesignEntity = {
  id: string;
  name: string;
  /** 다른 ENTITY와의 관계를 사람이 읽는 문장으로. 예: "E2에 속한다". */
  relations: string[];
  states: string[];
  source: DesignSource;
  /** 이게 무엇을 위한 것인지 한 줄. narrative가 ENTITY를 사람에게 보여줄 때 쓴다. */
  note?: string;
};

/**
 * FLOW의 한 단계. **순서가 의미를 갖는다** — 관계(edge)로 흩어 놓으면 순서가 흐릿해지므로
 * 순서 있는 목록으로 둔다 (§4.1).
 */
export type DesignFlowStep = {
  /** 누가 (ACTOR id) */
  actor?: string;
  /** 어디서 (SURFACE id) */
  surface?: string;
  /** 무엇을 */
  action: string;
  /** 어떤 정보에 (ENTITY id) */
  entity?: string;
  /** 그 정보가 어떻게 되는가. 예: "생성", "상태 = 공개" */
  effect?: string;
  /** 이 단계에 걸리는 RULE id */
  rule?: string;
};

export type DesignFlow = { id: string; name: string; steps: DesignFlowStep[]; source: DesignSource };

/** 조건 · 제약. */
export type DesignRule = {
  id: string;
  text: string;
  /** 이 규칙이 제약하는 REQ id들. */
  constrains: string[];
  source: DesignSource;
};

/**
 * 왜 그렇게 정했는가 / 무엇을 안 하기로 했는가.
 * 이 단위가 이 기능의 차별점이다 (§4.1) — 설계 의도는 DEC 없이 보존되지 않는다.
 */
export type DesignDecision = { id: string; text: string; why: string; source: DesignSource };

/**
 * 인터뷰 산출물. **사람용 설명과 harness는 모두 이 데이터에서 렌더된다** (§5, §6).
 * 산문이 원본이고 데이터가 파생물인 것이 아니라, 그 반대다.
 */
export type DesignDoc = {
  title: string;
  /** 한 문단짜리 한 줄 요약. 무엇을 만드는 앱인지. */
  summary: string;
  actors: DesignActor[];
  reqs: DesignReq[];
  surfaces: DesignSurface[];
  entities: DesignEntity[];
  flows: DesignFlow[];
  rules: DesignRule[];
  decisions: DesignDecision[];
};

// ---------- 드리프트 리뷰 (docs/vibe_coding_assistant_design.md §3.3, §7.2) ----------

/**
 * 리뷰 turn이 받는 전부. **판단 기준은 범용 베스트프랙티스가 아니라 이 프로젝트가 정한 것**
 * 하나다 — 버그·스타일 리뷰는 이미 provider가 잘 하고, 그것은 우리 몫이 아니다.
 *
 * diff를 우리가 만들어 넘긴다. agent에게 git을 실행시키지 않으므로 리뷰 turn에는 셸도
 * 쓰기 권한도 필요 없다.
 */
export type ReviewContext = {
  /** 오래된 것부터. 한 세션이 여러 커밋을 훑는다. */
  commits: ReviewCommit[];
  /** 지켜야 할 것 전부. DEC과 RULE을 한 목록으로 준다 — agent에게는 둘 다 "정한 것"이다. */
  criteria: ReviewCriterion[];
  /** 상한에 걸려 이번 리뷰에서 빠진 커밋 수. 0이 아니면 화면이 그 사실을 말해야 한다. */
  skipped: number;
};

/**
 * 리뷰의 단위는 **커밋 하나**다.
 *
 * 커밋은 변하지 않으므로 한 번 본 커밋을 다시 볼 이유가 없다. 범위(`base..HEAD`)를 통째로
 * 보면 커밋이 하나 늘 때마다 앞의 것까지 다시 읽게 되어 비용이 커밋 수만큼 곱해진다.
 *
 * 리포트의 수명 문제도 여기서 풀린다. 코드를 고치면 **새 커밋**이 생기고 그것이 다음 리뷰
 * 대상이 되므로, 지난 코멘트를 다시 계산하거나 상태를 뒤집을 일이 없다.
 */
export type ReviewCommit = {
  sha: string;
  subject: string;
  author: string;
  /** ISO 8601. */
  at: string;
  changedFiles: string[];
  /** 이 커밋 하나의 diff. 너무 크면 잘리고 `truncated`가 참이 된다. */
  diff: string;
  truncated: boolean;
};

/** 어디부터 볼지를 무엇이 정했는가. 화면이 사용자에게 그대로 말해 준다. */
export type ReviewStart =
  /** 마지막으로 리뷰한 커밋 다음부터. */
  | "last-review"
  /** `design.json`이 들어온 커밋부터 — 설계보다 앞선 커밋은 판정 대상이 아니다. */
  | "design"
  /** 설계가 아직 커밋되지 않은 경우의 안전판. */
  | "recent"
  /** 호출자가 직접 지정했다. */
  | "explicit";

export type ReviewCriterion = {
  /** DEC-… 또는 RULE-… . 리포트가 이 id를 되짚는다. */
  id: string;
  text: string;
  /** DEC에만 있다. 왜 그렇게 정했는지. */
  why?: string;
  source: DesignSource;
};

/** agent가 `report_drift`로 되돌려 보내는 판정 하나. */
export type DriftFinding = {
  /** **어느 커밋에서** 깨졌는가. `ReviewContext.commits`에 있는 sha여야 한다. */
  commit: string;
  /** 어긋난 기준의 id. `ReviewContext.criteria`에 있는 것이어야 한다. */
  criterionId: string;
  /** 어디서 깨졌는가. 프로젝트 기준 상대 경로. */
  files: string[];
  /** 무엇이 어긋났는지 한 문장. */
  detail: string;
  confidence: "high" | "low";
  /**
   * 이 finding을 고칠 프롬프트. **agent는 이 필드를 채우지 않는다** — bridge가
   * `criterionId`로 찾은 criterion과 함께 `/internal/drift`에서 렌더해 붙인다
   * (§3.3 표의 "해소 프롬프트" 행, LLM 없음).
   *
   * 판단과 실행 둘 다 이 프롬프트를 받는 **사용자의 옆 agent**가 한다 — 코드가 잘못됐으면
   * 코드를, 결정이 낡았으면 `design.json`의 그 항목만 고친다. 우리 앱은
   * 어느 쪽이 맞는지 정하지 않는다.
   */
  resolutionPrompt?: string;
};

/**
 * 리뷰 turn의 결론. **위반이 없으면 `findings`가 빈 배열이다** — 그 경우에도 반드시
 * 호출해야 한다. "조용히 끝났다"와 "확인했고 문제 없다"를 구분할 수 없으면 오탐 시험이
 * 성립하지 않는다.
 */
export type ReportDriftInput = {
  findings: DriftFinding[];
  /** 무엇을 근거로 그렇게 판단했는지 한 문단. */
  summary: string;
};

/**
 * finding 하나를 고친 뒤 "됐는지" 다시 확인하는 요청. **이 커밋 하나만 본다** — 지난
 * 리뷰 이후 전체를 다시 훑는 것이 아니라, 옆에 띄운 agent가 이 finding을 고치려고 막
 * 만든 커밋 하나가 실제로 그 기준을 지키는지만 본다.
 */
export type VerifyDriftFixRequest = {
  agent: AgentId;
  projectPath: string;
  /** 원래 finding이 걸렸던 커밋. 지금 HEAD가 이것과 같으면 아직 새 커밋이 없다는 뜻이다. */
  commit: string;
  criterionId: string;
  files: string[];
  /** 원래 finding의 detail. 이번 turn이 "무엇이 고쳐져야 하는지"를 다시 알 필요가 있다. */
  detail: string;
  model?: string;
  effort?: string;
};

/** 검증 turn이 `get_drift_verify_context`로 받는 전부. */
export type DriftVerifyContext = {
  originalCommit: string;
  criterionId: string;
  criterionText: string;
  criterionWhy?: string;
  originalDetail: string;
  files: string[];
  /** 원래 finding 이후 실제로 확인하는 커밋. HEAD다. */
  checkedCommit: string;
  checkedCommitSubject: string;
  diff: string;
  truncated: boolean;
  /**
   * 원래 지목됐던 파일들의 **지금(checkedCommit 시점) 실제 내용**. 이 turn에는 Read
   * 도구가 없고 diff는 checkedCommit 하나의 변경분만 보여준다 — 그 diff가 이 파일을
   * 건드리지 않았다면 agent는 "지금도 그대로 있는지"를 diff만으로는 알 수 없다.
   * 파일이 없으면(지워졌으면) `content`가 null이다.
   */
  currentFiles: Array<{ path: string; content: string | null; truncated: boolean }>;
};

/** agent가 `verify_drift_fix`로 되돌려 보내는 판정. */
export type VerifyDriftFixInput = {
  resolved: boolean;
  /** 한 문장. 한국어로 — 화면에 그대로 뜬다. */
  detail: string;
};

// ---------- 아키텍처·기술부채 ----------

export type ArchitectureDebtCategory =
  | "oversized-module"
  | "duplicated-logic"
  | "stale-temporary-workaround";

/** 인터뷰 설계에서 구조 점검의 기준으로 가져온 REQ/ENTITY. */
export type ArchitectureDesignRef = {
  id: string;
  name: string;
  kind: "REQ" | "ENTITY";
};

/** 크기와 설계 단위 매핑을 코드가 결정론적으로 준비한 파일 하나. */
export type ArchitectureFileSignal = {
  path: string;
  bytes: number;
  lines: number;
  /** 2MB 상한 안에서 본문까지 읽어 시그니처·설계 매핑을 준비했는가. */
  contentScanned: boolean;
  /** 파일명/본문에서 설계 단위 이름을 그대로 확인한 경우만 채운다. */
  matchedDesignIds: string[];
};

/** 의미가 같은 로직인지 agent가 비교할 함수/메서드 후보. */
export type ArchitectureSignature = {
  path: string;
  line: number;
  signature: string;
};

/** 오래 방치됐는지 agent가 판단할 임시 조치 후보. */
export type ArchitectureTemporaryMarker = {
  path: string;
  line: number;
  text: string;
  commit: string | null;
  committedAt: string | null;
  commitsSince: number | null;
};

/** `get_architecture_context`가 주는 결정론적 구조 점검 입력. */
export type ArchitectureContext = {
  designRefs: ArchitectureDesignRef[];
  files: ArchitectureFileSignal[];
  signatures: ArchitectureSignature[];
  temporaryMarkers: ArchitectureTemporaryMarker[];
  scannedFiles: number;
  currentCommit: string | null;
  truncated: {
    files: number;
    signatures: number;
    temporaryMarkers: number;
  };
};

/** 실제 코드 근거가 있는 기술부채 하나. */
export type ArchitectureDebtFinding = {
  category: ArchitectureDebtCategory;
  severity: "high" | "medium" | "low";
  title: string;
  /** 코드가 현재 어떤 구조인지에 대한 설명. */
  explanation: string;
  /** 사용자 기능 확장이나 유지보수에 주는 영향. */
  impact: string;
  /** 실제로 읽고 판단한 프로젝트 기준 상대 경로. */
  files: string[];
  /** 함수 위치, 설계 id, TODO의 나이처럼 화면에 그대로 보일 구체적인 근거. */
  evidence: string[];
  /** 이 finding이 설계 경계를 근거로 삼은 경우의 REQ/ENTITY id. */
  designIds: string[];
  /** 연결된 코딩 에이전트에게 맡길 수 있는 다음 행동 한 가지. */
  suggestion: string;
  /** Bridge가 결정론적 템플릿으로 채운다. agent 입력에는 없다. */
  resolutionPrompt?: string;
};

/** 읽기 전용 architecture turn이 앱에 제출하는 전체 결과. */
export type ArchitectureDebtReport = {
  summary: string;
  findings: ArchitectureDebtFinding[];
  /** 분석에서 확인하지 못했거나 제외한 범위. */
  limitations: string[];
  /** Bridge가 저장 시점에 채운다. */
  generatedAt?: string;
  /** 분석한 현재 git snapshot. 저장소가 아니거나 커밋이 없으면 null. */
  commit?: string | null;
};

// ---------- 위키 (docs/vibe_coding_assistant_design.md §3.5) ----------

/**
 * 세션에서 뽑아낸 대화 한 줄. provider가 다르지만 이 형태로 맞춰서 올라온다.
 */
export type TranscriptMessage = { role: "user" | "agent"; text: string };

/**
 * 위키 후보 키워드.
 *
 * **agent가 고른다.** 처음에는 빈도로 뽑았는데 완전히 실패했다 — 실제 대화에 돌리니
 * `wait` · `getting` · `turn` 같은 것이 상위를 차지했다. 당연한 일이다.
 * **빈도는 낯섦과 반대 방향이다** — 가장 자주 나오는 말이 가장 익숙한 말이다.
 * "비전공자가 모를 만한 말"은 세는 일이 아니라 판단이므로 세는 쪽에 맡길 수 없다
 * (SPIKE_FINDINGS.md §16).
 *
 * 세는 일은 그대로 코드가 한다 — agent가 몇 번 나왔는지를 정확히 세지는 못한다.
 */
export type WikiKeyword = {
  term: string;
  /** 왜 이 말이 궁금할 만한가. 사용자가 고를 때 보는 근거다. */
  why: string;
  /** 이 말이 나온 문장 하나. 사용자가 "아 이거" 하고 알아보게 하는 용도다. */
  sample: string;
  /** 대화에 몇 번 나왔는지. bridge가 센다. */
  count: number;
};

/** 위키 키워드 turn이 읽는 대화. 코드 블록과 우리 래퍼를 걷어내고 상한까지 자른 것. */
export type WikiTranscript = {
  messages: TranscriptMessage[];
  /** 상한에 걸려 빠진 메시지 수. */
  skipped: number;
};

/**
 * 위키 페이지. **순수 학습용이다** — 가치판단을 담지 않는다.
 *
 * "이건 위험합니다", "X가 더 낫습니다", "재검토가 필요합니다"는 전부 이 기능이 하는 일이
 * 아니다. 드리프트 판정과 역할이 다르고, 섞이면 둘 다 못 쓰게 된다.
 *
 * 그리고 **일반론이면 만들 이유가 없다.** 같은 설명을 검색으로 얻을 수 있다면 우리가 할 일이
 * 아니다. 가치는 `inThisProject`와 `where`에 있다 — 이 프로젝트에서 그 말이 무엇을 가리키는지.
 */
export type WikiPageInput = {
  term: string;
  /** 비전공자의 말로 한 줄. 기술 용어로 기술 용어를 설명하지 않는다. */
  oneLine: string;
  /** 이 앱에서 이것이 무엇을 하는가. 이 기능의 존재 이유다. */
  inThisProject: string;
  /** 근거. 실제 파일 경로 또는 REQ/FLOW/DEC id. 비어 있으면 일반론이라는 뜻이다. */
  where: string[];
  /** 같이 알아두면 좋은 다른 키워드. 다음에 읽을 것을 잇는다. */
  related: string[];
};

export type WikiPage = WikiPageInput & { createdAt: string };

/**
 * '내 위키' — 사용자가 후보 중에서 명시적으로 고른 페이지만 모은 것. 프로젝트 디렉터리당
 * 하나만 존재한다 (`.wiki/wiki.json`). 후보를 눌러 미리보기를 만드는 것과는 별개다 —
 * 미리보기는 자동으로 캐시(`wiki/<slug>.json`)에만 쌓이고, "내 위키로 추가"를 눌러야 여기 들어간다.
 */
export type MyWikiAddRequest = { projectPath: string; term: string };
export type MyWikiResponse = { pages: WikiPage[] };

/** 위키 turn이 받는 것. 그 말이 실제로 오간 대목과 설계를 함께 준다. */
export type WikiContext = {
  term: string;
  /** 그 말이 나온 대화 대목들. 무엇을 가리키는지는 여기에 있다. */
  mentions: string[];
  design: DesignDoc | null;
};

export type McpToolName =
  | "get_app_context"
  | "show_result"
  | "ask_user"
  | "save_design"
  | "get_review_context"
  | "report_drift"
  | "get_drift_verify_context"
  | "verify_drift_fix"
  | "get_architecture_context"
  | "report_architecture"
  | "get_wiki_transcript"
  | "save_wiki_keywords"
  | "get_wiki_context"
  | "save_wiki";

/**
 * agent가 `ask_user` MCP tool로 던지는 질문 (docs/requirements_flow.md §4.3).
 *
 * 이 tool은 **블로킹하지 않는다.** 질문을 등록만 하고 즉시 반환하며, agent는 곧바로 turn을
 * 끝낸다. MCP tool 호출에는 하드 월클럭 타임아웃이 있어 사람의 답을 기다릴 수 없기 때문이다.
 * 답변은 다음 turn에서 `get_app_context`로 읽는다.
 */
export type AskUserInput = {
  question: string;
  /** 왜 묻는지. 비전공자가 불안해하지 않도록. */
  why?: string;
  /** 선택지가 아니라 **예시**. 백지를 마주하는 부담만 덜어준다. */
  hints?: string[];
  progress?: { step: number; total: number };
};

export type PendingQuestion = AskUserInput & {
  id: string;
  askedAt: string;
};

export type InterviewExchange = {
  /** 대기 중인 질문에 답한 것이면 그 질문. 사용자가 먼저 꺼낸 말이면 빈 문자열. */
  question: string;
  answer: string;
  answeredAt: string;
};

/**
 * 인터뷰에 말을 건다 (docs/requirements_flow.md §4.5, §4.10 3단계).
 *
 * **질문이 대기 중이 아니어도 보낼 수 있다.** 초안이 나온 뒤 "이건 아닌데", "이것도 필요해"
 * 라고 말하는 것이 인터뷰의 3단계이며, 자유 채팅은 항상 열려 있어야 한다.
 */
export type InterviewMessageRequest = {
  agent: AgentId;
  projectPath: string;
  message: string;
  model?: string;
  effort?: string;
};

/** 인터뷰 진행 상태. `get_app_context`에 실려 agent가 앞선 문답을 확인한다. */
export type InterviewState = {
  pending: PendingQuestion | null;
  exchanges: InterviewExchange[];
  /**
   * 이 인터뷰가 어느 프로젝트 경로에서 시작됐는지. `AppContext.projectPath`는 Design 말고도
   * Drift/Architecture/Wiki가 액션마다 같이 덮어쓰는 공유 필드라, "지금 화면에 입력된 경로와
   * 이 인터뷰가 같은 프로젝트인가"를 그걸로 판단하면 다른 기능을 쓰는 사이 값이 바뀌어
   * 대화가 있는데도 없는 것처럼 보일 수 있다. 그래서 인터뷰 전용으로 따로 둔다.
   */
  projectPath: string | null;
};

/**
 * provider에 종속되지 않는 이벤트 모델 (§15). Codex 프로토콜 객체는 bridge에서
 * 이 union으로 정규화되며, raw 상태로 브라우저에 도달하지 않는다.
 */
export type AgentEvent =
  | { type: "task.started"; taskId: string; agent: AgentId; projectPath: string }
  /**
   * 이 task가 어느 세션에서 도는지. `resumed: false`면 새로 만들어진 세션이고,
   * `true`면 같은 프로젝트에서 이전 turn을 이어받은 것이다. 브라우저가 "새 대화인지
   * 이어지는 대화인지"를 보여주는 근거가 된다.
   */
  | { type: "agent.session"; taskId: string; sessionId: string; resumed: boolean }
  | { type: "agent.message.delta"; taskId: string; text: string }
  | { type: "agent.action.started"; taskId: string; name: string; detail?: unknown }
  | { type: "agent.action.completed"; taskId: string; name: string; detail?: unknown }
  | { type: "mcp.tool.called"; taskId: string; tool: McpToolName | string; source: "agent-stream" | "bridge-endpoint" }
  | { type: "app.result"; taskId: string; result: ShowResultInput }
  | { type: "app.design"; taskId: string; design: DesignDoc }
  /**
   * 리뷰 turn의 결론. **findings가 비어 있어도 온다** — 그것이 "확인했고 문제 없다"이다.
   * `openFindings`는 이번 run의 findings와는 별개로, 지금까지 해결 확인이 안 된 전체
   * 목록이다 — 화면은 `report.findings`가 아니라 이걸 기준으로 그린다.
   */
  | { type: "app.drift"; taskId: string; report: ReportDriftInput; openFindings: DriftFinding[] }
  /** finding 하나를 "피드백 받기"로 다시 확인한 결과. `originalCommit`+`criterionId`로 어느
   *  finding에 대한 것인지 화면에서 찾아 붙인다. */
  | {
      type: "app.drift.verify";
      taskId: string;
      originalCommit: string;
      criterionId: string;
      checkedCommit: string;
      result: VerifyDriftFixInput;
      /** 아직 위반일 때만 있다 — 이번 실패를 반영해 다시 만든 resolutionPrompt. */
      nextPrompt?: string;
      /** 해결됐으면 그 finding이 빠진, 갱신된 열린 목록. */
      openFindings: DriftFinding[];
    }
  | { type: "app.architecture"; taskId: string; report: ArchitectureDebtReport }
  | { type: "app.wiki"; taskId: string; page: WikiPage }
  /** 위키 후보 키워드가 정해졌다. 사용자가 여기서 하나를 고른다. */
  | { type: "app.wiki.keywords"; taskId: string; keywords: WikiKeyword[] }
  | { type: "app.question"; taskId: string; question: PendingQuestion }
  | { type: "app.answer"; taskId: string; questionId: string; answer: string }
  | { type: "system-map.committed"; taskId: string }
  | { type: "task.completed"; taskId: string }
  | { type: "task.interrupted"; taskId: string }
  | { type: "task.error"; taskId: string; message: string };

/** 전송되는 모든 이벤트는 단조 증가하는 seq와 타임스탬프를 함께 갖는다. */
export type AgentEventEnvelope = {
  seq: number;
  at: string;
  event: AgentEvent;
};

export type TaskStatus = "starting" | "running" | "completed" | "interrupted" | "error";

export type TaskState = {
  taskId: string;
  agent: AgentId;
  projectPath: string;
  prompt: string;
  selectedItem: SelectedItem | null;
  threadId?: string;
  turnId?: string;
  status: TaskStatus;
  /** 이 task에 적용된 오버라이드. 생략되면 provider 기본값으로 돈 것이다. */
  model?: string;
  effort?: string;
  startedAt: string;
  endedAt?: string;
  error?: string;
  /** 이 task에서 관측된 MCP tool 호출. 두 증거원(agent-stream / bridge-endpoint) 모두 기록한다. */
  mcpCalls: Array<{ tool: string; at: string; source: "agent-stream" | "bridge-endpoint" }>;
  result?: ShowResultInput;
  design?: DesignDoc;
};

/**
 * reasoning effort 하나. id는 provider가 쓰는 원문 값이다 — Codex에는 `ultra`가 있고
 * Claude에는 없으므로 공용 enum으로 고정하지 않는다.
 */
export type EffortOption = {
  id: string;
  description?: string;
};

/**
 * agent가 쓸 수 있는 모델 하나.
 *
 * 이 목록은 **provider가 스스로 신고한 것**을 bridge가 정규화한 결과다
 * (Codex는 `model/list` RPC, Claude는 `Query.supportedModels()`). 하드코딩하지 않는 이유는
 * CLI를 업데이트하면 목록이 바뀌기 때문이다. 브라우저는 이 배열을 그대로 렌더링할 뿐
 * 어느 provider인지 알지 못한다.
 */
export type ModelOption = {
  id: string;
  label: string;
  description?: string;
  /** 이 모델이 지원하는 effort. 빈 배열이면 effort 개념이 없는 모델이다 (예: Claude haiku). */
  efforts: EffortOption[];
  /** provider가 기본으로 쓰는 effort. 모르면 생략된다 (Claude는 알려주지 않는다). */
  defaultEffort?: string;
  /** provider가 기본으로 고르는 모델인지. 브라우저의 초기 선택값이 된다. */
  isDefault: boolean;
};

/**
 * 이어받을 수 있는 기존 세션 하나 (docs/requirements_flow.md §7).
 *
 * provider마다 부르는 이름이 다르다 — Codex는 thread, Claude는 session. 브라우저는
 * 그 차이를 알 필요가 없으므로 여기서 하나로 맞춘다.
 */
export type SessionSummary = {
  id: string;
  /** 첫 사용자 메시지. 어떤 대화였는지 알아보게 한다. */
  preview: string;
  updatedAt: string;
  /** bridge가 지금 이 세션을 물고 있는지. 물고 있으면 이어받기가 아니라 이미 이어져 있다. */
  active: boolean;
};

export type AgentSessionsResponse = {
  agent: AgentId;
  projectPath: string;
  sessions: SessionSummary[];
};

/** 기존 세션에 붙는다. 다음 turn부터 그 대화를 이어받는다. */
export type ResumeSessionRequest = {
  agent: AgentId;
  projectPath: string;
  sessionId: string;
};

/**
 * agent 말고 앱이 기대는 외부 도구 (지금은 git 하나).
 *
 * **원격 저장소는 쓰지 않는다.** git이 필요한 이유는 사용자가 되돌릴 지점을 갖기 위해서다 —
 * 비전공자는 무언가 잘못됐을 때 되돌리는 법을 모른다 (docs/requirements_flow.md §6).
 */
export type ToolReadiness = {
  tool: "git";
  installed: boolean;
  version?: string;
  /** 없을 때 사람이 읽을 안내. */
  message?: string;
};

export type HealthResponse = {
  ok: boolean;
  agents: AgentReadiness[];
  tools: ToolReadiness[];
};

export type AgentModelsResponse = {
  agent: AgentId;
  models: ModelOption[];
};

export type AgentReadiness = {
  agent: AgentId;
  installed: boolean;
  authenticated: boolean | "unknown";
  version?: string;
  /** agent를 쓸 수 없을 때 사람이 읽을 수 있는 사유. */
  message?: string;
};

// ---------- 브라우저 <-> Bridge HTTP API ----------

export type StartTaskRequest = {
  agent: AgentId;
  projectPath: string;
  prompt: string;
  appContext?: {
    selectedItem?: SelectedItem | null;
  };
  /** 인터뷰 모드로 시작한다. 프롬프트가 ask_user 사용을 지시하는 형태로 감싸진다. */
  mode?: "task" | "interview";
  /**
   * 모델·effort 오버라이드. 생략하면 provider가 자기 기본값을 쓴다.
   * 값의 유효 범위는 provider마다 다르므로 여기서는 문자열로만 다루고, 검증은 adapter가 한다.
   */
  model?: string;
  effort?: string;
};

export type StartTaskResponse = {
  taskId: string;
  /**
   * 인터뷰를 새로 시작하면서 프로젝트에서 지운 지난 산출물. 새 인터뷰는 새 프로젝트이므로
   * 지난 설계와 하네스를 남겨 두지 않는다. 사용자 파일이 사라진 것을 조용히 넘기지 않기 위해
   * 무엇을 지웠는지 그대로 올려 보낸다.
   */
  cleared?: string[];
};

/**
 * 드리프트 리뷰를 시작한다 (§3.3).
 *
 * **코드를 고치지 않는다.** 리뷰 turn은 읽기 전용이고, 어긋난 것이 나오면 그것을 고칠
 * 프롬프트를 사용자에게 건넨다. 고치는 일은 사용자가 쓰는 agent가 한다 — 우리 앱은
 * 코드를 쓰는 곳이 아니라 보는 곳이다.
 */
export type StartReviewRequest = {
  agent: AgentId;
  projectPath: string;
  /**
   * 이 ref **다음** 커밋부터 본다. 생략하면 bridge가 정한다 — 마지막 리뷰 지점, 없으면
   * 설계가 들어온 커밋, 그것도 없으면 최근 것들 (`ReviewStart`).
   */
  since?: string;
  model?: string;
  effort?: string;
};

export type StartReviewResponse = {
  taskId: string | null;
  /** 이번에 볼 커밋들. 오래된 것부터. */
  commits: Array<{ sha: string; subject: string }>;
  /** 어디부터 볼지를 무엇이 정했는지. */
  start: ReviewStart;
  /** 상한에 걸려 빠진 커밋 수. */
  skipped: number;
  /** 기준이 하나도 없으면 리뷰가 성립하지 않는다. 그 사실을 조용히 넘기지 않는다. */
  criteriaCount: number;
  /**
   * 지금까지 나온 finding 중 아직 "피드백 받기"로 해결 확인이 안 된 것들. 이번 리뷰가
   * 새로 뭘 찾았는지와 무관하게 항상 이 목록을 기준으로 화면을 그린다 — 그래야 안 고쳐진
   * 옛날 finding이 새 리뷰를 돌릴 때마다 사라지지 않는다. turn이 끝나기 전에 즉시 알 수
   * 있도록 이 응답에도 싣는다.
   */
  openFindings: DriftFinding[];
};

/** 기존 코드베이스 전체의 아키텍처와 기술부채 분석을 시작한다. */
export type StartArchitectureRequest = {
  agent: AgentId;
  projectPath: string;
  model?: string;
  effort?: string;
};

export type StartArchitectureResponse = {
  taskId: string;
};

/**
 * `reviews.json`. **어디까지 봤는지**가 남는 곳이다.
 *
 * 이것이 없으면 켤 때마다 처음부터 다시 본다. 커밋은 변하지 않으므로 한 번 본 것을
 * 다시 볼 이유가 없고, 다시 보면 비용만 커밋 수만큼 곱해진다.
 */
export type ReviewLog = {
  /** 마지막으로 리뷰가 끝난 커밋. 다음 리뷰는 이 다음부터 본다. */
  lastReviewedSha: string | null;
  runs: ReviewRun[];
  /**
   * "피드백 받기"가 해결됐다고 확인한 것들. 여기 없는, 과거 run에 남아 있는 finding은
   * 전부 아직 열려 있다고 본다 — 새 리뷰가 그 finding을 다시 언급하지 않아도(자기 diff만
   * 보므로 당연히 그렇다) 조용히 화면에서 사라지면 안 되기 때문이다.
   */
  resolutions: DriftResolution[];
};

export type ReviewRun = {
  at: string;
  agent: AgentId;
  /** 이번 run이 본 커밋들. 오래된 것부터. */
  commits: string[];
  findings: DriftFinding[];
  summary: string;
};

/** "피드백 받기"가 어떤 finding을 해결됐다고 확인했다는 기록. */
export type DriftResolution = {
  originalCommit: string;
  criterionId: string;
  resolvedAt: string;
  /** 그 finding을 해결했다고 확인된 실제 커밋. */
  checkedCommit: string;
};

/**
 * 후보 키워드를 뽑는 turn을 시작한다. 결과는 `app.wiki.keywords` 이벤트로 온다.
 * 위키 패널을 열 때 한 번 돌고, 키워드마다 돌지 않는다.
 */
export type StartWikiKeywordsRequest = {
  agent: AgentId;
  projectPath: string;
  model?: string;
  effort?: string;
};

export type StartWikiKeywordsResponse = {
  /** 대화가 하나도 없으면 null. 그 경우 turn을 돌리지 않는다. */
  taskId: string | null;
  /** 훑은 메시지 수. */
  messages: number;
  /** 이미 만들어 둔 페이지의 term들. 화면이 "이미 있음"을 표시하는 데 쓴다. */
  existing: string[];
};

export type StartWikiRequest = {
  agent: AgentId;
  projectPath: string;
  term: string;
  model?: string;
  effort?: string;
};

/**
 * 프로젝트에 묶인 세션을 놓아준다. 다음 task는 새 세션에서 시작한다.
 * 세션 자체를 지우는 것이 아니라 bridge가 들고 있던 참조만 버린다 —
 * 이전 세션은 디스크에 그대로 남아 CLI에서 이어받을 수 있다.
 */
export type ResetSessionRequest = {
  agent: AgentId;
  projectPath: string;
};

/**
 * 인계 (docs/requirements_flow.md §7).
 *
 * `agent`는 사용자가 실제로 쓰는 도구다. **그 도구의 harness만 만든다** —
 * Codex면 `AGENTS.md`, Claude Code면 `CLAUDE.md`. 둘 다 깔아 두면 어긋났을 때
 * 무엇이 맞는지 알 수 없다.
 */
export type ExportDesignRequest = {
  agent: AgentId;
  projectPath: string;
};

export type ExportDesignResponse = {
  projectPath: string;
  written: string[];
  /** 저장소가 없어서 새로 만들었다면 true. 되돌릴 지점을 확보하기 위한 것이다. */
  gitInitialized: boolean;
  /** 사람이 쓴 파일이라 건너뛴 것. 말없이 덮어쓰지 않는다. */
  skipped: string[];
  /** 비전공자가 빈 창을 마주하지 않도록 (§7). */
  firstPrompt: string;
  gaps: string[];
};

export type AppContextPatch = {
  projectPath?: string;
  prompt?: string;
  selectedItem?: SelectedItem | null;
};

export type BridgeStateResponse = {
  /** `npm run fixture`가 만드는 fixture 경로. 브라우저 입력창의 초기값으로 쓴다. */
  defaultProjectPath: string;
  appContext: AppContext;
  activeTaskId: string | null;
  tasks: TaskState[];
  design: DesignDoc | null;
  /** 비어 있는 단위에 대한 안내. 진행을 막지 않는다 (§4.10). */
  designGaps: string[];
};

export type ErrorResponse = { error: string };

// ---------- 시스템 맵 (vibee의 architecture-view/runtime-semantic 포팅) ----------

/** 시스템 런타임의 근거. RuntimeSemanticDocument는 좌표를 갖지 않으며 audience별 표현도 없다. */
export type SourceRef = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

export type ImplementationHint = {
  label: string;
  kind?: "framework" | "library" | "protocol" | "vendor" | "database" | "queue" | "runtime" | "other";
};

export type RuntimeActor = {
  id: string;
  label: string;
  sources?: SourceRef[];
};

export type RuntimeUnitKind =
  | "mobile"
  | "web"
  | "desktop-renderer"
  | "desktop-main"
  | "server"
  | "worker"
  | "cli"
  | "embedded"
  | "other";

export type RuntimeUnit = {
  id: string;
  label: string;
  kind: RuntimeUnitKind;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeResponsibility = {
  id: string;
  runtimeId: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeState = {
  id: string;
  runtimeId?: string;
  label: string;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeExternal = {
  id: string;
  label: string;
  kind?: "api" | "auth" | "storage" | "database" | "queue" | "service" | "other";
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeInteractionKind = "user-action" | "request" | "event" | "auth" | "state-read" | "state-write" | "other";

export type RuntimeInteraction = {
  id: string;
  from: string;
  to: string;
  label: string;
  kind?: RuntimeInteractionKind;
  implementationHints?: ImplementationHint[];
  sources: SourceRef[];
};

export type RuntimeSemanticDocument = {
  schemaVersion: 1;
  title: string;
  repository?: {
    url?: string;
    revision?: string;
  };
  actors: RuntimeActor[];
  runtimes: RuntimeUnit[];
  responsibilities: RuntimeResponsibility[];
  states: RuntimeState[];
  externals: RuntimeExternal[];
  interactions: RuntimeInteraction[];
};

/** 시스템 맵 컴포넌트 타입 */
export type SystemMapComponentType =
  | "frontend"
  | "backend"
  | "database"
  | "cloud"
  | "security"
  | "messagebus"
  | "external";

export type SystemMapSource = {
  path: string;
  line?: number;
  endLine?: number;
  label?: string;
};

/** RuntimeSemanticDocument 엔티티의 역할 */
export type SystemMapSemanticRole = "actor" | "responsibility" | "state" | "external";

export type SystemMapComponent = {
  id: string;
  type: SystemMapComponentType;
  semanticRole: SystemMapSemanticRole;
  semanticRefs: string[];
  label: string;
  sublabel?: string;
  pos: [number, number];
  size: [number, number];
  sources?: SystemMapSource[];
};

export type SystemMapBoundary = {
  id?: string;
  kind: "runtime" | "region" | "security-group";
  semanticRefs?: string[];
  label: string;
  wraps: string[];
  pad?: number;
};

export type SystemMapConnection = {
  id?: string;
  from: string;
  to: string;
  semanticRefs?: string[];
  label?: string;
  variant?: "default" | "emphasis" | "security" | "dashed";
};

export type SystemMapCard = {
  dot?: string;
  title: string;
  items: string[];
};

export type SystemMapDocument = {
  schemaVersion: 2;
  title: string;
  viewBox?: [number, number];
  repository?: { url?: string; revision?: string };
  components: SystemMapComponent[];
  boundaries: SystemMapBoundary[];
  connections: SystemMapConnection[];
  cards?: SystemMapCard[];
};

/** 검증 진단 심각도 */
export type DiagnosticSeverity = "error" | "warning";

export type Diagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** 예: 컴포넌트/연결 id */
  subject?: string;
  /** 구조화된 세부 사항 (예: 겹침 크기, 잘못된 rect) */
  evidence?: unknown;
  /** 사람이 읽을 수 있는 단문 힌트 문자열 */
  supportedFixes?: string[];
};

export function hasError(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
