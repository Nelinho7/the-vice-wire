import { randomUUID } from 'node:crypto';
import type { Repository,Usage,SourceItem } from './model.ts';
import { operationsConfig } from './operations-config.ts';
import { PilotLimitError } from './pilot-budget.ts';
import { safeError } from './security.ts';
export class BudgetLimitError extends PilotLimitError {}
const amount=(u:Usage)=>Math.max(u.reservedCost??0,u.estimatedCost??0);
const unresolved=(u:Usage)=>u.status!=='complete'||u.estimatedCost===null||(u.estimatedCost>(u.reservedCost??Infinity));
const paid=(repo:Repository)=>repo.usages().filter(u=>u.provider!=='fixture'&&u.provider!=='recorded-replay');
export function budgetStatus(repo:Repository,at=new Date().toISOString(),config=operationsConfig()){
  const all=paid(repo),month=at.slice(0,7),day=at.slice(0,10),monthly=all.filter(u=>u.at?.startsWith(month));
  const accounted=(u:Usage)=>u.status==='complete'&&u.estimatedCost!==null?u.estimatedCost:amount(u);
  const total=monthly.reduce((n,u)=>n+accounted(u),0),fraction=config.monthlyBudget?total/config.monthlyBudget:1;
  const group=(key:(u:Usage)=>string)=>Object.fromEntries([...new Set(monthly.map(key))].map(k=>[k,monthly.filter(u=>key(u)===k).reduce((n,u)=>n+accounted(u),0)]));
  return {month,currency:'USD',estimatedSpend:monthly.some(u=>u.estimatedCost===null)?null:total,accountedSpend:total,
    remaining:Math.max(0,config.monthlyBudget-total),monthlyLimit:config.monthlyBudget,dailyLimit:config.dailyBudget,
    spentToday:all.filter(u=>u.at?.startsWith(day)).reduce((n,u)=>n+accounted(u),0),llmCalls:monthly.length,
    inputTokens:monthly.reduce((n,u)=>n+(u.inputTokens??0),0),outputTokens:monthly.reduce((n,u)=>n+(u.outputTokens??0),0),
    unknownTokenCalls:monthly.filter(u=>u.inputTokens===null||u.outputTokens===null).length,
    unresolvedCalls:all.filter(unresolved).length,warnings:[50,75,90,100].filter(n=>fraction>=n/100),
    bySource:group(u=>u.source??'unknown'),byModel:group(u=>u.model),byStage:group(u=>u.stage),byDay:group(u=>u.at?.slice(0,10)??'unknown')};
}
export class CostBudget {
  repo:Repository;config:ReturnType<typeof operationsConfig>;runId:string;clock:()=>string;
  constructor(repo:Repository,config=operationsConfig(),runId=randomUUID(),clock=()=>new Date().toISOString()){
    for(const limit of [config.monthlyBudget,config.dailyBudget,config.runBudget])if(!Number.isFinite(limit)||limit<0||limit>300)throw Error('AI budget limits must be between zero and 300 USD');
    this.repo=repo;this.config=config;this.runId=runId;this.clock=clock;
  }
  async call<T>(source:SourceItem,stage:string,model:string,reservation:number,invoke:()=>Promise<{value:T;usage:Usage}>){
    if(!Number.isFinite(reservation)||reservation<0)throw new BudgetLimitError('Cannot reserve AI cost');
    const at=this.clock(),pending:Usage={id:randomUUID(),sourceId:source.id,source:source.sourceKey??source.platform,stage,model,provider:'openai',at,runId:this.runId,inputTokens:null,outputTokens:null,estimatedCost:null,reservedCost:reservation,status:'pending'};
    this.repo.transaction(()=>{
      const status=budgetStatus(this.repo,at,this.config),spent=paid(this.repo).filter(u=>u.runId===this.runId).reduce((n,u)=>n+(u.estimatedCost??u.reservedCost??0),0);
      if(status.unresolvedCalls)throw new BudgetLimitError('Unresolved AI cost blocks paid calls; reconcile the ledger first');
      if(status.accountedSpend+reservation>this.config.monthlyBudget)throw new BudgetLimitError('Monthly AI budget would be exceeded');
      if(status.spentToday+reservation>this.config.dailyBudget)throw new BudgetLimitError('Daily AI budget would be exceeded');
      if(spent+reservation>this.config.runBudget)throw new BudgetLimitError('Run AI budget would be exceeded');
      this.repo.usage(pending);
    });
    try{
      const result=await invoke(),usage={...pending,...result.usage,id:pending.id,at:pending.at,source:pending.source,runId:pending.runId,reservedCost:reservation,status:'complete' as const};
      this.repo.usage(usage);
      if(usage.estimatedCost!==null&&(!Number.isFinite(usage.estimatedCost)||usage.estimatedCost<0||usage.estimatedCost>reservation)){
        this.repo.usage({...usage,status:'error',estimatedCost:Number.isFinite(usage.estimatedCost)&&usage.estimatedCost>=0?usage.estimatedCost:null,error:'Provider usage exceeded reservation or was invalid'});
        throw new BudgetLimitError('Provider usage exceeded reservation; paid processing stopped');
      }
      return {value:result.value,usage};
    }catch(error){
      const saved=this.repo.usages().find(u=>u.id===pending.id);
      if(saved?.status==='pending')this.repo.usage({...pending,status:'error',error:safeError(error)});
      const clean=error instanceof BudgetLimitError?error:new Error(safeError(error));(clean as any).recordedUsage=true;throw clean;
    }
  }
}
