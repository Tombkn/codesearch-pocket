// Safari kann die Bildschirmtastatur über den Layout-Viewport legen.
// Nur den sichtbaren Bereich übernehmen; Pinch-Zoom niemals zurückskalieren.
export function bindViewport(win = window) {
  const viewport = win.visualViewport;
  const root = win.document.documentElement;
  let frame = 0;
  const update = () => {
    frame = 0;
    const editing = win.document.activeElement?.matches("input, textarea, select, [contenteditable=true]");
    // Auch unter Pinch-Zoom muss ein beendetes Tippen die Bedienleiste freigeben.
    if (!editing) root.classList.remove("keyboard-open");
    if (viewport && Math.abs((viewport.scale || 1) - 1) > 0.05) return;
    const height = viewport?.height || win.innerHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const top = Math.max(0, viewport?.offsetTop || 0);
    root.style.setProperty("--viewport-height", `${height}px`);
    root.style.setProperty("--viewport-top", `${top}px`);
    root.classList.toggle("compact-viewport", height < 500);
    root.classList.toggle("keyboard-open", Boolean(editing && win.innerHeight - height > 80));
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(update);
  };
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  win.addEventListener("resize", schedule);
  win.document.addEventListener("focusin", schedule);
  win.document.addEventListener("focusout", schedule);
  update();
  return () => {
    if (frame) win.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    win.removeEventListener("resize", schedule);
    win.document.removeEventListener("focusin", schedule);
    win.document.removeEventListener("focusout", schedule);
  };
}
