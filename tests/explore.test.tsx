import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { appsIn, BASE_APPS, domainOf, ECOSYSTEM_READ, FOLDERS_OF_BASE, type FolderKey } from "@/config/baseApps";
import { ExplorePanel } from "@/features/panels/ExplorePanel";
import { BRAND } from "@/brand";
import { ECOSYSTEM } from "./fixtures/ecosystem";

/** Which of base.org's categories each of our folders may draw from — the grouping is ours, the category is theirs. */
const ALLOWED: Record<FolderKey, readonly string[]> = {
  wallets: ["wallet/self-custody", "wallet/multisig"],
  defi: ["defi/lending/borrowing", "defi/dex", "defi/yield vault"],
  degen: ["defi/dex", "defi/portfolio", "defi/dex aggregator", "infra/data"],
  bridges: ["infra/bridge"],
  cashin: ["onramp/centralized exchange", "onramp/fiat on-ramp"],
  payments: ["consumer/payments", "defi/stablecoin"],
  jpegs: ["consumer/nft", "consumer/creator", "consumer/music"],
  social: ["consumer/social", "consumer/creator", "consumer/messaging", "infra/identity"],
  games: ["consumer/gaming"],
  ai: ["ai/ai"],
  dev: ["infra/developer tool", "infra/data", "infra/security", "infra/node provider / developer tool", "infra/raas"],
  daos: ["consumer/dao"],
};

describe("the directory's data — base.org's own entries, never typed from memory", () => {
  it("every project is an entry of the captured list: same name, same URL, same logo, an allowed category", () => {
    for (const app of BASE_APPS) {
      const src = ECOSYSTEM.find((e) => e.name === app.name);
      expect(src, app.name).toBeDefined();
      expect(app.url, app.name).toBe(src!.url);
      expect(app.logo, app.name).toBe(`https://www.base.org${src!.imageUrl}`);
      expect(ALLOWED[app.folder], app.name).toContain(`${src!.category}/${src!.subcategory}`);
    }
  });

  it("opens https only — the captured entries with an http URL are left out, and nothing else is", () => {
    for (const app of BASE_APPS) expect(new URL(app.url).protocol, app.name).toBe("https:");
    const missing = ECOSYSTEM.filter((e) => !BASE_APPS.some((a) => a.name === e.name)).map((e) => e.name);
    expect(missing).toEqual(["Aerodrome Finance", "Uniswap"]);
    for (const name of missing) expect(ECOSYSTEM.find((e) => e.name === name)!.url).toMatch(/^http:\/\//);
  });

  it("has one entry per name, a line for each, and no folder empty", () => {
    expect(new Set(BASE_APPS.map((a) => a.name)).size).toBe(BASE_APPS.length);
    for (const app of BASE_APPS) expect(app.line.length, app.name).toBeGreaterThan(10);
    for (const f of FOLDERS_OF_BASE) expect(appsIn(f.key).length, f.key).toBeGreaterThan(0);
    expect(BASE_APPS).toHaveLength(82);
  });

  it("names a link by its host, without www", () => {
    expect(domainOf("https://www.coinbase.com/wallet")).toBe("coinbase.com");
    expect(domainOf("https://rabby.io")).toBe("rabby.io");
  });
});

describe("the Explore Base window", () => {
  const open = (name: string) => fireEvent.doubleClick(screen.getByRole("button", { name }));

  it("opens on the folders, and Up goes back to them", () => {
    render(<ExplorePanel />);
    const grid = screen.getByRole("list", { name: "Explore Base" });
    expect(within(grid).getAllByRole("button").map((b) => b.textContent)).toEqual(FOLDERS_OF_BASE.map((f) => f.title));
    expect(screen.getByRole("status")).toHaveTextContent(`12 folders · ${BASE_APPS.length} programs`);
    expect(screen.getByRole("button", { name: "↑ Up" })).toBeDisabled();
    expect(screen.getByText(/base\.org's ecosystem list/)).toHaveAttribute("href", "https://www.base.org/ecosystem");
    expect(screen.getByText(new RegExp(`read ${ECOSYSTEM_READ}`))).toBeInTheDocument();
    open("Wallets");
    expect(screen.getByText("Explore Base \\ Wallets")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "↑ Up" }));
    expect(screen.getByRole("list", { name: "Explore Base" })).toBeInTheDocument();
  });

  it("a folder holds <name>.exe icons with base.org's logos, and Add yours.exe; a click selects", () => {
    render(<ExplorePanel />);
    open("Wallets");
    const grid = screen.getByRole("list", { name: "Wallets" });
    const labels = within(grid).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual([...appsIn("wallets").map((a) => `${a.name}.exe`), "Add yours.exe"]);
    expect(screen.getByRole("status")).toHaveTextContent(`${appsIn("wallets").length} programs`);
    const rabby = screen.getByRole("button", { name: "Rabby Wallet.exe" });
    expect(rabby.querySelector("img")).toHaveAttribute("src", "https://www.base.org/images/partners/rabby_wallet.webp");
    fireEvent.click(rabby);
    expect(rabby).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Rabby Wallet.exe — Shows what a transaction will do");
  });

  it("a logo that will not load becomes the generic program glyph", () => {
    render(<ExplorePanel />);
    open("Wallets");
    const img = screen.getByRole("button", { name: "Rabby Wallet.exe" }).querySelector("img")!;
    fireEvent.error(img);
    expect(screen.getByRole("button", { name: "Rabby Wallet.exe" }).querySelector("img")).toBeNull();
  });

  it("running a project only opens the dialog; Open is a new-window link with no opener, Cancel closes", () => {
    render(<ExplorePanel />);
    open("Wallets");
    open("Rabby Wallet.exe");
    const dialog = screen.getByRole("dialog", { name: "Rabby Wallet.exe" });
    expect(dialog).toHaveTextContent("Rabby Wallet.exe — Shows what a transaction will do before you sign it.");
    expect(dialog).toHaveTextContent("Rabby Wallet.exe wants to open rabby.io in a new window.");
    const go = within(dialog).getByRole("link", { name: "Open" });
    expect(go).toHaveAttribute("href", "https://rabby.io");
    expect(go).toHaveAttribute("target", "_blank");
    expect(go).toHaveAttribute("rel", "noopener noreferrer");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Open closes it too, and Escape does
    open("Rabby Wallet.exe");
    fireEvent.click(screen.getByRole("link", { name: "Open" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    open("Rabby Wallet.exe");
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    open("Rabby Wallet.exe");
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "a" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Enter runs an icon as a double click does; other keys do nothing", () => {
    render(<ExplorePanel />);
    fireEvent.keyDown(screen.getByRole("button", { name: "DeFi" }), { key: "a" });
    expect(screen.getByRole("list", { name: "Explore Base" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "DeFi" }), { key: "Enter" });
    expect(screen.getByRole("list", { name: "DeFi" })).toBeInTheDocument();
  });

  it("Add yours.exe explains how to get listed and sends nothing", () => {
    render(<ExplorePanel />);
    open("Dev");
    open("Add yours.exe");
    const dialog = screen.getByRole("dialog", { name: "Add yours.exe" });
    expect(dialog).toHaveTextContent("base/web");
    expect(dialog).toHaveTextContent(BRAND.x);
    expect(dialog).toHaveTextContent("Nothing is sent from here");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
