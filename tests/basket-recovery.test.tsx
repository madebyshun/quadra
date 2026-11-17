import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { checkPendingStep, journalWallet, JOURNAL_EVENT, readPendingStep, settlePendingStep } from "@/lib/basketJournal";
import { useBasketRecovery } from "@/features/panels/useBasketRecovery";
import type { Eip1193Provider } from "@/lib/wallet";
const account = `0x${"12".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const key = `quadra.basket.sequence.v1:${account}`;
const provider = (request: Eip1193Provider["request"]) => journalWallet({ request }, account, "buy stock");
const send = { method: "eth_sendTransaction" };
function Probe({ connected = true }: { connected?: boolean }) {
 const r=useBasketRecovery(connected ? account : null);
 return <><p>{r.locked ? "locked" : "open"}</p><p>{r.problem}</p><p>{r.note}</p><button onClick={()=>void r.refresh()}>check</button></>;
}
it("locks before the wallet boundary, persists its hash and only releases the same receipt",async()=>{
 expect(readPendingStep(account)).toBeNull();
 const wallet=provider(async(args)=>args.method===send.method?hash:8453);
 expect(await wallet.request({method:"eth_chainId"})).toBe(8453);
 await wallet.request(send); expect(readPendingStep(account)?.hash).toBe(hash);
 await expect(wallet.request(send)).rejects.toThrow("unresolved");
 settlePendingStep(account,"wrong");expect(readPendingStep(account)).not.toBeNull();
 settlePendingStep(account,hash);expect(readPendingStep(account)).toBeNull();
 expect(await checkPendingStep(account)).toBe("none");
 await provider(async()=>"bad").request(send);expect(await checkPendingStep(account)).toBe("unknown");
});
it("does not mistake a wallet timeout for rejection, and fails closed on corrupt storage",async()=>{
 for(const error of [{code:4001}, {code:"4001"}, new Error("timeout"), null]) {
  localStorage.removeItem(key);
  await expect(provider(async()=>{throw error;}).request(send)).rejects.toBe(error);
  expect(readPendingStep(account)===null).toBe(error!==null && "code" in error);
 }
 for(const entry of [{account:"wrong",label:"buy",hash:null},{account,label:3,hash:null},{account,label:"buy",hash:3},{account,label:"buy",hash:"bad"}]) {
  localStorage.setItem(key,JSON.stringify(entry));expect(()=>readPendingStep(account)).toThrow("unreadable");
 }
});
it("checks actual receipt status and keeps a lock for pending or unreadable receipts",async()=>{
 await provider(async()=>hash).request(send);
 const receipt=(status:unknown)=>vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:status===null?null:{status}})));
 receipt(null);expect(await checkPendingStep(account)).toBe("pending");
 receipt("bad");await expect(checkPendingStep(account)).rejects.toThrow("unreadable");
 receipt("0x0");expect(await checkPendingStep(account)).toBe("reverted");
 await provider(async()=>hash).request(send);receipt("0x1");expect(await checkPendingStep(account)).toBe("confirmed");
});
it("restores the lock after reload and explains a confirmed or reverted previous action",async()=>{
 await provider(async()=>hash).request(send);
 const view=render(<Probe/>);expect(screen.getByText("locked")).toBeInTheDocument();
 for(const status of ["0x1","0x0",null]) {
  if(readPendingStep(account)===null)await act(async()=>{await provider(async()=>hash).request(send);});
  vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({jsonrpc:"2.0",id:1,result:status===null?null:{status}})));
  await act(async()=>fireEvent.click(screen.getByText("check")));
  expect(screen.getByText(status==="0x1"?/Previous transaction confirmed/:status==="0x0"?/Previous transaction reverted/:/still unresolved/)).toBeInTheDocument();
 }
 view.unmount();
 localStorage.setItem(key,"bad");render(<Probe/>);expect(screen.getByText("locked")).toBeInTheDocument();
 await act(async()=>fireEvent.click(screen.getByText("check")));
});
it("clears session state when disconnected and listens to storage changes",()=>{
 const view=render(<Probe connected={false}/>);expect(screen.getByText("open")).toBeInTheDocument();
 view.rerender(<Probe/>);localStorage.setItem(key,"invalid");act(()=>window.dispatchEvent(new Event("storage")));
 expect(screen.getByText("locked")).toBeInTheDocument();
 localStorage.removeItem(key);act(()=>window.dispatchEvent(new Event(JOURNAL_EVENT)));expect(screen.getByText("open")).toBeInTheDocument();
});
