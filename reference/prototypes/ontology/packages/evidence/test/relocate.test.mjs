/**
 * Agent evidence relocation — 지문 검색 (implementation_plan §6.5 S1 ②).
 *
 * 여기서 거는 것은 **한 가지 판단**이다: 파일이 바뀌었을 때 그 근거가 어디로 갔는가.
 *
 * ```text
 * 포매팅만 바뀜        → 같은 곳. exact.        (acceptance 16 의 agent 절반이 여기 선다)
 * 본문 의미가 바뀜      → 같은 곳. degraded.     (acceptance 17 의 agent 절반이 여기 선다)
 * 똑같은 블록이 둘      → 모호하다. missing
 * 사라짐               → missing
 * ```
 *
 * **모호할 때 옮기지 않는 것이 중요하다.** 틀린 위치로 옮기면 Grounding 이 살아 있는 것처럼
 * 보이면서 엉뚱한 코드를 가리킨다 — 끊어진 것보다 나쁘다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprintOf, relocateExtent } from "@onto/evidence";

const ORIGINAL = `export function requestFollow(fromId, toId) {
  const target = users.find(fromId);
  if (target.private) {
    return createRequest(fromId, toId, "pending");
  }
  return createFollow(fromId, toId);
}`;

function target(extent = ORIGINAL, profile = "code") {
  return { fingerprint: fingerprintOf(extent, profile), extent, profile };
}

const HEADER = `// 파일 위에 줄이 늘었다\nimport { users } from "./db.js";\n\n`;

test("포매팅만 바뀌면 exact 로 옮긴다 — id 는 유지되고 grounding 이 살아남는다", () => {
  // prettier 재정렬 + 따옴표 + 주석 추가. code 프로파일이 전부 버리는 것들이다.
  const reformatted = `${HEADER}export function requestFollow( fromId, toId )
{
    // 비공개 계정이면 승인을 기다린다
    const target = users.find( fromId );
    if ( target.private )
    {
        return createRequest( fromId, toId, 'pending' );
    }
    return createFollow( fromId, toId );
}
`;

  const result = relocateExtent(reformatted, target());
  assert.equal(result.status, "relocated");
  assert.equal(result.confidence, "exact", "포매팅 변경은 exact 여야 한다");
  assert.equal(result.location.startLine, 4, "파일 위에 3줄이 늘었으므로 4줄부터다");
  assert.equal(
    fingerprintOf(result.extent, "code"),
    fingerprintOf(ORIGINAL, "code"),
    "옮긴 자리의 지문이 원래 지문과 같아야 한다",
  );
});

test("본문 의미가 바뀌면 degraded 로 옮긴다 — 같은 것이지만 재검토가 필요하다", () => {
  // 승인을 기다리지 않고 바로 관계를 만든다. **의미가 바뀌었다.**
  const changed = `export function requestFollow(fromId, toId) {
  const target = users.find(fromId);
  if (target.private) {
    return createFollow(fromId, toId);
  }
  return createFollow(fromId, toId);
}`;

  const result = relocateExtent(changed, target());
  assert.equal(result.status, "relocated");
  assert.equal(result.confidence, "degraded", "지문이 달라졌으므로 exact 일 수 없다");
  assert.notEqual(
    fingerprintOf(result.extent, "code"),
    fingerprintOf(ORIGINAL, "code"),
    "지문이 달라져야 EvidenceDiff 가 modified 로 분류한다 (acceptance 17)",
  );
});

test("똑같은 블록이 둘이면 옮기지 않는다 — 모호한 것을 찍지 않는다", () => {
  const twice = `${ORIGINAL}\n\n${ORIGINAL}\n`;
  const result = relocateExtent(twice, target());
  assert.equal(result.status, "missing");
  assert.equal(result.reason, "ambiguous");
});

test("사라졌으면 missing — 지어내지 않는다", () => {
  const gone = `export function unrelated(a) {\n  return a + 1;\n}\n`;
  const result = relocateExtent(gone, target());
  assert.equal(result.status, "missing");
});

test("같은 입력에 두 번 부르면 바이트 단위로 같은 결과다 (결정론)", () => {
  const moved = `${HEADER}${ORIGINAL}\n`;
  const first = relocateExtent(moved, target());
  const second = relocateExtent(moved, target());
  assert.deepEqual(first, second);
});

test("prose 프로파일도 같은 규칙으로 옮긴다 — 주석·설정 범위가 여기 선다", () => {
  const policy = `# 팔로우 정책\n비공개 계정은 승인을 요구한다.`;
  const moved = `# 머리말\n\n${policy}\n\n# 꼬리말\n`;
  const result = relocateExtent(moved, target(policy, "prose"));
  assert.equal(result.status, "relocated");
  assert.equal(result.confidence, "exact");
  assert.equal(result.location.startLine, 3);
});

test("식별자가 하나도 없는 extent 는 degraded 매칭의 기준이 없다", () => {
  const punctuation = `};`;
  const result = relocateExtent(`export const a = 1;\n`, target(punctuation));
  assert.equal(result.status, "missing");
});
