## Why this works

Most "AI with memory" demos fake persistence: they hold conversation
history in a browser variable or a server's in-memory array, which means
memory quietly dies on refresh, restart, or redeploy. This project doesn't
do that.

The actual proof is three specific lines in `src/actors/npc.ts`:

1. **`createState`** — returns the object that RivetKit durably stores.
   This isn't a cache in front of a database; it *is* the storage.
2. **`state.memory.push(...)` inside `talk`** — an ordinary array mutation
   that RivetKit persists automatically, with no explicit save/write call.
3. **`getMemory`** — called by the client on page load, before any message
   is sent. It's what repopulates your conversation after a refresh, and
   it's reading straight off durable state, not a client-side cache.

If you comment out RivetKit's actor persistence and swap in a plain
in-memory object instead, `getMemory` would return `[]` after every
refresh. That's the entire difference this project demonstrates.
