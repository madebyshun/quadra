// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice What a revenue share reads from and calls on this app's launchpad. v2 (`LaunchFactory`) and
///         v3 (`LaunchFactoryV3`) answer all four with the same ABI.
interface ILaunchpad {
    struct Launch {
        address creator;
        address creatorRecipient;
        PoolKey key;
    }

    function launches(address token) external view returns (Launch memory);
    function collect(address token) external returns (uint256 amount0, uint256 amount1);
    function owed(address account, Currency currency) external view returns (uint256);
    function withdraw(Currency currency) external;
}

/// @notice The two token calls a stake needs. A B20 answers both.
interface IStakeToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

/// @title RevenueShare
///
/// @notice An OPT-IN way for one launchpad coin to pass the launcher's share of its pool fees to the
///         people who STAKE the coin here. It does nothing until the coin's current creator recipient
///         hands its share to this contract with `setCreatorRecipient(token, <this>)` on the launchpad
///         — and since this contract has no function that calls `setCreatorRecipient`, that hand-over
///         is FOR GOOD: nobody, the launcher included, can point the share anywhere else afterwards.
///
///         What arrives — in the pool's two currencies only, the coin and its quote (ETH or a stock) —
///         is split once, at a share fixed at deployment: `agentBps` to `agent` (an agent's wallet, say),
///         the rest to stakers, pro rata to what each has staked, released over `STREAM` seconds.
///
/// @dev    Why staking and not "every holder": the coin is a B20 with no admin, so nothing can run on
///         its transfers and it keeps no balance history. A pro-rata split over plain balances would
///         need either a hook that cannot exist or an off-chain snapshot somebody posts — an operator
///         this contract would have to trust. It would also pay mostly the pool itself, which holds
///         most of the supply. Stakers are counted here, exactly, by this contract alone.
///
///         Why a stream: the launchpad's `collect` is public, so with an instant split anybody could
///         stake a large amount, call `collect`, claim and unstake in one transaction and take most of
///         everything accrued since the last collect. Every arrival is instead released in a straight
///         line over `STREAM` (re-spread with what is still unreleased whenever more arrives), so a
///         stake earns only for the seconds it is staked. While NOBODY is staked the stream is paused,
///         not lost: the clock is pushed forward and the first stakers receive it as it runs.
///
///         Accounting is by balance: the launchpad PUSHES (ETH by call, a token by `transfer`), so
///         nothing tells this contract a payment arrived. Every entry point first compares each
///         currency's balance with what is already accounted for; the difference is an arrival. A
///         direct gift counts the same way.
///
///         Refused payouts — a recipient that refuses ETH, a stock whose transfer policy refuses the
///         receiver — stay credited to whoever was owed, and one refusal never blocks anyone else.
///         No owner, no upgrade, no pause, no sweep: no address can move funds that are not its own.
contract RevenueShare {
    using CurrencyLibrary for Currency;

    /// @notice How long each arrival takes to be released to stakers.
    uint256 public constant STREAM = 7 days;
    /// @notice The highest agent share allowed, in basis points: stakers always get at least 10%.
    uint16 public constant MAX_AGENT_BPS = 9_000;
    /// @dev The fixed-point scale of `perShare`. 1e36 keeps an 8-decimal stock's cents meaningful
    ///      against a billion 18-decimal coins staked.
    uint256 internal constant ACC = 1e36;

    ILaunchpad public immutable launchpad;
    /// @notice The coin that is staked here, and the coin this contract shares the fees of.
    address public immutable token;
    /// @notice The pool's currencies, as the launchpad sorted them (`address(0)` = ETH).
    Currency public immutable currency0;
    Currency public immutable currency1;
    /// @notice Who receives the fixed agent share (`address(0)` when there is none).
    address public immutable agent;
    /// @notice The agent's share of every arrival, in basis points; fixed for good.
    uint16 public immutable agentBps;

    struct Stream {
        /// @notice this currency's balance already accounted for (stakes included, for the coin)
        uint256 accounted;
        /// @notice arrived for stakers, not yet released
        uint256 unreleased;
        /// @notice released per staked unit, scaled by 1e36; only ever grows
        uint256 perShare;
        /// @notice the agent's share, waiting for `payAgent`
        uint256 agentOwed;
        uint64 lastUpdate;
        /// @notice when `unreleased` will have been released completely
        uint64 finish;
    }

    struct Account {
        uint256 staked;
        uint256[2] paidPerShare;
        uint256[2] credited;
    }

    Stream[2] internal _streams;
    mapping(address staker => Account) internal _accounts;
    uint256 public totalStaked;

    uint256 private _locked = 1;

    event Staked(address indexed staker, uint256 amount);
    event Unstaked(address indexed staker, uint256 amount);
    /// @dev `toAgent` is part of `amount`; the rest goes to stakers.
    event Arrived(Currency indexed currency, uint256 amount, uint256 toAgent);
    /// @dev `paid` false: the transfer was refused and the amount is still credited to `staker`.
    event Claimed(address indexed staker, address indexed to, Currency indexed currency, uint256 amount, bool paid);
    event AgentPaid(Currency indexed currency, uint256 amount, bool paid);

    error NotLaunched();
    error BadSplit();
    error ZeroAmount();
    error Insufficient();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    /// @param launchpad_ the launchpad `token` was launched on
    /// @param token_ a coin launched there
    /// @param agent_ who receives the fixed share; `address(0)` exactly when `agentBps_` is 0
    /// @param agentBps_ the agent's share in basis points, 0 to `MAX_AGENT_BPS`
    constructor(ILaunchpad launchpad_, address token_, address agent_, uint16 agentBps_) {
        ILaunchpad.Launch memory l = launchpad_.launches(token_);
        if (l.creator == address(0)) revert NotLaunched();
        if (agentBps_ > MAX_AGENT_BPS || (agent_ == address(0)) != (agentBps_ == 0)) revert BadSplit();
        launchpad = launchpad_;
        token = token_;
        currency0 = l.key.currency0;
        currency1 = l.key.currency1;
        agent = agent_;
        agentBps = agentBps_;
        uint64 now_ = uint64(block.timestamp);
        _streams[0].lastUpdate = now_;
        _streams[0].finish = now_;
        _streams[1].lastUpdate = now_;
        _streams[1].finish = now_;
    }

    // ───────────────────────────────────────────────────────────── staking

    /// @notice Stake `amount` of the coin (approve this contract first). It earns from this second on.
    function stake(uint256 amount) external nonReentrant {
        _stake(amount);
    }

    /// @notice `stake` with an EIP-2612 permit, in one transaction. A permit somebody already used
    ///         (copied from the mempool, say) is ignored and the allowance it set is used instead.
    function stakeWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        try IStakeToken(token).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        _stake(amount);
    }

    function _stake(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender);
        uint256 i = _tokenIndex();
        uint256 before = Currency.wrap(token).balanceOfSelf();
        if (!IStakeToken(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        // what actually arrived is what is staked
        uint256 got = Currency.wrap(token).balanceOfSelf() - before;
        _streams[i].accounted += got;
        _accounts[msg.sender].staked += got;
        totalStaked += got;
        emit Staked(msg.sender, got);
    }

    /// @notice Take back `amount` of your stake. Whatever it earned stays credited to you.
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _settle(msg.sender);
        Account storage a = _accounts[msg.sender];
        if (amount > a.staked) revert Insufficient();
        a.staked -= amount;
        totalStaked -= amount;
        _streams[_tokenIndex()].accounted -= amount;
        if (!_push(Currency.wrap(token), msg.sender, amount)) revert TransferFailed();
        emit Unstaked(msg.sender, amount);
    }

    // ───────────────────────────────────────────────────────────── paying out

    /// @notice Send everything credited to you, in both currencies, to `to`. A currency `to` refuses
    ///         stays credited to you; the other is still paid.
    function claim(address to) external nonReentrant returns (uint256 paid0, uint256 paid1) {
        _settle(msg.sender);
        paid0 = _claim(0, to);
        paid1 = _claim(1, to);
    }

    function _claim(uint256 i, address to) private returns (uint256) {
        Account storage a = _accounts[msg.sender];
        uint256 amount = a.credited[i];
        if (amount == 0) return 0;
        Currency c = _currency(i);
        a.credited[i] = 0;
        _streams[i].accounted -= amount;
        bool ok = _push(c, to, amount);
        if (!ok) {
            a.credited[i] = amount;
            _streams[i].accounted += amount;
        }
        emit Claimed(msg.sender, to, c, amount, ok);
        return ok ? amount : 0;
    }

    /// @notice Pay the agent its share. Anyone may call it; it pays only `agent`.
    function payAgent() external nonReentrant {
        _syncAll();
        _payAgent(0);
        _payAgent(1);
    }

    function _payAgent(uint256 i) private {
        Stream storage s = _streams[i];
        uint256 amount = s.agentOwed;
        if (amount == 0) return;
        Currency c = _currency(i);
        s.agentOwed = 0;
        s.accounted -= amount;
        bool ok = _push(c, agent, amount);
        if (!ok) {
            s.agentOwed = amount;
            s.accounted += amount;
        }
        emit AgentPaid(c, amount, ok);
    }

    // ───────────────────────────────────────────────────────────── bringing fees in

    /// @notice Collect the coin's pool fees on the launchpad (anyone may) and start releasing what came.
    function harvest() external nonReentrant {
        launchpad.collect(token);
        _syncAll();
    }

    /// @notice Withdraw what the launchpad is keeping for this contract because a push to it was
    ///         refused (a stock's transfer policy, say), then account for it.
    function pullOwed(Currency currency) external nonReentrant {
        launchpad.withdraw(currency);
        _syncAll();
    }

    /// @notice Account for anything that arrived since the last call and bring the streams up to now.
    function sync() external nonReentrant {
        _syncAll();
    }

    // ───────────────────────────────────────────────────────────── reading

    /// @notice Whether the launchpad is paying the launcher's share here right now. A share contract
    ///         that is not the coin's creator recipient receives nothing from the pool.
    function isActive() external view returns (bool) {
        return launchpad.launches(token).creatorRecipient == address(this);
    }

    function stakedOf(address staker) external view returns (uint256) {
        return _accounts[staker].staked;
    }

    /// @notice What `staker` could claim now, in currency0 and currency1 — counting arrivals that are
    ///         not yet accounted for exactly as the next call would.
    function claimable(address staker) external view returns (uint256 amount0, uint256 amount1) {
        Account storage a = _accounts[staker];
        uint256[2] memory out;
        for (uint256 i; i < 2; i++) {
            Stream memory s = _streams[i];
            _syncView(s, i);
            out[i] = a.credited[i] + FullMath.mulDiv(a.staked, s.perShare - a.paidPerShare[i], ACC);
        }
        return (out[0], out[1]);
    }

    /// @notice A currency's stream as stored (index 0 = currency0).
    function streams(uint256 i) external view returns (Stream memory) {
        return _streams[i];
    }

    // ───────────────────────────────────────────────────────────── the accounting

    /// @dev Bring both streams up to now, then credit `staker` with what their stake earned so far.
    function _settle(address staker) private {
        _syncAll();
        Account storage a = _accounts[staker];
        for (uint256 i; i < 2; i++) {
            uint256 perShare = _streams[i].perShare;
            a.credited[i] += FullMath.mulDiv(a.staked, perShare - a.paidPerShare[i], ACC);
            a.paidPerShare[i] = perShare;
        }
    }

    function _syncAll() private {
        for (uint256 i; i < 2; i++) {
            Stream memory s = _streams[i];
            (uint256 arrived, uint256 toAgent) = _syncView(s, i);
            _streams[i] = s;
            if (arrived > 0) emit Arrived(_currency(i), arrived, toAgent);
        }
    }

    /// @dev The whole update, on a copy: release up to now under the old schedule, then take in what
    ///      arrived and spread everything unreleased over a fresh `STREAM`. Shared by `claimable`, so
    ///      what it shows is what a call would do.
    function _syncView(Stream memory s, uint256 i) private view returns (uint256 arrived, uint256 toAgent) {
        _release(s);
        uint256 balance = _currency(i).balanceOfSelf();
        // a balance BELOW what is accounted for (a stock's issuer can seize) brings nothing in; the
        // payouts it can no longer cover are refused and stay credited, as any refusal does
        if (balance <= s.accounted) return (0, 0);
        arrived = balance - s.accounted;
        s.accounted = balance;
        toAgent = arrived * agentBps / 10_000;
        s.agentOwed += toAgent;
        s.unreleased += arrived - toAgent;
        // casting to uint64 is safe: a timestamp plus seven days is far below 2^64 seconds
        // forge-lint: disable-next-line(unsafe-typecast)
        s.finish = uint64(block.timestamp + STREAM);
    }

    /// @dev Release in a straight line from `lastUpdate` to `finish`. The share released is computed
    ///      from what is left, so at `finish` exactly everything is out and no rate rounding is stranded.
    function _release(Stream memory s) private view {
        uint64 now_ = uint64(block.timestamp);
        if (now_ == s.lastUpdate) return;
        if (totalStaked == 0) {
            // nobody to release to: pause the clock rather than release into nothing
            if (s.finish > s.lastUpdate) s.finish += now_ - s.lastUpdate;
        } else {
            uint64 end = now_ < s.finish ? now_ : s.finish;
            if (end > s.lastUpdate) {
                uint256 released = FullMath.mulDiv(s.unreleased, end - s.lastUpdate, s.finish - s.lastUpdate);
                s.unreleased -= released;
                s.perShare += FullMath.mulDiv(released, ACC, totalStaked);
            }
        }
        s.lastUpdate = now_;
    }

    function _currency(uint256 i) private view returns (Currency) {
        return i == 0 ? currency0 : currency1;
    }

    function _tokenIndex() private view returns (uint256) {
        return Currency.unwrap(currency0) == token ? 0 : 1;
    }

    /// @dev ETH by call; a token by `transfer`, accepting one that returns nothing, refusing one that
    ///      returns false — the launchpad's own rule.
    function _push(Currency currency, address to, uint256 amount) private returns (bool ok) {
        bytes memory answer;
        if (currency.isAddressZero()) {
            (ok,) = to.call{value: amount}("");
            return ok;
        }
        (ok, answer) = Currency.unwrap(currency).call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return ok && (answer.length == 0 || abi.decode(answer, (bool)));
    }

    /// @dev The launchpad pays ETH here by call; a gift is welcome too. Accounted on the next call.
    receive() external payable {}
}

/// @title RevenueShareDeployer
/// @notice Deploys a `RevenueShare` for one launchpad, at an address fixed by (token, agent, agentBps),
///         and announces it — so an app can find every share contract of a coin from one event.
///         Anyone may deploy one; it receives nothing until the coin's creator recipient points the
///         launcher's share at it.
contract RevenueShareDeployer {
    ILaunchpad public immutable launchpad;

    event Created(address indexed token, address indexed share, address indexed agent, uint16 agentBps);

    error AlreadyCreated();

    constructor(ILaunchpad launchpad_) {
        launchpad = launchpad_;
    }

    function create(address token, address agent, uint16 agentBps) external returns (RevenueShare share) {
        if (predict(token, agent, agentBps).code.length > 0) revert AlreadyCreated();
        share = new RevenueShare{salt: _salt(token, agent, agentBps)}(launchpad, token, agent, agentBps);
        emit Created(token, address(share), agent, agentBps);
    }

    /// @notice Where `create(token, agent, agentBps)` puts (or has put) its contract.
    function predict(address token, address agent, uint16 agentBps) public view returns (address) {
        bytes32 initCode =
            keccak256(abi.encodePacked(type(RevenueShare).creationCode, abi.encode(launchpad, token, agent, agentBps)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(token, agent, agentBps), initCode)))));
    }

    function _salt(address token, address agent, uint16 agentBps) private pure returns (bytes32) {
        return keccak256(abi.encode(token, agent, agentBps));
    }
}
