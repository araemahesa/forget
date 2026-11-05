// Isolated rendering of the real components with explicit provider/IPC fixtures.
// This does not certify the incomplete application's build or live providers.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const esbuild = require(process.env.FORGEKIT_ESBUILD_MODULE || 'esbuild');
const { chromium } = require(process.env.FORGEKIT_PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/test-evidence/2026-10-31/prompt-layout');
const modules = {
  '@forgekit/contracts': `export const validateSnapshotToolReceipt=()=>false; export const validateAnimationRecipe=()=>[],validateCutsceneRecipe=()=>[],validateGuiRecipe=()=>[],validateModel3dRecipe=()=>[],validateMusicRecipe=()=>[],validateNpcDialogueRecipe=()=>[],validateTexture3dRecipe=()=>[],validateVfxRecipe=()=>[],validateSkyboxRecipe=()=>[];`,
  '@tauri-apps/api/core': `export const isTauri=()=>false;`,
  '@tauri-apps/api/event': `export const listen=async()=>()=>{};`,
  featureSelection: `export const useFeatureProviderSelection=()=>window.fixture.selection; export const getFeatureChoice=()=>window.fixture.selection?.choice ?? '';`,
  providerState: `export const useProviders=()=>window.fixture.selection;`,
  accountState: `export const useDiscordAccount=()=>({account:{profile:null}});`,
  studioState: `export const useStudioSnapshot=()=>null; export const acquireStudioTask=()=>()=>{}; export const refreshStudioContext=async()=>null;`,
  providerUsage: `export const useProviderUsage=()=>[]; export const refreshUsageAfterTask=async()=>{};`,
  tauri: `export const call=async(command,args)=>{window.calls.push({type:'ipc',command,args});if(command==='list_creative_versions')return [];if(command==='generate_creative')return {id:'fixture-version',engineVersion:1,artifact:{sha256:'fixture'},document:{kind:args.request.kind,recipe:{}}};if(command==='get_creative_task')return {id:args.id,status:'completed'};return null;};`,
  references: `export const referenceAccept='.png,.txt'; export const referenceFormats='PNG, teks'; export const readReference=async(file)=>({name:file.name,kind:'text',text:'fixture',summary:'Teks uji'});`,
  editorAi: `export const generateEditorRecipe=async(args)=>{window.calls.push({type:'editor',prompt:args.prompt});if(window.fixture.fail)throw Error('Provider tidak tersedia');return {spec:{name:'Fixture'}};};`,
  ai: `export const listChatThreads=async()=>[]; export const loadChatThread=async()=>[]; export const latestChatTurn=async()=>null; export const deleteChatThread=async()=>{}; export const cancelChatStream=async()=>{}; export const createChatThread=async()=>({id:'fixture-thread',title:'Fixture'}); export const sendChatMessage=async(_id,text)=>{window.calls.push({type:'chat',prompt:text});return {id:'answer',role:'assistant',content:'Hasil uji'};};`,
  TaskRecovery: `export const TaskRecovery=()=>null;`,
  TaskAttempts: `export const TaskAttempts=()=>null;`,
  OrcaUsagePanel: `export const OrcaUsagePanel=()=>null;`,
  MessageAvatar: `export const MessageAvatar=()=>null;`,
  MessageContent: `export const MessageContent=({content})=><p>{content}</p>;`,
  BrandMark: `export const BrandMark=()=> <span>F</span>;`,
  StudioConnection: `export const StudioConnection=()=>null;`,
  LibraryPage: `export const LibraryPage=()=>null;`,
  Button: `export const Button=props=><button {...props} className={'button '+(props.className||'')}/>;`,
  Status: `export const Status=({children})=><span>{children}</span>;`,
};
const entry = `
import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {ReferenceImages} from '/Users/ariardianto/Documents/ForgeKIT/CODE/apps/desktop/src/features/shared/ReferenceImages.tsx';
function Attachments(){const [files,setFiles]=useState([]);return <section className="prompt-composer"><ReferenceImages value={files} onChange={setFiles}/></section>}
import {CreativeControls} from '${path.join(root, 'apps/desktop/src/features/create/CreativeControls.tsx')}';
import {EditorAiPromptBar} from '${path.join(root, 'apps/desktop/src/features/shared/EditorAiPromptBar.tsx')}';
import {ChatPage} from '${path.join(root, 'apps/desktop/src/features/chat/ChatPage.tsx')}';
import {useCreativeTask} from '${path.join(root, 'apps/desktop/src/features/create/useCreativeTask.ts')}';
function QualityProbe({kind}){const task=useCreativeTask(kind);return <><button onClick={()=>void task.run('Buat karya',null)}>Generate probe</button><button onClick={()=>void task.run('Sempurnakan karya','saved-parent')}>Refine probe</button></>}
const view=createRoot(document.getElementById('root'));
window.calls=[]; let serial=0;
window.configure=({mode='generator',kind='model3d',ready=true,busy=false,fail=false}={})=>{
 localStorage.clear();window.calls=[];
 const account={id:'fixture',name:'Akun uji',providerType:'openai',model:'fixture-model',isDefault:true};
 const modelSelection={account,provider:account,modelId:ready?'fixture-model':'',models:[{id:'fixture-model',displayName:'Model dengan nama panjang untuk menguji perataan',reasoningEfforts:['high'],toolCalling:'supported'}],effort:'high',selected:{displayName:'Model dengan nama panjang untuk menguji perataan',reasoningEfforts:['high'],toolCalling:'supported'},error:'',selectionError:'',loading:false,setModel:()=>{},setEffort:()=>{},refresh:async()=>{}};
 const selection={profiles:[account],connectionProfiles:[],provider:ready?account:null,defaultProvider:account,effectiveAccount:account,modelSelection,isCustomOverride:false,choice:'fixture',setChoice:()=>{},promoteToPrimary:async()=>{},snapshot:()=>({providerId:'fixture',modelId:'fixture-model',reasoningEffort:'high'})};
 window.fixture={selection,fail};
 const task={...selection,kind,providerChoice:'fixture',setProviderChoice:()=>{},busy,generating:busy,cancelling:false,stop:async()=>window.calls.push({type:'stop'}),run:async(prompt,parent)=>window.calls.push({type:'generator',prompt,parent}),versions:[],version:mode==='refine'?{id:'saved-parent',document:{kind:'model3d',recipe:{name:'Gerbang tersimpan'}}}:null,setRecovering:()=>{},recovered:()=>{}};
 view.render(<div key={++serial} className={['generator','refine'].includes(mode)?'generator-inspector':''}>{mode==='quality-probe'?<QualityProbe kind={kind}/>:mode==='attachments'?<Attachments/>:mode==='chat'?<ChatPage onOpenVersion={()=>{}}/>:mode==='editor'?<EditorAiPromptBar kind="gfx" onApplySpec={()=>window.calls.push({type:'applied'})} disabled={busy}/>:<CreativeControls task={task} initialPrompt=""/>}</div>);
};
window.configure();
`;
const baseStyles = `
body{margin:0;padding:24px}#root{max-width:1000px;margin:auto}.generator-inspector{width:min(100%,360px)}.chat-empty-state,.chat-header{display:none}.chat-container,.chat-main{display:block;min-width:0}.chat-messages{max-height:120px;overflow:auto}.chat-composer{position:static!important;padding:0!important}.chat-composer-box{max-width:none!important}@media(max-width:480px){body{padding:16px}}
`;
(async () => {
 await fs.mkdir(output,{recursive:true});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'forgekit-prompt-layout-'));
 const build=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},nodePaths:JSON.parse(process.env.FORGEKIT_REVIEW_NODE_PATHS||'[]'),plugins:[{name:'explicit-fixtures',setup(build){build.onResolve({filter:/.*/},args=>{const name=modules[args.path]?args.path:path.basename(args.path);if(modules[name])return {path:name,namespace:'fixture'};});build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'tsx',resolveDir:root}));}}]});
 const css=await fs.readFile(path.join(root,'apps/desktop/src/app/workspace-layout.css'),'utf8');
 const nativeCss=await fs.readFile(path.join(root,'.forgekit-rebuild/native-frontend/assets/index-BLzujKwK.css'),'utf8');
 const html=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pratinjau komponen — data uji</title><style>${nativeCss}\n${css}\n${baseStyles}</style><div id="root"></div><script>${build.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></html>`;
 await fs.writeFile(path.join(temp,'index.html'),html);
 await fs.writeFile(path.join(output,'preview.html'),html);
 const server=http.createServer(async(req,res)=>{if(req.url?.startsWith('/branding/')){const asset=path.resolve(root,'.forgekit-rebuild/native-frontend','.'+req.url);if(asset.startsWith(path.join(root,'.forgekit-rebuild/native-frontend/branding/'))){try{res.setHeader('Content-Type',req.url.endsWith('.svg')?'image/svg+xml':'image/png');return res.end(await fs.readFile(asset));}catch{res.statusCode=404;return res.end();}}}res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const errors=[],cases=[],captures=[];
 try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const mode of ['generator','editor','chat'])for(const theme of ['dark','light'])for(const density of ['comfortable','compact'])for(const width of [1920,1440,1280,1024,720,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.evaluate(density=>document.documentElement.dataset.density=density,density);
   const kinds=mode==='generator'?['model3d','animation','vfx','interface','npc','cutscene','music','sky']:['gfx'];
   for(const kind of kinds){
    await page.evaluate(({mode,kind})=>window.configure({mode,kind}),{mode,kind});
    const card=page.locator('.prompt-composer').first();await card.waitFor();
    assert.equal(await card.getByText('Pengaturan hasil',{exact:true}).count(),0);
    assert.equal(await card.getByRole('combobox',{name:'Kualitas generator'}).count(),0);
    const geometry=await card.evaluate(el=>({card:el.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>window.innerWidth,items:[...el.querySelectorAll('textarea,button,[role=combobox]')].filter(x=>x.checkVisibility()).map(x=>({tag:x.tagName,name:x.getAttribute('aria-label')||x.title||x.textContent,rect:x.getBoundingClientRect().toJSON()}))}));
    if(geometry.items.some(x=>x.rect.height<30||x.rect.width<30||x.rect.right>geometry.card.right+1)){await card.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({mode,kind,width,...geometry},null,2));}
    assert(!geometry.overflow,`${mode}/${kind}/${width}: page overflow`);
    for(const item of geometry.items){assert(item.rect.x>=geometry.card.x&&item.rect.right<=geometry.card.right+1,`${mode}/${kind}/${width}: ${item.tag} overflows card`);assert(item.rect.height>=30&&item.rect.width>=30,`${mode}/${kind}/${width}: ${item.tag} is clipped`);}assert.equal(await card.getByRole('combobox').count(),3);
    const input=card.locator('textarea');await input.focus();
    assert(await card.evaluate(el=>getComputedStyle(el).borderColor===getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||getComputedStyle(el).boxShadow!=='none'),'Missing focus indication');
    cases.push({mode,kind,theme,density,width});
    if((width===1440||width===390)&&kind===kinds[0]&&density==='comfortable'){await input.fill('Buat gerbang fantasy dengan ukiran merah dan lentera hangat.');await input.blur();const name=`${mode}-${theme}-${width}.png`;await card.screenshot({path:path.join(output,name)});captures.push(name);}
   }
  }
  for(const mode of ['attachments','refine'])for(const theme of ['dark','light'])for(const density of ['comfortable','compact'])for(const width of [1920,1440,1280,1024,720,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(({theme,density,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.density=density;window.configure({mode})},{theme,density,mode});
   const card=page.locator(mode==='refine'?'.generator-refine':'.prompt-composer');await card.waitFor();
   const ok=await card.evaluate(el=>{const b=el.getBoundingClientRect();return document.documentElement.scrollWidth<=window.innerWidth&&[...el.querySelectorAll('button,textarea')].filter(x=>x.checkVisibility()).every(x=>{const r=x.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right+1&&r.height>=30})});assert(ok,mode+' overflow');cases.push({mode,theme,density,width});
   if(mode==='refine'&&theme==='dark'&&width===390&&density==='comfortable')await card.screenshot({path:path.join(output,'refine-dark-390.png')});
  }
  await page.evaluate(()=>window.configure({mode:'refine'}));
  await page.locator('.generator-refine textarea').fill('Tambahkan lentera');await page.getByRole('button',{name:'Simpan revisi',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.calls[0].parent),'saved-parent');
  await page.evaluate(()=>window.configure({mode:'attachments'}));
  const attachment=page.getByLabel('Pilih file referensi');
  assert(await attachment.isHidden());
  await attachment.setInputFiles({name:'referensi-dengan-nama-yang-sangat-panjang.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture')});
  await page.getByRole('button',{name:'Hapus referensi referensi-dengan-nama-yang-sangat-panjang.txt'}).waitFor();
  await page.getByRole('button',{name:'Hapus referensi referensi-dengan-nama-yang-sangat-panjang.txt'}).click();
  assert.equal(await page.locator('.attachment-cards figure').count(),0);
  await attachment.setInputFiles([1,2,3,4].map(i=>({name:i+'.txt',mimeType:'text/plain',buffer:Buffer.from('Fixture')})));
  await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').textContent()).includes('Maksimal 3'));
  await page.locator('.reference-help summary').click();
  assert(await page.getByText('Seret file ke sini atau pilih file.',{exact:false}).isVisible());
  const pickerGeometry=await page.locator('.reference-picker').evaluate(el=>{const b=el.getBoundingClientRect();return [...el.querySelectorAll('span')].every(span=>{const r=span.getBoundingClientRect();return r.left>=b.left&&r.right<=b.right&&r.top>=b.top&&r.bottom<=b.bottom})});
  assert(pickerGeometry,'Attachment text escapes its button');
  await page.locator('.prompt-composer').screenshot({path:path.join(output,'attachments.png')});
  for(const mode of ['generator','editor','chat']){
   await page.evaluate(mode=>window.configure({mode}),mode);
   const card=page.locator('.prompt-composer').first(),submit=card.getByRole('button',{name:mode==='chat'?'Kirim':mode==='editor'?'Susun':'Generate',exact:true});
   await submit.waitFor();assert(await submit.isDisabled());
   await card.locator('textarea').fill('Buat gerbang fantasy');await submit.click();
   await page.waitForFunction(mode=>window.calls.some(x=>x.type===mode),mode);
   assert.equal(await page.evaluate(mode=>window.calls.filter(x=>x.type===mode).length,mode),1);
  }
  await page.evaluate(()=>window.configure({busy:true}));
  await page.getByRole('button',{name:'Stop',exact:true}).click();assert(await page.evaluate(()=>window.calls.some(x=>x.type==='stop')));
  await page.evaluate(()=>window.configure({mode:'editor',fail:true}));await page.getByRole('textbox',{name:'Prompt instruksi AI'}).fill('Uji error');await page.getByRole('button',{name:'Susun',exact:true}).click();await page.getByRole('alert').waitFor();
  await page.evaluate(()=>window.configure({ready:false}));await page.getByRole('button',{name:'Generate',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Generate',exact:true}).isDisabled());
  const qualityChecks=[];
  for(const kind of ['model3d','animation','vfx','interface','npc','cutscene','material','music','sky'])for(const refine of [false,true]){
   await page.evaluate(kind=>window.configure({mode:'quality-probe',kind}),kind);
   await page.getByRole('button',{name:refine?'Refine probe':'Generate probe',exact:true}).click();
   await page.waitForFunction(()=>window.calls.some(x=>x.command==='generate_creative'));
   const requests=await page.evaluate(()=>window.calls.filter(x=>x.command==='generate_creative').map(x=>x.args.request));
   assert.equal(requests.length,1);assert.equal(requests[0].quality,'high');assert.equal(requests[0].kind,kind);
   assert.equal(requests[0].parentVersionId,refine?'saved-parent':null);
   assert.equal(requests[0].providerId,'fixture');assert.equal(requests[0].modelId,'fixture-model');assert.equal(requests[0].reasoningEffort,'high');
   qualityChecks.push({kind,refine,quality:requests[0].quality});
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,context:'Real React components and useCreativeTask hook rendered against extracted installed ForgeKit CSS plus changed source CSS. Provider/IPC/recipe validation/file extraction are explicit fixtures. Not a native application build or live-provider test.',cases,captures,errors,qualityChecks,interactions:['no output settings or quality control','high quality on generate/refine across nine supported creative kinds','frozen provider/model/effort unchanged','empty input disabled','one dispatch per submit in three components','generator stop','provider error visible','no provider disabled']},null,2));
  for(const name of ['failure.png','failure.json'])await fs.rm(path.join(output,name),{force:true});
  console.log(`Passed ${cases.length} component layout cases and prompt interaction checks.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
