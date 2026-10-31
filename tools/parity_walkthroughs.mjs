// Ausschließlich Gesten und reale Wartezeit; setClipboard entspricht dem editierbaren JSON-Dialog.
export const PARITY_SCRIPTS = {
  pocket_watch_start: (g) => g.enter(">states beobachten"),
  pocket_watch_change: async (g) => { g.slPulse("Fire"); await new Promise((resolve) => setTimeout(resolve, 1100)); },
  pocket_watch_stop: (g) => { g.enter(">states stoppen"); g.enter(">states verlauf"); },
  pocket_request_invalid: (g) => { g.setClipboard('{"schema":"codesearch.request.v1","id":"kaputt","questions":[{"kind":"overview"}]}'); g.enter(">nachfrage"); },
  pocket_request_valid: (g) => { g.enter(">beispiel anfrage"); g.enter(">nachfrage"); },
  pocket_request_stale: (g) => { const request = JSON.parse(g.cs.clipboard); request.revision = "absichtlich-alt"; g.setClipboard(JSON.stringify(request)); g.enter(">nachfrage"); },
  pocket_claims: (g) => { g.enter(">beispiel antwort"); g.enter(">antwort"); },
  pocket_claim_counterexample: (g) => {
    const explanation = JSON.parse(g.cs.clipboard);
    explanation.claims = [{ id: "quellvergleich", kind: "source", source: "/project1/CodeSearch_Tutorial/StateLab/StateLabExt", line: 1, text: "absichtlich falscher Quelltext" }];
    g.setClipboard(JSON.stringify(explanation)); g.enter(">antwort");
    g.tapRow((h) => h.art === "WIDERSPROCHEN");
  },
  pocket_preview_rule: (g) => { g.enter(">beispiel vorschau"); g.enter(">vorschau"); },
  pocket_repro_missing: (g) => g.enter(">minimalfall prüfen"),
  pocket_repro_create: (g) => { g.slPar("Doublefire", true); g.slPulse("Fire"); g.enter(">minimalfall"); },
  pocket_repro_isolated: (g) => { g.slPar("Doublefire", false); g.enter(">minimalfall prüfen"); },
};
