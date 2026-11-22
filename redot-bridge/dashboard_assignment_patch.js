// Assignment validation for the separate, pinned dashboard copy.
document.getElementById('task-send').onclick=async()=>{
  const button=document.getElementById('task-send');
  const note=document.getElementById('task-notice');
  const agent=document.getElementById('task-agent').value;
  const method=document.getElementById('task-method').value.trim();
  let params;
  try { params=JSON.parse(document.getElementById('task-params').value); }
  catch (_) { note.textContent='Укажите параметры как JSON-объект.'; return; }
  if (!agent || !method || !params || typeof params !== 'object' || Array.isArray(params)) {
    note.textContent='Нужны агент, метод и параметры как JSON-объект.'; return;
  }
  if (!Object.keys(params).length && !document.getElementById('task-allow-empty').checked) {
    note.textContent='Параметры пусты. Для метода без параметров отметьте явное разрешение.'; return;
  }
  const id='as'+chatStamp();
  const assignment={id,agent,method,params,from:document.getElementById('chat-from').value.trim()||'agent'};
  button.disabled=true; note.textContent='Отправка назначения…';
  try {
    const assigned=await postChat('assign',assignment,'assign-'+id+'.json');
    if (!assigned) { note.textContent='Запись назначения не подтверждена; оно могло сохраниться. Проверьте шару перед повтором.'; return; }
    note.textContent='Назначение записано; отправка задачи…';
    const queued=await uploadFile('task-'+id+'.json',JSON.stringify({jsonrpc:'2.0',id,method,params,agent}));
    note.textContent=queued ? `Назначение и задача ${id} отправлены. Подтверждение или result-файл не доказывают выполнение.` : `Назначение ${id} записано, запись задачи не подтверждена. Проверьте шару перед повтором.`;
  } catch (_) {
    note.textContent=`Отправка ${id} не подтверждена; файлы могли сохраниться частично. Проверьте шару перед повтором.`;
  } finally { button.disabled=false; }
};
