import React from 'react'
import { useSound } from 'gamba-react-ui-v2'
import { SOUND_EXPLODE, SOUND_FINISH, SOUND_STEP, SOUND_TICK, SOUND_WIN, GRID_SIZE, MINE_SELECT, PITCH_INCREASE_FACTOR } from './Mines/constants'
import { CellButton, Container, Container2, Grid, Level, Levels, StatusBar } from './Mines/styles'
import { generateGrid, revealAllMines, revealGold } from './Mines/utils'
import { useEvm } from '../evm/EvmProvider'
import { formatUnits, parseUnits } from '../components/evm/format'
import { getHouseContract } from '../evm/house'
import { solidityPackedKeccak256 } from 'ethers'
import EvmFunds from '../sections/EvmFunds'

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

  const refreshBalance = React.useCallback(async () => {
    try {
      const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string | undefined
      if (address && provider && houseAddress) {
        const signer = await provider.getSigner()
        const house = getHouseContract(houseAddress, signer)
        const bal: bigint = await house.balances(address)
        setHouseBalance(bal)
      }
    } catch {}
  }, [address, provider])

  React.useEffect(() => {
    refreshBalance()
    const id = setInterval(refreshBalance, 12000)
    return () => clearInterval(id)
  }, [refreshBalance])

  const start = async () => {
    setGrid(generateGrid(GRID_SIZE))
    setLoading(true)
    setLevel(0)
    setTotalGain(0n)
    movesRef.current = []
  setPendingSpent(0n)
  setBusted(false)
  // new random 32-byte seed for this session
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hex = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  setSeed(hex)
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
        const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string
        const house = getHouseContract(houseAddress, signer)
        const commitHash = (window as any).ethers?.utils?.keccak256
          ? (window as any).ethers.utils.keccak256(seed)
          : (await import('ethers')).keccak256(seed as any)
        setUserCommit(commitHash)
        try {
          const tx = await (house as any).userCommit(commitHash)
          await tx.wait(1)
        } catch (e) {
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
      const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string | undefined
      if (address && provider && houseAddress) {
        const signer = await provider.getSigner()
        const house = getHouseContract(houseAddress, signer)
        // Batch settle on-chain in one tx using the same seed and the per-click wagers
        const wagers = movesRef.current
        if (wagers.length > 0) {
          // Reveal with mixed seeds
          const houseSeedHex = (import.meta as any).env?.VITE_HOUSE_SEED || '0x686f7573652d7365656400000000000000000000000000000000000000000000'
          const tx1 = await (house as any).playBatchReveal(1, wagers, seed, houseSeedHex)
          await tx1.wait()
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
      // Local outcome using same rule as contract batch: win if keccak(seed, player, moveIndex) % 2 == 0
  const moveIndex = movesRef.current.length
      const hash = solidityPackedKeccak256(['bytes', 'address', 'uint256'], [seed, address, moveIndex])
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
            {houseBalance >= 0 && (
              <span style={{ marginLeft: 10 }}>In-house: {formatUnits(houseBalance - pendingSpent, tokenDecimals)}</span>
            )}
            {totalGain > 0 && (
              <span>
                +{formatUnits(totalGain, tokenDecimals)}
              </span>
            )}
          </div>
        </StatusBar>
        <Container>
          <Grid>
            {grid.map((cell, index) => (
              <CellButton
                key={index}
                status={cell.status}
                selected={selected === index}
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
