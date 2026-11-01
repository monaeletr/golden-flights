export function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getData(key, fallback = []) {
  const stored = localStorage.getItem(key);

  return stored ? JSON.parse(stored) : fallback;
}

export function removeData(key) {
  localStorage.removeItem(key);
}