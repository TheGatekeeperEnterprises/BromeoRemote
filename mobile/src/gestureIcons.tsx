// Simple finger/touch illustrations for the touch-mode gesture instructions
// (see MOUSE_MODE_GESTURES / TOUCH_MODE_GESTURES in App.tsx) — Lucide (our
// general icon set) has no finger/gesture icons, so these are hand-built
// with react-native-svg (already a dependency via lucide-react-native)
// rather than pulling in a whole extra icon library for five icons.
import React from "react";
import Svg, { Circle, Line, Path } from "react-native-svg";

// strokeWidth accepted (and ignored) purely so these drop in wherever a
// lucide icon is expected (App.tsx's gesture-instruction renderer passes it
// uniformly) — each icon here uses its own fixed internal stroke weights.
type GestureIconProps = { size?: number; color?: string; strokeWidth?: number };

const FINGERTIP_R = 3.2;

function Fingertip({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return <Circle cx={cx} cy={cy} r={FINGERTIP_R} fill={color} />;
}

// A single tap: one fingertip with a ripple ring expanding from it.
export function TapGestureIcon({ size = 24, color = "#2f6fed" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8} stroke={color} strokeWidth={1.4} strokeOpacity={0.4} />
      <Fingertip cx={12} cy={12} color={color} />
    </Svg>
  );
}

// Long-press: fingertip with a thicker, more emphatic dashed ring standing
// in for "held in place for a while" (vs. the light ripple of a quick tap).
export function LongPressGestureIcon({ size = 24, color = "#2f6fed" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} strokeDasharray="3,3" strokeOpacity={0.7} />
      <Fingertip cx={12} cy={12} color={color} />
    </Svg>
  );
}

// One-finger drag: fingertip at the bottom with a vertical arrow above it
// showing the finger sliding up/down the screen.
export function DragGestureIcon({ size = 24, color = "#2f6fed" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={12} y1={4} x2={12} y2={15} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9 7 L12 4 L15 7" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Fingertip cx={12} cy={18.5} color={color} />
    </Svg>
  );
}

// Long-press then drag: fingertip with a held-ring at the start point,
// trailing off toward a second (lighter) point to suggest dragging onward.
export function LongPressDragGestureIcon({ size = 24, color = "#2f6fed" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={7} cy={17} r={5.2} stroke={color} strokeWidth={1.6} strokeDasharray="2.5,2.5" strokeOpacity={0.6} />
      <Fingertip cx={7} cy={17} color={color} />
      <Line x1={10.5} y1={13.5} x2={16} y2={8} stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeDasharray="1,3" />
      <Circle cx={17} cy={7} r={2.4} fill="none" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

// Pinch (two fingers moving together/apart): two fingertips with a
// double-headed arrow between them.
export function PinchGestureIcon({ size = 24, color = "#2f6fed" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Fingertip cx={5.5} cy={18.5} color={color} />
      <Fingertip cx={18.5} cy={5.5} color={color} />
      <Line x1={8.2} y1={15.8} x2={15.8} y2={8.2} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M6.5 13 L8.2 15.8 L11 14.3" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M13 9.7 L15.8 8.2 L17.5 11" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
