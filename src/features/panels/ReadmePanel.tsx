import { BRAND } from "@/brand";

/** README.TXT, as the era shipped one: plain text in Notepad. Every line is true of the app today. */
export const README = `${BRAND.name.toUpperCase()} FOR BASE 8453
${"=".repeat(BRAND.name.length + 14)}

Thank you for switching on ${BRAND.name}, an on-chain supercomputer for Base.
Please read this file before you begin.


WHAT IS ON THIS DESKTOP
-----------------------
  My Computer   Task Manager, the Control Panel, and Coming Soon.
  Research      Launch Radar, Token Verdict, Markets, Profile.
  Money         Wallet, Send, Swap, Trade.
  Launchpad     Launch a coin, every coin launched here, the
                Leaderboard, and your Base card.
  Games         Rugsweeper and Achievements.
  Agents        MCP, x402, the API, the Docs, Verify.

  Terminal, Launch, Coins and Wallet also sit on the desktop.
  Double-click an icon in a folder to open it.


GETTING STARTED
---------------
  1. Open the Terminal and type  help  for every skill.
  2. Before you buy a coin, type  verdict 0x...  It reads the
     trade, the code, the holders and the launcher.
  3. Connect a wallet only when you want to send, swap or
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
      <pre className="notepad__text" tabIndex={0} aria-label="README.TXT">
        {README}
      </pre>
    </div>
  );
}
