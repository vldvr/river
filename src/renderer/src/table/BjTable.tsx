import { AnimatePresence, motion } from 'motion/react'
import { useMemo } from 'react'
import type { PlayerView } from '../../../protocol/index.ts'
import { Avatar } from '../components/Avatar'
import { ChipStack } from '../components/Chips'
import { PlayingCard } from '../components/PlayingCard'
import { bjPlacesFor } from '../choreo/bj'
import { chips } from '../lib/format'
import { useApp } from '../store/app'
import { useBj } from '../store/bjscene'
import { BJ_CARD, DEALER, SHOE, bjCardPos, dealerCardPos, type BjPlace } from './bjGeometry'
import { Felt } from './Felt'
import { shadowFor } from './geometry'
import { Stage } from './Stage'
import { Flights } from './TableParts'
import './table.css'
import './bj.css'

export function BjTable() {
  const view = useApp((s) => s.shown ?? s.view)
  const you = useApp((s) => s.you)
  const avatars = useApp((s) => s.avatars)
  const reduceMotion = useApp((s) => s.settings.reduceMotion)
  const { bj, labels, toAct, turnEndsAt, turnTotal } = useBj()

  const places = useMemo(() => (view ? bjPlacesFor(view, you) : new Map<number, BjPlace>()), [view, you])
  if (!view) return null

  const focus = toAct ? (places.get(toAct.seat)?.pos ?? null) : null
  const dealerCards = bj?.dealer.cards ?? []
  const playing = bj?.phase === 'playing' || bj?.phase === 'done'

  return (
    <Stage>
      <Felt focus={focus} calm={reduceMotion} />
      <div className="bj-print" aria-hidden="true">
        <div>Блэкджек платит 3 к 2</div>
        <div className="bj-print__small">Дилер добирает до 17 и стоит на мягких 17</div>
      </div>

      <div className="bj-shoe" style={{ left: SHOE.x, top: SHOE.y }} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bj-shoe__card" style={{ transform: `translate(${i * 3}px, ${-i * 3}px)` }}>
            <PlayingCard card={null} w={56} h={78} />
          </div>
        ))}
      </div>

      <div className="bj-dealer" style={{ left: DEALER.x, top: DEALER.y - BJ_CARD.h / 2 - 40 }}>
        <span>Дилер</span>
        {bj?.dealer.total !== null && bj?.dealer.total !== undefined && (
          <span className="bj-total num">{totalText(bj.dealer.total, bj.dealer.soft, dealerCards.length)}</span>
        )}
      </div>
      {dealerCards.map((c, i) => {
        const p = dealerCardPos(i, dealerCards.length)
        return (
          <motion.div key={`d-${bj?.roundNo}-${i}`} className="bj-card" initial={false} animate={{ left: p.x, top: p.y }} transition={{ duration: 0.3 }}>
            <PlayingCard card={c} w={BJ_CARD.w} h={BJ_CARD.h} shadow={shadowFor(p, 8)} />
          </motion.div>
        )
      })}

      {[...places.values()].map((place) => {
        const player = view.players.find((p) => p.seat === place.seat)
        if (!player) return null
        const seat = bj?.seats.find((s) => s.seat === place.seat)
        const acting = toAct?.seat === place.seat
        return (
          <div key={`bj-${player.id}`}>
            <BjSeatView place={place} player={player} avatar={avatars[player.id] ?? null} acting={acting} turnEndsAt={acting ? turnEndsAt : null} turnTotal={turnTotal} />
            {seat && !playing && seat.bet !== null && (
              <div className="bet" style={{ left: place.bet.x, top: place.bet.y }}>
                <ChipStack amount={seat.bet} size={26} />
                <span className="bet__amount num">{chips(seat.bet)}</span>
              </div>
            )}
            {seat?.hands.map((h, hi) => {
              const key = `${place.seat}:${hi}`
              const label = labels[key]
              const head = bjCardPos(place, hi, seat.hands.length, h.cards.length - 1)
              const active = acting && toAct?.hand === hi
              const betAt = { x: place.bet.x + (seat.hands.length > 1 ? (hi - 0.5) * 70 : 0), y: place.bet.y }
              return (
                <div key={key}>
                  {h.bet > 0 && (
                    <div className="bet" style={{ left: betAt.x, top: betAt.y }}>
                      <ChipStack amount={h.bet} size={24} />
                    </div>
                  )}
                  {h.cards.map((c, ci) => {
                    const p = bjCardPos(place, hi, seat.hands.length, ci)
                    return (
                      <motion.div key={`${ci}-${c}`} className={`bj-card ${active ? 'is-active' : ''}`} initial={false} animate={{ left: p.x, top: p.y }} transition={{ duration: 0.3 }} style={{ zIndex: ci }}>
                        <PlayingCard card={c} w={BJ_CARD.w} h={BJ_CARD.h} shadow={shadowFor(p, 8)} dim={h.result === 'bust' || h.result === 'lose'} win={h.result === 'win' || h.result === 'blackjack'} />
                      </motion.div>
                    )
                  })}
                  {h.cards.length > 0 && (
                    <div className={`bj-hand-total num ${active ? 'is-active' : ''}`} style={{ left: head.x + BJ_CARD.w * 0.42, top: head.y - BJ_CARD.h * 0.5 - 14 }}>
                      {totalText(h.total, h.soft, h.cards.length)}
                    </div>
                  )}
                  <AnimatePresence>
                    {label && (
                      <motion.div
                        key={label.text}
                        className={`bj-label is-${label.tone}`}
                        style={{ left: bjCardPos(place, hi, seat.hands.length, 0).x + 20, top: head.y + BJ_CARD.h * 0.5 + 18 }}
                        initial={{ opacity: 0, y: 6, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                      >
                        {label.text}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )
      })}
      <Flights />
    </Stage>
  )
}

function totalText(total: number, soft: boolean, count: number): string {
  if (count === 2 && total === 21) return 'Блэкджек'
  if (total > 21) return `${total}, перебор`
  return soft && total < 21 ? `${total - 10}/${total}` : String(total)
}

function BjSeatView({
  place,
  player,
  avatar,
  acting,
  turnEndsAt,
  turnTotal,
}: {
  place: BjPlace
  player: PlayerView
  avatar: string | null
  acting: boolean
  turnEndsAt: number | null
  turnTotal: number
}) {
  const out = player.status !== 'active'
  const remaining = turnEndsAt ? Math.max(0, turnEndsAt - performance.now()) : 0
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className={`seat ${acting ? 'is-acting' : ''} ${place.hero ? 'is-hero' : ''}`} style={{ left: place.pos.x, top: place.pos.y }}>
      <div className="seat__avatar">
        {acting && turnEndsAt !== null && (
          <svg className="ring" width={104} height={104} viewBox="0 0 104 104" aria-hidden="true">
            <circle cx="52" cy="52" r={r} className="ring__track" />
            <circle
              key={turnEndsAt}
              cx="52"
              cy="52"
              r={r}
              className="ring__bar"
              style={{ strokeDasharray: c, animationDuration: `${turnTotal}ms`, animationDelay: `${-(turnTotal - remaining)}ms`, ['--c' as string]: c }}
            />
          </svg>
        )}
        <Avatar name={player.name} color={player.color} src={avatar} size={78} dim={out || !player.connected} />
      </div>
      <div className="seat__plate">
        <span className="seat__name" title={`Эло: ${player.rating}, партий: ${player.ratingGames}`}>
          {player.name}
          <span className="seat__rating num">Эло {player.rating}</span>
        </span>
        <span className="seat__stack num">{player.status === 'busted' ? 'Без фишек' : player.status === 'sittingOut' ? 'Отошёл' : chips(player.stack)}</span>
      </div>
    </div>
  )
}
