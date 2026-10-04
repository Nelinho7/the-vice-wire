import type { SourceItem,Candidate,Claim,Evidence } from './model.ts';
export function filter(s:SourceItem):{useful:boolean;reason:string} {
  const t=((s.itemType==='comment'?'':s.title+' ')+s.text).toLowerCase();
  if(/no evidence|just a theory|maybe gta 6/.test(t))return {useful:false,reason:'unsupported speculation'};
  if(/^(meme:)/i.test(s.text)||/sunset screenshot|best game ever|all idiots|soundtrack more|football tonight/.test(t))return {useful:false,reason:'chatter or media without actionable information'};
  if(/\?/.test(s.text)&&!/(tested|worked|paid|found|fixed|reproduced|sold|i recommend|because|should buy|you can|use the)/.test(t))return {useful:false,reason:'unanswered question'};
  if((s.itemType==='post'?s.title+' '+s.text:s.text).trim().length<(s.itemType==='comment'?8:20))return {useful:false,reason:'insufficient textual evidence'};
  return {useful:true,reason:'candidate for structured extraction; usefulness decided by extractor'};
}
const aliases:Record<string,string>={'acid business':'acid lab','acid laboratory':'acid lab','bolingbroke prison':'bolingbroke penitentiary'};
export function canonical(s:string){const v=s.toLowerCase().replace(/[^a-z0-9$]+/g,' ').trim();return aliases[v]??v;}
export function normalize(c:Candidate):Candidate {return {...c,category:canonical(c.category).replaceAll(' ','_'),predicate:canonical(c.predicate).replaceAll(' ','_'),entities:[...new Set(c.entities.map(canonical))].sort(),conditions:Object.fromEntries(Object.entries(c.conditions).map(([k,v])=>[canonical(k).replaceAll(' ','_'),canonical(v)])),values:c.values.map(v=>({...v,name:canonical(v.name),unit:v.unit.trim()}))};}
export function similarity(a:string[],b:string[]){const x=new Set(a),y=new Set(b);return new Set([...x].filter(v=>y.has(v))).size/(new Set([...x,...y]).size||1);}
export function match(c:Candidate,claims:Claim[]):{kind:'new'|'merge'|'ambiguous';claimId?:string;score:number;alternatives:{id:string;score:number}[];reason:string} {
  const ranked=claims.filter(x=>x.review!=='invalid'&&x.review!=='duplicate'&&x.category===c.category).flatMap(x=>{
    const conflict=Object.keys(c.conditions).some(k=>k in x.conditions&&c.conditions[k]!==x.conditions[k]);
    if(conflict)return [];
    const e=similarity(c.entities,x.entities),p=c.predicate===x.predicate?1:similarity(c.predicate.split('_'),x.predicate.split('_')),t=similarity(c.claim.toLowerCase().split(/\W+/),x.claim.toLowerCase().split(/\W+/));
    const sameConditions=JSON.stringify(Object.entries(c.conditions).sort())===JSON.stringify(Object.entries(x.conditions).sort());
    const score=0.5*e+0.35*p+0.15*t;
    return [{id:x.id,score,sameConditions,e,p}];
  }).sort((a,b)=>b.score-a.score);
  const exact=ranked.filter(x=>x.sameConditions&&x.e===1&&x.p===1&&x.score>=0.85);
  const best=exact[0]??ranked[0],alternatives=ranked.filter(x=>x.score>=0.65).map(({id,score})=>({id,score}));
  if(!best||best.score<0.65)return {kind:'new',score:best?.score??0,alternatives,reason:'no sufficiently similar compatible claim'};
  if(best.score<0.85||!best.sameConditions||best.e!==1||best.p!==1||exact[1]?.score>=best.score-0.05)return {kind:'ambiguous',score:best.score,alternatives,reason:'missing conditions, entity/predicate ambiguity, or competing matches; separate claim retained for review'};
  return {kind:'merge',claimId:best.id,score:best.score,alternatives,reason:'canonical category/entities/predicate and conditions agree; semantic text similarity passes threshold'};
}
export function scoreConfidence(claim:Claim,evidence:Evidence[],sources:SourceItem[],now:string) {
  const linked=evidence.filter(e=>e.claimId===claim.id),byId=new Map(sources.map(s=>[s.id,s]));
  const seen=new Set<string>(),texts=new Set<string>(),threads=new Set<string>(),independent:Evidence[]=[];
  const contradictingThreads=new Set<string>();
  let copies=0;
  for(const e of linked){const s=byId.get(e.sourceId);if(!s)continue;const text=canonical(s.text),thread=s.platform==='reddit'?s.context?.threadId:undefined;
    if(e.stance==='contradicts'&&thread&&!contradictingThreads.has(thread)){contradictingThreads.add(thread);if(threads.has(thread)){independent.push(e);continue;}}
    if(s.copiedFrom||seen.has(s.independenceKey)||texts.has(text)||(thread&&threads.has(thread))){copies++;continue;}seen.add(s.independenceKey);texts.add(text);if(thread)threads.add(thread);independent.push(e);}
  const support=independent.filter(e=>e.stance==='supports'),against=independent.filter(e=>e.stance==='contradicts'),uncertain=independent.filter(e=>e.stance==='uncertain');
  const freshness=support.length?support.reduce((n,e)=>n+Math.exp(-Math.max(0,Date.parse(now)-Date.parse(byId.get(e.sourceId)!.timestamp))/(7*86400000)),0)/support.length:0;
  const numeric=independent.flatMap(e=>e.candidate.values.filter(v=>claim.values.some(x=>x.name===v.name&&x.unit===v.unit)).map(v=>{const base=claim.values.find(x=>x.name===v.name&&x.unit===v.unit)!;return Math.abs(v.value-base.value)/Math.max(Math.abs(base.value),1)<=0.1?1:0;}));
  const agreement=numeric.length?numeric.reduce((a,b)=>a+b,0)/numeric.length:1;
  const engagement=support.length?Math.min(3,support.reduce((n,e)=>n+Math.log10(1+Math.max(0,byId.get(e.sourceId)!.engagement.score)),0)/support.length):0;
  const components={base:support.length?15:0,independence:Math.min(45,support.length*12),recency:15*freshness,numericalAgreement:support.length?10*agreement:0,engagement,contradictionPenalty:against.length*20,uncertaintyPenalty:uncertain.length*4,copyPenalty:Math.min(10,copies*2)};
  const confidence=Math.round(Math.max(0,Math.min(95,components.base+components.independence+components.recency+components.numericalAgreement+engagement-components.contradictionPenalty-components.uncertaintyPenalty-components.copyPenalty)));
  const status=support.length>=4&&confidence>=85&&against.length===0&&agreement>=0.9?'VERIFIED':support.length>=3&&confidence>=65&&against.length===0?'LIKELY':support.length>=2?'DEVELOPING':'UNVERIFIED';
  return {confidence,status,evidenceCount:linked.length,lastCorroborated:support.length?support.map(e=>byId.get(e.sourceId)!.timestamp).sort().at(-1)!:null,breakdown:{version:'v0.2',asOf:now,components,independentSupporting:support.length,independentContradicting:against.length,independentUncertain:uncertain.length,copiesOrRepeatedAuthors:copies,numericalAgreement:agreement,threads:threads.size,assumptions:'Reddit support counts at most once per thread; same-thread contradiction is retained conservatively. Unknown source reliability is neutral. Author/text/thread/crosspost independence remains heuristic; VERIFIED is a model status, not established fact.'}};
}
