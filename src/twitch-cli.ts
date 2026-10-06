import { writeFileSync,readFileSync } from 'node:fs';
import { TwitchClient,TwitchSignals,TwitchAdapter,assertTwitchAccess,parseStream,metadataSource } from './twitch.ts';
import { SqliteRepository } from './store.ts';
import { operationsConfig,envNumber } from './operations-config.ts';
import { CostBudget } from './budget.ts';
import { OpenAIProvider } from './providers.ts';
import { runPipeline } from './pipeline.ts';
import { safeError,redactSecrets } from './security.ts';
export async function monitorTwitch(client:TwitchClient,streams:Awaited<ReturnType<TwitchClient['discover']>>,userId:string,minutes:number,options:{maxWindows?:number;progress?:(data:any)=>void;questionClusters?:boolean}={}){
 if(!Number.isFinite(minutes)||minutes<30||minutes>60)throw Error('Pilot duration must be 30-60 minutes');
 const started=new Date().toISOString(),signals=new TwitchSignals(streams,started,{maxWindows:options.maxWindows,questionClusters:options.questionClusters});let error:string|null=null,subscriptions=0;const progress=setInterval(()=>options.progress?.({started,elapsedSeconds:(Date.now()-Date.parse(started))/1000,subscriptions,apiRequests:client.requests,events:signals.events,windows:signals.windows.map(w=>({id:w.id,creator:w.stream.user_name,reasons:w.reasons,priority:w.priority,messageCount:w.messages.length,complete:Date.now()>=Date.parse(w.end)}))}),30000);
 await new Promise<void>((resolve,reject)=>{
  const socket=new WebSocket('wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30');let finished=false,welcomed=false,lastMessage=Date.now();
  const finish=(reason?:unknown)=>{if(finished)return;finished=true;clearTimeout(deadline);clearInterval(watchdog);clearInterval(poll);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);socket.close();if(reason)error=safeError(reason);resolve();};
  const interrupt=()=>finish(new Error('Pilot interrupted; windows may be incomplete'));
  const deadline=setTimeout(()=>finish(),minutes*60000);
  const watchdog=setInterval(()=>{if(Date.now()-lastMessage>40000)finish(new Error('EventSub connection timed out'));},5000);
  let polling=false;const poll=setInterval(async()=>{if(polling||finished)return;polling=true;try{for(const stream of streams){if(finished)break;const now=new Date().toISOString();for(const clip of await client.clips(stream.user_id,started,now))signals.clip(stream.user_id,clip,now);const current=await client.request('streams',{user_id:stream.user_id});if(current[0])signals.update(parseStream(current[0]),now);}}catch(e){finish(e);}finally{polling=false;}},360000);
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  socket.addEventListener('error',()=>finish(new Error('EventSub connection error')));
  socket.addEventListener('close',()=>{if(!finished)finish(new Error('EventSub connection closed; no automatic reconnect in bounded V0'));});
  socket.addEventListener('message',async event=>{lastMessage=Date.now();try{const message=JSON.parse(String(event.data)),type=message.metadata?.message_type;if(type==='session_welcome'){if(welcomed)return;welcomed=true;for(const stream of streams){if(finished)break;await client.subscribe(stream.user_id,userId,message.payload.session.id);subscriptions++;}}else if(type==='session_reconnect'||type==='revocation')finish(new Error('EventSub '+type+'; fail-closed, explicit new pilot required'));else signals.ingest(message);}catch(e){finish(e);}});
 });
 clearInterval(progress);const ended=new Date().toISOString();signals.finalize(ended);return {started,ended,durationSeconds:(Date.parse(ended)-Date.parse(started))/1000,streams,subscriptions,apiRequests:client.requests,events:signals.events,dropped:signals.dropped,windows:signals.windows,error,publishingEnabled:false,transcriptionCost:0,visionCost:0};
}
const command=process.argv[2];
if(import.meta.url===new URL(process.argv[1],'file:///').href||process.argv[1]?.endsWith('twitch-cli.ts')){
 let repo:SqliteRepository|undefined;
 try{
  const client=new TwitchClient();const auth=command==='process'?null:(assertTwitchAccess(),await client.auth());
  if(command==='auth')console.log(JSON.stringify({authenticated:true,...auth,requests:client.requests}));
  else if(command==='pilot'){
   const minutes=envNumber('TWITCH_PILOT_MINUTES',30,30,60,true),limit=envNumber('TWITCH_MAX_STREAMS',5,1,10,true);
   repo=new SqliteRepository(operationsConfig().dbPath);
   // Persistent one-experiment guard prevents concurrent or accidental repeated live runs.
   repo.transaction(()=>{if(repo!.setting('twitch:v0:experiment'))throw Error('Twitch V0 experiment already started; do not automatically run another');repo!.setSetting('twitch:v0:experiment',{started:new Date().toISOString(),publishingEnabled:false});});
   const streams=await client.discover(limit);if(!streams.length)throw Error('No eligible live GTA streams; pilot did not monitor');
   const result=await monitorTwitch(client,streams,auth!.userId,minutes);
   for(const stream of streams){const vods=await client.videos(stream.user_id);repo.saveSource(metadataSource(stream,'stream_metadata',result.started));for(const vod of vods)repo.saveSource({...metadataSource(stream,'vod_metadata',result.ended,{vod}),id:'twitch:vod:'+vod.id,sourceId:vod.id,url:vod.url});}
   repo.setSetting('twitch:v0:experiment',result);
   writeFileSync(process.env.TWITCH_REPORT_PATH??'data/twitch-v0.json',JSON.stringify(redactSecrets(result),null,2));
   console.log(JSON.stringify({streams:streams.length,durationSeconds:result.durationSeconds,events:result.events,windows:result.windows.length,error:result.error,aiCalls:0,published:0}));
  }else if(command==='process'){
   if(process.env.PAID_PROCESSING_APPROVED!=='true')throw Error('Paid processing is disabled');
   repo=new SqliteRepository(operationsConfig().dbPath);const result:any=repo.setting('twitch:v0:experiment');if(!result?.windows)throw Error('No completed Twitch pilot');
   repo.transaction(()=>{if(repo!.setting('twitch:v0:processing'))throw Error('Twitch V0 processing already started; no automatic repeat');repo!.setSetting('twitch:v0:processing',{started:new Date().toISOString(),cap:10});});
   const adapter=new TwitchAdapter(result.windows),before=repo.usages().length;
   const output=await runPipeline(repo,adapter,new OpenAIProvider(new CostBudget(repo)),new Date().toISOString());
   const usage=repo.usages().slice(before),windows=await adapter.fetchItems();const sent=new Set(usage.map(u=>u.sourceId)).size;const relevant=usage.filter(u=>u.stage==='RELEVANCE'),extract=usage.filter(u=>u.stage==='EXTRACT');const cost=usage.some(u=>u.estimatedCost===null)?null:usage.reduce((n,u)=>n+(u.estimatedCost??0),0);
   const report={...output,candidateWindows:windows.length,windowsSent:sent,apiRequests:client.requests+result.apiRequests,events:result.events,relevanceCalls:relevant.length,extractionCalls:extract.length,usage,aiCost:cost,transcriptionCost:0,totalExperimentCost:cost,costPerProcessedWindow:sent&&cost!==null?cost/sent:null,costPerUsefulItem:null,humanReview:windows.map(w=>({source:w.id,usefulness:null,wouldPlayerCare:null,hardToFindQuickly:null,claims:repo!.evidence().filter(e=>e.sourceId===w.id).map(e=>repo!.claims().find(c=>c.id===e.claimId))})),publishingEnabled:false};repo.setSetting('twitch:v0:processing',report);writeFileSync('data/twitch-v0-processing.json',JSON.stringify(redactSecrets(report),null,2));console.log(JSON.stringify(redactSecrets(report),null,2));
  }else throw Error('Use twitch:auth, twitch:pilot, or twitch:process');
 }catch(error){console.error(safeError(error));process.exitCode=1;}finally{repo?.close();}
}
