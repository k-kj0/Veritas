import { createClient } from "rivetkit/client";
import type { registry } from "../src/registry";

const client = createClient<typeof registry>(`${window.location.origin}/api/rivet`);

// One NPC instance, keyed by a fixed demo room + character id, so refreshing
// the page reconnects to the SAME actor and keeps its memory.
const npcHandle = client.npc.getOrCreate(["demo-room", "mira"], {
  createWithInput: {
    name: "Mira",
    personality:
      "A cautious village herbalist who warms up slowly, remembers every kindness or slight, and speaks plainly.",
  },
});

const conn = npcHandle.connect();

const PLAYER_ID = "player-1";

const chatLog = document.getElementById("chat-log") as HTMLDivElement;
const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLInputElement;
const skipBtn = document.getElementById("skip-day-btn") as HTMLButtonElement;
const dayLabel = document.getElementById("day-label") as HTMLSpanElement;
const relLabel = document.getElementById("relationship-label") as HTMLSpanElement;
const statusLabel = document.getElementById("status-label") as HTMLSpanElement;

function appendLine(speaker: string, text: string, cls = "") {
  const line = document.createElement("div");
  line.className = `line ${cls}`.trim();
  line.innerHTML = `<strong>${speaker}:</strong> ${escapeHtml(text)}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.innerText = s;
  return div.innerHTML;
}

conn.onOpen(() => {
  statusLabel.textContent = "connected";
});
conn.onClose(() => {
  statusLabel.textContent = "disconnected";
});
conn.onError((err: unknown) => {
  statusLabel.textContent = "error";
  console.error("connection error:", err);
});

conn.on(
  "npcReply",
  (data: { playerId: string; reply: string; day: number; relationship: number }) => {
    appendLine("Mira", data.reply, "npc");
    dayLabel.textContent = String(data.day);
    relLabel.textContent = String(data.relationship);
  }
);

conn.on("dayChanged", (day: number) => {
  dayLabel.textContent = String(day);
  appendLine("System", `A new day begins (day ${day}).`, "system");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  appendLine("You", message, "player");
  input.value = "";
  try {
    await conn.talk(PLAYER_ID, message);
  } catch (err) {
    console.error(err);
    appendLine("System", "Mira didn't respond — check the server logs / API key.", "system");
  }
});

skipBtn.addEventListener("click", async () => {
  await conn.skipDays(1);
});

// Load prior memory on connect so a page refresh shows history immediately.
npcHandle
  .getMemory()
  .then((memory: { day: number; speaker: string; text: string }[]) => {
    for (const m of memory) {
      if (m.speaker === PLAYER_ID) appendLine("You", m.text, "player");
      else if (m.speaker === "npc") appendLine("Mira", m.text, "npc");
    }
  })
  .catch((err: unknown) => console.error("failed to load memory:", err));

npcHandle
  .getStatus()
  .then((status: { currentDay: number; relationships: Record<string, number> }) => {
    dayLabel.textContent = String(status.currentDay);
    relLabel.textContent = String(status.relationships[PLAYER_ID] ?? 0);
  })
  .catch((err: unknown) => console.error("failed to load status:", err));
