// Simple finger/touch illustrations for the touch-mode gesture instructions
// (see MOUSE_MODE_GESTURES / TOUCH_MODE_GESTURES in App.tsx) — Lucide (our
// general icon set) has no finger/gesture icons, so these are hand-built
// with react-native-svg (already a dependency via lucide-react-native)
// rather than pulling in a whole extra icon library for five icons. Also
// houses the mouse-mode cursor-shape icons (see CURSOR_SHAPE_ICONS in
// App.tsx) for the same reason — a real OS cursor needs to read clearly
// against literally any screen content behind it, which none of lucide's
// plain single-color icons do on their own.
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import {
  Pointer,
  Move,
  MoveHorizontal,
  MoveVertical,
  MoveDiagonal,
  MoveDiagonal2,
  Hourglass,
  Ban,
  CircleQuestionMark,
} from "lucide-react-native";

// strokeWidth accepted (and ignored) purely so these drop in wherever a
// lucide icon is expected (App.tsx's gesture-instruction renderer passes it
// uniformly) — each icon here uses its own fixed internal stroke weights.
type GestureIconProps = { size?: number; color?: string; strokeWidth?: number };

// A classic OS arrow-cursor glyph (the standard default-pointer shape, not
// one of lucide's mouse-pointer variants, which read as more of an outline
// arrow than an actual cursor) — App.tsx's mouse-mode overlay uses this
// instead of the plain colored dot it started with. White fill with a dark
// outline is the universal cursor look (visible against light or dark
// backgrounds alike), so — unlike the other icons in this file — this one
// deliberately ignores the `color` prop for its fill and only uses it for
// the outline, to keep that contrast regardless of what color gets passed.
export function ArrowCursorIcon({ size = 24, color = "#111" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13.64,21.97C13.14,22.21 12.54,22 12.31,21.5L10.13,16.76L7.62,18.78C7.45,18.92 7.24,19 7,19A1,1 0 0,1 6,18V3A1,1 0 0,1 7,2C7.24,2 7.47,2.09 7.64,2.23L7.65,2.22L19.14,11.86C19.57,12.22 19.62,12.85 19.27,13.27C19.12,13.45 18.91,13.57 18.7,13.61L15.54,14.23L17.74,18.96C18,19.46 17.76,20.05 17.26,20.28L13.64,21.97Z"
        fill="#fff"
        stroke={color}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// Text I-beam cursor — a plain vertical stem with serif caps top/bottom,
// same white-fill/dark-outline treatment as ArrowCursorIcon for the same
// reason (needs to read against any screen content). Simple enough to draw
// directly as rectangles rather than a traced path.
export function TextCursorIcon({ size = 24, color = "#111" }: GestureIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={7.5} y={2.5} width={9} height={2.6} rx={0.6} fill="#fff" stroke={color} strokeWidth={1.1} />
      <Rect x={10.8} y={2.5} width={2.4} height={19} fill="#fff" stroke={color} strokeWidth={1.1} />
      <Rect x={7.5} y={18.9} width={9} height={2.6} rx={0.6} fill="#fff" stroke={color} strokeWidth={1.1} />
    </Svg>
  );
}

// Wraps any lucide icon in a small white circular badge, for cursor shapes
// lucide already covers well (hand/resize/move/wait/etc.) — gives them the
// same "visible against any background" property ArrowCursorIcon/
// TextCursorIcon get from being solid-filled shapes, without needing to
// hand-draw filled versions of icons a real, already-tested library has.
function CursorBadgeIcon({
  Icon,
  size = 24,
  color = "#111",
}: {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  size?: number;
  color?: string;
}) {
  // width/height/borderColor below depend on this component's own size/color props, so they can't
  // live in a static StyleSheet.create.
  return (
    <View
      // eslint-disable-next-line react-native/no-inline-styles
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#fff",
        borderWidth: 1.1,
        borderColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={size * 0.62} color={color} strokeWidth={2.3} />
    </View>
  );
}

// lucide's "Pointer" is the real hand/link-hover cursor shape (fingers +
// palm outline) — badge-wrapped rather than hand-drawn, since it's already
// a correct, tested asset.
export function HandCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={Pointer} {...props} />;
}
export function MoveCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={Move} {...props} />;
}
export function ResizeEWCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={MoveHorizontal} {...props} />;
}
export function ResizeNSCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={MoveVertical} {...props} />;
}
export function ResizeNESWCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={MoveDiagonal} {...props} />;
}
export function ResizeNWSECursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={MoveDiagonal2} {...props} />;
}
export function WaitCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={Hourglass} {...props} />;
}
export function NotAllowedCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={Ban} {...props} />;
}
export function HelpCursorIcon(props: GestureIconProps) {
  return <CursorBadgeIcon Icon={CircleQuestionMark} {...props} />;
}

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
