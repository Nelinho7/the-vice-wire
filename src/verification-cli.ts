import {readFileSync,writeFileSync} from 'node:fs';
import {SqliteRepository} from './store.ts';
import {operationsConfig} from './operations-config.ts';
import {WebSourceAdapter,SearchManifestProvider} from './web.ts';
import {OpenAIProvider} from './providers.ts';
import {CostBudget} from './budget.ts';
import {verifyBatch,focusedQueries} from './verification.ts';
import {fingerprint} from './fingerprints.ts';
import {safeError} from './security.ts';
const repo=new SqliteRepository(operationsConfig().dbPath),key='verification:v0:pilot';
try{
 if(process.argv[2]!=='pilot')throw Error('Only bounded verification pilot is supported');
 if(repo.setting(key))throw Error('This nine-claim pilot already started; no automatic repeat');
 if(!operationsConfig().paidApproved)throw Error('Paid processing approval required');
 const manifest=JSON.parse(readFileSync('config/verification-pilot.json','utf8')),config=JSON.parse(readFileSync('config/web-pilot.json','utf8'));
 const claims=repo.claims().filter(c=>manifest.claims.some((x:any)=>x.claimId===c.id));
 if(claims.length!==9||claims.some(c=>c.publication?.state!=='REVIEW_READY'))throw Error('Expected the original nine REVIEW_READY claims');
 const originalEvidence=repo.evidence(),originalSources=repo.sources(),beforeUsage=repo.usages().map(u=>u.id),before={at:new Date().toISOString(),claims,evidence:originalEvidence,sources:originalSources,budgets:operationsConfig(),usageIds:beforeUsage};
 writeFileSync('data/verification-v0-before.json',JSON.stringify(before,null,2));repo.setSetting(key,{started:before.at,claimIds:claims.map(c=>c.id),publishingEnabled:false});
 let hit:any=null;const adapter=new WebSourceAdapter({name:'focused-one-page-reader',costUSD:0,discover:async()=>[hit]},['verification'],config.policies,1);
 const reader={read:async(h:any)=>{hit={...h,query:'verification'};const count=adapter.requests,index=adapter.skips.length,sources=await adapter.fetchItems(),source=sources[0];return {source:source?{...source,id:'verification:'+source.id,pilotId:'verification-v0',raw:{...source.raw,verificationOnly:true}}:null,reason:adapter.skips.slice(index).map(s=>s.reason).join('; '),requests:adapter.requests-count};}};
 const search={name:'codex-public-search-recorded-v0',search:async(query:string)=>{const item=manifest.claims.flatMap((x:any)=>x.searches).find((s:any)=>s.query===query);if(!item)throw Error('No recorded actual search result; broad/unplanned discovery forbidden');return {hits:item.hits,costUSD:null};}};
 const provider=new OpenAIProvider(new CostBudget(repo)),base=provider.requestBody.bind(provider);
 const extractor={signature:'target-verifier-v1:'+provider.signature,extract:async(source:any,target:any)=>{
  provider.requestBody=(s:any)=>{const body=base(s);body.messages[0].content+=' Verify only TARGET_CLAIM against PRIMARY. Extract a concise proposition only if primary evidence actually supports, contradicts or partly addresses this target. Other topics yield NO_INTEL. Preserve all original numerical, reward, scope and time dimensions; do not infer equivalence from a similar number. For explicit disagreement normalize the original positive proposition with contradicts stance and the actually observed differing value. Partial evidence must preserve its narrower scope, never rewrite it as full target confirmation. Never choose a confidence percentage.';const payload=JSON.parse(body.messages[1].content);payload.TARGET_CLAIM={claim:target.claim,predicate:target.predicate,entities:target.entities,conditions:target.conditions,values:target.values,rewardModifiers:target.rewardModifiers};body.messages[1].content=JSON.stringify(payload);return body;};
  try{return await provider.extract(source);}finally{provider.requestBody=base;}
 }};
 const plans=Object.fromEntries(manifest.claims.map((c:any)=>[c.claimId,c.searches.map((s:any)=>s.query)]));
 const results=await verifyBatch(repo,claims.map(c=>c.id),search,reader,extractor,new Date().toISOString(),plans);
 const preserved=originalEvidence.every(e=>repo.evidence().some(n=>fingerprint(e)===fingerprint(n)))&&originalSources.every(s=>repo.sources().some(n=>fingerprint(s)===fingerprint(n)));
 if(!preserved)throw Error('Original discovery source/evidence integrity failed');
 const usage=repo.usages().filter(u=>!beforeUsage.includes(u.id)),result={at:new Date().toISOString(),results,actualSearchesPerformed:manifest.claims.reduce((n:number,c:any)=>n+c.searches.length,0),generatedQueries:Object.fromEntries(claims.map(c=>[c.id,focusedQueries(c)])),sourceRequests:adapter.requests,skips:adapter.skips,usage,knownLLMCostUSD:usage.reduce((n,u)=>n+(u.estimatedCost??0),0),searchCostUSD:null,originalEvidenceAndSourcesPreserved:preserved,budgetsUnchanged:operationsConfig().runBudget===before.budgets.runBudget&&operationsConfig().dailyBudget===before.budgets.dailyBudget&&operationsConfig().monthlyBudget===before.budgets.monthlyBudget,publishingEnabled:false,schedulingEnabled:false};
 writeFileSync('data/verification-v0-results.json',JSON.stringify(result,null,2));repo.setSetting(key,result);console.log(JSON.stringify({claims:results.length,searches:result.actualSearchesPerformed,requests:adapter.requests,calls:usage.length,cost:result.knownLLMCostUSD,states:results.map(r=>[r.claim,r.stateAfter,r.stopReason]),preserved}));
}catch(e){console.error(safeError(e));process.exitCode=1;}finally{repo.close();}
