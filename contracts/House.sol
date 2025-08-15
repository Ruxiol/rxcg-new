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

  address public owner;
  IERC20 public immutable token;
  address public treasury;
  uint256 public feeBps; // e.g., 100 = 1%

  modifier onlyOwner() { require(msg.sender == owner, "NOT_OWNER"); _; }

  constructor(address _token, address _treasury, uint256 _feeBps) {
    require(_token != address(0) && _treasury != address(0), "ZERO_ADDR");
    owner = msg.sender;
    token = IERC20(_token);
    treasury = _treasury;
    feeBps = _feeBps; // caution: max ~1000 (10%) rec.
  }

  function setFeeBps(uint256 _feeBps) external onlyOwner { feeBps = _feeBps; }
  function setTreasury(address _treasury) external onlyOwner { require(_treasury != address(0), "ZERO"); treasury = _treasury; }
  function transferOwnership(address _owner) external onlyOwner { require(_owner != address(0), "ZERO"); owner = _owner; }

  // WARNING: This example uses pseudo randomness (NOT for production). Replace with VRF/commit-reveal for fairness.
  function play(uint256 gameId, uint256 wager, uint256[] calldata bet, bytes calldata data) external returns (uint256 payout) {
    require(wager > 0, "WAGER_ZERO");
    // Pull tokens
    require(token.transferFrom(msg.sender, address(this), wager), "TRANSFER_FROM_FAIL");

    // Pseudo outcome: 50/50 double or lose. Replace per-game math in your frontend (encode in `data`) or on-chain here.
    bool win = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, block.timestamp))) % 2 == 0;
    payout = win ? wager * 2 : 0;

    uint256 fee = (payout * feeBps) / 10000;
    uint256 net = payout - fee;

    if (payout > 0) {
      require(token.transfer(msg.sender, net), "PAYOUT_FAIL");
      if (fee > 0) require(token.transfer(treasury, fee), "FEE_FAIL");
    }

    emit GamePlayed(msg.sender, gameId, wager, payout, data);
  }

  // Optional: allow owner to withdraw stuck funds
  function sweep(address to, uint256 amount) external onlyOwner {
    require(token.transfer(to, amount), "SWEEP_FAIL");
  }
}
