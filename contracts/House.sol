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
  }

  function setFeeBps(uint256 _feeBps) external onlyOwner { feeBps = _feeBps; }
  function setTreasury(address _treasury) external onlyOwner { require(_treasury != address(0), "ZERO"); treasury = _treasury; }
  function transferOwnership(address _owner) external onlyOwner { require(_owner != address(0), "ZERO"); owner = _owner; }

  // Deposit RXCGT into internal balance (requires prior approve by user)
  function deposit(uint256 amount) external {
    require(amount > 0, "AMOUNT_ZERO");
    require(token.transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM_FAIL");
    balances[msg.sender] += amount;
  }

  function withdraw(uint256 amount) public {
    require(balances[msg.sender] >= amount, "INSUFFICIENT_BAL");
    balances[msg.sender] -= amount;
    require(token.transfer(msg.sender, amount), "WITHDRAW_FAIL");
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

    uint256 fee = (payout * feeBps) / 10000;
    uint256 net = payout - fee;

    if (payout > 0) {
      // Credit winnings to internal balance; optionally route fee to treasury
      balances[msg.sender] += net;
      if (fee > 0 && treasury != address(this)) require(token.transfer(treasury, fee), "FEE_FAIL");
    }

    emit GamePlayed(msg.sender, gameId, wager, payout, data);
  }

  // Batch version to reduce confirmations: uses a caller-provided seed for pseudo randomness per move index
  function playBatch(uint256 gameId, uint256[] calldata wagers, bytes calldata seed) public returns (uint256 totalPayout) {
    require(wagers.length > 0, "NO_MOVES");
    // Expect a constant base wager per move
    uint256 base = wagers[0];
    require(base > 0, "WAGER_ZERO");
    // Require player has at least base deposited (locked as stake)
    require(balances[msg.sender] >= base, "INSUFFICIENT_BAL");

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
    uint256 fee = (payout * feeBps) / 10000;
    uint256 net = payout - fee;
    if (net > 0) {
      balances[msg.sender] += net;
    }
    if (fee > 0 && treasury != address(this)) {
      require(token.transfer(treasury, fee), "FEE_FAIL");
    }

    emit GameBatchPlayed(msg.sender, gameId, base * wagers.length, payout, wagers.length, seed);
    return payout;
  }

  // Convenience: batch play then withdraw all remaining internal balance
  function settleAndWithdraw(uint256 gameId, uint256[] calldata wagers, bytes calldata seed) external {
    playBatch(gameId, wagers, seed);
    uint256 amt = balances[msg.sender];
    if (amt > 0) {
      balances[msg.sender] = 0;
      require(token.transfer(msg.sender, amt), "WITHDRAW_FAIL");
    }
  }

  // Optional: allow owner to withdraw stuck funds
  function sweep(address to, uint256 amount) external onlyOwner {
    require(token.transfer(to, amount), "SWEEP_FAIL");
  }
}
