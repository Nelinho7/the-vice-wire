import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteRepository } from '../src/store.ts';
import { pilotConfig,assertLLMAccess } from '../src/pilot-config.ts';
import { RedditClient,RedditAdapter,redditPost,redditComments } from '../src/reddit.ts';
import { CompatibleLLMProvider } from '../src/providers.ts';
import { BudgetedProvider,PilotLimitError,budgetLedger } from '../src/pilot-budget.ts';
import { runPipeline } from '../src/pipeline.ts';
import { authenticatePilot,collectPilot,processPilot,approvePilotStage,resetLivePilot } from '../src/pilot.ts';
import { pilotReport } from '../src/pilot-report.ts';
import { saveHumanEvaluation } from '../src/human-evaluation.ts';
import { filter,normalize,scoreConfidence } from '../src/intelligence.ts';
import { fixtures,fixtureNow } from '../src/fixtures.ts';
import type { SourceItem,Claim,Evidence } from '../src/model.ts';
const config={...pilotConfig(),requestDelayMs:0,pilotId:'test-pilot',otherCost:0};
function credentials(){const keys=['REDDIT_ACCESS_APPROVED','REDDIT_ACCESS_TOKEN','REDDIT_USER_AGENT'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));Object.assign(process.env,{REDDIT_ACCESS_APPROVED:'true',REDDIT_ACCESS_TOKEN:'mock-only',REDDIT_USER_AGENT:'test-only'});return ()=>{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}};}
function post(id='abc',sub='gtaonline'){return {name:'t3_'+id,title:'What business should I buy next for solo money?',selftext:'I play solo and own an Acid Lab. What would you recommend?',permalink:`/r/${sub}/comments/${id}/question/`,subreddit:sub,created_utc:Date.parse(fixtureNow)/1000,score:1000,author:'poster'+id,num_comments:20};}
function comment(id:string,thread:string,parent:string,body:string,replies:any=''){return {kind:'t1',data:{name:'t1_'+id,link_id:'t3_'+thread,parent_id:parent,body,created_utc:Date.parse(fixtureNow)/1000,score:15,author:'author'+id,replies}};}
function conversation(thread='abc'){const child=comment(thread+'b',thread,'t1_'+thread+'a','Switching sessions fixed my mission bug twice.');const parent=comment(thread+'a',thread,'t3_'+thread,'Get the Kosatka for solo heists because you can run Cayo Perico alone.',{data:{children:[child]}});return [{data:{children:[{kind:'t3',data:post(thread)}]}},{data:{children:[parent,{kind:'more',data:{children:['omitted']}}]}}];}
function response(body:any,status=200,headers:Record<string,string>={}){return new Response(JSON.stringify(body),{status,headers});}
function source(id='abc'):SourceItem{return redditPost(post(id),config,'gtaonline:new:');}
const candidate=normalize((fixtures[0].extraction as any).candidates[0]);
const claim:Claim={...candidate,id:'claim',firstDetected:fixtureNow,lastCorroborated:null,status:'UNVERIFIED',confidence:0,evidenceCount:0,breakdown:{},review:null};
function evidence(s:SourceItem,i:number,stance:'supports'|'contradicts'='supports'):Evidence{return {id:'e'+i,claimId:claim.id,sourceId:s.id,stance,candidate:{...candidate,stance,quote:s.text},match:{kind:i?'merge':'new'},createdAt:fixtureNow};}
test('post/comment parsing preserves conversation relationships and avoids unnecessary personal metadata',()=>{
  const p=source(),result=redditComments(conversation(),p,config);assert.equal(result.items.length,2);assert.equal(result.omittedMore,1);assert.equal(result.items[1].context!.parentId,'t1_abca');assert.match(result.items[1].context!.parentText!,/Kosatka/);assert.equal(result.items[0].context!.postBody,p.text);assert.equal(result.items[0].itemType,'comment');assert.equal(result.items[0].context!.threadId,p.sourceId);assert.ok(result.items[0].url.startsWith('https://www.reddit.com/r/'));assert.equal((p.raw as any).author_fullname,undefined);assert.throws(()=>redditComments(conversation('wrong'),p,config),/relationship/);
});
test('context does not filter out an actionable reply merely because the post asks a question',()=>{const p=source(),c=redditComments(conversation(),p,config).items[0];assert.equal(filter(p).useful,false);assert.equal(filter(c).useful,true);assert.equal(filter({...c,text:'Buy Kosatka.'}).useful,true);const request=new CompatibleLLMProvider().requestBody(c);assert.match(request.messages[1].content,/postBody/);assert.match(request.messages[0].content,/primary comment text/);});
test('sampling covers configured communities, new/hot/top/search, comments and total source cap',async()=>{
  const restore=credentials(),urls:string[]=[];let counter=0;
  const http:any=async(url:string)=>{urls.push(url);const u=new URL(url),sub=u.pathname.split('/')[2];if(u.pathname.includes('/comments/'))return response(conversation(u.pathname.split('/')[4]));const id='p'+(++counter);return response({data:{children:[{kind:'t3',data:post(id,sub)}],after:null}});};
  try{const adapter=new RedditAdapter({config,client:new RedditClient(config,http,async()=>{}),target:10});const items=await adapter.fetchItems();assert.equal(items.length,10);assert.ok(items.some(s=>s.itemType==='comment'));assert.equal(new Set(items.map(s=>s.context!.subreddit)).size,3);for(const kind of ['new','hot','top','search'])assert.ok(urls.some(u=>new URL(u).pathname.endsWith('/'+kind)),kind);assert.ok(urls.some(u=>u.includes('restrict_sr=true')));assert.ok(urls.every(u=>u.startsWith('https://oauth.reddit.com/')));}finally{restore();}
});
test('auth uses only approved OAuth community reads; 429, request cap and rate headers stop safely',async()=>{
  const restore=credentials();let calls=0;
  try{const ok=new RedditClient(config,(async(_url:any,options:any)=>{assert.equal(options.headers.Authorization,'Bearer mock-only');calls++;return response({data:{children:[]}});}) as any,async()=>{});const result=await ok.testAccess();assert.deepEqual(result.readCommunities,config.subreddits);assert.equal(calls,3);
    const rate=new RedditClient(config,(async()=>response({},429,{'retry-after':'120'})) as any,async()=>{});await assert.rejects(()=>rate.get('/r/gtaonline/new'),/429/);assert.equal(rate.requests,1);
    const capped=new RedditClient({...config,maxApiRequests:1},(async()=>response({data:{children:[]}})) as any,async()=>{});await capped.get('/r/gtaonline/new');await assert.rejects(()=>capped.get('/r/gtaonline/hot'),/cap/);
    const headers=new RedditClient(config,(async()=>response({data:{children:[]} },200,{'x-ratelimit-remaining':'0','x-ratelimit-reset':'120'})) as any,async()=>{});await headers.get('/r/gtaonline/new');await assert.rejects(()=>headers.get('/r/gtaonline/hot'),/rate window/);
  }finally{restore();}
});
test('pagination uses official listing cursors and skips known IDs',async()=>{
  const restore=credentials(),urls:string[]=[];
  const single={...config,subreddits:['gtaonline'],queries:['money'],commentsPerPost:0,maxPagesPerLane:2};
  const http:any=async(url:string)=>{urls.push(url);const u=new URL(url),kind=u.pathname.split('/').at(-1)!;const second=u.searchParams.has('after');return response({data:{children:[{kind:'t3',data:post(second?kind+'fresh':kind+'known')}],after:second?null:'t3_cursor'}});};
  try{const adapter=new RedditAdapter({config:single,client:new RedditClient(single,http,async()=>{}),target:4,knownIds:['new','hot','top','search'].map(k=>'reddit:t3_'+k+'known')});const items=await adapter.fetchItems();assert.equal(items.length,4);assert.ok(items.every(s=>s.sourceId.endsWith('fresh')));assert.ok(urls.some(u=>u.includes('after=t3_cursor')));}finally{restore();}
});
test('same-thread comments cannot verify; a same-thread contradiction lowers confidence',()=>{
  const sources=Array.from({length:10},(_,i)=>({...source('a'+i),id:'reddit:t1_x'+i,sourceId:'t1_x'+i,itemType:'comment' as const,author:'different'+i,independenceKey:'different'+i,text:'Unique supporting observation '+i,context:{...source().context!,threadId:'t3_original'}}));
  const linked=sources.map((s,i)=>evidence(s,i));const result=scoreConfidence(claim,linked,sources,fixtureNow);assert.equal(result.status,'UNVERIFIED');assert.equal(result.breakdown.independentSupporting,1);
  linked[9].stance='contradicts';const contradiction=scoreConfidence(claim,linked,sources,fixtureNow);assert.ok(contradiction.confidence<result.confidence);assert.equal(contradiction.breakdown.independentContradicting,1);
});
test('pilot call/spend guard is persistent, reserves before calls, and does not count skipped calls',async()=>{
  const r=new SqliteRepository(':memory:');let actual=0;
  const inner={extract:async()=>{actual++;assert.equal(r.usages().at(-1)!.status,'pending');return {output:{kind:'NO_INTEL',reason:'none'},usage:{stage:'EXTRACT',provider:'test',model:'test',inputTokens:10,outputTokens:5,estimatedCost:0.01}};}};
  try{const guarded=new BudgetedProvider(r,{...config,maxLLMCalls:1},inner,()=>0.05);await guarded.extract(source());assert.equal(r.usages().length,1);assert.equal(r.usages()[0].status,'complete');await assert.rejects(()=>guarded.extract(source('b')),PilotLimitError);assert.equal(actual,1);
    const zero=new BudgetedProvider(r,{...config,pilotId:'empty-budget',maxEstimatedSpend:0},inner,()=>0.05);await assert.rejects(()=>zero.extract(source('c')),/spend/);assert.equal(actual,1);
  }finally{r.close();}
});
test('unknown/interrupted costs block subsequent calls and keep costs explicitly unknown',async()=>{
  const r=new SqliteRepository(':memory:');try{const inner={extract:async()=>({output:{kind:'NO_INTEL',reason:'none'},usage:{stage:'EXTRACT',provider:'test',model:'test',inputTokens:null,outputTokens:null,estimatedCost:null}})};const guard=new BudgetedProvider(r,config,inner,()=>0.1);await guard.extract(source());await assert.rejects(()=>guard.extract(source('b')),/unknown/);assert.equal(budgetLedger(r,config).accountedCost,0.1);assert.equal(pilotReport(r,config).estimatedLLMCost,null);}finally{r.close();}
});
test('pipeline stops on call limits without errors or fake live extraction',async()=>{
  const r=new SqliteRepository(':memory:');try{const s={...source(),title:'Useful test',text:'My full stock sale paid 350k today.'};const guarded=new BudgetedProvider(r,{...config,maxLLMCalls:0},{extract:async()=>{throw Error('must not run');}},()=>0.01);const result=await runPipeline(r,{name:'test',fetchItems:async()=>[s]},guarded);assert.match(result.stopped!,/calls/);assert.equal(result.processingErrors,0);assert.equal(r.claims().length,0);assert.equal(r.usages().length,0);assert.equal(r.sources().length,1);assert.equal(r.audits().at(-1)!.stage,'LIMIT');}finally{r.close();}
});
test('cost reservation bounds serialized context and output; missing provider configuration rejects',()=>{const p=new CompatibleLLMProvider();assert.ok(p.maximumCost(source(),1,2,48000,1500)>0);assert.throws(()=>p.maximumCost(source(),1,2,1,1500),/byte limit/);const previous=process.env.LLM_API_KEY;delete process.env.LLM_API_KEY;try{assert.throws(()=>assertLLMAccess(config),/requires/);}finally{if(previous!==undefined)process.env.LLM_API_KEY=previous;}});
test('human labels are separate, versioned and validate required fields',()=>{
  const r=new SqliteRepository(':memory:');try{const s=source();r.saveSource(s);assert.throws(()=>saveHumanEvaluation(r,{sourceId:s.id,useful:'YES',showToPlayer:'YES',reviewer:'R1',notes:''}),/YES needs/);saveHumanEvaluation(r,{sourceId:s.id,useful:'NO',showToPlayer:'NO',reviewer:'R1',notes:'question only'});saveHumanEvaluation(r,{sourceId:s.id,useful:'UNCERTAIN',showToPlayer:'NO',reviewer:'R2',notes:'needs context'});assert.equal(r.evaluations().length,2);assert.equal(r.claims().length,0);assert.equal(pilotReport(r,config).humanUncertain,1);assert.equal(pilotReport(r,config).labelHistoryCount,2);}finally{r.close();}
});
test('real-pilot metrics calculate reviewed confusion, extraction, matching, feed value and top claims',()=>{
  const r=new SqliteRepository(':memory:');try{
    r.saveClaim(claim);
    for(let i=0;i<4;i++){const s=source('m'+i);r.saveSource(s);r.audit({sourceId:s.id,stage:'STORE',at:fixtureNow,result:{outcome:i<2?'intel':'rejected'}});if(i<2)r.saveEvidence(evidence(s,i));const useful=i===0||i===2?'YES':'NO';saveHumanEvaluation(r,{sourceId:s.id,useful,reviewer:'R1',category:'money',extractionQuality:i===0?'correct':'incorrect',matching:i===0?'correctly created new claim':'should have created new claim',usefulness:i===0?5:2,showToPlayer:i===0?'YES':'NO',notes:'labeled'});}
    const report=pilotReport(r,config);assert.equal(report.truePositives,1);assert.equal(report.falsePositives,1);assert.equal(report.falseNegatives,1);assert.equal(report.trueNegatives,1);assert.equal(report.precision,0.5);assert.equal(report.recall,0.5);assert.equal(report.averageUsefulnessScore,3.5);assert.equal(report.wouldShowToPlayer.rate,0.25);assert.equal(report.extractionCorrectness.rate,0.5);assert.equal(report.top20HighestConfidenceClaims.length,1);assert.equal(report.top20HighestConfidenceClaims[0].humanUsefulnessRating,5);assert.equal(report.totalPilotCost,0);
  }finally{r.close();}
});
test('live-only reset removes pilot-linked data and preserves fixture intelligence/evaluations',()=>{
  const r=new SqliteRepository(':memory:');try{r.saveSource(fixtures[0].source);r.saveClaim({...claim,id:'fixture-claim'});r.saveEvidence({...evidence(fixtures[0].source,10),claimId:'fixture-claim'});const s=source();r.saveSource(s);r.saveClaim(claim);r.saveEvidence(evidence(s,0));saveHumanEvaluation(r,{sourceId:s.id,useful:'NO',showToPlayer:'NO',reviewer:'R1',notes:'live'});r.usage({id:'u',sourceId:s.id,pilotId:config.pilotId,stage:'EXTRACT',provider:'test',model:'test',inputTokens:1,outputTokens:1,estimatedCost:0});r.setSetting('pilot:'+config.pilotId,{authenticated:true});resetLivePilot(r,config);assert.deepEqual(r.sources().map(s=>s.platform),['fixture']);assert.equal(r.claims().length,1);assert.equal(r.claims()[0].id,'fixture-claim');assert.equal(r.evaluations().length,0);assert.equal(r.usages().length,0);assert.equal(r.setting('pilot:'+config.pilotId),null);}finally{r.close();}
});
test('staged collection enforces auth, manual inspection gates and capped 10-item smoke',async()=>{
  const restore=credentials(),r=new SqliteRepository(':memory:');let count=0;
  const http:any=async(url:string)=>{const u=new URL(url),sub=u.pathname.split('/')[2];if(u.pathname.includes('/comments/'))return response(conversation(u.pathname.split('/')[4]));return response({data:{children:[{kind:'t3',data:post('stage'+(++count),sub)}],after:null}});};
  try{await assert.rejects(()=>collectPilot(r,config,'smoke',10),/auth/);await authenticatePilot(r,config,new RedditClient(config,http,async()=>{}));await assert.rejects(()=>collectPilot(r,config,'intelligence',50),/approve smoke/);const smoke=await collectPilot(r,config,'smoke',10,new RedditClient(config,http,async()=>{}));assert.equal(smoke.added,10);assert.ok(r.sources().every(s=>s.firstDetectedAt&&Number.isFinite(s.detectionLatencyMs)));approvePilotStage(r,config,'smoke','Verified parsing, URLs and context');await assert.rejects(()=>collectPilot(r,config,'pilot',200),/approve intelligence/);assert.throws(()=>approvePilotStage(r,config,'intelligence','Looks okay'),/50 processed/);assert.equal((await collectPilot(r,config,'smoke',10)).added,0);}finally{r.close();restore();}
});
test('50-item authorized-API mock flows through the existing real-provider abstraction and human stage gate',async()=>{
  const restore=credentials(),repo=new SqliteRepository(':memory:'),originalFetch=globalThis.fetch;
  const keys=['LLM_ENDPOINT','LLM_API_KEY','LLM_MODEL','LLM_INPUT_PRICE_PER_MILLION','LLM_OUTPUT_PRICE_PER_MILLION'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{LLM_ENDPOINT:'https://mock-provider.example.invalid/chat/completions',LLM_API_KEY:'test-only',LLM_MODEL:'test-model',LLM_INPUT_PRICE_PER_MILLION:'1',LLM_OUTPUT_PRICE_PER_MILLION:'1'});let count=0;
  const redditHTTP:any=async(url:string)=>{const u=new URL(url),sub=u.pathname.split('/')[2];if(u.pathname.includes('/comments/'))return response(conversation(u.pathname.split('/')[4]));return response({data:{children:[{kind:'t3',data:post('full'+(++count),sub)}],after:null}});};
  globalThis.fetch=(async(_url:any,options:any)=>{const body=JSON.parse(options.body),primary=JSON.parse(body.messages[1].content);assert.ok(primary.context.postTitle);const strategy=primary.text.includes('Kosatka');return response({choices:[{message:{content:JSON.stringify({kind:'INTEL',reason:'actionable reply',candidates:[{category:strategy?'strategy':'workaround',claim:strategy?'Kosatka enables solo heists.':'Switch sessions to try fixing the mission bug.',predicate:strategy?'solo_heist_access':'session_bug_fix',entities:strategy?['Kosatka']:['mission'],conditions:[{key:'game',value:'GTA Online'}],values:[],stance:'supports',quote:primary.text}]})}}],usage:{prompt_tokens:200,completion_tokens:100}});}) as any;
  try{const cfg={...config,inputPrice:1,outputPrice:1};repo.setSetting('pilot:'+cfg.pilotId,{authenticated:true,smokeApproved:{note:'test-only approved parsing',at:fixtureNow}});const collected=await collectPilot(repo,cfg,'intelligence',50,new RedditClient(cfg,redditHTTP,async()=>{}));assert.equal(collected.added,50);const processed=await processPilot(repo,cfg);assert.equal(processed.report.unprocessed,0);assert.equal(processed.report.processingErrors,0);assert.ok(processed.report.llmCalls>0);assert.ok(processed.report.claimsCreated>=2);assert.ok(processed.report.top20HighestConfidenceClaims.length>0);assert.ok(repo.claims().every(c=>c.createdAt));
    for(const item of repo.sources().slice(0,10)){const linked=repo.evidence().filter(e=>e.sourceId===item.id),useful=linked.length?'YES':'NO';saveHumanEvaluation(repo,{sourceId:item.id,useful,showToPlayer:useful,reviewer:'R1',category:'strategy',extractionQuality:'correct',matching:linked[0]?.match.kind==='merge'?'correctly matched existing claim':'correctly created new claim',usefulness:4,notes:'Mock integration review, not live validation'});}
    assert.ok(approvePilotStage(repo,cfg,'intelligence','Inspected mock integration sample').intelligenceApproved);const calls=repo.usages().length;await processPilot(repo,cfg);assert.equal(repo.usages().length,calls);
  }finally{globalThis.fetch=originalFetch;for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}repo.close();restore();}
});
test('comment quotes cannot borrow evidence exclusively from the parent conversation',async()=>{
  const repo=new SqliteRepository(':memory:');try{const s=redditComments(conversation(),source(),config).items[1];const result=await runPipeline(repo,{name:'mock',fetchItems:async()=>[s]},{extract:async()=>({output:{kind:'INTEL',candidates:[{...candidate,quote:s.context!.parentText}]},usage:{stage:'EXTRACT',provider:'mock',model:'test',inputTokens:1,outputTokens:1,estimatedCost:0}})});assert.equal(result.processingErrors,1);assert.equal(repo.claims().length,0);assert.equal(repo.sources().length,1);}finally{repo.close();}
});
