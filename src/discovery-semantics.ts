import {numericRoles,numericClause} from './discovery-numeric.ts';
import {qualifyDiscoveryReport,entityRoleValid} from './discovery-projection.ts';
import type {Candidate,SourceItem} from './model.ts';
import type {DiscoveryDraft,DiscoveryReward,FieldSupport} from './discovery-model.ts';
export const supportedSpan=(text:string,quote:string):FieldSupport|undefined=>{const start=text.toLowerCase().indexOf(quote.toLowerCase());return start<0?undefined:{source:'PRIMARY',quote:text.slice(start,start+quote.length),start,end:start+quote.length};};
const phrase=(s:string)=>s.trim().replace(/[.;,]+$/,'');
export function discoveryPrimarySignal(t:string){
 if(/\b(?:i wish|it would be nice|if only|join now|subscribe|discord\.gg)\b/i.test(t)&&! /\b(?:i (?:found|tested|tried)|you (?:can|have to)|all you have to)\b/i.test(t))return false;
 return /\b(?:i|we|my|our)\b[\s\S]{0,160}\b(?:found|tried|tested|completed|sold|earned|killed|waited|walked|got|came across|installed|not working|doesn't|did not|didn't|never|appeared|approached|attacked)\b/i.test(t)||/\b(?:found|spawned)\b.{0,90}\b(?:times|in a row|road|street|near|behind|night|day)\b/i.test(t)||/\b(?:he|killer|slasher)\b.{0,100}\b(?:attacked|appeared|approached)\b/i.test(t)||/\b(?:you can|you have to|just keep|you forgot|there is|there are|zero .+ requirement|can only be|spawns? in|spawn in|free .+ on)\b/i.test(t)||/\b(?:enter|noclip|fast travel|restart|reboot|kill|drive|driving|collect|rob|loot|desactivar|reactivar|modo historia)\b/i.test(t)&&!/\b(?:wish|would be|should make a video)\b/i.test(t);
}
export function semanticTimes(text:string){
 const times:any[]=[];const add=(role:string,quote:string,condition=false)=>{const support=supportedSpan(text,quote);if(condition&&support&&times.some(x=>/^VIDEO/.test(x.role)&&support.start<x.support.end&&support.end>x.support.start))return;if(support&&!times.some(x=>x.support.start===support.start&&x.role===role))times.push({role,text:quote,support,condition});};
 for(const m of text.matchAll(/(?:^|\n)\s*(\d{1,2}:\d{2})\s+(?=[A-Za-z])/g))add('VIDEO_CHAPTER_OFFSET',m[0].trim());
 for(const m of text.matchAll(/\b(?:skip|jump|watch|go)\s+(?:to|at)\s+\d{1,2}:\d{2}(?:[^.!?\n]{0,35}\bvideo\b)?|\b(?:video|timestamp|chapter)\s*(?:at|:)?\s*\d{1,2}:\d{2}/gi))add('VIDEO_TIMESTAMP',m[0]);
 for(const m of text.matchAll(/\b(?:wait(?:ed|ing)?(?: for)?|waiting for)\s+(?:about |around |like |roughly )?(?:\d+|one|two|three|five|ten|forty)[ -]?(?:mins?|minutes?|hours?|days?)(?:\s*\(real time\))?/gi))add('WAIT_DURATION',m[0]);
 for(const m of text.matchAll(/\b(?:takes?|took|within|in less than|in)\s+(?:about |around |less than )?(?:\d+|one|two|three|five|ten|forty)[ -]?(?:mins?|minutes?|hours?)\b/gi))add('ELAPSED_DURATION',m[0]);
 for(const m of text.matchAll(/\b(?:cooldown(?: is| of|:)?|resets? after|respawns? after)\s*(?:\d+|one|two|five)\s*(?:minutes?|hours?|days?)\b/gi))add('COOLDOWN',m[0]);
 for(const m of text.matchAll(/\b(?:at|from|between|till|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*(?:and|to|till|until|[-–])\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))?(?:\s*(?:in[- ]game|in game|real[- ](?:time|world)))?|\b(?:at|during|only at|during the|during  the)\s+(?:night|day|noon|dawn|morning|evening)|\b(?:attacked|appeared)\b[^.!?\n]{0,30}\b(?:at day|during the day)/gi)){if(!/\bvideo|chapter|timestamp\b/i.test(m[0]))add(/real[- ](?:time|world)/i.test(m[0])?'REAL_WORLD_CLOCK_TIME':/in[- ]game|in game/i.test(m[0])?'IN_GAME_TIME':'TIME_CONDITION',m[0],true);}
 for(const m of text.matchAll(/\b(?:between|from)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:and|to|[-–])\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*(?:in[- ]game|in game|real[- ](?:time|world)))?|\bat\s+\d{1,2}:\d{2}(?!\s*(?:in the video|video|chapter))(?:\s*(?:in[- ]game|in game|real[- ](?:time|world)))?/gi))add(/in[- ]game|in game/i.test(m[0])?'IN_GAME_TIME':/real[- ](?:time|world)/i.test(m[0])?'REAL_WORLD_CLOCK_TIME':'TIME_CONDITION',m[0].trim(),true);
 for(const m of text.matchAll(/\b(?:in[- ]game|in game)\s*(?:at)?\s*\d{1,2}:\d{2}|\bat\s*\d{1,2}:\d{2}\s*(?:in[- ]game|in game)/gi))add('IN_GAME_TIME',m[0],true);
 for(const m of text.matchAll(/\b\d{1,2}:\d{2}\b/g))if(!times.some(x=>m.index>=x.support.start&&m.index<x.support.end))add('UNKNOWN_TIME_ROLE',m[0]);
 const numeric=numericRoles(text);for(const t of times)if(t.condition&&numeric.some(n=>n.role==='VIDEO_OFFSET'&&n.support.start<t.support.end&&n.support.end>t.support.start)){t.role='VIDEO_TIMESTAMP';t.condition=false;}
 return times;
}
export function reportOutcome(text:string){
 const snippets=(re:RegExp)=>[...text.matchAll(re)].map(m=>m[0]);
 const failure=snippets(/\b(?:did not|didn['’]t|does not|doesn['’]t|not|never|no longer|stopped)\s+(?:work|working|spawn|spawning|give|get|receive|seen|find)|\b(?:still (?:broken|not working)|gets? no reward|no reward|no cash|no money|no bonus|did not get|didn['’]t get|won['’]t get|not seen|not spawned|hasn't seen|haven't seen|no deaths|still failed|it failed|reboot failed|restart failed|Transaction Error|Transaction failed|did it.+didn't work)\b/gi).filter(x=>!/^no deaths$/i.test(x));
 const untested=snippets(/\b(?:not tested|haven't tested|untested|people say|not tried)\b/gi),success=snippets(/\b(?:that fixed it|it worked|still works|worked once|found|got|completed|sold|earned|did it)\b/gi);
 const inconsistent=snippets(/\b(?:sometimes works|worked once|doesn't always|inconsistent|not seen another|haven't seen another|never been able)\b/gi);
 const genuineSuccess=success.filter(q=>{const i=text.toLowerCase().indexOf(q.toLowerCase());return !/\b(?:not|never|didn['’]t|hasn['’]t|haven['’]t|no longer)\s*$/i.test(text.slice(Math.max(0,i-30),i));});
 const state=untested.length?'NOT_TESTED':inconsistent.length?'INCONSISTENT':failure.length?(genuineSuccess.some(x=>/^(?:got|earned|completed|sold|it worked|that fixed it)$/i.test(x))?'PARTIAL':'FAILURE'):genuineSuccess.length?'SUCCESS':'UNKNOWN';
 return {state,evidence:[...new Set([...failure,...untested,...inconsistent,...genuineSuccess])].map(q=>supportedSpan(text,q)).filter(Boolean),qualification:failure.length?'Failed or missing outcome reported; instructions alone are not a successful remedy':untested.length?'Suggested but not tested':undefined};
}
export function qualifyWholeReport(c:Candidate,s:SourceItem):Candidate{return qualifyDiscoveryReport(c,s);}
export function semanticEntity(c:Candidate,text:string,location:Record<string,any>){
 const labelled=text.match(/(?:^|\n)Entity:\s*([^\n]+)/i)?.[1];
 const candidates=[...new Set([c.conditions.entity,labelled,...c.entities].filter((v):v is string=>typeof v==='string'&&entityRoleValid(v,text,location)))];
 const attacker=text.match(/\b(slasher|serial killer|killer|attacker)\b/i)?.[1];if(attacker&&/attacked|appeared|approached|spawn/i.test(text)&&entityRoleValid(attacker,text,location))return attacker;
 const object=text.match(/\b(?:found|collected|collect|received|enter(?:ed)?|open(?:ed)?|install(?:ed)?)\s+(?:a |an |the )?([\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+){0,5})/iu)?.[1]?.split(/\s+(?:in|at|on|near|behind|after|before|that|and|for|within|this|a couple)\b/i)[0];
 const target=object&&entityRoleValid(object,text,location)?object:undefined;
 const matching=target?candidates.find(v=>target.toLowerCase().includes(v.toLowerCase())):undefined;
 return matching??(candidates.length===1?candidates[0]:candidates.find(v=>/\b(?:revolver|pistol|rifle|vehicle|safe|raid|mission|heist|room|apartment|building|mod|clue|nightclub)\b/i.test(v)))??target;
}
export function semanticRewards(text:string,game:string):DiscoveryReward[]{
 const monetary=numericRoles(text,game).filter(n=>n.role==='MONEY');
 return monetary.map(n=>{
  const start=n.token!.start,end=n.token!.end,{before,after}=numericClause(text,start,end);
  const local=before+after,scope=monetary.length===1?text:local;
  const eligibility=/once per account|per account,? not character/i.test(scope)?'ONCE_PER_ACCOUNT':/once per character/i.test(scope)?'ONCE_PER_CHARACTER':undefined;
  const basis=eligibility==='ONCE_PER_ACCOUNT'?'ACCOUNT_BONUS':eligibility==='ONCE_PER_CHARACTER'?'CHARACTER_BONUS':/^\s*(?:per |an |\/)(?:hour|h\b)|\bhourly\b/i.test(after)?'PER_HOUR':/^\s*in (?:about |around |less than )?(?:\d+|one|two|three) (?:hours?|minutes?|mins?)\b/i.test(after)?'SESSION_TOTAL':/^\s*(?:in a full day|per day|a day|today|daily)\b/i.test(after)?'DAY_TOTAL':/^\s*(?:per (?:sale|run|mission|activity)|for (?:it|one|each))\b/i.test(after)||n.moneyRole==='SALE_PRICE'?'PER_ACTIVITY':/\b(?:just with|total|cumulative)\b/i.test(after+before)?'CUMULATIVE':'UNKNOWN';
  const receipt=n.moneyRole??'UNKNOWN';
  const measurement=receipt==='COST'||receipt==='INVESTMENT'?'cost':receipt==='MISSING'?'expected_reward':receipt==='COMPARISON'||receipt==='BASELINE'||receipt==='ADVERTISED'?receipt.toLowerCase():basis==='PER_HOUR'?'per_hour':basis==='PER_ACTIVITY'?receipt==='SALE_PRICE'?'per_sale':'per_activity':basis==='ACCOUNT_BONUS'?'once_per_account':basis==='CHARACTER_BONUS'?'once_per_character':basis==='SESSION_TOTAL'?after.match(/^\s*in (?:about |around |less than )?(?:\d+|one|two|three) (?:hours?|minutes?|mins?)/i)?.[0].trim()??'session_total':basis==='DAY_TOTAL'?'day_total':basis==='CUMULATIVE'?'cumulative':/\b(?:found|looted|got)\b/i.test(before)&&/\bsafe\b/i.test(after)?'per_successful_loot':'unknown';
  const r:DiscoveryReward={rewardType:'MONEY',currency:n.currency,amountKind:n.amountKind==='LOWER_BOUND'?'UNKNOWN':n.amountKind,...(n.maximum!==undefined?{minimum:n.value,maximum:n.maximum}:n.amountKind==='LOWER_BOUND'?{minimum:n.value}:{amount:n.value}),basis,eligibility,frequency:eligibility?'ONE_TIME':undefined,reportedRepeatability:eligibility?'ONE_TIME':undefined,receipt,outcome:receipt==='MISSING'?'NOT_RECEIVED_OR_PENDING':undefined,measurement,support:n.token,relationship:n.relationship};
  if(eligibility){const q=scope.match(/once per account|once per character|per account,? not character/i)![0];r.eligibilitySupport=supportedSpan(text,q);}
  return r;
 });
}
export function attachFieldSupport(d:DiscoveryDraft,text:string){
 const supports:Record<string,FieldSupport[]>={};const add=(field:string,value:any)=>{if(typeof value==='string'){const span=supportedSpan(text,value);if(span)(supports[field]??=[]).push(span);}};
 add('primaryEntity',d.primaryEntity);add('action',d.action);for(const[k,v]of Object.entries(d.location))if(k!=='precision')add('location.'+k,v);for(const[k,v]of Object.entries(d.conditions))add('conditions.'+k,v);add('platform',d.platform);add('gameVersion',d.gameVersion);add('method',d.method);for(const step of d.steps)add('steps',step);for(const r of d.rewards??[])if(r.support)(supports.reward??=[]).push(r.support);for(const e of d.outcome?.evidence??[])(supports.outcome??=[]).push(e);for(const t of d.timeEvidence??[])(supports.time??=[]).push(t.support);d.fieldSupport=supports;return d;
}
