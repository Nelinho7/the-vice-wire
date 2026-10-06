import { readFileSync } from 'node:fs';
import type { SourceItem,Repository } from './model.ts';
import type { ScannableSource,ScanRequest,ScanBatch,SourceCheckpoint } from './scheduler.ts';
import { envNumber } from './operations-config.ts';
export type YouTubeConfig={queries:string[];channelIds:string[];videosPerScan:number;commentsPerVideo:number;maxPilotItems:number;lookbackHours:number};
export function youtubeConfig():YouTubeConfig {
  const path=process.env.YOUTUBE_PILOT_CONFIG||'config/youtube-pilot.json',config=JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  if(process.env.YOUTUBE_CHANNEL_IDS)config.channelIds=process.env.YOUTUBE_CHANNEL_IDS.split(',').map(s=>s.trim());
  if(!Array.isArray(config.queries)||!Array.isArray(config.channelIds)||!config.queries.length&&!config.channelIds.length||config.queries.length>20||config.channelIds.length>20||config.queries.some((q:any)=>typeof q!=='string'||!q.trim()||q.length>100)||config.channelIds.some((id:any)=>typeof id!=='string'||!/^UC[A-Za-z0-9_-]{22}$/.test(id)))throw Error('Invalid YouTube discovery configuration');
  for(const [key,max] of [['videosPerScan',2],['commentsPerVideo',2],['maxPilotItems',10],['lookbackHours',168]] as const)if(!Number.isInteger(config[key])||config[key]< (key==='commentsPerVideo'?0:1)||config[key]>max)throw Error('Invalid YouTube '+key);
  return config;
}
export function assertYouTubeAccess(){if(process.env.YOUTUBE_ACCESS_APPROVED!=='true'||!process.env.YOUTUBE_API_KEY&&!process.env.YOUTUBE_ACCESS_TOKEN)throw Error('Configure YOUTUBE_ACCESS_APPROVED and YOUTUBE_API_KEY (or approved OAuth access) locally; no request made');}
export class YouTubeApiError extends Error {status:number;reason:string;constructor(status:number,reason='requestFailed'){super('YouTube API '+status+' ('+reason+'); no scraping fallback');this.status=status;this.reason=reason;}}
export class YouTubeClient {
  requests=0;repo:Repository;http:typeof fetch;
  constructor(repo:Repository,http=fetch){this.repo=repo;this.http=http;}
  async get(endpoint:string,params:Record<string,string>){
    assertYouTubeAccess();if(!['search','videos','channels','playlistItems','commentThreads'].includes(endpoint))throw Error('Unsupported YouTube endpoint');
    if(this.requests>=envNumber('YOUTUBE_MAX_REQUESTS_PER_SCAN',6,1,10,true))throw Error('YouTube scan request cap reached');
    const day=new Date().toISOString().slice(0,10),key='youtube:quota:'+day;
    this.repo.transaction(()=>{const ledger:any=this.repo.setting(key)??{requests:0,searches:0};if(ledger.requests>=envNumber('YOUTUBE_DAILY_API_REQUEST_LIMIT',20,1,100,true)||endpoint==='search'&&ledger.searches>=envNumber('YOUTUBE_DAILY_SEARCH_LIMIT',3,0,20,true))throw Error('YouTube daily validation request cap reached');this.repo.setSetting(key,{requests:ledger.requests+1,searches:ledger.searches+(endpoint==='search'?1:0)});});
    this.requests++;const url=new URL('https://www.googleapis.com/youtube/v3/'+endpoint);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const headers:Record<string,string>={};if(process.env.YOUTUBE_API_KEY)headers['X-Goog-Api-Key']=process.env.YOUTUBE_API_KEY;if(process.env.YOUTUBE_ACCESS_TOKEN)headers.Authorization='Bearer '+process.env.YOUTUBE_ACCESS_TOKEN;
    let response:Response;try{response=await this.http(url.toString(),{headers,signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw Error('YouTube network failure; no automatic retry');}
    if(!response.ok){let reason='requestFailed';try{const body:any=await response.json(),r=body.error?.errors?.[0]?.reason;if(['commentsDisabled','quotaExceeded','dailyLimitExceeded','forbidden','videoNotFound','keyInvalid','accessNotConfigured'].includes(r))reason=r;}catch{}throw new YouTubeApiError(response.status,reason);}
    const body:any=await response.json();if(!Array.isArray(body.items))throw Error('Unexpected YouTube listing');return body;
  }
  async auth(config=youtubeConfig()){
    // One inexpensive public metadata read; no search, account/profile read, or AI call.
    return this.get('videos',{part:'snippet',chart:'mostPopular',maxResults:'1'}).then(body=>({authenticated:true,itemsReturned:body.items.length,requests:this.requests,note:'Public API credential check only; not proof of project policy approval.'}));
  }
}
const validDate=(v:any)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const videoId=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{11}$/.test(v);
export function youtubeVideo(d:any,at=new Date().toISOString()):SourceItem {
  const s=d?.snippet;if(!videoId(d?.id)||!s||typeof s.title!=='string'||typeof s.description!=='string'||!validDate(s.publishedAt)||typeof s.channelId!=='string')throw Error('Invalid YouTube video metadata');
  return {id:'youtube:video:'+d.id,platform:'youtube',sourceId:d.id,url:'https://www.youtube.com/watch?v='+d.id,author:s.channelId,title:s.title,text:s.description,timestamp:s.publishedAt,engagement:{score:Number(d.statistics?.likeCount)||0},ingestedAt:at,independenceKey:'youtube:channel:'+s.channelId,itemType:'post',
    raw:{kind:'video_metadata',channelId:s.channelId,liveBroadcastContent:s.liveBroadcastContent??'none',viewCount:Number(d.statistics?.viewCount)||0,activeLiveChatId:d.liveStreamingDetails?.activeLiveChatId??null},
    context:{subreddit:'',postId:d.id,postTitle:s.title,postBody:s.description,parentId:d.id,threadId:d.id,discovery:['youtube:metadata']}};
}
export function youtubeComment(thread:any,video:SourceItem,at=new Date().toISOString()):SourceItem {
  const c=thread?.snippet?.topLevelComment,s=c?.snippet;if(typeof c?.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(c.id)||s?.videoId!==video.sourceId||typeof s.textOriginal!=='string'||!validDate(s.publishedAt))throw Error('Invalid YouTube comment relationship');
  const author=typeof s.authorChannelId?.value==='string'?s.authorChannelId.value:null;
  return {id:'youtube:comment:'+c.id,platform:'youtube',sourceId:c.id,url:video.url+'&lc='+encodeURIComponent(c.id),author,title:video.title,text:s.textOriginal,timestamp:s.publishedAt,engagement:{score:Number(s.likeCount)||0},ingestedAt:at,independenceKey:author?'youtube:channel:'+author:'youtube:unknown',itemType:'comment',
    raw:{kind:'top_level_comment',videoId:video.sourceId,updatedAt:validDate(s.updatedAt)?s.updatedAt:null,coverage:'Bounded top-level comments; replies not expanded'},context:{...video.context!,parentId:video.sourceId,discovery:['youtube:comments']}};
}
export class YouTubeAdapter implements ScannableSource {
  id='youtube';platform='youtube';config:YouTubeConfig;client:YouTubeClient;
  constructor(repo:Repository,config=youtubeConfig(),client=new YouTubeClient(repo)){this.config=config;this.client=client;}
  async scan(request:ScanRequest):Promise<ScanBatch>{
    assertYouTubeAccess();const limit=Math.min(request.limit,this.config.maxPilotItems,10),at=new Date().toISOString(),old:any=request.checkpoint.state??{};
    if(!Number.isInteger(limit)||limit<1)throw Error('Invalid YouTube validation cap');
    const lanes=[...this.config.channelIds.map(id=>({id:'channel:'+id,channelId:id,query:undefined})),...this.config.queries.map(q=>({id:'query:'+q,query:q,channelId:undefined}))];
    const index=Number.isInteger(old.laneIndex)?old.laneIndex:0,lane=lanes[index%lanes.length],laneStates={...(old.lanes??{})};
    const l=laneStates[lane.id]??{},since=l.after??l.since??new Date(Date.parse(at)-this.config.lookbackHours*3600000).toISOString();
    const existing=this.client.repo.sources().filter(s=>s.platform==='youtube'),knownItems=new Set(existing.map(s=>s.id));
    let remaining=Math.max(0,this.config.maxPilotItems-existing.length);
    let ids:string[]=[],nextPage:string|undefined;
    if(request.context?.videoIds){if(request.context.videoIds.length>2||request.context.videoIds.some(id=>!videoId(id)))throw Error('Targeted YouTube scan permits at most two valid video IDs');ids=request.context.videoIds;}
    else if(!remaining){ids=existing.filter(s=>s.itemType==='post').map(s=>s.sourceId).filter(videoId).slice(0,2);}
    else if(lane.channelId){
      const channel=await this.client.get('channels',{part:'contentDetails',id:lane.channelId});const playlist=channel.items[0]?.contentDetails?.relatedPlaylists?.uploads;if(typeof playlist!=='string')throw Error('Channel uploads playlist unavailable');
      const listing=await this.client.get('playlistItems',{part:'snippet,contentDetails',playlistId:playlist,maxResults:String(this.config.videosPerScan),...(l.pageToken?{pageToken:l.pageToken}:{})});ids=listing.items.map((i:any)=>i.contentDetails?.videoId).filter(videoId);nextPage=listing.nextPageToken;
    }else{
      const listing=await this.client.get('search',{part:'snippet',type:'video',q:lane.query!,order:'date',publishedAfter:since,maxResults:String(this.config.videosPerScan),...(l.pageToken?{pageToken:l.pageToken}:{})});
      ids=listing.items.map((i:any)=>i.id?.videoId).filter(videoId);nextPage=listing.nextPageToken;
    }
    // Refresh one previously sampled video so edits and new comments can become candidates.
    const known:string[]=Array.isArray(old.knownVideoIds)?old.knownVideoIds.filter(videoId):[],refresh=Number.isInteger(old.refreshIndex)?old.refreshIndex:0;
    if(!request.context?.videoIds&&known.length)ids.push(known[refresh%known.length]);ids=[...new Set(ids)].slice(0,3);
    const items:SourceItem[]=[];
    const add=(item:SourceItem)=>{if(items.length>=limit)return;if(knownItems.has(item.id)){items.push(item);return;}if(remaining){items.push(item);knownItems.add(item.id);remaining--;}};
    if(ids.length){const videos=await this.client.get('videos',{part:'snippet,statistics,liveStreamingDetails',id:ids.join(',')});
      for(const data of videos.items){if(items.length>=limit)break;const video=youtubeVideo(data,at);add(video);
        if(this.config.commentsPerVideo&&items.length<limit){try{const comments=await this.client.get('commentThreads',{part:'snippet',videoId:video.sourceId,maxResults:String(Math.min(this.config.commentsPerVideo,limit-items.length)),order:'time',textFormat:'plainText'});for(const c of comments.items){if(items.length>=limit)break;add(youtubeComment(c,video,at));}}catch(error){if(!(error instanceof YouTubeApiError&&error.reason==='commentsDisabled'))throw error;}}
      }
    }
    if(!request.context?.videoIds&&remaining)laneStates[lane.id]=nextPage?{since:l.since,after:since,pageToken:nextPage}:{since:new Date(Date.parse(at)-3600000).toISOString()};
    const checkpoint:SourceCheckpoint={since:at,state:{laneIndex:request.context?.videoIds?index:index+1,lanes:laneStates,knownVideoIds:[...new Set([...ids,...known])].slice(0,20),refreshIndex:refresh+1}};
    return {items,checkpoint};
  }
}
