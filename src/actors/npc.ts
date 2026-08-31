import { actor } from "rivetkit";
import { generateNpcReply } from "../llm.ts";

export interface MemoryEntry {
  day: number;
  speaker: string; // playerId, or "npc"
  text: string;
}

export interface NpcState {
  name: string;
  personality: string;
  currentDay: number;
  memory: MemoryEntry[];
  relationships: Record<string, number>; // playerId -> affinity score
}

export interface NpcCreateInput {
  name: string;
  personality: string;
}

// How much memory (in entries) we actually feed back into the LLM prompt.
// Keeping this bounded is what keeps per-turn LLM cost predictable as
// memory grows over many in-game days.
const MEMORY_WINDOW = 20;

export const npc = actor({
  // ── PERSISTENCE POINT #1 ─────────────────────────────────────────
  // Whatever this function returns becomes `c.state` below, and RivetKit
  // durably stores it. This is the entire difference between an actor and
  // a normal HTTP handler: in a stateless server, this object would be a
  // local variable that dies the instant the request finishes. Here, it
  // survives page refreshes, server restarts, and redeploys, because it
  // isn't held in this process's memory at all — RivetKit's storage layer
  // owns it. `createState` only runs ONCE, the first time this actor is
  // created; every later call reads/writes the same persisted object.
  createState: (_c, input: NpcCreateInput): NpcState => ({
    name: input.name,
    personality: input.personality,
    currentDay: 0,
    memory: [],
    relationships: {},
  }),

  actions: {
    // Player sends a line of dialogue, NPC replies in character and
    // remembers both sides of the exchange.
    talk: async (c, playerId: string, message: string) => {
      const state = c.state;

      // ── PERSISTENCE POINT #2 ───────────────────────────────────────
      // This mutation is the whole trick. There is no explicit save(),
      // no database write, no "commit" call — RivetKit persists this
      // array push automatically because `state` IS the actor's durable
      // storage, not a copy of it. Compare this to a typical Express/Hono
      // route handler: if you pushed to an in-memory array there, it
      // would vanish the moment that request's process ends or restarts.
      state.memory.push({ day: state.currentDay, speaker: playerId, text: message });

      const recentMemory = state.memory.slice(-MEMORY_WINDOW);

      const reply = await generateNpcReply({
        name: state.name,
        personality: state.personality,
        currentDay: state.currentDay,
        relationshipScore: state.relationships[playerId] ?? 0,
        recentMemory,
        playerId,
        message,
      });

      // Same guarantee applies here — the NPC's own reply is written to
      // the same durable state as the player's message.
      state.memory.push({ day: state.currentDay, speaker: "npc", text: reply });
      state.relationships[playerId] = (state.relationships[playerId] ?? 0) + scoreDelta(message);

      // `c.broadcast` is a SEPARATE mechanism from persistence — it pushes
      // a live event to any connected client (see client/main.ts's
      // `conn.on("npcReply", ...)`). Persistence is what survives a
      // refresh; broadcast is what updates an already-open tab instantly.
      c.broadcast("npcReply", {
        playerId,
        reply,
        day: state.currentDay,
        relationship: state.relationships[playerId],
      });

      return { reply, day: state.currentDay, relationship: state.relationships[playerId] };
    },

    // Debug/demo-only: fast-forwards simulated days so the "evolves over
    // time" behavior can be shown live instead of requiring real elapsed
    // time. This is announced to the player, never silently faked.
    skipDays: (c, days: number) => {
      const delta = Math.max(1, Math.floor(days));
      c.state.currentDay += delta;
      c.broadcast("dayChanged", c.state.currentDay);
      return c.state.currentDay;
    },

    // ── PERSISTENCE POINT #3 (the proof) ────────────────────────────
    // This is what client/main.ts calls immediately on page load, BEFORE
    // any message is sent. It reads `c.state.memory` — the same object
    // from createState — directly off durable storage. If you refresh the
    // browser tab right now, this is the call that repopulates the whole
    // conversation. There is no client-side cache making that happen.
    getMemory: (c) => c.state.memory,

    getStatus: (c) => ({
      name: c.state.name,
      currentDay: c.state.currentDay,
      relationships: c.state.relationships,
    }),
  },
});

// Placeholder sentiment nudge. This is intentionally simple — swap for a
// real classifier or a structured field from the LLM response later.
function scoreDelta(message: string): number {
  const positive = /\b(thank|help|friend|gift|please)\b/i.test(message);
  const negative = /\b(hate|stupid|kill|steal)\b/i.test(message);
  if (positive) return 1;
  if (negative) return -1;
  return 0;
}
