// Прогон множества раздач ботами через настоящий HostServer: node --experimental-strip-types tools/sim.ts [раздач]
import { HostServer } from '../src/host/server.ts'
import { ManualScheduler } from '../src/host/scheduler.ts'
import { loopback } from '../src/host/loopback.ts'
import { DEFAULT_CONFIG, seededRandomInt, chipsInPlay } from '../src/engine/index.ts'
import { PROTOCOL_VERSION } from '../src/protocol/index.ts'

const target = Number(process.argv[2] ?? 1000)
const sched = new ManualScheduler()
const queue: (() => void)[] = []
const server = new HostServer({
  code: '000000',
  hostToken: 'sim-host-token-000000',
  appVersion: 'sim',
  config: { ...DEFAULT_CONFIG, format: 'cash', startingStack: 2000 },
  scheduler: sched,
  rand: seededRandomInt(Number(process.argv[3] ?? 1)),
})
const host = loopback(server, (fn) => queue.push(fn))
host.onMessage = () => {}
const flush = () => {
  while (queue.length) queue.shift()!()
}
host.send({ t: 'hello', v: PROTOCOL_VERSION, appVersion: 'sim', name: 'Хост', color: '#888888', avatar: null, token: 'sim-host-token-000000' })
flush()
host.send({ t: 'sit', out: true })
for (let i = 0; i < 6; i++) host.send({ t: 'addBot' })
host.send({ t: 'start' })
flush()

const started = performance.now()
let rebuys = 0
let simulatedMs = 0
while (server.state.game.handNo < target) {
  if (!sched.step()) throw new Error('stuck: no timers pending')
  flush()
  const g = server.state.game
  for (const p of g.players) {
    if (p.status === 'busted') {
      p.stack = g.config.startingStack
      p.buyIns += 1
      p.status = 'active'
      rebuys++
    }
  }
  const expected = g.players.reduce((s, p) => s + p.buyIns, 0) * g.config.startingStack
  if (chipsInPlay(g) !== expected) throw new Error(`chips drifted at hand ${g.handNo}`)
  simulatedMs = sched.now()
}
const wall = performance.now() - started
console.log(`${target} раздач за ${wall.toFixed(0)} мс реального времени`)
console.log(`игрового времени: ${(simulatedMs / 3_600_000).toFixed(1)} ч, в среднем ${(simulatedMs / target / 1000).toFixed(1)} с на раздачу`)
console.log(`докупок: ${rebuys}`)
