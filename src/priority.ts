import type { SourceItem,Claim } from './model.ts';
import { canonical,similarity } from './intelligence.ts';
export type PriorityConfig={sourceReliability?:Record<string,number>;trendingTopics?:string[]};
export function priorityScore(item:SourceItem,peers:SourceItem[]=[],claims:Claim[]=[],at=new Date().toISOString(),config:PriorityConfig={}){
  const text=canonical(item.title+' '+item.text),words=text.split(' '),age=Math.max(0,Date.parse(at)-Date.parse(item.timestamp));
  const components={recency:Number.isFinite(age)?25*Math.exp(-age/86400000):0,engagement:Math.min(15,3*Math.log10(1+Math.max(0,item.engagement.score))),
    gta:/gta|acid lab|kosatka|cayo|heist/.test(text)?10:0,
    actionable:/money|payout|business|mission|bug|fix|workaround|location|vehicle|update|secret/.test(text)?15:0,
    similar:Math.min(15,peers.filter(s=>s.id!==item.id&&s.independenceKey!==item.independenceKey&&similarity(words,canonical(s.title+' '+s.text).split(' '))>=0.5).length*5),
    reliability:10*Math.max(0,Math.min(1,config.sourceReliability?.[item.platform]??0)),
    ...(item.platform==='web'?{sourceQuality:Math.max(0,Math.min(100,Number((item.raw.quality as any)?.score)||0))/5}:{}),
    trending:config.trendingTopics?.some(t=>text.includes(canonical(t)))?5:0,
    possibleContradiction:/wrong|no longer|outdated|did not|doesn t|changed|nerf/.test(text)&&claims.some(c=>c.entities.some(e=>text.includes(canonical(e))))?10:0};
  return {score:Math.round(Object.values(components).reduce((a,b)=>a+b,0)),components,note:'Processing priority only; not a truth or confidence score.'};
}
