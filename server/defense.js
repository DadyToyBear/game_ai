export function initialDefense() { return { guards:0, raid:null, lastResult:null }; }
export function hireGuard(w, log) {
  if (w.defense.guards >= 6) return { ok:false, message:'В отряде уже шесть стражников — предел прототипа.' };
  if (w.gold < 10) return { ok:false, message:'На наём стражника нужно 10 монет.' };
  w.gold-=10;w.defense.guards++;log(w,`Нанят стражник. В отряде ${w.defense.guards}.`,'good');
  return { ok:true, message:'Стражник нанят за 10 монет.' };
}
export function tickDefense(w, log) {
  const d=w.defense, dayOfYear=(w.day-1)%40+1, year=Math.floor((w.day-1)/40);
  if (!d.raid && dayOfYear===26) {
    d.raid={ strength:5+(year%3)*2, attackDay:w.day+3 };
    log(w,`Разведчики заметили разбойников: сила ${d.raid.strength}, нападение через три дня.`,'warn');
  }
  if (d.raid && w.day>=d.raid.attackDay) {
    const power=d.guards*2, repelled=power>=d.raid.strength;
    if (repelled) { d.lastResult=`Стража отразила набег: сила обороны ${power}.`; log(w,d.lastResult,'good'); }
    else {
      const grain=Math.min(w.grain,40), wood=Math.min(w.wood,20);
      w.grain=Math.round((w.grain-grain)*10)/10;w.wood=Math.round((w.wood-wood)*10)/10;
      d.lastResult=`Разбойники победили и унесли ${grain} зерна и ${wood} древесины.`;log(w,d.lastResult,'warn');
    }
    d.raid=null;
  }
}
export function marshalAdvice(w) {
  const d=w.defense;
  if (d.raid) return { level:'warn', text:`Разбойники атакуют через ${Math.max(0,d.raid.attackDay-w.day)} дн.; их сила ${d.raid.strength}, наша оборона ${d.guards*2}.` };
  if (d.guards<3) return { level:'warn', text:'Стражи мало. Ближайший набег может застать амбар врасплох; найм стоит 10 монет за человека.' };
  return { level:'good', text:`В дозоре ${d.guards} стражников, сила обороны ${d.guards*2}. Следите за донесениями разведчиков.` };
}
