import { randomUUID } from 'node:crypto';
import type { ExtractionProvider } from './providers.ts';
import type { SourceItem,Repository,Usage } from './model.ts';
import type { PilotConfig } from './pilot-config.ts';
export class PilotLimitError extends Error {}
export function budgetLedger(repo:Repository,config:PilotConfig){
  const usages=repo.usages().filter(u=>u.pilotId===config.pilotId);
  return {calls:usages.length,accountedCost:usages.reduce((n,u)=>n+(u.estimatedCost??u.reservedCost??0),0),unresolved:usages.filter(u=>u.status!=='complete'||u.estimatedCost===null||(u.reservedCost!==undefined&&u.estimatedCost>u.reservedCost)).length};
}
export class BudgetedProvider implements ExtractionProvider {
  repo:Repository;config:PilotConfig;inner:ExtractionProvider;maximum:(s:SourceItem)=>number;
  constructor(repo:Repository,config:PilotConfig,inner:ExtractionProvider,maximum:(s:SourceItem)=>number){this.repo=repo;this.config=config;this.inner=inner;this.maximum=maximum;}
  async extract(s:SourceItem){
    const reserved=this.maximum(s);if(!Number.isFinite(reserved)||reserved<0)throw new PilotLimitError('Cannot calculate a safe cost reservation');
    const pending:Usage={id:randomUUID(),sourceId:s.id,pilotId:this.config.pilotId,at:new Date().toISOString(),stage:'EXTRACT',provider:'compatible-llm',model:process.env.LLM_MODEL??'unknown',inputTokens:null,outputTokens:null,estimatedCost:null,reservedCost:reserved,status:'pending'};
    this.repo.transaction(()=>{
      const ledger=budgetLedger(this.repo,this.config);
      if(ledger.calls>=this.config.maxLLMCalls)throw new PilotLimitError('Maximum pilot LLM calls reached');
      if(ledger.unresolved)throw new PilotLimitError('Prior LLM usage/cost is unknown, interrupted, or exceeded its reservation. Stop and reconcile ledger before more calls.');
      if(ledger.accountedCost+reserved>this.config.maxEstimatedSpend)throw new PilotLimitError('Next call reservation would exceed maximum estimated pilot spend');
      this.repo.usage(pending);
    });
    try{const result=await this.inner.extract(s);const usage={...pending,...result.usage,status:'complete' as const};this.repo.usage(usage);return {...result,usage};}
    catch(error){this.repo.usage({...pending,status:'error',error:String(error)});const recorded=new Error(String(error));(recorded as any).recordedUsage=true;throw recorded;}
  }
}
