import { useState } from "react";

import type { WikiPage } from "@vci/protocol";

import type { WikiFeatureState } from "./useWikiFeature.js";

/** 파일 저장 쪽(wiki.ts의 wikiSlug)과 같은 규칙 — 앵커 id와 파일명이 어긋나지 않게 한다. */
function wikiSlug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "") || "page";
}

function WikiPageBody({ page }: { page: WikiPage }) {
  return (
    <>
      <p>{page.oneLine}</p>
      <div className="narrative">{page.inThisProject}</div>
      {/* 근거가 비면 일반론이라는 뜻이다. 그 사실을 감추지 않는다. */}
      {page.where.length > 0 ? (
        <>
          <h3 style={{ fontSize: 14, marginTop: 20 }}>이 프로젝트에서</h3>
          <ul className="gap-list">
            {page.where.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 20 }}>
          이 프로젝트 안에서 근거를 찾지 못했습니다.
        </p>
      )}
      {page.related.length > 0 && <p className="why">함께 보기: {page.related.join(" · ")}</p>}
    </>
  );
}

/** 실제로 스크롤되는 건 window가 아니라 `.main`(styles.css의 overflow-y: auto)이다. */
function scrollMain(to: "top" | "bottom") {
  const container = document.querySelector(".main");
  if (!container) return;
  container.scrollTo({ top: to === "top" ? 0 : container.scrollHeight, behavior: "smooth" });
}

function ScrollButtons() {
  return (
    <div className="scroll-fabs">
      <button type="button" aria-label="맨 위로" onClick={() => scrollMain("top")}>
        ↑
      </button>
      <button type="button" aria-label="맨 아래로" onClick={() => scrollMain("bottom")}>
        ↓
      </button>
    </div>
  );
}

/** 나무위키 우측 목차처럼 평소엔 점으로만 있다가, 마우스를 올리면 개념 이름이 펼쳐진다. */
function FloatingToc({ pages }: { pages: WikiPage[] }) {
  return (
    <nav className="toc-fab" aria-label="내 위키 목차">
      <ul>
        {pages.map((page) => (
          <li key={page.term}>
            <a href={`#${wikiSlug(page.term)}`}>
              <span className="toc-label">{page.term}</span>
              <span className="toc-dot" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** '내 위키' 제목 바로 아래, 문서 흐름 안에 있는 접이식 목차. 플로팅 목차(FloatingToc)와는 별개다. */
function CollapsibleToc({ pages }: { pages: WikiPage[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="toc-box">
      <button type="button" className="toc-box-header" onClick={() => setOpen((value) => !value)}>
        <span>목차</span>
        <span className="toc-box-arrow">{open ? "⌄" : "‹"}</span>
      </button>
      {open && (
        <ol>
          {pages.map((page) => (
            <li key={page.term}>
              <a href={`#${wikiSlug(page.term)}`}>{page.term}</a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function WikiMain(state: WikiFeatureState) {
  if (!state.page) {
    if (state.myWiki.length === 0) {
      return <p className="empty-state">왼쪽에서 프로젝트 경로를 입력하고 키워드 후보를 찾은 뒤 하나를 고르세요.</p>;
    }
    // 저장된 '내 위키'가 있으면 후보를 고르기 전에도 바로 보여준다.
    return (
      <div>
        <h1>내 위키</h1>
        <CollapsibleToc pages={state.myWiki} />
        <FloatingToc pages={state.myWiki} />
        {state.myWiki.map((page, index) => (
          <div key={page.term} id={wikiSlug(page.term)}>
            {index > 0 && <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid var(--border)" }} />}
            <h2>{page.term}</h2>
            <WikiPageBody page={page} />
          </div>
        ))}
        <ScrollButtons />
      </div>
    );
  }

  const alreadyAdded = state.myWiki.some((page) => page.term === state.page?.term);

  return (
    <div>
      {state.myWiki.length > 0 && (
        <button className="secondary" onClick={state.onBackToMyWiki} style={{ marginBottom: 12 }}>
          ← 내 위키로 돌아가기
        </button>
      )}
      <h1>{state.page.term}</h1>
      <WikiPageBody page={state.page} />
      <div style={{ marginTop: 16 }}>
        <button className="primary" disabled={alreadyAdded} onClick={() => state.page && void state.onAddToMyWiki(state.page)}>
          {alreadyAdded ? "내 위키에 있음" : "내 위키로 추가"}
        </button>
      </div>
      {state.warnings.length > 0 && (
        <div className="error-banner" style={{ marginTop: 16 }}>
          {state.warnings.join(" / ")}
        </div>
      )}
      <ScrollButtons />
    </div>
  );
}
