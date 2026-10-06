// Synthetic gate controls only. Never ingest into an operational source database.
import type {Claim,Evidence,SourceItem} from './model.ts';
import type {PublicationState} from './feed-quality.ts';
export const controlNow='2026-10-04T12:00:00.000Z';
export type FeedControl={id:string;synthetic:true;expected:PublicationState;claim:Claim;sources:SourceItem[];evidence:Evidence[]};
function control(id:string,category:string,text:string,entities:string[],conditions:Record<string,string>,values:Claim['values']=[],count=2,expected:PublicationState='PUBLISHABLE',stance:Evidence['stance']='supports'):FeedControl{
 const claim:Claim={id:'control:'+id,category,claim:text,predicate:category==='vehicle'?'vehicle_spawn':id,entities,conditions,values,firstDetected:controlNow,status:count===1?'UNVERIFIED':'DEVELOPING',confidence:count===1?38:55,evidenceCount:count,lastCorroborated:controlNow,breakdown:{independentSupporting:stance==='supports'?count:0,independentContradicting:0},review:null};
 const sources:SourceItem[]=Array.from({length:count},(_,i)=>({id:`synthetic:${id}:${i}`,platform:'fixture',sourceId:`${id}:${i}`,title:'GTA Online / GTA V synthetic positive or negative control',text:text+'\nIndependent synthetic report '+i,url:'https://example.invalid/synthetic/'+id+'/'+i,author:'synthetic-'+id+'-'+i,independenceKey:'synthetic-'+id+'-'+i,timestamp:controlNow,ingestedAt:controlNow,engagement:{score:0},raw:{synthetic:true}}));
 const evidence:Evidence[]=sources.map((s,i)=>({id:`control-e:${id}:${i}`,claimId:claim.id,sourceId:s.id,stance,candidate:{category,claim:text,predicate:claim.predicate,entities,conditions,values,stance,quote:text},match:{kind:'new'},createdAt:controlNow}));
 return {id,synthetic:true,expected,claim,sources,evidence};
}
const money={name:'earnings',value:400000,unit:'GTA$',currency:'GTA$' as const,measurement:'earnings_rate',timeBasis:'hour',activityBasis:'mission x',conditions:{}};
export const positiveControls:FeedControl[]=[
 control('money_observation','money','I earned GTA$400000 in one hour from Mission X while playing solo.',['Mission X'],{game:'GTA Online',activity:'Mission X',players:'solo'},[money],1),
 control('vehicle_location','vehicle','A Sultan spawns at the prison parking lot at night in story mode.',['Sultan','prison parking lot'],{game:'GTA V',location:'prison parking lot',time:'night',mode:'story mode'}),
 control('reproducible_bug','bug','Opening the map freezes the Mission X planning board on PC patch 1.72. Reproduced twice.',['Mission X','planning board'],{game:'GTA Online',trigger:'opening the map',platform:'PC',version:'1.72'}),
 control('working_workaround','workaround','Switching to invite-only fixed the frozen planning board on PC patch 1.72.',['planning board'],{game:'GTA Online',problem:'frozen planning board',action:'switching to invite-only',platform:'PC',version:'1.72'}),
 control('gameplay_change','game_update','Patch 1.72 changed the Mission X payout to GTA$200000 per mission.',['Mission X'],{game:'GTA Online',version:'1.72',activity:'Mission X'},[{name:'payout',value:200000,unit:'GTA$',currency:'GTA$',measurement:'payout',timeBasis:'per_mission',activityBasis:'mission x',conditions:{}}]),
 control('uncertain_discovery','discovery','I observed a door glowing at night in the tunnel; it may be an Easter egg.',['glowing door','tunnel'],{game:'GTA Online',location:'tunnel',time:'night'},[],2,'PUBLISHABLE','uncertain')
];
export const negativeControls:FeedControl[]=[
 control('promotional_guide','money','BEST MONEY METHOD!!! This guide shows you how to get rich.',['money guide'],{game:'GTA Online'},[],1,'NOT_ELIGIBLE'),
 control('vague_recommendation','money','Auto Shops are good for money.',['Auto Shop'],{game:'GTA Online'},[],1,'NOT_ELIGIBLE'),
 {...structuredClone(positiveControls[0]),id:'unsupported_best',expected:'NOT_ELIGIBLE',claim:{...positiveControls[0].claim,claim:'Mission X is the best GTA Online money method.'}},
 control('stale_exploit','glitch','Switching to story mode replays Mission X on PC patch 1.72.',['Mission X'],{game:'GTA Online',activity:'Mission X',steps:'switching to story mode',platform:'PC',version:'1.72'},[],2,'NEEDS_MORE_EVIDENCE'),
 {...structuredClone(positiveControls[0]),id:'contradictory_claim',expected:'NEEDS_MORE_EVIDENCE'},
 control('incomplete_amount','money','I earned GTA$400000 from Mission X solo.',['Mission X'],{game:'GTA Online',activity:'Mission X',players:'solo'},[{...money,timeBasis:'unknown'}],1,'NEEDS_MORE_EVIDENCE'),
 control('question_only','vehicle','Where can I find a Sultan?',['Sultan'],{game:'GTA V'},[],1,'NOT_ELIGIBLE')
];
negativeControls.find(c=>c.id==='stale_exploit')!.sources.forEach(s=>s.timestamp='2026-08-01T12:00:00.000Z');
const contradicted=negativeControls.find(c=>c.id==='contradictory_claim')!;
contradicted.sources.push({...contradicted.sources[0],id:'synthetic:contradiction',author:'independent-against',independenceKey:'independent-against',text:'Mission X did not pay the reported amount.'});
contradicted.evidence.push({...contradicted.evidence[0],id:'against',sourceId:'synthetic:contradiction',stance:'contradicts',candidate:{...contradicted.evidence[0].candidate,quote:'Mission X did not pay the reported amount.',stance:'contradicts'}});
