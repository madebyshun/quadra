import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderAt } from "./helpers";

/**
 * `Page.tsx` used to hand `Window` no `layout` at all — a static frame with
 * minimise and zoom drawn but inert, per `tests/ui.test.tsx`'s "Window without
 * layout" block. It now carries a real one, so a standalone page's window
 * drags, resizes and minimises exactly like a window on the multi-window
 * desktop. This file is only about that layout wiring; `tests/ui.test.tsx`
 * already covers what `Window` does with a `layout` prop in general, and
 * `tests/app.test.tsx` already covers the close-light/Start-button/back-link
 * behaviour that predates this change.
 */
function fireDrag(handle: Element, x0: number, y0: number, x1: number, y1: number) {
  act(() => {
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x0, clientY: y0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x1, clientY: y1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

describe("Page: the standalone window now behaves like any other", () => {
  it("drags by the title bar", () => {
    renderAt("/verify");
    const win = screen.getByLabelText(/^Verify/);
    const left0 = win.style.left;
    const bar = win.querySelector(".win__bar")!;
    fireDrag(bar, 100, 100, 140, 130);
    expect(win.style.left).not.toBe(left0);
    expect(win.style.left).toBe(`${parseInt(left0) + 40}px`);
  });

  it("resizes from the corner grip, floored at the same minimum every window respects", () => {
    renderAt("/verify");
    const win = screen.getByLabelText(/^Verify/);
    const grip = win.querySelector(".win__resize")!;
    fireDrag(grip, 100, 100, -10000, -10000);
    expect(win.style.width).toBe("300px");
    expect(win.style.height).toBe("200px");
  });

  it("minimises to the taskbar on the light, and restores from the taskbar chip", async () => {
    const user = userEvent.setup();
    renderAt("/verify");
    const win = screen.getByLabelText(/^Verify/);
    await user.click(screen.getByRole("button", { name: "Minimise" }));
    expect(win).not.toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Verify/ }));
    expect(win).toBeVisible();
  });
});
