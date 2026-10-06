import type {CalibrationReview} from './status-calibration.ts';
import {calibrationFingerprint} from './status-calibration.ts';
import {scoreConfidence} from './intelligence.ts';
import {isGtaVI,recordStagingReview,stagingReview} from './gta-vi-staging.ts';
import {refreshPublication} from './feed-quality.ts';
import {corpusScope} from './gta-vi-corpus.ts';
import type {Repository,Claim,Evidence,SourceItem} from './model.ts';
export function reviewedPropositionKind(c:Claim,row:any){
 if(row.sourceType==='FIRST_PARTY_PLATFORM')return /launch platform/.test(c.claim)?'ANNOUNCED_PLATFORM':'PLATFORM_METADATA';
 if(row.sourceType!=='OFFICIAL_ROCKSTAR_TEXT')return 'NON_AUTHORITATIVE';
 if(/gallery names|caption/i.test(c.claim))return 'OFFICIAL_LABEL';
 if(row.topic==='release')return /scheduled|launches|release date/i.test(c.claim)?'ANNOUNCED_RELEASE':'OFFICIAL_ANNOUNCEMENT';
 if(row.topic==='platforms')return 'ANNOUNCED_PLATFORM';
 if(row.topic==='characters'||row.topic==='businesses')return 'CHARACTER_BIOGRAPHY';
 if(row.topic==='story')return 'OFFICIAL_STORY';
 if(row.topic==='world')return /names|state containing/i.test(c.claim)?'NAMED_SETTING':'OFFICIAL_ANNOUNCEMENT';
 return 'UNSCOPED';
}
export function reviewedCalibration(c:Claim,evidence:Evidence[],sources:SourceItem[],row:any,at:string,reviewKind:CalibrationReview['reviewKind']='ASSISTED_EDITORIAL'):CalibrationReview{
 if(row.id!==c.id||row.claim!==c.claim||!row.notes||!row.sourceContext)throw Error('Matching complete proposition review required');
 return {version:'authority-v1',reviewer:reviewKind==='HUMAN_REVIEWED'?'User-reviewed calibration with assisted editorial analysis':'Assisted editorial calibration; independent human sign-off pending',reviewKind,at,fingerprint:calibrationFingerprint(c,evidence,sources),sourceType:row.sourceType,strength:row.strength,currentness:row.currentness,propositionKind:reviewedPropositionKind(c,row),ambiguityResolved:true,notes:row.notes+' Matching audit: retained distinct proposition; no new merge, corroboration or source text introduced.'};
}
export function evaluateCalibration(repo:Repository,rows:any[],at:string,reviewKind:CalibrationReview['reviewKind']='ASSISTED_EDITORIAL'){
 const evidence=repo.evidence(),sources=repo.sources();return repo.claims().filter(isGtaVI).map(original=>{const row=rows.find(r=>r.id===original.id);if(!row)throw Error('Missing audited claim');const c={...original,calibration:reviewedCalibration(original,evidence,sources,row,at,reviewKind)};return {original,claim:{...c,...scoreConfidence(c,evidence,sources,at)},review:row};});
}
export function applyCalibration(repo:Repository,rows:any[],at:string,reviewKind:CalibrationReview['reviewKind']='ASSISTED_EDITORIAL'){
 const assessed=evaluateCalibration(repo,rows,at,reviewKind),before=JSON.stringify({sources:repo.sources(),evidence:repo.evidence(),usages:repo.usages(),profiles:repo.communityRecords('profiles'),seeds:repo.communityRecords('seededContributions'),policy:repo.setting('seededPresentation'),nonVI:repo.claims().filter(c=>!isGtaVI(c))});
 repo.transaction(()=>{for(const item of assessed){const {claim:c,original}=item,old=stagingReview(repo,original);repo.saveClaim(c);repo.saveCommunityRecord('statusCalibrationReviews',c.id,{...c.calibration,claimId:c.id,originalStatus:original.status,newStatus:c.status,expectedStatus:item.review.expectedStatus,originalMatchingReview:original.review,publishingEnabled:false});if(!old)throw Error('Missing original staging review');}
 // Score calibration does not change publication/verification/reputation standards.
 refreshPublication(corpusScope(repo),at);
 for(const item of assessed){const c=repo.claims().find(c=>c.id===item.claim.id)!;const old=stagingReview(repo,c)!;recordStagingReview(repo,c,{...old,reviewer:c.calibration!.reviewer,notes:old.notes+' Status calibration: '+String(c.breakdown.statusReason)+' Original source check retained; no new fetch.',calibrationVersion:'authority-v1'},at);}
 const after=JSON.stringify({sources:repo.sources(),evidence:repo.evidence(),usages:repo.usages(),profiles:repo.communityRecords('profiles'),seeds:repo.communityRecords('seededContributions'),policy:repo.setting('seededPresentation'),nonVI:repo.claims().filter(c=>!isGtaVI(c))});if(before!==after)throw Error('Calibration altered protected graph, provider usage or community records');repo.setSetting('gtaVIStatusCalibration',{version:'authority-v1',at,claims:assessed.length,reviewKind,publishingEnabled:false});repo.audit({sourceId:'gta-vi-calibration',stage:'STATUS_CALIBRATION',at,result:{claims:assessed.length,reviewKind,legacyUnchanged:true,sourceTextUnchanged:true,evidenceUnchanged:true,noExternalCalls:true,publishingEnabled:false}});});return assessed;
}
