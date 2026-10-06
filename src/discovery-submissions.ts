import {extractDiscovery} from './discovery-extraction.ts';
import {assessDiscovery} from './discoveries.ts';
import type {SourceItem,Candidate} from './model.ts';
export function prepareDiscoverySubmission(input:any,at:string){
 const fields=['reward','method','requirements','repeatability','version','action','entity','steps'];const enabled=input.discoveryEnabled===true||input.discoveryEnabled==='true'||fields.some(k=>input[k])||/GTA\s*(?:VI|6)\b/i.test(input.title+' '+input.description);
 if(!enabled)return {description:input.description,discoveryDraft:null,followUps:[],enabled:false};
 const lines:string[]=[];for(const name of [...fields,'location','platform']){const value=input[name];if(value==null||value==='')continue;if(typeof value!=='string'||value.length>1000||/[\r\n]/.test(value)&&!['steps','method'].includes(name))throw Error('Invalid discovery submission field');if(name==='repeatability'&&!['UNKNOWN','ONE_TIME','REPEATABLE','CONDITIONAL','PATCHED','INCONSISTENT'].includes(value))throw Error('Invalid repeatability');if(name==='steps'){const steps=value.split('\n').map(s=>s.trim()).filter(Boolean);if(steps.length>20||steps.some(s=>s.length>500))throw Error('Invalid discovery steps');lines.push(...steps.map((s,i)=>(i+1)+'. '+s));}else lines.push(name[0].toUpperCase()+name.slice(1)+': '+value);}
 const description=input.description+(lines.length?'\n'+lines.join('\n'):'');if(description.length>6000)throw Error('Discovery report exceeds submission limit');
 const conditions={...input.conditions,game:/GTA\s*(?:VI|6)\b/i.test(input.title+' '+description)?'GTA VI':input.conditions?.game??'UNKNOWN'};
 const source:SourceItem={id:'pending',sourceId:'pending',platform:'informant',title:input.title,text:description,url:'https://vice-wire.invalid/pending',author:null,timestamp:input.observedAt,ingestedAt:at,engagement:{score:0},independenceKey:'pending',raw:{game:conditions.game,location:input.location,declaredConditions:conditions}};
 const candidate:Candidate={category:input.category,claim:input.description,predicate:'reported_discovery',entities:[input.entity??input.location??input.category],conditions,values:[],stance:'supports',quote:description};
 const discoveryDraft=extractDiscovery(candidate,source);return {description,discoveryDraft,followUps:discoveryDraft?assessDiscovery(discoveryDraft,at).followUps:[],enabled:true};
}
