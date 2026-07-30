// Host-side whiteboard overlay: a full-screen, always-on-top window the host
// draws on directly with the mouse. Finished shapes relay through main.ts to
// the main window, which broadcasts them to every connected viewer via the
// same "annotation-shape" system command a viewer's own draw tool uses (see
// wireAnnotationCapture/broadcastSystemCommand in app.ts) — so the rendering
// here mirrors that one's shape model and fade behavior, it just never
// receives shapes back, only originates them.

export {};

import type { AnnotationShape, AnnotationShapeKind } from "../shared/protocol.js";

const ANNOTATION_STROKE_TTL_MS = 6000;
const ERASE_RADIUS = 0.02; // normalized (~2% of screen width) hit-test radius

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const ctx = canvas.getContext("2d")!;

let tool: AnnotationShapeKind | "select" | "eraser" = "pen";
let color = "#ff3b3b";
let shapes: (AnnotationShape & { createdAt: number })[] = [];
let currentPoints: { x: number; y: number }[] = [];
let dragging = false;
let dragStart: { x: number; y: number } | null = null;
let redrawTimer: ReturnType<typeof setInterval> | null = null;
let activeTextInput: HTMLInputElement | null = null;

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function toNorm(e: MouseEvent): { x: number; y: number } {
  return {
    x: Math.min(1, Math.max(0, e.clientX / window.innerWidth)),
    y: Math.min(1, Math.max(0, e.clientY / window.innerHeight)),
  };
}

function newId(): string {
  return crypto.randomUUID();
}

// --- Rendering — mirrors app.ts's drawAnnotationShape for a consistent
// look on both sides of the session. ---
function drawShape(shape: AnnotationShape, opacity: number): void {
  const px = (v: number) => v * canvas.width;
  const py = (v: number) => v * canvas.height;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  if (shape.kind === "pen" || shape.kind === "highlighter") {
    const points = shape.points ?? [];
    if (points.length < 2) return;
    ctx.globalAlpha = (shape.kind === "highlighter" ? 0.35 : 1) * opacity;
    ctx.lineWidth = shape.kind === "highlighter" ? 14 : 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(px(p.x), py(p.y));
      else ctx.lineTo(px(p.x), py(p.y));
    });
    ctx.stroke();
  } else if (shape.kind === "rect") {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 3;
    ctx.strokeRect(px(shape.x ?? 0), py(shape.y ?? 0), px(shape.w ?? 0), py(shape.h ?? 0));
  } else if (shape.kind === "ellipse") {
    ctx.globalAlpha = opacity;
    ctx.lineWidth = 3;
    const cx = px((shape.x ?? 0) + (shape.w ?? 0) / 2);
    const cy = py((shape.y ?? 0) + (shape.h ?? 0) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(px(shape.w ?? 0) / 2), Math.abs(py(shape.h ?? 0) / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (shape.kind === "text") {
    ctx.globalAlpha = opacity;
    ctx.font = "600 20px 'Segoe UI', Arial, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(shape.text ?? "", px(shape.x ?? 0), py(shape.y ?? 0));
  } else if (shape.kind === "comment") {
    const x = px(shape.x ?? 0);
    const y = py(shape.y ?? 0);
    const text = shape.text ?? "";
    ctx.font = "600 14px 'Segoe UI', Arial, sans-serif";
    const padding = 9;
    const boxWidth = ctx.measureText(text).width + padding * 2;
    const boxHeight = 30;
    ctx.globalAlpha = 0.92 * opacity;
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r);
    ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r);
    ctx.arcTo(x, y + boxHeight, x, y, r);
    ctx.arcTo(x, y, x + boxWidth, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padding, y + boxHeight / 2 + 1);
  }
}

function redraw(): void {
  const now = Date.now();
  shapes = shapes.filter((s) => now - s.createdAt < ANNOTATION_STROKE_TTL_MS);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fadeStart = ANNOTATION_STROKE_TTL_MS * 0.7;
  for (const shape of shapes) {
    const age = now - shape.createdAt;
    const opacity = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / (ANNOTATION_STROKE_TTL_MS - fadeStart)) : 1;
    drawShape(shape, opacity);
  }
  if ((tool === "pen" || tool === "highlighter") && currentPoints.length >= 2) {
    drawShape({ id: "", kind: tool, color, points: currentPoints }, 1);
  } else if ((tool === "rect" || tool === "ellipse") && dragStart && currentPoints.length > 0) {
    const end = currentPoints[currentPoints.length - 1];
    drawShape(rectBounds(dragStart, end, tool), 1);
  }
  ctx.globalAlpha = 1;
  if (shapes.length === 0 && currentPoints.length === 0 && redrawTimer) {
    clearInterval(redrawTimer);
    redrawTimer = null;
  }
}

function ensureRedrawLoop(): void {
  if (redrawTimer) return;
  redrawTimer = setInterval(redraw, 100);
}

function rectBounds(a: { x: number; y: number }, b: { x: number; y: number }, kind: "rect" | "ellipse"): AnnotationShape {
  return {
    id: "",
    kind,
    color,
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function commitShape(shape: AnnotationShape): void {
  const finished: AnnotationShape = { ...shape, id: newId() };
  shapes.push({ ...finished, createdAt: Date.now() });
  ensureRedrawLoop();
  redraw();
  void window.bromeo.sendHostAnnotationShape(finished);
}

// --- Eraser: removes any shape whose path/bounds pass within ERASE_RADIUS
// of the dragged point, immediately (not just via the fade timer). ---
function shapeNearPoint(shape: AnnotationShape, p: { x: number; y: number }): boolean {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  if (shape.kind === "pen" || shape.kind === "highlighter") {
    return (shape.points ?? []).some((pt) => dist(pt, p) < ERASE_RADIUS);
  }
  if (shape.kind === "rect" || shape.kind === "ellipse") {
    const x = shape.x ?? 0, y = shape.y ?? 0, w = shape.w ?? 0, h = shape.h ?? 0;
    return p.x >= x - ERASE_RADIUS && p.x <= x + w + ERASE_RADIUS && p.y >= y - ERASE_RADIUS && p.y <= y + h + ERASE_RADIUS;
  }
  if (shape.kind === "text" || shape.kind === "comment") {
    return dist({ x: shape.x ?? 0, y: shape.y ?? 0 }, p) < ERASE_RADIUS * 2;
  }
  return false;
}

function eraseAt(p: { x: number; y: number }): void {
  const toErase = shapes.filter((s) => shapeNearPoint(s, p));
  if (toErase.length === 0) return;
  shapes = shapes.filter((s) => !toErase.includes(s));
  redraw();
  toErase.forEach((s) => void window.bromeo.sendHostAnnotationErase(s.id));
}

// --- Inline text/comment placement ---
function placeTextInput(clientX: number, clientY: number, kind: "text" | "comment"): void {
  if (activeTextInput) activeTextInput.blur();
  const norm = { x: clientX / window.innerWidth, y: clientY / window.innerHeight };
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-input";
  input.style.left = `${clientX}px`;
  input.style.top = `${clientY - 4}px`;
  input.style.color = color;
  document.body.appendChild(input);
  activeTextInput = input;
  input.focus();

  const commit = () => {
    if (activeTextInput !== input) return;
    activeTextInput = null;
    const text = input.value.trim();
    input.remove();
    if (text) commitShape({ id: "", kind, color, x: norm.x, y: norm.y, text });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") {
      // Cancel just the text placement, not the whole overlay — stop the
      // keypress from also reaching the window-level Escape-closes-overlay
      // handler below.
      e.stopPropagation();
      activeTextInput = null;
      input.remove();
    }
  });
  input.addEventListener("blur", commit);
}

// --- Toolbar wiring ---
document.querySelectorAll<HTMLButtonElement>(".tool-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll<HTMLButtonElement>(".tool-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tool = btn.dataset.tool as typeof tool;
    document.body.className = `tool-${tool}`;
  };
});
document.querySelectorAll<HTMLButtonElement>(".color-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll<HTMLButtonElement>(".color-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    color = btn.dataset.color ?? color;
  };
});

// --- Canvas interaction ---
canvas.addEventListener("mousedown", (e) => {
  const p = toNorm(e);
  if (tool === "select") return;
  if (tool === "text" || tool === "comment") {
    placeTextInput(e.clientX, e.clientY, tool);
    return;
  }
  if (tool === "eraser") {
    dragging = true;
    eraseAt(p);
    return;
  }
  dragging = true;
  dragStart = p;
  currentPoints = [p];
  ensureRedrawLoop();
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const p = toNorm(e);
  if (tool === "eraser") {
    eraseAt(p);
    return;
  }
  currentPoints.push(p);
});
window.addEventListener("mouseup", () => {
  if (!dragging) return;
  dragging = false;
  if (tool === "eraser") {
    dragStart = null;
    currentPoints = [];
    return;
  }
  if (tool === "pen" || tool === "highlighter") {
    if (currentPoints.length >= 2) commitShape({ id: "", kind: tool, color, points: currentPoints });
  } else if ((tool === "rect" || tool === "ellipse") && dragStart) {
    const end = currentPoints[currentPoints.length - 1] ?? dragStart;
    const bounds = rectBounds(dragStart, end, tool);
    if ((bounds.w ?? 0) > 0.005 || (bounds.h ?? 0) > 0.005) commitShape(bounds);
  }
  dragStart = null;
  currentPoints = [];
});

clearBtn.onclick = () => {
  shapes = [];
  currentPoints = [];
  redraw();
  void window.bromeo.sendHostAnnotationClear();
};

saveBtn.onclick = () => {
  void window.bromeo.saveHostAnnotationImage(canvas.toDataURL("image/png"), `whiteboard-${Date.now()}.png`);
};

closeBtn.onclick = () => {
  void window.bromeo.closeHostAnnotationOverlay();
};

// Keyboard fallback for closing — this window covers the whole primary
// display and captures every mouse event, so if the toolbar is ever
// unreachable (multi-monitor/DPI edge case) Escape is the only way back.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !activeTextInput) void window.bromeo.closeHostAnnotationOverlay();
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
