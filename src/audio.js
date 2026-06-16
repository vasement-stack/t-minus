// T-Minus Audio Engine v2
// Interstellar-style: pipe organ drones + deep bass pulse + clock ticks
// Rocket Man ending: ascending piano + string swell

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// ── 自動播放保護 ──────────────────────────────────────────────────────────────
// 瀏覽器要求使用者互動後才能播音樂。
// pendingTheme 記錄「還沒互動就呼叫 Music.play()」的主題，
// 等到第一次 touch/click 後再補播。
let pendingTheme = null;
let userInteracted = false;

function onFirstInteraction() {
  if (userInteracted) return;
  userInteracted = true;
  if (ctx && ctx.state === "suspended") ctx.resume();
  if (pendingTheme) {
    const theme = pendingTheme;
    pendingTheme = null;
    Music.play(theme, true);
  }
}

// DOM 事件已移除——音樂改由 Music.play() 直接用原生 <audio> 播放，
// 不需要 userInteracted gate（原生 audio 在使用者互動的 call stack 內可直接播）

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// ─── Low-level helpers ─────────────────────────────────────────────────────────
function osc(type, freq, start, dur, gain = 0.2, detune = 0) {
  const c = getCtx(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  g.gain.setValueAtTime(gain, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  o.connect(g); g.connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
}

function noise(dur, gain = 0.12, filterFreq = 1200, filterType = "bandpass") {
  const c = getCtx(), buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = filterType; f.frequency.value = filterFreq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + dur + 0.05);
}

// ─── SFX ───────────────────────────────────────────────────────────────────────
export const SFX = {
  windowOpen()    { [523,659,784].forEach((f,i)=>osc("sine",f,i*.08,.35,.16)); },
  chargeStart()   {
    const c=getCtx(),o=c.createOscillator(),g=c.createGain();
    o.type="sawtooth"; o.frequency.setValueAtTime(55,c.currentTime); o.frequency.linearRampToValueAtTime(160,c.currentTime+2.5);
    g.gain.setValueAtTime(0.05,c.currentTime); g.gain.linearRampToValueAtTime(0.12,c.currentTime+2.5);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+2.5);
  },
  chargeStop()    { osc("square",220,0,.08,.1); },
  ignition()      {
    noise(2.2,.38,160); noise(1.8,.22,80);
    osc("sawtooth",40,0,1.8,.32); osc("sawtooth",55,.1,1.6,.2); osc("sine",80,.2,1.2,.14);
    for(let i=0;i<10;i++) setTimeout(()=>noise(.06,.15+Math.random()*.1,300+Math.random()*600),i*80);
  },
  liftoff()       { const c=getCtx(),o=c.createOscillator(),g=c.createGain(); o.type="sawtooth"; o.frequency.setValueAtTime(55,c.currentTime); o.frequency.exponentialRampToValueAtTime(350,c.currentTime+1.4); g.gain.setValueAtTime(.2,c.currentTime); g.gain.exponentialRampToValueAtTime(.001,c.currentTime+1.4); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+1.5); noise(1.4,.18,500); },
  cloudHit()      { osc("sine",100,0,.3,.28); noise(.3,.15,700); },
  lightning()     { noise(.07,.55,9000); noise(.14,.38,3000); osc("square",160,0,.1,.28); osc("sine",380,0,.05,.3); },
  boosterTap()    { osc("square",200,0,.06,.14); },
  boosterSeparate(){ [330,392,523].forEach((f,i)=>osc("sine",f,i*.07,.32,.2)); noise(.2,.1,500); },
  stageComplete() { [523,659,784,1047].forEach((f,i)=>osc("sine",f,i*.1,.5,.16)); },
  angleLock()     { osc("sine",880,0,.1,.2); osc("sine",1100,.1,.14,.16); },
  brakeOn()       { noise(.15,.1,1000); osc("sawtooth",160,0,.15,.08); },
  landingConfirmed(){ [392,523,659,784].forEach((f,i)=>osc("sine",f,i*.09,.45,.18)); },
  uiTap()         { osc("sine",620,0,.07,.08); },
  countdownBeep(urgent=false){ osc("sine",urgent?900:660,0,.11,urgent?.22:.14); },

  // Mission fail — deep descending drones like Interstellar failure motif
  missionFail() {
    [440,360,280,200].forEach((f,i)=>osc("sawtooth",f,i*.2,.5,.16));
    osc("sine",80,0,.9,.2); noise(.8,.1,200);
  },

  missionSuccess() {
    if (successAudio) { successAudio.pause(); successAudio = null; }
    const el = new Audio(MUSIC_SRC("sunlit_victory"));
    el.loop = false;
    el.volume = 0.75;
    successAudio = el;
    el.play().catch(() => {});
  },

  stopSuccess() {
    if (successAudio) { successAudio.pause(); successAudio.src = ""; successAudio = null; }
  },
};

// ─── Background Music Engine ───────────────────────────────────────────────────
// 全程用原生 <audio> 元素播放，不走 Web Audio API（避免 autoplay 限制）
// flying_music.ogg → 全程循環
// sunlit_victory    → 成功結算疊加，不循環

let bgAudio = null;       // 飛行背景音樂
let successAudio = null;  // 勝利音樂
let currentTheme = null;

const MUSIC_SRC = (file) => `/audio/${file}.mp3`;

export const Music = {
  play() {
    // 已在播就完全不動，保持當前播放位置
    if (bgAudio && !bgAudio.paused) return;
    // 曾被暫停（例如頁面切換）→ 繼續播
    if (bgAudio && bgAudio.paused) { bgAudio.play().catch(()=>{}); return; }
    // 第一次啟動
    const el = new Audio(MUSIC_SRC("flying_music"));
    el.loop = true;
    el.volume = 1.0;
    bgAudio = el;
    el.play().catch(() => {
      const retry = () => { el.play().catch(()=>{}); };
      document.addEventListener("touchstart", retry, { once: true });
      document.addEventListener("click", retry, { once: true });
    });
  },

  // 背景音樂全程不停，這兩個方法保留 API 但不做任何事
  stop() {},
  fadeOut() {},

  forceStop() {
    // 只有真的要停（例如：未來需要）才用這個
    if (bgAudio) { bgAudio.pause(); bgAudio.src = ""; bgAudio = null; }
  },

  setVolume(v) { if (bgAudio) bgAudio.volume = Math.max(0, Math.min(1, v)); },
};

export function initAudio() {
  // 第一次呼叫時嘗試啟動音樂（在使用者互動的 call stack 內）
  Music.play();
}