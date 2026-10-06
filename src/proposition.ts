import type {Candidate,Claim} from './model.ts';
import {dimensions} from './semantics.ts';
import {fingerprint} from './fingerprints.ts';
const ignored=new Set('a an the is are was were be been of in on at to from for with and this that approximately roughly about gta online'.split(' '));
export function propositionTerms(c:Pick<Candidate,'claim'|'values'>){
 // Amounts can disagree about the same scoped metric. Actions, objects,
 // prerequisites and qualifiers remain part of the proposition.
 return [...new Set(c.claim.toLowerCase().replace(/\b\d[\d,.]*\s*(?:k|m|million|thousand)?\b/gi,' value ').replace(/\b(?:approximately|roughly|around|about)\b/g,'').match(/[\p{L}$]+/gu)??[])].filter(t=>!ignored.has(t));
}
export function claimFingerprint(c:Candidate|Claim){return fingerprint({category:c.category,entities:c.entities,predicate:c.predicate,proposition:propositionTerms(c),conditions:c.conditions,dimensions:c.values.map(dimensions).sort(),modifiers:c.rewardModifiers??[],observation:/\b(i|my|we|our|chat participants report)\b/i.test(c.claim)});}
