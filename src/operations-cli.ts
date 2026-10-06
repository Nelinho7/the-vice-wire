import {sourceRegistry} from './source-registry.ts';
import {specialistScheduler} from './specialist-runner.ts';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { SqliteRepository } from './store.ts';
import { CostBudget,budgetStatus } from './budget.ts';
import { operationsConfig } from './operations-config.ts';
import { OpenAIProvider,FixtureProvider,extractionProvider } from './providers.ts';
import { fixtures } from './fixtures.ts';
import { contentFingerprint } from './fingerprints.ts';
import { ScanScheduler,sourceHealth } from './scheduler.ts';
import type { ScannableSource } from './scheduler.ts';
import { YouTubeAdapter,YouTubeClient,assertYouTubeAccess } from './youtube.ts';
import { runPipeline } from './pipeline.ts';
import { validateExtraction } from './model.ts';
import type { SourceItem } from './model.ts';
import { safeError,redactSecrets } from './security.ts';
const command=process.argv[2],args=process.argv.slice(3),config=operationsConfig();
const flag=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const fixtureSource:ScannableSource={id:'fixture',platform:'fixture',scan:async({checkpoint,limit})=>{const offset=Number(checkpoint.cursor??0),batch=fixtures.slice(offset,offset+limit).map(f=>structuredClone(f.source));return {items:batch,checkpoint:{cursor:String(Math.min(fixtures.length,offset+batch.length))}};}};
let repo:SqliteRepository|undefined;
const open=()=>repo??=new SqliteRepository(config.dbPath);
const output=(v:unknown)=>console.log(JSON.stringify(redactSecrets(v),null,2));
const requireOpenAI=()=>{if(!process.env.OPENAI_API_KEY)throw Error('Add OPENAI_API_KEY to local .env; no paid call made');};
try{
  if(command==='budget')output(budgetStatus(open()));
  else if(command==='checkpoints')output(sourceHealth(open()));
  else if(command==='llm-smoke'){
    requireOpenAI();const r=open(),provider=new OpenAIProvider(new CostBudget(r,{...config,runBudget:Math.min(config.runBudget,0.05)}));
    const samples=[
      {text:'lol sunset screenshot. GTA 6 hype, best game ever!!!',expected:'NO_INTEL'},
      {text:'ok so i tested full upgraded Acid Lab stock today in invite-only GTA Online, got about GTA$350,000. not the public lobby bonus.',expected:'INTEL'},
      {text:'That GTA Online Casino Heist board workaround is wrong for me: switching sessions did not fix the freeze. Tried twice on PC.',expected:'INTEL'}
    ];
    const results=[];
    for(const [i,sample] of samples.entries()){
      const source:SourceItem={id:'smoke:llm:'+i,platform:'llm-smoke',sourceId:String(i),url:'https://example.invalid/llm-smoke/'+i,author:null,title:'Synthetic messy GTA text',text:sample.text,timestamp:new Date().toISOString(),ingestedAt:new Date().toISOString(),engagement:{score:0},raw:{synthetic:true},independenceKey:'smoke:'+i};
      const result=await provider.extract(source),parsed=validateExtraction(result.output,source.title+'\n'+source.text);
      results.push({sample:i+1,expected:sample.expected,kind:parsed.kind,matchedExpectation:parsed.kind===sample.expected,usage:result.usage});
    }
    output({results,inputTokens:results.reduce((n,r)=>n+(r.usage.inputTokens??0),0),outputTokens:results.reduce((n,r)=>n+(r.usage.outputTokens??0),0),estimatedCost:results.some(r=>r.usage.estimatedCost===null)?null:results.reduce((n,r)=>n+r.usage.estimatedCost!,0),note:'Provider token usage, estimated USD at configured rates; not an invoice. Synthetic samples, no live community data.'});
    if(results.some(r=>!r.matchedExpectation))process.exitCode=1;
  }
  else if(command==='youtube-auth'){assertYouTubeAccess();output(await new YouTubeClient(open()).auth());}
  else if(command==='youtube-smoke'){
    assertYouTubeAccess();const scheduler=new ScanScheduler(open(),new FixtureProvider(),[new YouTubeAdapter(open())],{processEnabled:false});
    output(await scheduler.scan('youtube',{reason:'tiny metadata/comment validation'}));
    if(scheduler.state('youtube')?.health==='error')process.exitCode=1;
  }
  else if(command==='youtube-process'){
    requireOpenAI();const r=open(),items=r.sources().filter(s=>s.platform==='youtube');if(items.length>10)throw Error('YouTube processing is limited to the 10-item validation pilot');
    output(await runPipeline(r,{name:'youtube-stored',fetchItems:async()=>items},new OpenAIProvider(new CostBudget(r,{...config,runBudget:Math.min(config.runBudget,0.05)}))));
  }
  else if(['scan','target'].includes(command)&&sourceRegistry().some(s=>s.id===flag('--source'))){
    const source=sourceRegistry().find(s=>s.id===flag('--source'))!;if(!source.enabled)throw Error('Specialist source access is disabled: '+source.id);
    const scheduler=specialistScheduler(open(),{sources:[source]});output(command==='target'?await scheduler.targetedScan(source.id,{reason:flag('--reason')||'targeted specialist verification',topic:flag('--topic')}):await scheduler.scan(source.id,{reason:'manual specialist collection'}));
  }
  else if(['scan','schedule','target'].includes(command)){
    const ids=command==='schedule'?(process.env.SCHEDULED_SOURCES||'fixture').split(','):[flag('--source')||'fixture'];
    if(ids.some(s=>s!=='fixture'&&s!=='youtube'))throw Error('Only fixture and the bounded YouTube pilot are registered; Reddit/Twitch/Discord are excluded');
    if(command==='schedule'&&!config.scheduledEnabled)throw Error('Scheduler is disabled; set SCHEDULER_ENABLED=true locally only when ready');
    if(command==='schedule'&&ids.includes('youtube'))throw Error('Continuous YouTube scanning is deferred; use the tiny manual pilot first');
    if(ids.includes('youtube'))assertYouTubeAccess();
    const mode=process.env.EXTRACTOR_MODE??'fixture';
    if(ids.includes('youtube')&&mode==='fixture')throw Error('Live YouTube requires EXTRACTOR_MODE=openai or llm; use youtube:smoke for collection without AI');
    if(mode!=='fixture'&&!config.paidApproved)throw Error('Paid scans require explicit PAID_PROCESSING_APPROVED=true; tiny llm:smoke and youtube:process remain available');
    if(mode==='openai')requireOpenAI();
    const r=open(),sources=ids.map(id=>id==='fixture'?fixtureSource:new YouTubeAdapter(r));
    const priority=JSON.parse(readFileSync(new URL('../config/processing-priority.json',import.meta.url),'utf8'));
    const scheduler=new ScanScheduler(r,extractionProvider(new CostBudget(r)),sources,{priority});
    const controller=new AbortController();const stop=()=>{scheduler.stop();controller.abort();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
    if(command==='schedule'){
      output({enabled:true,intervalMinutes:config.scanIntervalMs/60000,sources:ids,stop:'Ctrl+C; waits for the active scan and releases its lease.'});
      while(!scheduler.stopping){const results=await scheduler.tick();if(results.length)output(results);try{await sleep(1000,undefined,{signal:controller.signal});}catch{break;}}
    }else{
      const context=command==='target'?{reason:flag('--reason')||'manual targeted scan',topic:flag('--topic'),videoIds:flag('--video-id')?[flag('--video-id')!]:undefined}:undefined;
      const result=context?await scheduler.targetedScan(ids[0],context):await scheduler.scan(ids[0]);output(result);
      if((result as any).health==='error')process.exitCode=1;
    }
  }else throw Error('Use llm-smoke, youtube-auth, youtube-smoke, youtube-process, scan, schedule, target, checkpoints or budget');
}catch(error){console.error(safeError(error));process.exitCode=1;}finally{repo?.close();}
