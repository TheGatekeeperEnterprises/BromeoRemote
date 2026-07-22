import type { MiniControllerState } from "./global";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  peer: $<HTMLElement>("mini-peer"),
  status: $<HTMLElement>("mini-status"),
  permissions: $<HTMLElement>("mini-permissions"),
  screen: $<HTMLElement>("mini-screen"),
  open: $<HTMLButtonElement>("mini-open"),
  clipboard: $<HTMLButtonElement>("mini-clipboard"),
  chat: $<HTMLButtonElement>("mini-chat"),
  screenToggle: $<HTMLButtonElement>("mini-screen-toggle"),
  end: $<HTMLButtonElement>("mini-end"),
  panic: $<HTMLButtonElement>("mini-panic"),
};

function send(action: string): void {
  window.bromeo.miniControllerAction(action);
}

function update(state: MiniControllerState): void {
  el.peer.textContent = state.peer;
  el.status.textContent = state.status;
  el.permissions.textContent = state.permissions;
  el.screen.textContent = state.screenOff ? "Uit" : "Aan";
  el.screenToggle.textContent = state.screenOff ? "Scherm aan" : "Scherm uit";
  el.clipboard.disabled = !state.canClipboard;
  el.screenToggle.disabled = !state.canScreenPower;
}

el.open.onclick = () => send("open");
el.clipboard.onclick = () => send("clipboard");
el.chat.onclick = () => send("chat");
el.screenToggle.onclick = () => send("screen-toggle");
el.end.onclick = () => send("end");
el.panic.onclick = () => send("panic");

window.bromeo.onMiniControllerState(update);
