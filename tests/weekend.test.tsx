import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { FRESH_MS, UPSTREAM, weekendHandler, WEEKEND_PATH } from "@/server/weekend";
import { diaryReport, readWeekend, scorecardReport, WEEKEND_PAGE } from "@/lib/weekend";
import { WeekendPanel } from "@/features/panels/WeekendPanel";
import { routes } from "@/server/vercel";
import SCORECARD from "./fixtures/weekend/scorecard.json";
import DIARY from "./fixtures/weekend/diary.json";
import { json, net, useNet } from "./net";

useNet();

/**
 * Blue Agent's weekend record, as it answered on 2026-11-12 (`POST {}` to each endpoint, saved
 * whole). This app words what is published and grades nothing.
 */

const ask = (path: string, init: RequestInit = { headers: { "x-quadra": "1" } }) => new Request(`https://quadra.test${WEEKEND_PATH}/${path}`, init);

describe("the server route", () => {
  it("asks Blue Agent with an empty POST and hands the answer back, remembered for ten minutes", async () => {
    const upstream = vi.fn(async () => json(SCORECARD));
    let now = 0;
    const handle = weekendHandler(upstream as unknown as typeof fetch, () => now);
    const first = await handle(ask("scorecard"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(SCORECARD);
    expect(upstream).toHaveBeenCalledWith(UPSTREAM.scorecard, expect.objectContaining({ method: "POST", body: "{}" }));
    now = FRESH_MS - 1;
    await handle(ask("scorecard"));
    expect(upstream).toHaveBeenCalledTimes(1);
    now = FRESH_MS;
    await handle(ask("scorecard"));
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("refuses a request without its header, a POST, and anything but the two records", async () => {
    const handle = weekendHandler(vi.fn() as unknown as typeof fetch);
    expect((await handle(ask("scorecard", {}))).status).toBe(403);
    expect((await handle(ask("scorecard", { method: "POST", headers: { "x-quadra": "1" } }))).status).toBe(405);
    expect((await handle(ask("constructor"))).status).toBe(404);
    expect((await handle(ask("anything"))).status).toBe(404);
  });

  it("says Blue Agent's refusal and an outage as such, never as an empty record", async () => {
    const refused = weekendHandler((async () => json({ error: "unreadable" }, 503)) as unknown as typeof fetch);
    const r = await refused(ask("diary"));
    expect(r.status).toBe(502);
    expect((await r.json()).detail).toBe("Blue Agent answered 503.");
    const down = weekendHandler((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect((await (await down(ask("diary"))).json()).detail).toBe("Blue Agent could not be reached.");
  });

  it("is a Vercel route too", async () => {
    const r = routes({}, (async () => json(DIARY)) as unknown as typeof fetch);
    expect((await r.weekend(ask("diary"))).status).toBe(200);
  });
});

describe("the scorecard, worded", () => {
  it("says 20 of 35 right is not yet better than a coin flip, and lists the latest weekend's calls", () => {
    const r = scorecardReport(SCORECARD);
    const by = (label: string) => r.rows.find((x) => x.label === label)!;
    expect(by("Record")).toMatchObject({ tone: "warn", href: WEEKEND_PAGE, value: "20 of 35 calls right — 57% (95% range 41%–72%), p = 0.50 — not yet better than a coin flip" });
    expect(by("Nearer Monday's open").value).toBe("Base's Sunday price 43 times, Friday's close 43 times");
    expect(by("Moves of ≥2%").value).toBe("3 of 3 right");
    expect(by("Weekend of 2026-11-06").value).toBe("BTC -1.8%, ETH -4.9% over the same hours");
    expect(by("NVDA")).toMatchObject({ tone: "ok", value: "DOWN — Base -2.37% vs Friday's close · Monday's open -5.13% · right" });
    expect(by("META").tone).toBe("bad");
    expect(by("AAPL")).toEqual(expect.objectContaining({ value: expect.stringMatching(/· not graded$/) }));
    expect(by("AAPL").tone).toBeUndefined();
    expect(r.sources[0]).toMatch(/^Blue Agent/);
  });

  it("calls a record with skill by its number alone, and one too young for a rate by what it needs", () => {
    const strong = scorecardReport({ ...SCORECARD, summary: { ...SCORECARD.summary, p_value_two_sided: 0.01 } });
    expect(strong.rows[0]).toMatchObject({ tone: "ok", value: expect.not.stringMatching(/coin flip/) });
    const noP = scorecardReport({ ...SCORECARD, summary: { ...SCORECARD.summary, p_value_two_sided: null, ci95: null } });
    expect(noP.rows[0]!.value).toBe("20 of 35 calls right — 57% (95% range not published–not published), p = not published — not yet better than a coin flip");
    const young = scorecardReport({ summary: { calls: 12, hits: 7, ready: false, needed: 30 } });
    expect(young.rows[0]!.value).toBe("7 of 12 calls right — a rate is published from 30 graded calls");
    expect(scorecardReport(null).rows[0]!.value).toBe("0 of 0 calls right — a rate is published from 30 graded calls");
    expect(scorecardReport({ summary: { ready: true, hit_rate: 0.5, by_size: [{}] } }).rows.map((x) => x.value)).toEqual([
      "? of ? calls right — 50% (95% range not published–not published), p = not published — not yet better than a coin flip",
      "? of ? right",
    ]);
  });

  it("says when this weekend's call is live or taken, and words a row with nothing in it", () => {
    expect(scorecardReport({ ...SCORECARD, live: {} }).rows.find((x) => x.label === "This weekend")!.value).toBe("live — provisional until Sunday 22:00 UTC");
    expect(scorecardReport({ ...SCORECARD, live: {}, pending: {} }).rows.find((x) => x.label === "This weekend")!.value).toMatch(/^the call is taken/);
    const bare = scorecardReport({ weekends: [{ rows: [{}] }] });
    expect(bare.rows.slice(-2)).toEqual([
      { label: "Weekend of ?", value: "BTC not published, ETH not published over the same hours" },
      { label: "?", value: "not published — Base not published vs Friday's close · Monday's open not published · not graded" },
    ]);
  });
});

describe("the diary, worded", () => {
  it("shows the rule, the in-sample backtest in red, and that no live weekend has closed", () => {
    const r = diaryReport(DIARY);
    expect(r.rows.map((x) => x.label)).toEqual(["Rule", "Backtest", "Since it went live"]);
    expect(r.rows[1]).toMatchObject({ tone: "bad", value: "35 trades over 11 weekends, 14 won, −$276 — in-sample, before the rule went live" });
    expect(r.rows[2]).toEqual({ label: "Since it went live", value: "no weekend closed yet — the first entry is taken Sunday 22:00 UTC" });
    expect(r.notes[1]).toBe(`Blue Agent on the backtest: ${DIARY.backtest.note}`);
    expect(diaryReport({ backtest: {} }).notes).toHaveLength(1);
  });

  it("shows live results and each entry, open or closed, with its note", () => {
    const r = diaryReport({
      ...DIARY,
      forward: { trades: 4, wins: 3, pnl_usd: 41 },
      entries: [
        { friday: "2026-11-13", positions: [{}, {}], pnl_usd: 41, note_close: "Three of four held." },
        { friday: "2026-11-20", positions: [{}], pnl_usd: null, note_open: "Entered NVDA." },
        { friday: "2026-11-27", positions: [], pnl_usd: 0 },
      ],
    });
    expect(r.rows.slice(2).map((x) => [x.value, x.tone])).toEqual([
      ["4 trades, 3 won, +$41", "ok"],
      ["2 positions, +$41 — “Three of four held.”", "ok"],
      ["1 positions, open — “Entered NVDA.”", undefined],
      ["0 positions, $0", undefined],
    ]);
  });

  it("says what was not published", () => {
    const r = diaryReport({ forward: { trades: 2 }, entries: [{}] });
    expect(r.rows.map((x) => x.value)).toEqual([
      "not published",
      "? trades over ? weekends, ? won, not published — in-sample, before the rule went live",
      "2 trades, ? won, not published",
      "0 positions, open",
    ]);
    expect(diaryReport(null).rows[0]!.value).toBe("not published");
  });
});

describe("the Weekend window", () => {
  it("shows both records, credited to Blue Agent", async () => {
    net({ get: (url) => (url.endsWith("/scorecard") ? SCORECARD : url.endsWith("/diary") ? DIARY : undefined) });
    render(<WeekendPanel />);
    expect(screen.getByText("Reading Blue Agent's weekend scorecard…")).toBeInTheDocument();
    await screen.findByText("Does Base's weekend price call Monday's open?");
    await screen.findByText("Blue Agent's weekend diary — $1,000 paper positions");
    expect(screen.getByRole("link", { name: "Blue Agent" })).toHaveAttribute("href", WEEKEND_PAGE);
  });

  it("says a record it could not read, and shows nothing in its place", async () => {
    net({ get: (url) => (url.endsWith("/scorecard") ? json({}, 502) : url.endsWith("/diary") ? DIARY : undefined) });
    render(<WeekendPanel />);
    await screen.findByText("Blue Agent's weekend scorecard could not be read (502). Nothing is shown in its place.");
    await waitFor(() => expect(screen.getByText("Blue Agent's weekend diary — $1,000 paper positions")).toBeInTheDocument());
  });

  it("drops an answer that comes after the window closed", async () => {
    let release: (v: unknown) => void = () => {};
    net({ get: () => new Promise((r) => (release = r)) as never });
    const { unmount } = render(<WeekendPanel />);
    unmount();
    release(json(SCORECARD));
    await expect(readWeekend("scorecard")).resolves.toBeDefined();
  });
});
