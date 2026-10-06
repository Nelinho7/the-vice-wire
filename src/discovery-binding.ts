import type {Candidate,SourceItem} from './model.ts';
import type {DiscoveryDraft,FieldSupport,OutcomeState} from './discovery-model.ts';
export type PropositionAssertion='OBSERVATION'|'GENERALIZATION'|'HYPOTHESIS'|'QUESTION'|'WISH'|'INSTRUCTION'|'REPORTED_CLAIM'|'FAILED_ATTEMPT'|'SUCCESSFUL_ATTEMPT'|'UNKNOWN';
export type PropositionOwner='PRIMARY_REPORT'|'PARENT_COMMENT'|'VIDEO_TITLE'|'VIDEO_DESCRIPTION'|'VIDEO_CHAPTER'|'CREATOR_INSTRUCTION'|'OTHER_USER_COMMENT';
export type GroundedProposition={propositionId:string;subject?:string;predicate?:string;object?:string;location?:string;mode?:string;platform?:string;version?:string;timeScope?:string;conditions:string[];exclusions:string[];eligibility:string[];rewardBasis?:string;rewards?:{rewardIndex:number;receipt?:string;support:FieldSupport}[];reporterOutcome:OutcomeState;assertionKind:PropositionAssertion;reporter:string|null;owner:PropositionOwner;evidence:FieldSupport[];sourceScope:string;parentProposition?:string;relationships:{propositionId:string;kind:'EXPLICIT_COREFERENCE'|'STRUCTURED_LABEL';evidence:FieldSupport}[]};
export type PropositionFieldBinding={propositionId:string;support:FieldSupport;owner:PropositionOwner};
const modes=/\b(?:Director Mode|Story Mode|GTA Online|Online mode|mission replay|creator mode|custom[- ]job|storymode|director mode|online)\b/gi;
const platforms=/\b(?:PS[345]|Xbox(?: One| Series [XS]| 360)?|PC|old-gen|current-gen)\b/gi;
const evidence=(text:string,start:number,end:number):FieldSupport=>({source:'PRIMARY',quote:text.slice(start,end),start,end});
const norm=(x:string|undefined)=>(x??'').toLowerCase().replace(/[-\s]+/g,' ').trim();
const unique=(xs:string[])=>[...new Map(xs.map(x=>[norm(x),x])).values()];
export function propositionAssertion(text:string):PropositionAssertion{
 if(/\b(?:I wish|if only|wish we|would like)\b/i.test(text))return 'WISH';
 if(/\b(?:wonder|hypothetical|perhaps|might|could|maybe|not tested|untested|haven't tried)\b/i.test(text))return 'HYPOTHESIS';
 if(/\?\s*$/.test(text))return 'QUESTION';
 if(/\b(?:according to|another (?:user|player)|they (?:say|claim)|creator says)\b/i.test(text))return 'REPORTED_CLAIM';
 if(/\b(?:didn't|did not|doesn't|does not|never|failed|won't|not working)\b/i.test(text))return 'FAILED_ATTEMPT';
 if(/\b(?:I|we)\b[^.!?]*\b(?:got|received|found|entered|completed|sold|earned|did it|made)|\b(?:worked|works|succeeded|did)\s*[.!?]?$/i.test(text))return 'SUCCESSFUL_ATTEMPT';
 if(/^(?:open|enter|reboot|restart|use|try|complete|collect)\b/i.test(text.trim()))return 'INSTRUCTION';
 if(/\b(?:always|every time|usually|can|lets you|allows)\b/i.test(text))return 'GENERALIZATION';
 if(/\b(?:spawned|appeared|opens|paid|gave|reward was|reward is|found)\b/i.test(text))return 'OBSERVATION';
 return 'UNKNOWN';
}
export function groundedPropositions(text:string,options:{offset?:number;owner?:PropositionOwner;reporter?:string|null;sourceScope?:string}={}):GroundedProposition[]{
 const offset=options.offset??0,owner=options.owner??'PRIMARY_REPORT';const out:GroundedProposition[]=[];
 // Decimal points remain inside quantities; contrast boundaries isolate new methods/platforms.
 const boundary=/[.!?](?!\d)(?:\s+|$)|;\s*|\n+|,?\s+but\s+(?=(?:on\s+)?(?:PC|PS[345]|Xbox|old-gen|current-gen|Method\s+[A-Z]|now\b))|\s+and\s+(?=(?:on\s+)?(?:PC|PS[345]|Xbox|old-gen|current-gen)\b)|\s+(?:and|but)\s+(?=(?:at\s+|I (?:found|entered|rebooted|completed|sold)\b|found\s+))|\s+and\s+(?=I (?:got|received|earned) [^.!?;]+ from\b)|\s+and\s+(?=(?:the )?[^.!?;]{1,50} (?:paid|gave me)\b)/gi;
 let start=0;const parts:{start:number;end:number}[]=[];for(const m of text.matchAll(boundary)){const punctuation=/^[.!?]/.test(m[0])?1:0;parts.push({start,end:m.index!+punctuation});start=m.index!+m[0].length;}parts.push({start,end:text.length});
 for(const part of parts){let a=part.start,b=part.end;while(a<b&&/\s/.test(text[a]))a++;while(b>a&&/\s/.test(text[b-1]))b--;if(a===b)continue;const t=text.slice(a,b),support=evidence(text,a,b);support.start+=offset;support.end+=offset;
 const ps=unique([...t.matchAll(platforms)].map(m=>m[0])),ms=unique([...t.matchAll(modes)].map(m=>m[0]));const assertionKind=propositionAssertion(t);
 const p:GroundedProposition={propositionId:`${owner}:${offset+a}:${offset+b}`,reporter:options.reporter??null,owner,sourceScope:options.sourceScope??'primary',evidence:[support],conditions:[],exclusions:[],eligibility:[],relationships:[],assertionKind,reporterOutcome:assertionKind==='FAILED_ATTEMPT'?'FAILURE':['HYPOTHESIS','QUESTION','WISH'].includes(assertionKind)?'NOT_TESTED':assertionKind==='SUCCESSFUL_ATTEMPT'?'SUCCESS':'UNKNOWN'};
 if(ps.length===1)p.platform=ps[0];if(ms.length===1)p.mode=ms[0];
 p.timeScope=t.match(/\b(?:years ago|historical|before (?:the )?patch|after (?:the )?patch|now|currently|used to|old-gen|current-gen)\b/i)?.[0];p.version=t.match(/\b(?:before|after|since) (?:the )?(?:patch|update)|\b(?:patch|version|update)\s*\d+(?:\.\d+)*/i)?.[0];
 p.subject=t.match(/\b(?:Method\s+[A-Z]|Car|NPCs?|slasher|mission|robbery|safe|heist)\b/i)?.[0];p.predicate=t.match(/\b(?:open|opened|enter|entered|spawned|found|robbed|killed|sold|selling|completed|rebooted|restart|paid|gave|worked|failed)\b[^.!?;]*/i)?.[0];p.object=t.match(/\b(?:open|opened|enter|entered|found|robbed|killed)\s+(?:the )?([^.!?;,]+?)(?=\s+(?:at|in|on|from|and|but)\b|[.!?;,]|$)/i)?.[1];p.location=t.match(/\b(?:at|near|inside)\s+([^.!?;,]+?)(?=\s+(?:I|we|only|and|but)\b|[.!?;,]|$)/i)?.[1];
 if(/\b(?:only|requires?|must|without)\b/i.test(t))p.conditions.push(t);if(/\b(?:unless|except|excluding|without)\b/i.test(t))p.exclusions.push(t);if(/\b(?:once per account|once per character|first character|second character|ineligible)\b/i.test(t))p.eligibility.push(t);
 const previous=out.at(-1);const label=/^(?:Entity|Location|Action|Platform|Version|Requirements|Reward|Repeatability|Discovery type):/i.test(t);const coref=/^(?:only works|it |this (?:method|reward|bonus|door|entrance)|that (?:method|reward)|the same (?:method|reward)|my second character)/i.test(t);
 if(previous&&(label||coref)&&(!p.platform||!previous.platform||norm(p.platform)===norm(previous.platform))&&(!p.mode||!previous.mode||norm(p.mode)===norm(previous.mode))){p.parentProposition=previous.parentProposition??previous.propositionId;p.relationships.push({propositionId:p.parentProposition,kind:label?'STRUCTURED_LABEL':'EXPLICIT_COREFERENCE',evidence:support});p.platform??=previous.platform;p.mode??=previous.mode;p.timeScope??=previous.timeScope;}
 out.push(p);
 }
 return out;
}
export function propositionCompatible(a:GroundedProposition,b:GroundedProposition):boolean{
 if(a.owner!==b.owner||a.reporter!==b.reporter||a.sourceScope!==b.sourceScope)return false;
 for(const k of ['platform','mode','version','timeScope','subject','location'] as const)if(a[k]&&b[k]&&norm(a[k])!==norm(b[k]))return false;
 if(['HYPOTHESIS','QUESTION','WISH'].includes(a.assertionKind)!==['HYPOTHESIS','QUESTION','WISH'].includes(b.assertionKind))return false;
 if(a.propositionId===b.propositionId)return true;
 // An explicit relation is necessary; mere absence of conflicting fields is insufficient.
 return !!(a.parentProposition===b.propositionId||b.parentProposition===a.propositionId||a.parentProposition&&a.parentProposition===b.parentProposition);
}
export function rewardActivityBinding(text:string):{activity?:string;support?:FieldSupport}{
 // Require a literal causal grammar. Co-occurrence and neighboring activities are insufficient.
 const expressions=[/\b(?:got|received|earned)\s+(?:about\s+)?(?:GTA\$|USD\s*|\$)?\d[\d,.]*(?:\s*(?:k|m|million|thousand))?\s+from\s+(?:the\s+)?([^.!?;,]+?)(?=\s+(?:and|but)\b|[.!?;,]|$)/gi,/\b(?:the\s+)?([^.!?;,]+?)\s+(?:paid|gave me|reward (?:was|is))\s+(?:GTA\$|USD\s*|\$)?\d[\d,.]*(?:\s*(?:k|m|million|thousand))?/gi];
 if(/\b(?:combined|cumulative|session total|ended with)\b/i.test(text))return {};
 const hits=expressions.flatMap(re=>[...text.matchAll(re)]).filter(m=>!(/\b(?:and|total|combined|ended with|session|instead|expected)\b/i.test(m[1])));
 if(hits.length!==1)return {};const m=hits[0],activity=m[1].trim().replace(/^(?:I |we |the )/i,'');if(!activity||activity.length>120)return {};return {activity,support:evidence(text,m.index!,m.index!+m[0].length)};
}
export function validatePropositionBindings(d:DiscoveryDraft):DiscoveryDraft{
 const binding=d.binding;if(!binding)return d;const byId=new Map(binding.propositions.map(p=>[p.propositionId,p]));const errors:string[]=[];
 const original=groundedPropositions(d.grounding.quote,{offset:d.proposition?.support.start??0,reporter:binding.propositions.find(p=>p.owner==='PRIMARY_REPORT')?.reporter,sourceScope:binding.propositions.find(p=>p.owner==='PRIMARY_REPORT')?.sourceScope});
 for(const p of binding.propositions.filter(p=>p.owner==='PRIMARY_REPORT')){const expected=original.find(x=>x.propositionId===p.propositionId);if(!expected||['mode','platform','version','timeScope','parentProposition','assertionKind','reporterOutcome'].some(k=>p[k]!==expected[k])||JSON.stringify(p.evidence)!==JSON.stringify(expected.evidence)||JSON.stringify(p.relationships)!==JSON.stringify(expected.relationships))errors.push('Altered proposition semantics or evidence');}
 const modesInEvidence=unique(original.map(p=>p.mode).filter(Boolean) as string[]);if(modesInEvidence.length===1&&norm(d.conditions.mode)!==norm(modesInEvidence[0]))errors.push('Material mode omitted');
 const ps=unique([...d.grounding.quote.matchAll(platforms)].map(m=>m[0]));if(ps.length>1){errors.push('Multiple platform outcomes cannot collapse');if(d.outcome)d.outcome.state='UNKNOWN';}
 const scalarValues:Record<string,string|undefined>={action:d.action,entity:d.primaryEntity,platform:d.platform,version:d.gameVersion,mode:d.conditions.mode};
 for(const [k,v]of Object.entries(d.location))if(typeof v==='string'&&k!=='precision')scalarValues['location:'+k]=v;
 for(const [k,v]of Object.entries(d.conditions))if(v&&k!=='mode')scalarValues['conditions:'+k]=v;
 for(const [k,v]of Object.entries(scalarValues))if(v&&!(binding.fields[k]??[]).some(r=>norm(r.support.quote)===norm(v)))errors.push('Unbound field: '+k);
 for(const [i,r]of (d.rewards??(d.reward?[d.reward]:[])).entries()){if(!(binding.fields['reward:'+i]??[]).some(ref=>ref.propositionId===r.propositionId))errors.push('Unbound reward event');if(r.activityBasis&&r.activityBasis!=='not_established'){const ref=binding.fields['activityBasis:'+i]?.[0],p=ref&&byId.get(ref.propositionId),link=p&&rewardActivityBinding(p.evidence[0].quote);if(!ref||ref.propositionId!==r.propositionId||link?.activity!==r.activityBasis)errors.push('Unsupported activity relationship');}}

 for(const [field,refs]of Object.entries(binding.fields)){for(const ref of refs){const p=byId.get(ref.propositionId);if(!p||p.owner!=='PRIMARY_REPORT'||p.owner!==ref.owner||!p.evidence.some(e=>ref.support.start>=e.start&&ref.support.end<=e.end&&e.quote.slice(ref.support.start-e.start,ref.support.end-e.start)===ref.support.quote))errors.push('Invalid proposition provenance: '+field);}}
 const highRisk=Object.entries(binding.fields).filter(([k])=>!k.startsWith('activityBasis:')).flatMap(([,v])=>v).map(r=>byId.get(r.propositionId)).filter(Boolean) as GroundedProposition[];
 if(highRisk.some(p=>['HYPOTHESIS','QUESTION','WISH','REPORTED_CLAIM'].includes(p.assertionKind)))errors.push('Non-observation assertion cannot become an actionable reporter observation');
 for(const a of highRisk)for(const b of highRisk)if(!propositionCompatible(a,b))errors.push('Incompatible event fields');
 for(const [key,refs]of Object.entries(binding.fields).filter(([k])=>k.startsWith('activityBasis:'))){const rewardRefs=binding.fields[key.replace('activityBasis:','reward:')]??[];if(!rewardRefs.length||refs.some(a=>!rewardRefs.some(b=>a.propositionId===b.propositionId)))errors.push('Reward activity belongs to another proposition');}
 if(errors.length){binding.state='INCOMPLETE_NEEDS_REVIEW';binding.reviewReasons=[...new Set([...binding.reviewReasons,...errors])];}
 if(binding.state==='INCOMPLETE_NEEDS_REVIEW'&&d.proposition){d.proposition.state='INCOMPLETE_NEEDS_REVIEW';d.proposition.reviewReasons=[...new Set([...d.proposition.reviewReasons,...binding.reviewReasons])];}return d;
}
export function bindDiscoveryPropositions(d:DiscoveryDraft,c:Candidate,s:SourceItem){
 const offset=s.text.toLowerCase().indexOf(c.quote.toLowerCase());const propositions=groundedPropositions(c.quote,{offset,reporter:s.author,sourceScope:s.id});const fields:Record<string,PropositionFieldBinding[]>={};const reasons:string[]=[];
 const primary=propositions.filter(p=>p.owner==='PRIMARY_REPORT');
 const own=(field:string,value:string|undefined)=>{if(!value)return;const candidates=primary.filter(p=>p.evidence.some(e=>e.quote.toLowerCase().includes(value.toLowerCase())));if(!candidates.length||candidates.some(a=>candidates.some(b=>!propositionCompatible(a,b)))){reasons.push('Unresolved field owner: '+field);return;}const p=candidates[0],e=p.evidence[0],at=e.quote.toLowerCase().indexOf(value.toLowerCase());fields[field]=[{propositionId:p.propositionId,owner:p.owner,support:{source:'PRIMARY',quote:e.quote.slice(at,at+value.length),start:e.start+at,end:e.start+at+value.length}}];};
 own('action',d.action);own('entity',d.primaryEntity);for(const [k,v]of Object.entries(d.location))if(typeof v==='string'&&k!=='precision')own('location:'+k,v);own('platform',d.platform);own('version',d.gameVersion);
 for(const [k,v]of Object.entries(d.conditions))if(v)own('conditions:'+k,v);
 const modeList=unique([...c.quote.matchAll(modes)].map(m=>m[0]));if(modeList.length===1){d.conditions.mode=modeList[0];own('mode',modeList[0]);}else if(modeList.length>1)reasons.push('Multiple modes require separate review');
 for(const [i,r]of (d.rewards??(d.reward?[d.reward]:[])).entries()){let support=r.support;if(!support){const literal=r.itemReward??(r.rewardType==='RP'?c.quote.match(new RegExp('\\b'+r.amount+'\\s*RP\\b','i'))?.[0]:undefined);if(literal){own('reward:'+i,literal);support=fields['reward:'+i]?.[0]?.support;if(support)r.support=support;}}if(!support){reasons.push('Unresolved reward event');continue;}const p=primary.find(p=>p.evidence.some(e=>support.start>=e.start&&support.end<=e.end));if(!p){reasons.push('Unresolved reward event');continue;}fields['reward:'+i]=[{propositionId:p.propositionId,owner:p.owner,support}];r.propositionId=p.propositionId;(p.rewards??=[]).push({rewardIndex:i,receipt:r.receipt,support});p.rewardBasis=r.basis;const link=rewardActivityBinding(p.evidence[0].quote);if(link.activity&&link.support&&support.start>=p.evidence[0].start+link.support.start&&support.end<=p.evidence[0].start+link.support.end){r.activityBasis=link.activity;r.activityRelationship={...link.support,start:link.support.start+p.evidence[0].start,end:link.support.end+p.evidence[0].start};fields['activityBasis:'+i]=[{propositionId:p.propositionId,owner:p.owner,support:r.activityRelationship}];}else r.activityBasis='not_established';}
 const scopes=unique([...c.quote.matchAll(platforms)].map(m=>m[0]));if(scopes.length>1){reasons.push('Multiple platforms require separate review');d.platform=undefined;delete d.conditions.platform;if(d.outcome){d.outcome.state='UNKNOWN';d.outcome.scope={reporter:s.author,platform:null};}}
 const outcomeEvidence=d.outcome?.evidence??[];for(const e of outcomeEvidence){const p=primary.find(p=>p.evidence.some(x=>e.start>=x.start&&e.end<=x.end));if(p)(fields.outcome??=[]).push({propositionId:p.propositionId,owner:p.owner,support:e});}
 // Foreign context is represented separately and never contributes a primary field.
 const contextKeys:[string,PropositionOwner][]=[['parentComment','PARENT_COMMENT'],['parentText','PARENT_COMMENT'],['videoTitle','VIDEO_TITLE'],['videoDescription','VIDEO_DESCRIPTION'],['videoChapter','VIDEO_CHAPTER'],['creatorInstruction','CREATOR_INSTRUCTION'],['otherUserComment','OTHER_USER_COMMENT']];
 for(const [key,owner]of contextKeys){const t=s.raw[key];if(typeof t==='string')propositions.push(...groundedPropositions(t,{owner,sourceScope:s.id+':'+key}));}
 if(s.context?.parentText)propositions.push(...groundedPropositions(s.context.parentText,{owner:'PARENT_COMMENT',sourceScope:s.id+':parent'}));
 if(s.context?.postBody)propositions.push(...groundedPropositions(s.context.postBody,{owner:'PARENT_COMMENT',sourceScope:s.id+':post'}));
 if(s.title)propositions.push(...groundedPropositions(s.title,{owner:'VIDEO_TITLE',sourceScope:s.id+':title'}));
 d.binding={propositions,fields,state:reasons.length?'INCOMPLETE_NEEDS_REVIEW':'COMPLETE',reviewReasons:reasons};return validatePropositionBindings(d);
}
