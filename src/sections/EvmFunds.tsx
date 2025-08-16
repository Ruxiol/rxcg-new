import React from 'react'
import { Modal } from '../components/Modal'
import { useEvm } from '../evm/EvmProvider'
import { getHouseContract, ensureAllowance, getHouseAddress, ERC20_ABI } from '../evm/house'
import { Contract } from 'ethers'
import { formatUnits, parseUnits } from '../components/evm/format'

export default function EvmFunds(props: { onClose: () => void }) {
  const { address, provider } = useEvm()
  const [loading, setLoading] = React.useState(false)
  const [balance, setBalance] = React.useState<bigint>(0n)
  const [amountIn, setAmountIn] = React.useState('')
  const [amountOut, setAmountOut] = React.useState('')
  const tokenDecimals = Number(import.meta.env.VITE_BEP20_TOKEN_DECIMALS ?? 18)
  const houseAddress = getHouseAddress()
  const tokenAddress = import.meta.env.VITE_BEP20_TOKEN_ADDRESS as string | undefined

  const refresh = React.useCallback(async () => {
    try {
      if (!address || !provider || !houseAddress) return
      const signer = await provider.getSigner()
      const house = getHouseContract(houseAddress, signer)
      const bal: bigint = await house.balances(address)
      setBalance(bal)
    } catch {}
  }, [address, provider, houseAddress])

  React.useEffect(() => { refresh() }, [refresh])

  const deposit = async () => {
    try {
      if (!address || !provider || !houseAddress || !tokenAddress) throw new Error('Missing config')
      const amt = parseUnits(amountIn || '0', tokenDecimals)
      if (amt <= 0n) throw new Error('Enter amount')
      setLoading(true)
      const signer = await provider.getSigner()
      // Ensure on correct chain (optional)
      try { await (await provider).send('eth_chainId', []) } catch {}
      // Check wallet token balance
      try {
        const erc20 = new Contract(tokenAddress, ERC20_ABI, signer)
        const bal: bigint = await erc20.balanceOf(address)
        if (bal < amt) throw new Error('Insufficient token balance for deposit')
      } catch {}
  await ensureAllowance(tokenAddress, address, houseAddress, amt, signer)
      const house = getHouseContract(houseAddress, signer)
      // Estimate gas and add a buffer to avoid RPC generic errors
      let gasLimit
      try { const est: bigint = await (house as any).deposit.estimateGas(amt); gasLimit = (est * 120n) / 100n } catch {}
      const tx = await (house as any).deposit(amt, gasLimit ? { gasLimit } : {})
      await tx.wait(2)
      setAmountIn('')
  await refresh()
  try { window.dispatchEvent(new CustomEvent('house-balance-updated')) } catch {}
    } catch (e: any) {
      const msg = e?.reason || e?.data?.message || e?.message || 'Deposit failed'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  const withdraw = async (all = false) => {
    try {
      if (!address || !provider || !houseAddress) throw new Error('Missing config')
      setLoading(true)
      const signer = await provider.getSigner()
      const house = getHouseContract(houseAddress, signer)
  if (all) {
        let gasLimit
        try { const est: bigint = await (house as any).withdrawAll.estimateGas(); gasLimit = (est * 120n) / 100n } catch {}
        const tx = await (house as any).withdrawAll(gasLimit ? { gasLimit } : {})
        await tx.wait(2)
      } else {
        const amt = parseUnits(amountOut || '0', tokenDecimals)
        if (amt <= 0n) throw new Error('Enter amount')
        let gasLimit
        try { const est: bigint = await (house as any).withdraw.estimateGas(amt); gasLimit = (est * 120n) / 100n } catch {}
        const tx = await (house as any).withdraw(amt, gasLimit ? { gasLimit } : {})
        await tx.wait(2)
      }
  setAmountOut('')
  await refresh()
  try { window.dispatchEvent(new CustomEvent('house-balance-updated')) } catch {}
    } catch (e: any) {
      const msg = e?.reason || e?.data?.message || e?.message || 'Withdraw failed'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal onClose={props.onClose}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        Funds
        {loading && (
          <span
            aria-label="loading"
            style={{
              width: 12,
              height: 12,
              border: '2px solid #ffffff22',
              borderTopColor: '#fff',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'spin 0.8s linear infinite'
            }}
          />
        )}
      </h2>
      <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
      <div style={{ marginBottom: 8 }}>On-contract: {formatUnits(balance, tokenDecimals)}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          placeholder="Add funds"
          value={amountIn}
          onChange={(e) => setAmountIn(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333' }}
        />
        <button disabled={loading} onClick={deposit} style={{ padding: '8px 12px', borderRadius: 6 }}>Deposit</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          placeholder="Withdraw amount"
          value={amountOut}
          onChange={(e) => setAmountOut(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333' }}
        />
        <button disabled={loading} onClick={() => withdraw(false)} style={{ padding: '8px 12px', borderRadius: 6 }}>Withdraw</button>
        <button disabled={loading} onClick={() => withdraw(true)} style={{ padding: '8px 12px', borderRadius: 6 }}>Withdraw All</button>
      </div>
    </Modal>
  )
}
