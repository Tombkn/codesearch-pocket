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
// Carbon LED / Carbon Glow (1.10.2): dieselben Rollen wie nativ LOOK_FAMILY_COLORS / LOOK_MEANING_COLORS - satter, DAT orange statt pink.
// Seit 1.10.3 kommen die Werte aus ui.json (tools/uitext.py WANTED); diese Literale sind nur der Fallback, falls der Key fehlt.
const VIVID_FALLBACK = {
  carbon_led: { purple: [0.78, 0.52, 1.0], green: [0.36, 0.98, 0.46], blue: [0.36, 0.66, 1.0], yellow: [1.0, 0.92, 0.26], cyan: [0.30, 0.95, 1.0], magenta: [1.0, 0.58, 0.20], red: [1.0, 0.40, 0.42] },
  carbon_glow: { purple: [0.82, 0.58, 1.0], green: [0.42, 1.0, 0.52], blue: [0.42, 0.72, 1.0], yellow: [1.0, 0.94, 0.32], cyan: [0.36, 0.98, 1.0], magenta: [1.0, 0.62, 0.24], red: [1.0, 0.40, 0.42], amber: [0.52, 0.78, 1.0] },
};
// Native Familienfarbe → Pocket-Rolle (COMP hat in Pocket keine eigene Rolle); Bedeutungsfarben: hot/trigger → red, write → amber
const FAMILY_ROLE = { TOP: "purple", CHOP: "green", SOP: "blue", DAT: "magenta", MAT: "yellow", POP: "cyan" };
const rgbOnly = (value) => (Array.isArray(value) ? value.slice(0, 3) : null);
export function vividRoles(ui, key) {
  const family = ui?.LOOK_FAMILY_COLORS?.[key];
  const meaning = ui?.LOOK_MEANING_COLORS?.[key];
  if (!family && !meaning) return VIVID_FALLBACK[key] || {};
  const roles = {};
  for (const [name, role] of Object.entries(FAMILY_ROLE)) if (rgbOnly(family?.[name])) roles[role] = rgbOnly(family[name]);
  if (rgbOnly(meaning?.trigger)) roles.red = rgbOnly(meaning.trigger);
  if (rgbOnly(meaning?.hot)) roles.red = rgbOnly(meaning.hot);
  if (rgbOnly(meaning?.write)) roles.amber = rgbOnly(meaning.write);
  return roles;
}
export function lookVariables(palette, key = "", ui = null) {
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
  Object.assign(roles, vividRoles(ui, key));
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
// Glas-Looks: body[data-glass] schaltet in css/app.css Blur, Spiegelung und Lichtkanten frei (smoke | black | navy | frost).
// Welche Looks Glas sind, sagt seit 1.10.3 das native GLASS_LOOKS (ui.json); diese Tabelle ordnet die CSS-Variante zu
// und ist zugleich der Fallback, wenn der Key fehlt. Ein neuer nativer Glas-Look ohne Eintrag bekommt 'smoke'.
export const GLASS_LOOKS = { smoked_glass: 'smoke', glass_black: 'black', glass_navy: 'navy', frosted_glass: 'frost' };
export function glassVariant(ui, key) {
  const glass = Array.isArray(ui?.GLASS_LOOKS) ? ui.GLASS_LOOKS : Object.keys(GLASS_LOOKS);
  return glass.includes(key) ? (GLASS_LOOKS[key] || 'smoke') : '';
}
export function applyLook(body, ui, key) {
  const palette = ui.CODESEARCH_LOOKS?.[key];
  body.dataset.look = key;
  const variant = glassVariant(ui, key);
  if (variant) body.dataset.glass = variant; else delete body.dataset.glass;
  if (!palette) return;
  body.style.colorScheme = palette[8] ? "light" : "dark";
  for (const [name, value] of Object.entries(lookVariables(palette, key, ui))) body.style.setProperty(name, value);
  // Native GLASS_SHADOW: Schattenkante unter jeder Leiste = Grundfarbe × Faktor (dunkel / hell); nur bei Glas-Looks gesetzt
  const factor = ui.GLASS_SHADOW?.[palette[8] ? "light" : "dark"];
  if (variant && typeof factor === "number") body.style.setProperty("--glass-shadow-edge", rgb(palette[1].map((v) => v * factor)));
  else body.style.removeProperty("--glass-shadow-edge");
}
