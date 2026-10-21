// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseEndpoint } from "@/adapters/http/endpoint";
import { pinnedPayee } from "@/config/payees";

/**
 * Outside a browser there is no page, so there is no "this app's own origin": the same modules
 * run on the server (the API imports the skills) and must not treat any origin as their own.
 */
describe("outside a browser", () => {
  it("pins no origin to this app's fee address, and pays no http endpoint", () => {
    expect(pinnedPayee("http://localhost:5273")).toBeNull();
    expect(() => parseEndpoint("http://localhost:5273/api/skills/gas")).toThrow(/Only https endpoints are paid/);
  });
});
