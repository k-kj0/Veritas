import { createClient } from "rivetkit/client";
import type { registry } from "../src/registry.ts";

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
const RELATIONSHIP_METER_MAX = 10;

const chatLog = document.getElementById("chat-log") as HTMLDivElement;
const emptyHint = document.getElementById("empty-hint") as HTMLParagraphElement | null;
const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLInputElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const skipBtn = document.getElementById("skip-day-btn") as HTMLButtonElement;
const dayLabel = document.getElementById("day-label") as HTMLSpanElement;
const relLabel = document.getElementById("relationship-label") as HTMLSpanElement;
const relFill = document.getElementById("relationship-fill") as HTMLSpanElement;
const statusLabel = document.getElementById("status-label") as HTMLSpanElement;
const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const typingIndicator = document.getElementById("typing-indicator") as HTMLDivElement;

// ---- Actor state inspector (built here so index.html needs no change) ----
const inspectorStyle = document.createElement("style");
inspectorStyle.textContent = `
  .inspector { margin-top: 18px; border: 1px solid rgba(217,184,120,0.16); border-radius: 12px; background: rgba(255,255,255,0.02); }
  .inspector summary { cursor: pointer; padding: 12px 16px; font-size: 13px; color: #a9a89f; }
  .inspector pre { margin: 0; padding: 0 16px 16px; font-size: 12px; line-height: 1.5; color: #dfe8e2; white-space: pre-wrap; word-break: break-word; }
`;
document.head.appendChild(inspectorStyle);

const inspector = document.createElement("details");
inspector.className = "inspector";
inspector.innerHTML =
  '<summary>Live actor state (read straight from Rivet)</summary><pre id="inspector-json">Loading…</pre>';
document.querySelector(".shell")?.appendChild(inspector);
const inspectorJson = document.getElementById("inspector-json") as HTMLPreElement;

async function refreshInspector() {
  try {
    const state = await npcHandle.inspect();
    inspectorJson.textContent = JSON.stringify(state, null, 2);
  } catch (err) {
    console.error("failed to load actor state:", err);
    inspectorJson.textContent = "Could not read actor state.";
  }
}

function hideEmptyHint() {
  if (emptyHint) emptyHint.style.display = "none";
}

function appendLine(speaker: "You" | "Mira" | "System", text: string, cls: "player" | "npc" | "system") {
  hideEmptyHint();

  const row = document.createElement("div");
  row.className = `row ${cls}`;

  if (cls === "system") {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    row.appendChild(bubble);
  } else {
    const avatar = document.createElement("div");
    avatar.className = `avatar ${cls}`;
    avatar.textContent = cls === "npc" ? "M" : "Y";
    avatar.setAttribute("aria-label", speaker);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    row.appendChild(avatar);
    row.appendChild(bubble);
  }

  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(state: "connecting" | "connected" | "disconnected" | "error") {
  statusDot.className = `dot ${state === "connected" ? "connected" : state === "error" ? "error" : ""}`.trim();
  statusLabel.textContent =
    state === "connecting"
      ? "Connecting…"
      : state === "connected"
        ? "Connected"
        : state === "error"
          ? "Connection error"
          : "Disconnected";
}

function setTyping(active: boolean) {
  typingIndicator.classList.toggle("active", active);
  if (active) chatLog.scrollTop = chatLog.scrollHeight;
}

function updateRelationship(score: number) {
  relLabel.textContent = String(score);
  const clamped = Math.max(0, Math.min(RELATIONSHIP_METER_MAX, score));
  relFill.style.width = `${(clamped / RELATIONSHIP_METER_MAX) * 100}%`;
}

setStatus("connecting");

conn.onOpen(() => setStatus("connected"));
conn.onClose(() => setStatus("disconnected"));
conn.onError((err: unknown) => {
  setStatus("error");
  console.error("connection error:", err);
});

conn.on(
  "npcReply",
  (data: { playerId: string; reply: string; day: number; relationship: number }) => {
    setTyping(false);
    appendLine("Mira", data.reply, "npc");
    dayLabel.textContent = String(data.day);
    updateRelationship(data.relationship);
    void refreshInspector();
  }
);

// Fires on the skip button AND on the actor's own durable timer (every 5 min).
conn.on("dayChanged", (day: number) => {
  dayLabel.textContent = String(day);
  appendLine("System", `A new day begins (day ${day}).`, "system");
  void refreshInspector();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  appendLine("You", message, "player");
  input.value = "";
  sendBtn.disabled = true;
  setTyping(true);
  try {
    await conn.talk(PLAYER_ID, message);
  } catch (err) {
    console.error(err);
    setTyping(false);
    appendLine("System", "Mira is away right now. Try again in a moment.", "system");
  } finally {
    sendBtn.disabled = false;
  }
});

skipBtn.addEventListener("click", async () => {
  skipBtn.disabled = true;
  try {
    await conn.skipDays(1);
  } catch (err) {
    console.error(err);
    appendLine("System", "Could not advance the day. Try again in a moment.", "system");
  } finally {
    skipBtn.disabled = false;
  }
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
    updateRelationship(status.relationships[PLAYER_ID] ?? 0);
  })
  .catch((err: unknown) => console.error("failed to load status:", err));

void refreshInspector();
