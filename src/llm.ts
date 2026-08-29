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

// Public API base. If you're on a Blackbox Enterprise plan, set
// BLACKBOX_API_BASE_URL=https://enterprise.blackbox.ai in your .env instead.
const DEFAULT_BASE_URL = "https://api.blackbox.ai";

// Any model id from Blackbox's catalog works here, e.g.
// "blackboxai/openai/gpt-5.5" or "blackboxai/anthropic/claude-opus-4.6".
// Override with BLACKBOX_MODEL in .env without touching this file.
const DEFAULT_MODEL = "blackboxai/openai/gpt-4o";

export async function generateNpcReply(input: ReplyInput): Promise<string> {
  const apiKey = process.env.BLACKBOX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BLACKBOX_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }

  const baseUrl = process.env.BLACKBOX_API_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.BLACKBOX_MODEL || DEFAULT_MODEL;

  const memoryText = input.recentMemory
    .map((m) => `Day ${m.day} - ${m.speaker}: ${m.text}`)
    .join("\n");

  const systemPrompt = `You are ${input.name}, an NPC in a life-sim game. Personality: ${input.personality}.
It is day ${input.currentDay}. Your relationship score with "${input.playerId}" is ${input.relationshipScore} (higher = friendlier, can be negative).

Recent memory of this relationship:
${memoryText || "(no prior memory yet)"}

Reply in character, 1-3 sentences. Let the relationship score and memory visibly color your tone. Never break character or mention that you are an AI or a language model.`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: 0.8,
      max_tokens: 200,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Blackbox API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const reply = data.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error("Blackbox API returned no text in its response.");
  }

  return reply.trim();
}
