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
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @title LaunchFactory (v2)
///
/// @notice A token launchpad on Base with nothing to rug, paired with ETH or with an asset the
///         quote admin has enabled — Coinbase's stock tokens on Base above all. One call creates a
///         B20 token with a fixed supply and NO admin, opens a Uniswap v4 pool for it against the
///         chosen quote, and puts the whole supply into that pool as liquidity that no function can
///         ever take out. Every trade pays the pool's 1% fee; this contract collects those fees and
///         splits them 80% to the launcher and 20% to the protocol, in whatever the trade paid with.
///
/// @dev What the launcher cannot do — enforced by the chain, as in v1 (contracts/deployed/):
///      mint, pause, freeze, seize or rename (the B20 has no admin, so no role can ever be
///      granted); pull liquidity (no code path passes a negative `liquidityDelta`); be front-run
///      to the pool (the token does not exist until this transaction).
///
///      What the QUOTE ADMIN can do, and nothing more: enable or disable a quote asset, and set the
///      opening price new launches against it use. It cannot touch a pool, a position, a fee or a
///      launch that already exists. Two-step to hand on, like the protocol recipient.
///
///      The supply goes in as single-sided liquidity at the quote's opening price, on whichever
///      side of the pool the token sorts to. Prices are kept as a tick of TOKEN-PER-QUOTE in raw
///      units, so one number serves both orientations: when the token is currency1 the pool's own
///      tick is that number and the position spans [lowest usable tick, it]; when the token is
///      currency0 the pool's tick is its negation and the position spans [it, highest usable tick].
///
///      A quote's issuer may restrict who holds or moves it (B20 transfer policies). MEASURED
///      2026-10-02 on NVDAc: sender, receiver and executor policies all authorised the pool
///      manager, this factory's v1 and an arbitrary address. A payout a quote refuses is kept as
///      `owed` instead of blocking every other payout of the same collection.
contract LaunchFactory is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    /// @notice Every launch's supply, with 18 decimals: one billion.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice The pool's fee: 1%, in hundredths of a basis point.
    uint24 public constant LP_FEE = 10_000;
    /// @notice The tick spacing Uniswap pairs with a 1% fee.
    int24 public constant TICK_SPACING = 200;
    /// @notice The launcher's share of every fee collected, in basis points; the rest is the protocol's.
    uint16 public constant CREATOR_SHARE_BPS = 8_000;
    /// @notice Where the rounding dust of the opening liquidity goes: out of circulation.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager public immutable poolManager;

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

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IPoolManager manager, address protocol, address admin, int24 ethStartTick) {
        if (address(manager) == address(0) || protocol == address(0) || admin == address(0)) revert ZeroAddress();
        _checkTick(ethStartTick);
        poolManager = manager;
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
    /// @param name the token's name
    /// @param symbol the token's symbol
    /// @param contractURI ERC-7572 metadata (a URL or a data: URI); fixed forever
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
        uint256 quoteIn
    ) external payable nonReentrant returns (address token) {
        Quote memory q = quotes[quote];
        if (!q.enabled) revert QuoteNotEnabled();
        if (msg.value != (quote == address(0) ? quoteIn : 0)) revert WrongValue();

        token = _create(name, symbol, contractURI, launchSalt(msg.sender, salt));
        PoolKey memory key = _record(token, quote, q.startTick);

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
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
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

    // ───────────────────────────────────────────────────────────── fees

    /// @notice Collect a token's pool fees and pay them out: 80% to the launcher's recipient, 20% to
    ///         the protocol, in both of the pool's currencies. Anyone may call it.
    function collect(address token) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Launch storage l = _launches[token];
        if (l.creator == address(0)) revert NotLaunched();
        (amount0, amount1) = abi.decode(poolManager.unlock(abi.encode(Op.Collect, token, uint256(0), address(0))), (uint256, uint256));
        emit FeesCollected(token, amount0, amount1);
        _split(l.key.currency0, amount0, l.creatorRecipient);
        _split(l.key.currency1, amount1, l.creatorRecipient);
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

    /// @dev The launcher's buy, at the opening price: paying the quote, which is currency0 exactly when
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

    function _split(Currency currency, uint256 amount, address creatorRecipient) private {
        if (amount == 0) return;
        uint256 toCreator = amount * CREATOR_SHARE_BPS / 10_000;
        _send(currency, creatorRecipient, toCreator);
        _send(currency, protocolRecipient, amount - toCreator);
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
