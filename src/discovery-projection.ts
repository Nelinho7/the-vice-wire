import type {Candidate,SourceItem} from './model.ts';
import type {DiscoveryDraft,FieldSupport,MaterialQualifier,QualifiedDiscoveryProposition} from './discovery-model.ts';
const span=(text:string,start:number,end:number):FieldSupport=>({source:'PRIMARY',quote:text.slice(start,end),start,end});
const literal=(text:string,value:string)=>text.toLowerCase().includes(value.toLowerCase());
const bounded=(value:string)=>value.trim().replace(/[.;,]+$/,'');

export function materialQualifiers(text:string):MaterialQualifier[]{
 const out:MaterialQualifier[]=[];
 // Preserve whole qualified clauses, not disconnected condition keywords.
 for(const m of text.matchAll(/[^.!?;\n]+(?:\.(?=\d)[^.!?;\n]*)*/g)){
  const q=m[0].trim();if(!q)continue;const start=m.index!+m[0].indexOf(q),support=span(text,start,start+q.length);
  const kinds:MaterialQualifier['kind'][]=[];
  if(/\b(?:once per (?:account|character)|per account,? not character|first character only|only (?:the )?(?:first|main) character|second character|ineligible|eligib(?:le|ility))\b/i.test(q))kinds.push('ELIGIBILITY');
  if(/\b(?:unless|except|excluding|cannot|can't|can’t|doesn't|doesn’t|does not|won't|won’t)\b[^.!?]*\b(?:approach|disguise|platform|Xbox|PS[345]|PC|using|work|done|character)|\bonly\b[^.!?]*\b(?:approach|disguise)|\b(?:unless|except|excluding)\b/i.test(q))kinds.push('EXCLUSION');
  if(/\b(?:PS[345]|Xbox(?: One| 1| Series [XS]| 360)?|PC|Console)\b/i.test(q))kinds.push('PLATFORM');
  if(/\b(?:before|after|since|post|latest|new|last couple)\b[^.!?]*\b(?:patch(?:es)?|updates?|DLC)|\b(?:version|build|patch|update)\s+\d|\brecorded\b/i.test(q))kinds.push('VERSION');
  if(/\b(?:only|from|between|at|during)\b[^.!?]*\b(?:night|day|noon|dawn|morning|evening|\d{1,2}\s*(?:am|pm))\b/i.test(q)&&!/\bvideo|timestamp|chapter|tested independently/i.test(q))kinds.push('TIME');
  if(/\b(?:only|unless|except)\b[^.!?]*\b(?:at|inside|near|location)|^Location:/i.test(q))kinds.push('LOCATION');
  if(/\b(?:once|repeatable|in a row|never again|no longer|used to|on repeat)\b/i.test(q))kinds.push('REPEATABILITY');
  if(/\b(?:per (?:hour|day|sale|run|activity|account|character)|an hour|in (?:\d+|two|three) hours|full day|instead of|rather than|normally|usually|expected|missing|short by|bonus)\b/i.test(q))kinds.push('REWARD_BASIS');
  if(/\b(?:did not|didn't|didn’t|doesn't|doesn’t|does not|still|never|no longer|stopped|gets? no|no reward|no cash|no money|no bonus|failed|error|not tested|untested|haven't|haven’t|hasn't|hasn’t)\b/i.test(q)&&/\b(?:work|working|spawn|appear|reward|cash|money|bonus|fail(?:ed)?|error|tested|receive|get|seen)\b/i.test(q))kinds.push('OUTCOME');
  if(!/^Reported conditions:/i.test(q)&&/\b(?:Director Mode|Story Mode|Online mode|mission replay|creator mode|custom[- ]job)\b/i.test(q))kinds.push('METHOD');
  if(/\b(?:only|unless|except|requires?|need(?:ed)?|must|without)\b[^.!?]*\b(?:mission|approach|disguise|method|vehicle|item|clues?|revolver|noclip|mode|finish|complete)|\b(?:only works after|works unless)\b/i.test(q))kinds.push('METHOD');
  for(const kind of new Set(kinds))out.push({kind,support,scope:q.length>500?'UNRESOLVED':'PROPOSITION'});
 }
 return out;
}
export function qualifyDiscoveryReport(c:Candidate,s:SourceItem):Candidate{
 const at=s.text.toLowerCase().indexOf(c.quote.toLowerCase());if(at<0)return c;
 const lo=s.text.lastIndexOf('\n\n',at)+2,hi=s.text.indexOf('\n\n',at+c.quote.length);const paragraph=s.text.slice(lo===1?0:lo,hi<0?s.text.length:hi);
 const restrictions=materialQualifiers(paragraph);
 // Do not transfer unrelated paragraphs or ancillary witness clock times into a method.
 if(paragraph.length<=2000&&restrictions.some(q=>!literal(c.quote,q.support.quote)))return {...c,quote:paragraph,claim:paragraph};
 // A following bounded qualifier may explicitly refer back to this event.
 const end=at+c.quote.length,next=s.text.slice(end).match(/^\s*\n\n\s*(Only works (?:once per (?:account|character)|in [^.!?\n]+)[.!?]?)/i);
 if(next&&next[0].length<=500)return {...c,quote:s.text.slice(at,end+next[0].length),claim:s.text.slice(at,end+next[0].length)};
 return c;
}
export function entityRoleValid(value:string,text:string,location:Record<string,unknown>={}){
 const v=bounded(value);if(!v||!literal(text,v))return false;
 if(/^(?:UNKNOWN|he|she|it|they|them|this|that|myself|me|one|some|a couple|spawn location|location|rewards?|money|cash|bonus|account|character|garage|road|highway|alley|counter|fragment|locked ways|Rockstar|GTA.*|PC|PS[345]|Xbox.*|regular .+|.+county)$/i.test(v))return false;
 if(/(?:\d+|one|two|three|four)\s*(?:times?|runs?|minutes?|kills?|attempts?)\b|(?:GTA\$|\$|\d+[km]\b)|^(?:me |over |not |no |a shot |on |in |at |of |for )|\b(?:and|but|since|because|would|could|was|is|have|has)\b/i.test(v))return false;
 // A building can itself be an INTERIOR target. A district/street/county cannot.
 if(['street','district','region'].some(k=>typeof location[k]==='string'&&String(location[k]).toLowerCase()===v.toLowerCase()))return false;
 if(typeof location.namedLocation==='string'&&String(location.namedLocation).toLowerCase()===v.toLowerCase()&&!/\b(?:safe|bank|hotel|tower|building|club|room|apartment|house|office|garage|store|shop)\b/i.test(v))return false;
 return true;
}
export function actionRoleValid(value:string,text:string){
 if(value.trim().split(/\s+/).length<2&&value.toLowerCase()!=='noclip')return false;
 if(!literal(text,value)||!value||/^(?:got|found|spawn(?:s|ed)?|take|took ages|no longer works|stopped working|kill boxes.*)$/i.test(value.trim()))return false;
 if(/(?:GTA\$|\$|\b\d+(?:\.\d+)?[km]\b)|\b(?:kill boxes|took ages)\b/i.test(value))return false;
 return /\b(?:open|opening|opened|enter|entering|entered|loot|looting|looted|collect|collected|collecting|disable|desactivar|reactivar|rob|use|using|take|taking|follow|kill|killed|killing|restart|restarting|restarted|reboot|rebooting|rebooted|buy|purchase|purchasing|bought|drive|driving|drove|complete|completed|walk|walked|park|parked|parking|noclip|fly|install|installed|press|pressing|fast travel|switch|toggling|wait|waited)\b/i.test(value);
}
export function semanticAction(text:string,declared?:string){
 if(declared&&actionRoleValid(declared,text))return bounded(declared);
 const candidates=[...text.matchAll(/\b(?:enter(?:ed|ing)?|open(?:ed|ing)?|loot(?:ed|ing)?|collect(?:ed|ing)?|restart(?:ed|ing)?|reboot(?:ed|ing)?|drive|driving|drove|complete(?:d)?|walked|park(?:ed|ing)?|noclip|fly|install(?:ed)?|press(?:ing)?|disable|desactivar|reactivar|kill(?:ed|ing)?|switch|follow|wait(?:ed)?)\b/gi)];
 const phrases=candidates.map(m=>bounded(text.slice(m.index!).split(/[!?;\n]|\.(?!\d)/)[0].split(/\b(?:but|and then)\b/i)[0])).filter(p=>p.length<=180&&actionRoleValid(p,text));
 // Prefer a method with an object over bare observational verbs; never truncate a clause.
 return phrases.find(p=>/^(?:enter|open|loot|collect|restart|reboot|noclip|disable|desactivar|reactivar|switch|follow)\b/i.test(p))??phrases[0];
}
export function projectQualifiedProposition(d:DiscoveryDraft,c:Candidate,s:SourceItem){
 const qs=materialQualifiers(c.quote);const offset=s.text.toLowerCase().indexOf(c.quote.toLowerCase());
 for(const q of qs){q.support={...q.support,start:q.support.start+offset,end:q.support.end+offset};}
 const missing:string[]=[];
 const add=(key:string,value:string)=>{if(value.length<=500)d.conditions[key]=value;else missing.push(key);};
 for(const [i,q]of qs.entries()){add('materialQualifier_'+i,q.support.quote);q.projectedField='conditions.materialQualifier_'+i;}
 const exclusions=qs.filter(q=>q.kind==='EXCLUSION').map(q=>q.support.quote);if(exclusions.length&&exclusions.join('; ').length<=500)d.conditions.exclusions=[...new Set(exclusions)].join('; ');
 const eligibility=qs.filter(q=>q.kind==='ELIGIBILITY').map(q=>q.support.quote);if(eligibility.length&&eligibility.join('; ').length<=500)d.conditions.eligibility=[...new Set(eligibility)].join('; ');
 if(/\bfirst character only|only (?:the )?(?:first|main) character\b/i.test(c.quote))d.eligibilityStates=['FIRST_CHARACTER_ONLY'];
 if(/\bsecond character\b[^.!?]*\b(?:didn't work|did not work|ineligible|won't get|will not get|no (?:cash|reward|bonus))|\b(?:won't get|will not get|no (?:cash|reward|bonus))\b[^.!?]*\bsecond character\b/i.test(c.quote))(d.eligibilityStates??=[]).push('SECOND_CHARACTER_INELIGIBLE');
 if(d.reward?.eligibility)(d.eligibilityStates??=[]).push(d.reward.eligibility);
 const allQualified=qs.every(q=>literal(c.claim,q.support.quote));
 const displayText=qs.length&&!allQualified?c.quote:c.claim;
 const primarySupport=offset>=0?span(s.text,offset,offset+c.quote.length):undefined;
 const proposition:QualifiedDiscoveryProposition={text:displayText,subject:d.primaryEntity,action:d.action,outcome:d.outcome?.state??'UNKNOWN',qualifiers:qs,support:primarySupport!,state:missing.length?'INCOMPLETE_NEEDS_REVIEW':'COMPLETE',missingQualifiers:missing,reviewReasons:[]};
 if(offset<0){proposition.state='INCOMPLETE_NEEDS_REVIEW';proposition.reviewReasons.push('Proposition is not primary evidence');}
 const outside=materialQualifiers(s.text).filter(q=>!literal(c.quote,q.support.quote));
 // Only evaluate the same evidence paragraph: never borrow separate unrelated methods.
 const paragraphStart=s.text.lastIndexOf('\n\n',Math.max(0,offset)-1);const sourceParagraph=s.text.slice(paragraphStart<0?0:paragraphStart+2,s.text.indexOf('\n\n',offset+c.quote.length)<0?undefined:s.text.indexOf('\n\n',offset+c.quote.length));
 if(outside.some(q=>sourceParagraph.includes(q.support.quote))){proposition.state='INCOMPLETE_NEEDS_REVIEW';proposition.reviewReasons.push('Material qualification outside projected passage remains unresolved');proposition.missingQualifiers.push(...outside.filter(q=>sourceParagraph.includes(q.support.quote)).map(q=>q.kind+': '+q.support.quote.slice(0,500)));}
 if(d.outcome)d.outcome.scope={...d.outcome.scope,conditions:{...d.conditions}};d.proposition=proposition;return validateQualifierProjection(d);
}
export function validateQualifierProjection(d:DiscoveryDraft){
 const p=d.proposition;if(!p)return d;
 const missing=p.qualifiers.filter(q=>q.scope==='UNRESOLVED'||!q.projectedField||!literal(p.text,q.support.quote)||d.conditions[q.projectedField.replace('conditions.','')]!==q.support.quote).map(q=>q.kind+': '+q.support.quote);
 if(missing.length){p.state='INCOMPLETE_NEEDS_REVIEW';p.missingQualifiers=[...new Set([...p.missingQualifiers,...missing])];p.reviewReasons=[...new Set([...p.reviewReasons,'Material qualification omitted or detached'])];}
 return d;
}
