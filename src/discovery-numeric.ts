import type {FieldSupport,NumericEvidence,MonetaryRole} from './discovery-model.ts';

// Lex the whole numeric expression first. Role precedence runs before suffix expansion.
const scales:Record<string,number>={k:1e3,thousand:1e3,grand:1e3,m:1e6,million:1e6,millions:1e6};
const words:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,forty:40,fifty:50};
const durationUnit=/^\s*[- ]?\s*(minutes?|mins?|seconds?|secs?|hours?|hrs?|days?)\b/i;
const countUnit=/^\s*[- ]?\s*(kills?|players?|cars?|vehicles?|missions?|runs?|times?|attempts?|items?|collectibles?|headshots?|targets?|waves?|rounds?|RP)\b/i;
const moneySignal=/\b(?:cash|payout|paid|earn(?:ed|s|ing)?|made|mak(?:e|ing)|reward|bonus|cost(?:s|ing)?|price|sold(?: for)?|worth|profit|money|grand|received|got|get|getting|expected|advertised|investment|normally|usually|missing|short by|extra|bonus|supposed to get|should have been)\b/gi;
const span=(text:string,start:number,end:number):FieldSupport=>({source:'PRIMARY',quote:text.slice(start,end),start,end});
// Sentence boundaries exclude decimal points; conjunctions separate predicate scope.
export function numericClause(text:string,start:number,end:number){
 const boundaries=[...text.matchAll(/[;!?\n]|\.(?!\d)|,|\b(?:but|and|or)\b/gi)].filter(m=>m.index!<start);
 const left=boundaries.length?boundaries.at(-1)!.index!+boundaries.at(-1)![0].length:0;
 const next=[...text.slice(end).matchAll(/[;!?\n]|\.(?!\d)|,|\b(?:but|and|or)\b/gi)][0];
 return {before:text.slice(left,start),after:text.slice(end,next?end+next.index!:text.length),left};
}
export function monetaryRole(before:string,after:string):MonetaryRole{
 if(/\b(?:instead of|rather than|compared (?:to|with)|versus|vs\.?)\s*$/i.test(before))return 'COMPARISON';
 if(/\b(?:expected|expecting|should have been|supposed to (?:get|receive)|should (?:get|receive))\b[^;!?]*$/i.test(before))return 'EXPECTED';
 if(/\b(?:normally|usually|baseline|base payout)\b/i.test(before)||/^\s*(?:normally|usually|baseline)\b/i.test(after))return 'BASELINE';
 if(/\b(?:advertised|advertises|promised)\b/i.test(before))return 'ADVERTISED';
 if(/\bshort by\s*$/i.test(before))return 'MISSING';
 if(/\b(?:did not|didn't|didn’t|not|never|won't|won’t|gets? no|missing|waiting|neither)\b/i.test(before)||/^\s*(?:missing|not received|short)\b/i.test(after))return 'MISSING';
 if(/\b(?:investment|invested)\b/i.test(before))return 'INVESTMENT';
 if(/\b(?:cost(?:s|ing)?|price|paid|bought|purchase|requires|requirements)\b/i.test(before))return 'COST';
 if(/\b(?:sold(?: for)?|sale price|sell(?:s)? for)\b/i.test(before))return 'SALE_PRICE';
 if(/\b(?:profit|profited)\b/i.test(before))return 'PROFIT';
 if(/\b(?:got|received|made|earned|earn|earning|getting|looted|found)\b/i.test(before))return 'RECEIVED';
 if(/\b(?:bonus|extra)\b/i.test(before+after))return 'BONUS';
 if(/\b(?:reward|payout|worth|cash)\b/i.test(before+after))return 'EXPECTED';
 return 'UNKNOWN';
}
export function numericRoles(text:string,game='UNKNOWN'):NumericEvidence[]{
 const out:NumericEvidence[]=[];
 const tokens=/(?<![\p{L}\p{N}_])(?:(GTA\$|US\$|USD|EUR|GBP|\$|€|£)\s*)?(\d[\d,]*(?:\.\d+)?(?::\d{2})?)\s*(?:\+\s*)?(k|m|millions?|thousand|grand)?(?![\p{L}\p{N}_])(?:\s*(?:[-–]|to)\s*(?:(GTA\$|USD|US\$|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|millions?|thousand|grand)?(?![\p{L}\p{N}_]))?(?:\s*\+)?(?:\s*(GTA\$|USD|US\$|EUR|GBP))?/giu;
 for(const m of text.matchAll(tokens)){
  const start=m.index!,end=start+m[0].length,tail=text.slice(end),context=numericClause(text,start,end),before=context.before,after=context.after;
  const raw=m[0].trim(),suffix=m[3]?.toLowerCase(),marker=(m[7]??m[1])?.toUpperCase(),base=Number(m[2].replaceAll(',',''));
  let role:NumericEvidence['role']='UNKNOWN',unit:string|undefined,value=base,maximum:number|undefined;
  const immediateDuration=tail.match(durationUnit),immediateCount=tail.match(countUnit);
  const shortDuration=suffix==='m'&&(/\b(?:wait(?:ed|ing)?|video|duration|length|takes?|took)\s*(?:about |around |for )?$/i.test(before)||/^\s*(?:wait|video|long|duration|length|later)\b/i.test(after));
  const previousMoney=out.filter(n=>n.role==='MONEY').at(-1);const ellipticalMoney=!!previousMoney&&!!suffix&&/^\s*(?:in (?:\d+|one|two|three) (?:hours?|minutes?)|today|per (?:hour|day)|\/hour)\b/i.test(after)&&!/[.!?;\n]/.test(text.slice(previousMoney.support.end,start));
  const around=text.slice(Math.max(0,start-55),Math.min(text.length,end+55));
  if(m[2].includes(':')){
   const line=text.slice(text.lastIndexOf('\n',start-1)+1,start);
   role=/video|chapter|timestamp|skip|jump/i.test(before+after)||/^\s*$/.test(line)&&/^\s+[A-Za-z]/.test(tail)?'VIDEO_OFFSET':/\b(?:at|between|from|in[- ]game)\s*$/i.test(before)?'TIME_OF_DAY':'UNKNOWN';value=NaN;
  }else if(immediateDuration||shortDuration){role=marker?'UNKNOWN':'DURATION';unit=immediateDuration?.[1]??'minutes';}
  else if(immediateCount){role=marker?'UNKNOWN':'COUNT';unit=immediateCount[1];}
  else if(/^\s*(?:am|pm)\b/i.test(tail)){role='TIME_OF_DAY';unit=tail.match(/^\s*(am|pm)\b/i)![1];}
  else if(/^\s*(?:%|percent\b)/i.test(tail)){role='PERCENTAGE';unit='%';}
  else if(/^\s*(?:meters?|metres?|km|miles?|feet|ft)\b/i.test(tail)){role='DISTANCE';unit=tail.match(/^\s*([\w]+)/)![1];}
  else if(/\b(?:version|build|patch|update)\s*:?\s*$/i.test(before)&&!marker){role='VERSION';}
  else if(/\b(?:level|rank)\s*$/i.test(before)&&!marker){role='LEVEL';}
  else if(/\bcoordinates?\s*[:=]/i.test(around)&&!marker){role='COORDINATE';}
  else if(!marker&&(base>=1900&&base<=2100&&!suffix||/\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(around))){role='DATE';}
  else {
   const signals=[...before.matchAll(moneySignal),...after.matchAll(moneySignal)];
   const strong=!!marker||signals.length>0||ellipticalMoney;
   // Generic get/got next to a plain number is not money evidence without a currency,
   // monetary noun or complete shorthand. Reject coordinate/date/version/quantity first.
   const unscaledMoney=!!marker||/\b(?:cash|payout|paid|reward|bonus|cost|price|sold for|worth|profit|money|investment)\b/i.test(before+after);
   if(strong&&(suffix||unscaledMoney)&&! /\b(?:video|wait|duration)\s*$/i.test(before)){role='MONEY';value=base*(scales[suffix??m[6]?.toLowerCase()??'']??1);if(m[5])maximum=Number(m[5].replaceAll(',',''))*(scales[m[6]?.toLowerCase()??suffix??'']??1);}
  }
  if((text[start-1]==='-'||text[start-1]==='−')&&!/\d\s*[-−]$/.test(text.slice(Math.max(0,start-10),start))){role='UNKNOWN';value=base;maximum=undefined;}
  if(text[end]==='.'&&/\d/.test(text[end+1]??'')||text[start-1]==='.'&&/\d/.test(text[start-2]??'')){role='UNKNOWN';value=base;}
  const nearestQualifier=before.match(/\b(about|around|roughly|approximately|approx\.?|over|at least|more than)\s*$/i);
  const kind=maximum!==undefined?'RANGE':/\+/.test(raw)||nearestQualifier&&/over|at least|more than/i.test(nearestQualifier[0])?'LOWER_BOUND':nearestQualifier?'APPROXIMATE':'EXACT';
  const canonicalUnit=unit?.toLowerCase().replace(/^(min|mins|minute)$/,'minutes').replace(/^(sec|secs|second)$/,'seconds').replace(/^(hr|hrs|hour)$/,'hours');
  let supportEnd=end;if(immediateDuration||immediateCount||role==='TIME_OF_DAY'&&unit||role==='PERCENTAGE'||role==='DISTANCE'){const u=immediateDuration??immediateCount??tail.match(/^\s*(am|pm|%|percent|meters?|metres?|km|miles?|feet|ft)/i);if(u)supportEnd=end+u[0].length;}
  const expression=span(text,start,supportEnd);const moneyToken=span(text,start,end);
  const signal=[...before.matchAll(moneySignal)].at(-1);const nextSignal=[...after.matchAll(moneySignal)][0];
  const relationship=ellipticalMoney&&!marker&&!signal&&!nextSignal?previousMoney.relationship:marker?moneyToken:signal?span(text,context.left+signal.index!,context.left+signal.index!+signal[0].length):nextSignal?span(text,end+nextSignal.index!,end+nextSignal.index!+nextSignal[0].length):expression;
  const currency=marker==='USD'||marker==='US$'?'USD':marker==='EUR'||marker==='€'?'EUR':marker==='GBP'||marker==='£'?'GBP':marker==='GTA$'||/^GTA/i.test(game)&&(!marker||marker==='$')?'GTA$':'unknown';
  out.push({role,expression:expression.quote,...(Number.isFinite(value)?{value}:{}),...(maximum!==undefined?{maximum}:{}),unit:canonicalUnit,amountKind:kind,support:expression,relationship,...(role==='MONEY'?{currency,moneyRole:monetaryRole(before,after)==='UNKNOWN'&&ellipticalMoney?previousMoney.moneyRole:monetaryRole(before,after),token:moneyToken}:{}),...(marker&&(immediateDuration||immediateCount)?{warning:'Currency marker conflicts with non-monetary quantity unit'}:{})});
 }
 for(const m of text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|forty|fifty)\s+(runs?|times?|attempts?|kills?|players?|cars?|vehicles?|items?|collectibles?|minutes?|mins?|hours?|days?|seconds?)\b/gi)){
  const unit=m[2].toLowerCase(),role=/minutes?|mins?|hours?|days?|seconds?/.test(unit)?'DURATION':'COUNT',support=span(text,m.index!,m.index!+m[0].length);
  out.push({role,expression:m[0],value:words[m[1].toLowerCase()],unit,amountKind:'EXACT',support,relationship:support});
 }
 return out.sort((a,b)=>a.support.start-b.support.start);
}
