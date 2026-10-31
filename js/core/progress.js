// Bis 195bfcd499: 462 native Stationen, danach 26 lokale Ergänzungen.
// Alte Sicherungen enthalten nur einen Index. Die festen IDs retten ihre Lesestelle
// auch dann, wenn ein neuer nativer Kurs vor diesen Ergänzungen wächst.
const LEGACY_EXTRAS = [
  "abschluss_wer_liest", "abschluss_woher_groesse", "abschluss_strecke", "abschluss_codezeile",
  "abschluss_pro_frame", "abschluss_state_impact", "abschluss_einstieg", "abschluss_route",
  "abschluss_beweis_cool", "abschluss_warum", "abschluss_tabelle", "abschluss_zugriff",
  "abschluss_alias", "abschluss_bilanz", "pocket_watch_start", "pocket_watch_change",
  "pocket_watch_stop", "pocket_request_invalid", "pocket_request_valid", "pocket_request_stale",
  "pocket_claims", "pocket_claim_counterexample", "pocket_preview_rule", "pocket_repro_missing",
  "pocket_repro_create", "pocket_repro_isolated",
];

export function resolveProgressStep(data, lessons) {
  if (typeof data.lessonId === "string") {
    const found = lessons.findIndex((lesson) => lesson.id === data.lessonId);
    return found < 0 ? 0 : found;
  }
  const step = Number.isInteger(data.step) ? data.step : 0;
  if (step < 0) return 0;
  if (step < 462) return Math.min(step, Math.max(0, lessons.length - 1));
  const id = LEGACY_EXTRAS[step - 462];
  const found = id ? lessons.findIndex((lesson) => lesson.id === id) : -1;
  return found < 0 ? 0 : found;
}
