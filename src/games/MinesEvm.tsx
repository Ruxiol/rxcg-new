import React from 'react'
import { GambaUi } from 'gamba-react-ui-v2'
import { SOUND_EXPLODE, SOUND_FINISH, SOUND_STEP, SOUND_TICK, SOUND_WIN, GRID_SIZE, MINE_SELECT, PITCH_INCREASE_FACTOR } from './Mines/constants'
import { useSound } from 'gamba-react-ui-v2'
import { CellButton, Container, Container2, Grid, Level, Levels, StatusBar } from './Mines/styles'
import { generateGrid, revealAllMines, revealGold } from './Mines/utils'
import { useEvm } from '../evm/EvmProvider'
import { formatUnits, parseUnits } from '../components/evm/format'
import { getHouseContract, ensureAllowance, HOUSE_ABI, ERC20_ABI } from '../evm/house'
import { Interface, toUtf8Bytes, Contract, solidityPackedKeccak256 } from 'ethers'

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
  const [houseBalance, setHouseBalance] = React.useState<bigint>(0n)
  const [seed, setSeed] = React.useState<string>('0x')
  const movesRef = React.useRef<bigint[]>([])

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
  const canPlay = started && !loading && !gameFinished
  const { wager, bet } = levels[currentLevel] ?? {}

  const start = async () => {
    setGrid(generateGrid(GRID_SIZE))
    setLoading(true)
    setLevel(0)
    setTotalGain(0n)
    movesRef.current = []
    // new random 32-byte seed for this session
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const hex = '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    setSeed(hex)
    try {
      // Pre-approve allowance so MetaMask prompts on Start
      const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string | undefined
      const tokenAddress = import.meta.env.VITE_BEP20_TOKEN_ADDRESS as string | undefined
      if (!address || !provider) throw new Error('Connect wallet')
      if (!houseAddress || !tokenAddress) throw new Error('Missing HOUSE or TOKEN address')
  const signer = await provider.getSigner()
  await ensureAllowance(tokenAddress, address, houseAddress, initialWager, signer)
  const house = getHouseContract(houseAddress, signer)
  // deposit initial wager amount up-front
  const tx = await house.deposit(initialWager)
  await tx.wait()
  // read internal balance
  const bal: bigint = await house.balances(address)
  setHouseBalance(bal)
  setStarted(true)
    } catch (e: any) {
      console.error('Start pre-approve failed', e)
      alert(e?.message || 'Failed to prepare game')
      setStarted(false)
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
          const tx1 = await house.settleAndWithdraw(1, wagers, seed)
          await tx1.wait()
        } else {
          // If no moves, just withdraw leftovers
          const bal: bigint = await house.balances(address)
          if (bal > 0n) {
            const tx2 = await house.withdrawAll()
            await tx2.wait()
          }
        }
  // Immediately zero local in-house balance to avoid stale display
  setHouseBalance(0n)
  movesRef.current = []
  setSeed('0x')
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

      sounds.sounds.tick.player.stop()

      if (!win) {
        setStarted(false)
        setGrid(revealAllMines(grid, cellIndex, mines))
        // Optimistically reflect stake loss in UI (on-chain settle happens on Finish)
        setHouseBalance(0n)
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
    <>
      <GambaUi.Portal target="screen">
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
                <span style={{ marginLeft: 10 }}>In-house: {formatUnits(houseBalance, tokenDecimals)}</span>
              )}
              {totalGain > 0 && (
                <span>
                  +{formatUnits(totalGain, tokenDecimals)}
                </span>
              )}
            </div>
          </StatusBar>
          <GambaUi.Responsive>
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
          </GambaUi.Responsive>
        </Container2>
      </GambaUi.Portal>
      <GambaUi.Portal target="controls">
        {!started ? (
          <>
            <input
              value={initialWagerInput}
              onChange={(e) => setInitialWagerInput(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333' }}
            />
            <GambaUi.Select
              options={MINE_SELECT}
              value={mines}
              onChange={setMines}
              label={(mines) => (<>{mines} Mines</>)}
            />
            <GambaUi.PlayButton onClick={start}>Start</GambaUi.PlayButton>
          </>
        ) : (
          <GambaUi.Button onClick={endGame}>{totalGain > 0 ? 'Finish' : 'Reset'}</GambaUi.Button>
        )}
      </GambaUi.Portal>
    </>
  )
}
