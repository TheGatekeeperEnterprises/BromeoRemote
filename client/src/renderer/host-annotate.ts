// Host-side whiteboard overlay: a full-screen, always-on-top window the host
// draws on directly with the mouse. Each finished stroke is relayed through
// main.ts to the main window, which broadcasts it to every connected viewer
// via the same "annotation-stroke" system command a viewer's own draw tool
// uses (see wireAnnotationCapture/broadcastSystemCommand in app.ts) — so
// this file mirrors that one's local rendering/fade logic for a consistent
// look, it just never receives strokes back, only sends them.

const ANNOTATION_COLOR = "#ff3b3b";
const ANNOTATION_STROKE_TTL_MS = 6000;

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const ctx = canvas.getContext("2d")!;

let strokes: { points: { x: number; y: number }[]; createdAt: number }[] = [];
let currentPoints: { x: number; y: number }[] = [];
let drawing = false;
let redrawTimer: ReturnType<typeof setInterval> | null = null;

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

function drawPath(points: { x: number; y: number }[], opacity: number): void {
  if (points.length < 2) return;
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = ANNOTATION_COLOR;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.x * canvas.width;
    const y = p.y * canvas.height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function redraw(): void {
  const now = Date.now();
  strokes = strokes.filter((s) => now - s.createdAt < ANNOTATION_STROKE_TTL_MS);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fadeStart = ANNOTATION_STROKE_TTL_MS * 0.7;
  for (const stroke of strokes) {
    const age = now - stroke.createdAt;
    const opacity = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / (ANNOTATION_STROKE_TTL_MS - fadeStart)) : 1;
    drawPath(stroke.points, opacity);
  }
  drawPath(currentPoints, 1);
  ctx.globalAlpha = 1;
  if (strokes.length === 0 && currentPoints.length === 0 && redrawTimer) {
    clearInterval(redrawTimer);
    redrawTimer = null;
  }
}

function ensureRedrawLoop(): void {
  if (redrawTimer) return;
  redrawTimer = setInterval(redraw, 100);
}

canvas.addEventListener("mousedown", (e) => {
  drawing = true;
  currentPoints = [toNorm(e)];
  ensureRedrawLoop();
});
window.addEventListener("mousemove", (e) => {
  if (!drawing) return;
  currentPoints.push(toNorm(e));
});
window.addEventListener("mouseup", () => {
  if (!drawing) return;
  drawing = false;
  if (currentPoints.length < 2) {
    currentPoints = [];
    return;
  }
  const points = currentPoints;
  currentPoints = [];
  strokes.push({ points, createdAt: Date.now() });
  ensureRedrawLoop();
  void window.bromeo.sendHostAnnotationStroke(crypto.randomUUID(), points, ANNOTATION_COLOR);
});

clearBtn.onclick = () => {
  strokes = [];
  currentPoints = [];
  redraw();
  void window.bromeo.sendHostAnnotationClear();
};

closeBtn.onclick = () => {
  void window.bromeo.closeHostAnnotationOverlay();
};

// Keyboard fallback for closing — this window covers the whole primary
// display and captures every mouse event, so if the toolbar is ever
// unreachable (multi-monitor/DPI edge case) Escape is the only way back.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void window.bromeo.closeHostAnnotationOverlay();
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
