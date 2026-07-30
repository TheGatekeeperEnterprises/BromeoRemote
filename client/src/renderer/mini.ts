import type { MiniControllerState } from "./global";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  peer: $<HTMLElement>("mini-peer"),
  status: $<HTMLElement>("mini-status"),
  viewerList: $<HTMLDivElement>("mini-viewer-list"),
  screen: $<HTMLElement>("mini-screen"),
  open: $<HTMLButtonElement>("mini-open"),
  collapse: $<HTMLButtonElement>("mini-collapse"),
  tab: $<HTMLDivElement>("mini-tab"),
  clipboard: $<HTMLButtonElement>("mini-clipboard"),
  chat: $<HTMLButtonElement>("mini-chat"),
  screenToggle: $<HTMLButtonElement>("mini-screen-toggle"),
  whiteboard: $<HTMLButtonElement>("mini-whiteboard"),
  end: $<HTMLButtonElement>("mini-end"),
  panic: $<HTMLButtonElement>("mini-panic"),
};

function send(action: string, peerId?: string): void {
  window.bromeo.miniControllerAction(action, peerId);
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function update(state: MiniControllerState): void {
  const count = state.viewers.length;
  el.peer.textContent = count === 1 ? state.viewers[0].label : `${count} kijkers`;
  el.status.textContent =
    count === 1
      ? state.viewers[0].viewOnly
        ? "Kijkt mee met dit apparaat"
        : "Bekijkt en bestuurt dit apparaat"
      : "Meerdere kijkers verbonden";
  el.viewerList.innerHTML = state.viewers
    .map(
      (v) =>
        `<div class="viewer-row">` +
        `<span class="viewer-name">${escapeHtml(v.label)}</span>` +
        `<span class="viewer-perm">${escapeHtml(v.permissions)}</span>` +
        (v.viewOnly
          ? `<button class="viewer-promote" data-peer="${escapeHtml(v.peerId)}" title="Besturing geven aan deze kijker">⇧</button>`
          : "") +
        `<button class="viewer-kick" data-peer="${escapeHtml(v.peerId)}" title="Deze kijker loskoppelen">×</button>` +
        `</div>`
    )
    .join("");
  el.viewerList.querySelectorAll<HTMLButtonElement>(".viewer-kick").forEach((btn) => {
    btn.onclick = () => send("end", btn.dataset.peer);
  });
  el.viewerList.querySelectorAll<HTMLButtonElement>(".viewer-promote").forEach((btn) => {
    btn.onclick = () => send("promote", btn.dataset.peer);
  });
  el.screen.textContent = state.screenOff ? "Uit" : "Aan";
  el.screenToggle.textContent = state.screenOff ? "Scherm aan" : "Scherm uit";
  el.clipboard.disabled = !state.canClipboard;
  el.screenToggle.disabled = !state.canScreenPower;
  el.whiteboard.classList.toggle("active", state.whiteboardActive);
  el.whiteboard.textContent = state.whiteboardActive ? "Whiteboard aan" : "Whiteboard";
}

el.open.onclick = () => send("open");
el.collapse.onclick = () => send("collapse");
el.tab.onclick = () => send("collapse");
el.clipboard.onclick = () => send("clipboard");
el.chat.onclick = () => send("chat");
el.screenToggle.onclick = () => send("screen-toggle");
el.whiteboard.onclick = () => send("whiteboard");
el.end.onclick = () => send("end"); // no peerId — ends the whole hosting session
el.panic.onclick = () => send("panic");

window.bromeo.onMiniControllerState(update);
window.bromeo.onMiniControllerCollapsed((collapsed) => {
  document.body.classList.toggle("collapsed", collapsed);
  el.collapse.textContent = collapsed ? "»" : "«";
});
