// Context Bar: what is filling my context window?
//   Above the prompt, the window as one stacked bar, a color per category as /context
//   draws them (system prompt, tools, MCP tools, memory files, skills, messages, free),
//   with a legend of tokens and shares and where auto-compaction runs. It refreshes as the
//   main conversation keeps each row (prompt, response, tool result, compaction), so it
//   grows steadily within a turn, and again once /clear, /compact or /resume has installed
//   the new transcript. /context-bar shows or hides it, and the choice is kept
//   across sessions.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading, Slice } from '../types'

const MIN_WIDTH = 20 // narrower than this, the bar is not drawn
const SPLIT = '   '
// /context's theme gives several rows the same grey, so each used row gets its own color, in order.
const PALETTE = ['#7aa2f7', '#7dcfff', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64', '#c0caf5']
const MESSAGES = '#d97757' // the row that grows, in the accent color
const FREE = '#808080' // a mid grey thin line reads as empty on dark and light themes alike
const BUFFER = '#808080'
const GLYPH = { used: '█', free: '─', buffer: '░' } as const
// An appended row reaches the in-memory transcript one tick after its append resolves
// (measured on Claude Code 2.1.300); a 1ms timer runs after that tick.
const AFTER_APPEND_MS = 1

// Held by the host, so the bar survives a hot reload of this file. The owner must be the
// manifest's name ('ctx-bar'), written as a literal in each ref: `claude plugin validate`
// only reads atom sources whose plugin and key are string literals.
const reading = atom({ plugin: 'ctx-bar', key: 'reading' } as const, null as Reading | null)
const isHidden = atom({ plugin: 'ctx-bar', key: 'isHidden' } as const, false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'context-bar', description: 'Show or hide the context window bar above the prompt' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    const hidden = (await $.store.get('isHidden').catch(() => undefined)) === true
    await update($, isHidden, () => hidden)
    void scheduleRefresh($)
    return r
  })

  // Every row the main conversation keeps changes what the window holds. The append resolves
  // once the row is stored, but Claude Code installs it in the in-memory transcript the estimate
  // reads only a tick later, so a refresh right here would measure the window one row behind.
  // A timer past that tick waits for the install; it also keeps a slow estimate from holding up
  // the append, and a failing hook still lets the row through (the handler replays what next
  // settled to, or runs it).
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    // A subagent's rows fill its own window; queue records and notices are never in the model's.
    if (!e.agentId && e.door !== 'queue' && e.door !== 'notice') $.clock.after(AFTER_APPEND_MS, () => void scheduleRefresh($))
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await scheduleRefresh($) // a subagent's turn fills its own window, not this one
    return r
  })

  // /clear, /compact and /resume swap the transcript without a turn ending. The command resolves
  // before Claude Code installs the new transcript, so the refresh waits past the install.
  on('command.run', { command: ['clear', 'compact', 'resume'] }, async ($, e, next) => {
    const r = await next(e)
    refreshAfterSwap($)
    return r
  }).catch(($, e, next) => next(e))

  // Best effort for compactions no command announces: auto-compaction and a plugin's own.
  // A manual /compact is already covered by the command.run hook above, and `precompute`
  // installs nothing; a subagent compacts its own window. An organization's managed settings
  // may keep this hook from running in an installed plugin; the rows appended by the model's
  // next reply then refresh the bar instead.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && (e.trigger === 'auto' || e.trigger === 'plugin') && 'messages' in r) refreshAfterSwap($)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'context-bar' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    await $.store.set('isHidden', hidden).catch(() => {})
    if (!hidden) await scheduleRefresh($)
    return { text: hidden ? 'Context bar hidden. /context-bar shows it again' : 'Context bar on' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays, drawn above the box so one-row mods stay visible
    const r = await read($, reading)
    if (e.props.hasSurvey || (await read($, isHidden)) || !r) return rest
    const { Box, Text } = $.ui.resolve(e)
    const inner = e.props.bodyColumns - 4 // the border and padding take 4 cells
    if (inner < MIN_WIDTH) return rest

    const head = `${tokens(r.total)} of ${tokens(r.window)}${r.compactsAt ? ` · compacts at ${tokens(r.compactsAt)}` : ''}`
    const pct = ` ${r.percent}% `
    const level = r.compactsAt ? r.total / r.compactsAt : r.total / r.window
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color="#d97757">{'◆ '}</Text>
              <Text bold>context</Text>
            </Text>
            <Text wrap="truncate-start">
              <Text dimColor>{`${head} `}</Text>
              <Text bold color="black" backgroundColor={level >= 0.9 ? 'red' : level >= 0.7 ? 'yellow' : 'green'}>{pct}</Text>
            </Text>
          </Box>
          <Text>
            {cells(r, inner).map(c => (
              <Text color={c.color}>{c.text}</Text>
            ))}
          </Text>
          {legend(r, inner).map(line => (
            <Text wrap="truncate-end">
              {line.map((s, i) => (
                <Text>
                  {i > 0 && <Text>{SPLIT}</Text>}
                  <Text color={s.color}>{s.kind === 'used' ? '■ ' : `${GLYPH[s.kind]} `}</Text>
                  <Text dimColor={s.kind !== 'used'}>{`${s.name} `}</Text>
                  <Text bold={s.kind === 'used'}>{tokens(s.tokens)}</Text>
                  {s.kind === 'used' && <Text dimColor>{` ${share(s.tokens, r.window)}`}</Text>}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}

// One refresh at a time: a request while one runs marks the reading stale, and exactly one
// more refresh follows. Concurrent reads could land out of order and leave an older total
// over a newer one; this way the last reading drawn is always taken after the last request.
// Resolves when the reading is current; never rejects (a failed estimate keeps the old one).
// The follow-up pass reuses the first caller's `$`: the engine refuses a module that keeps `$`
// in a variable, so the newest caller's cannot be swapped in.
let running: Promise<void> | undefined
let isStale = false
function scheduleRefresh($: EngineInterface): Promise<void> {
  if (running) {
    isStale = true
    return running
  }
  running = (async () => {
    do {
      isStale = false
      await refresh($).catch(() => {})
    } while (isStale)
    running = undefined
  })()
  return running
}

// A swapped transcript is installed only after the chain announcing the swap (command.run,
// session.compact) resolves, so a refresh there still measures the old one. This re-reads on a
// few timers past that point: bounded, each a local estimate, coalesced by scheduleRefresh.
// Timers rather than sleeps, as the hook's dispatch ends before they fire; a refused timer
// only loses that one re-read. The delays are a guess with no install event to wait on: an
// install slower than the last one (a large /resume) leaves the bar stale until the next row.
const AFTER_SWAP_MS = [50, 500, 2000]
function refreshAfterSwap($: EngineInterface) {
  for (const ms of AFTER_SWAP_MS) $.clock.after(ms, () => void scheduleRefresh($))
}

// Asks the engine for /context's breakdown, estimated locally (no token-count calls).
async function refresh($: EngineInterface) {
  if (await read($, isHidden)) return
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b || !(b.rawMaxTokens > 0)) return // no window to measure against
  await update($, reading, () => toReading(b))
}

export function toReading(b: {
  categories: { name: string; tokens: number; color: string; kind: string }[]
  totalTokens: number
  rawMaxTokens: number
  percentage: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
}): Reading {
  const slices: Slice[] = b.categories
    .filter(c => c.kind !== 'deferred' && c.tokens > 0)
    .map(c => ({ name: c.name.toLowerCase(), tokens: c.tokens, color: c.color, kind: c.kind as Slice['kind'] }))
  const order = { used: 0, free: 1, buffer: 2 }
  slices.sort((x, y) => order[x.kind] - order[y.kind]) // stable: used rows keep /context's order
  let next = 0
  for (const s of slices) {
    s.color = s.kind === 'free' ? FREE : s.kind === 'buffer' ? BUFFER : s.name === 'messages' ? MESSAGES : PALETTE[next++ % PALETTE.length]!
  }
  return {
    slices,
    total: b.totalTokens,
    window: b.rawMaxTokens,
    percent: b.percentage,
    compactsAt: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
  }
}

// The bar as runs of cells: each slice gets its share of `width`, a used one at least one cell.
export function cells(r: Reading, width: number) {
  const sizes = r.slices.map(s => Math.max(s.kind === 'used' ? 1 : 0, Math.round((s.tokens / r.window) * width)))
  // Rounding leaves the sum a few cells off: free space takes the difference first, then the largest slices.
  let diff = width - sizes.reduce((a, n) => a + n, 0)
  const isUsed = (i: number) => r.slices[i]!.kind === 'used'
  const order = r.slices.map((_, i) => i).sort((a, b) => Number(isUsed(a)) - Number(isUsed(b)) || sizes[b]! - sizes[a]!)
  for (const i of order) {
    if (diff === 0) break
    const size = Math.max(isUsed(i) ? 1 : 0, sizes[i]! + diff)
    diff -= size - sizes[i]!
    sizes[i] = size
  }
  return r.slices.map((s, i) => ({ color: s.color, kind: s.kind, text: GLYPH[s.kind].repeat(sizes[i]!) })).filter(c => c.text !== '')
}

// The legend, packed into lines no wider than `width`.
export function legend(r: Reading, width: number) {
  const lines: Slice[][] = [[]]
  let used = 0
  for (const s of r.slices) {
    const size = 2 + s.name.length + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0)
    const line = lines.at(-1)!
    if (line.length > 0 && used + SPLIT.length + size > width) {
      lines.push([s])
      used = size
    } else {
      used += (line.length > 0 ? SPLIT.length : 0) + size
      line.push(s)
    }
  }
  return lines.filter(l => l.length > 0)
}

// Compact token count: '950', '3.4k', '186k', '1.2M'. Values that round to 1000k (from 999_500)
// already read as a million, so the M branch starts there.
export function tokens(n: number) {
  if (n >= 999_500) return `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}k`
  return String(n)
}

export function share(n: number, window: number) {
  const p = (n / window) * 100
  if (p > 0 && p < 0.1) return '<0.1%'
  return `${p >= 10 ? Math.round(p) : +p.toFixed(1)}%`
}
