import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PROCESS_REFRESH_MS, TaskManagerPanel } from "@/features/panels/TaskManagerPanel";
import { PulseContext } from "@/ui/usePulse";
import { ACHIEVEMENTS_KEY } from "@/lib/achievements";
import type { Activity } from "@/skills/activity";
import { fakePulse, pulse } from "./pulseFake";
import { settle } from "./helpers";

const launchActivity = vi.fn<() => Promise<Activity>>();
vi.mock("@/skills/activity", () => ({ launchActivity: () => launchActivity() }));

beforeEach(() => launchActivity.mockReset());
afterEach(() => vi.useRealTimers());

function mount(p = fakePulse()) {
  render(
    <PulseContext.Provider value={p.store}>
      <TaskManagerPanel />
    </PulseContext.Provider>,
  );
  return p;
}

describe("Task Manager — Performance", () => {
  it("waits, then shows the pulse with tps measuring… on one block, and counts the visit", () => {
    const p = mount();
    expect(screen.getByText("Reading Base…")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)!).taskmgr).toBe(1);
    act(() => p.set({ kind: "live", pulse: pulse(7, { baseFeeGwei: 0.0042, fullness: 0.37 }), history: [pulse(7)] }));
    expect(screen.getByText("measuring…")).toBeInTheDocument();
    expect(screen.getByText("0.0042 gwei")).toBeInTheDocument();
    expect(screen.getByText(/how full each block is: 37%/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Block fullness, last 1 blocks read" })).toBeInTheDocument();
  });

  it("works out tx/s over a history, a larger base fee to three places, and says when it is stale", () => {
    const history = [pulse(1, { txs: 10, time: 100 }), pulse(2, { txs: 30, time: 102, baseFeeGwei: 0.25 })];
    const p = mount(fakePulse({ kind: "live", pulse: history[1]!, history }));
    expect(screen.getByText("15.0")).toBeInTheDocument();
    expect(screen.getByText("0.250 gwei")).toBeInTheDocument();
    expect(screen.getByText("30 txs")).toBeInTheDocument();
    act(() => p.set({ kind: "stale", pulse: history[1]!, history, why: "429" }));
    expect(screen.getByText("Showing the last block read — the newest could not be: 429")).toBeInTheDocument();
    act(() => p.set({ kind: "stale", pulse: null, history: [], why: "down" }));
    expect(screen.getByText("Base could not be reached: down")).toBeInTheDocument();
  });

  it("has an unreachable line even for a live state without a pulse (a type it cannot be in, still rendered safely)", () => {
    mount(fakePulse({ kind: "live", pulse: null, history: [] } as never));
    expect(screen.getByText("Base could not be reached:")).toBeInTheDocument();
  });
});

const ACT: Activity = {
  latest: 36_500_000,
  minutes: 10,
  total: 7,
  processes: [
    { name: "Clanker", launches: 4, ours: false },
    { name: "Quadra launchpad", launches: 2, ours: true },
  ],
};

describe("Task Manager — Processes", () => {
  it("reads, lists the launchpads with ours highlighted, refreshes every minute, and End task is denied", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    launchActivity.mockResolvedValue(ACT);
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Processes" }));
    expect(screen.getByText("Counting the launchpads running on Base…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText(/7 pools opened on Uniswap v4 in the last 10 min \(to block 36,500,000\)/)).toBeInTheDocument();
    expect(screen.getByText("Clanker")).toBeInTheDocument();
    expect(screen.getByText("Quadra launchpad").closest("tr")).toHaveClass("tm__ours");
    expect(screen.getByText("Clanker").closest("tr")).not.toHaveClass("tm__ours");
    expect(launchActivity).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(PROCESS_REFRESH_MS));
    expect(launchActivity).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "End task" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Access is denied/);
    fireEvent.click(screen.getByRole("tab", { name: "Performance" }));
    expect(screen.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
  });

  it("says when nothing launched, and when the launches could not be read", async () => {
    launchActivity.mockResolvedValueOnce({ ...ACT, total: 0, processes: [] });
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Processes" }));
    await settle();
    expect(screen.getByText("Nothing launched in this window. Quiet.")).toBeInTheDocument();
  });

  it("failed", async () => {
    launchActivity.mockRejectedValueOnce(new Error("logs refused"));
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Processes" }));
    await settle();
    expect(screen.getByText("Not checked — the launches could not be read: logs refused")).toBeInTheDocument();
  });
});
