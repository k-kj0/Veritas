# Veritas

**An AI memory demo where the memory lives in a [Rivet Actor](https://rivet.dev/actors/docs/), not in the browser.**

Live demo: https://veritas-eta-nine.vercel.app

Most "AI with memory" demos keep history in a browser variable or a server array, so it disappears on refresh, restart or redeploy. In Veritas, a character called **Mira** keeps her memory in durable actor state. Tell her something, refresh the page, redeploy the app: she still knows.

> Solo project, self-tested. Built to learn Rivet Actors by using them for real.

## Try it

Open the demo and click an example card, or type your own message.

| Try this | What it shows |
| --- | --- |
| "Hi, I'm Kavya. I'm a final-year student..." | She stores the message. The "Your name" fact appears. |
| "What do you remember about me so far?" | She answers from stored history and summary. |
| "Thanks, that was really helpful." | The Trust meter moves (she scores each message from -2 to +2). |
| Refresh the page | History, day and trust load back from the actor. |
| Open the "What Mira remembers" panel | Live values read from the actor with an `inspect` action. |

## Why it is not a fake

The proof is in `src/actors/npc.ts`:

- `createState` returns the object RivetKit durably stores. It is the storage, not a cache in front of a database.
- `state.memory.push(...)` inside `talk` is a plain array mutation. There is no explicit save call.
- `getMemory` is called by the client on page load, before any message is sent. It repopulates the chat from durable state.

Replace the actor state with a plain in-memory object and `getMemory` returns `[]` after every refresh. That difference is the whole demo.

## What the actor does

- **Durable memory:** every message is written to actor state.
- **Memory compaction:** past 20 stored messages, older ones are summarized by the model into a short `summary` and only the newest 10 stay verbatim, so state stays bounded.
- **Relationship score:** each reply ends with a `MOOD: n` line (-2 to 2) that the actor parses and applies to a 0-10 trust value.
- **Durable timer:** the actor advances its own "day" every 5 minutes using `c.schedule.after`. After 1 hour without messages it stops ticking so an unattended demo does not wake forever. The next message restarts the timer and catches the day count up (capped at 50).
- **Realtime events:** replies and day changes are pushed to connected clients with `c.broadcast`.

## Architecture

```
Browser (client/main.ts)
   |  rivetkit/client over /api/rivet
   v
Vercel function (api/index.ts, Hono)  --- registry.handler ---+
                                                              |
Rivet Cloud (control plane, serverless mode) <----------------+
   |  starts the npc actor by calling /api/rivet on Vercel
   v
npc actor (src/actors/npc.ts)  ->  OpenRouter chat completion
```

| Path | Purpose |
| --- | --- |
| `src/actors/npc.ts` | The actor: state, actions, schedule, compaction |
| `src/registry.ts` | Registers the actor |
| `api/index.ts` | Hono app that hands `/api/rivet/*` to RivetKit |
| `client/main.ts` | Browser client, example cards, memory panel |
| `public/index.html` | UI |

## Configuration

Set these as environment variables in Vercel (never commit them):

| Variable | Notes |
| --- | --- |
| `RIVET_ENDPOINT` | Secret endpoint URL from the Rivet dashboard (Advanced). Server-side only. |
| `RIVET_PUBLIC_ENDPOINT` | Publishable endpoint URL, given to browsers. |
| `RIVETKIT_RUNTIME_MODE` | `serverless` |
| `OPENROUTER_API_KEY` | Model access |
| `OPENROUTER_MODEL` | Optional. Defaults to `openai/gpt-4o-mini`. |

Then, in Rivet Cloud, add a provider named `default` pointing at `https://<your-app>.vercel.app/api/rivet`, and enable the datacenters you want actors to run in.

## Lessons from deploying this

Notes from getting it running on Vercel with Rivet Cloud, in case they save someone time:

1. **Rivet needs to know your URL.** A correct Vercel deploy is not enough. Without a provider config named `default`, the client fails with `No runner config with name 'default'`.
2. **Enable more than one datacenter.** After adding the provider, the browser still failed with `actor.no_runner_config_configured`. Rivet's docs say actors are created in the region nearest the client by default, and my provider only had Northern Virginia enabled while I connect from India. Enabling all four datacenters fixed it. I believe that was the cause, but I did not isolate it further.
3. **Bump the actor key when you change an actor's initial state.** `createState` only runs when an actor is created, so existing actors keep their old shape.

## Known limitations

- Single hard-coded player and room (`demo-room`), so every visitor shares one Mira.
- The "Your name" fact is derived in the browser from stored messages with a simple pattern, not extracted by the model.
- No automated tests yet.
- No rate limiting on the model calls.
- Typechecked against `rivetkit`, but not covered by an end-to-end test.

## Roadmap

- Per-visitor actors, keyed by a random id
- Model-based fact extraction stored in actor state
- Tests for compaction and the idle timer
- Rate limiting

## Related

- Rivet Actors: https://rivet.dev/actors/docs/
- Personal agents guide ("one long-lived Actor per user"): https://rivet.dev/guides/ai-agent/
