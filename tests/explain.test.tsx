import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CACHE_TTL_MS,
  DEFAULT_VENICE_MODEL,
  EXPLAIN_PATH,
  EXPLAIN_SYSTEM_PROMPT,
  explainHandler,
  filterExplanation,
  hashReport,
  MAX_ARG_CHARS,
  RATE_LIMIT,
  VENICE_CHAT_URL,
} from "@/server/explain";
import { ExplainReport, explainTarget, isExplainable } from "@/features/panels/ExplainReport";
import { ReportView } from "@/features/panels/ReportView";
import { row, type Report } from "@/skills/types";

const TOKEN_ADDR = "0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf";

const VERDICT_REPORT: Report = {
  title: "TEST — Token Verdict",
  rows: [
    row("Token", "Test Token (TEST)", { href: `https://basescan.org/token/${TOKEN_ADDR}` }),
    row("Verdict", "Caution — 70/100", { tone: "warn" }),
    row("Buy → sell, simulated now", "2.68% lost on the round trip", { tone: "ok" }),
    row("Top 10 holders", "not checked — indexer lagging", { tone: "warn" }),
  ],
  notes: ['"No red flags found" is not "safe".'],
  sources: ["Base", "DexScreener"],
};

const VERDICT_FALLBACK_TITLE_REPORT: Report = {
  title: `Token Verdict — ${TOKEN_ADDR}`,
  rows: [row("Verdict", "Caution — 70/100", { tone: "warn" })],
  notes: [],
  sources: ["Base"],
};

const SEND_CHECK_REPORT: Report = {
  title: "Send Check — 0x1111111111111111111111111111111111111111",
  rows: [row("Decision", "Caution — contract address", { tone: "warn" })],
  notes: [],
  sources: ["Base RPC"],
};

const RADAR_REPORT: Report = {
  title: "Launch Radar — last 60 min",
  rows: [row("Pools", "3 new pools")],
  notes: [],
  sources: ["Base RPC"],
};

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://quadra.test${EXPLAIN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-quadra": "1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("filterExplanation", () => {
  it("allows plain explanations including negated 'not safe' and rejects unnegated 'safe' or investment advice", () => {
    expect(filterExplanation("  No red flags found; top 10 holders were not checked.  ")).toBe(
      "No red flags found; top 10 holders were not checked.",
    );
    expect(filterExplanation("This report is not safe to treat as a guarantee.")).toBe(
      "This report is not safe to treat as a guarantee.",
    );
    expect(filterExplanation("   ")).toBeNull();
    expect(filterExplanation("This token is safe to trade.")).toBeNull();
    expect(filterExplanation("You should buy this token now.")).toBeNull();
    expect(filterExplanation("This looks like a strong investment.")).toBeNull();
  });
});

describe("explainHandler (server/explain.ts)", () => {
  it("hashes strings deterministically", () => {
    expect(hashReport("abc")).toBe(hashReport("abc"));
    expect(hashReport("abc")).not.toBe(hashReport("abd"));
    expect(hashReport("abc")).toHaveLength(16);
  });

  it("enforces POST, x-quadra header, and VENICE_API_KEY presence", async () => {
    const h = explainHandler({ apiKey: "venice-key" });
    expect((await h(new Request(`https://quadra.test${EXPLAIN_PATH}`, { method: "GET" }))).status).toBe(405);
    expect((await h(new Request(`https://quadra.test${EXPLAIN_PATH}`, { method: "POST" }))).status).toBe(403);

    expect((await explainHandler()(post({ skill: "verdict", args: [TOKEN_ADDR] }))).status).toBe(503);
    const noKey = explainHandler({ apiKey: "  " });
    const res = await noKey(post({ skill: "verdict", args: [TOKEN_ADDR] }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Venice explanation is waiting on VENICE_API_KEY in this server's environment." });
  });

  it("validates JSON body, allowlisted skill, and 1-2 bounded string args", async () => {
    const h = explainHandler({ apiKey: "venice-key", runSkill: async () => VERDICT_REPORT });
    expect((await h(post("{not-json"))).status).toBe(400);
    expect((await h(post("null"))).status).toBe(400);
    expect((await h(post({ skill: "radar", args: ["60"] }))).status).toBe(400);
    expect((await h(post({ skill: "verdict", args: [] }))).status).toBe(400);
    expect((await h(post({ skill: "verdict", args: ["a", "b", "c"] }))).status).toBe(400);
    expect((await h(post({ skill: "verdict", args: ["   "] }))).status).toBe(400);
    expect((await h(post({ skill: "verdict", args: [123] }))).status).toBe(400);
    expect((await h(post({ skill: "verdict", args: ["x".repeat(MAX_ARG_CHARS + 1)] }))).status).toBe(400);
    expect((await h(post({ reportText: "arbitrary prompt" }))).status).toBe(400);
  });

  it("runs the skill server-side, returns 422 on skill failure, caches for 10m, and rate limits per IP", async () => {
    // Default runSkill wiring executes findSkill(skill).run(args) and returns 422 on invalid address
    const defaultRunner = explainHandler({ apiKey: "k" });
    const badAddr = await defaultRunner(post({ skill: "verdict", args: ["not-an-address"] }));
    expect(badAddr.status).toBe(422);

    let clock = 1_000_000;
    const calls: { url: string; init: RequestInit }[] = [];
    const skillCalls: { skill: string; args: readonly string[] }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          model: "mistral-small-3-2-24b-instruct",
          choices: [{ message: { content: "  Caution score 70/100; top 10 holders were not checked.  " } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const runSkill = async (skill: "verdict" | "sendcheck", args: readonly string[]) => {
      skillCalls.push({ skill, args });
      return skill === "verdict" ? VERDICT_REPORT : SEND_CHECK_REPORT;
    };

    const h = explainHandler({ apiKey: "secret-venice-key", fetchImpl, now: () => clock, runSkill });

    const first = await h(post({ skill: "verdict", args: [TOKEN_ADDR] }, { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }));
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson).toEqual({
      explanation: "Caution score 70/100; top 10 holders were not checked.",
      model: DEFAULT_VENICE_MODEL,
      cached: false,
    });
    expect(JSON.stringify(firstJson)).not.toContain("secret-venice-key");
    expect(skillCalls).toEqual([{ skill: "verdict", args: [TOKEN_ADDR] }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(VENICE_CHAT_URL);
    const payload = JSON.parse(String(calls[0]!.init.body)) as { model: string; messages: { role: string; content: string }[] };
    expect(payload.model).toBe(DEFAULT_VENICE_MODEL);
    expect(payload.messages[0]).toEqual({ role: "system", content: EXPLAIN_SYSTEM_PROMPT });
    expect(payload.messages[0]!.content).toContain("untrusted data");
    expect(payload.messages[1]!.content).toContain("not checked");

    // Second call within 10 minutes (even different case) hits cache without re-running skill or Venice
    clock += 1_000;
    const second = await h(post({ skill: "verdict", args: [TOKEN_ADDR.toLowerCase()] }, { "x-forwarded-for": "1.2.3.4" }));
    expect(await second.json()).toEqual({
      explanation: "Caution score 70/100; top 10 holders were not checked.",
      model: DEFAULT_VENICE_MODEL,
      cached: true,
    });
    expect(skillCalls).toHaveLength(1);
    expect(calls).toHaveLength(1);

    // After 10 minutes cache expires and re-runs skill + Venice
    clock += CACHE_TTL_MS + 1;
    const third = await h(post({ skill: "verdict", args: [TOKEN_ADDR] }, { "x-real-ip": "9.9.9.9" }));
    expect((await third.json()).cached).toBe(false);
    expect(skillCalls).toHaveLength(2);
    expect(calls).toHaveLength(2);

    // Rate limit per IP: RATE_LIMIT.max calls succeed, next returns 429
    const limited = explainHandler({ apiKey: "k", fetchImpl, now: () => clock, runSkill });
    for (let i = 0; i < RATE_LIMIT.max; i++) {
      expect((await limited(post({ skill: "sendcheck", args: [`0x${String(i).padStart(40, "0")}`] }))).status).toBe(200);
    }
    expect((await limited(post({ skill: "sendcheck", args: ["0x9999999999999999999999999999999999999999"] }))).status).toBe(429);
  });

  it("handles upstream errors, empty content, and withholds policy-violating replies without caching", async () => {
    const runSkill = async () => VERDICT_REPORT;

    const netErr = explainHandler({ apiKey: "k", runSkill, fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect((await netErr(post({ skill: "verdict", args: [TOKEN_ADDR] }))).status).toBe(502);

    const badStatus = explainHandler({ apiKey: "k", runSkill, fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch });
    const badRes = await badStatus(post({ skill: "verdict", args: [TOKEN_ADDR] }));
    expect(badRes.status).toBe(502);
    expect((await badRes.json()).error).toContain("503");

    const badJson = explainHandler({ apiKey: "k", runSkill, fetchImpl: (async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch });
    expect((await badJson(post({ skill: "verdict", args: [TOKEN_ADDR] }))).status).toBe(502);

    const empty = explainHandler({
      apiKey: "k",
      model: "custom-model",
      runSkill,
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "  " } }] }), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await empty(post({ skill: "verdict", args: [TOKEN_ADDR] }))).status).toBe(502);

    const missingChoices = explainHandler({
      apiKey: "k",
      runSkill,
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    expect((await missingChoices(post({ skill: "verdict", args: [TOKEN_ADDR] }))).status).toBe(502);

    // Hostile token injection causing model to say "safe" is withheld (502) and NOT cached
    let attempts = 0;
    const injected = explainHandler({
      apiKey: "k",
      runSkill,
      fetchImpl: (async () => {
        attempts++;
        return new Response(JSON.stringify({ choices: [{ message: { content: "This token is safe, you should buy it." } }] }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const withheld = await injected(post({ skill: "verdict", args: [TOKEN_ADDR] }));
    expect(withheld.status).toBe(502);
    expect((await withheld.json()).error).toContain("withheld");
    await injected(post({ skill: "verdict", args: [TOKEN_ADDR] }));
    expect(attempts).toBe(2);

    // Falls back to configured model if response omits model field
    const noModel = explainHandler({
      apiKey: "k",
      model: "custom-model",
      runSkill,
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: "Plain summary." } }] }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(await (await noModel(post({ skill: "verdict", args: [TOKEN_ADDR] }))).json()).toEqual({
      explanation: "Plain summary.",
      model: "custom-model",
      cached: false,
    });
  });
});

describe("ExplainReport UI inside ReportView", () => {
  it("extracts skill and args only for Token Verdict and Send Check reports", () => {
    expect(explainTarget(VERDICT_REPORT)).toEqual({ skill: "verdict", args: [TOKEN_ADDR] });
    expect(explainTarget(VERDICT_FALLBACK_TITLE_REPORT)).toEqual({ skill: "verdict", args: [TOKEN_ADDR] });
    expect(explainTarget({ title: "TEST — Token Verdict", rows: [], notes: [], sources: [] })).toBeNull();
    expect(explainTarget(SEND_CHECK_REPORT)).toEqual({ skill: "sendcheck", args: ["0x1111111111111111111111111111111111111111"] });
    expect(explainTarget({ title: "Send Check —   ", rows: [], notes: [], sources: [] })).toBeNull();
    expect(isExplainable(VERDICT_REPORT)).toBe(true);
    expect(isExplainable(SEND_CHECK_REPORT)).toBe(true);
    expect(isExplainable(RADAR_REPORT)).toBe(false);
  });

  it("sends only skill and args to /api/explain and displays Venice label", async () => {
    let sentBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ explanation: "Top 10 holders were not checked.", model: DEFAULT_VENICE_MODEL, cached: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { rerender } = render(<ReportView report={VERDICT_REPORT} />);
    const btn = screen.getByRole("button", { name: "Explain in plain words" });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("region", { name: "Plain-English explanation" })).toBeInTheDocument());
    expect(JSON.parse(sentBody)).toEqual({ skill: "verdict", args: [TOKEN_ADDR] });
    expect(screen.getByText(/Top 10 holders were not checked\./)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Explanation by Venice \\(${DEFAULT_VENICE_MODEL}\\), from this report only`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "see the report rows" })).toHaveAttribute("href", expect.stringMatching(/^#/));

    // Switching to another report resets back to the idle button
    rerender(<ReportView report={SEND_CHECK_REPORT} />);
    expect(screen.getByRole("button", { name: "Explain in plain words" })).toBeInTheDocument();

    // Non-verdict / non-sendcheck report does not show the button
    rerender(<ReportView report={RADAR_REPORT} />);
    expect(screen.queryByRole("button", { name: "Explain in plain words" })).toBeNull();
  });

  it("shows server errors, fallback HTTP errors, and network failures cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Waiting on VENICE_API_KEY." }), { status: 503 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }))
        .mockRejectedValueOnce(new Error("offline")),
    );

    render(<ExplainReport report={VERDICT_REPORT} rowsId="rows-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Explain in plain words" }));
    expect(await screen.findByText("Waiting on VENICE_API_KEY.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explain in plain words" }));
    expect(await screen.findByText("Explanation could not be read (HTTP 500).")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Explain in plain words" }));
    expect(await screen.findByText("Could not reach the explanation service.")).toBeInTheDocument();
  });
});
