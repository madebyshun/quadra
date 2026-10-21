import { describe, expect, it } from "vitest";
import { messageOf } from "@/lib/errors";

describe("messageOf", () => {
  it("reads an Error's own message", () => {
    expect(messageOf(new Error("the pool refused"))).toBe("the pool refused");
  });

  it("says a non-Error aloud rather than dropping it", () => {
    expect(messageOf("popup blocked")).toBe("popup blocked");
    expect(messageOf(42)).toBe("42");
  });
});
