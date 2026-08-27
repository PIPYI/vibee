import { release } from "node:os";

const MINIMUM = [20, 19, 0];

function versionTuple(version) {
  return version.replace(/^v/, "").split(".").slice(0, 3).map((part) => Number(part) || 0);
}

export function supportsCurrentNode(version = process.versions.node) {
  const [major = 0, minor = 0, patch = 0] = versionTuple(version);
  if (major >= 22) return major > 22 || minor > 12 || (minor === 12 && patch >= 0);
  if (major !== MINIMUM[0]) return false;
  return minor > MINIMUM[1] || (minor === MINIMUM[1] && patch >= MINIMUM[2]);
}

export function detectRuntime() {
  const wsl =
    process.platform === "linux" &&
    (Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) || /microsoft/i.test(release()));
  const platform = wsl
    ? "wsl"
    : process.platform === "darwin"
      ? "macos"
      : process.platform === "win32"
        ? "windows"
        : "linux";

  return {
    platform,
    nodeVersion: process.versions.node,
    webHost: process.env.VCI_WEB_HOST || (wsl ? "0.0.0.0" : "127.0.0.1"),
  };
}

export function assertSupportedNode() {
  if (supportsCurrentNode()) return;
  throw new Error(
    `Node ${process.versions.node}에서는 현재 Vite를 실행할 수 없습니다. ` +
      "Node 20.19 이상 또는 22.12 이상을 사용하세요. (.nvmrc 권장 버전: 22)",
  );
}
