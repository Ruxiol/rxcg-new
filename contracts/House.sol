// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function totalSupply() external view returns (uint256);
  function balanceOf(address account) external view returns (uint256);
  function transfer(address to, uint256 amount) external returns (bool);
  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function decimals() external view returns (uint8);
}

contract House {
  event GamePlayed(address indexed player, uint256 indexed gameId, uint256 wager, uint256 payout, bytes data);
  event GameBatchPlayed(address indexed player, uint256 indexed gameId, uint256 totalWager, uint256 totalPayout, uint256 count, bytes seed);

  address public owner;
  IERC20 public immutable token;
  address public treasury;
  uint256 public feeBps; // e.g., 100 = 1%
  uint256 public houseEdgeBps; // e.g., 500 = 5% edge => 95% RTP
  // Commit-reveal: owner sets a house commit; players bind to the current commit when they commit
  bytes32 public currentHouseCommit; // keccak256(houseSeed)
  mapping(address => bytes32) public userCommitment; // keccak256(userSeed)
  mapping(address => bytes32) public sessionHouseCommit; // the house commit the user is bound to
  // Per-player internal balances (deposit at Start, play many moves, withdraw on Finish)
  mapping(address => uint256) public balances;

  modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }

  constructor(address _token) {
    require(_token != address(0), "ZERO_ADDR");
    owner = msg.sender;
    token = IERC20(_token);
    // default: treasury is the contract itself, fee 0
    treasury = address(this);
  feeBps = 0;
  houseEdgeBps = 500; // default 5% edge (95% RTP)
  }

  // --- Safe ERC20 helpers (handles non-standard tokens that return no boolean) ---
  function _safeTransfer(address to, uint256 amount) internal {
    (bool success, bytes memory data) = address(token).call(
      abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
    );
    require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAIL");
  }

  function _safeTransferFrom(address from, address to, uint256 amount) internal {
    (bool success, bytes memory data) = address(token).call(
      abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
    );
    require(success && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAIL");
  }

  function setFeeBps(uint256 _feeBps) external onlyOwner { feeBps = _feeBps; }
  function setTreasury(address _treasury) external onlyOwner { require(_treasury != address(0), "ZERO"); treasury = _treasury; }
  function transferOwnership(address _owner) external onlyOwner { require(_owner != address(0), "ZERO"); owner = _owner; }
  function setHouseEdgeBps(uint256 _bps) external onlyOwner { require(_bps <= 10_000, "BPS_TOO_HIGH"); houseEdgeBps = _bps; }
  function setCurrentHouseCommit(bytes32 _commit) external onlyOwner { require(_commit != bytes32(0), "ZERO_COMMIT"); currentHouseCommit = _commit; }

  // Players must commit to their seed before playing a session; binds the session to the active house commit.
  function userCommit(bytes32 _userCommit) external {
    require(_userCommit != bytes32(0), "ZERO_COMMIT");
    require(userCommitment[msg.sender] == bytes32(0), "ACTIVE_SESSION");
    require(currentHouseCommit != bytes32(0), "NO_HOUSE_COMMIT");
    userCommitment[msg.sender] = _userCommit;
    sessionHouseCommit[msg.sender] = currentHouseCommit;
  }

  // Deposit RXCGT into internal balance (requires prior approve by user)
  function deposit(uint256 amount) external {
    require(amount > 0, "AMOUNT_ZERO");
    uint256 beforeBal = token.balanceOf(address(this));
    _safeTransferFrom(msg.sender, address(this), amount);
    uint256 afterBal = token.balanceOf(address(this));
    require(afterBal > beforeBal, "NO_TOKENS");
    uint256 received = afterBal - beforeBal;
    balances[msg.sender] += received;
  }

  function withdraw(uint256 amount) public {
    require(balances[msg.sender] >= amount, "INSUFFICIENT_BAL");
    balances[msg.sender] -= amount;
  _safeTransfer(msg.sender, amount);
  }

  function withdrawAll() external {
    uint256 amt = balances[msg.sender];
    withdraw(amt);
  }

  // WARNING: This example uses pseudo randomness (NOT for production). Replace with VRF/commit-reveal for fairness.
  function play(uint256 gameId, uint256 wager, uint256[] calldata /* bet */, bytes calldata data) external returns (uint256 payout) {
    require(wager > 0, "WAGER_ZERO");
    // Use internal balance instead of transferFrom per click
    require(balances[msg.sender] >= wager, "INSUFFICIENT_BAL");
    balances[msg.sender] -= wager;

    // Pseudo outcome: 50/50 double or lose. Replace per-game math in your frontend (encode in `data`) or on-chain here.
    bool win = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, block.timestamp))) % 2 == 0;
  payout = win ? wager * 2 : 0;
  // Apply house edge on payout first (scales player returns)
  uint256 payoutAfterEdge = (payout * (10_000 - houseEdgeBps)) / 10_000;
  uint256 fee = (payoutAfterEdge * feeBps) / 10_000;
  uint256 net = payoutAfterEdge - fee;

    if (payout > 0) {
      // Credit winnings to internal balance; optionally route fee to treasury
      balances[msg.sender] += net;
  if (fee > 0 && treasury != address(this)) _safeTransfer(treasury, fee);
    }

  // Emit the payout after edge (pre-fee) for transparency
  emit GamePlayed(msg.sender, gameId, wager, payoutAfterEdge, data);
  }

  // Batch version to reduce confirmations: uses a caller-provided seed for pseudo randomness per move index
  function playBatch(uint256 gameId, uint256[] calldata wagers, bytes calldata seed) public returns (uint256 totalPayout) {
    require(wagers.length > 0, "NO_MOVES");
    // Expect a constant base wager per move
    uint256 base = wagers[0];
    require(base > 0, "WAGER_ZERO");
  // Require player has at least base deposited (locked as stake)
  require(balances[msg.sender] >= base, "INSUFFICIENT_BAL");
  // lock stake upfront
  balances[msg.sender] -= base;

    uint256 wins = 0;
    for (uint256 i = 0; i < wagers.length; i++) {
      require(wagers[i] == base, "NON_UNIFORM");
      bool win = uint256(keccak256(abi.encode(seed, msg.sender, i))) % 2 == 0;
      if (!win) {
        // lost at move i: payout is zero; stake stays with the house (already deposited)
        wins = 0;
        break;
      }
      wins += 1;
    }

    // If at least 1 win, payout = base * (1 + wins); else 0
  uint256 payout = wins > 0 ? base * (1 + wins) : 0;
  // Apply house edge on payout first
  uint256 payoutAfterEdge = (payout * (10_000 - houseEdgeBps)) / 10_000;
  uint256 fee = (payoutAfterEdge * feeBps) / 10_000;
  uint256 net = payoutAfterEdge - fee;
    if (net > 0) {
      balances[msg.sender] += net;
    }
    if (fee > 0 && treasury != address(this)) {
      _safeTransfer(treasury, fee);
    }

  emit GameBatchPlayed(msg.sender, gameId, base * wagers.length, payoutAfterEdge, wagers.length, seed);
  return payoutAfterEdge;
  }

  // Commit-reveal version: verifies both seeds and uses mixed entropy
  function playBatchReveal(uint256 gameId, uint256[] calldata wagers, bytes calldata userSeed, bytes calldata houseSeed) external returns (uint256) {
    // Verify commitments
    require(keccak256(userSeed) == userCommitment[msg.sender], "BAD_USER_REVEAL");
    require(keccak256(houseSeed) == sessionHouseCommit[msg.sender], "BAD_HOUSE_REVEAL");

  // Clear session (prevents re-use even if revert later)
  userCommitment[msg.sender] = bytes32(0);
  sessionHouseCommit[msg.sender] = bytes32(0);

    require(wagers.length > 0, "NO_MOVES");
    uint256 base = wagers[0];
    require(base > 0, "WAGER_ZERO");
    require(balances[msg.sender] >= base, "INSUFFICIENT_BAL");
    // lock stake upfront
    balances[msg.sender] -= base;

    uint256 wins = 0;
    for (uint256 i = 0; i < wagers.length; i++) {
      require(wagers[i] == base, "NON_UNIFORM");
  // Use combined seeds directly per move to avoid extra locals
  bool win = uint256(keccak256(abi.encode(userSeed, houseSeed, msg.sender, i))) % 2 == 0;
      if (!win) { wins = 0; break; }
      wins += 1;
    }

    uint256 payout = wins > 0 ? base * (1 + wins) : 0;
    uint256 payoutAfterEdge = (payout * (10_000 - houseEdgeBps)) / 10_000;
    uint256 fee = (payoutAfterEdge * feeBps) / 10_000;
    uint256 net = payoutAfterEdge - fee;
    if (net > 0) { balances[msg.sender] += net; }
    if (fee > 0 && treasury != address(this)) { _safeTransfer(treasury, fee); }

    emit GameBatchPlayed(msg.sender, gameId, base * wagers.length, payoutAfterEdge, wagers.length, userSeed);
    return payoutAfterEdge;
  }

  // Convenience: batch play then withdraw all remaining internal balance
  function settleAndWithdraw(uint256 gameId, uint256[] calldata wagers, bytes calldata seed) external {
    playBatch(gameId, wagers, seed);
    uint256 amt = balances[msg.sender];
    if (amt > 0) {
      balances[msg.sender] = 0;
  _safeTransfer(msg.sender, amt);
    }
  }

  // Optional: allow owner to withdraw stuck funds
  function sweep(address to, uint256 amount) external onlyOwner {
  _safeTransfer(to, amount);
  }
}
