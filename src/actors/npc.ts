import { actor } from "rivetkit";

type MemoryEntry = { day: number; speaker: string; text: string };
type NpcInput = { name: string; personality: string };
type NpcState = {
  name: string;
  personality: string;
  currentDay: number;
  relationships: Record<string, number>;
  memory: MemoryEntry[];
  summary: string;
};

// Memory compaction: once raw memory passes MAX_RAW, the oldest entries are
// folded into `summary` and only the newest KEEP_RECENT stay verbatim.
const MAX_RAW = 20;
const KEEP_RECENT = 10;

// Scheduled behavior: the actor advances its own day on a durable timer,
// even while no client is connected (the actor sleeps and Rivet wakes it).
const DAY_MS = 5 * 60 * 1000;

const MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

async function llm(system: string, user: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export const npc = actor({
  createState: (_c, input: NpcInput): NpcState => ({
    name: input?.name ?? "Mira",
    personality: input?.personality ?? "A cautious village herbalist who speaks plainly.",
    currentDay: 0,
    relationships: {},
    memory: [],
    summary: "",
  }),

  // Runs once, when the actor is first created. Starts the durable day timer.
  onCreate: async (c) => {
    await c.schedule.after(DAY_MS, "advanceDay");
  },

  actions: {
    talk: async (c, playerId: string, message: string) => {
      const s = c.state;
      s.memory.push({ day: s.currentDay, speaker: playerId, text: message });

      const score = s.relationships[playerId] ?? 0;
      const history = s.memory
        .slice(-KEEP_RECENT)
        .map((m) => `${m.speaker === "npc" ? s.name : "Player"}: ${m.text}`)
        .join("\n");

      const system =
        `You are ${s.name}. ${s.personality}\n` +
        `It is day ${s.currentDay}. Your relationship score with this player is ${score} (0 = stranger, 10 = close friend).\n` +
        (s.summary ? `What you remember from earlier: ${s.summary}\n` : "") +
        `Answer clearly and concisely (under 120 words); use plain text and short code lines if needed. Use what you remember about the player. ` +
        `End with one final line exactly like "MOOD: 1" where the number (-2 to 2) is how the player's last message changes your feelings.`;

      let reply = "";
      let delta = 0;
      try {
        const raw = await llm(system, history);
        const mood = raw.match(/MOOD:\s*(-?\d)/i);
        delta = mood ? Math.max(-2, Math.min(2, Number(mood[1]))) : 0;
        reply = raw.replace(/\n?\s*MOOD:[\s\S]*$/i, "").trim();
      } catch (err) {
        console.error("talk: LLM failed", err);
      }
      if (!reply) reply = "I lost my train of thought. Could you try that again?";

      s.memory.push({ day: s.currentDay, speaker: "npc", text: reply });
      s.relationships[playerId] = Math.max(0, Math.min(10, score + delta));

      await compact(c.state);

      const payload = {
        playerId,
        reply,
        day: s.currentDay,
        relationship: s.relationships[playerId],
      };
      c.broadcast("npcReply", payload);
      return payload;
    },

    // Fired by the durable schedule. Also reschedules itself.
    advanceDay: async (c) => {
      c.state.currentDay += 1;
      c.broadcast("dayChanged", c.state.currentDay);
      await c.schedule.after(DAY_MS, "advanceDay");
    },

    // Debug helper used by the demo button.
    skipDays: (c, n: number) => {
      c.state.currentDay += Math.max(1, Math.floor(n));
      c.broadcast("dayChanged", c.state.currentDay);
      return c.state.currentDay;
    },

    getMemory: (c) => c.state.memory,

    getStatus: (c) => ({
      currentDay: c.state.currentDay,
      relationships: c.state.relationships,
    }),

    // Raw durable state, shown in the demo's "actor state" panel.
    inspect: (c) => ({
      name: c.state.name,
      currentDay: c.state.currentDay,
      relationships: c.state.relationships,
      summary: c.state.summary,
      memoryCount: c.state.memory.length,
      recentMemory: c.state.memory.slice(-5),
    }),
  },
});

async function compact(s: NpcState) {
  if (s.memory.length <= MAX_RAW) return;
  const old = s.memory.slice(0, s.memory.length - KEEP_RECENT);
  const text = old.map((m) => `${m.speaker === "npc" ? s.name : "Player"}: ${m.text}`).join("\n");
  try {
    const merged = await llm(
      "Summarize what the character remembers about the player in under 80 words. Keep names, facts and how the player treated the character.",
      `${s.summary ? `Existing summary: ${s.summary}\n\n` : ""}New conversation:\n${text}`
    );
    s.summary = merged || s.summary;
  } catch (err) {
    console.error("compact: LLM failed, keeping a plain fallback", err);
    s.summary = `${s.summary} ${text}`.slice(-600);
  }
  s.memory = s.memory.slice(-KEEP_RECENT);
}
