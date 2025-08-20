import React from 'react'
import { useSound } from 'gamba-react-ui-v2'
import CustomSlider from './Slider'
import CRASH_SOUND from './crash.mp3'
import SOUND from './music.mp3'
import WIN_SOUND from './win.mp3'
import { LineLayer1, LineLayer2, LineLayer3, MultiplierText, Rocket, ScreenWrapper, StarsLayer1, StarsLayer2, StarsLayer3 } from './styles'
import { useEvm } from '../../evm/EvmProvider'
import { formatUnits, parseUnits } from '../../components/evm/format'
import { getHouseAddress, getHouseContract } from '../../evm/house'
import { AbiCoder, hexlify, keccak256, toUtf8Bytes } from 'ethers'
import EvmFunds from '../../sections/EvmFunds'
import { Modal } from '../../components/Modal'

export default function CrashGame() {
  const sound = useSound({ music: SOUND, crash: CRASH_SOUND, win: WIN_SOUND })
  const { address, provider, rpc } = useEvm()
  const [multiplierTarget, setMultiplierTarget] = React.useState(1.5)
  const [currentMultiplier, setCurrentMultiplier] = React.useState(0)
  const [rocketState, setRocketState] = React.useState<'idle' | 'win' | 'crash'>('idle')

  const [initialWagerInput, setInitialWagerInput] = React.useState('0.01')
  const tokenDecimals = Number(import.meta.env.VITE_BEP20_TOKEN_DECIMALS ?? 18)
  const initialWager = React.useMemo(() => parseUnits(initialWagerInput, tokenDecimals), [initialWagerInput, tokenDecimals])

  const [houseBalance, setHouseBalance] = React.useState<bigint>(0n)
  const [pendingSpent, setPendingSpent] = React.useState<bigint>(0n)
  const [edgeBps, setEdgeBps] = React.useState<number>(0)
  const [feeBps, setFeeBps] = React.useState<number>(0)
  const [loading, setLoading] = React.useState(false)
  const [started, setStarted] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [showFunds, setShowFunds] = React.useState(false)
  const [seed, setSeed] = React.useState<string>('0x')
  const [userCommit, setUserCommit] = React.useState<string>('0x')

  const availableBalance = React.useMemo(() => houseBalance - pendingSpent, [houseBalance, pendingSpent])

  const projectedPayout = React.useMemo(() => {
    const winsTarget = Math.max(0, Math.floor(multiplierTarget - 1 + 1e-9))
    if (winsTarget <= 0) return 0n
    const gross = initialWager * BigInt(1 + winsTarget)
    const afterEdge = (gross * BigInt(10000 - edgeBps)) / 10000n
    const fee = (afterEdge * BigInt(feeBps)) / 10000n
    return afterEdge - fee
  }, [multiplierTarget, initialWager, edgeBps, feeBps])

  const refreshBalance = React.useCallback(async () => {
    try {
      const houseAddr = getHouseAddress()
      if (!address || !houseAddr) return
      if (rpc) {
        const house = getHouseContract(houseAddr, rpc)
        const bal: bigint = await (house as any).balances(address)
        setHouseBalance(bal)
        return
      }
      if (provider) {
        const signer = await provider.getSigner()
        const house = getHouseContract(houseAddr, signer)
        const bal: bigint = await (house as any).balances(address)
        setHouseBalance(bal)
      }
    } catch {}
  }, [address, provider, rpc])

  React.useEffect(() => {
    refreshBalance()
    const id = setInterval(refreshBalance, 12000)
    return () => clearInterval(id)
  }, [refreshBalance])

  React.useEffect(() => {
    const run = async () => {
      try {
        const addr = getHouseAddress()
        if (!addr) return
        if (rpc) {
          const house = getHouseContract(addr, rpc)
          const e = await (house as any).houseEdgeBps()
          const f = await (house as any).feeBps()
          setEdgeBps(Number(e)); setFeeBps(Number(f))
          return
        }
        if (provider) {
          const signer = await provider.getSigner()
          const house = getHouseContract(addr, signer)
          const e = await (house as any).houseEdgeBps()
          const f = await (house as any).feeBps()
          setEdgeBps(Number(e)); setFeeBps(Number(f))
        }
      } catch {}
    }
    run()
  }, [provider, rpc])

  const getRocketStyle = () => {
    const maxMultiplier = 1
    const progress = Math.min(currentMultiplier / maxMultiplier, 1)

    const leftOffset = 20
    const bottomOffset = 30
    const left = progress * (100 - leftOffset)
    const bottom = Math.pow(progress, 5) * (100 - bottomOffset)
    const rotationProgress = Math.pow(progress, 2.3)
    const startRotationDeg = 90
    const rotation = (1 - rotationProgress) * startRotationDeg

    return {
      bottom: `${bottom}%`,
      left: `${left}%`,
      transform: `rotate(${rotation}deg)`,
    }
  }

  const doTheIntervalThing = (
    currentMultiplier: number,
    targetMultiplier: number,
    win: boolean,
  ) => {
    const nextIncrement = 0.01 * (Math.floor(currentMultiplier) + 1)
    const nextValue = currentMultiplier + nextIncrement

    setCurrentMultiplier(nextValue)

    if (nextValue >= targetMultiplier) {
      sound.sounds.music.player.stop()
      sound.play(win ? 'win' : 'crash')
      setRocketState(win ? 'win' : 'crash')
      setCurrentMultiplier(targetMultiplier)
      return
    }

    setTimeout(() => doTheIntervalThing(nextValue, targetMultiplier, win), 50)
  }

  const multiplierColor = (
    () => {
      if (rocketState === 'crash') return '#ff0000'
      if (rocketState === 'win') return '#00ff00'
      return '#ffffff'
    }
  )()

  //Kinda realistic losing number chooser
  const calculateBiasedLowMultiplier = (targetMultiplier: number) => {
    const randomValue = Math.random()
    const maxPossibleMultiplier = Math.min(targetMultiplier, 12)
    const exponent = randomValue > 0.95 ? 2.8 : (targetMultiplier > 10 ? 5 : 6)
    const result = 1 + Math.pow(randomValue, exponent) * (maxPossibleMultiplier - 1)
    return parseFloat(result.toFixed(2))
  }

  const start = async () => {
    setRocketState('idle')
    setCurrentMultiplier(0)
    setStarted(false)
    setConfirmed(false)
    setPendingSpent(0n)
    // generate candidate seed
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes)
    const seedCandidate = ('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`
    try {
      if (!address || !provider) throw new Error('Connect wallet')
      await refreshBalance()
      if (houseBalance < initialWager) {
        setShowFunds(true); return
      }
      const signer = await provider.getSigner()
      const houseAddr = getHouseAddress()
      const house = getHouseContract(houseAddr, signer)
      // Preflight commit present
      try {
        const active = await (house as any).currentHouseCommit()
        if (!active || active === '0x' || /^0x0+$/.test(String(active))) {
          alert('House commit not set yet. Ask admin to set it in Admin panel.');
          throw new Error('NO_HOUSE_COMMIT')
        }
        try { const k = `crash-session-house-commit:${address.toLowerCase()}`; localStorage.setItem(k, String(active)) } catch {}
      } catch {}
      const commitHash = keccak256(seedCandidate as any)
      try {
        const tx = await (house as any).userCommit(commitHash)
        await tx.wait(1)
        try { const k = `crash-commit-seed:${address.toLowerCase()}`; localStorage.setItem(k, seedCandidate) } catch {}
        setSeed(seedCandidate); setUserCommit(commitHash)
        setStarted(true); setConfirmed(true)
      } catch (e: any) {
        const msg = String(e?.reason || e?.message || '')
        if (msg.includes('ACTIVE_SESSION')) {
          const k = `crash-commit-seed:${address.toLowerCase()}`
          const saved = localStorage.getItem(k)
          if (saved) { setSeed(saved); setUserCommit(keccak256(saved as any)); setStarted(true); setConfirmed(true) }
          else { alert('Active session but seed missing. Ask admin to clear your session or paste seed.'); }
        } else { throw e }
      }
    } catch (e: any) {
      console.warn('start crash error', e)
    }
  }

  const settle = async (winsTarget: number) => {
    try {
      if (!address || !provider) throw new Error('Connect wallet')
      const signer = await provider.getSigner()
      const houseAddr = getHouseAddress()
      const house = getHouseContract(houseAddr, signer)

      // Build houseSeed from env and preflight against captured commit
      const envSeed: string | undefined = (import.meta as any).env?.VITE_HOUSE_SEED
      const houseSeedHex = envSeed && envSeed.startsWith('0x') ? envSeed as `0x${string}` : hexlify(toUtf8Bytes(envSeed || 'house-seed'))
      try {
        const commitKey = `crash-session-house-commit:${address.toLowerCase()}`
        const captured = localStorage.getItem(commitKey)
        if (captured && keccak256(houseSeedHex as any) !== captured) {
          alert('House commit mismatch: update VITE_HOUSE_SEED or rotate commit.');
          return
        }
      } catch {}

      const wagers = Array.from({ length: Math.max(1, winsTarget) }).map(() => initialWager)
      const tx = await (house as any).playBatchReveal(2, wagers, seed, houseSeedHex)
      await tx.wait(1)
      setPendingSpent(0n)
      refreshBalance()
    } catch (e) { console.warn('settle crash error', e) }
  }

  const play = async () => {
    if (!confirmed) { await start(); if (!confirmed) return }
    // Lock stake locally
    setPendingSpent(initialWager)
    setLoading(true)
    setRocketState('idle')

    // Determine local outcome using same RNG as contract
    const winsTarget = Math.max(0, Math.floor(multiplierTarget - 1 + 1e-9))
    let wins = 0
    try {
      const envSeed: string | undefined = (import.meta as any).env?.VITE_HOUSE_SEED
      const houseSeedHex = envSeed && envSeed.startsWith('0x') ? envSeed as `0x${string}` : hexlify(toUtf8Bytes(envSeed || 'house-seed'))
      const coder = AbiCoder.defaultAbiCoder()
      for (let i = 0; i < winsTarget; i++) {
        const encoded = coder.encode(['bytes','bytes','address','uint256'], [seed, houseSeedHex, address, i])
        const h = keccak256(encoded)
        const win = (BigInt(h) & 1n) === 0n
        if (!win) { wins = 0; break }
        wins += 1
      }
    } catch {}
    const win = wins === winsTarget && winsTarget > 0
    const multiplierResult = win ? Math.max(1, Math.floor(multiplierTarget * 100) / 100) : calculateBiasedLowMultiplier(multiplierTarget)

    sound.play('music')
    doTheIntervalThing(0, multiplierResult, win)
    setTimeout(() => {
      // Reveal and settle on-chain
      settle(winsTarget).finally(() => setLoading(false))
    }, Math.max(500, Math.min(6000, Math.ceil(multiplierResult * 800))))
  }

  return (
    <>
      <ScreenWrapper>
        <StarsLayer1 style={{ opacity: currentMultiplier > 3 ? 0 : 1 }} />
        <LineLayer1 style={{ opacity: currentMultiplier > 3 ? 1 : 0 }} />
        <StarsLayer2 style={{ opacity: currentMultiplier > 2 ? 0 : 1 }} />
        <LineLayer2 style={{ opacity: currentMultiplier > 2 ? 1 : 0 }} />
        <StarsLayer3 style={{ opacity: currentMultiplier > 1 ? 0 : 1 }} />
        <LineLayer3 style={{ opacity: currentMultiplier > 1 ? 1 : 0 }} />
        <MultiplierText color={multiplierColor}>
          {currentMultiplier.toFixed(2)}x
        </MultiplierText>
        <Rocket style={getRocketStyle()} />
      </ScreenWrapper>

      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, opacity: .8 }}>Stake</div>
            <input value={initialWagerInput} onChange={(e) => setInitialWagerInput(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333', width: 120 }} />
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 12, opacity: .8 }}>Target Multiplier</div>
            <CustomSlider value={multiplierTarget} onChange={setMultiplierTarget} />
          </div>
          <button disabled={loading} onClick={play} style={{ padding: '10px 16px', borderRadius: 8 }}>Play</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
          Available: {formatUnits(availableBalance, tokenDecimals)} | Locked: {formatUnits(pendingSpent, tokenDecimals)} | Projected: {formatUnits(projectedPayout, tokenDecimals)}
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: .6 }}>Note: fractional targets round down to nearest whole-step for payout.</div>
        <div style={{ marginTop: 8 }}>
          <button onClick={start} disabled={loading} style={{ padding: '6px 10px', borderRadius: 6, marginRight: 8 }}>Commit Session</button>
          <button onClick={() => setShowFunds(true)} style={{ padding: '6px 10px', borderRadius: 6 }}>Funds</button>
        </div>
      </div>

      {showFunds && (
        <Modal onClose={() => setShowFunds(false)}>
          <EvmFunds />
        </Modal>
      )}
    </>
  )
}
