import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Taskbar } from "@/ui/Taskbar";
import { WalletProvider } from "@/ui/WalletProvider";
import { BRAND } from "@/brand";
import type { WindowId } from "@/features/registry";

/**
 * `Taskbar` through `tests/app.test.tsx` only ever sees it with `onOpenFeature`
 * set (the Home page) or wired to a real navigate-home `onStart` (the standalone
 * pages) — and on those pages a Start click navigates away before the menu can be
 * observed, so the `onOpenFeature`-absent branch (a plain `Link` per item) is only
 * reachable by rendering the component directly, with an `onStart` that does not
 * unmount it out from under the click.
 */
function renderTaskbar(onOpenFeature?: (id: WindowId) => void) {
  const onStart = vi.fn();
  const onToggle = vi.fn();
  render(
    <MemoryRouter>
      {/* the tray reads the page's one wallet session — see `ui/WalletProvider.tsx` */}
      <WalletProvider>
        <Taskbar windows={[]} onToggle={onToggle} onStart={onStart} {...(onOpenFeature ? { onOpenFeature } : {})} />
      </WalletProvider>
    </MemoryRouter>,
  );
  return { onStart, onToggle };
}

describe("the menu bar's app menu, without a window manager to open into", () => {
  it("renders every feature as a link to /?do=<id> rather than a button", async () => {
    const user = userEvent.setup();
    renderTaskbar();
    await user.click(screen.getByRole("button", { name: BRAND.name }));
    const item = within(screen.getByRole("menu", { name: `${BRAND.name} menu` })).getByRole("menuitem", {
      name: /^Send/,
    });
    expect(item.tagName).toBe("A");
    expect(item).toHaveAttribute("href", "/?do=send");
  });

  it("closes the menu when a link item is clicked", async () => {
    const user = userEvent.setup();
    renderTaskbar();
    await user.click(screen.getByRole("button", { name: BRAND.name }));
    await user.click(
      within(screen.getByRole("menu", { name: `${BRAND.name} menu` })).getByRole("menuitem", { name: /^Send/ }),
    );
    expect(screen.queryByRole("menu", { name: `${BRAND.name} menu` })).not.toBeInTheDocument();
  });

  it("closes the menu when a doc-page link item is clicked", async () => {
    const user = userEvent.setup();
    renderTaskbar();
    await user.click(screen.getByRole("button", { name: BRAND.name }));
    await user.click(
      within(screen.getByRole("menu", { name: `${BRAND.name} menu` })).getByRole("menuitem", { name: "Docs" }),
    );
    expect(screen.queryByRole("menu", { name: `${BRAND.name} menu` })).not.toBeInTheDocument();
  });

  it("calls onStart from the Windows menu's Show Desktop, and closes the menu", async () => {
    const user = userEvent.setup();
    const { onStart } = renderTaskbar();
    await user.click(screen.getByRole("button", { name: "Windows" }));
    await user.click(screen.getByRole("menuitem", { name: "Show Desktop" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("links a folder's own menu back to the desktop too", async () => {
    const user = userEvent.setup();
    renderTaskbar();
    await user.click(screen.getByRole("button", { name: "Money folder" }));
    expect(screen.getByRole("menuitem", { name: /^Send/ })).toHaveAttribute("href", "/?do=send");
  });
});

describe("the Windows menu", () => {
  it("lists every open window, checks the one in front, dims a hidden one, and toggles the picked one", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <MemoryRouter>
        <WalletProvider>
          <Taskbar
            windows={[
              { id: "send", title: "Send", minimized: false, focused: true },
              { id: "swap", title: "Swap", minimized: true, focused: false },
            ]}
            onToggle={onToggle}
            onStart={() => {}}
          />
        </WalletProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Windows" }));
    const send = screen.getByRole("menuitemcheckbox", { name: "Send" });
    const swap = screen.getByRole("menuitemcheckbox", { name: "Swap" });
    expect(send).toHaveAttribute("aria-checked", "true");
    expect(swap).toHaveAttribute("aria-checked", "false");
    expect(swap).toHaveClass("menu__item--hidden");
    await user.click(swap);
    expect(onToggle).toHaveBeenCalledWith("swap");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
