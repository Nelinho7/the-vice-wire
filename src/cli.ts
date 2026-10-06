import { SqliteRepository } from './store.ts';
import { sourceAdapter } from './adapters.ts';
import { extractionProvider } from './providers.ts';
import { runPipeline } from './pipeline.ts';
import { evaluate } from './evaluation.ts';
const command=process.argv[2]??'evaluate';
if(command==='evaluate')console.log(JSON.stringify(await evaluate(),null,2));
else if(command==='ingest'||command==='worker') {
  if((process.env.EXTRACTOR_MODE??'fixture')!=='fixture'&&process.env.PAID_PROCESSING_APPROVED!=='true')throw Error('Paid ingestion requires explicit PAID_PROCESSING_APPROVED=true; use llm:smoke for tiny validation');
  if(process.env.SOURCE_MODE==='reddit')throw Error('Use staged pilot commands for Reddit; direct ingestion/worker disabled to preserve pilot guardrails');
  if((process.env.SOURCE_MODE??'fixture')!=='fixture'&&(process.env.EXTRACTOR_MODE??'fixture')==='fixture')throw Error('Live sources require EXTRACTOR_MODE=llm');
  const repo=new SqliteRepository(process.env.DB_PATH??'data/vice-wire.sqlite');
  try {do{console.log(JSON.stringify(await runPipeline(repo,sourceAdapter(),extractionProvider()),null,2));if(command==='worker'){const interval=Number(process.env.WORKER_INTERVAL_MS??900000);if(!Number.isFinite(interval)||interval<60000)throw Error('Worker interval must be at least 60000ms');await new Promise(resolve=>setTimeout(resolve,interval));}}while(command==='worker');}finally{repo.close();}
}else throw Error('Use ingest, evaluate or worker');
