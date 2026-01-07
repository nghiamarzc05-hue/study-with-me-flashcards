// app.js
import {
  seedIfEmpty,
  saveState,
  migrateState,
  parseTagsCsv,
  normalizeTag,
  loadTheme,
  saveTheme,
  exportJson,
  restoreMerge,
  restoreOverwrite,
  deckToCsv,
  importCardsFromCsv,
} from "./storage.js";

import { createTts, initTtsUI, speakText, stopSpeak } from "./tts.js";

let state = seedIfEmpty();

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function downloadText(filename, content, mime="text/plain;charset=utf-8"){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getActiveDeck(){
  return state.decks.find(d => d.id === state.activeDeckId) ?? null;
}

function getDeckById(id){
  return state.decks.find(d => d.id === id) ?? null;
}

// ---------- theme ----------
function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  const label = theme === "light" ? "☀️ Light" : "🌙 Dark";
  $("#themeToggleTop").textContent = label;
}
function initTheme(){
  applyTheme(loadTheme());
  $("#themeToggleTop").addEventListener("click", () => toggleTheme());
  $("#themeToggleSettings").addEventListener("click", () => toggleTheme());
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const next = cur === "light" ? "dark" : "light";
  saveTheme(next);
  applyTheme(next);
}

// ---------- tabs ----------
const tabs = $$(".tab");
const panels = $$("[data-panel]");

function showTab(name){
  // stop background things
  if (name !== "study"){
    stopAutoplay();
    stopPomo();
    stopSpeak(tts);
  }

  tabs.forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  panels.forEach(p => p.classList.toggle("hidden", p.dataset.panel !== name));

  if (name === "study") renderStudy();
  if (name === "import") renderImport();
}
tabs.forEach(btn => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

// ---------- elements ----------
const deckList = $("#deckList");
const deckEmpty = $("#deckEmpty");
const deckDetail = $("#deckDetail");
const deckName = $("#deckName");
const deckDesc = $("#deckDesc");
const deckTags = $("#deckTags");
const btnTogglePin = $("#btnTogglePin");

const deckSearch = $("#deckSearch");
const tagFilter = $("#tagFilter");
const sortSelect = $("#sortSelect");
const btnClearFilter = $("#btnClearFilter");

const cardList = $("#cardList");
const cardSearch = $("#cardSearch");

const dlgDeck = $("#dlgDeck");
const newDeckName = $("#newDeckName");
const newDeckTags = $("#newDeckTags");

const dlgCard = $("#dlgCard");
const dlgCardTitle = $("#dlgCardTitle");
const cardFront = $("#cardFront");
const cardBack = $("#cardBack");
const cardTag = $("#cardTag");
const cardHint = $("#cardHint");
const editingCardId = $("#editingCardId");

// settings elements
const btnExportJson = $("#btnExportJson");
const jsonFileInput = $("#jsonFileInput");
const backupMsg = $("#backupMsg");
const btnResetAll = $("#btnResetAll");

// restore dialog
const dlgRestore = $("#dlgRestore");

// import elements
const importDeckSelect = $("#importDeckSelect");
const csvText = $("#csvText");
const importResult = $("#importResult");

// ---------- filters/sort ----------
let deckFilters = { q: "", tag: "" };

function getAllDeckTags(){
  const set = new Set();
  for (const d of state.decks){
    for (const t of (Array.isArray(d.tags) ? d.tags : [])){
      const nt = normalizeTag(t);
      if (nt) set.add(nt);
    }
  }
  return Array.from(set).sort();
}

function renderTagFilterOptions(){
  const current = tagFilter.value || "";
  const tags = getAllDeckTags();
  tagFilter.innerHTML = `<option value="">Tất cả tag</option>`;
  for (const t of tags){
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    tagFilter.appendChild(opt);
  }
  tagFilter.value = tags.includes(current) ? current : "";
  deckFilters.tag = tagFilter.value;
}

function applyDeckSort(decks){
  const mode = sortSelect.value || "pinned_newest";

  const pinnedFirst = (a,b) => (b.pinned?1:0) - (a.pinned?1:0);

  if (mode === "pinned_az"){
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return String(a.name).localeCompare(String(b.name), "vi", { sensitivity: "base" });
    });
  } else if (mode === "pinned_cards"){
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return (b.cards?.length||0) - (a.cards?.length||0);
    });
  } else {
    // pinned_newest
    decks.sort((a,b) => {
      const p = pinnedFirst(a,b);
      if (p) return p;
      return (b.createdAt||0) - (a.createdAt||0);
    });
  }
  return decks;
}

if (deckSearch){
  deckSearch.addEventListener("input", () => {
    deckFilters.q = deckSearch.value.trim().toLowerCase();
    renderDeckList();
  });
}
if (tagFilter){
  tagFilter.addEventListener("change", () => {
    deckFilters.tag = tagFilter.value;
    renderDeckList();
  });
}
if (sortSelect){
  sortSelect.addEventListener("change", () => renderDeckList());
}
if (btnClearFilter){
  btnClearFilter.addEventListener("click", () => {
    deckFilters.q = "";
    deckFilters.tag = "";
    deckSearch.value = "";
    tagFilter.value = "";
    renderDeckList();
  });
}

// ---------- decks CRUD ----------
$("#btnNewDeck").addEventListener("click", () => {
  newDeckName.value = "";
  newDeckTags.value = "";
  dlgDeck.showModal();
});

$("#btnCreateDeckConfirm").addEventListener("click", (e) => {
  if (!newDeckName.value.trim()){
    e.preventDefault();
    alert("Tên bộ trống. Đặt tên đi.");
  }
});

dlgDeck.addEventListener("close", () => {
  if (dlgDeck.returnValue !== "ok") return;
  const name = newDeckName.value.trim();
  const tags = parseTagsCsv(newDeckTags.value);

  const deck = {
    id: crypto.randomUUID ? crypto.randomUUID() : `deck_${Date.now()}`,
    name,
    description: "",
    tags,
    pinned: false,
    createdAt: Date.now(),
    cards: [],
  };
  state.decks.unshift(deck);
  state.activeDeckId = deck.id;
  saveAndRender();
});

$("#btnSaveDeck").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;

  const name = deckName.value.trim();
  if (!name) return alert("Tên bộ trống. Sửa lại.");
  deck.name = name;
  deck.description = deckDesc.value.trim();
  deck.tags = parseTagsCsv(deckTags.value);

  saveAndRender();
});

btnTogglePin.addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  deck.pinned = !deck.pinned;
  saveAndRender();
});

$("#btnDeleteDeck").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  const ok = confirm(`Xóa bộ "${deck.name}"? Xóa là mất luôn.`);
  if (!ok) return;

  state.decks = state.decks.filter(d => d.id !== deck.id);
  state.activeDeckId = state.decks[0]?.id ?? null;
  saveAndRender();
});

$("#btnStudyThisDeck").addEventListener("click", () => {
  showTab("study");
});

$("#btnExportDeckCsv").addEventListener("click", () => {
  const deck = getActiveDeck();
  if (!deck) return;
  const csv = deckToCsv(deck);
  const safeName = deck.name.replaceAll(/[^a-zA-Z0-9_\- ]/g, "_").slice(0,50).trim() || "deck";
  downloadText(`${safeName}.csv`, csv, "text/csv;charset=utf-8");
});

// ---------- cards CRUD ----------
$("#btnNewCard").addEventListener("click", () => {
  if (!getActiveDeck()) return alert("Chọn bộ trước.");
  openCardDialog("add");
});

$("#btnSaveCardConfirm").addEventListener("click", (e) => {
  if (!cardFront.value.trim() || !cardBack.value.trim()){
    e.preventDefault();
    alert("Front/back trống. Điền đủ.");
  }
});

dlgCard.addEventListener("close", () => {
  if (dlgCard.returnValue !== "ok") return;
  const deck = getActiveDeck();
  if (!deck) return;

  const front = cardFront.value.trim();
  const back = cardBack.value.trim();
  const tag = normalizeTag(cardTag.value.trim());
  const hint = cardHint.value.trim();
  const id = editingCardId.value;

  if (!id){
    deck.cards.unshift({
      id: crypto.randomUUID ? crypto.randomUUID() : `card_${Date.now()}`,
      front, back, tag, hint,
      createdAt: Date.now(),
    });
  }else{
    const c = deck.cards.find(x => x.id === id);
    if (c){
      c.front = front;
      c.back = back;
      c.tag = tag;
      c.hint = hint;
    }
  }

  saveAndRenderDeckDetail();
});

cardSearch.addEventListener("input", () => renderDeckDetail());

function openCardDialog(mode, card){
  editingCardId.value = "";
  if (mode === "add"){
    dlgCardTitle.textContent = "Thêm thẻ";
    cardFront.value = "";
    cardBack.value = "";
    cardTag.value = "";
    cardHint.value = "";
  } else {
    dlgCardTitle.textContent = "Sửa thẻ";
    editingCardId.value = card.id;
    cardFront.value = card.front ?? "";
    cardBack.value = card.back ?? "";
    cardTag.value = card.tag ?? "";
    cardHint.value = card.hint ?? "";
  }
  dlgCard.showModal();
}

// ---------- render decks ----------
function renderDeckList(){
  renderTagFilterOptions();

  deckList.innerHTML = "";
  if (!state.decks.length){
    deckList.innerHTML = `<div class="muted">Chưa có bộ nào. Tạo bộ mới đi.</div>`;
    return;
  }

  let decks = state.decks.slice();

  // filter by query
  if (deckFilters.q){
    const q = deckFilters.q;
    decks = decks.filter(d => {
      const name = (d.name||"").toLowerCase();
      const desc = (d.description||"").toLowerCase();
      const tags = (Array.isArray(d.tags) ? d.tags : []).map(normalizeTag).join(" ");
      return name.includes(q) || desc.includes(q) || tags.includes(q);
    });
  }

  // filter by tag
  if (deckFilters.tag){
    const t = deckFilters.tag;
    decks = decks.filter(d => (Array.isArray(d.tags) ? d.tags.map(normalizeTag) : []).includes(t));
  }

  applyDeckSort(decks);

  for (const d of decks){
    const el = document.createElement("div");
    el.className = "item" + (d.id === state.activeDeckId ? " is-active" : "");
    const tags = (Array.isArray(d.tags) ? d.tags : []).map(normalizeTag).filter(Boolean);
    const tagsHtml = tags.length
      ? `<div class="tags">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

    el.innerHTML = `
      <div class="item-title">${escapeHtml(d.name)} ${d.pinned ? "⭐" : ""}</div>
      <div class="item-sub">${(d.cards?.length||0)} thẻ • ${(d.description||"") ? "có mô tả" : "không mô tả"}</div>
      ${tagsHtml}
      <div class="item-actions">
        <button class="chip pin" data-act="pin">${d.pinned ? "Bỏ ghim" : "Ghim"}</button>
      </div>
    `;

    el.addEventListener("click", (ev) => {
      // tránh click vào nút pin mà cũng chọn deck 2 lần
      const act = ev.target?.dataset?.act;
      if (act === "pin") return;
      state.activeDeckId = d.id;
      saveAndRender();
    });

    el.querySelector('[data-act="pin"]').addEventListener("click", () => {
      d.pinned = !d.pinned;
      saveAndRender();
    });

    deckList.appendChild(el);
  }
}

function renderDeckDetail(){
  const deck = getActiveDeck();
  if (!deck){
    deckEmpty.classList.remove("hidden");
    deckDetail.classList.add("hidden");
    return;
  }
  deckEmpty.classList.add("hidden");
  deckDetail.classList.remove("hidden");

  deckName.value = deck.name;
  deckDesc.value = deck.description || "";
  deckTags.value = (deck.tags || []).join(", ");
  btnTogglePin.textContent = deck.pinned ? "⭐ Bỏ ghim" : "⭐ Ghim";

  const q = cardSearch.value.trim().toLowerCase();
  const cards = q
    ? (deck.cards||[]).filter(c => {
        const t = (c.tag||"").toLowerCase();
        const h = (c.hint||"").toLowerCase();
        return (c.front||"").toLowerCase().includes(q)
          || (c.back||"").toLowerCase().includes(q)
          || t.includes(q)
          || h.includes(q);
      })
    : (deck.cards||[]);

  cardList.innerHTML = "";
  if (!cards.length){
    cardList.innerHTML = `<div class="muted">Chưa có thẻ. Bấm “Thêm thẻ”.</div>`;
    return;
  }

  for (const c of cards){
    const el = document.createElement("div");
    el.className = "item";
    const tag = c.tag ? `<span class="tag">${escapeHtml(c.tag)}</span>` : "";
    const hint = c.hint ? `<span class="muted small">Hint: ${escapeHtml(c.hint)}</span>` : "";

    el.innerHTML = `
      <div class="item-title">${escapeHtml(c.front)}</div>
      <div class="item-sub">${escapeHtml(c.back)}</div>
      <div class="tags">${tag}</div>
      ${hint ? `<div class="item-sub">${hint}</div>` : ""}
      <div class="item-actions">
        <button class="chip" data-act="edit">Sửa</button>
        <button class="chip" data-act="del">Xóa</button>
      </div>
    `;

    el.querySelector('[data-act="edit"]').addEventListener("click", () => openCardDialog("edit", c));
    el.querySelector('[data-act="del"]').addEventListener("click", () => {
      const ok = confirm("Xóa thẻ này? Xóa là mất luôn.");
      if (!ok) return;
      const deck2 = getActiveDeck();
      deck2.cards = deck2.cards.filter(x => x.id !== c.id);
      saveAndRenderDeckDetail();
    });

    cardList.appendChild(el);
  }
}

function saveAndRender(){
  state = migrateState(state);
  saveState(state);
  renderAll();
}

function saveAndRenderDeckDetail(){
  state = migrateState(state);
  saveState(state);
  renderDeckDetail();
  renderDeckList();
  // study/import selects might need update
  const activePanel = panels.find(p => !p.classList.contains("hidden"))?.dataset.panel;
  if (activePanel === "study") renderStudy();
  if (activePanel === "import") renderImport();
}

function renderAll(){
  renderDeckList();
  renderDeckDetail();
  // settings message
  if (backupMsg) backupMsg.textContent = "";
}

// ---------- Study logic ----------
let randomMode = false;

let study = {
  deckId: state.activeDeckId,
  order: [],
  idx: 0,
  flipped: false,
};

const studyDeckSelect = $("#studyDeckSelect");
const flashcard = $("#flashcard");
const flashFront = $("#flashFront");
const flashBack = $("#flashBack");
const studyMeta = $("#studyMeta");

function getStudyDeck(){
  return getDeckById(study.deckId);
}

function getCurrentCard(){
  const deck = getStudyDeck();
  if (!deck || !study.order.length) return null;
  const id = study.order[study.idx];
  return deck.cards.find(c => c.id === id) || null;
}
function getFrontText(){
  return getCurrentCard()?.front?.trim() || "";
}
function getBackText(){
  return getCurrentCard()?.back?.trim() || "";
}

function speakFront(){
  speakText(tts, getFrontText());
}
function speakBack(){
  speakText(tts, getBackText());
}

function pickRandomIndex(){
  if (!study.order.length) return 0;
  if (study.order.length === 1) return 0;
  let next = Math.floor(Math.random() * study.order.length);
  if (next === study.idx) next = (next + 1) % study.order.length;
  return next;
}

function setupStudy(deckId, shuffle){
  study.deckId = deckId;
  const deck = getDeckById(deckId);
  const ids = (deck?.cards ?? []).map(c => c.id);
  if (!ids.length){
    study.order = [];
    study.idx = 0;
    study.flipped = false;
    return;
  }

  study.order = ids.slice();
  if (shuffle) fisherYates(study.order);
  study.idx = 0;
  study.flipped = false;
}

function fisherYates(arr){
  for (let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function renderStudy(){
  stopAutoplay(); // prevent double speak
  stopPomo();

  // fill select
  studyDeckSelect.innerHTML = "";
  for (const d of state.decks){
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.cards.length})`;
    studyDeckSelect.appendChild(opt);
  }

  const defaultId = state.activeDeckId ?? state.decks[0]?.id ?? "";
  studyDeckSelect.value = defaultId;

  setupStudy(defaultId, false);
  renderStudyCard();
}

function renderStudyCard(){
  const deck = getStudyDeck();
  const total = study.order.length;

  if (!deck || !total){
    studyMeta.textContent = "Deck trống. Thêm thẻ trước đã.";
    flashFront.textContent = "—";
    flashBack.textContent = "—";
    flashcard.classList.remove("is-flipped");
    return;
  }

  const card = getCurrentCard();
  studyMeta.textContent = `Deck: ${deck.name} • Thẻ: ${study.idx + 1}/${total}`;
  flashFront.textContent = card?.front ?? "—";

  // mặt sau có thể thêm hint nhỏ
  const back = card?.back ?? "—";
  const hint = card?.hint ? `\n\n(Hint: ${card.hint})` : "";
  flashBack.textContent = back + hint;

  flashcard.classList.toggle("is-flipped", !!study.flipped);
}

function goPrev(opts = { speak: true }){
  if (!study.order.length) return;

  if (randomMode) study.idx = pickRandomIndex();
  else study.idx = (study.idx - 1 + study.order.length) % study.order.length;

  study.flipped = false;
  renderStudyCard();

  if (opts.speak) speakFront();
}

function goNext(opts = { speak: true }){
  if (!study.order.length) return;

  if (randomMode) study.idx = pickRandomIndex();
  else study.idx = (study.idx + 1) % study.order.length;

  study.flipped = false;
  renderStudyCard();

  if (opts.speak) speakFront();
}

function flipCard(){
  if (!study.order.length) return;
  study.flipped = !study.flipped;
  renderStudyCard();
}

$("#btnPrev").addEventListener("click", () => goPrev({ speak: true }));
$("#btnNext").addEventListener("click", () => goNext({ speak: true }));
$("#btnFlip").addEventListener("click", flipCard);
flashcard.addEventListener("click", flipCard);

$("#btnShuffle").addEventListener("click", () => {
  setupStudy(studyDeckSelect.value, true);
  renderStudyCard();
  // shuffle xong, nói front cho tiện
  speakFront();
});

$("#btnRandom").addEventListener("click", () => {
  randomMode = !randomMode;
  $("#btnRandom").textContent = randomMode ? "🎲 Random: ON" : "🎲 Random: OFF";
});

studyDeckSelect.addEventListener("change", () => {
  stopSpeak(tts);
  setupStudy(studyDeckSelect.value, false);
  renderStudyCard();
});

// keyboard shortcuts
window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const activePanel = panels.find(p => !p.classList.contains("hidden"))?.dataset.panel;
  if (activePanel !== "study") return;

  if (e.code === "Space"){
    e.preventDefault();
    flipCard();
  }else if (e.code === "ArrowLeft"){
    e.preventDefault();
    goPrev({ speak: true });
  }else if (e.code === "ArrowRight"){
    e.preventDefault();
    goNext({ speak: true });
  }else if (e.code === "KeyR"){
    randomMode = !randomMode;
    $("#btnRandom").textContent = randomMode ? "🎲 Random: ON" : "🎲 Random: OFF";
  }else if (e.code === "KeyS"){
    e.preventDefault();
    speakBack(); // manual speak back
  }
});

// ---------- autoplay ----------
let autoplayTimer = null;
let autoplayMs = 3000;

const autoplaySpeed = $("#autoplaySpeed");
const btnAutoplay = $("#btnAutoplay");

if (autoplaySpeed){
  autoplayMs = Number(autoplaySpeed.value) || 3000;
  autoplaySpeed.addEventListener("change", () => {
    autoplayMs = Number(autoplaySpeed.value) || 3000;
    if (autoplayTimer) startAutoplay(); // restart
  });
}
if (btnAutoplay) btnAutoplay.addEventListener("click", toggleAutoplay);

function stopAutoplay(){
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = null;
  if (btnAutoplay) btnAutoplay.textContent = "▶ Auto";
}

function startAutoplay(){
  stopAutoplay();
  if (btnAutoplay) btnAutoplay.textContent = "⏸ Auto";
  autoplayTimer = setInterval(() => {
    goNext({ speak: false }); // tránh đọc 2 lần
    speakFront();            // autoplay tự đọc mặt trước
  }, autoplayMs);
  // đọc ngay thẻ hiện tại để user biết
  speakFront();
}

function toggleAutoplay(){
  if (autoplayTimer) stopAutoplay();
  else startAutoplay();
}

// ---------- Pomodoro ----------
let pomoTimer = null;
let pomoMode = "work"; // work | break
let workMin = 25;
let breakMin = 5;
let remainingSec = workMin * 60;

const pomoLabel = $("#pomoLabel");
const pomoTime = $("#pomoTime");
const btnPomoStart = $("#btnPomoStart");
const btnPomoReset = $("#btnPomoReset");
const pomoPreset = $("#pomoPreset");

function fmtTime(sec){
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function renderPomo(){
  if (pomoLabel) pomoLabel.textContent = `Pomodoro: ${pomoMode === "work" ? "học" : "nghỉ"}`;
  if (pomoTime) pomoTime.textContent = fmtTime(remainingSec);
}
function stopPomo(){
  if (pomoTimer) clearInterval(pomoTimer);
  pomoTimer = null;
  if (btnPomoStart) btnPomoStart.textContent = "Start";
}
function startPomo(){
  if (pomoTimer) return;
  if (btnPomoStart) btnPomoStart.textContent = "Pause";
  pomoTimer = setInterval(() => {
    remainingSec--;
    if (remainingSec <= 0){
      // switch
      pomoMode = (pomoMode === "work") ? "break" : "work";
      remainingSec = (pomoMode === "work" ? workMin : breakMin) * 60;
    }
    renderPomo();
  }, 1000);
}
function togglePomo(){
  if (pomoTimer) stopPomo();
  else startPomo();
}
function resetPomo(){
  stopPomo();
  pomoMode = "work";
  remainingSec = workMin * 60;
  renderPomo();
}
if (pomoPreset){
  const [w,b] = pomoPreset.value.split(",").map(Number);
  workMin = w; breakMin = b; remainingSec = workMin * 60;
  pomoPreset.addEventListener("change", () => {
    const [w2,b2] = pomoPreset.value.split(",").map(Number);
    workMin = w2; breakMin = b2;
    resetPomo();
  });
}
if (btnPomoStart) btnPomoStart.addEventListener("click", togglePomo);
if (btnPomoReset) btnPomoReset.addEventListener("click", resetPomo);
renderPomo();

// ---------- TTS init ----------
const tts = createTts();
initTtsUI(tts, {
  btnSpeak: $("#btnSpeak"),
  voiceSelect: $("#voiceSelect"),
  rateSelect: $("#rateSelect"),
  onSpeakBack: () => speakBack(), // manual: đọc mặt sau
});

// ---------- Import tab ----------
function renderImport(){
  importDeckSelect.innerHTML = "";
  for (const d of state.decks){
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    importDeckSelect.appendChild(opt);
  }
  importDeckSelect.value = state.activeDeckId ?? state.decks[0]?.id ?? "";
  importResult.textContent = "";
}

$("#btnDownloadSample").addEventListener("click", () => {
  const sample = `front,back,tag,hint
apple,quả táo,english,"trái cây"
book,quyển sách,english,"đồ vật"
"thank you","cảm ơn",phrase,"lịch sự"
`;
  downloadText("flashcards_sample.csv", sample, "text/csv;charset=utf-8");
});

$("#btnImport").addEventListener("click", () => {
  const deckId = importDeckSelect.value;
  const deck = getDeckById(deckId);
  if (!deck) return alert("Deck không tồn tại.");

  const { added, skipped } = importCardsFromCsv(deck, csvText.value);
  saveAndRenderDeckDetail();

  importResult.textContent = `Đã import: ${added} thẻ${skipped ? ` • Bỏ qua: ${skipped}` : ""}.`;
  csvText.value = "";
});

// ---------- Settings: backup/restore ----------
btnExportJson.addEventListener("click", () => {
  const { filename, data } = exportJson(state);
  downloadText(filename, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
  backupMsg.textContent = "Đã export JSON.";
});

let pendingImportJson = null;

jsonFileInput.addEventListener("change", async () => {
  const file = jsonFileInput.files?.[0];
  if (!file) return;

  try{
    const text = await file.text();
    pendingImportJson = JSON.parse(text);
  }catch{
    pendingImportJson = null;
    alert("File JSON không hợp lệ.");
    jsonFileInput.value = "";
    return;
  }

  dlgRestore.showModal();
});

dlgRestore.addEventListener("close", () => {
  // reset input
  jsonFileInput.value = "";
});

$("#btnRestoreOverwrite").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingImportJson) return;
  const ok = confirm("Ghi đè sẽ xóa dữ liệu hiện tại. Chắc chưa?");
  if (!ok) return;

  state = restoreOverwrite(pendingImportJson);
  saveState(state);
  pendingImportJson = null;
  backupMsg.textContent = "Đã khôi phục (ghi đè).";
  dlgRestore.close();
  renderAll();
});

$("#btnRestoreMerge").addEventListener("click", (e) => {
  e.preventDefault();
  if (!pendingImportJson) return;

  state = restoreMerge(state, pendingImportJson);
  saveState(state);
  pendingImportJson = null;
  backupMsg.textContent = "Đã khôi phục (gộp).";
  dlgRestore.close();
  renderAll();
});

btnResetAll.addEventListener("click", () => {
  const ok = confirm("Reset sẽ xóa toàn bộ dữ liệu trên máy. Chắc chưa?");
  if (!ok) return;
  localStorage.clear();
  location.reload();
});

// ---------- init ----------
initTheme();
renderAll();
showTab("decks");
