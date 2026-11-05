// Run against pnpm --filter @forgekit/desktop exec vite preview --host 127.0.0.1 --port 1431 --strictPort.
const {chromium}=require(process.env.FORGEKIT_PLAYWRIGHT_MODULE || 'playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'docs/test-evidence/2026-10-31/recovery-build');
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const cases=[],errors=[];
 try{
 const routes=['chat','create/model-3d','create/animation','create/vfx','create/visual','create/visual?mode=thumbnail','create/visual?mode=icon','create/visual?mode=clothing','create/audio','create/audio?mode=music','create/cutscene','create/interface','create/npc','create/sky','settings'];
 const sizes=[[1920,1080],[1440,900],[1280,800],[1024,700],[720,450]];
 for(const [width,height] of sizes){
 const context=await browser.newContext({viewport:{width,height}});
 const page=await context.newPage(); page.on('pageerror',e=>errors.push({width,message:e.message}));
 for(const route of routes){
 await page.goto('about:blank');
 await page.goto('http://127.0.0.1:1431/#'+route);
 await page.locator('.page-body>div:not([hidden])').waitFor();
 await page.waitForFunction(()=>!!document.querySelector('.page-body>div:not([hidden]) h1, .page-body>div:not([hidden]) textarea, .settings-page'));
 await page.locator('.page-body>div:not([hidden])').evaluate(async el=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))});
 const result=await page.evaluate(()=>({width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.querySelector('.breadcrumb')?.textContent,composers:[...document.querySelectorAll('.prompt-composer')].filter(x=>x.checkVisibility()).map(el=>({width:el.getBoundingClientRect().width,clipped:[...el.querySelectorAll('textarea,button,select')].filter(x=>x.checkVisibility()).filter(x=>{const a=x.getBoundingClientRect(),b=el.getBoundingClientRect();return a.left<b.left-1||a.right>b.right+1||a.width<24||a.height<24}).map(x=>x.getAttribute('aria-label')||x.textContent.trim())})),brokenImages:[...document.images].filter(x=>x.checkVisibility()&&(!x.complete||!x.naturalWidth)).map(x=>x.getAttribute('src')),badStages:[...document.querySelectorAll('.three-stage')].filter(x=>x.checkVisibility()).filter(x=>{const c=x.querySelector('canvas');return c&&c.getBoundingClientRect().bottom>x.getBoundingClientRect().bottom+1}).length,body:document.body.innerText.slice(0,300)}));
 cases.push({route,width,height,...result});
 console.log(`Rendered ${route} at ${width}×${height}`);
 if(width===1280||result.scrollWidth>width||result.composers.some(x=>x.clipped.length)||result.brokenImages.length||result.badStages)await page.screenshot({path:path.join(out,'browser-'+route.replace(/[^a-z0-9]/gi,'-')+'-'+width+'.png'),fullPage:false});
 }
 await context.close();
 }
 await fs.writeFile(path.join(out,'browser-smoke.json'),JSON.stringify({ok:!errors.length&&!cases.some(x=>x.scrollWidth>x.width||x.composers.some(c=>c.clipped.length)||x.brokenImages.length||x.badStages),context:'Production frontend in Chrome, no mocked IPC. Native-required states expected. Does not verify native IPC/provider/Studio.',cases,errors},null,2));
 await fs.rm(path.join(out,'browser-smoke-failure.json'),{force:true});
 console.log(JSON.stringify({cases:cases.length,errors,overflow:cases.filter(x=>x.scrollWidth>x.width).map(x=>({route:x.route,width:x.width,scrollWidth:x.scrollWidth})),clipped:cases.filter(x=>x.composers.some(c=>c.clipped.length)).map(x=>({route:x.route,width:x.width,composers:x.composers}))},null,2));
 if(errors.length||cases.some(x=>x.scrollWidth>x.width||x.composers.some(c=>c.clipped.length)||x.brokenImages.length||x.badStages))process.exitCode=1;
 }catch(error){await fs.writeFile(path.join(out,'browser-smoke-failure.json'),JSON.stringify({ok:false,cases,errors,error:String(error)},null,2));throw error;}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
