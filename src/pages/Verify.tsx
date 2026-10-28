import { useState } from "react";
import { BASE } from "@/config/chain";
import { describe, recognize, type Recognized } from "@/lib/verify";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";

/** The page body alone — see `DocsBody` for why this is split out. */
export function VerifyBody() {
  const [link, setLink] = useState("");
  const [result, setResult] = useState<Recognized | null>(null);

  return (
    <>
      <p className="panel__lede">
        Paste anything this site told you — a transaction, a receipt, an address — and check it yourself.
        If it does not match, it did not happen.
      </p>

      <fieldset className="group">
        <legend>Check a link</legend>
        <label className="label" htmlFor="verify-link">
          Transaction hash or address
        </label>
        <input
          id="verify-link"
          className="field"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <Gel onClick={() => setResult(recognize(link))} disabled={!link.trim()}>
            Check it
          </Gel>
          <Gel
            quiet
            onClick={() => {
              setLink("");
              setResult(null);
            }}
            disabled={!link && result === null}
          >
            Clear
          </Gel>
        </div>
      </fieldset>

      <Crt label="Result">
        {result === null ? (
          <span className="crt__dim">{"// nothing checked yet"}</span>
        ) : (
          <>
            <span>{describe(result)}</span>
            {result.kind === "txHash" ? (
              <>
                {"\n\n"}
                <a
                  href={`${BASE.explorer}/tx/${result.value}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open it on Basescan
                </a>
                {"\n"}
                <span className="crt__dim">
                  {"// read it there yourself — this page is not the authority."}
                  {"\n// or type `tx <hash>` in the Terminal to have it explained."}
                </span>
              </>
            ) : null}
          </>
        )}
      </Crt>
    </>
  );
}

export function Verify() {
  return (
    <Page title="Verify">
      <VerifyBody />
    </Page>
  );
}
