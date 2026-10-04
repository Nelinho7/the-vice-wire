import { assertRedditAccess,assertLLMAccess } from './pilot-config.ts';
import type { PilotConfig } from './pilot-config.ts';
import type { Repository,SourceItem } from './model.ts';
import { RedditAdapter,RedditClient } from './reddit.ts';
import { CompatibleLLMProvider } from './providers.ts';
import { BudgetedProvider } from './pilot-budget.ts';
import { runPipeline,refreshScores } from './pipeline.ts';
import { pilotReport } from './pilot-report.ts';
type PilotState={authenticated?:boolean;authAt?:string;cursor?:number;smokeApproved?:{note:string;at:string};intelligenceApproved?:{note:string;at:string};lastSampling?:Record<string,unknown>;lastStage?:string};
export function pilotSources(repo:Repository,config:PilotConfig){return repo.sources().filter(s=>s.platform==='reddit'&&s.pilotId===config.pilotId);}
function state(repo:Repository,config:PilotConfig):PilotState{return (repo.setting('pilot:'+config.pilotId)??{}) as PilotState;}
export async function authenticatePilot(repo:Repository,config:PilotConfig,client=new RedditClient(config)){
  assertRedditAccess();const result=await client.testAccess();repo.setSetting('pilot:'+config.pilotId,{...state(repo,config),authenticated:true,authAt:new Date().toISOString()});return result;
}
export async function collectPilot(repo:Repository,config:PilotConfig,stage:'smoke'|'intelligence'|'pilot',target:number,client?:RedditClient){
  assertRedditAccess();const s=state(repo,config);if(!s.authenticated)throw Error('Run pilot:auth successfully first');
  if(stage!=='smoke'&&!s.smokeApproved)throw Error('Inspect the 10-item smoke, then approve smoke before collecting 50 items');
  if(stage==='pilot'&&!s.intelligenceApproved)throw Error('Inspect and human-label the 50-item intelligence test, then approve intelligence before the larger pilot');
  if(stage==='smoke'&&target!==10||stage==='intelligence'&&target!==50||stage==='pilot'&&(target<200||target>500))throw Error('Invalid stage target');
  if(target>config.maxSourceItems)throw Error(`Requested ${target} exceeds PILOT_MAX_SOURCE_ITEMS=${config.maxSourceItems}; explicitly configure the larger stage limit`);
  const existing=pilotSources(repo,config),remaining=Math.max(0,target-existing.length);
  if(!remaining)return {added:0,note:'Stage target already collected',report:pilotReport(repo,config)};
  const adapter=new RedditAdapter({config,client,target:remaining,knownIds:repo.sources().map(x=>x.id),cursor:s.cursor??0});
  const items=await adapter.fetchItems();const at=new Date().toISOString();
  let added=0;
  repo.transaction(()=>{for(const item of items){if(pilotSources(repo,config).length>=Math.min(target,config.maxSourceItems))break;const original=repo.sources().find(x=>x.id===item.id);if(original)continue;const source={...item,ingestedAt:at,firstDetectedAt:at,detectionLatencyMs:Math.max(0,Date.parse(at)-Date.parse(item.timestamp))};repo.saveSource(source);added++;repo.audit({sourceId:item.id,stage:'INGEST',at,result:{adapter:'reddit',pilotStage:stage}});}repo.setSetting('pilot:'+config.pilotId,{...s,cursor:adapter.cursor,lastSampling:adapter.diagnostics,lastStage:stage});});
  return {added,sampling:adapter.diagnostics,report:pilotReport(repo,config)};
}
export async function processPilot(repo:Repository,config:PilotConfig,retryErrors=false){
  assertLLMAccess(config);
  const sources=pilotSources(repo,config);if(sources.length>config.maxSourceItems)throw Error('Database exceeds configured source cap; raise cap explicitly to process it');
  const provider=new CompatibleLLMProvider();
  const budgeted=new BudgetedProvider(repo,config,provider,s=>provider.maximumCost(s,config.inputPrice!,config.outputPrice!,config.maxInputBytes,config.maxOutputTokens));
  const eligible=sources.filter(s=>retryErrors||!repo.audits().some(a=>a.sourceId===s.id&&a.stage==='ERROR'));
  const result=await runPipeline(repo,{name:'reddit-pilot-stored',fetchItems:async()=>eligible},budgeted);
  return {processing:result,report:pilotReport(repo,config)};
}
export function approvePilotStage(repo:Repository,config:PilotConfig,stage:string,note:string){
  if(!note.trim())throw Error('An inspection note is required');const report=pilotReport(repo,config),s=state(repo,config);
  if(stage==='smoke'){if(report.sourceItemsIngested<10||s.lastSampling?.stopReason)throw Error('Smoke must collect 10 items without access/parser errors before approval');s.smokeApproved={note,at:new Date().toISOString()};}
  else if(stage==='intelligence'){if(report.sourceItemsIngested<50||report.unprocessed||report.unresolvedProcessingErrors||s.lastSampling?.stopReason||report.humanLabeledItems<10)throw Error('Intelligence approval needs 50 processed items, no unresolved errors, and at least 10 human evaluations');s.intelligenceApproved={note,at:new Date().toISOString()};}
  else throw Error('Approve smoke or intelligence');repo.setSetting('pilot:'+config.pilotId,s);return s;
}
export function resetLivePilot(repo:Repository,config:PilotConfig){repo.resetPilot(config.pilotId);refreshScores(repo);return {resetPilotId:config.pilotId,preservedFixtureItems:repo.sources().filter(s=>s.platform!=='reddit').length};}
