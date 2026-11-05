import * as THREE from 'three';
import type { GuiRecipe } from '@forgekit/contracts';

/** UDim2 hierarchy projected into a layered inspection scene; ScreenGui stays a 2D runtime UI. */
export function buildGuiScene(recipe: GuiRecipe) {
  const group = new THREE.Group(); group.name = recipe.screenName;
  const width = recipe.targetDevice === 'mobile' ? 390 : recipe.targetDevice === 'tablet' ? 1024 : 1920;
  const height = recipe.targetDevice === 'mobile' ? 844 : recipe.targetDevice === 'tablet' ? 768 : 1080;
  const scale = 10 / width;
  const screen = new THREE.Mesh(new THREE.BoxGeometry(10, height * scale, .06), new THREE.MeshStandardMaterial({color:'#161419',roughness:.9}));
  screen.name = 'ScreenGui'; group.add(screen);
  const seen = new Set<string>();
  function add(parentId: string | undefined, x: number, y: number, w: number, h: number, depth: number) {
    for (const [index, el] of recipe.elements.entries()) {
      if (el.parentId !== parentId || seen.has(el.id)) continue;
      seen.add(el.id);
      const ew = Math.max(1,el.size[0]*w+el.size[1]), eh = Math.max(1,el.size[2]*h+el.size[3]);
      const ex = x+el.position[0]*w+el.position[1]-(el.anchorPoint?.[0]??0)*ew;
      const ey = y+el.position[2]*h+el.position[3]-(el.anchorPoint?.[1]??0)*eh;
      const transparent = el.backgroundColor === 'transparent';
      const material = new THREE.MeshStandardMaterial({color:transparent?'#51424c':el.backgroundColor,transparent,opacity:transparent?.2:1,roughness:.85});
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(ew*scale,eh*scale,.035),material);
      mesh.name=el.name; mesh.userData.partId=el.id; mesh.userData.parentId=parentId;
      mesh.position.set((ex+ew/2-width/2)*scale,(height/2-ey-eh/2)*scale,.08+depth*.18+index*.002);
      group.add(mesh);
      if (el.text && typeof document !== 'undefined') {
        const canvas=document.createElement('canvas'); canvas.width=Math.min(2048,Math.max(128,Math.round(ew))); canvas.height=Math.min(1024,Math.max(64,Math.round(eh)));
        const context=canvas.getContext('2d');
        if(context){context.clearRect(0,0,canvas.width,canvas.height);context.fillStyle=el.textColor??'#ffffff';context.textAlign='center';context.textBaseline='middle';context.font=`500 ${Math.max(12,Math.min(32,canvas.height*.4))}px sans-serif`;context.fillText(el.text,canvas.width/2,canvas.height/2,canvas.width-8);
          const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
          const label=new THREE.Mesh(new THREE.PlaneGeometry(ew*scale,eh*scale),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));label.name=`${el.name} text`;label.userData.partId=el.id;label.position.z=.019;mesh.add(label);
        }
      }
      add(el.id,ex,ey,ew,eh,depth+1);
    }
  }
  add(undefined,0,0,width,height,0);group.updateMatrixWorld(true); return group;
}
