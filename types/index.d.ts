export type Tier = 'light' | 'standard' | 'deep'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type Route = { model: string; effort: Effort }

export type Config = {
  isOn: boolean
  classifier: string
  keepModelAboveTokens: number
  routes: Record<Tier, Route>
}

export type Decision = {
  tier: Tier
  model: string
  effort: Effort
  note?: string
  answeredBy?: string
}

declare module 'claude-code' {
  interface PluginState {
    'auto-model': { last: Decision | null }
  }
}
