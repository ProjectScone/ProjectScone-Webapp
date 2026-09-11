import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRecallEntities,recallLaneLabels} from '../src/memory/recall-entities.ts';
const seed={entity_id:'ent:alice',key:'alice',label:'Alice',role:'seed',matched:'Alice'};
const fixture=()=>({entities:[seed,{entity_id:'ent:acme',key:'acme',label:'Acme',role:'neighbour',matched:'works_at'}],items:[{lanes:{vector:2,entity:1}}]});
test('entity-assisted recall preserves considered roles and per-passage ranks separately',()=>{
 assert.deepEqual(readRecallEntities(fixture(),true),fixture().entities);
 assert.deepEqual(recallLaneLabels({vector:2,text:3,entity:1}),['vector lane, rank 2','text lane, rank 3','entity lane, rank 1']);
 assert.deepEqual(readRecallEntities({entities:[],items:[]},true),[]);
 assert.equal(readRecallEntities({},false),undefined);
});
test('explicit entity recall requires acknowledged, bounded, distinct entity records',()=>{
 for(const value of [{},{entities:null},{entities:[seed,seed]}, {entities:[{...seed,role:'inferred'}]}, {entities:[{...seed,entity_id:'wrong'}]}, {entities:[{...seed,matched:''}]}, {entities:Array.from({length:13},(_,i)=>({...seed,entity_id:`ent:${i}`}))}, {entities:Array.from({length:5},(_,i)=>({...seed,entity_id:`ent:${i}`}))}])assert.throws(()=>readRecallEntities({...value,items:[]},true));
 assert.throws(()=>readRecallEntities({entities:[{...seed,role:'neighbour'}],items:[]},true));
});
test('entity rank must be finite positive and backed by considered entities',()=>{
 for(const rank of [0,-1,1.5,NaN,Infinity,'1'])assert.throws(()=>readRecallEntities({...fixture(),items:[{lanes:{entity:rank}}]},true));
 assert.throws(()=>readRecallEntities({entities:[],items:[{lanes:{entity:1}}]},true));
 assert.deepEqual(recallLaneLabels({vector:0,text:NaN,entity:-1}),[]);
 assert.deepEqual(recallLaneLabels(undefined),[]);
});
test('JSON role values must be exact strings without coercion',()=>{
 for(const role of [['seed'],['neighbour'],{role:'seed'},true])assert.throws(()=>readRecallEntities({entities:[seed,{...seed,entity_id:'ent:bob',role}],items:[]},true));
});
