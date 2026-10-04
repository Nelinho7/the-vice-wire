import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Repository,SourceItem,Claim,Evidence,Audit,Usage,Review,HumanEvaluation } from './model.ts';
export class SqliteRepository implements Repository {
  db: DatabaseSync;
  constructor(path:string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),source_id TEXT NOT NULL REFERENCES sources(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usages(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_version VALUES(2);`);
  }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;} }
  read(table:string):any[] { return this.db.prepare(`SELECT payload FROM ${table}`).all().map((r:any)=>JSON.parse(r.payload)); }
  sources():SourceItem[]{return this.read('sources');} claims():Claim[]{return this.read('claims');} evidence():Evidence[]{return this.read('evidence');} audits():Audit[]{return this.read('audits');} usages():Usage[]{return this.read('usages');} reviews():Review[]{return this.read('reviews');}
  saveSource(s:SourceItem){this.db.prepare('INSERT INTO sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(s.id,JSON.stringify(s));}
  saveClaim(c:Claim){this.db.prepare('INSERT INTO claims VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(c.id,JSON.stringify(c));}
  saveEvidence(e:Evidence){this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET claim_id=excluded.claim_id,payload=excluded.payload').run(e.id,e.claimId,e.sourceId,JSON.stringify(e));}
  audit(a:Audit){this.db.prepare('INSERT INTO audits(payload) VALUES(?)').run(JSON.stringify(a));}
  usage(u:Usage){if(u.id){const result=this.db.prepare("UPDATE usages SET payload=? WHERE json_extract(payload,'$.id')=?").run(JSON.stringify(u),u.id);if(result.changes)return;}this.db.prepare('INSERT INTO usages(payload) VALUES(?)').run(JSON.stringify(u));}
  review(r:Review){this.db.prepare('INSERT INTO reviews VALUES(?,?)').run(r.id,JSON.stringify(r));}
  evaluations():HumanEvaluation[]{return this.read('evaluations');}
  saveEvaluation(e:HumanEvaluation){this.db.prepare('INSERT INTO evaluations VALUES(?,?,?)').run(e.id,e.sourceId,JSON.stringify(e));}
  setting(key:string):unknown{const row:any=this.db.prepare('SELECT payload FROM settings WHERE key=?').get(key);return row?JSON.parse(row.payload):null;}
  setSetting(key:string,value:unknown){this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(value));}
  resetPilot(pilotId:string){
    this.transaction(()=>{
      const sources=this.sources().filter(s=>s.platform==='reddit'&&s.pilotId===pilotId),ids=new Set(sources.map(s=>s.id));
      const touched=new Set(this.evidence().filter(e=>ids.has(e.sourceId)).map(e=>e.claimId));
      for(const s of sources){this.db.prepare('DELETE FROM evaluations WHERE source_id=?').run(s.id);this.db.prepare('DELETE FROM evidence WHERE source_id=?').run(s.id);this.db.prepare("DELETE FROM audits WHERE json_extract(payload,'$.sourceId')=?").run(s.id);this.db.prepare("DELETE FROM usages WHERE json_extract(payload,'$.sourceId')=?").run(s.id);this.db.prepare('DELETE FROM sources WHERE id=?').run(s.id);}
      for(const id of touched)if(!this.evidence().some(e=>e.claimId===id)){this.db.prepare("DELETE FROM reviews WHERE json_extract(payload,'$.claimId')=? OR json_extract(payload,'$.fromClaimId')=?").run(id,id);this.db.prepare('DELETE FROM claims WHERE id=?').run(id);}
      this.db.prepare('DELETE FROM settings WHERE key=?').run('pilot:'+pilotId);
    });
  }
  close(){this.db.close();}
}
