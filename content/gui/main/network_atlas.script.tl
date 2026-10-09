local react = ug_require "::/gui/main/react.lua" as React
local builtin = ug_require "::/gui/main/builtin.lua" as Builtin
local main_mod_button_area = ug_require "::/gui/main/main_mod_button_area.tl" as MainModButtonArea

--- A Transport Fever 3 update (Oct 2026) made app.saveUserdata reject any
--- directory that is not one of its registered userdata namespaces, with
--- "The directory you trying to access is not available or invalid". The
--- engine only knows the namespaces towns_industries, heightmaps and
--- mod_presets. Try those plus a plain "userdata" name, first match wins; the
--- status line reports the folder that worked.
local exportCandidates = {
	{ directory = "userdata", fileName = "network_atlas_export" },
	{ directory = "heightmaps", fileName = "network_atlas_export" },
	{ directory = "mod_presets", fileName = "network_atlas_export" },
	{ directory = "towns_industries", fileName = "network_atlas_export" },
}

--- Upper bound of the exported origin/destination cargo flows. The largest
--- volumes are kept and the number of flows found is reported separately, so a
--- reader can tell a complete table from a capped one.
local exportFlowCap = 1000

--- Largest distance kept between a track segment and the shape sampled for it.
--- A bigger mismatch means the sampled geometry belongs to another edge, and
--- the segment is exported without its shape instead of with a wrong one.
local railGeometryTolerance = 25.0

--- Sampling of a computed route: one point every 20 metres, with at most
--- computedPathMaxStepsPerEdge steps per network edge. A long edge is covered
--- by fewer, wider steps - it is never sampled only in part.
local computedPathStep = 20.0
local computedPathMaxStepsPerEdge = 16

--- Length limit handed to the pathfinder for one stop pair: 5 times the
--- straight-line distance between the two stops, floored so a short pair still
--- has room to find its way around. A route that ends short of its stop pair
--- because of this limit is dropped, not shipped. Real routes detour far past
--- three times the crow flies - one-way loops, coast and highway detours - and
--- every edge of the result is chained and arrival-checked anyway, so the
--- limit only has to catch an absurd wander.
local computedPathLengthFactor = 5.0
local computedPathLengthFloor = 2500.0

--- Sampling budget of one stop pair. A normal leg keeps the 20 m step; only a
--- leg whose length limit already allows more points than this is sampled more
--- coarsely, so one long-distance pair cannot dominate the export.
local computedPathPointsPerLeg = 400

--- Provenance marker written next to a computed route, so a reader never has
--- to guess whether a route was read from the save or computed here.
local computedPathSource = "pathfinder"

--- First reason the computed route of the current line failed; written to the
--- game log beside the line id so a route missing from an export can be traced
--- to the check that dropped it, without reopening the export format.
local computedPathFail = ""

-- ---------------------------------------------------------------------------
-- Line export helpers
--
-- Everything written for a line is a plain string, number, boolean, array or
-- keyed table so app.saveUserdata can serialize it. Optional statistics are
-- read inside a narrow pcall: a value the engine does not provide for a line
-- stays nil and the field is omitted instead of failing the whole export, and
-- no missing value is ever replaced by a fabricated zero.
-- ---------------------------------------------------------------------------

--- Centre of an entity bounding box in world coordinates.
local record WorldPos
	x : number
	y : number
end

local record ExportStop
	--- 1-based position inside the line's ordered stop list
	index : integer
	--- display name of the station group the stop belongs to
	name : string
	--- world position of the station, nil when it could not be resolved
	x : number
	y : number
	--- terminal index inside the station, exactly as reported by the game
	terminal : integer
	--- entity the coordinates were read from (station, else station group)
	stationEntity : integer
end

local record ExportCapacity
	cargoTypeId : integer
	name : string
	used : number
	capacity : number
end

local record ExportIssue
	--- LineIssue.Type name, e.g. "NowhereToLoad"
	type : string
	stopIndex : integer
	cargoTypeId : integer
	cargoName : string
end

--- Values taken from the same calls the game uses for its line window, so the
--- exported numbers match what the game shows for that line.
local record ExportFinance
	--- line balance over the last game year, in game currency
	balanceLastYear : integer
	--- game time of the exported balance period
	balanceFromTime : integer
	balanceToTime : integer
	--- calendar year of the export time
	year : integer
	--- "itemsTransported" logbook value for the last year (items/passengers)
	itemsTransportedLastYear : integer
end

--- One vertex of an exported polyline, rounded like every other coordinate.
local record ExportPoint
	x : number
	y : number
end

--- One track segment of the shared street/track graph. The row uses the same
--- four coordinate fields as a roads row, so a viewer can stroke it with the
--- same code; `points` additionally carries the true shape of curved segments.
local record ExportRail
	x0 : number
	y0 : number
	x1 : number
	y1 : number
	--- RoadType name of the segment, "TRACK" for every row of this collection
	roadType : string
	--- road template resource name, e.g. "::/infrastructure/rail/main.street_template"
	roadTemplate : string
	--- BaseEdgeType name: "NORMAL", "BRIDGE" or "TUNNEL"
	edgeType : string
	--- segment length exactly as the game reports it
	distance : number
	--- sampled centreline in world coordinates, first point first; nil when the
	--- segment geometry could not be resolved or did not match the segment
	points : {ExportPoint}
end

--- Cargo an industry produces (outputs) or consumes (inputs).
local record ExportCargoAmount
	cargoTypeId : CargoTypeId
	name : string
	--- items per year the industry currently produces (outputs) or consumes (inputs)
	amount : integer
	--- the maximum the industry can produce (outputs) or consume (inputs) per year
	maxAmount : integer
end

--- One origin/destination cargo movement of the last game year.
local record ExportFlow
	--- origin entity id, always an industry of this snapshot
	from : Engine.Entity
	--- destination entity id, a town or an industry of this snapshot
	to : Engine.Entity
	fromName : string
	toName : string
	cargoTypeId : CargoTypeId
	cargoName : string
	--- items delivered in the last game year
	volume : integer
end

--- Land use capacity of one town district.
local record ExportLandUse
	--- "RESIDENTIAL", "COMMERCIAL" or "INDUSTRIAL"
	type : string
	--- building capacity currently occupied
	used : integer
	--- building capacity in total
	capacity : integer
end

--- Cargo waiting in a town.
local record ExportTownStock
	cargoTypeId : CargoTypeId
	name : string
	--- items currently in stock
	stock : integer
	--- stock capacity of the town
	capacity : integer
end

local record ExportTown
	name : string
	x : number
	y : number
	sizeFactors : {number}
	--- town entity id inside this snapshot; nil when no town entity matched
	entity : Engine.Entity
	--- population as the game's own town window reads it (residential capacity)
	population : integer
	landUse : {ExportLandUse}
	--- share of the town that the player's lines serve, from 0 to 1
	lineUsage : number
	stock : {ExportTownStock}
end

local record ExportIndustry
	x : number
	y : number
	angle : number
	onWater : boolean
	fileName : string
	tag : string
	--- industry entity id inside this snapshot; nil when no industry entity matched
	entity : Engine.Entity
	level : integer
	maxLevel : integer
	--- whether the industry is currently producing
	producing : boolean
	boostFromRule : boolean
	boostFromPersonCapacity : boolean
	productionRating : number
	inputs : {ExportCargoAmount}
	outputs : {ExportCargoAmount}
end

--- Optional economic snapshot: cargo flows between towns and industries.
local record ExportEcon
	--- calendar year the export was made in
	year : integer
	--- number of flows found before the cap was applied
	flowsTotal : integer
	--- the cap that was applied (exportFlowCap)
	flowCap : integer
	flows : {ExportFlow}
end

local record ExportLine
	id : integer
	name : string
	color : {number}
	modes : {string}
	stops : {ExportStop}
	--- Number of waypoints stored on this line's stops (the via points placed in
	--- the line manager). Written only when the line stores at least one, so a
	--- line carrying this field but no `path` stores waypoints that could not be
	--- resolved against the transport network.
	waypointCount : integer
	--- Ordered world points of this line's stop centres with its stored waypoints
	--- resolved against the transport network - the same stop/waypoint sequence
	--- the game's own line manager assembles. This is not the route the vehicles
	--- drive: the save stores no route on a line, only stops and waypoints.
	--- Omitted when no waypoint could be resolved, in which case the viewer can
	--- still fall back to the stop-to-stop segments.
	path : {ExportPoint}
	--- Route computed for this line at export time by the game's own pathfinder
	--- (api.engine.util.pathfinding.findPath) between consecutive stops, then
	--- replayed against the network geometry: stop centre, route to the next
	--- stop, that stop's centre, and so on. This is a computed route, not a
	--- saved one - see `computedPathSource`. Written only for a line the save
	--- gives no route for at all (no `path` and no `waypointCount`), so it can
	--- never contradict stored waypoints, and only when every stop pair routed
	--- completely: one failing pair omits the whole field rather than part of a
	--- route.
	computedPath : {ExportPoint}
	--- Provenance of `computedPath`, the string "pathfinder". Present exactly
	--- when `computedPath` is, so the two always travel together.
	computedPathSource : string
	capacity : {ExportCapacity}
	throughput : integer
	maxFrequency : number
	issues : {ExportIssue}
	finance : ExportFinance
end

local transportModeName = function(mode : TransportMode) : string
	if mode == api.type["enum"].TransportMode.PERSON then
		return "PERSON"
	end
	if mode == api.type["enum"].TransportMode.CARGO then
		return "CARGO"
	end
	if mode == api.type["enum"].TransportMode.CAR then
		return "CAR"
	end
	if mode == api.type["enum"].TransportMode.BUS then
		return "BUS"
	end
	if mode == api.type["enum"].TransportMode.TRUCK then
		return "TRUCK"
	end
	if mode == api.type["enum"].TransportMode.TRAM then
		return "TRAM"
	end
	if mode == api.type["enum"].TransportMode.ELECTRIC_TRAM then
		return "ELECTRIC_TRAM"
	end
	if mode == api.type["enum"].TransportMode.TRAIN then
		return "TRAIN"
	end
	if mode == api.type["enum"].TransportMode.ELECTRIC_TRAIN then
		return "ELECTRIC_TRAIN"
	end
	if mode == api.type["enum"].TransportMode.AIRCRAFT then
		return "AIRCRAFT"
	end
	if mode == api.type["enum"].TransportMode.SHIP then
		return "SHIP"
	end
	if mode == api.type["enum"].TransportMode.SMALL_AIRCRAFT then
		return "SMALL_AIRCRAFT"
	end
	if mode == api.type["enum"].TransportMode.SMALL_SHIP then
		return "SMALL_SHIP"
	end
	if mode == api.type["enum"].TransportMode.HELICOPTER then
		return "HELICOPTER"
	end
	if mode == api.type["enum"].TransportMode.TRAM_TRACK then
		return "TRAM_TRACK"
	end
	if mode == api.type["enum"].TransportMode.ELECTRIC_TRAM_TRACK then
		return "ELECTRIC_TRAM_TRACK"
	end
	return tostring(mode)
end

local lineIssueTypeName = function(issueType : LineIssue.Type) : string
	if issueType == api.type.LineIssue.Type.NowhereToLoad then
		return "NowhereToLoad"
	end
	if issueType == api.type.LineIssue.Type.NowhereToUnload then
		return "NowhereToUnload"
	end
	if issueType == api.type.LineIssue.Type.NoVehicleToLoadCargo then
		return "NoVehicleToLoadCargo"
	end
	if issueType == api.type.LineIssue.Type.VehicleUseless then
		return "VehicleUseless"
	end
	if issueType == api.type.LineIssue.Type.LineCargoConfig then
		return "LineCargoConfig"
	end
	if issueType == api.type.LineIssue.Type.None then
		return "None"
	end
	return tostring(issueType)
end

local cargoTypeName = function(cargoTypeId : CargoTypeId) : string
	local found : string = nil
	pcall(function()
		found = api.res.cargoTypeRep.getName(cargoTypeId)
	end)
	return found
end

--- World coordinate at the precision the exported file writes numbers with.
local roundCoord = function(value : number) : number
	if value ~= value then
		return value
	end
	if value >= 0 then
		return math.floor(value * 100 + 0.5) / 100
	end
	return math.ceil(value * 100 - 0.5) / 100
end

local pointDistance = function(ax : number, ay : number, bx : number, by : number) : number
	local dx = ax - bx
	local dy = ay - by
	return math.sqrt(dx * dx + dy * dy)
end

--- Append a world point to a polyline. Points that round to the same
--- coordinates as their predecessor are dropped instead of written twice.
local addPoint = function(points : {ExportPoint}, x : number, y : number)
	local pointX = roundCoord(x)
	local pointY = roundCoord(y)
	local previous = points[#points]
	if previous ~= nil and previous.x == pointX and previous.y == pointY then
		return
	end
	local point : ExportPoint = {
		x = pointX,
		y = pointY,
	}
	table.insert(points, point)
end

local roadTypeName = function(roadType : RoadType) : string
	if roadType == api.type["enum"].RoadType.STREET then
		return "STREET"
	end
	if roadType == api.type["enum"].RoadType.TRACK then
		return "TRACK"
	end
	return tostring(roadType)
end

local edgeTypeName = function(edgeType : BaseEdgeType) : string
	if edgeType == api.type["enum"].BaseEdgeType.NORMAL then
		return "NORMAL"
	end
	if edgeType == api.type["enum"].BaseEdgeType.BRIDGE then
		return "BRIDGE"
	end
	if edgeType == api.type["enum"].BaseEdgeType.TUNNEL then
		return "TUNNEL"
	end
	return tostring(edgeType)
end

local landUseTypeName = function(landUseType : LandUseType) : string
	if landUseType == api.type["enum"].LandUseType.RESIDENTIAL then
		return "RESIDENTIAL"
	end
	if landUseType == api.type["enum"].LandUseType.COMMERCIAL then
		return "COMMERCIAL"
	end
	if landUseType == api.type["enum"].LandUseType.INDUSTRIAL then
		return "INDUSTRIAL"
	end
	return tostring(landUseType)
end

--- Display name of an entity; nil when the game has none.
local entityName = function(entity : Engine.Entity) : string
	local found : string = nil
	pcall(function()
		found = api.engine.util.getEntityName(entity)
	end)
	return found
end

--- Volume moved between an origin and a destination in the last game year,
--- read with the same argument order the game's own cargo flow helper uses
--- (gui/main/cargo_util.tl): the log behind a town destination is read from the
--- town, every other log from the origin.
local flowVolume = function(origin : Engine.Entity, destination : Engine.Entity, cargoTypeId : CargoTypeId, destinationIsTown : boolean) : integer
	local volume : integer = nil
	pcall(function()
		if destinationIsTown then
			volume = api.engine.util.stock.getCargoLogPerYearForTarget(destination, origin, "itemsTransported", cargoTypeId)
		else
			volume = api.engine.util.stock.getCargoLogPerYearForTarget(origin, destination, "itemsTransported", cargoTypeId)
		end
	end)
	return volume
end

--- Bounding box centre of an entity; nil when the entity has no bounding volume.
local entityWorldCenter = function(entity : Engine.Entity) : WorldPos
	local volume : Engine.Component.BoundingVolume = nil
	pcall(function()
		volume = api.engine.getComponent(entity, api.type.ComponentType.BOUNDING_VOLUME) as Engine.Component.BoundingVolume
	end)
	if volume == nil then
		return nil
	end
	local box = volume.bbox
	local pos : WorldPos = {
		x = (box.min.x + box.max.x) * 0.5,
		y = (box.min.y + box.max.y) * 0.5,
	}
	return pos
end

--- Entity of `candidates` closest to a map position; nil when there is none.
--- Used when the game map does not carry the entity itself, so a statistic is
--- still read from a matching entity instead of being written for nobody.
local nearestEntity = function(pos : WorldPos, candidates : {Engine.Entity}) : Engine.Entity
	local closest : Engine.Entity = nil
	local closestDistance = math.huge
	for _, entity in ipairs(candidates) do
		local centre = entityWorldCenter(entity)
		if centre then
			local distance = pointDistance(centre.x, centre.y, pos.x, pos.y)
			if distance < closestDistance then
				closest = entity
				closestDistance = distance
			end
		end
	end
	return closest
end

--- The station entity a line stop serves: the station the stop points at
--- inside its station group, or the station group itself when the game names
--- no station for that index. Everything read for a stop is read from this
--- entity, so the stop's coordinates and its terminal always agree.
local stopStationEntity = function(stop : Engine.Component.Line.Stop) : Engine.Entity
	local group : Engine.Component.StationGroup = nil
	pcall(function()
		group = api.engine.getComponent(stop.stationGroup, api.type.ComponentType.STATION_GROUP) as Engine.Component.StationGroup
	end)
	local stations : {Engine.Entity} = nil
	if group then
		stations = group.stations
	end
	if stations == nil then
		return stop.stationGroup
	end
	local stationEntity = stations[stop.station + 1]
	if stationEntity == nil then
		return stop.stationGroup
	end
	return stationEntity
end

local buildStop = function(stopIndex : integer, stop : Engine.Component.Line.Stop) : ExportStop
	local entry : ExportStop = {
		index = stopIndex,
		terminal = stop.terminal,
	}

	local stationName : string = nil
	pcall(function()
		stationName = api.engine.util.getEntityName(stop.stationGroup)
	end)
	if stationName then
		entry.name = stationName
	end

	local target : Engine.Entity = stopStationEntity(stop)
	entry.stationEntity = target

	local pos : WorldPos = entityWorldCenter(target)
	if pos == nil then
		pos = entityWorldCenter(stop.stationGroup)
	end
	if pos then
		entry.x = pos.x
		entry.y = pos.y
	end

	return entry
end

--- One network edge by its id; nil when the game has no transport network for
--- the entity or no geometry at that index. The same read the waypoint
--- resolution makes, so a stored waypoint and a computed route are resolved
--- against exactly the same edges.
local networkEdge = function(edgeId : EdgeId) : Edge
	local edge : Edge = nil
	pcall(function()
		local network = api.engine.getComponent(edgeId.entity, api.type.ComponentType.TRANSPORT_NETWORK) as Engine.Component.TransportNetwork
		edge = network.edges[edgeId.index + 1]
	end)
	return edge
end

--- Resolve one line waypoint into path points.
---
--- A waypoint that carries a position contributes that position; a waypoint
--- that sits on an edge is read from that edge's geometry, and consecutive
--- waypoints of one edge are sampled along the edge so curves follow the track
--- instead of being joined by a chord. Returns whether a point was written and
--- the edge the waypoint sits on, so the next waypoint can compare against it.
--- Nothing is interpolated across edges the waypoint list does not mention.
local addWaypoint = function(points : {ExportPoint}, waypoint : Waypoint, fromEntity : Engine.Entity, fromIndex : integer, fromParam : number) : boolean, Engine.Entity, integer, number
	local edgePos : EdgePos = waypoint.edgePos
	if edgePos == nil then
		local pos : Vec3f = waypoint.pos
		if pos == nil then
			return false, nil, -1, 0.0
		end
		addPoint(points, pos[1], pos[2])
		return true, nil, -1, 0.0
	end

	local entity : Engine.Entity = edgePos.edgeId.entity
	local index : integer = edgePos.edgeId.index
	local param : number = edgePos.param

	local geometry : EdgeGeometry = nil
	local length : number = nil
	local edge = networkEdge(edgePos.edgeId)
	if edge and edge.geometry then
		geometry = edge.geometry
		length = edge.geometry.length
	end
	if geometry == nil then
		return false, nil, -1, 0.0
	end

	local samples : {number} = {}
	if fromEntity ~= nil and fromEntity == entity and fromIndex == index then
		-- Same edge as the previous waypoint: follow the edge between the two
		-- parameters instead of joining them with a chord. One sample every 20
		-- metres, at most 16 steps, so a waypoint run cannot grow unbounded.
		local steps = 1
		if length ~= nil and length > 0 then
			steps = math.ceil(length * math.abs(param - fromParam) / 20)
			if steps > 16 then
				steps = 16
			end
			if steps < 1 then
				steps = 1
			end
		end
		for i = 1, steps do
			samples[#samples + 1] = fromParam + (param - fromParam) * (i / steps)
		end
	else
		samples[1] = param
	end

	local added = false
	for _, sample in ipairs(samples) do
		local pos : Vec3f = nil
		local resolved = pcall(function()
			pos = api.engine.util.transport.calcPosition(geometry, sample)
		end)
		if resolved and pos ~= nil then
			addPoint(points, pos[1], pos[2])
			added = true
		end
	end
	if not added then
		return false, nil, -1, 0.0
	end
	return true, entity, index, param
end

--- Whether two transport network nodes are the same node.
local sameNode = function(a : NodeId, b : NodeId) : boolean
	if a == nil or b == nil then
		return false
	end
	return a.entity == b.entity and a.index == b.index
end

--- Whether a node is one of a list of nodes.
local nodeInList = function(node : NodeId, candidates : {NodeId}) : boolean
	for _, candidate in ipairs(candidates) do
		if sameNode(node, candidate) then
			return true
		end
	end
	return false
end

--- The end (1 or 2) at which a route hops from one network into another
--- through a shared station, depot or port: both edges touch the same
--- foreign node network but share no node of their own, because the
--- vehicle is handed through the building rather than over an edge. The
--- hop only exists between nodes of a network neither edge belongs to, so
--- a gap inside the vehicle's own road network stays a broken chain.
--- Returns nil when the two edges do not connect at all.
local hopEntry = function(fromNode : NodeId, conns : {NodeId}, fromEdge : EdgeId, toEdge : EdgeId) : integer
	if fromNode == nil or conns == nil or fromEdge == nil or toEdge == nil then
		return nil
	end
	local network = fromNode.entity
	if network == fromEdge.entity or network == toEdge.entity then
		return nil
	end
	if conns[1] ~= nil and conns[1].entity == network then
		return 1
	end
	if conns[2] ~= nil and conns[2].entity == network then
		return 2
	end
	return nil
end

--- A node as a compact diagnostic tag: entity:index.
local nodeTag = function(node : NodeId) : string
	if node == nil then
		return "nil"
	end
	return tostring(node.entity) .. ":" .. tostring(node.index)
end

--- An edge id as a compact diagnostic tag: entity:index.
local edgeTag = function(edgeId : EdgeId) : string
	if edgeId == nil then
		return "nil"
	end
	return tostring(edgeId.entity) .. ":" .. tostring(edgeId.index)
end

--- All end nodes of an edge as a compact diagnostic tag.
local connsTag = function(conns : {NodeId}) : string
	local parts : {string} = {}
	for i, n in ipairs(conns) do
		parts[i] = nodeTag(n)
	end
	return "{" .. table.concat(parts, ",") .. "}"
end

--- The terminals of one line stop: the terminal the stop is configured with
--- first, followed by the alternatives the game may switch that stop to
--- (Engine.Component.Line.Stop.alternativeTerminals, engine.d.tl). Every
--- terminal is read from the stop's own station, so the route a stop takes and
--- the position the stop is exported with come from the same entity. An empty
--- list means the game gives this stop no terminal at all.
local stopTerminals = function(stop : Engine.Component.Line.Stop) : {Terminal}
	local terminals : {Terminal} = {}
	local collect = function(stationEntity : Engine.Entity, terminalIndex : integer)
		local station : Engine.Component.Station = nil
		pcall(function()
			station = api.engine.getComponent(stationEntity, api.type.ComponentType.STATION) as Engine.Component.Station
		end)
		if station == nil or station.terminals == nil then
			return
		end
		local terminal = station.terminals[terminalIndex + 1]
		if terminal then
			table.insert(terminals, terminal)
		end
	end

	collect(stopStationEntity(stop), stop.terminal)

	local group : Engine.Component.StationGroup = nil
	pcall(function()
		group = api.engine.getComponent(stop.stationGroup, api.type.ComponentType.STATION_GROUP) as Engine.Component.StationGroup
	end)
	if group and group.stations and stop.alternativeTerminals then
		for _, alternative in ipairs(stop.alternativeTerminals) do
			local stationEntity = group.stations[alternative.station + 1]
			if stationEntity then
				collect(stationEntity, alternative.terminal)
			end
		end
	end
	return terminals
end

--- One stop pair of a computed route: the game's own pathfinder result, read
--- back against the network geometry it was found on.
---
--- The route is accepted only when it verifies end to end. It must start on an
--- edge of the departure terminal, every consecutive pair of edges must share
--- a node, and it must end within one edge of an arrival node - the check that
--- catches a route cut short by the pathfinder's length limit. An empty
--- result, an unresolvable terminal, an unreachable stop pair or a result that
--- does not verify all make the leg fail, and the caller drops the whole line
--- rather than shipping part of a route. Nothing is drawn from a route that
--- could not be checked.
---
--- The returned points are the route only; the caller puts the stop centres
--- around them.
local computeLeg = function(fromStop : ExportStop, toStop : ExportStop, fromLineStop : Engine.Component.Line.Stop, toLineStop : Engine.Component.Line.Stop, modeSet : {TransportMode}) : {ExportPoint}
	if fromStop.x == nil or fromStop.y == nil or toStop.x == nil or toStop.y == nil then
		computedPathFail = "stopPosPair"
		return nil
	end
	local straight = pointDistance(fromStop.x, fromStop.y, toStop.x, toStop.y)
	local maxLength = math.max(math.floor(straight * computedPathLengthFactor), computedPathLengthFloor)
	-- 20 metres is the resolution of an ordinary leg. A leg whose length limit
	-- alone would allow more points than the budget is sampled more coarsely;
	-- the route is still walked from its first edge to its last, only with
	-- wider steps.
	local step = math.max(computedPathStep, math.ceil(maxLength / computedPathPointsPerLeg))

	local fromTerminals = stopTerminals(fromLineStop)
	local toTerminals = stopTerminals(toLineStop)
	if #fromTerminals == 0 or #toTerminals == 0 then
		computedPathFail = "noTerminals " .. tostring(#fromTerminals) .. "/" .. tostring(#toTerminals)
		return nil
	end

	-- Every node the departing vehicle can stand on: the stop node of each
	-- terminal of this stop plus the end nodes of any standing edge a terminal
	-- carries. Terminals differ per mode - a road stop often carries no standing
	-- edge at all - so both seed lists are built and either may drive the route.
	local startNodes : {NodeId} = {}
	local starts : {UtilPathfinding.EdgeIdDirAndLength} = {}
	for _, terminal in ipairs(fromTerminals) do
		if terminal.vehicleNodeId then
			table.insert(startNodes, terminal.vehicleNodeId)
		end
		local departureEdges = terminal.vehicleEdges
		if departureEdges then
			for _, edgePos in ipairs(departureEdges) do
				local edge = networkEdge(edgePos.edgeId)
				if edge and edge.conns and #edge.conns >= 1 then
					for _, conn in ipairs(edge.conns) do
						table.insert(startNodes, conn)
					end
				end
				-- An edge the network will not stand on - a station stub, say -
				-- seeds the stop nodes above but cannot seed a pathfinding start
				-- state, which needs both of its end nodes.
				if edge and edge.conns and #edge.conns >= 2 then
					local edgeLength = 0.0
					if edge.geometry and edge.geometry.length then
						edgeLength = edge.geometry.length
					end
					starts[#starts + 1] = { edgeId = edgePos.edgeId, dir = true, length = edgePos.param * edgeLength }
					starts[#starts + 1] = { edgeId = edgePos.edgeId, dir = false, length = (1.0 - edgePos.param) * edgeLength }
				end
			end
		end
	end
	if #startNodes == 0 then
		computedPathFail = "noStartNodes"
		return nil
	end

	-- The node the vehicles stop at, plus the stop's alternative terminals, so
	-- a stop the game may switch terminal on still has an arrival node.
	local destinations : {NodeId} = {}
	for _, terminal in ipairs(toTerminals) do
		if terminal.vehicleNodeId then
			table.insert(destinations, terminal.vehicleNodeId)
		end
	end
	if #destinations == 0 then
		computedPathFail = "noDestinations"
		return nil
	end

	-- First choice: the edge-based pathfinder started from the standing edges
	-- inside the length limit. Second choice: the node-based pathfinder from
	-- stop node to stop node, which needs no standing edge on either side. When
	-- both fail their two reasons are reported together, so one log line names
	-- the whole gap instead of only the last attempt.
	local result : {{EdgeId, boolean}} = nil
	local pathSrc = "edge"
	local edgeFail : string = ""
	if #starts > 0 then
		local called, callErr = pcall(function()
			result = api.engine.util.pathfinding.findPath(starts, destinations, modeSet, maxLength)
		end)
		if not called or result == nil or #result == 0 then
			edgeFail = called and ("edgeEmpty starts=" .. tostring(#starts)) or ("edgeError " .. tostring(callErr))
			result = nil
		end
	end
	if result == nil or #result == 0 then
		local nodeCalled, nodeErr = pcall(function()
			result = api.engine.util.pathfinding.findPathNodeToNode(startNodes, destinations, modeSet)
		end)
		if not nodeCalled or result == nil or #result == 0 then
			local nodeFail = nodeCalled and ("nodeEmpty nodes=" .. tostring(#startNodes)) or ("nodeError " .. tostring(nodeErr))
			if edgeFail ~= "" then
				computedPathFail = edgeFail .. " + " .. nodeFail
			else
				computedPathFail = nodeFail
			end
			return nil
		end
		pathSrc = "node"
	end

	-- Read the geometry of every edge the pathfinder came back with. An edge
	-- without geometry or without its two end nodes cannot be walked or
	-- checked, so the leg fails instead of being drawn from the edges that did
	-- resolve.
	local geometries : {EdgeGeometry} = {}
	local connsOf : {{NodeId}} = {}
	for index, legEdge in ipairs(result) do
		local edge = networkEdge(legEdge[1])
		if edge == nil or edge.geometry == nil or edge.conns == nil or #edge.conns < 2 then
			computedPathFail = "routeEdge " .. tostring(index)
			return nil
		end
		geometries[index] = edge.geometry
		connsOf[index] = edge.conns
	end

	-- Which end of each edge the route leaves from. The nodes themselves
	-- decide: an edge after the first one has to start where the previous one
	-- ended, and a chain that does not connect is rejected instead of being
	-- drawn as a jump. The one gap that is not a break is a transfer through
	-- a station, depot or port: two edges touching the same foreign network
	-- are joined inside the building (see hopEntry), while a gap inside the
	-- vehicle's own network stays a broken chain. The direction flag the
	-- pathfinder reports is only the fallback for a route of a single edge,
	-- where there is no chain to follow.
	local reversed : {boolean} = {}
	local node : NodeId = nil
	local prevEdgeId : EdgeId = nil
	for index, legEdge in ipairs(result) do
		local conns = connsOf[index]
		if index == 1 then
			if #result == 1 then
				reversed[1] = not nodeInList(conns[1], startNodes)
			else
				local nextConns = connsOf[2]
				local e1 = legEdge[1]
				local e2 = result[2][1]
				-- The first edge leaves at conns[2] when run forward and at
				-- conns[1] when reversed. Exact node matches decide; a station
				-- hop decides only for an end the pathfinder could have started
				-- from, and falls back to the plain hop when neither end does.
				local hopForward = hopEntry(conns[2], nextConns, e1, e2) ~= nil
				local hopReverse = hopEntry(conns[1], nextConns, e1, e2) ~= nil
				if sameNode(conns[2], nextConns[1]) or sameNode(conns[2], nextConns[2]) then
					reversed[1] = false
				elseif sameNode(conns[1], nextConns[1]) or sameNode(conns[1], nextConns[2]) then
					reversed[1] = true
				elseif hopForward and nodeInList(conns[1], startNodes) then
					reversed[1] = false
				elseif hopReverse and nodeInList(conns[2], startNodes) then
					reversed[1] = true
				elseif hopForward then
					reversed[1] = false
				elseif hopReverse then
					reversed[1] = true
				else
					computedPathFail = "chainFirst e1=" .. edgeTag(e1) .. " conns=" .. connsTag(conns) .. " e2=" .. edgeTag(e2) .. " conns=" .. connsTag(nextConns) .. " src=" .. pathSrc
					return nil
				end
			end
			node = reversed[1] and conns[1] or conns[2]
		else
			if sameNode(node, conns[1]) then
				reversed[index] = false
			elseif sameNode(node, conns[2]) then
				reversed[index] = true
			else
				local entry = hopEntry(node, conns, prevEdgeId, legEdge[1])
				if entry == nil then
					computedPathFail = "chainWalk i=" .. tostring(index) .. " head=" .. nodeTag(node) .. " e=" .. edgeTag(legEdge[1]) .. " conns=" .. connsTag(conns) .. " src=" .. pathSrc
					return nil
				end
				-- An entry at conns[1] runs the edge forward, at conns[2] reversed.
				reversed[index] = entry ~= 1
			end
			node = reversed[index] and conns[1] or conns[2]
		end
		prevEdgeId = legEdge[1]
	end

	local firstConns = connsOf[1]
	if not nodeInList(reversed[1] and firstConns[2] or firstConns[1], startNodes) then
		computedPathFail = "startNode"
		return nil
	end
	local lastConns = connsOf[#connsOf]
	if not nodeInList(reversed[#reversed] and lastConns[1] or lastConns[2], destinations) then
		-- The route stopped short of the stop pair it was asked for: a length
		-- limit hit, not a route. Truncated routes are never exported.
		computedPathFail = "truncated " .. tostring(#result) .. " edges"
		return nil
	end

	-- Sample the route: one point every `step` metres along each edge, at most
	-- computedPathMaxStepsPerEdge steps, from the edge's first point to its
	-- last whichever way the route runs, dropping points that round onto their
	-- predecessor so shared edge corners are written once.
	local points : {ExportPoint} = {}
	local routeLength = 0.0
	for index, legEdge in ipairs(result) do
		local geometry = geometries[index]
		local edgeLength = 0.0
		if geometry.length then
			edgeLength = geometry.length
		end
		local steps = 1
		if edgeLength > 0 then
			steps = math.ceil(edgeLength / step)
			if steps > computedPathMaxStepsPerEdge then
				steps = computedPathMaxStepsPerEdge
			end
		end
		for sample = 0, steps do
			local param = sample / steps
			if reversed[index] then
				param = 1.0 - param
			end
			local pos : Vec3f = nil
			local resolved = pcall(function()
				pos = api.engine.util.transport.calcPosition(geometry, param)
			end)
			if not resolved or pos == nil then
				computedPathFail = "calcPos"
				return nil
			end
			local before = #points
			addPoint(points, pos[1], pos[2])
			if #points > before then
				local previous = points[#points - 1]
				if previous then
					local current = points[#points]
					routeLength = routeLength + pointDistance(previous.x, previous.y, current.x, current.y)
				end
			end
		end
	end

	if #points < 2 then
		computedPathFail = "tooFewRoutePts"
		return nil
	end
	-- A route that cannot even reach as far as the stop pair it connects, or
	-- one that is longer than the limit it was given, is not a verified route.
	if routeLength * 2.0 < straight then
		computedPathFail = "shortRoute " .. tostring(math.floor(routeLength)) .. "x2<" .. tostring(math.floor(straight)) .. " src=" .. pathSrc
		return nil
	end
	if routeLength > maxLength * 1.05 + 1.0 then
		computedPathFail = "overLimit " .. tostring(math.floor(routeLength)) .. ">" .. tostring(math.floor(maxLength)) .. " src=" .. pathSrc
		return nil
	end
	return points
end

--- The computed route of a whole line: every stop centre in order with the
--- route of each stop pair in between, so the polyline touches its stops the
--- same way a stored `path` does.
---
--- Written only for a line the save gives no route for at all, and only when
--- every stop pair routed - one failing pair leaves the line without a route
--- instead of with a piece of one. A line the game cannot route (no modes, no
--- terminal, a stop without a position) is left out entirely.
local buildComputedPath = function(stopRows : {ExportStop}, lineStops : {Engine.Component.Line.Stop}, modes : {TransportMode : boolean}) : {ExportPoint}
	computedPathFail = ""
	if modes == nil or #stopRows < 2 or #lineStops < #stopRows then
		computedPathFail = "shape"
		return nil
	end
	local modeSet : {TransportMode} = {}
	for mode, enabled in pairs(modes) do
		if enabled then
			table.insert(modeSet, mode)
		end
	end
	if #modeSet == 0 then
		computedPathFail = "noModes"
		return nil
	end

	local points : {ExportPoint} = {}
	for index, stopRow in ipairs(stopRows) do
		if stopRow.x == nil or stopRow.y == nil then
			computedPathFail = "stopPos"
			return nil
		end
		addPoint(points, stopRow.x, stopRow.y)
		if index < #stopRows then
			local legPoints = computeLeg(stopRow, stopRows[index + 1], lineStops[index], lineStops[index + 1], modeSet)
			if legPoints == nil then
				if computedPathFail == "" then computedPathFail = "legFailed" end
				return nil
			end
			for _, point in ipairs(legPoints) do
				addPoint(points, point.x, point.y)
			end
		end
	end
	if #points < 2 then
		computedPathFail = "tooFewPts"
		return nil
	end
	return points
end

--- Finance values for one line, or nil when the engine reports none of them.
local buildFinance = function(lineEntity : Engine.Entity) : ExportFinance
	local gameTime : Engine.Component.GameTime = nil
	pcall(function()
		gameTime = api.engine.getComponent(api.engine.util.getWorld(), api.type.ComponentType.GAME_TIME) as Engine.Component.GameTime
	end)
	if gameTime == nil then
		return nil
	end

	local toTime = gameTime.gameTime
	local fromTime = math.max(toTime - api.util.getDefaultYearDuration(), 0)

	local balance : integer = nil
	pcall(function()
		balance = api.engine.util.finance.calculateBalance({ lineEntity }, fromTime, toTime, true)
	end)

	local transported : integer = nil
	pcall(function()
		transported = api.engine.util.logbook.getLogValuePerYear(lineEntity, "itemsTransported")
	end)

	if balance == nil and transported == nil then
		return nil
	end

	local finance : ExportFinance = {
		balanceFromTime = fromTime,
		balanceToTime = toTime,
	}
	if balance then
		finance.balanceLastYear = balance
	end
	if transported then
		finance.itemsTransportedLastYear = transported
	end
	local year : integer = nil
	pcall(function()
		year = api.engine.util.getYear()
	end)
	if year then
		finance.year = year
	end

	return finance
end

local buildLine = function(lineEntity : Engine.Entity) : ExportLine
	local row : ExportLine = {
		id = lineEntity,
	}

	local name : string = nil
	pcall(function()
		name = api.engine.util.getEntityName(lineEntity)
	end)
	if name then
		row.name = name
	end

	local color : Engine.Component.Color = nil
	pcall(function()
		color = api.engine.getComponent(lineEntity, api.type.ComponentType.COLOR) as Engine.Component.Color
	end)
	if color then
		row.color = { color.color.x, color.color.y, color.color.z }
	end

	local modes : {TransportMode : boolean} = nil
	pcall(function()
		modes = api.engine.util.line.getLineTransportModesUnion(lineEntity)
	end)
	if modes then
		local modeNames : {string} = {}
		for mode, enabled in pairs(modes) do
			if enabled then
				table.insert(modeNames, transportModeName(mode))
			end
		end
		table.sort(modeNames)
		row.modes = modeNames
	end

	local lineComponent : Engine.Component.Line = nil
	pcall(function()
		lineComponent = api.engine.getComponent(lineEntity, api.type.ComponentType.LINE) as Engine.Component.Line
	end)
	if lineComponent then
		local stops = lineComponent.stops
		if stops then
			local stopRows : {ExportStop} = {}
			local lineStops : {Engine.Component.Line.Stop} = {}
			local pathPoints : {ExportPoint} = {}
			local storedWaypoints = 0
			local resolvedWaypoints = 0
			local fromEntity : Engine.Entity = nil
			local fromIndex = -1
			local fromParam = 0.0
			for stopIndex, stop in ipairs(stops) do
				local stopRow : ExportStop = buildStop(stopIndex, stop)
				table.insert(stopRows, stopRow)
				table.insert(lineStops, stop)
				if stopRow.x and stopRow.y then
					addPoint(pathPoints, stopRow.x, stopRow.y)
				end
				local waypoints = stop.waypoints
				if waypoints then
					storedWaypoints = storedWaypoints + #waypoints
					for _, waypoint in ipairs(waypoints) do
						local added = false
						local resolved = pcall(function()
							added, fromEntity, fromIndex, fromParam = addWaypoint(pathPoints, waypoint, fromEntity, fromIndex, fromParam)
						end)
						if resolved and added then
							resolvedWaypoints = resolvedWaypoints + 1
						end
					end
				end
			end
			row.stops = stopRows
			if storedWaypoints > 0 then
				row.waypointCount = storedWaypoints
			end
			-- Stop centres on their own only repeat what `stops` already carries,
			-- so a path is written only when a waypoint contributed real shape.
			if resolvedWaypoints > 0 and #pathPoints > 1 then
				row.path = pathPoints
			end
			-- A route is computed only for a line the save gives no route for at
			-- all: stored waypoints win over it, and a stored waypoint that could
			-- not be resolved stays visible instead of being papered over by a
			-- computed one. Every read inside is guarded, so a failure anywhere
			-- leaves both computed fields out and the rest of the line untouched.
			if row.path == nil and row.waypointCount == nil and #stopRows >= 2 then
				local computed : {ExportPoint} = nil
				local computedOk, computedErr = pcall(function()
					computed = buildComputedPath(stopRows, lineStops, modes)
				end)
				if computedOk and computed then
					row.computedPath = computed
					row.computedPathSource = computedPathSource
					print("[network_atlas] computedPath ok line " .. tostring(row.id) .. ": " .. tostring(#computed) .. " pts")
				else
					local reason : string = "unreported"
					if not computedOk then
						reason = "error " .. tostring(computedErr)
					elseif computedPathFail ~= "" then
						reason = computedPathFail
					end
					print("[network_atlas] computedPath FAIL line " .. tostring(row.id) .. ": " .. reason)
				end
			end
		end
	end

	local capacities : {CargoTypeId : UtilLine.LineCapacityUsage} = nil
	pcall(function()
		capacities = api.engine.util.line.getLineCapacityUsages(lineEntity, false)
	end)
	if capacities then
		local cargoTypeIds : {CargoTypeId} = {}
		for cargoTypeId in pairs(capacities) do
			table.insert(cargoTypeIds, cargoTypeId)
		end
		table.sort(cargoTypeIds)
		local capacityRows : {ExportCapacity} = {}
		for _, cargoTypeId in ipairs(cargoTypeIds) do
			local usage = capacities[cargoTypeId]
			if usage then
				local entry : ExportCapacity = {
					cargoTypeId = cargoTypeId,
					used = usage.used,
					capacity = usage.capacity,
				}
				local cargoName : string = cargoTypeName(cargoTypeId)
				if cargoName then
					entry.name = cargoName
				end
				table.insert(capacityRows, entry)
			end
		end
		row.capacity = capacityRows
	end

	local throughput : integer = nil
	pcall(function()
		throughput = api.engine.util.line.calcLineStationThroughput(lineEntity)
	end)
	if throughput then
		row.throughput = throughput
	end

	local frequency : number = nil
	pcall(function()
		frequency = api.engine.util.line.getMaxFrequency(lineEntity)
	end)
	if frequency then
		row.maxFrequency = frequency
	end

	local issues : {LineIssue} = nil
	local issuesRead = pcall(function()
		issues = api.engine.util.line.getLineIssues(lineEntity, false)
	end)
	if issuesRead and issues then
		local issueRows : {ExportIssue} = {}
		for _, issue in ipairs(issues) do
			local entry : ExportIssue = {
				type = lineIssueTypeName(issue.type),
				stopIndex = issue.stopIndex,
			}
			local cargoTypeId = issue.cargoType
			if cargoTypeId then
				entry.cargoTypeId = cargoTypeId
				local cargoName : string = cargoTypeName(cargoTypeId)
				if cargoName then
					entry.cargoName = cargoName
				end
			end
			table.insert(issueRows, entry)
		end
		row.issues = issueRows
	end

	row.finance = buildFinance(lineEntity)

	return row
end

--- All lines of the current player, sorted by entity id for stable output.
local collectLines = function() : {ExportLine}
	local lines : {ExportLine} = {}

	local playerEntity : Engine.Entity = nil
	pcall(function()
		playerEntity = api.engine.util.getPlayer()
	end)
	if playerEntity == nil then
		return lines
	end

	local lineEntities : {Engine.Entity} = {}
	pcall(function()
		lineEntities = api.engine.system.lineSystem.getLinesForPlayer(playerEntity)
	end)
	if lineEntities == nil then
		return lines
	end

	for _, lineEntity in ipairs(lineEntities) do
		local row : ExportLine = nil
		local built = pcall(function()
			row = buildLine(lineEntity)
		end)
		if built and row ~= nil then
			table.insert(lines, row)
		end
	end

	table.sort(lines, function(a : ExportLine, b : ExportLine) : boolean
		return a.id < b.id
	end)
	return lines
end

-- ---------------------------------------------------------------------------
-- Railway, town, industry and economy export helpers
--
-- Each value is read inside a narrow pcall like the blocks above: a statistic
-- the engine does not provide stays nil and its field is omitted, and no
-- missing value is ever replaced by a fabricated zero or point.
-- ---------------------------------------------------------------------------

--- Sampled centreline of one track segment, or nil when it cannot be trusted.
local buildRailPoints = function(entity : Engine.Entity, edge : Engine.Component.BaseEdge) : {ExportPoint}
	local network : Engine.Component.TransportNetwork = nil
	local read = pcall(function()
		network = api.engine.getComponent(entity, api.type.ComponentType.TRANSPORT_NETWORK) as Engine.Component.TransportNetwork
	end)
	if not read or network == nil then
		return nil
	end
	local networkEdges = network.edges
	if networkEdges == nil or networkEdges[1] == nil or networkEdges[1].geometry == nil then
		return nil
	end
	local geometry = networkEdges[1].geometry

	local length : number = nil
	pcall(function()
		length = geometry.length
	end)
	-- One sample every 20 metres, at most 16 steps for a whole segment. The
	-- bound keeps a rail row at well under 1.5 kB, so the rail collection can
	-- never grow past a few percent of the export no matter how long a segment
	-- is; the steps are spread over the whole segment, never truncated.
	local steps = 8
	if length ~= nil and length > 0 then
		steps = math.ceil(length / 20)
	end
	if steps > 16 then
		steps = 16
	end
	if steps < 2 then
		steps = 2
	end

	local sampled : {ExportPoint} = {}
	local sampledOk = pcall(function()
		for i = 0, steps do
			local pos : Vec3f = api.engine.util.transport.calcPosition(geometry, i / steps)
			addPoint(sampled, pos[1], pos[2])
		end
	end)
	if not sampledOk or #sampled < 2 then
		return nil
	end

	-- The sampled shape has to begin and end where the segment does; a shape
	-- that ends far away belongs to another edge and is not written.
	local first = sampled[1]
	local last = sampled[#sampled]
	local forward = pointDistance(first.x, first.y, edge.position0[1], edge.position0[2])
		+ pointDistance(last.x, last.y, edge.position1[1], edge.position1[2])
	local backward = pointDistance(first.x, first.y, edge.position1[1], edge.position1[2])
		+ pointDistance(last.x, last.y, edge.position0[1], edge.position0[2])
	if backward < forward then
		forward = backward
		local reversed : {ExportPoint} = {}
		for i = #sampled, 1, -1 do
			table.insert(reversed, sampled[i])
		end
		sampled = reversed
	end
	if forward > railGeometryTolerance then
		return nil
	end
	return sampled
end

--- One track segment row, or nil when the entity carries no base edge.
local buildRail = function(entity : Engine.Entity) : ExportRail
	local edge : Engine.Component.BaseEdge = nil
	local read = pcall(function()
		edge = api.engine.getComponent(entity, api.type.ComponentType.BASE_EDGE) as Engine.Component.BaseEdge
	end)
	if not read or edge == nil then
		return nil
	end

	local row : ExportRail = {
		x0 = roundCoord(edge.position0[1]),
		y0 = roundCoord(edge.position0[2]),
		x1 = roundCoord(edge.position1[1]),
		y1 = roundCoord(edge.position1[2]),
	}

	local roadType : RoadType = edge.roadType
	if roadType ~= nil then
		row.roadType = roadTypeName(roadType)
	end

	local edgeType : BaseEdgeType = edge.type
	if edgeType ~= nil then
		row.edgeType = edgeTypeName(edgeType)
	end

	local roadTemplate : string = edge.roadTemplate
	if roadTemplate then
		row.roadTemplate = roadTemplate
	end

	if edge.distance ~= nil then
		row.distance = edge.distance
	end

	local points : {ExportPoint} = nil
	local pointsRead = pcall(function()
		points = buildRailPoints(entity, edge)
	end)
	if pointsRead then
		row.points = points
	end
	return row
end

--- Every track segment of the shared street/track graph, in the order the
--- street system reports it. A segment reported under several nodes is
--- written once.
local collectRails = function() : {ExportRail}
	local rails : {ExportRail} = {}

	local nodeToTrackEdges : {Engine.Entity : {Engine.Entity}} = nil
	pcall(function()
		nodeToTrackEdges = api.engine.system.streetSystem.getNode2TrackEdgeMap()
	end)
	if nodeToTrackEdges == nil then
		return rails
	end

	local seenEdges : {Engine.Entity : boolean} = {}
	for _, edgeEntities in pairs(nodeToTrackEdges) do
		for _, entity in pairs(edgeEntities) do
			if not seenEdges[entity] then
				seenEdges[entity] = true
				local row : ExportRail = nil
				local built = pcall(function()
					row = buildRail(entity)
				end)
				if built and row ~= nil then
					table.insert(rails, row)
				end
			end
		end
	end
	return rails
end

--- Produced (outputs) or consumed (inputs) amounts of one industry, or nil
--- when the engine reports none of them.
local buildCargoAmounts = function(stockList : Engine.Entity, cargoTypeIds : {CargoTypeId}, produced : boolean) : {ExportCargoAmount}
	if cargoTypeIds == nil then
		return nil
	end
	local rows : {ExportCargoAmount} = {}
	for _, cargoTypeId in ipairs(cargoTypeIds) do
		local amount : integer = nil
		local maxAmount : integer = nil
		pcall(function()
			if produced then
				amount = api.engine.util.stock.getCargoProducedPerYear(stockList, cargoTypeId)
				maxAmount = api.engine.util.stock.getCargoMaxProductionPerYear(stockList, cargoTypeId)
			else
				amount = api.engine.util.stock.getCargoConsumedPerYear(stockList, cargoTypeId)
				maxAmount = api.engine.util.stock.getCargoMaxConsumptionPerYear(stockList, cargoTypeId)
			end
		end)
		local entry : ExportCargoAmount = {
			cargoTypeId = cargoTypeId,
		}
		local cargoName : string = cargoTypeName(cargoTypeId)
		if cargoName then
			entry.name = cargoName
		end
		if amount then
			entry.amount = amount
		end
		if maxAmount then
			entry.maxAmount = maxAmount
		end
		table.insert(rows, entry)
	end
	if #rows == 0 then
		return nil
	end
	return rows
end

--- One land use row of a town, or nil when the game reports no such district.
local landUseRow = function(usages : {UtilTown.TownCapacityUsage}, landUseType : LandUseType) : ExportLandUse
	local usage = usages[landUseType as integer + 1]
	if usage == nil then
		return nil
	end
	local row : ExportLandUse = {
		type = landUseTypeName(landUseType),
		used = usage.used,
		capacity = usage.capacity,
	}
	return row
end

--- One town row plus the town entity it belongs to. The entity is nil when no
--- town entity could be matched, and every statistic is then left out.
local buildTown = function(town : GameMap.Town, candidates : {Engine.Entity}) : ExportTown, Engine.Entity
	local row : ExportTown = {
		name = town.name,
		x = town.pos[1],
		y = town.pos[2],
		sizeFactors = town.sizeFactors,
	}

	local pos : WorldPos = {
		x = town.pos[1],
		y = town.pos[2],
	}

	local townEntity : Engine.Entity = nil
	if town.existing ~= nil and town.existing > 0 then
		townEntity = town.existing
	else
		townEntity = nearestEntity(pos, candidates)
	end
	if townEntity == nil then
		return row, nil
	end
	row.entity = townEntity

	local usages : {UtilTown.TownCapacityUsage} = nil
	pcall(function()
		usages = api.engine.util.town.getTownCapacityUsage(townEntity)
	end)
	if usages then
		local residential : ExportLandUse = landUseRow(usages, api.type["enum"].LandUseType.RESIDENTIAL)
		local commercial : ExportLandUse = landUseRow(usages, api.type["enum"].LandUseType.COMMERCIAL)
		local industrial : ExportLandUse = landUseRow(usages, api.type["enum"].LandUseType.INDUSTRIAL)
		local landUseRows : {ExportLandUse} = {}
		if residential then
			table.insert(landUseRows, residential)
			-- the game's town window reads the population the same way
			row.population = residential.capacity
		end
		if commercial then
			table.insert(landUseRows, commercial)
		end
		if industrial then
			table.insert(landUseRows, industrial)
		end
		if #landUseRows > 0 then
			row.landUse = landUseRows
		end
	end

	local lineUsage : number = nil
	pcall(function()
		lineUsage = api.engine.util.town.getTownLineUsage(townEntity)
	end)
	if lineUsage then
		row.lineUsage = lineUsage
	end

	local townStockCargo : {CargoTypeId : {integer, integer}} = nil
	pcall(function()
		townStockCargo = api.engine.util.town.getTownStockCargo(townEntity)
	end)
	if townStockCargo then
		local cargoTypeIds : {CargoTypeId} = {}
		for cargoTypeId in pairs(townStockCargo) do
			table.insert(cargoTypeIds, cargoTypeId)
		end
		table.sort(cargoTypeIds)
		local stockRows : {ExportTownStock} = {}
		for _, cargoTypeId in ipairs(cargoTypeIds) do
			local stockAndCapacity = townStockCargo[cargoTypeId]
			if stockAndCapacity then
				local entry : ExportTownStock = {
					cargoTypeId = cargoTypeId,
					stock = stockAndCapacity[1],
					capacity = stockAndCapacity[2],
				}
				local cargoName : string = cargoTypeName(cargoTypeId)
				if cargoName then
					entry.name = cargoName
				end
				table.insert(stockRows, entry)
			end
		end
		if #stockRows > 0 then
			row.stock = stockRows
		end
	end

	return row, townEntity
end

--- One industry row plus the industry entity it belongs to. The entity is nil
--- when no industry entity could be matched, and every statistic is then left
--- out.
local buildIndustry = function(industry : GameMap.Industry, candidates : {Engine.Entity}) : ExportIndustry, Engine.Entity
	local row : ExportIndustry = {
		x = industry.pos[1],
		y = industry.pos[2],
		angle = industry.angle,
		onWater = industry.onWater,
		fileName = industry.fileName,
		tag = industry.tag,
	}

	local pos : WorldPos = {
		x = industry.pos[1],
		y = industry.pos[2],
	}

	local industryEntity : Engine.Entity = nil
	if industry.existing ~= nil and industry.existing > 0 then
		industryEntity = industry.existing
	else
		industryEntity = nearestEntity(pos, candidates)
	end
	if industryEntity == nil then
		return row, nil
	end
	row.entity = industryEntity

	local component : Engine.Component.Industry = nil
	pcall(function()
		component = api.engine.getComponent(industryEntity, api.type.ComponentType.INDUSTRY) as Engine.Component.Industry
	end)

	local stockList : Engine.Entity = industryEntity
	if component ~= nil and component.stockList ~= nil then
		stockList = component.stockList
	end

	if component ~= nil then
		if component.level ~= nil then
			row.level = component.level
		end
		if component.maxLevel ~= nil then
			row.maxLevel = component.maxLevel
		end
	end

	local productivity : UtilIndustry.IndustryProductivityInfo = nil
	pcall(function()
		productivity = api.engine.util.industry.getIndustryProductivityInfo(industryEntity)
	end)
	if productivity then
		row.producing = productivity.producing
		row.boostFromRule = productivity.boostFromRule
		row.boostFromPersonCapacity = productivity.boostFromPersonCapacity
	end

	local productionRating : number = nil
	pcall(function()
		productionRating = api.engine.util.stock.getProductionRating(stockList)
	end)
	if productionRating then
		row.productionRating = productionRating
	end

	local inputsAndOutputs : {{CargoTypeId}, {CargoTypeId}} = nil
	pcall(function()
		inputsAndOutputs = api.engine.util.stock.getInputsOutputsFromRules(stockList)
	end)
	if inputsAndOutputs then
		row.inputs = buildCargoAmounts(stockList, inputsAndOutputs[1], false)
		row.outputs = buildCargoAmounts(stockList, inputsAndOutputs[2], true)
	end

	return row, industryEntity
end

--- Cargo flows of the last game year, largest volume first, or nil when the
--- game reports no flow at all.
---
--- The origins are the industries of this snapshot and its destinations are
--- its towns and industries. A flow is only written when the game reports a
--- positive volume for it, so the table never carries invented zeros.
local buildFlows = function(townEntities : {Engine.Entity}, industryEntities : {Engine.Entity}) : ExportEcon
	if #industryEntities == 0 then
		return nil
	end

	local destinations : {Engine.Entity} = {}
	local destinationIsTown : {Engine.Entity : boolean} = {}
	local entityNames : {Engine.Entity : string} = {}
	for _, entity in ipairs(townEntities) do
		table.insert(destinations, entity)
		destinationIsTown[entity] = true
	end
	for _, entity in ipairs(industryEntities) do
		table.insert(destinations, entity)
	end
	for _, entity in ipairs(destinations) do
		local found : string = entityName(entity)
		if found then
			entityNames[entity] = found
		end
	end

	local flows : {ExportFlow} = {}
	for _, origin in ipairs(industryEntities) do
		local stockList : Engine.Entity = origin
		local component : Engine.Component.Industry = nil
		pcall(function()
			component = api.engine.getComponent(origin, api.type.ComponentType.INDUSTRY) as Engine.Component.Industry
		end)
		if component ~= nil and component.stockList ~= nil then
			stockList = component.stockList
		end

		local inputsAndOutputs : {{CargoTypeId}, {CargoTypeId}} = nil
		pcall(function()
			inputsAndOutputs = api.engine.util.stock.getInputsOutputsFromRules(stockList)
		end)
		local outputs : {CargoTypeId} = nil
		if inputsAndOutputs ~= nil then
			outputs = inputsAndOutputs[2]
		end

		if outputs then
			for _, cargoTypeId in ipairs(outputs) do
				for _, destination in ipairs(destinations) do
					if destination ~= origin then
						local volume = flowVolume(origin, destination, cargoTypeId, destinationIsTown[destination] == true)
						if volume ~= nil and volume > 0 then
							local flow : ExportFlow = {
								from = origin,
								to = destination,
								cargoTypeId = cargoTypeId,
								volume = volume,
							}
							flow.fromName = entityNames[origin]
							flow.toName = entityNames[destination]
							flow.cargoName = cargoTypeName(cargoTypeId)
							table.insert(flows, flow)
						end
					end
				end
			end
		end
	end

	if #flows == 0 then
		return nil
	end

	table.sort(flows, function(a : ExportFlow, b : ExportFlow) : boolean
		if a.volume ~= b.volume then
			return a.volume > b.volume
		end
		if a.from ~= b.from then
			return a.from < b.from
		end
		if a.to ~= b.to then
			return a.to < b.to
		end
		return a.cargoTypeId < b.cargoTypeId
	end)

	local flowsTotal = #flows
	if flowsTotal > exportFlowCap then
		local capped : {ExportFlow} = {}
		for index = 1, exportFlowCap do
			capped[index] = flows[index]
		end
		flows = capped
	end

	local econ : ExportEcon = {
		flowCap = exportFlowCap,
		flows = flows,
	}
	econ.flowsTotal = flowsTotal

	local year : integer = nil
	pcall(function()
		year = api.engine.util.getYear()
	end)
	if year then
		econ.year = year
	end
	return econ
end

local label = function(text : string) : TreeNodeId
	return builtin.TextView { text = text }
end

local button = function(text : string, onClick : function()) : TreeNodeId
	return builtin.Button {
		content = label(text),
		onClick = onClick,
	}
end

local NetworkAtlasPlugin = react.RegisterPluginRecipe(
	main_mod_button_area.MainModButtonAreaExtension,
	"NetworkAtlas",
	function() : TreeNodeId
		local openState = react.useState(false)
		local statusState = react.useState("Ready to export")

		local writeExport = function() : string, string, string
			local map = api.engine.terrain.makeMapFromGame(true, true, true, true)
			local bounds = api.engine.terrain.getBoundingBox()
			local roads = {}
			local edgeType = api.type.ComponentType.BASE_EDGE
			local seenEdges = {}
			local nodeToStreetEdges = api.engine.system.streetSystem.getNode2StreetEdgeMap()
			for _, edgeEntities in pairs(nodeToStreetEdges) do
				for _, entity in pairs(edgeEntities) do
					if not seenEdges[entity] then
						seenEdges[entity] = true
						local edge = api.engine.getComponent(entity, edgeType)
						if edge then
							table.insert(roads, {
								x0 = edge.position0[1],
								y0 = edge.position0[2],
								x1 = edge.position1[1],
								y1 = edge.position1[2],
								roadTemplate = edge.roadTemplate,
								distance = edge.distance,
							})
						end
					end
				end
			end
			local rails = collectRails()
			local townCandidates : {Engine.Entity} = {}
			pcall(function()
				townCandidates = api.engine.getEntitiesWithComponent(api.type.ComponentType.TOWN)
			end)
			local industryCandidates : {Engine.Entity} = {}
			pcall(function()
				industryCandidates = api.engine.getEntitiesWithComponent(api.type.ComponentType.INDUSTRY)
			end)
			local towns = {}
			local townEntities : {Engine.Entity} = {}
			for _, town in pairs(map.towns) do
				local townRow, townEntity = buildTown(town, townCandidates)
				table.insert(towns, townRow)
				if townEntity then
					table.insert(townEntities, townEntity)
				end
			end
			local industries = {}
			local industryEntities : {Engine.Entity} = {}
			for _, industry in pairs(map.industries) do
				local industryRow, industryEntity = buildIndustry(industry, industryCandidates)
				table.insert(industries, industryRow)
				if industryEntity then
					table.insert(industryEntities, industryEntity)
				end
			end
			local lines = collectLines()
			local econ : ExportEcon = nil
			pcall(function()
				econ = buildFlows(townEntities, industryEntities)
			end)

			local exportData = {
				format = "network-atlas-map-v1",
				world = {
					minX = bounds.min[1],
					minY = bounds.min[2],
					maxX = bounds.max[1],
					maxY = bounds.max[2],
					width = map.numTilesX * 256.0,
					height = map.numTilesY * 256.0,
					tilesX = map.numTilesX,
					tilesY = map.numTilesY,
				},
				terrain = {
					heightmap = map.heightmap,
					numTilesX = map.numTilesX,
					numTilesY = map.numTilesY,
					levels = map.levels,
					offsetZ = map.offsetZ,
					waterLevel = map.waterLevel,
					resolutionX = map.resolution[1],
					resolutionY = map.resolution[2],
					resolutionZ = map.resolution[3],
				},
				roads = roads,
				rails = rails,
				towns = towns,
				industries = industries,
				lines = lines,
				econ = econ,
			}

			local usedDirectory : string = nil
			local usedFileName : string = nil
			local lastError : string = nil
			for _, candidate in ipairs(exportCandidates) do
				local saved, err = pcall(function()
					app.saveUserdata(candidate.directory, candidate.fileName, exportData)
				end)
				if saved then
					usedDirectory = candidate.directory
					usedFileName = candidate.fileName
					print("[network_atlas] saveUserdata ok: " .. candidate.directory .. "/" .. candidate.fileName)
					break
				end
				lastError = tostring(err)
				print("[network_atlas] saveUserdata FAIL " .. candidate.directory .. "/" .. candidate.fileName .. ": " .. tostring(err))
			end
			if not usedDirectory then
				error("could not write userdata: " .. tostring(lastError))
			end
			return tostring(#roads) .. " roads, " .. tostring(#rails) .. " rails and " .. tostring(#lines) .. " lines", usedDirectory, usedFileName
		end

		local exportMap = function()
			statusState:set("Building map export...")
			local ok, result, usedDirectory, usedFileName = pcall(writeExport)
			if ok then
				statusState:set("Exported " .. tostring(result) .. ". File: " .. app.getUserDataFolder() .. tostring(usedDirectory) .. "/" .. tostring(usedFileName) .. ".lua")
			else
				statusState:set("Export failed: " .. tostring(result))
			end
		end

		local openExportFolder = function()
			local ok, result = pcall(function() app.openUserDataFolder() end)
			if ok then
				statusState:set("Opened userdata folder: " .. app.getUserDataFolder())
			else
				statusState:set("Could not open userdata folder: " .. tostring(result))
			end
		end

		local children : {TreeNodeId} = {}
		table.insert(children, button(openState:old() and "Export x" or "Export map", function()
			openState:set(not openState:old())
		end))

		if openState:old() then
			table.insert(children, button("Export map data", exportMap))
			table.insert(children, button("Open export folder", openExportFolder))
			table.insert(children, label(statusState:old()))
		end

		return builtin.BoxLayout {
			orientation = builtin.type.Orientation.Horizontal,
			children = children,
		}
	end
)

return { NetworkAtlasPlugin = NetworkAtlasPlugin }
