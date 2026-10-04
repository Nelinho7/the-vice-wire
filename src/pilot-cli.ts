import { writeFile,mkdir,readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SqliteRepository } from './store.ts';
import { pilotConfig,assertLLMAccess } from './pilot-config.ts';
import { authenticatePilot,collectPilot,processPilot,approvePilotStage,resetLivePilot } from './pilot.ts';
import { pilotReport } from './pilot-report.ts';
import { saveHumanEvaluation } from './human-evaluation.ts';
const config=pilotConfig(),command=process.argv[2],args=process.argv.slice(3);
const value=(flag:string)=>{const index=args.indexOf(flag);return index<0?undefined:args[index+1];};
const repo=new SqliteRepository(process.env.PILOT_DB_PATH??'data/reddit-pilot.sqlite');
try{
  let result:unknown;
  if(command==='auth')result=await authenticatePilot(repo,config);
  else if(command==='smoke')result=await collectPilot(repo,config,'smoke',10);
  else if(command==='intelligence'){assertLLMAccess(config);const ingestion=await collectPilot(repo,config,'intelligence',50);if((ingestion as any).sampling?.stopReason)throw Error('Collection stopped: '+(ingestion as any).sampling.stopReason+'; sources retained, inspect pilot:report before processing');result={ingestion,processing:await processPilot(repo,config)};}
  else if(command==='ingest')result=await collectPilot(repo,config,'pilot',Number(value('--items')??200));
  else if(command==='process')result=await processPilot(repo,config,args.includes('--retry-errors'));
  else if(command==='approve')result=approvePilotStage(repo,config,args[0],value('--note')??'');
  else if(command==='label'){const file=value('--file');if(!file)throw Error('Use --file path-to-evaluation.json');const payload=JSON.parse(await readFile(file,'utf8'));const rows=Array.isArray(payload)?payload:[payload];result=repo.transaction(()=>rows.map(row=>saveHumanEvaluation(repo,row)));}
  else if(command==='report'){result=pilotReport(repo,config);const output=value('--output');if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));}}
  else if(command==='export'){result={report:pilotReport(repo,config),sources:repo.sources().filter(s=>s.platform==='reddit'&&s.pilotId===config.pilotId),evaluations:repo.evaluations().filter(e=>repo.sources().some(s=>s.id===e.sourceId&&s.platform==='reddit'&&s.pilotId===config.pilotId))};const output=value('--output');if(!output)throw Error('Use --output private-benchmark.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2));result={exported:output,note:'Contains permitted source text and reviewer labels; keep local according to approved retention.'};}
  else if(command==='reset'){if(value('--pilot-id')!==config.pilotId)throw Error('Reset requires --pilot-id matching PILOT_ID');result=resetLivePilot(repo,config);}
  else throw Error('Use auth, smoke, intelligence, ingest, process, approve, label, report, export or reset');
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(String(error));process.exitCode=1;}finally{repo.close();}

