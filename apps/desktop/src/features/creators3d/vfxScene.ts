import * as THREE from 'three';
import type { VfxRecipe } from '@forgekit/contracts';
import { buildReferenceRig } from '../create/robloxRig';

export function particleOpacity(recipe: VfxRecipe, age: number) {
  const points = recipe.transparency ?? [{ time: 0, value: 0 }, { time: 1, value: 1 }];
  const next = points.findIndex(p => p.time >= age);
  if (next <= 0) return 1 - points[next < 0 ? points.length - 1 : 0].value;
  const a = points[next - 1], b = points[next];
  return 1 - (a.value + (b.value - a.value) * (age - a.time) / (b.time - a.time));
}
export function buildVfxScene(recipe: VfxRecipe) {
  const group = new THREE.Group(); group.name = recipe.name;
  const rig = buildReferenceRig('R15'); group.add(rig.group);
  const emitter = new THREE.Group(); emitter.name = `Emitter · ${recipe.type}`; emitter.position.set(2.5, 2, 0); group.add(emitter);
  const count = Math.min(2048, Math.ceil(recipe.type === 'burst' ? recipe.rate : recipe.rate * recipe.lifetime[1]));
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), sizes = new Float32Array(count), alpha = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1)); geometry.setAttribute('aOpacity', new THREE.BufferAttribute(alpha, 1));
  // Frame the full emitter lifetime so a growing burst stays inside the initial camera view.
  const reach=recipe.speed[1]*recipe.lifetime[1], cone=recipe.spread*Math.PI/180;
  const radius=reach*(cone>=Math.PI/2?1:Math.sin(cone))+Math.max(recipe.sizeStart,recipe.sizeEnd)/2;
  geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-radius,Math.min(0,Math.cos(cone)*reach),-radius),new THREE.Vector3(radius,reach,radius));
  geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true, blending: recipe.lightEmission > .5 ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute float aSize; attribute float aOpacity; varying vec3 vColor; varying float vOpacity; void main(){vColor=color;vOpacity=aOpacity;vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(aSize*600.0/max(0.1,-p.z),1.0,180.0);}',
    fragmentShader: 'varying vec3 vColor; varying float vOpacity; void main(){float r=length(gl_PointCoord-vec2(0.5))*2.0;float a=(1.0-smoothstep(0.15,1.0,r))*vOpacity;if(a<0.005)discard;gl_FragColor=vec4(vColor,a);#include <colorspace_fragment>}',
  });
  // Shader chunks must begin on their own preprocessing line.
  material.fragmentShader = material.fragmentShader.replace('#include', '\n#include').replace('>}', '>\n}');
  const particles = new THREE.Points(geometry, material); particles.name = 'ParticleEmitter'; particles.frustumCulled = false;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,1,12), new THREE.MeshBasicMaterial({color:recipe.startColor,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false})); beam.name = 'Beam';
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64*8*3),3));
  const trailIndices:number[]=[];
  for(let i=0;i<63;i++)for(let j=0;j<8;j++){const a=i*8+j,b=i*8+(j+1)%8,c=a+8,d=b+8;trailIndices.push(a,c,b,b,c,d);}
  trailGeometry.setIndex(trailIndices);
  const trail = new THREE.Mesh(trailGeometry,new THREE.MeshStandardMaterial({color:recipe.startColor,emissive:recipe.startColor,emissiveIntensity:recipe.lightEmission,transparent:true,opacity:.8,side:THREE.DoubleSide})); trail.name = 'Trail';
  emitter.add(recipe.type === 'beam' ? beam : recipe.type === 'trail' ? trail : particles);
  // Dispose geometry for unused effect modes through the normal scene cleanup.
  for (const item of [particles, beam, trail]) if (!item.parent) { item.geometry.dispose(); item.material.dispose(); }
  const start = new THREE.Color(recipe.startColor), end = new THREE.Color(recipe.endColor), color = new THREE.Color();
  const update = (seconds: number) => {
    if (recipe.type === 'beam') {
      const length = Math.max(.1, recipe.speed[1] * .5); beam.scale.set(Math.max(.2,recipe.sizeStart),length,Math.max(.2,recipe.sizeEnd)); beam.position.y=length/2;
      beam.rotation.z=Math.sin(seconds*2)*recipe.spread*Math.PI/360; beam.material.opacity=.5+.4*Math.sin(seconds*4)**2; return;
    }
    if (recipe.type === 'trail') {
      const attribute=trail.geometry.getAttribute('position');
      for(let i=0;i<64;i++){const t=seconds-i*.025,r=Math.max(.01,THREE.MathUtils.lerp(recipe.sizeStart,recipe.sizeEnd,i/63))*.15;
        for(let j=0;j<8;j++){const angle=j*Math.PI/4;attribute.setXYZ(i*8+j,Math.sin(t*2)*2+Math.cos(angle)*r,1+Math.cos(t*1.4)+Math.sin(angle)*r,Math.cos(t*2)*2);}
      } attribute.needsUpdate=true;trail.geometry.computeVertexNormals();trail.geometry.computeBoundingSphere(); return;
    }
    for(let i=0;i<count;i++) {
      const a=(i*.61803398875)%1,b=(i*.38196601125)%1;
      const lifetime=recipe.lifetime[0]+a*(recipe.lifetime[1]-recipe.lifetime[0]);
      const rawAge=recipe.type === 'burst' ? (seconds % (recipe.lifetime[1]+.5))-a*.08 : (seconds+i/recipe.rate)%lifetime;
      const age=THREE.MathUtils.clamp(rawAge/lifetime,0,1);
      const angle=b*Math.PI*2, spread=Math.sqrt(a)*recipe.spread*Math.PI/180;
      const distance=age*lifetime*(recipe.speed[0]+b*(recipe.speed[1]-recipe.speed[0]));
      positions[i*3]=Math.sin(spread)*Math.cos(angle)*distance; positions[i*3+1]=Math.cos(spread)*distance; positions[i*3+2]=Math.sin(spread)*Math.sin(angle)*distance;
      color.copy(start).lerp(end,age); color.toArray(colors,i*3);
      sizes[i]=Math.max(.02,THREE.MathUtils.lerp(recipe.sizeStart,recipe.sizeEnd,age)); alpha[i]=rawAge<0||rawAge>lifetime?0:particleOpacity(recipe,age);
    }
    for(const key of ['position','color','aSize','aOpacity']) geometry.getAttribute(key).needsUpdate=true;
  };
  update(.3); group.updateMatrixWorld(true);
  return {group,update,count};
}
