// Projekt-Ansichten (Paket P2a-2, Vertrag POCKET-PROJECTS-SPEC Abschnitte 7/14): oeffentliche Schnittstelle fuer die
// Projekt-Huelle (P2a-1). Alle Funktionen bauen DOM nur mit createElement/textContent (keine innerHTML, keine
// Paketwerte in href/src/style/on*) auf einem ProjectModel aus js/projects/model.js; CSS-Klassen tragen das Praefix
// "pv-" (Block projects-views in css/app.css).
//
//   renderNetwork(container, model, view, actions)   -> {update(view), destroy()}
//     view    = {comp: rel, selected: rel|null, zoom, panX, panY}   (zoom/pan null -> einpassen)
//     actions = {selectOp(rel|null), enterComp(rel), goParent(), openDetails(rel), openCode(sourceKey, line), setView(partial)}
//   renderCode(container, model, view, actions)      -> {update(view), destroy()}
//     view    = {source: key, line: int|null, scrollTop, find: str}
//     actions = {openDetails(rel), openSource(key, line), addNote(anchor), copyText(text, kind), setView(partial)}
//     addNote bekommt einen fertigen Anker nach Vertrag 13 (createAnchor aus js/projects/anchors.js).
//     copyText: kind = "path" | "code" | "selection" - die Huelle meldet danach, WAS kopiert wurde.
//   renderDetails(container, model, rel, actions)    -> {destroy()}   actions wie oben + openUnderstand(target)
//   renderUnderstand(container, model, target, actions) -> {destroy()} target = {op: rel} | {source: key, symbol}
//   renderNotes(container, notes, model, actions)    -> {destroy()}   actions: openCode|openSource, openDetails, deleteNote?
//
// Fehlende Aktionen schalten die zugehoerigen Knoepfe aus, statt zu werfen.

import { renderNetwork } from "./project-network.js";
import { renderCode } from "./project-code.js";
import { renderDetails, renderUnderstand } from "./project-details.js";
import { renderNotes } from "./project-notes.js";

export { renderNetwork, renderCode, renderDetails, renderUnderstand, renderNotes };
