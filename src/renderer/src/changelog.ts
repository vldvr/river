// Патчноуты. Правило: у каждой версии из package.json здесь есть запись, иначе тесты и релиз не пройдут.
// Новая версия идёт первой. Пишем для игроков: что изменилось за столом, без внутренней кухни.

export type ChangeKind = 'new' | 'better' | 'fix'

export interface Change {
  kind: ChangeKind
  /** Коротко, как заголовок: «Кролик». */
  title: string
  /** Одно-два предложения: что это и как этим пользоваться. */
  text?: string
}

export interface Release {
  version: string
  /** ГГГГ-ММ-ДД. */
  date: string
  /** Имя релиза в два-три слова. */
  title: string
  changes: Change[]
}

export const CHANGELOG: Release[] = [
  {
    version: '1.7.0',
    date: '2026-11-05',
    title: 'Драма за столом',
    changes: [
      {
        kind: 'new',
        title: 'Шансы при олл-ине',
        text: 'Когда руки вскрылись, у каждой видно, сколько у неё шансов, и число меняется с каждой новой картой. Зрители видят шансы всю раздачу.',
      },
      {
        kind: 'new',
        title: 'Кролик',
        text: 'Раздача кончилась раньше ривера? Нажми «Кролик» над доской и посмотри, какие карты легли бы дальше. Их увидят все за столом.',
      },
      {
        kind: 'new',
        title: 'Номинации в итогах',
        text: 'В конце партии: бэд-бит, везунчик, лучшая рука, самый большой банк и ещё пять. Считаются только по картам, которые видели все.',
      },
      {
        kind: 'new',
        title: 'Что нового',
        text: 'После обновления Ривер показывает, что изменилось. Список всех версий открывается в настройках.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-11-03',
    title: 'Быстрые ставки',
    changes: [
      { kind: 'new', title: 'Mac обновляется сам', text: 'Новая версия скачивается в фоне и ставится, когда закрываешь Ривер. Нужно, чтобы он лежал в «Программах».' },
      { kind: 'new', title: 'Свои быстрые ставки', text: 'В настройках: на префлопе в больших блайндах, после флопа в процентах банка.' },
      { kind: 'new', title: 'Суммы в BB', text: 'Щелчок по своему стеку, ставке или банку переключает фишки на большие блайнды и обратно.' },
      { kind: 'new', title: 'Цветные карты', text: 'В «Колоде» есть вариант, где карта целиком в цвет масти.' },
    ],
  },
  {
    version: '1.5.1',
    date: '2026-11-01',
    title: 'Подсказки к косметике',
    changes: [
      { kind: 'better', title: 'Закрытые рубашки и сукна', text: 'Под каждой видно, сколько партий или какое Эло нужно, чтобы её открыть.' },
      { kind: 'fix', title: 'Сетка сукон в настройках стала ровной' },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-11-01',
    title: 'Ривер на Mac',
    changes: [
      { kind: 'new', title: 'Версия для Mac', text: 'Для M1 и новее и для Intel.' },
      { kind: 'new', title: 'Рубашки и реакции', text: 'Своя рубашка карт, которую видят все, и быстрые фразы над местом.' },
      { kind: 'new', title: 'Профиль за столом', text: 'Имя, цвет и рубашку можно сменить, не выходя из игры.' },
      { kind: 'new', title: 'Хост может убрать игрока из-за стола' },
      { kind: 'better', title: 'Честное завершение', text: 'Если хост заканчивает игру посреди раздачи, она доигрывается до конца.' },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-01',
    title: 'Рейтинг на сервере',
    changes: [
      { kind: 'new', title: 'Эло считает сервер', text: 'Рейтинг хранится на сервере, а не у каждого свой. На другом компьютере его можно вернуть по коду восстановления.' },
    ],
  },
]

/** Сравнение версий вида 1.2.3: отрицательное, если a старше b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Что показать после обновления: версии новее `seen` до текущей включительно, не больше трёх.
 * seen = null: игрок пришёл с версии, где патчноутов ещё не было, показываем только текущую.
 */
export function releasesSince(seen: string | null, current: string, log: readonly Release[] = CHANGELOG): Release[] {
  const upTo = log.filter((r) => compareVersions(r.version, current) <= 0)
  if (seen === null) return upTo.filter((r) => r.version === current)
  return upTo.filter((r) => compareVersions(r.version, seen) > 0).slice(0, 3)
}

/** Все вышедшие версии до текущей: для списка в настройках. */
export function releasedUpTo(current: string, log: readonly Release[] = CHANGELOG): Release[] {
  return log.filter((r) => compareVersions(r.version, current) <= 0)
}
