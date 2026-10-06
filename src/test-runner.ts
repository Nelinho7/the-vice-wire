import { mkdtempSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
// Test files share a temporary budget ledger; serialize files so pending mock calls cannot block unrelated tests.
// Mocked provider tests must never write usage into the real operational ledger.
const directory=mkdtempSync(join(tmpdir(),'vice-wire-tests-'));
try{
  const files=readdirSync('tests').filter(f=>f.endsWith('.test.ts')).map(f=>join('tests',f));
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',env:{...process.env,OPERATIONS_DB_PATH:join(directory,'operations.sqlite'),MONTHLY_AI_BUDGET_USD:'300',DAILY_AI_BUDGET_USD:'10',AI_RUN_BUDGET_USD:'0.25',TWITCH_CLIENT_ID:'',TWITCH_USER_ACCESS_TOKEN:'',TWITCH_CLIENT_SECRET:'',TWITCH_ACCESS_APPROVED:'false',OPENAI_API_KEY:'',YOUTUBE_API_KEY:'',YOUTUBE_ACCESS_TOKEN:'',SCHEDULER_ENABLED:'false'}});
  process.exitCode=result.status??1;
}finally{
  const target=resolve(directory),parent=resolve(tmpdir());
  if(resolve(join(target,'..'))===parent&&target.includes('vice-wire-tests-'))rmSync(target,{recursive:true,force:true});
}
