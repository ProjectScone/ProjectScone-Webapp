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

## Contributing, license and citation

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and review requirements.
The [ProjectScone Research Attribution License](LICENSE) is custom and
MIT-derived, with mandatory research and academic citation. Credit Mark
Sturman, JudgeHuman and ProjectScone. [CITING.md](CITING.md) provides MLA,
APA, Chicago and BibTeX examples; [CITATION.cff](CITATION.cff) provides metadata.
