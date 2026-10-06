import { randomUUID } from 'node:crypto';
import type { SourceItem,Repository } from './model.ts';
import type { ExtractionProvider } from './providers.ts';
import { runPipeline } from './pipeline.ts';
import { contentFingerprint } from './fingerprints.ts';
import { operationsConfig } from './operations-config.ts';
import { safeError } from './security.ts';
import type { PriorityConfig } from './priority.ts';
export type ScanContext={reason?:string;videoIds?:string[];channelId?:string;topic?:string};
export type SourceCheckpoint={since?:string;cursor?:string;state?:Record<string,unknown>};
export type ScanRequest={checkpoint:SourceCheckpoint;context?:ScanContext;limit:number};
export type ScanBatch={items:SourceItem[];checkpoint:SourceCheckpoint};
export interface ScannableSource { id:string;platform:string;intervalMs?:number;scan(request:ScanRequest):Promise<ScanBatch> }
export type ScanState={source:string;platform:string;lastSuccessfulScan?:string;lastAttempt?:string;nextScheduledScan?:string;checkpoint:SourceCheckpoint;health:string;itemsDiscovered:number;skippedUnchanged:number;aiCandidatesProcessed:number;recentErrors:{at:string;message:string}[];lastReason?:string};
export type LiveActivitySignal={source:string;kind:'chat_spike'|'repeated_topic'|'publication'|'informant'|'unusual_activity';observedAt:string;windowSeconds:number;baselineCount:number;currentCount:number;topic?:string;context?:ScanContext};
export function due(state:ScanState|undefined,at:string){return !state?.nextScheduledScan||Date.parse(state.nextScheduledScan)<=Date.parse(at);}
export class ScanScheduler {
  repo:Repository;provider:ExtractionProvider;sources:Map<string,ScannableSource>;intervalMs:number;clock:()=>string;stopping=false;priority:PriorityConfig;processEnabled:boolean;
  constructor(repo:Repository,provider:ExtractionProvider,sources:ScannableSource[],options:{intervalMs?:number;clock?:()=>string;priority?:PriorityConfig;processEnabled?:boolean}={}){
    this.repo=repo;this.provider=provider;this.sources=new Map(sources.map(s=>[s.id,s]));this.intervalMs=options.intervalMs??operationsConfig().scanIntervalMs;this.clock=options.clock??(()=>new Date().toISOString());this.priority=options.priority??{};
    if(!Number.isFinite(this.intervalMs)||this.intervalMs<60000)throw Error('Invalid scan interval');
    for(const source of sources)if(source.intervalMs!==undefined&&(!Number.isFinite(source.intervalMs)||source.intervalMs<60000))throw Error('Invalid source-specific interval');
    this.processEnabled=options.processEnabled!==false;
    const registered=new Set((repo.setting('scan:sources')??[]) as string[]);
    for(const s of sources)registered.add(s.id);repo.setSetting('scan:sources',[...registered]);
  }
  state(id:string):ScanState|undefined{return this.repo.setting('scan:state:'+id) as ScanState|undefined;}
  async scan(id:string,context?:ScanContext){
    const source=this.sources.get(id);if(!source)throw Error('Source is not registered');if(this.stopping)return {skipped:true,reason:'stopping'};
    const at=this.clock(),token=randomUUID(),leaseMs=120000;
    const acquired=this.repo.transaction(()=>{const lock:any=this.repo.setting('scan:lock:'+id);if(lock&&Date.parse(lock.expiresAt)>Date.parse(at))return false;this.repo.setSetting('scan:lock:'+id,{token,expiresAt:new Date(Date.parse(at)+leaseMs).toISOString()});return true;});
    if(!acquired)return {skipped:true,reason:'source scan already running'};
    const heartbeat=setInterval(()=>{this.repo.transaction(()=>{const lock:any=this.repo.setting('scan:lock:'+id);if(lock?.token===token)this.repo.setSetting('scan:lock:'+id,{token,expiresAt:new Date(Date.parse(this.clock())+leaseMs).toISOString()});});},30000);heartbeat.unref();
    const previous=this.state(id),state:ScanState={source:id,platform:source.platform,checkpoint:previous?.checkpoint??{},health:'scanning',itemsDiscovered:0,skippedUnchanged:0,aiCandidatesProcessed:0,recentErrors:previous?.recentErrors??[],...previous,lastAttempt:at,lastReason:context?.reason??'baseline'};
    state.health='scanning';this.repo.setSetting('scan:state:'+id,state);
    state.itemsDiscovered=0;state.skippedUnchanged=0;state.aiCandidatesProcessed=0;
    try{
      const batch=await source.scan({checkpoint:state.checkpoint,context,limit:10});
      if(batch.items.length>10)throw Error('Adapter exceeded the 10-item validation cap');
      const lock:any=this.repo.setting('scan:lock:'+id);if(lock?.token!==token)throw Error('Scan lease lost');
      let unchanged=0;
      this.repo.transaction(()=>{
        for(const item of batch.items){const prior=this.repo.sources().find(s=>s.id===item.id),hash=contentFingerprint(item);if(prior?.analyzedHash===hash)unchanged++;this.repo.saveSource({...prior,...item,sourceKey:id,contentHash:hash,analyzedHash:prior?.analyzedHash});}
        state.checkpoint=batch.checkpoint;state.lastSuccessfulScan=this.clock();state.itemsDiscovered=batch.items.length;state.skippedUnchanged=unchanged;
        state.nextScheduledScan=context&&previous?.nextScheduledScan?previous.nextScheduledScan:new Date(Date.parse(state.lastSuccessfulScan)+(source.intervalMs??this.intervalMs)).toISOString();state.health='ready';this.repo.setSetting('scan:state:'+id,state);
      });
      const pending=this.repo.sources().filter(s=>s.sourceKey===id&&s.analyzedHash!==contentFingerprint(s));
      if(pending.length&&this.processEnabled){
        const auditCount=this.repo.audits().length;
        const result=await runPipeline(this.repo,{name:id,fetchItems:async()=>pending.slice(0,10)},this.provider,this.clock(),{priority:this.priority});
        state.aiCandidatesProcessed=new Set(this.repo.audits().slice(auditCount).filter(a=>['EXTRACT','RELEVANCE'].includes(a.stage)).map(a=>a.sourceId)).size;state.health=result.stopped?'processing paused':'ready';
        if(result.stopped)state.recentErrors=[...state.recentErrors,{at:this.clock(),message:result.stopped}].slice(-10);
      }
      this.repo.setSetting('scan:state:'+id,state);return state;
    }catch(error){state.health='error';const retry=(error as any)?.retryAfterMs;const wait=Math.max(source.intervalMs??this.intervalMs,Number.isFinite(retry)&&retry>0?retry:0);state.nextScheduledScan=new Date(Date.parse(this.clock())+wait).toISOString();state.recentErrors=[...state.recentErrors,{at:this.clock(),message:safeError(error)}].slice(-10);this.repo.setSetting('scan:state:'+id,state);return state;}
    finally{clearInterval(heartbeat);this.repo.transaction(()=>{const lock:any=this.repo.setting('scan:lock:'+id);if(lock?.token===token)this.repo.setSetting('scan:lock:'+id,null);});}
  }
  targetedScan(source:string,context:ScanContext){return this.scan(source,{...context,reason:context.reason??'targeted'});}
  signal(signal:LiveActivitySignal){if(!Number.isFinite(signal.currentCount)||!Number.isFinite(signal.baselineCount)||signal.currentCount<0||signal.baselineCount<0||signal.windowSeconds<=0)throw Error('Invalid activity signal');return this.targetedScan(signal.source,{...signal.context,topic:signal.topic,reason:signal.kind});}
  async tick(){const results=[];for(const source of this.sources.values()){if(this.stopping)break;if(due(this.state(source.id),this.clock()))results.push(await this.scan(source.id));}return results;}
  stop(){this.stopping=true;}
}
export function sourceHealth(repo:Repository){return ((repo.setting('scan:sources')??[]) as string[]).map(id=>repo.setting('scan:state:'+id)).filter(Boolean);}
