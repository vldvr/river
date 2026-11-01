import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { REACTIONS, type PlayerView } from '../../../protocol/index.ts'
import { isHost, send } from '../net/connection'
import { useApp } from '../store/app'

const REACT_MS = 2600

/** Над местом: реакция игрока и, для хоста, кнопка «убрать из-за стола». */
export function SeatExtras({ player }: { player: PlayerView }) {
  const you = useApp((s) => s.you)
  const reaction = useApp((s) => s.reactions[player.id])
  const [visible, setVisible] = useState<number | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (!reaction || Date.now() - reaction.at > REACT_MS) return
    setVisible(reaction.at)
    const t = setTimeout(() => setVisible(null), REACT_MS - (Date.now() - reaction.at))
    return () => clearTimeout(t)
  }, [reaction])

  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3000)
    return () => clearTimeout(t)
  }, [confirm])

  const canKick = isHost() && player.id !== you && !player.isHost && player.status !== 'left'
  return (
    <>
      <AnimatePresence>
        {visible !== null && reaction && (
          <motion.div
            key={visible}
            className="seat__react"
            initial={{ opacity: 0, y: 8, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 480, damping: 26 }}
          >
            {REACTIONS[reaction.r]}
          </motion.div>
        )}
      </AnimatePresence>
      {canKick &&
        (confirm ? (
          <button className="btn btn--sm seat__kick-confirm" onClick={() => send({ t: 'kick', id: player.id })}>
            Убрать {player.name}?
          </button>
        ) : (
          <button className="seat__kick" onClick={() => setConfirm(true)} aria-label={`Убрать ${player.name} из-за стола`} title="Убрать из-за стола">
            <X size={14} weight="bold" />
          </button>
        ))}
    </>
  )
}
