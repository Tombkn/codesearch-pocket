"""Lokale Attrappe der GitHub-Contents-API fuer die Pocket-Browser-Tests (Vertrag POCKET-PROJECTS-SPEC 11 "Lesen").

Bildet nur nach, was Pocket liest:
  GET /repos/<owner>/<repo>/contents/<pfad>
    Accept: application/vnd.github.raw+json  -> rohe Bytes der Datei aus dem Fixture-Verzeichnis
    sonst (application/vnd.github+json, object) -> JSON-Objekt mit base64 wie bei GitHub (> 1 MiB nur raw/object)
  ETag + If-None-Match -> 304 · Bearer fehlt/falsch -> 401 · gesperrtes Token -> 403
  CORS nur fuer die Test-Origin(s): Access-Control-Allow-Origin exakt, OPTIONS-Preflight mit GitHubs
  Allow-Headers-Liste (enthaelt X-GitHub-Api-Version).
  Pfade gross/klein-genau wie Git: Schreibvarianten, Punkt am Namensende, Geraetenamen und Umwege ueber
  Verknuepfungen (Symlink, Junction) ergeben 404 - auch auf Windows (getestet) und macOS (nicht getestet), deren
  Dateisysteme solche Varianten sonst oeffnen.

Cache-Control (--cache-control, Standard "github"): Lese-Antworten (200 und 304) tragen GitHubs Wert fuer
authentifizierte Anfragen "private, max-age=60, s-maxage=60". Nur so faellt im Browser-Test auf, wenn ein Client
cache:"no-store" vergisst (Vertrag 11): dann beantwortet der HTTP-Cache des Browsers die Wiederholung, und
/__mock/counters zaehlt sie nicht. Fehlerantworten tragen keinen Cache-Control-Kopf (wie GitHubs 404 ohne Token,
Probe 2026-11-05; authentifizierte Fehler bei GitHub: UNKNOWN). Die Steuerung unter /__mock/ ist immer no-store.
"--cache-control no-store" setzt no-store auf jede Antwort (frueheres Verhalten, fuer Gegenproben).

Grenzen mit Absicht: nur 127.0.0.1 (fest, keine Option), nur Test- und Kanarienwerte als Tokens - nie echte.
Das Fixture-Verzeichnis wird nie veraendert: Hilfsbefehle (neuer Kopf, Grabstein, Datei, Verzoegerung, Fehler,
Token sperren) schreiben in eine Ueberlagerung im Speicher. Log und Zaehler enthalten nie ein Token, nur dessen
Etikett (valid-1, blocked-1, ...), und nie die Query (dort koennte ein falsch gebauter Client ein Token anhaengen).
Kopf und Index, die set-head/publish schreiben, halten die Regeln des strengen Lesers im Transport ein (Name 1-120,
Pfad 1-1024 Codepoints, gueltige Zeiten); Paketwerte ausserhalb dieser Grenzen werden ersetzt und in "fallbacks"
gemeldet, damit ein absichtlich kaputtes Testpaket als Paketfehler auffaellt und nicht als kaputter Speicher.

Abweichungen von GitHub (bewusst, fuer eindeutige Tests): 401 auch ohne Token (GitHub meldet bei privaten Repos
dann 404), Verzeichnisse -> 501 statt Liste, Access-Control-Allow-Origin exakt statt "*", Allow-Methods nur GET,
Preflight-Max-Age 0 statt 86400 (jeder Request wird gezaehlt), ETag immer schwach (W/...; GitHub sendet bei
Rohantworten einen starken), X-GitHub-Api-Version wird nicht ausgewertet (nur im Log vermerkt), keine
Rate-Limit-Koepfe. Belegt (Probe an einem oeffentlichen Repo): Content-Type der Rohantwort
"application/vnd.github.raw+json; charset=utf-8".

Aufruf (Python 3.9+, nur Standardbibliothek):
  python -I -B tools/mock_github_store.py serve --port 8765 --fixtures <ordner> --origin http://127.0.0.1:8123 \\
      --tokens-file <tokens.json>            (JSON {"valid": [..], "blocked": [..]}; alternativ --token/--blocked-token)
      [--cache-control github|no-store]
  python -I -B tools/mock_github_store.py set-head --port 8765 --project psp_... --revision rev_... [--seq N]
  python -I -B tools/mock_github_store.py publish --port 8765 --file paket.json [--seq N]
  python -I -B tools/mock_github_store.py delete-project --port 8765 --project psp_...
  python -I -B tools/mock_github_store.py log|counters|state|reset --port 8765
Die erste Zeile auf stdout von "serve" ist JSON {"event":"ready", "port":..., ...} (Port 0 = frei waehlen).

Steuerung per HTTP fuer Testskripte (ohne CORS; POST verlangt Content-Type application/json, damit eine Seite im
Browser sie nicht ohne Preflight ausloesen kann - und der Preflight fuer /__mock/ wird abgelehnt):
  GET  /__mock/log · /__mock/counters · /__mock/state
  POST /__mock/<befehl> mit JSON-Objekt: set-head {projectId, revisionId, seq?, committedAt?, allowMissing?,
       exportedAt?, projectName?} -> {head, fallbacks} · publish {base64, seq?, committedAt?} -> {projectId,
       revisionId, head, fallbacks} · delete-project {projectId, deletedAt?} · put-file {path, base64|text} ·
       remove-file {path} · delay {path, ms} · fail {path, status|null} ·
       token {label, state: valid|blocked|removed} · reset {} · reset-log {}
"""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote, urlsplit

HOST = "127.0.0.1"  # fest verdrahtet: die Attrappe ist nie aus dem Netz erreichbar
DEFAULT_OWNER = "Tombkn"
DEFAULT_REPO = "codesearch-pocket-data"

STORE_FORMAT = "codesearch.pocket.store"
INDEX_FORMAT = "codesearch.pocket.index"
PROJECT_FORMAT = "codesearch.pocket.project"
INSTALL_ID = "mock-store"  # passt zur installId-Regel des Transports: [A-Za-z0-9_-]{8,64}
HEAD_LOG_LIMIT = 200  # Vertrag 11: Kopf-Log hoechstens 200 Eintraege
REQUEST_LOG_LIMIT = 20000  # Request-Log der Attrappe; aeltere Eintraege fallen heraus (Zaehler bleiben)
ONE_MIB = 1024 * 1024
MAX_CONTROL_BODY = 64 * ONE_MIB  # publish traegt ein Paket bis 32 MiB als base64

# Genau GitHubs Liste aus dem Preflight von api.github.com (Probe OPTIONS .../contents/projects/index.json,
# 2026-11-05). Gespiegelt statt gekuerzt: ein Header, den GitHub erlaubt (X-GitHub-Api-Version, wie ihn der
# PC-Transport sendet), darf hier nicht scheitern - und einer, den GitHub ablehnt, soll hier genauso scheitern.
# Accept steht nicht darin, weil der Browser ihn fuer Werte wie application/vnd.github.raw+json gar nicht erfragt
# (CORS-safelisted request-header).
GITHUB_ALLOWED_REQUEST_HEADERS = (
    "Authorization", "Content-Type", "If-Match", "If-Modified-Since", "If-None-Match", "If-Unmodified-Since",
    "Accept-Encoding", "X-GitHub-OTP", "X-Requested-With", "User-Agent", "GraphQL-Features",
    "X-Github-Next-Global-ID", "X-GitHub-Api-Version", "X-Fetch-Nonce", "Copilot-Integration-Id", "DD-CLIENT-TOKEN",
    "X-Client-Application", "X-Experiment-Commit-Agent-Version", "Idempotency-Key")
ALLOWED_REQUEST_HEADERS = ", ".join(GITHUB_ALLOWED_REQUEST_HEADERS)
ALLOWED_REQUEST_HEADER_NAMES = frozenset(name.lower() for name in GITHUB_ALLOWED_REQUEST_HEADERS)
EXPOSED_HEADERS = "ETag, X-Mock-Request-Id"
CONTROL_PREFIX = "/__mock/"

# GitHubs Cache-Control fuer authentifizierte Lese-Antworten (docs.github.com "Getting started with the REST API",
# Beispielantwort; ohne Token sendet GitHub "public, ..."). Live mit Token nicht geprueft: hier gibt es nie eins.
GITHUB_CACHE_CONTROL = "private, max-age=60, s-maxage=60"
CACHE_MODES = ("github", "no-store")
# Welche Art Antwort gerade entsteht - davon haengt der Cache-Control-Kopf ab (_cache_control).
ResponseKind = Literal["read", "control", "other"]

PROJECT_ID = re.compile(r"psp_[0-9a-f]{32}")
REVISION_ID = re.compile(r"rev_[0-9a-f]{32}")
TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
API_VERSION_FORM = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# Grenzen des strengen Speicher-Lesers im Transport (_is_name/_is_path; Vertrag 4.1 und 9).
NAME_LIMIT = 120
PATH_LIMIT = 1024
FALLBACK_NAME = "Mock-Projekt"
FALLBACK_ROOT = "/project1"
CONTENTS = re.compile(r"/repos/([^/]+)/([^/]+)/contents/(.+)")
# Ein Pfadsegment: kein leeres, kein ".", kein "..", kein verstecktes, kein Backslash, kein Steuerzeichen.
SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,254}")
# Token-Form nach RFC 6750 (b64token); nur Testwerte, die Form verhindert Header-Bruch und Leerzeichen-Tricks.
TOKEN_FORM = re.compile(r"[A-Za-z0-9._~+/-]{8,255}=*")
RAW_MEDIA = re.compile(r"application/vnd\.github(?:\.v3)?\.raw")
OBJECT_MEDIA = re.compile(r"application/vnd\.github(?:\.v3)?\.object")
TOKEN_STATES = ("valid", "blocked", "removed")


class MockError(Exception):
    """Fehler eines Hilfsbefehls; status = HTTP-Status der Steuerantwort, message ohne Token oder Dateiinhalt."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class TokenEntry:
    label: str
    value: str
    state: str  # valid | blocked | removed (removed = widerrufen -> 401 wie "Bad credentials")
    initial: str


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def git_blob_sha(data: bytes) -> str:
    """Git-Blob-SHA wie bei GitHub (sha1 ueber "blob <laenge>\\0" + Bytes)."""
    return hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()


def store_bytes(value: Any) -> bytes:
    """Speicherdateien in derselben Form wie cs_pocket_transport._store_bytes (kompakt, Schluessel sortiert).

    Ein Wert, der so nicht speicherbar ist (einzelnes Surrogat, NaN aus einer per put-file abgelegten Datei), wird
    zu einer 409-Antwort statt eines abgebrochenen Requests - die Meldung nennt nur die Art, nie den Inhalt.
    """
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                          allow_nan=False).encode("utf-8")
    except ValueError as error:  # UnicodeEncodeError ist ein ValueError
        raise MockError(409, f"Speicherdatei nicht als UTF-8-JSON schreibbar ({type(error).__name__})") from error


def is_timestamp(value: Any) -> bool:
    """RFC 3339 UTC mit echtem Kalenderdatum - dieselbe Probe wie cs_pocket_transport._is_timestamp."""
    if type(value) is not str or TIMESTAMP.fullmatch(value) is None:
        return False
    try:
        time.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return False
    return True


def is_text(value: Any, limit: int) -> bool:
    """1..limit Codepoints und als UTF-8 speicherbar (kein einzelnes Surrogat) - wie cs_pocket_transport._is_text."""
    if type(value) is not str or not 1 <= len(value) <= limit:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def json_body(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def make_etag(body: bytes) -> str:
    # Schwacher ETag wie meist bei api.github.com; Pocket muss ihn unveraendert zuruecksenden (W/ inklusive).
    return 'W/"%s"' % hashlib.sha256(body).hexdigest()[:40]


def etag_matches(header: str | None, etag: str) -> bool:
    """If-None-Match nach schwachem Vergleich (RFC 9110): Liste, "*", W/ wird ignoriert."""
    if header is None:
        return False
    wanted = etag.removeprefix("W/")
    for item in header.split(","):
        candidate = item.strip()
        if candidate == "*" or (candidate and candidate.removeprefix("W/") == wanted):
            return True
    return False


def safe_rel(raw: str) -> str | None:
    """Repo-Pfad aus der URL pruefen: einmal dekodieren, nur einfache Segmente - sonst None (= 404)."""
    try:
        text = unquote(raw, errors="strict")
    except UnicodeDecodeError:
        return None
    if not text or len(text) > 1024:
        return None
    parts = text.split("/")
    if any(SEGMENT.fullmatch(part) is None for part in parts):
        return None
    return "/".join(parts)


def package_facts(data: bytes) -> dict[str, Any]:
    """Kopf-Felder aus einem Paket lesen, wie der Transport sie setzt. Kaputte Pakete (Testvektoren!) -> {}.

    Uebernommen wird nur, was der strenge Speicher-Leser im Transport annimmt. Ein vorhandener, aber unzulaessiger
    Wert (Name ueber 120 Codepoints, Pfad ueber 1024, 30. Februar, einzelnes Surrogat) steht unter "rejected" -
    sonst schriebe set-head einen Kopf, an dem der ganze Speicher scheitert statt nur das Testpaket.
    """
    try:
        doc = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
        return {}
    if not isinstance(doc, dict):
        return {}
    facts: dict[str, Any] = {}
    rejected: list[str] = []
    if isinstance(doc.get("projectId"), str):
        facts["projectId"] = doc["projectId"]
    revision = doc.get("revision")
    if isinstance(revision, dict) and isinstance(revision.get("id"), str):
        facts["revisionId"] = revision["id"]
    root = doc.get("exportRoot")
    candidates = {"exportedAt": (doc.get("exportedAt"), is_timestamp),
                  "projectName": (doc.get("projectName"), lambda value: is_text(value, NAME_LIMIT)),
                  "rootPath": (root.get("path") if isinstance(root, dict) else None,
                               lambda value: is_text(value, PATH_LIMIT))}
    for field, (value, accepted) in candidates.items():
        if value is None:
            continue
        if accepted(value):
            facts[field] = value
        else:
            rejected.append(field)
    if isinstance(doc.get("operators"), list) and isinstance(doc.get("codeSources"), list):
        facts["counts"] = {"operators": len(doc["operators"]), "codeSources": len(doc["codeSources"])}
    facts["rejected"] = sorted(rejected)
    return facts


def _require(condition: bool, message: str, status: int = 400) -> None:
    if not condition:
        raise MockError(status, message)


def _check_time(value: Any, field: str) -> str | None:
    if value is None:
        return None
    _require(is_timestamp(value), f"{field} muss RFC-3339-UTC mit gueltigem Datum sein (YYYY-MM-DDTHH:MM:SSZ)")
    return value


def _check_seq(value: Any) -> int | None:
    if value is None:
        return None
    _require(type(value) is int and 1 <= value <= 2 ** 53 - 1, "seq muss eine Ganzzahl >= 1 sein")
    return value


class MockStore:
    """Zustand der Attrappe. Alle Methoden sind threadsicher (ein Lock), weil der Server je Request einen Thread hat."""

    def __init__(self, fixtures: Path, *, owner: str = DEFAULT_OWNER, repo: str = DEFAULT_REPO,
                 origins: Iterable[str] = (), tokens: Iterable[str] = (), blocked: Iterable[str] = (),
                 preflight_max_age: int = 0, cache_control: str = "github",
                 clock: Callable[[], str] = utc_now) -> None:
        try:
            root = Path(fixtures).resolve(strict=True)
        except OSError as error:
            raise MockError(400, f"--fixtures nicht gefunden ({type(error).__name__})") from error
        if not root.is_dir():
            raise MockError(400, "--fixtures ist kein Verzeichnis")
        _require(cache_control in CACHE_MODES, "--cache-control muss github oder no-store sein")
        self.root = root
        self.owner = owner
        self.repo = repo
        self.cache_control = cache_control
        self.origins = frozenset(origins)
        for origin in self.origins:
            parts = urlsplit(origin)
            # Exakte Origin: Schema + Host (+ Port), ohne Pfad und ohne Schraegstrich - sonst passt der Vergleich nie.
            _require(parts.scheme in ("http", "https") and bool(parts.netloc) and parts.path == ""
                     and not parts.query and not parts.fragment, f"keine Origin: {origin!r}")
        self.preflight_max_age = preflight_max_age
        self._clock = clock
        self._lock = threading.RLock()
        self._tokens: list[TokenEntry] = []
        seen: set[str] = set()
        for state, values in (("valid", tokens), ("blocked", blocked)):
            for number, value in enumerate(values, start=1):
                # Fehlermeldungen nennen nur das Etikett, nie den Wert.
                _require(TOKEN_FORM.fullmatch(value) is not None, f"Token {state}-{number}: ungueltige Form")
                _require(value not in seen, f"Token {state}-{number}: doppelt")
                seen.add(value)
                self._tokens.append(TokenEntry(f"{state}-{number}", value, state, state))
        self._overlay: dict[str, bytes | None] = {}
        self._delays: dict[str, float] = {}
        self._failures: dict[str, int] = {}
        self._log: list[dict[str, Any]] = []
        self._counts: dict[str, int] = {}
        self._next_id = 1
        self._started = time.monotonic()

    # ---------------------------------------------------------------- Lesen
    def lookup(self, rel: str) -> tuple[str, bytes | None]:
        """("file", bytes) | ("dir", None) | ("missing", None). Ueberlagerung zuerst, dann das Verzeichnis.

        Git-Pfade unterscheiden Gross/Klein; GitHub antwortet auf STORE.JSON oder "store.json." mit 404. Windows und
        macOS oeffnen solche Varianten trotzdem (Gross/Klein egal, Punkt am Ende wird abgeschnitten, 8.3-Kurznamen).
        Darum muss jedes Segment exakt so im Verzeichnis stehen, und der aufgeloeste Pfad muss genau rel sein - so
        fuehrt auch kein Symlink und keine Junction auf eine andere Datei, weder hinaus noch innerhalb der Fixtures.
        """
        with self._lock:
            if rel in self._overlay:
                data = self._overlay[rel]
                return ("file", data) if data is not None else ("missing", None)
        current = self.root
        for part in rel.split("/"):
            try:
                names = os.listdir(current)
            except OSError:  # kein Verzeichnis (Datei mitten im Pfad) oder nicht lesbar: gibt es nicht
                return "missing", None
            if part not in names:
                return "missing", None
            current = current / part
        try:
            resolved = current.resolve(strict=True)
        except OSError:  # FileNotFoundError und Windows-Pfadfehler: beides heisst "gibt es nicht"
            return "missing", None
        if not resolved.is_relative_to(self.root) or resolved.relative_to(self.root).as_posix() != rel:
            return "missing", None
        if resolved.is_dir():
            return "dir", None
        try:
            return "file", resolved.read_bytes()
        except OSError:
            return "missing", None

    def _read_bytes(self, rel: str) -> bytes | None:
        kind, data = self.lookup(rel)
        return data if kind == "file" else None

    def _read_json(self, rel: str) -> Any:
        data = self._read_bytes(rel)
        if data is None:
            return None
        try:
            return json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
            raise MockError(409, f"{rel} ist kein lesbares JSON ({type(error).__name__})") from error

    # ---------------------------------------------------------------- Zugriff
    def check_auth(self, header: str | None) -> tuple[str, str | None]:
        """("none"|"wrong"|"valid"|"blocked"|"removed", Etikett). Der Wert selbst verlaesst diese Methode nie."""
        if header is None or not header.strip():
            return "none", None
        scheme, _, value = header.strip().partition(" ")
        value = value.strip()
        if scheme.lower() not in ("bearer", "token") or not value:
            return "wrong", None
        with self._lock:
            entries = list(self._tokens)
        found: TokenEntry | None = None
        for entry in entries:
            # Vergleich in konstanter Zeit, auch in der Attrappe: die richtige Gewohnheit kostet nichts.
            if hmac.compare_digest(entry.value.encode("utf-8"), value.encode("utf-8")):
                found = entry
        if found is None:
            return "wrong", None
        return found.state, found.label

    def cors_headers(self, origin: str | None) -> dict[str, str]:
        if origin is not None and origin in self.origins:
            return {"Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": EXPOSED_HEADERS}
        return {}

    def failure_for(self, rel: str) -> int | None:
        with self._lock:
            return self._failures.get(rel)

    def delay_for(self, rel: str) -> float:
        with self._lock:
            return self._delays.get(rel, 0.0)

    # ---------------------------------------------------------------- Log und Zaehler
    def record(self, entry: dict[str, Any]) -> int:
        with self._lock:
            entry_id = self._next_id
            self._next_id += 1
            entry = {"id": entry_id, "atMs": int((time.monotonic() - self._started) * 1000), **entry}
            self._log.append(entry)
            if len(self._log) > REQUEST_LOG_LIMIT:
                del self._log[: len(self._log) - REQUEST_LOG_LIMIT]
            key = f'{entry["method"]} {entry["status"]}'
            self._counts[key] = self._counts.get(key, 0) + 1
            return entry_id

    def next_request_id(self) -> int:
        with self._lock:
            return self._next_id

    def log_entries(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(entry) for entry in self._log]

    def counters(self) -> dict[str, Any]:
        with self._lock:
            by_path: dict[str, dict[str, int]] = {}
            for entry in self._log:
                if entry.get("rel") and entry["method"] == "GET":
                    slot = by_path.setdefault(entry["rel"], {})
                    slot[str(entry["status"])] = slot.get(str(entry["status"]), 0) + 1
            total = sum(self._counts.values())

            def count(method: str, status: int) -> int:
                return self._counts.get(f"{method} {status}", 0)

            return {"requests": total, "byStatus": dict(sorted(self._counts.items())), "byPath": by_path,
                    "fetched": count("GET", 200), "notModified": count("GET", 304),
                    "unauthorized": count("GET", 401), "forbidden": count("GET", 403),
                    "preflights": sum(v for k, v in self._counts.items() if k.startswith("OPTIONS "))}

    def reset_log(self) -> None:
        with self._lock:
            self._log.clear()
            self._counts.clear()

    def state(self) -> dict[str, Any]:
        with self._lock:
            return {"owner": self.owner, "repo": self.repo, "origins": sorted(self.origins),
                    "cacheControl": self.cache_control,
                    "overlay": {path: (None if data is None else len(data)) for path, data in sorted(self._overlay.items())},
                    "delaysMs": {path: int(seconds * 1000) for path, seconds in sorted(self._delays.items())},
                    "failures": dict(sorted(self._failures.items())),
                    "tokens": [{"label": entry.label, "state": entry.state} for entry in self._tokens]}

    # ---------------------------------------------------------------- Hilfsbefehle
    def put_file(self, rel: str, data: bytes) -> None:
        checked = safe_rel(rel)
        _require(checked is not None and checked == rel, "ungueltiger Pfad")
        with self._lock:
            self._overlay[rel] = bytes(data)

    def remove_file(self, rel: str) -> None:
        checked = safe_rel(rel)
        _require(checked is not None and checked == rel, "ungueltiger Pfad")
        with self._lock:
            self._overlay[rel] = None

    def set_delay(self, rel: str, ms: int) -> None:
        _require(type(ms) is int and 0 <= ms <= 120000, "ms muss 0..120000 sein")
        with self._lock:
            if ms == 0:
                self._delays.pop(rel, None)
            else:
                self._delays[rel] = ms / 1000.0

    def set_failure(self, rel: str, status: int | None) -> None:
        _require(status is None or (type(status) is int and 400 <= status <= 599), "status muss 400..599 oder null sein")
        with self._lock:
            if status is None:
                self._failures.pop(rel, None)
            else:
                self._failures[rel] = status

    def set_token_state(self, label: str, state: str) -> None:
        _require(state in TOKEN_STATES, "state muss valid, blocked oder removed sein")
        with self._lock:
            entry = next((item for item in self._tokens if item.label == label), None)
            if entry is None:
                raise MockError(404, f"unbekanntes Token-Etikett {label!r}")
            entry.state = state

    def reset(self) -> None:
        """Ueberlagerung, Verzoegerungen, Fehler und Token-Zustaende zuruecksetzen; das Log bleibt."""
        with self._lock:
            self._overlay.clear()
            self._delays.clear()
            self._failures.clear()
            for entry in self._tokens:
                entry.state = entry.initial

    def set_head(self, project_id: str, revision_id: str, *, seq: int | None = None, committed_at: str | None = None,
                 allow_missing: bool = False, exported_at: str | None = None, project_name: str | None = None,
                 fallbacks: list[str] | None = None) -> dict[str, Any]:
        """Neuer Kopf wie beim Upload (Vertrag 10/11): project.json (Kopf + Log) und index.json neu schreiben.

        seq fehlt -> aktuelle seq + 1. Eine kleinere seq bildet den Testfall "Rueckfall der Projektliste" nach,
        allow_missing den Fall "Kopf auf nicht gespeicherte Revision". Ein Grabstein nimmt nie wieder einen Kopf an.
        Ausdrueckliche Werte ausserhalb der Grenzen sind ein Fehler des Testskripts -> 400. Paketwerte ausserhalb der
        Grenzen werden ersetzt (Mock-Projekt, /project1, committedAt); ihre Feldnamen landen sortiert in fallbacks.
        """
        _require(isinstance(project_id, str) and PROJECT_ID.fullmatch(project_id) is not None, "projectId ungueltig")
        _require(isinstance(revision_id, str) and REVISION_ID.fullmatch(revision_id) is not None, "revisionId ungueltig")
        new_seq_wanted = _check_seq(seq)
        now = _check_time(committed_at, "committedAt") or self._clock()
        exported = _check_time(exported_at, "exportedAt")
        _require(project_name is None or is_text(project_name, NAME_LIMIT),
                 f"projectName muss 1-{NAME_LIMIT} Codepoints haben und als UTF-8 speicherbar sein")
        with self._lock:
            project_path = f"projects/{project_id}/project.json"
            project = self._read_json(project_path)
            index = self._load_index()
            if project is not None:
                _require(isinstance(project, dict), "project.json ist kein Objekt", 409)
                _require(project.get("status") != "deleted", "Projekt hat einen Grabstein (Vertrag 10)", 409)
            previous = project.get("head") if isinstance(project, dict) else None
            previous_seq = previous["seq"] if isinstance(previous, dict) and type(previous.get("seq")) is int else 0
            new_seq = new_seq_wanted if new_seq_wanted is not None else previous_seq + 1
            package = self._read_bytes(f"projects/{project_id}/revisions/{revision_id}.json")
            _require(package is not None or allow_missing,
                     "Revision fehlt im Speicher (allowMissing fuer 'Kopf auf nicht gespeicherte Revision')", 404)
            facts = package_facts(package) if package is not None else {}
            # Ein ausdruecklicher Wert ersetzt den Paketwert; nur ein tatsaechlich benutzter Rueckfall wird gemeldet.
            explicit = {"exportedAt": exported, "projectName": project_name}
            replaced = [field for field in facts.get("rejected", []) if explicit.get(field) is None]
            head = {
                "seq": new_seq,
                "revisionId": revision_id,
                "committedAt": now,
                "exportedAt": exported or facts.get("exportedAt") or now,
                "projectName": project_name or facts.get("projectName") or FALLBACK_NAME,
                "bytes": len(package) if package is not None else 0,
                "counts": facts.get("counts") or {"operators": 0, "codeSources": 0},
                "rootPath": facts.get("rootPath") or FALLBACK_ROOT,
            }
            entry = {"seq": new_seq, "revisionId": revision_id, "prevSeq": previous_seq, "committedAt": now,
                     "exportedAt": head["exportedAt"], "projectName": head["projectName"], "installId": INSTALL_ID}
            if project is None:
                project = {"format": PROJECT_FORMAT, "version": 1, "projectId": project_id, "status": "active",
                           "createdAt": now, "deletedAt": None, "head": head, "log": [entry]}
            else:
                project = dict(project)
                old_log = project.get("log") if isinstance(project.get("log"), list) else []
                project["head"] = head
                project["log"] = [entry] + old_log[: HEAD_LOG_LIMIT - 1]
            index_doc = self._index_with(index, {"projectId": project_id, "status": "active", "head": head})
            # Erst alle Bytes bauen, dann schreiben: scheitert eine Datei (409), bleibt kein halber Kopf zurueck.
            writes = {project_path: store_bytes(project), "projects/index.json": store_bytes(index_doc)}
            if self._read_bytes("store.json") is None:
                # Ohne Speicher-Marke lehnt ein strenger Leser den ganzen Speicher ab (Transport _check_store_marker).
                writes["store.json"] = store_bytes({"format": STORE_FORMAT, "version": 1})
            self._overlay.update(writes)
            if fallbacks is not None:
                fallbacks.extend(replaced)
            return head

    def publish(self, data: bytes, *, seq: int | None = None, committed_at: str | None = None) -> dict[str, Any]:
        """Paket ablegen (revisions/<id>.json, Bytes unveraendert) und den Kopf darauf setzen.

        Ergebnis {projectId, revisionId, head, fallbacks}; fallbacks wie bei set_head.
        """
        facts = package_facts(data)
        project_id, revision_id = str(facts.get("projectId", "")), str(facts.get("revisionId", ""))
        _require(PROJECT_ID.fullmatch(project_id) is not None, "Paket ohne gueltige projectId")
        _require(REVISION_ID.fullmatch(revision_id) is not None, "Paket ohne gueltige revision.id")
        replaced: list[str] = []
        path = f"projects/{project_id}/revisions/{revision_id}.json"
        with self._lock:
            had_overlay_entry = path in self._overlay
            previous_entry = self._overlay.get(path)
            self.put_file(path, data)
            try:
                head = self.set_head(project_id, revision_id, seq=seq, committed_at=committed_at, fallbacks=replaced)
            except MockError:
                # Kein Kopf -> auch kein neues Paket (wie beim Transport: Grabstein-Pruefung vor dem Blob). Die
                # Ueberlagerung bleibt, wie sie vor dem Befehl war.
                if had_overlay_entry:
                    self._overlay[path] = previous_entry
                else:
                    self._overlay.pop(path, None)
                raise
        return {"projectId": project_id, "revisionId": revision_id, "head": head, "fallbacks": replaced}

    def delete_project(self, project_id: str, *, deleted_at: str | None = None) -> dict[str, Any]:
        """Grabstein wie cs_pocket_transport._delete_once; die Revisionen verschwinden aus dem aktuellen Stand."""
        _require(isinstance(project_id, str) and PROJECT_ID.fullmatch(project_id) is not None, "projectId ungueltig")
        now = _check_time(deleted_at, "deletedAt") or self._clock()
        with self._lock:
            project_path = f"projects/{project_id}/project.json"
            project = self._read_json(project_path)
            index = self._load_index()
            head = project.get("head") if isinstance(project, dict) else None
            last_seq = head["seq"] if isinstance(head, dict) and type(head.get("seq")) is int else 0
            created = project.get("createdAt") if isinstance(project, dict) else None
            tombstone = {"format": PROJECT_FORMAT, "version": 1, "projectId": project_id, "status": "deleted",
                         "createdAt": created if is_timestamp(created) else now, "deletedAt": now,
                         "lastSeq": last_seq, "head": None, "log": []}
            # Erst alle Bytes bauen, dann schreiben (wie set_head): ein 409 hinterlaesst keinen halben Grabstein.
            writes: dict[str, bytes | None] = {
                project_path: store_bytes(tombstone),
                "projects/index.json": store_bytes(
                    self._index_with(index, {"projectId": project_id, "status": "deleted", "head": None})),
            }
            for rel in self._revision_paths(project_id):
                writes[rel] = None
            self._overlay.update(writes)
            return {"projectId": project_id, "lastSeq": last_seq}

    def _load_index(self) -> dict[str, Any] | None:
        index = self._read_json("projects/index.json")
        if index is not None:
            _require(isinstance(index, dict) and isinstance(index.get("projects"), list),
                     "index.json hat keine Projektliste", 409)
        return index

    def _revision_paths(self, project_id: str) -> list[str]:
        prefix = f"projects/{project_id}/revisions/"
        found = {rel for rel in self._overlay if rel.startswith(prefix)}
        folder = self.root / "projects" / project_id / "revisions"
        if folder.is_dir():
            found.update(prefix + path.name for path in folder.iterdir()
                         if path.is_file() and SEGMENT.fullmatch(path.name) is not None)
        return sorted(found)

    @staticmethod
    def _index_with(index: Any, entry: dict[str, Any]) -> dict[str, Any]:
        """Eintrag ersetzen, nach projectId sortieren (Vertrag 11); fremde Felder des Index bleiben erhalten."""
        document = dict(index) if isinstance(index, dict) else {"format": INDEX_FORMAT, "version": 1}
        projects = [item for item in document.get("projects", [])
                    if not (isinstance(item, dict) and item.get("projectId") == entry["projectId"])]
        projects.append(entry)
        projects.sort(key=lambda item: str(item.get("projectId", "")) if isinstance(item, dict) else "")
        document["projects"] = projects
        return document


# -------------------------------------------------------------------------------------------- HTTP
def api_version_label(value: str | None) -> str | None:
    """X-GitHub-Api-Version fuers Log: nur die Datumsform (z.B. 2022-11-28), sonst "other".

    Die Attrappe wertet den Header nicht aus; das Log zeigt nur, ob und welche Version ein Client sendet. Ein
    beliebiger Wert (etwa ein Token im falschen Header) kommt so nie ins Log.
    """
    if value is None:
        return None
    if API_VERSION_FORM.fullmatch(value):
        return value
    return "other"


def representation(rel: str, data: bytes, accept: str) -> tuple[int, bytes, str]:
    """(status, body, Content-Type) je Medientyp wie bei GitHub (Doku: raw / object / Standard)."""
    if RAW_MEDIA.search(accept):
        # Content-Type wie bei GitHub beobachtet (Rohantwort eines oeffentlichen Repos, 2026-11-05); Pocket liest
        # trotzdem nur die Bytes.
        return 200, data, "application/vnd.github.raw+json; charset=utf-8"
    name = rel.rsplit("/", 1)[-1]
    big = len(data) > ONE_MIB
    if not OBJECT_MEDIA.search(accept) and big:
        # Laut Doku ueber 1 MB nur raw/object; die genaue Fehlerantwort ist UNKNOWN, hier als 403 too_large.
        return 403, json_body({"message": "This API returns blobs up to 1 MB in size.",
                               "errors": [{"resource": "Blob", "field": "data", "code": "too_large"}]}), \
            "application/json; charset=utf-8"
    document = {"type": "file", "encoding": "none" if big else "base64", "size": len(data), "name": name,
                "path": rel, "sha": git_blob_sha(data),
                "content": "" if big else base64.encodebytes(data).decode("ascii")}
    return 200, json_body(document), "application/json; charset=utf-8"


def make_handler(store: MockStore, quiet: bool = True) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "mock-github-store/1"
        # Socket-Zeitlimit: ein haengender Testclient (halber POST-Body) blockiert keinen Handler-Thread endlos.
        timeout = 30

        def version_string(self) -> str:
            # Ohne Python-Version im Server-Header: die Attrappe soll nichts ueber die Umgebung verraten.
            return self.server_version

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - Signatur der Basisklasse
            # Standard-Log aus: es schreibt die rohe Anfragezeile samt Query. Die Attrappe fuehrt ihr eigenes Log
            # ohne Token und ohne Query (_finish); mit --verbose steht dort je Request eine Zeile auf stderr.
            return

        # ------------------------------------------------------------ Senden
        def _send(self, status: int, body: bytes, headers: dict[str, str]) -> None:
            try:
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                if status not in (204, 304):
                    self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body and status not in (204, 304) and self.command != "HEAD":
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # Client ist weg (Test abgebrochen, Browser-Tab zu): nichts mehr zu senden, Log ist schon geschrieben.
                return

        @staticmethod
        def _cache_control(kind: ResponseKind, status: int) -> str | None:
            """Cache-Control je Antwort (Kopf der Datei): nur gelesene Inhalte sind wie bei GitHub cachebar."""
            if store.cache_control == "no-store" or kind == "control":
                return "no-store"
            if kind == "read" and status in (200, 304):
                # 304 traegt dieselben Cache-Angaben wie die 200-Antwort (RFC 9110 15.4.5).
                return GITHUB_CACHE_CONTROL
            return None  # Fehler und Preflight: ohne Kopf, wie GitHubs 404 ohne Token

        def _finish(self, entry: dict[str, Any], status: int, body: bytes = b"",
                    headers: dict[str, str] | None = None, kind: ResponseKind = "other") -> None:
            entry["status"] = status
            entry["bytes"] = len(body) if status not in (204, 304) else 0
            request_id = store.record(entry)
            if not quiet:
                sys.stderr.write(f"mock_github_store: {entry['method']} {entry['path']} -> {status}\n")
            all_headers = {"X-Mock-Request-Id": str(request_id)}
            cache_control = self._cache_control(kind, status)
            if cache_control is not None:
                all_headers["Cache-Control"] = cache_control
            if body and "Content-Type" not in (headers or {}):
                all_headers["Content-Type"] = "application/json; charset=utf-8"
            all_headers.update(headers or {})
            self._send(status, body, all_headers)

        def _entry(self, method: str) -> tuple[dict[str, Any], Any]:
            split = urlsplit(self.path)
            origin = self.headers.get("Origin")
            entry: dict[str, Any] = {
                "method": method, "path": split.path, "query": bool(split.query), "rel": None,
                "origin": origin, "cors": origin is not None and origin in store.origins,
                "auth": None, "token": None, "accept": self.headers.get("Accept"),
                "conditional": self.headers.get("If-None-Match") is not None, "etag": None, "delayMs": 0,
                "apiVersion": api_version_label(self.headers.get("X-GitHub-Api-Version")),
            }
            return entry, split

        # ------------------------------------------------------------ Preflight
        def do_OPTIONS(self) -> None:  # noqa: N802 - Name verlangt BaseHTTPRequestHandler
            entry, split = self._entry("OPTIONS")
            asked = self.headers.get("Access-Control-Request-Headers") or ""
            entry["preflightHeaders"] = sorted({item.strip().lower() for item in asked.split(",") if item.strip()})
            # Der Browser setzt die Liste durch, nicht die Attrappe. Das Log nennt die Namen, die GitHub nicht
            # freigibt - so zeigt ein gescheiterter Browser-Test sofort, welcher Header der Grund war.
            entry["preflightDenied"] = [name for name in entry["preflightHeaders"]
                                        if name not in ALLOWED_REQUEST_HEADER_NAMES]
            entry["preflightMethod"] = self.headers.get("Access-Control-Request-Method")
            origin = entry["origin"]
            # Steuerung und fremde Pfade bekommen nie eine CORS-Freigabe - so kann keine Testseite sie ausloesen.
            if split.path.startswith(CONTROL_PREFIX):
                self._finish(entry, 403, headers={"Vary": "Origin"}, kind="control")
                return
            if CONTENTS.fullmatch(split.path) is None or not entry["cors"]:
                self._finish(entry, 403, headers={"Vary": "Origin"})
                return
            headers = {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET",
                       "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
                       "Access-Control-Max-Age": str(store.preflight_max_age),
                       "Vary": "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"}
            # Chromium "Private Network Access": Seiten auf oeffentlichen Origins fragen das vor 127.0.0.1 ab.
            if (self.headers.get("Access-Control-Request-Private-Network") or "").lower() == "true":
                headers["Access-Control-Allow-Private-Network"] = "true"
            self._finish(entry, 204, headers=headers)

        # ------------------------------------------------------------ Lesen
        def do_GET(self) -> None:  # noqa: N802
            entry, split = self._entry("GET")
            if split.path.startswith(CONTROL_PREFIX):
                self._control_get(entry, split.path[len(CONTROL_PREFIX):])
                return
            cors = store.cors_headers(entry["origin"])
            vary = {"Vary": "Origin, Accept, Authorization"}
            match = CONTENTS.fullmatch(split.path)
            if match is None:
                self._finish(entry, 404, json_body({"message": "Not Found"}), {**cors, **vary})
                return
            auth, label = store.check_auth(self.headers.get("Authorization"))
            entry["auth"], entry["token"] = auth, label
            if auth == "none":
                self._finish(entry, 401, json_body({"message": "Requires authentication"}), {**cors, **vary})
                return
            if auth in ("wrong", "removed"):
                self._finish(entry, 401, json_body({"message": "Bad credentials"}), {**cors, **vary})
                return
            if auth == "blocked":
                self._finish(entry, 403, json_body({"message": "Resource not accessible by personal access token"}),
                             {**cors, **vary})
                return
            owner, repo, raw = match.groups()
            rel = safe_rel(raw)
            entry["rel"] = rel
            # Owner und Repo sind bei GitHub gross/klein-unabhaengig.
            if owner.lower() != store.owner.lower() or repo.lower() != store.repo.lower() or rel is None:
                self._finish(entry, 404, json_body({"message": "Not Found"}), {**cors, **vary})
                return
            failure = store.failure_for(rel)
            if failure is not None:
                self._finish(entry, failure, json_body({"message": "mock: erzwungener Fehler"}), {**cors, **vary})
                return
            delay = store.delay_for(rel)
            if delay > 0:
                # Eigener Thread je Request (ThreadingHTTPServer): andere Antworten laufen in der Zeit weiter -
                # so entsteht die vertauschte Ankunftsreihenfolge fuer den Pocket-Test.
                entry["delayMs"] = int(delay * 1000)
                time.sleep(delay)
            kind, data = store.lookup(rel)
            if kind == "dir":
                self._finish(entry, 501, json_body({"message": "mock: Verzeichnisse werden nicht nachgebildet"}),
                             {**cors, **vary})
                return
            if kind == "missing" or data is None:
                self._finish(entry, 404, json_body({"message": "Not Found"}), {**cors, **vary})
                return
            status, body, content_type = representation(rel, data, self.headers.get("Accept") or "")
            if status != 200:
                self._finish(entry, status, body, {**cors, **vary, "Content-Type": content_type})
                return
            etag = make_etag(body)
            entry["etag"] = etag
            if etag_matches(self.headers.get("If-None-Match"), etag):
                self._finish(entry, 304, b"", {**cors, **vary, "ETag": etag}, kind="read")
                return
            self._finish(entry, 200, body, {**cors, **vary, "ETag": etag, "Content-Type": content_type}, kind="read")

        def do_HEAD(self) -> None:  # noqa: N802
            self._not_allowed("HEAD")

        def do_PUT(self) -> None:  # noqa: N802
            self._not_allowed("PUT")

        def do_PATCH(self) -> None:  # noqa: N802
            self._not_allowed("PATCH")

        def do_DELETE(self) -> None:  # noqa: N802
            self._not_allowed("DELETE")

        def _not_allowed(self, method: str) -> None:
            entry, _split = self._entry(method)
            self._finish(entry, 405, json_body({"message": "mock: nur GET (Pocket liest nur)"}),
                         {**store.cors_headers(entry["origin"]), "Allow": "GET, OPTIONS"})

        # ------------------------------------------------------------ Steuerung
        def _control_get(self, entry: dict[str, Any], command: str) -> None:
            entry["control"] = command
            views: dict[str, Callable[[], Any]] = {"log": lambda: {"entries": store.log_entries()},
                                                   "counters": store.counters, "state": store.state}
            view = views.get(command)
            if view is None:
                self._finish(entry, 404, json_body({"ok": False, "error": "unbekannter Befehl"}), kind="control")
                return
            # Erst den Zustand lesen, dann diesen Request mitzaehlen - sonst zaehlt "counters" sich selbst.
            self._finish(entry, 200, json_body({"ok": True, **view()}), kind="control")

        def do_POST(self) -> None:  # noqa: N802
            entry, split = self._entry("POST")
            if not split.path.startswith(CONTROL_PREFIX):
                self._finish(entry, 405, json_body({"message": "mock: nur GET (Pocket liest nur)"}),
                             {**store.cors_headers(entry["origin"]), "Allow": "GET, OPTIONS"})
                return
            command = split.path[len(CONTROL_PREFIX):]
            entry["control"] = command
            content_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                self._finish(entry, 415, json_body({"ok": False, "error": "Content-Type application/json noetig"}),
                             kind="control")
                return
            try:
                length = int(self.headers.get("Content-Length") or "-1")
            except ValueError:
                length = -1
            if not 0 <= length <= MAX_CONTROL_BODY:
                self._finish(entry, 413, json_body({"ok": False, "error": "Content-Length fehlt oder zu gross"}),
                             kind="control")
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError):
                self._finish(entry, 400, json_body({"ok": False, "error": "kein JSON"}), kind="control")
                return
            try:
                if not isinstance(payload, dict):
                    raise MockError(400, "JSON-Objekt erwartet")
                result = run_command(store, command, payload)
            except MockError as error:
                self._finish(entry, error.status, json_body({"ok": False, "error": error.message}), kind="control")
                return
            self._finish(entry, 200, json_body({"ok": True, **result}), kind="control")

    return Handler


def _decode_payload_bytes(payload: dict[str, Any]) -> bytes:
    if isinstance(payload.get("base64"), str):
        try:
            return base64.b64decode(payload["base64"], validate=True)
        except binascii.Error as error:
            raise MockError(400, "base64 ungueltig") from error
    if isinstance(payload.get("text"), str):
        try:
            return payload["text"].encode("utf-8")
        except UnicodeEncodeError as error:  # einzelnes Surrogat aus einem JSON-Escape
            raise MockError(400, "text ist nicht als UTF-8 speicherbar") from error
    raise MockError(400, "base64 oder text fehlt")


def run_command(store: MockStore, command: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Ein Hilfsbefehl der Steuerung; Ergebnis ohne Dateiinhalte und ohne Token."""
    if command == "set-head":
        replaced: list[str] = []
        head = store.set_head(payload.get("projectId"), payload.get("revisionId"), seq=payload.get("seq"),
                              committed_at=payload.get("committedAt"),
                              allow_missing=payload.get("allowMissing") is True,
                              exported_at=payload.get("exportedAt"), project_name=payload.get("projectName"),
                              fallbacks=replaced)
        return {"head": head, "fallbacks": replaced}
    if command == "publish":
        return store.publish(_decode_payload_bytes(payload), seq=payload.get("seq"),
                             committed_at=payload.get("committedAt"))
    if command == "delete-project":
        return store.delete_project(payload.get("projectId"), deleted_at=payload.get("deletedAt"))
    if command == "put-file":
        path = payload.get("path")
        _require(isinstance(path, str), "path fehlt")
        data = _decode_payload_bytes(payload)
        store.put_file(path, data)
        return {"path": path, "bytes": len(data)}
    if command == "remove-file":
        path = payload.get("path")
        _require(isinstance(path, str), "path fehlt")
        store.remove_file(path)
        return {"path": path}
    if command == "delay":
        path = payload.get("path")
        _require(isinstance(path, str) and safe_rel(path) == path, "path ungueltig")
        store.set_delay(path, payload.get("ms"))
        return {"path": path}
    if command == "fail":
        path = payload.get("path")
        _require(isinstance(path, str) and safe_rel(path) == path, "path ungueltig")
        store.set_failure(path, payload.get("status"))
        return {"path": path}
    if command == "token":
        label, state = payload.get("label"), payload.get("state")
        _require(isinstance(label, str) and isinstance(state, str), "label und state noetig")
        store.set_token_state(label, state)
        return {"label": label, "state": state}
    if command == "reset":
        store.reset()
        return {}
    if command == "reset-log":
        store.reset_log()
        return {}
    raise MockError(404, "unbekannter Befehl")


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True  # haengende Test-Requests halten das Beenden nicht auf
    # Unter Windows erlaubt SO_REUSEADDR, dass ein zweiter Prozess denselben Port mitbelegt - dort aus.
    allow_reuse_address = sys.platform != "win32"


def create_server(store: MockStore, port: int, quiet: bool = True) -> LocalServer:
    if not 0 <= port <= 65535:
        raise MockError(400, "Port 0..65535")
    return LocalServer((HOST, port), make_handler(store, quiet))


# -------------------------------------------------------------------------------------------- Kommandozeile
def _load_tokens(args: argparse.Namespace) -> tuple[list[str], list[str]]:
    valid, blocked = list(args.token), list(args.blocked_token)
    if args.tokens_file is not None:
        try:
            document = json.loads(Path(args.tokens_file).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise MockError(400, f"--tokens-file nicht lesbar ({type(error).__name__})") from error
        _require(isinstance(document, dict), "--tokens-file: JSON-Objekt {valid:[..], blocked:[..]} erwartet")
        for key, target in (("valid", valid), ("blocked", blocked)):
            values = document.get(key, [])
            _require(isinstance(values, list) and all(isinstance(item, str) for item in values),
                     f"--tokens-file: {key} muss eine Liste von Strings sein")
            target.extend(values)
    return valid, blocked


def _serve(args: argparse.Namespace) -> int:
    valid, blocked = _load_tokens(args)
    store = MockStore(args.fixtures, owner=args.owner, repo=args.repo, origins=args.origin, tokens=valid,
                      blocked=blocked, preflight_max_age=args.preflight_max_age, cache_control=args.cache_control)
    try:
        server = create_server(store, args.port, quiet=not args.verbose)
    except OSError as error:
        raise MockError(400, f"Port {args.port} auf {HOST} nicht nutzbar (errno {error.errno})") from error
    port = server.server_address[1]
    # Startzeile fuer Testskripte: ohne Token, ohne Pfadinhalte.
    print(json.dumps({"event": "ready", "host": HOST, "port": port, "url": f"http://{HOST}:{port}",
                      "owner": store.owner, "repo": store.repo, "origins": sorted(store.origins),
                      "cacheControl": store.cache_control,
                      "tokens": {"valid": len(valid), "blocked": len(blocked)}}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass  # Strg+C ist das normale Ende im Terminal
    finally:
        server.server_close()
    return 0


def _client(args: argparse.Namespace, command: str, payload: dict[str, Any] | None) -> int:
    url = f"http://{HOST}:{args.port}{CONTROL_PREFIX}{command}"
    if payload is None:
        request = urllib.request.Request(url, method="GET")
    else:
        request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                         headers={"Content-Type": "application/json"})
    # Antwort als Bytes durchreichen: eine Windows-Konsole (cp1252) wuerde an Umlauten in Projektnamen scheitern.
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            sys.stdout.buffer.write(response.read() + b"\n")
            return 0
    except urllib.error.HTTPError as error:
        sys.stdout.buffer.write(error.read() + b"\n")
        return 1
    except urllib.error.URLError as error:
        print(json.dumps({"ok": False, "error": f"Attrappe nicht erreichbar ({type(error.reason).__name__})"}))
        return 2
    finally:
        sys.stdout.flush()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GitHub-Contents-Attrappe fuer Pocket-Browser-Tests (nur 127.0.0.1)")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Server starten")
    serve.add_argument("--port", type=int, required=True, help="Port auf 127.0.0.1 (0 = frei, steht in der Startzeile)")
    serve.add_argument("--fixtures", type=Path, required=True, help="Verzeichnis im Layout des Datenrepos")
    serve.add_argument("--origin", action="append", default=[], help="erlaubte Test-Origin, exakt (mehrfach)")
    serve.add_argument("--token", action="append", default=[], help="gueltiges Testtoken (nur Kanarienwerte)")
    serve.add_argument("--blocked-token", action="append", default=[], help="gesperrtes Testtoken -> 403")
    serve.add_argument("--tokens-file", type=Path, help='JSON {"valid": [..], "blocked": [..]} statt Kommandozeile')
    serve.add_argument("--owner", default=DEFAULT_OWNER)
    serve.add_argument("--repo", default=DEFAULT_REPO)
    serve.add_argument("--preflight-max-age", type=int, default=0, help="Access-Control-Max-Age in s (Standard 0)")
    serve.add_argument("--cache-control", choices=CACHE_MODES, default="github",
                       help='github (Standard): Lese-Antworten "private, max-age=60, s-maxage=60" wie GitHub; '
                            "no-store: jede Antwort no-store")
    serve.add_argument("--verbose", action="store_true", help="Anfragezeilen (ohne Query) auf stderr")
    for name, text in (("log", "Request-Log zeigen"), ("counters", "Zaehler zeigen"), ("state", "Zustand zeigen"),
                       ("reset", "Ueberlagerung/Verzoegerung/Fehler/Token-Zustand zuruecksetzen"),
                       ("reset-log", "Log und Zaehler leeren")):
        sub.add_parser(name, help=text).add_argument("--port", type=int, required=True)
    head = sub.add_parser("set-head", help="neuen Kopf setzen")
    head.add_argument("--port", type=int, required=True)
    head.add_argument("--project", required=True)
    head.add_argument("--revision", required=True)
    head.add_argument("--seq", type=int)
    head.add_argument("--committed-at")
    head.add_argument("--allow-missing", action="store_true")
    publish = sub.add_parser("publish", help="Paketdatei ablegen und Kopf darauf setzen")
    publish.add_argument("--port", type=int, required=True)
    publish.add_argument("--file", type=Path, required=True)
    publish.add_argument("--seq", type=int)
    delete = sub.add_parser("delete-project", help="Grabstein setzen")
    delete.add_argument("--port", type=int, required=True)
    delete.add_argument("--project", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "serve":
            return _serve(args)
        if args.command in ("log", "counters", "state"):
            return _client(args, args.command, None)
        if args.command in ("reset", "reset-log"):
            return _client(args, args.command, {})
        if args.command == "set-head":
            payload: dict[str, Any] = {"projectId": args.project, "revisionId": args.revision,
                                       "allowMissing": args.allow_missing}
            if args.seq is not None:
                payload["seq"] = args.seq
            if args.committed_at is not None:
                payload["committedAt"] = args.committed_at
            return _client(args, "set-head", payload)
        if args.command == "publish":
            try:
                data = args.file.read_bytes()
            except OSError as error:
                raise MockError(400, f"--file nicht lesbar ({type(error).__name__})") from error
            payload = {"base64": base64.b64encode(data).decode("ascii")}
            if args.seq is not None:
                payload["seq"] = args.seq
            return _client(args, "publish", payload)
        if args.command == "delete-project":
            return _client(args, "delete-project", {"projectId": args.project})
    except MockError as error:
        print(json.dumps({"ok": False, "error": error.message}), file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    sys.exit(main())
