# claude-auto-model

**Cursor Auto mode for Claude Code Desktop.**

Stop switching `/model` and `/effort` by hand: every prompt is sent to the model and effort it needs.

> Unofficial community plugin, not an Anthropic product. It uses Claude Code's function-hooks plugin API, which is early access and may change between releases. Built and tested on Claude Code 2.1.308.

## What it is

A Claude Code plugin (a "mod") that picks the model and the effort for each prompt you send:

- "What is 2+2?" → Sonnet, low effort
- "Add a test for this function" → Sonnet, medium effort
- "Design the sharding strategy for our event store" → Opus, high effort

It runs inside Claude Code itself. There is no server, proxy, or API key to set up: it uses your session's own login.

## Works with

| Where | Supported |
| --- | --- |
| Claude Desktop app, Code tab | ✅ |
| Claude Code CLI (`claude` in a terminal) | ✅ |
| claude.ai web chat, Desktop Chat tab | ❌ (not Claude Code) |

Both run the same Claude Code engine, so one user-scope install covers both. Requires a Claude Code version with the function-hooks `turn.step` event; tested on 2.1.308. On an older CLI, run `claude update` first.

## Why

Claude Code runs every prompt on one model and one effort until you change them. That leaves two bad defaults:

- **Always the big model:** simple questions burn Opus tokens and usage limits.
- **Always the small model:** hard tasks get a weaker answer unless you remember to switch.

Choosing per prompt by hand is friction most people skip. Model choice is one of the largest levers on token cost, and it should not depend on remembering a slash command.

## Inspiration

- **Cursor's Auto mode.** Cursor routes each request through [Cursor Router](https://cursor.com/blog/router), a classifier that sends simple tasks to cheaper models and complex ones to frontier models, and counts the cost of cache misses when it switches.
- **[anthropics/claude-code#43326](https://github.com/anthropics/claude-code/issues/43326).** "Auto-select model and effort level based on task complexity", a long-standing feature request. The thread notes that a `UserPromptSubmit` settings hook cannot change a running session's model. A function-hooks mod can, through the `turn.step` event.

This plugin is a local, open take on the same idea: a small classifier and a routing table you control.

## How it works

1. **Classify.** On each prompt, Haiku labels it `light`, `standard`, `deep`, or `same` (a short follow-up such as "ok, go ahead" that keeps the previous tier). One short call per prompt: at most 16 output tokens, 6-second timeout.
2. **Route.** The tier maps to a model and effort, and every request of that turn is sent with them. Subagents are left alone.
3. **Keep the cache.** A cheaper model reads none of the prompt cache the current one has warmed, so above 40k context tokens the model stays and only the effort changes.

If the classifier fails, the previous tier is kept; with no previous tier, the session's own model and effort are used.

| Tier | Default |
| --- | --- |
| `light` | sonnet · low |
| `standard` | sonnet · medium |
| `deep` | opus · high |

## How to run it

### 1. Install

From a shell:

```bash
claude plugin install auto-model --marketplace danniely/claude-auto-model
```

Or at the prompt of a Claude Code terminal session:

```
/plugin install auto-model --marketplace danniely/claude-auto-model
```

Answer `y` to add the marketplace, then pick the **user** scope. In the desktop app itself: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `danniely/claude-auto-model` → **Add plugin**.

### 2. Use Claude as usual

Open a new session (Claude Desktop Code tab or `claude` in a terminal) and type prompts as you normally would. The routed model shows above the prompt:

```
auto · light → sonnet-5-5 · low
```

The Desktop header keeps showing the session's own model; the line above the prompt is what each turn actually used.

### 3. Tune it

| Command | What it does |
| --- | --- |
| `/auto-model status` | Settings and the last 10 routed turns |
| `/auto-model log` | The last 20 classifier verdicts and routes |
| `/auto-model set <tier> <model> <effort>` | e.g. `/auto-model set standard opus medium` |
| `/auto-model keep <tokens>` | Context size above which the model is not downgraded |
| `/auto-model on` / `off` | Turn routing on or off |
| `/auto-model reset` | Back to the defaults |

Models: `haiku`, `sonnet`, `opus`, `fable`, or a full `claude-…` id. Efforts: `low`, `medium`, `high`, `xhigh`, `max`.

## Limits

- Every prompt costs one Haiku call, billed to your own usage.
- Switching models mid-conversation rewrites the prompt cache on the new model.
- The classifier is a prompt, not a trained router: it reads the message, not the outcome.

## Develop

```bash
claude --plugin-dir .
```

```bash
claude plugin test .
```

## License

MIT
