import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { partialHandName } from '../../../engine/index.ts'
import { placesFor } from '../choreo/choreographer'
import { useApp } from '../store/app'
import { useScene } from '../store/scene'
import { EquityBadge, RabbitButton, RabbitCaption, useEquity } from './Drama'
import { Felt } from './Felt'
import { equityAnchor } from './geometry'
import { BetChips, Seat, SeatCards } from './Seat'
import { Stage } from './Stage'
import { Board, DealerButton, Flights, Pot, ResultBanner } from './TableParts'
import './table.css'

export function Table() {
  const view = useApp((s) => s.shown ?? s.view)
  const you = useApp((s) => s.you)
  const avatars = useApp((s) => s.avatars)
  const reduceMotion = useApp((s) => s.settings.reduceMotion)
  const hideCards = useApp((s) => s.settings.hideCards)
  const scene = useScene()
  const [hover, setHover] = useState(false)
  const held = useHeldSpace(hideCards)
  const onPeek = useCallback((on: boolean) => setHover(on), [])

  const places = useMemo(() => placesFor(view, you), [view, you])
  const odds = useEquity(scene)
  if (!view) return null

  const heroSeat = view.players.find((p) => p.id === you)?.seat ?? null
  const showdown = !scene.live && !!scene.best && scene.winners.length > 0
  const focus = scene.toAct !== null ? (places.get(scene.toAct)?.pos ?? null) : null
  const buttonPlace = scene.button !== null ? (places.get(scene.button) ?? null) : null
  const hero = heroSeat !== null ? scene.seats[heroSeat] : undefined
  const heroCards = hero?.cards?.filter((c): c is string => !!c) ?? []
  // «В одной комнате»: своя рука закрыта, пока её не видят все и пока не подглядываешь.
  const heroHidden = hideCards && !hero?.shown && !hover && !held
  // На шоудауне название руки и так подписано у места.
  const hint =
    heroCards.length === 2 && !hero?.folded && !hero?.handName && !heroHidden ? partialHandName([...heroCards, ...scene.board]) : null

  return (
    <Stage>
      <Felt focus={focus} calm={reduceMotion} />
      <Board cards={scene.board} epoch={scene.epoch} best={scene.best} showdown={showdown} rabbit={scene.rabbit?.cards ?? null} />
      <RabbitCaption view={view} scene={scene} />
      <RabbitButton view={view} scene={scene} />
      <Pot amount={scene.pot} />
      <DealerButton place={buttonPlace} />

      {[...places.values()].map((place) => {
        const s = scene.seats[place.seat]
        return s ? <BetChips key={`bet-${place.seat}`} place={place} amount={s.bet} /> : null
      })}

      {[...places.values()].map((place) => {
        const s = scene.seats[place.seat]
        if (!s?.cards?.length) return null
        const back = view.players.find((p) => p.seat === place.seat)?.back
        const own = place.hero && hideCards
        return (
          <SeatCards
            key={`cards-${place.seat}-${scene.handNo}`}
            place={place}
            seat={s}
            best={scene.best}
            showdown={showdown}
            back={back}
            hidden={own && heroHidden}
            onPeek={own ? onPeek : undefined}
          />
        )
      })}

      {[...places.values()].map((place) => {
        const player = view.players.find((p) => p.seat === place.seat)
        if (!player) return null
        return (
          <Seat
            key={`seat-${player.id}`}
            place={place}
            player={player}
            avatar={avatars[player.id] ?? null}
            seat={scene.seats[place.seat] ?? null}
            acting={scene.toAct === place.seat}
            turnEndsAt={scene.toAct === place.seat ? scene.turnEndsAt : null}
            turnTotal={scene.turnTotal}
            winner={showdown ? scene.winners.includes(place.seat) : scene.winners.includes(place.seat) && !scene.live}
            dealer={scene.button === place.seat}
          />
        )
      })}

      <AnimatePresence>
        {odds &&
          [...odds].map(([seat, value]) => {
            const place = places.get(seat)
            if (!place) return null
            const lead = Math.max(...odds.values())
            const name = view.players.find((p) => p.seat === seat)?.name ?? ''
            return <EquityBadge key={`eq-${seat}-${scene.handNo}`} at={equityAnchor(place)} value={value} leader={value === lead && value > 0} name={name} />
          })}
      </AnimatePresence>

      {hint && heroSeat !== null && (
        <div className="hero-hint" key={hint}>
          {hint}
        </div>
      )}

      <ResultBanner banner={scene.live ? null : scene.banner} />
      <Flights />
    </Stage>
  )
}

/** Пробел зажат: подглядываем в свои карты без мыши. В полях ввода пробел остаётся пробелом. */
function useHeldSpace(enabled: boolean): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!enabled) {
      setHeld(false)
      return
    }
    const typing = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return
      // Иначе пробел нажмёт кнопку в фокусе, например «Фолд».
      e.preventDefault()
      setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (!typing(e.target)) e.preventDefault()
      setHeld(false)
    }
    const release = () => setHeld(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', release)
    }
  }, [enabled])
  return held
}
