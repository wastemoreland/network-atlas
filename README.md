# Network Atlas: Interactive Map & Stats

Network Atlas lets you explore your Transport Fever 3 saves outside the game.

Export your map to an interactive browser view in 2D or 3D. Inspect your railways, roads, cities and industries, trace connections across the map, and dig into the numbers behind your network. Explore economic stats, cargo flows, production chains and city growth through maps, charts and other visualizations.

The export is a **snapshot** taken when you press the export button — not live telemetry. The viewer runs locally in your browser and never uploads the file to a server.

## Features

- **2D and 3D map** — pan, zoom and tilt a real terrain relief built from the exported heightmap, with roads, rails and lines draped onto the surface.
- **Layers** — terrain, roads, rails, towns, industries and transport lines, alone or combined.
- **Network inspection** — select a line to see its route, stops, capacity usage, throughput, frequency and configuration issues.
- **Economy** — cargo flows between industries and towns, production chains and town growth.
- **Search and filter** — find lines by name, mode, cargo or id; every missing statistic is shown as `—` rather than an invented zero.
- **No dependencies** — the viewer is a single HTML file with no CDN or network access required.

## Requirements

- Transport Fever 3 installed, with the mod enabled for the save you want to export.
- A modern desktop browser. The 3D view uses WebGL and falls back to a flat tilted view where WebGL is unavailable.

## Installation

### Steam Workshop

Subscribe to **Network Atlas: Interactive Map & Stats** in the Workshop; the game installs and updates it automatically.

### Manual / local install

Copy this repository into your Transport Fever 3 local mods folder so the metadata sits one level inside it:

```
<userdata>/local/mods/network_atlas/
    mod.json
    _content.json
    _metadata/
    content/
```

To download, use **Code → Download ZIP** on GitHub and unpack it, or clone the repository into that folder.

### Viewer only

You do not need the game to open an existing export. Open `index.html` directly in a browser, or host this repository with GitHub Pages and use the published URL.

## How to use

### 1. Export a map

1. Enable **Network Atlas: Interactive Map & Stats** for the save and load the game.
2. Open **Export map** in the top-left mod button area and choose **Export map data**.
3. The mod writes `network_atlas_export.lua` in the game's userdata folder under `network_atlas_exports`.
4. Open `index.html` in a browser and upload `network_atlas_export.lua` (or drag and drop it onto the window).

The export contains terrain height samples, world bounds, road segments, track segments, towns, industries, a `lines` collection and an optional `econ` block of cargo flows.

**Everything in the file is a snapshot taken at the moment you press Export.** Traffic movement, live traffic intensity, vehicle positions and any value that changes after the export are frozen at export time. Re-export to refresh.

### 2. Explore

- Use the layer selector to switch between **Terrain + roads**, **Terrain**, **Roads**, **Lines** and **Lines + map**.
- In the **Lines** panel you get a table of every exported line: name, mode, stop count, frequency, throughput and capacity usage. Type into the filter box to search by name, mode, cargo or id.
- Click a row — or click a route/stop directly on the map — to select a line. Its route is drawn thicker with a dark outline, its stops and stop names are labelled, and the detail panel shows its stops with coordinates, per-cargo capacity, configuration issues and any finance values. Click the row again or **Clear selection** to deselect.
- Stops are drawn for every line; names are only labelled for the selected or hovered line so labels do not pile up.
- **A missing value is shown as `—`.** It means the game did not report that value for that line — it does not mean zero. Examples: a line with no readable capacity usage shows `—` under Capacity; a line with no balance shows `—` under *Balance (last year)*.
- Pan with the mouse drag, zoom with the wheel, press **Fit** to frame the map (the fit area accounts for the side panel).
- PNG export always renders the flat 2D view regardless of the current camera tilt.

## 3D terrain view

Click the **3D** button in the bottom-right zoom controls (or right-drag the map) to tilt the camera and extrude the heightmap into a real 3D relief model.

- The terrain is drawn as a textured WebGL mesh: the map surface is displaced by elevation, water surfaces are flattened to sea level, and the map plate gets a skirt wall around its edges.
- Roads, rails and transport lines are draped onto the terrain surface and broken where they pass behind mountains, ridges or other occluding terrain.
- Towns, industries, line stops and the selection marker are projected onto the terrain and hidden when they are behind relief.
- The **Relief exaggeration** slider in *Terrain generation* controls the vertical scale in 3D as well as the hillshade. **Terrain detail** sets the mesh resolution: *Draft* is fastest, *Normal* is a good balance, and *Full* is sharpest on large screens.
- If WebGL is unavailable the viewer falls back to the original flat tilted view.

The viewer parses the uploaded file as data only: it never evaluates uploaded Lua (`eval`, `Function` and friends are not used).

## Export format

The format identifier is `network-atlas-map-v1`. Everything described below is **additive and optional**: a key the game reports nothing for is omitted, and a value the engine does not provide is omitted too, never replaced by a fabricated `0`. The viewer refuses any other format identifier.

### Lines

Lines are the current player's lines from `api.engine.system.lineSystem.getLinesForPlayer(api.engine.util.getPlayer())`, sorted by entity id. Each line is a plain table of serializable values:

| Field | Meaning |
| --- | --- |
| `id` | Line entity id — stable within this snapshot; use it to join related records. |
| `name` | Display name from `api.engine.util.getEntityName`. Omitted when the game returns none (the viewer then shows `#<id>`). |
| `color` | `[r, g, b]` in 0–1 from the line's `COLOR` component. Omitted when the line has none; the viewer falls back to a palette colour. |
| `modes` | Sorted transport mode names from `getLineTransportModesUnion`, e.g. `BUS`, `ELECTRIC_TRAIN`. Omitted when the read fails. |
| `stops` | Ordered stops: `index` (1-based), `name` (station group name), `x`/`y` world coordinates, `terminal`, `stationEntity`. Coordinates are the centre of the station's bounding volume (`BOUNDING_VOLUME.bbox`); if the station cannot be resolved the station group's centre is used, and if neither exists `x`/`y` are omitted. |
| `waypointCount` | How many waypoints the save stores on this line's stops (the via points placed in the line manager), summed over its stops. Written only when the count is at least one. A line with `waypointCount` but no `path` stores waypoints that could not be resolved against the transport network; a line with neither stores none at all. |
| `path` | Ordered world points (`{x, y}` each, rounded to 2 decimals): every stop centre in stop order with the line's **stored** waypoints resolved against the transport network between them — the same stop-then-waypoint sequence the game's own line manager assembles (`gui/line_vehicle_mgmt/line_util.tl`: one `path` entry per stop, then one per waypoint). A waypoint that carries a position contributes that position; a waypoint that sits on an edge is read from that edge's geometry (`getComponent(edgeId.entity, TRANSPORT_NETWORK)` → `edges[edgeId.index + 1]` → `api.engine.util.transport.calcPosition`), sampled every 20 m (at most 16 steps) when two consecutive waypoints lie on the same edge so curves follow the track instead of a chord. A waypoint that cannot be resolved contributes nothing and no point is ever invented. **Omitted entirely** when the line has no resolvable waypoint. This is *not* the route vehicles drive — Transport Fever 3 stores no route on a line (see *Not exported*), so every line without a manually placed waypoint has no `path` and the viewer falls back to its stop-to-stop drawing. |
| `computedPath` | Ordered world points with the same shape as `path`: every stop centre in stop order with a **computed** route between consecutive stops — the game's own pathfinder (`api.engine.util.pathfinding.findPath`) run once per stop pair at export time, then replayed against the network geometry exactly the way a stored `path` is (`getComponent(edgeId.entity, TRANSPORT_NETWORK)` → `edges[edgeId.index + 1]` → `api.engine.util.transport.calcPosition`, one sample every 20 m with at most 16 steps per edge so a long edge is covered coarsely but never partially, rounded to 2 decimals, consecutive duplicates dropped). Nothing in it is read from the save; see *Computed routes* below for when it is written and when it is dropped. |
| `computedPathSource` | The literal string `pathfinder`, written exactly when `computedPath` is. The provenance marker: a reader never has to guess whether a shape came from the save or was computed during this export. |
| `capacity` | Per cargo type: `cargoTypeId`, `name`, `used`, `capacity` from `getLineCapacityUsages(line, false)` — the same call the game uses for the line's capacity display (`false` = the vehicle's current load configuration). |
| `throughput` | `calcLineStationThroughput(line)`. |
| `maxFrequency` | `getMaxFrequency(line)`, in cycles per second as returned by the game. |
| `issues` | `getLineIssues(line, false)`: `type` (e.g. `NowhereToLoad`), `stopIndex`, `cargoTypeId`, `cargoName`. |
| `finance` | See below. Omitted when the game reports no finance value for the line. |

Each optional statistic is read inside its own narrow `pcall`, so a value one line does not support can never fail the whole export. A value the engine does not provide is **omitted**, never replaced by a fabricated `0`.

### Computed routes (`computedPath`)

Transport Fever 3 stores no route on a line — only its stops and any waypoints the player clicked in — so `path` only ever reports a *stored* waypoint sequence (see *Not exported*). `computedPath` is the other half of that story: the route the game itself would path between two stops, **computed once per stop pair while you press Export**, replayed against the network geometry and written with its own name and marker so it can never be mistaken for stored data.

- **Provenance.** It exists only next to `computedPathSource = "pathfinder"`, and it is absent from every line the save already describes: a line that stores any waypoint at all (a `path`, or a `waypointCount` of at least one) is never recomputed, so stored data always wins and an unresolvable stored waypoint is never papered over by a computed one.
- **Endpoints.** The stop's own terminal, resolved the way the line manager resolves a stop: `stops.stationGroup` → `stations[stop.station]` → `terminals[stop.terminal]` (plus that stop's `alternativeTerminals`). The departure contributes `Terminal.vehicleEdges` (`api/type.d.tl`) as start states — one per standing position, in both travel directions, each carrying the distance from the edge's start — and the arrival contributes `Terminal.vehicleNodeId`. This mirrors the game's own helper `mission/mission_pathfinding_util.tl`, which routes to `station.terminals[*].vehicleNodeId`. *Caveat:* the polyline begins at the **start of the departure terminal's edge**, not at the vehicle's standing position, so its first route point can sit a short distance from the stop centre; the stop centre is written first, so the line always touches its stops.
- **Mode set.** The line's own modes (`getLineTransportModesUnion`, only the modes the line is enabled for) are passed to `findPath` as the allowed `transportModeSet` — the same shape the game passes when it knows the modes, so a rail line is never routed over road-only edges and vice versa.
- **Length limit.** `maxLength = max(floor(1.5 × straight line distance between the two stops), 1000 m)`, so a short pair still has room to go around an obstacle.
- **Verification.** The result is accepted only if it is non-empty, every edge it names resolves to geometry with two end nodes, every consecutive pair of edges shares a node (the nodes decide the direction; the `boolean` the pathfinder reports is only a fallback), the first edge starts on an edge of the departure terminal, the last edge touches an arrival node — the check that catches a route cut short by the length limit — and the sampled length is at least half the stop pair's straight distance and no longer than the limit it was given. The route is then sampled whole edge by whole edge: one point every 20 m, at most 16 steps per edge (wider for a long edge, never truncated), stop centres interleaved.
- **Omission.** Everything above is all-or-nothing per line. Fewer than two stops, a stop without a resolved centre, no transport modes, a terminal without standing edges, a stop pair the pathfinder cannot route, a result that fails any verification, or any read that raises — and *both* `computedPath` and `computedPathSource` are left out for that line while the rest of the export continues. There is no fallback geometry and no partial route. Worst case the field is absent everywhere.
- **Cost.** About 180 `findPath` calls for a 127-line save, made in one pass with no retries, and only for lines that store no waypoints. On the reference export the field is estimated at **+1.1 … +1.5 MB (≈ +2 … +2.7 %)** — measured as 183 stop pairs totalling 312.8 km of straight-line stop gaps at the same 20 m point density the rail shapes already use; a longer stop gap than about 5.3 km is sampled more coarsely (8 of 183 legs on this save) so no single leg can grow without bound. Raising `computedPathStep` from 20 m to 40 m would roughly halve that again.

### Finance fields

`finance` is present when at least one value could be read. Every exported value has a verified source, unit and period:

| Field | Source | Units | Period |
| --- | --- | --- | --- |
| `balanceLastYear` | `api.engine.util.finance.calculateBalance({line}, fromTime, toTime, true)` — the exact call the game uses for a line's **Balance** card | game currency (what the game prints with `api.util.formatMoney`) | last game year: `toTime = GameTime.gameTime`, `fromTime = max(toTime - api.util.getDefaultYearDuration(), 0)` |
| `balanceFromTime`, `balanceToTime` | The boundaries of that period | game time units | — |
| `year` | `api.engine.util.getYear()` | Calendar year at export time | — |
| `itemsTransportedLastYear` | `api.engine.util.logbook.getLogValuePerYear(line, "itemsTransported")` — the exact call the game uses for the line's **Transported · Last Year** card | Items/passengers carried | Last year |

**Unavailable / unverified finance fields — deliberately not exported:**

- **No per-line income, running cost or profit figure.** Transport Fever 3 has no per-line finance logbook entry: the only log name found for a line entity in the installed game scripts is `itemsTransported` (`companyBalance` and `companyTotalValue` exist only for world entities). So `getLogValuePerYear` cannot report money per line, and there is no verified "profit" value to export.
- The line's account chart (`api.engine.util.finance.getAccountChart`) does expose income and running-cost series for a line, but the mapping from a chart group to its time period could not be verified from the API definitions alone, so those series are left out rather than exported with guessed labels.
- `balanceLastYear` is intentionally **not** named "profit": it is the balance the game itself shows for the line over the last game year.

### Railways (`rails`)

`rails` is a top-level array of every track segment of the shared street/track graph, read from `api.engine.system.streetSystem.getNode2TrackEdgeMap()`. A segment reported under several nodes is written once. Rows use the same four coordinate fields as `roads`, so a viewer can stroke them with the same code:

| Field | Meaning |
| --- | --- |
| `x0`, `y0`, `x1`, `y1` | Segment endpoints in world coordinates, rounded to 2 decimals (the same precision the rest of the file is written with). |
| `roadType` | `RoadType` name — `TRACK` for a track segment, `STREET` if the game reports a street. Omitted when the game reports none. |
| `roadTemplate` | Road template resource name, e.g. `::/infrastructure/rail/main.street_template`. |
| `edgeType` | `BaseEdgeType` name: `NORMAL`, `BRIDGE` or `TUNNEL` (from `BaseEdge.type`). |
| `distance` | Segment length exactly as the game reports it. |
| `points` | Sampled centreline as `{x, y}` points (rounded to 2 decimals), first point first — the true shape of a curved segment. Sampled every 20 m, at most 16 steps (17 points), which keeps one rail row below ~1.5 kB whatever the segment length. **Omitted** when the segment has no transport-network geometry, when fewer than two distinct points come out of the sampling, or when the sampled shape does not begin and end where the segment does (tolerance 25 world units — such geometry belongs to a different edge). A row without `points` is drawn straight between its endpoints. |

### Towns and industries

Town rows keep `name`, `x`, `y`, `sizeFactors`; industry rows keep `x`, `y`, `angle`, `onWater`, `fileName`, `tag`. Both gain:

| Field | Meaning |
| --- | --- |
| `entity` | Town/industry entity id inside this snapshot — the join key for `econ.flows`. Taken from the game map's `existing` field, falling back to the nearest entity of the matching component (`TOWN` / `INDUSTRY`) around the row's position. Omitted when nothing matches, and every statistic below is then left out as well. |

Towns additionally:

| Field | Meaning |
| --- | --- |
| `population` | `getTownCapacityUsage(town)[RESIDENTIAL + 1].capacity` — the same expression the game's town window uses for its population number. |
| `landUse` | One row per district (`type` = `RESIDENTIAL` / `COMMERCIAL` / `INDUSTRIAL`, plus `used` and `capacity`) from `api.engine.util.town.getTownCapacityUsage`. |
| `lineUsage` | `getTownLineUsage(town)` — the share of the town the player's lines serve, 0–1. |
| `stock` | Cargo waiting in the town from `getTownStockCargo(town)`: `cargoTypeId`, `name`, `stock` (items in stock), `capacity` (stock capacity), sorted by cargo id. |

Industries additionally:

| Field | Meaning |
| --- | --- |
| `level`, `maxLevel` | Industry level from its `INDUSTRY` component. |
| `producing`, `boostFromRule`, `boostFromPersonCapacity` | `api.engine.util.industry.getIndustryProductivityInfo(industry)` — booleans exactly as reported, so `false` is a value and not a missing one. |
| `productionRating` | `api.engine.util.stock.getProductionRating(stockList)`. |
| `inputs`, `outputs` | Per cargo type: `cargoTypeId`, `name`, `amount`, `maxAmount`. Inputs are `getCargoConsumedPerYear` / `getCargoMaxConsumptionPerYear`, outputs are `getCargoProducedPerYear` / `getCargoMaxProductionPerYear`, and the cargo lists come from `getInputsOutputsFromRules(stockList)` (the stock list entity of the industry). |

### Economy (`econ`)

`econ` is a top-level block and is **omitted entirely** when the game reports no cargo flow at all:

| Field | Meaning |
| --- | --- |
| `year` | `api.engine.util.getYear()` — calendar year at export time. |
| `flowCap` | The cap that was applied (1000). |
| `flowsTotal` | Number of flows found before the cap was applied; compare with `#flows` to know whether the table is complete. |
| `flows` | Cargo flows of the **most recent game year only**, sorted by `volume` descending and then `from`, `to`, `cargoTypeId` ascending, truncated at `flowCap`. |

Each flow carries `from` (industry entity id), `to` (town or industry entity id), `fromName`, `toName`, `cargoTypeId`, `cargoName` and `volume` (items delivered in the last year).

- **Origins** are this snapshot's industries, **destinations** its towns and industries, and the cargo types are each industry's outputs from `getInputsOutputsFromRules`. All four endpoint/cargo ids join back to rows in `industries`/`towns` via `entity`.
- The volume is read with `api.engine.util.stock.getCargoLogPerYearForTarget` using the argument order of the game's own helper (`gui/main/cargo_util.tl`): the log behind a town destination is read from the town (`getCargoLogPerYearForTarget(destination, origin, "itemsTransported", cargo)`), every other log from the origin.
- A flow is written only when the game reports a positive volume, so no row carries an invented zero.

### Not exported (and why)

- **Per-cargo line info (`cargoInfo`).** `api.engine.system.transportVehicleSystem.getLineCargoInfo(line, cargoTypeId)` was dropped because it could trigger a hard engine assertion — `Fatal error: cargoType < m_systemData->cargo2line2info.size()`, in `ecs::TransportVehicleSystem::GetLineCargoInfo`. A native assertion aborts the process and cannot be caught with `pcall`, and no API exposes the bound the engine checks, so no cargo type can be proven safe to ask about. The viewer colours routes by their dominant cargo using the safe `capacity` block instead.
- **Passenger origin/destination arcs.** `getSourceToDestinationCount` needs a complete `destinationIsTownMap` that can only be built by replicating the game's own person-destination enumeration; with an incomplete map the counts would be wrong. Left out rather than guessed.
- **Town happiness and growth statistics** (`getTownExperience`, development state): no API verified that reports them per town entity.
- **Traffic speed / congestion map**: out of scope for this export and far larger than the whole budget allows.
- **Turn-by-turn routes for auto-routed lines.** The save stores none. `Engine.Component.Line` (`api/engine.d.tl`) carries only `stops`, `vehicleInfo`, `customFilters` and `reservationPriority`, and `Stop` carries `stationGroup`, `station`, `terminal`, `alternativeTerminals`, `loadMode`, the waiting times, `waypoints` and `stopConfig` — no edge sequence anywhere. Waypoints themselves are created only by the player in the line manager (`gui/line_vehicle_mgmt/manager_window.tl`: `api.type.Waypoint.new()` → `.edgePos` for road/track or `.pos` for water/air → `commonParams.addWaypoint`); no game script creates them automatically, which is why only lines with manually placed via points get a `path`. The path APIs that do exist — `api.engine.util.pathfinding.findPath` / `findPathNodeToNode`, returning `{{EdgeId, boolean}}` — are *computations*, not a stored line route: they take plain node lists rather than the stop's terminal, its `alternativeTerminals` or the line's waypoints, `findPath` takes a `maxLength` that can silently shorten a result, and the game re-runs them at runtime — a vehicle's route lives in `MovePath.path` (and `path0`/`path2` on the move state) and changes as it drives. Replaying them at export time would publish a route no vehicle is guaranteed to drive, which is why `path` only ever reports what the save stores. Where a line has nothing stored at all, the pathfinder result *is* now exported — under its own name, `computedPath`, always next to `computedPathSource = "pathfinder"` and never on a line that stores waypoints (see *Computed routes*), so a computed route can always be told apart from a stored one and `path` still means exactly what the save contains.

## Compatibility and versioning

- The export format identifier is `network-atlas-map-v1`. It was renamed together with the mod; exports written by the former **Map Overview** build (`north-map-overview-map-v1`) are **not** accepted by this viewer and must be re-exported.
- Within the same identifier the format is additive: a key the game reports nothing for is omitted, so newer exports remain readable by older viewers of the same format, and the viewer always refuses unknown identifiers rather than guessing.
- Rebranding changed the internal mod id to `network_atlas`, the export folder to `<userdata>/network_atlas_exports` and the export file to `network_atlas_export.lua`. Existing saves keep working; only the export path and format identifier changed.

## Project structure

```
NetworkAtlas/
├── mod.json                              # Mod metadata (id, dependencies)
├── _content.json                         # Files the game registers
├── _metadata/
│   └── modinfo.json                      # Workshop name, description, tags
├── content/
│   └── gui/
│       └── main/
│           ├── network_atlas.res.lua     # Registers the top-left mod button
│           └── network_atlas.script.tl   # Builds and writes the map export
├── index.html                            # Interactive 2D/3D web viewer
├── LICENSE
└── README.md
```

## License

Released under the [MIT License](LICENSE).
