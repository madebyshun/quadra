// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice What the furnace reads from and calls on this app's launchpad (v3 answers all three).
interface IFurnaceLaunchpad {
    struct Launch {
        address creator;
        address creatorRecipient;
        PoolKey key;
    }

    function launches(address token) external view returns (Launch memory);
    function collect(address token) external returns (uint256 amount0, uint256 amount1);
    function withdraw(Currency currency) external;
}

/// @title QuadraFurnace
///
/// @notice The launcher's share of ONE coin's pool fees, split at a rate fixed at deployment: `burnBps`
///         of every arrival goes to removing the coin from circulation, the rest to `treasury`.
///         Written for $QUADRA (2026-10-29, the owner: "keep part of the revenue for the treasury, do
///         not burn it all"); nothing in it is specific to that coin.
///
///         It does nothing until the coin's creator recipient points the share here with
///         `setCreatorRecipient(token, <this>)` on the launchpad. This contract never calls
///         `setCreatorRecipient`, so that hand-over is for good.
///
///         The pool pays in its two currencies, the coin and its quote (ETH or a stock):
///           - the COIN: `burnBps` is sent to the dead address at once, the rest to the treasury;
///           - the QUOTE: `burnBps` is SET ASIDE (`toBuy`) to buy the coin back from its own pool and
///             burn it; the rest goes to the treasury.
///
/// @dev    Who triggers a buyback: only `treasury`, with a `minOut` it chooses. A permissionless buyback
///         would need a price it can trust, and a v4 pool has no oracle: a caller who moves the pool
///         first could buy at a bad price through it. The treasury can choose WHEN and at what floor,
///         and nothing else: the set-aside can only become burnt coins, never be withdrawn by anyone.
///
///         Refused payouts to the treasury (a stock's transfer policy) are kept as `treasuryOwed` and
///         retried with `payTreasury`; they never block a burn. No owner, no upgrade, no pause.
contract QuadraFurnace is IUnlockCallback {
    using CurrencyLibrary for Currency;

    /// @notice Where burnt coins go. The coin is a B20 with no admin, so nothing can bring them back.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IFurnaceLaunchpad public immutable launchpad;
    IPoolManager public immutable poolManager;
    /// @notice The coin whose fees arrive here, and the coin that is burnt.
    address public immutable token;
    /// @notice Receives what is not burnt, and alone may trigger a buyback.
    address public immutable treasury;
    /// @notice The share of every arrival that is burnt, in basis points (0 to 10,000), fixed for good.
    uint16 public immutable burnBps;

    Currency internal immutable _c0;
    Currency internal immutable _c1;
    uint24 internal immutable _fee;
    int24 internal immutable _spacing;
    address internal immutable _hooks;
    bool internal immutable _tokenIs0;

    /// @notice Quote set aside for buybacks, not yet spent.
    uint256 public toBuy;
    /// @notice Coins burnt straight from the fees, and bought back and burnt; quote spent on buybacks.
    uint256 public burnedFromFees;
    uint256 public burnedFromBuybacks;
    uint256 public quoteSpent;
    /// @notice What the treasury refused, per currency, waiting for `payTreasury`.
    mapping(Currency currency => uint256) public treasuryOwed;

    uint256 private _locked = 1;

    event Burned(uint256 amount, bool boughtBack);
    event SetAside(uint256 amount);
    event BoughtBack(uint256 quoteIn, uint256 tokenOut);
    event ToTreasury(Currency indexed currency, uint256 amount, bool paid);

    error NotLaunched();
    error BadSplit();
    error NotTreasury();
    error NotPoolManager();
    error BadAmount();
    error TooLittle(uint256 got, uint256 minOut);
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IFurnaceLaunchpad launchpad_, IPoolManager poolManager_, address token_, address treasury_, uint16 burnBps_) {
        IFurnaceLaunchpad.Launch memory l = launchpad_.launches(token_);
        if (l.creator == address(0)) revert NotLaunched();
        if (burnBps_ > 10_000 || treasury_ == address(0)) revert BadSplit();
        launchpad = launchpad_;
        poolManager = poolManager_;
        token = token_;
        treasury = treasury_;
        burnBps = burnBps_;
        _c0 = l.key.currency0;
        _c1 = l.key.currency1;
        _fee = l.key.fee;
        _spacing = l.key.tickSpacing;
        _hooks = address(l.key.hooks);
        _tokenIs0 = Currency.unwrap(l.key.currency0) == token_;
    }

    // ───────────────────────────────────────────────────────────── bringing fees in

    /// @notice Collect the coin's pool fees on the launchpad (anyone may) and split what came.
    function harvest() external nonReentrant {
        launchpad.collect(token);
        _distribute();
    }

    /// @notice Withdraw what the launchpad kept for this contract after a refused push, then split it.
    function pullOwed(Currency currency) external nonReentrant {
        launchpad.withdraw(currency);
        _distribute();
    }

    /// @notice Split anything that arrived since the last call (a gift counts the same way).
    function distribute() external nonReentrant {
        _distribute();
    }

    /// @notice Retry paying the treasury what it refused before.
    function payTreasury(Currency currency) external nonReentrant {
        uint256 amount = treasuryOwed[currency];
        treasuryOwed[currency] = 0;
        _toTreasury(currency, amount);
    }

    // ───────────────────────────────────────────────────────────── buying back

    /// @notice Spend `amountIn` of the set-aside quote buying the coin from its own pool, and burn every
    ///         coin bought. Only the treasury, which picks the floor `minOut`.
    function buyAndBurn(uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 got) {
        if (msg.sender != treasury) revert NotTreasury();
        _distribute();
        if (amountIn == 0 || amountIn > toBuy) revert BadAmount();
        toBuy -= amountIn;
        got = abi.decode(poolManager.unlock(abi.encode(amountIn)), (uint256));
        if (got < minOut) revert TooLittle(got, minOut);
        quoteSpent += amountIn;
        burnedFromBuybacks += got;
        _burn(got);
        emit BoughtBack(amountIn, got);
        emit Burned(got, true);
    }

    /// @dev The swap, inside the pool manager's lock: exact `amountIn` of the quote for the coin.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint256 amountIn = abi.decode(data, (uint256));
        PoolKey memory key = _key();
        // selling the quote: it is currency0 exactly when the coin is currency1
        bool zeroForOne = !_tokenIs0;
        // casting to int256 is safe: `amountIn` is a balance this contract holds, far below 2^255
        // forge-lint: disable-next-line(unsafe-typecast)
        int256 exactIn = -int256(amountIn);
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactIn,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        uint256 got = uint256(int256(_tokenIs0 ? d.amount0() : d.amount1()));
        Currency quote = _quote();
        if (quote.isAddressZero()) {
            poolManager.settle{value: amountIn}();
        } else {
            poolManager.sync(quote);
            quote.transfer(address(poolManager), amountIn);
            poolManager.settle();
        }
        poolManager.take(Currency.wrap(token), address(this), got);
        return abi.encode(got);
    }

    // ───────────────────────────────────────────────────────────── the split

    function _distribute() private {
        Currency coin = Currency.wrap(token);
        uint256 coins = coin.balanceOfSelf() - treasuryOwed[coin];
        if (coins > 0) {
            uint256 burn = coins * burnBps / 10_000;
            if (burn > 0) {
                burnedFromFees += burn;
                _burn(burn);
                emit Burned(burn, false);
            }
            _toTreasury(coin, coins - burn);
        }
        Currency quote = _quote();
        uint256 fresh = quote.balanceOfSelf() - toBuy - treasuryOwed[quote];
        if (fresh > 0) {
            uint256 set = fresh * burnBps / 10_000;
            if (set > 0) {
                toBuy += set;
                emit SetAside(set);
            }
            _toTreasury(quote, fresh - set);
        }
    }

    /// @dev The coin is a B20 with no admin and no transfer rule, so a transfer to the dead address
    ///      cannot be refused; were it ever, the library's revert stops the burn outright.
    function _burn(uint256 amount) private {
        Currency.wrap(token).transfer(DEAD, amount);
    }

    function _toTreasury(Currency currency, uint256 amount) private {
        if (amount == 0) return;
        bool ok = _push(currency, treasury, amount);
        if (!ok) treasuryOwed[currency] += amount;
        emit ToTreasury(currency, amount, ok);
    }

    /// @dev ETH with a fixed stipend and no return data copied (the review's F1, kept out of this
    ///      contract); a token by `transfer`, accepting one that returns nothing, refusing one that
    ///      returns false.
    function _push(Currency currency, address to, uint256 amount) private returns (bool ok) {
        if (currency.isAddressZero()) {
            assembly ("memory-safe") {
                ok := call(50000, to, amount, 0, 0, 0, 0)
            }
            return ok;
        }
        bytes memory answer;
        (ok, answer) = Currency.unwrap(currency).call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return ok && (answer.length == 0 || abi.decode(answer, (bool)));
    }

    function _quote() private view returns (Currency) {
        return _tokenIs0 ? _c1 : _c0;
    }

    function _key() private view returns (PoolKey memory) {
        return PoolKey({currency0: _c0, currency1: _c1, fee: _fee, tickSpacing: _spacing, hooks: IHooks(_hooks)});
    }

    /// @notice Whether the launchpad is paying the launcher's share here right now.
    function isActive() external view returns (bool) {
        return launchpad.launches(token).creatorRecipient == address(this);
    }

    /// @dev The launchpad pays ETH here by call, and the pool manager never does; a gift is welcome.
    receive() external payable {}
}
