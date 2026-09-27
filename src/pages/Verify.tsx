import { useState } from "react";
import { BASE } from "@/config/chain";
import { canCheckOnChain, describe, recognize, type Recognized } from "@/lib/verify";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";

export function Verify() {
  const [link, setLink] = useState("");
  const [result, setResult] = useState<Recognized | null>(null);

  return (
    <Page title="Verify">
      <p className="panel__lede">
        Paste anything this site told you — a transaction, a receipt, a note — and check it yourself.
        If it does not match, it did not happen.
      </p>

      <fieldset className="group">
        <legend>Check a link</legend>
        <label className="label" htmlFor="verify-link">
          Transaction hash, address, or note
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
                  {"// read it there yourself — this page is not the authority"}
                </span>
              </>
            ) : null}
            {canCheckOnChain() ? null : (
              <>
                {"\n\n"}
                <span className="crt__amber">
                  {"The shape is all this can confirm right now. The pool is not deployed, so there\nis nothing on chain to check it against."}
                </span>
              </>
            )}
          </>
        )}
      </Crt>
    </Page>
  );
}
