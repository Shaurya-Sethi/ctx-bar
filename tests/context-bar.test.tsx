import { describe, expect, mock, test } from 'claude-code/testing'

import { cells, legend, share, toReading, tokens } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 84 } }

// /context's breakdown as the engine hands it over, for a 1M window.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3_400, color: 'promptBorder', kind: 'used', isDeferred: false },
    { name: 'System tools', tokens: 12_000, color: 'inactive', kind: 'used', isDeferred: false },
    { name: 'MCP tools', tokens: 2_600, color: 'cyan_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'MCP tools (deferred)', tokens: 40_000, color: 'inactive', kind: 'deferred', isDeferred: true },
    { name: 'Skills', tokens: 0, color: 'warning', kind: 'used', isDeferred: false },
    { name: 'Messages', tokens: 186_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used', isDeferred: false },
    { name: 'Autocompact buffer', tokens: 50_000, color: 'inactive', kind: 'buffer', isDeferred: false },
    { name: 'Free space', tokens: 746_000, color: 'promptBorder', kind: 'free', isDeferred: false },
  ],
  totalTokens: 204_000,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 20,
  autoCompactThreshold: 950_000,
  isAutoCompactEnabled: true,
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  model: 'opus',
  apiUsage: null,
  autocompactSource: 'model-default',
}

// Stands for the engine beneath the mod.
// `live` is the window as the engine would estimate it now; a read waits on `gate`, when set, before answering.
function engine(on: any, store: Record<string, unknown> = {}) {
  const asked: unknown[] = []
  const live: { total: number; gate?: Promise<unknown> } = { total: 204_000 }
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('turn.complete', () => ({ text: '' }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = e.value), { value: undefined }))
  on('session.usage', async (_$: any, e: any) => {
    asked.push(e)
    const { total, gate } = live // read now, answered once the gate opens, as a slow estimate would be
    if (gate) await gate
    const breakdown = { ...BREAKDOWN, totalTokens: total, percentage: Math.round(total / 10_000) }
    return { value: { startedAt: 0, context: { tokens: total, window: 1_000_000, percent: breakdown.percentage, breakdown }, rateLimits: {}, cost: { usd: 0 } } }
  })
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { asked, store, live }
}

const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // the first refresh runs in the background

describe('context-bar', () => {
  test('helpers', () => {
    expect(tokens(3_400)).toBe('3.4k')
    expect(tokens(186_000)).toBe('186k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(999_499)).toBe('999k')
    expect(tokens(999_500)).toBe('1M')
    expect(tokens(999_600)).toBe('1M') // rounds up to a million, never '1000k'
    expect(tokens(950)).toBe('950')
    expect(share(3_400, 1_000_000)).toBe('0.3%')
    expect(share(186_000, 1_000_000)).toBe('19%')
    expect(share(494, 1_000_000)).toBe('<0.1%')

    const r = toReading(BREAKDOWN)
    // Deferred and empty rows are left out; used first, then free, then the buffer.
    expect(r.slices.map(s => s.name)).toEqual(['system prompt', 'system tools', 'mcp tools', 'messages', 'free space', 'autocompact buffer'])
    expect(r.compactsAt).toBe(950_000)
    // Every used row has its own color, and none matches free space or the buffer.
    const colors = r.slices.filter(s => s.kind === 'used').map(s => s.color)
    expect(new Set(colors).size).toBe(colors.length)
    expect(cells(r, 80).find(c => c.kind === 'buffer')?.text).toMatch(/^░+$/)
    expect(cells(r, 80).find(c => c.kind === 'free')?.text).toMatch(/^─+$/)

    for (const width of [20, 47, 80, 200]) {
      const bar = cells(r, width)
      expect(bar.reduce((n, c) => n + c.text.length, 0)).toBe(width) // always exactly the width
      expect(bar.filter(c => c.kind === 'used').every(c => c.text.length >= 1)).toBe(true) // a small used slice still shows
    }
    for (const line of legend(r, 40)) {
      const size = line.reduce((n, s, i) => n + (i ? 3 : 0) + 2 + s.name.length + 1 + tokens(s.tokens).length + (s.kind === 'used' ? 1 + share(s.tokens, r.window).length : 0), 0)
      expect(size <= 40 || line.length === 1).toBe(true)
    }
    expect(toReading({ ...BREAKDOWN, isAutoCompactEnabled: false }).compactsAt).toBeUndefined()
  })

  test('draws the bar and legend above the prompt from a summary breakdown', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect(asked).toEqual([{ breakdown: 'summary' }]) // estimated locally, never the token-count API

    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /204k of 1M · compacts at 950k/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: / 20% / })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^messages $/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^186k$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /mcp tools \(deferred\)/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'band below' })).toBeDefined() // the band beneath stays
    // the box is the bottom of the stack: what other mods draw sits above it
    const root: any = await band.drawn()
    const kids = root.children as any[]
    expect(kids[0].children).toEqual(['band below'])
    expect(kids[1].props.borderStyle).toBe('round')
    await band.unmount()
  })

  test('refreshes after a main turn, not after a subagent turn', async ($, on) => {
    const { asked } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, agentId: 'a1' } as any)
    expect(asked.length).toBe(1)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(asked.length).toBe(2)
  })

  // Like Claude Code: an append resolves once the row is stored, and the in-memory transcript
  // the estimate reads takes the row a tick later, so a refresh right at resolve reads the old total.
  test('grows with each row the main conversation keeps, once it is installed, before the turn ends', async ($, on) => {
    const { live } = engine(on)
    const clock = mock.clock(on)
    live.total = 18_000
    on('session.append', async (_$: any, e: any, next: any) => {
      const r = await next(e)
      ;(globalThis as any).setTimeout(() => (live.total = 22_600), 0)
      return r
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    await $.session.append({ message: { type: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output' }] } } as any)
    await settle() // the row is installed by now; a refresh at resolve would have read 18k
    await clock.advance(1) // the first re-read, right after the install tick
    await settle()
    expect(await band.find({ type: 'Text', text: /23k of 1M/ })).toBeDefined()
    await band.unmount()
  })

  // Host scheduling does not promise the install lands within a tick; a later re-read catches it.
  test('a row installed late still reaches the bar before the next row', async ($, on) => {
    const { live } = engine(on)
    const clock = mock.clock(on)
    live.total = 18_000
    on('session.append', async (_$: any, e: any, next: any) => {
      const r = await next(e)
      void clock.sleep(100).then(() => (live.total = 22_600))
      return r
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    await $.session.append({ message: { type: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output' }] } } as any)
    await clock.advance(1)
    await settle()
    expect(await band.find({ type: 'Text', text: /18k of 1M/ })).toBeDefined() // not installed yet
    await clock.advance(300)
    await settle()
    expect(await band.find({ type: 'Text', text: /23k of 1M/ })).toBeDefined()
    await band.unmount()
  })

  test('a row a subagent keeps does not refresh the bar', async ($, on) => {
    const { asked } = engine(on)
    const clock = mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: 'a row' }] }, agentId: 'a1' } as any)
    await clock.advance(100)
    await settle()
    expect(asked.length).toBe(1)
  })

  test('a burst of rows leaves the newest reading, not a slower older one', async ($, on) => {
    const { live } = engine(on)
    const clock = mock.clock(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    let open!: () => void
    live.total = 210_000
    live.gate = new Promise<void>(done => (open = done)) // this read is slow
    const row = { message: { type: 'user', content: [{ type: 'text', text: 'a row' }] } } as any
    await $.session.append(row)
    await clock.advance(1) // its refresh starts, and waits on the slow read
    live.total = 230_000
    live.gate = undefined // the next ones are fast, so without care they land before the slow one
    await $.session.append(row)
    await clock.advance(1)
    await $.session.append(row)
    await clock.advance(1)
    await settle()
    open() // the slow read answers last
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any) // resolves once the reading is current
    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /230k of 1M/ })).toBeDefined()
    await band.unmount()
  })

  // Like Claude Code: a command or compaction that swaps the transcript resolves first, and the
  // new transcript is installed only afterwards, so the estimate changes only then.
  for (const swap of ['compact', 'clear', 'resume']) {
    test(`/${swap} shows the new transcript once it is installed`, async ($, on) => {
      const { live } = engine(on)
      const clock = mock.clock(on)
      on('command.run', () => ({ text: '' }))
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
      await settle()
      await $.command.run({ command: swap, args: '' } as any)
      live.total = 16_000 // installed after the command resolved
      await clock.advance(5_000)
      const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
      expect(await band.find({ type: 'Text', text: /16k of 1M/ })).toBeDefined()
      await band.unmount()
    })
  }

  test('an auto-compaction shows the compacted transcript once it is installed', async ($, on) => {
    const { live } = engine(on)
    const clock = mock.clock(on)
    on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
    live.total = 30_000
    await clock.advance(5_000)
    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /30k of 1M/ })).toBeDefined()
    await band.unmount()
  })

  // precompute installs nothing; a manual compaction is refreshed by its /compact command instead.
  for (const trigger of ['precompute', 'manual']) {
    test(`a ${trigger} compaction alone does not refresh`, async ($, on) => {
      const { asked } = engine(on)
      const clock = mock.clock(on)
      on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }))
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
      await settle()
      await $.session.compact({ trigger, messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
      await clock.advance(5_000)
      expect(asked.length).toBe(1)
    })
  }

  test('/context-bar hides and shows it, and remembers the choice', async ($, on) => {
    const { store } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toMatch(/hidden/)
    expect(store.isHidden).toBe(true)
    let band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeUndefined()
    await band.unmount()

    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toBe('Context bar on')
    expect(store.isHidden).toBe(false)
    band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeDefined()
    await band.unmount()
  })

  test('a session that hid it starts hidden', async ($, on) => {
    engine(on, { isHidden: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await settle()
    const band = await $.ui.mount({ plugin: 'ctx-bar', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /of 1M/ })).toBeUndefined()
    await band.unmount()
    // the stored choice was loaded, not just left unset, so the next toggle shows it
    expect((await $.command.run({ command: 'context-bar', args: '' } as any)).text).toBe('Context bar on')
  })
})
