import { mouse, keyboard, Point, Button, Key, screen } from "@nut-tree-fork/nut-js";
import type { InputEvent } from "../shared/protocol";

mouse.config.mouseSpeed = 4000; // near-instant cursor moves, this is remote control not a demo

const BUTTON_MAP: Record<"left" | "right" | "middle", Button> = {
  left: Button.LEFT,
  right: Button.RIGHT,
  middle: Button.MIDDLE,
};

// Maps a browser KeyboardEvent.code to a nut-js Key. Covers the common keys
// needed for remote support/admin work; extend as needed.
const CODE_MAP: Record<string, Key> = {
  KeyA: Key.A, KeyB: Key.B, KeyC: Key.C, KeyD: Key.D, KeyE: Key.E, KeyF: Key.F,
  KeyG: Key.G, KeyH: Key.H, KeyI: Key.I, KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L,
  KeyM: Key.M, KeyN: Key.N, KeyO: Key.O, KeyP: Key.P, KeyQ: Key.Q, KeyR: Key.R,
  KeyS: Key.S, KeyT: Key.T, KeyU: Key.U, KeyV: Key.V, KeyW: Key.W, KeyX: Key.X,
  KeyY: Key.Y, KeyZ: Key.Z,
  Digit0: Key.Num0, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3,
  Digit4: Key.Num4, Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7,
  Digit8: Key.Num8, Digit9: Key.Num9,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Enter: Key.Enter, Escape: Key.Escape, Backspace: Key.Backspace, Tab: Key.Tab,
  Space: Key.Space, ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  Delete: Key.Delete, Insert: Key.Insert, CapsLock: Key.CapsLock,
  Minus: Key.Minus, Equal: Key.Equal, BracketLeft: Key.LeftBracket,
  BracketRight: Key.RightBracket, Backslash: Key.Backslash, Semicolon: Key.Semicolon,
  Quote: Key.Quote, Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash,
  PrintScreen: Key.Print,
};

let cachedScreenSize: { width: number; height: number } | null = null;

async function getScreenSize() {
  if (!cachedScreenSize) {
    cachedScreenSize = { width: await screen.width(), height: await screen.height() };
  }
  return cachedScreenSize;
}

export function invalidateScreenSizeCache(): void {
  cachedScreenSize = null;
}

export async function applyInputEvent(event: InputEvent): Promise<void> {
  switch (event.kind) {
    case "mousemove": {
      const { width, height } = await getScreenSize();
      await mouse.setPosition(new Point(Math.round(event.xPct * width), Math.round(event.yPct * height)));
      break;
    }
    case "mousedown": {
      const { width, height } = await getScreenSize();
      await mouse.setPosition(new Point(Math.round(event.xPct * width), Math.round(event.yPct * height)));
      await mouse.pressButton(BUTTON_MAP[event.button]);
      break;
    }
    case "mouseup": {
      await mouse.releaseButton(BUTTON_MAP[event.button]);
      break;
    }
    case "wheel": {
      if (event.deltaY > 0) await mouse.scrollDown(Math.min(20, Math.round(event.deltaY / 10)));
      else if (event.deltaY < 0) await mouse.scrollUp(Math.min(20, Math.round(-event.deltaY / 10)));
      if (event.deltaX > 0) await mouse.scrollRight(Math.min(20, Math.round(event.deltaX / 10)));
      else if (event.deltaX < 0) await mouse.scrollLeft(Math.min(20, Math.round(-event.deltaX / 10)));
      break;
    }
    case "keydown": {
      const key = CODE_MAP[event.code];
      if (key !== undefined) await keyboard.pressKey(key);
      break;
    }
    case "keyup": {
      const key = CODE_MAP[event.code];
      if (key !== undefined) await keyboard.releaseKey(key);
      break;
    }
    case "text": {
      await keyboard.type(event.value);
      break;
    }
  }
}
