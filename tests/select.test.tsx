import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlatinumSelect } from "@/ui/Select";

/** The Platinum drop-down: a real <select> for keyboards and tests, a menu for the eye. */
describe("PlatinumSelect", () => {
  const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];

  it("opens its menu, picks an option, and closes", () => {
    const onChange = vi.fn();
    render(<PlatinumSelect ariaLabel="Letter" value="a" onChange={onChange} options={options} className="extra" />);
    const button = screen.getByRole("button", { name: "Alpha" });
    expect(button.parentElement).toHaveClass("qselect", "extra");
    fireEvent.click(button);
    const menu = screen.getByRole("listbox", { name: "Letter options" });
    expect(within(menu).getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(menu).getByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(screen.getByLabelText("Letter"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and on a click outside, and ignores other keys and clicks inside", () => {
    render(<div><PlatinumSelect value="zz" onChange={vi.fn()} options={options} /><p>outside</p></div>);
    // an unknown value shows the first option
    const button = screen.getByRole("button", { name: "Alpha" });
    fireEvent.click(button);
    expect(screen.getByRole("listbox", { name: "Options" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.mouseDown(button);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows groups under their headings, and the value itself when there are no options", () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <PlatinumSelect ariaLabel="Pair" value="y" onChange={onChange} groups={[{ label: "Crypto", options: [{ value: "x", label: "ETH" }] }, { label: "Stocks", options: [{ value: "y", label: "NVDAc" }] }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "NVDAc" }));
    const menu = screen.getByRole("listbox");
    expect(menu).toHaveTextContent("Crypto");
    expect(menu).toHaveTextContent("Stocks");
    fireEvent.click(within(menu).getByRole("option", { name: "ETH" }));
    expect(onChange).toHaveBeenCalledWith("x");
    unmount();
    render(<PlatinumSelect value="raw" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "raw" }));
    expect(screen.getByRole("listbox")).toBeEmptyDOMElement();
  });

  it("does not open while disabled", () => {
    render(<PlatinumSelect ariaLabel="Off" value="a" onChange={vi.fn()} options={options} disabled />);
    const button = screen.getByRole("button", { name: "Alpha" });
    fireEvent.click(button);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
