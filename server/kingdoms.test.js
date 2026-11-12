import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorld, advance, migrateWorld } from './simulation.js';
import { diplomacy, tickKingdoms } from './kingdoms.js';
import { hireGuard, tickDefense, marshalAdvice } from './defense.js';
import { improve, tickSpoilage, elderAdvice } from './improvements.js';
import { tickCrisis } from './crises.js';
const log=()=>{};

test('three neighbours have distinct identities and rule-based diplomacy', () => {
  const w=initialWorld();assert.deepEqual(w.kingdoms.map(k=>k.id),['ironmoor','wolfmark','sunvale']);
  const iron=w.kingdoms[0];assert.equal(diplomacy(w,'bad','peace',log).ok,false);
  assert.equal(diplomacy(w,'ironmoor','trade_pact',log).ok,false);
  assert.equal(diplomacy(w,'ironmoor','peace',log).ok,true);assert.equal(iron.relation,40);
  assert.equal(diplomacy(w,'ironmoor','peace',log).ok,false);
  const r=diplomacy(w,'ironmoor','trade_pact',log);assert.equal(r.accepted,false);assert.equal(iron.tradePact,false);
  const gold=w.gold,otherGold=iron.gold;assert.equal(diplomacy(w,'ironmoor','gift',log).ok,true);assert.equal(w.gold,gold-10);assert.equal(iron.gold,otherGold+10);
  assert.equal(diplomacy(w,'ironmoor','trade_pact',log).accepted,true);assert.equal(iron.tradePact,true);
});
test('diplomatic trades transfer resources between both parties and reject impossible deals atomically', () => {
  const w=initialWorld(), k=w.kingdoms[2];diplomacy(w,k.id,'peace',log);diplomacy(w,k.id,'trade_pact',log);
  const initial={grain:w.grain,gold:w.gold,otherGrain:k.grain,otherGold:k.gold,wood:w.wood,otherWood:k.wood};
  assert.equal(diplomacy(w,k.id,'buy_grain',log).ok,true);assert.equal(w.grain,initial.grain+10);assert.equal(w.gold,initial.gold-20);assert.equal(k.grain,initial.otherGrain-10);assert.equal(k.gold,initial.otherGold+20);
  assert.equal(diplomacy(w,k.id,'sell_wood',log).ok,true);assert.equal(w.wood,initial.wood-10);assert.equal(k.wood,initial.otherWood+10);assert.equal(w.gold,initial.gold);assert.equal(k.gold,initial.otherGold);
  w.grain=w.grainCapacity-1;const snap=structuredClone(w);assert.equal(diplomacy(w,k.id,'buy_grain',log).ok,false);assert.deepEqual(w,snap);
  w.wood=0;const snap2=structuredClone(w);assert.equal(diplomacy(w,k.id,'sell_wood',log).ok,false);assert.deepEqual(w,snap2);
  w.wood=10;k.gold=0;assert.equal(diplomacy(w,k.id,'sell_wood',log).ok,false);
});
test('neighbour supplies recover without deleting resources above the replenishment cap', () => {
  const w=initialWorld();w.day=5;w.kingdoms[0].gold=250;w.kingdoms[0].wood=220;w.kingdoms[0].grain=350;tickKingdoms(w);
  assert.equal(w.kingdoms[0].gold,250);assert.equal(w.kingdoms[0].wood,220);assert.equal(w.kingdoms[0].grain,350);
  assert.equal(w.kingdoms[1].grain,128);
});
test('guard costs, cap and raid warning lead to deterministic victory', () => {
  const w=initialWorld();for(let i=0;i<3;i++)assert.equal(hireGuard(w,log).ok,true);assert.equal(w.gold,56);
  w.day=26;tickDefense(w,log);assert.equal(w.defense.raid.strength,5);assert.equal(w.defense.raid.attackDay,29);assert.match(marshalAdvice(w).text,/3 дн/);
  const grain=w.grain,wood=w.wood;w.day=28;tickDefense(w,log);assert.ok(w.defense.raid);w.day=29;tickDefense(w,log);
  assert.equal(w.defense.raid,null);assert.equal(w.grain,grain);assert.equal(w.wood,wood);assert.match(w.defense.lastResult,/отразила/);
  for(let i=0;i<3;i++)hireGuard(w,log);const before=w.gold;assert.equal(hireGuard(w,log).ok,false);assert.equal(w.gold,before);
});
test('undefended raid cannot take more than stored resources and persists warning', () => {
  const w=initialWorld();w.grain=5;w.wood=3;w.day=26;tickDefense(w,log);
  const saved=migrateWorld(JSON.parse(JSON.stringify(w)));assert.equal(saved.defense.raid.attackDay,29);
  saved.day=29;tickDefense(saved,log);assert.equal(saved.grain,0);assert.equal(saved.wood,0);assert.match(saved.defense.lastResult,/5 зерна и 3 древесины/);
  const broke=initialWorld();broke.gold=0;assert.equal(hireGuard(broke,log).ok,false);assert.equal(broke.defense.guards,0);
});
test('upgrades cost finite resources once and actually affect rats and summer spoilage', () => {
  const base=initialWorld(), improved=structuredClone(base);const before={wood:improved.wood,gold:improved.gold};
  assert.equal(improve(improved,'ratProof',log).ok,true);assert.equal(improved.wood,before.wood-20);assert.equal(improved.gold,before.gold-10);
  const snap=structuredClone(improved);assert.equal(improve(improved,'ratProof',log).ok,false);assert.deepEqual(improved,snap);
  for(const w of [base,improved])w.threat={kind:'rats',startDay:46,expiresDay:51,mitigated:false,progress:0,lost:0};
  tickCrisis(base,log);tickCrisis(improved,log);assert.equal(base.threat.lost,10);assert.equal(improved.threat.lost,3);
  const noCellar=initialWorld(),cellar=initialWorld();assert.equal(improve(cellar,'cellar',log).ok,true);noCellar.day=15;cellar.day=15;tickSpoilage(noCellar,log);tickSpoilage(cellar,log);assert.equal(noCellar.grain,280);assert.equal(cellar.grain,283);
  const poor=initialWorld();poor.gold=0;const original=structuredClone(poor);assert.equal(improve(poor,'infirmary',log).ok,false);assert.deepEqual(poor,original);assert.equal(improve(poor,'fake',log).ok,false);
});
test('infirmary improves rest and advisors follow the real world', () => {
  const a=initialWorld(),b=structuredClone(a);improve(b,'infirmary',log);
  for(const w of [a,b]){const v=w.villagers[0];v.x=4;v.y=2;v.energy=10;v.hunger=0;}
  advance(a);advance(b);assert.equal(b.villagers[0].energy-a.villagers[0].energy,10);
  assert.match(elderAdvice(a).text,/без койки/);a.villagers[0].hunger=99;assert.match(elderAdvice(a).text,/голодают/);assert.match(marshalAdvice(a).text,/Стражи мало/);
});
test('version 6 migration preserves market and ongoing threats while adding systems', () => {
  const w=initialWorld();w.version=6;delete w.kingdoms;delete w.defense;delete w.improvements;w.grain=91;w.market.grainStock=33;w.threat={kind:'drought',startDay:14,expiresDay:21,mitigated:true,progress:0,lost:0};
  const next=migrateWorld(JSON.parse(JSON.stringify(w)));assert.equal(next.version,7);assert.equal(next.grain,91);assert.equal(next.market.grainStock,33);assert.equal(next.threat.mitigated,true);assert.equal(next.kingdoms.length,3);assert.equal(next.defense.guards,0);assert.equal(next.improvements.cellar,false);advance(next);
});
