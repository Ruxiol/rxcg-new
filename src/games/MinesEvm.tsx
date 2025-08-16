import React from 'react'
import { useSound } from 'gamba-react-ui-v2'
import { SOUND_EXPLODE, SOUND_FINISH, SOUND_STEP, SOUND_TICK, SOUND_WIN, GRID_SIZE, MINE_SELECT, PITCH_INCREASE_FACTOR } from './Mines/constants'
import { CellButton, Container, Container2, Grid, Level, Levels, StatusBar } from './Mines/styles'
import { generateGrid, revealAllMines, revealGold } from './Mines/utils'
import { useEvm } from '../evm/EvmProvider'
import { formatUnits, parseUnits } from '../components/evm/format'
import { getHouseContract, getHouseAddress } from '../evm/house'
import { solidityPackedKeccak256, keccak256, hexlify, toUtf8Bytes, AbiCoder } from 'ethers'
import EvmFunds from '../sections/EvmFunds'
import { Modal } from '../components/Modal'

// Simple local RNG for demo; in production use verifiable randomness or on-chain logic
function rng(seed: number) { return () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 } }

export default function MinesEvm() {
  const sounds = useSound({ tick: SOUND_TICK, win: SOUND_WIN, finish: SOUND_FINISH, step: SOUND_STEP, explode: SOUND_EXPLODE })
  const { address, provider, rpc } = useEvm()

  const [grid, setGrid] = React.useState(generateGrid(GRID_SIZE))
  const [currentLevel, setLevel] = React.useState(0)
  const [selected, setSelected] = React.useState(-1)
  const [totalGain, setTotalGain] = React.useState<bigint>(0n)
  const [loading, setLoading] = React.useState(false)
  const [started, setStarted] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [houseBalance, setHouseBalance] = React.useState<bigint>(0n)
  const [seed, setSeed] = React.useState<string>('0x')
  const [userCommit, setUserCommit] = React.useState<string>('0x')
  const [showFunds, setShowFunds] = React.useState(false)
  const movesRef = React.useRef<bigint[]>([])
  const [pendingSpent, setPendingSpent] = React.useState<bigint>(0n)
  const [busted, setBusted] = React.useState(false)
  const [edgeBps, setEdgeBps] = React.useState<number>(0)
  const [feeBps, setFeeBps] = React.useState<number>(0)
  const [showRecover, setShowRecover] = React.useState(false)
  const [recoverSeedInput, setRecoverSeedInput] = React.useState('')

  const [initialWagerInput, setInitialWagerInput] = React.useState('0.01')
  const tokenDecimals = Number(import.meta.env.VITE_BEP20_TOKEN_DECIMALS ?? 18)
  const [mines, setMines] = React.useState(MINE_SELECT[2])

  const rand = React.useMemo(() => rng(Date.now() % 100000), [])

  const getMultiplierForLevel = (level: number) => {
    const remainingCells = GRID_SIZE - level
    return remainingCells / (remainingCells - mines)
  }

  const initialWager = React.useMemo(() => parseUnits(initialWagerInput, tokenDecimals), [initialWagerInput, tokenDecimals])

  const levels = React.useMemo(() => {
    const totalLevels = GRID_SIZE - mines
    let cumProfit = 0n
    return Array.from({ length: totalLevels }).map((_, level) => {
      const wager = initialWager // constant per move
      const profit = initialWager // each successful pick yields +wager net (2x payout minus wager)
      cumProfit += profit
      return { wager, profit, cumProfit, bet: [], balance: 0n }
    })
  }, [initialWager, mines])

  const remainingCells = GRID_SIZE - currentLevel
  const gameFinished = remainingCells <= mines
  const canPlay = started && confirmed && !loading && !gameFinished && !busted
  const { wager, bet } = levels[currentLevel] ?? {}

  const availableBalance = React.useMemo(() => houseBalance - pendingSpent, [houseBalance, pendingSpent])

  const projectedPayout = React.useMemo(() => {
    if (busted || currentLevel <= 0) return 0n
    const base = levels[0]?.wager ?? 0n
    if (base <= 0n) return 0n
    const gross = base * BigInt(1 + currentLevel)
    const afterEdge = (gross * BigInt(10000 - edgeBps)) / 10000n
    const fee = (afterEdge * BigInt(feeBps)) / 10000n
    const net = afterEdge - fee
    return net
  }, [busted, currentLevel, levels, edgeBps, feeBps])

  const refreshBalance = React.useCallback(async () => {
    try {
      const houseAddress = getHouseAddress()
      if (!address || !houseAddress) return
      if (rpc) {
        const house = getHouseContract(houseAddress, rpc)
        const bal: bigint = await (house as any).balances(address)
        setHouseBalance(bal)
        return
      }
      if (provider) {
        const signer = await provider.getSigner()
        const house = getHouseContract(houseAddress, signer)
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

  // Fetch house edge/fee for accurate projections
  React.useEffect(() => {
    const run = async () => {
      try {
        const addr = getHouseAddress()
        if (!addr) return
        if (rpc) {
          const house = getHouseContract(addr, rpc)
          const e = await (house as any).houseEdgeBps()
          const f = await (house as any).feeBps()
          setEdgeBps(Number(e))
          setFeeBps(Number(f))
          return
        }
        if (provider) {
          const signer = await provider.getSigner()
          const house = getHouseContract(addr, signer)
          const e = await (house as any).houseEdgeBps()
          const f = await (house as any).feeBps()
          setEdgeBps(Number(e))
          setFeeBps(Number(f))
        }
      } catch {}
    }
    run()
  }, [provider, rpc])

  // Refresh balance immediately when Funds modal performs a deposit/withdraw
  React.useEffect(() => {
    const handler = () => refreshBalance()
    window.addEventListener('house-balance-updated', handler as any)
    return () => window.removeEventListener('house-balance-updated', handler as any)
  }, [refreshBalance])

  const start = async () => {
    setGrid(generateGrid(GRID_SIZE))
    setLoading(true)
    setLevel(0)
    setTotalGain(0n)
    movesRef.current = []
    setPendingSpent(0n)
    setBusted(false)
    // generate a candidate user seed, but only persist it after successful commit
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const seedCandidate = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    try {
      if (!address || !provider) throw new Error('Connect wallet')
      // Require pre-funded on-contract balance
      await refreshBalance()
      if (houseBalance < initialWager) {
        setShowFunds(true)
        setStarted(false)
        setConfirmed(false)
      } else {
        // Commit user seed to contract (binds to current house commit)
        const signer = await provider.getSigner()
        const houseAddress = getHouseAddress()
        const house = getHouseContract(houseAddress, signer)
        // Try to preflight-check currentHouseCommit; if it fails, we'll rely on userCommit revert handling
        try {
          const active = await (house as any).currentHouseCommit()
          if (!active || active === '0x' || /^0x0+$/.test(String(active))) {
            alert('House commit not set yet. Ask admin to set a commit in Admin panel.')
            throw new Error('NO_HOUSE_COMMIT')
          }
          // Save active commit for this session so reveal can verify against it
          try {
            const commitKey = address ? `mines-session-house-commit:${address.toLowerCase()}` : undefined
            if (commitKey) localStorage.setItem(commitKey, String(active))
          } catch {}
        } catch (e) {
          console.warn('currentHouseCommit check skipped due to read error; will try userCommit directly', e)
        }
        const commitHash = keccak256(seedCandidate as any)
  try {
          const tx = await (house as any).userCommit(commitHash)
          await tx.wait(1)
          // Persist committed seed per user so reveal matches even after reloads
          const key = address ? `mines-commit-seed:${address.toLowerCase()}` : undefined
          if (key) localStorage.setItem(key, seedCandidate)
          setSeed(seedCandidate)
          setUserCommit(commitHash)
        } catch (e: any) {
          const msg = String(e?.reason || e?.message || '')
          if (msg.includes('NO_HOUSE_COMMIT')) {
            alert('House commit is not set. Admin must set it in the Admin panel before playing.')
            setStarted(false)
            setConfirmed(false)
            return
          }
      if (msg.includes('ACTIVE_SESSION')) {
            // Reuse previously saved seed to continue the active session
            const key = address ? `mines-commit-seed:${address.toLowerCase()}` : undefined
            const saved = key ? localStorage.getItem(key) : null
            if (saved && saved.startsWith('0x')) {
              setSeed(saved)
              setStarted(true)
              setConfirmed(true)
              return
            } else {
        setShowRecover(true)
        return
            }
          }
          console.error('userCommit failed', e)
          throw e
        }
        setStarted(true)
        setConfirmed(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const endGame = async () => {
    try {
      const houseAddress = getHouseAddress()
      if (address && provider && houseAddress) {
        const signer = await provider.getSigner()
        const house = getHouseContract(houseAddress, signer)
        // Batch settle on-chain in one tx using the same seed and the per-click wagers
        const wagers = movesRef.current
        if (wagers.length > 0) {
          // Reveal with mixed seeds. Build house seed exactly like Admin did for commit.
          const envSeed: string | undefined = (import.meta as any).env?.VITE_HOUSE_SEED
          const houseSeedHex = envSeed
            ? (envSeed.startsWith('0x') ? envSeed : hexlify(toUtf8Bytes(envSeed)))
            : hexlify(toUtf8Bytes('house-seed'))
          // Preflight: keccak256(houseSeedHex) must equal captured commit
          try {
            const commitKey = address ? `mines-session-house-commit:${address.toLowerCase()}` : undefined
            const expected = commitKey ? localStorage.getItem(commitKey) : null
            const computed = keccak256(houseSeedHex as any)
            if (expected && expected.toLowerCase() !== computed.toLowerCase()) {
              alert('House commit mismatch: VITE_HOUSE_SEED does not match active commit (or commit rotated). Start a new round after syncing seed/commit.')
              return
            }
          } catch {}
          const tx1 = await (house as any).playBatchReveal(1, wagers, seed, houseSeedHex)
          await tx1.wait()
          // Clear persisted seed after successful settle
          const key = address ? `mines-commit-seed:${address.toLowerCase()}` : undefined
          if (key) localStorage.removeItem(key)
          const commitKey = address ? `mines-session-house-commit:${address.toLowerCase()}` : undefined
          if (commitKey) localStorage.removeItem(commitKey)
        }
        movesRef.current = []
        setSeed('0x')
        setPendingSpent(0n)
        setBusted(false)
        await refreshBalance()
      }
    } catch (e) {
      console.error('Withdraw failed', e)
    } finally {
      sounds.play('finish')
      reset()
    }
  }

  const reset = () => {
    setGrid(generateGrid(GRID_SIZE))
    setLoading(false)
    setLevel(0)
    setTotalGain(0n)
    setStarted(false)
  setConfirmed(false)
  setPendingSpent(0n)
  setBusted(false)
  }

  const play = async (cellIndex: number) => {
    setLoading(true)
    setSelected(cellIndex)
    try {
      if (!address) throw new Error('Connect wallet')
      const tokenAddress = import.meta.env.VITE_BEP20_TOKEN_ADDRESS as string | undefined
      const wager = levels[currentLevel]?.wager ?? 0n
      if (!tokenAddress) throw new Error('Missing TOKEN address')
      if (wager <= 0n) throw new Error('Invalid wager')

  // No per-click wallet balance checks; funds are already deposited to the House

      sounds.sounds.step.player.loop = true
      sounds.play('step', { })
      sounds.sounds.tick.player.loop = true
      sounds.play('tick', { })
      // Local outcome must match contract: hash(userSeed, houseSeed, player, moveIndex)
      const moveIndex = movesRef.current.length
      const envSeed: string | undefined = (import.meta as any).env?.VITE_HOUSE_SEED
      const houseSeedHex = envSeed
        ? (envSeed.startsWith('0x') ? envSeed : hexlify(toUtf8Bytes(envSeed)))
        : hexlify(toUtf8Bytes('house-seed'))
  // Contract uses keccak256(abi.encode(...)), so mirror that with AbiCoder
  const coder = AbiCoder.defaultAbiCoder()
  const encoded = coder.encode(['bytes', 'bytes', 'address', 'uint256'], [seed, houseSeedHex, address, moveIndex])
  const hash = keccak256(encoded)
      const win = BigInt(hash) % 2n === 0n
  movesRef.current.push(initialWager)
  setPendingSpent((s) => s + initialWager)

      sounds.sounds.tick.player.stop()

      if (!win) {
        setBusted(true)
        setGrid(revealAllMines(grid, cellIndex, mines))
        sounds.play('explode')
        return
      }

      const nextLevel = currentLevel + 1
      setLevel(nextLevel)
      const profit = wager // since 2x payout - wager = +wager
      setGrid(revealGold(grid, cellIndex, Number(profit)))
      setTotalGain((total) => total + (wager * 2n))

      if (nextLevel < GRID_SIZE - mines) {
        sounds.play('win', { playbackRate: Math.pow(PITCH_INCREASE_FACTOR, currentLevel) })
      } else {
        sounds.play('win', { playbackRate: .9 })
        sounds.play('finish')
      }
    } finally {
      setLoading(false)
      setSelected(-1)
  sounds.sounds.tick.player.stop()
  sounds.sounds.step.player.stop()
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Container2>
        {showRecover && (
          <Modal onClose={() => setShowRecover(false)}>
            <h3>Recover session</h3>
            <p style={{ fontSize: 12, opacity: .8 }}>A round is already active for this account. Paste the user seed (0x…32 bytes) used when you clicked Start.</p>
            <input
              placeholder="0x..."
              value={recoverSeedInput}
              onChange={(e) => setRecoverSeedInput(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333', marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  const s = recoverSeedInput.trim()
                  if (!s.startsWith('0x') || s.length < 4) return
                  setSeed(s)
                  setStarted(true)
                  setConfirmed(true)
                  setShowRecover(false)
                }}
                style={{ padding: '8px 12px', borderRadius: 6 }}
              >Use seed</button>
              <button onClick={() => setShowRecover(false)} style={{ padding: '8px 12px', borderRadius: 6 }}>Cancel</button>
            </div>
          </Modal>
        )}
        <Levels>
          {levels.map(({ cumProfit }, i) => (
            <Level key={i} $active={currentLevel === i}>
              <div>LEVEL {i + 1}</div>
              <div>{formatUnits(cumProfit, tokenDecimals)}</div>
            </Level>
          ))}
        </Levels>
        <StatusBar>
          <div>
            <span> Mines: {mines} </span>
            <span style={{ marginLeft: 10 }}>Available: {formatUnits(availableBalance, tokenDecimals)}</span>
            <span style={{ marginLeft: 10, opacity: .8 }}>Locked: {formatUnits(pendingSpent, tokenDecimals)}</span>
            {!busted && currentLevel > 0 && (
              <span style={{ marginLeft: 10, color: '#9ad68a' }}>Projected: {formatUnits(projectedPayout, tokenDecimals)}</span>
            )}
          </div>
        </StatusBar>
        <Container>
          <Grid>
            {grid.map((cell, index) => (
              <CellButton
                key={index}
                $status={cell.status}
                $selected={selected === index}
                onClick={() => play(index)}
                disabled={!canPlay || cell.status !== 'hidden'}
              >
                {(cell.status === 'gold') && (
                  <div>+{formatUnits(BigInt(cell.profit), tokenDecimals)}</div>
                )}
              </CellButton>
            ))}
          </Grid>
        </Container>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          {!started ? (
            <>
              <input
                value={initialWagerInput}
                onChange={(e) => setInitialWagerInput(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333' }}
              />
              <select
                value={mines}
                onChange={(e) => setMines(Number(e.target.value))}
                style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333' }}
              >
                {MINE_SELECT.map((m) => (
                  <option key={m} value={m}>{m} Mines</option>
                ))}
              </select>
              <button onClick={start} style={{ padding: '8px 12px', borderRadius: 6 }}>Start</button>
              <button onClick={() => setShowFunds(true)} style={{ padding: '8px 12px', borderRadius: 6 }}>Add funds</button>
            </>
          ) : (
            <button onClick={endGame} style={{ padding: '8px 12px', borderRadius: 6 }}>{movesRef.current.length > 0 ? 'Settle' : 'End'}</button>
          )}
        </div>
      {showFunds && (
        <EvmFunds onClose={() => { setShowFunds(false); refreshBalance() }} />
      )}
      </Container2>
    </div>
  )
}
