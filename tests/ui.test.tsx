import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Window } from "@/ui/Window";
import { Crt } from "@/ui/Crt";
import { Gel } from "@/ui/Gel";

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
