// tts.js
// TTS chỉ đọc "word" (tiếng Anh). Không đọc tiếng Việt.

const VOICE_KEY = "swm_voice_uri";
const RATE_KEY = "swm_tts_rate";

export function createTts(){
  const enabled = ("speechSynthesis" in window) && ("SpeechSynthesisUtterance" in window);
  return {
    enabled,
    voiceURI: localStorage.getItem(VOICE_KEY) || "",
    rate: Number(localStorage.getItem(RATE_KEY) || "1.0"),
  };
}

export function stopSpeak(tts){
  if (!tts?.enabled) return;
  window.speechSynthesis.cancel();
}

export function speakText(tts, text){
  if (!tts?.enabled) return;
  const clean = String(text || "").trim();
  if (!clean) return;

  stopSpeak(tts);

  const u = new SpeechSynthesisUtterance(clean);
  u.rate = tts.rate;

  const voices = window.speechSynthesis.getVoices?.() || [];
  if (tts.voiceURI){
    const v = voices.find(x => x.voiceURI === tts.voiceURI);
    if (v) u.voice = v;
  }else{
    const vEn = voices.find(x => (x.lang || "").toLowerCase().startsWith("en"));
    if (vEn) u.voice = vEn;
  }

  window.speechSynthesis.speak(u);
}

export function initTtsUI(tts, { btnSpeak, voiceSelect, rateSelect, onSpeakWord }){
  if (rateSelect){
    rateSelect.value = String(tts.rate);
    rateSelect.addEventListener("change", () => {
      tts.rate = Number(rateSelect.value) || 1.0;
      localStorage.setItem(RATE_KEY, String(tts.rate));
    });
  }

  if (!tts.enabled){
    if (btnSpeak){ btnSpeak.disabled = true; btnSpeak.textContent = "🔇 Trình duyệt không hỗ trợ TTS"; }
    if (voiceSelect) voiceSelect.disabled = true;
    if (rateSelect) rateSelect.disabled = true;
    return;
  }

  function fillVoices(){
    if (!voiceSelect) return;
    const voices = window.speechSynthesis.getVoices?.() || [];
    voiceSelect.innerHTML = "";

    const optAuto = document.createElement("option");
    optAuto.value = "";
    optAuto.textContent = "Tự chọn (khuyến nghị)";
    voiceSelect.appendChild(optAuto);

    for (const v of voices){
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} • ${v.lang}`;
      voiceSelect.appendChild(opt);
    }

    voiceSelect.value = tts.voiceURI || "";
  }

  fillVoices();
  window.speechSynthesis.onvoiceschanged = fillVoices;

  if (voiceSelect){
    voiceSelect.addEventListener("change", () => {
      tts.voiceURI = voiceSelect.value;
      localStorage.setItem(VOICE_KEY, tts.voiceURI);
    });
  }

  if (btnSpeak){
    btnSpeak.addEventListener("click", () => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      onSpeakWord?.();
    });
  }
}
