import {validateSourceProvenance,sourceEvidenceType} from './source-provenance.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicationReview } from './feed-quality.ts';
import type {Repository,SourceItem,Claim,Evidence,Audit,Usage,Review,HumanEvaluation } from './model.ts';
export class SqliteRepository implements Repository {
  db: DatabaseSync;testIsolation:boolean;
  constructor(path:string) {
    this.testIsolation=path===':memory:';
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),source_id TEXT NOT NULL REFERENCES sources(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usages(id INTEGER PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_version VALUES(2);
      CREATE TABLE IF NOT EXISTS publication_reviews(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_version VALUES(3);`);
  }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;} }
  read(table:string):any[] { return this.db.prepare(`SELECT payload FROM ${table}`).all().map((r:any)=>JSON.parse(r.payload)); }
  sources():SourceItem[]{return this.read('sources');} claims():Claim[]{return this.read('claims');} evidence():Evidence[]{return this.read('evidence');} audits():Audit[]{return this.read('audits');} usages():Usage[]{return this.read('usages');} reviews():Review[]{return this.read('reviews');}
  publicationReviews():PublicationReview[]{return this.read('publication_reviews');}
  savePublicationReview(r:PublicationReview){this.db.prepare('INSERT INTO publication_reviews VALUES(?,?)').run(r.id,JSON.stringify(r));}
  saveSource(s:SourceItem){if(s.raw.reviewerFixture===true&&!this.testIsolation)throw Error('Reviewer fixtures cannot enter operational repository');if(s.raw.discoveryFixture===true&&(!this.testIsolation||this.setting('discoveryTestOnly')!==true))throw Error('Discovery fixtures cannot enter operational repository');const previous=this.db.prepare('SELECT payload FROM sources WHERE id=?').get(s.id) as any;if(previous){const old=JSON.parse(previous.payload);s={...s,evidenceType:s.evidenceType??old.evidenceType,provenanceDescription:s.provenanceDescription??old.provenanceDescription};}validateSourceProvenance(s);this.db.prepare('INSERT INTO sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(s.id,JSON.stringify(s));}
  saveClaim(c:Claim){this.db.prepare('INSERT INTO claims VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(c.id,JSON.stringify(c));}
  saveEvidence(e:Evidence){const incomingSource=this.sources().find(s=>s.id===e.sourceId);const unchanged=this.evidence().find(x=>x.id===e.id&&JSON.stringify(x.candidate)===JSON.stringify(e.candidate)&&x.claimId===e.claimId&&x.sourceId===e.sourceId);if(!this.testIsolation&&!unchanged&&incomingSource&&incomingSource.platform!=='fixture'&&(incomingSource.raw.discoveryEnabled===true||!!e.candidate.discovery||!['OFFICIAL','OFFICIAL_FOOTAGE'].includes(sourceEvidenceType(incomingSource)))){const approved=this.communityRecords('reviewerCandidates').find(c=>c.source.id===e.sourceId&&c.humanApproval?.evidenceId===e.id&&c.humanApproval?.claimId===e.claimId&&['APPROVED','EDITED_AND_APPROVED'].includes(c.state));const actor=this.communityRecords('profiles').find(p=>p.id===approved?.humanApproval?.actor);if(!approved||actor?.role!=='moderator'||actor.suspended||actor.accountOrigin!=='ORGANIC')throw Error('Community evidence requires explicit Reviewer Desk human approval');}const previous=this.db.prepare('SELECT payload FROM evidence WHERE id=?').get(e.id) as any,old=previous?JSON.parse(previous.payload):null,source=this.sources().find(s=>s.id===e.sourceId);e={...e,sourceEvidenceType:e.sourceEvidenceType??(old?.sourceId===e.sourceId?old.sourceEvidenceType:null)??(source&&sourceEvidenceType(source)!=='UNKNOWN'?sourceEvidenceType(source):undefined),sourceProvenanceDescription:e.sourceProvenanceDescription??(old?.sourceId===e.sourceId?old.sourceProvenanceDescription:null)??source?.provenanceDescription};this.db.prepare('INSERT INTO evidence VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET claim_id=excluded.claim_id,payload=excluded.payload').run(e.id,e.claimId,e.sourceId,JSON.stringify(e));}
  removeSourceEvidence(sourceId:string){
    const ids=this.evidence().filter(e=>e.sourceId===sourceId).map(e=>e.claimId);
    this.db.prepare('DELETE FROM evidence WHERE source_id=?').run(sourceId);
    for(const id of ids)if(!this.evidence().some(e=>e.claimId===id)){
      this.db.prepare("DELETE FROM reviews WHERE json_extract(payload,'$.claimId')=? OR json_extract(payload,'$.fromClaimId')=?").run(id,id);
      this.db.prepare('DELETE FROM claims WHERE id=?').run(id);
    }
  }
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
  communityRecords(kind:string){return this.db.prepare('SELECT payload FROM community_records WHERE kind=?').all(kind).map((r:any)=>JSON.parse(r.payload));}
  saveCommunityRecord(kind:string,id:string,payload:any){if(kind==='reviewerCandidates'&&payload.fixture===true&&!this.testIsolation)throw Error('Reviewer fixtures require an isolated memory repository');if(kind==='reviewerAudit'&&this.db.prepare('SELECT 1 FROM community_records WHERE kind=? AND id=?').get(kind,id))throw Error('Reviewer audit is append-only');if(kind==='discoveries'&&payload.testOnly&&(!this.testIsolation||this.setting('discoveryTestOnly')!==true))throw Error('Discovery fixtures cannot enter operational repository');if(kind==='profiles'){const row=this.db.prepare('SELECT payload FROM community_records WHERE kind=? AND id=?').get(kind,id) as any;const old=row?JSON.parse(row.payload):null;const origin=payload.accountOrigin??old?.accountOrigin??'ORGANIC';if(!['SEEDED','ORGANIC'].includes(origin)||(old?.accountOrigin&&origin!==old.accountOrigin))throw Error('Account origin is immutable');payload={...payload,accountOrigin:origin};}this.db.prepare('INSERT INTO community_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind,id,JSON.stringify(payload));}
  close(){this.db.close();}
}
