import { Page } from "@/pages/Page";
import { Crt } from "@/ui/Crt";

export function NotFound() {
  return (
    <Page title="Nothing here">
      <Crt label="404">
        <span className="crt__amber">
          That address does not exist on this site. Nothing was charged.
        </span>
      </Crt>
    </Page>
  );
}
