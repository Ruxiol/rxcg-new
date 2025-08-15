// src/sections/Header.tsx
import { GambaUi, TokenValue } from 'gamba-react-ui-v2'
import React from 'react'
import { NavLink } from 'react-router-dom'
import styled from 'styled-components'
import { Modal } from '../components/Modal'
import LeaderboardsModal from '../sections/LeaderBoard/LeaderboardsModal'
import { PLATFORM_JACKPOT_FEE, PLATFORM_CREATOR_ADDRESS } from '../constants'
import { useMediaQuery } from '../hooks/useMediaQuery'
import TokenSelect from './TokenSelect'
// Removed Solana UserButton; using EVM connect only
import EvmUserButton from './EvmUserButton'
import EvmFunds from './EvmFunds'
import { ENABLE_LEADERBOARD } from '../constants'

const Bonus = styled.button`
  all: unset;
  cursor: pointer;
  color: #ffe42d;
  border-radius: 10px;
  padding: 2px 10px;
  font-size: 12px;
  text-transform: uppercase;
  font-weight: bold;
  transition: background-color 0.2s;
  &:hover {
    background: white;
  }
`

const StyledHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px;
  background: #000000cc;
  backdrop-filter: blur(20px);
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1000;
`

const Logo = styled(NavLink)`
  height: 35px;
  margin: 0 15px;
  & > img {
    height: 120%;
  }
`

export default function Header() {
  const evmEnabled = Boolean(import.meta.env.VITE_BEP20_TOKEN_ADDRESS)
  const isDesktop = useMediaQuery('lg') 
  const [showLeaderboard, setShowLeaderboard] = React.useState(false)
  const [bonusHelp, setBonusHelp] = React.useState(false)
  const [jackpotHelp, setJackpotHelp] = React.useState(false)
  const [showFunds, setShowFunds] = React.useState(false)

  return (
    <>
      {bonusHelp && (
        <Modal onClose={() => setBonusHelp(false)}>
          <h1>Bonus ✨</h1>
          <p>
            You have <b>bonus plays</b>{' '}
            worth of free plays. This bonus will be applied automatically when you
            play.
          </p>
          <p>Note that a fee is still needed from your wallet for each play.</p>
        </Modal>
      )}

  {!evmEnabled && jackpotHelp && (
        <Modal onClose={() => setJackpotHelp(false)}>
          <h1>Jackpot 💰</h1>
          <p style={{ fontWeight: 'bold' }}>
    There&apos;s <TokenValue amount={0} /> in the
            Jackpot.
          </p>
          <p>
            The Jackpot is a prize pool that grows with every bet made. As it
            grows, so does your chance of winning. Once a winner is selected,
            the pool resets and grows again from there.
          </p>
          <p>
            You pay a maximum of{' '}
            {(PLATFORM_JACKPOT_FEE * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}
            % of each wager for a chance to win.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {'ENABLED'}
            <GambaUi.Switch
              checked={true}
              onChange={() => {}}
            />
          </label>
        </Modal>
      )}

  {!evmEnabled && ENABLE_LEADERBOARD && showLeaderboard && (
        <LeaderboardsModal
          creator={PLATFORM_CREATOR_ADDRESS.toBase58()}
          onClose={() => setShowLeaderboard(false)}
        />
      )}

      <StyledHeader>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Logo to="/">
            <img alt="Gamba logo" src="/logo.svg" />
          </Logo>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'center',
            position: 'relative',
          }}
        >
      {!evmEnabled && (
            <Bonus onClick={() => setJackpotHelp(true)}>
        💰
            </Bonus>
          )}

      {!evmEnabled && (
            <Bonus onClick={() => setBonusHelp(true)}>
        ✨
            </Bonus>
          )}

          {/* Leaderboard shows only on desktop */}
          {!evmEnabled && isDesktop && (
            <button onClick={() => setShowLeaderboard(true)} style={{ padding: '6px 10px', borderRadius: 6 }}>
              Leaderboard
            </button>
          )}

          <TokenSelect />
          {evmEnabled && (
            <button onClick={() => setShowFunds(true)} style={{ padding: '6px 10px', borderRadius: 6 }}>
              Funds
            </button>
          )}
          <EvmUserButton />
        </div>
      </StyledHeader>
      {evmEnabled && showFunds && (
        <EvmFunds onClose={() => setShowFunds(false)} />
      )}
    </>
  )
}
