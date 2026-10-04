export const categories = ['money','vehicle','mission','location','weapon','business','strategy','bug','workaround','easter_egg','discovery','other'];
export type Stance = 'supports' | 'contradicts' | 'uncertain';
export type ConversationContext = { subreddit:string; postId:string; postTitle:string; postBody:string; parentId:string; parentText?:string; threadId:string; discovery:string[]; coverage?:string };
export type SourceItem = { id: string; platform: string; sourceId: string; url: string; author: string | null; title: string; text: string; timestamp: string; engagement: { score: number }; ingestedAt: string; raw: Record<string, unknown>; independenceKey: string; copiedFrom?: string; itemType?:'post'|'comment'; context?:ConversationContext; pilotId?:string; firstDetectedAt?:string; processingStartedAt?:string; processedAt?:string; processingDurationMs?:number; detectionLatencyMs?:number };
export type Candidate = { category: string; claim: string; predicate: string; entities: string[]; conditions: Record<string,string>; values: { name: string; value: number; unit: string }[]; stance: Stance; quote: string };
export type Extraction = { kind: 'NO_INTEL'; reason: string } | { kind: 'INTEL'; candidates: Candidate[] };
export type Claim = { id: string; category: string; claim: string; predicate: string; entities: string[]; conditions: Record<string,string>; values: Candidate['values']; firstDetected: string; createdAt?:string; lastCorroborated: string | null; status: string; confidence: number; evidenceCount: number; breakdown: Record<string,unknown>; review: string | null };
export type Evidence = { id: string; claimId: string; sourceId: string; stance: Stance; candidate: Candidate; match: Record<string,unknown>; createdAt: string };
export type Usage = { stage: string; provider: string; model: string; inputTokens: number | null; outputTokens: number | null; estimatedCost: number | null; error?: string; id?:string; sourceId?:string; pilotId?:string; at?:string; status?:'pending'|'complete'|'error'; reservedCost?:number };
export type Audit = { sourceId: string; stage: string; result: unknown; at: string };
export type Review = { id: string; claimId: string; decision: string; note: string; at: string; evidenceId?: string; fromClaimId?: string };
export type HumanEvaluation = { id:string;sourceId:string;reviewer:string;useful:'YES'|'NO'|'UNCERTAIN';category:string|null;extractionQuality:'correct'|'partially correct'|'incorrect'|null;matching:'correctly matched existing claim'|'should have created new claim'|'incorrectly merged'|'correctly created new claim'|null;usefulness:number|null;showToPlayer:'YES'|'NO';notes:string;at:string; claimIds:string[] };
export interface Repository { sources(): SourceItem[]; claims(): Claim[]; evidence(): Evidence[]; audits(): Audit[]; usages(): Usage[]; reviews(): Review[]; evaluations():HumanEvaluation[]; saveEvaluation(e:HumanEvaluation):void; setting(key:string):unknown; setSetting(key:string,value:unknown):void; resetPilot(pilotId:string):void; saveSource(s: SourceItem): void; saveClaim(c: Claim): void; saveEvidence(e: Evidence): void; audit(a: Audit): void; usage(u: Usage): void; review(r: Review): void; transaction<T>(fn:()=>T):T; close(): void }
export const extractionSchema = { type: 'object', additionalProperties: false, required: ['kind','reason','candidates'], properties: { kind: { type:'string',enum:['INTEL','NO_INTEL'] }, reason:{type:'string'}, candidates:{type:'array',items:{type:'object',additionalProperties:false,required:['category','claim','predicate','entities','conditions','values','stance','quote'],properties:{ category:{type:'string'},claim:{type:'string'},predicate:{type:'string'},entities:{type:'array',items:{type:'string'}},conditions:{type:'array',items:{type:'object',additionalProperties:false,required:['key','value'],properties:{key:{type:'string'},value:{type:'string'}}}},values:{type:'array',items:{type:'object',additionalProperties:false,required:['name','value','unit'],properties:{name:{type:'string'},value:{type:'number'},unit:{type:'string'}}}},stance:{type:'string',enum:['supports','contradicts','uncertain']},quote:{type:'string'}}}}} };
function object(v: unknown): v is Record<string,any> { return !!v && typeof v==='object' && !Array.isArray(v); }
function keys(v: Record<string,any>, allowed: string[]) { if(Object.keys(v).some(k=>!allowed.includes(k))) throw Error('Unexpected schema field'); }
export function validateExtraction(value: unknown, sourceText: string): Extraction {
  if(!object(value)) throw Error('Extraction must be an object');
  keys(value,['kind','reason','candidates']);
  if(value.kind==='NO_INTEL' && typeof value.reason==='string' && (!value.candidates || (Array.isArray(value.candidates)&&value.candidates.length===0))) return {kind:'NO_INTEL',reason:value.reason};
  if(value.kind!=='INTEL'||!Array.isArray(value.candidates)||value.candidates.length<1||value.candidates.length>10) throw Error('Invalid extraction envelope');
  const candidates=value.candidates.map((c:any)=>{
    if(!object(c)) throw Error('Invalid candidate');
    keys(c,['category','claim','predicate','entities','conditions','values','stance','quote']);
    for(const key of ['category','claim','predicate','quote']) if(typeof c[key]!=='string'||!c[key].trim()||c[key].length>2000) throw Error('Invalid '+key);
    if(!Array.isArray(c.entities)||!c.entities.length||c.entities.some((e:any)=>typeof e!=='string'||!e.trim())) throw Error('Invalid entities');
    if(!['supports','contradicts','uncertain'].includes(c.stance)) throw Error('Invalid stance');
    let conditions=c.conditions;
    if(Array.isArray(conditions)) { for(const pair of conditions) { if(!object(pair)||typeof pair.key!=='string'||typeof pair.value!=='string') throw Error('Invalid condition'); keys(pair,['key','value']); } conditions=Object.fromEntries(conditions.map((p:any)=>[p.key,p.value])); }
    if(!object(conditions)||Object.values(conditions).some(v=>typeof v!=='string')) throw Error('Invalid conditions');
    if(!Array.isArray(c.values)||c.values.some((v:any)=>!object(v)||typeof v.name!=='string'||typeof v.unit!=='string'||typeof v.value!=='number'||!Number.isFinite(v.value)||Object.keys(v).some(k=>!['name','unit','value'].includes(k)))) throw Error('Invalid numerical values');
    if(!sourceText.includes(c.quote)) throw Error('Evidence quote is not present in source');
    return {...c,conditions} as Candidate;
  });
  return {kind:'INTEL',candidates};
}
