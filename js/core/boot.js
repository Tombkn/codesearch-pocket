// Alles zusammenstecken: Netz, Lab, CodeSearch, Tour, Gesten. Gleich fuer App und verify.mjs.

import { Net } from "./net.js";
import { Lab } from "./lab.js";
import { CodeSearch } from "./cs.js";
import { Tour } from "./tour.js";
import { Gestures } from "./gestures.js";

export function createApp({ course, net: netJson, code, ui }, storage = null) {
  const net = new Net(netJson, code);
  const lab = new Lab(net);
  const cs = new CodeSearch({ net, lab, ui, storage });
  const tour = new Tour({ course, cs, storage });
  const gestures = new Gestures(tour);
  return { net, lab, cs, tour, gestures, ui, course };
}
