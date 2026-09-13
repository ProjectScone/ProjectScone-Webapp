# Scone Webapp

Repository: https://github.com/ProjectScone/ProjectScone-Webapp

Independent React + strict TypeScript workspace for the Scone HTTP API. Python
and Rust sources are separate repositories. No sibling checkout is required to
build, test or serve this application.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm check:assets
SCONE_API_URL=http://127.0.0.1:7437 pnpm start
```

Node 24 and pnpm 9.9.0 are used in CI. Open http://127.0.0.1:5173/memory.
`pnpm build` embeds JavaScript and CSS into ignored `dist/console.html`.
`check:assets` checks that artifact without writing anything. To supply an
external native consumer, explicitly choose its staging artifact:

```sh
node scripts/package.mjs --output /private/tmp/scone-preview.html
```

The build never updates another repository. The Node host binds to loopback and
requires `SCONE_API_URL` naming a local HTTP(S) API origin. Configure optional
`SCONE_UI_PORT` (default 5173) or `SCONE_UI_HTML` for an alternate built artifact.
It proxies `/v1` and `/healthz`, preserving bearer authentication, streaming SSE
and WebSocket traffic. It never supplies a backend credential automatically.
The backend remains responsible for API authorization. API errors remain API
responses, and named workspace deep links receive the React application.

Enter your space key through the Connect dialog. An optional `SCONE_UI_KEY`
may be supplied **at host runtime** for a single local space; it is never read
by packaging or included in build output. Bootstrap requires both a loopback
peer and one valid raw loopback Host header; forwarded headers cannot authorize
it. Credential-bearing pages and `/__scone/session` use `no-store`. Public guides
stay keyless. Keys live only in browser memory; never configure a `VITE_` key.
Restart the production host after replacing its HTML artifact.

For React Fast Refresh, run `pnpm dev`. Vite proxies the local backend at port
7437; set `SCONE_DEV_API=http://127.0.0.1:PORT` to override it. Vite serves its own
runtime bootstrap endpoint and does not fetch HTML from the Python API.

Browser suites live in `scripts/test-*.cjs` and fixtures in `scripts/fixtures`.
Install Playwright in a test environment or set `SCONE_PLAYWRIGHT_MODULE` to its
module; optionally set `SCONE_BROWSER_PATH`. Run fixture suites using:

```sh
node --test scripts/test-learn.cjs scripts/test-documents.cjs scripts/test-conversations.cjs
```

They default to `dist/console.html`; explicit `SCONE_*_HTML` overrides remain
available. Python integration suites require `SCONE_TEST_PYTHON` pointing to an
interpreter with the separate Scone API and relevant optional realtime packages
installed. They start disposable API processes and this repository's UI proxy;
they never connect to the running memory store. For example:

```sh
SCONE_TEST_PYTHON=/explicit/environment/bin/python \
SCONE_CONVERSATIONS_HTML="$PWD/dist/console.html" \
node --test scripts/test-conversations-native.cjs
```

The HTTP capability fixture is local at `tests/fixtures/http-capabilities.json`.
Keep it in sync through explicit reviewed contract updates. Original project
license and citation attribution remain in `LICENSE` and `CITATION.cff`.

## Documents: retained-source library

Open `/memory#documents` on a server advertising `episodes.list`. The library
uses authenticated `GET /v1/sources`, not recall, to browse files, notes,
conversations, observations and connector sources. Pages contain up to 25 entries
ordered by descending stored episode ID. Type filters apply server-side before
pagination; Newer/Older navigate the cursor history, and Refresh restarts at the
newest IDs for the selected type. Page counts are not whole-library totals.

Open a source to read its retained text with Markdown formatting. Filenames and local paths
remain provenance labels; only absolute HTTP(S) source URLs become external
links. Available original images use the existing authenticated, digest-checked
preview. A source record is not an approved memory claim, and retained text is
not a downloadable copy of the original file. Newly added or removed records can
change the inventory; it is not a frozen export.

Source inspections, review quotes and retrieved passages render emphasis, code,
lists and tables without modifying stored evidence. **View original Markdown**
reveals the exact retained string. Formatted full-source previews are limited to
80,000 characters; the complete original remains available below that preview.
Embedded HTML is never executed. Only absolute HTTP(S) and mailto Markdown links
are navigable; relative links and unsafe schemes are inert. Markdown images show
their descriptions without fetching remote bytes. Saved image attachments still
use the separate authenticated image viewer.

On attachment-capable servers, Add source reuses the existing note/image and
UTF-8 text-file import flow. A verified save refreshes All sources at the newest
page. No delete controls or unsupported write operations are inferred from the
read-only inventory capability. Older servers without `episodes.list` do not
show the section or receive inventory requests.

When `documents.files`, `documents.provenance`, `episodes.attachments` and
`episodes.read` are all advertised, **Import documents** opens a file queue.
It discovers installed formats and the server's file-size limit before allowing
selection. Up to 20 files and 100 MiB can be queued; each file uploads its original
bytes, indexes using its selected filename, then verifies the source identity,
linked original/manifest, extracted text and source locators. Imports run one at
a time, with pause taking effect after the current file. A confirmed receipt
opens the source page or its extracted segments and table evidence.

Newly imported documents expose a display filename in the source library and
source page when it fits the server's 256-character metadata limit. Older
records and longer labels keep the existing source fallback; document provenance
still retains the complete extraction filename. Display names do not change
source or attachment identities.

For a source with verified document attachments, **Prepare original file**
rechecks the source and extraction, downloads the original through the authenticated
attachment route, verifies its byte count and SHA-256, and rechecks the source
after the transfer. **Save original file** downloads those exact bytes with the
extraction filename's safe basename. The browser limit is 100 MiB. Cancel, clear,
refresh, source changes and connection changes discard pending work and release
prepared object URLs. Files are offered as binary downloads, never rendered as
active HTML; typed originals served as `application/octet-stream` remain supported.
A downloaded local copy is independent of subsequent server retention changes.

The queue belongs to the open Documents view. It does not persist across view
changes, closing or reload, and does not represent a durable background job.
Saved sources remain stored. Upload or authorization failures can be queued
again; ambiguous indexing outcomes require checking the library first and have
no automatic write retry. A saved source whose verification failed retains its
ID for an explicit read-only retry. Availability describes parser dependencies,
not whether a particular file is valid. PDF imports use embedded text; scanned
PDF OCR and parser settings are not part of this upload control.

After building, `node --test scripts/test-document-imports.cjs` verifies the
packaged queue, pause, failure/retry, capability gating and mobile layout against
an isolated HTTP fixture. It accepts `SCONE_DOCUMENTS_HTML`,
`SCONE_PLAYWRIGHT_MODULE`, `SCONE_BROWSER_ENGINE` and `SCONE_BROWSER_PATH`.

The browser boundary suite is `scripts/test-documents.cjs`, with
`SCONE_DOCUMENTS_HTML` pointing to the isolated packaged artifact above.
`scripts/test-conversations-native.cjs` also covers Documents pagination, import,
literal readback, original images and cross-space denial against a disposable
Python API service with a separate UI host. Neither suite uses the live memory database.

## Current boundaries

### Knowledge workspace

Retained source pages also offer Follow this source’s evidence when the server
advertises `graph.sources`. An explicit read follows sections and stored chunks
into quoted claims and their named entities; text-only entity mentions remain
separate. Selecting a section, chunk, quote or mention opens its exact original
span. The UI checks the content SHA-256, source identity, read consistency and
UTF-8 boundaries before displaying provenance. Repeated quotes disclose their
occurrence count and identify the first span. Chunk/claim limits and graph-read
limits remain visible, and all returned lists page in groups of 20. Refresh,
connection changes and cancellation discard old provenance. The source original
remains available independently of this optional capability.

The Memory navigation includes Knowledge when the server advertises
`graph.knowledge`. This page reads the space's recorded entity graph and offers
an entity directory, an interactive map, and current, history, proposed and
excluded-inclusive views. `entities.read` independently enables inspection of
incoming/outgoing relationships, literal values and supporting claims.

`graph.knowledge_paging` adds next/previous navigation through the entity
ranking, with at most 150 entities on each page. Pages share the first read's
instant, projection identity and revision; changed snapshots, repeated entities,
cursor loops and incomplete page contracts are rejected. The map shows only
relationships between entities on its current page. Inspection and connection
search can reach beyond it. Refresh, mode, community settings and connection
changes restart paging and discard old selections. Servers without the paging
capability retain the bounded first view.

`graph.knowledge_seeds` independently enables Explore around entities. Choose up
to 24 starting entities from the map or verified whole-space search, then read
their neighborhood with an entity limit and hub degree cutoff. Connections are
followed in both directions by default; high-degree hubs are shown but not expanded unless
explicitly selected as starting entities. The response must preserve the
requested seeds, cutoff, snapshot and known identities/support. Partial reads,
entities outside the walk and skipped hubs remain explicit. The canvas draws at
most 150 entities and 1,000 relationships; a directory pages through every
returned entity in groups of 20 and can bring an off-map selection into view.
Inspection reuses the main claim/source inspector. Draft changes, clearing and
main graph changes discard obsolete results and neighborhood-owned inspection.

With `graph.knowledge_walk`, the same panel adds incoming/outgoing/both direction
and a limit of 1–8 steps or no step limit. Incoming follows object to subject;
arrows always preserve the original subject-to-object claim. The directory
shows each entity's distance from the nearest start. Responses must match the
requested direction/depth and include a directed predecessor for each step;
provable shortcuts cannot be reported as longer distances. Hidden full-read hub
degree is respected rather than guessed from displayed edges. Capability changes
clear walk-owned results and inspection. Older servers receive no direction or
step parameters and do not show distance labels.

After `pnpm build`, `node --test scripts/test-knowledge-walk.cjs` exercises the
packaged controls against an isolated read-only HTTP fixture. Set
`SCONE_PLAYWRIGHT_MODULE`, `SCONE_BROWSER_ENGINE` and `SCONE_BROWSER_PATH` when
using a separately provisioned Playwright/browser installation.

Coverage notices retain backend read limits. The map draws at most 1,000 of the
returned relationships and discloses that display limit; inspection retains up
to the backend's 50,000 supporting claims, shown in pages of 50. Source links
require the currently verified space. Inspection rejects a changed graph
revision, and changing connection, mode or refreshing revokes old selections.

When `graph.report` is available, Show communities requests the backend's
computed analysis. Community colors and filters retain stable group identities;
the directory and map show only the selected group's returned members. The UI
shows visible versus whole-community sizes, analysis limits, and whether bridge
scores use sampling. Entity inspection adds degree, PageRank, bridge and
participation scores. These measures describe graph structure, not claim
reliability. Entities without returned analysis are labeled separately.
When the server returns resolution metadata, the map can request any community
resolution above zero through 10 and verifies the setting used in the response.

Explore a knowledge report explicitly computes a report over the returned claim
view, including entities outside the map. Reports show central and bridging
entities, cross-community connections with claim IDs, suggested questions and
paged communities. Resolution and optional degree-percentile hub exclusion
(50–100) control the analysis; excluded hubs remain inspectable in a paged list.
Entity inspection is independently gated and connection selections filter the
supporting records. Reports retain sampling and partial-read disclosures and
verify space, projection, time, settings and known entity identities. Changing
settings, refreshing or cancelling discards old report results and inspection.

With `graph.timeline`, selecting an entity offers a valid-time timeline across
outgoing, incoming and value lanes. This history includes closed, proposed and
excluded records independently of the map's claim filter. Choose a UTC moment
to mark which records count then, inspect exact intervals and verified quotes,
follow supersession or stored claim links, and open retained sources. Linked
records reveal their lane and page. The UI checks entity keys, revision, time,
validity markers, lane membership and requested limits; it permits the history
projection's digest to differ from the current-view digest. Returned records
page in groups of 20, with capped and stale reads disclosed. Entity, graph and
request changes revoke old timeline evidence.

With `graph.path` and `entities.read`, Find a connection searches entities across
the space, including those outside the initial map. Choose exact endpoints and
hop, route and hub limits to inspect shortest routes from the backend. Each hop
preserves the recorded relationship's direction and exposes its supporting
claims; inspection filters records to that hop and can open retained sources.
Path/search responses must match the displayed space, projection revision and
time. Changing endpoints or limits discards stale route results. Partial reads,
excluded intermediate hubs and route limits remain visible; a limited search
cannot establish that no connection exists.

With `graph.export`, Export knowledge prepares authenticated JSON, GraphML,
Cypher, CSV ZIP, JSON-LD or Obsidian ZIP files. Exports cover the selected claim
view across the space; map search, community selection and drawing caps do not
narrow their contents. The browser verifies space, projection digest/revision,
status, timestamp, media type and truncation headers before offering a file.
Decoded bytes are bounded to 100 MiB. Redirects are rejected; cancellation,
refresh, format and connection changes revoke pending or ready downloads.
Partial-export metadata stays in the native file and is disclosed in the UI.

This is a recorded-knowledge view, separate from query evidence. Broader graph
editing and the remaining reference capabilities are still follow-up work.
Availability follows each native server's capabilities.

### Three-dimensional evidence map

Depth renders individual records in the current snapshot with deterministic XYZ
coordinates, a rotation matrix and perspective projection. Drag to orbit,
Shift-drag to pan, and pinch or Ctrl-scroll to zoom inside the canvas. Focus the canvas and use
arrow keys to orbit, +/− to zoom, or 0 to reset. Nodes support keyboard inspection;
this is useful when nearer records obscure a distant one. The X/Y/Z compass and
wireframe planes describe spatial orientation, not confidence or temporal truth.
Layout choices change geometry without changing evidence edges. Unattributed
records and source IDs absent from the snapshot are explicitly identified.
The 2D view retains its expandable session groups. Depth pages large responses
at 1,000 individual records and draws at most 4,000 stored links per page; the
view reports links outside the page or drawing limit. The inspector still shows
all connections in the loaded response, and selecting an endpoint opens its
page. This is not a claim that the complete database was loaded.

Source-image previews are implemented for Playground recall, graph source
inspection, Memory Search and recent-memory results. Select an episode node in
the graph or Records view, then expand **View source images** in its inspector.
Chunk, claim and interaction IDs are not treated as episode IDs: follow their
recorded source connection to an episode first. Switching the inspected record
closes its previews and releases their temporary URLs.

Expand **View source images** to fetch the episode's saved
attachment metadata, then authenticated raster bytes. PNG, JPEG, GIF and WebP
previews validate the recorded size and SHA-256 digest before creating a temporary
browser object URL. Downloads are bounded to 25 MB per image; URLs are revoked
when previews unmount. This byte limit is not a decoded-pixel memory guarantee.
Other media types remain metadata-only; no inline SVG, HTML or PDF rendering.

The Add source form appears when `episodes.attachments` is explicitly true. It
saves a note with an optional original raster image, verifies the attachment
receipt against the selected bytes, then reads back the saved episode link.
Identical text may reuse an existing episode and attach the image there. Closing
before submitting makes no write; while saving, controls lock against repetition.
Upload and episode/link writes are not atomic. An unconfirmed outcome locks the
form and directs the user to inspect Search rather than automatically retrying.
Do not navigate away during saving; aborting a request does not undo server work.
The uncertain-write lock is local to this mounted form, not a durable receipt or
cross-navigation guarantee. A reload/navigation can discard it; server-side
operation tracking and recovery remain follow-up work.

The same form offers **Import text file** for UTF-8 text, Markdown and code
(up to 1 MB). Selection reads locally and shows a literal, non-executing preview;
Save submits the complete decoded text with kind `file` and source basename.
The read-back must match exactly, including line endings and any UTF-8 BOM,
before success is shown. A deduplicated episode retains its earlier metadata;
the saved-text inspection shows its recorded source. No separate binary file
attachment or download is created. Invalid encodings, empty/binary content and
unsupported formats are rejected; PDF parsing and URL fetching are not included.

The native integration test uses the Python attachment API and an isolated
in-memory store, not the live workspace. Rust attachment parity, automatic image
capture from agent sessions, bulk imports, broader file parsing, URL import, OCR and media-inclusive backup
are still unfinished. Existing `[Image #1]` text cannot reconstruct missing bytes.
Missing metadata, missing bytes and transport failures remain distinct states.
This UI is staged until the running backend is reloaded with its required routes.

Submitted Memory Search queries have independent request state. A changed query
or filter immediately removes the previous results and image previews; obsolete
requests are cancelled and late replies ignored. Failed queries expose **Retry
search** and do not retain another query's error. Requests have a 10-second
deadline. Editing the input alone does not submit a search; press Search or Enter.

When `recall.graph_boost` is advertised, Search offers **Use entity-assisted
retrieval**, off by default. It adds passages naming entities connected to the
submitted query while retaining its metadata, tag and time filters. The result
lists considered query entities and neighbors separately from passage support;
**why this** includes the entity lane's rank when reported. Missing or malformed
expansion acknowledgements are rejected, and limited/unavailable retrieval stays
visible even on empty results. Changing this option cancels obsolete requests;
late replies cannot restore the previous expansion. A selected option that loses
capability support pauses the search until explicitly turned off. A new memory
connection starts with the option off.

The Review inbox groups recorded subjects, filters by origin and checked quotes,
and renders 25 cards per page. Sources are loaded only when expanded. Bulk
approval freezes every matching ID across pages, confirms explicitly, and runs
oldest effective date first. Confirmed outcomes survive a later failure; uncertain
writes stop the batch and require a refresh, never an automatic retry. This does
not freeze server state or provide transaction/undo guarantees. Queue polling is
every 15 seconds while visible and idle; the API still returns the full queue.

Beliefs uses inline reason/confirmation forms for close, exclude and include.
Successful receipts are checked against the submitted ID; errors do not imply
that no write occurred. Refresh is required after an unconfirmed outcome.
Closing is not deletion or undo; including does not reopen historical beliefs.
Rust's HTTP server supports close but not exclude/include. Native consoles and
CLIs retain their own independently tested workflows.

- `src/main.tsx`, `src/App.tsx`: React entry, shared shell, authentication and routes.
- `src/memory/`: typed Memory page components, coordinated with Fable.
- `src/playground/`: scoped graph, record search, source inspection and recall.
- `src/conversations/`: capability-checked text session controls, saved
  transcripts, public-text previews, request polling and source evidence. Uses
  the optional Python conversation API; provider configuration is server-owned.
  No voice/video or token-level telemetry is claimed.
- `src/api.ts`, `src/types.ts`: authenticated API client and evidence wire types.
- `src/local-session.ts`: explicit UI-host runtime bootstrap.
- `src/components/DevReload.tsx`: opt-in ETag revision checks.
- `src/workspace.css`, `src/identity.css`: layout and original Scone identity.
- `src/assets/`: runtime images; `assets/`: original mark and generation record.
- `/memory`, `/playground` and `/conversations/:sid?` are React routes in one application; `/` redirects
  to `/memory`. Development proxies only API traffic and local auth bootstrap.
- This repository's Node host serves page routes and proxies API requests to the
  explicitly configured local backend. Python services serve APIs only.

Saved sessions remain readable without a configured text model; starting and
sending require one. On reopening, the optional conversation API's
`latest_request_id` identifies the latest accepted turn without guessing from
request-ID order. The UI distinguishes a completed reply whose text was forgotten
from one that cannot currently be read, and never resends either automatically.
It rechecks known receipts, clears revoked reply evidence and protects newer
commands/session selections from stale polling responses. These are outcome
receipts, not proof of provider delivery or a reconstructed token stream.

When the service explicitly advertises `streaming: true` with an SSE
`active_window` contract, accepted turns also show a **Live preview**. This reads
real public-text chunks using authenticated fetch; the key is never put in a URL,
redirects are rejected, and no stream is opened on older aggregate-only servers.
The preview is separate from Saved messages. Only the existing polled receipt
and transcript establish a retained reply; streamed text is not a capture receipt.

**Reconnect preview** resumes the same turn from its last sequence without
posting another message. There is no automatic reconnect loop. If the server has
evicted a prefix, the UI labels the gap and shows only the latest continuous
segment instead of stitching disconnected passages together. A reload can read
the active window, not an unlimited history of chunks. The final saved reply
remains readable through ordinary receipts/transcripts when available.

Each SSE frame is bounded to 524,288 decoded UTF-16 code units including framing,
and the visible preview to 1 MiB of UTF-8 text. Reaching that limit stops the stream and waits for the
saved outcome. Thirty seconds without incoming stream bytes interrupts the
preview; receipt polling continues. These are client safeguards, not provider
queue or whole-browser memory guarantees. Cancel, end, session/space changes,
and terminal outcomes remove provisional text and close its reader. A failed,
forgotten or unreadable reply cannot be replaced with the old preview. Hidden
reasoning is not displayed; chunk counts are not token counts. Voice and video
remain separate, unfinished transport work.

For isolated conversation UI checks, build with Vite, package with `--output`
as above, and pass that path as `SCONE_CONVERSATIONS_HTML` to
`node --test scripts/test-conversations.cjs` from the repository root. Install
Playwright or set `SCONE_PLAYWRIGHT_MODULE` to an installed module; optionally set
`SCONE_BROWSER_PATH` and `SCONE_SCREENSHOT_DIR`. Fixtures use temporary localhost
services, never the live memory store. No screenshots are written by default.

When the conversation service explicitly advertises `recall_scope: true`, the
start dialog offers source type, literal source prefix, inclusive creation-date
bounds and exact metadata matches. All selected filters must match; an empty
result never broadens recall. Dates without times mean midnight UTC. Filters
are fixed when the start request is submitted, retained for uncertain retries,
and checked against the server's acknowledgement before opening the session.
Validation rejections allow correction; uncertain outcomes do not automatically
create another session. Saved conversations expose a read-only Memory selection
summary, distinguishing no extra filters from unreported scope on older servers.
These controls narrow retrieved knowledge, not transcript capture, the session's
own history or server-side access policy.

`scripts/test-conversations-native.cjs` additionally exercises the actual Python
conversation API, native memory and realtime adapters through the browser. Set
`SCONE_TEST_PYTHON` to an environment with Scone's `api` and relevant realtime dependencies,
plus `SCONE_CONVERSATIONS_HTML` and the browser settings above. The Python
fixture uses temporary state and scripted model frames, not provider inference.
For an existing split local test installation, `SCONE_TEST_EXTRA_SITEPACKAGES`
can explicitly append an API dependency directory; such a run does not verify a
fresh, self-contained dependency installation.

The native browser suite also tears down and recreates the conversation service
around its retained journal and memory engine, with the model then disabled.
It verifies latest-outcome discovery, forgotten text, browser reload and scope
isolation. This is service recreation, not a killed-process or live-provider test.

The graph renders stored relationships only. Depth is a spatial layout, not a
3D simulation or confidence value. API connectivity, observed agent events and
verified host capture are distinct. Current snapshots are bounded; lossless
event replay and current Codex App capture have not been verified.

## Source removal

Source pages on servers advertising `episodes.forget` link to an impact preview
at `/memory/sources/:id/forget?space=...`. The page checks the connected space,
shows chunks and attachment ownership, and lists retained citing claims and
links before requiring explicit confirmation. Claims, links and their quotes
remain; shared attachments, downloaded copies and backups can remain too.

After an unconfirmed response, Check removal status only reads. Pending cleanup
can be resumed with a fresh confirmation; a completed tombstone confirms removal
without fabricating the original receipt counts. The app does not automatically
retry DELETE. HTTP transports may replay an idempotent DELETE after a broken
connection, so the backend must retain and honor its durable cleanup identity.
The preview is an observation rather than a lock against intervening writes.

`scripts/test-source-removal.cjs` checks the packaged UI with the same local
Playwright/browser environment variables as the other browser suites. It covers
confirmation, paged impact, interrupted responses, explicit resumption, read-role
denial, invalid receipts, capability/space checks, navigation and mobile layout.

## Agent workflow configuration

`/agents` discovers `agents.catalog` and `agents.plans` before offering the
workflow editor. A host supplies named agents and allowed models; the user picks
an explicit model for every task and declares which task outputs it receives.
Plans support up to 32 tasks with acyclic dependencies. Saving and editing use
server revisions, with conflicts retaining the local draft. Removed model choices
remain visible as unavailable until explicitly changed. Saves never silently
replace the selected model or task graph.

Saved plans belong to the authenticated space and are loaded without browser
storage. The server enforces write permissions; read-only users can inspect plans.
The Python host must configure `AgentCatalog` and `AgentPlanStore` in `create_app`.
Hosts with run capabilities also support starting, cancelling and inspecting
saved workflow runs in the browser. Native execution uses `AgentWorkflow`.

When the host advertises `agents.history`, every opened run shows an
**Execution timeline** below its results: the metadata the host recorded as
the run executed -- observation start and end, turns, model and tool calls
with their timing, tool outcomes by status and size, and the sequences the
collector did not see -- one numbered entry per retained position. Prompts,
tool arguments, answers and reasoning are never in these events, and an
entry carrying any other field is withheld with an alert rather than shown.
Positions removed by retention are named. **Load more** reads the next page
from the cursor the host returned; **Follow live** opens the host's
`text/event-stream` route from the last cursor, accepts a page only when its
SSE id names it, reconnects from that cursor while the run is active when the
host closes an observation window, and stops -- saying so -- after three
windows without a new event, when the run is no longer active, or when the
collector records that observation finished. Nothing in the timeline restarts
a run or calls a model.

When the host advertises `agents.text_stream`, each step a run is working on
shows a **Live answer** pane while it runs: the answer as the model writes it,
labelled provisional, never the verified result. Text written before a tool
call is withdrawn and the pane says so; a reader that fell behind the host's
window is told what is missing rather than shown a spliced passage; when the
run has a receipt the pane yields to the verified result, which decides the
outcome. The pane reconnects from its last sequence on request, and never
restarts a run.

Run `node --test scripts/test-agents.cjs` with the same Playwright environment
variables used above. It verifies packaged desktop/mobile editing, persistence,
forged save receipts, conflict/draft handling, delayed paging and capability gates.

## Retained OCR table inspection

Servers advertising `documents.ocr.tables` offer **Analyze table layout** below
retained PDF OCR evidence on the source page. The explicit read finds possible
aligned grids, displays candidate rows and columns, and links cells back to
recorded OCR regions. Unassigned text remains available. The JSON download
includes source identities and region references for checking the result.

This geometry-only inspection neither reruns OCR nor changes indexed text.
Headers, merged cells, multi-line cells and missing values are not inferred;
aligned prose can resemble a table. The UI rejects changed source bindings,
invented cell text, invalid geometry and incomplete region coverage, and hides
old results on retry or cancellation. The server limits analysis to 5,000 regions
and 2 MB of text per page; candidate and row paging keep larger results usable.

`node --test scripts/test-ocr-tables-native.cjs` exercises the packaged UI against
an isolated Python native API, real local Tesseract recognition of a generated
raster-only PDF, and durable SQLite/blob storage. Use `SCONE_TEST_PYTHON` with
Scone's PDF OCR and API dependencies, the Playwright/browser settings above, and
`PYTHONPATH` pointing to the matching native checkout. It checks desktop/mobile
inspection and export, cancellation, capability absence, process restart without
OCR repetition, and forgotten-source refusal. No live service is used.

## Contributing, license and citation

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review requirements.
The [ProjectScone Research Attribution License](LICENSE) is custom and
MIT-derived, with mandatory research and academic citation. Credit Mark
Sturman, JudgeHuman and ProjectScone. [CITING.md](CITING.md) provides MLA,
APA, Chicago and BibTeX examples; [CITATION.cff](CITATION.cff) provides metadata.

### Retained media transcripts and checked playback

Media source pages and verified import results offer **Inspect transcript and audio**. **Read transcript** checks the saved source, timestamps and current
memory space before showing paged segments. Reading does not transcribe again.
Video transcripts describe the first audio stream; they do not describe frames.

For extractions with a recorded normalized audio identity, **Prepare checked audio** fetches `/v1/episodes/{id}/document/audio`, verifies its digest, length and
PCM format, then rechecks source access before creating a temporary playback URL.
The host decodes the retained original without running its transcription model.
Playback starts only through the audio control. Segment seek buttons move the
playhead and pause it; cancellation and clearing release the temporary URL.
Legacy extractions without this identity retain transcript inspection and original
downloads but cannot offer checked playback.

`node --test scripts/test-document-media.cjs` covers packaged controls against
bounded local fixtures. `scripts/test-document-media-native.cjs` additionally runs
real native ingestion, decoding and SQLite persistence through the packaged UI,
including a service restart and a forgotten source. Set `SCONE_TEST_PYTHON` to an
interpreter with Scone's API/media dependencies, install local `ffmpeg`, and use
the browser environment described above. Its generated audio and scripted
transcript test interoperability, not transcription accuracy.

### Configured directory synchronization

Documents exposes local collections when the host advertises `documents.sync`.
Start records a stable request ID and the discovered configuration; a changed
collection is refused before admission. Missing-source removal is off by default
and only offered for collections that allow it. Unconfirmed admissions can be
checked without another write, or explicitly retried with the same intent.

History reads never start work. Interrupted runs require explicit resume;
cancellation acknowledges intent while the worker stops. The UI disables local
controls for runs owned by another server process. Result pages validate their
space, run identity and ordering, and label receipts as historical observations.
The current source library remains the place to inspect retained content.

`node --test scripts/test-directory-sync.cjs` checks control and transport faults.
`scripts/test-directory-sync-native.cjs` exercises the standard native host with
local SQLite and source journals on desktop/mobile, including edits, deletion,
result paging, restart without replay, process termination and explicit recovery.
Use the explicit Python/browser environment described above; its state is private
to the test and it does not connect to the running memory service.

### Sampled video text and frame citations

When the server advertises video OCR, choose **Visible text in sampled frames**
before selecting videos, or change the choice on an individual queued file.
Speech transcription remains the default when available. Frame OCR excludes
speech; other file types keep their existing extraction choices. Both the local
queue and background imports bind this choice to the saved request and result.

**Inspect sampled video frames** on a source or verified import reads the retained
sampling record. Select a frame, then **Prepare checked frame** to display PNG
pixels verified against its hash, dimensions, ordinal and exact presentation
timestamp. Select recognized text to highlight its stored box. Long region lists
are paginated. The catalogue uses decimal-string int64 clocks and rational time
bases so large offsets are not rounded by JavaScript.

Empty OCR results remain visible in the frame inventory. They do not establish
that an image is blank, and sampling does not establish coverage between frames.
Viewing frames reruns neither OCR nor transcription. Cancellation, changing the
source/space/frame, and clearing evidence discard pending results and release
prepared image URLs. Source access is rechecked before pixels are displayed;
these observations are not an atomic transaction across storage systems.

This requires a native host supporting the version-one video catalogue and
verified frame endpoint. Existing audio and document evidence remain available
on older hosts. Hosts supporting visual-only video retention can keep the original
and sampled evidence when OCR returns no text; the source then has no searchable
text.

On source pages, hosts advertising `documents.video.understand` also offer
**Interpret this frame** after the selected PNG is checked. Choose an image-capable
self-hosted model in **Models → Image understanding**, write a task, and explicitly
submit it. Each request uses the current saved vision model. The displayed result
names that model and frame and remains unsaved; it does not alter OCR evidence or
make the source searchable by its visual meaning.

The task limit is 16,000 Unicode codepoints, including emoji counted consistently
with the API. Changing the task or frame, cancelling, clearing evidence or leaving
the source discards the pending result. Reloading does not replay inference. The
browser rechecks source evidence before and after the response; a removed or
changed source refuses the interpretation. Cancellation stops display and browser
transport, but cannot guarantee the provider stops work already received.

When the connected server advertises `agents.usage`, completed workflow results
show **Reported token usage** for each model task or handoff hop. Prompt,
completion, and total counts each include their reporting coverage; missing
reports display **Unknown**, and historical tasks without telemetry say that it
was not recorded. Saved results keep their original counts across restart and
repeated reads. Human replies have no model usage, and a final handoff is shown
once with its hop.

This view requires the native workflow usage contract and explicitly requests
`include_usage=true`. Older servers retain the existing result view. The counts
are provider reports for completed tasks, not billing totals or quality scores;
failed and interrupted attempts can consume tokens outside these receipts.

### Task output requirements

When the host advertises `agents.output_requirements`, each model task can choose
text or JSON-object output, answer instructions, and byte/line limits. Hosts with
`agents.output_schema` additionally accept an optional JSON schema. Schema drafts
must be bounded JSON objects without duplicate keys; the host validates schema
semantics and rejects invalid model answers. The console keeps authored local
`$defs`/`$ref` intact through saving, loading and immutable run requests. Human
input tasks retain their existing plain-text reply controls.

Changing requirements creates a new plan revision and requires a new run. Shape
validation does not establish factual accuracy. The console refuses nonfinite or
unsafe integer schema values, and schema drafts that lose decimal precision or underflow, rather than silently rounding them; its browser
number representation is narrower than Python's integers. Servers without these
capabilities retain the existing workflow editor.

`scripts/test-agent-output-native.cjs` exercises the packaged console against
actual local native HTTP and encrypted journals at desktop and mobile widths,
including malformed drafts, selected models, invalid answer withholding and
process restart without additional inference. It uses the same explicit local
Python/browser environment variables as the other native browser fixtures.

### Handoff final output requirements

When the host advertises `agents.handoffs.output_requirements`, a handoff workflow
can set a final text or JSON-object contract, including byte/line limits,
instructions and an optional schema. Requirements apply when an agent finishes;
intermediate agents can exchange ordinary prose notes. Each agent retains its
selected host-approved model and allowed targets.

Schema authoring additionally requires `agents.output_schema`. The console keeps
authored local references and refuses invalid drafts before saving. An invalid
schema draft also marks the workflow unsaved, preventing a run against stale
saved settings. Changing the contract requires a new plan revision and run.
The native host validates the final result before persistence and again when
reopening it. A schema checks shape, not factual accuracy.

`scripts/test-handoff-output-native.cjs` exercises real two-agent HTTP execution,
selected models, exact save/reload, invalid drafts and final answers, and an
encrypted journal restart without model replay, at desktop and mobile widths.
Use the same isolated Python/browser settings as the task contract fixture.

### Exact tool approvals

When the host advertises `agents.approvals`, run inspection shows guarded calls
with their agent, selected model, workflow step, tool revision and exact JSON
arguments. Large integers retain their original digits. Directional Unicode
controls appear as explicit Unicode escapes in both pending requests and history;
the bound arguments remain unchanged.

**Approve** or **Deny** saves a decision without executing a tool or calling a
model. Select individual saved decisions and choose **Continue with selected
decisions** to advance those calls. A denial skips that tool handler and lets the
agent receive the denial when explicitly continued. Decisions require a review
or full key; continuation requires a write or full key. The host enforces these
permissions and binds each decision to the saved call and revision.

An unconfirmed continuation retains its identifier and selected batch across
status refreshes and reopening that run in the current panel. Retrying is always
explicit. A continuation already saved by the host can also be recovered after
reloading the browser. Nothing is automatically resubmitted. Cancelled runs and
runs with unknown outcomes cannot continue; admitted-call history alone does not
prove an effect completed. Read the run status and verified results.

After `pnpm build`, `pnpm test:agent-approvals:browser` exercises the packaged
console against an isolated local HTTP fixture. It checks ambiguous-response
recovery across status refresh and visible directional controls without changing
argument values. It requires an installed Playwright module and local browser;
set `SCONE_PLAYWRIGHT_MODULE` to its module path and
`SCONE_BROWSER_EXECUTABLE` to the browser executable when they are not available
through Playwright's defaults. The command does not install or download either.
