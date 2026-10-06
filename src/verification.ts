import {sourceFamily} from './independence.ts';
import {randomUUID} from 'node:crypto';
import {fingerprint} from './fingerprints.ts';
import {claimFingerprint,propositionTerms} from './proposition.ts';
import {normalize,canonical,match,scoreConfidence} from './intelligence.ts';
import {validateExtraction} from './model.ts';
import {locateQuote} from './provenance.ts';
import {dimensions,incomplete} from './semantics.ts';
import {DeterministicSemanticSupport,refreshPublication,evaluateFeedQuality} from './feed-quality.ts';
import type {Candidate,Claim,SourceItem,Repository,Usage} from './model.ts';
export type VerificationClass='SUPPORTS'|'CONTRADICTS'|'PARTIALLY_SUPPORTS'|'IRRELEVANT'|'INSUFFICIENT';
export type VerificationStop='VERIFIED_ENOUGH'|'STRONG_CONTRADICTION'|'INSUFFICIENT_EVIDENCE'|'SEARCH_LIMIT_REACHED';
export type SearchHit={url:string;sourceType:string;title?:string};
export interface VerificationSearch {name:string;search(query:string):Promise<{hits:SearchHit[];costUSD:number|null}>;}
export interface VerificationReader {read(hit:SearchHit):Promise<{source:SourceItem|null;reason?:string;requests?:number}>;}
export interface VerificationExtractor {signature:string;extract(source:SourceItem,target:Claim):Promise<{output:unknown;usage:Usage}>;}
export const verificationLimits={claims:9,searchesPerClaim:5,pagesPerClaim:5};
export async function verifyBatch(repo:Repository,ids:string[],search:VerificationSearch,reader:VerificationReader,extractor:VerificationExtractor,now=new Date().toISOString(),plans:Record<string,string[]>={}){
 if(!ids.length||ids.length>verificationLimits.claims||new Set(ids).size!==ids.length)throw Error('Verification batch must contain 1–9 distinct claims');
 const results=[];for(const id of ids){try{results.push(await verifyClaim(repo,id,search,reader,extractor,now,plans[id]));}catch(error){const key='verification:job:'+id,job:any=repo.setting(key);repo.setSetting(key,{...job,status:'FAILED',failedAt:now,reason:'Verification stopped; inspect safe pilot error and paid ledger before an explicit retry'});throw error;}}return results;
}
export function focusedQueries(c:Claim){const entities=c.entities.join(' '),scope=Object.values(c.conditions).join(' '),fact=c.claim.replace(/[“”]/g,'"');return [...new Set([...(c.rewardModifiers?.length?[`site:rockstargames.com ${entities} ${c.rewardModifiers.map(m=>`${m.value}x ${m.reward}`).join(' ')} ${scope}`]:[]),`GTA Online ${fact} ${scope}`,`${entities} ${c.predicate.replaceAll('_',' ')} ${scope} GTA Online verification`,`${entities} ${c.values.map(v=>`${v.value} ${v.unit} ${v.timeBasis}`).join(' ')} ${scope} tested`,`${entities} ${scope} Rockstar official`])].slice(0,5);}
export function authorityRank(h:SearchHit,c:Claim){let host='';try{host=new URL(h.url).hostname;}catch{return 99;}const official=/(^|\.)rockstargames\.com$/.test(host);return official&&!/best|fastest|hour|average|suitable|preparation to learn/i.test(c.claim)?0:h.sourceType==='primary'?1:h.sourceType==='specialist'?2:h.sourceType==='publication'?3:h.sourceType==='community'?4:5;}
export function verificationFingerprint(repo:Repository,c:Claim){return fingerprint({version:'verification-v1',claim:claimFingerprint(c),evidence:repo.evidence().filter(e=>e.claimId===c.id).map(e=>({id:e.id,candidate:e.candidate,stance:e.stance})).sort((a,b)=>a.id.localeCompare(b.id))});}
export function enqueueVerification(repo:Repository,c:Claim,now=new Date().toISOString()){
 const gate=evaluateFeedQuality(c,repo.evidence(),repo.sources(),now);
 if(!['REVIEW_READY','NEEDS_MORE_EVIDENCE'].includes(gate.state))return null;
 const key='verification:job:'+c.id,old:any=repo.setting(key),hash=verificationFingerprint(repo,c);
 if(old?.fingerprint===hash&&Date.parse(old.reverifyAfter)>Date.parse(now))return old;
 const job={id:randomUUID(),claimId:c.id,fingerprint:hash,status:'QUEUED',queuedAt:now,reverifyAfter:now};repo.setSetting(key,job);return job;
}
export function independenceIdentity(s:SourceItem){return sourceFamily(s);}
function relevant(c:Claim,q:Candidate,s:SourceItem){const terms=new Set(canonical(q.quote+' '+s.title).split(' '));return c.entities.some(e=>canonical(e).split(' ').filter(x=>x.length>2&&!['gta','online','heist'].includes(x)).every(x=>terms.has(x)));}
export function verificationIndependence(s:SourceItem,c:Claim,originalSources:SourceItem[]){
 const actual=sourceFamily(s,originalSources),linked=originalSources.find(p=>typeof p.raw.upstreamReference==='string'&&/rockstargames\.com\/.*article\//.test(String(p.raw.upstreamReference)));
 const taggedNewswire=Array.isArray(s.raw.citations)&&(s.raw.citations as string[]).some(u=>/\/tags\/(?:newswire|weekly-event)\b/.test(u));
 const independentTest=/tested in.game|hands.on guide|we (?:tested|completed|recorded|measured)/i.test(s.text);
 const sameEvent=c.rewardModifiers?.some(m=>m.period.start&&m.period.end&&Date.parse(s.timestamp)>=Date.parse(m.period.start)-7*86400000&&Date.parse(s.timestamp)<Date.parse(m.period.end)+86400000&&m.activity.some(a=>canonical(s.title+' '+s.text).includes(canonical(a))));
 if(sameEvent&&linked&&taggedNewswire&&!independentTest)return {key:sourceFamily(linked,originalSources),basis:'Conservative shared-announcement assumption: same scoped event, Newswire/weekly-event tags, no direct test in primary excerpt',assumed:true};
 return {key:actual,basis:'Explicit upstream/citation/domain identity; publication/author/copy checks also apply',assumed:false};
}
export function classifyVerification(c:Claim,q:Candidate,s:SourceItem,now:string):{classification:VerificationClass;reason:string;temporal:string}{
 if(!locateQuote(s.title+'\n'+s.text,q.quote))return {classification:'INSUFFICIENT',reason:'unlocatable quote',temporal:'unknown'};
 if(!relevant(c,q,s))return {classification:'IRRELEVANT',reason:'same topic is not the target activity/proposition',temporal:'not applicable'};
 const age=(Date.parse(now)-Date.parse(q.temporal?.observedAt??s.timestamp))/86400000,maximum=c.rewardModifiers?.some(m=>m.period.text)?7:14;
 if(!Number.isFinite(age)||age<0||age>maximum)return {classification:'INSUFFICIENT',reason:'source does not establish current applicability',temporal:'stale/unknown'};
 const candidate=normalize(q,s),target=c.rewardModifiers??[],actual=candidate.rewardModifiers??[];
 const selfEvidence={id:'self',claimId:c.id,sourceId:s.id,stance:q.stance,candidate,match:{},createdAt:now};
 const selfSupport=new DeterministicSemanticSupport().check({...c,...candidate},selfEvidence,s);
 if(selfSupport.result==='unsupported')return {classification:'INSUFFICIENT',reason:'independently extracted candidate fails grounding semantics: '+selfSupport.reason,temporal:'recent; extraction unsupported'};
 if(target.length){
  const rewards=target.every(m=>actual.some(n=>m.kind===n.kind&&m.value===n.value&&m.reward===n.reward&&m.activity.every(a=>canonical(a).split(' ').every(t=>canonical(n.activity.join(' ')).split(' ').includes(t)))));
  const periods=target.every(m=>actual.some(n=>m.period.start&&m.period.end&&n.period.start&&n.period.end&&n.period.start<=m.period.start&&n.period.end>=m.period.end));
  return {classification:rewards&&periods&&q.stance==='supports'?'SUPPORTS':'PARTIALLY_SUPPORTS',reason:!rewards?'reward/activity dimensions incomplete or different':!periods?'same-period confirmation missing':'explicit matching reward, activity and period',temporal:periods?'same period':'incomplete/different period'};
 }
 const sameDimensions=c.values.length===candidate.values.length&&c.values.every(v=>!incomplete(v)&&candidate.values.some(w=>!incomplete(w)&&dimensions(v)===dimensions(w)));
 if((c.values.length||candidate.values.length)&&!sameDimensions)return {classification:'PARTIALLY_SUPPORTS',reason:'numerical basis/range/conditions are not established as equivalent',temporal:'recent source; scope incomplete'};
 const normalizedTarget={...c,...normalize({...c,stance:'supports',quote:c.claim})};
 const aligned=match(candidate,[normalizedTarget]).kind==='merge';
 if(q.stance==='contradicts'&&aligned&&/not|no longer|incorrect|wrong|instead|rather than/i.test(q.quote))return {classification:'CONTRADICTS',reason:'explicit scoped disagreement',temporal:'recent same scoped proposition'};
 const e={id:'check',claimId:c.id,sourceId:s.id,stance:q.stance,candidate:q,match:{},createdAt:now},support=new DeterministicSemanticSupport().check(c,e,s);
 const sameAmounts=c.values.every(v=>candidate.values.some(w=>dimensions(v)===dimensions(w)&&v.value===w.value));
 return {classification:support.result==='supported'&&sameAmounts&&q.stance==='supports'?'SUPPORTS':'PARTIALLY_SUPPORTS',reason:support.reason,temporal:'recent; quoted scope preserved'};
}
export async function verifyClaim(repo:Repository,claimId:string,search:VerificationSearch,reader:VerificationReader,extractor:VerificationExtractor,now=new Date().toISOString(),queries?:string[]){
 const c=repo.claims().find(c=>c.id===claimId);if(!c)throw Error('Unknown verification claim');const key='verification:job:'+c.id,old:any=repo.setting(key),hash=verificationFingerprint(repo,c);
 if(old?.status==='COMPLETE'&&old.fingerprint===hash&&Date.parse(old.reverifyAfter)>Date.parse(now))return {...old.result,cached:true};
 const job=enqueueVerification(repo,c,now);if(!job)throw Error('Claim is outside verification gate states');repo.setSetting(key,{...job,status:'RUNNING'});
 const original=repo.evidence().filter(e=>e.claimId===c.id),sourceMap=new Map(repo.sources().map(s=>[s.id,s])),seen=new Set(original.map(e=>sourceMap.get(e.sourceId)?.url)),searches:any[]=[],results:any[]=[];let pages=0,cost:number|null=0,stop:VerificationStop='INSUFFICIENT_EVIDENCE';
 const plan=[...new Set(queries??focusedQueries(c))].slice(0,verificationLimits.searchesPerClaim);
 outer:for(const query of plan){
  const sk='verification:search:'+fingerprint([search.name,query]),saved:any=repo.setting(sk);let response:any,cached=false;
  if(saved&&Date.parse(saved.expiresAt)>Date.parse(now)){response=saved.response;cached=true;}else{response=await search.search(query);repo.setSetting(sk,{response,expiresAt:new Date(Date.parse(now)+86400000).toISOString()});}
  cost=cost===null||response.costUSD===null?null:cost+(cached?0:response.costUSD);searches.push({query,cached,costUSD:cached?0:response.costUSD,hits:response.hits});
  for(const hit of [...response.hits].sort((a,b)=>authorityRank(a,c)-authorityRank(b,c))){
   if(seen.has(hit.url))continue;if(pages>=verificationLimits.pagesPerClaim){stop='SEARCH_LIMIT_REACHED';break outer;}seen.add(hit.url);pages++;
   const rk='verification:page:'+fingerprint(hit.url),stored:any=repo.setting(rk);let read:any;
   if(stored&&Date.parse(stored.expiresAt)>Date.parse(now))read=stored.result;else{read=await reader.read(hit);repo.setSetting(rk,{result:read,expiresAt:new Date(Date.parse(now)+86400000).toISOString()});}
   if(!read.source){results.push({url:hit.url,sourceType:hit.sourceType,authorityRank:authorityRank(hit,c),classification:'INSUFFICIENT',reason:read.reason??'page inaccessible',temporal:'unknown'});continue;}
   const s:SourceItem=read.source;repo.saveSource(s);const ek='verification:extraction:'+fingerprint([extractor.signature,c.claim,c.conditions,c.values,c.rewardModifiers,s.title,s.text]),cachedExtract:any=repo.setting(ek);let output:any;
   if(cachedExtract&&Date.parse(cachedExtract.expiresAt)>Date.parse(now))output=cachedExtract.output;else{const response=await extractor.extract(s,c);repo.usage({...response.usage,sourceId:s.id,pilotId:'verification-v0'});output=response.output;repo.setSetting(ek,{output,expiresAt:new Date(Date.parse(now)+86400000).toISOString()});}
   let extraction;try{extraction=validateExtraction(output,s.title+'\n'+s.text);}catch{results.push({url:s.url,classification:'INSUFFICIENT',reason:'invalid extraction or ungrounded quote',temporal:'unknown'});continue;}
   if(extraction.kind==='NO_INTEL'){results.push({url:s.url,classification:'INSUFFICIENT',reason:extraction.reason,temporal:'unknown'});continue;}
   let strongest:any=null;const order=['SUPPORTS','CONTRADICTS','PARTIALLY_SUPPORTS','INSUFFICIENT','IRRELEVANT'];
   for(const raw of extraction.candidates){const relation=classifyVerification(c,raw,s,now);if(!strongest||order.indexOf(relation.classification)<order.indexOf(strongest.classification))strongest={...relation,candidate:normalize(raw,s)};}
   const dependence=verificationIndependence(s,c,original.map(e=>sourceMap.get(e.sourceId)!).filter(Boolean));
   const r={url:s.url,sourceId:s.id,sourceType:hit.sourceType,authorityRank:authorityRank(hit,c),independenceIdentity:dependence.key,independenceAssessment:dependence,...strongest};results.push(r);
   if(['SUPPORTS','CONTRADICTS','PARTIALLY_SUPPORTS'].includes(r.classification)){
    const stance=r.classification==='SUPPORTS'?'supports':r.classification==='CONTRADICTS'?'contradicts':'uncertain';
    const already=repo.evidence().some(e=>e.claimId===c.id&&e.sourceId===s.id&&e.match.verificationClassification===r.classification&&e.candidate.quote===r.candidate.quote);
    if(!already)repo.saveEvidence({id:randomUUID(),claimId:c.id,sourceId:s.id,stance,candidate:{...r.candidate,stance},match:{kind:'verification',verificationClassification:r.classification,reason:r.reason,temporal:r.temporal,authorityRank:r.authorityRank,verificationIndependenceKey:dependence.key,verificationIndependenceAssessment:dependence},createdAt:now});
   }
   const target=repo.claims().find(x=>x.id===c.id)!;repo.saveClaim({...target,...scoreConfidence(target,repo.evidence(),repo.sources(),now)});refreshPublication(repo,now);
   if(r.classification==='CONTRADICTS'&&r.authorityRank<=2){stop='STRONG_CONTRADICTION';break outer;}
   if(repo.claims().find(x=>x.id===c.id)?.publication?.state==='PUBLISHABLE'){stop='VERIFIED_ENOUGH';break outer;}
  }
 }
 if(stop==='INSUFFICIENT_EVIDENCE'&&(pages>=5||searches.length>=5))stop='SEARCH_LIMIT_REACHED';
 const after=repo.claims().find(x=>x.id===c.id)!,linked=repo.evidence().filter(e=>e.claimId===c.id),currentSources=repo.sources();
 const result={claimId:c.id,claim:c.claim,originalSources:original.map(e=>sourceMap.get(e.sourceId)),searches,results,pagesConsidered:pages,stopReason:stop,confidenceBefore:c.confidence,confidenceAfter:after.confidence,stateBefore:c.publication?.state,stateAfter:after.publication?.state,sourceCount:new Set(linked.map(e=>currentSources.find(s=>s.id===e.sourceId)!.url)).size,independentSupporting:Number(after.breakdown.independentSupporting??0),independentContradicting:Number(after.breakdown.independentContradicting??0),supportFamilies:[...new Set(linked.filter(e=>e.stance==='supports').map(e=>e.match.verificationIndependenceKey??sourceFamily(currentSources.find(s=>s.id===e.sourceId)!,currentSources)))],searchCostUSD:cost,publishingEnabled:false,cached:false};
 const ttl=c.rewardModifiers?.some(m=>m.period.text)?86400000:7*86400000;repo.setSetting(key,{...job,status:'COMPLETE',fingerprint:verificationFingerprint(repo,after),completedAt:now,reverifyAfter:new Date(Date.parse(now)+ttl).toISOString(),result});repo.audit({sourceId:'verification:'+c.id,stage:'VERIFICATION_COMPLETE',result,at:now});return result;
}
