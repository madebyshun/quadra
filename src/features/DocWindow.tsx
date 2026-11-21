import type { DocId } from "@/features/registry";
import { DocsBody } from "@/pages/Docs";
import { ApiBody } from "@/pages/ApiPage";
import { VerifyBody } from "@/pages/Verify";

/**
 * A doc page rendered as the contents of a desktop window. The same three
 * bodies the `/docs`, `/api` and `/verify` routes render, so opening Docs from
 * the desktop and following a saved `/docs` link show the same prose.
 */
export function DocWindow({ id }: { id: DocId }) {
  return (
    <div className="stack doc-body">
      {id === "docs" ? <DocsBody /> : id === "api" ? <ApiBody /> : <VerifyBody />}
    </div>
  );
}
