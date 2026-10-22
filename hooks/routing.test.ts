import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type Sent = { model: string; effort?: string | number }

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function engine(on: Parameters<Parameters<typeof test>[1]>[1], contextTokens: () => number) {
  const sent: Sent[] = []
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'auto-model' } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: contextTokens(), window: 200000 }, rateLimits: [] } }))
  on('model.complete', (_, e) => {
    const text = /2\+2/.test(e.prompt) ? 'light' : /architecture/.test(e.prompt) ? 'deep' : /go ahead/.test(e.prompt) ? 'same' : 'standard'

    return { value: { isAnswered: true, text, usage: USAGE } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })

    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })
  on('turn.complete', () => ({ text: '' }))

  return sent
}

async function turn($: Engine, turnId: string, text: string, agentId?: string) {
  await $.turn.start({ turnId, text, agentId })
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1, agentId })
  for await (const _ of stream) {
    // drained
  }
  await stream.result
  await $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer', agentId })
}

test('routes each prompt by its tier and keeps the tier on a follow-up', async ($, on) => {
  const sent = engine(on, () => 1000)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await turn($, 't1', 'What is 2+2?')
  await turn($, 't2', 'Propose an architecture for sharding our event store')
  await turn($, 't3', 'ok go ahead')

  expect(sent).toEqual([
    { model: 'claude-sonnet-5-5', effort: 'low' },
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'high' },
  ])
})

test('does not move a long context to a cheaper model', async ($, on) => {
  let tokens = 1000
  const sent = engine(on, () => tokens)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await turn($, 't1', 'Propose an architecture for sharding our event store')
  tokens = 120000
  await turn($, 't2', 'What is 2+2?')

  expect(sent).toEqual([
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'low' },
  ])
})

test('off passes requests through, and subagents are never rewritten', async ($, on) => {
  const sent = engine(on, () => 1000)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await turn($, 't1', 'What is 2+2?', 'agent-1')
  await $.command.run({ command: 'auto-model', args: 'off' })
  await turn($, 't2', 'What is 2+2?')
  await $.command.run({ command: 'auto-model', args: 'on' })
  await $.command.run({ command: 'auto-model', args: 'set light haiku medium' })
  await turn($, 't3', 'What is 2+2?')

  expect(sent).toEqual([
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-opus-5-5', effort: 'high' },
    { model: 'claude-haiku-5-5', effort: 'medium' },
  ])
})
