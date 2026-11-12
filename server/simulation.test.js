import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorld, advance, applyOrders, migrateWorld, findPath, isWalkable, LOCATIONS, BARN_WOOD, BARN_CAPACITY } from './simulation.js';
import { askLord, templates } from './ai.js';

test('pathfinder routes around obstacles with cardinal steps', () => {
  const path = findPath(LOCATIONS.stockpile, LOCATIONS.site); assert.ok(path.length > 0);
  let prev = LOCATIONS.stockpile;
  for (const p of path) { assert.ok(isWalkable(...p)); assert.equal(Math.abs(p[0]-prev[0])+Math.abs(p[1]-prev[1]), 1); prev = p; }
  assert.deepEqual(prev, LOCATIONS.site); assert.deepEqual(findPath([0,0], LOCATIONS.site), []);
});
test('construction transports reserved wood, builds and expands capacity exactly once', () => {
  const w = initialWorld(), oldCapacity = w.grainCapacity, oldWood = w.wood;
  applyOrders(w, templates.barn, templates.barn.reply); assert.equal(w.barn.status,'building');
  advance(w); assert.equal(w.barn.delivered, 0); assert.equal(w.grainCapacity, oldCapacity);
  let sawCarrying = false;
  for (let i = 0; i < 150 && w.barn.status !== 'complete'; i++) { advance(w); if (w.villagers.some(v => v.carriedWood > 0)) sawCarrying = true; }
  assert.ok(sawCarrying); assert.equal(w.barn.delivered,BARN_WOOD); assert.equal(w.barn.status,'complete'); assert.equal(w.grainCapacity, oldCapacity+BARN_CAPACITY);
  assert.ok(w.wood >= oldWood-BARN_WOOD); applyOrders(w, templates.barn, templates.barn.reply); for(let i=0;i<10;i++) advance(w); assert.equal(w.grainCapacity,oldCapacity+BARN_CAPACITY);
});
test('no wood means no construction progress or created materials', () => {
  const w = initialWorld(); w.wood = 0; w.focus = 'farming'; applyOrders(w,templates.barn,templates.barn.reply);
  for(let i=0;i<20;i++) advance(w); assert.equal(w.barn.delivered,0); assert.equal(w.barn.progress,0); assert.equal(w.grainCapacity,320);
});
test('seasons consume seed, generate and harvest a finite crop within storage capacity', () => {
  const w = initialWorld(); w.focus = 'farming';
  for(let i=0;i<9;i++) advance(w); assert.ok(w.field.planted > 0); assert.ok(w.grain < 284);
  while(w.day<21) advance(w); assert.ok(w.field.harvestRemaining > 0 || w.field.harvested > 0);
  while(w.day<30) advance(w); assert.ok(w.field.harvested > 0); assert.ok(w.grain <= w.grainCapacity); assert.equal(w.field.harvestRemaining,0);
  const full = initialWorld(); full.day = 20; full.grain = full.grainCapacity; full.field.planted = 12; for(const v of full.villagers){v.x=6;v.y=5;v.hunger=0;v.energy=100;} advance(full); assert.ok(full.grain <= full.grainCapacity); assert.ok(full.events.some(e=>e.text.includes('Амбар полон')));
});
test('old saves migrate without losing resources or day', () => {
  const old = { day: 25, grain: 440, wood: 12, loyalty: 45, villagers: [{id:1,name:'Эдмунд',hunger:33,energy:67}] };
  const w = migrateWorld(old); assert.equal(w.day,25); assert.equal(w.grain,440); assert.equal(w.wood,12); assert.ok(w.grainCapacity>=440); assert.equal(w.villagers[0].hunger,33); assert.ok(w.villagers.every(v=>isWalkable(v.x,v.y))); assert.equal(w.barn.status,'available');
});
test('AI decisions are strictly validated before application', async () => {
  const w = initialWorld(); const mock = content => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
  const result = await askLord('Построй амбар',w,{key:'test',fetcher:mock(JSON.stringify({reply:'Хорошо',focus:'unchanged',ration:'unchanged',buildBarn:true}))});
  assert.equal(result.buildBarn,true); applyOrders(w,result,result.reply); assert.equal(w.barn.status,'building');
  await assert.rejects(askLord('Обмани',w,{key:'test',fetcher:mock(JSON.stringify({reply:'Да',focus:'farming',ration:'unchanged',gold:999999}))}));
  await assert.rejects(askLord('Привет',w,{key:'test',fetcher:mock('not json')}));
});

test('a home provides six beds after materials and construction work, with no duplicate beds', () => {
  const w = initialWorld(); assert.equal(w.villagers.filter(v=>v.homeId).length,6);
  const beforeMood = w.villagers[11].mood, beforeLoyalty = w.loyalty;
  advance(w); assert.ok(w.villagers[11].mood < beforeMood); assert.ok(w.loyalty < beforeLoyalty);
  applyOrders(w,templates.house,templates.house.reply); assert.equal(w.house.status,'building');
  assert.equal(w.villagers.filter(v=>v.homeId).length,6);
  for(let i=0;i<150 && w.house.status !== 'complete';i++) advance(w);
  assert.equal(w.house.status,'complete'); assert.equal(w.house.delivered,18); assert.equal(w.house.progress,5);
  assert.equal(w.villagers.filter(v=>v.homeId === 'new').length,6);
  applyOrders(w,templates.house,templates.house.reply); assert.equal(w.villagers.filter(v=>v.homeId === 'new').length,6);
});
test('housing makes rest more effective and concurrent blueprints are rejected', () => {
  const w=initialWorld(), housed=w.villagers[0], homeless=w.villagers[11];
  for(const v of [housed,homeless]) { v.x=4;v.y=2;v.energy=20;v.hunger=0; }
  advance(w); assert.ok(housed.energy > homeless.energy);
  applyOrders(w,templates.barn,templates.barn.reply); applyOrders(w,templates.house,templates.house.reply);
  assert.equal(w.house.status,'available'); assert.equal(w.barn.status,'building'); assert.match(w.reply,/завершить/);
});
test('skills, supported traits, and mood change actual work output', async () => {
  const {workFactor} = await import('./simulation.js');
  const w=initialWorld(), v=w.villagers[0];
  const weak={...v,trait:'Спокойный',mood:100}, strong={...weak,farmingSkill:10};
  assert.ok(workFactor(strong,strong.farmingSkill)>workFactor(weak,1));
  assert.ok(workFactor({...weak,trait:'Трудолюбивый'},5)>workFactor(weak,5));
  assert.ok(workFactor({...weak,mood:0},5)<workFactor(weak,5));
  const a=initialWorld(),b=initialWorld();
  for(const world of [a,b]) { world.day=11; world.focus='logging'; for(const p of world.villagers){p.role='Фермер'; p.x=4;p.y=2;p.energy=100;p.hunger=0;} world.villagers[0].x=2;world.villagers[0].y=3; }
  a.villagers[0].woodSkill=1;b.villagers[0].woodSkill=10; advance(a);advance(b);
  assert.ok(b.villagers[0].carriedLogs > a.villagers[0].carriedLogs);
});
test('logs reach stockpile only on delivery even after a focus change', () => {
  const w=initialWorld(); w.focus='balanced';
  for(const v of w.villagers){v.role='Фермер';v.hunger=0;v.energy=100;v.x=4;v.y=2;}
  const logger=w.villagers[2];logger.role='Дровосек';logger.x=2;logger.y=3;
  const before=w.wood;advance(w); assert.ok(logger.carriedLogs>0); assert.equal(w.wood,before);
  const amount=logger.carriedLogs;w.focus='farming';advance(w);
  assert.equal(logger.task,'deliveringLogs'); assert.equal(logger.carriedLogs,0); assert.equal(w.wood,Math.round((before+amount)*10)/10);
});
test('version 2 saves preserve ongoing construction, cargo, and field on migration', () => {
  const w=initialWorld(); w.version=2;delete w.house;delete w.villagers[0].carriedLogs; delete w.villagers[0].homeId;
  w.barn.status='building'; w.barn.delivered=12; w.villagers[0].carriedWood=6;w.field.planted=7;w.wood=40;
  const migrated=migrateWorld(w);assert.equal(migrated.version,7);assert.equal(migrated.barn.delivered,12);assert.equal(migrated.villagers[0].carriedWood,6);assert.equal(migrated.field.planted,7);assert.equal(migrated.wood,40);assert.equal(migrated.house.status,'available');assert.equal(migrated.villagers[0].homeId,'old');
});

test('drought has a finite response window and irrigation improves autumn yield once', () => {
  const dry = initialWorld(); dry.day=13; dry.field.planted=10; dry.field.care=0; dry.focus='logging';
  for (const v of dry.villagers) {v.hunger=0;v.energy=100;}
  const wet=structuredClone(dry);advance(dry);advance(wet);
  assert.equal(wet.threat.kind,'drought');const before=wet.wood;
  applyOrders(wet,templates.irrigate,templates.irrigate.reply);assert.equal(wet.wood,before-10);assert.equal(wet.weather.irrigated,true);
  applyOrders(wet,templates.irrigate,templates.irrigate.reply);assert.equal(wet.wood,before-10);assert.match(wet.reply,/уже/);
  while(dry.day<21)advance(dry);while(wet.day<21)advance(wet);
  assert.equal(dry.threat,null);assert.equal(wet.threat,null);assert.equal(dry.field.harvestRemaining,66);assert.equal(wet.field.harvestRemaining,102);
});
test('rats lose real grain each day and protection reduces losses, without negative wood', () => {
  const base=initialWorld();base.day=45;for(const v of base.villagers){v.hunger=0;v.energy=100;}
  const protectedWorld=structuredClone(base);advance(base);advance(protectedWorld);assert.equal(base.threat.kind,'rats');assert.equal(base.threat.lost,10);
  const before=protectedWorld.wood;applyOrders(protectedWorld,templates.protect,templates.protect.reply);assert.equal(protectedWorld.wood,before-8);
  advance(base);advance(protectedWorld);assert.equal(base.threat.lost,20);assert.equal(protectedWorld.threat.lost,12);
  const poor=initialWorld();poor.day=45;poor.wood=0;advance(poor);applyOrders(poor,templates.protect,templates.protect.reply);assert.equal(poor.wood,0);assert.equal(poor.threat.mitigated,false);assert.match(poor.reply,/Недостаточно/);
});
test('firefighters reach the granary, extinguish fire and avoid later losses', () => {
  const w=initialWorld();w.day=93;for(const v of w.villagers){v.hunger=0;v.energy=100;} for(const v of w.villagers.filter(v=>v.id===4||v.id===5)){v.x=4;v.y=4;}
  advance(w);assert.equal(w.threat.kind,'fire');assert.equal(w.threat.lost,6);
  applyOrders(w,templates.fight,templates.fight.reply);advance(w);assert.equal(w.threat.progress,2);advance(w);
  assert.equal(w.threat,null);assert.ok(w.events.some(e=>e.text.includes('Пожар потушен')));
  const grain=w.grain;applyOrders(w,templates.fight,templates.fight.reply);assert.match(w.reply,/нет бедствия/);assert.equal(w.grain,grain);
});
test('fire burns out after the deadline and never loses more grain than exists', () => {
  const w=initialWorld();w.day=93;w.grain=5;advance(w);assert.equal(w.grain,0);assert.equal(w.threat.lost,5);
  while(w.threat)advance(w);assert.ok(w.grain>=0);assert.ok(w.events.some(e=>e.text.includes('Пожар погас')));
});
test('friendships grow symmetrically only from sharing a task and tile', async () => {
  const {updateRelationships}=await import('./relations.js');const w=initialWorld();w.villagers=w.villagers.slice(0,3);
  const [a,b,c]=w.villagers;a.x=b.x=c.x=4;a.y=b.y=c.y=2;a.task=b.task='resting';c.task='farming';a.mood=b.mood=50;
  for(const day of [3,6,9,12]){w.day=day;updateRelationships(w,()=>{});}
  assert.equal(w.relationships.length,1);assert.deepEqual(w.relationships[0],{a:a.id,b:b.id,score:8});assert.equal(a.mood,51);assert.equal(b.mood,51);
  b.x=3;w.day=15;updateRelationships(w,()=>{});assert.equal(w.relationships[0].score,8);
});
test('version 4 migration preserves active projects and starts new systems safely', () => {
  const old=initialWorld();old.version=4;delete old.relationships;delete old.threat;delete old.weather;old.barn.status='building';old.barn.delivered=12;old.grain=220;
  const w=migrateWorld(old);assert.equal(w.version,7);assert.equal(w.barn.delivered,12);assert.equal(w.grain,220);assert.equal(w.threat,null);assert.deepEqual(w.relationships,[]);assert.equal(w.weather.droughtYear,null);advance(w);
});

test('active crisis and friendships survive save migration without replaying losses', () => {
  const w=initialWorld();w.day=45;advance(w);applyOrders(w,templates.protect,templates.protect.reply);w.relationships=[{a:1,b:2,score:8}];
  const saved=JSON.parse(JSON.stringify(w));const restored=migrateWorld(saved);
  assert.equal(restored.threat.kind,'rats');assert.equal(restored.threat.lost,10);assert.equal(restored.threat.mitigated,true);assert.deepEqual(restored.relationships,[{a:1,b:2,score:8}]);
  advance(restored);assert.equal(restored.threat.lost,12);
});

test('market purchase checks affordability, capacity and merchant stock atomically', async () => {
  const {trade}=await import('./market.js');const w=initialWorld();w.grain=100;w.gold=86;
  const log=()=>{};let r=trade(w,'buy_grain',10,w.market.grainPrice,log);
  assert.equal(r.ok,true);assert.equal(w.gold,66);assert.equal(w.grain,110);assert.equal(w.market.grainStock,90);assert.equal(w.market.trades[0].total,20);
  const before=structuredClone(w);r=trade(w,'buy_grain',100,w.market.grainPrice,log);assert.equal(r.ok,false);assert.deepEqual(w,before);
  w.grain=w.grainCapacity-5;const beforeFull=structuredClone(w);r=trade(w,'buy_grain',10,w.market.grainPrice,log);assert.equal(r.code,'capacity');assert.deepEqual(w,beforeFull);
  w.grain=0;w.gold=0;const broke=structuredClone(w);r=trade(w,'buy_grain',10,w.market.grainPrice,log);assert.equal(r.code,'funds');assert.deepEqual(w,broke);
});
test('wood sale pays treasury once, respects demand and does not sell carried logs', async () => {
  const {trade}=await import('./market.js');const w=initialWorld();w.wood=20;w.villagers[0].carriedLogs=50;
  const r=trade(w,'sell_wood',10,2,()=>{});assert.equal(r.ok,true);assert.equal(w.wood,10);assert.equal(w.gold,106);assert.equal(w.market.woodDemand,90);assert.equal(w.villagers[0].carriedLogs,50);
  const snapshot=structuredClone(w);assert.equal(trade(w,'sell_wood',11,2,()=>{}).code,'stock');assert.deepEqual(w,snapshot);
  w.wood=200;w.market.woodDemand=5;const snapshot2=structuredClone(w);assert.equal(trade(w,'sell_wood',6,2,()=>{}).code,'demand');assert.deepEqual(w,snapshot2);
});
test('market rejects invalid quantities and stale prices without mutation', async () => {
  const {trade}=await import('./market.js');const w=initialWorld(), snapshot=structuredClone(w);
  for(const amount of [-1,0,101,1.5,'10',null,NaN,Infinity]) assert.equal(trade(w,'buy_grain',amount,2,()=>{}).ok,false);
  assert.equal(trade(w,'buy_grain',10,999,()=>{}).code,'stale');assert.equal(trade(w,'not_real',10,2,()=>{}).code,'invalid');assert.deepEqual(w,snapshot);
});
test('market quotes respond to drought, scarcity and seasonal supply, restock and history are bounded', async () => {
  const {refreshMarket,trade}=await import('./market.js');const w=initialWorld();w.day=14;w.weather.droughtYear=0;w.grain=40;w.market.grainStock=20;refreshMarket(w);
  assert.equal(w.market.grainPrice,5);w.day=31;refreshMarket(w);assert.equal(w.market.grainPrice,6);
  w.market.woodDemand=10;refreshMarket(w);assert.equal(w.market.woodPrice,1);w.day=35;refreshMarket(w,true);assert.equal(w.market.woodDemand,35);assert.equal(w.market.grainStock,40);
  for(let i=0;i<35;i++){w.day++;refreshMarket(w);}assert.equal(w.market.history.length,30);
  const current=w.market.grainPrice;assert.equal(trade(w,'buy_grain',1,current-1,()=>{}).code,'stale');
});
test('treasurer advice reacts to low grain, empty treasury and full storage', async () => {
  const {treasurerAdvice}=await import('./market.js');const w=initialWorld();w.grain=25;assert.match(treasurerAdvice(w).text,/Зерна мало/);
  w.gold=0;assert.match(treasurerAdvice(w).text,/продать древесину/);w.grain=w.grainCapacity;assert.match(treasurerAdvice(w).text,/полон/);
});
test('version 5 migration adds market without changing active threat or previous state', () => {
  const old=initialWorld();old.version=5;delete old.market;old.grain=10;old.day=14;old.weather.droughtYear=0;old.threat={kind:'drought',startDay:14,expiresDay:21,mitigated:false,progress:0,lost:0};old.relationships=[{a:1,b:2,score:8}];
  const w=migrateWorld(JSON.parse(JSON.stringify(old)));assert.equal(w.version,7);assert.equal(w.grain,10);assert.equal(w.market.grainPrice,4);assert.equal(w.market.history[0].day,14);assert.equal(w.threat.kind,'drought');assert.equal(w.relationships[0].score,8);
});
