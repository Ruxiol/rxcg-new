import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { BrowserProvider, Eip1193Provider, JsonRpcProvider, Contract, formatEther, parseUnits } from 'ethers'

export type EvmContextType = {
  chainId?: number
  address?: string
  isConnecting: boolean
  provider?: BrowserProvider
  rpc?: JsonRpcProvider
  connect: () => Promise<void>
  disconnect: () => void
}

const EvmContext = createContext<EvmContextType>({
  isConnecting: false,
  connect: async () => {},
  disconnect: () => {},
})

function getWindowEthereum(): Eip1193Provider | undefined {
  // @ts-ignore
  return typeof window !== 'undefined' ? (window.ethereum as Eip1193Provider | undefined) : undefined
}

export function EvmProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | undefined>(undefined)
  const [chainId, setChainId] = useState<number | undefined>(undefined)
  const [isConnecting, setIsConnecting] = useState(false)

  const evmChainId = Number(import.meta.env.VITE_EVM_CHAIN_ID ?? 97) // BSC testnet default
  const evmRpc = import.meta.env.VITE_EVM_RPC_HTTP ?? 'https://data-seed-prebsc-1-s1.binance.org:8545'

  const rpc = useMemo(() => new JsonRpcProvider(evmRpc, evmChainId), [evmRpc, evmChainId])

  const provider = useMemo(() => {
    const eth = getWindowEthereum()
    return eth ? new BrowserProvider(eth) : undefined
  }, [])

  useEffect(() => {
    const eth = getWindowEthereum()
    if (!eth) return

    const onAccountsChanged = (accounts: string[]) => {
      setAddress(accounts?.[0])
    }
    const onChainChanged = (hexChainId: string) => {
      try {
        const id = Number(hexChainId)
        setChainId(id)
      } catch {}
    }

    // @ts-ignore
    eth.on?.('accountsChanged', onAccountsChanged)
    // @ts-ignore
    eth.on?.('chainChanged', onChainChanged)

    return () => {
      // @ts-ignore
      eth.removeListener?.('accountsChanged', onAccountsChanged)
      // @ts-ignore
      eth.removeListener?.('chainChanged', onChainChanged)
    }
  }, [])

  const connect = async () => {
    const eth = getWindowEthereum()
    if (!eth) {
      window.open('https://metamask.io/download.html', '_blank')
      return
    }
    try {
      setIsConnecting(true)
      const accs = await eth.request?.({ method: 'eth_requestAccounts' }) as string[]
      const chainHex = await eth.request?.({ method: 'eth_chainId' }) as string
      setAddress(accs?.[0])
      setChainId(Number(chainHex))

      // Ensure correct network
      if (Number(chainHex) !== evmChainId) {
        try {
          await eth.request?.({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + evmChainId.toString(16) }],
          })
        } catch (switchErr: any) {
          // Try to add network then switch
          await eth.request?.({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: '0x' + evmChainId.toString(16),
              chainName: 'BSC Testnet',
              rpcUrls: [evmRpc],
              nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
              blockExplorerUrls: ['https://testnet.bscscan.com'],
            }],
          })
        }
      }
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnect = () => {
    setAddress(undefined)
  }

  const value: EvmContextType = {
    chainId,
    address,
    isConnecting,
    provider,
    rpc,
    connect,
    disconnect,
  }

  return (
    <EvmContext.Provider value={value}>
      {children}
    </EvmContext.Provider>
  )
}

export const useEvm = () => useContext(EvmContext)

// Minimal ERC-20 helper
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)'
]

export function useErc20Balance(tokenAddress?: string) {
  const { address, rpc } = useEvm()
  const [balance, setBalance] = useState<string>('0')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!address || !tokenAddress) { setBalance('0'); return }
      setLoading(true)
      try {
        const erc20 = new Contract(tokenAddress, ERC20_ABI, rpc)
        const raw = await erc20.balanceOf(address)
        setBalance(raw.toString())
      } catch {
        if (!cancelled) setBalance('0')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    const id = setInterval(run, 12_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [address, tokenAddress, rpc])
  return { balance, loading }
}
