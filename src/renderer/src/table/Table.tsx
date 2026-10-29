import { useMemo } from 'react'
import { partialHandName } from '../../../engine/index.ts'
import { placesFor } from '../choreo/choreographer'
import { useApp } from '../store/app'
import { useScene } from '../store/scene'
import { Felt } from './Felt'
import { BetChips, Seat, SeatCards } from './Seat'
import { Stage } from './Stage'
import { Board, DealerButton, Flights, Pot, ResultBanner } from './TableParts'
import './table.css'

export function Table() {
  const view = useApp((s) => s.shown ?? s.view)
  const you = useApp((s) => s.you)
  const avatars = useApp((s) => s.avatars)
  const reduceMotion = useApp((s) => s.settings.reduceMotion)
  const scene = useScene()

  const places = useMemo(() => placesFor(view, you), [view, you])
  if (!view) return null

  const heroSeat = view.players.find((p) => p.id === you)?.seat ?? null
  const showdown = !scene.live && !!scene.best && scene.winners.length > 0
  const focus = scene.toAct !== null ? (places.get(scene.toAct)?.pos ?? null) : null
  const buttonPlace = scene.button !== null ? (places.get(scene.button) ?? null) : null
  const hero = heroSeat !== null ? scene.seats[heroSeat] : undefined
  const heroCards = hero?.cards?.filter((c): c is string => !!c) ?? []
  // На шоудауне название руки и так подписано у места.
  const hint = heroCards.length === 2 && !hero?.folded && !hero?.handName ? partialHandName([...heroCards, ...scene.board]) : null

  return (
    <Stage>
      <Felt focus={focus} calm={reduceMotion} />
      <Board cards={scene.board} epoch={scene.epoch} best={scene.best} showdown={showdown} />
      <Pot amount={scene.pot} />
      <DealerButton place={buttonPlace} />

      {[...places.values()].map((place) => {
        const s = scene.seats[place.seat]
        return s ? <BetChips key={`bet-${place.seat}`} place={place} amount={s.bet} /> : null
      })}

      {[...places.values()].map((place) => {
        const s = scene.seats[place.seat]
        if (!s?.cards?.length) return null
        return <SeatCards key={`cards-${place.seat}-${scene.handNo}`} place={place} seat={s} best={scene.best} showdown={showdown} />
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
