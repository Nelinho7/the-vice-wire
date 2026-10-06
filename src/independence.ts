import {communityFamily} from './community.ts';
import type {SourceItem} from './model.ts';
function reference(url:string){try{const u=new URL(url),article=u.pathname.match(/\/article\/([^/]+)/)?.[1];return /(^|\.)rockstargames\.com$/.test(u.hostname)&&article?'rockstar-article:'+article:u.origin+u.pathname.replace(/\/$/,'');}catch{return url;}}
export function sourceFamily(s:SourceItem,sources:SourceItem[]=[]):string{
 const community=communityFamily(s);if(community)return community;
 const visited=new Set<string>();let current=s;
 while(!visited.has(current.id)){
  visited.add(current.id);const upstream=current.raw.syndicationSource??current.raw.upstreamReference;
  if(typeof upstream!=='string'||!upstream)return current.independenceKey.startsWith('web:upstream:')?reference(current.independenceKey.slice(13)):current.independenceKey;
  const key=reference(upstream),parent=sources.find(p=>p.id!==current.id&&reference(p.url)===key);
  if(!parent)return key;current=parent;
 }
 return 'citation-cycle:'+sources.filter(s=>visited.has(s.id)).map(s=>reference(s.url)).sort().join('|');
}
export function sourceNetwork(s:SourceItem){return typeof s.raw.publicationNetwork==='string'?'network:'+s.raw.publicationNetwork:null;}
