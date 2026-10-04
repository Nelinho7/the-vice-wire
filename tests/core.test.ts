import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtures,fixtureNow } from '../src/fixtures.ts';
import { filter,normalize,match,scoreConfidence } from '../src/intelligence.ts';
import { validateExtraction } from '../src/model.ts';
import { SqliteRepository } from '../src/store.ts';
import { FixtureAdapter,RedditAdapter } from '../src/adapters.ts';
import { FixtureProvider,CompatibleLLMProvider } from '../src/providers.ts';
import { runPipeline,reviewClaim,reassignEvidence } from '../src/pipeline.ts';
import { evaluate } from '../src/evaluation.ts';
import type { Claim,Evidence,SourceItem } from '../src/model.ts';
const candidate=normalize((fixtures[0].extraction as any).candidates[0]);
const claim:Claim={...candidate,id:'c',firstDetected:fixtureNow,lastCorroborated:null,status:'UNVERIFIED',confidence:0,evidenceCount:0,breakdown:{},review:null};
function sample(n:number,stance:'supports'|'contradicts'|'uncertain'='supports'){
  const sources:SourceItem[]=Array.from({length:n},(_,i)=>({...fixtures[0].source,id:'s'+i,author:'a'+i,independenceKey:'a'+i,text:'Independent sale report '+i,timestamp:fixtureNow}));
  const evidence:Evidence[]=sources.map((s,i)=>({id:'e'+i,sourceId:s.id,claimId:'c',stance,candidate,match:{},createdAt:fixtureNow}));return {sources,evidence};
}
test('filter accepts labeled useful observations and rejects chatter',()=>{for(const f of fixtures)assert.equal(filter(f.source).useful,f.label.useful,f.source.id);});
test('structured schema accepts valid and rejects hallucinated quotes, unknown fields, malformed values',()=>{
  const output=structuredClone(fixtures[0].extraction);assert.equal(validateExtraction(output,fixtures[0].source.text).kind,'INTEL');
  assert.throws(()=>validateExtraction({kind:'INTEL',candidates:[]},''));
  for(const update of [{quote:'not in source'},{confidence:99},{values:[{name:'payout',value:'350k',unit:'GTA$'}]},{stance:'yes'},{conditions:null}])assert.throws(()=>validateExtraction({kind:'INTEL',candidates:[{...candidate,quote:fixtures[0].source.text,...update}]},fixtures[0].source.text));
  assert.equal(validateExtraction({kind:'NO_INTEL',reason:'chatter',candidates:[]},'').kind,'NO_INTEL');
});
test('entity aliases and nearby numerical reports merge semantically',()=>{const c=normalize((fixtures[1].extraction as any).candidates[0]);assert.equal(match(c,[claim]).kind,'merge');assert.equal(match(normalize((fixtures[2].extraction as any).candidates[0]),[claim]).kind,'merge');});
test('condition conflicts remain separate, missing conditions flagged, predicate mismatch never silently merged',()=>{assert.equal(match(normalize((fixtures[5].extraction as any).candidates[0]),[claim]).kind,'new');assert.equal(match(normalize((fixtures[6].extraction as any).candidates[0]),[claim]).kind,'ambiguous');assert.notEqual(match({...candidate,predicate:'production_speed'},[claim]).kind,'merge');});
test('one huge engagement post cannot verify; independent support causes transitions',()=>{
  const one=sample(1);one.sources[0].engagement.score=10000000;assert.equal(scoreConfidence(claim,one.evidence,one.sources,fixtureNow).status,'UNVERIFIED');
  for(const [n,status] of [[2,'DEVELOPING'],[3,'LIKELY'],[4,'VERIFIED']] as const){const s=sample(n);assert.equal(scoreConfidence(claim,s.evidence,s.sources,fixtureNow).status,status);}
});
test('copy and author dependence limit confidence',()=>{const s=sample(5);for(const source of s.sources)source.independenceKey='same author';const result=scoreConfidence(claim,s.evidence,s.sources,fixtureNow);assert.equal(result.status,'UNVERIFIED');assert.equal(result.breakdown.copiesOrRepeatedAuthors,4);});
test('contradiction, uncertain observation, staleness and numeric disagreement reduce score',()=>{
  const s=sample(4),base=scoreConfidence(claim,s.evidence,s.sources,fixtureNow);
  const contradicted=structuredClone(s);contradicted.evidence[3].stance='contradicts';assert.ok(scoreConfidence(claim,contradicted.evidence,contradicted.sources,fixtureNow).confidence<base.confidence);assert.notEqual(scoreConfidence(claim,contradicted.evidence,contradicted.sources,fixtureNow).status,'VERIFIED');
  const uncertain=sample(1,'uncertain');assert.equal(scoreConfidence(claim,uncertain.evidence,uncertain.sources,fixtureNow).lastCorroborated,null);
  const stale=structuredClone(s);stale.sources.forEach(x=>x.timestamp='2025-01-01T00:00:00Z');assert.ok(scoreConfidence(claim,stale.evidence,stale.sources,fixtureNow).confidence<base.confidence);
  const numbers=structuredClone(s);numbers.evidence[3].candidate.values[0].value=900000;assert.ok(scoreConfidence(claim,numbers.evidence,numbers.sources,fixtureNow).confidence<base.confidence);
});
test('complete pipeline attaches evidence, stores rejected sources, is idempotent, supports review/reassignment',async()=>{
  const r=new SqliteRepository(':memory:');try{
    const first=await runPipeline(r,new FixtureAdapter(),new FixtureProvider(),fixtureNow);assert.equal(first.processingErrors,0);assert.equal(r.sources().length,fixtures.length);assert.ok(r.audits().some(a=>a.stage==='FILTER'&&!(a.result as any).useful));
    const count=r.evidence().length;const again=await runPipeline(r,new FixtureAdapter(),new FixtureProvider(),fixtureNow);assert.equal(again.processed,0);assert.equal(r.evidence().length,count);
    const c=r.claims()[0];reviewClaim(r,c.id,'valid','Reviewed evidence');assert.equal(r.claims()[0].review,'valid');
    const e=r.evidence()[0],target=r.claims().find(c=>c.id!==e.claimId)!;reassignEvidence(r,e.id,target.id,'Original match wrong',fixtureNow);assert.equal(r.evidence().find(x=>x.id===e.id)!.claimId,target.id);assert.equal(r.reviews().length,2);assert.equal(r.claims().find(x=>x.id===c.id)!.evidenceCount,r.evidence().filter(x=>x.claimId===c.id).length);
    assert.throws(()=>reviewClaim(r,c.id,'VERIFIED','bad'));assert.throws(()=>reassignEvidence(r,e.id,'missing','bad'));
  }finally{r.close();}
});
test('extraction failure retained and retryable without free-form database claims',async()=>{const r=new SqliteRepository(':memory:');try{const result=await runPipeline(r,{name:'one',fetchItems:async()=>[fixtures[0].source]},{extract:async()=>({output:'free-form LLM text',usage:{stage:'EXTRACT',provider:'test',model:'mock',inputTokens:1,outputTokens:1,estimatedCost:0}})},fixtureNow);assert.equal(result.processingErrors,1);assert.equal(r.claims().length,0);assert.equal(r.sources().length,1);const retry=await runPipeline(r,{name:'one',fetchItems:async()=>[fixtures[0].source]},new FixtureProvider(),fixtureNow);assert.equal(retry.processed,1);assert.equal(r.claims().length,1);}finally{r.close();}});
test('transaction failure rolls back changes',()=>{const r=new SqliteRepository(':memory:');try{assert.throws(()=>r.transaction(()=>{r.saveClaim(claim);throw Error('abort');}));assert.equal(r.claims().length,0);}finally{r.close();}});
test('fixture evaluation meets expected mechanics',async()=>{const e=await evaluate();assert.equal(e.processingErrors,0);assert.equal(e.quality.filterPrecision,1);assert.equal(e.quality.filterRecall,1);assert.equal(e.quality.dedupPairPrecision,1);assert.equal(e.quality.dedupPairRecall,1);assert.equal(e.quality.stanceAccuracy,1);assert.equal(e.quality.ambiguityPreserved,true);assert.ok(e.contradictionsDetected>=2);});
test('Reddit refuses unapproved access without requesting a website',async()=>{const previous=process.env.REDDIT_ACCESS_APPROVED;process.env.REDDIT_ACCESS_APPROVED='false';try{await assert.rejects(()=>new RedditAdapter().fetchItems(),/requires explicit approval/);}finally{if(previous===undefined)delete process.env.REDDIT_ACCESS_APPROVED;else process.env.REDDIT_ACCESS_APPROVED=previous;}});
test('structured provider records configured token cost and preserves malformed output for auditing',async()=>{
  const names=['LLM_ENDPOINT','LLM_API_KEY','LLM_MODEL','LLM_INPUT_PRICE_PER_MILLION','LLM_OUTPUT_PRICE_PER_MILLION'],previous=Object.fromEntries(names.map(k=>[k,process.env[k]])),original=globalThis.fetch;
  Object.assign(process.env,{LLM_ENDPOINT:'https://provider.example.invalid/chat/completions',LLM_API_KEY:'test-only',LLM_MODEL:'test-model',LLM_INPUT_PRICE_PER_MILLION:'1',LLM_OUTPUT_PRICE_PER_MILLION:'2'});
  globalThis.fetch=async(_url:any,options:any)=>{const request=JSON.parse(options.body);assert.equal(request.response_format.json_schema.strict,true);assert.match(request.messages[0].content,/untrusted data/);return new Response(JSON.stringify({choices:[{message:{content:'malformed output'}}],usage:{prompt_tokens:1000,completion_tokens:500}}),{status:200});};
  try{const result=await new CompatibleLLMProvider().extract(fixtures[0].source);assert.equal(result.usage.estimatedCost,0.002);assert.equal(result.usage.inputTokens,1000);assert.equal(result.output,'malformed output');assert.throws(()=>validateExtraction(result.output,fixtures[0].source.text));}finally{globalThis.fetch=original;for(const k of names){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}}
});
test('later complete conditions merge despite an earlier ambiguous draft',()=>{const incomplete={...claim,id:'ambiguous',conditions:{game:'gta online',upgrade:'equipment',stock:'full'},review:'needs review'};assert.equal(match(candidate,[incomplete,claim]).claimId,claim.id);assert.equal(match(candidate,[claim,{...claim,id:'competing'}]).kind,'ambiguous');});
