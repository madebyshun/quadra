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
  return (
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
  );
}
