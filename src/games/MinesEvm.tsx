import React from 'react'
import { GambaUi } from 'gamba-react-ui-v2'
import { SOUND_EXPLODE, SOUND_FINISH, SOUND_STEP, SOUND_TICK, SOUND_WIN, GRID_SIZE, MINE_SELECT, PITCH_INCREASE_FACTOR } from './Mines/constants'
import { useSound } from 'gamba-react-ui-v2'
import { CellButton, Container, Container2, Grid, Level, Levels, StatusBar } from './Mines/styles'
import { generateGrid, revealAllMines, revealGold } from './Mines/utils'
import { useEvm } from '../evm/EvmProvider'
import { formatUnits, parseUnits } from '../components/evm/format'
import { getHouseContract, ensureAllowance, HOUSE_ABI, ERC20_ABI } from '../evm/house'
import { Interface, toUtf8Bytes, Contract } from 'ethers'

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
    let previousBalance = initialWager
    let cumProfit = 0n

    return Array.from({ length: totalLevels }).map((_, level) => {
      const wager = level === 0 ? previousBalance : previousBalance
      const multiplier = getMultiplierForLevel(level)
      const remainingCells = GRID_SIZE - level
      const bet = Array.from({ length: remainingCells }, (_, i) => i < mines ? 0 : multiplier)
      const profit = BigInt(Math.floor(Number(wager) * (multiplier - 1)))
      const balance = wager + profit
      previousBalance = balance
      cumProfit += profit
      return { wager, profit, cumProfit, bet, balance }
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
        // withdraw remaining internal balance
        const bal: bigint = await house.balances(address)
        if (bal > 0n) {
          const tx = await house.withdrawAll()
          await tx.wait()
        }
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
      if (!address || !provider) throw new Error('Connect wallet')
      const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string | undefined
      const tokenAddress = import.meta.env.VITE_BEP20_TOKEN_ADDRESS as string | undefined
      const wager = levels[currentLevel]?.wager ?? 0n
      if (!houseAddress || !tokenAddress) throw new Error('Missing HOUSE or TOKEN address')
      if (wager <= 0n) throw new Error('Invalid wager')

      const signer = await provider.getSigner()

      // Preflight checks: read balance via RPC to avoid wallet issues
      try {
        const erc20 = new Contract(tokenAddress, ERC20_ABI, rpc)
        const bal: bigint = await erc20.balanceOf(address)
        if (bal < wager) {
          throw new Error(`Insufficient RXCGT balance. Have ${formatUnits(bal, tokenDecimals)} need ${formatUnits(wager, tokenDecimals)}`)
        }
      } catch (err) {
        console.error('ERC20 balanceOf failed', err)
        throw new Error('Unable to read RXCGT balance on this network. Check token address and network.')
      }

  const house = getHouseContract(houseAddress, signer)
      const dataBytes = toUtf8Bytes(JSON.stringify({ game: 'mines', level: currentLevel, cellIndex, mines }))

      sounds.sounds.step.player.loop = true
      sounds.play('step', { })
      sounds.sounds.tick.player.loop = true
      sounds.play('tick', { })

      let receipt
      try {
        const tx = await house.play(1, wager, [], dataBytes)
        receipt = await tx.wait()
        // update internal balance
        const bal: bigint = await house.balances(address)
        setHouseBalance(bal)
      } catch (e: any) {
        console.error('House.play failed', e)
        throw new Error(e?.shortMessage || e?.reason || 'House.play reverted')
      }

      const iface = new Interface(HOUSE_ABI)
      let payout: bigint = 0n
      for (const log of receipt.logs) {
        if (log.address?.toLowerCase?.() !== houseAddress.toLowerCase()) continue
        try {
          const parsed = iface.parseLog(log)
          if (parsed?.name === 'GamePlayed') {
            payout = BigInt(parsed.args[3].toString())
            break
          }
        } catch {}
      }

      sounds.sounds.tick.player.stop()

      if (payout === 0n) {
        setStarted(false)
        setGrid(revealAllMines(grid, cellIndex, mines))
        sounds.play('explode')
        return
      }

      const nextLevel = currentLevel + 1
      setLevel(nextLevel)
      const profit = payout - wager
      setGrid(revealGold(grid, cellIndex, Number(profit)))
      setTotalGain(payout)

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
