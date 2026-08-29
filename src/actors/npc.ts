import { actor } from "rivetkit";
import { generateNpcReply } from "../llm";

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
// Keeping this bounded is what keeps per-turn Gemini cost predictable as
// memory grows over many in-game days.
const MEMORY_WINDOW = 20;

export const npc = actor({
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

      state.memory.push({ day: state.currentDay, speaker: "npc", text: reply });
      state.relationships[playerId] = (state.relationships[playerId] ?? 0) + scoreDelta(message);

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
