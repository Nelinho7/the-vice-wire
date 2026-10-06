import type {Claim} from './model.ts';
// Shared consumer labels; this is the existing mapping, not a new confidence rule.
export function status(c:Claim){if(c.status==='POTENTIALLY_OUTDATED')return 'OUTDATED';if(c.status==='DISPUTED'||Number(c.breakdown.calibratedContradictions??c.breakdown.independentContradicting??0)>0)return 'DISPUTED';return ['VERIFIED','LIKELY','DEVELOPING','UNVERIFIED'].includes(c.status)?c.status:'UNVERIFIED';}
