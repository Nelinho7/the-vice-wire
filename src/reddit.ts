import { setTimeout as delay } from 'node:timers/promises';
import { assertRedditAccess,pilotConfig } from './pilot-config.ts';
import type { PilotConfig } from './pilot-config.ts';
import type { SourceItem } from './model.ts';
import type { SourceAdapter } from './adapters.ts';
export class RedditClient {
  requests=0;lastRequest=0;blockedUntil=0;receipts:{endpoint:string;at:string;status:number;remaining:string|null;reset:string|null}[]=[];
  config:PilotConfig;http:typeof fetch;sleep:(ms:number)=>Promise<any>;
  constructor(config=pilotConfig(),http=fetch,sleep:(ms:number)=>Promise<any>=delay){this.config=config;this.http=http;this.sleep=sleep;}
  async get(path:string){
    assertRedditAccess();
    if(!path.startsWith('/r/')&&path!=='/api/v1/me')throw Error('Unsupported Reddit endpoint');
    if(this.requests>=this.config.maxApiRequests)throw Error('Reddit API request cap reached');
    const wait=Math.max(0,this.lastRequest+this.config.requestDelayMs-Date.now(),this.blockedUntil-Date.now());
    if(wait>60000)throw Error('Reddit rate window exhausted; stop and retry after reset.');
    if(wait)await this.sleep(wait);
    this.requests++;this.lastRequest=Date.now();
    const response=await this.http('https://oauth.reddit.com'+path,{headers:{Authorization:'Bearer '+process.env.REDDIT_ACCESS_TOKEN,'User-Agent':process.env.REDDIT_USER_AGENT!},signal:AbortSignal.timeout(20000)});
    const remaining=response.headers.get('x-ratelimit-remaining'),reset=response.headers.get('x-ratelimit-reset');
    this.receipts.push({endpoint:path,at:new Date().toISOString(),status:response.status,remaining,reset});
    if(response.status===429)throw Error(`Reddit rate-limited (429), Retry-After=${response.headers.get('retry-after')??'not supplied'}; stop, no retry/bypass.`);
    if(!response.ok)throw Error('Reddit HTTP '+response.status+'; stop, no scraping fallback.');
    if(remaining!==null&&Number(remaining)<=1)this.blockedUntil=Date.now()+Math.max(1,Number(reset)||60)*1000;
    return response.json();
  }
  async testAccess(){for(const sub of this.config.subreddits){const body=await this.get(`/r/${sub}/new?limit=1&raw_json=1`);listing(body);}return {authenticated:true,readCommunities:this.config.subreddits,apiRequests:this.requests,receipts:this.receipts};}
}
function listing(body:any):any[]{if(!Array.isArray(body?.data?.children))throw Error('Unexpected Reddit listing');return body.data.children;}
function metadata(d:any,kind:string){return {kind,subreddit:d.subreddit,edited:typeof d.edited==='number'?d.edited:false,numComments:typeof d.num_comments==='number'?d.num_comments:undefined,crosspostParent:d.crosspost_parent??null};}
export function redditPost(d:any,config:PilotConfig,discovery:string):SourceItem {
  if(!/^t3_[a-z0-9]+$/i.test(d?.name)||!Number.isFinite(d.created_utc)||typeof d.title!=='string'||typeof d.permalink!=='string'||!/^\/r\/[A-Za-z0-9_]+\//.test(d.permalink)||!config.subreddits.some(s=>s.toLowerCase()===String(d.subreddit).toLowerCase()))throw Error('Invalid Reddit post or unexpected community');
  const author=typeof d.author==='string'&&d.author!=='[deleted]'?d.author:null,at=new Date().toISOString();
  return {id:'reddit:'+d.name,platform:'reddit',sourceId:d.name,url:'https://www.reddit.com'+d.permalink,author,title:d.title,text:typeof d.selftext==='string'?d.selftext:'',timestamp:new Date(d.created_utc*1000).toISOString(),engagement:{score:Number(d.score)||0},ingestedAt:at,raw:metadata(d,'t3'),independenceKey:author?'reddit:'+author:'reddit:unknown',itemType:'post',pilotId:config.pilotId,context:{subreddit:d.subreddit,postId:d.name,postTitle:d.title,postBody:typeof d.selftext==='string'?d.selftext:'',parentId:d.name,threadId:d.crosspost_parent??d.name,discovery:[discovery]},...(d.crosspost_parent?{copiedFrom:'reddit:'+d.crosspost_parent}:{})};
}
export function redditComments(body:any,post:SourceItem,config:PilotConfig):{items:SourceItem[];omittedMore:number} {
  if(!Array.isArray(body)||body.length<2)throw Error('Unexpected Reddit conversation');
  const items:SourceItem[]=[],parentTexts=new Map<string,string>([[post.sourceId,post.text]]);let omittedMore=0;
  function walk(children:any[],depth=0){if(depth>12)return;for(const node of children){if(node.kind==='more'){omittedMore++;continue;}if(node.kind!=='t1')continue;const d=node.data;
    if(!/^t1_[a-z0-9]+$/i.test(d?.name)||d.link_id!==post.sourceId||typeof d.body!=='string'||!Number.isFinite(d.created_utc)||typeof d.parent_id!=='string')throw Error('Invalid Reddit comment relationship');
    parentTexts.set(d.name,d.body);
    if(!['[removed]','[deleted]'].includes(d.body)&&items.length<config.commentsPerPost){
      const author=typeof d.author==='string'&&d.author!=='[deleted]'?d.author:null;
      const path=typeof d.permalink==='string'&&/^\/r\/[A-Za-z0-9_]+\//.test(d.permalink)?d.permalink:`/r/${post.context!.subreddit}/comments/${post.sourceId.slice(3)}/_/${d.name.slice(3)}/`;
      items.push({id:'reddit:'+d.name,platform:'reddit',sourceId:d.name,url:'https://www.reddit.com'+path,author,title:post.title,text:d.body,timestamp:new Date(d.created_utc*1000).toISOString(),engagement:{score:Number(d.score)||0},ingestedAt:new Date().toISOString(),raw:metadata(d,'t1'),independenceKey:author?'reddit:'+author:'reddit:unknown',itemType:'comment',pilotId:config.pilotId,context:{...post.context!,parentId:d.parent_id,parentText:parentTexts.get(d.parent_id),coverage:'bounded returned comment tree; more nodes are not expanded'}});
    }
    if(d.replies&&typeof d.replies==='object')walk(listing(d.replies),depth+1);
  }}
  walk(listing(body[1]));return {items,omittedMore};
}
type Queue={children:any[];after:string|null;pages:number};
export class RedditAdapter implements SourceAdapter {
  name='reddit';config:PilotConfig;client:RedditClient;target:number;known:Set<string>;cursor:number;diagnostics:Record<string,unknown>={};
  constructor(options:{config?:PilotConfig;client?:RedditClient;target?:number;knownIds?:string[];cursor?:number}={}){this.config=options.config??pilotConfig();this.client=options.client??new RedditClient(this.config);this.target=Math.min(options.target??this.config.maxSourceItems,this.config.maxSourceItems);this.known=new Set(options.knownIds??[]);this.cursor=options.cursor??0;}
  async fetchItems(){
    assertRedditAccess();const result:SourceItem[]=[],queues=new Map<string,Queue>(),seen=new Map<string,SourceItem>();let omittedMore=0;let stopReason:string|null=null;
    const add=(s:SourceItem)=>{const existing=seen.get(s.id);if(existing){existing.context!.discovery=[...new Set([...existing.context!.discovery,...s.context!.discovery])];return;}if(this.known.has(s.id)||result.length>=this.target)return;seen.set(s.id,s);result.push(s);};
    const kinds=['new','hot','top','search'] as const;
    const attempts=this.config.subreddits.length*4*this.config.queries.length*this.config.maxPagesPerLane;
    for(let n=0;n<attempts&&result.length<this.target;n++,this.cursor++){
      const index=this.cursor,sub=this.config.subreddits[index%this.config.subreddits.length],kind=kinds[index%4],query=kind==='search'?this.config.queries[Math.floor(index/4)%this.config.queries.length]:undefined;
      const key=`${sub}:${kind}:${query??''}`,q=queues.get(key)??{children:[],after:null,pages:0};
      try{
        if(!q.children.length){if(q.pages>=this.config.maxPagesPerLane||(q.pages>0&&!q.after))continue;
          const params=new URLSearchParams({limit:String(this.config.listingLimit),raw_json:'1'});if(kind==='top'){params.set('t','week');}if(kind==='search'){params.set('q',query!);params.set('restrict_sr','true');params.set('sort','relevance');params.set('t','month');}if(q.after)params.set('after',q.after);
          const body:any=await this.client.get(`/r/${sub}/${kind}?${params}`);q.children=listing(body).filter(x=>x.kind==='t3');q.after=typeof body.data.after==='string'?body.data.after:null;q.pages++;queues.set(key,q);
        }
        let node;while(q.children.length){const next=q.children.shift();if(!this.known.has('reddit:'+next.data?.name)&&!seen.has('reddit:'+next.data?.name)){node=next;break;}}
        if(!node)continue;
        const post=redditPost(node.data,this.config,key);add(post);
        if(this.config.commentsPerPost&&result.length<this.target){const body=await this.client.get(`/r/${sub}/comments/${post.sourceId.slice(3)}?limit=${this.config.commentsPerPost}&depth=6&sort=top&raw_json=1`);const comments=redditComments(body,post,{...this.config,commentsPerPost:Math.min(this.config.commentsPerPost,Math.max(1,Math.floor(this.target/12)))});omittedMore+=comments.omittedMore;comments.items.forEach(add);}
      }catch(error){stopReason=String(error);break;}
    }
    this.diagnostics={requested:this.target,returned:result.length,apiRequests:this.client.requests,omittedMore,cursor:this.cursor,stopReason,receipts:this.client.receipts,sampling:'round-robin communities and new/hot/top-week/search-month; bounded comments, paginated listings; not an exhaustive or random sample'};
    if(!result.length&&stopReason)throw Error(stopReason);
    return result;
  }
}
