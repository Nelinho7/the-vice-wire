import { randomUUID } from 'node:crypto';
import { filter,normalize,match,scoreConfidence } from './intelligence.ts';
import { validateExtraction } from './model.ts';
import type { Repository,Claim,Evidence } from './model.ts';
import type { SourceAdapter } from './adapters.ts';
import type { ExtractionProvider } from './providers.ts';
import { PilotLimitError } from './pilot-budget.ts';
export function refreshScores(repo:Repository,now=new Date().toISOString()) {const sources=repo.sources(),evidence=repo.evidence();for(const c of repo.claims())repo.saveClaim({...c,...scoreConfidence(c,evidence,sources,now)});}
export async function runPipeline(repo:Repository,adapter:SourceAdapter,provider:ExtractionProvider,now=new Date().toISOString()) {
  const items=await adapter.fetchItems();let processed=0,skipped=0;let stopped:string|null=null;
  for(const item of items){
    if(repo.audits().some(a=>a.sourceId===item.id&&a.stage==='STORE')){skipped++;continue;}
    processed++;
    const processingAt=item.platform==='reddit'?new Date().toISOString():now;
    const audit=(stage:string,result:unknown)=>repo.audit({sourceId:item.id,stage,result,at:item.platform==='reddit'?new Date().toISOString():now});
    const started=performance.now(),prior=repo.sources().find(s=>s.id===item.id);
    const detected=prior?.firstDetectedAt??item.firstDetectedAt??processingAt;
    const stored={...item,ingestedAt:prior?.ingestedAt??item.ingestedAt??processingAt,firstDetectedAt:detected,processingStartedAt:processingAt,detectionLatencyMs:Math.max(0,Date.parse(detected)-Date.parse(item.timestamp))};
    repo.saveSource(stored);audit('INGEST',{adapter:adapter.name});
    const complete=()=>repo.saveSource({...stored,processedAt:new Date().toISOString(),processingDurationMs:Math.round(performance.now()-started)});
    try {
      const classification=filter(item);audit('FILTER',classification);
      if(!classification.useful){audit('STORE',{outcome:'rejected'});complete();continue;}
      let extractionResponse;
      try {extractionResponse=await provider.extract(item);repo.usage({...extractionResponse.usage,sourceId:item.id,pilotId:item.pilotId,at:extractionResponse.usage.at??now});}catch(error){if(!(error instanceof PilotLimitError)&&!(error as any)?.recordedUsage)repo.usage({stage:'EXTRACT',provider:provider.constructor.name,model:process.env.LLM_MODEL??'unknown',inputTokens:null,outputTokens:null,estimatedCost:null,error:String(error),sourceId:item.id,pilotId:item.pilotId,at:now});throw error;}
      audit('EXTRACT_RAW',extractionResponse.output);
      const extracted=validateExtraction(extractionResponse.output,item.itemType==='comment'?item.text:item.title+'\n'+item.text);audit('EXTRACT',extracted);
      if(extracted.kind==='NO_INTEL'){audit('STORE',{outcome:'no_intel'});complete();continue;}
      repo.transaction(()=>{
        for(const raw of extracted.candidates){
          const candidate=normalize(raw);audit('NORMALIZE',candidate);
          const decision=match(candidate,repo.claims());audit('MATCH',decision);
          let claim:Claim;
          if(decision.kind==='merge')claim=repo.claims().find(c=>c.id===decision.claimId)!;
          else {claim={id:randomUUID(),category:candidate.category,claim:candidate.claim,predicate:candidate.predicate,entities:candidate.entities,conditions:candidate.conditions,values:candidate.values,firstDetected:detected,createdAt:item.platform==='reddit'?new Date().toISOString():now,lastCorroborated:null,status:'UNVERIFIED',confidence:0,evidenceCount:0,breakdown:{},review:decision.kind==='ambiguous'?'needs review':null};repo.saveClaim(claim);}
          const evidence:Evidence={id:randomUUID(),claimId:claim.id,sourceId:item.id,stance:candidate.stance,candidate,match:decision,createdAt:now};repo.saveEvidence(evidence);audit('ATTACH_EVIDENCE',{evidenceId:evidence.id,claimId:claim.id,stance:evidence.stance});
          const scored={...claim,...scoreConfidence(claim,repo.evidence(),repo.sources(),now)};repo.saveClaim(scored);audit('SCORE_CONFIDENCE',{claimId:claim.id,...scored.breakdown});
        }
        audit('STORE',{outcome:'intel',candidateCount:extracted.candidates.length});complete();
      });
    }catch(error){if(error instanceof PilotLimitError){stopped=error.message;audit('LIMIT',{message:stopped});break;}audit('ERROR',{message:String(error)});if(item.platform==='reddit'){stopped='Live processing stopped after an error; inspect retained audit and retry explicitly.';break;}}
  }
  refreshScores(repo,now);return {processed,skipped,stopped,...report(repo)};
}
export function report(repo:Repository) {
  const audits=repo.audits(),outcomes=new Map<string,string>();for(const a of audits)if(a.stage==='STORE')outcomes.set(a.sourceId,(a.result as any).outcome);
  const intel=[...outcomes.values()].filter(v=>v==='intel').length,claims=repo.claims(),usages=repo.usages();
  return {sourceItems:repo.sources().length,usefulIntelItems:intel,usefulPercentage:repo.sources().length?Math.round(intel/repo.sources().length*10000)/100:0,claimsCreated:claims.length,duplicatesMerged:repo.evidence().filter(e=>e.match.kind==='merge').length,ambiguousMatches:repo.evidence().filter(e=>e.match.kind==='ambiguous').length,contradictionsDetected:repo.evidence().filter(e=>e.stance==='contradicts').length,claimsByStatus:Object.fromEntries(['UNVERIFIED','DEVELOPING','LIKELY','VERIFIED'].map(s=>[s,claims.filter(c=>c.status===s).length])),processingErrors:audits.filter(a=>a.stage==='ERROR').length,llmCalls:usages.filter(u=>u.provider!=='fixture').length,fixtureReplayCalls:usages.filter(u=>u.provider==='fixture').length,inputTokens:usages.some(u=>u.inputTokens!==null)?usages.reduce((n,u)=>n+(u.inputTokens??0),0):null,outputTokens:usages.some(u=>u.outputTokens!==null)?usages.reduce((n,u)=>n+(u.outputTokens??0),0):null,estimatedCost:usages.every(u=>u.estimatedCost!==null)?usages.reduce((n,u)=>n+(u.estimatedCost??0),0):null};
}
export function reviewClaim(repo:Repository,claimId:string,decision:string,note:string,now=new Date().toISOString()) {
  if(!['valid','invalid','duplicate','needs review'].includes(decision))throw Error('Invalid review decision');
  const c=repo.claims().find(c=>c.id===claimId);if(!c)throw Error('Claim not found');
  repo.transaction(()=>{repo.saveClaim({...c,review:decision});repo.review({id:randomUUID(),claimId,decision,note,at:now});});
}
export function reassignEvidence(repo:Repository,evidenceId:string,claimId:string,note:string,now=new Date().toISOString()) {
  const e=repo.evidence().find(e=>e.id===evidenceId);if(!e)throw Error('Evidence not found');
  if(!repo.claims().some(c=>c.id===claimId))throw Error('Target claim not found');
  repo.transaction(()=>{repo.saveEvidence({...e,claimId,match:{...e.match,manualReassignment:true,fromClaimId:e.claimId,note}});repo.review({id:randomUUID(),claimId,fromClaimId:e.claimId,evidenceId,decision:'reassign evidence',note,at:now});refreshScores(repo,now);});
}
