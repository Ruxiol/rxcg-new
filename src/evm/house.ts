import { BrowserProvider, Contract, JsonRpcProvider, Signer } from 'ethers'

export const HOUSE_ABI = [
  'event GamePlayed(address indexed player, uint256 indexed gameId, uint256 wager, uint256 payout, bytes data)',
  'function play(uint256 gameId, uint256 wager, uint256[] , bytes data) returns (uint256 payout)',
  'function playBatch(uint256 gameId, uint256[] wagers, bytes seed) returns (uint256 totalPayout)',
  'function settleAndWithdraw(uint256 gameId, uint256[] wagers, bytes seed)',
  'function playBatchReveal(uint256 gameId, uint256[] wagers, bytes userSeed, bytes houseSeed) returns (uint256)',
  'function userCommit(bytes32 _userCommit)',
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
    'function currentHouseCommit() view returns (bytes32)',
  'function withdrawAll()',
  'function balances(address) view returns (uint256)',
  'function setFeeBps(uint256 _feeBps)',
  'function setHouseEdgeBps(uint256 _bps)',
  'function setTreasury(address _treasury)',
  'function setCurrentHouseCommit(bytes32 _commit)',
  'function sweep(address to, uint256 amount)',
  'function transferOwnership(address _owner)',
  'function feeBps() view returns (uint256)',
  'function houseEdgeBps() view returns (uint256)',
  'function owner() view returns (address)',
  'function token() view returns (address)',
  'function treasury() view returns (address)'
]

export function getHouseContract(address: string, signerOrProvider: Signer | BrowserProvider | JsonRpcProvider) {
  return new Contract(address, HOUSE_ABI, signerOrProvider as any)
}

// Central resolver for House address with fallback to provided new deployment
export function getHouseAddress(): string {
  const envAddr = (import.meta as any).env?.VITE_HOUSE_ADDRESS as string | undefined
  return envAddr && envAddr !== '' ? envAddr : '0x211b512689b45dcc4a109c45d6bb1e0ff8f0a877'
}

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

export async function ensureAllowance(
  tokenAddress: string,
  owner: string,
  spender: string,
  amount: bigint,
  signer: Signer,
) {
  // Read via signer first; if provider refuses, fallback to RPC provider
  let current: bigint = 0n
  try {
    const erc20Read = new Contract(tokenAddress, ERC20_ABI, await (signer as any).provider)
    current = await erc20Read.allowance(owner, spender)
  } catch {
    // try a default BSC testnet RPC if signer.provider fails
    const rpcUrl = (import.meta as any).env?.VITE_EVM_RPC_HTTP || 'https://data-seed-prebsc-1-s1.binance.org:8545'
    const chainId = Number((import.meta as any).env?.VITE_EVM_CHAIN_ID || 97)
    const rpc = new JsonRpcProvider(rpcUrl, chainId)
    const erc20Fallback = new Contract(tokenAddress, ERC20_ABI, rpc)
    current = await erc20Fallback.allowance(owner, spender)
  }
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer)
  if (current >= amount) return
  const max = (1n << 256n) - 1n
  try {
    const tx = await erc20.approve(spender, max)
    await tx.wait()
    return
  } catch {
    // Some tokens (e.g., USDT) require resetting allowance to 0 first
    try {
      const tx0 = await erc20.approve(spender, 0)
      await tx0.wait()
      const tx1 = await erc20.approve(spender, max)
      await tx1.wait()
      return
    } catch (e) {
      throw e
    }
  }
}
