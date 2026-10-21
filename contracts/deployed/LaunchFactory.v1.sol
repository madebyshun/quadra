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

/// @title LaunchFactory
///
/// @notice A token launchpad on Base with nothing to rug. One call creates a B20 token with a
///         fixed supply and NO admin, opens a Uniswap v4 pool for it against ETH, and puts the
///         whole supply into that pool as liquidity that no function can ever take out. Every
///         trade pays the pool's 1% fee; this contract collects those fees and splits them 80%
///         to the launcher and 20% to the protocol.
///
/// @dev What the launcher cannot do, and why, each enforced by the chain rather than promised:
///      - mint more: the B20 is created with `initialAdmin = address(0)`, so no role exists to
///        grant `MINT_ROLE`; the supply is minted once, inside the factory's `initCalls`.
///      - pause, freeze, seize, rename: same — every B20 role is unheld, forever.
///      - pull liquidity: the position belongs to THIS contract, and this contract has no code
///        path that passes a negative `liquidityDelta`. `collect` pokes the position with zero.
///      - be front-run to the pool: the token does not exist until this transaction, and the
///        pool is initialised in the same transaction it is created in.
///      The launcher may buy first in the same transaction (`msg.value`), at the opening price.
///
///      The supply goes in as single-sided liquidity: the pool opens at `startTick`, and the
///      position spans [minimum usable tick, startTick] in token-per-ETH terms, so at the opening
///      price it holds only the token. Buying moves the price down that range.
contract LaunchFactory is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    // `Currency.transfer` checks the token's answer in assembly (Solady's safeTransfer), so a
    // token that returns false or nothing is a revert, not a silent non-payment
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
    /// @notice The opening price, as a tick of token-per-ETH. A multiple of `TICK_SPACING`.
    int24 public immutable startTick;

    /// @notice Who receives the protocol's share. Changed only by itself, in two steps.
    address public protocolRecipient;
    address public pendingProtocolRecipient;

    struct Launch {
        /// @notice who launched it
        address creator;
        /// @notice who receives the launcher's share — the launcher, unless they hand it on
        address creatorRecipient;
        PoolKey key;
    }

    mapping(address token => Launch) internal _launches;
    /// @notice ETH that could not be pushed to an account (it refused it), waiting for `withdraw`.
    mapping(address account => uint256 amount) public owedEth;

    uint256 private _locked = 1;

    enum Op {
        Open,
        Collect
    }

    event Launched(
        address indexed token, address indexed creator, PoolId indexed poolId, uint256 devBuyEth, uint256 devBuyTokens
    );
    event FeesCollected(address indexed token, uint256 eth, uint256 tokens);
    event Paid(address indexed to, Currency indexed currency, uint256 amount, bool pushed);
    event CreatorRecipientChanged(address indexed token, address indexed recipient);
    event ProtocolRecipientProposed(address indexed recipient);
    event ProtocolRecipientChanged(address indexed recipient);

    error NotPoolManager();
    error NotLaunched();
    error NotAllowed();
    error ZeroAddress();
    error Reentrancy();
    error BadStartTick();
    error NothingOwed();
    error TransferFailed();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IPoolManager manager, address protocol, int24 openingTick) {
        if (address(manager) == address(0) || protocol == address(0)) revert ZeroAddress();
        int24 floor = TickMath.minUsableTick(TICK_SPACING);
        if (openingTick % TICK_SPACING != 0 || openingTick <= floor || openingTick > TickMath.maxUsableTick(TICK_SPACING)) {
            revert BadStartTick();
        }
        poolManager = manager;
        protocolRecipient = protocol;
        startTick = openingTick;
    }

    // ───────────────────────────────────────────────────────────── launching

    /// @notice Create a token, its pool and its locked liquidity; buy first with any ETH sent.
    /// @param name the token's name
    /// @param symbol the token's symbol
    /// @param contractURI ERC-7572 metadata (a URL or a data: URI); fixed forever
    /// @param salt any value; the token's address is derived from it AND the caller, so nobody
    ///        else can take the address the caller computed
    /// @return token the new token's address
    function launch(string calldata name, string calldata symbol, string calldata contractURI, bytes32 salt)
        external
        payable
        nonReentrant
        returns (address token)
    {
        bytes[] memory init = new bytes[](2);
        init[0] = abi.encodeCall(IB20.mint, (address(this), TOTAL_SUPPLY));
        init[1] = B20FactoryLib.encodeUpdateContractURI(contractURI);
        token = StdPrecompiles.B20_FACTORY.createB20(
            IB20Factory.B20Variant.ASSET,
            launchSalt(msg.sender, salt),
            B20FactoryLib.encodeAssetCreateParams(name, symbol, address(0), 18),
            init
        );

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        _launches[token] = Launch({creator: msg.sender, creatorRecipient: msg.sender, key: key});

        // An exact-input buy spends all of `msg.value`: the range runs down to the lowest price v4
        // allows, so no buy can exhaust it and stop early at the price limit with ETH left over.
        (uint256 spentEth, uint256 boughtTokens) =
            abi.decode(poolManager.unlock(abi.encode(Op.Open, key, msg.value, msg.sender)), (uint256, uint256));

        // the rounding left over from the opening liquidity is a few wei of the token (or none)
        key.currency1.transfer(DEAD, IB20(token).balanceOf(address(this)));

        emit Launched(token, msg.sender, key.toId(), spentEth, boughtTokens);
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

    // ───────────────────────────────────────────────────────────── fees

    /// @notice Collect a token's pool fees and pay them out: 80% to the launcher's recipient, 20%
    ///         to the protocol, in both ETH and the token. Anyone may call it.
    function collect(address token) external nonReentrant returns (uint256 eth, uint256 tokens) {
        Launch storage l = _launches[token];
        if (l.creator == address(0)) revert NotLaunched();
        (eth, tokens) = abi.decode(poolManager.unlock(abi.encode(Op.Collect, l.key, uint256(0), address(0))), (uint256, uint256));
        emit FeesCollected(token, eth, tokens);
        _split(l.key.currency0, eth, l.creatorRecipient);
        _split(l.key.currency1, tokens, l.creatorRecipient);
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
        // a zero pending recipient can never match a caller, so "nothing proposed" refuses here too
        if (msg.sender != pendingProtocolRecipient) revert NotAllowed();
        protocolRecipient = msg.sender;
        pendingProtocolRecipient = address(0);
        emit ProtocolRecipientChanged(msg.sender);
    }

    /// @notice Withdraw ETH that could not be pushed when it was due.
    function withdraw() external nonReentrant {
        uint256 amount = owedEth[msg.sender];
        if (amount == 0) revert NothingOwed();
        owedEth[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Paid(msg.sender, Currency.wrap(address(0)), amount, true);
    }

    function launches(address token) external view returns (Launch memory) {
        return _launches[token];
    }

    // ───────────────────────────────────────────────────────────── the pool manager

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (Op op, PoolKey memory key, uint256 ethIn, address buyer) = abi.decode(data, (Op, PoolKey, uint256, address));
        return op == Op.Open ? _open(key, ethIn, buyer) : _collect(key);
    }

    function _position() private view returns (ModifyLiquidityParams memory) {
        return ModifyLiquidityParams({
            tickLower: TickMath.minUsableTick(TICK_SPACING),
            tickUpper: startTick,
            liquidityDelta: 0,
            salt: bytes32(0)
        });
    }

    function _open(PoolKey memory key, uint256 ethIn, address buyer) private returns (bytes memory) {
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(startTick));

        ModifyLiquidityParams memory position = _position();
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(position.tickLower), TickMath.getSqrtPriceAtTick(position.tickUpper), TOTAL_SUPPLY
        );
        position.liquidityDelta = int256(uint256(liquidity));
        (BalanceDelta added,) = poolManager.modifyLiquidity(key, position, "");
        // the position is entirely token at the opening price: the pool is owed only currency1
        uint256 owed1 = uint256(int256(-added.amount1()));
        poolManager.sync(key.currency1);
        key.currency1.transfer(address(poolManager), owed1);
        poolManager.settle();

        if (ethIn == 0) return abi.encode(uint256(0), uint256(0));
        // casting to int256 is safe: `ethIn` is `msg.value`, bounded by all the ETH there is (< 2^128)
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exactIn = -int256(ethIn);
        BalanceDelta bought = poolManager.swap(
            key, SwapParams({zeroForOne: true, amountSpecified: exactIn, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}), ""
        );
        uint256 spent = uint256(int256(-bought.amount0()));
        uint256 got = uint256(int256(bought.amount1()));
        poolManager.settle{value: spent}();
        poolManager.take(key.currency1, buyer, got);
        return abi.encode(spent, got);
    }

    function _collect(PoolKey memory key) private returns (bytes memory) {
        // a zero change pokes the position: what comes back is exactly the fees it earned
        (BalanceDelta fees,) = poolManager.modifyLiquidity(key, _position(), "");
        uint256 eth = uint256(int256(fees.amount0()));
        uint256 tokens = uint256(int256(fees.amount1()));
        if (eth > 0) poolManager.take(key.currency0, address(this), eth);
        if (tokens > 0) poolManager.take(key.currency1, address(this), tokens);
        return abi.encode(eth, tokens);
    }

    // ───────────────────────────────────────────────────────────── paying out

    function _split(Currency currency, uint256 amount, address creatorRecipient) private {
        if (amount == 0) return;
        uint256 toCreator = amount * CREATOR_SHARE_BPS / 10_000;
        _send(currency, creatorRecipient, toCreator);
        _send(currency, protocolRecipient, amount - toCreator);
    }

    /// @dev Tokens are pushed. ETH is pushed, and if the recipient refuses it, it is kept as `owed`
    ///      for `withdraw` — one recipient that cannot take ETH must not stop everyone else's fees.
    function _send(Currency currency, address to, uint256 amount) private {
        if (!currency.isAddressZero()) {
            currency.transfer(to, amount);
            emit Paid(to, currency, amount, true);
            return;
        }
        (bool ok,) = to.call{value: amount}("");
        if (!ok) owedEth[to] += amount;
        emit Paid(to, currency, amount, ok);
    }

    /// @dev ETH arrives only from the pool manager's `take`; anything else would be stuck here.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
    }
}
