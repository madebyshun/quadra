import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Assistant, HELLO_MS } from "@/ui/Assistant";
import { OpenWindowProvider } from "@/features/openWindow";
import { GREETING, Q_KEY, forgetTips, say } from "@/lib/assistant";
import { renderAt, settle } from "./helpers";

beforeEach(() => forgetTips());
afterEach(() => vi.useRealTimers());

const q = () => screen.queryByRole("status", { name: "Q, the assistant" });

describe("Assistant", () => {
  it("greets after HELLO_MS, and its action runs the command on the desktop and closes", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    render(
      <OpenWindowProvider open={open}>
        <Assistant />
      </OpenWindowProvider>,
    );
    expect(q()).toBeNull();
    act(() => void vi.advanceTimersByTime(HELLO_MS - 1));
    expect(q()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText(GREETING.text)).toBeInTheDocument();
    expect(q()).not.toHaveClass("q--bad");
    fireEvent.click(screen.getByRole("button", { name: GREETING.action!.label }));
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]![0]).toBe("research");
    expect(q()).toBeNull();
  });

  it("stays quiet with greet=false; a bad tip wears its tone and Thanks closes it; no action button outside the desktop", () => {
    vi.useFakeTimers();
    render(<Assistant greet={false} />);
    act(() => void vi.advanceTimersByTime(HELLO_MS * 2));
    expect(q()).toBeNull();
    act(() => say({ id: "red", tone: "bad", text: "red!", action: { label: "Go", command: "radar" } }));
    expect(q()).toHaveClass("q--bad");
    expect(screen.queryByRole("button", { name: "Go" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thanks" }));
    expect(q()).toBeNull();
  });

  it("“Don't show Q again” hides Q and is remembered", () => {
    render(<Assistant greet={false} />);
    act(() => say({ id: "ok", tone: "ok", text: "fine" }));
    expect(q()).toHaveClass("q--ok");
    fireEvent.click(screen.getByRole("button", { name: "Don't show Q again" }));
    expect(q()).toBeNull();
    expect(localStorage.getItem(Q_KEY)).toBe("off");
    act(() => say({ id: "later", text: "anyone?" }));
    expect(q()).toBeNull();
  });

  it("is on the real desktop once the intro is over", async () => {
    renderAt("/");
    await settle();
    act(() => say({ id: "app", text: "on the desktop" }));
    expect(screen.getByText("on the desktop")).toBeInTheDocument();
  });
});
