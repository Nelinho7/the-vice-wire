import {TwitchClient,parseStream} from './twitch.ts';
import type {TwitchStream} from './twitch.ts';
export type StreamRelevance={score:number;positiveSignals:string[];negativeSignals:string[];eligible:boolean;reasons:string[]};
const positive:[string,RegExp,number][]=[['gta_online',/\bgta\s*(?:5\s*)?online\b|\bgrand theft auto online\b/i,45],['grinding',/\bgrind(?:ing)?\b/i,15],['money',/\bmoney|payout|cash\b/i,12],['business',/\bbusiness(?:es)?|acid lab|nightclub|bunker\b/i,12],['heist',/\bheists?|cayo\s*perico|casino\s*heist|cluckin\s*bell\b/i,12],['missions',/\bmissions?\b/i,10],['update_dlc',/\bupdate|dlc|new\s*content\b/i,12],['vehicles',/\bvehicles?|cars?\b/i,8],['testing',/\btest(?:ing)?\b/i,15],['guide_help',/\bguide|help|new\s*player|returning\s*player|advice\b/i,12],['solo',/\bsolo\b/i,8],['career_unlock',/\bcareer|achievement|unlock|100%|challenge\b/i,8],['method_strategy',/\bmethod|strateg(?:y|ies)\b/i,12],['bug_discovery',/\bbug|glitch|workaround|secret|discover/i,12]];
const negative:[string,RegExp][]=[['roleplay',/\brole\s*play|\brp\b|\bgtarp\b/i],['fivem',/\bfive\s*m\b/i],['nopixel',/\bno\s*pixel\b/i],['custom_server',/\bcustom\s*(?:rp\s*)?server|\bdreadm\b|\bonx\b|\bprodigy\s*rp\b/i],['character_story_rp',/\b(?:police|gang|ems|city|character|story)\s*rp\b/i]];
export function scoreStream(stream:TwitchStream):StreamRelevance{
 const current=stream.title+' '+(stream.tags??[]).join(' '),profile=stream.description??'',text=(current+' '+profile).replace(/gtaonline/gi,'gta online');
 const positives=positive.filter(([,r])=>r.test(current.replace(/gtaonline/gi,'gta online'))),negatives=negative.filter(([,r])=>r.test(text));
 const currentNegative=negative.some(([,r])=>r.test(current));
 const mode=/gta\s*(?:5\s*)?online|grand theft auto online|cayo\s*perico|acid\s*lab|cluckin\s*bell|casino\s*heist/i.test(text);
 const score=Math.max(0,Math.min(100,positives.reduce((n,[,,w])=>n+w,0)-negatives.length*60));
 const optedOut=(stream.tags??[]).some(t=>/^aioptedout$/i.test(t));
 const reasons=[...(optedOut?['creator_ai_opt_out']:[]),...(currentNegative?['explicit_rp_or_custom_server']:[]),...(!mode?['no_explicit_gta_online_context']:[]),...(score<35?['insufficient_intelligence_relevance']:[])];
 return {score,positiveSignals:positives.map(([name])=>name),negativeSignals:negatives.map(([name])=>name),eligible:!optedOut&&!currentNegative&&mode&&score>=35&&stream.language==='en'&&stream.type==='live',reasons};
}
export async function discoverPilot2(client:TwitchClient){
 const games=await client.request('games',{name:'Grand Theft Auto V'});if(!games[0]?.id)throw Error('GTA category missing');
 const found=new Map<string,TwitchStream>();let cursor:string|undefined;let pages=0;
 // At most 3 pages of one category, never expand continuously.
 do{const data=await client.request('streams',{game_id:games[0].id,language:'en',type:'live',first:'100',...(cursor?{after:cursor}:{})});pages++;cursor=client.lastPagination.cursor;
  for(const row of data){const stream=parseStream(row);if(stream.game_id===games[0].id)found.set(stream.user_id,stream);}
 }while(cursor&&pages<3);
 const streams=[...found.values()];for(let i=0;i<streams.length;i+=100){const users=await client.request('users',{id:streams.slice(i,i+100).map(s=>s.user_id)});for(const u of users){const s=found.get(u.id);if(s)s.description=typeof u.description==='string'?u.description.slice(0,2000):'';}}
 const candidates=streams.map(stream=>({stream,relevance:scoreStream(stream)})).sort((a,b)=>b.relevance.score-a.relevance.score||b.stream.viewer_count-a.stream.viewer_count);
 return {at:new Date().toISOString(),pages,candidates,selected:candidates.filter(c=>c.relevance.eligible).slice(0,10),apiRequests:client.requests};
}
export function questionClusters(messages:{user:string;text:string}[]){
 const grouped=new Map<string,{key:string;count:number;users:Set<string>;examples:string[]}>();
 for(const m of messages){const t=m.text.toLowerCase();let key:string|undefined;
  const question=/\?|\bwhere|\bhow\b|\bwhat\b|\bdoes\b|\bworth\b/i.test(t);
  if(!question)continue;
  if(/\b(?:car|vehicle)\b/.test(t)&&/where|location|spawn|get/.test(t))key='vehicle_location';
  else if(/where did you get (?:it|that)\??$/.test(t)&&messages.some(x=>x.user!==m.user&&/\b(?:car|vehicle)\b/i.test(x.text)&&/where|location|spawn/i.test(x.text)))key='vehicle_location';
  else if(/how much|payout|pay\b/.test(t)&&/money|payout|pay\b|mission|heist|business/.test(t))key='activity_payout';
  else if(/does (?:this|it) work|still works?|patched|fixed|glitch|bug/.test(t))key='method_validity';
  else if(/what (?:mission|business|method)|how do you/.test(t))key='gameplay_method';
  if(!key)continue;const named=t.match(/\b(?:sultan|adder|vagner|kuruma|oppressor|cayo perico|acid lab|casino heist|cluckin bell)\b/)?.[0];if(named)key+=':'+named;const g=grouped.get(key)??{key,count:0,users:new Set<string>(),examples:[]};g.count++;g.users.add(m.user);if(g.examples.length<3)g.examples.push(m.text);grouped.set(key,g);
 }
 return [...grouped.values()].filter(g=>g.users.size>=3).map(g=>({key:g.key,count:g.count,uniqueParticipants:g.users.size,examples:g.examples}));
}
