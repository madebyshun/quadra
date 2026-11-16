import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecipes, parseRecipe, recipeLink, RECIPES_KEY, removeRecipe, saveRecipe, sharedRecipe } from "@/lib/basketRecipes";
import { BasketRecipes } from "@/features/panels/BasketRecipes";
import { copyText } from "@/features/panels/ContractAddress";
vi.mock("@/features/panels/ContractAddress", () => ({ copyText: vi.fn() }));
const r = { name: "My AI", picks: [["NVDA", 60], ["AAPL", 40]] as const };
beforeEach(() => { window.history.replaceState(null, "", "/"); });

describe("basket recipes", () => {
  it("validates a whole target basket and treats links as untrusted input", () => {
    expect(parseRecipe(r)).toEqual(r);
    for (const v of [null, 2, {}, { ...r, name: " " }, { ...r, name: "x".repeat(49) }, { ...r, picks: null }, { ...r, picks: [] }, { ...r, picks: Array(11).fill(["A", 10]) }, { ...r, picks: [null] }, { ...r, picks: [["A"]] }, { ...r, picks: [[2, 100]] }, { ...r, picks: [["<script>", 100]] }, { ...r, picks: [["A", 0]] }, { ...r, picks: [["A", 101]] }, { ...r, picks: [["A", 20.5]] }, { ...r, picks: [["nvda", 50], ["NVDA", 50]] }, { ...r, picks: [["A", 99]] }]) expect(parseRecipe(v)).toBeNull();
    expect(parseRecipe({ name: " A ", picks: [["cbBTC", 100]] })).toEqual({ name: "A", picks: [["CBBTC", 100]] });
    expect(sharedRecipe("")).toBeNull();
    expect(sharedRecipe("?b=NVDA:100")).toEqual({ name: "Shared basket", picks: [["NVDA", 100]] });
    expect(() => sharedRecipe("?b=NVDA:70")).toThrow("invalid");
    expect(() => sharedRecipe("?b=NVDA:100:1")).toThrow("invalid");
    expect(sharedRecipe(new URL(recipeLink(r)).search)).toEqual(r);
    expect(() => sharedRecipe("?basket=null")).toThrow("invalid");
    expect(() => sharedRecipe("?basket=bad-json")).toThrow();
    expect(recipeLink(r)).not.toContain("account");
  });
  it("stores, replaces by name, deletes and limits recipes, and tolerates corrupt or inaccessible storage", () => {
    expect(loadRecipes()).toEqual([]);
    expect(saveRecipe(r)).toEqual([r]);
    expect(saveRecipe({ ...r, name: "MY AI" })).toHaveLength(1);
    expect(removeRecipe("MY AI")).toEqual([]);
    localStorage.setItem(RECIPES_KEY, JSON.stringify([null, r]));
    expect(loadRecipes()).toEqual([r]);
    localStorage.setItem(RECIPES_KEY, "{}"); expect(loadRecipes()).toEqual([]);
    localStorage.setItem(RECIPES_KEY, "bad-json"); expect(loadRecipes()).toEqual([]);
    for (let i = 0; i < 25; i++) saveRecipe({ ...r, name: `R${i}` });
    expect(loadRecipes()).toHaveLength(20);
    const fail = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw Error("blocked"); });
    expect(loadRecipes()).toEqual([]); fail.mockRestore();
  });
});
const mount = () => { const onLoad = vi.fn(), setName = vi.fn(); render(<BasketRecipes rows={r.picks.map(([symbol, weight]) => ({ symbol, weight: String(weight) }))} name={r.name} setName={setName} onLoad={onLoad} disabled={false} />); return { onLoad, setName }; };
describe("saved basket controls", () => {
  it("saves, loads, copies and deletes a recipe and exposes the exact share link", async () => {
    vi.mocked(copyText).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { onLoad, setName } = mount();
    fireEvent.change(screen.getByLabelText("Basket name"), { target: { value: "New" } });
    expect(setName).toHaveBeenCalledWith("New");
    fireEvent.click(screen.getByRole("button", { name: "Save basket" }));
    fireEvent.click(screen.getByRole("button", { name: "My AI" }));
    expect(onLoad).toHaveBeenCalledWith(r);
    expect(screen.getByRole("status")).toHaveTextContent("Saved basket loaded");
    expect(screen.getByRole("link", { name: "Open basket link" })).toHaveAttribute("href", recipeLink(r));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy basket link" })); });
    expect(copyText).toHaveBeenCalledWith(recipeLink(r));
    expect(screen.getByRole("status")).toHaveTextContent("link copied");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy basket link" })); });
    expect(screen.getByRole("status")).toHaveTextContent("Could not copy");
    fireEvent.click(screen.getByRole("button", { name: "Delete saved basket My AI" }));
    expect(screen.getByRole("status")).toHaveTextContent("removed");
  });
  it("reports storage failures instead of claiming a save or delete succeeded", () => {
    saveRecipe(r); mount();
    const fail = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
    fireEvent.click(screen.getByRole("button", { name: "Save basket" }));
    expect(screen.getByRole("status")).toHaveTextContent("could not save");
    fireEvent.click(screen.getByRole("button", { name: "Delete saved basket My AI" }));
    expect(screen.getByRole("status")).toHaveTextContent("could not remove");
    fail.mockRestore();
  });
  it("loads a shared basket once without buying and reports an invalid link", () => {
    window.history.replaceState(null, "", recipeLink(r));
    const { onLoad } = mount();
    expect(onLoad).toHaveBeenCalledWith(r);
    expect(screen.getByRole("status")).toHaveTextContent("Shared basket loaded");
  });
  it("refuses an invalid shared recipe and disables invalid targets", () => {
    window.history.replaceState(null, "", "/?basket=null");
    render(<BasketRecipes rows={[]} name="" setName={() => {}} onLoad={() => {}} disabled={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("link is invalid");
    expect(screen.getByRole("button", { name: "Save basket" })).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
