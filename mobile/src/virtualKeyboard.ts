import { NativeModules } from "react-native";

const { VirtualKeyboardModule } = NativeModules;

export async function isVirtualKeyboardEnabled(): Promise<boolean> {
  if (!VirtualKeyboardModule) return false;
  return await VirtualKeyboardModule.isKeyboardEnabled();
}

export async function isVirtualKeyboardActive(): Promise<boolean> {
  if (!VirtualKeyboardModule) return false;
  return await VirtualKeyboardModule.isKeyboardActive();
}

export function openKeyboardSettings(): void {
  VirtualKeyboardModule?.openKeyboardSettings();
}

export function commitText(text: string): void {
  VirtualKeyboardModule?.commitText(text);
}

export function sendKeyEvent(keyCode: number): void {
  VirtualKeyboardModule?.sendKeyEvent(keyCode);
}

export function deleteSurroundingText(before: number, after: number): void {
  VirtualKeyboardModule?.deleteSurroundingText(before, after);
}
