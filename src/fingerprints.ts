import { createHash } from 'node:crypto';
import type { SourceItem } from './model.ts';
export function stable(value:any):string {
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
export function fingerprint(value:unknown){return createHash('sha256').update(stable(value)).digest('hex');}
export function contentFingerprint(s:SourceItem){return fingerprint({...s.raw.discoveryEnabled===true?{discoveryContext:{enabled:true,confirmation:s.raw.discoveryConfirmation??null,declaredResult:s.raw.declaredResult??null,declaredConditions:s.raw.declaredConditions??null,platform:s.raw.platform??null,version:s.raw.version??null,location:s.raw.location??null}}:{},title:s.title,text:s.text,itemType:s.itemType??'post',context:s.context?{postTitle:s.context.postTitle,postBody:s.context.postBody,parentText:s.context.parentText}:null});}
export function cacheKey(s:SourceItem,signature:string,stage:string){return 'ai-cache:'+fingerprint({signature,stage,content:contentFingerprint(s)});}
