import { randomUUID } from 'node:crypto';
import { categories } from './model.ts';
import type { Repository,HumanEvaluation } from './model.ts';
export const matchingLabels=['correctly matched existing claim','should have created new claim','incorrectly merged','correctly created new claim'];
export function saveHumanEvaluation(repo:Repository,input:any,at=new Date().toISOString()):HumanEvaluation {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Evaluation must be an object');
  if(!repo.sources().some(s=>s.id===input.sourceId))throw Error('SourceItem not found');
  if(!['YES','NO','UNCERTAIN'].includes(input.useful)||!['YES','NO'].includes(input.showToPlayer))throw Error('Invalid usefulness/feed decision');
  if(typeof input.reviewer!=='string'||!input.reviewer.trim()||input.reviewer.length>100)throw Error('Reviewer identifier is required');
  if(typeof input.notes!=='string'||input.notes.length>5000)throw Error('Invalid review notes');
  const yes=input.useful==='YES';
  if(yes&&(!categories.includes(input.category)||!['correct','partially correct','incorrect'].includes(input.extractionQuality)||!matchingLabels.includes(input.matching)||!Number.isInteger(input.usefulness)||input.usefulness<1||input.usefulness>5))throw Error('YES needs category, extraction quality, matching label and usefulness score 1–5');
  if(input.useful!=='YES'&&input.showToPlayer==='YES')throw Error('Only useful=YES can be shown to a player');
  const linked=repo.evidence().filter(e=>e.sourceId===input.sourceId).map(e=>e.claimId);
  const claimIds=input.claimIds??[...new Set(linked)];
  if(!Array.isArray(claimIds)||claimIds.some((id:any)=>typeof id!=='string'||!linked.includes(id)))throw Error('Evaluation claim IDs must be linked to this source');
  const evaluation:HumanEvaluation={id:randomUUID(),sourceId:input.sourceId,reviewer:input.reviewer.trim(),useful:input.useful,category:yes?input.category:null,extractionQuality:yes?input.extractionQuality:null,matching:yes?input.matching:null,usefulness:yes?input.usefulness:null,showToPlayer:input.showToPlayer,notes:input.notes,at,claimIds:[...new Set(claimIds)]};
  repo.saveEvaluation(evaluation);return evaluation;
}
export function latestEvaluations(repo:Repository){const latest=new Map<string,HumanEvaluation>();for(const evaluation of repo.evaluations())latest.set(evaluation.sourceId,evaluation);return latest;}
