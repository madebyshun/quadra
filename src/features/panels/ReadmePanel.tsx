import { useOpenWindow } from "@/features/openWindow";
import { BRAND } from "@/brand";

/** The Read Me, as the era shipped one: plain text in a plain window. Every line is true of the app today. */
export const README = `${BRAND.name.toUpperCase()} FOR BASE 8453
${"=".repeat(BRAND.name.length + 14)}

Thank you for switching on ${BRAND.name}, an on-chain supercomputer for Base.
Please read this file before you begin.


WHAT IS ON THIS DESKTOP
-----------------------
  Check         Paste a token before you buy it: a simulated
                buy and sell, its code, holders and launcher.
  Coins         Every coin launched here. Open one to trade it.
  Launch        Launch a coin, paired with ETH or a stock.
  Wallet        Connect, see what you hold, claim your fees.
  Agents        MCP, x402, the API, the Docs, Verify.
  My Computer   Everything else: Research, Money, Launchpad,
                Games, the Terminal, Task Manager, the Control
                Panel, and this file.

  Double-click an icon to open it.


GETTING STARTED
---------------
  1. Paste a token's address into Check.
  2. Open Coins and pick one to buy or sell it.
  3. Connect a wallet only when you want to trade or
     launch. Looking things up needs no wallet at all.


IMPORTANT
---------
  ${BRAND.name} never holds your key. Every send, swap and launch
  is checked here first and signed in your own wallet.

  Never copy an address from your transaction history.
  Look-alike addresses are planted there.


KEYBOARD
--------
  Esc      closes the window on top.
  Enter    opens the selected icon in a folder.


Wallpaper, sounds and the screen saver are in
My Computer > Control Panel.
`;

export function ReadmePanel() {
  const open = useOpenWindow();
  return (
    <div className="readme stack">
      <header><p className="mono">quadra / read me</p><h3 className="readme__title">your desktop for coins and stocks on base.</h3><p>discover a coin, build a basket, or launch your own. you review each action and sign in your wallet.</p></header>
      <section aria-label="Getting started" className="readme__jobs">
        {([
          ["coins", "explore coins", "coins created on quadra, paired with ETH or a stock token. a stock-paired coin is not the stock itself."],
          ["basket", "build a basket", "choose assets and weights. each asset arrives in your wallet - there is no basket token."],
          ["launch", "launch a coin", "choose your identity and pair, review the costs, then confirm in your wallet."],
          ["wallet", "your wallet", "connect when you are ready to act. browsing does not need a wallet."],
        ] as const).map(([id, title, description]) => <article key={id}><h3>{title}</h3><p>{description}</p>{open ? <button type="button" className="chip" onClick={() => open(id)}>open {title}</button> : null}</article>)}
      </section>
      <section><h3>before you sign</h3><p>check the token address, amount, fees and minimum received. a price snapshot is not a trade quote. unavailable data is not zero activity.</p><p>your wallet holds the keys. contract checks do not guarantee value or eliminate market risk.</p></section>
      <p><a href="/about" target="_blank" rel="noreferrer">quadra / product tour - opens a new tab</a></p>
      <details><summary>desktop / keyboard and reference</summary>
    <div className="notepad">
      <div className="explorer__menu" aria-hidden="true">
        <span>File</span>
        <span>Edit</span>
        <span>Search</span>
        <span>Help</span>
      </div>
      <pre className="notepad__text" tabIndex={0} aria-label="Read Me">
        {README}
      </pre>
    </div>
      </details>
    </div>
  );
}
