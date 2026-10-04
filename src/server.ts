import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { SqliteRepository } from './store.ts';
import { FixtureAdapter,sourceAdapter } from './adapters.ts';
import { FixtureProvider,extractionProvider } from './providers.ts';
import { runPipeline,refreshScores,report,reviewClaim,reassignEvidence } from './pipeline.ts';
import { pilotConfig } from './pilot-config.ts';
import { pilotReport } from './pilot-report.ts';
import { saveHumanEvaluation } from './human-evaluation.ts';
const repo=new SqliteRepository(process.env.DB_PATH??'data/vice-wire.sqlite');
const pilotRepo=new SqliteRepository(process.env.PILOT_DB_PATH??'data/reddit-pilot.sqlite');
const config=pilotConfig();
const host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??3210);
if(!['127.0.0.1','localhost','::1'].includes(host))throw Error('V0 has no authentication: bind only to loopback');
if((process.env.SOURCE_MODE??'fixture')!=='fixture'&&(process.env.EXTRACTOR_MODE??'fixture')==='fixture')throw Error('Live source requires EXTRACTOR_MODE=llm');
if(!repo.sources().length&&(process.env.SOURCE_MODE??'fixture')==='fixture')await runPipeline(repo,new FixtureAdapter(),new FixtureProvider());
const csrf=randomBytes(32).toString('hex');let busy=false;
const server=createServer(async(req,res)=>{
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  try {
    const expectedHost=`${host==='::1'?'[::1]':host}:${port}`;
    if(req.headers.host!==expectedHost){json(403,{error:'Invalid host'});return;}
    const url=new URL(req.url??'/',`http://${expectedHost}`);
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('../public/index.html',import.meta.url)));return;}
    if(req.method==='GET'&&['/app.js','/style.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css','X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('../public'+url.pathname,import.meta.url)));return;}
    if(req.method==='GET'&&url.pathname==='/api/state') {
      if(!busy){refreshScores(repo);refreshScores(pilotRepo);}
      const repositories=process.env.DB_PATH===process.env.PILOT_DB_PATH&&process.env.DB_PATH?[repo]:[repo,pilotRepo];
      json(200,{claims:repositories.flatMap(r=>r.claims()),sources:repositories.flatMap(r=>r.sources()),evidence:repositories.flatMap(r=>r.evidence()),audits:repositories.flatMap(r=>r.audits()),reviews:repositories.flatMap(r=>r.reviews()),evaluations:repositories.flatMap(r=>r.evaluations()),usage:repositories.flatMap(r=>r.usages()),report:report(repo),pilotReport:pilotReport(pilotRepo,config),mode:{source:process.env.SOURCE_MODE??'fixture',extractor:process.env.EXTRACTOR_MODE??'fixture'},csrf,busy});return;
    }
    if(req.method!=='POST'){json(404,{error:'Not found'});return;}
    if(req.headers['x-vice-wire-token']!==csrf||req.headers.origin!==`http://${expectedHost}`){json(403,{error:'Invalid request origin or token'});return;}
    if(busy){json(409,{error:'Ingestion is running; retry once complete'});return;}
    let text='';for await(const chunk of req){text+=chunk;if(text.length>16384){json(413,{error:'Body too large'});return;}}
    const body=JSON.parse(text||'{}');
    if(url.pathname==='/api/ingest'){if(process.env.SOURCE_MODE==='reddit')throw Error('Use staged CLI pilot commands for live Reddit; fixture dashboard ingestion does not start a pilot');busy=true;try{json(200,await runPipeline(repo,sourceAdapter(),extractionProvider()));}finally{busy=false;}return;}
    if(url.pathname==='/api/evaluate'){const target=pilotRepo.sources().some(s=>s.id===body.sourceId)?pilotRepo:repo;json(200,saveHumanEvaluation(target,body));return;}
    if(typeof body.note!=='string'||!body.note.trim()||body.note.length>2000){json(400,{error:'A review note is required (maximum 2000 characters)'});return;}
    const target=pilotRepo.claims().some(c=>c.id===body.claimId)?pilotRepo:repo;
    if(url.pathname==='/api/review'){reviewClaim(target,body.claimId,body.decision,body.note);json(200,{ok:true});return;}
    if(url.pathname==='/api/reassign'){if(!target.evidence().some(e=>e.id===body.evidenceId))throw Error('Evidence reassignment must stay within the same fixture/pilot database');reassignEvidence(target,body.evidenceId,body.claimId,body.note);json(200,{ok:true});return;}
    json(404,{error:'Not found'});
  }catch(error){console.error(error);json(400,{error:String(error)});}
});
server.listen(port,host,()=>console.log(`The Vice Wire V0: http://${host==='::1'?'[::1]':host}:${port}`));
function stop(){server.close(()=>{repo.close();pilotRepo.close();process.exit(0);});}process.on('SIGINT',stop);process.on('SIGTERM',stop);
