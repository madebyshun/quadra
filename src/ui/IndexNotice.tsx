/** Freshness is independent of whether the HTTP request succeeded. */
export function IndexNotice({ behind, error }: { behind: number | null; error: string | null }) {
  return <aside role="status" className="index-notice">
    <strong>index / {error ? "source error" : behind === null ? "freshness unknown" : behind > 0 ? "catching up" : "caught up at last check"}</strong>
    <p>{behind === null ? "The chain head could not be checked." : `${behind.toLocaleString("en-US")} blocks behind the last checked chain head.`} {error}</p>
    {behind !== 0 || error ? <p>Figures may be incomplete. Missing trades are not zero activity. A fresh trade quote is checked separately.</p> : null}
  </aside>;
}
