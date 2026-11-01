// Die Palette kommt aus dem nativen CODESEARCH_LOOKS. Nur die Zuordnung zu
// Pocket-Flächen und die lesbaren semantischen Farben leben hier.
export const rgb = (value) => `rgb(${value.map((v) => Math.round(v * 255)).join(", ")})`;
const mix = (a, b, amount) => a.map((v, i) => v * (1 - amount) + b[i] * amount);
const luminance = (color) => color.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
export function contrast(a, b) {
  const aa = luminance(a), bb = luminance(b);
  return (Math.max(aa, bb) + 0.05) / (Math.min(aa, bb) + 0.05);
}
function readable(color, backgrounds, text) {
  for (let n = 0; n <= 20; n += 1) {
    const result = mix(color, text, n / 20);
    if (backgrounds.every((bg) => contrast(result, bg) >= 4.6)) return result;
  }
  return text;
}
export function lookVariables(palette) {
  if (!palette || palette.length !== 9) return {};
  const [, base, surface, raised, line, text, muted, accent, light] = palette;
  const selected = mix(surface, accent, 0.3);
  const backgrounds = [base, surface, raised, selected];
  const roles = light ? {
    amber: [0.12, 0.32, 0.60], cyan: [0.03, 0.32, 0.48], green: [0.04, 0.35, 0.18], red: [0.68, 0.05, 0.09],
    yellow: [0.27, 0.22, 0.66], magenta: [0.55, 0.08, 0.36], purple: [0.39, 0.19, 0.62], blue: [0.08, 0.30, 0.66],
    string: [0.26, 0.35, 0.07],
  } : {
    amber: [0.48, 0.74, 1.0], cyan: [0.34, 0.78, 0.90], green: [0.44, 0.82, 0.48], red: [0.94, 0.42, 0.42],
    yellow: [0.65, 0.71, 1.0], magenta: [0.95, 0.56, 0.82], purple: [0.72, 0.56, 0.95], blue: [0.45, 0.66, 0.98],
    string: [0.76, 0.91, 0.55],
  };
  const colors = Object.fromEntries(Object.entries(roles).map(([key, value]) => [key, readable(value, backgrounds, text)]));
  const safeMuted = readable(muted, backgrounds, text);
  const uiAccent = readable(accent, backgrounds, text);
  const onAccent = contrast(uiAccent, [1, 1, 1]) > contrast(uiAccent, [0, 0, 0]) ? [1, 1, 1] : [0, 0, 0];
  const tokens = {
    bg: base, win: surface, panel: surface, panel2: raised, line, line2: line, text, muted: safeMuted, dim: safeMuted,
    sel: selected, "sel-line": accent, "look-accent": accent, accent: uiAccent,
    "on-accent": onAccent,
    // Eingabefelder heben sich in jedem Look ab (wie nativ _look_field_colors): Feldfarbe + Akzentrahmen.
    field: light ? mix([1, 1, 1], accent, 0.08) : mix(raised, accent, 0.18), "field-line": uiAccent,
    chip: raised, code: base, tour: base, tour2: surface,
    ...colors, "dat-fg": colors.magenta, "dat-bg": mix(surface, colors.magenta, 0.09),
  };
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--${key}`, rgb(value)]));
}
export function applyLook(body, ui, key) {
  const palette = ui.CODESEARCH_LOOKS?.[key];
  body.dataset.look = key;
  if (!palette) return;
  body.style.colorScheme = palette[8] ? "light" : "dark";
  for (const [name, value] of Object.entries(lookVariables(palette))) body.style.setProperty(name, value);
}
