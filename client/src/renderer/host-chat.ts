// Docked host chat window — a display + input surface for the chatLog that
// app.ts (the main window, running hidden/minimized while hosting) actually
// owns. Sent messages round-trip through main.ts's "host-chat-send" so
// app.ts can push them out over the real session; this file never talks to
// a PeerSession directly.

export {};

interface ChatMessage {
  text: string;
  timestamp: number;
  mine: boolean;
}

const messagesEl = document.getElementById("chat-messages") as HTMLDivElement;
const inputEl = document.getElementById("chat-input") as HTMLInputElement;
const sendBtn = document.getElementById("chat-send") as HTMLButtonElement;
const closeBtn = document.getElementById("chat-close") as HTMLButtonElement;

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function render(messages: ChatMessage[]): void {
  if (messages.length === 0) {
    messagesEl.innerHTML = `<div class="empty">Nog geen berichten</div>`;
    return;
  }
  messagesEl.innerHTML = messages
    .map((m) => {
      const time = new Date(m.timestamp).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
      return `<div class="bubble ${m.mine ? "mine" : ""}">${escapeHtml(m.text)}<time>${time}</time></div>`;
    })
    .join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function send(): void {
  const text = inputEl.value.trim();
  if (!text) return;
  void window.bromeo.sendHostChatMessage(text);
  inputEl.value = "";
}

sendBtn.onclick = () => send();
inputEl.onkeydown = (e) => {
  if (e.key === "Enter") send();
};
closeBtn.onclick = () => {
  void window.bromeo.hideHostChat();
};

window.bromeo.onHostChatMessages(render);
inputEl.focus();
