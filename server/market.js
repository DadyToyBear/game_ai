// The market belongs to a single saved world. Stock and demand are finite, and
// trade is settled atomically against a server-side quote, never a client price.
const round = n => Math.round(n * 10) / 10;
const limit = (n, min, max) => Math.max(min, Math.min(max, n));
export function initialMarket() {
  return { grainStock: 100, woodDemand: 100, grainPrice: 2, woodPrice: 2, history: [{ day:1, grainPrice:2, woodPrice:2 }], trades: [] };
}
export function refreshMarket(w, restock = false) {
  const m = w.market;
  if (restock && w.day % 5 === 0) { m.grainStock = Math.min(100, m.grainStock + 20); m.woodDemand = Math.min(100, m.woodDemand + 25); }
  const year = Math.floor((w.day - 1) / 40), period = Math.floor((w.day - 1) / 10) % 4;
  const drought = w.weather.droughtYear === year;
  m.grainPrice = limit(2 + (w.grain < 80 ? 1 : 0) + (drought ? 1 : 0) + (m.grainStock < 30 ? 1 : 0) + (period === 3 ? 1 : 0), 2, 6);
  m.woodPrice = m.woodDemand >= 60 ? 2 : 1;
  const quote = { day: w.day, grainPrice: m.grainPrice, woodPrice: m.woodPrice };
  if (m.history.at(-1)?.day === w.day) m.history[m.history.length - 1] = quote;
  else m.history.push(quote);
  m.history = m.history.slice(-30);
}
export function trade(w, direction, amount, expectedPrice, log) {
  if (direction !== 'buy_grain' && direction !== 'sell_wood') return { ok:false, code:'invalid', message:'Неизвестный вид сделки.' };
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100) return { ok:false, code:'invalid', message:'Укажите целое количество от 1 до 100.' };
  if (!Number.isSafeInteger(expectedPrice) || expectedPrice < 1) return { ok:false, code:'invalid', message:'Не указана действующая цена.' };
  const m = w.market, price = direction === 'buy_grain' ? m.grainPrice : m.woodPrice;
  if (expectedPrice !== price) return { ok:false, code:'stale', message:'Цена изменилась. Проверьте новое предложение и подтвердите сделку ещё раз.' };
  const total = amount * price;
  if (direction === 'buy_grain') {
    if (m.grainStock < amount) return { ok:false, code:'stock', message:'У купцов не хватает зерна для этой сделки.' };
    if (w.gold < total) return { ok:false, code:'funds', message:'В казне недостаточно золота.' };
    if (round(w.grain + amount) > w.grainCapacity) return { ok:false, code:'capacity', message:'В амбаре не хватает места для всей покупки.' };
  } else {
    if (w.wood < amount) return { ok:false, code:'stock', message:'На складе не хватает древесины.' };
    if (m.woodDemand < amount) return { ok:false, code:'demand', message:'Купцы пока не готовы купить столько древесины.' };
  }
  // All checks have passed: no partial deals or negative balances.
  if (direction === 'buy_grain') { w.gold -= total; w.grain = round(w.grain + amount); m.grainStock -= amount; }
  else { w.wood = round(w.wood - amount); w.gold += total; m.woodDemand -= amount; }
  const record = { id: `${w.day}-${Date.now()}-${Math.random().toString(36).slice(2)}`, day:w.day, direction, amount, unitPrice:price, total };
  m.trades.unshift(record); m.trades = m.trades.slice(0, 20);
  log(w, direction === 'buy_grain' ? `Казначей купил ${amount} мешков зерна за ${total} монет.` : `Казначей продал ${amount} брёвен за ${total} монет.`, 'good');
  refreshMarket(w);
  return { ok:true, record };
}
export function treasurerAdvice(w) {
  const m = w.market, room = Math.floor(Math.max(0, w.grainCapacity - w.grain));
  if (w.grain < 60) {
    if (room > 0 && m.grainStock > 0 && w.gold >= m.grainPrice) return { level:'warn', text:`Зерна мало. Купцы продают его по ${m.grainPrice} монет за мешок; советую пополнить запасы.` };
    if (w.gold < m.grainPrice && w.wood >= 1 && m.woodDemand >= 1) return { level:'warn', text:'Зерна и золота мало. Можно продать древесину, чтобы собрать деньги на продовольствие.' };
    return { level:'warn', text:'Запасы зерна на исходе, но сейчас покупка затруднена. Проверьте казну и предложение купцов.' };
  }
  if (room < 10) return { level:'info', text:'Амбар почти полон. Перед покупкой зерна убедитесь, что для него есть место.' };
  if (w.gold < 20 && w.wood >= 10) return { level:'warn', text:`Казна почти пуста. Можно продать древесину по ${m.woodPrice} монет за бревно.` };
  if (w.threat?.kind === 'drought') return { level:'warn', text:`Засуха может уменьшить урожай; цена зерна сейчас ${m.grainPrice} монет за мешок.` };
  if (m.grainStock < 20) return { level:'info', text:'У купцов мало зерна. Их запасы пополняются каждые пять дней.' };
  return { level:'good', text:`Запасы и казна в порядке. Зерно стоит ${m.grainPrice} монет, древесину принимают по ${m.woodPrice}.` };
}
