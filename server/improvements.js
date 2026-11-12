const IMPROVEMENTS={
  ratProof:{wood:20,gold:10,name:'Защита амбара'},
  cellar:{wood:20,gold:15,name:'Погреб'},
  infirmary:{wood:15,gold:20,name:'Лазарет'},
};
export function initialImprovements() { return { ratProof:false, cellar:false, infirmary:false }; }
export function improve(w, kind, log) {
  if (!Object.hasOwn(IMPROVEMENTS, kind)) return { ok:false, message:'Неизвестное улучшение.' };
  const spec=IMPROVEMENTS[kind];
  if (w.improvements[kind]) return { ok:false, message:'Это улучшение уже выполнено.' };
  if (w.wood<spec.wood || w.gold<spec.gold) return { ok:false, message:`Нужно ${spec.wood} древесины и ${spec.gold} монет.` };
  w.wood=Math.round((w.wood-spec.wood)*10)/10;w.gold-=spec.gold;w.improvements[kind]=true;
  log(w,`${spec.name}: улучшение выполнено за ${spec.wood} древесины и ${spec.gold} монет.`,'good');
  return {ok:true,message:`Улучшение «${spec.name}» завершено.`};
}
export function tickSpoilage(w, log) {
  const day=(w.day-1)%40+1;
  if (day!==15 && day!==20) return;
  const lost=Math.min(w.grain,w.improvements.cellar?1:4);
  w.grain=Math.round((w.grain-lost)*10)/10;
  if (lost) log(w,`Летняя порча: потеряно ${lost} мешков зерна${w.improvements.cellar?' (погреб снизил потери)':''}.`,'warn');
}
export function elderAdvice(w) {
  const unhoused=w.villagers.filter(v=>!v.homeId).length, hungry=w.villagers.filter(v=>v.hunger>=75).length;
  if (hungry) return {level:'warn',text:`${hungry} жителей голодают. Проследите за запасами и пайком.`};
  if (unhoused) return {level:'warn',text:`${unhoused} жителей без койки; новый дом улучшит их отдых и настроение.`};
  const tired=w.villagers.filter(v=>v.energy<30).length;
  if (tired) return {level:'info',text:`${tired} жителей устали. Они самостоятельно отправятся отдыхать.`};
  return {level:'good',text:'Народ сыт и обеспечен жильём; жители продолжают свои дела.'};
}
