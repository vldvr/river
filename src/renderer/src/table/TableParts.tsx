import { AnimatePresence, motion } from 'motion/react'
import { memo } from 'react'
import { PlayingCard } from '../components/PlayingCard'
import { ChipStack } from '../components/Chips'
import { chips } from '../lib/format'
import { useScene, type Banner as BannerData, type Flight } from '../store/scene'
import { BOARD_CARD, DECK, HERO_CARD, POT, SMALL_CARD, boardSlot, shadowFor, type SeatPlace } from './geometry'

export const Board = memo(function Board({
  cards,
  epoch,
  best,
  showdown,
}: {
  cards: string[]
  epoch: number
  best: string[] | null
  showdown: boolean
}) {
  // Новые карты одной улицы переворачиваются каскадом.
  const streetStart = cards.length <= 3 ? 0 : cards.length - 1
  return (
    <div className="board" aria-label="Карты на столе">
      {[0, 1, 2, 3, 4].map((i) => {
        const p = boardSlot(i)
        return (
          <div key={`slot-${i}`} className="board__slot" style={{ left: p.x, top: p.y, width: BOARD_CARD.w, height: BOARD_CARD.h }} />
        )
      })}
      {cards.map((c, i) => {
        const p = boardSlot(i)
        const inBest = !!best?.includes(c)
        return (
          <div key={`${epoch}-${c}`} className="board__card" style={{ left: p.x, top: p.y }}>
            <PlayingCard
              card={c}
              w={BOARD_CARD.w}
              h={BOARD_CARD.h}
              flipIn={{ delay: Math.max(0, i - streetStart) * 0.13, from: { x: DECK.x - p.x, y: DECK.y - p.y } }}
              shadow={shadowFor(p, 8)}
              win={showdown && inBest}
              dim={showdown && !!best && !inBest}
            />
          </div>
        )
      })}
    </div>
  )
})

export const Pot = memo(function Pot({ amount }: { amount: number }) {
  return (
    <AnimatePresence>
      {amount > 0 && (
        <motion.div
          className="pot"
          style={{ left: POT.x, top: POT.y }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          <ChipStack amount={amount} size={30} />
          <span className="pot__label">
            Банк <span className="num">{chips(amount)}</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
})

export const DealerButton = memo(function DealerButton({ place }: { place: SeatPlace | null }) {
  if (!place) return null
  return (
    <motion.div
      className="dealer"
      initial={false}
      animate={{ x: place.button.x, y: place.button.y }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      aria-label="Баттон"
    >
      D
    </motion.div>
  )
})

export function Flights() {
  const flights = useScene((s) => s.flights)
  return (
    <div className="flights" aria-hidden="true">
      {flights.map((f) => (
        <FlightItem key={f.id} f={f} />
      ))}
    </div>
  )
}

function FlightItem({ f }: { f: Flight }) {
  const remove = useScene((s) => s.removeFlight)
  const dx = f.to.x - f.from.x
  const dy = f.to.y - f.from.y
  const card = f.small ? SMALL_CARD : HERO_CARD
  return (
    <motion.div
      className="flight"
      style={{ left: f.from.x, top: f.from.y }}
      initial={{ x: 0, y: 0, opacity: f.kind === 'card' ? 0.4 : 1, rotate: 0, scale: f.kind === 'card' ? 0.85 : 1 }}
      animate={{
        x: dx,
        // Карты летят по лёгкой дуге: чуть выше прямой.
        y: f.kind === 'card' ? [0, dy * 0.45 - 26, dy] : dy,
        opacity: 1,
        rotate: f.rotate ?? 0,
        scale: 1,
      }}
      transition={{
        duration: f.duration / 1000,
        delay: f.delay / 1000,
        ease: [0.2, 0.8, 0.25, 1],
        ...(f.kind === 'card' ? { y: { duration: f.duration / 1000, delay: f.delay / 1000, times: [0, 0.5, 1], ease: 'easeOut' } } : {}),
      }}
      onAnimationComplete={() => remove(f.id)}
    >
      {f.kind === 'card' ? (
        <PlayingCard card={null} w={card.w} h={card.h} back={f.back} />
      ) : (
        <ChipStack amount={f.amount} size={f.small ? 22 : 26} />
      )}
    </motion.div>
  )
}

export const ResultBanner = memo(function ResultBanner({ banner }: { banner: BannerData | null }) {
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          key={banner.title + banner.subtitle}
          className="result"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.25 } }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          <div className="result__title">{banner.title}</div>
          <div className="result__sub">{banner.subtitle}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
