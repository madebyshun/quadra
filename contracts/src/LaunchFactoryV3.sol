// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {LaunchHook} from "./LaunchHook.sol";

/// @title LaunchFactoryV3
///
/// @notice v2 (src/LaunchFactory.sol) plus two choices and one protection. A launch creates a B20
///         token with a fixed supply and NO admin, opens a Uniswap v4 pool for it against ETH or an
///         enabled quote asset, and puts the whole supply into that pool as liquidity no function can
///         ever take out — exactly as v2. New in v3:
///         - the launcher picks the coin's fee: 1% or 3% (`FEE_LOW` / `FEE_HIGH`), nothing else;
///         - the anti-sniper opening: for the first `LaunchHook.window` seconds the fee falls in a
///           straight line from `LaunchHook.startFee` (50% at the default deploy) to the chosen fee.
///           The launcher's own first buy, inside the launch transaction, pays the chosen fee;
///         - only this factory can open a pool with its hook, so nobody can open a coin's pool first
///           at another price — not even for a token address `predictToken` has made public.
///         Every fee the pool charges is an LP fee earned by the factory's locked position, and
///         `collect` splits it 80% to the launcher and 20% to the protocol, in both currencies;
///         - REFERRALS (owner, 2026-10-22): a launch may name a referrer — an app that built the launch
///           for its user. It counts only if the protocol recipient has APPROVED it (`setReferrer`) at
///           the moment of the launch; an unapproved one is recorded as none and announced as ignored
///           (`ReferralIgnored`), never a revert, so a stale referral cannot block a launch. A counted
///           referrer is fixed for the coin's life (`referrerOf`, announced by `Referred`) and takes 5%
///           out of the protocol's 20%: launcher 80%, referrer 5%, protocol the remainder (~15%), so no
///           wei is lost. Removing a referrer from the list stops it counting for NEW launches only —
///           a referral already recorded keeps being paid, because `collect` never reads the list.
///           A creator may name themselves only if they are approved, like anyone else.
///
/// @dev The pool's key carries LPFeeLibrary.DYNAMIC_FEE_FLAG as its fee and `hook` as its hooks: the
///      hook sets every swap's fee. The hook is deployed BY this factory's constructor with a mined
///      CREATE2 salt, so `hook.factory()` is this contract by construction; it has no owner, no setter
///      and no return-delta permission — it can set an LP fee and refuse a pool, nothing else.
///
///      Everything else is v2's: what the launcher cannot do (mint, pause, freeze, seize, rename, pull
///      liquidity, be front-run to the pool), the quote admin and its limits, the single-sided range on
///      whichever side the token sorts to, `owed` for refused payouts. See v2's header.
contract LaunchFactoryV3 is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    /// @notice Every launch's supply, with 18 decimals: one billion.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice The fees a launcher may choose, in hundredths of a basis point: 1% and 3%.
    uint24 public constant FEE_LOW = 10_000;
    uint24 public constant FEE_HIGH = 30_000;
    /// @notice One tick spacing for both fees (Uniswap pairs 200 with 1%), so one opening tick per quote serves both.
    int24 public constant TICK_SPACING = 200;
    /// @notice The launcher's share of every fee collected, in basis points; the rest is the protocol's.
    uint16 public constant CREATOR_SHARE_BPS = 8_000;
    /// @notice A recorded referrer's share of every fee collected, in basis points, taken out of the protocol's.
    uint16 public constant REFERRER_SHARE_BPS = 500;
    /// @notice Where the rounding dust of the opening liquidity goes: out of circulation.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;
    /// @notice The hook every pool of this factory uses — deployed by this factory's constructor.
    LaunchHook public immutable hook;

    /// @notice Who receives the protocol's share. Changed only by itself, in two steps.
    address public protocolRecipient;
    address public pendingProtocolRecipient;
    /// @notice Who may enable quote assets and set their opening prices. Changed only by itself, in two steps.
    address public quoteAdmin;
    address public pendingQuoteAdmin;

    struct Quote {
        bool enabled;
        /// @notice the opening price for new launches, as a tick of token-per-quote in raw units
        int24 startTick;
    }

    /// @notice The quote assets launches may pair with — native ETH is `address(0)`.
    mapping(address quote => Quote) public quotes;

    struct Launch {
        /// @notice who launched it
        address creator;
        /// @notice who receives the launcher's share — the launcher, unless they hand it on
        address creatorRecipient;
        PoolKey key;
    }

    struct Position {
        int24 tickLower;
        int24 tickUpper;
    }

    mapping(address token => Launch) internal _launches;
    mapping(address token => Position) internal _positions;
    /// @notice Payouts a recipient (or a quote's transfer policy) refused, waiting for `withdraw`.
    mapping(address account => mapping(Currency currency => uint256 amount)) public owed;

    uint256 private _locked = 1;

    /// @notice Referrers the protocol recipient approved; only these count when a launch names one.
    mapping(address referrer => bool) public approvedReferrers;
    /// @notice The referrer recorded for a coin at its launch (zero: none). Never changes afterwards.
    mapping(address token => address) public referrerOf;

    enum Op {
        Open,
        Collect
    }

    /// @dev The same signature as v1's, so one reader serves both factories.
    event Launched(
        address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyIn, uint256 devBuyTokens
    );
    event FeesCollected(address indexed token, uint256 amount0, uint256 amount1);
    event Paid(address indexed to, Currency indexed currency, uint256 amount, bool pushed);
    event CreatorRecipientChanged(address indexed token, address indexed recipient);
    event ProtocolRecipientProposed(address indexed recipient);
    event ProtocolRecipientChanged(address indexed recipient);
    event QuoteAdminProposed(address indexed admin);
    event QuoteAdminChanged(address indexed admin);
    event QuoteSet(address indexed quote, bool enabled, int24 startTick);
    /// @dev New in v3, emitted just before `Launched` (which keeps v1/v2's exact signature, so one
    ///      reader still serves every factory): the coin's chosen fee.
    event LaunchFee(address indexed token, uint24 fee);
    /// @dev New in v3: the approved list changed (only the protocol recipient changes it).
    event ReferrerSet(address indexed referrer, bool approved);
    /// @dev New in v3, emitted before `Launched`: this coin's referrer, recorded for good.
    event Referred(address indexed token, address indexed referrer);
    /// @dev New in v3, emitted before `Launched`: the launch named a referrer that was not approved,
    ///      so it was recorded as none.
    event ReferralIgnored(address indexed token, address indexed referrer);

    error NotPoolManager();
    error NotLaunched();
    error NotAllowed();
    error ZeroAddress();
    error Reentrancy();
    error BadStartTick();
    error QuoteNotEnabled();
    error WrongValue();
    error NothingOwed();
    error TransferFailed();
    error BadFee();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param startFee the LP fee at the second a pool opens (500_000 = 50% at the default deploy)
    /// @param window seconds for the fee to fall from `startFee` to the coin's chosen fee (15 by default)
    /// @param hookSalt the CREATE2 salt that puts the hook at an address with exactly its permission
    ///        bits — mined against THIS contract's address (script/DeployLaunchFactoryV3.s.sol)
    constructor(
        IPoolManager manager,
        address protocol,
        address admin,
        int24 ethStartTick,
        uint24 startFee,
        uint32 window,
        bytes32 hookSalt
    ) {
        if (address(manager) == address(0) || protocol == address(0) || admin == address(0)) revert ZeroAddress();
        _checkTick(ethStartTick);
        poolManager = manager;
        hook = new LaunchHook{salt: hookSalt}(manager, startFee, window);
        protocolRecipient = protocol;
        quoteAdmin = admin;
        quotes[address(0)] = Quote({enabled: true, startTick: ethStartTick});
        emit QuoteSet(address(0), true, ethStartTick);
    }

    function _checkTick(int24 tick) private pure {
        // the token-per-quote tick and its negation must both leave room for a position
        if (tick % TICK_SPACING != 0 || tick <= TickMath.minUsableTick(TICK_SPACING) || tick >= TickMath.maxUsableTick(TICK_SPACING)) {
            revert BadStartTick();
        }
    }

    // ───────────────────────────────────────────────────────────── launching

    /// @notice Create a token, its pool against `quote` and its locked liquidity; buy first with `quoteIn`.
    /// @param fee the coin's fee: `FEE_LOW` (1%) or `FEE_HIGH` (3%) — anything else reverts
    /// @param name the token's name
    /// @param symbol the token's symbol
    /// @param contractURI ERC-7572 metadata (a URL or a data: URI); fixed forever
    /// @param referrer who brought this launch (`address(0)` = none); counted only if approved now
    /// @param salt any value; the token's address is derived from it AND the caller
    /// @param quote what the token trades against: `address(0)` for ETH, or an enabled asset
    /// @param quoteIn the first buy, in the quote's raw units — sent as `msg.value` for ETH, or
    ///        pulled with `transferFrom` (approve this factory first) for an asset
    /// @return token the new token's address
    function launch(
        string calldata name,
        string calldata symbol,
        string calldata contractURI,
        bytes32 salt,
        address quote,
        uint256 quoteIn,
        uint24 fee,
        address referrer
    ) external payable nonReentrant returns (address token) {
        Quote memory q = quotes[quote];
        if (!q.enabled) revert QuoteNotEnabled();
        if (msg.value != (quote == address(0) ? quoteIn : 0)) revert WrongValue();
        if (fee != FEE_LOW && fee != FEE_HIGH) revert BadFee();

        token = _create(name, symbol, contractURI, launchSalt(msg.sender, salt));
        PoolKey memory key = _record(token, quote, q.startTick);
        // the hook learns the coin's fee and its opening second before the pool exists
        hook.register(key.toId(), fee);
        emit LaunchFee(token, fee);
        if (referrer != address(0)) {
            if (approvedReferrers[referrer]) {
                referrerOf[token] = referrer;
                emit Referred(token, referrer);
            } else {
                emit ReferralIgnored(token, referrer);
            }
        }

        // An exact-input buy spends all of `quoteIn`: the range runs to the far end of the prices v4
        // allows, so no buy can exhaust it and stop early at the price limit with some left over.
        (, uint256 boughtTokens) =
            abi.decode(poolManager.unlock(abi.encode(Op.Open, token, quoteIn, msg.sender)), (uint256, uint256));

        // the rounding left over from the opening liquidity is a few wei of the token (or none)
        Currency.wrap(token).transfer(DEAD, IB20(token).balanceOf(address(this)));
        emit Launched(token, msg.sender, key.toId(), quoteIn, boughtTokens);
    }

    /// @dev The B20: no admin, the whole supply minted to this factory, the metadata set — all at creation.
    function _create(string calldata name, string calldata symbol, string calldata contractURI, bytes32 b20Salt)
        private
        returns (address)
    {
        bytes[] memory init = new bytes[](2);
        init[0] = abi.encodeCall(IB20.mint, (address(this), TOTAL_SUPPLY));
        init[1] = B20FactoryLib.encodeUpdateContractURI(contractURI);
        return StdPrecompiles.B20_FACTORY.createB20(
            IB20Factory.B20Variant.ASSET, b20Salt, B20FactoryLib.encodeAssetCreateParams(name, symbol, address(0), 18), init
        );
    }

    /// @dev The pool key (sorted by address) and the single-sided range, on whichever side the token sorts to.
    function _record(address token, address quote, int24 startTick) private returns (PoolKey memory key) {
        bool tokenIs1 = token > quote;
        key = PoolKey({
            currency0: Currency.wrap(tokenIs1 ? quote : token),
            currency1: Currency.wrap(tokenIs1 ? token : quote),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        _launches[token] = Launch({creator: msg.sender, creatorRecipient: msg.sender, key: key});
        _positions[token] = tokenIs1
            ? Position({tickLower: TickMath.minUsableTick(TICK_SPACING), tickUpper: startTick})
            : Position({tickLower: -startTick, tickUpper: TickMath.maxUsableTick(TICK_SPACING)});
    }

    /// @notice The B20 salt for a caller's salt: bound to the caller, so a launch cannot be front-run
    ///         into `TokenAlreadyExists` by someone replaying the same salt.
    function launchSalt(address caller, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(caller, salt));
    }

    /// @notice The address `launch` will create for this caller and salt.
    function predictToken(address caller, bytes32 salt) external view returns (address) {
        return StdPrecompiles.B20_FACTORY.getB20Address(IB20Factory.B20Variant.ASSET, address(this), launchSalt(caller, salt));
    }

    // ───────────────────────────────────────────────────────────── quotes

    /// @notice Enable (or disable) a quote asset and set the opening price of NEW launches against it.
    function setQuote(address quote, bool enabled, int24 startTick) external {
        if (msg.sender != quoteAdmin) revert NotAllowed();
        if (enabled) _checkTick(startTick);
        quotes[quote] = Quote({enabled: enabled, startTick: startTick});
        emit QuoteSet(quote, enabled, startTick);
    }

    function proposeQuoteAdmin(address admin) external {
        if (msg.sender != quoteAdmin) revert NotAllowed();
        pendingQuoteAdmin = admin;
        emit QuoteAdminProposed(admin);
    }

    function acceptQuoteAdmin() external {
        // a zero pending admin can never match a caller, so "nothing proposed" refuses here too
        if (msg.sender != pendingQuoteAdmin) revert NotAllowed();
        quoteAdmin = msg.sender;
        pendingQuoteAdmin = address(0);
        emit QuoteAdminChanged(msg.sender);
    }

    // ───────────────────────────────────────────────────────────── referrers

    /// @notice Approve (or stop approving) a referrer for NEW launches. Only the protocol recipient may:
    ///         a referrer is paid out of the protocol's share, so the party that gives it up decides.
    ///         Launches already recorded keep their referrer either way.
    function setReferrer(address referrer, bool approved) external {
        if (msg.sender != protocolRecipient) revert NotAllowed();
        if (referrer == address(0)) revert ZeroAddress();
        approvedReferrers[referrer] = approved;
        emit ReferrerSet(referrer, approved);
    }

    // ───────────────────────────────────────────────────────────── fees

    /// @notice Collect a token's pool fees and pay them out: 80% to the launcher's recipient, 20% to
    ///         the protocol — or, for a referred coin, 80% / 5% to its referrer / the remainder to the
    ///         protocol — in both of the pool's currencies. Anyone may call it.
    function collect(address token) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Launch storage l = _launches[token];
        if (l.creator == address(0)) revert NotLaunched();
        (amount0, amount1) = abi.decode(poolManager.unlock(abi.encode(Op.Collect, token, uint256(0), address(0))), (uint256, uint256));
        emit FeesCollected(token, amount0, amount1);
        address referrer = referrerOf[token];
        _split(l.key.currency0, amount0, l.creatorRecipient, referrer);
        _split(l.key.currency1, amount1, l.creatorRecipient, referrer);
    }

    /// @notice Hand the launcher's share on to another address. Only the current recipient may.
    function setCreatorRecipient(address token, address recipient) external {
        Launch storage l = _launches[token];
        if (l.creator == address(0)) revert NotLaunched();
        if (msg.sender != l.creatorRecipient) revert NotAllowed();
        if (recipient == address(0)) revert ZeroAddress();
        l.creatorRecipient = recipient;
        emit CreatorRecipientChanged(token, recipient);
    }

    /// @notice Propose a new protocol recipient; it takes effect when that address accepts.
    function proposeProtocolRecipient(address recipient) external {
        if (msg.sender != protocolRecipient) revert NotAllowed();
        pendingProtocolRecipient = recipient;
        emit ProtocolRecipientProposed(recipient);
    }

    function acceptProtocolRecipient() external {
        if (msg.sender != pendingProtocolRecipient) revert NotAllowed();
        protocolRecipient = msg.sender;
        pendingProtocolRecipient = address(0);
        emit ProtocolRecipientChanged(msg.sender);
    }

    /// @notice Withdraw a payout that could not be pushed when it was due.
    function withdraw(Currency currency) external nonReentrant {
        uint256 amount = owed[msg.sender][currency];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender][currency] = 0;
        if (!_push(currency, msg.sender, amount)) revert TransferFailed();
        emit Paid(msg.sender, currency, amount, true);
    }

    function launches(address token) external view returns (Launch memory) {
        return _launches[token];
    }

    function positions(address token) external view returns (Position memory) {
        return _positions[token];
    }

    // ───────────────────────────────────────────────────────────── the pool manager

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Op op, address token, uint256 quoteIn, address buyer) = abi.decode(data, (Op, address, uint256, address));
        return op == Op.Open ? _open(token, quoteIn, buyer) : _collect(token);
    }

    function _params(address token, int256 liquidityDelta) private view returns (ModifyLiquidityParams memory) {
        Position memory p = _positions[token];
        return ModifyLiquidityParams({tickLower: p.tickLower, tickUpper: p.tickUpper, liquidityDelta: liquidityDelta, salt: bytes32(0)});
    }

    function _open(address token, uint256 quoteIn, address buyer) private returns (bytes memory) {
        PoolKey memory key = _launches[token].key;
        bool tokenIs1 = Currency.unwrap(key.currency1) == token;
        _seed(key, token, tokenIs1);
        if (quoteIn == 0) return abi.encode(uint256(0), uint256(0));
        return abi.encode(quoteIn, _firstBuy(key, token, tokenIs1, quoteIn, buyer));
    }

    /// @dev Open the pool at the end of the range the supply sits beyond, and put the whole supply in.
    function _seed(PoolKey memory key, address token, bool tokenIs1) private {
        Position memory p = _positions[token];
        uint160 lower = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.tickUpper);
        poolManager.initialize(key, tokenIs1 ? upper : lower);
        uint128 liquidity = tokenIs1
            ? LiquidityAmounts.getLiquidityForAmount1(lower, upper, TOTAL_SUPPLY)
            : LiquidityAmounts.getLiquidityForAmount0(lower, upper, TOTAL_SUPPLY);
        (BalanceDelta added,) = poolManager.modifyLiquidity(key, _params(token, int256(uint256(liquidity))), "");
        Currency tokenC = Currency.wrap(token);
        poolManager.sync(tokenC);
        tokenC.transfer(address(poolManager), uint256(int256(-(tokenIs1 ? added.amount1() : added.amount0()))));
        poolManager.settle();
    }

    /// @dev The launcher's buy, at the opening price, at the coin's chosen fee (the hook exempts this
    ///      factory from the opening fee): paying the quote, which is currency0 exactly when
    ///      the token is currency1.
    function _firstBuy(PoolKey memory key, address token, bool tokenIs1, uint256 quoteIn, address buyer)
        private
        returns (uint256 got)
    {
        // casting to int256 is safe: `quoteIn` is ETH sent or an asset balance, both far below 2^255
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exactIn = -int256(quoteIn);
        BalanceDelta bought = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: tokenIs1,
                amountSpecified: exactIn,
                sqrtPriceLimitX96: tokenIs1 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        got = uint256(int256(tokenIs1 ? bought.amount1() : bought.amount0()));
        Currency quoteC = tokenIs1 ? key.currency0 : key.currency1;
        if (quoteC.isAddressZero()) {
            poolManager.settle{value: quoteIn}();
        } else {
            poolManager.sync(quoteC);
            _pull(quoteC, buyer, quoteIn);
            poolManager.settle();
        }
        poolManager.take(Currency.wrap(token), buyer, got);
    }

    function _collect(address token) private returns (bytes memory) {
        PoolKey memory key = _launches[token].key;
        // a zero change pokes the position: what comes back is exactly the fees it earned
        (BalanceDelta fees,) = poolManager.modifyLiquidity(key, _params(token, 0), "");
        uint256 amount0 = uint256(int256(fees.amount0()));
        uint256 amount1 = uint256(int256(fees.amount1()));
        if (amount0 > 0) poolManager.take(key.currency0, address(this), amount0);
        if (amount1 > 0) poolManager.take(key.currency1, address(this), amount1);
        return abi.encode(amount0, amount1);
    }

    // ───────────────────────────────────────────────────────────── moving value

    /// @dev The first buy's asset, from the buyer straight to the pool manager. A refusal reverts the launch.
    function _pull(Currency currency, address from, uint256 amount) private {
        (bool ok, bytes memory answer) = Currency.unwrap(currency).call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(poolManager), amount)
        );
        if (!ok || (answer.length > 0 && !abi.decode(answer, (bool)))) revert TransferFailed();
    }

    function _split(Currency currency, uint256 amount, address creatorRecipient, address referrer) private {
        if (amount == 0) return;
        uint256 toCreator = amount * CREATOR_SHARE_BPS / 10_000;
        _send(currency, creatorRecipient, toCreator);
        uint256 toReferrer;
        if (referrer != address(0)) {
            toReferrer = amount * REFERRER_SHARE_BPS / 10_000;
            _send(currency, referrer, toReferrer);
        }
        // the protocol takes the remainder, so the rounding of both shares stays in the split
        _send(currency, protocolRecipient, amount - toCreator - toReferrer);
    }

    /// @dev Pushes, and keeps as `owed` whatever the recipient — or the asset's own transfer policy —
    ///      refuses: one refusal must not stop everyone else's fees.
    function _send(Currency currency, address to, uint256 amount) private {
        bool ok = _push(currency, to, amount);
        if (!ok) owed[to][currency] += amount;
        emit Paid(to, currency, amount, ok);
    }

    /// @dev ETH by call; an asset by `transfer`, accepting a token that returns nothing, refusing one that returns false.
    function _push(Currency currency, address to, uint256 amount) private returns (bool ok) {
        bytes memory answer;
        if (currency.isAddressZero()) {
            (ok,) = to.call{value: amount}("");
            return ok;
        }
        (ok, answer) = Currency.unwrap(currency).call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return ok && (answer.length == 0 || abi.decode(answer, (bool)));
    }

    /// @dev ETH arrives only from the pool manager's `take`; anything else would be stuck here.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
    }
}
