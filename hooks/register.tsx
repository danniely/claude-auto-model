import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Config, Decision, Effort, Tier } from '../types'

const last = atom({ plugin: 'auto-model', key: 'last' } as const, null)

const TIERS: readonly Tier[] = ['light', 'standard', 'deep']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable']
const MODEL_IDS: Record<string, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
  fable: 'claude-fable-5-1',
}

const DEFAULTS: Config = {
  isOn: true,
  classifier: 'haiku',
  keepModelAboveTokens: 40000,
  routes: {
    light: { model: 'sonnet', effort: 'low' },
    standard: { model: 'sonnet', effort: 'medium' },
    deep: { model: 'opus', effort: 'high' },
  },
}

const SYSTEM = `You route requests sent to a coding agent. Read the user's latest message and answer with exactly one word, nothing else:
light - a quick question, a lookup, explaining a small snippet, a rename, formatting, a trivial or one-line edit, running a known command.
standard - normal feature work, a bug fix with a known cause, writing tests, a well-scoped change across a few files.
deep - architecture or design, a bug whose cause is unknown, a large refactor, a security or correctness review, research across many files or sources, planning, or anything the user calls hard.
same - a short follow-up that only continues the previous task ("ok", "go ahead", "yes", "continue", "do it"), so the previous tier still applies.`

const COMMAND_HELP = 'on | off | set <tier> <model> <effort> | keep <tokens> | reset | log | status'

const resolveModel = (model: string): string => MODEL_IDS[model] ?? model

const rank = (model: string): number => FAMILIES.findIndex(family => model.includes(family))

const short = (model: string): string => model.replace(/^claude-/, '')

const label = (decision: Decision): string => {
  const answered =
    decision.answeredBy !== undefined && decision.answeredBy !== decision.model
      ? `, answered by ${short(decision.answeredBy)}`
      : ''
  const note = decision.note === undefined ? '' : ` (${decision.note})`

  return `auto · ${decision.tier} → ${short(decision.model)} · ${decision.effort}${note}${answered}`
}

async function loadConfig($: EngineInterface): Promise<Config> {
  const saved = ((await $.store.get('config')) ?? {}) as Partial<Config>

  return { ...DEFAULTS, ...saved, routes: { ...DEFAULTS.routes, ...saved.routes } }
}

async function classify(
  $: EngineInterface,
  config: Config,
  text: string,
  previous: Tier | undefined,
): Promise<Tier | 'same' | undefined> {
  const reply = await $.model.complete({
    model: config.classifier,
    system: SYSTEM,
    prompt: `Previous tier: ${previous ?? 'none'}\n\n<message>\n${text.slice(0, 6000)}\n</message>`,
    maxTokens: 16,
    timeoutMs: 6000,
  })
  if (!reply.isAnswered) {
    return undefined
  }
  const word = reply.text.trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? ''

  return word === 'same' || TIERS.includes(word as Tier) ? (word as Tier | 'same') : undefined
}

// A cheaper model reads none of the cache the current one has warmed, so a long context stays where it is.
async function settle($: EngineInterface, planned: Decision, warm: string): Promise<Decision> {
  if (rank(planned.model) >= rank(warm)) {
    return planned
  }
  const config = await loadConfig($)
  const tokens = (await $.session.usage()).context.tokens ?? 0
  if (tokens <= config.keepModelAboveTokens) {
    return planned
  }

  return { ...planned, model: warm, note: `kept ${short(warm)}: ${Math.round(tokens / 1000)}k tokens cached` }
}

export const register: Register = on => {
  let previous: Tier | undefined
  let warmModel: string | undefined
  const byTurn = new Map<string, Decision>()
  const history: Decision[] = []
  const trace: Record<string, unknown>[] = []

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'auto-model', description: `Auto model/effort routing: ${COMMAND_HELP}` })

    return next(e)
  })

  on('command.run', { command: 'auto-model' }, async ($, e) => {
    const [verb = 'status', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const config = await loadConfig($)

    if (verb === 'on' || verb === 'off') {
      await $.store.set('config', { ...config, isOn: verb === 'on' })
      if (verb === 'off') {
        await update($, last, () => null)
        $.ui.status(undefined)
      }

      return { text: `Auto model routing is ${verb}.` }
    }
    if (verb === 'set') {
      const [tier, model, effort] = rest
      const isModel = model !== undefined && (model in MODEL_IDS || model.startsWith('claude-'))
      if (!TIERS.includes(tier as Tier) || !isModel || !EFFORTS.includes(effort as Effort)) {
        return { text: `Usage: /auto-model set <${TIERS.join('|')}> <${Object.keys(MODEL_IDS).join('|')}|claude-…> <${EFFORTS.join('|')}>` }
      }
      const routes = { ...config.routes, [tier as Tier]: { model, effort: effort as Effort } }
      await $.store.set('config', { ...config, routes })

      return { text: `${tier} → ${model} · ${effort}` }
    }
    if (verb === 'keep') {
      const tokens = Number(rest[0])
      if (!Number.isInteger(tokens) || tokens < 0) {
        return { text: 'Usage: /auto-model keep <tokens>' }
      }
      await $.store.set('config', { ...config, keepModelAboveTokens: tokens })

      return { text: `A cheaper model is not switched to above ${tokens} context tokens.` }
    }
    if (verb === 'reset') {
      await $.store.delete('config')

      return { text: 'Auto model routing is back to its defaults.' }
    }
    if (verb === 'log') {
      const saved = ((await $.store.get('trace')) ?? []) as Record<string, unknown>[]

      return { text: saved.length === 0 ? 'No routed turns yet.' : saved.slice(-20).map(row => JSON.stringify(row)).join('\n') }
    }
    if (verb !== 'status') {
      return { text: `Usage: /auto-model ${COMMAND_HELP}` }
    }
    const routes = TIERS.map(tier => `  ${tier}: ${config.routes[tier].model} · ${config.routes[tier].effort}`)
    const recent = history.slice(-10).map(decision => `  ${label(decision)}`)

    return {
      text: [
        `Auto model routing is ${config.isOn ? 'on' : 'off'} (classifier ${config.classifier}).`,
        ...routes,
        `  no downgrade above ${config.keepModelAboveTokens} context tokens`,
        recent.length === 0 ? 'No routed turns yet.' : 'Recent turns:',
        ...recent,
      ].join('\n'),
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }
    const config = await loadConfig($)
    if (!config.isOn) {
      return next(e)
    }
    const text = e.text.trim()
    const verdict = text === '' ? 'same' : await classify($, config, text, previous).catch(() => undefined)
    const tier = verdict === 'same' || verdict === undefined ? previous : verdict
    trace.push({ at: 'turn.start', turnId: e.turnId, verdict: verdict ?? 'unclassified', tier: tier ?? 'passthrough' })
    await $.store.set('trace', trace.slice(-50))
    if (tier !== undefined) {
      const route = config.routes[tier]
      byTurn.set(e.turnId, { tier, model: resolveModel(route.model), effort: route.effort })
      previous = tier
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const planned = e.agentId === undefined ? byTurn.get(e.turnId) : undefined
    if (planned === undefined) {
      return yield* next(e)
    }
    const decision = e.index === 0 ? await settle($, planned, warmModel ?? e.model) : planned
    byTurn.set(e.turnId, decision)
    const result = yield* next({ ...e, model: decision.model, effort: decision.effort })
    warmModel = decision.model
    if (e.index === 0) {
      const shown: Decision = { ...decision, answeredBy: result.usage?.model }
      history.push(shown)
      history.splice(0, Math.max(0, history.length - 20))
      trace.push({ at: 'turn.step', turnId: e.turnId, sessionModel: e.model, ...shown })
      await $.store.set('trace', trace.slice(-50))
      await update($, last, () => shown)
      $.ui.status(label(shown))
    }

    return result
  })

  on('turn.complete', ($, e, next) => {
    byTurn.delete(e.turnId)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, last)
    if (shown === null || e.props.hasSurvey) {
      return next(e)
    }
    const { Text } = $.ui.resolve(e)

    return <Text dimColor>{label(shown)}</Text>
  })
}
