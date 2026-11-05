-- Contract tests for the exact bundled importer, with no Roblox uploads or map writes.
local importer=assert(arg[1], 'path to blender_insert.lua')
local uploads, meshparts, selected, history = 0, 0, nil, 0
local document, place, running, deny, switchAfterUpload = 'document-A', 123, false, false, false
local all = {}
local function object(class)
    local o={ClassName=class,Name=class,attributes={},destroyed=false}
    function o:IsA(name) return self.ClassName==name end
    function o:SetAttribute(key,value) self.attributes[key]=value end
    function o:GetAttribute(key) return self.attributes[key] end
    function o:GetChildren()
        local children={}; for _,child in ipairs(all) do if child.Parent==self and not child.destroyed then children[#children+1]=child end end; return children
    end
    function o:Destroy() self.destroyed=true;self.Parent=nil;for _,child in ipairs(self:GetChildren()) do child:Destroy() end end
    function o:GetBoundingBox() return {},{X=2,Y=4,Z=2} end
    function o:PivotTo(frame) self.pivot=frame end
    all[#all+1]=o;return o
end
workspace=object('Workspace')
workspace.CurrentCamera={Focus={Position={X=10,Y=0,Z=20}}}
function workspace:GetDebugId() return document..'-workspace' end
Enum={AssetType={Mesh='mesh'},AssetCreatorType={User='user',Group='group'},CreateAssetResult={Success='success'},CollisionFidelity={Default='default'},RenderFidelity={Precise='precise'},Material={SmoothPlastic='plastic'},FinishRecordingOperation={Commit='commit'}}
Instance={new=object};Vector3={new=function(x,y,z)return {X=x,Y=y,Z=z}end};CFrame={new=Vector3.new};Color3={fromRGB=function(r,g,b)return {r,g,b}end};Content={fromAssetId=function(id)return {assetId=id}end}
task={wait=function()end}
local services={
    HttpService={JSONEncode=function(_,value)return value end},
    RunService={IsRunning=function()return running end},
    StudioService={GetUserId=function()return 1234 end},
    ChangeHistoryService={TryBeginRecording=function()return 'recording' end,FinishRecording=function()history=history+1 end},
    Selection={Set=function(_,value)selected=value[1]end},
}
services.AssetService={
    CreateEditableMesh=function()
        local mesh={vertices={},faces={},normals={}}
        function mesh:AddVertex(p)self.vertices[#self.vertices+1]=p;return #self.vertices end
        function mesh:AddNormal(n)self.normals[#self.normals+1]=n;return #self.normals end
        function mesh:AddTriangle(a,b,c)self.faces[#self.faces+1]={a,b,c};return #self.faces end
        function mesh:SetFaceNormals(face,normals)assert(#normals==3 and self.faces[face])end
        function mesh:Destroy()self.destroyed=true end
        return mesh
    end,
    CreateAssetAsync=function(_,mesh,kind,params)
        uploads=uploads+1;assert(kind=='mesh' and params.CreatorId==1234 and params.CreatorType=='user')
        assert(#mesh.faces==1 and #mesh.vertices==3)
        if deny then return 'denied',0 end
        if switchAfterUpload then document='document-B' end
        return 'success',10000+uploads
    end,
    CreateMeshPartAsync=function(_,content)
        meshparts=meshparts+1;assert(content.assetId>=10001);return object('MeshPart')
    end,
}
game={CreatorId=1234,CreatorType={Name='User'},PlaceId=place,GetService=function(_,name)return assert(services[name],name)end,GetDebugId=function()return document end}
local function execute(action,extra)
    payload={action=action,source='source-A',documentId='document-A:document-A-workspace',placeId=tostring(place),owner=1234,ownerType='User',name='Model test',versionId='version-A'}
    for key,value in pairs(extra or {}) do payload[key]=value end
    return assert(loadfile(importer))()
end
local positions={-1,0,0,1,0,0,0,2,0};local normals={0,0,1,0,0,1,0,0,1}
local function append()return execute('append',{index=1,offset=0,positions=positions,normals=normals})end
local function finish()return execute('finishPart',{index=1,triangles=1,partId='part',center={0,1,0},size={2,2,.001},color={36,107,179},material='SmoothPlastic',opacity=1,roughness=.5,metalness=0})end
assert(execute('probe').ok);assert(uploads==0)
assert(execute('begin').ok);assert(append().triangles==1)
assert(finish().assetId==10001);assert(execute('commit',{parts=1,triangles=1}).ok)
assert(#workspace:GetChildren()==1 and selected.Parent==workspace and selected:GetAttribute('ForgeKitVersionId')=='version-A')
assert(selected:GetChildren()[1].Anchored and history==1)
assert(execute('probe').reused and uploads==1)
-- Switched map is rejected before changing geometry or uploading.
document='other';assert(not pcall(append));assert(uploads==1);document='document-A'
-- A known upload failure leaves the old map model untouched and never reports success.
local old=selected;_G.__ForgeKitBlender_source_B=nil
execute('begin',{source='source-B'});execute('append',{source='source-B',index=1,offset=0,positions=positions,normals=normals})
deny=true;local failure=execute('finishPart',{source='source-B',index=1,triangles=1});assert(not failure.ok);deny=false
assert(old.Parent==workspace and #workspace:GetChildren()==1)
local count=uploads;local retry=execute('finishPart',{source='source-B',index=1,triangles=1});assert(not retry.ok and uploads==count)
assert(execute('begin',{source='source-B'}).ok) -- An explicit retry after a confirmed rejection is allowed.
-- Losing target identity while upload yields retains its asset ID in the failure receipt.
execute('begin',{source='source-C'});execute('append',{source='source-C',index=1,offset=0,positions=positions,normals=normals})
switchAfterUpload=true;failure=execute('finishPart',{source='source-C',index=1,triangles=1});assert(not failure.ok and #failure.assetIds==1)
assert(meshparts==1 and old.Parent==workspace)
print('PASS: real importer script, mesh/normals, upload receipt, commit/Undo, reuse, switched map, upload denial and no automatic retry')
