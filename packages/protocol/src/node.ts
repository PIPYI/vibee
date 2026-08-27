/**
 * Node 전용 헬퍼. app 체크아웃 위치를 찾고, bridge · MCP server · 등록 스크립트가
 * 공유하는 loopback 설정을 읽고 쓴다.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "./index.js";

const ROOT_PACKAGE_NAME = "vibe-coding-app";

/** `startPath`에서 위로 올라가며 app의 루트 package.json을 찾는다. */
export function findAppRoot(startPath: string): string {
  let dir = resolve(startPath);
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === ROOT_PACKAGE_NAME) return dir;
      } catch {
        // 올라가는 도중 읽을 수 없는 package.json이 있어도 치명적이지 않다. 계속 올라간다.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the ${ROOT_PACKAGE_NAME} root above ${startPath}`);
    }
    dir = parent;
  }
}

export function appRootFromModule(moduleUrl: string): string {
  return findAppRoot(dirname(fileURLToPath(moduleUrl)));
}

/**
 * `npm run fixture`가 만드는 일회용 fixture 프로젝트 경로.
 *
 * bridge(브라우저 입력창 기본값), create-fixture, acceptance 세 곳이 같은 경로를 봐야 하므로
 * 정의는 여기 한 곳에만 둔다.
 */
export function fixturePath(appRoot: string): string {
  return join(appRoot, "tmp", "fixture");
}

export type BridgeConfig = {
  port: number;
  /** `/internal/*`에 필요한 공유 비밀. loopback 밖으로 나가지 않는다. */
  token: string;
  baseUrl: string;
  configPath: string;
};

/**
 * `.vci-app/bridge.json`을 읽고, 처음 쓸 때는 새 토큰과 함께 생성한다.
 * bridge와 등록 스크립트가 모두 이 함수를 거치므로, MCP server에 서로 맞는
 * BRIDGE_URL/BRIDGE_TOKEN 쌍을 넘겨줄 수 있다.
 */
export function loadBridgeConfig(appRoot: string): BridgeConfig {
  const dir = join(appRoot, ".vci-app");
  const configPath = join(dir, "bridge.json");

  let port = Number(process.env.VCI_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT);
  let token: string | undefined;

  if (existsSync(configPath)) {
    const saved = JSON.parse(readFileSync(configPath, "utf8")) as { port?: number; token?: string };
    if (!process.env.VCI_BRIDGE_PORT && typeof saved.port === "number") port = saved.port;
    token = saved.token;
  }

  if (!token) {
    token = randomBytes(24).toString("hex");
    mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ port, token }, null, 2)}\n`, { mode: 0o600 });
  }

  return { port, token, baseUrl: `http://${BRIDGE_HOST}:${port}`, configPath };
}
