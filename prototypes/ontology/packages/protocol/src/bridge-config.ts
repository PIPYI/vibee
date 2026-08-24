/**
 * loopback 설정. bridge · MCP server · 등록 스크립트가 **같은 함수를 거쳐** 서로 맞는
 * URL/토큰 쌍을 얻는다 (B1).
 *
 * Node 전용이다. 브라우저는 이 모듈을 import 하지 않는다.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "./agent.js";
import type { SystemIntelligenceV4Mode } from "./index.js";

const ROOT_PACKAGE_NAME = "ontology-proto";

/** `startPath`에서 위로 올라가며 프로토타입 루트를 찾는다. */
export function findProtoRoot(startPath: string): string {
  let dir = resolve(startPath);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === ROOT_PACKAGE_NAME) return dir;
      } catch {
        // 읽을 수 없는 package.json 이 중간에 있어도 치명적이지 않다. 계속 올라간다.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`${ROOT_PACKAGE_NAME} 루트를 ${startPath} 위에서 찾지 못했습니다`);
    dir = parent;
  }
}

export function protoRootFromModule(moduleUrl: string): string {
  return findProtoRoot(dirname(fileURLToPath(moduleUrl)));
}

export type BridgeConfig = {
  port: number;
  /** `/internal/*`에 필요한 공유 비밀. loopback 밖으로 나가지 않는다 */
  token: string;
  baseUrl: string;
  configPath: string;
  systemIntelligenceV4: SystemIntelligenceV4Mode;
};

export function parseSystemIntelligenceV4Mode(value: string | undefined): SystemIntelligenceV4Mode {
  return value === "off" || value === "shadow" || value === "on" ? value : "on";
}

/** `.onto/bridge.json`을 읽고, 처음 쓸 때는 새 토큰과 함께 만든다. */
export function loadBridgeConfig(protoRoot: string): BridgeConfig {
  const dir = join(protoRoot, ".onto");
  const configPath = join(dir, "bridge.json");

  let port = Number(process.env.ONTO_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
  /**
   * env 가 디스크보다 우선한다.
   *
   * bridge 와 MCP server 가 **같은 함수를 거치는데도** 서로 다른 토큰을 쓰면 loopback 이
   * 401 로 끊긴다. MCP server 는 등록 스크립트가 주입한 env 를 쓰므로 bridge 도 같은 env 를
   * 봐야 한다 — 그러지 않으면 "같은 함수를 쓴다"는 것이 아무것도 보장하지 못한다.
   */
  let token: string | undefined = process.env.ONTO_BRIDGE_TOKEN;

  if (existsSync(configPath)) {
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as { port?: number; token?: string };
    if (!process.env.ONTO_BRIDGE_PORT && typeof saved.port === "number") port = saved.port;
    token ??= saved.token;
  }

  /**
   * env 로 완전히 지정되었으면 **디스크에 쓰지 않는다.**
   *
   * 그러지 않으면 시험이나 일회성 실행이 개발자의 공유 설정(포트·토큰)을 조용히 덮어쓴다.
   * 실제로 시험 실행이 bridge 포트를 바꿔 버린 적이 있다.
   */
  const fullyFromEnv =
    process.env.ONTO_BRIDGE_TOKEN !== undefined && process.env.ONTO_BRIDGE_PORT !== undefined;

  if (!token) {
    token = randomBytes(24).toString("hex");
  }
  if (!fullyFromEnv && !existsSync(configPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ port, token }, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    port,
    token,
    baseUrl: `http://${BRIDGE_HOST}:${port}`,
    configPath,
    systemIntelligenceV4: parseSystemIntelligenceV4Mode(process.env.ONTO_SYSTEM_INTELLIGENCE_V4),
  };
}
