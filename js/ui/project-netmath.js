// Reine Netz-Mathematik der Projektansicht NETZ (Vertrag 14): Lage aus den exportierten Positionen, Anschluesse je
// Index, Reihe der Ops ohne Position, Platzhalter fuer externe Enden, Einpassen, Verschieben, Zoom und Pinch.
// Ohne DOM, damit Spiegelung, Anschlussversatz und Gestenrechnung getrennt pruefbar sind (tools/projects-views-tests.mjs).
//
// Koordinaten: Welt = TD-Netzeinheiten mit gespiegelter Y-Achse. TD liefert nodeX/nodeY als linke/UNTERE Kante mit
// Y nach oben; SVG zaehlt Y nach unten. Rechteck in der Welt: (x, -(y + h), w, h). Bildschirm = Welt * zoom + pan.

export const NET_ZOOM = Object.freeze({ min: 0.01, max: 8, step: 1.25, fitMax: 1.5 });
export const FIT_PADDING = 24;
// Ops ohne Position: eigene, beschriftete Reihe UNTER allem Bekannten. Die Plaetze dort sind ausdruecklich keine
// TD-Positionen (Vertrag 14: nie geschaetzte Positionen als echt ausgeben).
export const UNKNOWN_BOX = Object.freeze({ w: 130, h: 90, gap: 50, rowGap: 220, labelGap: 36, perRow: 12 });
export const PLACEHOLDER_BOX = Object.freeze({ w: 240, h: 56, gap: 30, margin: 220 });
// Anschluss-Striche je Seite: der Index ist im Schema jede sichere Ganzzahl >= 0. Ein Strich je Index wuerde bei
// einem beschaedigten Paket (Index 1e6) Millionen Pfadsegmente bauen und den Tab einfrieren - ueber dieser Grenze
// gibt es Striche nur fuer belegte Indizes, hoechstens MAX_TICKS.
export const MAX_TICKS = 64;

export function clampZoom(zoom, limits = NET_ZOOM) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

export function mirrorRect(node) {
  return { x: node.x, y: -(node.y + node.h), w: node.w, h: node.h };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

export function wirePath(x1, y1, x2, y2) {
  // Waagerechte Tangenten wie im TD-Netzeditor; rueckwaerts laufende Leitungen bekommen mehr Ausholweg.
  const span = x2 - x1;
  const dx = Math.max(40, Math.abs(span) * 0.5, span < 0 ? 80 : 0);
  return `M${round1(x1)} ${round1(y1)} C${round1(x1 + dx)} ${round1(y1)} ${round1(x2 - dx)} ${round1(y2)} ${round1(x2)} ${round1(y2)}`;
}

// Indizes, an denen ein Anschluss-Strich steht: alle bis MAX_TICKS, darueber nur die belegten (sortiert, hoechstens
// max; bei mehr der erste Teil plus der hoechste, damit das untere Ende sichtbar bleibt). Aufwand haengt nur von der
// Zahl der belegten Indizes ab, nie vom Indexwert.
export function tickIndices(n, used, max = MAX_TICKS) {
  if (!Number.isSafeInteger(n) || n <= 1) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const list = [...(used || [])].filter((i) => Number.isSafeInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
  if (list.length <= max) return list;
  return [...list.slice(0, max - 1), list[list.length - 1]];
}

export function inAnchor(op, index) {
  const n = Math.max(op.nIn, index + 1);
  return { x: op.x, y: op.y + (op.h * (index + 1)) / (n + 1) };
}

export function outAnchor(op, index) {
  const n = Math.max(op.nOut, index + 1);
  return { x: op.x + op.w, y: op.y + (op.h * (index + 1)) / (n + 1) };
}

function endRel(end) {
  return end !== null && typeof end === "object" && Object.hasOwn(end, "op") ? end.op : null;
}

function emptyBounds() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function grow(bounds, x, y, w, h) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x + w);
  bounds.maxY = Math.max(bounds.maxY, y + h);
}

function finite(bounds) {
  if (bounds.minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return bounds;
}

// net = ProjectModel.network(compRel). lookup(rel) -> Operator aus dem Paket (isCOMP, connectors) oder null.
// absOf(rel) -> Originalpfad (fuer Platzhalter von Ops ausserhalb des aktuellen COMP).
export function layoutNetwork(net, { lookup = () => null, absOf = (rel) => rel } = {}) {
  const ops = [];
  const byRel = new Map();
  const known = emptyBounds();
  const content = emptyBounds();
  for (const o of net.known) {
    const r = mirrorRect(o);
    const item = { rel: o.rel, name: o.name, opType: o.opType, family: o.family, known: true, reason: null, ...r, nIn: 1, nOut: 1,
      usedIn: new Set(), usedOut: new Set() };
    ops.push(item);
    byRel.set(o.rel, item);
    grow(known, r.x, r.y, r.w, r.h);
  }
  const annotations = net.annotations.map((a) => {
    const r = mirrorRect(a.node);
    grow(known, r.x, r.y, r.w, r.h);
    return { rel: a.rel, name: a.name, title: a.title, body: a.body, mode: a.mode, enclosed: a.enclosed, ...r };
  });
  const base = finite({ ...known });
  // Reihe der Ops ohne Position: unter dem Bekannten, links buendig, hoechstens perRow je Zeile.
  let unknownRow = null;
  if (net.unknown.length) {
    const top = (known.minY === Infinity ? 0 : base.maxY) + (known.minY === Infinity ? UNKNOWN_BOX.labelGap : UNKNOWN_BOX.rowGap);
    const left = base.minX;
    net.unknown.forEach((o, i) => {
      const col = i % UNKNOWN_BOX.perRow;
      const row = Math.floor(i / UNKNOWN_BOX.perRow);
      const item = {
        rel: o.rel, name: o.name, opType: o.opType, family: o.family, known: false, reason: o.reason,
        x: left + col * (UNKNOWN_BOX.w + UNKNOWN_BOX.gap), y: top + row * (UNKNOWN_BOX.h + UNKNOWN_BOX.gap),
        w: UNKNOWN_BOX.w, h: UNKNOWN_BOX.h, nIn: 1, nOut: 1, usedIn: new Set(), usedOut: new Set(),
      };
      ops.push(item);
      byRel.set(o.rel, item);
    });
    const cols = Math.min(UNKNOWN_BOX.perRow, net.unknown.length);
    const rows = Math.ceil(net.unknown.length / UNKNOWN_BOX.perRow);
    unknownRow = {
      x: left, y: top - UNKNOWN_BOX.labelGap,
      w: cols * UNKNOWN_BOX.w + (cols - 1) * UNKNOWN_BOX.gap,
      h: UNKNOWN_BOX.labelGap + rows * UNKNOWN_BOX.h + (rows - 1) * UNKNOWN_BOX.gap,
      count: net.unknown.length,
    };
  }
  for (const item of ops) grow(content, item.x, item.y, item.w, item.h);
  for (const a of annotations) grow(content, a.x, a.y, a.w, a.h);
  if (unknownRow) grow(content, unknownRow.x, unknownRow.y, unknownRow.w, unknownRow.h);
  const area = finite({ ...content });

  // Anschlusszahl je Op: hoechster verwendeter Index + 1, bei COMPs mindestens die Zahl der In-/Out-Stecker.
  // Die belegten Indizes merken: sie tragen die Striche, wenn die Zahl ueber MAX_TICKS liegt.
  const raise = (rel, side, index) => {
    const item = byRel.get(rel);
    if (!item || !Number.isSafeInteger(index) || index < 0) return;
    item[side] = Math.max(item[side], index + 1);
    (side === "nIn" ? item.usedIn : item.usedOut).add(index);
  };
  for (const item of ops) {
    const o = lookup(item.rel);
    item.isCOMP = Boolean(o && o.isCOMP);
    const connectors = o && o.connectors;
    if (connectors && Array.isArray(connectors.in)) for (const c of connectors.in) raise(item.rel, "nIn", c.index);
    if (connectors && Array.isArray(connectors.out)) for (const c of connectors.out) raise(item.rel, "nOut", c.index);
  }
  for (const c of [...net.wires, ...net.outer]) {
    raise(endRel(c.to), "nIn", c.toIndex);
    raise(endRel(c.from), "nOut", c.fromIndex);
  }

  const wires = [];
  for (const c of net.wires) {
    const from = byRel.get(endRel(c.from));
    const to = byRel.get(endRel(c.to));
    if (!from || !to) continue;
    const a = outAnchor(from, c.fromIndex);
    const b = inAnchor(to, c.toIndex);
    wires.push({
      kind: c.kind, fromRel: from.rel, toRel: to.rel, fromIndex: c.fromIndex, toIndex: c.toIndex,
      dashed: Boolean(c.dashed) || !from.known || !to.known, outer: false, placeholder: null,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, d: wirePath(a.x, a.y, b.x, b.y),
    });
  }

  // Platzhalter: externe Enden ("extern: <pfad>") und Enden ausserhalb des aktuellen COMP. Nie navigierbar.
  const placeholders = [];
  const phByKey = new Map();
  const placeholder = (side, end, index) => {
    const external = end !== null && typeof end === "object" && Object.hasOwn(end, "external");
    const path = external ? end.external : absOf(endRel(end));
    const key = `${side}\n${index}\n${external ? "x" : "o"}\n${path}`;
    let ph = phByKey.get(key);
    if (!ph) {
      ph = { key, side, index, external, path, label: external ? `extern: ${path}` : `außerhalb: ${path}`, x: 0, y: 0, w: PLACEHOLDER_BOX.w, h: PLACEHOLDER_BOX.h };
      phByKey.set(key, ph);
      placeholders.push(ph);
    }
    return ph;
  };
  const comp = lookup(net.comp);
  const couplings = [];
  const coupledOp = (side, index) => {
    const list = comp && comp.connectors ? comp.connectors[side] : null;
    if (!Array.isArray(list)) return null;
    const hit = list.find((c) => c.index === index);
    const rel = hit ? (side === "in" ? hit.inOP : hit.outOP) : null;
    return rel !== null && byRel.has(rel) ? rel : null;
  };
  // Grenzleitungen des aktuellen COMP: Kopplung an In-/Out-OP steht nur in connectors (Vertrag 4.9), daher eine
  // gepunktete Kopplungslinie statt einer Leitung.
  for (const c of net.boundary.in) {
    const ph = placeholder("in", c.from, c.toIndex);
    couplings.push({ side: "in", index: c.toIndex, ph, opRel: coupledOp("in", c.toIndex), kind: c.kind });
  }
  for (const c of net.boundary.out) {
    const ph = placeholder("out", c.to, c.fromIndex);
    couplings.push({ side: "out", index: c.fromIndex, ph, opRel: coupledOp("out", c.fromIndex), kind: c.kind });
  }
  // Leitungen eines Kinds zu Enden ausserhalb dieses COMP: echte Leitung, aber zum Platzhalter gestrichelt.
  const outerWires = [];
  for (const c of net.outer) {
    const toRel = endRel(c.to);
    const fromRel = endRel(c.from);
    if (toRel !== null && byRel.has(toRel) && !(fromRel !== null && byRel.has(fromRel))) {
      outerWires.push({ c, inside: byRel.get(toRel), ph: placeholder("in", c.from, c.toIndex), side: "in" });
    } else if (fromRel !== null && byRel.has(fromRel)) {
      outerWires.push({ c, inside: byRel.get(fromRel), ph: placeholder("out", c.to, c.fromIndex), side: "out" });
    }
  }
  const side = { in: placeholders.filter((p) => p.side === "in"), out: placeholders.filter((p) => p.side === "out") };
  side.in.forEach((p, i) => {
    p.x = area.minX - PLACEHOLDER_BOX.margin - p.w;
    p.y = area.minY + i * (p.h + PLACEHOLDER_BOX.gap);
  });
  side.out.forEach((p, i) => {
    p.x = area.maxX + PLACEHOLDER_BOX.margin;
    p.y = area.minY + i * (p.h + PLACEHOLDER_BOX.gap);
  });
  for (const k of couplings) {
    const op = k.opRel !== null ? byRel.get(k.opRel) : null;
    const p = k.ph;
    if (k.side === "in") {
      k.x1 = p.x + p.w;
      k.y1 = p.y + p.h / 2;
      const b = op ? inAnchor(op, 0) : { x: k.x1 + 60, y: k.y1 };
      k.x2 = op ? op.x : b.x;
      k.y2 = b.y;
    } else {
      const a = op ? outAnchor(op, 0) : { x: p.x - 60, y: p.y + p.h / 2 };
      k.x1 = a.x;
      k.y1 = a.y;
      k.x2 = p.x;
      k.y2 = p.y + p.h / 2;
    }
    k.d = op ? wirePath(k.x1, k.y1, k.x2, k.y2) : null;
  }
  for (const w of outerWires) {
    const p = w.ph;
    let a;
    let b;
    if (w.side === "in") {
      a = { x: p.x + p.w, y: p.y + p.h / 2 };
      b = inAnchor(w.inside, w.c.toIndex);
    } else {
      a = outAnchor(w.inside, w.c.fromIndex);
      b = { x: p.x, y: p.y + p.h / 2 };
    }
    wires.push({
      kind: w.c.kind, fromRel: w.side === "out" ? w.inside.rel : null, toRel: w.side === "in" ? w.inside.rel : null,
      fromIndex: w.c.fromIndex, toIndex: w.c.toIndex, dashed: true, outer: true, placeholder: p.key,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, d: wirePath(a.x, a.y, b.x, b.y),
    });
  }
  const bounds = emptyBounds();
  if (content.minX !== Infinity) grow(bounds, area.minX, area.minY, area.maxX - area.minX, area.maxY - area.minY);
  for (const p of placeholders) grow(bounds, p.x, p.y, p.w, p.h);
  return {
    comp: net.comp, path: net.path, ops, byRel, annotations, wires, placeholders, couplings, unknownRow,
    knownBounds: finite(known), bounds: finite(bounds), hiddenChildren: net.hiddenChildren,
  };
}

// ------------------------------------------------------------------ Ansicht (Bildschirm = Welt * zoom + pan)

export function viewTransform(view) {
  const f = (v) => Math.round(v * 1000) / 1000;
  return `translate(${f(view.panX)} ${f(view.panY)}) scale(${f(view.zoom)})`;
}

export function worldToScreen(view, x, y) {
  return { x: x * view.zoom + view.panX, y: y * view.zoom + view.panY };
}

export function screenToWorld(view, x, y) {
  return { x: (x - view.panX) / view.zoom, y: (y - view.panY) / view.zoom };
}

export function fitView(bounds, width, height, { padding = FIT_PADDING, limits = NET_ZOOM } = {}) {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const usableW = Math.max(1, width - 2 * padding);
  const usableH = Math.max(1, height - 2 * padding);
  // Einpassen vergroessert kleine Netze nur bis fitMax; weiter hinein geht es per Pinch/Knopf.
  const zoom = clampZoom(Math.min(usableW / bw, usableH / bh, limits.fitMax ?? limits.max), limits);
  return {
    zoom,
    panX: (width - bw * zoom) / 2 - bounds.minX * zoom,
    panY: (height - bh * zoom) / 2 - bounds.minY * zoom,
  };
}

export function panBy(view, dx, dy) {
  return { zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy };
}

// Zoom um einen Bildschirmpunkt: der Weltpunkt unter (cx, cy) bleibt stehen.
export function zoomAt(view, factor, cx, cy, limits = NET_ZOOM) {
  const zoom = clampZoom(view.zoom * factor, limits);
  const w = screenToWorld(view, cx, cy);
  return { zoom, panX: cx - w.x * zoom, panY: cy - w.y * zoom };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Zwei Zeiger: Abstand bestimmt den Zoom, die Mitte verschiebt. Der Weltpunkt unter der Start-Mitte landet unter
// der aktuellen Mitte - Zoomen und Verschieben in einer Geste, ohne Drift.
export function pinchView(start, a0, b0, a1, b1, limits = NET_ZOOM) {
  const d0 = distance(a0, b0);
  const d1 = distance(a1, b1);
  const scale = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const zoom = clampZoom(start.zoom * scale, limits);
  const m0 = midpoint(a0, b0);
  const m1 = midpoint(a1, b1);
  const w = screenToWorld(start, m0.x, m0.y);
  return { zoom, panX: m1.x - w.x * zoom, panY: m1.y - w.y * zoom };
}

// Verschiebt nur so weit, dass das Weltrechteck mit Rand im Bild liegt (Tastaturfokus auf einem Op).
export function ensureVisible(view, rect, width, height, margin = 24) {
  const a = worldToScreen(view, rect.x, rect.y);
  const b = worldToScreen(view, rect.x + rect.w, rect.y + rect.h);
  let dx = 0;
  let dy = 0;
  if (b.x - a.x + 2 * margin > width) dx = margin - a.x;
  else if (a.x < margin) dx = margin - a.x;
  else if (b.x > width - margin) dx = width - margin - b.x;
  if (b.y - a.y + 2 * margin > height) dy = margin - a.y;
  else if (a.y < margin) dy = margin - a.y;
  else if (b.y > height - margin) dy = height - margin - b.y;
  return dx || dy ? panBy(view, dx, dy) : view;
}

export function sameView(a, b, epsilon = 1e-6) {
  if (!a || !b) return false;
  return Math.abs(a.zoom - b.zoom) < epsilon && Math.abs(a.panX - b.panX) < epsilon && Math.abs(a.panY - b.panY) < epsilon;
}

export function isViewValue(v) {
  return v !== null && typeof v === "object" && Number.isFinite(v.zoom) && v.zoom > 0 && Number.isFinite(v.panX) && Number.isFinite(v.panY);
}
