// A local, deterministic diplomatic prototype. All decisions and resources live on the server.
const round = n => Math.round(n * 10) / 10;
export function initialKingdoms() {
  return [
    { id:'ironmoor', name:'Ironmoor', lord:'Лорд Торрен', temperament:'расчётливый', relation:30, grain:160, wood:110, gold:120, peaceful:false, tradePact:false, tradeThreshold:45, lastReply:'Железо и слово должны иметь цену.' },
    { id:'wolfmark', name:'Wolfmark', lord:'Леди Рагна', temperament:'воинственная', relation:20, grain:120, wood:100, gold:100, peaceful:false, tradePact:false, tradeThreshold:35, lastReply:'Сильное слово требует сильной стражи.' },
    { id:'sunvale', name:'Sunvale', lord:'Лорд Алден', temperament:'милосердный', relation:55, grain:220, wood:80, gold:130, peaceful:false, tradePact:false, tradeThreshold:30, lastReply:'Мир и торговля накормят наши земли.' },
  ];
}
export function tickKingdoms(w) {
  if (w.day % 5 !== 0) return;
  // Abstract local economy: finite resources recover slowly; no unimplemented population simulation.
  for (const k of w.kingdoms) { if (k.grain < 300) k.grain = Math.min(300, k.grain + 8); if (k.wood < 200) k.wood = Math.min(200, k.wood + 5); if (k.gold < 200) k.gold = Math.min(200, k.gold + 2); }
}
export function diplomacy(w, target, action, log) {
  const k = w.kingdoms.find(item => item.id === target);
  if (!k) return { ok:false, message:'Такого королевства не существует.' };
  if (!['peace','trade_pact','gift','buy_grain','sell_wood'].includes(action)) return { ok:false, message:'Неизвестное дипломатическое действие.' };
  if (action === 'peace') {
    if (k.peaceful) return { ok:false, message:'Мирный договор уже заключён.' };
    k.peaceful=true; k.relation=Math.min(100,k.relation+10); k.lastReply='Мы принимаем мир и надеемся на спокойные границы.';
    log(w,`Грейнхолд заключил мир с ${k.name}.`,'good');
  } else if (action === 'trade_pact') {
    if (k.tradePact) return { ok:false, message:'Торговый договор уже действует.' };
    if (!k.peaceful) return { ok:false, message:'Сначала предложите мир.' };
    if (k.relation < k.tradeThreshold) { k.lastReply=`Нам нужно больше доверия: отношения не ниже ${k.tradeThreshold}.`; log(w,`${k.name} отклонил торговый договор: недостаточно доверия.`,'warn'); return { ok:true, accepted:false, message:k.lastReply }; }
    k.tradePact=true; k.lastReply='Наши купцы готовы к обмену.'; log(w,`С ${k.name} заключён торговый договор.`,'good');
  } else if (action === 'gift') {
    if (w.gold < 10) return { ok:false, message:'В казне нужно 10 монет для дара.' };
    if (k.relation >= 100) return { ok:false, message:'Отношения уже достигли максимума.' };
    w.gold-=10;k.gold+=10;k.relation=Math.min(100,k.relation+10);k.lastReply='Дар принят. Наши отношения стали теплее.';log(w,`Грейнхолд отправил дар в ${k.name}: 10 монет.`,'good');
  } else if (action === 'buy_grain') {
    if (!k.tradePact) return { ok:false, message:'Для обмена нужен торговый договор.' };
    if (k.grain < 10) return { ok:false, message:'У соседей недостаточно зерна.' };
    if (w.gold < 20) return { ok:false, message:'Для покупки нужно 20 монет.' };
    if (round(w.grain+10) > w.grainCapacity) return { ok:false, message:'В амбаре нет места для 10 мешков.' };
    w.gold-=20;k.gold+=20;k.grain-=10;w.grain=round(w.grain+10);k.relation=Math.min(100,k.relation+1); k.lastReply='Зерно доставлено по договору.';log(w,`Из ${k.name} куплено 10 мешков зерна за 20 монет.`,'good');
  } else {
    if (!k.tradePact) return { ok:false, message:'Для обмена нужен торговый договор.' };
    if (w.wood < 10) return { ok:false, message:'На складе нужно 10 брёвен.' };
    if (k.gold < 20) return { ok:false, message:'У соседей недостаточно золота.' };
    w.wood=round(w.wood-10);k.wood+=10;k.gold-=20;w.gold+=20;k.relation=Math.min(100,k.relation+1);k.lastReply='Древесина принята по договору.';log(w,`В ${k.name} продано 10 брёвен за 20 монет.`,'good');
  }
  return { ok:true, accepted:true, message:k.lastReply };
}
