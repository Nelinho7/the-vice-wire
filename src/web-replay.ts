import {writeFileSync} from 'node:fs';
import {SqliteRepository} from './store.ts';
import {operationsConfig} from './operations-config.ts';
import {runPipeline,analysisVersion} from './pipeline.ts';
import {fingerprint,contentFingerprint} from './fingerprints.ts';
import {safeError} from './security.ts';
import type {SourceItem} from './model.ts';
const key='web:v0:dimensions-v7-replay';
function sourceRecord(s:SourceItem){const {analysisVersion,analyzedHash,contentHash,processingStartedAt,processedAt,processingDurationMs,detectionLatencyMs,...core}=s;return core;}
const repo=new SqliteRepository(operationsConfig().dbPath);
// This operation has no networking capability, including source discovery.
globalThis.fetch=async()=>{throw Error('Network disabled for exact-cohort recorded replay');};
try{
 if(repo.setting(key))throw Error('This exact-cohort repair replay already started; no automatic repeat');
 const collection:any=repo.setting('web:v0:collection'),ids=new Set<string>(collection?.items??[]);
 const sources=repo.sources().filter(s=>ids.has(s.id));
 if(ids.size!==32||sources.length!==32||sources.some(s=>s.platform!=='web'||s.pilotId!=='web-v0'))throw Error('Expected exactly the original 32 stored Web V0 sources');
 const allEvidence=repo.evidence(),evidence=allEvidence.filter(e=>ids.has(e.sourceId)),claimIds=new Set(evidence.map(e=>e.claimId)),claims=repo.claims().filter(c=>claimIds.has(c.id));
 if(allEvidence.some(e=>claimIds.has(e.claimId)&&!ids.has(e.sourceId)))throw Error('Shared historical claims require a separately reviewed migration');
 const audits=repo.audits(),responses=new Map(sources.map(s=>[s.id,audits.filter(a=>a.sourceId===s.id&&a.stage==='EXTRACT_RESPONSE').at(-1)?.result]));
 if([...responses.values()].some(v=>!v))throw Error('Missing original extraction response; no paid fallback or fetch permitted');
 const hashes=new Map(sources.map(s=>[s.id,fingerprint(sourceRecord(s))]));
 const before={at:new Date().toISOString(),sources,claims,evidence,audits:audits.filter(a=>ids.has(a.sourceId)),usage:repo.usages(),budgets:operationsConfig(),publicationReviews:repo.publicationReviews().filter(r=>claimIds.has(r.claimId))};
 writeFileSync('data/web-v0-before-dimensions-v7.json',JSON.stringify(before,null,2));
 repo.setSetting(key,{started:before.at,sourceIds:[...ids],mode:'recorded extraction replay; no network; no new LLM calls',publishingEnabled:false});
 // Rebuild the complete cohort graph, rather than retaining the original false
 // merge's extra evidence. Raw sources and old audits remain untouched.
 repo.transaction(()=>{for(const s of sources)repo.removeSourceEvidence(s.id);});
 const outcome=await runPipeline(repo,{name:'web-v0-exact-recorded-replay',fetchItems:async()=>structuredClone(sources)},{signature:'recorded-web-v0-'+analysisVersion,extract:async s=>({output:structuredClone(responses.get(s.id)),usage:{stage:'EXTRACT',provider:'recorded-replay',model:'original-extraction-response',inputTokens:0,outputTokens:0,estimatedCost:0,sourceId:s.id,pilotId:'web-v0-repair',at:new Date().toISOString()}})},new Date().toISOString(),{cache:false});
 const afterSources=repo.sources().filter(s=>ids.has(s.id));
 const unchanged=afterSources.every(s=>hashes.get(s.id)===fingerprint(sourceRecord(s))&&contentFingerprint(s)===contentFingerprint(sources.find(x=>x.id===s.id)!));
 if(!unchanged)throw Error('Source integrity check failed');
 const afterEvidence=repo.evidence().filter(e=>ids.has(e.sourceId)),afterIds=new Set(afterEvidence.map(e=>e.claimId)),afterClaims=repo.claims().filter(c=>afterIds.has(c.id));
 const result={at:new Date().toISOString(),sourceIds:[...ids],processed:outcome.processed,skipped:outcome.skipped,stopped:outcome.stopped,sourceRecordsUnchanged:unchanged,networkRequests:0,newLLMCalls:0,reprocessingCostUSD:0,recordedResponses:responses.size,claims:afterClaims,evidence:afterEvidence,audits:repo.audits().slice(audits.length),publishingEnabled:false};
 writeFileSync('data/web-v0-dimensions-v7-replay.json',JSON.stringify(result,null,2));repo.setSetting(key,result);
 console.log(JSON.stringify({processed:result.processed,claims:afterClaims.length,evidence:afterEvidence.length,merges:afterEvidence.filter(e=>e.match.kind==='merge').length,ambiguous:afterEvidence.filter(e=>e.match.kind==='ambiguous').length,states:Object.fromEntries(['NOT_ELIGIBLE','NEEDS_MORE_EVIDENCE','REVIEW_READY','PUBLISHABLE'].map(state=>[state,afterClaims.filter(c=>c.publication?.state===state).length])),sourceRecordsUnchanged:unchanged,networkRequests:0,newLLMCalls:0,cost:0,stopped:result.stopped}));
 if(outcome.stopped||outcome.processed!==32)process.exitCode=1;
}catch(e){console.error(safeError(e));process.exitCode=1;}finally{repo.close();}
