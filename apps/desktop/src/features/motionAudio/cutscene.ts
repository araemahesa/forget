import * as THREE from 'three';
import { buildReferenceRig } from '../create/robloxRig';
import { validateCutsceneRecipe, type CameraKeyframe, type CutsceneRecipe } from '@forgekit/contracts';

export function cameraEasing(style: CameraKeyframe['easing'], x: number) {
  if (style === 'Linear') return x;
  if (style === 'Sine') return (1 - Math.cos(Math.PI * x)) / 2;
  const power = style === 'Quad' ? 2 : style === 'Cubic' ? 3 : 5;
  return x < .5 ? 2 ** (power - 1) * x ** power : 1 - (-2 * x + 2) ** power / 2;
}
function orientation(frame: CameraKeyframe) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
    new THREE.Vector3(...frame.position), new THREE.Vector3(...frame.lookAt), new THREE.Vector3(0, 1, 0),
  ));
}
export function sampleCutscene(recipe: CutsceneRecipe, time: number) {
  const t = THREE.MathUtils.clamp(time, 0, recipe.keyframes.at(-1)!.time);
  let index = recipe.keyframes.findIndex((frame) => frame.time >= t);
  if (index < 0) index = recipe.keyframes.length - 1;
  const b = recipe.keyframes[index], a = recipe.keyframes[Math.max(0, index - 1)];
  const factor = a === b ? 0 : cameraEasing(b.easing, (t - a.time) / (b.time - a.time));
  return {
    position: new THREE.Vector3(...a.position).lerp(new THREE.Vector3(...b.position), factor),
    quaternion: orientation(a).slerp(orientation(b), factor),
    fov: THREE.MathUtils.lerp(a.fov, b.fov, factor),
  };
}
export function buildCutscenePreview(recipe: CutsceneRecipe) {
  const issues = validateCutsceneRecipe(recipe);
  if (issues.length) throw new Error(issues[0].message);
  const group = new THREE.Group();
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(recipe.keyframes.map((frame) => new THREE.Vector3(...frame.position))), new THREE.LineBasicMaterial({ color: '#ff3359' }));
  path.name = 'CameraPath'; group.add(path);
  for (const frame of recipe.keyframes) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.6, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3359' }));
    marker.position.fromArray(frame.position); group.add(marker);
  }
  group.name = recipe.title; group.add(buildReferenceRig('R15').group);
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, .1, 1000000);
  const helperCamera = new THREE.PerspectiveCamera(70, 16 / 9, .1, 6);
  const helper = new THREE.CameraHelper(helperCamera); group.add(helper);
  const update = (time: number) => {
    const pose = sampleCutscene(recipe, time);
    helperCamera.aspect = camera.aspect;
    for (const view of [camera, helperCamera]) {
      view.position.copy(pose.position); view.quaternion.copy(pose.quaternion); view.fov = pose.fov;
      view.updateProjectionMatrix(); view.updateMatrixWorld(true);
    }
    helper.update();
    return pose;
  };
  update(0);
  return { group, camera, helper, update };
}

export function cutsceneLuau(recipe: CutsceneRecipe) {
  const issues = validateCutsceneRecipe(recipe);
  if (issues.length) throw new Error(issues[0].message);
  const frames = recipe.keyframes.map((frame) =>
    `    { time = ${frame.time}, pose = CFrame.lookAt(Vector3.new(${frame.position.join(', ')}), Vector3.new(${frame.lookAt.join(', ')})), fov = ${frame.fov}, easing = Enum.EasingStyle.${frame.easing} },`).join('\n');
  return `-- ForgeKit: LocalScript. Reference coordinates; review against your map before running.
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
assert(RunService:IsClient(), "Run cutscene from a LocalScript")
local camera = workspace.CurrentCamera
assert(camera, "CurrentCamera unavailable")
local frames = {
${frames}
}
local duration, loop = ${recipe.duration}, ${recipe.loop}
local previousType, previousPose, previousFov, previousSubject = camera.CameraType, camera.CFrame, camera.FieldOfView, camera.CameraSubject
local connection, destroying
local stopped = false
local function stop()
    if stopped then return end
    stopped = true
    if connection then connection:Disconnect() end
    if destroying then destroying:Disconnect() end
    if camera.Parent then
        camera.CFrame, camera.FieldOfView = previousPose, previousFov
        camera.CameraSubject, camera.CameraType = previousSubject, previousType
    end
end
destroying = script.Destroying:Connect(stop)
camera.CameraType = Enum.CameraType.Scriptable
local elapsed = 0
connection = RunService.RenderStepped:Connect(function(delta)
    if workspace.CurrentCamera ~= camera then stop() return end
    elapsed += delta
    local t = loop and elapsed % duration or math.min(elapsed, duration)
    local a, b = frames[#frames], frames[#frames]
    for i = 2, #frames do
        if t <= frames[i].time then a, b = frames[i - 1], frames[i] break end
    end
    local alpha = a == b and 0 or TweenService:GetValue((t - a.time) / (b.time - a.time), b.easing, Enum.EasingDirection.InOut)
    camera.CFrame = a.pose:Lerp(b.pose, alpha)
    camera.FieldOfView = a.fov + (b.fov - a.fov) * alpha
    if not loop and elapsed >= duration then stop() end
end)
`;
}
