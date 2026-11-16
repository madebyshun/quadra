import { describe, it, expect, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt, settle } from "./helpers";
import { BRAND } from "@/brand";
import { visibleFeatures, FEATURES, desktopItems, comingSoon, folderItems, FOLDER_IDS, entryOf } from "@/features/registry";
import { radarSkill } from "@/skills/radar";

describe("the desktop", () => {
  it("leads with the product name", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(BRAND.name);
  });

  /**
   * The three status chips ("N of M switched on", "holds no key", "local pool,
   * not deployed yet") were removed on the owner's call, along with `lib/status`.
   * Asserted by absence rather than left to the eye, because a deleted module is
   * exactly the kind of thing a later refactor re-introduces from a stale import.
   */
  it("does not put status chips under the tagline", () => {
    renderAt("/");
    expect(screen.queryByLabelText("What is true right now")).toBeNull();
    // scoped to the header: "switched on" also appears in the off feature's blurb
    const head = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(head.querySelectorAll(".chip")).toHaveLength(0);
    expect(head).toHaveTextContent(BRAND.desktopLine);
    for (const claim of [/switched on/, /holds no key/, /not deployed yet/]) {
      expect(head.textContent).not.toMatch(claim);
    }
  });

  it("puts the four doors, Agents and My Computer on the desktop, and the Trash in its corner", async () => {
    renderAt("/");
    const cards = within(screen.getByLabelText("What you can do")).getAllByRole("button");
    expect(cards.map((c) => c.querySelector(".icon__title")!.textContent)).toEqual(desktopItems().map((e) => e.title));
    expect(cards.map((c) => c.querySelector(".icon__title")!.textContent)).toEqual(["Check", "Coins", "Launch", "Wallet", "Agents", "My Computer"]);
    expect(FEATURES.length - visibleFeatures().length).toBe(1);
    expect(screen.queryByRole("button", { name: /^Bridge/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Read about it")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trash" })).toHaveClass("desk-trash");
    await userEvent.click(screen.getByRole("button", { name: "treasury basket" }));
    expect(screen.getByRole("heading", { name: "Treasury Basket" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "terminal" }));
    expect(screen.getByRole("heading", { name: "Terminal" })).toBeInTheDocument();
  });

  it("opens a folder as an Explorer window: one click selects, a double click or Enter opens", async () => {
    const user = userEvent.setup();
    renderAt("/");
    // the desktop's My Computer holds the other folders: open it, then Money inside it
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^My Computer/ }));
    await user.dblClick(within(screen.getByRole("list", { name: "My Computer" })).getByRole("button", { name: "Money" }));
    const folder = screen.getByRole("list", { name: "Money" });
    const win = windowFrame("Money");
    expect(within(win).getByRole("status")).toHaveTextContent("4 objects");
    const send = within(folder).getByRole("button", { name: "Send" });
    await user.click(send);
    expect(send).toHaveAttribute("aria-pressed", "true");
    expect(within(win).getByRole("status")).toHaveTextContent("Send — pay any address or Basename");
    expect(screen.queryByLabelText("Send", { selector: "section" })).not.toBeInTheDocument();
    await user.dblClick(send);
    expect(windowFrame("Send")).toBeInTheDocument();
    within(folder).getByRole("button", { name: "Swap" }).focus();
    await user.keyboard("{Enter}");
    expect(windowFrame("Swap")).toBeInTheDocument();
  });

  it("files every folder's programs where the folder says, each one openable", async () => {
    for (const id of FOLDER_IDS) {
      const { unmount } = renderAt(`/?do=${id}`);
      await settle();
      const titles = within(screen.getByRole("list", { name: entryOf(id).title })).getAllByRole("button").map((b) => b.textContent);
      expect(titles, id).toEqual(folderItems(id).map((e) => e.title));
      unmount();
    }
  });

  it("says plainly that an off feature is off, from the Coming Soon folder", async () => {
    const user = userEvent.setup();
    renderAt("/?do=soon");
    await settle();
    const folder = screen.getByLabelText("Programs not switched on yet");
    const off = comingSoon();
    expect(off.length).toBeGreaterThan(0);
    for (const f of off) expect(within(folder).getByRole("button", { name: f.title })).toHaveAttribute("title", f.blurb);
    await user.dblClick(within(folder).getByRole("button", { name: off[0]!.title }));
    expect(screen.getByLabelText(`${off[0]!.title} is off`)).toHaveTextContent("not switched on");
  });

  it("shows the real blurb for each desktop icon", () => {
    renderAt("/");
    const on = desktopItems();
    expect(on.length).toBeGreaterThan(0);
    const cards = within(screen.getByLabelText("What you can do")).getAllByRole("button");
    for (const [i, f] of on.entries()) {
      const card = cards[i]!;
      expect(card).toHaveTextContent(f.title);
      expect(card).toHaveTextContent(f.blurb);
      expect(card).not.toHaveAttribute("aria-disabled");
    }
  });

  /**
   * On the desktop these are buttons, not links. Following `/docs` unmounted the
   * whole desktop — header and every other open window went with it — so
   * a doc page now opens as a window like anything else. The routes still exist
   * for a saved link; `renderAt("/docs")` below is what covers them.
   */
  it("keeps the three doc pages in the Agents folder, as windows, not as navigation", async () => {
    renderAt("/?do=folder-agents");
    await settle();
    const agents = screen.getByRole("list", { name: "Agents" });
    for (const name of ["Docs", "API", "Verify"]) expect(within(agents).getByRole("button", { name })).toBeInTheDocument();
    expect(within(agents).queryAllByRole("link")).toEqual([]);
  });

  it("opens a doc page in place, keeping the desktop underneath", async () => {
    const user = userEvent.setup();
    renderAt("/?do=folder-agents");
    await settle();
    await user.dblClick(within(screen.getByRole("list", { name: "Agents" })).getByRole("button", { name: "Docs" }));
    await settle();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Agents", `Docs — ${BRAND.name}`]);
    // the header the old navigation threw away
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(BRAND.name);
  });

  it("opens each doc page from a saved ?do= link, with its own body", async () => {
    const expected = [
      ["docs", `Docs — ${BRAND.name}`, /never holds a key/],
      ["api", "API", /Endpoints/],
      ["verify", "Verify", /nothing checked yet/],
    ] as const;
    for (const [id, title, body] of expected) {
      const { unmount } = renderAt(`/?do=${id}`);
      await settle();
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(title);
      expect(screen.getByRole("heading", { level: 2 }).closest(".win")).toHaveTextContent(body);
      unmount();
    }
  });

  /**
   * The Docs window says nothing about the product's own token, by decision. The
   * token is not deployed, so any sentence about it is a plan, and a plan printed
   * beside a checked on-chain address borrows that address's credibility. Pinned
   * by absence, because prose about an unshipped token is exactly the kind of
   * thing that creeps back in one helpful paragraph at a time.
   */
  it("says nothing about the product's own token — the About page does, with its numbers read from the chain", async () => {
    renderAt("/?do=docs");
    await settle();
    const win = screen.getByRole("heading", { level: 2 }).closest(".win")!;
    expect(win.textContent).not.toContain(BRAND.ticker);
    expect(win.textContent).not.toContain(BRAND.ticker.replace("$", ""));
    // what it does print is checkable: where every answer comes from
    expect(win).toHaveTextContent("Blockscout");
  });

  it("opens a doc page from the Start menu too", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    await user.click(
      within(screen.getByRole("menu", { name: `${BRAND.name} menu` })).getByRole("menuitem", { name: "API" }),
    );
    await settle();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("API");
  });

  it("keeps a feature window open when a doc page is opened next to it", async () => {
    const user = userEvent.setup();
    renderAt("/?do=send");
    await settle();
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Agents/ }));
    await user.dblClick(within(screen.getByRole("list", { name: "Agents" })).getByRole("button", { name: "Verify" }));
    await settle();
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toContain("Send");
    expect(titles).toContain("Verify");
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

  it("stacks the window on top of the desktop rather than replacing it", () => {
    renderAt("/?do=bridge");
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Bridge");
  });

  it("falls back to the desktop for an unknown id", () => {
    renderAt("/?do=teleport");
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("warns instead of offering controls when the feature is off", () => {
    renderAt("/?do=audit");
    expect(screen.getByLabelText("Audit is off")).toHaveTextContent(
      /not switched on\. Nothing here will move money/,
    );
  });

  it("gives the Terminal and Radar real controls, not a placeholder", async () => {
    const { unmount } = renderAt("/?do=terminal");
    await settle();
    expect(screen.getByLabelText("Command")).toBeInTheDocument();
    expect(screen.queryByLabelText("Terminal is not built yet")).not.toBeInTheDocument();
    unmount();

    renderAt("/?do=research");
    await settle();
    expect(screen.getByText(radarSkill.summary)).toBeInTheDocument();
    expect(screen.queryByLabelText("Radar is not built yet")).not.toBeInTheDocument();
  });
});

/** the window frame itself: the one element whose *own* aria-label is the title, not a descendant's */
function windowFrame(title: string): HTMLElement {
  return screen.getByLabelText(title, { selector: "section" });
}

describe("opening a feature from the desktop icon", () => {
  it("clicking a card opens its window without a page navigation", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Wallet/ }));
    expect(windowFrame("Connect wallet")).toBeInTheDocument();
  });

  it("clicking the same card twice does not open a second window", async () => {
    const user = userEvent.setup();
    renderAt("/");
    const card = within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Wallet/ });
    await user.click(card);
    await user.click(card);
    expect(screen.getAllByLabelText("Connect wallet", { selector: "section" })).toHaveLength(1);
  });
});

describe("multiple windows", () => {
  it("keeps two windows open and visible at once", async () => {
    const user = userEvent.setup();
    renderAt("/?do=send");
    await settle();
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Coins/ }));
    expect(windowFrame("Send")).toBeInTheDocument();
    expect(windowFrame("Coins")).toBeInTheDocument();
  });

  it("closing one window leaves the other open", async () => {
    const user = userEvent.setup();
    renderAt("/?do=send");
    await settle();
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Coins/ }));
    await user.click(within(windowFrame("Send")).getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Send", { selector: "section" })).not.toBeInTheDocument();
    expect(windowFrame("Coins")).toBeInTheDocument();
  });

  it("clicking a background window brings it in front (its taskbar chip becomes active)", async () => {
    const user = userEvent.setup();
    renderAt("/?do=send");
    await settle();
    await user.click(within(screen.getByLabelText("What you can do")).getByRole("button", { name: /^Coins/ }));
    await user.click(windowFrame("Send"));
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: "Windows" }));
    const send = within(screen.getByRole("menu", { name: "Windows menu" })).getByRole("menuitemcheckbox", { name: "Send" });
    expect(send).toHaveAttribute("aria-checked", "true");
    // and the window behind loses its title bar's stripes
    expect(windowFrame("Coins")).toHaveClass("win--inactive");
    expect(windowFrame("Send")).not.toHaveClass("win--inactive");
  });
});

describe("dragging, resizing and minimising a window", () => {
  it("moves a window when its title bar is dragged", async () => {
    renderAt("/?do=send");
    await settle();
    const win = windowFrame("Send");
    const bar = win.querySelector(".win__bar")!;
    const before = win.style.left;
    fireDrag(bar, 0, 0, 40, 25);
    expect(win.style.left).not.toBe(before);
  });

  it("resizes a window when its corner grip is dragged", async () => {
    renderAt("/?do=send");
    await settle();
    const win = windowFrame("Send");
    const grip = win.querySelector(".win__resize")!;
    const beforeWidth = win.style.width;
    fireDrag(grip, 0, 0, 80, 60);
    expect(win.style.width).not.toBe(beforeWidth);
  });

  it("minimises a window to the taskbar and restores it at the same position", async () => {
    const user = userEvent.setup();
    renderAt("/?do=send");
    await settle();
    const win = windowFrame("Send");
    const before = { left: win.style.left, top: win.style.top };
    await user.click(within(win).getByRole("button", { name: "Minimise" }));
    expect(win).not.toBeVisible();
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: "Windows" }));
    const send = within(screen.getByRole("menu", { name: "Windows menu" })).getByRole("menuitemcheckbox", { name: "Send" });
    expect(send).toHaveClass("menu__item--hidden");
    await user.click(send);
    expect(win).toBeVisible();
    expect({ left: win.style.left, top: win.style.top }).toEqual(before);
  });
});

function fireDrag(handle: Element, x0: number, y0: number, x1: number, y1: number) {
  act(() => {
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x0, clientY: y0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x1, clientY: y1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

describe("closing the window", () => {
  it("closes just that window when the close light is clicked", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Swap")).not.toBeInTheDocument();
  });

  it("closes the topmost window on Esc", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Swap")).not.toBeInTheDocument();
  });

  it("ignores other keys", async () => {
    const user = userEvent.setup();
    renderAt("/?do=swap");
    await user.keyboard("{Enter}a ");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Swap");
  });

  it("shows the desktop again once every window is closed", async () => {
    const user = userEvent.setup();
    renderAt("/?do=mcp");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });

  it("puts every window away from the Windows menu's Show Desktop", async () => {
    const user = userEvent.setup();
    renderAt("/?do=mcp");
    await settle();
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: "Windows" }));
    await user.click(within(screen.getByRole("menu", { name: "Windows menu" })).getByRole("menuitem", { name: "Show Desktop" }));
    expect(windowFrame("MCP tools")).not.toBeVisible();
    expect(screen.queryByRole("menu", { name: "Windows menu" })).not.toBeInTheDocument();
  });
});

describe("the menu bar", () => {
  it("is present on the desktop and names the product", () => {
    renderAt("/");
    expect(
      within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }),
    ).toBeInTheDocument();
  });

  it("states the chain, because an address means nothing without one", () => {
    renderAt("/");
    expect(screen.getByLabelText("Menu bar")).toHaveTextContent("Base");
  });

  it("names the open window while one is open", async () => {
    renderAt("/?do=inference");
    await settle();
    const bar = within(screen.getByLabelText("Menu bar"));
    await userEvent.setup().click(bar.getByRole("button", { name: "Windows" }));
    expect(
      within(screen.getByRole("menu", { name: "Windows menu" })).getByRole("menuitemcheckbox", { name: "Private inference" }),
    ).toBeInTheDocument();
  });
});

describe("the app's own menu (it holds what the Start menu held)", () => {
  it("opens on a Start click, listing every visible feature and the doc pages", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    const menu = screen.getByRole("menu", { name: `${BRAND.name} menu` });
    expect(within(menu).getByRole("menuitem", { name: /^Check/ })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Docs" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "API" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Verify" })).toBeInTheDocument();
  });

  it("lists the desktop's doors, then its folders' programs, the off ones waiting in Coming Soon", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    const menu = screen.getByRole("menu", { name: `${BRAND.name} menu` });
    for (const id of ["folder-agents", "computer"] as const) {
      const group = within(menu).getByRole("group", { name: entryOf(id).title });
      expect(within(group).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([entryOf(id).title, ...folderItems(id).map((e) => e.title)]);
    }
    expect(within(menu).getByRole("menuitem", { name: "Read Me" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Bridge/ })).not.toBeInTheDocument();
    for (const f of comingSoon()) expect(within(menu).queryByRole("menuitem", { name: f.title })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Games" }));
    expect(windowFrame("Games")).toBeInTheDocument();
  });

  it("opens a window in place from the Home page, and closes the menu", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    await user.click(
      within(screen.getByRole("menu", { name: `${BRAND.name} menu` })).getByRole("menuitem", { name: /^Coins/ }),
    );
    expect(windowFrame("Coins")).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: `${BRAND.name} menu` })).not.toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    expect(screen.getByRole("menu", { name: `${BRAND.name} menu` })).toBeInTheDocument();
    await user.click(screen.getByRole("heading", { level: 1 }));
    expect(screen.queryByRole("menu", { name: `${BRAND.name} menu` })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderAt("/");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: BRAND.name }));
    expect(screen.getByRole("menu", { name: `${BRAND.name} menu` })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: `${BRAND.name} menu` })).not.toBeInTheDocument();
  });

  it("opens a window from a folder's own menu title, and moving across the bar switches menus", async () => {
    const user = userEvent.setup();
    renderAt("/");
    const bar = within(screen.getByLabelText("Menu bar"));
    // only the folders ON the desktop have a title in the bar (2026-10-29)
    expect(bar.queryByRole("button", { name: "Money folder" })).toBeNull();
    await user.click(bar.getByRole("button", { name: "My Computer folder" }));
    const computer = screen.getByRole("menu", { name: "My Computer folder menu" });
    expect(within(computer).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([entryOf("computer").title, ...folderItems("computer").map((e) => e.title)]);
    // hovering another title while one is open opens that one instead
    await user.hover(bar.getByRole("button", { name: "Agents folder" }));
    expect(screen.queryByRole("menu", { name: "My Computer folder menu" })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("menu", { name: "Agents folder menu" })).getByRole("menuitem", { name: /^MCP/ }));
    expect(windowFrame("MCP tools")).toBeInTheDocument();
    // with no menu open, hovering opens nothing; a second click on an open title closes it
    await user.hover(bar.getByRole("button", { name: "My Computer folder" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(bar.getByRole("button", { name: "My Computer folder" }));
    await user.click(bar.getByRole("button", { name: "My Computer folder" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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

  it("goes home from the menu bar's Show Desktop on a standalone page, not nowhere", async () => {
    const user = userEvent.setup();
    renderAt("/api");
    await user.click(within(screen.getByLabelText("Menu bar")).getByRole("button", { name: "Windows" }));
    await user.click(within(screen.getByRole("menu", { name: "Windows menu" })).getByRole("menuitem", { name: "Show Desktop" }));
    expect(screen.getByLabelText("What you can do")).toBeInTheDocument();
  });
});

/**
 * `x402` opens at prose height, never below panel height. MEASURED 2026-09-29: at panel
 * height the output box of a confirmed, wallet-ready payment sat 43px below its own Pay
 * button, and on a 673px viewport `pageHeight` alone came out SHORTER than a panel.
 */
describe("how tall a window opens", () => {
  const heightOf = (title: string) => parseInt(screen.getByLabelText(title, { selector: ".win" }).style.height, 10);

  function at(viewport: number) {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport });
  }

  it("opens x402 at prose height on a tall screen, taller than an ordinary panel", async () => {
    at(900);
    renderAt("/?do=x402");
    await settle();
    expect(heightOf("x402")).toBe(660);
  });

  it("sells only this app's own tools in x402: no BlueAgent, no any-URL, no request to either (2026-10-02)", async () => {
    at(900);
    const asked: string[] = [];
    vi.stubGlobal("fetch", (u: string) => (asked.push(String(u)), Promise.reject(new TypeError("Failed to fetch"))));
    renderAt("/?do=x402");
    await settle();
    expect(screen.queryByRole("group", { name: "Pay" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BlueAgent tools|Any x402 URL/ })).not.toBeInTheDocument();
    expect(asked.some((u) => u.includes("blueagent") || u.includes("/upstream"))).toBe(false);
    vi.unstubAllGlobals();
  });

  it("opens the own-tools-only x402 window for a wallet on the wrong chain, offering the switch", async () => {
    at(900);
    vi.stubGlobal("ethereum", {
      request: ({ method }: { method: string }) =>
        method === "eth_accounts" ? Promise.resolve(["0xabcdef0123456789abcdef0123456789abcdef01"]) : method === "eth_chainId" ? Promise.resolve("0x1") : Promise.reject(new Error("no")),
    });
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    renderAt("/?do=x402");
    await settle();
    expect(screen.getByLabelText("x402", { selector: ".win" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("never opens x402 shorter than an ordinary panel, however short the screen", async () => {
    at(673);
    renderAt("/?do=x402");
    await settle();
    expect(heightOf("x402")).toBe(568);
  });

  it("leaves an ordinary panel at panel height", async () => {
    at(900);
    renderAt("/?do=wallet");
    await settle();
    expect(heightOf("Connect wallet")).toBe(568);
  });

  /** A money form grows by a whole review once filled in, so it opens tall where it can. */
  it("opens every money window tall", async () => {
    at(900);
    for (const [id, title] of [["send", "Send"], ["swap", "Swap"], ["bridge", "Bridge"], ["launch", "Launch"]] as const) {
      const { unmount } = renderAt(`/?do=${id}`);
      await settle();
      expect(heightOf(title), id).toBe(660);
      unmount();
    }
  });
});

/**
 * The Docs window's two lists are claims a reader can check in the app, so they are
 * pinned to say the unfinished things out loud: nothing is deployed, and launch has not
 * yet been measured against a live o1.
 */
describe("what the Docs window admits", () => {
  it("lists what works and what does not, and claims no privacy", async () => {
    renderAt("/?do=docs");
    await settle();
    const works = screen.getByLabelText("Works today");
    const notYet = screen.getByLabelText("Not yet");
    expect(works).toHaveTextContent(/Research:/);
    expect(works).toHaveTextContent(/Safety:/);
    expect(works).toHaveTextContent(/The Terminal/);
    expect(works).toHaveTextContent(/Send ETH or any token.*launch a coin on this app's own launchpad/);
    // Robinhood Chain is hidden (2026-10-02): the Docs do not offer a bridge to it
    expect(works).not.toHaveTextContent(/Robinhood/);
    expect(notYet).toHaveTextContent(/The app itself is not deployed/);
    expect(notYet).toHaveTextContent(/launchpad contract has not been audited/);
    /*
      The privacy model was dropped on 2026-09-30. A leftover sentence promising it would
      be a claim this build cannot keep, so the whole window is checked, not one list.
    */
    const win = windowFrame("Docs — " + BRAND.name);
    expect(win.textContent).not.toMatch(/private|shielded|unlinkab|anonym/i);
  });
});
