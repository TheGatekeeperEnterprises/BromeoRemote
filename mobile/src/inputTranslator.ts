import type { InputEvent } from "./shared/protocol";
import { dispatchTap, dispatchLongPress, dispatchSwipePath, dispatchScroll } from "./remoteControl";
import { commitText, sendKeyEvent } from "./virtualKeyboard";

// Translates the WebRTC control channel's discrete mouse-style events (built
// for a cursor-based desktop) into the single gesture Android's
// AccessibilityService.dispatchGesture() expects — a whole stroke path given
// up front, not incremental points. So a drag has to be buffered between
// mousedown and mouseup and only dispatched once the full path is known.
export class RemoteInputTranslator {
  private path: { x: number; y: number }[] = [];
  private downTime = 0;
  private isRightButton = false;

  handle(event: InputEvent): void {
    switch (event.kind) {
      case "mousedown":
        this.path = [{ x: event.xPct, y: event.yPct }];
        this.downTime = Date.now();
        this.isRightButton = event.button === "right";
        break;
      case "mousemove":
        if (this.path.length > 0) this.path.push({ x: event.xPct, y: event.yPct });
        break;
      case "mouseup": {
        if (this.path.length === 0) break;
        if (this.path.length === 1) {
          // No movement between down/up — a tap, or a long-press if the
          // sender flagged it as a right-click (mobile/desktop viewers both
          // send mousedown+mouseup with button:"right" for a long-press).
          if (this.isRightButton) dispatchLongPress(event.xPct, event.yPct);
          else dispatchTap(event.xPct, event.yPct);
        } else {
          const duration = Math.max(50, Date.now() - this.downTime);
          dispatchSwipePath(this.path, duration);
        }
        this.path = [];
        break;
      }
      case "wheel": {
        // No cursor position is carried on a wheel event (there's no
        // persistent "cursor" concept on a touchscreen) — approximate by
        // scrolling around the screen center. Deliberately approximate:
        // there's no way to be more precise with what this event carries.
        const deltaYPct = Math.max(-0.3, Math.min(0.3, event.deltaY / 1000));
        const deltaXPct = Math.max(-0.3, Math.min(0.3, event.deltaX / 1000));
        dispatchScroll(0.5, 0.5, deltaXPct, deltaYPct);
        break;
      }
      case "keydown": {
        const key = event.key?.toLowerCase();
        if (key === "backspace") {
          // KEYCODE_DEL = 67
          sendKeyEvent(67);
        } else if (key === "enter") {
          // KEYCODE_ENTER = 66
          sendKeyEvent(66);
        } else if (key === "escape") {
          // KEYCODE_BACK = 4
          sendKeyEvent(4);
        } else if (key === "arrowleft") {
          sendKeyEvent(21);
        } else if (key === "arrowright") {
          sendKeyEvent(22);
        } else if (key === "arrowup") {
          sendKeyEvent(19);
        } else if (key === "arrowdown") {
          sendKeyEvent(20);
        }
        break;
      }
      case "keyup":
        break;
      case "text":
        commitText(event.value);
        break;
    }
  }

  reset(): void {
    this.path = [];
  }
}
