import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useRef } from 'react'
import { WifiSlash, Crown } from '@phosphor-icons/react'
import type { PlayerView } from '../../../protocol/index.ts'
import { Avatar } from '../components/Avatar'
import { PlayingCard } from '../components/PlayingCard'
import { ChipStack } from '../components/Chips'
import { sound } from '../audio/sound'
import { chips, plural } from '../lib/format'
import type { SceneSeat } from '../store/scene'
import { useApp } from '../store/app'
import { HERO_CARD, SMALL_CARD, shadowFor, type SeatPlace } from './geometry'

const LABEL: Record<string, string> = {
  fold: 'Фолд',
  check: 'Чек',
  call: 'Колл',
  bet: 'Бет',
  raise: 'Рейз',
  allin: 'Олл-ин',
  timeout: 'Время вышло',
}

const AVATAR = 78

function reentryLabel(n: number): string {
  return `${n} ${plural(n, 'повторный вход', 'повторных входа', 'повторных входов')}`
}

interface SeatProps {
  place: SeatPlace
  player: PlayerView
  avatar: string | null
  seat: SceneSeat | null
  acting: boolean
  turnEndsAt: number | null
  turnTotal: number
  winner: boolean
  dealer: boolean
}

export const Seat = memo(function Seat({ place, player, avatar, seat, acting, turnEndsAt, turnTotal, winner, dealer }: SeatProps) {
  const folded = seat?.folded ?? false
  const out = player.status === 'busted' || player.status === 'sittingOut' || player.status === 'left'
  const stack = seat ? seat.stack : player.stack
  const label = seat?.label
  const status =
    player.status === 'busted'
      ? player.place
        ? `${player.place} место`
        : 'Без фишек'
      : player.status === 'sittingOut'
        ? 'Отошёл'
        : null

  let bubble: string | null = null
  if (label && label.kind !== 'post' && label.kind !== 'win') {
    bubble = LABEL[label.kind] ?? null
    if ((label.kind === 'raise' || label.kind === 'bet') && label.amount) bubble += ` ${chips(label.amount)}`
  }

  return (
    <div
      className={`seat ${acting ? 'is-acting' : ''} ${winner ? 'is-winner' : ''} ${place.hero ? 'is-hero' : ''}`}
      style={{ left: place.pos.x, top: place.pos.y }}
    >
      <div className="seat__avatar">
        {acting && turnEndsAt !== null && <TurnRing endsAt={turnEndsAt} total={turnTotal} hero={place.hero} />}
        <Avatar name={player.name} color={player.color} src={avatar} size={AVATAR} dim={folded || out || !player.connected} />
        {!player.connected && (
          <span className="seat__badge" title="Нет связи">
            <WifiSlash size={16} weight="bold" />
          </span>
        )}
        {player.isHost && (
          <span className="seat__host" title="Хост">
            <Crown size={14} weight="fill" />
          </span>
        )}
        {dealer && place.hero && <span className="seat__dealer-mini">D</span>}
      </div>

      <div className="seat__plate">
        <span className="seat__name">{player.name}</span>
        <span className="seat__stack num">{status ?? (seat?.allIn ? 'Олл-ин' : chips(stack))}</span>
        {player.buyIns > 1 && <span className="seat__reentry">{reentryLabel(player.buyIns - 1)}</span>}
      </div>

      <AnimatePresence>
        {bubble && (
          <motion.div
            key={`${label?.kind}-${label?.amount}`}
            className={`seat__bubble ${label?.kind === 'allin' ? 'is-allin' : ''} ${label?.kind === 'fold' ? 'is-quiet' : ''}`}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            {bubble}
          </motion.div>
        )}
        {label?.kind === 'win' && (
          <motion.div
            key="win"
            className="seat__bubble is-win num"
            initial={{ opacity: 0, y: 10, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          >
            +{chips(label.amount)}
          </motion.div>
        )}
      </AnimatePresence>

      {seat?.handName && !folded && <div className="seat__hand">{seat.handName}</div>}
    </div>
  )
})

/** Кольцо таймера вокруг аватара. В последние 5 секунд у своего места тикает. */
function TurnRing({ endsAt, total, hero }: { endsAt: number; total: number; hero: boolean }) {
  const remaining = Math.max(0, endsAt - performance.now())
  const elapsed = Math.max(0, total - remaining)
  const ticked = useRef(new Set<number>())
  const reduce = useApp((s) => s.settings.reduceMotion)

  useEffect(() => {
    if (!hero) return
    const id = setInterval(() => {
      const left = Math.ceil((endsAt - performance.now()) / 1000)
      if (left > 0 && left <= 5 && !ticked.current.has(left)) {
        ticked.current.add(left)
        sound.play('tick', { volume: 0.35 + (5 - left) * 0.06 })
      }
    }, 200)
    return () => clearInterval(id)
  }, [endsAt, hero])

  const r = 46
  const c = 2 * Math.PI * r
  return (
    <svg className="ring" width={104} height={104} viewBox="0 0 104 104" aria-hidden="true">
      <circle cx="52" cy="52" r={r} className="ring__track" />
      <circle
        key={endsAt}
        cx="52"
        cy="52"
        r={r}
        className="ring__bar"
        style={{
          strokeDasharray: c,
          animationDuration: `${total}ms`,
          animationDelay: `${-elapsed}ms`,
          animationPlayState: reduce ? 'running' : 'running',
          ['--c' as string]: c,
        }}
      />
    </svg>
  )
}

/** Карты соседа: маленькие, у аватара; свои: крупные снизу по центру. */
export const SeatCards = memo(function SeatCards({
  place,
  seat,
  best,
  showdown,
}: {
  place: SeatPlace
  seat: SceneSeat
  best: string[] | null
  showdown: boolean
}) {
  const cards = seat.cards
  const size = place.hero ? HERO_CARD : SMALL_CARD
  const spread = place.hero ? size.w * 0.64 : size.w * 0.5
  const sh = shadowFor(place.cards, place.hero ? 12 : 7)
  return (
    <div className={`seat-cards ${place.hero ? 'is-hero' : ''}`} style={{ left: place.cards.x, top: place.cards.y }}>
      <AnimatePresence>
        {cards?.map((c, i) => {
          const inBest = !!c && !!best?.includes(c)
          return (
            <motion.div
              key={`${i}`}
              className="seat-cards__slot"
              style={{ zIndex: i }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: (i - (cards.length - 1) / 2) * spread, rotate: (i - 0.5) * (place.hero ? 7 : 9) }}
              exit={{ opacity: 0, y: place.hero ? -40 : 0, scale: 0.8, transition: { duration: 0.32 } }}
              transition={{ duration: 0.12 }}
            >
              <PlayingCard card={c} w={size.w} h={size.h} shadow={sh} win={showdown && inBest} dim={showdown && !!best && !inBest} />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
})

export const BetChips = memo(function BetChips({ place, amount }: { place: SeatPlace; amount: number }) {
  return (
    <AnimatePresence>
      {amount > 0 && (
        <motion.div
          className="bet"
          style={{ left: place.bet.x, top: place.bet.y }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.15 }}
        >
          <ChipStack amount={amount} size={26} />
          <span className="bet__amount num">{chips(amount)}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
