import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PaperPlaneRight, X } from '@phosphor-icons/react'
import { send } from '../net/connection'
import { useApp } from '../store/app'

export function SidePanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const [tab, setTab] = useState<'chat' | 'log'>('chat')
  const chat = useApp((s) => s.chat)
  const log = useApp((s) => s.log)
  const you = useApp((s) => s.you)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) useApp.setState({ unread: 0 })
  }, [open, chat.length])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length, log.length, tab, open])

  const hands = useMemo(() => {
    const groups = new Map<number, typeof log>()
    for (const l of log) {
      const g = groups.get(l.hand) ?? []
      g.push(l)
      groups.set(l.hand, g)
    }
    return [...groups.entries()].slice(-30)
  }, [log])

  const submit = () => {
    const t = text.trim()
    if (!t) return
    send({ t: 'chat', text: t.slice(0, 200) })
    setText('')
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="side panel"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 30, opacity: 0, transition: { duration: 0.16 } }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        >
          <div className="side__head">
            <div className="segmented" role="tablist">
              <button aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}>
                Чат
              </button>
              <button aria-pressed={tab === 'log'} onClick={() => setTab('log')}>
                Раздачи
              </button>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          </div>

          <div className="side__list" ref={listRef}>
            {tab === 'chat' &&
              (chat.length === 0 ? (
                <p className="side__empty">Здесь будет переписка за столом. Напиши первым.</p>
              ) : (
                chat.map((m) => (
                  <div key={m.id} className={`msg ${m.from === you ? 'is-me' : ''}`}>
                    <span className="msg__name">{m.name}</span>
                    <span className="msg__text">{m.text}</span>
                  </div>
                ))
              ))}
            {tab === 'log' &&
              (hands.length === 0 ? (
                <p className="side__empty">История появится после первой раздачи.</p>
              ) : (
                hands.map(([hand, lines]) => (
                  <div key={hand} className="loghand">
                    {lines.map((l) => (
                      <div key={l.id} className={`logline ${l.strong ? 'is-strong' : ''}`}>
                        {l.text}
                      </div>
                    ))}
                  </div>
                ))
              ))}
          </div>

          {tab === 'chat' && (
            <form
              className="side__compose"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <input
                className="input"
                type="text"
                value={text}
                maxLength={200}
                placeholder="Сообщение"
                onChange={(e) => setText(e.target.value)}
                aria-label="Сообщение в чат"
              />
              <button className="icon-btn" type="submit" aria-label="Отправить" disabled={!text.trim()}>
                <PaperPlaneRight size={20} weight="fill" />
              </button>
            </form>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
