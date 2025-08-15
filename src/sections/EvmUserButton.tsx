import React from 'react'
import { GambaUi } from 'gamba-react-ui-v2'
import { useEvm, useErc20Balance } from '../evm/EvmProvider'
import { truncateString } from '../utils'

export default function EvmUserButton() {
  const { address, connect, disconnect, isConnecting } = useEvm()
  const tokenAddress = import.meta.env.VITE_BEP20_TOKEN_ADDRESS as string | undefined
  const tokenDecimals = Number(import.meta.env.VITE_BEP20_TOKEN_DECIMALS ?? 18)
  const { balance } = useErc20Balance(tokenAddress)

  const formatted = React.useMemo(() => {
    try {
      if (!balance) return '0'
      // naive format using decimals
      const bn = BigInt(balance)
      const base = 10n ** BigInt(tokenDecimals)
      const int = (bn / base).toString()
      const frac = (bn % base).toString().padStart(tokenDecimals, '0').slice(0, 4)
      return `${int}.${frac}`
    } catch {
      return '0'
    }
  }, [balance, tokenDecimals])

  if (!address) {
    return (
      <GambaUi.Button onClick={connect}>
        {isConnecting ? 'Connecting…' : 'Connect MetaMask'}
      </GambaUi.Button>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {tokenAddress && (
        <div style={{ fontSize: '12px', opacity: .8 }}>Token balance: {formatted}</div>
      )}
      <GambaUi.Button onClick={disconnect}>
        {truncateString(address, 4)}
      </GambaUi.Button>
    </div>
  )
}
