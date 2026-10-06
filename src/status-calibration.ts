import {createHash} from 'node:crypto';
import {locateQuote} from './provenance.ts';
import {DeterministicSemanticSupport} from './feed-quality.ts';
import type {Claim,Evidence,SourceItem} from './model.ts';
export type CalibrationReview={version:'authority-v1';reviewer:string;reviewKind:'ASSISTED_EDITORIAL'|'HUMAN_REVIEWED';at:string;fingerprint:string;sourceType:string;strength:'DIRECT'|'CORROBORATED'|'OBSERVED'|'INFERRED'|'WEAK';currentness:'CURRENT'|'POTENTIALLY_OUTDATED'|'OUTDATED'|'UNKNOWN';propositionKind:string;ambiguityResolved:boolean;originalMediaInspected?:boolean;notes:string};
export function calibrationFingerprint(c:Claim,evidence:Evidence[],sources:SourceItem[]){const es=evidence.filter(e=>e.claimId===c.id);return createHash('sha256').update(JSON.stringify({claim:c.claim,predicate:c.predicate,category:c.category,entities:c.entities,conditions:c.conditions,values:c.values,evidence:es,sources:sources.filter(s=>es.some(e=>e.sourceId===s.id))})).digest('hex');}
const host=(s:SourceItem)=>{try{return new URL(s.url).hostname.toLowerCase();}catch{return '';}};
const domain=(s:SourceItem,d:string)=>host(s)===d||host(s).endsWith('.'+d);
export function claimAuthority(c:Claim,e:Evidence,s:SourceItem,review:CalibrationReview){
 if(e.stance!=='supports'||s.raw.synthetic||s.raw.informantSuppressed||s.platform==='informant'||s.copiedFrom)return null;
 if(!locateQuote(s.title+'\n'+s.text,e.candidate.quote)||new DeterministicSemanticSupport().check(c,e,s).result!=='supported')return null;
 if(/\b(best|fastest|most realistic|guaranteed|always|unlimited|purchasable|can be purchased)\b/i.test(c.claim))return null;
 if(review.strength!=='DIRECT'&&!(review.strength==='OBSERVED'&&review.originalMediaInspected))return null;
 const kind=review.propositionKind;
 const official=domain(s,'rockstargames.com')&&(s.evidenceType==='OFFICIAL'||s.evidenceType==='OFFICIAL_FOOTAGE');
 const platform=(domain(s,'playstation.com')||domain(s,'xbox.com'))&&s.evidenceType==='OFFICIAL';
 if(official&&s.evidenceType==='OFFICIAL_FOOTAGE'&&kind==='FOOTAGE_OBSERVATION'&&review.originalMediaInspected&&/appears|visible|seen|footage/i.test(c.claim))return {sourceId:s.id,evidenceId:e.id,kind,explanation:'Directly reviewed official footage establishes this bounded appearance observation; no purchasability or general mechanic is implied.'};
 if(official&&['ANNOUNCED_RELEASE','ANNOUNCED_PLATFORM','CHARACTER_BIOGRAPHY','NAMED_SETTING','OFFICIAL_STORY','OFFICIAL_LABEL','OFFICIAL_ANNOUNCEMENT'].includes(kind)){
  if(s.evidenceType==='OFFICIAL_FOOTAGE'&&!(kind==='OFFICIAL_LABEL'&&/\bgallery names\b|\bcaption\b/i.test(c.claim)))return null;
  return {sourceId:s.id,evidenceId:e.id,kind,explanation:s.raw.textRepresentation==='EDITORIAL_FACTUAL_NOTES'?'Rockstar directly establishes this scoped proposition in the retained source-reviewed factual note (paraphrase, not a captured quotation).':'Rockstar directly states this scoped proposition in the attached evidence.'};
 }
 if(platform&&['ANNOUNCED_PLATFORM','PLATFORM_METADATA'].includes(kind))return {sourceId:s.id,evidenceId:e.id,kind,explanation:'The first-party platform listing establishes this platform-specific proposition; it does not establish general gameplay or performance guarantees.'};
 return null;
}
export const statusExplanations:Record<string,string>={VERIFIED:'Established by scoped authoritative evidence or strong independent evidence.',LIKELY:'Strong evidence supports this; material uncertainty remains.',DEVELOPING:'Specific credible intelligence is still being investigated.',UNVERIFIED:'Reported, but not sufficiently confirmed.',DISPUTED:'Meaningful supported evidence conflicts.',OUTDATED:'Superseded or no longer applicable to the current proposition.'};
export function calibratedStatus(c:Claim,evidence:Evidence[],sources:SourceItem[],base:any){
 const r=c.calibration;if(!r||r.version!=='authority-v1'||r.fingerprint!==calibrationFingerprint(c,evidence,sources))return base;
 const byId=new Map(sources.map(s=>[s.id,s]));const checker=new DeterministicSemanticSupport();
 const grounded=evidence.filter(e=>e.claimId===c.id).filter(e=>{const s=byId.get(e.sourceId);return s&&!s.raw.synthetic&&!s.raw.informantSuppressed&&s.platform!=='informant'&&!!locateQuote(s.title+'\n'+s.text,e.candidate.quote);});
 const supported=grounded.filter(e=>e.stance==='supports'&&checker.check(c,e,byId.get(e.sourceId)!).result==='supported');
 // Contradictions survive shared-source dedup: disagreement is not corroboration.
 const contrary=grounded.filter(e=>e.stance==='contradicts'&&checker.check({...c,claim:e.candidate.claim},e,byId.get(e.sourceId)!).result==='supported');
 const authority=supported.map(e=>claimAuthority(c,e,byId.get(e.sourceId)!,r)).filter(Boolean);
 const historicalEstablished=authority.length>0;
 let status='UNVERIFIED',confidence=base.confidence,reason='Retained provenance does not directly establish the proposition.';
 if(r.currentness==='OUTDATED'||r.currentness==='POTENTIALLY_OUTDATED'){status='POTENTIALLY_OUTDATED';if(historicalEstablished)confidence=95;reason='Historical evidence retained; this proposition is superseded or not currently applicable.';}
 else if(contrary.length){status='DISPUTED';confidence=Math.min(confidence,55);reason='Grounded conflicting evidence remains; authority cannot override it.';}
 else if(c.review==='needs review'&&!r.ambiguityResolved){status='NEEDS_REVIEW';reason='Matching ambiguity remains unresolved.';}
 else if(r.strength==='INFERRED'||!supported.length){confidence=Math.min(confidence,35);reason='The recorded proposition remains inferred or lacks direct supporting evidence.';}
 else if(authority.length&&r.currentness==='CURRENT'){status='VERIFIED';confidence=95;reason=authority[0]!.explanation;}
 else if(r.sourceType==='REPUTABLE_INDEPENDENT_REPORTING'&&r.strength==='DIRECT'&&r.currentness==='CURRENT'&&supported.some(e=>/developer|interview/i.test(String(byId.get(e.sourceId)!.raw.sourceContext??'')))){status='LIKELY';confidence=80;reason='Specific attributed developer reporting supports this pre-release report; primary statement or final-build confirmation remains unavailable.';}
 else if(base.status==='VERIFIED'&&supported.length>=4&&r.strength==='CORROBORATED'){status='VERIFIED';reason='Strong independent, semantically supported evidence establishes the scoped proposition.';}
 else if(base.status==='LIKELY'&&supported.length>=3&&r.strength==='CORROBORATED'){status='LIKELY';reason='Independent supporting evidence exists; material uncertainty remains.';}
 else if(['OBSERVED','CORROBORATED'].includes(r.strength)||['COMMUNITY_ANALYSIS','INDEPENDENT_OBSERVATION','SPECIALIST_RECAP'].includes(r.sourceType)){status='DEVELOPING';confidence=Math.max(45,Math.min(60,confidence));reason='Specific sourced analysis or observation merits investigation; it is not direct first-party confirmation or independent playtesting.';}
 return {...base,status,confidence,breakdown:{...base.breakdown,calibrationVersion:'authority-v1',confidenceRubric:{legacyBase:base.confidence,calibrated:confidence,authorityAdjustment:confidence-base.confidence,note:'Ordinal evidence rubric, not a measured probability or player success rate.'},authority:{established:authority.length>0,sources:authority,historicalEstablished},evidenceStrength:r.strength,currentness:r.currentness,statusReason:reason,statusExplanation:statusExplanations[status==='POTENTIALLY_OUTDATED'?'OUTDATED':status]??statusExplanations.UNVERIFIED,reviewKind:r.reviewKind,reviewedBy:r.reviewer,reviewedAt:r.at,calibratedContradictions:contrary.length,temporalValidity:r.currentness.toLowerCase()}};
}
