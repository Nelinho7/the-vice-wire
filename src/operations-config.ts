export function envNumber(name:string,fallback:number,min:number,max:number,integer=false){
  const raw=process.env[name],n=raw===undefined||raw===''?fallback:Number(raw);
  if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error(`Invalid ${name}`);
  return n;
}
export function operationsConfig(){return {
  dbPath:process.env.OPERATIONS_DB_PATH??'data/operations.sqlite',
  scanIntervalMs:envNumber('SCAN_INTERVAL_MINUTES',30,1,1440)*60000,
  monthlyBudget:envNumber('MONTHLY_AI_BUDGET_USD',300,0,300),
  dailyBudget:envNumber('DAILY_AI_BUDGET_USD',10,0,300),
  runBudget:envNumber('AI_RUN_BUDGET_USD',0.25,0,300),
  cacheTtlMs:envNumber('AI_CACHE_TTL_HOURS',168,0,720)*3600000,
  maxInputBytes:envNumber('LLM_MAX_INPUT_BYTES',48000,1000,200000,true),
  maxOutputTokens:envNumber('LLM_MAX_OUTPUT_TOKENS',1500,100,4000,true),
  scheduledEnabled:process.env.SCHEDULER_ENABLED==='true',
  paidApproved:process.env.PAID_PROCESSING_APPROVED==='true'
};}
