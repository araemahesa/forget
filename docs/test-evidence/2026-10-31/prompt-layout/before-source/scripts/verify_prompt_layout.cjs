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
const output = path.join(root, 'docs/test-evidence/2026-10-30/prompt-layout');
const modules = {
  '@forgekit/contracts': `export const qualityProfiles={fast:{label:'Cepat',maxParts:32},balanced:{label:'Seimbang',maxParts:64},high:{label:'Tinggi',maxParts:128}}; export const validateSnapshotToolReceipt=()=>false;`,
  '@tauri-apps/api/core': `export const isTauri=()=>false;`,
  '@tauri-apps/api/event': `export const listen=async()=>()=>{};`,
  featureSelection: `export const useFeatureProviderSelection=()=>window.fixture.selection;`,
  providerState: `export const useProviders=()=>window.fixture.selection;`,
  accountState: `export const useDiscordAccount=()=>({account:{profile:null}});`,
  studioState: `export const useStudioSnapshot=()=>null; export const acquireStudioTask=()=>()=>{}; export const refreshStudioContext=async()=>null;`,
  providerUsage: `export const useProviderUsage=()=>[]; export const refreshUsageAfterTask=async()=>{};`,
  tauri: `export const call=async(command)=>{window.calls.push({type:'ipc',command});return null;};`,
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
import {CreativeControls} from '${path.join(root, 'apps/desktop/src/features/create/CreativeControls.tsx')}';
import {EditorAiPromptBar} from '${path.join(root, 'apps/desktop/src/features/shared/EditorAiPromptBar.tsx')}';
import {ChatPage} from '${path.join(root, 'apps/desktop/src/features/chat/ChatPage.tsx')}';
const view=createRoot(document.getElementById('root'));
window.calls=[]; let serial=0;
window.configure=({mode='generator',kind='model3d',ready=true,busy=false,fail=false}={})=>{
 localStorage.clear();window.calls=[];
 const account={id:'fixture',name:'Akun uji',providerType:'fixture-provider',model:'fixture-model',isDefault:true};
 const modelSelection={account,provider:account,modelId:ready?'fixture-model':'',models:[{id:'fixture-model',displayName:'Model dengan nama panjang untuk menguji perataan',reasoningEfforts:['high'],toolCalling:'supported'}],effort:'high',selected:{displayName:'Model dengan nama panjang untuk menguji perataan',reasoningEfforts:['high'],toolCalling:'supported'},error:'',selectionError:'',loading:false,setModel:()=>{},setEffort:()=>{},refresh:async()=>{}};
 const selection={profiles:[account],connectionProfiles:[],provider:ready?account:null,defaultProvider:account,effectiveAccount:account,modelSelection,choice:'fixture',setChoice:()=>{},promoteToPrimary:async()=>{},snapshot:()=>({})};
 window.fixture={selection,fail};
 const task={...selection,kind,providerChoice:'fixture',setProviderChoice:()=>{},quality:'balanced',setQuality:()=>{},busy,generating:busy,cancelling:false,stop:async()=>window.calls.push({type:'stop'}),run:async(prompt)=>window.calls.push({type:'generator',prompt}),versions:[],version:null,setRecovering:()=>{},recovered:()=>{}};
 view.render(<div key={++serial}>{mode==='chat'?<ChatPage onOpenVersion={()=>{}}/>:mode==='editor'?<EditorAiPromptBar kind="gfx" onApplySpec={()=>window.calls.push({type:'applied'})} disabled={busy}/>:<CreativeControls task={task} initialPrompt=""/>}</div>);
};
window.configure();
`;
const baseStyles = `
:root{--bg:#0c0b0d;--surface:#151215;--surface-raised:#211c21;--border:#312b30;--border-control:#443941;--text:#f2eef1;--text-secondary:#c7bec5;--text-muted:#978c94;--accent:#f40941;--shadow:#0003;--control-height:36px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;color:var(--text);background:var(--bg)}
:root[data-theme=light]{--bg:#f5f2f4;--surface:#fff;--surface-raised:#f4eff2;--border:#e0d6dc;--border-control:#d0c3cb;--text:#20181e;--text-secondary:#51434d;--text-muted:#786773}
body{margin:0;padding:24px}#root{max-width:1000px;margin:auto}button,a,summary{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}a{color:var(--text-secondary);text-decoration:none}.icon{width:18px;height:18px;flex-shrink:0}.button,.theme-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--border);background:var(--surface-raised);color:var(--text);text-decoration:none}.primary-button{background:var(--accent);color:white;border-color:transparent}.theme-button{padding:8px;border-radius:8px}.select-control{display:block;min-width:0}.dropdown{display:flex;align-items:center;justify-content:space-between;gap:6px;width:100%;min-width:0;padding:6px 10px;border:1px solid var(--border);color:var(--text);text-align:left}.dropdown-value{flex:1}.dropdown-menu{position:fixed;z-index:100;box-sizing:border-box;list-style:none;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:6px;margin:0;overflow:auto}.dropdown-menu [role=option]{padding:10px;display:flex;align-items:center;justify-content:space-between;cursor:pointer}.dropdown-menu [data-highlighted]{background:var(--surface-raised)}.chat-empty-state,.chat-header{display:none}.chat-container,.chat-main{display:block;min-width:0}.chat-messages{max-height:120px;overflow:auto}.generator-versions{margin-top:16px}.provider-logo{display:inline-flex}.status-error{color:var(--accent)}@media(max-width:480px){body{padding:16px}}
`;
(async () => {
 await fs.mkdir(output,{recursive:true});
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'forgekit-prompt-layout-'));
 const build=await esbuild.build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,write:false,jsx:'automatic',tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},nodePaths:JSON.parse(process.env.FORGEKIT_REVIEW_NODE_PATHS||'[]'),plugins:[{name:'explicit-fixtures',setup(build){build.onResolve({filter:/.*/},args=>{const name=modules[args.path]?args.path:path.basename(args.path);if(modules[name])return {path:name,namespace:'fixture'};});build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:modules[args.path],loader:'tsx',resolveDir:root}));}}]});
 const css=await fs.readFile(path.join(root,'apps/desktop/src/app/workspace-layout.css'),'utf8');
 const html=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pratinjau komponen — data uji</title><style>${baseStyles}\n${css}</style><div id="root"></div><script>${build.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></html>`;
 await fs.writeFile(path.join(temp,'index.html'),html);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const errors=[],cases=[],captures=[];
 try {
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for(const mode of ['generator','editor','chat'])for(const theme of ['dark','light'])for(const width of [1440,760,390,320]){
   await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const kinds=mode==='generator'?['model3d','animation','vfx','interface','npc','cutscene','music','sky']:['gfx'];
   for(const kind of kinds){
    await page.evaluate(({mode,kind})=>window.configure({mode,kind}),{mode,kind});
    const card=page.locator('.prompt-composer').first();await card.waitFor();
    const geometry=await card.evaluate(el=>({card:el.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>window.innerWidth,items:[...el.querySelectorAll('textarea,button,[role=combobox]')].filter(x=>x.checkVisibility()).map(x=>({tag:x.tagName,name:x.getAttribute('aria-label')||x.title||x.textContent,rect:x.getBoundingClientRect().toJSON()}))}));
    if(geometry.items.some(x=>x.rect.height<30||x.rect.width<30||x.rect.right>geometry.card.right+1)){await card.screenshot({path:path.join(output,'failure.png')});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify({mode,kind,width,...geometry},null,2));}
    assert(!geometry.overflow,`${mode}/${kind}/${width}: page overflow`);
    for(const item of geometry.items){assert(item.rect.x>=geometry.card.x&&item.rect.right<=geometry.card.right+1,`${mode}/${kind}/${width}: ${item.tag} overflows card`);assert(item.rect.height>=30&&item.rect.width>=30,`${mode}/${kind}/${width}: ${item.tag} is clipped`);}assert.equal(await card.getByRole('combobox').count(),3);
    const input=card.locator('textarea');await input.focus();
    assert(await card.evaluate(el=>getComputedStyle(el).borderColor===getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||getComputedStyle(el).boxShadow!=='none'),'Missing focus indication');
    cases.push({mode,kind,theme,width});
    if((width===1440||width===390)&&kind===kinds[0]){const name=`${mode}-${theme}-${width}.png`;await card.screenshot({path:path.join(output,name)});captures.push(name);}
   }
  }
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
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({ok:true,context:'Real React prompt components with explicit local fixtures; missing global styles replaced by fixture tokens. Not a full application build or live-provider test.',cases,captures,errors,interactions:['empty input disabled','one dispatch per submit in three components','generator stop','provider error visible','no provider disabled']},null,2));
  for(const name of ['failure.png','failure.json'])await fs.rm(path.join(output,name),{force:true});
  console.log(`Passed ${cases.length} component layout cases and prompt interaction checks.`);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
