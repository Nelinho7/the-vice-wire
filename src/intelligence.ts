import {discoveryPrimarySignal} from './discovery-semantics.ts';
import {calibratedStatus} from './status-calibration.ts';
import {sourceFamily,sourceNetwork} from './independence.ts';
import {rewardModifiers,temporaryReward} from './reward-modifiers.ts';
import {propositionTerms} from './proposition.ts';
import { dimensions,incomplete,valueSemantics,factualText } from './semantics.ts';
import type { SourceItem,Candidate,Claim,Evidence } from './model.ts';
export function filter(s:SourceItem):{useful:boolean;reason:string} {
  if(s.raw.informantSuppressed)return {useful:false,reason:'moderated submission'};
  const t=((s.itemType==='comment'?'':s.title+' ')+s.text).toLowerCase();
  if(/no evidence|just a theory|maybe gta 6/.test(t))return {useful:false,reason:'unsupported speculation'};
  if(/^(meme:)/i.test(s.text)||/sunset screenshot|best game ever|all idiots|soundtrack more|football tonight/.test(t))return {useful:false,reason:'chatter or media without actionable information'};
  if(!(s.raw.discoveryEnabled===true&&discoveryPrimarySignal(s.text))&&/\?/.test(s.text.replace(/https?:\/\/\S+/g,''))&&!factualText(s.text)&&!/(tested|worked|paid|found|fixed|reproduced|sold|i recommend|because|should buy|you can|use the)/.test(t))return {useful:false,reason:'unanswered question'};
  if((s.itemType==='post'?s.title+' '+s.text:s.text).trim().length<(s.itemType==='comment'?8:20))return {useful:false,reason:'insufficient textual evidence'};
  return {useful:true,reason:'candidate for structured extraction; usefulness decided by extractor'};
}
const aliases:Record<string,string>={'acid business':'acid lab','acid laboratory':'acid lab','bolingbroke prison':'bolingbroke penitentiary'};
export function canonical(s:string){const v=s.toLowerCase().replace(/[^\p{L}\p{N}$]+/gu,' ').trim();return aliases[v]??v;}
function explicitGameAmount(quote:string,value:number){
  return [...quote.matchAll(/(?:GTA\$|\$)\s*(\d[\d,.]*)\s*(k|m|million|thousand)?\b/gi)].some(m=>Number(m[1].replaceAll(',',''))*({k:1e3,m:1e6,million:1e6,thousand:1e3}[m[2]?.toLowerCase()??'']??1)===value);
}
export function normalize(c:Candidate,source?:SourceItem):Candidate {
  const modifiers=rewardModifiers(c,source);
  const values=c.values.filter(v=>{
    const factorAsPayout=modifiers.some(m=>m.value===v.value)&&/GTA\$|payout|earnings/i.test(v.unit+' '+v.name)&&!explicitGameAmount(c.quote,v.value);
    const modifierValue=/multiplier/i.test(v.name)||/^(times|multiplier|x|\u00d7)$/i.test(v.unit)||(/bonus|increase/i.test(v.name)&&/%|percent/i.test(v.unit));
    return !factorAsPayout&&!modifierValue;
  }).map(v=>valueSemantics({...v,name:canonical(v.name),unit:v.unit.trim()},c,source));
  return {...c,category:canonical(c.category).replaceAll(' ','_'),predicate:canonical(c.predicate).replaceAll(' ','_'),entities:[...new Set(c.entities.map(canonical))].sort(),conditions:Object.fromEntries(Object.entries(c.conditions).map(([k,v])=>[canonical(k).replaceAll(' ','_'),canonical(v)])),rewardModifiers:modifiers,values};
}
export function similarity(a:string[],b:string[]){const x=new Set(a),y=new Set(b);return new Set([...x].filter(v=>y.has(v))).size/(new Set([...x,...y]).size||1);}
export function match(c:Candidate,claims:Claim[]):{kind:'new'|'merge'|'ambiguous';claimId?:string;score:number;alternatives:{id:string;score:number}[];reason:string} {
  const ranked=claims.filter(x=>x.review!=='invalid'&&x.review!=='duplicate'&&x.category===c.category).flatMap(x=>{
    const invalidation=c.stance==='contradicts'&&!c.values.length&&!x.values.length&&!temporaryReward(c)&&!temporaryReward(x)&&/works$/.test(c.predicate)&&/no longer works|(?:was|is|been) patched/i.test(c.quote);
    const timeless=(v:Record<string,string>)=>Object.fromEntries(Object.entries(v).filter(([k])=>!(invalidation&&['date','year','observed_at','patch','version'].includes(k))));
    const cc=timeless(c.conditions),xc=timeless(x.conditions);
    const conflict=Object.keys(cc).some(k=>k in xc&&cc[k]!==xc[k]);
    if(conflict)return [];
    const mods=(v:Candidate|Claim)=>JSON.stringify((v.rewardModifiers??[]).map(m=>[m.kind,m.value,m.reward,m.activity,m.period]).sort());
    if(mods(c)!==mods(x))return [];
    const proposition=similarity(propositionTerms(c),propositionTerms(x)),sameObservation=/\b(i|my|we|our|chat participants report)\b/i.test(c.claim)===/\b(i|my|we|our|chat participants report)\b/i.test(x.claim);
    const e=similarity(c.entities,x.entities),p=c.predicate===x.predicate?1:similarity(c.predicate.split('_'),x.predicate.split('_')),t=similarity(c.claim.toLowerCase().split(/\W+/),x.claim.toLowerCase().split(/\W+/));
    const sameConditions=JSON.stringify(Object.entries(cc).sort())===JSON.stringify(Object.entries(xc).sort());
    const score=0.5*e+0.35*p+0.15*t;
    const numerical=c.values.length||x.values.length;
    const missing=numerical&&(c.values.some(incomplete)||x.values.some(incomplete)||!c.values.length||!x.values.length);
    if(numerical&&!missing&&(c.values.length!==x.values.length||c.values.some(v=>!x.values.some(w=>dimensions(v)===dimensions(w)))))return [];
    return [{id:x.id,score,sameConditions: sameConditions&&!missing,e,p,proposition,sameObservation,orderedProposition:JSON.stringify(propositionTerms(c))===JSON.stringify(propositionTerms(x))}];
  }).sort((a,b)=>b.score-a.score);
  const exact=ranked.filter(x=>x.sameConditions&&x.e===1&&x.p===1&&x.score>=0.85&&x.proposition===1&&x.sameObservation&&x.orderedProposition);
  const best=exact[0]??ranked[0],alternatives=ranked.filter(x=>x.score>=0.65).map(({id,score})=>({id,score}));
  if(!best||best.score<0.65)return {kind:'new',score:best?.score??0,alternatives,reason:'no sufficiently similar compatible claim'};
  if(best.score<0.85||!best.sameConditions||best.e!==1||best.p!==1||best.proposition!==1||!best.orderedProposition||!best.sameObservation||exact[1]?.score>=best.score-0.05)return {kind:'ambiguous',score:best.score,alternatives,reason:'missing conditions, entity/predicate ambiguity, or competing matches; separate claim retained for review'};
  return {kind:'merge',claimId:best.id,score:best.score,alternatives,reason:'canonical core proposition, category/entities/predicate, numerical/reward dimensions and scoped conditions agree'};
}
export function scoreConfidence(claim:Claim,evidence:Evidence[],sources:SourceItem[],now:string) {
  const linked=evidence.filter(e=>e.claimId===claim.id&&!sources.find(s=>s.id===e.sourceId)?.raw.informantSuppressed),byId=new Map(sources.map(s=>[s.id,s]));
  const seen=new Set<string>(),networks=new Set<string>(),authors=new Set<string>(),texts=new Set<string>(),threads=new Set<string>(),independent:Evidence[]=[];
  const contradictingThreads=new Set<string>();
  let copies=0;
  for(const e of linked){const s=byId.get(e.sourceId);if(!s)continue;const text=canonical(s.text),thread=['reddit','youtube'].includes(s.platform)?s.context?.threadId??s.sourceId:undefined;
    if(e.stance==='contradicts'&&thread&&!contradictingThreads.has(thread)){contradictingThreads.add(thread);if(threads.has(thread)){independent.push(e);continue;}}
    if(s.copiedFrom||seen.has(String(e.match.verificationIndependenceKey??sourceFamily(s,sources)))||(sourceNetwork(s)!==null&&networks.has(sourceNetwork(s)!))||(s.author&&authors.has(s.author))||texts.has(text)||(thread&&threads.has(thread))){copies++;continue;}seen.add(String(e.match.verificationIndependenceKey??sourceFamily(s,sources)));if(sourceNetwork(s))networks.add(sourceNetwork(s)!);if(s.author)authors.add(s.author);texts.add(text);if(thread)threads.add(thread);independent.push(e);}
  const support=independent.filter(e=>e.stance==='supports'),against=independent.filter(e=>e.stance==='contradicts'),uncertain=independent.filter(e=>e.stance==='uncertain');
  const freshness=support.length?support.reduce((n,e)=>n+Math.exp(-Math.max(0,Date.parse(now)-Date.parse(byId.get(e.sourceId)!.timestamp))/(7*86400000)),0)/support.length:0;
  const numeric=independent.flatMap(e=>e.candidate.values.filter(v=>claim.values.some(x=>x.name===v.name&&x.unit===v.unit)).map(v=>{const base=claim.values.find(x=>x.name===v.name&&x.unit===v.unit)!;return Math.abs(v.value-base.value)/Math.max(Math.abs(base.value),1)<=0.1?1:0;}));
  const agreement=numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:1;
  const engagement=support.length?Math.min(3,support.reduce((n,e)=>n+Math.log10(1+Math.max(0,byId.get(e.sourceId)!.engagement.score)),0)/support.length):0;
  const components={base:support.length?15:0,independence:Math.min(45,support.length*12),recency:15*freshness,numericalAgreement:support.length?10*agreement:0,engagement,contradictionPenalty:against.length*20,uncertaintyPenalty:uncertain.length*4,copyPenalty:Math.min(10,copies*2),temporalPenalty:0};
  let confidence=Math.round(Math.max(0,Math.min(95,components.base+components.independence+components.recency+components.numericalAgreement+engagement-components.contradictionPenalty-components.uncertaintyPenalty-components.copyPenalty)));
  const latestSupport=support.map(e=>e.candidate.temporal?.observedAt??byId.get(e.sourceId)!.timestamp).sort().at(-1);
  const temporalUpdates=evidence.filter(e=>e.claimId!==claim.id&&((Array.isArray(e.match.relatedTemporalClaims)&&(e.match.relatedTemporalClaims as string[]).includes(claim.id))||(e.candidate.temporal?.invalidates&&(e.candidate.entities.some(entity=>claim.entities.includes(entity))||(byId.get(e.sourceId)?.itemType==='comment'&&/method|glitch|strategy|workaround/i.test(claim.category)))&&linked.some(old=>{const a=byId.get(old.sourceId)?.context?.threadId,b=byId.get(e.sourceId)?.context?.threadId;return !!a&&a===b;}))));
  const invalidation=[...linked,...temporalUpdates].some(e=>e.candidate.temporal?.invalidates&&(e.candidate.temporal.observedAt??byId.get(e.sourceId)?.timestamp??'')>(latestSupport??''));
  if(invalidation&&against.length===0){components.temporalPenalty=20;confidence=Math.max(0,confidence-components.temporalPenalty);}
  const needsReview=claim.review==='needs review'||claim.values.map(v=>valueSemantics(v,claim as Candidate)).some(incomplete);
  const status=needsReview?'NEEDS_REVIEW':invalidation?'POTENTIALLY_OUTDATED':support.length>=4&&confidence>=85&&against.length===0&&agreement>=0.9?'VERIFIED':support.length>=3&&confidence>=65&&against.length===0?'LIKELY':support.length>=2?'DEVELOPING':'UNVERIFIED';
  return calibratedStatus(claim,evidence,sources,{confidence,status,evidenceCount:linked.length,lastCorroborated:support.length?support.map(e=>byId.get(e.sourceId)!.timestamp).sort().at(-1)!:null,breakdown:{version:'v0.3',temporalValidity:invalidation?'potentially_outdated':'unresolved',relatedTemporalEvidence:temporalUpdates.map(e=>e.id),asOf:now,components,independentSupporting:support.length,independentContradicting:against.length,independentUncertain:uncertain.length,copiesOrRepeatedAuthors:copies,numericalAgreement:agreement,threads:threads.size,assumptions:'Reddit/YouTube support counts at most once per thread/video; same-thread contradiction is retained conservatively. Unknown source reliability is neutral. Author/text/thread/crosspost independence remains heuristic; VERIFIED is a model status, not established fact.'}});
}
