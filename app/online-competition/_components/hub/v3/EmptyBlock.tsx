/** Dark-palette twin of ../../ui.tsx's <EmptyState> — same 3x3 cube
 *  motif, v3 colors. Kept separate rather than parameterised so the v2
 *  component the admin/detail pages use stays untouched. */
export default function EmptyBlock({ text, hint }: { text: string; hint?: React.ReactNode }) {
  return (
    <div className="oc-v3-empty">
      <div className="oc-v3-empty-icon" aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} className="oc-v3-empty-cell" />
        ))}
      </div>
      <p className="oc-v3-empty-text">{text}</p>
      {hint && <div className="oc-v3-empty-hint">{hint}</div>}
    </div>
  );
}
