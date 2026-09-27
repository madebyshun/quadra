import { BRAND } from "@/brand";
import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";

export function ApiPage() {
  return (
    <Page title="API">
      <p className="panel__lede">
        Two endpoints, both public, both free to read. Nothing here needs a key.
      </p>

      <fieldset className="group">
        <legend>GET /api/services</legend>
        <p className="panel__lede">Everything this router can pay, with what each one costs.</p>
        <Crt label="Example request">
          {`curl https://${BRAND.domain}/api/services`}
        </Crt>
      </fieldset>

      <fieldset className="group">
        <legend>GET /api/pool</legend>
        <p className="panel__lede">
          The pool right now: how much is in it, and how many notes it is holding. Never who owns
          them, because the pool does not know either.
        </p>
        <Crt label="Example request">{`curl https://${BRAND.domain}/api/pool`}</Crt>
      </fieldset>
    </Page>
  );
}
