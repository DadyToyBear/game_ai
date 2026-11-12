// Co-located villagers doing the same activity gradually build symmetric friendships.
export function updateRelationships(w, log) {
  if (w.day % 3 !== 0) return;
  let announced = 0;
  const encouraged = new Set();
  for (let i = 0; i < w.villagers.length; i++) for (let j = i + 1; j < w.villagers.length; j++) {
    const a = w.villagers[i], b = w.villagers[j];
    if (a.x !== b.x || a.y !== b.y || a.task !== b.task || a.task === 'waiting') continue;
    let rel = w.relationships.find(r => r.a === a.id && r.b === b.id);
    if (!rel) { rel = { a:a.id, b:b.id, score:0 }; w.relationships.push(rel); }
    const previous = rel.score;
    rel.score = Math.min(100, rel.score + 2);
    if (rel.score >= 8) {
      encouraged.add(a.id); encouraged.add(b.id);
      if (previous < 8 && announced++ < 2) log(w, `${a.name} и ${b.name} подружились, проводя время вместе.`, 'good');
    }
  }
  for (const person of w.villagers) if (encouraged.has(person.id)) person.mood = Math.min(100, person.mood + 1);
}
