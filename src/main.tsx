import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Crown, FastForward, Flame, Leaf, Map, Menu, Minus, Mountain, Pause, Play, Plus, RotateCcw, ScrollText, Settings2, Shield, Sparkles, Sun, Trees, Users, Wheat, X, House, Hammer, Package, TreePine } from 'lucide-react';
import './styles.css';

type Focus = 'farming' | 'logging' | 'balanced';
type Event = { id: string; day: number; text: string; kind: 'good' | 'warn' | 'info' };
type Villager = { id: number; name: string; age: number; trait: string; role: string; farmingSkill: number; woodSkill: number; constructionSkill: number; homeId: 'old' | 'new' | null; mood: number; task: 'farming' | 'logging' | 'eating' | 'resting' | 'fetching' | 'hauling' | 'building' | 'waiting' | 'deliveringLogs'; color: string; x: number; y: number; hunger: number; energy: number; carriedWood: number; carriedLogs: number };
type World = { day: number; grain: number; grainCapacity: number; wood: number; gold: number; loyalty: number; focus: Focus; ration: 'normal' | 'half'; playing: boolean; speed: number; events: Event[]; reply: string; villagers: Villager[]; map: string[]; barn: { status: 'available' | 'building' | 'complete'; delivered: number; progress: number }; house: { status: 'available' | 'building' | 'complete'; delivered: number; progress: number }; field: { planted: number; care: number; harvestRemaining: number; harvested: number } };
const seasons = ['Весна', 'Лето', 'Осень', 'Зима'];
function season(day: number) { return seasons[Math.floor((day - 1) / 10) % 4]; }
function taskLabel(task: Villager['task']) { return { farming: 'Работает в поле', logging: 'Рубит лес', eating: 'Ест у амбара', resting: 'Отдыхает', fetching: 'Идёт за древесиной', hauling: 'Несёт древесину', building: 'Строит здание', waiting: 'Ждёт материалы', deliveringLogs: 'Несёт брёвна на склад' }[task]; }
async function request(path: string, body?: object) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Ошибка соединения с сервером.');
  return data;
}
function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decree, setDecree] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'chronicle' | 'people'>('chronicle');
  const [showHelp, setShowHelp] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { try { const data = await request('/api/world'); if (alive) { setWorld(data.world); setAiConfigured(data.aiConfigured); } } catch { if (alive) setNotice('Нет связи с сервером. Проверьте подключение.'); } };
    refresh(); const timer = window.setInterval(refresh, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const send = async (template?: string) => {
    if (!template && !decree.trim()) { setNotice('Напишите указ или выберите готовый шаблон.'); return; }
    setBusy(true); setNotice(template ? 'Передаём указ старосте…' : 'Лорд рассматривает ваш указ…');
    try { const data = await request('/api/decrees', template ? { template } : { text: decree }); setWorld(data.world); if (!template) setDecree(''); setNotice('Лорд рассмотрел указ.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Ошибка соединения.'); }
    finally { setBusy(false); }
  };
  const control = async (action: string) => { try { const data = await request('/api/control', { action }); setWorld(data.world); } catch { setNotice('Не удалось изменить состояние мира.'); } };
  const reset = () => { if (window.confirm('Начать заново? Текущая летопись и ресурсы будут сброшены.')) void control('reset'); };
  if (!world) return <div className="loading-world">{notice || 'Летописец готовит королевство…'}</div>;
  const { playing, speed, villagers } = world;
  const focusLabel = world.focus === 'farming' ? 'Земледелие' : world.focus === 'logging' ? 'Заготовка леса' : 'Все работы';
  return <div className="app-shell">
    <aside className="rail" aria-label="Навигация">
      <div className="brand-mark"><Crown size={22}/></div>
      <div className="rail-line"/>
      <button className="rail-button active" title="Поселение"><Map size={19}/></button>
      <button className="rail-button" title="Летопись" onClick={() => setTab('chronicle')}><BookOpen size={19}/></button>
      <button className="rail-button" title="Жители" onClick={() => setTab('people')}><Users size={19}/></button>
      <div className="rail-bottom"><button className="rail-button" title="Как играть" onClick={() => setShowHelp(true)}><CircleHelp size={19}/></button><button className="rail-button" title="Начать заново" onClick={reset}><RotateCcw size={18}/></button></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="wordmark"><span>KING GRAIN</span><small>AI KINGDOMS <i>✦</i> ПРОТОТИП</small></div>
        <div className="top-divider"/>
        <div className="kingdom-name"><span>ВАШЕ КОРОЛЕВСТВО</span><strong>Грейнхолд <ChevronDown size={14}/></strong></div>
        <div className="top-spacer"/>
        <div className="top-date"><Sun size={17}/><div><strong>{season(world.day)}, день {((world.day - 1) % 10) + 1}</strong><span>Год {Math.floor((world.day - 1) / 40) + 1} · День {world.day}</span></div></div>
        <div className="top-divider short"/><button className="help-link" onClick={() => setShowHelp(true)}><CircleHelp size={17}/> <span>Как играть</span></button>
      </header>
      <div className="page-content">
        <div className="heading"><div><div className="eyebrow"><span>✦</span> ВАШЕ КОРОЛЕВСТВО <span>✦</span></div><h1>Жизнь в Грейнхолде</h1><p>Маленькое королевство. Большая история.</p></div><div className="status"><span className="status-dot"/> {world.grain === 0 ? 'В ПОСЕЛЕНИИ ГОЛОД' : world.loyalty < 60 ? 'НАРОД ОБЕСПОКОЕН' : 'ПОСЕЛЕНИЕ ПРОЦВЕТАЕТ'}</div></div>
        <section className="resources" aria-label="Ресурсы королевства">
          <Resource icon={<Wheat/>} label="ЗЕРНО" value={Math.floor(world.grain)} unit="мешков" detail={`${Math.floor(world.grain)} / ${world.grainCapacity} вместимость`} tone="wheat"/>
          <Resource icon={<Trees/>} label="ДРЕВЕСИНА" value={Math.floor(world.wood)} unit="брёвен" detail="На складе" tone="wood"/>
          <Resource icon={<span className="coin">✦</span>} label="КАЗНА" value={world.gold} unit="монет" detail="Золото королевства" tone="gold"/>
          <Resource icon={<Users/>} label="ЖИТЕЛИ" value={villagers.length} unit="душ" detail={`${villagers.filter(v => v.homeId).length} / ${villagers.length} с жильём`} tone="people"/>
          <Resource icon={<Shield/>} label="ВЕРНОСТЬ" value={`${world.loyalty}%`} unit="" detail={world.loyalty >= 60 ? 'Народ доволен' : 'Народ обеспокоен'} tone="loyalty"/>
        </section>
        <div className="game-grid">
          <div className="left-column">
            <section className="map-card">
              <div className="section-bar"><div><span className="bar-icon"><Map size={16}/></span><strong>Ваше поселение</strong><span className="section-sub">{focusLabel}</span></div><div className="live"><span/> {playing ? 'МИР ЖИВЁТ' : 'МИР НА ПАУЗЕ'}</div></div>
              <div className="scene"><div className={`scene-inner ${playing ? "" : "paused"}`} style={{ transform: `scale(${zoom})` }}>
                <div className="tile-map" role="group" aria-label="Клеточная карта поселения: лес, дома, амбар, склад и поля">
                  {world.map.flatMap((row, y) => [...row].map((tile, x) => <div key={`${x}-${y}`} className={`tile tile-${tile.toLowerCase()} ${tile === 'F' ? `field-${season(world.day) === 'Зима' ? 'winter' : season(world.day) === 'Осень' ? 'autumn' : season(world.day) === 'Лето' ? 'summer' : 'spring'}` : ''}`} title={{T:'Лес', G:'Луг', P:'Дорога', H:'Дом', B:'Старый амбар', L:'Склад древесины', S:'Место нового амбара', D:'Место нового дома', F:'Поле'}[tile]}>
                    {tile === 'T' && <TreePine className="tile-tree" size={29}/>} {tile === 'H' && <span className="tile-building house-building"><House size={26}/></span>}
                    {tile === 'B' && <span className="tile-building barn-building"><House size={25}/></span>}
                    {tile === 'L' && <span className="tile-object"><Package size={24}/></span>}
                    {tile === 'S' && <span className={`tile-site site-${world.barn.status}`}>{world.barn.status === 'complete' ? <House size={24}/> : world.barn.status === 'building' ? <Hammer size={22}/> : '+'}</span>}
                    {tile === 'D' && <span className={`tile-site site-${world.house.status}`}>{world.house.status === 'complete' ? <House size={24}/> : world.house.status === 'building' ? <Hammer size={22}/> : '+'}</span>}
                    {tile === 'F' && <Wheat className="tile-wheat" size={18}/>}
                  </div>))}
                  {villagers.map((v,i) => <button className={`villager ${selectedPerson === v.id ? 'person-selected' : ''}`} key={v.id} aria-label={`${v.name} — ${taskLabel(v.task)}. Открыть карточку`} title={`${v.name} — ${taskLabel(v.task)} · голод ${v.hunger}% · энергия ${v.energy}%`} onClick={() => setSelectedPerson(v.id)} style={{ left: `calc(${(v.x + .5) / 12 * 100}% + ${(i % 3 - 1) * 7}px)`, top: `calc(${(v.y + .5) / 9 * 100}% + ${(Math.floor(i / 3) % 3 - 1) * 5}px)` }}><span className="villager-head"/><span className="villager-body" style={{background: v.color}}/><span className="villager-shadow"/>{(v.carriedWood > 0 || v.carriedLogs > 0) && <span className="wood-load">▰</span>}</button>)}
                </div>
              </div>
                <div className="map-label"><span>✦ ЗЕМЛИ КОРОЛЕВСТВА</span><strong>Грейнхолд</strong><small>Основано в год первый</small></div>
                <div className="map-tools"><button title="Приблизить" aria-label="Приблизить карту" onClick={() => setZoom(z => Math.min(1.3, +(z + .1).toFixed(1)))}><Plus size={16}/></button><button title="Отдалить" aria-label="Отдалить карту" onClick={() => setZoom(z => Math.max(1, +(z - .1).toFixed(1)))}><Minus size={16}/></button></div>
                <div className="map-note"><span className="mini-person">♟</span> Нажмите на жителя, чтобы открыть карточку</div>
              </div>
              <div className="map-legend"><span><TreePine size={13}/> Лес</span><span><Package size={13}/> Склад</span><span><Hammer size={13}/> Стройка</span><span><Wheat size={13}/> Поле</span><span><House size={13}/> Дом / амбар</span></div><div className="map-footer"><div className="time-controls"><button className="play-btn" onClick={() => control('toggle')} aria-label={playing ? 'Пауза' : 'Продолжить'}>{playing ? <Pause size={15} fill="currentColor"/> : <Play size={15} fill="currentColor"/>}</button><button className={speed === 2 ? 'speed active-speed' : 'speed'} onClick={() => control('speed')} title="Изменить скорость"><FastForward size={16}/> <span>{speed}×</span></button><button className="next-day" onClick={() => control('next')} title="Следующий день"><ChevronRight size={18}/><span>Следующий день</span></button></div><div className="map-footer-right"><Clock3 size={14}/> 1 день ≈ {speed === 1 ? '5' : '1,8'} сек. <span className="footer-separator"/> <Sun size={15}/> {season(world.day)}</div></div>
            </section>
            <div className="bottom-heading"><div><span className="ornament">✦</span><h2>Народ королевства</h2><span className="count-badge">{villagers.length} жителей</span></div><button onClick={() => setTab('people')}>Посмотреть жителей <ChevronRight size={15}/></button></div>
            <div className="villager-list">{villagers.slice(0,4).map((v,i) => <button className="villager-card" key={v.name} onClick={() => setSelectedPerson(v.id)}><div className={`portrait portrait-${i}`}><span>{['♟','♟','♟','♟'][i]}</span></div><div><strong>{v.name}</strong><span>{v.role}</span><small><i/> {taskLabel(v.task)}</small></div></button>)}</div>
          </div>
          <aside className="right-column">
            <section className="decree-card"><div className="card-title"><div className="title-icon"><ScrollText size={19}/></div><div><h2>Свиток указов</h2><p>Ваше слово — закон</p></div><span className="card-sparkle">✦</span></div><div className="fine-line"/><p className="instruction">Что повелеваете, мой лорд?</p><div className="chips"><button disabled={busy || world.house.status !== 'available' || world.barn.status === 'building'} title={world.barn.status === 'building' ? 'Сначала завершите текущую стройку' : '18 древесины, 6 коек'} onClick={() => send('house')}>🏠 Построить дом</button><button disabled={busy || world.barn.status !== 'available' || world.house.status === 'building'} title={world.house.status === 'building' ? 'Сначала завершите текущую стройку' : '24 древесины'} onClick={() => send('barn')}>🔨 Построить амбар</button><button disabled={busy} onClick={() => send('farming')}>🌾 Больше зерна</button><button disabled={busy} onClick={() => send('logging')}>🌲 Заготовка леса</button><button disabled={busy} onClick={() => send('balanced')}>⚖ Все работы</button><button disabled={busy} onClick={() => send(world.ration === 'normal' ? 'half' : 'normal')}>🍞 {world.ration === 'normal' ? 'Сократить паёк' : 'Обычный паёк'}</button></div><label className="sr-only" htmlFor="decree">Текст указа</label><textarea id="decree" value={decree} onChange={e => {setDecree(e.target.value); setNotice('');}} placeholder="Напишите свой указ...&#10;Например: «Пусть жители собирают больше зерна»" maxLength={300}/><button className="send-button" disabled={busy} onClick={() => send()}><ScrollText size={16}/> Отправить указ <span>→</span></button>{notice && <p className="notice" role="status">{notice}</p>}<div className="decree-hint"><Sparkles size={14}/> {aiConfigured ? 'Свободные указы требуют доступного OpenRouter; кнопки работают без ИИ.' : 'ИИ не настроен; готовые указы работают без него.'}</div></section>
            <section className="workshop-card"><div className="workshop-heading"><span className="bar-icon"><Hammer size={16}/></span><strong>Новый амбар</strong><span className="project-state">{world.barn.status === 'available' ? 'ОЖИДАЕТ УКАЗА' : world.barn.status === 'building' ? 'СТРОИТЕЛЬСТВО' : 'ПОСТРОЕН'}</span></div><p>{world.barn.status === 'available' ? 'Укажите построить амбар: потребуется 24 древесины.' : world.barn.status === 'building' ? (world.wood < 1 && world.barn.delivered < 24 ? 'На складе мало древесины. Строители ждут поставки.' : 'Жители забирают древесину со склада и доставляют на стройку.') : 'Вместимость зерна увеличена на 160 мешков.'}</p>{world.barn.status !== 'available' && <><div className="progress-label"><span>Древесина</span><b>{world.barn.delivered} / 24</b></div><div className="progress-track"><i style={{width: `${world.barn.delivered / 24 * 100}%`}}/></div><div className="progress-label"><span>Работа</span><b>{world.barn.progress} / 6</b></div><div className="progress-track"><i style={{width: `${world.barn.progress / 6 * 100}%`}}/></div></>}</section>
            <section className="workshop-card housing-card"><div className="workshop-heading"><span className="bar-icon"><House size={16}/></span><strong>Жильё жителей</strong><span className="project-state">{world.house.status === 'available' ? 'ОЖИДАЕТ УКАЗА' : world.house.status === 'building' ? 'СТРОИТЕЛЬСТВО' : 'ПОСТРОЕН'}</span></div><p>{villagers.filter(v => v.homeId).length} из {villagers.length} жителей имеют койку. {world.house.status === 'available' ? 'Новый дом: 18 древесины, 6 коек.' : world.house.status === 'building' ? 'Строители несут древесину и строят дом.' : 'Новый дом заселён.'}</p>{world.house.status !== 'available' && <><div className="progress-label"><span>Древесина</span><b>{world.house.delivered} / 18</b></div><div className="progress-track"><i style={{width: `${world.house.delivered / 18 * 100}%`}}/></div><div className="progress-label"><span>Работа</span><b>{world.house.progress} / 5</b></div><div className="progress-track"><i style={{width: `${world.house.progress / 5 * 100}%`}}/></div></>}</section>
            <section className="field-card"><div className="workshop-heading"><span className="bar-icon"><Wheat size={16}/></span><strong>Жизнь полей</strong><span className="project-state">{season(world.day).toUpperCase()}</span></div><p>{season(world.day) === 'Весна' ? `Посевы: ${world.field.planted} / 12. Каждый посев расходует 1 мешок зерна.` : season(world.day) === 'Лето' ? `За посевами ухаживают. Работ по уходу: ${world.field.care}.` : season(world.day) === 'Осень' ? `Осталось собрать: ${world.field.harvestRemaining} мешков. Доставлено: ${world.field.harvested}.` : 'Зимой поля отдыхают. Весной начнётся новый посев.'}</p></section>
            <section className="lord-card"><div className="lord-avatar"><Crown size={22}/></div><div><div className="lord-heading"><strong>Слово лорда</strong><span>✦</span></div><p>«{world.reply}»</p><small>ЛОРД ГРЕЙНХОЛДА</small></div></section>
            <section className="chronicle"><div className="chronicle-tabs"><button className={tab === 'chronicle' ? 'selected' : ''} onClick={() => setTab('chronicle')}><BookOpen size={16}/> Летопись</button><button className={tab === 'people' ? 'selected' : ''} onClick={() => setTab('people')}><Users size={16}/> Жители</button></div>{tab === 'chronicle' ? <div className="events">{world.events.slice(0,5).map(event => <div className="event" key={event.id}><div className={`event-icon ${event.kind}`}>{event.kind === 'good' ? <Leaf size={14}/> : event.kind === 'warn' ? <Flame size={14}/> : <ScrollText size={14}/>}</div><div><small>ДЕНЬ {event.day}</small><p>{event.text}</p></div></div>)}</div> : <div className="people-panel"><p>Жители самостоятельно распределяют время между работой, едой и отдыхом.</p>{villagers.map(v => <button className="people-row" key={v.id} onClick={() => setSelectedPerson(v.id)}><span className="person-dot"/><strong>{v.name}</strong><small>{taskLabel(v.task)} · голод {v.hunger}%</small><ChevronRight size={13}/></button>)}<p className="people-note">У каждого жителя свои голод, энергия и занятие.</p></div>}</section>
          </aside>
        </div>
        <footer><span>✦ KING GRAIN <b>·</b> AI KINGDOMS</span><span>ПРОТОТИП <b>·</b> ВАША ИСТОРИЯ ТОЛЬКО НАЧИНАЕТСЯ</span><span>Сохранение на сервере</span></footer>
      </div>
    </main>
    {selectedPerson !== null && (() => { const v = villagers.find(person => person.id === selectedPerson); if (!v) return null; return <div className="modal-backdrop" onClick={() => setSelectedPerson(null)}><div className="modal person-modal" role="dialog" aria-modal="true" aria-labelledby="person-title" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelectedPerson(null)} aria-label="Закрыть"><X size={20}/></button><span className="eyebrow">✦ ЖИТЕЛЬ ГРЕЙНХОЛДА</span><div className="person-profile"><div className="profile-portrait" style={{background: v.color}}>♟</div><div><h2 id="person-title">{v.name}</h2><p>{v.role} · {v.age} лет</p></div></div><div className="profile-trait">✦ {v.trait}</div><div className="profile-metric"><span>Голод</span><strong>{v.hunger}%</strong></div><div className="progress-track hunger-track"><i style={{width: `${v.hunger}%`}}/></div><div className="profile-metric"><span>Энергия</span><strong>{v.energy}%</strong></div><div className="progress-track"><i style={{width: `${v.energy}%`}}/></div><div className="profile-metric"><span>Настроение</span><strong>{v.mood}%</strong></div><div className="progress-track"><i style={{width: `${v.mood}%`}}/></div><div className="profile-detail"><span>Жильё</span><b>{v.homeId === 'old' ? 'Старый дом' : v.homeId === 'new' ? 'Новый дом' : 'Нет койки'}</b></div><div className="profile-detail"><span>Сейчас</span><b>{taskLabel(v.task)}{v.carriedWood ? ` · несёт ${v.carriedWood} брёвен на стройку` : v.carriedLogs ? ` · несёт ${v.carriedLogs} брёвен на склад` : ''}</b></div><div className="profile-detail"><span>Навыки</span><b>Земледелие {v.farmingSkill}/10 · лес {v.woodSkill}/10 · стройка {v.constructionSkill}/10</b></div><p className="modal-note">Навыки и настроение влияют на работу. Трудолюбивые, упорные и практичные работают быстрее; заботливые быстрее восстанавливают настроение при хорошем жилье. Остальные черты пока не влияют на игру.</p><button className="send-button" onClick={() => setSelectedPerson(null)}>Вернуться к поселению <span>→</span></button></div></div>; })()}
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setShowHelp(false)} aria-label="Закрыть"><X size={20}/></button><span className="eyebrow">✦ ПЕРВЫЕ ШАГИ</span><h2 id="help-title">Добро пожаловать, мой лорд</h2><p>Жители Грейнхолда работают самостоятельно. Вы не управляете ими напрямую — вместо этого направляйте жизнь поселения указами.</p><div className="help-row"><Wheat size={19}/><span><b>Следите за зерном.</b> Весной жители сеют, летом ухаживают за посевами, осенью собирают урожай. Пустой амбар снижает верность.</span></div><div className="help-row"><ScrollText size={19}/><span><b>Отдавайте указы.</b> Выберите готовый указ, чтобы направить работы или начать стройку амбара или дома. Одновременно возможна одна стройка. Для свободного текста нужен OpenRouter.</span></div><div className="help-row"><Clock3 size={19}/><span><b>Управляйте временем.</b> Поставьте мир на паузу, ускорьте его или перейдите к следующему дню.</span></div><p className="modal-note">Каждый житель выбирает работу, еду или отдых по своим потребностям. Свободные указы отправляются ИИ-лорду, а готовые работают без ИИ. Мир хранится на сервере и привязан к браузеру.</p><button className="send-button" onClick={() => setShowHelp(false)}>Понятно, за дело <span>→</span></button></div></div>}
  </div>;
}
function Resource({ icon,label,value,unit,detail,tone }: {icon: React.ReactNode; label: string; value: string | number; unit: string; detail: string; tone: string}) { return <div className="resource"><div className={`resource-icon ${tone}`}>{icon}</div><div className="resource-text"><span>{label}</span><div><strong>{value}</strong> <small>{unit}</small></div><p><i/> {detail}</p></div></div>; }

createRoot(document.getElementById('root')!).render(<App/>);
