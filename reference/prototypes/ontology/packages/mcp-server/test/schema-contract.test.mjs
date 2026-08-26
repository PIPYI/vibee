import assert from "node:assert/strict";
import test from "node:test";

import { ANALYSIS_BUNDLE_SCHEMA, analysisContractDigest } from "@onto/protocol";
import { jsonSchemaToZod } from "../dist/json-schema-zod.js";

const schema = jsonSchemaToZod(ANALYSIS_BUNDLE_SCHEMA);

test("AnalysisBundle MCP 계약은 잘못된 workflow enum을 제출 전에 거절한다", () => {
  const result = schema.safeParse({
    architecture: { title: "A", components: [], boundaries: [], connections: [] },
    workflow: {
      title: "W",
      lanes: [{ id: "lane", label: "system", kind: "service" }],
      mainPath: [],
      nodes: [],
      edges: [],
    },
    sequences: [],
  });
  assert.equal(result.success, false);
});

test("AnalysisBundle MCP 계약은 Scenario transition의 금지 필드를 거절한다", () => {
  const result = schema.safeParse({
    architecture: { title: "A", components: [], boundaries: [], connections: [] },
    workflow: { title: "W", lanes: [], mainPath: [], nodes: [], edges: [] },
    userMap: {
      title: "U",
      journeys: [{
        id: "journey",
        name: "Journey",
        type: "user",
        participants: [],
        steps: [{ id: "one", label: "One", conceptRefs: [], evidenceRefs: ["ev"] }],
        transitions: [{ id: "not-allowed", fromStepId: "one", toStepId: "one", evidenceRefs: ["ev"] }],
        entryStepId: "one",
        outcomeStepIds: ["one"],
      }],
    },
    sequences: [],
  });
  assert.equal(result.success, false);
});

test("Sequence message 계약은 call·return·event를 노출하고 허용한다", () => {
  assert.match(analysisContractDigest(), /sequences\[\]\.messages\[\]\.kind: `call` \| `return` \| `event`/);
  const result = schema.safeParse({
    architecture: { title: "A", components: [], boundaries: [], connections: [] },
    workflow: { title: "W", lanes: [], mainPath: [], nodes: [], edges: [] },
    sequences: [{
      id: "sequence", title: "Request lifecycle", triggeredByEdgeId: "edge",
      participants: [{ id: "ui", label: "UI" }, { id: "api", label: "API" }],
      messages: [
        { id: "call", fromParticipantId: "ui", toParticipantId: "api", order: 0, label: "request", kind: "call", evidenceRefs: ["ev-call"] },
        { id: "return", fromParticipantId: "api", toParticipantId: "ui", order: 1, label: "response", kind: "return", evidenceRefs: ["ev-call"] },
        { id: "event", fromParticipantId: "ui", toParticipantId: "ui", order: 2, label: "updated", kind: "event", evidenceRefs: ["ev-ui"] },
      ],
      evidenceRefs: ["ev-call"],
    }],
  });
  assert.equal(result.success, true);
});
