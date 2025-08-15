import { BrowserProvider, Contract, JsonRpcProvider, Signer } from 'ethers'

export const HOUSE_ABI = [
  'event GamePlayed(address indexed player, uint256 indexed gameId, uint256 wager, uint256 payout, bytes data)',
  'function play(uint256 gameId, uint256 wager, uint256[] , bytes data) returns (uint256 payout)',
  'function setFeeBps(uint256 _feeBps)',
  'function setTreasury(address _treasury)',
  'function sweep(address to, uint256 amount)',
  'function transferOwnership(address _owner)',
  'function feeBps() view returns (uint256)',
  'function owner() view returns (address)',
  'function token() view returns (address)',
  'function treasury() view returns (address)'
]

export function getHouseContract(address: string, signerOrProvider: Signer | BrowserProvider | JsonRpcProvider) {
  return new Contract(address, HOUSE_ABI, signerOrProvider as any)
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
  const erc20 = new Contract(tokenAddress, ERC20_ABI, signer)
  const current: bigint = await erc20.allowance(owner, spender)
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
