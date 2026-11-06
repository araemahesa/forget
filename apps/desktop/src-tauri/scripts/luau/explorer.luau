local HttpService = game:GetService("HttpService")
local query = HttpService:JSONDecode(QUERY_JSON)
local function identity(object)
    local ok, id = pcall(function() return tostring(object.UniqueId) end)
    if ok and id ~= "00000000000000000000000000000000" then return id end
    local debugOk, debugId = pcall(function() return object:GetDebugId(32) end)
    if debugOk then return debugId end
    error("Studio tidak menyediakan identitas instance stabil; Explorer tidak dapat menjamin nama kembar.")
end
local epoch = identity(game)
if query.epoch and query.epoch ~= epoch then error("Map/session berubah. Muat ulang Explorer.") end
local target = game
for _, segment in ipairs(query.path) do
    local found = nil
    for _, child in ipairs(target:GetChildren()) do
        if child.Name == segment.name and identity(child) == segment.id then found = child break end
    end
    if not found then error("Objek berubah atau sudah dihapus; muat ulang cabang.") end
    target = found
end
local function node(object, path)
    local parts = table.clone(path)
    table.insert(parts, {name = object.Name, id = identity(object)})
    return {id = identity(object), name = object.Name, className = object.ClassName, path = parts, displayPath = object:GetFullName(), childCount = #object:GetChildren()}
end
local result = {epoch = epoch, datamodel = "Edit", nodes = {}, offset = query.offset, total = 0, properties = {}, partial = false}
if query.action == "properties" then
    for _, key in ipairs({"Name", "ClassName", "Archivable", "Position", "Size", "CFrame", "Color", "Material", "Transparency", "Anchored", "CanCollide", "Enabled", "Disabled", "Visible", "Text", "Value", "Volume", "SoundId", "PlaybackSpeed", "Rate", "Lifetime", "Speed"}) do
        local ok, value = pcall(function() return target[key] end)
        if ok then result.properties[key] = tostring(value) end
    end
    result.properties.Parent = target.Parent and target.Parent:GetFullName() or "—"
    result.properties.Children = tostring(#target:GetChildren())
elseif query.action == "children" then
    local children = target:GetChildren()
    result.total = #children
    for index = query.offset + 1, math.min(#children, query.offset + 100) do table.insert(result.nodes, node(children[index], query.path)) end
    result.more = query.offset + #result.nodes < #children
else
    -- Search unseen branches in bounded batches; incomplete coverage is explicit.
    local queue = {{object = game, path = {}}}
    local index, scanned, matches = 1, 0, 0
    local term = string.lower(query.search)
    while index <= #queue and scanned < 10000 do
        local entry = queue[index]
        index += 1
        for _, child in ipairs(entry.object:GetChildren()) do
            scanned += 1
            local childNode = node(child, entry.path)
            local text = string.lower(child.Name .. " " .. child.ClassName .. " " .. childNode.displayPath)
            if string.find(text, term, 1, true) then
                if matches >= query.offset and #result.nodes < 100 then table.insert(result.nodes, childNode) end
                matches += 1
            end
            if childNode.childCount > 0 then table.insert(queue, {object = child, path = childNode.path}) end
            if scanned % 100 == 0 then task.wait() end
            if scanned >= 10000 then break end
        end
    end
    result.partial = index <= #queue or scanned >= 10000
    result.total = matches
    result.more = query.offset + #result.nodes < matches
    result.scanned = scanned
end
return HttpService:JSONEncode(result)
