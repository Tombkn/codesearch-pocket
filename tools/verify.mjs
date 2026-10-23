import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEngine } from "../js/engine.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const course = JSON.parse(readFileSync(join(root, "data/course.json"), "utf8"));
const hits = JSON.parse(readFileSync(join(root, "data/hits.json"), "utf8"));
const engine = createEngine(course, hits);

const failed = [];
for (let i = 0; i < course.lessons.length; i += 1) {
  const result = engine.solve(i);
  if (!result.ok) {
    failed.push({
      i,
      id: result.lesson.id,
      chapter: result.lesson.chapter,
      open: result.results.filter((row) => !row.ok).map((row) => ({
        key: row.key,
        op: row.op,
        expected: row.value,
        actual: row.actual,
        hint: row.hint,
      })),
    });
  }
}

console.log(JSON.stringify({
  total: course.lessons.length,
  passed: course.lessons.length - failed.length,
  failed: failed.length,
  samples: failed.slice(0, 25),
}, null, 2));
