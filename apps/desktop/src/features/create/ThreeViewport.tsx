import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Icon } from '../../design-system/Icon';
import { frameClipping, frameDistance } from './viewportCamera';
import { viewportGrid } from './viewportGrid';
import { modelReveal } from './modelReveal';
import type { ReactNode } from 'react';

type View = 'perspective' | 'front' | 'right' | 'top';
export function ThreeViewport({ object, wireframe = false, onSelect, onFrame, label, previewCamera, emptyMessage, overlay, revealKey }: {
  object: THREE.Group; wireframe?: boolean; onSelect?: (id: string) => void;
  onFrame?: (elapsed: number) => void; label: string; previewCamera?: THREE.PerspectiveCamera; emptyMessage?: string; overlay?: ReactNode; revealKey?: string;
}) {
  const host = useRef<HTMLDivElement>(null), frame = useRef(onFrame), select = useRef(onSelect);
  frame.current = onFrame; select.current = onSelect;
  const controller = useRef<{ view: (value: View) => void; pick: (item: THREE.Object3D) => void } | null>(null);
  const [error, setError] = useState(''), [structure, setStructure] = useState(false), [active, setActive] = useState('');
  const [visibleNodes, setVisibleNodes] = useState(128);
  const [wire, setWire] = useState(wireframe), [gridVisible, setGridVisible] = useState(true);
  const settings = useRef({ gridVisible }); settings.current = { gridVisible };
  const reveal = useRef<ReturnType<typeof modelReveal> | null>(null);
  const meshes = useMemo(() => { const nodes: (THREE.Mesh | THREE.Line | THREE.Points)[] = []; object.traverse(item => { if (item instanceof THREE.Mesh || item instanceof THREE.Line || item instanceof THREE.Points) nodes.push(item); }); return nodes; }, [object]);
  useEffect(() => setWire(wireframe), [wireframe]);
  useEffect(() => {
    if (!revealKey || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animation = modelReveal(object, media.matches); reveal.current = animation;
    const changed = () => { if (media.matches) animation.restore(); };
    media.addEventListener('change', changed);
    return () => { media.removeEventListener('change', changed); animation.restore(); reveal.current = null; };
  }, [object, revealKey]);
  useEffect(() => {
    for (const item of meshes) for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
      if ('wireframe' in material) material.wireframe = wire;
    }
  }, [meshes, wire]);
  useEffect(() => {
    const element = host.current!;
    setActive(''); setVisibleNodes(128);
    if (!window.WebGLRenderingContext) { setError('WebGL tidak tersedia. Aktifkan dukungan GPU untuk membuka ruang 3D.'); return; }
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setError('Renderer 3D gagal dimulai. Periksa dukungan WebGL perangkat.'); return; }
    setError(''); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    const canvas = renderer.domElement; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label);
    canvas.tabIndex = 0; element.appendChild(canvas);
    const scene = new THREE.Scene(); scene.add(object);
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, .04); scene.environment = environment.texture;
    room.dispose(); pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(40, 1, .01, 100000);
    const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.enabled = !previewCamera;
    let target: THREE.Object3D = object;
    function view(value: View) {
      const bounds = new THREE.Box3().setFromObject(target);
      const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(bounds.isEmpty() ? 4 : bounds.getSize(new THREE.Vector3()).length() / 2, .001);
      const direction = value === 'front' ? new THREE.Vector3(0,0,1) : value === 'right' ? new THREE.Vector3(1,0,0)
        : value === 'top' ? new THREE.Vector3(0,1,.001) : new THREE.Vector3(1,.6,1).normalize();
      const distance = frameDistance(radius, camera.fov, camera.aspect);
      const clipping = frameClipping(radius, distance);
      camera.position.copy(center).addScaledVector(direction, distance); camera.near = clipping.near; camera.far = clipping.far; camera.updateProjectionMatrix();
      controls.target.copy(center); controls.minDistance = clipping.minDistance; controls.maxDistance = distance * 30; controls.update();
    }
    scene.add(new THREE.HemisphereLight('#ffffff', '#b3b3b3', 1));
    const light = new THREE.DirectionalLight('#ffffff', 2); light.position.set(4, 8, 6); scene.add(light);
    const bounds = new THREE.Box3().setFromObject(object);
    const floor = viewportGrid(bounds);
    const grid = new THREE.GridHelper(floor.size, floor.divisions, '#66525c', '#30292e');
    grid.position.set(floor.x, floor.y, floor.z);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true; gridMaterial.opacity = .5; scene.add(grid);
    const selectionBounds = new THREE.Box3(); const box = new THREE.Box3Helper(selectionBounds, '#ff3359'); box.visible = false; scene.add(box);
    let selected: THREE.Object3D | null = null;
    controller.current = { view: value => { target = object; view(value); }, pick: item => {
      selected = item; setActive(item.uuid); select.current?.(item.userData.partId ?? item.name);
      target = item; view('perspective');
    } };
    function resize() {
      const { width, height } = element.getBoundingClientRect();
      const aspect = Math.max(width, 1) / Math.max(height, 1);
      const ratio = frameDistance(1, camera.fov, aspect) / frameDistance(1, camera.fov, camera.aspect);
      camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
      controls.maxDistance *= ratio;
      renderer.setSize(Math.max(width, 1), Math.max(height, 1)); camera.aspect = aspect; camera.updateProjectionMatrix();
      if (previewCamera) { previewCamera.aspect = camera.aspect; previewCamera.updateProjectionMatrix(); }
    }
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); view('perspective');
    let down = [0, 0]; const raycaster = new THREE.Raycaster();
    function pointerdown(event: PointerEvent) { down = [event.clientX, event.clientY]; }
    function pointerup(event: PointerEvent) {
      if (event.button !== 0 || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), previewCamera ?? camera);
      const hit = raycaster.intersectObject(object, true).find(entry => entry.object instanceof THREE.Mesh || entry.object instanceof THREE.Points || entry.object instanceof THREE.Line);
      selected = hit?.object ?? null; setActive(selected?.uuid ?? '');
      if (selected) select.current?.(selected.userData.partId ?? selected.name);
    }
    function keydown(event: KeyboardEvent) {
      const value = ({ f: 'perspective', '1': 'front', '3': 'right', '7': 'top' } as Record<string, View>)[event.key.toLowerCase()];
      if (value && !previewCamera) { event.preventDefault(); target = object; view(value); }
    }
    function contextlost(event: Event) { event.preventDefault(); setError('Konteks GPU terputus. Buka ulang editor untuk memuat ruang 3D.'); }
    canvas.addEventListener('pointerdown', pointerdown); canvas.addEventListener('pointerup', pointerup); canvas.addEventListener('keydown', keydown); canvas.addEventListener('webglcontextlost', contextlost);
    let handle = 0, last = performance.now(); let backup: ReturnType<typeof setTimeout> | undefined;
    function render(now: number) {
      // Timer fallback replaces a stalled frame; never leave both clocks queued.
      cancelAnimationFrame(handle); clearTimeout(backup);
      const elapsed = Math.min((now - last) / 1000, .1); last = now;
      if (element.getClientRects().length) {
        reveal.current?.update(elapsed); frame.current?.(elapsed); controls.update(); grid.visible = settings.current.gridVisible;
        box.visible = !!selected; if (selected) selectionBounds.setFromObject(selected);
        renderer.render(scene, previewCamera ?? camera);
      }
      handle = requestAnimationFrame(render); backup = setTimeout(() => render(performance.now()), 100);
    }
    handle = requestAnimationFrame(render); backup = setTimeout(() => render(performance.now()), 100);
    return () => {
      controller.current = null; cancelAnimationFrame(handle); clearTimeout(backup); observer.disconnect(); controls.dispose();
      canvas.removeEventListener('pointerdown', pointerdown); canvas.removeEventListener('pointerup', pointerup); canvas.removeEventListener('keydown', keydown); canvas.removeEventListener('webglcontextlost', contextlost);
      scene.remove(object); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); box.geometry.dispose(); (box.material as THREE.Material).dispose();
      environment.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    };
  }, [object, label, previewCamera]);
  return <div className="three-viewport">
    <div className="viewport-navigation" aria-label="Kontrol ruang 3D">
      <div className="viewport-camera-buttons">{(['perspective','front','right','top'] as const).map((value, i) => <button key={value} type="button" disabled={!!previewCamera} onClick={() => controller.current?.view(value)} title={['Bingkai semua objek (F)','Depan (1)','Kanan (3)','Atas (7)'][i]}>{['Bingkai','Depan','Kanan','Atas'][i]}</button>)}</div>
      <div className="viewport-display-buttons"><button type="button" aria-pressed={gridVisible} title="Tampilkan grid" onClick={() => setGridVisible(!gridVisible)}><Icon name="grid" /></button><button type="button" aria-pressed={wire} title="Wireframe" onClick={() => setWire(!wire)}><Icon name="cube" /></button><button type="button" aria-pressed={structure} title="Struktur objek" onClick={() => setStructure(!structure)}><Icon name="layers" /></button></div>
    </div>
    <div className="three-stage" ref={host}>{error && <p role="alert">{error}</p>}{!error && emptyMessage && !meshes.length && <p className="viewport-empty-message">{emptyMessage}</p>}
      {structure && <aside className="viewport-structure" aria-label="Struktur objek 3D"><strong>{object.name || 'Scene'} <small>{meshes.length} objek</small></strong>{meshes.slice(0,visibleNodes).map(item => <button type="button" key={item.uuid} aria-pressed={active === item.uuid} title={item.name} onClick={() => controller.current?.pick(item)}><Icon name="cube" /><span>{item.name || 'Mesh'}</span></button>)}{meshes.length > visibleNodes && <button type="button" onClick={() => setVisibleNodes(value => value + 128)}>Tampilkan berikutnya ({meshes.length - visibleNodes} tersisa)</button>}</aside>}
      {!error && previewCamera && <span className="viewport-gesture-hint">Kamera cutscene</span>}
      {overlay}
    </div>
  </div>;
}
