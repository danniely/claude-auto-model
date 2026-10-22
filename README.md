# claude-auto-model

Cursor-style Auto mode for Claude Code: picks the model and effort for each prompt with a Haiku classifier.

> Unofficial community mod, not an Anthropic product. It uses Claude Code's function-hooks plugin API, which is early access and may change between releases. Built and tested on Claude Code 2.1.308.

## How it works

1. **Classify.** On each prompt, Haiku labels it `light`, `standard`, `deep`, or `same` (a short follow-up that keeps the previous tier). One short call per prompt: at most 16 output tokens, 6-second timeout.
2. **Route.** The tier maps to a model and effort, and every request of that turn is sent with them (`turn.step` hook). Subagents are left alone.
3. **Keep the cache.** A cheaper model reads none of the prompt cache the current one has warmed, so above 40k context tokens the model stays and only the effort changes.

If the classifier fails, the previous tier is kept; with no previous tier, the session's own model and effort are used.

| Tier | Default |
| --- | --- |
| `light` | sonnet · low |
| `standard` | sonnet · medium |
| `deep` | opus · high |

The routed model is shown above the prompt (`auto · light → sonnet-5-5 · low`). The Claude Desktop header keeps showing the session's own model.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install auto-model --marketplace danniely/claude-auto-model
```

From a shell:

```bash
claude plugin install auto-model --marketplace danniely/claude-auto-model
```

Answer `y` to add the marketplace, then pick the user scope. Installed at the user scope, it also loads in the sessions the Claude Desktop app's Code tab starts. In the desktop app itself: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `danniely/claude-auto-model` → **Add plugin**.

## Commands

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
