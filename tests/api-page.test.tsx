import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { ENDPOINTS, apiLede, endpointBadge, type Endpoint } from "@/pages/ApiPage";
import { BRAND } from "@/brand";
import { BLUEAGENT } from "@/config/upstream";
import { renderAt } from "./helpers";

/**
 * This page's job is to be believed, so the tests check a property rather than a
 * paragraph: nothing on it may present an endpoint this origin does not serve as
 * though it does.
 *
 * The page previously opened with "two endpoints, both public, both free to read"
 * and a `curl` for each. Neither existed. A test asserting that the heading said
 * "API" passed the whole time — which is why the assertions below are about
 * `live`, not about wording.
 */

const LIVE: Endpoint = {
  method: "GET",
  path: "/api/services",
  what: "Everything this router can pay.",
  live: true,
};

describe("the API page", () => {
  it("marks every endpoint this origin does not serve as not built", () => {
    renderAt("/api");
    const list = screen.getByLabelText("Endpoints");
    for (const endpoint of ENDPOINTS) {
      const row = within(list).getByText(`${endpoint.method} ${endpoint.path}`).closest("li");
      expect(row, endpoint.path).not.toBeNull();
      expect(within(row as HTMLElement).getByText(endpoint.live ? "live" : "not built")).toBeInTheDocument();
    }
  });

  /**
   * The strongest version of the honesty check, and the one that would have caught
   * the original bug: a copyable command for this origin is a promise it answers.
   * Upstream's catalog is a different matter — that URL really does answer, which
   * is exactly why it is the only one allowed to appear as a command.
   */
  it("offers no runnable command for an endpoint that is not built", () => {
    renderAt("/api");
    const commands = screen.getAllByText(/^curl /).map((el) => el.textContent ?? "");
    expect(commands).not.toHaveLength(0);
    for (const command of commands) {
      expect(command, command).not.toContain(BRAND.domain);
    }
    expect(commands).toContain(`curl ${BLUEAGENT.catalog}`);
  });

  it("says plainly that there is no server on this origin", () => {
    expect(apiLede(ENDPOINTS)).toContain("serves no API today");
    expect(apiLede(ENDPOINTS)).toContain(BRAND.domain);
  });

  /**
   * The wording that ships the day an endpoint goes up, checked now rather than
   * first appearing in production. Same reason `installLine` takes `published`.
   */
  it("changes its lede once something is actually served", () => {
    const lede = apiLede([...ENDPOINTS, LIVE]);
    expect(lede).not.toContain("serves no API today");
    expect(lede).toContain(BRAND.domain);
  });

  it("badges a live endpoint as live and an unbuilt one as not built", () => {
    expect(endpointBadge(true)).toEqual({ className: "chip chip--ok", label: "live" });
    expect(endpointBadge(false)).toEqual({ className: "chip chip--warn", label: "not built" });
  });

  /**
   * Not a style rule. `live` is the flag every assertion above trusts, so an entry
   * that forgets it would quietly opt out of all of them.
   */
  it("gives every endpoint a live flag and something to say", () => {
    expect(ENDPOINTS).not.toHaveLength(0);
    for (const endpoint of ENDPOINTS) {
      expect(typeof endpoint.live, endpoint.path).toBe("boolean");
      expect(endpoint.what.length, endpoint.path).toBeGreaterThan(0);
      expect(endpoint.path.startsWith("/api/"), endpoint.path).toBe(true);
    }
  });
});
