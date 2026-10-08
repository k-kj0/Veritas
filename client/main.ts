import { createClient } from "rivetkit/client";
import type { registry } from "../src/registry.ts";

const client = createClient<typeof registry>(`${window.location.origin}/api/rivet`);

// Which actor this browser talks to.
// - No saved chat id  -> the original actor (same as before, nothing changes).
// - After "Delete chat" -> a brand new random id, so a brand new empty Mira.
// The id is saved in localStorage, so refresh / new tab keeps the same chat.
const CHAT_ID_KEY = "veritas:chatId";

function loadChatId(): string {
  try {
    return localStorage.getItem(CHAT_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveChatId(id: string) {
  try {
    localStorage.setItem(CHAT_ID_KEY, id);
  } catch {
    /* storage blocked: new chat still works until the page is reloaded */
  }
}

function makeHandle(chatId: string) {
  const key = chatId ? ["mira-v4", chatId] : ["demo-room", "mira-v4"];
  return client.npc.getOrCreate(key, {
    createWithInput: {
      name: "Mira",
      personality:
        "A warm, practical AI memory partner for builders and engineers. She remembers the user's name, goals and projects, gives clear, concise answers, and asks a short follow-up when useful.",
    },
  });
}

let chatId = loadChatId();
let npcHandle = makeHandle(chatId);
let conn = npcHandle.connect();

const PLAYER_ID = "player-1";
const METER_MAX = 10;
const SCENARIOS = [
  { title: "Introduce yourself", hue: 160, icon: "✦", desc: "Share your background, then test recall.", prompt: "Hi, I'm Kavya. I'm a recent graduate building AI and backend projects." },
  { title: "Explain a code snippet", hue: 215, icon: "</>", desc: "Understand what code does and where it could break.", prompt: "Explain what this does: const total = items.reduce((sum, i) => sum + i.price, 0)" },
  { title: "Plan a project", hue: 270, icon: "◈", desc: "Break an idea into a first-week plan.", prompt: "I want to build a habit tracker. Help me plan the first week." },
  { title: "Career guidance", hue: 30, icon: "↗", desc: "Get next steps for an engineering job search.", prompt: "I'm a recent graduate applying for backend engineering roles. What should I improve first?" },
  { title: "Test recall", hue: 195, icon: "◎", desc: "Ask what Mira has stored about you so far.", prompt: "What do you remember about me so far?" },
  { title: "Test the trust score", hue: 320, icon: "♥", desc: "Watch the Trust score react to feedback.", prompt: "Thanks, that was really helpful. I appreciate it." },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chatLog = $<HTMLDivElement>("chat-log");
const emptyHint = document.getElementById("empty-hint");
const form = $<HTMLFormElement>("chat-form");
const input = $<HTMLInputElement>("chat-input");
const sendBtn = $<HTMLButtonElement>("send-btn");
const skipBtn = $<HTMLButtonElement>("skip-day-btn");
const dayLabel = $<HTMLElement>("day-label");
const relLabel = $<HTMLElement>("relationship-label");
const relFill = $<HTMLElement>("relationship-fill");
const statusLabel = $<HTMLElement>("status-label");
const statusDot = $<HTMLElement>("status-dot");
const typing = $<HTMLDivElement>("typing-indicator");
const chips = $<HTMLDivElement>("chips");

const DEFAULT_SUMMARY =
  "Nothing summarized yet. Recent messages are kept word for word; older ones get compressed.";

let playerTexts: string[] = [];
let lastName = "";
let lastRel = 0;

// Highlight style for a selected example card.
const styleTag = document.createElement("style");
styleTag.textContent = `
  .ex.selected { outline: 2px solid hsl(var(--h, 200) 80% 60%); box-shadow: 0 0 0 4px hsl(var(--h, 200) 80% 60% / 0.18); }
  #delete-chat-btn { margin: 10px 0 0; padding: 8px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.18); background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; opacity: 0.85; }
  #delete-chat-btn:hover { opacity: 1; border-color: rgba(255,120,120,0.7); }
  #delete-chat-btn:disabled { opacity: 0.4; cursor: default; }
`;
document.head.appendChild(styleTag);

const orb = document.querySelector(".orb");
function think(on: boolean) {
  orb?.classList.toggle("thinking", on);
}

// Soft light that follows the pointer (hidden for reduced-motion users via CSS).
const cursorGlow = document.getElementById("cursor-glow");
window.addEventListener("pointermove", (e) => {
  if (cursorGlow) cursorGlow.style.transform = `translate(${e.clientX - 300}px, ${e.clientY - 300}px)`;
});

function toast(text: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  $("toast").appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function bump(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart the CSS animation
  el.classList.add(cls);
}

function line(text: string, cls: "player" | "npc" | "system") {
  emptyHint?.remove();
  const row = document.createElement("div");
  row.className = `row ${cls}`;
  if (cls !== "system") {
    const av = document.createElement("div");
    av.className = `avatar ${cls}`;
    av.textContent = cls === "npc" ? "M" : "Y";
    row.appendChild(av);
  }
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.appendChild(bubble);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setStatus(s: "connecting" | "connected" | "disconnected" | "error") {
  statusDot.className = `dot ${s === "connected" || s === "error" ? s : ""}`.trim();
  statusLabel.textContent = { connecting: "Connecting…", connected: "Online", disconnected: "Offline", error: "Connection error" }[s];
}

function setRelationship(score: number) {
  relLabel.textContent = String(score);
  relFill.style.width = `${(Math.max(0, Math.min(METER_MAX, score)) / METER_MAX) * 100}%`;
  if (score > lastRel) {
    bump(relFill, "glow");
    toast("Trust score increased.");
  } else if (score < lastRel) {
    toast("Trust score decreased.");
  }
  lastRel = score;
}

function setDay(day: number) {
  dayLabel.textContent = String(day);
  $("mem-day").textContent = String(day);
  bump(dayLabel, "bump");
}

// The name is derived from the messages the actor stored, so it survives refreshes.
function findName(texts: string[]): string {
  for (const t of [...texts].reverse()) {
    const m = t.match(/\b(?:my name is|i'm|i am|im|call me)\s+([a-z][a-z'-]{1,20})/i);
    if (m && !/^(fine|good|sad|tired|sick|new|here)$/i.test(m[1])) {
      return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    }
  }
  return "";
}

async function refreshPanel() {
  try {
    const s = await npcHandle.inspect();
    $("mem-count").textContent = String(s.memoryCount);
    $("mem-day").textContent = String(s.currentDay);
    if (s.summary) $("mem-summary").textContent = s.summary;
  } catch (err) {
    console.error("failed to load actor state:", err);
  }
  const name = findName(playerTexts);
  if (name) {
    const el = $("mem-name");
    el.textContent = name;
    if (name !== lastName) {
      bump(el, "fresh");
      if (lastName || playerTexts.length > 1) toast(`New memory: your name is ${name}.`);
      lastName = name;
    }
  }
}

function setBusy(busy: boolean) {
  sendBtn.disabled = busy;
  chips.querySelectorAll("button").forEach((b) => (b.disabled = busy));
}

async function send(message: string) {
  const text = message.trim();
  if (!text) return;
  line(text, "player");
  playerTexts.push(text);
  input.value = "";
  setBusy(true);
  typing.classList.add("active");
  think(true);
  chatLog.scrollTop = chatLog.scrollHeight;
  try {
    await conn.talk(PLAYER_ID, text);
  } catch (err) {
    console.error(err);
    typing.classList.remove("active");
    think(false);
    line("Mira is away right now. Try again in a moment.", "system");
  } finally {
    setBusy(false);
  }
}

// ---- Example cards: 1st click = select + send, 2nd click = unselect ----
let selectedCard: HTMLButtonElement | null = null;

function clearSelection() {
  selectedCard?.classList.remove("selected");
  selectedCard?.setAttribute("aria-pressed", "false");
  selectedCard = null;
}

let cardIndex = 0;
for (const s of SCENARIOS) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ex";
  b.setAttribute("aria-pressed", "false");
  b.innerHTML = '<em class="ic"></em><b></b><span></span><i>→</i>';
  (b.querySelector(".ic") as HTMLElement).textContent = s.icon;
  b.style.setProperty("--h", String(s.hue));
  b.style.setProperty("--k", String(cardIndex++));
  (b.querySelector("b") as HTMLElement).textContent = s.title;
  (b.querySelector("span") as HTMLElement).textContent = s.desc;
  b.addEventListener("click", () => {
    if (selectedCard === b) {
      // second click: just unselect, send nothing
      clearSelection();
      return;
    }
    clearSelection();
    selectedCard = b;
    b.classList.add("selected");
    b.setAttribute("aria-pressed", "true");
    document.getElementById("chat")?.scrollIntoView({ behavior: "smooth", block: "center" });
    void send(s.prompt);
  });
  chips.appendChild(b);
}

// Ambient fireflies (hidden automatically for reduced-motion users via CSS).
const flies = $("flies");
for (let i = 0; i < 14; i++) {
  const f = document.createElement("span");
  f.style.left = `${Math.random() * 100}%`;
  f.style.top = `${40 + Math.random() * 60}%`;
  f.style.setProperty("--d", `${9 + Math.random() * 9}s`);
  f.style.setProperty("--delay", `${Math.random() * 10}s`);
  f.style.setProperty("--x", `${Math.random() * 80 - 40}px`);
  flies.appendChild(f);
}

// ---- Connection wiring (re-run when a new chat is started) ----
function wireConnection() {
  setStatus("connecting");
  conn.onOpen(() => setStatus("connected"));
  conn.onClose(() => setStatus("disconnected"));
  conn.onError((err: unknown) => {
    setStatus("error");
    console.error("connection error:", err);
  });

  conn.on("npcReply", (d: { playerId: string; reply: string; day: number; relationship: number }) => {
    typing.classList.remove("active");
    think(false);
    line(d.reply, "npc");
    setDay(d.day);
    setRelationship(d.relationship);
    void refreshPanel();
  });

  // Fires for the demo button and for the actor's own durable timer.
  conn.on("dayChanged", (day: number) => {
    setDay(day);
    line(`A new day begins (day ${day}).`, "system");
  });
}

// Restore everything from the actor on load: this is the persistence proof.
function loadFromActor() {
  npcHandle
    .getMemory()
    .then((memory: { day: number; speaker: string; text: string }[]) => {
      for (const m of memory) {
        if (m.speaker === PLAYER_ID) {
          line(m.text, "player");
          playerTexts.push(m.text);
        } else if (m.speaker === "npc") line(m.text, "npc");
      }
      return refreshPanel();
    })
    .catch((err: unknown) => console.error("failed to load memory:", err));

  npcHandle
    .getStatus()
    .then((s: { currentDay: number; relationships: Record<string, number> }) => {
      lastRel = s.relationships[PLAYER_ID] ?? 0;
      setDay(s.currentDay);
      setRelationship(lastRel);
    })
    .catch((err: unknown) => console.error("failed to load status:", err));
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void send(input.value);
});

skipBtn.addEventListener("click", async () => {
  skipBtn.disabled = true;
  try {
    await conn.skipDays(1);
  } catch (err) {
    console.error(err);
    line("Could not advance the day. Try again in a moment.", "system");
  } finally {
    skipBtn.disabled = false;
  }
});

// ---- Delete chat: clears the screen and starts a brand new, empty Mira ----
const deleteBtn = document.createElement("button");
deleteBtn.id = "delete-chat-btn";
deleteBtn.type = "button";
deleteBtn.textContent = "Delete chat";
form.insertAdjacentElement("afterend", deleteBtn);

deleteBtn.addEventListener("click", async () => {
  if (!confirm("Delete this chat and start a new one? Mira will forget everything from this chat.")) return;
  deleteBtn.disabled = true;
  try {
    // drop the old connection
    try {
      await (conn as unknown as { dispose?: () => Promise<void> }).dispose?.();
    } catch {
      /* ignore */
    }

    // new empty actor
    chatId = crypto.randomUUID();
    saveChatId(chatId);
    npcHandle = makeHandle(chatId);
    conn = npcHandle.connect();

    // reset the screen
    chatLog.querySelectorAll(".row").forEach((r) => r.remove());
    if (emptyHint && !emptyHint.isConnected) chatLog.appendChild(emptyHint);
    playerTexts = [];
    lastName = "";
    lastRel = 0;
    typing.classList.remove("active");
    think(false);
    clearSelection();
    setBusy(false);
    $("mem-name").textContent = "Not told yet";
    $("mem-count").textContent = "0";
    $("mem-summary").textContent = DEFAULT_SUMMARY;
    setDay(0);
    setRelationship(0);

    wireConnection();
    toast("New chat started.");
  } finally {
    deleteBtn.disabled = false;
  }
});

wireConnection();
loadFromActor();
