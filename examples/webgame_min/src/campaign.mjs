// Кампания мини-примера: маленькая, но с теми же конструкциями, что в большой игре.

export const SEASONS = ["spring", "summer", "autumn", "winter"];

export function createCampaign(input = {}) {
  const gold = Number.isFinite(input.gold) ? input.gold : 100;
  return {
    day: 1,
    season: 0,
    gold,
    army: Array.isArray(input.army) ? input.army.slice() : [],
    log: [],
    finished: false,
  };
}

export function addGold(state, amount) {
  return { ...state, gold: state.gold + amount };
}

export function endDay(state) {
  const next = { ...state, day: state.day + 1 };
  if (next.day % 30 === 0) next.season = (next.season + 1) % SEASONS.length;
  const upkeep = next.army.length * 4;
  next.gold = Math.max(0, next.gold - upkeep);
  next.log = [...next.log, `День ${next.day}: содержание ${upkeep}, казна ${next.gold}`].slice(-6);
  if (next.gold <= 0 && next.army.length > 0) {
    next.log.push("Казна пуста — отряды разбегаются");
    next.army = [];
  }
  return next;
}

export function armyStrength(state) {
  const weights = { swords: 10, archers: 7, cavalry: 14 };
  return state.army.reduce((total, unit) => total + (weights[unit] ?? 5), 0);
}
