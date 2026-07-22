import { NativeModules } from "react-native";

const { RemoteControlModule } = NativeModules;

export function isAccessibilityServiceEnabled(): Promise<boolean> {
  return RemoteControlModule.isEnabled();
}

export function openAccessibilitySettings(): void {
  RemoteControlModule.openSettings();
}

export function dispatchTap(xPct: number, yPct: number): void {
  RemoteControlModule.tap(xPct, yPct);
}

export function dispatchLongPress(xPct: number, yPct: number): void {
  RemoteControlModule.longPress(xPct, yPct);
}

export function dispatchSwipePath(points: { x: number; y: number }[], durationMs: number): void {
  RemoteControlModule.swipePath(points, durationMs);
}

export function dispatchScroll(xPct: number, yPct: number, deltaXPct: number, deltaYPct: number): void {
  RemoteControlModule.scroll(xPct, yPct, deltaXPct, deltaYPct);
}
