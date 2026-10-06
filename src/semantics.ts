import type { Candidate,SourceItem } from './model.ts';
export type NumericalValue={name:string;value:number;unit:string;currency?:'GTA$'|'USD'|'EUR'|'GBP'|'unknown'|'non_currency';measurement?:string;timeBasis?:string;activityBasis?:string;conditions?:Record<string,string>};
export function dimensions(v:NumericalValue){return JSON.stringify([v.name,v.currency??v.unit,v.measurement??'unknown',v.timeBasis??'unknown',v.activityBasis??'unknown',Object.entries(v.conditions??{}).sort()]);}
export function incomplete(v:NumericalValue){return !v.currency||v.currency==='unknown'||!v.measurement||v.measurement==='unknown'||!v.timeBasis||v.timeBasis==='unknown'||!v.activityBasis||v.activityBasis==='unknown';}
function explicitAmountCurrency(text:string,value:number):NumericalValue['currency']|null {
 const found:NumericalValue['currency'][]=[];
 for(const m of text.matchAll(/(GTA\$|USD|US\$|EUR|GBP|€|£|\$)?\s*(\d[\d,.]*)\s*\+?\s*(millions?|million|thousand|[kmb])?\b/gi)){
  const amount=Number(m[2].replaceAll(',',''))*({k:1e3,thousand:1e3,m:1e6,million:1e6,millions:1e6,b:1e9}[m[3]?.toLowerCase()??'']??1);
  if(amount!==value)continue;
  const prefix=m[1]?.toUpperCase(),suffix=text.slice((m.index??0)+m[0].length).match(/^\s*(USD|EUR|GBP|GTA\$)\b/i)?.[1]?.toUpperCase();
  const unit=suffix??prefix;
  if(unit&&unit!=='$')found.push(unit==='€'||unit==='EUR'?'EUR':unit==='£'||unit==='GBP'?'GBP':unit==='GTA$'?'GTA$':'USD');
 }
 const currencies=[...new Set(found)];return currencies.length===1?currencies[0]:currencies.length>1?'unknown':null;
}
export function valueSemantics(v:NumericalValue,c:Candidate,source?:SourceItem):NumericalValue {
 const t=(c.quote??c.claim).toLowerCase(),game=/gta|auto shop|acid lab|heist|nightclub/.test(t+' '+Object.values(c.conditions).join(' ').toLowerCase()+' '+(source?.title??'').toLowerCase()+' '+(source?.context?.postTitle??'').toLowerCase());
 const real=/real.world|usd|us dollars|dlc (?:cost|price)|subscription|€|£|eur|gbp/.test(t);
 const nonCurrency=!['$','GTA$','USD','EUR','GBP','unknown','currency','money'].includes(v.unit)||v.currency==='non_currency';
 const explicit=explicitAmountCurrency(c.quote??c.claim,v.value);
 let currency:NumericalValue['currency']=nonCurrency?'non_currency':explicit??((!real&&game&&/\$|\b(?:earn|made|pays?|payout|sale|investment|million|dollars?|reward|\d+k)\b/.test(t))?'GTA$':/€|eur/i.test(t)?'EUR':/£|gbp/i.test(t)?'GBP':/usd|us dollars/i.test(t)?'USD':/\$/.test(t)&&real?'USD':v.unit==='GTA$'?'GTA$':['EUR','GBP'].includes(v.unit)?v.unit as any:'unknown');
 let timeBasis=v.timeBasis&&v.timeBasis!=='unknown'?v.timeBasis:/per hour|an hour|hourly|\/hour|\/h\b/.test(t)?'hour':/per day|daily|a day/.test(t)?'day':/lifetime|total.*(?:made|earned)|(?:made|earned).*total/.test(t)?'lifetime':/two hours|2 hours/.test(t)?'2_hours':/once|one.off/.test(t)?'once':c.predicate==='sale_payout'?'per_activity':v.timeBasis??'unknown';
 const measurement=/investment|requires|costs?|purchase/.test(t)?'investment':timeBasis==='hour'||timeBasis==='day'?'earnings_rate':timeBasis==='lifetime'?'cumulative_earnings':currency==='non_currency'?'quantity':'payout';
 const activityBasis=v.activityBasis&&v.activityBasis!=='unknown'?v.activityBasis:/per sale|sale_payout/.test(t+' '+c.predicate)?'sale':/per mission/.test(t)?'mission':c.conditions.activity??(c.entities.length===1?c.entities[0]:'unknown');
 if(currency==='non_currency'&&!v.timeBasis)timeBasis='not_applicable';
 const basisAliases:Record<string,string>={'hourly':'hour','per hour':'hour','per_hour':'hour','daily':'day','per day':'day','full day':'day','2 hours':'2_hours','one-time':'once','one_time':'once','one-off':'once','per sale':'per_sale','per mission':'per_mission','unspecified':'unknown','not stated':'unknown'};
 timeBasis=basisAliases[timeBasis.toLowerCase()]??timeBasis.toLowerCase();
 return {...v,currency,unit:currency==='non_currency'?v.unit:currency,measurement:v.measurement&&v.measurement!=='unknown'?v.measurement:measurement,timeBasis,activityBasis:activityBasis.toLowerCase().normalize('NFC').replace(/\s+/g,' ').trim(),conditions:v.conditions??{}};
}
export const superlative=/\b(best|fastest|highest[ _-]paying|top|most profitable|easiest)\b|#1\b/i;
export function unsupportedSuperlative(c:Candidate){
 if(!superlative.test(c.claim))return false;
 const comparison=/(?:compared (?:with|to)|versus|\bvs\.?\b|faster than|more (?:profitable|than)|highest among|lowest among)/i.test(c.quote);
 const scoped=/of these|among|between|compared|versus|\bvs\b|than|in this (?:test|comparison|sample)/i.test(c.claim);
 const values=c.values.map(v=>valueSemantics(v,c));
 const metrics=[...c.quote.matchAll(/(?:GTA\$|\$|€|£)\s*\d[\d,.]*|\b\d+(?:\.\d+)?\s*(?:k\b|million|seconds?|minutes?|hours?|fps\b)/gi)];
 const comparable=values.length>=2&&values.every(v=>!incomplete(v)&&v.currency===values[0].currency&&v.measurement===values[0].measurement&&v.timeBasis===values[0].timeBasis);
 return !(comparison&&scoped&&c.entities.length>=2&&metrics.length>=2&&comparable);
}
export function factualText(text:string){const clean=text.replace(/https?:\/\/\S+/g,'');return clean.split(/(?<=[?!.])\s+|\n/).some(s=>!s.includes('?')&&/\b(tested|worked|paid|found|fixed|reproduced|sold|pays|happened|released|added|removed|requires|no longer|does not|without|has been|now|still works)\b/i.test(s));}
export function temporal(c:Candidate,s:SourceItem){const t=c.quote;const date=t.match(/\b(20\d\d-\d\d-\d\d)\b/);return {publishedAt:s.timestamp,observedAt:date?date[1]:null,observedTimeText:date?date[1]:c.conditions.date??c.conditions.time??null,invalidates:!/(?:may|might|could|can).*patch|at any time/i.test(t)&&/no longer works|(?:was|is|were|been) patched|fixed after|death barrier.*added|stopped working/i.test(t),update:/update|patch|dlc/i.test(t)};}
