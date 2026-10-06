import type {Candidate,SourceItem} from './model.ts';
export type RewardModifier={kind:'multiplier'|'percentage_bonus';value:number;factor:number;reward:'GTA$'|'RP'|'other';activity:string[];period:{start:string|null;end:string|null;text:string|null};baseline:{value:number;reward:'GTA$'|'RP';quote:string}|null;result:{value:number;reward:'GTA$'|'RP';origin:'derived';formula:string}|null;quote:string};
const months='January February March April May June July August September October November December'.split(' ');
const monthPattern=months.join('|');
function iso(month:string,day:string,year:string){const m=months.findIndex(x=>x.toLowerCase()===month.toLowerCase());const d=Number(day),y=Number(year),date=new Date(Date.UTC(y,m,d));return date.getUTCMonth()===m&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;}
export function rewardPeriod(c:Candidate,s?:SourceItem):RewardModifier['period']{
 const local=[c.quote,...Object.values(c.conditions)].join(' '),primary=(s?.title??'')+' '+(s?.text??'');
 const range=new RegExp('('+monthPattern+')\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\s*(?:to|through|[-–])\\s*(?:('+monthPattern+')\\s+)?(\\d{1,2})(?:,?\\s+(20\\d{2}))?','i');
 const explicitEnd=local.match(new RegExp('(?:through|until|ends? on)\\s+('+monthPattern+')\\s+(\\d{1,2}),?\\s+(20\\d{2})','i'));
 if(explicitEnd&&!local.match(range))return {start:null,end:iso(explicitEnd[1],explicitEnd[2],explicitEnd[3]),text:explicitEnd[0]};
 // Do not borrow a date from a different activity buried in a long article.
 // A document-wide fallback must be an explicit event range in the heading.
 const m=local.match(range)??(s?.title??'').match(range)??primary.slice(0,500).match(range);
 if(m){const year=m[6]??m[3];if(year)return {start:iso(m[1],m[2],year),end:iso(m[4]??m[1],m[5],year),text:m[0]};return {start:null,end:null,text:m[0]};}
 const dates=local.match(/\b20\d{2}-\d{2}-\d{2}\b/g);if(dates?.length===2)return {start:dates[0],end:dates[1],text:dates.join(' to ')};
 const end=local.match(new RegExp('(?:through|until|ends? on)\\s+('+monthPattern+')\\s+(\\d{1,2}),?\\s+(20\\d{2})','i'));
 if(end)return {start:null,end:iso(end[1],end[2],end[3]),text:end[0]};
 return {start:null,end:null,text:local.match(/\b(?:this week|all October|weekly|this month)\b/i)?.[0]??null};
}
export function rewardModifiers(c:Candidate,s?:SourceItem):RewardModifier[]{
 // Only the located quote establishes factors and rewards. Wider primary context
 // may supply an explicit event range, never a baseline or an omitted reward.
 const quote=c.quote,found=[...quote.matchAll(/\b(\d+(?:\.\d+)?)\s*[x×](?!\w)|\b(double|triple)\b|\b(\d+(?:\.\d+)?)\s*%\s*(?:bonus|increase|extra)/gi)];
 const out:RewardModifier[]=[];
 for(const [i,m] of found.entries()){
  const segment=quote.slice(m.index,(found[i+1]?.index??quote.length));
  const before=quote.slice(Math.max(0,(m.index??0)-50),m.index);
  // Avoid double cooldowns, triple vehicle counts, etc.
  if(!/GTA\$|\bRP\b|money|payout|rewards?|pays?|earnings|bonus/i.test(segment+' '+before))continue;
  const value=m[1]?Number(m[1]):m[2]?m[2].toLowerCase()==='double'?2:3:Number(m[3]);
  const kind=m[3]?'percentage_bonus':'multiplier',factor=kind==='multiplier'?value:1+value/100;
  const rewardAfter=segment.replace(/^\d+(?:\.\d+)?\s*(?:[x×]|%\s*(?:bonus|increase|extra))/i,'').split(/[.;]/)[0];
  const rewardText=/GTA\$|\bRP\b|money|payout/i.test(rewardAfter)?rewardAfter:before.split(/[.;]/).at(-1)??'';
  const rewards:RewardModifier['reward'][]=[];
  if(/GTA\$|\bmoney\b|\bpayout\b/i.test(rewardText))rewards.push('GTA$');
  if(/\bRP\b/i.test(rewardText))rewards.push('RP');
  if(!rewards.length)rewards.push('other');
  for(const reward of rewards){
   // Arithmetic is deliberately limited to one explicit normal/base amount in
   // the same quote and one affected entity. No inference from other pages.
   const baselines=[...quote.matchAll(/\b(?:normal|base|baseline)\s+(?:payout|reward)(?:\s+is|\s+of|\s*:)?\s*(GTA\$|RP)\s*(\d[\d,.]*)\s*(k|m|million|thousand)?\b/gi)].filter(b=>b[1].toUpperCase()===reward);
   const b=baselines.length===1&&c.entities.length===1&&found.length===1?baselines[0]:null;
   const amount=b?Number(b[2].replaceAll(',',''))*({k:1000,m:1000000,million:1000000,thousand:1000}[b[3]?.toLowerCase()??'']??1):null;
   const baseline=amount!==null&&reward!=='other'?{value:amount,reward,quote:b![0]}:null;
   const result=baseline?{value:baseline.value*factor,reward:baseline.reward,origin:'derived' as const,formula:`${baseline.value} * ${factor}`} :null;
   const mixedFactors=new Set(found.map(f=>f[1]??f[2]??f[3])).size>1;
   out.push({kind,value,factor,reward,activity:mixedFactors&&c.entities.length>1?[]:[...c.entities].sort(),period:rewardPeriod(c,s),baseline,result,quote:m[0]});
  }
 }
 return out.filter((v,i)=>out.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i);
}
export function temporaryReward(c:{rewardModifiers?:RewardModifier[]}){return c.rewardModifiers?.some(m=>!!(m.period.start||m.period.end||m.period.text))??false;}
