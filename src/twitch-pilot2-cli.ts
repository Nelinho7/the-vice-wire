import {writeFileSync} from 'node:fs';
import {TwitchClient,TwitchAdapter,assertTwitchAccess,parseStream} from './twitch.ts';
import {discoverPilot2,scoreStream} from './twitch-selection.ts';
import {monitorTwitch} from './twitch-cli.ts';
import {SqliteRepository} from './store.ts';
import {operationsConfig} from './operations-config.ts';
import {CostBudget} from './budget.ts';
import {OpenAIProvider} from './providers.ts';
import {runPipeline} from './pipeline.ts';
import {safeError,redactSecrets} from './security.ts';
const command=process.argv[2];let repo:SqliteRepository|undefined;
try{
 repo=new SqliteRepository(operationsConfig().dbPath);
 if(command==='discover'){
  assertTwitchAccess();if(repo.setting('twitch:pilot2:experiment'))throw Error('Pilot 2 already started; no further discovery or collection authorized');const client=new TwitchClient();await client.auth();const result=await discoverPilot2(client);repo.setSetting('twitch:pilot2:selection',result);writeFileSync('data/twitch-pilot2-selection.json',JSON.stringify(redactSecrets(result),null,2));console.log(JSON.stringify({considered:result.candidates.length,pages:result.pages,apiRequests:result.apiRequests,selected:result.selected.map(c=>({streamer:c.stream.user_name,title:c.stream.title,viewers:c.stream.viewer_count,language:c.stream.language,tags:c.stream.tags,score:c.relevance.score,positive:c.relevance.positiveSignals,negative:c.relevance.negativeSignals,id:c.stream.user_id})),rejected:result.candidates.length-result.selected.length},null,2));
 }else if(command==='monitor'){
  assertTwitchAccess();const selection:any=repo.setting('twitch:pilot2:selection'),review:any=repo.setting('twitch:pilot2:cohort-review');if(!selection||!review?.approvedIds?.length)throw Error('Manual cohort review required before monitoring');if(Date.now()-Date.parse(selection.at)>900000)throw Error('Candidate discovery is stale; inspect/revalidate before monitoring');
  const client=new TwitchClient(),auth=await client.auth();const live=await client.request('streams',{user_id:review.approvedIds});const streams=live.map(parseStream).filter(s=>review.approvedIds.includes(s.user_id)).map(s=>({...s,description:selection.candidates.find((c:any)=>c.stream.user_id===s.user_id)?.stream.description??''})).filter(s=>s.game_id==='32982'&&scoreStream(s).eligible).slice(0,10);if(!streams.length)throw Error('No approved suitable streams remain live; no collection started');
  repo.transaction(()=>{if(repo!.setting('twitch:pilot2:experiment'))throw Error('Pilot 2 already started; no repeat');repo!.setSetting('twitch:pilot2:experiment',{started:new Date().toISOString(),streams,publishingEnabled:false});});
  const result=await monitorTwitch(client,streams,auth.userId,60,{maxWindows:15,questionClusters:true,progress:data=>{repo!.setSetting('twitch:pilot2:progress',data);writeFileSync('data/twitch-pilot2-progress.json',JSON.stringify(data));}});
  repo.setSetting('twitch:pilot2:experiment',result);writeFileSync('data/twitch-pilot2.json',JSON.stringify(redactSecrets(result),null,2));console.log(JSON.stringify({streams:streams.length,duration:result.durationSeconds,events:result.events,windows:result.windows.length,apiRequests:result.apiRequests,error:result.error,published:0}));
 }else if(command==='process'){
  if(process.env.PAID_PROCESSING_APPROVED!=='true')throw Error('Paid processing approval required');const collection:any=repo.setting('twitch:pilot2:experiment');if(!collection?.windows)throw Error('No completed collection');repo.transaction(()=>{if(repo!.setting('twitch:pilot2:processing'))throw Error('Pilot 2 processing already started');repo!.setSetting('twitch:pilot2:processing',{started:new Date().toISOString(),cap:10});});
  const before=repo.usages().length,adapter=new TwitchAdapter(collection.windows);const items=(await adapter.fetchItems()).map(s=>({...s,pilotId:'twitch-pilot2'}));const outcome=await runPipeline(repo,{name:'twitch-pilot2',fetchItems:async()=>items},new OpenAIProvider(new CostBudget(repo)));
  const usages=repo.usages().slice(before),report={...outcome,consideredWindows:items.length,aiWindows:new Set(usages.map(u=>u.sourceId)).size,usage:usages,publishingEnabled:false};repo.setSetting('twitch:pilot2:processing',report);writeFileSync('data/twitch-pilot2-processing.json',JSON.stringify(redactSecrets(report),null,2));console.log(JSON.stringify({considered:items.length,aiWindows:report.aiWindows,calls:usages.length,newEvidence:repo.evidence().filter(e=>items.some(s=>s.id===e.sourceId)).length,stopped:outcome.stopped}));
 }else throw Error('Use discover, monitor, process');
}catch(error){console.error(safeError(error));process.exitCode=1;}finally{repo?.close();}
