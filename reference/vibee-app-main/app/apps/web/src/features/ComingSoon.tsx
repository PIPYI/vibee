export function ComingSoon({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h3 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)" }}>{label} 준비 중</h3>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
        해당 기능은 현재 이식 작업이 진행되고 있습니다.
      </p>
    </div>
  );
}
