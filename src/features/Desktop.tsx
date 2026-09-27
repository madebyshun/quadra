import { Link } from "react-router-dom";
import { BRAND } from "@/brand";
import { VISIBLE_FEATURES, isEnabled } from "@/features/registry";
import { badges } from "@/lib/status";

const DOCS = [
  { to: "/docs", title: "Docs", blurb: `how it works, and ${BRAND.ticker}` },
  { to: "/api", title: "API", blurb: "two public endpoints, with code" },
  { to: "/verify", title: "Verify", blurb: "check any link" },
] as const;

export function Desktop() {
  return (
    <div className="home stack">
      <header className="home__head">
        <h1 className="home__brand">{BRAND.name}</h1>
        <p className="home__tagline">{BRAND.tagline}</p>
        <ul className="row" aria-label="What is true right now">
          {badges().map((b) => (
            <li
              key={b.text}
              className={`chip ${b.tone === "ok" ? "chip--ok" : b.tone === "warn" ? "chip--warn" : ""}`}
            >
              {b.text}
            </li>
          ))}
        </ul>
      </header>

      <ul className="cards" aria-label="What you can do">
        {VISIBLE_FEATURES.map((f) => {
          const on = isEnabled(f);
          return (
            <li key={f.id}>
              <Link
                to={`/?do=${f.id}`}
                className={`card ${on ? "" : "card--off"}`}
                aria-disabled={on ? undefined : true}
              >
                <span className="card__title">{f.title}</span>
                <span className="card__blurb">{on ? f.blurb : "not switched on yet"}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <ul className="cards cards--docs" aria-label="Read about it">
        {DOCS.map((d) => (
          <li key={d.to}>
            <Link to={d.to} className="card card--doc">
              <span className="card__title">{d.title}</span>
              <span className="card__blurb">{d.blurb}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
