import {claimHumanEvidenceReview} from './source-provenance.ts';
import {sourceFamily,sourceNetwork} from './independence.ts';
import {rewardModifiers,temporaryReward} from './reward-modifiers.ts';
import {createHash,randomUUID} from 'node:crypto';
import {locateQuote,quoteForm} from './provenance.ts';
import {incomplete,unsupportedSuperlative,valueSemantics} from './semantics.ts';
import type {Claim,Evidence,SourceItem,Repository} from './model.ts';

export type PublicationState='NOT_ELIGIBLE'|'NEEDS_MORE_EVIDENCE'|'REVIEW_READY'|'PUBLISHABLE';
export type AssertionKind='OBSERVATION'|'GENERALIZED';
export type GateDimension={result:'pass'|'fail'|'review';reasons:string[];details?:unknown};
export type PublicationGate={version:string;state:PublicationState;assertionKind:AssertionKind;evaluatedAt:string;fingerprint:string;reasons:string[];dimensions:Record<string,GateDimension>;independentSources:number;eligibleEvidenceIds:string[];feedText:string;published:false};
export type PublicationReview={evidenceReview?:ReturnType<typeof claimHumanEvidenceReview>;id:string;claimId:string;reviewer:string;decision:'approve'|'reject'|'request_more_evidence';note:string;at:string;gateFingerprint:string;automaticState:PublicationState};
export interface SemanticSupportChecker {check(claim:Claim,evidence:Evidence,source:SourceItem):{result:'supported'|'unsupported'|'unknown';reason:string};}
export const gateVersion='feed-quality-v2';
export function assertionKind(c:Claim):AssertionKind{return /\bchat participants report|\b(i|my|we|our)\b|\b(?:one|a|two|three|\d+) (?:player|streamer)s? (?:just )?(?:reports?|observed|discovered|found)|\b(?:player|streamer) .+ reports?\b/i.test(c.claim)?'OBSERVATION':'GENERALIZED';}
function amounts(s:string){const result:number[]=[];for(const m of s.matchAll(/\b(\d[\d,.]*)\s*\+?\s*(millions?|thousand|[kmb])?\b/gi)){const scale:Record<string,number>={k:1e3,m:1e6,million:1e6,millions:1e6,thousand:1e3,b:1e9};result.push(Number(m[1].replaceAll(',',''))*(scale[m[2]?.toLowerCase()]??1));}if(/\b(?:a|one) million\b/i.test(s))result.push(1e6);return result;}
function terms(s:string){return quoteForm(s).toLowerCase().replace(/gta\$/g,'$').replace(/(\d),(?=\d)/g,'$1').replace(/\b(?:made|making|makes)\b/g,'make').replace(/\b(?:earned|earning|earns)\b/g,'earn').replace(/\b(?:approximately|around|roughly|about)\b/g,'approx').match(/[\p{L}\p{N}$]+/gu)??[];}
const stop=new Set('the a an is are was were be been of in on at to from for using with and or this that it i my we our one player players streamer streamers report reports reported'.split(' '));
export class DeterministicSemanticSupport implements SemanticSupportChecker {
 check(c:Claim,e:Evidence,s:SourceItem){
  const quote=e.candidate.quote,claim=c.claim;
  const declarations=quote.split(/(?<=[?!.])\s+|\n/).filter(t=>!t.trim().endsWith('?')).join(' ');
  if(!declarations.trim())return {result:'unsupported' as const,reason:'question_without_factual_observation'};
  if(/\b(?:will earn|going to earn|plan to|intend to)\b/i.test(quote))return {result:'unknown' as const,reason:'prospective_statement_not_observation'};
  if(/\balways\b|guaranteed|never fails|100%/i.test(claim))return {result:'unsupported' as const,reason:'unbounded_generalization'};
  if(c.rewardModifiers?.length&&[...claim.matchAll(/(?:GTA\$|\$)\s*(\d[\d,.]*)\s*(k|m|million|thousand)?\b/gi)].some(m=>!amounts(quote).includes(Number(m[1].replaceAll(',',''))*({k:1e3,m:1e6,million:1e6,thousand:1e3}[m[2]?.toLowerCase()??'']??1))))return {result:'unsupported' as const,reason:'multiplier_does_not_establish_absolute_payout'};
  if((c.rewardModifiers??[]).some(m=>!rewardModifiers(e.candidate,s).some(v=>v.kind===m.kind&&v.value===m.value&&v.reward===m.reward&&JSON.stringify(v.baseline)===JSON.stringify(m.baseline)&&JSON.stringify(v.result)===JSON.stringify(m.result))))return {result:'unsupported' as const,reason:'unsupported_reward_modifier'};
  if(c.values.some(v=>!amounts(quote).some(n=>Math.abs(n-v.value)/Math.max(Math.abs(v.value),1)<=0.05)))return {result:'unsupported' as const,reason:'unsupported_structured_value'};
  for(const v of c.values){
   if(v.currency&&v.currency!=='unknown'&&v.currency!=='non_currency'&&(v.unit!==v.currency||valueSemantics(v,{...e.candidate,conditions:c.conditions},s).currency!==v.currency))return {result:'unsupported' as const,reason:'unsupported_structured_currency'};
   const hours=v.timeBasis?.match(/^(\d+)_hours?$/)?.[1];
   if((v.timeBasis==='hour'&&!/(?:one|1|an|per)\s+hour\b|hourly|\/hour|\/h\b/i.test(quote))||(hours&&!new RegExp('(?:'+hours+'|'+(hours==='2'?'two':hours)+')\\s+hours?\\b','i').test(quote))||(/day/.test(v.timeBasis??'')&&!/day|daily/i.test(quote))||(v.measurement==='investment'&&!/cost|invest|requires|purchase/i.test(quote)))return {result:'unsupported' as const,reason:'unsupported_measurement_basis'};
  }
  if(unsupportedSuperlative({...e.candidate,claim}))return {result:'unsupported' as const,reason:'unsupported_comparison'};
  if(/\b(always|guaranteed|every|all players|never fails|100%)\b/i.test(claim)&&!/(always|guaranteed|every|all players|never fails|100%)/i.test(quote))return {result:'unsupported' as const,reason:'semantic_overstatement'};
  for(const word of ['patched','fixed','removed','confirmed','official','unlimited','requires','only'])if(new RegExp('\\b'+word+'\\b','i').test(claim)&&!new RegExp('\\b'+word+'\\b','i').test(quote))return {result:'unsupported' as const,reason:'evidence_does_not_support_normalized_claim'};
  const neg=/\b(no|not|never|cannot|can't|without|isn't|doesn't)\b/i,uncertain=/\b(may|might|perhaps|possibly|seems|suspect|think|inconclusive)\b/i;
  if((neg.test(claim)!==neg.test(quote))||(uncertain.test(quote)&&!uncertain.test(claim)))return {result:'unknown' as const,reason:'semantic_scope_or_polarity_unclear'};
  const scope=new Set(terms(claim+' '+Object.entries(c.conditions).flat().join(' ')));
  for(const qualifier of quote.matchAll(/\b(?:if|when|unless|provided that|as long as)\s+([^.!?]+)/gi))if(terms(qualifier[1]).filter(t=>!stop.has(t)).some(t=>!scope.has(t)))return {result:'unknown' as const,reason:'omitted_evidence_condition'};
  const cTerms=terms(claim).filter(t=>!stop.has(t)),qTerms=terms(declarations).filter(t=>!stop.has(t));
  let cursor=0;for(const word of qTerms)if(word===cTerms[cursor])cursor++;
  // Similar topics do not establish entailment. Borderline paraphrases require review.
  if(cursor===cTerms.length&&cTerms.length>=3)return {result:'supported' as const,reason:'normalized_meaning_supported'};
  return {result:'unknown' as const,reason:'semantic_support_requires_review'};
 }
}
function family(c:Claim){const t=(c.category+' '+c.predicate).toLowerCase();return /glitch|exploit/.test(t)?'exploit':/workaround|bug_fix/.test(t)?'workaround':/bug|freeze|error/.test(t)?'bug':/vehicle.*spawn|vehicle.*location|vehicle_spawn/.test(t)?'location':/easter|discovery/.test(t)?'discovery':/update|change|event/.test(t)?'change':/money|earn|payout|business|investment/.test(t)?'money':/location|spawn/.test(t)?'location':/strategy|method|gameplay/.test(t)?'method':'other';}
function condition(c:Claim,...names:string[]){return Object.entries(c.conditions).some(([k,v])=>names.some(n=>k.includes(n))&&!!v&&!/^(unknown|unspecified|none|not stated)$/i.test(v));}
function categoryRequirements(c:Claim,quotes:string[]):string[]{
 const f=family(c),text=quotes.join('\n'),reasons:string[]=[];
 if(c.rewardModifiers?.some(m=>!m.activity.length))reasons.push('missing_reward_activity_association');
 if(!c.entities.length||c.entities.every(x=>/^(gta|gta online|game|player|method|activity)$/i.test(x)))reasons.push('missing_specificity');
 if(f==='money'){
  if(!condition(c,'activity','mission','business','method')&&!c.entities.some(x=>/shop|lab|heist|contract|bunker|nightclub|mission/i.test(x)))reasons.push('missing_activity');
  if(!c.values.length&&!c.rewardModifiers?.length&&!/free|discount|double (?:money|payout)|no investment/i.test(text))reasons.push('missing_economic_detail');
  if(c.values.some(incomplete))reasons.push('missing_measurement_basis');
  if(!condition(c,'game')||(c.values.some(v=>v.measurement==='earnings_rate')&&!condition(c,'solo','players','playstyle','session','prerequisite','upgrade','requirements')))reasons.push('insufficient_context');
 }else if(f==='bug'){
  if(!condition(c,'trigger','action','when'))reasons.push('missing_bug_trigger');
  if(!condition(c,'platform')||!condition(c,'version','patch'))reasons.push('missing_platform_or_version');
 }else if(f==='workaround'){
  if(!condition(c,'problem'))reasons.push('missing_problem');
  if(!condition(c,'action','steps','method'))reasons.push('missing_actionable_detail');
  if(!/worked|works|fixed|resolved|tested|reproduced/i.test(text))reasons.push('missing_workaround_outcome');
  if(!condition(c,'platform')||!condition(c,'version','patch'))reasons.push('missing_platform_or_version');
 }else if(f==='location'){
  if(c.entities.length<2&&!condition(c,'location'))reasons.push('missing_location');
  if(!condition(c,'game'))reasons.push('insufficient_context');
 }else if(f==='exploit'||f==='method'){
  if(!condition(c,'action','steps','route','method'))reasons.push('missing_actionable_detail');
  if(!condition(c,'activity','mission','problem','goal'))reasons.push('missing_activity');
  if(f==='exploit'&&(!condition(c,'platform')||!condition(c,'version','patch')))reasons.push('missing_platform_or_version');
 }else if(f==='change'){
  if(!condition(c,'version','patch','date','update')&&!temporaryReward(c))reasons.push('missing_update_context');
  if(!c.rewardModifiers?.length&&!/pays|paid|added|removed|released|changed|no longer|without|background|reward|double/i.test(text))reasons.push('missing_gameplay_change');
 }else if(f==='discovery'){
  if(!condition(c,'location','trigger','action'))reasons.push('missing_discovery_context');
 }else reasons.push('unrecognized_category_requires_review');
 return reasons;
}
function independent(rows:{e:Evidence;s:SourceItem}[]){const seen=new Set<string>(),out:typeof rows=[];for(const r of rows){if(r.s.copiedFrom)continue;const keys=['id:'+r.s.id,'source:'+r.s.platform+':'+r.s.sourceId,'author:'+(r.s.author??r.s.independenceKey),'key:'+String(r.e.match.verificationIndependenceKey??sourceFamily(r.s,rows.map(x=>x.s))),...(sourceNetwork(r.s)?[sourceNetwork(r.s)!]:[]),'text:'+quoteForm(r.s.text).toLowerCase(),...(r.s.context?.threadId?['thread:'+r.s.platform+':'+r.s.context.threadId]:[])];if(keys.some(k=>seen.has(k)))continue;keys.forEach(k=>seen.add(k));out.push(r);}return out;}
export function evaluateFeedQuality(c:Claim,evidence:Evidence[],sources:SourceItem[],now=new Date().toISOString(),checker:SemanticSupportChecker=new DeterministicSemanticSupport()):PublicationGate{
 const byId=new Map(sources.map(s=>[s.id,s])),linked=evidence.filter(e=>e.claimId===c.id&&!byId.get(e.sourceId)?.raw.informantSuppressed),kind=assertionKind(c),dims:Record<string,GateDimension>={};
 const rows=linked.flatMap(e=>{const s=byId.get(e.sourceId);return s?[{e,s}]:[];});
 const located=rows.filter(({e,s})=>!!locateQuote(s.itemType==='comment'?s.text:s.title+'\n'+s.text,e.candidate.quote));
 dims.grounding={result:located.length?'pass':'fail',reasons:located.length?['grounded_evidence']:['unlocatable_evidence']};
 const semantic=located.map(r=>({...r,support:r.e.match.verificationClassification==='PARTIALLY_SUPPORTS'?{result:'unknown' as const,reason:'verification_scope_only_partially_supported'}:checker.check(c,r.e,r.s)}));
 const supported=semantic.filter(r=>r.support.result==='supported'&&r.e.stance!=='contradicts'),unknown=semantic.filter(r=>r.support.result==='unknown'&&r.e.stance!=='contradicts');
 dims.semanticSupport={result:supported.length?'pass':unknown.length?'review':'fail',reasons:supported.length?['normalized_meaning_supported']:[...new Set(semantic.filter(r=>r.e.stance!=='contradicts').map(r=>r.support.reason)),'evidence_does_not_support_normalized_claim']};
 const quotes=located.map(r=>r.e.candidate.quote),meta=/\b(?:guide|tutorial) (?:explains|covers|shows|walks)|\bi (?:will|also) (?:show|explain)|guide\s*[-:]\s*https?:\/\//i.test(quotes.join('\n'))||/\bthe (?:guide|tutorial) (?:explains|covers)/i.test(c.claim);
 const vague=/\b(?:good for money|best way|game changer|players are using|old requirements|daily .* limit can be hit)\b/i.test(c.claim);
 dims.specificity={result:vague||meta?'fail':'pass',reasons:vague||meta?['missing_specificity']:['specific_detail']};
 const requirements=categoryRequirements(c,quotes),incompleteContext=requirements.filter(r=>r!=='unrecognized_category_requires_review');
 const unsupportedConditions=Object.entries(c.conditions).filter(([key,value])=>!located.some(({s})=>{const primary=(s.itemType==='comment'?'':s.title+' ')+s.text,reference=/game|activity|mission|business/.test(key)?' '+(s.context?.postTitle??''):'';const available=new Set(terms(primary+reference));return terms(value).filter(t=>!stop.has(t)).every(t=>available.has(t));}));
 dims.context={result:incompleteContext.length?'fail':requirements.length||unsupportedConditions.length?'review':'pass',reasons:[...(requirements.length?requirements:[]),...(unsupportedConditions.length?['context_not_grounded']:[]),...(!requirements.length&&!unsupportedConditions.length?['category_context_complete']:[])],details:{family:family(c),unsupportedConditions:unsupportedConditions.map(([key])=>key)}};
 const actionable=!meta&&!vague&&requirements.every(r=>!['missing_activity','missing_location','missing_problem','missing_actionable_detail','missing_economic_detail','missing_gameplay_change','missing_discovery_context'].includes(r));
 dims.actionability={result:actionable?'pass':'fail',reasons:actionable?['actionable_detail']:['missing_actionable_detail']};
 const f=family(c),baseAgeDays={exploit:2,bug:7,workaround:7,money:14,change:7,method:14,discovery:14,location:365,other:14}[f];
 const timeContext=Object.values(c.conditions).join(' ')+' '+c.claim;
 const maxAgeDays=/this week|weekly/i.test(timeContext)?Math.min(baseAgeDays,7):/today|this day|daily bonus/i.test(timeContext)?Math.min(baseAgeDays,1):baseAgeDays;
 const periodValid=()=>!(c.rewardModifiers??[]).some(m=>(m.period.end&&now.slice(0,10)>m.period.end)||(m.period.start&&now.slice(0,10)<m.period.start));
 const timely=(r:{e:Evidence;s:SourceItem})=>{const date=r.e.candidate.temporal?.observedAt??r.s.timestamp,age=(Date.parse(now)-Date.parse(date))/86400000;return periodValid()&&Number.isFinite(age)&&age>=0&&age<=maxAgeDays;};
 const eligible=independent(supported.filter(timely)),freshUnknown=independent(unknown.filter(timely));
 const temporalRisk=c.status==='POTENTIALLY_OUTDATED'||c.breakdown.temporalValidity==='potentially_outdated';
 dims.freshness={result:temporalRisk||!semantic.some(timely)?'fail':'pass',reasons:temporalRisk?['possible_patch_invalidation']:!semantic.some(timely)?[periodValid()?'stale_time_sensitive_claim':'outside_reward_period']:['fresh_evidence'],details:{maxAgeDays}};
 const contradicted=linked.some(e=>e.stance==='contradicts')||Number(c.breakdown.independentContradicting??0)>0;
 dims.contradiction={result:contradicted?'fail':'pass',reasons:contradicted?['unresolved_contradiction']:['no_unresolved_contradiction']};
 const promo=meta||vague||quotes.some(q=>/\b(?:BEST MONEY METHOD|INFINITE GTA MONEY|subscribe|100% working)\b/i.test(q));
 dims.promotion={result:meta||vague?'fail':promo?'review':'pass',reasons:promo?['promotional_source_language']:['no_promotional_dependency']};
 const independence=eligible.length||freshUnknown.length,needed=kind==='GENERALIZED'?2:f==='discovery'?2:1;
 dims.independence={result:independence>=needed?'pass':'review',reasons:independence>=needed?[kind==='OBSERVATION'&&independence===1?'single_source_observation':'independent_evidence']:[independence===0?'no_recent_supported_evidence':'single_source_only'],details:{supporting:independence,groundedIndependentSources:independent(located.filter(r=>r.e.stance!=='contradicts')).length,required:needed}};
 const twitchOnly=located.length>0&&located.every(r=>r.s.platform==='twitch'&&r.s.raw.observationOnly===true);
 if(twitchOnly)dims.twitchObservation={result:'fail',reasons:['unverified_chat_report_needs_direct_gameplay_evidence']};
 if(rows.some(r=>r.s.platform==='informant'&&r.s.raw.informantContextRisk))dims.communityContext={result:'review',reasons:['informant_cross_context_disagreement_requires_review']};
 const hard=!located.length||dims.semanticSupport.result==='fail'||dims.specificity.result==='fail'||dims.actionability.result==='fail'||c.review==='invalid'||c.review==='duplicate';
 const missing=twitchOnly||dims.context.result==='fail'||dims.freshness.result==='fail'||contradicted;
 const needsReview=dims.communityContext?.result==='review'||dims.semanticSupport.result==='review'||dims.context.result==='review'||dims.independence.result==='review'||dims.promotion.result==='review'||c.review==='needs review'||c.status==='NEEDS_REVIEW';
 const state:PublicationState=hard?'NOT_ELIGIBLE':missing?'NEEDS_MORE_EVIDENCE':needsReview?'REVIEW_READY':'PUBLISHABLE';
 const reasons=[...new Set(Object.values(dims).flatMap(d=>d.reasons))];if(c.review==='invalid'||c.review==='duplicate')reasons.push('invalid_or_duplicate_claim');
 const fingerprint=createHash('sha256').update(JSON.stringify({version:gateVersion,claim:{claim:c.claim,category:c.category,predicate:c.predicate,entities:c.entities,conditions:c.conditions,values:c.values,rewardModifiers:c.rewardModifiers,review:c.review},evidence:linked.map(e=>({id:e.id,sourceId:e.sourceId,stance:e.stance,candidate:e.candidate})),sources:rows.map(r=>({id:r.s.id,text:r.s.text,title:r.s.title,timestamp:r.s.timestamp,author:r.s.author,independenceKey:r.s.independenceKey,copiedFrom:r.s.copiedFrom,context:r.s.context})),state,reasons,eligibleEvidenceIds:eligible.map(r=>r.e.id)})).digest('hex');
 const feedText=(kind==='OBSERVATION'?'Player observation: ':'')+c.claim+' Conditions: '+Object.entries(c.conditions).map(([key,value])=>`${key}: ${value}`).join('; ');
 return {version:gateVersion,state,assertionKind:kind,evaluatedAt:now,fingerprint,reasons,dimensions:dims,independentSources:independent(located.filter(r=>r.e.stance!=='contradicts')).length,eligibleEvidenceIds:eligible.map(r=>r.e.id),feedText,published:false};
}
export function refreshPublication(repo:Repository,now=new Date().toISOString()){const evidence=repo.evidence(),sources=repo.sources();for(const c of repo.claims()){const publication=evaluateFeedQuality(c,evidence,sources,now);repo.saveClaim({...c,assertionKind:publication.assertionKind,publication});}}
export function reviewPublication(repo:Repository,claimId:string,decision:PublicationReview['decision'],reviewer:string,note:string,now=new Date().toISOString()){
 if(!['approve','reject','request_more_evidence'].includes(decision)||!reviewer?.trim()||reviewer.length>100||!note?.trim()||note.length>2000)throw Error('Valid publication decision, reviewer and note required');
 const claim=repo.claims().find(c=>c.id===claimId);if(!claim)throw Error('Claim not found');
 const gate=evaluateFeedQuality(claim,repo.evidence(),repo.sources(),now);
 if(decision==='approve'&&!['REVIEW_READY','PUBLISHABLE'].includes(gate.state))throw Error('Hard failures and missing evidence cannot be approved for feed');
 const record:PublicationReview={id:randomUUID(),claimId,decision,reviewer:reviewer.trim(),note:note.trim(),at:now,gateFingerprint:gate.fingerprint,automaticState:gate.state,evidenceReview:claimHumanEvidenceReview(repo,claimId,now)};
 repo.savePublicationReview(record);return record;
}
export function effectiveEligibility(c:Claim,reviews:PublicationReview[]):{eligible:boolean;automaticState:PublicationState;reviewState:string;published:false}{
 const gate=c.publication;if(!gate)return {eligible:false,automaticState:'NOT_ELIGIBLE',reviewState:'not_evaluated',published:false};
 const latest=reviews.filter(r=>r.claimId===c.id).at(-1),current=latest?.gateFingerprint===gate.fingerprint;
 const eligible=(gate.state==='PUBLISHABLE'||(gate.state==='REVIEW_READY'&&current&&latest?.decision==='approve'))&&(!latest||(current&&latest.decision==='approve'));
 return {eligible,automaticState:gate.state,reviewState:latest?(current?latest.decision:'review_stale'):'unreviewed',published:false};
}
// Future feed consumers must use this boundary, not repository.claims().
// Re-evaluate time/evidence at read time so persisted eligibility cannot expire silently.
export function eligibleIntel(repo:Repository,now=new Date().toISOString()){
 const evidence=repo.evidence(),sources=repo.sources(),reviews=repo.publicationReviews();
 return repo.claims().map(c=>({...c,publication:evaluateFeedQuality(c,evidence,sources,now)})).filter(c=>effectiveEligibility(c,reviews).eligible);
}
