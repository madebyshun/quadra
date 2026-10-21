import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { blockText, BootScreen, CLICK_PX, DRAG, hintFor, Intro } from "@/intro/Intro";
import type { Hit, IntroScene } from "@/intro/scene";
import { ORBIT_LIMITS, startOf, TOTAL_MS, type Orbit } from "@/intro/timeline";
import { RX } from "./fixtures/radar";
import { DOWN, net, useNet } from "./net";
import { renderAt, settle } from "./helpers";

useNet();

/**
 * The intro component runs here with its clock, its animation frames and its scene all in the
 * test's hands: frames are stepped one at a time, the clock is set, and the scene records what it
 * was asked to draw. The latest block it shows comes from the captured `eth_blockNumber`.
 */

let frames: FrameRequestCallback[] = [];
let ms = 0;
const clock = () => ms;

beforeEach(() => {
  frames = [];
  ms = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  // jsdom has no PointerEvent: without one, a fired pointer event carries no coordinates
  vi.stubGlobal("PointerEvent", class extends MouseEvent {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeScene(under: Hit = null) {
  const drawn: { ms: number; pointer: { x: number; y: number }; orbit?: Orbit }[] = [];
  const scene: IntroScene & { resized: [number, number][]; disposed: number; under: Hit } = {
    resized: [],
    disposed: 0,
    under,
    frame: (t, pointer, orbit) => void drawn.push({ ms: t, pointer: { ...pointer }, ...(orbit ? { orbit } : {}) }),
    hit() {
      return this.under;
    },
    resize(w, h) {
      this.resized.push([w, h]);
    },
    dispose() {
      this.disposed++;
    },
  };
  return { scene, drawn };
}

/** Advance the clock to `to` and run the next animation frame. */
async function step(to: number) {
  ms = to;
  const next = frames.shift();
  await act(async () => next?.(ms));
}

/** Base answers the latest block (or does not); every other read the page makes is down. */
function chain(block: unknown = RX.blockNumber) {
  net({ rpc: (m) => (m === "eth_blockNumber" ? block : undefined), get: () => DOWN });
}

/** The tube's element, as the component handed it to the scene — the boot screen renders into it. */
let tube: HTMLElement = document.createElement("div");

async function mount(start: () => Promise<IntroScene>) {
  const onDone = vi.fn();
  const view = render(
    <Intro
      onDone={onDone}
      start={(_, el) => {
        tube = el;
        return start();
      }}
      clock={clock}
    />,
  );
  await settle();
  return { onDone, view };
}

describe("the boot screen", () => {
  it("says the latest block it read, that it is reading, or that Base was not reached", () => {
    expect(blockText({ kind: "read", number: 52042198n })).toBe("Base 8453 · block 52,042,198");
    expect(blockText({ kind: "reading" })).toBe("Base 8453 · reading the latest block…");
    expect(blockText({ kind: "unreached" })).toBe("Base 8453 · not reached — look-ups will try again");
  });

  it("shows the icon, then the welcome box, then the desktop the page is about to be", () => {
    const at = (phase: Parameters<typeof BootScreen>[0]["phase"]) => render(<BootScreen phase={phase} block={{ kind: "reading" }} />).container;
    expect(at("icon").querySelector(".boot__icon")).not.toBeNull();
    expect(at("welcome").textContent).toContain("Welcome to Quadra");
    expect(at("welcome").textContent).not.toContain("Click the screen");
    expect(at("ready").textContent).toContain("Click the screen to begin ▸");
    for (const p of ["zoom", "fade", "done"] as const) expect(at(p).querySelector(".boot__desk")).not.toBeNull();
    expect(at("dark").textContent).toBe("");
  });
});

describe("the intro", () => {
  it("plays every phase on its clock, draws each frame, and ends by handing over", async () => {
    chain();
    const { scene, drawn } = fakeScene();
    const { onDone, view } = await mount(async () => scene);
    // the first frame is drawn before the clock starts: it compiles the shaders
    expect(drawn[0]).toEqual({ ms: 0, pointer: { x: 0, y: 0 } });
    expect(drawn[1]!.orbit).toEqual({ yaw: 0, pitch: 0, zoom: 1 });
    expect(view.container.querySelector(".intro")).toHaveClass("intro--dark");

    await step(startOf("icon"));
    expect(tube.querySelector(".boot__icon")).not.toBeNull();
    await step(startOf("welcome") + 10);
    expect(tube.querySelector(".boot__block")).toHaveTextContent(`block ${BigInt(RX.blockNumber).toLocaleString("en-US")}`);
    await step(startOf("zoom"));
    expect(view.container.querySelector(".intro")).toHaveClass("intro--zoom");
    expect(onDone).not.toHaveBeenCalled();
    await step(TOTAL_MS);
    expect(onDone).toHaveBeenCalledOnce();
    expect(drawn.map((d) => d.ms)).toEqual([0, 0, startOf("icon"), startOf("welcome") + 10, startOf("zoom")]);
  });

  it("leans the camera with the pointer and follows a resize", async () => {
    chain();
    const { scene, drawn } = fakeScene();
    await mount(async () => scene);
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: window.innerWidth, clientY: 0 }));
    await step(100);
    expect(drawn.at(-1)!.pointer).toEqual({ x: 1, y: 1 });
    fireEvent(window, new Event("resize"));
    expect(scene.resized).toEqual([[window.innerWidth, window.innerHeight]]);
  });

  it("skips to the hand-over on the Skip button or Esc — not on a click, which is for playing", async () => {
    chain();
    const { scene, drawn } = fakeScene();
    const { view } = await mount(async () => scene);
    const overlay = view.container.querySelector(".intro")!;
    await step(300);
    // a click on nothing in particular does nothing at all
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(overlay, { clientX: 10, clientY: 10 });
    await step(400);
    expect(drawn.at(-1)!.ms).toBe(400);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Skip intro" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    await step(500);
    expect(drawn.at(-1)!.ms).toBe(startOf("fade"));
    expect(overlay).toHaveClass("intro--fade");
    // during the hand-over, neither a skip nor the visitor's action changes anything
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });
    await step(600);
    expect(drawn.at(-1)!.ms).toBe(startOf("fade") + 100);
  });

  it("switches the machine on when it is clicked, and goes in when the screen is — or on Enter", async () => {
    chain();
    const { scene, drawn } = fakeScene("machine");
    const { view } = await mount(async () => scene);
    const overlay = view.container.querySelector(".intro")!;
    await step(startOf("idle") + 500);
    expect(screen.getByText(hintFor("idle")!)).toBeInTheDocument();
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(overlay, { clientX: 302, clientY: 301 });
    const clicked = startOf("idle") + 600;
    await step(clicked);
    expect(drawn.at(-1)!.ms).toBe(startOf("warm"));
    // from here the intro's clock runs ahead of the page's by the time the click saved
    const at = (introMs: number) => introMs + clicked - startOf("warm");
    // booting: a click does not jump ahead
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 300 });
    await step(at(startOf("warm") + 100));
    expect(drawn.at(-1)!.ms).toBe(startOf("warm") + 100);
    // ready: the machine is not the screen; the screen goes in
    await step(at(startOf("ready") + 100));
    expect(screen.getByText(hintFor("ready")!)).toBeInTheDocument();
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 300 });
    await step(at(startOf("ready") + 200));
    expect(drawn.at(-1)!.ms).toBe(startOf("ready") + 200);
    scene.under = "screen";
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 300 });
    await step(at(startOf("ready") + 300));
    expect(drawn.at(-1)!.ms).toBe(startOf("zoom"));
    expect(hintFor("zoom")).toBeNull();
  });

  it("goes on by itself with Enter, or when the visitor does nothing", async () => {
    chain();
    const { scene, drawn } = fakeScene();
    await mount(async () => scene);
    await step(200);
    fireEvent.keyDown(window, { key: "Enter" });
    await step(300);
    expect(drawn.at(-1)!.ms).toBe(startOf("warm"));
    // nobody clicks the screen: the wait ends on its own
    await step(startOf("zoom") - startOf("warm") + 300);
    expect(drawn.at(-1)!.ms).toBe(startOf("zoom"));
  });

  it("turns the view when dragged, leans in when scrolled, and a drag is not a click", async () => {
    chain();
    const { scene, drawn } = fakeScene("machine");
    const { view } = await mount(async () => scene);
    const overlay = view.container.querySelector(".intro")!;
    await step(startOf("idle") + 100);
    fireEvent.pointerDown(overlay, { clientX: 300, clientY: 300 });
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 320 });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 320 });
    fireEvent.wheel(overlay, { deltaY: -100 });
    await step(startOf("idle") + 200);
    const o = drawn.at(-1)!;
    expect(o.ms).toBe(startOf("idle") + 200);
    expect(o.orbit!.yaw).toBeCloseTo(-100 * DRAG.yaw);
    expect(o.orbit!.pitch).toBeCloseTo(20 * DRAG.pitch);
    expect(o.orbit!.zoom).toBeCloseTo(1 - 100 * DRAG.zoom);
    expect(100).toBeGreaterThan(CLICK_PX);
    // dragged far, the view stops at its limit
    fireEvent.pointerDown(overlay, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(overlay, { clientX: -5000, clientY: 0 });
    fireEvent.pointerLeave(overlay);
    await step(startOf("idle") + 300);
    expect(drawn.at(-1)!.orbit!.yaw).toBe(ORBIT_LIMITS.yaw);
  });

  it("shows a hand over what a click would act on, and nothing once the pointer leaves", async () => {
    chain();
    const { scene } = fakeScene("machine");
    const { view } = await mount(async () => scene);
    const overlay = view.container.querySelector(".intro")!;
    await step(startOf("idle") + 100);
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 300 });
    expect(overlay).toHaveClass("intro--hover");
    fireEvent.pointerLeave(overlay);
    expect(overlay).not.toHaveClass("intro--hover");
    // while it boots, nothing is clickable
    await step(startOf("icon"));
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 300 });
    expect(overlay).not.toHaveClass("intro--hover");
  });

  it("ends at once when skipped before three.js has even loaded", async () => {
    chain();
    let release: (s: IntroScene) => void = () => {};
    const { onDone } = await mount(() => new Promise((r) => (release = r)));
    expect(screen.getByText("Starting up…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).toHaveBeenCalledOnce();
    release(fakeScene().scene);
  });

  it("keeps time by the page's own monotonic clock unless it is given one", async () => {
    chain();
    const { scene, drawn } = fakeScene();
    const read = vi.spyOn(performance, "now").mockReturnValue(1000);
    render(<Intro onDone={() => {}} start={async () => scene} />);
    await settle();
    read.mockReturnValue(1250);
    await act(async () => frames.shift()?.(0));
    expect(drawn.at(-1)!.ms).toBe(250);
    read.mockRestore();
  });

  it("is not a gate: no three.js or no GPU means straight to the desktop", async () => {
    chain();
    const { onDone } = await mount(() => Promise.reject(new Error("WebGL not available")));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("says when Base was not reached, rather than showing no block", async () => {
    chain(DOWN);
    const { scene } = fakeScene();
    await mount(async () => scene);
    await step(startOf("welcome"));
    expect(tube.querySelector(".boot__block")).toHaveTextContent("not reached");
  });

  it("lets go of everything when it leaves, including a scene or a block that arrives late", async () => {
    let answer: (v: unknown) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise((r) => (answer = r)));
    let release: (s: IntroScene) => void = () => {};
    const late = fakeScene().scene;
    const { view } = await mount(() => new Promise((r) => (release = r)));
    view.unmount();
    await act(async () => {
      release(late);
      answer(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" })));
    });
    expect(late.disposed).toBe(1);

    // a running scene is disposed with the component, and a failure after leaving is ignored
    chain();
    const running = fakeScene().scene;
    const second = await mount(async () => running);
    second.view.unmount();
    expect(running.disposed).toBe(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    chain(DOWN);
    let fail: (e: Error) => void = () => {};
    const third = await mount(() => new Promise((_, reject) => (fail = reject)));
    third.view.unmount();
    await act(async () => fail(new Error("late")));
    expect(third.onDone).not.toHaveBeenCalled();
  });
});

describe("on the home page", () => {
  const allowMotion = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));

  it("plays over the desktop when there is a GPU, and the desktop is there when it ends", async () => {
    allowMotion();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as RenderingContext);
    chain();
    renderAt("/");
    expect(document.querySelector(".intro")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Quadra" })).toBeInTheDocument();
    // from here on the probe says no, as the real WebGLRenderer finds: there is no GPU in a test
    getContext.mockReturnValue(null);
    // in this test environment the real three.js cannot draw, so the intro gives way at once
    // (three says so on the console; that sentence is the expected one, not noise to keep)
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    await settle();
    await vi.waitFor(() => expect(document.querySelector(".intro")).toBeNull());
    expect(said).toHaveBeenCalledWith("THREE.WebGLRenderer: Error creating WebGL context.");
    said.mockRestore();
  });

  it("does not play for a window link", () => {
    allowMotion();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as RenderingContext);
    renderAt("/?do=swap");
    expect(document.querySelector(".intro")).toBeNull();
  });
});
