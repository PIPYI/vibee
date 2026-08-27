export type RuntimeInfo = {
  platform: "macos" | "windows" | "wsl" | "linux";
  nodeVersion: string;
  webHost: string;
};

export function supportsCurrentNode(version?: string): boolean;
export function detectRuntime(): RuntimeInfo;
export function assertSupportedNode(): void;
