// Conservative typography equivalence only: no translation, stemming, or word removal.
function decode(s:string){return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{const named:any={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};if(key[0]!=='#')return named[key.toLowerCase()]??all;const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):all;});}
export function quoteForm(s:string){return decode(s).normalize('NFC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[–—]/g,'-').replace(/\uFE0F/g,'').replace(/\s+/gu,' ').trim();}
export function locateQuote(source:string,quote:string):{quote:string;start:number;end:number;method:string}|null {
  if(!quote.trim())return null;
  const direct=source.indexOf(quote);if(direct>=0)return {quote,start:direct,end:direct+quote.length,method:'exact'};
  // Keep original offsets while decoding entities and composing grapheme clusters.
  const segments=[...new Intl.Segmenter('und',{granularity:'grapheme'}).segment(source)];
  let normalized='',starts:number[]=[],ends:number[]=[];
  for(let i=0;i<segments.length;i++){
    const seg=segments[i];let raw=seg.segment,end=seg.index+raw.length;
    if(raw==='&'){const entity=source.slice(seg.index).match(/^&(?:#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/i);if(entity){raw=entity[0];end=seg.index+raw.length;while(i+1<segments.length&&segments[i+1].index<end)i++;}}
    const part=decode(raw).normalize('NFC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").replace(/[–—]/g,'-').replace(/\uFE0F/g,'').replace(/\s/gu,' ');
    for(const ch of part){if(ch===' '&&normalized.endsWith(' ')){ends[ends.length-1]=end;continue;}normalized+=ch;for(let j=0;j<ch.length;j++){starts.push(seg.index);ends.push(end);}}
  }
  const wanted=quoteForm(quote),at=normalized.indexOf(wanted);if(at<0||!wanted)return null;
  const start=starts[at],end=ends[at+wanted.length-1];return {quote:source.slice(start,end),start,end,method:'typography-equivalent'};
}
