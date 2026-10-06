import {readFileSync,writeFileSync} from 'node:fs';
import {SqliteRepository} from './store.ts';
import {operationsConfig} from './operations-config.ts';
import {WebSourceAdapter,SearchManifestProvider} from './web.ts';
import {runPipeline} from './pipeline.ts';
import {OpenAIProvider} from './providers.ts';
import {CostBudget} from './budget.ts';
import {safeError} from './security.ts';
const repo=new SqliteRepository(operationsConfig().dbPath);
try{
 const command=process.argv[2];
 if(command==='collect'){
  if(repo.setting('web:v0:collection'))throw Error('Web V0 already started; repeat collection not authorized');
  const config=JSON.parse(readFileSync('config/web-pilot.json','utf8'));repo.setSetting('web:v0:collection',{started:new Date().toISOString(),publishingEnabled:false});
  const adapter=new WebSourceAdapter(new SearchManifestProvider(config.hits),config.queries,config.policies,config.maxItems),items=await adapter.fetchItems();
  for(const item of items)repo.saveSource(item);
  const collection={at:new Date().toISOString(),items:items.map(s=>s.id),requests:adapter.requests,skips:adapter.skips,policies:config.policies,discoveryProvider:config.discoveryProvider,searchCostUSD:config.discoveryCostUSD,extractionCostUSD:0,publishingEnabled:false};repo.setSetting('web:v0:collection',collection);writeFileSync('data/web-v0-collection.json',JSON.stringify(collection,null,2));console.log(JSON.stringify({items:items.length,requests:adapter.requests,skips:adapter.skips,domains:[...new Set(items.map(s=>s.raw.domain))]}));
 }else if(command==='process'){
  if(process.env.PAID_PROCESSING_APPROVED!=='true')throw Error('Paid processing approval required');const collection:any=repo.setting('web:v0:collection');if(!collection?.items)throw Error('No completed web collection');if(repo.setting('web:v0:processing'))throw Error('One bounded process only; no automatic retry');repo.setSetting('web:v0:processing',{started:new Date().toISOString()});const sourceIds=new Set(collection.items),before=repo.usages().map(u=>u.id),items=repo.sources().filter(s=>sourceIds.has(s.id));const outcome=await runPipeline(repo,{name:'web-v0',fetchItems:async()=>items},new OpenAIProvider(new CostBudget(repo)));const usage=repo.usages().filter(u=>!before.includes(u.id)),result={processed:outcome.processed,skipped:outcome.skipped,stopped:outcome.stopped,usage,publishingEnabled:false};repo.setSetting('web:v0:processing',result);writeFileSync('data/web-v0-processing.json',JSON.stringify(result,null,2));console.log(JSON.stringify({processed:result.processed,calls:usage.length,cost:usage.reduce((n,u)=>n+(u.estimatedCost??0),0),stopped:result.stopped}));
 }else throw Error('Use collect or process');
}catch(e){console.error(safeError(e));process.exitCode=1;}finally{repo.close();}
