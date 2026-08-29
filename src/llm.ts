import type { MemoryEntry } from "./actors/npc";

interface ReplyInput {
  name: string;
  personality: string;
  currentDay: number;
  relationshipScore: number;
  recentMemory: MemoryEntry[];
  playerId: string;
  message: string;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Any OpenRouter model slug works here, e.g. "anthropic/claude-3-5-sonnet"
// or "google/gemini-2.5-flash". Override with OPENROUTER_MODEL in .env
// without touching this file.
const DEFAULT_MODEL = "openai/gpt-4o";

export async function generateNpcReply(input: ReplyInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it in your local .env (dev) or Vercel Environment Variables (prod)."
    );
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const memoryText = input.recentMemory
    .map((m) => `Day ${m.day} - ${m.speaker}: ${m.text}`)
    .join("\n");

  const systemPrompt = `You are ${input.name}, an NPC in a life-sim game. Personality: ${input.personality}.
It is day ${input.currentDay}. Your relationship score with "${input.playerId}" is ${input.relationshipScore} (higher = friendlier, can be negative).

Recent memory of this relationship:
${memoryText || "(no prior memory yet)"}

Reply in character, 1-3 sentences. Let the relationship score and memory visibly color your tone. Never break character or mention that you are an AI or a language model.`;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional per OpenRouter docs, but harmless to include — identifies
      // the app on their dashboard/leaderboards.
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:8080",
      "X-Title": "NPC Memory Demo",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.8,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = data.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error("OpenRouter API returned no text in its response.");
  }

  return reply.trim();
}
