import { fixtures,fixtureNow } from './fixtures.ts';
import { FixtureAdapter } from './adapters.ts';
import { FixtureProvider } from './providers.ts';
import { SqliteRepository } from './store.ts';
import { runPipeline } from './pipeline.ts';
export async function evaluate() {
  const repo=new SqliteRepository(':memory:');
  try {
    const summary=await runPipeline(repo,new FixtureAdapter(),new FixtureProvider(),fixtureNow);
    const evidence=repo.evidence();let tp=0,fp=0,fn=0,tn=0,pairTP=0,pairFP=0,pairFN=0,stances=0;
    for(const f of fixtures){const found=evidence.filter(e=>e.sourceId===f.source.id);if(f.label.useful){if(found.length)tp++;else fn++;}else{if(found.length)fp++;else tn++;}if(f.label.useful&&found[0]?.stance===f.label.stance)stances++;}
    for(let i=0;i<fixtures.length;i++)for(let j=i+1;j<fixtures.length;j++){
      const a=fixtures[i],b=fixtures[j];if(!a.label.useful||!b.label.useful)continue;
      const expected=a.label.group===b.label.group,ea=evidence.find(e=>e.sourceId===a.source.id),eb=evidence.find(e=>e.sourceId===b.source.id),actual=!!ea&&!!eb&&ea.claimId===eb.claimId;
      if(expected&&actual)pairTP++;if(!expected&&actual)pairFP++;if(expected&&!actual)pairFN++;
    }
    const ambiguity=fixtures.filter(f=>f.label.ambiguous).every(f=>evidence.find(e=>e.sourceId===f.source.id)?.match.kind==='ambiguous');
    return {warning:'Synthetic labeled replay tests pipeline mechanics, not live LLM extraction quality or GTA factual correctness.',...summary,quality:{filterPrecision:tp/(tp+fp||1),filterRecall:tp/(tp+fn||1),truePositives:tp,falsePositives:fp,falseNegatives:fn,trueNegatives:tn,dedupPairPrecision:pairTP/(pairTP+pairFP||1),dedupPairRecall:pairTP/(pairTP+pairFN||1),pairTP,pairFP,pairFN,stanceAccuracy:stances/fixtures.filter(f=>f.label.useful).length,ambiguityPreserved:ambiguity},fixtureTimestamp:fixtureNow};
  }finally{repo.close();}
}
