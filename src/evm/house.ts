import { BrowserProvider, Contract, JsonRpcProvider, Signer } from 'ethers'

export const HOUSE_ABI = [
  'event GamePlayed(address indexed player, uint256 gameId, uint256 wager, uint256 payout, bytes data)',
  'function token() view returns (address)',
  'function feeBps() view returns (uint256)',
  'function setFeeBps(uint256 _feeBps)',
  'function play(uint256 gameId, uint256 wager, uint256[] bet, bytes data) returns (uint256 payout)',
  'function payout(address player, uint256 amount)'
]

export function getHouseContract(address: string, signerOrProvider: Signer | BrowserProvider | JsonRpcProvider) {
  return new Contract(address, HOUSE_ABI, signerOrProvider as any)
}

export const ERC20_ABI = [
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
  const tx = await erc20.approve(spender, amount)
  await tx.wait()
}
