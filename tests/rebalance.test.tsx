import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { rebalance } from "@/lib/rebalance";
import { RebalancePreview } from "@/features/panels/RebalancePreview";
it("preserves value exactly and skips dust without fabricating token quantities",()=>{
 const rows=rebalance([8000000n,2000000n],[50,50],["A","B"],0n);
 expect(rows.map(r=>r.delta)).toEqual([-3000000n,3000000n]);
 expect(rows.reduce((s,r)=>s+r.target,0n)).toBe(10000000n);
 expect(rebalance([1n,1n,1n],[33,33,34],["A","B","C"],10n).map(r=>r.delta)).toEqual([0n,0n,0n]);
 expect(rebalance([0n],[100],["A"],0n)[0]!.driftBps).toBe(0n);
 for(const args of [ [[],[100],["A"],0n], [[1n],[100],[],0n], [[-1n],[100],["A"],0n], [[1n],[1.5],["A"],0n], [[1n],[-1],["A"],0n], [[1n],[99],["A"],0n], [[1n],[100],["A"],-1n] ] as const) expect(()=>rebalance(args[0],args[1],args[2],args[3])).toThrow();
});
it("keeps the preview non-executable and makes buys, sells and minimum explicit",()=>{
 render(<RebalancePreview held={[8000000n,2000000n,0n]} weights={[50,50,0]} symbols={["A","B","C"]} />);
 expect(screen.getByText(/new funds required/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("preview mode"),{target:{value:"all"}});
 expect(screen.getByText("sell 3")).toBeInTheDocument();
 expect(screen.getByText("buy 3")).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("skip changes below / USDC"),{target:{value:"bad"}});
 expect(screen.getByRole("status")).toHaveTextContent("non-negative");
 expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
