/**
 * Explore Base — a directory of projects on Base, as folders of program icons (2026-10-22, the owner,
 * after solana95.com's "Solana Directory").
 *
 * 🔴 SOURCE: base.org's own ecosystem list, the file behind https://www.base.org/ecosystem —
 * `apps/web/src/data/ecosystem.json` in github.com/base/web (598 entries, last commit 82b0f0a on
 * 2026-03-03), read 2026-10-22. Every entry below is one of those entries: its NAME, URL and LOGO are
 * copied, never typed from memory, and `tests/explore.test.tsx` holds each one to the captured entry in
 * `tests/fixtures/ecosystem/`. Only the folder (our grouping of base.org's category/subcategory) and
 * the one-line `line` are this app's own — written to be true about the project, never a price, a
 * promise or advice. Entries whose listed URL is not https (Aerodrome Finance, Uniswap) are left out:
 * a link from here opens https only.
 *
 * To add a project: it is added to base.org's list first (a pull request to base/web), then here.
 */

export type FolderKey = "wallets" | "defi" | "stocks" | "degen" | "bridges" | "cashin" | "payments" | "jpegs" | "social" | "games" | "ai" | "dev" | "daos";

export type BaseApp = {
  /** as base.org or docs.base.org lists it */
  readonly name: string;
  readonly folder: FolderKey;
  /** https only */
  readonly url: string;
  /** base.org's own logo for it, or empty string to render the program glyph */
  readonly logo: string;
  /** one true line, this app's words */
  readonly line: string;
  /** where the entry came from (default: base.org ecosystem list) */
  readonly source?: "base.org" | "docs.base.org";
};

export const ECOSYSTEM_SOURCE = "https://www.base.org/ecosystem";
export const ECOSYSTEM_READ = "2026-11-20";
const LOGO_ORIGIN = "https://www.base.org";

export const FOLDERS_OF_BASE: readonly { readonly key: FolderKey; readonly title: string; readonly blurb: string }[] = [
  { key: "wallets", title: "Wallets", blurb: "somewhere to keep your keys" },
  { key: "defi", title: "DeFi", blurb: "lend, borrow, earn" },
  { key: "stocks", title: "Stocks & RWA", blurb: "tokenized US equities, B20 & Chainlink NAV feeds" },
  { key: "degen", title: "Degen", blurb: "charts, perps and swap routers" },
  { key: "bridges", title: "Bridges", blurb: "move funds between chains" },
  { key: "cashin", title: "Cash In", blurb: "from a bank or card to Base" },
  { key: "payments", title: "Payments", blurb: "stablecoins, checkouts, streams" },
  { key: "jpegs", title: "JPEGs", blurb: "NFTs, art and music" },
  { key: "social", title: "Social", blurb: "posts, quests, messages" },
  { key: "games", title: "Games", blurb: "play on Base" },
  { key: "ai", title: "AI", blurb: "agents and assistants" },
  { key: "dev", title: "Dev", blurb: "nodes, data, audits, SDKs" },
  { key: "daos", title: "DAOs", blurb: "vote and govern together" },
];

const app = (name: string, folder: FolderKey, url: string, image: string, line: string): BaseApp => ({ name, folder, url, logo: `${LOGO_ORIGIN}${image}`, line });
const stockApp = (name: string, url: string, image: string, line: string): BaseApp => ({ name, folder: "stocks", url, logo: image ? `${LOGO_ORIGIN}${image}` : "", line, source: "docs.base.org" });

export const BASE_APPS: readonly BaseApp[] = [
  app("Coinbase Wallet", "wallets", "https://www.coinbase.com/wallet", "/images/partners/wallet.webp", "Coinbase's self-custody wallet: the keys are yours, not Coinbase's."),
  app("Rainbow Wallet", "wallets", "https://rainbow.me", "/images/partners/rainbow_wallet.webp", "A wallet that takes its colours seriously, and your keys more so."),
  app("Rabby Wallet", "wallets", "https://rabby.io", "/images/partners/rabby_wallet.webp", "Shows what a transaction will do before you sign it. We approve."),
  app("Zerion", "wallets", "https://zerion.io/base-wallet?utm_source=baseeco", "/images/partners/zerion.webp", "A wallet with the portfolio tracker built in."),
  app("Safe Wallet", "wallets", "https://safe.global/", "/images/partners/safe.webp", "A multisig: the wallet that needs several keys to agree."),
  app("Phantom", "wallets", "https://phantom.app/", "/images/partners/phantom.svg", "Grew up on Solana, now speaks Base too."),
  app("Ledger", "wallets", "https://www.ledger.com/", "/images/partners/ledger.webp", "A hardware wallet: your key lives in a small box, not a browser tab."),
  app("Trust Wallet", "wallets", "https://trustwallet.com/", "/images/partners/trust_wallet.webp", "A mobile wallet for a long list of chains, Base among them."),

  app("Aave", "defi", "https://app.aave.com", "/images/partners/aave.webp", "Lend, borrow, repeat: one of DeFi's oldest money markets."),
  app("Morpho", "defi", "https://morpho.org/", "/images/partners/morpho.png", "Lending markets, and the vaults curators build on top of them."),
  app("Moonwell", "defi", "https://moonwell.fi", "/images/partners/moonwell.webp", "A lending market that made Base one of its homes."),
  app("Compound", "defi", "https://compound.finance", "/images/partners/compound.webp", "The money market that started 2020's DeFi summer."),
  app("Balancer", "defi", "https://balancer.fi/", "/images/partners/balancer.webp", "Pools with more than two tokens, and weights other than 50/50."),
  app("PoolTogether", "defi", "https://pooltogether.com/", "/images/partners/pooltogether.png", "Savings with a prize draw: deposit, keep your deposit, maybe win."),

  stockApp("Coinbase Tokenized Stocks", "https://www.coinbase.com/tokenize", "/images/partners/wallet.webp", "Coinbase's B20 tokenized US equities on Base, backed 1:1 by shares in regulated custody (eligible non-US users)."),
  stockApp("Base B20 Stock Docs", "https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks", "", "Official Base documentation for the B20 tokenized stock standard, public API, and Chainlink NAV feeds."),
  stockApp("Ondo Global Markets", "https://ondo.finance/global-markets", "", "Tokenized US stocks, ETFs, and treasuries with onchain minting and redemption for eligible non-US users."),
  stockApp("Dinari", "https://www.dinari.com/", "", "1:1 backed tokenized US equities (dShares) issued on Base and other EVM networks."),
  stockApp("Backed (xStocks)", "https://backed.fi/", "", "Regulated tokenized equities and ETFs giving onchain economic exposure to traditional shares."),
  stockApp("Chainlink Equities Feeds", "https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks", "/images/partners/chainlink.webp", "Total-return Chainlink NAV reference feeds powering Base's B20 tokenized stocks."),

  app("Avantis", "degen", "https://www.avantisfi.com/", "/images/partners/avantis.png", "Perpetuals on Base, with leverage. Leverage cuts both ways."),
  app("SynFutures", "degen", "https://www.synfutures.com/", "/images/partners/synfutures.png", "Perpetual futures on Base. Read the liquidation price first."),
  app("gTrade", "degen", "https://gains.trade/trading", "/images/partners/gTrade.png", "Gains Network's leveraged trading: crypto, forex and more."),
  app("GeckoTerminal", "degen", "https://www.geckoterminal.com/", "/images/partners/geckoterminal.webp", "Live charts for DEX pools. Our Markets charts come from here too."),
  app("Birdeye.so", "degen", "https://birdeye.so/", "/images/partners/birdeye.png", "Token charts and wallet tracking, for staring at candles."),
  app("DefiLlama", "degen", "https://defillama.com/", "/images/partners/defillama.webp", "How much sits in every protocol on every chain, free and open."),
  app("Matcha", "degen", "https://matcha.xyz/", "/images/partners/matcha.png", "0x's swap app: it finds the route so you don't have to."),
  app("CoW Swap", "degen", "https://swap.cow.fi", "/images/partners/cowswap.png", "Swaps settled in batch auctions, built to keep MEV bots off your trade."),

  app("Across Protocol", "bridges", "https://across.to/", "/images/partners/across_protocol.webp", "Fast bridging through relayers. Our Bridge window is built on it."),
  app("Superbridge", "bridges", "https://superbridge.app", "/images/partners/superbridge.webp", "Moves funds between Ethereum and the OP Stack chains, Base included."),
  app("Stargate Finance", "bridges", "https://stargate.finance/", "/images/partners/stargate.webp", "A bridge on LayerZero, with shared liquidity pools."),
  app("LayerZero", "bridges", "https://layerzero.network/", "/images/partners/layerzero.webp", "Messaging between chains; plenty of bridges are built on it."),
  app("Jumper Exchange", "bridges", "https://jumper.exchange", "/images/partners/jumper_exchange.webp", "LI.FI's app: bridges and swaps compared in one place."),
  app("Orbiter Finance", "bridges", "https://www.orbiter.finance/", "/images/partners/orbiterfinance.webp", "A bridge between rollups, Base among them."),
  app("deBridge", "bridges", "https://debridge.finance/", "/images/partners/debridge.webp", "Cross-chain trades, filled by solvers on the other side."),

  app("Coinbase Onramp", "cashin", "https://www.coinbase.com/developer-platform/products/onramp", "/images/partners/pay.webp", "Card or bank to crypto, from Coinbase, inside other apps."),
  app("MoonPay", "cashin", "https://www.moonpay.com/business/onramps", "/images/partners/moonpay.png", "Buy crypto with a card, in apps across web3."),
  app("Transak", "cashin", "https://transak.com/", "/images/partners/transak.webp", "A fiat on-ramp that lives inside other apps."),
  app("Ramp Network", "cashin", "https://ramp.network", "/images/partners/ramp.webp", "Bank or card to crypto, built into wallets."),
  app("ZKP2P", "cashin", "https://zkp2p.xyz/", "/images/partners/zkp2p.webp", "Pay a person through a payment app, prove it in zero knowledge, get USDC."),

  app("Coinbase Commerce", "payments", "https://www.coinbase.com/commerce", "/images/partners/commerce.webp", "Lets a shop take crypto at checkout."),
  app("USDC", "payments", "https://www.circle.com/usdc", "/images/partners/usdc.svg", "Circle's digital dollar. This app's paid tools are priced in it."),
  app("EURC", "payments", "https://www.circle.com/eurc", "/images/partners/eurc.svg", "Circle's euro stablecoin, for when the dollar is not your unit."),
  app("Sablier", "payments", "https://sablier.com", "/images/partners/sablier.png", "Token streaming: salaries and vesting paid by the second."),
  app("Superfluid", "payments", "https://www.superfluid.finance/", "/images/partners/superfluid.webp", "Money that flows: pay per second instead of per month."),
  app("Slice", "payments", "https://slice.so", "/images/partners/slice.png", "An onchain shop, its revenue split among whoever built it."),

  app("OpenSea", "jpegs", "https://opensea.io/", "/images/partners/opensea.webp", "The big NFT marketplace. Base JPEGs included."),
  app("Zora", "jpegs", "https://zora.co/", "/images/partners/zora.webp", "Post on Base, and every post can become a coin."),
  app("Mint.fun", "jpegs", "https://mint.fun/feed/trending", "/images/partners/mint_fun.webp", "A feed of what everybody is minting right now."),
  app("BasePaint", "jpegs", "https://basepaint.xyz/", "/images/partners/basepaint.webp", "One canvas, painted together, a new picture every day."),
  app("Highlight", "jpegs", "https://www.highlight.xyz", "/images/partners/highlight.webp", "Tools for artists to mint generative and onchain art."),
  app("Manifold", "jpegs", "https://studio.manifold.xyz/", "/images/partners/manifold.webp", "Creator-owned contracts for minting, no platform in between."),
  app("Sound.xyz", "jpegs", "https://www.sound.xyz/", "/images/partners/sound.webp", "Collect a song straight from the artist who made it."),
  app("Base Colors", "jpegs", "https://basecolors.com", "/images/partners/basecolors.png", "Own a colour. An actual hex code, minted as an NFT."),

  app("Warpcast", "social", "https://warpcast.com", "/images/partners/warpcast.png", "A Farcaster client: a social network where your wallet is your account."),
  app("Paragraph", "social", "https://paragraph.xyz/", "/images/partners/paragraph.png", "Newsletters and blogs whose posts can be collected onchain."),
  app("Mirror", "social", "https://www.mirror.xyz", "/images/partners/mirror.webp", "Publishing onchain: essays as collectible entries."),
  app("Guild", "social", "https://guild.xyz", "/images/partners/guild.webp", "Lets a community in by what is in your wallet."),
  app("Galxe", "social", "https://galxe.com/", "/images/partners/galxe.webp", "Quests and credentials: do the task, prove it on chain."),
  app("Layer3", "social", "https://layer3.xyz/", "/images/partners/layer3.webp", "Quests that teach you an app by making you use it."),
  app("XMTP", "social", "https://xmtp.org/", "/images/partners/xmtp.webp", "Encrypted messages between wallet addresses."),
  app("Talent Protocol", "social", "https://talentprotocol.com", "/images/partners/talent-protocol.png", "A builder score, read from what you actually shipped."),

  app("Parallel", "games", "https://parallel.life/", "/images/partners/parallel.webp", "A sci-fi card game whose cards you can own."),
  app("Heroes of Mavia", "games", "https://www.mavia.com", "/images/partners/mavia.png", "Build a base, raid other bases. The other kind of base."),
  app("Frenpet", "games", "https://frenpet.xyz/", "/images/partners/frenpet.png", "A pet on chain that needs feeding. Neglect has consequences."),
  app("Pixotchi", "games", "https://app.pixotchi.tech/", "/images/partners/pixotchi.png", "Grow a plant on Base. Do not forget to water it."),
  app("Cat Town", "games", "https://www.cat.town", "/images/partners/cattown.png", "A cosy town full of cats, living on Base."),
  app("Yield Guild Games", "games", "https://yieldguild.io", "/images/partners/yield_guild_games.webp", "A guild of players across web3 games."),

  app("Virtuals Protocol", "ai", "https://app.virtuals.io/", "/images/partners/virtuals.png", "Launch an AI agent with a token of its own. Many have."),
  app("Venice", "ai", "https://venice.ai/", "/images/partners/venice.svg", "AI chat that says it keeps your conversations on your device."),
  app("Brian", "ai", "https://www.brianknows.org/", "/images/partners/brian.webp", "Say what you want done on chain in plain words; it builds the transaction."),
  app("Giza", "ai", "https://arma.xyz/", "/images/partners/giza.svg", "Agents that manage DeFi positions. The link opens ARMA, its yield agent."),

  app("Alchemy", "dev", "https://www.alchemy.com/", "/images/partners/alchemy.webp", "Node APIs and dev tools: the plumbing behind many apps."),
  app("ThirdWeb", "dev", "https://thirdweb.com/", "/images/partners/thirdweb.webp", "SDKs and contracts for shipping an onchain app quickly."),
  app("Privy", "dev", "https://www.privy.io/", "/images/partners/privy.webp", "Embedded wallets and logins, so a user can start with an email."),
  app("The Graph", "dev", "https://thegraph.com/", "/images/partners/the_graph.webp", "Indexes chain data into queries — subgraphs, mostly."),
  app("Tenderly", "dev", "https://tenderly.co/", "/images/partners/tenderly.webp", "Simulate, debug and trace transactions before they cost anything."),
  app("OpenZeppelin", "dev", "https://www.openzeppelin.com/", "/images/partners/oz.webp", "The contract library half of Ethereum imports, and audits."),
  app("Blockscout", "dev", "https://www.blockscout.com/", "/images/partners/blockscout.webp", "An open-source explorer. Many of this app's facts are read from it."),
  app("Etherscan", "dev", "https://basescan.org/", "/images/partners/etherscan.webp", "Basescan, by Etherscan: where you go to check a hash."),
  app("QuickNode", "dev", "https://www.quicknode.com/", "/images/partners/quicknode.webp", "RPC nodes on demand, for Base and many other chains."),
  app("Chainlink", "dev", "https://chain.link/", "/images/partners/chainlink.webp", "Oracles. The stock NAVs in our Markets window are its feeds."),
  app("Pyth Network", "dev", "https://pyth.network/", "/images/partners/pyth_network.webp", "Price feeds pulled on demand, from first-party publishers."),
  app("Conduit", "dev", "https://www.conduit.xyz/", "/images/partners/conduit.png", "Rollups as a service: run an OP Stack chain of your own."),

  app("Nouns Builder", "daos", "https://nouns.build", "/images/partners/nouns_builder.webp", "Start a Nouns-style DAO: one NFT auctioned at a time, forever."),
  app("Tally", "daos", "https://www.tally.xyz", "/images/partners/tally.webp", "Read a DAO's proposals and vote on them."),
  app("Aragon Project", "daos", "https://aragon.org/", "/images/partners/aragon_project.webp", "A toolkit for building DAOs, around since 2017."),
  app("FWB", "daos", "https://fwb.help", "/images/partners/fwb.webp", "Friends With Benefits: a members' club with a token at the door."),
];

/** A folder's projects, in the order above. */
export function appsIn(folder: FolderKey): readonly BaseApp[] {
  return BASE_APPS.filter((a) => a.folder === folder);
}

/** "rabby.io" — the host a project's link opens, as the dialog names it. */
export function domainOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
