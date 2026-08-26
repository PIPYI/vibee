import type { AgentEvent } from "@vibee/protocol";

type ToolCallEntry = { tool: string; at: number };
type UsageEvent = Extract<AgentEvent, { type: "agent.usage" }>;

type Props = {
  projectPath: string;
  exploredFiles: string[];
  toolCalls: ToolCallEntry[];
  usage: UsageEvent | null;
  thinking: boolean;
};

// Plain-language labels for the two MCP tools the AI can call, per
// docs/v1_plan.md 4.5. The Claude Agent SDK namespaces MCP-server-provided
// tool names as `mcp__<serverName>__<toolName>` (confirmed by actually
// running a live task against this bridge in this sandbox and observing the
// real `mcp.tool.called` event -- its `tool` field is the full
// "mcp__vibee__validate_architecture_view", not the bare
// "validate_architecture_view" one might assume from the MCP tool's own
// name alone; see apps/bridge/src/agents/claude/adapter.ts's
// MCP_TOOL_PREFIX). Matching on suffix here is robust to that prefix
// without hardcoding the server name "vibee" in two places.
const TOOL_LABELS: Record<string, string> = {
  validate_architecture_view: "다이어그램 검증 중",
  submit_architecture_view: "다이어그램 제출 중",
  submit_runtime_semantics: "실행 구조 제출 중",
};

function toolLabel(tool: string): string {
  const bareName = tool.includes("__") ? tool.slice(tool.lastIndexOf("__") + 2) : tool;
  return TOOL_LABELS[bareName] ?? tool;
}

function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

export function AnalyzingConsole({ projectPath, exploredFiles, toolCalls, usage, thinking }: Props) {
  return (
    <div className="analyzing-console">
      <h1>분석 중...</h1>
      <p className="lead">
        <code>{projectPath}</code> 를 분석하고 있습니다. 완료되면 자동으로 다이어그램 화면으로 이동합니다.
      </p>

      {thinking && <p className="thinking-indicator">생각 중...</p>}

      <section>
        <h2>코드를 읽는 중...</h2>
        {exploredFiles.length === 0 ? (
          <p className="helper-text">아직 탐색한 파일이 없습니다.</p>
        ) : (
          <ul className="explored-files" aria-label="탐색한 파일 목록">
            {exploredFiles.map((path, i) => (
              <li key={`${path}-${i}`}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>진행 상황</h2>
        {toolCalls.length === 0 ? (
          <p className="helper-text">아직 검증/제출 시도가 없습니다.</p>
        ) : (
          <ul className="tool-calls" aria-label="도구 호출 로그">
            {toolCalls.map((entry, i) => (
              <li key={i}>{toolLabel(entry.tool)}</li>
            ))}
          </ul>
        )}
      </section>

      {usage && (
        <section>
          <h2>토큰 사용량</h2>
          <p className="usage-readout">
            입력 토큰 {formatNumber(usage.inputTokens)} · 출력 토큰 {formatNumber(usage.outputTokens)}
            {usage.cacheReadTokens !== undefined && <> · 캐시 읽기 {formatNumber(usage.cacheReadTokens)}</>}
            {usage.cacheWriteTokens !== undefined && <> · 캐시 쓰기 {formatNumber(usage.cacheWriteTokens)}</>}
          </p>
        </section>
      )}
    </div>
  );
}
