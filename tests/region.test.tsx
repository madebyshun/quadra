import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { regionHandler, REGION_PATH } from "@/server/region";
import { countryOf, forgetRegion, isRestricted, isStock, useStockAddresses, useStocksClosed } from "@/lib/region";
import { routes } from "@/server/vercel";
import { STOCKS_PATH } from "@/server/stocks";
import { forgetCatalog } from "@/adapters/http/markets";
import { MARKETS_FX, NVDA_ON_BASE } from "./fixtures/markets";
import { settle } from "./helpers";
import { DOWN, json, net, useNet } from "./net";

useNet();

/**
 * Coinbase's stock tokens are "only for eligible persons outside the U.S." — the host's country
 * header decides whether this page offers them. A country that could not be read closes nothing.
 */

const ask = (headers: Record<string, string>, method = "GET") => new Request(`https://quadra.test${REGION_PATH}`, { method, headers });

describe("the region route", () => {
  it("hands back Vercel's country header, upper-cased, and null when there is none or it is not a code", async () => {
    const handle = regionHandler();
    expect(await (await handle(ask({ "x-quadra": "1", "x-vercel-ip-country": "vn" }))).json()).toEqual({ country: "VN" });
    expect(await (await handle(ask({ "x-quadra": "1" }))).json()).toEqual({ country: null });
    expect(await (await handle(ask({ "x-quadra": "1", "x-vercel-ip-country": "XX1" }))).json()).toEqual({ country: null });
  });

  it("refuses a request without its header, and anything but GET", async () => {
    const handle = regionHandler();
    expect((await handle(ask({}))).status).toBe(403);
    expect((await handle(ask({ "x-quadra": "1" }, "POST"))).status).toBe(405);
  });

  it("is a Vercel route too", async () => {
    const r = routes({}, (async () => json({})) as unknown as typeof fetch);
    expect(await (await r.region(ask({ "x-quadra": "1", "x-vercel-ip-country": "US" }))).json()).toEqual({ country: "US" });
  });
});

describe("reading the country in the page", () => {
  it("asks once, and reads a refusal, a body without a country, and an outage as unread", async () => {
    const calls = net({ get: (url) => (url === "/api/region" ? { country: "US" } : undefined) });
    expect(await countryOf()).toBe("US");
    expect(await countryOf()).toBe("US");
    expect(calls.filter((c) => c.url === "/api/region")).toHaveLength(1);
    forgetRegion();
    net({ get: (url) => (url === "/api/region" ? json({}, 500) : undefined) });
    expect(await countryOf()).toBeNull();
    forgetRegion();
    net({ get: (url) => (url === "/api/region" ? { country: 7 } : undefined) });
    expect(await countryOf()).toBeNull();
    forgetRegion();
    net({ get: (url) => (url === "/api/region" ? DOWN : undefined) });
    expect(await countryOf()).toBeNull();
  });

  it("closes stocks for the U.S. and its territories only — never for an unread country", () => {
    expect(["US", "PR", "GU"].map(isRestricted)).toEqual([true, true, true]);
    expect([null, "VN", "GB"].map(isRestricted)).toEqual([false, false, false]);
  });

  it("knows a stock by Coinbase's list, and while the list is unread, by its B20 address", () => {
    const list = new Set([NVDA_ON_BASE.toLowerCase()]);
    expect(isStock(NVDA_ON_BASE, list)).toBe(true);
    expect(isStock("0xb200000000000000000000ffffffffffffffffff", list)).toBe(false);
    expect(isStock(" 0xB200000000000000000000ffffffffffffffffff ", null)).toBe(true);
    expect(isStock("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", null)).toBe(false);
  });

  function Probe({ wanted }: { wanted: boolean }) {
    const closed = useStocksClosed();
    const stocks = useStockAddresses(wanted);
    return <output aria-label="probe">{`${closed} ${stocks === null ? "unread" : stocks.size}`}</output>;
  }

  it("reads the stock list only when asked to, and drops answers that come after it closed", async () => {
    forgetCatalog();
    net({ get: (url) => (url === "/api/region" ? { country: "US" } : url === `${STOCKS_PATH}/base` ? MARKETS_FX.coinbaseStocks : undefined) });
    const { unmount } = render(<Probe wanted={false} />);
    await settle();
    expect(screen.getByLabelText("probe")).toHaveTextContent("true unread");
    unmount();
    render(<Probe wanted />);
    await settle();
    expect(screen.getByLabelText("probe").textContent).toMatch(/^true \d+$/);
    const late = render(<Probe wanted />);
    late.unmount();
    await settle();
    forgetCatalog();
    forgetRegion();
    net({ get: (url) => (url === "/api/region" ? { country: null } : url === `${STOCKS_PATH}/base` ? DOWN : undefined) });
    render(<Probe wanted />);
    await settle();
    expect(screen.getAllByLabelText("probe").at(-1)).toHaveTextContent("false unread");
  });
});
