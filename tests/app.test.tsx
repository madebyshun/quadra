import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt, settle } from "./helpers";
import { BRAND } from "@/brand";
import { FEATURES, isEnabled } from "@/features/registry";

describe("the desktop", () => {
  it("leads with the product name", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(BRAND.name);
  });

  it("renders a card for every feature, on or off", () => {
    renderAt("/");
    const cards = within(screen.getByLabelText("What you can do")).getAllByRole("link");
    expect(cards).toHaveLength(FEATURES.length);
  });

  it("links each card at its own ?do= id", () => {
    renderAt("/");
    for (const f of FEATURES) {
      const link = screen.getByRole("link", { name: new RegExp(`^${f.title}`) });
      expect(link).toHaveAttribute("href", `/?do=${f.id}`);
    }
  });

  it("says plainly that an off feature is off, instead of hiding it", () => {
    renderAt("/");
    for (const f of FEATURES.filter((x) => !isEnabled(x))) {
      const link = screen.getByRole("link", { name: new RegExp(`^${f.title}`) });
      expect(link).toHaveTextContent("not switched on yet");
      expect(link).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("shows the real blurb for a feature that is on", () => {
    renderAt("/");
    const on = FEATURES.filter(isEnabled);
    expect(on.length).toBeGreaterThan(0);
    for (const f of on) {
      const link = screen.getByRole("link", { name: new RegExp(`^${f.title}`) });
      expect(link).toHaveTextContent(f.blurb);
      expect(link).not.toHaveAttribute("aria-disabled");
    }
  });

  it("offers the three doc pages", () => {
    renderAt("/");
    const docs = within(screen.getByLabelText("Read about it")).getAllByRole("link");
    expect(docs.map((a) => a.getAttribute("href"))).toEqual(["/docs", "/api", "/verify"]);
  });

  it("shows no window frame until a feature is picked", () => {
    renderAt("/");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("opening a feature with ?do=", () => {
  it("opens the window titled for that feature", () => {
    renderAt("/?do=swap");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Swap");
  });

  it("uses each feature's own window title", async () => {
    for (const f of FEATURES) {
      const { unmount } = renderAt(`/?do=${f.id}`);
      await settle();
      expect(screen.getByRole("heading", { level: 2 }), f.id).toHaveTextContent(f.window);
      unmount();
    }
  });

  it("replaces the desktop rather than stacking on it", () => {
    renderAt("/?do=router");
    expect(screen.queryByLabelText("What you can do")).not.toBeInTheDocument();
  });

  it("falls back to the desktop for an unknown id", () => {
    renderAt("/?do=teleport");
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("warns instead of offering controls when the feature is off", () => {
    renderAt("/?do=bridge");
    expect(screen.getByLabelText("Bridge is off")).toHaveTextContent(
      /not switched on\. Nothing here will move money/,
    );
  });

  /**
   * Distinguishes the two ways a window can be empty. "Off" and "not built" are
   * different facts, and a single shared placeholder blurred them — a flag being
   * on used to be enough to make a window look ready.
   */
  it("says a switched-on feature is unbuilt, rather than showing a blank output", () => {
    renderAt("/?do=swap");
    expect(screen.getByLabelText("Swap is not built yet")).toHaveTextContent(
      /switched on but not built yet.*nothing here will move money/i,
    );
    expect(screen.queryByLabelText("Swap output")).not.toBeInTheDocument();
  });

  it("gives Send and Inference real controls, not a placeholder", async () => {
    renderAt("/?do=send");
    await settle();
    expect(screen.getByRole("button", { name: "Deposit" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Send is not built yet")).not.toBeInTheDocument();
  });
});

describe("closing the window", () => {
  it("goes back to the desktop when the close light is clicked", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });

  it("closes on Esc", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });

  it("says so, since a keyboard shortcut nobody mentions does not exist", () => {
    renderAt("/?do=swap");
    expect(screen.getByText("Esc closes this.")).toBeInTheDocument();
  });

  it("ignores other keys", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.keyboard("{Enter}a ");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Swap");
  });

  it("closes from the taskbar start button too", async () => {
    const user = userEvent.setup();
    renderAt("/?do=mcp");
    await user.click(within(screen.getByLabelText("Taskbar")).getByRole("button"));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });
});

describe("the taskbar", () => {
  it("is present on the desktop and names the product", () => {
    renderAt("/");
    expect(within(screen.getByLabelText("Taskbar")).getByRole("button")).toHaveTextContent(
      BRAND.name,
    );
  });

  it("states the chain, because an address means nothing without one", () => {
    renderAt("/");
    expect(screen.getByLabelText("Taskbar")).toHaveTextContent("Base");
  });

  it("names the open window while one is open", async () => {
    renderAt("/?do=inference");
    await settle();
    expect(screen.getByLabelText("Taskbar")).toHaveTextContent("Private inference");
  });
});

describe("routing", () => {
  it("serves /docs", () => {
    renderAt("/docs");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Docs");
  });

  it("serves /api", () => {
    renderAt("/api");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("API");
  });

  it("serves /verify", () => {
    renderAt("/verify");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Verify");
  });

  it("answers an unknown path without claiming a charge was made", () => {
    renderAt("/definitely-not-a-page");
    expect(screen.getByLabelText("404")).toHaveTextContent("Nothing was charged");
  });

  it("gives every standalone page a way back to the desktop", () => {
    for (const path of ["/docs", "/api", "/verify", "/nope"]) {
      const { unmount } = renderAt(path);
      expect(screen.getByRole("link", { name: "Back to the desktop" }), path).toHaveAttribute(
        "href",
        "/",
      );
      unmount();
    }
  });

  it("closes a standalone page back to the desktop from its close light", async () => {
    const user = userEvent.setup();
    renderAt("/docs");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });

  it("goes home from the taskbar on a standalone page, not nowhere", async () => {
    const user = userEvent.setup();
    renderAt("/api");
    await user.click(within(screen.getByLabelText("Taskbar")).getByRole("button"));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });
});
