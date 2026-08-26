/**
 * `/events` WebSocket — bridge가 정규화해 보내는 `AgentEvent`만 받는다(§6.9 B1).
 *
 * byoa-mcp-spike의 재접속 패턴을 그대로 따른다 — 실패하면 브라우저가 반드시 error 다음에
 * close를 보내므로, 재접속은 `onclose` 한 곳에서만 건다.
 */
import { useEffect, useRef, useState } from "react";

import type { AgentEvent, AgentEventEnvelope } from "@onto/protocol";

import { bridgeState, type StateResponse } from "./api.js";

export type StreamStatus = "connecting" | "open" | "closed";

export function useAgentEvents(
  onEvent: (event: AgentEvent, envelope: AgentEventEnvelope) => void,
  onStateResync?: (state: StateResponse) => void,
): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  // 최신 콜백을 매번 새 effect 없이 쓴다 — 렌더마다 소켓을 새로 열지 않는다.
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const resyncRef = useRef(onStateResync);
  resyncRef.current = onStateResync;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = (): void => {
      const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`;
      socket = new WebSocket(url);
      socket.onopen = () => {
        setStatus("open");
        // 재접속 동안 놓친 event log를 억지로 되살리지는 않는다. 대신 Bridge가 보존한
        // task/stage/usage snapshot을 즉시 다시 읽어 진행 상태가 과거에 멈춰 보이지 않게 한다.
        void bridgeState().then((state) => resyncRef.current?.(state)).catch(() => undefined);
      };
      socket.onmessage = (raw) => {
        const envelope = JSON.parse(raw.data as string) as AgentEventEnvelope;
        handlerRef.current(envelope.event, envelope);
      };
      socket.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        retry = setTimeout(connect, 1000);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return status;
}
