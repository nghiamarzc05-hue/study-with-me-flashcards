// storage.js
// Lưu/đọc dữ liệu, migrate, backup/restore.
// Dữ liệu lưu trên máy (localStorage) — phù hợp GitHub Pages.

const STORAGE_KEY = "swm_flashcards_v2";
const THEME_KEY = "swm_theme_v1";

export function uid(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeTag(t){
  return String(t || "").trim().toLowerCase();
}

export function parseTagsCsv(input){
  return String(input || "")
    .split(",")
    .map(s => normalizeTag(s))
    .filter(Boolean);
}

export function loadTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" ? "light" : "dark";
}

export function saveTheme(theme){
  localStorage.setItem(THEME_KEY, theme === "light" ? "light" : "dark");
}

export function emptyState(){
  return { version: 2, decks: [], activeDeckId: null };
}

export function migrateState(state){
  // Tạo state hợp lệ, thêm field thiếu.
  const s = state && typeof state === "object" ? state : emptyState();
  if (!Array.isArray(s.decks)) s.decks = [];
  if (!("activeDeckId" in s)) s.activeDeckId = null;

  for (const d of s.decks){
    if (!d.id) d.id = uid("deck");
    if (!d.name) d.name = "Untitled";
    if (!("description" in d)) d.description = "";
    if (!("createdAt" in d)) d.createdAt = Date.now();
    if (!Array.isArray(d.cards)) d.cards = [];
    if (!Array.isArray(d.tags)) d.tags = [];
    d.tags = d.tags.map(normalizeTag).filter(Boolean);
    if (!("pinned" in d)) d.pinned = false;

    for (const c of d.cards){
      if (!c.id) c.id = uid("card");
      if (!("front" in c)) c.front = "";
      if (!("back" in c)) c.back = "";
      if (!("tag" in c)) c.tag = "";
      if (!("hint" in c)) c.hint = "";
      if (!("createdAt" in c)) c.createdAt = Date.now();
      c.tag = normalizeTag(c.tag);
    }
  }

  if (s.decks.length && !s.activeDeckId) s.activeDeckId = s.decks[0].id;
  if (s.activeDeckId && !s.decks.some(d => d.id === s.activeDeckId)){
    s.activeDeckId = s.decks[0]?.id ?? null;
  }

  s.version = 2;
  return s;
}

export function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrateState(JSON.parse(raw));
  }catch{
    return null;
  }
}

export function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(migrateState(state)));
}

export function seedIfEmpty(){
  let s = loadState();
  if (s && s.decks.length) return s;

  s = emptyState();
  const deck = {
    id: uid("deck"),
    name: "English A1 (mẫu)",
    description: "Deck mẫu để bạn test Search/Tag/Study/TTS.",
    tags: ["english","vocab"],
    pinned: true,
    createdAt: Date.now(),
    cards: [
      { id: uid("card"), front: "apple", back: "quả táo", tag: "noun", hint: "trái cây", createdAt: Date.now() },
      { id: uid("card"), front: "book", back: "quyển sách", tag: "noun", hint: "đồ vật", createdAt: Date.now() },
      { id: uid("card"), front: "thank you", back: "cảm ơn", tag: "phrase", hint: "lịch sự", createdAt: Date.now() }
    ],
  };
  s.decks.push(deck);
  s.activeDeckId = deck.id;

  saveState(s);
  return s;
}

/* =====================
   Backup / Restore
   ===================== */
export function exportJson(state){
  const data = migrateState(structuredClone(state));
  const filename = `study_with_me_backup_${new Date().toISOString().slice(0,10)}.json`;
  return { filename, data };
}

function reIdDeck(deck){
  const oldId = deck.id;
  deck.id = uid("deck");
  for (const c of deck.cards) c.id = uid("card");
  return oldId;
}

export function restoreOverwrite(imported){
  // imported: any -> state
  return migrateState(imported);
}

export function restoreMerge(current, imported){
  const cur = migrateState(structuredClone(current));
  const inc = migrateState(structuredClone(imported));

  // Merge strategy (đơn giản, an toàn):
  // - Nếu deck.id trùng: đổi id deck import để tránh đè.
  // - Sau đó append decks import vào list.
  const curIds = new Set(cur.decks.map(d => d.id));
  for (const d of inc.decks){
    if (curIds.has(d.id)){
      reIdDeck(d);
    }
    curIds.add(d.id);
    cur.decks.push(d);
  }

  // active deck: giữ cái đang dùng, nếu trống thì lấy cái đầu
  if (!cur.activeDeckId && cur.decks.length) cur.activeDeckId = cur.decks[0].id;

  return migrateState(cur);
}

/* =====================
   CSV export helpers
   ===================== */
export function deckToCsv(deck){
  const header = ["front","back","tag","hint"];
  const lines = [header.join(",")];

  for (const c of deck.cards){
    const row = [
      csvEscape(c.front ?? ""),
      csvEscape(c.back ?? ""),
      csvEscape(c.tag ?? ""),
      csvEscape(c.hint ?? "")
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function csvEscape(s){
  const v = String(s ?? "");
  if (/[",\n\r]/.test(v)){
    return '"' + v.replaceAll('"', '""') + '"';
  }
  return v;
}

/* =====================
   CSV parse (hỗ trợ quotes cơ bản)
   ===================== */
export function parseCsv(text){
  const rows = [];
  let i = 0;
  const s = String(text || "");

  function readCell(){
    let cell = "";
    if (s[i] === '"'){
      i++; // skip quote
      while (i < s.length){
        if (s[i] === '"'){
          if (s[i+1] === '"'){ cell += '"'; i += 2; continue; }
          i++; // end quote
          break;
        }
        cell += s[i++];
      }
      // skip spaces
      while (s[i] === " " || s[i] === "\t") i++;
      return cell;
    }else{
      while (i < s.length && s[i] !== "," && s[i] !== "\n" && s[i] !== "\r"){
        cell += s[i++];
      }
      return cell.trim();
    }
  }

  while (i < s.length){
    // skip empty lines
    while (i < s.length && (s[i] === "\r" || s[i] === "\n")) i++;
    if (i >= s.length) break;

    const row = [];
    while (i < s.length){
      row.push(readCell());
      if (s[i] === ","){ i++; continue; }
      if (s[i] === "\r"){ i++; if (s[i] === "\n") i++; break; }
      if (s[i] === "\n"){ i++; break; }
      // end
      if (i >= s.length) break;
      // any other char -> continue
    }
    if (row.length) rows.push(row);
  }

  return rows;
}

export function importCardsFromCsv(deck, csvText){
  const rows = parseCsv(csvText);
  if (!rows.length) return { added: 0, skipped: 0 };

  // header detection
  const first = rows[0].map(x => (x || "").toLowerCase());
  const hasHeader = first.includes("front") || first.includes("back");

  let start = hasHeader ? 1 : 0;

  let added = 0;
  let skipped = 0;

  for (let r = start; r < rows.length; r++){
    const cols = rows[r];
    const front = (cols[0] ?? "").trim();
    const back = (cols[1] ?? "").trim();
    const tag = normalizeTag((cols[2] ?? "").trim());
    const hint = (cols[3] ?? "").trim();

    if (!front || !back){ skipped++; continue; }
    deck.cards.push({
      id: uid("card"),
      front, back,
      tag,
      hint,
      createdAt: Date.now(),
    });
    added++;
  }

  return { added, skipped };
}
