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
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--accent)", margin: "8px 0 16px" }}>
        {page.oneLine}
      </div>
      <div className="narrative" style={{ margin: "14px 0" }}>
        {page.inThisProject}
      </div>
      
      {/* 근거 섹션 */}
      {page.where.length > 0 ? (
        <div className="callout-box" style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", margin: "18px 0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            이 프로젝트 내 근거
          </div>
          <ul className="gap-list" style={{ margin: 0, color: "var(--text-secondary)" }}>
            {page.where.map((item, index) => (
              <li key={index} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 14 }}>
          이 프로젝트 안에서 구체적인 근거를 찾지 못했습니다. (일반 개념 설명)
        </p>
      )}

      {page.related.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginRight: 8 }}>함께 보기:</span>
          <div className="chip-group" style={{ display: "inline-flex" }}>
            {page.related.map((term, i) => (
              <span key={i} className="chip chip-accent">
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
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
      <button type="button" aria-label="맨 위로" title="맨 위로" onClick={() => scrollMain("top")}>
        ↑
      </button>
      <button type="button" aria-label="맨 아래로" title="맨 아래로" onClick={() => scrollMain("bottom")}>
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

/** '내 위키' 제목 바로 아래, 문서 흐름 안에 있는 접이식 목차. */
function CollapsibleToc({ pages }: { pages: WikiPage[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="toc-box">
      <button type="button" className="toc-box-header" onClick={() => setOpen((value) => !value)}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          목차 ({pages.length})
        </span>
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
      return (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
          <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>프로젝트 위키</h3>
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5, whiteSpace: "nowrap" }}>
            왼쪽 패널에서 프로젝트 경로를 입력하고 키워드 후보를 찾은 뒤 항목을 선택하세요.
          </p>
        </div>
      );
    }
    // 저장된 '내 위키'가 있으면 후보를 고르기 전에도 바로 보여준다.
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>내 위키</h1>
          <span className="chip chip-accent">{state.myWiki.length}개 항목</span>
        </div>

        <CollapsibleToc pages={state.myWiki} />
        <FloatingToc pages={state.myWiki} />

        {state.myWiki.map((page, index) => (
          <div key={page.term} id={wikiSlug(page.term)} style={{ marginBottom: 32 }}>
            {index > 0 && <hr style={{ margin: "32px 0", border: "none", borderTop: "1px solid var(--border)" }} />}
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 12px" }}>{page.term}</h2>
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
        <button className="secondary" onClick={state.onBackToMyWiki} style={{ marginBottom: 16 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          내 위키로 돌아가기
        </button>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{state.page.term}</h1>
        {alreadyAdded && <span className="chip chip-success">저장됨</span>}
      </div>

      <WikiPageBody page={state.page} />

      <div style={{ marginTop: 24 }}>
        <button
          className="primary"
          style={{ width: "auto", minWidth: 140, padding: "9px 18px" }}
          disabled={alreadyAdded}
          onClick={() => state.page && void state.onAddToMyWiki(state.page)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          {alreadyAdded ? "내 위키에 저장됨" : "내 위키로 추가"}
        </button>
      </div>

      {state.warnings.length > 0 && (
        <div className="error-banner" style={{ marginTop: 20 }}>
          {state.warnings.join(" / ")}
        </div>
      )}
      <ScrollButtons />
    </div>
  );
}
