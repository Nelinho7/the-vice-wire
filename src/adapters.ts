import { fixtures } from './fixtures.ts';
import type { SourceItem } from './model.ts';
import { RedditAdapter } from './reddit.ts';
export { RedditAdapter } from './reddit.ts';
export interface SourceAdapter { name:string; fetchItems():Promise<SourceItem[]> }
export class FixtureAdapter implements SourceAdapter {name='fixture';async fetchItems(){return fixtures.map(f=>structuredClone(f.source));}}
export function sourceAdapter():SourceAdapter {const mode=process.env.SOURCE_MODE??'fixture';if(mode==='fixture')return new FixtureAdapter();if(mode==='reddit')return new RedditAdapter();throw Error('Unknown SOURCE_MODE');}
