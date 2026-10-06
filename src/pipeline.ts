import {discoveryPrimarySignal} from './discovery-semantics.ts';
import {discoveryCandidate} from './discovery-extraction.ts';
import {guardDiscoveryMatch,refreshDiscoveries} from './discoveries.ts';
import {claimHumanEvidenceReview} from './source-provenance.ts';
import {enqueueVerification} from './verification.ts';
import {claimFingerprint} from './proposition.ts';
import { refreshPublication } from './feed-quality.ts';
import { unsupportedSuperlative,temporal,factualText } from './semantics.ts';
import { randomUUID } from 'node:crypto';
import { filter,normalize,match,scoreConfidence } from './intelligence.ts';
import { validateExtraction } from './model.ts';
import type { Repository,Claim,Evidence } from './model.ts';
import type { SourceAdapter } from './adapters.ts';
import type { ExtractionProvider } from './providers.ts';
import { PilotLimitError } from './pilot-budget.ts';
import { contentFingerprint,cacheKey } from './fingerprints.ts';
import { priorityScore } from './priority.ts';
import type { PriorityConfig } from './priority.ts';
import { operationsConfig } from './operations-config.ts';
import { safeError,redactSecrets } from './security.ts';
export const analysisVersion='intelligence-dimensions-v8';
export function refreshScores(repo:Repository,now=new Date().toISOString()) {const sources=repo.sources(),evidence=repo.evidence();for(const c of repo.claims())repo.saveClaim({...c,...scoreConfidence(c,evidence,sources,now)});refreshPublication(repo,now);refreshDiscoveries(repo,now);}
export async function runPipeline(repo:Repository,adapter:SourceAdapter,provider:ExtractionProvider,now=new Date().toISOString(),options:{priority?:PriorityConfig;cache?:boolean}={}) {
  const fetched=await adapter.fetchItems();
  if(fetched.some(s=>s.raw.discoveryEnabled===true&&s.platform==='informant'&&repo.communityRecords('profiles').some(p=>p.id===s.author&&p.accountOrigin==='SEEDED')))throw Error('Seeded archives cannot originate or confirm discoveries');
  if(fetched.some(s=>s.raw.discoveryFixture===true)&&(!repo.testIsolation||repo.setting('discoveryTestOnly')!==true))throw Error('Discovery fixtures cannot enter operational repository');
  // Persist the whole candidate batch before a budget stop can interrupt paid processing.
  repo.transaction(()=>{for(const item of fetched){const prior=repo.sources().find(s=>s.id===item.id);const legacy=prior&&!prior.analyzedHash&&repo.audits().some(a=>a.sourceId===item.id&&a.stage==='STORE');repo.saveSource({...prior,...item,contentHash:contentFingerprint(item),analyzedHash:prior?.analyzedHash??(legacy?contentFingerprint(prior!):undefined),firstDetectedAt:prior?.firstDetectedAt??item.firstDetectedAt??now});}});
  const items=fetched.every(s=>s.platform==='fixture')?fetched:fetched.toSorted((a,b)=>priorityScore(b,fetched,repo.claims(),now,options.priority).score-priorityScore(a,fetched,repo.claims(),now,options.priority).score);
  const touched=new Set<string>();
  let processed=0,skipped=0,cacheHits=0;let stopped:string|null=null;
  for(const item of items){
    const prior=repo.sources().find(s=>s.id===item.id),hash=contentFingerprint(item);
    if(prior?.analyzedHash===hash&&prior.analysisVersion===analysisVersion){skipped++;continue;}
    processed++;
    const processingAt=item.platform==='reddit'?new Date().toISOString():now;
    const audit=(stage:string,result:unknown)=>repo.audit({sourceId:item.id,stage,result:redactSecrets(result),at:item.platform==='reddit'?new Date().toISOString():now});
    const started=performance.now();
    const detected=prior?.firstDetectedAt??item.firstDetectedAt??processingAt;
    const stored={...prior,...item,contentHash:hash,analyzedHash:prior?.analyzedHash,ingestedAt:prior?.ingestedAt??item.ingestedAt??processingAt,firstDetectedAt:detected,processingStartedAt:processingAt,detectionLatencyMs:Math.max(0,Date.parse(detected)-Date.parse(item.timestamp))};
    repo.saveSource(stored);audit('INGEST',{adapter:adapter.name});
    const complete=()=>repo.saveSource({...stored,analyzedHash:hash,analysisVersion,processedAt:new Date().toISOString(),processingDurationMs:Math.round(performance.now()-started)});
    const reject=(outcome:string,reason:string)=>repo.transaction(()=>{repo.removeSourceEvidence(item.id);audit('STORE',{outcome,reason,contentHash:hash});complete();});
    const cache=options.cache!==false&&!!provider.signature;
    const getCache=(stage:string)=>{if(!cache)return null;const hit:any=repo.setting(cacheKey(item,provider.signature!+'|'+analysisVersion,stage));return hit&&Date.parse(hit.expiresAt)>Date.parse(now)?hit.result:null;};
    const putCache=(stage:string,result:unknown)=>{if(cache)repo.setSetting(cacheKey(item,provider.signature!+'|'+analysisVersion,stage),{result,expiresAt:new Date(Date.parse(now)+operationsConfig().cacheTtlMs).toISOString()});};
    try {
      audit('PRIORITY',priorityScore(item,items,repo.claims(),now,options.priority));
      const classification=filter(item);audit('FILTER',classification);
      if(!classification.useful){reject('rejected',classification.reason);continue;}
      const concrete=item.raw.discoveryEnabled===true&&discoveryPrimarySignal(item.text)||factualText(item.text)||/\b(tested|worked|paid|found|fixed|reproduced|sold|recommend|because|should buy|you can|no longer|outdated|full stock|equipment upgrade)\b/i.test(item.title+' '+item.text);
      if(provider.classify&&!concrete){
        let relevance:any=getCache('RELEVANCE');
        if(relevance){cacheHits++;audit('CACHE',{stage:'RELEVANCE'});}else{const response=await provider.classify(item);repo.usage({...response.usage,sourceId:item.id,source:item.platform});relevance={relevant:response.relevant,reason:response.reason};putCache('RELEVANCE',relevance);}
        audit('RELEVANCE',relevance);if(!relevance.relevant){reject('rejected',relevance.reason);continue;}
      }
      // A cheap pre-match is advisory: similar wording cannot establish the same proposition.
      audit('CANDIDATE_MATCH',{claimIds:repo.claims().filter(c=>c.entities.some(e=>(item.title+' '+item.text).toLowerCase().includes(e.toLowerCase()))).map(c=>c.id)});
      let extractionResponse;
      const cached=getCache('EXTRACT');
      if(cached){cacheHits++;audit('CACHE',{stage:'EXTRACT'});extractionResponse={output:cached};}
      else try {extractionResponse=await provider.extract(item);repo.usage({...extractionResponse.usage,sourceId:item.id,source:item.platform,pilotId:item.pilotId,at:extractionResponse.usage.at??now});}catch(error){throw error;}
      audit('EXTRACT_RESPONSE',extractionResponse.output);
      let output:any=extractionResponse.output;let provenanceRejected=0;
      if(output?.kind==='INTEL'&&Array.isArray(output.candidates)){const grounded=[];for(const c of output.candidates){try{const v=validateExtraction({kind:'INTEL',reason:'',candidates:[c]},item.itemType==='comment'?item.text:item.title+'\n'+item.text);if(v.kind==='INTEL'){if(unsupportedSuperlative(v.candidates[0]))audit('CANDIDATE_REJECTED',{reason:'unsupported superlative',candidate:c});else grounded.push(v.candidates[0]);}}catch(error){if(error instanceof Error&&error.message==='Evidence quote is not present in source'){provenanceRejected++;audit('PROVENANCE_REJECTED',{reason:error.message,candidate:c});}else throw error;}}output=grounded.length?{kind:'INTEL',candidates:grounded}:{kind:'NO_INTEL',reason:'No grounded, supported candidates; see provenance/candidate audit'};}
      const extracted=validateExtraction(output,item.itemType==='comment'?item.text:item.title+'\n'+item.text);audit('EXTRACT',extracted);
      if(!cached)putCache('EXTRACT',extracted);
      if(extracted.kind==='NO_INTEL'){reject(provenanceRejected?'needs_review':'no_intel',extracted.reason);continue;}
      repo.transaction(()=>{
        repo.removeSourceEvidence(item.id);
        for(const raw of extracted.candidates){
          const scoped=item.platform==='twitch'&&item.raw.observationOnly===true?{...raw,claim:'Chat participants report: '+raw.claim,stance:'uncertain' as const}:raw;
          const enriched=item.raw.discoveryEnabled===true?discoveryCandidate(scoped,item):scoped;const candidate={...normalize(enriched,item),temporal:temporal(scoped,item)};audit('NORMALIZE',candidate);
          const decision=guardDiscoveryMatch(candidate,repo.claims(),match(candidate,repo.claims()));audit('MATCH',decision);
          let claim:Claim;
          if(decision.kind==='merge')claim=repo.claims().find(c=>c.id===decision.claimId)!;
          else {claim={id:randomUUID(),discovery:candidate.discovery,category:candidate.category,claim:candidate.claim,predicate:candidate.predicate,entities:candidate.entities,conditions:candidate.conditions,values:candidate.values,rewardModifiers:candidate.rewardModifiers,propositionFingerprint:claimFingerprint(candidate),firstDetected:detected,createdAt:item.platform==='reddit'?new Date().toISOString():now,lastCorroborated:null,status:'UNVERIFIED',confidence:0,evidenceCount:0,breakdown:{},review:decision.kind==='ambiguous'?'needs review':null};repo.saveClaim(claim);}
          // A patch observation can warn about a related method without pretending
          // that a different proposition is direct contradictory evidence.
          const relatedTemporalClaims=candidate.temporal.invalidates?repo.claims().filter(c=>c.id!==claim.id&&(c.entities.some(entity=>candidate.entities.includes(entity))||(item.itemType==='comment'&&/method|glitch|strategy|workaround/i.test(c.category)))&&repo.evidence().some(e=>e.claimId===c.id&&repo.sources().some(s=>s.id===e.sourceId&&s.context?.threadId&&s.context.threadId===item.context?.threadId))).map(c=>c.id):[];
          touched.add(claim.id);
          const evidence:Evidence={id:randomUUID(),claimId:claim.id,sourceId:item.id,stance:candidate.stance,candidate,match:{...decision,relatedTemporalClaims},createdAt:now};repo.saveEvidence(evidence);audit('ATTACH_EVIDENCE',{evidenceId:evidence.id,claimId:claim.id,stance:evidence.stance,relatedTemporalClaims});
          const scored={...claim,...scoreConfidence(claim,repo.evidence(),repo.sources(),now)};repo.saveClaim(scored);audit('SCORE_CONFIDENCE',{claimId:claim.id,...scored.breakdown});
        }
        audit('STORE',{outcome:'intel',candidateCount:extracted.candidates.length,extractionStatus:provenanceRejected?'partially_grounded':'grounded',provenanceRejected,contentHash:hash});complete();
      });
    }catch(error){if(error instanceof PilotLimitError){stopped=safeError(error);audit('LIMIT',{message:stopped});break;}audit('ERROR',{message:safeError(error)});if(item.platform!=='fixture'){stopped='Live processing stopped after an error; inspect retained audit and retry explicitly.';break;}}
  }
  refreshScores(repo,now);for(const c of repo.claims())if(touched.has(c.id))enqueueVerification(repo,c,now);return {processed,skipped,skippedUnchanged:skipped,cacheHits,stopped,...report(repo)};
}
export function report(repo:Repository) {
  const audits=repo.audits(),outcomes=new Map<string,string>();for(const a of audits)if(a.stage==='STORE')outcomes.set(a.sourceId,(a.result as any).outcome);
  const intel=[...outcomes.values()].filter(v=>v==='intel').length,claims=repo.claims(),usages=repo.usages();
  return {sourceItems:repo.sources().length,usefulIntelItems:intel,usefulPercentage:repo.sources().length?Math.round(intel/repo.sources().length*10000)/100:0,claimsCreated:claims.length,duplicatesMerged:repo.evidence().filter(e=>e.match.kind==='merge').length,ambiguousMatches:repo.evidence().filter(e=>e.match.kind==='ambiguous').length,contradictionsDetected:repo.evidence().filter(e=>e.stance==='contradicts').length,claimsByStatus:Object.fromEntries(['UNVERIFIED','DEVELOPING','LIKELY','VERIFIED','NEEDS_REVIEW','POTENTIALLY_OUTDATED'].map(s=>[s,claims.filter(c=>c.status===s).length])),processingErrors:audits.filter(a=>a.stage==='ERROR').length,llmCalls:usages.filter(u=>u.provider!=='fixture'&&u.provider!=='recorded-replay').length,recordedReplayCalls:usages.filter(u=>u.provider==='recorded-replay').length,fixtureReplayCalls:usages.filter(u=>u.provider==='fixture').length,inputTokens:usages.some(u=>u.inputTokens!==null)?usages.reduce((n,u)=>n+(u.inputTokens??0),0):null,outputTokens:usages.some(u=>u.outputTokens!==null)?usages.reduce((n,u)=>n+(u.outputTokens??0),0):null,estimatedCost:usages.every(u=>u.estimatedCost!==null)?usages.reduce((n,u)=>n+(u.estimatedCost??0),0):null};
}
export function reviewClaim(repo:Repository,claimId:string,decision:string,note:string,now=new Date().toISOString()) {
  if(!['valid','invalid','duplicate','needs review'].includes(decision))throw Error('Invalid review decision');
  const c=repo.claims().find(c=>c.id===claimId);if(!c)throw Error('Claim not found');
  repo.transaction(()=>{repo.saveClaim({...c,review:decision});repo.review({id:randomUUID(),claimId,decision,note,at:now,evidenceReview:claimHumanEvidenceReview(repo,claimId,now)});});
}
export function reassignEvidence(repo:Repository,evidenceId:string,claimId:string,note:string,now=new Date().toISOString()) {
  const e=repo.evidence().find(e=>e.id===evidenceId);if(!e)throw Error('Evidence not found');
  if(!repo.claims().some(c=>c.id===claimId))throw Error('Target claim not found');const evidenceReview=claimHumanEvidenceReview(repo,e.claimId,now);
  repo.transaction(()=>{repo.saveEvidence({...e,claimId,match:{...e.match,manualReassignment:true,fromClaimId:e.claimId,note}});repo.review({id:randomUUID(),claimId,fromClaimId:e.claimId,evidenceId,decision:'reassign evidence',note,at:now,evidenceReview});refreshScores(repo,now);});
}
