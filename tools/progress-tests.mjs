import assert from "node:assert/strict";
import test from "node:test";
import { resolveProgressStep } from "../js/core/progress.js";
import { Tour } from "../js/core/tour.js";

const originals = Array.from({ length: 462 }, (_, i) => ({ id: `original-${i}` }));
const added = Array.from({ length: 96 }, (_, i) => ({ id: `workflow-${i}` }));
const extras = [{ id: "abschluss_wer_liest" }, { id: "pocket_repro_isolated" }];
const lessons = [...originals, ...added, ...extras];

test("Alte native Lesestelle bleibt bei Erweiterung gleich", () => {
  assert.equal(resolveProgressStep({ step: 300 }, lessons), 300);
});
test("Alte Abschluss- und Werkstattpositionen folgen ihren IDs", () => {
  assert.equal(resolveProgressStep({ step: 462 }, lessons), 558);
  assert.equal(resolveProgressStep({ step: 487 }, lessons), 559);
});
test("Neue Sicherung folgt ID auch nach einer weiteren Umordnung", () => {
  assert.equal(resolveProgressStep({ step: 558, lessonId: "workflow-7" }, [...extras, ...originals, ...added]), 471);
});
test("Fehlende Station oder kaputter alter Index wird nicht als andere Übung ausgegeben", () => {
  assert.equal(resolveProgressStep({ step: 487, lessonId: "deleted" }, lessons), 0);
  for (const step of [-4, 462.5, 900, "477"]) assert.equal(resolveProgressStep({ step }, lessons), 0);
});
test("Tour lädt die alte Station und speichert ihre ID ohne Häkchen zu erfinden", () => {
  const items = new Map([["codesearch-pocket-v2", JSON.stringify({ step: 487, done: { "original-1": "verified", "original-2": "confirmed", absent: "verified", "original-3": "kaputt" }, skipped: ["original-4", "absent"] })]]);
  const storage = { getItem: (key) => items.get(key), setItem: (key, value) => items.set(key, value) };
  const tour = new Tour({ course: { lessons, chapters: [] }, cs: { lab: {} }, storage });
  tour.load();
  assert.equal(tour.lesson().id, "pocket_repro_isolated");
  assert.deepEqual(tour.done, { "original-1": "verified", "original-2": "confirmed" });
  assert.deepEqual([...tour.skipped], ["original-4"]);
  tour.save();
  assert.equal(JSON.parse(items.get("codesearch-pocket-v2")).lessonId, "pocket_repro_isolated");
});
