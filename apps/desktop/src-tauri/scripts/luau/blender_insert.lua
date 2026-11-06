-- Trusted importer. Payload is validated mesh data; no provider-supplied code runs here.
local http = game:GetService('HttpService')
local run = game:GetService('RunService')
local assets = game:GetService('AssetService')
local function identity()
    assert(not run:IsRunning(), 'Hentikan Play sebelum memasukkan model.')
    return game:GetDebugId(32) .. ':' .. workspace:GetDebugId(32)
end
local function guard()
    assert(identity() == payload.documentId, 'Map berganti. Impor dihentikan.')
    assert(tostring(game.PlaceId) == payload.placeId, 'Place tujuan berubah.')
end
if payload.action == 'probe' then
    local id = identity()
    assert(type(assets.CreateAssetAsync) == 'function' and type(assets.CreateMeshPartAsync) == 'function', 'Studio belum mendukung impor mesh ini.')
    local owner = game.CreatorId
    local ownerType = game.CreatorType.Name
    if owner == 0 then owner = game:GetService('StudioService'):GetUserId(); ownerType = 'User' end
    assert(owner > 0 and (ownerType == 'User' or ownerType == 'Group'), 'Pemilik map belum dapat diverifikasi.')
    for _, model in ipairs(workspace:GetChildren()) do
        if model:IsA('Model') and model:GetAttribute('ForgeKitSource') == payload.source then
            return http:JSONEncode({ok=true, documentId=id, placeId=tostring(game.PlaceId), owner=owner, ownerType=ownerType, reused=true, modelName=model.Name})
        end
    end
    return http:JSONEncode({ok=true, documentId=id, placeId=tostring(game.PlaceId), owner=owner, ownerType=ownerType})
end
guard()
local key = '__ForgeKitBlender_' .. payload.source
local state = _G[key]
if payload.action == 'begin' then
    if state and state.phase == 'failed' and #state.assets == 0 and (not state.uploadStarted or state.uploadRejected) then
        _G[key]=nil; state=nil -- A confirmed pre-upload/rejected attempt can be tried again.
    end
    assert(not state, 'Impor versi ini sudah pernah dimulai. Periksa model/receipt sebelumnya sebelum mencoba ulang.')
    state = {model=Instance.new('Model'), meshes={}, assets={}, phase='building', owner=payload.owner, ownerType=payload.ownerType, documentId=payload.documentId}
    state.model.Name = payload.name
    _G[key] = state
end
assert(state and state.documentId == payload.documentId, 'Sesi impor tidak tersedia pada map ini.')
local ok, result = pcall(function()
    if payload.action == 'begin' then return {phase='building'} end
    assert(state.phase ~= 'failed' and state.phase ~= 'uploading', 'Impor sebelumnya belum terkonfirmasi. Periksa receipt; upload tidak diulang otomatis.')
    if payload.action == 'append' then
        local entry = state.meshes[payload.index]
        if not entry then
            local mesh = assets:CreateEditableMesh()
            assert(mesh, 'Memori EditableMesh tidak cukup.')
            entry = {mesh=mesh, triangles=0}; state.meshes[payload.index] = entry
        end
        assert(entry.triangles == payload.offset, 'Urutan geometri tidak cocok; chunk tidak diulang.')
        for i=1,#payload.positions,9 do
            local vertices, normals, colors = {}, {}, {}
            for corner=0,2 do
                local n = i + corner*3
                vertices[corner+1] = entry.mesh:AddVertex(Vector3.new(payload.positions[n],payload.positions[n+1],payload.positions[n+2]))
                normals[corner+1] = entry.mesh:AddNormal(Vector3.new(payload.normals[n],payload.normals[n+1],payload.normals[n+2]))
                if payload.colors then
                    colors[corner+1] = entry.mesh:AddColor(Color3.new(payload.colors[n],payload.colors[n+1],payload.colors[n+2]),1)
                end
            end
            local face = entry.mesh:AddTriangle(vertices[1],vertices[2],vertices[3])
            entry.mesh:SetFaceNormals(face,normals)
            if payload.colors then entry.mesh:SetFaceColors(face,colors) end
            entry.triangles = entry.triangles + 1
            if entry.triangles % 256 == 0 then task.wait(); guard() end
        end
        return {triangles=entry.triangles}
    elseif payload.action == 'finishPart' then
        local entry = assert(state.meshes[payload.index], 'Mesh belum dibuat.')
        assert(entry.triangles == payload.triangles and not entry.part, 'Jumlah triangle atau status mesh tidak cocok.')
        state.phase = 'uploading' -- A lost response must never silently repeat this upload.
        state.uploadStarted = true; state.uploadRejected = false
        guard()
        local status, assetId = assets:CreateAssetAsync(entry.mesh,Enum.AssetType.Mesh,{
            CreatorId=state.owner, CreatorType=Enum.AssetCreatorType[state.ownerType],
            Name=payload.name, Description='Mesh Blender dari ForgeKit Studio',
        })
        state.uploadRejected = status ~= Enum.CreateAssetResult.Success
        assert(status == Enum.CreateAssetResult.Success and type(assetId) == 'number' and assetId > 0, 'Upload mesh ditolak: ' .. tostring(status) .. ' ' .. tostring(assetId))
        state.assets[#state.assets+1] = assetId
        guard()
        local part = assets:CreateMeshPartAsync(Content.fromAssetId(assetId),{CollisionFidelity=Enum.CollisionFidelity.Default,RenderFidelity=Enum.RenderFidelity.Precise})
        entry.part = part
        guard()
        part.Name = payload.name
        part.Anchored = true
        part.Color = Color3.fromRGB(payload.color[1],payload.color[2],payload.color[3])
        part.Material = Enum.Material[payload.material]
        part.Transparency = 1-payload.opacity
        part.Size = Vector3.new(payload.size[1],payload.size[2],payload.size[3])
        part.CFrame = CFrame.new(payload.center[1],payload.center[2],payload.center[3])
        part:SetAttribute('ForgeKitPartId',payload.partId)
        part:SetAttribute('ForgeKitTriangles',entry.triangles)
        part:SetAttribute('ForgeKitRoughness',payload.roughness)
        part:SetAttribute('ForgeKitMetalness',payload.metalness)
        part.Parent = state.model
        entry.mesh:Destroy(); entry.mesh=nil
        state.phase = 'building'
        return {assetId=assetId,triangles=entry.triangles}
    elseif payload.action == 'commit' then
        local count, triangles = 0, 0
        for _, entry in pairs(state.meshes) do
            assert(entry.part and entry.part:IsA('MeshPart'), 'MeshPart belum selesai.')
            count=count+1; triangles=triangles+entry.triangles
        end
        assert(count == payload.parts and triangles == payload.triangles, 'Hasil impor tidak lengkap.')
        state.model:SetAttribute('ForgeKitSource',payload.source)
        state.model:SetAttribute('ForgeKitVersionId',payload.versionId)
        state.model:SetAttribute('ForgeKitTriangles',triangles)
        local camera = workspace.CurrentCamera
        if camera then
            local _, size = state.model:GetBoundingBox()
            local focus = camera.Focus.Position
            state.model:PivotTo(CFrame.new(focus.X,focus.Y+size.Y/2,focus.Z))
        end
        guard()
        local history = game:GetService('ChangeHistoryService')
        local recording = history:TryBeginRecording('ForgeKitBlenderImport','Masukkan model Blender')
        assert(recording, 'Studio sedang merekam perubahan lain; model belum dimasukkan.')
        state.model.Parent = workspace
        history:FinishRecording(recording,Enum.FinishRecordingOperation.Commit)
        state.phase = 'complete'
        pcall(function() game:GetService('Selection'):Set({state.model}) end)
        assert(state.model.Parent == workspace and #state.model:GetChildren() == count, 'Read-back model tidak cocok.')
        return {modelName=state.model.Name,parts=count,triangles=triangles,assetIds=state.assets,reused=false}
    end
    error('Tahap impor tidak dikenal.')
end)
if not ok then
    state.phase='failed'
    -- Only our detached staging model is cleaned up. Existing map objects and uploaded assets are retained.
    if state.model.Parent == nil then
        state.model:Destroy()
        for _,entry in pairs(state.meshes) do
            if entry.mesh then entry.mesh:Destroy(); entry.mesh=nil end
            if entry.part and entry.part.Parent == nil then entry.part:Destroy() end
        end
    end
    return http:JSONEncode({ok=false,error=tostring(result),assetIds=state.assets})
end
result.ok=true
return http:JSONEncode(result)
