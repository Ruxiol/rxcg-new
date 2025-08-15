import React from 'react'
import { Modal } from '../components/Modal'
import { useEvm } from '../evm/EvmProvider'
import { getHouseContract } from '../evm/house'
import { keccak256, toUtf8Bytes, isHexString, hexlify } from 'ethers'

export default function AdminPanel(props: { onClose: () => void }) {
  const { address, provider, rpc } = useEvm()
  const houseAddress = import.meta.env.VITE_HOUSE_ADDRESS as string | undefined
  const [loading, setLoading] = React.useState(false)
  const [owner, setOwner] = React.useState<string>('')
  const [feeBps, setFeeBps] = React.useState<number>(0)
  const [edgeBps, setEdgeBps] = React.useState<number>(0)
  const [currentCommit, setCurrentCommit] = React.useState<string>('0x')
  const [seedInput, setSeedInput] = React.useState('')
  const [commitPreview, setCommitPreview] = React.useState<string>('0x')

  const refresh = React.useCallback(async () => {
    if (!rpc || !houseAddress) return
    try {
      const house = getHouseContract(houseAddress, rpc)
      const o = await (house as any).owner()
      const f = await (house as any).feeBps()
      const e = await (house as any).houseEdgeBps()
      const c = await (house as any).currentHouseCommit()
      setOwner(String(o))
      setFeeBps(Number(f))
      setEdgeBps(Number(e))
      setCurrentCommit(String(c))
    } catch {}
  }, [rpc, houseAddress])

  React.useEffect(() => { refresh() }, [refresh])

  React.useEffect(() => {
    try {
      if (!seedInput) { setCommitPreview('0x'); return }
      let bytes: Uint8Array
      if (seedInput.startsWith('0x') && isHexString(seedInput)) {
        // Hash the provided hex bytes directly
        const clean = seedInput as `0x${string}`
        setCommitPreview(keccak256(clean))
      } else {
        bytes = toUtf8Bytes(seedInput)
        setCommitPreview(keccak256(bytes))
      }
    } catch {
      setCommitPreview('0x')
    }
  }, [seedInput])

  const setHouseEdge = async () => {
    if (!provider || !houseAddress) return
    setLoading(true)
    try {
      const signer = await provider.getSigner()
      const house = getHouseContract(houseAddress, signer)
      const tx = await (house as any).setHouseEdgeBps(edgeBps)
      await tx.wait(1)
      await refresh()
    } catch (e: any) {
      alert(e?.message || 'Failed to set house edge')
    } finally { setLoading(false) }
  }

  const setCommit = async () => {
    if (!provider || !houseAddress) return
    if (!commitPreview || commitPreview === '0x') { alert('Enter a seed to compute commit'); return }
    setLoading(true)
    try {
      const signer = await provider.getSigner()
      const house = getHouseContract(houseAddress, signer)
      const tx = await (house as any).setCurrentHouseCommit(commitPreview)
      await tx.wait(1)
      await refresh()
    } catch (e: any) {
      alert(e?.message || 'Failed to set commit')
    } finally { setLoading(false) }
  }

  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase()

  return (
    <Modal onClose={props.onClose}>
      <h2>Admin</h2>
      {!isOwner && (
        <div style={{ color: '#ff8080', marginBottom: 8 }}>Connected wallet is not the owner.</div>
      )}
      <div style={{ fontSize: 12, opacity: .8, marginBottom: 12 }}>
        <div>Owner: {owner || '-'}</div>
        <div>feeBps: {feeBps}</div>
        <div>houseEdgeBps (RTP): {edgeBps} ({((10000 - edgeBps)/100).toFixed(2)}%)</div>
        <div>currentHouseCommit: {currentCommit}</div>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 12, marginTop: 12 }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>RTP (House Edge)</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            value={edgeBps}
            onChange={(e) => setEdgeBps(Number(e.target.value))}
            style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333', width: 120 }}
          />
          <span style={{ fontSize: 12, opacity: .8 }}>bps (500 = 5% edge → RTP 95%)</span>
          <button disabled={!isOwner || loading} onClick={setHouseEdge} style={{ padding: '8px 12px', borderRadius: 6 }}>Set</button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 12, marginTop: 12 }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>House Commit</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input
            placeholder="House seed (secret) or 0x..."
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, background: '#111', color: '#fff', border: '1px solid #333', flex: 1 }}
          />
          <button disabled={!isOwner || loading} onClick={setCommit} style={{ padding: '8px 12px', borderRadius: 6 }}>Set commit</button>
        </div>
        <div style={{ fontSize: 12, opacity: .8, wordBreak: 'break-all' }}>Computed commit: {commitPreview}</div>
        <div style={{ fontSize: 12, opacity: .6, marginTop: 6 }}>Note: For production, do not reveal seeds in the UI. Rotate commits off-chain and only publish the commit hash.</div>
      </div>
    </Modal>
  )
}
