import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MENUBAR_H, Window, type WindowLayout } from "@/ui/Window";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";

function makeLayout(overrides: Partial<WindowLayout> = {}): WindowLayout {
  return {
    x: 10,
    y: 20,
    width: 400,
    height: 300,
    zIndex: 1,
    visible: true,
    onFocus: vi.fn(),
    onMinimize: vi.fn(),
    onMove: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
}

function fireDrag(handle: Element, x0: number, y0: number, x1: number, y1: number) {
  act(() => {
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x0, clientY: y0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x1, clientY: y1 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

describe("Window", () => {
  it("labels the frame with its title so it is findable by name", () => {
    render(<Window title="Swap">body</Window>);
    expect(screen.getByLabelText("Swap")).toBeInTheDocument();
  });

  it("draws all three traffic lights, because the frame reads wrong without them", () => {
    render(<Window title="Swap">body</Window>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Minimise/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Zoom/ })).toBeInTheDocument();
  });

  it("marks minimise and zoom disabled rather than pretending they work", () => {
    render(<Window title="Swap">body</Window>);
    expect(screen.getByRole("button", { name: /Minimise/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Zoom/ })).toBeDisabled();
  });

  it("keeps the inert lights out of the tab order", () => {
    render(<Window title="Swap">body</Window>);
    expect(screen.getByRole("button", { name: /Minimise/ })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: /Zoom/ })).toHaveAttribute("tabindex", "-1");
  });

  it("says so in the label when a light does nothing", () => {
    render(<Window title="Swap">body</Window>);
    expect(screen.getByRole("button", { name: "Minimise (not available)" })).toBeInTheDocument();
  });

  it("disables close when there is nowhere to close to", () => {
    render(<Window title="Docs">body</Window>);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  });

  it("calls onClose once per click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Window title="Swap" onClose={onClose}>
        body
      </Window>,
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders its children in the body", () => {
    render(
      <Window title="Swap">
        <p>the actual content</p>
      </Window>,
    );
    expect(screen.getByText("the actual content")).toBeInTheDocument();
  });
});

describe("Window with layout (the floating, multi-window desktop)", () => {
  it("positions itself from the layout, rather than the static centred frame", () => {
    render(
      <Window title="Send" layout={makeLayout({ x: 10, y: 20, width: 400, height: 300, zIndex: 3 })}>
        body
      </Window>,
    );
    const win = screen.getByLabelText("Send");
    expect(win.style.left).toBe("10px");
    expect(win.style.top).toBe("20px");
    expect(win.style.width).toBe("400px");
    expect(win.style.height).toBe("300px");
    expect(win.style.zIndex).toBe("3");
  });

  it("hides itself with display:none while minimised, rather than unmounting", () => {
    render(
      <Window title="Send" layout={makeLayout({ visible: false })}>
        body
      </Window>,
    );
    expect(screen.getByLabelText("Send")).not.toBeVisible();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("enables minimise, and calls onMinimize", async () => {
    const user = userEvent.setup();
    const onMinimize = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ onMinimize })}>
        body
      </Window>,
    );
    const light = screen.getByRole("button", { name: "Minimise" });
    expect(light).not.toBeDisabled();
    await user.click(light);
    expect(onMinimize).toHaveBeenCalledTimes(1);
  });

  it("focuses on any mousedown inside the frame", () => {
    const onFocus = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ onFocus })}>
        body
      </Window>,
    );
    act(() => {
      screen.getByLabelText("Send").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onFocus).toHaveBeenCalled();
  });

  it("drags by the title bar, moving the window by the mouse delta", () => {
    const onMove = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ x: 10, y: 20, onMove })}>
        body
      </Window>,
    );
    const bar = screen.getByLabelText("Send").querySelector(".win__bar")!;
    fireDrag(bar, 100, 100, 140, 130);
    expect(onMove).toHaveBeenCalledWith(50, 50);
  });

  it("does not start a drag when the mousedown lands on a traffic light", () => {
    const onMove = vi.fn();
    render(
      <Window title="Send" onClose={() => {}} layout={makeLayout({ onMove })}>
        body
      </Window>,
    );
    const closeLight = screen.getByRole("button", { name: "Close" });
    fireDrag(closeLight, 100, 100, 140, 130);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("never moves a dragged window up under the menu bar", () => {
    const onMove = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ x: 10, y: 20, onMove })}>
        body
      </Window>,
    );
    const bar = screen.getByLabelText("Send").querySelector(".win__bar")!;
    fireDrag(bar, 100, 100, 100, -500);
    expect(onMove).toHaveBeenCalledWith(10, MENUBAR_H);
  });

  it("resizes from the corner grip, growing by the mouse delta", () => {
    const onResize = vi.fn();
    const onFocus = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ width: 400, height: 300, onResize, onFocus })}>
        body
      </Window>,
    );
    const grip = screen.getByLabelText("Send").querySelector(".win__resize")!;
    fireDrag(grip, 100, 100, 160, 140);
    expect(onResize).toHaveBeenCalledWith(460, 340);
    // the grip also focuses the window, same as any other click inside it
    expect(onFocus).toHaveBeenCalled();
  });

  it("stops dragging on mouseup, so a later mousemove is a no-op", () => {
    const onMove = vi.fn();
    render(
      <Window title="Send" layout={makeLayout({ x: 10, y: 20, onMove })}>
        body
      </Window>,
    );
    const bar = screen.getByLabelText("Send").querySelector(".win__bar")!;
    fireDrag(bar, 100, 100, 140, 130);
    onMove.mockClear();
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 200, clientY: 200 }));
    });
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("Crt", () => {
  it("is a labelled group, since the content is usually raw hex", () => {
    render(<Crt label="Receipt">0xdead</Crt>);
    expect(screen.getByRole("group", { name: "Receipt" })).toHaveTextContent("0xdead");
  });

  it("falls back to a generic label rather than none", () => {
    render(<Crt>0xbeef</Crt>);
    expect(screen.getByRole("group", { name: "output" })).toBeInTheDocument();
  });
});

describe("Gel", () => {
  it("defaults to type=button, so it never submits a form by accident", () => {
    render(<Gel>Check it</Gel>);
    expect(screen.getByRole("button", { name: "Check it" })).toHaveAttribute("type", "button");
  });

  it("can still be a submit button when asked", () => {
    render(<Gel type="submit">Go</Gel>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "submit");
  });

  it("wears the graphite variant only when quiet", () => {
    const { rerender } = render(<Gel>Loud</Gel>);
    expect(screen.getByRole("button")).not.toHaveClass("gel--quiet");
    rerender(<Gel quiet>Quiet</Gel>);
    expect(screen.getByRole("button")).toHaveClass("gel", "gel--quiet");
  });

  it("keeps a caller's className alongside its own", () => {
    render(<Gel className="wide">Go</Gel>);
    expect(screen.getByRole("button")).toHaveClass("gel", "wide");
  });

  it("does not leak `quiet` onto the dom as an attribute", () => {
    render(<Gel quiet>Go</Gel>);
    expect(screen.getByRole("button")).not.toHaveAttribute("quiet");
  });

  it("forwards disabled and does not fire when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Gel disabled onClick={onClick}>
        Go
      </Gel>,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
