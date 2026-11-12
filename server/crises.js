// Deterministic schedule makes disasters reproducible across reloads and tests.
// Only one event can be active; the next event is chosen on the first day of the schedule.
const round = n => Math.round(n * 10) / 10;
export function startScheduledCrisis(w, log) {
  if (w.threat) return;
  const year = Math.floor((w.day - 1) / 40), day = (w.day - 1) % 40 + 1;
  const kind = year % 3 === 0 && day === 14 ? 'drought' : year % 3 === 1 && day === 6 ? 'rats' : year % 3 === 2 && day === 14 ? 'fire' : null;
  if (!kind) return;
  w.threat = { kind, startDay: w.day, expiresDay: w.day + (kind === 'fire' ? 8 : kind === 'rats' ? 5 : 7), mitigated: false, progress: 0, lost: 0 };
  if (kind === 'drought') { w.weather.droughtYear = year; w.weather.irrigated = false; log(w, 'Засуха угрожает осеннему урожаю. Можно распорядиться полить поля за 10 брёвен.', 'warn'); }
  if (kind === 'rats') log(w, 'В амбаре завелись крысы. Укрепите амбар за 8 брёвен, чтобы сократить ежедневные потери зерна.', 'warn');
  if (kind === 'fire') log(w, 'В амбаре пожар! Каждый день горит зерно. Прикажите жителям тушить огонь.', 'warn');
}
export function applyCrisisAction(w, action, log) {
  const threat = w.threat;
  const kinds = { irrigate: 'drought', protect: 'rats', fight: 'fire' };
  if (!Object.hasOwn(kinds, action)) return { ok:false, message:'Неизвестное распоряжение.' };
  if (!threat || threat.kind !== kinds[action]) return { ok:false, message:'Сейчас нет бедствия, для которого подходит этот указ.' };
  if (threat.mitigated) return { ok:false, message:'Этот указ уже выполняется.' };
  const cost = action === 'irrigate' ? 10 : action === 'protect' ? 8 : 0;
  if (w.wood < cost) return { ok:false, message:`Недостаточно древесины: нужно ${cost} брёвен на складе.` };
  w.wood = round(w.wood - cost); threat.mitigated = true;
  if (action === 'irrigate') { w.weather.irrigated = true; log(w, 'Староста организовал полив: последствия засухи для урожая уменьшатся.', 'good'); }
  if (action === 'protect') log(w, 'Амбар укреплён: крысы унесут меньше зерна.', 'good');
  if (action === 'fight') log(w, 'Двое жителей направлены тушить пожар. Нужны четыре действия у амбара.', 'good');
  return { ok:true, message: action === 'irrigate' ? 'Поля будут политы, мой лорд.' : action === 'protect' ? 'Амбар укреплён, мой лорд.' : 'Люди спешат тушить пожар, мой лорд.' };
}
export function tickCrisis(w, log) {
  const threat = w.threat; if (!threat) return;
  if (threat.kind === 'fire' && threat.progress >= 4) {
    log(w, `Пожар потушен. Потеряно ${round(threat.lost)} мешков зерна.`, 'good'); w.threat = null; return;
  }
  if (w.day >= threat.expiresDay) {
    if (threat.kind === 'drought') log(w, 'Засуха закончилась. Её последствия скажутся при осеннем сборе.', 'info');
    if (threat.kind === 'rats') log(w, `Крысы исчезли. Потеряно ${round(threat.lost)} мешков зерна.`, 'info');
    if (threat.kind === 'fire') log(w, `Пожар погас, но зерно пострадало: потеряно ${round(threat.lost)} мешков.`, 'warn');
    w.threat = null; return;
  }
  if (threat.kind === 'rats' || threat.kind === 'fire') {
    const loss = Math.min(w.grain, threat.kind === 'rats' ? (threat.mitigated ? (w.improvements.ratProof ? 1 : 2) : (w.improvements.ratProof ? 3 : 10)) : 6);
    w.grain = round(w.grain - loss); threat.lost = round(threat.lost + loss);
  }
}
