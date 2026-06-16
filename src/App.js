// T-Minus v6 — with audio
// Copy audio.js to src/audio.js first, then use this as src/App.js

import { useState, useEffect, useRef } from "react";
import { SFX, Music, initAudio } from "./audio";
import { uploadSurvivalScore, getSurvivalLeaderboard, uploadMissionScore, getMissionLeaderboard } from "./firebase";

const GW = 390, GH = 700;
const ROCKET_SCREEN_X = GW / 2;
const ROCKET_SCREEN_Y = GH * 0.62;

// Global test mode: when true, obstacles are minimal so you can walk through
// the whole game flow. Toggle from the home screen. Turn OFF to see real difficulty/effects.
const TEST = { on: false };

const C = {
  bg:"#06060F", border:"rgba(255,255,255,0.07)",
  amber:"#F5A623", amberGlow:"#FF8C00",
  green:"#34D399", red:"#EF4444",
  purple:"#7C3AED", purpleL:"#A78BFA",
  blue:"#60A5FA",
  ink:"#E8EDF2", inkDim:"#7A8EA0",
  panel:"rgba(6,9,20,0.88)",
};

// Rocket images live in public/rockets/. Each PNG already includes its own flame,
// so we DON'T draw a separate flame for the in-game rocket sprite.
// aspect = width/height of the source PNG (used to size correctly).
// Each rocket has 4 AI damage-stage PNGs: rocket-t{N}-{0..3}.png
//   0 = pristine, 1 = light, 2 = moderate, 3 = heavy battle damage.
// aspect is shared across the 4 stages (normalized onto a common canvas so the
// rocket doesn't change size as it takes damage).
const ROCKETS = [
  { id:0, name:"T-1 曙光", imgBase:"/rockets/rocket-t1", aspect:0.4448, color:"#E0533B", cost:0,     osc:0.018 },
  { id:1, name:"T-2 蒼隼", imgBase:"/rockets/rocket-t2", aspect:0.3246, color:"#4FA3E0", cost:550,   osc:0.024 },
  { id:2, name:"T-3 獵戶", imgBase:"/rockets/rocket-t3", aspect:0.3903, color:"#E08A3B", cost:1650,  osc:0.030 },
  { id:3, name:"T-4 巨神", imgBase:"/rockets/rocket-t4", aspect:0.3235, color:"#9B6BD6", cost:9900,  osc:0.038 },
  { id:4, name:"T-5 永恆", imgBase:"/rockets/rocket-t5", aspect:0.3504, color:"#2DD4BF", cost:35200, osc:0.048 },
];
// Resolve the sprite path for a given wear stage (0-3).
function rocketSrc(rocket, wear=0){ return `${rocket.imgBase}-${Math.max(0,Math.min(3,wear|0))}.png`; }

// Renders a rocket PNG at a given display HEIGHT (px), preserving aspect ratio.
// The PNG already contains the flame AND the battle damage (AI art per wear stage),
// so we just pick the right sprite and add an optional glow. No CSS damage overlays.
// wear: 0=pristine, 1=light, 2=moderate, 3=heavy.
function RocketImg({ rocket, height=120, glow=0, tilt=0, wear=0, style={} }) {
  const w = height * rocket.aspect;
  const src = rocketSrc(rocket, wear);
  const glowF = glow > 0 ? `drop-shadow(0 0 ${glow}px ${rocket.color}cc)` : "";
  return (
    <div style={{ position:"relative", width:w, height, transform: tilt?`rotate(${tilt}deg)`:undefined, transition:"transform 0.25s ease-out", pointerEvents:"none", userSelect:"none", ...style }}>
      <img src={src} alt={rocket.name} draggable={false}
        style={{ width:"100%", height:"100%", objectFit:"contain", filter:glowF||undefined, display:"block" }}/>
    </div>
  );
}

// Wear advances ONE stage per flight: 0 uses=新, 1=輕損, 2=中損, 3+=重損.
function wearLevel(uses){ return Math.max(0, Math.min(3, uses|0)); }
const WEAR_LABEL=["全新","輕微戰損","中度戰損","嚴重戰損"];

// Each stage: { name, type }. type maps to one of 4 gameplay engines:
//   "charge" = 蓄力發射 (PreLaunch-style)
//   "tap"    = 時機/連點 (Booster-style)
//   "dodge"  = 衝刺閃避 (debris-style)
//   "land"   = 指針著陸 (orbit-style)
const PLANETS = [
  { id:0, name:"月球", emoji:"🌙", color:"#C0C0C0", unlockRocket:0, baseScore:500, stages:[
    { name:"火箭升空", type:"charge" },
    { name:"推進器分離", type:"tap" },
    { name:"漫步月球", type:"dodge" },
    { name:"建立月球基地", type:"tap" },
    { name:"尋找月球水冰", type:"land" },
  ]},
  { id:1, name:"火星", emoji:"🔴", color:"#EF4444", unlockRocket:1, baseScore:1500, stages:[
    { name:"恐怖七分鐘降落", type:"land" },
    { name:"地下鑽探水源", type:"tap" },
    { name:"遭遇特大沙塵暴", type:"dodge" },
    { name:"太陽能板清理", type:"tap" },
    { name:"奧林帕斯山挑戰", type:"dodge" },
    { name:"尋找遠古生命跡象", type:"tap" },
  ]},
  { id:2, name:"金星", emoji:"🟡", color:"#F59E0B", unlockRocket:1, baseScore:2500, stages:[
    { name:"切入金星軌道", type:"charge" },
    { name:"穿越硫酸雲層", type:"dodge" },
    { name:"高壓著陸抗衡", type:"land" },
    { name:"探測器散熱維護", type:"tap" },
    { name:"火山噴發逃離", type:"dodge" },
    { name:"溫室效應調查", type:"tap" },
    { name:"極限地表逃逸", type:"charge" },
  ]},
  { id:3, name:"木星", emoji:"🟠", color:"#FB923C", unlockRocket:2, baseScore:4500, stages:[
    { name:"強磁場防護", type:"tap" },
    { name:"大紅斑風暴衝浪", type:"dodge" },
    { name:"引力彈弓加速", type:"charge" },
    { name:"冰月亮著陸", type:"land" },
    { name:"穿透厚冰層鑽探", type:"tap" },
    { name:"深海潛艇操控", type:"dodge" },
    { name:"尋找深海熱泉生命", type:"tap" },
    { name:"核心壓力逃離", type:"charge" },
  ]},
  { id:4, name:"土星", emoji:"🪐", color:"#D97706", unlockRocket:3, baseScore:7000, stages:[
    { name:"土星環外圍減速", type:"tap" },
    { name:"冰塊障礙生死時速", type:"dodge" },
    { name:"光環塵埃收集", type:"tap" },
    { name:"穿越泰坦大氣層", type:"dodge" },
    { name:"甲烷湖泊降落", type:"land" },
    { name:"液態甲烷航行", type:"dodge" },
    { name:"尋找碳氫生命", type:"tap" },
    { name:"間歇泉噴發躲避", type:"dodge" },
    { name:"光環核心逃逸", type:"charge" },
  ]},
  { id:5, name:"天王星", emoji:"🔵", color:"#7DD3FC", unlockRocket:3, baseScore:11000, stages:[
    { name:"側向軌道切入", type:"charge" },
    { name:"冰晶風暴穿越", type:"dodge" },
    { name:"鑽石海洋探測", type:"tap" },
    { name:"極低溫能源調配", type:"tap" },
    { name:"天王星環碎石陣", type:"dodge" },
    { name:"降落米蘭達衛星", type:"land" },
    { name:"大峽谷極限滑翔", type:"dodge" },
    { name:"磁場異常修正", type:"tap" },
    { name:"微弱陽光採集", type:"tap" },
    { name:"啟動深空加速", type:"charge" },
  ]},
  { id:6, name:"海王星", emoji:"🔵", color:"#3B82F6", unlockRocket:4, baseScore:16000, stages:[
    { name:"超音速風暴逆風行", type:"dodge" },
    { name:"捕捉大黑斑", type:"land" },
    { name:"高壓鑽石雨收集", type:"tap" },
    { name:"軌道修正偏離", type:"tap" },
    { name:"極寒系統除冰", type:"tap" },
    { name:"降落海衛一", type:"land" },
    { name:"氮氣冰火山躲避", type:"dodge" },
    { name:"微弱光線雷達導航", type:"dodge" },
    { name:"深空通訊天線修復", type:"tap" },
    { name:"冰層塌陷逃生", type:"charge" },
    { name:"折返！目標太陽", type:"charge" },
  ]},
  { id:7, name:"太陽", emoji:"☀️", color:"#FB7185", unlockRocket:4, isBoss:true, baseScore:50000, stages:[
    { name:"耐熱護盾全開", type:"tap" },
    { name:"日冕物質拋射衝刺", type:"dodge" },
    { name:"太陽風暴電磁修復", type:"tap" },
    { name:"太陽能極限充電", type:"tap" },
    { name:"強行進入太陽黑子", type:"land" },
    { name:"測量太陽耀斑", type:"tap" },
    { name:"重力井深淵掙扎", type:"tap" },
    { name:"日珥穿梭", type:"dodge" },
    { name:"光球層穿透", type:"dodge" },
    { name:"量子數據傳輸", type:"tap" },
    { name:"熔毀倒數逃離", type:"charge" },
    { name:"夸父追日", type:"charge" },
  ]},
];

// Cumulative clear-score needed to conquer each planet (and unlock the next).
// Rises with difficulty: moon two 80% passes (160) clears it; later planets need more.
const UNLOCK_THRESHOLD = [150, 180, 210, 250, 290, 330, 380, 999];

// ═══ SKINNING ═══════════════════════════════════════════════════════════════
// Per-planet visual theme: background sky, star tint, and the look of the
// "dodge" obstacles for that planet. Lets the same 4 engines feel different.
// debris.render(d) returns inline style for a falling-hazard chip.
const PLANET_THEME = {
  0: { sky:["#0a0a14","#1a1a26"], star:"#ffffff", debris:{ img:"/assets/obs_moon_rock.png" } },
  1: { sky:["#3a1508","#5a2410"], star:"#ffcaa0", debris:{ img:"/assets/obs_mars_dust.png" } },
  2: { sky:["#3a3000","#5a4a08","#2a2200"], star:"#fff0a0", debris:{ img:"/assets/obs_venus_acid.png" } },
  3: { sky:["#3a2510","#5a3a1a","#2a1a08"], star:"#ffd9a0", debris:{ img:"/assets/obs_jupiter_storm.png" } },
  4: { sky:["#1a1a2e","#2a2a40"], star:"#e0e8ff", debris:{ img:"/assets/obs_saturn_ice.png" } },
  5: { sky:["#0a2a3a","#143a4a"], star:"#c0f0ff", debris:{ img:"/assets/obs_uranus_crystal.png" } },
  6: { sky:["#0a1a4a","#102a5a"], star:"#a0c0ff", debris:{ img:"/assets/obs_neptune_vortex.png" } },
  7: { sky:["#4a1500","#6a2a00","#3a1000"], star:"#ffd060", debris:{ img:"/assets/obs_sun_plasma.png" } },
};
function themeOf(planetId){ return PLANET_THEME[planetId] || PLANET_THEME[0]; }

// Second layer: specific tasks get their own obstacle art (overrides planet default).
const OBSTACLE_SKINS = {
  "遭遇特大沙塵暴": { img:"/assets/task_mars_sandstorm.png" },
  "奧林帕斯山挑戰": { img:"/assets/task_mars_lava_rock.png" },
  "穿越硫酸雲層":   { img:"/assets/task_venus_sulfuric_cloud.png" },
  "火山噴發逃離":   { img:"/assets/task_mars_lava_rock.png" },
  "大紅斑風暴衝浪": { img:"/assets/task_jupiter_red_spot.png" },
  "冰塊障礙生死時速": { img:"/assets/task_saturn_ring_ice.png" },
  "冰晶風暴穿越":   { img:"/assets/task_uranus_ice_blade.png" },
  "天王星環碎石陣": { img:"/assets/task_uranus_dark_rock.png" },
  "超音速風暴逆風行": { img:"/assets/task_neptune_wind_blade.png" },
  "氮氣冰火山躲避": { img:"/assets/task_neptune_nitrogen_ice.png" },
  "日冕物質拋射衝刺": { img:"/assets/task_sun_corona_plasma.png" },
  "光球層穿透":     { img:"/assets/task_sun_granulation.png" },
  "日珥穿梭":       { img:"/assets/task_sun_prominence.png" },
};
// Resolve obstacle art: specific task art > planet default.
function debrisSkinFor(planet, stageName){ return OBSTACLE_SKINS[stageName] || themeOf(planet.id).debris; }

const ITEMS = [
  { id:"radar",       name:"天氣雷達", emoji:"📡", img:"/assets/item_radar.png",         color:C.blue,   desc:"雲層移速 -50%",   effect:"slowCloud"   },
  { id:"shield",      name:"護盾",     emoji:"🛡️", img:"/assets/item_shield.png",        color:C.green,  desc:"閃避多一格 HP",   effect:"extraHp"     },
  { id:"retry",       name:"重試卡",   emoji:"🔄", img:"/assets/item_refresh.png",       color:C.amber,  desc:"失敗自動觸發重試", effect:"retry"       },
  { id:"widen",       name:"精準導引", emoji:"🎯", img:"/assets/item_crosshair.png",     color:C.purpleL,desc:"發射缺口 +40%",   effect:"widenGap"    },
  { id:"lightning",   name:"避雷針",   emoji:"⚡", img:"/assets/item_lightning_rod.png", color:"#F472B6",desc:"免疫閃電一次",    effect:"noLightning" },
  { id:"slowland",    name:"著陸緩速", emoji:"🛬", img:"/assets/item_slowland.png",     color:"#34D399",desc:"著陸指針速度 -60%", effect:"slowLand"    },
];
const MAX_INVENTORY = 10;  // 最多持有道具數
// 每個道具適用的關卡類型（undefined = 全關適用）
const ITEM_STAGE_TYPES = {
  radar:     ["charge"],              // 天氣雷達：只在發射關有效（雲層）
  shield:    ["dodge"],               // 護盾：只在閃避關有效
  // retry 不在這裡：失敗時自動觸發，不需玩家手動選
  widen:     ["charge"],              // 精準導引：只在發射關有效
  lightning: ["charge","dodge"],      // 避雷針：發射關和大氣層閃避關
  slowland:  ["land"],                // 著陸緩速：只在著陸關有效
};
const MAX_AD_PER_DAY = 3; // 每天可看廣告次數

// 今天已看廣告次數（用 localStorage 跨 session 記錄）
function getAdCount() {
  try {
    const raw = localStorage.getItem("tminus_ad");
    if (!raw) return { count:0, date:"" };
    return JSON.parse(raw);
  } catch(e) { return { count:0, date:"" }; }
}
function saveAdCount(count) {
  const date = new Date().toDateString();
  try { localStorage.setItem("tminus_ad", JSON.stringify({ count, date })); } catch(e) {}
}
function todayAdCount() {
  const { count, date } = getAdCount();
  if (date !== new Date().toDateString()) return 0; // 新的一天重置
  return count;
}
function addAdCount() {
  const c = todayAdCount();
  saveAdCount(c + 1);
}

// ─── 玩家暱稱 ────────────────────────────────────────────────────────────────
const PLAYER_NAME_KEY = "tminus_player_name";
function getPlayerName() { try { return localStorage.getItem(PLAYER_NAME_KEY)||""; } catch(e){ return ""; } }
function savePlayerName(n) { try { localStorage.setItem(PLAYER_NAME_KEY, n); } catch(e){} }

function NameInputModal({ onConfirm }) {
  const [name,setName]=useState(getPlayerName());
  return (
    <div style={{ position:"fixed",inset:0,zIndex:200,background:"rgba(0,0,0,0.92)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui" }}>
      <div style={{ background:"#0a0f1e",border:"1px solid rgba(255,255,255,0.1)",borderRadius:20,padding:"32px 28px",width:300,textAlign:"center" }}>
        <div style={{ fontSize:32,marginBottom:12 }}>🚀</div>
        <div style={{ fontSize:16,fontWeight:800,marginBottom:6,color:"#E8EDF2" }}>設定你的暱稱</div>
        <div style={{ fontSize:11,color:"rgba(255,255,255,0.4)",marginBottom:20 }}>排行榜將顯示此名稱</div>
        <input value={name} onChange={e=>setName(e.target.value.slice(0,12))} placeholder="輸入暱稱（最多12字）" maxLength={12}
          style={{ width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:10,padding:"10px 14px",color:"#E8EDF2",fontSize:14,outline:"none",boxSizing:"border-box",marginBottom:16,fontFamily:"system-ui" }}/>
        <button onClick={()=>{ if(name.trim()){ savePlayerName(name.trim()); onConfirm(name.trim()); } }} disabled={!name.trim()}
          style={{ width:"100%",padding:"13px 0",background:name.trim()?"linear-gradient(135deg,#F5A623,#FF8C00)":"rgba(255,255,255,0.1)",border:"none",borderRadius:12,color:name.trim()?"#000":"rgba(255,255,255,0.3)",fontSize:14,fontWeight:800,cursor:name.trim()?"pointer":"not-allowed" }}>
          確認
        </button>
      </div>
    </div>
  );
}

// ─── 排行榜頁面 ──────────────────────────────────────────────────────────────
function LeaderboardPage({ mode="survival", planetId=0, planetName="", onBack }) {
  const [tab,setTab]=useState(mode==="survival"?"survival":"mission");
  const [selectedPlanet,setSelectedPlanet]=useState(mode==="mission"?{id:planetId,name:planetName,emoji:PLANETS[planetId]?.emoji||""}:null);
  const [scores,setScores]=useState([]);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    if(tab==="survival"){
      setLoading(true); setScores([]);
      getSurvivalLeaderboard(10).then(s=>{ setScores(s); setLoading(false); }).catch(()=>setLoading(false));
    } else if(tab==="mission" && selectedPlanet){
      setLoading(true); setScores([]);
      getMissionLeaderboard(selectedPlanet.id,10).then(s=>{ setScores(s); setLoading(false); }).catch(()=>setLoading(false));
    }
  },[tab,selectedPlanet]);

  return (
    <div style={{ background:"#010208",height:"100dvh",maxHeight:"100dvh",fontFamily:"system-ui",color:"#E8EDF2",display:"flex",flexDirection:"column",position:"relative",overflow:"hidden" }}>
      <StarsBg density={1.2}/>
      {/* Header */}
      <div style={{ padding:"14px 20px 0",display:"flex",alignItems:"center",gap:10,position:"relative",zIndex:2 }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"#7A8EA0",fontSize:22,cursor:"pointer",padding:0 }}>←</button>
        <span style={{ fontWeight:700,fontSize:13,letterSpacing:1,fontFamily:"monospace" }}>排行榜</span>
      </div>
      {/* Tab 切換 */}
      <div style={{ display:"flex",gap:8,padding:"10px 16px",position:"relative",zIndex:2,borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
        <button onClick={()=>{ setTab("survival"); setSelectedPlanet(null); }}
          style={{ flex:1,padding:"8px 0",borderRadius:10,border:`1px solid ${tab==="survival"?"rgba(52,211,153,0.5)":"rgba(255,255,255,0.08)"}`,background:tab==="survival"?"rgba(52,211,153,0.12)":"transparent",color:tab==="survival"?"#34D399":"rgba(255,255,255,0.4)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
          <img src="/assets/ui_rocket_launch.png" alt="" style={{width:14,height:14,objectFit:"contain"}}/> 生存挑戰
        </button>
        <button onClick={()=>setTab("mission")}
          style={{ flex:1,padding:"8px 0",borderRadius:10,border:`1px solid ${tab==="mission"?"rgba(245,166,35,0.5)":"rgba(255,255,255,0.08)"}`,background:tab==="mission"?"rgba(245,166,35,0.1)":"transparent",color:tab==="mission"?"#F5A623":"rgba(255,255,255,0.4)",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
          <img src="/assets/ui_trophy.png" alt="" style={{width:14,height:14,objectFit:"contain"}}/> 星球任務
        </button>
      </div>

      <div style={{ flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"12px 16px 40px",position:"relative",zIndex:2 }}>
        {/* 星球任務：先選星球 */}
        {tab==="mission" && !selectedPlanet && (
          <div>
            <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:2,fontFamily:"monospace",marginBottom:12 }}>選擇星球查看排行榜</div>
            {PLANETS.map(p=>(
              <button key={p.id} onClick={()=>setSelectedPlanet(p)}
                style={{ width:"100%",display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:"rgba(255,255,255,0.04)",border:`1px solid ${p.color}33`,borderRadius:12,cursor:"pointer",textAlign:"left" }}>
                <span style={{ fontSize:28 }}>{p.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13,fontWeight:700,color:"#E8EDF2" }}>{p.name}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace" }}>{p.stages.length} 段任務</div>
                </div>
                <span style={{ color:p.color,fontSize:14 }}>▶</span>
              </button>
            ))}
          </div>
        )}

        {/* 星球任務：已選星球，顯示返回和榜單 */}
        {tab==="mission" && selectedPlanet && (
          <div>
            <button onClick={()=>{ setSelectedPlanet(null); setScores([]); }}
              style={{ display:"flex",alignItems:"center",gap:6,background:"none",border:"none",color:"rgba(255,255,255,0.4)",fontSize:12,cursor:"pointer",padding:"0 0 12px",fontFamily:"monospace" }}>
              ← {selectedPlanet.emoji} {selectedPlanet.name} 任務榜
            </button>
            {loading&&<div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",padding:40,fontFamily:"monospace" }}>載入中...</div>}
            {!loading&&scores.length===0&&<div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",padding:40,fontFamily:"monospace" }}>尚無紀錄</div>}
            {scores.map((s,i)=>(
              <div key={s._id||i} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:"rgba(255,255,255,0.04)",border:`1px solid ${i===0?"rgba(245,166,35,0.4)":i===1?"rgba(192,192,192,0.3)":i===2?"rgba(205,127,50,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:12 }}>
                <div style={{ width:28,textAlign:"center" }}>
                  {i===0?<img src="/assets/ui_gold_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:i===1?<img src="/assets/ui_silver_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:i===2?<img src="/assets/ui_bronze_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:<span style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",fontWeight:900}}>{i+1}</span>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13,fontWeight:700 }}>{s.name}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",marginTop:2 }}>{s.pct}% 達成</div>
                </div>
                <div style={{ fontSize:16,fontWeight:900,color:"#F5A623",fontFamily:"monospace" }}>{s.score?.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {/* 生存挑戰榜 */}
        {tab==="survival" && (
          <div>
            {loading&&<div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",padding:40,fontFamily:"monospace" }}>載入中...</div>}
            {!loading&&scores.length===0&&<div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",padding:40,fontFamily:"monospace" }}>尚無紀錄</div>}
            {scores.map((s,i)=>(
              <div key={s._id||i} style={{ display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,background:"rgba(255,255,255,0.04)",border:`1px solid ${i===0?"rgba(245,166,35,0.4)":i===1?"rgba(192,192,192,0.3)":i===2?"rgba(205,127,50,0.3)":"rgba(255,255,255,0.06)"}`,borderRadius:12 }}>
                <div style={{ width:28,textAlign:"center" }}>
                  {i===0?<img src="/assets/ui_gold_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:i===1?<img src="/assets/ui_silver_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:i===2?<img src="/assets/ui_bronze_medal.png" alt="" style={{width:24,height:24,objectFit:"contain"}}/>:<span style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",fontWeight:900}}>{i+1}</span>}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13,fontWeight:700 }}>{s.name}</div>
                  <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",marginTop:2 }}>{s.elapsed}s · Wave {s.wave}</div>
                </div>
                <div style={{ fontSize:16,fontWeight:900,color:"#F5A623",fontFamily:"monospace" }}>{s.score?.toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 生存挑戰 ─────────────────────────────────────────────────────────────────
const SURVIVAL_DEBRIS_SKINS=["/assets/obs_moon_rock.png","/assets/obs_mars_dust.png","/assets/obs_jupiter_storm.png","/assets/obs_saturn_ice.png","/assets/obs_sun_plasma.png"];

function SurvivalResult({ score,elapsed,wave,rocket,onBack,onRestart,onShowLeaderboard }) {
  const [name,setName]=useState(getPlayerName());
  const [rank,setRank]=useState(null);
  const [uploading,setUploading]=useState(false);
  const [uploaded,setUploaded]=useState(false);

  const doUpload=()=>{
    if(!name.trim()||uploading)return;
    savePlayerName(name.trim());
    setUploading(true);
    uploadSurvivalScore({ name:name.trim(),score,elapsed,wave,rocketId:rocket?.id??0 })
      .then(r=>{ setRank(r); setUploaded(true); setUploading(false); })
      .catch(()=>{ setUploaded(true); setUploading(false); });
  };

  return (
    <div style={{ position:"absolute",inset:0,zIndex:50,background:"rgba(0,0,0,0.93)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui" }}>
      <div style={{ textAlign:"center",padding:"0 24px",width:"100%",maxWidth:320 }}>
        <img src="/assets/ui_explosion.png" alt="" style={{width:80,height:80,objectFit:"contain",marginBottom:8}}/>
        <div style={{ fontSize:22,fontWeight:800,color:"#EF4444",marginBottom:4 }}>火箭墜毀！</div>
        <div style={{ background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:16,padding:"20px 24px",marginBottom:12 }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:12 }}>
            <div><div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1 }}>存活時間</div><div style={{ fontSize:32,fontWeight:900,color:"#34D399",fontFamily:"monospace" }}>{elapsed}s</div></div>
            <div style={{ textAlign:"right" }}><div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1 }}>波次</div><div style={{ fontSize:32,fontWeight:900,color:"#F5A623",fontFamily:"monospace" }}>W{wave}</div></div>
          </div>
          <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:12,marginBottom:12 }}>
            <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,marginBottom:4 }}>總分</div>
            <div style={{ fontSize:28,fontWeight:900,color:"#E8EDF2",fontFamily:"monospace" }}>{score.toLocaleString()}</div>
          </div>
          {!uploaded ? (
            <div>
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.4)",marginBottom:6,fontFamily:"monospace" }}>輸入名字上傳排行榜</div>
              <div style={{ display:"flex",gap:8 }}>
                <input value={name} onChange={e=>setName(e.target.value.slice(0,12))} placeholder="你的名字" maxLength={12}
                  style={{ flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"8px 10px",color:"#E8EDF2",fontSize:13,outline:"none",fontFamily:"system-ui" }}/>
                <button onClick={doUpload} disabled={!name.trim()||uploading}
                  style={{ padding:"8px 14px",background:name.trim()&&!uploading?"linear-gradient(135deg,#F5A623,#FF8C00)":"rgba(255,255,255,0.1)",border:"none",borderRadius:8,color:name.trim()&&!uploading?"#000":"rgba(255,255,255,0.3)",fontSize:12,fontWeight:800,cursor:name.trim()&&!uploading?"pointer":"not-allowed" }}>
                  {uploading?"...":"立刻留名"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize:13,color:"#F5A623",fontWeight:700,fontFamily:"monospace" }}>
              {rank ? `🏆 全球第 ${rank} 名` : "✅ 已上傳"}
            </div>
          )}
        </div>
        <div style={{ display:"flex",gap:10 }}>
          <button onClick={onBack} style={{ flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"13px 0",color:"rgba(255,255,255,0.6)",fontSize:13,cursor:"pointer" }}>返回</button>
          <button onClick={onRestart} style={{ flex:1,background:"rgba(52,211,153,0.15)",border:"1px solid rgba(52,211,153,0.4)",borderRadius:12,padding:"13px 0",color:"#34D399",fontSize:13,fontWeight:700,cursor:"pointer" }}>再挑戰</button>
          <button onClick={()=>onShowLeaderboard("survival")} style={{ flex:1,background:"linear-gradient(135deg,#F5A623,#FF8C00)",border:"none",borderRadius:12,padding:"13px 0",color:"#000",fontSize:13,fontWeight:800,cursor:"pointer" }}><img src="/assets/ui_trophy.png" alt="" style={{width:16,height:16,objectFit:"contain",verticalAlign:"middle",marginRight:4}}/> 榜單</button>
        </div>
      </div>
    </div>
  );
}

function SurvivalMode({ rocket,wear=3,onBack,onRestart,onShowLeaderboard }) {
  const [rocketX,setRocketX]=useState(GW/2);
  const [elapsed,setElapsed]=useState(0);
  const [wave,setWave]=useState(1);
  const [debris,setDebris]=useState([]);
  const [hitFlash,setHitFlash]=useState(false);
  const [dead,setDead]=useState(false);
  const [score,setScore]=useState(0);
  const [finalElapsed,setFinalElapsed]=useState(0);
  const [finalWave,setFinalWave]=useState(1);
  const rocketXRef=useRef(GW/2),targetXRef=useRef(GW/2);
  const debrisRef=useRef([]),nextId=useRef(0);
  const doneRef=useRef(false),elapsedRef=useRef(0),waveRef=useRef(1);
  const frameRef=useRef(null),timerRef=useRef(null),spawnRef=useRef(null),containerRef=useRef(null);

  useEffect(()=>{
    doneRef.current = false; // 確保每次 mount 都重置
    Music.play("flying");
    const getWave=()=>Math.min(10,Math.floor(elapsedRef.current/30)+1);
    const getInterval=()=>Math.max(180,800-getWave()*80);
    const getFallSpeed=()=>2.5+getWave()*0.45;
    const spawn=()=>{
      if(doneRef.current)return;
      const size=24+Math.random()*32;
      const skin=SURVIVAL_DEBRIS_SKINS[Math.floor(Math.random()*SURVIVAL_DEBRIS_SKINS.length)];
      debrisRef.current.push({ id:nextId.current++,skin,x:30+Math.random()*(GW-60),y:-size,size,vx:(Math.random()-0.5)*1.8,vy:getFallSpeed()*(0.8+Math.random()*0.5),rot:Math.random()*360,vr:(Math.random()-0.5)*7 });
      spawnRef.current=setTimeout(spawn,getInterval()*(0.6+Math.random()*0.8));
    };
    spawn();
    const tick=()=>{
      if(doneRef.current)return;
      rocketXRef.current+=(targetXRef.current-rocketXRef.current)*0.22;
      rocketXRef.current=Math.max(24,Math.min(GW-24,rocketXRef.current));
      setRocketX(rocketXRef.current);
      const rx=rocketXRef.current,ry=ROCKET_SCREEN_Y;
      let hit=false;
      debrisRef.current=debrisRef.current.filter(d=>{
        d.x+=d.vx; d.y+=d.vy; d.rot+=d.vr;
        const dx=d.x-rx,dy=d.y-ry,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<d.size*0.5+22&&!d.hit){ d.hit=true; hit=true; return false; }
        return d.y<GH+60;
      });
      setDebris([...debrisRef.current]);
      if(hit){
        doneRef.current=true;
        cancelAnimationFrame(frameRef.current); clearInterval(timerRef.current); clearTimeout(spawnRef.current);
        SFX.missionFail(); setHitFlash(true);
        const fe=elapsedRef.current,fw=waveRef.current;
        setFinalElapsed(fe); setFinalWave(fw); setScore(Math.round(fe*10+fw*50));
        setTimeout(()=>setDead(true),600);
        return;
      }
      frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);
    timerRef.current=setInterval(()=>{
      elapsedRef.current+=1; setElapsed(elapsedRef.current);
      const w=getWave();
      if(w!==waveRef.current){ waveRef.current=w; setWave(w); SFX.stageComplete(); }
    },1000);
    return()=>{
      doneRef.current=true;
      cancelAnimationFrame(frameRef.current);
      clearInterval(timerRef.current);
      clearTimeout(spawnRef.current);
      debrisRef.current=[];
      elapsedRef.current=0;
      waveRef.current=1;
    };
  },[]);

  const setTargetFromClientX=(clientX)=>{
    const el=containerRef.current; if(!el)return;
    const rect=el.getBoundingClientRect();
    targetXRef.current=Math.max(24,Math.min(GW-24,(clientX-rect.left)*(GW/rect.width)));
  };
  const onTouchStart=(e)=>{ e.preventDefault(); setTargetFromClientX(e.touches[0].clientX); };
  const onTouchMove=(e)=>{ e.preventDefault(); if(e.touches[0]) setTargetFromClientX(e.touches[0].clientX); };
  const waveColor=wave<=3?"#34D399":wave<=6?"#F5A623":"#EF4444";

  return (
    <div ref={containerRef}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove}
      onMouseDown={e=>setTargetFromClientX(e.clientX)}
      onMouseMove={e=>{ if(e.buttons) setTargetFromClientX(e.clientX); }}
      style={{ position:"relative",width:GW,maxWidth:"100%",height:GH,overflow:"hidden",userSelect:"none",fontFamily:"system-ui",touchAction:"none",background:"linear-gradient(180deg,#06060F,#0a1020)",margin:"0 auto" }}>
      <ScrollingStars speed={3.5+wave*0.3} density={1.5} tint="#c0d8ff"/>
      {hitFlash&&<div style={{ position:"absolute",inset:0,background:"rgba(239,68,68,0.35)",zIndex:30,pointerEvents:"none" }}/>}
      {debris.map(d=>(
        <div key={d.id} style={{ position:"absolute",left:d.x-d.size/2,top:d.y-d.size/2,width:d.size,height:d.size,transform:`rotate(${d.rot}deg)`,zIndex:6,pointerEvents:"none" }}>
          <img src={d.skin} alt="" draggable={false} style={{ width:"100%",height:"100%",objectFit:"contain" }}/>
        </div>
      ))}
      <SmokePlume x={rocketX} y={ROCKET_SCREEN_Y+44} intensity={0.8} spread={0.9}/>
      <div style={{ position:"absolute",left:rocketX,top:ROCKET_SCREEN_Y-58,transform:"translateX(-50%)",zIndex:8 }}>
        <RocketImg rocket={rocket} wear={wear} height={130} glow={14}/>
      </div>
      <div style={{ position:"absolute",top:0,left:0,right:0,padding:"10px 16px",background:"linear-gradient(180deg,rgba(0,0,0,0.7),transparent)",zIndex:20,display:"flex",alignItems:"center",gap:10 }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:20,cursor:"pointer",padding:0 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:2,fontFamily:"monospace" }}>生存挑戰</div>
          <div style={{ fontSize:11,color:waveColor,fontWeight:700,fontFamily:"monospace" }}>WAVE {wave}{wave>=7?" 💀":wave>=4?" 🔥":""}</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:28,fontWeight:900,color:"#34D399",fontFamily:"monospace",lineHeight:1 }}>{elapsed}s</div>
          <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"monospace" }}>存活時間</div>
        </div>
      </div>
      {dead&&<SurvivalResult score={score} elapsed={finalElapsed} wave={finalWave} rocket={rocket}
        onBack={onBack} onRestart={onRestart} onShowLeaderboard={onShowLeaderboard}/>}
    </div>
  );
}

// ─── Stars ────────────────────────────────────────────────────────────────────
function StarsBg({ density=1 }) {
  const ref=useRef(null);
  useEffect(()=>{
    const c=ref.current; if(!c)return;
    c.width=GW; c.height=GH;
    const ctx=c.getContext("2d");
    const g=ctx.createLinearGradient(0,0,0,GH);
    g.addColorStop(0,"#010407"); g.addColorStop(0.5,"#040A18");
    g.addColorStop(0.85,"#081520"); g.addColorStop(1,"#0A1A0D");
    ctx.fillStyle=g; ctx.fillRect(0,0,GW,GH);
    const n=Math.floor(200*density);
    for(let i=0;i<n;i++){
      const x=Math.random()*GW,y=Math.random()*GH*.88,r=Math.random()*1.3+.2,a=Math.random()*.55+.1;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
      ctx.fillStyle=`rgba(215,228,248,${a})`; ctx.fill();
    }
  },[density]);
  return <canvas ref={ref} style={{ position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none" }}/>;
}

// ─── Scrolling star background (gives sense of motion during flight) ──────────
// Stars drift DOWNWARD continuously, so the rocket feels like it's climbing.
function ScrollingStars({ speed=1, density=1, tint="#d7e4f8" }) {
  const ref=useRef(null), frame=useRef(null);
  // Parse tint hex → rgb for star color
  const rgb=(()=>{ const h=tint.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; })();
  useEffect(()=>{
    const c=ref.current; if(!c)return;
    c.width=GW; c.height=GH;
    const ctx=c.getContext("2d");
    const n=Math.floor(160*density);
    // 3 parallax layers — far stars slow, near stars fast
    const stars=Array.from({length:n},()=>{
      const layer=Math.random();
      return {
        x:Math.random()*GW,
        y:Math.random()*GH,
        r:0.3+layer*1.4,
        a:0.15+layer*0.5,
        spd:(0.4+layer*1.8), // parallax: bigger/brighter = faster
      };
    });
    const draw=()=>{
      ctx.clearRect(0,0,GW,GH);
      stars.forEach(s=>{
        s.y+=s.spd*speed;
        if(s.y>GH){ s.y=-2; s.x=Math.random()*GW; }
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
        ctx.fillStyle=`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${s.a})`; ctx.fill();
      });
      frame.current=requestAnimationFrame(draw);
    };
    draw();
    return()=>cancelAnimationFrame(frame.current);
  },[speed,density,tint]);
  // Stars only — backdrop is provided by the parent (planet sky), so transparent here.
  return (
    <canvas ref={ref} style={{ position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none" }}/>
  );
}

// ─── Decorative floating clouds (background only, no collision) ───────────────
const CLOUD_IMGS = ["/assets/cloud_round.png","/assets/cloud_elongated.png","/assets/cloud_irregular.png","/assets/cloud_irregular-2.png"];
function FloatingClouds({ speed=1, count=4 }) {
  const [clouds,setClouds]=useState([]);
  const cloudsRef=useRef([]), frame=useRef(null);
  useEffect(()=>{
    cloudsRef.current=Array.from({length:count},(_,i)=>({
      id:i,
      img:CLOUD_IMGS[Math.floor(Math.random()*CLOUD_IMGS.length)],
      x:Math.random()*GW,
      y:Math.random()*GH,
      w:90+Math.random()*120,
      spd:0.3+Math.random()*0.7,
      op:0.12+Math.random()*0.22, // faint, so it doesn't clash with gameplay
    }));
    setClouds([...cloudsRef.current]);
    const tick=()=>{
      cloudsRef.current=cloudsRef.current.map(c=>{
        let y=c.y+c.spd*speed;
        if(y>GH+60){ y=-80; c.x=Math.random()*GW; }
        return {...c,y};
      });
      setClouds([...cloudsRef.current]);
      frame.current=requestAnimationFrame(tick);
    };
    frame.current=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame.current);
  },[speed,count]);
  return (
    <div style={{ position:"absolute",inset:0,pointerEvents:"none",zIndex:2,overflow:"hidden" }}>
      {clouds.map(c=>(
        <img key={c.id} src={c.img} alt="" draggable={false}
          style={{ position:"absolute",left:c.x-c.w/2,top:c.y,width:c.w,opacity:c.op,filter:"blur(0.3px)" }}/>
      ))}
    </div>
  );
}

// ─── Smoke plume particle system (engine exhaust / launch billows) ───────────
// Emits soft grey puffs + warm core. Use during launch and stage transitions.
function SmokePlume({ x=GW/2, y=GH-110, intensity=1, spread=1, big=false }) {
  const ref=useRef(null), frame=useRef(null), parts=useRef([]);
  useEffect(()=>{
    const c=ref.current; if(!c)return;
    c.width=GW; c.height=GH;
    const ctx=c.getContext("2d");
    let alive=true;
    const spawn=()=>{
      const count=big?3:2;
      for(let i=0;i<count*intensity;i++){
        parts.current.push({
          x:x+(Math.random()-.5)*22*spread,
          y:y+(Math.random()-.5)*8,
          vx:(Math.random()-.5)*1.6*spread,
          vy:(0.6+Math.random()*1.4),  // drift downward (exhaust)
          r:(big?14:9)+Math.random()*(big?22:14),
          life:1,
          decay:0.008+Math.random()*0.012,
          warm:Math.random()<0.3, // some warm-tinted near engine
        });
      }
    };
    const draw=()=>{
      if(!alive)return;
      ctx.clearRect(0,0,GW,GH);
      if(intensity>0) spawn();
      parts.current=parts.current.filter(p=>p.life>0);
      parts.current.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy; p.vy+=0.02; p.r+=0.5; p.life-=p.decay;
        const a=Math.max(0,p.life*0.5);
        const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
        if(p.warm){
          g.addColorStop(0,`rgba(255,190,90,${a*0.8})`);
          g.addColorStop(0.4,`rgba(220,150,80,${a*0.4})`);
          g.addColorStop(1,`rgba(200,200,200,0)`);
        } else {
          g.addColorStop(0,`rgba(220,222,228,${a})`);
          g.addColorStop(0.5,`rgba(180,184,194,${a*0.5})`);
          g.addColorStop(1,`rgba(170,175,185,0)`);
        }
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      });
      frame.current=requestAnimationFrame(draw);
    };
    draw();
    return()=>{ alive=false; cancelAnimationFrame(frame.current); };
  },[x,y,intensity,spread,big]);
  return <canvas ref={ref} style={{ position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:9 }}/>;
}
function StageHUD({ stageIndex, totalStages, planet, score, onBack, stageName }) {
  return (
    <div style={{ position:"absolute",top:0,left:0,right:0,padding:"10px 16px 8px",background:"linear-gradient(180deg,rgba(0,0,0,0.6),transparent)",display:"flex",alignItems:"center",gap:10,zIndex:20 }}>
      <button onClick={()=>{ Music.stop(); onBack(); }} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:20,cursor:"pointer",padding:0 }}>←</button>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex",gap:3,marginBottom:4 }}>
          {Array.from({length:totalStages},(_,i)=>(
            <div key={i} style={{ flex:1,height:3,borderRadius:2,background:i<stageIndex?"rgba(52,211,153,0.7)":i===stageIndex?C.amber:"rgba(255,255,255,0.12)",transition:"background 0.4s" }}/>
          ))}
        </div>
        {stageName&&<div style={{ fontSize:11,color:C.ink,fontWeight:700 }}>{stageName}</div>}
      </div>
      <div style={{ textAlign:"right" }}>
        <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1,fontFamily:"monospace" }}>{planet.emoji} {planet.name} {stageIndex+1}/{totalStages}</div>
        {score>0&&<div style={{ fontSize:11,color:C.amber,fontFamily:"monospace" }}>★ {score}</div>}
      </div>
    </div>
  );
}

// ─── Obstacle visuals (cloud + lightning) ────────────────────────────────────
function makeLane(id, worldY) {
  const fromLeft=Math.random()>.5, gapW=92+Math.random()*30, gapCenter=62+Math.random()*(GW-124);
  const spd=(0.9+Math.random()*.6)*(fromLeft?1:-1);
  // Lightning is rare now: ~8% (was 25%). Mostly clouds.
  const types=["cloud","cloud","cloud","cloud","cloud","cloud","cloud","cloud","cloud","cloud","cloud","lightning"];
  return { id, worldY, gapCenter, gapW, spd, type:types[Math.floor(Math.random()*types.length)], offset:fromLeft?-GW:GW, fromLeft, passed:false };
}

// Wall of real cloud PNGs with a gap. Clouds are placed left of gapLeft and
// right of gapRight; the gap stays clear (collision logic unchanged).
// Clouds are shown whole (no cropping) and tiled to cover each side.
// Procedural smoke (rocket-exhaust style) — no images. Each strip fills the area
// outside the launch gap with soft, billowing puffs that drift slightly.
// Tint follows the planet so Venus reads yellow-ish, Sun orange, etc.
const SMOKE_TINT = {
  0:"#cfd6e0", 1:"#e8b894", 2:"#e8d488", 3:"#e0b890",
  4:"#cfe4f0", 5:"#bfe8f5", 6:"#aac4f0", 7:"#f5b870",
};
function smokeTint(planetId){ return SMOKE_TINT[planetId] || "#d8dde6"; }
function CloudStrip({ screenY, gapLeft, gapRight, opacity=1, planetId=0 }) {
  const H=180;                 // tall enough that puffs (r≤50 + jitter + drift) never clip
  const tint=smokeTint(planetId);
  // Build a stable set of overlapping puffs for each side (so they don't flicker).
  const puffsRef=useRef(null);
  if(puffsRef.current===null){
    const mk=(n)=>Array.from({length:n},()=>({
      r: 28+Math.random()*22,                 // puff radius (max ~50)
      dx: Math.random()*30-15,                // horizontal jitter
      dy: Math.random()*22-11,                // vertical jitter (kept small to avoid clipping)
      o: 0.5+Math.random()*0.45,              // opacity
      ph: Math.random()*Math.PI*2,            // drift phase
    }));
    puffsRef.current={ left:mk(9), right:mk(9) };
  }
  // Gentle continuous drift.
  const [t,setT]=useState(0);
  useEffect(()=>{ let alive=true,raf;
    const loop=()=>{ if(!alive)return; setT(p=>p+0.018); raf=requestAnimationFrame(loop); };
    raf=requestAnimationFrame(loop);
    return()=>{ alive=false; cancelAnimationFrame(raf); };
  },[]);

  // Lay puffs from each gap edge outward to the screen edge. Start a bit beyond the
  // edge (by ~half a puff) so the launch gap reads as clearly open, not smoke-covered.
  const STEP=46;
  const build=(fromX, dir, puffs)=>{
    const out=[]; let x=fromX+dir*22, i=0;
    while(x>-70 && x<GW+70 && i<puffs.length){
      const p=puffs[i];
      out.push({ ...p, key:(dir<0?"L":"R")+i, cx:x+p.dx, drift:Math.sin(t+p.ph) });
      x+=dir*STEP; i++;
    }
    return out;
  };
  const left = gapLeft>16 ? build(gapLeft+4, -1, puffsRef.current.left) : [];
  const right = GW-gapRight>16 ? build(gapRight-4, +1, puffsRef.current.right) : [];
  const all=[...left,...right];
  const cy=H/2;
  return (
    <div style={{ position:"absolute",top:screenY-H/2,left:0,width:GW,height:H,pointerEvents:"none",opacity,overflow:"visible" }}>
      <svg width={GW} height={H} style={{ position:"absolute",inset:0,filter:"blur(1px)",overflow:"visible" }}>
        <defs>
          <radialGradient id={`sm-${planetId}`} cx="50%" cy="42%" r="55%">
            <stop offset="0%" stopColor={tint} stopOpacity="0.95"/>
            <stop offset="55%" stopColor={tint} stopOpacity="0.6"/>
            <stop offset="100%" stopColor={tint} stopOpacity="0"/>
          </radialGradient>
          <radialGradient id={`sm-core-${planetId}`} cx="50%" cy="45%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
          </radialGradient>
        </defs>
        {all.map(p=>(
          <g key={p.key} transform={`translate(${p.cx},${cy+p.dy+p.drift*4})`}>
            <circle r={p.r} fill={`url(#sm-${planetId})`} opacity={p.o}/>
            <circle r={p.r*0.6} fill={`url(#sm-core-${planetId})`} opacity={p.o*0.7}/>
          </g>
        ))}
      </svg>
    </div>
  );
}

// 閃電：全幅隨機閃現，沒有缺口，碰到就中雷
// onHit(true/false) 通知呼叫端閃電是否活躍
function LightningStrip({ screenY, onHit }) {
  const H = 110;
  const [visible, setVisible] = useState(false);
  const [brightness, setBrightness] = useState(1);
  const [xOff, setXOff] = useState(0);

  useEffect(()=>{
    let alive = true;
    const strike = () => {
      if (!alive) return;
      setXOff((Math.random()-0.5)*60);
      const flashes = 2 + (Math.random()<0.4?1:0);
      let i = 0;
      const doFlash = () => {
        if (!alive || i>=flashes) {
          setVisible(false);
          onHit && onHit(false);
          const cooldown = 900 + Math.random()*1400;
          setTimeout(()=>{ if(alive) strike(); }, cooldown);
          return;
        }
        setVisible(true);
        setBrightness(0.7+Math.random()*0.3);
        onHit && onHit(true);
        const dur = 60 + Math.random()*70;
        setTimeout(()=>{
          if(!alive)return;
          setVisible(false);
          onHit && onHit(false);
          i++;
          setTimeout(doFlash, 80+Math.random()*80);
        }, dur);
      };
      doFlash();
    };
    const initDelay = setTimeout(()=>{ if(alive) strike(); }, 600+Math.random()*800);
    return()=>{ alive=false; clearTimeout(initDelay); };
  },[]);

  if(!visible) return null;
  return (
    <div style={{ position:"absolute",top:screenY-H/2,left:xOff,width:GW,height:H,pointerEvents:"none" }}>
      <svg width={GW} height={H} style={{ overflow:"visible",filter:`drop-shadow(0 0 10px rgba(255,220,40,${brightness})) drop-shadow(0 0 24px rgba(255,200,20,0.6))` }}>
        <polyline points={`${GW*0.1},${H*0.1} ${GW*0.38},${H*0.45} ${GW*0.22},${H*0.5} ${GW*0.55},${H*0.85} ${GW*0.42},${H*0.9} ${GW*0.72},${H*1.05}`}
          fill="none" stroke={`rgba(255,240,160,${brightness})`} strokeWidth={3.5} strokeLinejoin="round"/>
        <polyline points={`${GW*0.38},${H*0.45} ${GW*0.6},${H*0.65} ${GW*0.52},${H*0.7}`}
          fill="none" stroke={`rgba(255,240,160,${brightness*0.7})`} strokeWidth={2} strokeLinejoin="round"/>
        <polyline points={`${GW*0.1},${H*0.1} ${GW*0.38},${H*0.45} ${GW*0.22},${H*0.5} ${GW*0.55},${H*0.85}`}
          fill="none" stroke={`rgba(255,255,255,${brightness*0.9})`} strokeWidth={1.5} strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ═══ STAGE 1: Atmosphere dodge ════════════════════════════════════════════════
function Stage1_Atmosphere({ planet, rocket, wear=0, onComplete, onFail, stageIndex, totalStages, onBack, activeItem=null }) {
  const SPACE_ALT=900, CLIMB=3.0;
  const [scrollY,setScrollY]=useState(0), [tilt,setTilt]=useState(0), [lanes,setLanes]=useState([]), [hitFlash,setHitFlash]=useState(null);
  const scrollRef=useRef(0), tiltRef=useRef(0), lanesRef=useRef([]), nextId=useRef(0), flyFrame=useRef(null), slideFrame=useRef(null);

  useEffect(()=>{
    Music.play("flying");
    lanesRef.current=Array.from({length:3},(_,i)=>makeLane(nextId.current++,220+i*220+Math.random()*60));
    setLanes([...lanesRef.current]);
    const slide=()=>{ lanesRef.current=lanesRef.current.map(l=>{ let off=l.offset+l.spd; if(l.fromLeft?off>GW+20:off<-GW-20)off=l.fromLeft?-GW:GW; return{...l,offset:off}; }); setLanes([...lanesRef.current]); slideFrame.current=requestAnimationFrame(slide); };
    slideFrame.current=requestAnimationFrame(slide);
    const fly=()=>{
      scrollRef.current+=CLIMB; setScrollY(scrollRef.current);
      lanesRef.current=lanesRef.current.map(l=>{
        if(l.passed)return l;
        if(scrollRef.current>=l.worldY-28&&scrollRef.current<=l.worldY+28){
          const gsc=l.gapCenter+l.offset,gl=gsc-l.gapW/2,gr=gsc+l.gapW/2;
          const inGap=(GW/2+14)>gl&&(GW/2-14)<gr;
          if(!inGap){
            if(l.type==="lightning"){
              cancelAnimationFrame(flyFrame.current); cancelAnimationFrame(slideFrame.current);
              SFX.lightning(); setHitFlash("lightning");
              setTimeout(()=>{ Music.fadeOut(0.5); onFail("lightning"); },500);
              return{...l,passed:true};
            } else {
              SFX.cloudHit();
              const d=(Math.random()>.5?1:-1)*(12+Math.random()*18);
              tiltRef.current=Math.max(-55,Math.min(55,tiltRef.current+d)); setTilt(tiltRef.current);
              setHitFlash("cloud"); setTimeout(()=>setHitFlash(null),280);
            }
          }
          return{...l,passed:true};
        }
        return l;
      });
      setLanes([...lanesRef.current]);
      if(scrollRef.current>=SPACE_ALT){
        cancelAnimationFrame(flyFrame.current); cancelAnimationFrame(slideFrame.current);
        SFX.stageComplete();
        onComplete({ tilt:tiltRef.current, score:Math.round(500*(1-Math.abs(tiltRef.current)/60)) });
        return;
      }
      flyFrame.current=requestAnimationFrame(fly);
    };
    flyFrame.current=requestAnimationFrame(fly);
    return()=>{ cancelAnimationFrame(flyFrame.current); cancelAnimationFrame(slideFrame.current); };
  },[]);

  const _t2=themeOf(planet.id);
  return (
    <div style={{ position:"relative",width:GW,height:GH,maxWidth:"100%",overflow:"hidden",userSelect:"none",fontFamily:"system-ui",background:`linear-gradient(180deg, ${_t2.sky.join(", ")})` }}>
      {hitFlash==="cloud"&&<div style={{ position:"absolute",inset:0,background:"rgba(200,220,240,0.18)",zIndex:99,pointerEvents:"none" }}/>}
      {hitFlash==="lightning"&&<div style={{ position:"absolute",inset:0,background:"rgba(255,220,30,0.5)",zIndex:99,pointerEvents:"none" }}/>}
      <ScrollingStars speed={2.2} density={0.9} tint={_t2.star}/>
      {lanes.map(lane=>{ const sY=ROCKET_SCREEN_Y-(lane.worldY-scrollRef.current); if(sY<-80||sY>GH+80)return null; const gl=Math.max(0,lane.gapCenter+lane.offset-lane.gapW/2),gr=Math.min(GW,lane.gapCenter+lane.offset+lane.gapW/2); const fade=lane.passed?Math.max(0,1-(scrollRef.current-lane.worldY)/100):1; if(fade<=0)return null; if(lane.type==="lightning")return null; return <CloudStrip key={lane.id} screenY={sY} gapLeft={gl} gapRight={gr} opacity={fade} planetId={planet.id}/>; })}
      {/* 閃電：固定在畫面中段，隨機閃現，測試模式下也出現 */}
      {(()=>{ const sY=GH*0.35; return <LightningStrip key="atm-lt" screenY={sY} onHit={a=>{ if(a&&!scrollRef.current){ return; } }}/>; })()}
      {/* Engine smoke trail */}
      <SmokePlume x={ROCKET_SCREEN_X} y={ROCKET_SCREEN_Y+44} intensity={1} spread={1}/>
      <div style={{ position:"absolute",left:ROCKET_SCREEN_X,top:ROCKET_SCREEN_Y-58,transform:"translateX(-50%)",zIndex:8 }}>
        <RocketImg rocket={rocket} wear={wear} height={130} glow={14} tilt={tilt}/>
      </div>
      <div style={{ position:"absolute",right:14,top:56,bottom:100,width:4,background:"rgba(255,255,255,0.06)",borderRadius:2,zIndex:15 }}>
        <div style={{ position:"absolute",bottom:0,width:"100%",background:`linear-gradient(180deg,${planet.color},${C.amber})`,borderRadius:2,height:`${Math.min(100,(scrollRef.current/SPACE_ALT)*100)}%`,transition:"height 0.1s" }}/>
        <div style={{ position:"absolute",bottom:"100%",right:-12,fontSize:14 }}>{planet.emoji}</div>
      </div>
      {Math.abs(tilt)>28&&<div style={{ position:"absolute",top:"30%",left:"50%",transform:"translateX(-50%)",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:16,padding:"4px 14px",zIndex:10,fontSize:11,color:C.red,fontFamily:"monospace",whiteSpace:"nowrap" }}>⚠ 偏斜 {Math.abs(Math.round(tilt))}°</div>}
      <StageHUD stageIndex={stageIndex} totalStages={totalStages} planet={planet} score={0} onBack={onBack}/>
      <div style={{ position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",fontSize:11,color:"rgba(255,255,255,0.25)",fontFamily:"monospace",whiteSpace:"nowrap" }}>閃避雲朵，衝出大氣層</div>
    </div>
  );
}

// ═══ STAGE 2: Booster tap (drains if idle, separation animation on success) ══
// ── Tap-stage "context": same fast-tap gameplay, but the on-screen subject,
// labels and wording change with the task so it reads correctly. ──
const TAP_CONTEXTS = {
  thrust:  { kindImg:"thrust",  verb:"瘋狂連點！", meterLabel:"推進燃燒", hint:"燃燒值會一直下降，停手就失敗",   doneLabel:"推進器分離！", c1:"#F5A623", c2:"#E0533B", showRocket:true,  showBoosters:true },
  drill:   { kindImg:"drill",   verb:"全力鑽探！", meterLabel:"鑽探進度", hint:"鑽頭會卡住，停手就前功盡棄",     doneLabel:"鑽探完成！",   c1:"#C89B5A", c2:"#8A6A35", showRocket:false, showBoosters:false },
  collect: { kindImg:"collect", verb:"快速採集！", meterLabel:"採集進度", hint:"樣本會流失，停手就採不滿",       doneLabel:"採集完成！",   c1:"#4ECDC4", c2:"#2E9E96", showRocket:false, showBoosters:false },
  scan:    { kindImg:"scan",    verb:"持續掃描！", meterLabel:"掃描進度", hint:"訊號會中斷，停手就要重來",       doneLabel:"掃描完成！",   c1:"#6AB8FF", c2:"#2E7AD4", showRocket:false, showBoosters:false },
  repair:  { kindImg:"repair",  verb:"快速搶修！", meterLabel:"修復進度", hint:"系統持續惡化，停手就修不好",     doneLabel:"修復完成！",   c1:"#7ED957", c2:"#3FA535", showRocket:false, showBoosters:false },
  build:   { kindImg:"build",   verb:"全力建造！", meterLabel:"建造進度", hint:"工程會停擺，停手就蓋不完",       doneLabel:"建造完成！",   c1:"#FFB454", c2:"#D4862E", showRocket:false, showBoosters:false },
  clean:   { kindImg:"clean",   verb:"快速清理！", meterLabel:"清理進度", hint:"灰塵持續堆積，停手就清不乾淨",   doneLabel:"清理完成！",   c1:"#9AD4E0", c2:"#5A9AAE", showRocket:false, showBoosters:false },
  charge:  { kindImg:"charge",  verb:"全力供能！", meterLabel:"能量",     hint:"能量會一直流失，停手就充不滿",   doneLabel:"能量充滿！",   c1:"#FFD93D", c2:"#F5A623", showRocket:false, showBoosters:false },
};
// Per-task kind. Decided with the user; keyword fallback handles the rest.
const TAP_TASK_KIND = {
  // thrust
  "推進器分離":"thrust", "土星環外圍減速":"thrust", "重力井深淵掙扎":"thrust", "軌道修正偏離":"thrust",
  // build
  "建立月球基地":"build",
  // clean
  "太陽能板清理":"clean",
  // charge (energy / heating / shields)
  "極低溫能源調配":"charge", "太陽能極限充電":"charge", "極寒系統除冰":"charge", "耐熱護盾全開":"charge",
  // scan / survey (looking, measuring, data)
  "尋找遠古生命跡象":"scan", "溫室效應調查":"scan", "尋找深海熱泉生命":"scan",
  "尋找碳氫生命":"scan", "鑽石海洋探測":"scan", "測量太陽耀斑":"scan", "量子數據傳輸":"scan",
  // drill
  "地下鑽探水源":"drill", "穿透厚冰層鑽探":"drill",
  // fix keyword traps
  "探測器散熱維護":"repair", "高壓鑽石雨收集":"collect",
};
// Subject art for each tap-stage kind (you generate these; drop into public/assets/).
const TAP_SUBJECT_IMG = {
  drill:"/assets/subj_drill.png", collect:"/assets/subj_collector.png", scan:"/assets/subj_scanner.png",
  repair:"/assets/subj_wrench.png", build:"/assets/subj_crane.png", clean:"/assets/subj_brush.png",
  charge:"/assets/subj_battery.png",
};
function tapKindFor(name){
  if(TAP_TASK_KIND[name]) return TAP_TASK_KIND[name];
  if(/鑽探|鑽/.test(name)) return "drill";
  if(/掃描|測量|數據|傳輸|分析|調查|探測|尋找/.test(name)) return "scan";
  if(/採集|收集/.test(name)) return "collect";
  if(/清理/.test(name)) return "clean";
  if(/建立|建造|搭建/.test(name)) return "build";
  if(/充電|能源/.test(name)) return "charge";
  if(/修復|維護|散熱/.test(name)) return "repair";
  return "collect"; // safe default — never a stray rocket
}

function Stage2_Booster({ planet, rocket, wear=0, underpowered=false, deficit=0, onComplete, onFail, stageName, stageIndex, totalStages, onBack, activeItem=null, pausedRef=null }) {
  const KIND=tapKindFor(stageName||""), CTX=TAP_CONTEXTS[KIND];
  const TIME_LIMIT = TEST.on ? 14 : 12; // seconds to reach 100% or the stage fails
  const [burnPct,setBurnPct]=useState(0), [done,setDone]=useState(false), [shakeX,setShakeX]=useState(0);
  const [timeLeft,setTimeLeft]=useState(TIME_LIMIT);
  const [sep,setSep]=useState(0); // 0→1 separation progress for animation
  const burnRef=useRef(0), drainFrame=useRef(null), shakeRef=useRef(null), doneRef=useRef(false), completedRef=useRef(false), sepStartRef=useRef(null), failedRef=useRef(false), timerRef=useRef(null);

  useEffect(()=>{
    Music.play("flying");
    // Burn DRAINS over real time; tap() handles reaching 100% so drain can't block it.
    let lastT=Date.now();
    // Each tap +7. With a 12s limit, tps needed to hit 100%: moon 3.5 → sun 6.9.
    // moon16 mars20 venus24 jupiter28 saturn32 uranus36 neptune/sun 40 (capped).
    // Underpowered (old rocket on a tougher planet) drains ~30% faster.
    // Penalty compounds per missing rocket tier: 1 tier ≈ +26% drain, more tiers
    // stack multiplicatively so a huge mismatch (T1 → Sun) drains faster than any
    // human can tap. Cap rises with deficit so extreme cases are genuinely unbeatable.
    const penalty = Math.pow(1.26, deficit);
    const cap = deficit>=3 ? 80 : deficit>=2 ? 60 : 44;
    const DRAIN_PER_SEC = TEST.on ? 10 : Math.min(cap, (16 + planet.id*4) * penalty);
    const loop=()=>{
      if(pausedRef?.current){ drainFrame.current=requestAnimationFrame(loop); return; }
      if(!doneRef.current){
        const now=Date.now();
        const dt=(now-lastT)/1000; lastT=now;
        burnRef.current=Math.max(0,burnRef.current-DRAIN_PER_SEC*dt);
        setBurnPct(burnRef.current);
      } else {
        // separation animation, then complete (once)
        const t=Math.min(1,(Date.now()-sepStartRef.current)/1100);
        setSep(t);
        if(t>=1){
          if(!completedRef.current){ completedRef.current=true; onComplete({burnScore:100,score:420}); }
          return;
        }
      }
      drainFrame.current=requestAnimationFrame(loop);
    };
    drainFrame.current=requestAnimationFrame(loop);
    shakeRef.current=setInterval(()=>setShakeX((Math.random()-.5)*6),120);
    // Countdown — must hit 100% before it reaches 0.
    timerRef.current=setInterval(()=>{
      setTimeLeft(t=>{
        if(doneRef.current){ clearInterval(timerRef.current); return t; }
        if(t<=1){
          clearInterval(timerRef.current);
          if(!doneRef.current && !failedRef.current){
            failedRef.current=true; doneRef.current=true;
            cancelAnimationFrame(drainFrame.current); clearInterval(shakeRef.current);
            SFX.cloudHit(); Music.fadeOut(0.5);
            setTimeout(()=>onFail&&onFail({reason:"未在時限內完成"}),300);
          }
          return 0;
        }
        SFX.countdownBeep(t<=4); return t-1;
      });
    },1000);
    return()=>{ cancelAnimationFrame(drainFrame.current); clearInterval(shakeRef.current); clearInterval(timerRef.current); };
  },[]);

  const triggerSeparation=()=>{
    if(doneRef.current)return;
    doneRef.current=true; setDone(true); SFX.boosterSeparate();
    clearInterval(shakeRef.current); clearInterval(timerRef.current);
    sepStartRef.current=Date.now();
  };

  const tap=()=>{
    if(doneRef.current)return;
    SFX.boosterTap();
    burnRef.current=Math.min(100,burnRef.current+(TEST.on?7:7)); setBurnPct(burnRef.current);
    if(burnRef.current>=100) triggerSeparation(); // check here, before drain can lower it
  };
  const touchedRef=useRef(false);
  const onTouch=(e)=>{ e.preventDefault(); touchedRef.current=true; tap(); };
  const onClickGuarded=(e)=>{ if(touchedRef.current){ touchedRef.current=false; return; } tap(); };

  const _t2=themeOf(planet.id);
  return (
    <div style={{ position:"relative",width:GW,height:GH,maxWidth:"100%",overflow:"hidden",userSelect:"none",fontFamily:"system-ui",background:`linear-gradient(180deg, ${_t2.sky.join(", ")})` }} onClick={onClickGuarded} onTouchStart={onTouch}>
      <ScrollingStars speed={1.6} density={1.1} tint={_t2.star}/>

      {/* Side boosters that separate on success — only for thrust tasks */}
      {CTX.showBoosters && [-1,1].map(side=>(
        <div key={side} style={{
          position:"absolute",
          left:ROCKET_SCREEN_X + side*(20 + sep*120) + shakeX*(done?0:1),
          top:ROCKET_SCREEN_Y-40 + sep*sep*200,
          transform:`translateX(-50%) rotate(${side*sep*55}deg)`,
          opacity:1-sep*0.7, zIndex:7, transition:"none",
        }}>
          <div style={{ width:18,height:68,position:"relative",borderRadius:"9px 9px 5px 5px",
            background:"linear-gradient(90deg,#3a3f4a 0%,#6e7a8a 18%,#c8d0d8 38%,#e8edf2 50%,#c8d0d8 62%,#6e7a8a 82%,#3a3f4a 100%)",
            border:"1.5px solid rgba(20,24,32,0.7)",
            boxShadow:"inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -4px 8px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)" }}>
            {/* 高光條 */}
            <div style={{ position:"absolute",top:4,left:3,right:3,height:2,borderRadius:1,background:"rgba(255,255,255,0.55)" }}/>
            {/* 中間暗線（模擬接縫） */}
            <div style={{ position:"absolute",top:"40%",left:0,right:0,height:1,background:"rgba(0,0,0,0.25)" }}/>
            {/* 鉚釘感小點 */}
            <div style={{ position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",width:5,height:5,borderRadius:"50%",background:"linear-gradient(135deg,#8a9ab0,#4a5566)",border:"1px solid rgba(0,0,0,0.4)" }}/>
            <div style={{ position:"absolute",top:24,left:"50%",transform:"translateX(-50%)",width:5,height:5,borderRadius:"50%",background:"linear-gradient(135deg,#8a9ab0,#4a5566)",border:"1px solid rgba(0,0,0,0.4)" }}/>
            <div style={{ position:"absolute",top:38,left:"50%",transform:"translateX(-50%)",width:5,height:5,borderRadius:"50%",background:"linear-gradient(135deg,#8a9ab0,#4a5566)",border:"1px solid rgba(0,0,0,0.4)" }}/>
          </div>
          {/* booster flame */}
          {!done&&<div style={{ position:"absolute",bottom:-18,left:"50%",transform:"translateX(-50%)",width:10,height:20,background:"linear-gradient(180deg,#FFD54F,#FF8F00,transparent)",borderRadius:"0 0 50% 50%",filter:"blur(1.5px)" }}/>}
        </div>
      ))}

      {/* Separation smoke burst (thrust only) */}
      {done && CTX.showRocket && <SmokePlume x={ROCKET_SCREEN_X} y={ROCKET_SCREEN_Y+10} intensity={2.5} spread={2.2} big/>}
      {/* Continuous engine smoke (thrust only) */}
      {!done && CTX.showRocket && <SmokePlume x={ROCKET_SCREEN_X} y={ROCKET_SCREEN_Y+50} intensity={1} spread={1}/>}

      {/* Main subject: rocket for thrust, big themed emoji otherwise */}
      {CTX.showRocket ? (
        <div style={{ position:"absolute",left:ROCKET_SCREEN_X+(done?0:shakeX),top:ROCKET_SCREEN_Y-90 - sep*60,transform:"translateX(-50%)",zIndex:8 }}>
          <RocketImg rocket={rocket} wear={wear} height={150} glow={done?22:14}/>
        </div>
      ) : (
        <div style={{ position:"absolute",left:ROCKET_SCREEN_X+(done?0:shakeX),top:ROCKET_SCREEN_Y-70,transform:"translateX(-50%)",zIndex:8,textAlign:"center" }}>
          <img src={TAP_SUBJECT_IMG[KIND]} alt="" draggable={false}
            style={{ width:130,height:130,objectFit:"contain",filter:`drop-shadow(0 0 ${12+burnPct*0.2}px ${CTX.c1}cc)`,transform:`scale(${done?1.2:1+burnPct/600})`,transition:"transform 0.08s" }}/>
          {/* work glow pulses brighter as the meter fills */}
          <div style={{ position:"absolute",left:"50%",top:"50%",transform:"translate(-50%,-50%)",width:140,height:140,borderRadius:"50%",background:`radial-gradient(circle, ${CTX.c1}${done?"66":"33"} 0%, transparent 70%)`,opacity:0.4+burnPct/200,zIndex:-1,pointerEvents:"none" }}/>
        </div>
      )}
      {/* Burn/work glow under subject */}
      <div style={{ position:"absolute",left:ROCKET_SCREEN_X-30+shakeX,top:ROCKET_SCREEN_Y+30,width:60,height:Math.round(20+burnPct*.6),background:`radial-gradient(ellipse at top, ${CTX.c1}${Math.round((.3+burnPct/200)*99).toString(16).padStart(2,"0")} 0%, transparent 70%)`,filter:"blur(4px)",zIndex:9,pointerEvents:"none" }}/>

      {/* Progress meter */}
      {!done && (
        <div style={{ position:"absolute",left:60,right:60,top:"16%",zIndex:15 }}>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:10,color:C.inkDim,marginBottom:6,fontFamily:"monospace",letterSpacing:1 }}>
            <span>{CTX.meterLabel}</span><span style={{ color:burnPct>60?C.green:burnPct>30?C.amber:C.red }}>{Math.round(burnPct)}%</span>
          </div>
          <div style={{ height:16,background:"rgba(255,255,255,0.06)",borderRadius:8,overflow:"hidden",border:"1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ height:"100%",width:`${burnPct}%`,background:`linear-gradient(90deg,${CTX.c1},${CTX.c2})`,borderRadius:8,boxShadow:`0 0 8px ${CTX.c1}88` }}/>
          </div>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:"rgba(255,255,255,0.18)",marginTop:4,fontFamily:"monospace" }}>
            <span>會持續下降</span><span style={{ color:C.inkDim }}>衝到 100% 完成</span>
          </div>
        </div>
      )}

      {/* Countdown — must hit 100% before it runs out */}
      {!done && (
        <div style={{ position:"absolute",top:"23%",left:0,right:0,textAlign:"center",zIndex:16 }}>
          <div style={{ fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:"monospace",letterSpacing:2 }}>剩餘時間</div>
          <div style={{ fontSize:34,fontWeight:900,fontFamily:"monospace",lineHeight:1,color:timeLeft<=3?C.red:timeLeft<=5?C.amber:C.ink,filter:timeLeft<=3?`drop-shadow(0 0 10px ${C.red})`:"none" }}>{timeLeft}</div>
        </div>
      )}

      {!done && (
        <div style={{ position:"absolute",bottom:80,left:0,right:0,textAlign:"center",zIndex:15 }}>
          <div style={{ fontSize:16,fontWeight:700,color:C.ink,marginBottom:4 }}>{CTX.verb}</div>
          <div style={{ fontSize:11,color:C.inkDim }}>{CTX.hint}</div>
        </div>
      )}
      {done && (
        <div style={{ position:"absolute",top:"30%",left:0,right:0,textAlign:"center",zIndex:30 }}>
          <div style={{ fontSize:20,fontWeight:800,color:C.green,letterSpacing:1 }}>{CTX.doneLabel}</div>
        </div>
      )}
      <StageHUD stageIndex={stageIndex} totalStages={totalStages} planet={planet} score={Math.round(burnPct*4)} onBack={onBack} stageName={stageName}/>
    </div>
  );
}

// ── Per-task dodge descriptions so each stage reads correctly (not always "碎片") ──
const DODGE_TEXT = {
  "漫步月球":         { title:"閃避漂浮月岩",   hint:"滑動操控，避開低重力下漂來的月岩" },
  "遭遇特大沙塵暴":   { title:"穿越火星沙塵暴", hint:"滑動操控，鑽過漫天飛揚的沙塵團" },
  "奧林帕斯山挑戰":   { title:"飛越火山岩流",   hint:"滑動操控，閃過噴飛的火山岩塊" },
  "穿越硫酸雲層":     { title:"穿越硫酸雲層",   hint:"滑動操控，避開腐蝕性的硫酸液滴" },
  "火山噴發逃離":     { title:"火山噴發逃離",   hint:"滑動操控火箭，閃過噴飛的熔岩彈" },
  "大紅斑風暴衝浪":   { title:"大紅斑風暴衝浪", hint:"滑動操控，在狂暴的紅斑亂流中求生" },
  "深海潛艇操控":     { title:"冰海潛航",       hint:"滑動操控潛艇，避開海底冰礁與熱泉" },
  "冰塊障礙生死時速": { title:"土星環冰塊衝刺", hint:"滑動操控，高速閃過環中冰塊" },
  "穿越泰坦大氣層":   { title:"穿越泰坦濃霧",   hint:"滑動操控，鑽過甲烷濃霧與亂流" },
  "液態甲烷航行":     { title:"甲烷湖泊航行",   hint:"滑動操控，避開湖面浮冰與漩渦" },
  "間歇泉噴發躲避":   { title:"閃避間歇泉噴發", hint:"滑動操控，躲開突然噴發的冰泉" },
  "冰晶風暴穿越":     { title:"穿越冰晶風暴",   hint:"滑動操控，閃過鋒利的冰晶刃" },
  "天王星環碎石陣":   { title:"穿越碎石陣",     hint:"滑動操控，鑽過環中飛旋的暗黑岩塊" },
  "大峽谷極限滑翔":   { title:"大峽谷極限滑翔", hint:"滑動操控，貼著峽谷壁高速滑翔" },
  "超音速風暴逆風行": { title:"超音速逆風行",   hint:"滑動操控，頂著超音速狂風前進" },
  "氮氣冰火山躲避":   { title:"閃避氮氣冰火山", hint:"滑動操控，躲開噴發的氮冰碎屑" },
  "微弱光線雷達導航": { title:"黑暗中雷達導航", hint:"滑動操控，在微光中閃避看不清的障礙" },
  "日冕物質拋射衝刺": { title:"日冕拋射衝刺",   hint:"滑動操控，衝過爆發的電漿流" },
  "日珥穿梭":         { title:"日珥火環穿梭",   hint:"滑動操控，鑽過翻騰的火焰環" },
  "光球層穿透":       { title:"穿透光球層",     hint:"滑動操控，避開翻滾的對流胞" },
};
function dodgeTextFor(name){ return DODGE_TEXT[name] || { title:"閃避障礙", hint:"手指按住螢幕左右滑動操控火箭" }; }

// ═══ STAGE 3: Dodge planetary debris — drag finger to steer ══════════════════
function Stage3_Exosphere({ planet, rocket, wear=0, underpowered=false, deficit=0, onComplete, onFail, stageName, stageIndex, totalStages, onBack, activeItem=null, pausedRef=null }) {
  const DODGE_TXT = dodgeTextFor(stageName||"");
  const DURATION = TEST.on ? 12 : Math.round((10 + (120-10)*planet.id/7) * Math.pow(1.30, deficit));
  const [rocketX,setRocketX]=useState(GW/2), [timeLeft,setTimeLeft]=useState(DURATION);
  // HP：T1=1, T2=2...T5=5，護盾+1。用 ref 存計算好的值避免 closure 問題
  const calcMaxHp = ()=> (rocket?.id ?? 0) + 1 + (activeItem==="shield" ? 1 : 0);
  const MAX_HP = calcMaxHp();
  const [debris,setDebris]=useState([]), [hitFlash,setHitFlash]=useState(false);
  const [hp,setHp]=useState(MAX_HP);
  const rocketXRef=useRef(GW/2), targetXRef=useRef(GW/2), draggingRef=useRef(false);
  const debrisRef=useRef([]), nextId=useRef(0), doneRef=useRef(false);
  const hpRef=useRef(MAX_HP);
  const frameRef=useRef(null), timerRef=useRef(null), spawnRef=useRef(null), containerRef=useRef(null);

  useEffect(()=>{
    // 每次 mount 重新計算 HP（解決 Strict Mode / closure 問題）
    const initHp = (rocket?.id ?? 0) + 1 + (activeItem==="shield" ? 1 : 0);
    hpRef.current = initHp;
    setHp(initHp);
    Music.play("space");
    const start=Date.now();
    // Base difficulty by planet; TEST mode makes it sparse.
    const baseInterval = TEST.on ? 1600 : Math.max(280, 620-planet.id*48);
    const baseFall = TEST.on ? 1.8 : 3.2+planet.id*0.6;
    // Elapsed-time ramp: by the end of the stage, spawns are ~45% faster and
    // debris falls ~40% quicker — keeps long (2-min) stages escalating.
    const rampNow=()=>{ const p=Math.min(1,(Date.now()-start)/(DURATION*1000)); return p; };

    const spawn=()=>{
      if(doneRef.current)return;
      const p=rampNow();
      const size=26+Math.random()*30;
      const fallSpeed=baseFall*(1+p*0.4);
      debrisRef.current.push({
        id:nextId.current++,
        x:30+Math.random()*(GW-60),
        y:-size,
        size,
        vx:(Math.random()-0.5)*1.2,
        vy:fallSpeed*(0.8+Math.random()*0.5),
        rot:Math.random()*360,
        vr:(Math.random()-0.5)*6,
      });
      const spawnInterval=baseInterval*(1-p*0.45);
      spawnRef.current=setTimeout(spawn, spawnInterval*(0.6+Math.random()*0.8));
    };
    spawn();

    const tick=()=>{
      if(doneRef.current)return;
      if(pausedRef?.current){ frameRef.current=requestAnimationFrame(tick); return; }
      // Rocket eases toward finger
      rocketXRef.current += (targetXRef.current - rocketXRef.current)*0.22;
      rocketXRef.current=Math.max(24,Math.min(GW-24,rocketXRef.current));
      setRocketX(rocketXRef.current);
      // Move debris, check collisions
      const rx=rocketXRef.current, ry=ROCKET_SCREEN_Y;
      debrisRef.current=debrisRef.current.filter(d=>{
        d.x+=d.vx; d.y+=d.vy; d.rot+=d.vr;
        // collision with rocket (rough circle)
        const dx=d.x-rx, dy=d.y-ry, dist=Math.sqrt(dx*dx+dy*dy);
        if(dist < d.size*0.5+24 && !d.hit){
          d.hit=true;
          hpRef.current-=1; setHp(hpRef.current);
          SFX.cloudHit(); setHitFlash(true); setTimeout(()=>setHitFlash(false),180);
          if(hpRef.current<=0){
            doneRef.current=true;
            cancelAnimationFrame(frameRef.current); clearInterval(timerRef.current); clearTimeout(spawnRef.current);
            Music.fadeOut(0.5); setTimeout(()=>onFail("debris"),300);
          }
          return false; // remove debris that hit
        }
        return d.y < GH+60; // keep if on screen
      });
      setDebris([...debrisRef.current]);
      frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);

    timerRef.current=setInterval(()=>{
      setTimeLeft(t=>{
        if(t<=1){ clearInterval(timerRef.current); clearTimeout(spawnRef.current);
          if(!doneRef.current){ doneRef.current=true; cancelAnimationFrame(frameRef.current); SFX.stageComplete(); onComplete({score:100+hpRef.current*80}); }
          return 0;
        }
        SFX.countdownBeep(t<=4); return t-1;
      });
    },1000);

    return()=>{ cancelAnimationFrame(frameRef.current); clearInterval(timerRef.current); clearTimeout(spawnRef.current); };
  },[]);

  // Robust continuous drag: track finger/mouse via the container rect.
  const setTargetFromClientX=(clientX)=>{
    const el=containerRef.current; if(!el)return;
    const rect=el.getBoundingClientRect();
    const localX=(clientX-rect.left)*(GW/rect.width); // scale if CSS-resized
    targetXRef.current=Math.max(24,Math.min(GW-24,localX));
  };
  const onTouchStart=(e)=>{ draggingRef.current=true; setTargetFromClientX(e.touches[0].clientX); };
  const onTouchMove=(e)=>{ if(e.touches[0]) setTargetFromClientX(e.touches[0].clientX); };
  const onTouchEnd=()=>{ draggingRef.current=false; };
  const onMouseDown=(e)=>{ draggingRef.current=true; setTargetFromClientX(e.clientX); };
  const onMouseMove=(e)=>{ if(draggingRef.current) setTargetFromClientX(e.clientX); };
  const onMouseUp=()=>{ draggingRef.current=false; };

  const timeColor=timeLeft>7?C.green:timeLeft>3?C.amber:C.red;
  const theme=themeOf(planet.id);
  const debrisSkin=debrisSkinFor(planet, stageName); // specific task skin > planet default

  return (
    <div ref={containerRef}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      style={{ position:"relative",width:"100%",maxWidth:GW,height:GH,maxHeight:"100dvh",margin:"0 auto",overflow:"hidden",userSelect:"none",fontFamily:"system-ui",cursor:"grab",touchAction:"none",boxSizing:"border-box",background:`linear-gradient(180deg, ${theme.sky.join(", ")})` }}>
      <ScrollingStars speed={3.2} density={1.4} tint={theme.star}/>
      {hitFlash&&<div style={{ position:"absolute",inset:0,background:"rgba(239,68,68,0.28)",zIndex:30,pointerEvents:"none" }}/>}

      {/* Debris — real obstacle art per planet */}
      {debris.map(d=>(
        <div key={d.id} style={{ position:"absolute",left:d.x-d.size/2,top:d.y-d.size/2,width:d.size,height:d.size,transform:`rotate(${d.rot}deg)`,zIndex:6,pointerEvents:"none" }}>
          <img src={debrisSkin.img} alt="" draggable={false} style={{ width:"100%",height:"100%",objectFit:"contain",filter:"drop-shadow(0 0 6px rgba(0,0,0,0.4))" }}/>
        </div>
      ))}

      {/* Engine smoke trail */}
      <SmokePlume x={rocketX} y={ROCKET_SCREEN_Y+44} intensity={0.8} spread={0.9}/>

      {/* Rocket */}
      <div style={{ position:"absolute",left:rocketX,top:ROCKET_SCREEN_Y-58,transform:"translateX(-50%)",zIndex:8 }}>
        <RocketImg rocket={rocket} wear={wear} height={130} glow={14}/>
      </div>

      {/* Timer */}
      <div style={{ position:"absolute",top:60,left:"50%",transform:"translateX(-50%)",textAlign:"center",zIndex:15 }}>
        <div style={{ fontSize:28,fontWeight:900,color:timeColor,fontFamily:"monospace" }}>{timeLeft}</div>
        <div style={{ fontSize:9,color:"rgba(255,255,255,0.25)",letterSpacing:1 }}>撐住</div>
      </div>

      {/* HP shields = rocket tier */}
      <div style={{ position:"absolute",top:58,right:16,display:"flex",gap:4,zIndex:15 }}>
        {Array.from({length:MAX_HP}).map((_,i)=>(
          <div key={i} style={{ width:14,height:14,borderRadius:"50%",background:i<hp?C.green:"rgba(255,255,255,0.15)",border:`1px solid ${i<hp?"rgba(52,211,153,0.6)":"rgba(255,255,255,0.2)"}`,boxShadow:i<hp?`0 0 6px ${C.green}`:"none" }}/>
        ))}
      </div>

      <div style={{ position:"absolute",bottom:36,left:0,right:0,textAlign:"center",zIndex:15 }}>
        <div style={{ fontSize:13,color:C.ink,fontFamily:"monospace",letterSpacing:1,marginBottom:4,fontWeight:700 }}>{DODGE_TXT.title}</div>
        <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:"monospace" }}>{DODGE_TXT.hint}</div>
      </div>

      <StageHUD stageIndex={stageIndex} totalStages={totalStages} planet={planet} score={100+hp*80} onBack={onBack} stageName={stageName}/>
    </div>
  );
}

// Real surface art per planet (rises into view during landing).
const SURFACE_IMG = {
  0:"/surfaces/surface_moon.png", 1:"/surfaces/surface_mars.png", 2:"/surfaces/surface_venus.png",
  3:"/surfaces/surface_jupiter.png", 4:"/surfaces/surface_saturn.png", 5:"/surfaces/surface_uranus.png",
  6:"/surfaces/surface_neptune.png", 7:"/surfaces/surface_sun.png",
};
function PlanetSurface({ planetId, reveal=0 }) {
  if(reveal<=0) return null;
  const img=SURFACE_IMG[planetId]||SURFACE_IMG[0];
  // Surface slab sits at the bottom and rises up as reveal→1.
  const slabH=GH*0.5;
  const top=GH - slabH*reveal*1.1;
  return (
    <img src={img} alt="" draggable={false}
      style={{ position:"absolute",left:"50%",top,transform:"translateX(-50%)",width:GW*1.15,height:"auto",zIndex:3,pointerEvents:"none",filter:"drop-shadow(0 -4px 12px rgba(0,0,0,0.4))" }}/>
  );
}

// ═══ STAGE 4: Orbit landing — confirm ignition, then time the landing ════════
function Stage4_Orbit({ planet, rocket, wear=0, deficit=0, onComplete, onFail, stageName, stageIndex, totalStages, onBack, activeItem=null, pausedRef=null }) {
  // phases: "intro" (press to begin) → "landing" (marker sweeps, tap in green) → done
  const [phase,setPhase]=useState("intro");
  const [marker,setMarker]=useState(0);     // 0–100 sweeping position
  const [descend,setDescend]=useState(0);    // rocket lowers toward planet 0→1
  const [result,setResult]=useState(null);   // "perfect"|"ok"|"hard"
  const markerRef=useRef(0), dirRef=useRef(1), doneRef=useRef(false), frameRef=useRef(null), descRef=useRef(0);

  // Green landing zone (center). Width shrinks on harder planets.
  const ZONE_C=50, ZONE_HALF= TEST.on ? Math.max(9,18-planet.id*1.4) : Math.max(3, (12 - planet.id*1.0) / Math.pow(1.22,deficit));
  const ZONE_MIN=ZONE_C-ZONE_HALF, ZONE_MAX=ZONE_C+ZONE_HALF;
  // Marker speed scales with planet difficulty
  const SWEEP_BASE = TEST.on ? (0.9+planet.id*0.22) : (1.6 + planet.id*0.42) * Math.pow(1.15,deficit);
  const SWEEP = activeItem==="slowland" ? SWEEP_BASE*0.4 : SWEEP_BASE; // slowland 道具降速 60%

  useEffect(()=>{ Music.play("space"); },[]);

  const beginLanding=()=>{
    if(phase!=="intro")return;
    SFX.ignition();
    setPhase("landing");
    const tick=()=>{
      if(doneRef.current)return;
      if(pausedRef?.current){ frameRef.current=requestAnimationFrame(tick); return; }
      markerRef.current+=dirRef.current*SWEEP;
      if(markerRef.current>=100){ markerRef.current=100; dirRef.current=-1; }
      if(markerRef.current<=0){ markerRef.current=0; dirRef.current=1; }
      setMarker(markerRef.current);
      frameRef.current=requestAnimationFrame(tick);
    };
    frameRef.current=requestAnimationFrame(tick);
  };

  const attemptLand=()=>{
    if(phase!=="landing"||doneRef.current)return;
    doneRef.current=true;
    cancelAnimationFrame(frameRef.current);
    const m=markerRef.current;
    const inZone=m>=ZONE_MIN&&m<=ZONE_MAX;
    let res, score;
    if(inZone){
      const precision=1-Math.abs(m-ZONE_C)/ZONE_HALF;
      res= precision>0.5 ? "perfect" : "ok";
      score= res==="perfect" ? 500 : 320;
      SFX.landingConfirmed();
    } else {
      res="hard"; score=120;
      SFX.cloudHit();
    }
    setResult(res);
    // Descent animation
    const start=Date.now();
    const dur= res==="hard"?700:1200;
    const desc=()=>{
      const t=Math.min(1,(Date.now()-start)/dur);
      descRef.current=t; setDescend(t);
      if(t>=1){
        setTimeout(()=>{ Music.fadeOut(0.8); onComplete({ score, landing:res }); },400);
        return;
      }
      requestAnimationFrame(desc);
    };
    desc();
  };

  // Marker color
  const inZoneNow=marker>=ZONE_MIN&&marker<=ZONE_MAX;

  const _t4=themeOf(planet.id);
  return (
    <div style={{ position:"relative",width:GW,height:GH,maxWidth:"100%",overflow:"hidden",userSelect:"none",fontFamily:"system-ui",background:`linear-gradient(180deg, ${_t4.sky.join(", ")})` }}
      onClick={phase==="landing"?attemptLand:undefined}
      onTouchStart={phase==="landing"?(e)=>{e.preventDefault();attemptLand();}:undefined}>
      <ScrollingStars speed={descend>0?0.4:1.2} density={1.6} tint={_t4.star}/>

      {/* Distant planet emoji — fades out as we approach surface */}
      <div style={{ position:"absolute",top:40+descend*60,left:"50%",transform:`translateX(-50%) scale(${1+descend*0.5})`,fontSize:64,filter:`drop-shadow(0 0 ${24+descend*30}px ${planet.color})`,opacity:Math.max(0,1-descend*1.6),zIndex:2,transition:"none" }}>{planet.emoji}</div>

      {/* Procedural planet surface rises into view as we descend */}
      <PlanetSurface planetId={planet.id} reveal={descend}/>

      {/* Landing smoke when descending */}
      {descend>0.3 && <SmokePlume x={ROCKET_SCREEN_X} y={ROCKET_SCREEN_Y+30} intensity={2} spread={1.8} big/>}

      {/* Rocket — lowers toward planet on landing */}
      <div style={{ position:"absolute",left:ROCKET_SCREEN_X,top:ROCKET_SCREEN_Y-58 - descend*60,transform:`translateX(-50%) scale(${1-descend*0.3})`,zIndex:8 }}>
        <RocketImg rocket={rocket} wear={wear} height={130} glow={14}/>
      </div>

      {/* INTRO */}
      {phase==="intro" && (
        <div style={{ position:"absolute",bottom:90,left:20,right:20,zIndex:15,textAlign:"center" }}>
          <div style={{ fontSize:13,color:planet.color,fontWeight:700,letterSpacing:1,marginBottom:6,fontFamily:"monospace" }}>{stageName||`即將進入 ${planet.name} 軌道`}</div>
          <div style={{ fontSize:11,color:C.inkDim,marginBottom:16 }}>準備執行精準著陸程序</div>
          <button onClick={beginLanding} style={{ width:"100%",height:58,background:`linear-gradient(135deg,${C.amber},${C.amberGlow})`,border:"none",borderRadius:14,color:"#000",fontSize:14,fontWeight:800,cursor:"pointer",letterSpacing:1,fontFamily:"monospace",boxShadow:`0 0 22px rgba(245,166,35,0.4)` }}>
            🔥 點火進入
          </button>
        </div>
      )}

      {/* LANDING — sweeping marker, tap to land */}
      {phase==="landing" && !doneRef.current && (
        <div style={{ position:"absolute",bottom:90,left:20,right:20,zIndex:15 }}>
          <div style={{ fontSize:12,color:C.inkDim,textAlign:"center",marginBottom:12,fontFamily:"monospace",letterSpacing:1 }}>指針進入綠色區間時點擊著陸</div>
          <div style={{ position:"relative",height:20,background:"rgba(255,255,255,0.06)",borderRadius:10,overflow:"hidden",marginBottom:14 }}>
            {/* green zone */}
            <div style={{ position:"absolute",left:`${ZONE_MIN}%`,width:`${ZONE_MAX-ZONE_MIN}%`,height:"100%",background:"rgba(52,211,153,0.3)" }}/>
            {/* marker */}
            <div style={{ position:"absolute",left:`${marker}%`,top:0,bottom:0,width:5,background:inZoneNow?C.green:C.amber,borderRadius:3,transform:"translateX(-50%)",boxShadow:inZoneNow?`0 0 10px ${C.green}`:`0 0 6px ${C.amber}` }}/>
          </div>
          <button onClick={attemptLand} onTouchStart={e=>{e.preventDefault();attemptLand();}}
            style={{ width:"100%",height:58,background:inZoneNow?`linear-gradient(135deg,${C.green},#047857)`:`linear-gradient(135deg,${C.red},#B71C1C)`,border:"none",borderRadius:14,color:"white",fontSize:15,fontWeight:800,cursor:"pointer",letterSpacing:2,fontFamily:"monospace",boxShadow:inZoneNow?`0 0 18px ${C.green}88`:"none" }}>
            著陸！
          </button>
        </div>
      )}

      {/* Result flash */}
      {result && (
        <div style={{ position:"absolute",top:"32%",left:0,right:0,textAlign:"center",zIndex:30 }}>
          <div style={{ fontSize:20,fontWeight:800,color:result==="hard"?C.amber:C.green,letterSpacing:1 }}>
            {result==="perfect"?"完美著陸！":result==="ok"?"成功著陸":"粗糙著陸"}
          </div>
        </div>
      )}

      <StageHUD stageIndex={stageIndex} totalStages={totalStages} planet={planet} score={0} onBack={onBack} stageName={stageName}/>
    </div>
  );
}

// ═══ Mission result ════════════════════════════════════════════════════════════
// Each sub-stage contributes score (0 if failed). The big stage passes only if
// total score reaches ≥60% of the maximum possible — otherwise it fails with no funds.
const STAGE_MAX_SCORE = { charge:300, tap:420, dodge:420, land:500 };
const PASS_RATIO = 0.60;
function MissionResult({ planet, stages, stageResults, onFinish, onBack }) {
  // Theoretical max = sum of each stage's ceiling.
  const maxScore = stages.reduce((s,st)=>s+(STAGE_MAX_SCORE[st.type]||300), 0);
  const gotScore = stageResults.reduce((s,r)=>s+(r.failed?0:(r.score||0)), 0);
  const ratio = maxScore>0 ? gotScore/maxScore : 0;
  const pct = Math.round(ratio*100);
  const passed = ratio >= PASS_RATIO;
  // Funds tuned so each rocket tier takes several passes: moon~2 for T2, jupiter~4 for T4.
  // Base reward by planet + a smaller performance bonus. fail = nothing.
  const funds = passed ? Math.round(planet.baseScore*0.45 + ratio*planet.baseScore*0.18) : 0;
  const failed = !passed;

  const [missionName,setMissionName]=useState(getPlayerName());
  const [missionUploaded,setMissionUploaded]=useState(false);
  const doMissionUpload=()=>{
    if(!missionName.trim()||missionUploaded)return;
    savePlayerName(missionName.trim());
    uploadMissionScore({ name:missionName.trim(), planetId:planet.id, score:gotScore, pct, rocketId:0 })
      .then(()=>setMissionUploaded(true)).catch(()=>setMissionUploaded(true));
  };

  useEffect(()=>{
    if(failed) SFX.missionFail();
    else SFX.missionSuccess();
    return()=>Music.stop();
  },[]);

  return (
    <div style={{ position:"relative",width:"100%",maxWidth:GW,height:GH,maxHeight:"100dvh",overflow:"hidden",background:"#010208",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui",color:C.ink,padding:24,boxSizing:"border-box",margin:"0 auto" }}>
      <StarsBg density={1.5}/>
      <div style={{ position:"relative",zIndex:2,width:"100%",display:"flex",flexDirection:"column",alignItems:"center" }}>
        <img src={failed?"/assets/badge_fail.png":"/assets/badge_success.png"} alt="" draggable={false}
          style={{ width:96,height:96,objectFit:"contain",marginBottom:8,filter:`drop-shadow(0 0 18px ${failed?"#E0533B":"#34D399"}aa)` }}/>
        <div style={{ fontSize:42,filter:`drop-shadow(0 0 20px ${planet.color})`,marginBottom:8 }}>{planet.emoji}</div>
        <div style={{ fontSize:20,fontWeight:800,marginBottom:4 }}>{failed?`任務失敗 — ${planet.name}`:`成功征服 ${planet.name}！`}</div>

        {/* Overall score ring */}
        <div style={{ fontSize:12,color:failed?C.red:C.green,fontFamily:"monospace",marginBottom:2 }}>
          總評分 {pct}%　{failed?`(需 ${Math.round(PASS_RATIO*100)}% 才通關)`:"達標！"}
        </div>
        <div style={{ width:"100%",height:10,background:"rgba(255,255,255,0.07)",borderRadius:6,overflow:"hidden",margin:"6px 0 4px",position:"relative" }}>
          <div style={{ height:"100%",width:`${pct}%`,background:failed?`linear-gradient(90deg,#E0533B,#B8392A)`:`linear-gradient(90deg,#34D399,#059669)`,borderRadius:6 }}/>
          {/* 60% threshold marker */}
          <div style={{ position:"absolute",left:`${PASS_RATIO*100}%`,top:-2,bottom:-2,width:2,background:"rgba(255,255,255,0.6)" }}/>
        </div>

        <div style={{ width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",margin:"12px 0 12px" }}>
          <div style={{ fontSize:9,color:C.inkDim,marginBottom:10,letterSpacing:2,fontFamily:"monospace" }}>STAGE BREAKDOWN</div>
          {stageResults.map((r,i)=>(
            <div key={i} style={{ display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:12 }}>
              <span style={{ color:C.inkDim }}>{stages[i]?.name||`第 ${i+1} 段`}</span>
              <span style={{ color:r.failed?C.red:C.green,fontFamily:"monospace" }}>{r.failed?"✗ 失敗":r.score?`+${r.score}`:"✓"}</span>
            </div>
          ))}
          <div style={{ borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:6,display:"flex",justifyContent:"space-between" }}>
            <span style={{ fontSize:13,color:C.inkDim }}>資金入帳</span>
            <span style={{ fontSize:16,fontWeight:800,color:failed?C.red:C.amber }}>💰 ${funds.toLocaleString()}</span>
          </div>
          {passed&&(
            <div style={{ borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:6 }}>
              {!missionUploaded?(
                <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                  <input value={missionName} onChange={e=>setMissionName(e.target.value.slice(0,12))} placeholder="名字上傳榜單" maxLength={12}
                    style={{ flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"6px 10px",color:"#E8EDF2",fontSize:12,outline:"none",fontFamily:"system-ui" }}/>
                  <button onClick={doMissionUpload} disabled={!missionName.trim()}
                    style={{ padding:"6px 12px",background:missionName.trim()?"linear-gradient(135deg,#F5A623,#FF8C00)":"rgba(255,255,255,0.1)",border:"none",borderRadius:8,color:missionName.trim()?"#000":"rgba(255,255,255,0.3)",fontSize:11,fontWeight:800,cursor:missionName.trim()?"pointer":"not-allowed" }}>
                    <img src="/assets/ui_trophy.png" alt="" style={{width:14,height:14,objectFit:"contain",verticalAlign:"middle",marginRight:3}}/>立刻留名
                  </button>
                </div>
              ):(
                <div style={{ fontSize:11,color:C.green,fontFamily:"monospace",textAlign:"center" }}>✅ 已上傳排行榜</div>
              )}
            </div>
          )}
        </div>
        <div style={{ display:"flex",gap:10,width:"100%" }}>
          <button onClick={()=>{ SFX.stopSuccess(); onBack(); }} style={{ flex:1,background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,borderRadius:12,padding:13,color:C.ink,fontSize:14,cursor:"pointer" }}>返回</button>
          <button onClick={()=>{ SFX.stopSuccess(); onFinish(funds, passed, pct); }} style={{ flex:1,background:`linear-gradient(135deg,${C.amber},${C.amberGlow})`,border:"none",borderRadius:12,padding:13,color:"#000",fontSize:14,fontWeight:800,cursor:"pointer" }}>{passed?`領取 $${funds.toLocaleString()}`:"返回基地"}</button>
        </div>
      </div>
    </div>
  );
}

// ═══ Pre-launch ════════════════════════════════════════════════════════════════
function makeLaneSimple(id,planetId,deficit=0){
  if(TEST.on){ // easy: one wide centered clear gap, slow
    const fromLeft=Math.random()>.5;
    return{id,laneY:100+Math.random()*340,gapCenter:GW/2,gapW:260,spd:(0.4+Math.random()*.2)*(fromLeft?1:-1),type:"cloud",offset:fromLeft?-GW:GW,fromLeft};
  }
  const fromLeft=Math.random()>.5;
  // Underpowered rocket → narrower gap (harder to thread) and faster clouds.
  const gapW=Math.max(70, 170 - deficit*26);        // each missing tier shrinks the gap
  const gapCenter=90+Math.random()*(GW-180);
  // SPEED is the difficulty knob: later planets = faster clouds = shorter launch window.
  const baseSpd=(1.3 + planetId*0.7) * Math.pow(1.18, deficit); // mismatch speeds clouds up
  const spd=(baseSpd + Math.random()*0.4)*(fromLeft?1:-1);
  // A little lightning only on the harder half
  const type = "cloud"; // 閃電改由獨立 LightningStrip 元件處理
  return{id,laneY:100+Math.random()*340,gapCenter,gapW,spd,type,offset:fromLeft?-GW:GW,fromLeft};
}

function ChargeStage({ planet, rocket, wear=0, deficit=0, inventory, stageName, stageIndex, totalStages, onComplete, onFail, onBack, activeItem=null, pausedRef=null }) {
  const [phase,setPhase]=useState("wait"), [lanes,setLanes]=useState([]), [windowOpen,setWindowOpen]=useState(false), [flash,setFlash]=useState(false);
  const phaseRef=useRef("wait"), lanesRef=useRef([]), nextId=useRef(0), slideRef=useRef(null), windowRef=useRef(false);
  const lightningActiveRef=useRef(false);

  useEffect(()=>{
    Music.play("prelaunch");
    // ONE cloud lane. Difficulty = cloud speed (scales with planet), not count.
    const count=1;
    lanesRef.current=Array.from({length:count},(_,i)=>makeLaneSimple(nextId.current++,planet.id,deficit));
    // 道具：精準導引 → 缺口加寬 40%
    if(activeItem==="widen") lanesRef.current=lanesRef.current.map(l=>({...l,gapW:Math.min(GW*0.7,l.gapW*1.4)}));
    // 道具：天氣雷達 → 雲速降低 50%
    if(activeItem==="radar") lanesRef.current=lanesRef.current.map(l=>({...l,spd:l.spd*0.5}));
    setLanes([...lanesRef.current]);
    const slide=()=>{ if(!pausedRef?.current){ lanesRef.current=lanesRef.current.map(l=>{ let off=l.offset+l.spd; const past=l.fromLeft?off>GW+20:off<-GW-20; if(past)off=l.fromLeft?-GW:GW; return{...l,offset:off}; }); } const all=lanesRef.current.every(l=>{ const g=l.gapCenter+l.offset; return Math.abs(g-GW/2)<l.gapW/2-10; }); if(all&&!windowRef.current){ windowRef.current=true; SFX.windowOpen(); } if(!all) windowRef.current=false; setWindowOpen(all); setLanes([...lanesRef.current]); slideRef.current=requestAnimationFrame(slide); };
    slideRef.current=requestAnimationFrame(slide);
    return()=>{ cancelAnimationFrame(slideRef.current); };
  },[]);

  // You can ALWAYS launch. If the path is blocked, you crash and fail.
  const handleLaunch=()=>{
    if(phaseRef.current!=="wait")return;
    // Is the center blocked by any obstacle right now?
    let blocked=null;
    for(const l of lanesRef.current){ const g=l.gapCenter+l.offset; if(!((GW/2+14)>(g-l.gapW/2)&&(GW/2-14)<(g+l.gapW/2))){ blocked=l; break; } }
    if(blocked){
      // Launched into an obstacle — crash and fail the stage.
      cancelAnimationFrame(slideRef.current);
      if(blocked.type==="lightning"){ SFX.lightning(); } else { SFX.cloudHit(); }
      setFlash(true);
      phaseRef.current="crashed"; setPhase("crashed");
      setTimeout(()=>{ Music.fadeOut(0.6); onFail&&onFail({reason:blocked.type==="lightning"?"遭雷擊":"撞上雲層"}); },900);
      return;
    }
    // Clear path — launch!
    cancelAnimationFrame(slideRef.current);
    SFX.ignition();
    phaseRef.current="igniting"; setPhase("igniting");
    setTimeout(()=>{ Music.fadeOut(0.6); onComplete({result:"success",score:300}); },1900);
  };

  return (
    <div style={{ position:"relative",width:GW,height:GH,maxWidth:"100%",overflow:"hidden",background:"#010407",userSelect:"none",fontFamily:"system-ui" }}>
      {flash&&<div style={{ position:"absolute",inset:0,background:"rgba(255,220,30,0.45)",zIndex:99,pointerEvents:"none" }}/>}
      <StarsBg density={.7}/>
      <div style={{ position:"absolute",top:14,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",zIndex:5 }}>
        <div style={{ fontSize:32,filter:`drop-shadow(0 0 12px ${planet.color})` }}>{planet.emoji}</div>
        <div style={{ fontSize:9,color:planet.color,fontWeight:700,letterSpacing:2,marginTop:2,fontFamily:"monospace" }}>{planet.name.toUpperCase()}</div>
      </div>
      <svg style={{ position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none" }}><line x1={GW/2} y1={75} x2={GW/2} y2={GH-140} stroke="rgba(245,166,35,0.09)" strokeWidth={1} strokeDasharray="3 8"/></svg>
      {windowOpen&&phase==="wait"&&<div style={{ position:"absolute",top:"35%",left:"50%",transform:"translateX(-50%)",background:"rgba(52,211,153,0.12)",border:"1px solid rgba(52,211,153,0.38)",borderRadius:20,padding:"5px 16px",zIndex:10,fontSize:11,fontWeight:700,color:C.green,whiteSpace:"nowrap",letterSpacing:1,fontFamily:"monospace" }}>◉ 發射窗口開啟</div>}
      {phase==="wait"&&lanes.map(l=>{ const gl=Math.max(0,l.gapCenter+l.offset-l.gapW/2),gr=Math.min(GW,l.gapCenter+l.offset+l.gapW/2); if(l.type==="lightning")return null; return <CloudStrip key={l.id} screenY={l.laneY} gapLeft={gl} gapRight={gr} planetId={planet.id}/>; })}
      {/* 閃電：planet>=4 才出現，隨機閃現，按發射時若活躍則中雷 */}
      {planet.id>=4&&phase==="wait"&&<LightningStrip key="charge-lt" screenY={GH*0.38} onHit={a=>{ lightningActiveRef.current=a; }}/>}
      {phase==="wait"&&<div style={{ position:"absolute",left:GW/2,top:GH-176,transform:"translateX(-50%)",zIndex:8 }}>
        <RocketImg rocket={rocket} wear={wear} height={120} glow={windowOpen?16:6}/>
      </div>}
      {phase==="igniting"&&<><SmokePlume x={GW/2} y={GH-120} intensity={3} spread={2.5} big/><div style={{ position:"absolute",inset:0,zIndex:22,pointerEvents:"none" }}><div style={{ position:"absolute",left:GW/2-40,top:GH-120,width:80,height:60,background:"radial-gradient(ellipse at top, rgba(255,180,40,0.7) 0%, transparent 70%)",filter:"blur(6px)" }}/><div style={{ position:"absolute",left:GW/2,top:GH-176,transform:"translateX(-50%)" }}><RocketImg rocket={rocket} wear={wear} height={120} glow={20}/></div><div style={{ position:"absolute",bottom:90,left:"50%",transform:"translateX(-50%)",fontSize:14,color:C.amber,fontFamily:"monospace",letterSpacing:2,whiteSpace:"nowrap" }}>IGNITION SEQUENCE...</div></div></>}
      <div style={{ position:"absolute",bottom:0,width:"100%",height:92,background:"linear-gradient(180deg,#0D3321,#061A0F)",borderTop:"2px solid rgba(52,180,80,0.55)",zIndex:6 }}><div style={{ textAlign:"center",paddingTop:10,fontSize:9,color:"rgba(80,180,100,0.5)",letterSpacing:2,fontFamily:"monospace" }}>T-MINUS LAUNCH COMPLEX</div></div>
      <div style={{ position:"absolute",top:0,left:0,right:0,padding:"8px 16px",background:"linear-gradient(180deg,rgba(0,0,0,0.5),transparent)",display:"flex",alignItems:"center",gap:10,zIndex:15 }}>
        <button onClick={()=>{ Music.stop(); onBack(); }} style={{ background:"none",border:"none",color:"rgba(255,255,255,0.45)",fontSize:20,cursor:"pointer",padding:0 }}>←</button>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex",gap:3,marginBottom:4 }}>
            {Array.from({length:totalStages},(_,i)=>(
              <div key={i} style={{ flex:1,height:3,borderRadius:2,background:i<stageIndex?"rgba(52,211,153,0.7)":i===stageIndex?C.amber:"rgba(255,255,255,0.12)" }}/>
            ))}
          </div>
          {stageName&&<div style={{ fontSize:11,color:C.ink,fontWeight:700 }}>{stageName}</div>}
        </div>
        <div style={{ fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:"monospace",whiteSpace:"nowrap" }}>{planet.emoji} {stageIndex+1}/{totalStages}</div>
      </div>
      {/* old top bar removed */}
      {false&&(
        <div style={{ position:"absolute",top:0,left:0,right:0,padding:"8px 16px",zIndex:15 }}>
          <div>T-MINUS</div>
        </div>
      )}
      {phase==="wait"&&(
        <div style={{ position:"absolute",bottom:92,left:0,right:0,padding:"10px 20px 14px",background:"linear-gradient(0deg,rgba(1,4,8,0.88),transparent)",zIndex:10 }}>
          <div style={{ textAlign:"center",marginBottom:12 }}>
            <div style={{ fontSize:13,color:windowOpen?C.green:C.amber,fontWeight:700,fontFamily:"monospace",letterSpacing:1 }}>
              {windowOpen?"◉ 路徑淨空 — 安全發射！":"⚠ 雲層擋路 — 發射會撞毀"}
            </div>
            <div style={{ fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:4 }}>抓準缺口對準中央再發射，撞到雲就失敗</div>
          </div>
          <div onClick={handleLaunch} onTouchStart={e=>{e.preventDefault();handleLaunch();}}
            style={{ width:"100%",height:60,background:windowOpen?`linear-gradient(135deg,${C.green},#047857)`:`linear-gradient(135deg,${C.amber},#B8730E)`,border:`1px solid ${windowOpen?"rgba(52,211,153,0.6)":"rgba(245,166,35,0.6)"}`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:15,fontWeight:800,color:"white",letterSpacing:2,fontFamily:"monospace",userSelect:"none",WebkitUserSelect:"none",boxShadow:windowOpen?`0 0 22px ${C.green}66`:`0 0 14px ${C.amber}44` }}>
            🚀 發射
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 失敗轉場提示（顯示 1.5 秒後自動進下一關）─────────────────────────────
function FailBanner({ stageName, reason, onDone, onRetry=null }) {
  useEffect(()=>{
    // 有重試卡時不自動消失，等玩家選擇
    if(onRetry) return;
    const t = setTimeout(onDone, 1500);
    return ()=> clearTimeout(t);
  },[onRetry]);
  const label = reason==="lightning"?"⚡ 遭雷擊！" : reason==="debris"?"💥 被擊中！" : reason==="撞上雲層"?"☁️ 撞上雲層！" : reason==="遭雷擊"?"⚡ 遭雷擊！" : reason==="未在時限內完成"?"⏱ 時間到！" : "✗ 任務失敗";
  return (
    <div style={{ position:"absolute",inset:0,zIndex:50,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.78)",fontFamily:"system-ui" }}>
      <div style={{ background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.4)",borderRadius:20,padding:"28px 36px",textAlign:"center",maxWidth:280 }}>
        <img src="/assets/ui_cracked_shield.png" alt="" style={{width:60,height:60,objectFit:"contain",marginBottom:10}}/>
        <div style={{ fontSize:18,fontWeight:800,color:"#EF4444",marginBottom:6 }}>{label}</div>
        <div style={{ fontSize:12,color:"#7A8EA0",marginBottom:14 }}>{stageName}</div>
        {onRetry ? (
          // 有重試卡：顯示選擇
          <div style={{ display:"flex",flexDirection:"column",gap:10,marginTop:8 }}>
            <button onClick={onRetry}
              style={{ background:"rgba(245,166,35,0.18)",border:"1px solid rgba(245,166,35,0.5)",borderRadius:12,padding:"11px 0",color:"#F5A623",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"monospace" }}>
              🔄 使用重試卡重來
            </button>
            <button onClick={onDone}
              style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"9px 0",color:"rgba(255,255,255,0.4)",fontSize:12,cursor:"pointer" }}>
              放棄，繼續下一關
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:"monospace",letterSpacing:1 }}>得 0 分 — 繼續下一關</div>
            <div style={{ marginTop:16,height:3,background:"rgba(255,255,255,0.08)",borderRadius:2,overflow:"hidden" }}>
              <div style={{ height:"100%",background:"#EF4444",borderRadius:2,animation:"failbar 1.5s linear forwards" }}/>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes failbar { from{width:100%} to{width:0%} }`}</style>
    </div>
  );
}

// ─── 成功轉場（0.8 秒後自動進下一關）────────────────────────────────────────
function SuccessBanner({ stageName, score, onDone }) {
  useEffect(()=>{
    const t = setTimeout(onDone, 900);
    return ()=> clearTimeout(t);
  },[]);
  return (
    <div style={{ position:"absolute",inset:0,zIndex:50,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.7)",fontFamily:"system-ui" }}>
      <div style={{ background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.35)",borderRadius:20,padding:"24px 36px",textAlign:"center",maxWidth:280 }}>
        <div style={{ fontSize:11,color:"rgba(52,211,153,0.6)",letterSpacing:3,fontFamily:"monospace",marginBottom:8 }}>STAGE CLEAR</div>
        <div style={{ fontSize:16,fontWeight:700,color:"#34D399",marginBottom:4 }}>{stageName}</div>
        {score>0&&<div style={{ fontSize:13,color:"rgba(245,166,35,0.8)",fontFamily:"monospace" }}>+{score}</div>}
        <div style={{ marginTop:14,height:2,background:"rgba(52,211,153,0.15)",borderRadius:1,overflow:"hidden" }}>
          <div style={{ height:"100%",background:"#34D399",borderRadius:1,animation:"successbar 0.9s linear forwards" }}/>
        </div>
      </div>
      <style>{`@keyframes successbar { from{width:100%} to{width:0%} }`}</style>
    </div>
  );
}


function Mission({ planet, rocket, wear=0, inventory={}, onUseItem, onFinish, onBack }) {
  const stages=planet.stages;
  const [stageIdx,setStageIdx]=useState(0);
  const [stageResults,setStageResults]=useState([]);
  const [showResult,setShowResult]=useState(false);
  const [failBanner,setFailBanner]=useState(null);
  const [successBanner,setSuccessBanner]=useState(null);
  const pendingSuccessRef=useRef(null);
  const pendingFailRef=useRef(null);
  // 道具選擇：每關開始前可選一個道具使用
  const [activeItem,setActiveItem]=useState(null); // 本關使用的道具 id
  const [retryKey,setRetryKey]=useState(0); // 增加此值強制 remount 當前 stage
  const [showItemPicker,setShowItemPicker]=useState(false);
  const [paused,setPaused]=useState(false);
  const pausedRef=useRef(false); // RAF closure 用 ref 才能即時讀到最新值
  const setPausedSync=(v)=>{ pausedRef.current=v; setPaused(v); };
  const itemCount = Object.values(inventory).reduce((a,b)=>a+b,0);

  const completeStage=(result)=>{
    const curIdx = stageIdx;
    const stageName = stages[curIdx]?.name||"";
    const score = result?.score||0;
    // 最後一關直接進結算，不顯示 banner
    if(curIdx+1>=stages.length){
      setStageResults(prev=>[...prev,{...result}]);
      setShowResult(true);
      return;
    }
    // 中間關：顯示成功 banner，消失後推進
    pendingSuccessRef.current=()=>{
      setStageResults(prev=>[...prev,{...result}]);
      setActiveItem(null);
      setStageIdx(curIdx+1);
      setSuccessBanner(null);
      SFX.stageComplete();
    };
    setSuccessBanner({ stageName, score });
  };
  const retryStage=()=>{
    onUseItem&&onUseItem("retry");
    setActiveItem(null);
    setFailBanner(null);
    setRetryKey(k=>k+1); // 強制 remount 當前 stage
  };

  const failStage=(reason)=>{
    const curIdx = stageIdx;
    const reasonStr = typeof reason==="string"?reason:reason?.reason||"";
    const hasRetry = (inventory["retry"]||0) > 0;
    setActiveItem(null);
    pendingFailRef.current = ()=>{
      setStageResults(prev=>[...prev,{failed:true,reason,score:0}]);
      const next=curIdx+1;
      if(next>=stages.length){ setShowResult(true); }
      else { setStageIdx(next); }
      setFailBanner(null);
    };
    setFailBanner({ stageName: stages[curIdx]?.name||"", reason: reasonStr, hasRetry, curIdx });
  };

  if(showResult) return <MissionResult planet={planet} stages={stages} stageResults={stageResults} onFinish={onFinish} onBack={onBack}/>;

  const stage=stages[stageIdx];
  const k=`${planet.id}-${stageIdx}-${retryKey}`; // retryKey 讓重試卡也能強制 remount
  // How many tiers below the recommended rocket is the player flying? 0 = adequate.
  // Each missing tier ramps difficulty so an extreme mismatch (e.g. T1 → Sun) is
  // effectively impossible, while a 1-tier gap is merely hard.
  const deficit = Math.max(0, planet.unlockRocket - (rocket?.id ?? 0));
  const underpowered = deficit > 0;
  // 當前關卡適用的道具（stage 已定義，可安全使用）
  const applicableItems = ITEMS.filter(it=>{
    if(!(inventory[it.id]>0)) return false;
    const types = ITEM_STAGE_TYPES[it.id];
    return !types || types.includes(stage?.type);
  });
  const p={ key:k, planet,rocket,wear,inventory,stage,stageName:stage.name,stageIndex:stageIdx,totalStages:stages.length,underpowered,deficit,onBack,onComplete:completeStage,onFail:failStage,activeItem,pausedRef };

  // TEST MODE: instant-win helpers so you can race to the final stage/planet
  // without playing every sub-stage. Each gives full marks for the stage(s).
  const skipStage=()=>{ completeStage({ score: STAGE_MAX_SCORE[stage.type]||300, perfect:true }); };
  const winAll=()=>{
    const results=stages.map(st=>({ score: STAGE_MAX_SCORE[st.type]||300, perfect:true }));
    setStageResults(results); setShowResult(true);
  };
  const testBar = TEST.on ? (
    <div style={{ position:"absolute",bottom:8,left:8,right:8,zIndex:40,display:"flex",gap:8 }}>
      <button onClick={skipStage} style={{ flex:1,padding:"9px 0",background:"rgba(52,211,153,0.18)",border:"1px solid rgba(52,211,153,0.5)",borderRadius:10,color:C.green,fontSize:11,fontFamily:"monospace",fontWeight:700,cursor:"pointer" }}>⏭ 跳過本關</button>
      <button onClick={winAll} style={{ flex:1,padding:"9px 0",background:"rgba(245,166,35,0.18)",border:"1px solid rgba(245,166,35,0.5)",borderRadius:10,color:C.amber,fontSize:11,fontFamily:"monospace",fontWeight:700,cursor:"pointer" }}>⏯ 秒過整關(滿分)</button>
    </div>
  ) : null;

  // Route by engine type
  const StageEl =
    stage.type==="charge" ? <ChargeStage {...p}/> :
    stage.type==="tap"    ? <Stage2_Booster {...p}/> :
    stage.type==="dodge"  ? <Stage3_Exosphere {...p}/> :
    stage.type==="land"   ? <Stage4_Orbit {...p}/> :
    <Stage2_Booster {...p}/>;
  // 道具選擇器（疊在小關畫面上）
  const itemPickerUI = showItemPicker ? (
    <div style={{ position:"absolute",inset:0,zIndex:60,background:"rgba(0,0,0,0.88)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"system-ui" }}>
      <div style={{ color:"rgba(255,255,255,0.5)",fontSize:11,letterSpacing:2,fontFamily:"monospace",marginBottom:4 }}>選擇道具（本關使用）</div>
      <div style={{ fontSize:9,color:"rgba(255,255,255,0.25)",marginBottom:16,fontFamily:"monospace" }}>只顯示本關有效道具</div>
      <div style={{ display:"flex",flexDirection:"column",gap:10,width:280 }}>
        {applicableItems.length===0 && (
          <div style={{ textAlign:"center",color:"rgba(255,255,255,0.3)",fontSize:12,padding:"20px 0" }}>
            本關沒有適用道具
          </div>
        )}
        {applicableItems.map(it=>(
          <button key={it.id} onClick={()=>{ setActiveItem(it.id); onUseItem&&onUseItem(it.id); setShowItemPicker(false); setPausedSync(false); setRetryKey(k=>k+1); SFX.uiTap(); }}
            style={{ display:"flex",alignItems:"center",gap:12,background:`${it.color}18`,border:`1px solid ${it.color}55`,borderRadius:14,padding:"12px 16px",cursor:"pointer",textAlign:"left" }}>
            <img src={it.img} alt={it.name} style={{ width:36,height:36,objectFit:"contain" }}/>
            <div>
              <div style={{ fontSize:13,fontWeight:700,color:it.color }}>{it.name}</div>
              <div style={{ fontSize:11,color:"rgba(255,255,255,0.45)",marginTop:2 }}>{it.desc}</div>
            </div>
          </button>
        ))}
        <button onClick={()=>{ setShowItemPicker(false); setPausedSync(false); }}
          style={{ background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"10px",color:"rgba(255,255,255,0.4)",fontSize:12,cursor:"pointer" }}>
          不使用道具
        </button>
      </div>
    </div>
  ) : null;

  // 道具提示按鈕（右下角，有道具時顯示）
  const itemHintBtn = (!showItemPicker && applicableItems.length>0 && !activeItem && !showResult && !failBanner) ? (
    <button onClick={()=>{ SFX.uiTap(); setShowItemPicker(true); setPausedSync(true); }}
      style={{ position:"absolute",bottom:60,right:12,zIndex:35,background:"rgba(0,0,0,0.7)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:12,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6 }}>
      <span style={{ fontSize:16 }}>🎒</span>
      <span style={{ fontSize:10,color:"rgba(255,255,255,0.6)",fontFamily:"monospace" }}>{itemCount}</span>
    </button>
  ) : null;

  // 已使用道具提示
  const activeItemBadge = activeItem ? (()=>{
    const it = ITEMS.find(i=>i.id===activeItem);
    return it ? (
      <div style={{ position:"absolute",bottom:60,right:12,zIndex:35,background:`${it.color}22`,border:`1px solid ${it.color}55`,borderRadius:12,padding:"6px 10px",display:"flex",alignItems:"center",gap:6 }}>
        <img src={it.img} alt={it.name} style={{ width:16,height:16,objectFit:"contain" }}/>
        <span style={{ fontSize:10,color:it.color,fontFamily:"monospace" }}>{it.name} 生效中</span>
      </div>
    ) : null;
  })() : null;

  return (
    <div style={{ position:"relative",width:"100%",height:"100%" }}>
      {StageEl}
      {testBar}
      {itemHintBtn}
      {activeItemBadge}
      {itemPickerUI}
      {successBanner && (
        <SuccessBanner
          stageName={successBanner.stageName}
          score={successBanner.score}
          onDone={()=>{ if(pendingSuccessRef.current){ pendingSuccessRef.current(); pendingSuccessRef.current=null; } }}
        />
      )}
      {failBanner && (
        <FailBanner
          stageName={failBanner.stageName}
          reason={failBanner.reason}
          onDone={()=>{ if(pendingFailRef.current){ pendingFailRef.current(); pendingFailRef.current=null; } }}
          onRetry={failBanner.hasRetry ? ()=>retryStage() : null}
        />
      )}
    </div>
  );
}

// ─── Shell screens ─────────────────────────────────────────────────────────────
function Home({ onLaunch, onRnD, onSurvival, onLeaderboard, playerName, funds, rocketId, maxRocket=0, onSelectRocket, launches, rocketUses={}, onReset, inventory={}, onWatchAd, adCount=0 }) {
  const rocket=ROCKETS[rocketId];
  const wear=wearLevel(rocketUses[rocketId]||0);
  const next=ROCKETS[maxRocket+1], pct=next?Math.min(100,(funds/next.cost)*100):100;
  const canPrev=rocketId>0, canNext=rocketId<maxRocket;
  const startedRef=useRef(false);
  const [adCountLocal,setAdCountLocal]=useState(adCount);
  // Try to start music on mount (works if audio already unlocked from a previous screen)
  useEffect(()=>{ Music.play("home"); },[]);
  // Browsers block audio until a user gesture — (re)start music on first tap.
  const kickAudio=()=>{ initAudio(); if(!startedRef.current){ startedRef.current=true; Music.play("home", true); } };
  return (
    <div style={{ position:"relative",width:GW,height:GH,maxWidth:"100%",overflow:"hidden",fontFamily:"system-ui",color:C.ink }}
      onClick={kickAudio} onTouchStart={kickAudio}>

      <StarsBg/>
      <div style={{ position:"absolute",bottom:0,width:"100%",height:92,background:"linear-gradient(180deg,#0D3321,#061A0F)",borderTop:"2px solid rgba(52,180,80,0.45)",zIndex:6 }}><div style={{ textAlign:"center",paddingTop:10,fontSize:9,color:"rgba(80,180,100,0.45)",letterSpacing:2,fontFamily:"monospace" }}>T-MINUS LAUNCH COMPLEX</div></div>
      <div style={{ position:"absolute",top:42,left:0,right:0,textAlign:"center",zIndex:2 }}>
        <div style={{ fontSize:9,color:"rgba(245,166,35,0.55)",letterSpacing:5,fontFamily:"monospace",marginBottom:10 }}>LAUNCH SEQUENCE INITIATED</div>
        <div style={{ fontSize:44,fontWeight:900,letterSpacing:6,color:C.ink,lineHeight:1 }}>T-MINUS</div>
        <div style={{ fontSize:11,color:"rgba(245,166,35,0.7)",letterSpacing:4,marginTop:6,fontFamily:"monospace" }}>火箭倒數</div>
      </div>
      <div style={{ position:"absolute",bottom:92,left:20,right:20,zIndex:2 }}>
        <div style={{ background:C.panel,border:`1px solid ${C.border}`,borderRadius:16,padding:"10px 14px",marginBottom:8 }}>
          <div style={{ fontSize:9,color:"rgba(245,166,35,0.45)",letterSpacing:2,fontFamily:"monospace",marginBottom:10 }}>MISSION STATUS</div>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:14 }}>
            <div><div style={{ fontSize:9,color:C.inkDim }}>FUNDS</div><div style={{ fontSize:22,fontWeight:800,color:C.amber }}>${funds.toLocaleString()}</div></div>
            <div style={{ textAlign:"right" }}><div style={{ fontSize:9,color:C.inkDim }}>LAUNCHES</div><div style={{ fontSize:22,fontWeight:800,color:C.inkDim }}>{launches}</div></div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:8,paddingTop:12,borderTop:`1px solid ${C.border}` }}>
            {/* ◀ switch to previous owned rocket */}
            <button onClick={()=>canPrev&&onSelectRocket&&onSelectRocket(rocketId-1)} disabled={!canPrev}
              style={{ width:30,height:30,flexShrink:0,borderRadius:8,border:`1px solid ${canPrev?C.border:"transparent"}`,background:canPrev?"rgba(255,255,255,0.06)":"transparent",color:canPrev?C.ink:"rgba(255,255,255,0.12)",fontSize:14,cursor:canPrev?"pointer":"default",fontFamily:"monospace" }}>◀</button>
            <div style={{ width:44,display:"flex",justifyContent:"center" }}><RocketImg rocket={rocket} wear={wear} height={52} glow={7}/></div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12,fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:6 }}>{rocket.name}
                <span style={{ fontSize:8,padding:"1px 6px",borderRadius:4,background:wear===0?"rgba(52,211,153,0.15)":wear===1?"rgba(245,166,35,0.15)":"rgba(239,68,68,0.18)",color:wear===0?C.green:wear===1?C.amber:C.red,fontFamily:"monospace" }}>{WEAR_LABEL[wear]}</span>
                {maxRocket>0 && <span style={{ fontSize:8,color:C.inkDim,fontFamily:"monospace",marginLeft:"auto" }}>{rocketId+1}/{maxRocket+1}</span>}
              </div>
              {/* Hull condition bar */}
              <div style={{ height:3,background:"rgba(255,255,255,0.07)",borderRadius:2,marginBottom:4 }}><div style={{ width:`${100-wear*30}%`,height:"100%",background:wear>=2?C.red:wear===1?C.amber:C.green,borderRadius:2 }}/></div>
              {next?(<><div style={{ height:3,background:"rgba(255,255,255,0.07)",borderRadius:2,marginBottom:3 }}><div style={{ width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${C.amber},${C.amberGlow})`,borderRadius:2 }}/></div><div style={{ fontSize:9,color:C.inkDim,fontFamily:"monospace" }}>下一代 {next.name} · ${next.cost.toLocaleString()}</div></>):<div style={{ fontSize:10,color:C.green }}>已達最高型號</div>}
            </div>
            {/* ▶ switch to next owned rocket */}
            <button onClick={()=>canNext&&onSelectRocket&&onSelectRocket(rocketId+1)} disabled={!canNext}
              style={{ width:30,height:30,flexShrink:0,borderRadius:8,border:`1px solid ${canNext?C.border:"transparent"}`,background:canNext?"rgba(255,255,255,0.06)":"transparent",color:canNext?C.ink:"rgba(255,255,255,0.12)",fontSize:14,cursor:canNext?"pointer":"default",fontFamily:"monospace" }}>▶</button>
          </div>
          {wear>=2 && <div style={{ fontSize:9,color:C.red,marginTop:8,textAlign:"center",fontFamily:"monospace" }}>⚠ 船體嚴重磨損，建議研發新型火箭</div>}
        </div>
        <button onClick={()=>{ SFX.uiTap(); onLaunch(); }} style={{ width:"100%",padding:"15px 0",marginBottom:8,background:`linear-gradient(135deg,${C.amber},${C.amberGlow})`,border:"none",borderRadius:14,color:"#000",fontSize:13,fontWeight:800,letterSpacing:2,fontFamily:"monospace",cursor:"pointer",boxShadow:`0 0 22px rgba(245,166,35,0.38)` }}>◉ SELECT TARGET</button>
        <div style={{ display:"flex",gap:8,marginBottom:8 }}>
          <button onClick={()=>{ SFX.uiTap(); onSurvival&&onSurvival(); }} style={{ flex:1,padding:"12px 0",background:"rgba(52,211,153,0.12)",border:"1px solid rgba(52,211,153,0.35)",borderRadius:12,color:"#34D399",fontSize:11,fontWeight:700,fontFamily:"monospace",letterSpacing:1,cursor:"pointer" }}><img src="/assets/ui_rocket_launch.png" alt="" style={{width:16,height:16,objectFit:"contain",verticalAlign:"middle",marginRight:4}}/> 生存挑戰</button>
          <button onClick={()=>{ SFX.uiTap(); onLeaderboard&&onLeaderboard(); }} style={{ flex:1,padding:"12px 0",background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:12,color:C.amber,fontSize:11,fontWeight:700,fontFamily:"monospace",letterSpacing:1,cursor:"pointer" }}><img src="/assets/ui_trophy.png" alt="" style={{width:16,height:16,objectFit:"contain",verticalAlign:"middle",marginRight:4}}/> 排行榜</button>
        </div>
        <button onClick={()=>{ SFX.uiTap(); onRnD(); }} style={{ width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 0",color:C.inkDim,fontSize:11,fontFamily:"monospace",letterSpacing:1,cursor:"pointer" }}><img src="/assets/ui_wrench_gear.png" alt="" style={{width:16,height:16,objectFit:"contain",verticalAlign:"middle",marginRight:4}}/> R&D CENTER</button>
        {/* 道具欄 + 看廣告 */}
        <div style={{ marginTop:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
            <div style={{ fontSize:9,color:C.inkDim,letterSpacing:2,fontFamily:"monospace" }}>道具欄 ({Object.values(inventory).reduce((a,b)=>a+b,0)}/{MAX_INVENTORY})</div>
            <button onClick={()=>{ SFX.uiTap(); onWatchAd&&onWatchAd(item=>{ setAdCountLocal(todayAdCount()); }); }}
              style={{ fontSize:10,color:adCountLocal>=MAX_AD_PER_DAY?C.inkDim:C.amber,background:"transparent",border:`1px solid ${adCountLocal>=MAX_AD_PER_DAY?"rgba(255,255,255,0.1)":"rgba(245,166,35,0.4)"}`,borderRadius:8,padding:"3px 10px",cursor:adCountLocal>=MAX_AD_PER_DAY?"not-allowed":"pointer",fontFamily:"monospace" }}>
              <><img src="/assets/ui_play_screen.png" alt="" style={{width:14,height:14,objectFit:"contain",verticalAlign:"middle",marginRight:4}}/> 看廣告換道具 ({MAX_AD_PER_DAY-adCountLocal}次)</>
            </button>
          </div>
          <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
            {ITEMS.filter(it=>it.id!=="retry").map(it=>{
              const count=inventory[it.id]||0;
              if(count===0) return null;
              return (
                <div key={it.id} style={{ display:"flex",alignItems:"center",gap:4,background:`${it.color}18`,border:`1px solid ${it.color}44`,borderRadius:8,padding:"4px 8px" }}>
                  <img src={it.img} alt={it.name} style={{ width:18,height:18,objectFit:"contain" }}/>
                  <span style={{ fontSize:10,color:it.color,fontWeight:700 }}>{it.name}</span>
                  {count>1&&<span style={{ fontSize:9,color:C.inkDim }}>×{count}</span>}
                </div>
              );
            })}
            {ITEMS.filter(it=>it.id!=="retry").every(it=>!(inventory[it.id]>0))&&(
              <div style={{ fontSize:10,color:"rgba(255,255,255,0.2)",fontFamily:"monospace" }}>尚無道具，看廣告獲得</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanetSelect({ onSelect, onBack, funds, rocketId, isPlanetUnlocked, planetNeedsBetterRocket, maxPlanetCleared, planetProgress={}, onPlanetLeaderboard }) {
  // Only show planets up to the next unlocked one (hide far-future planets).
  const nextLocked=maxPlanetCleared+1; // the one currently playable
  const visible=PLANETS.filter(p=> p.id<=nextLocked);
  return (
    <div style={{ background:"#010407",height:"100dvh",maxHeight:"100dvh",fontFamily:"system-ui",color:C.ink,display:"flex",flexDirection:"column",position:"relative",overflow:"hidden" }}>
      <StarsBg/>
      <div style={{ padding:"14px 20px 10px",display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${C.border}`,position:"relative",zIndex:2 }}>
        <button onClick={()=>{ SFX.uiTap(); onBack(); }} style={{ background:"none",border:"none",color:C.inkDim,fontSize:22,cursor:"pointer",padding:0 }}>←</button>
        <span style={{ fontWeight:700,fontSize:12,letterSpacing:2,fontFamily:"monospace" }}>選擇目標</span>
        <div style={{ flex:1 }}/><span style={{ color:C.amber,fontSize:12,fontFamily:"monospace" }}>${funds.toLocaleString()}</span>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:"12px 16px 24px",position:"relative",zIndex:2 }}>
        {visible.map(p=>{ const unlocked=isPlanetUnlocked(p.id); const cleared=p.id<=maxPlanetCleared; const needRocket=planetNeedsBetterRocket&&planetNeedsBetterRocket(p.id);
          const prog=planetProgress[p.id]||0, thresh=UNLOCK_THRESHOLD[p.id], progPct=Math.min(100,Math.round(prog/thresh*100));
          return <div key={p.id} onClick={()=>{ if(unlocked){ SFX.uiTap(); onSelect(p); }}} style={{ background:unlocked?"rgba(255,255,255,0.04)":"rgba(255,255,255,0.02)",border:`1px solid ${unlocked?p.color+"33":needRocket?"rgba(239,68,68,0.3)":C.border}`,borderRadius:14,padding:"12px 14px",marginBottom:8,cursor:unlocked?"pointer":"not-allowed",display:"flex",alignItems:"center",gap:12,opacity:unlocked?1:0.5 }}>
          <div style={{ fontSize:34,filter:unlocked?`drop-shadow(0 0 8px ${p.color})`:"none" }}>{p.emoji}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:6 }}>{p.name}{p.isBoss&&<span style={{ fontSize:9,background:C.purple,borderRadius:4,padding:"1px 6px" }}>BOSS</span>}{cleared&&<span style={{ fontSize:9,color:C.green }}>✓ 已征服</span>}</div>
            <div style={{ fontSize:10,color:C.inkDim,marginTop:1,fontFamily:"monospace" }}>{p.stages.length} 段任務 · +${p.baseScore.toLocaleString()}</div>
            {/* Conquest progress toward unlocking the next planet */}
            {unlocked && !cleared && (
              <div style={{ marginTop:5 }}>
                <div style={{ display:"flex",justifyContent:"space-between",fontSize:9,color:C.inkDim,fontFamily:"monospace",marginBottom:2 }}>
                  <span>征服進度</span><span style={{ color:progPct>=100?C.green:C.amber }}>{prog}/{thresh}</span>
                </div>
                <div style={{ height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden" }}>
                  <div style={{ height:"100%",width:`${progPct}%`,background:progPct>=100?C.green:`linear-gradient(90deg,${p.color},${p.color}aa)`,borderRadius:3 }}/>
                </div>
              </div>
            )}
            {needRocket&&<div style={{ fontSize:10,color:C.red,marginTop:2,fontWeight:700 }}>🔒 需要 {ROCKETS[p.unlockRocket].name}</div>}
          </div>
          <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"center" }}>
            {unlocked&&<div style={{ color:p.color,fontSize:16 }}>▶</div>}
            <button onClick={e=>{ e.stopPropagation(); SFX.uiTap(); onPlanetLeaderboard&&onPlanetLeaderboard(p); }}
              style={{ background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:8,padding:"3px 8px",fontSize:10,color:"#F5A623",cursor:"pointer",fontFamily:"monospace" }}><img src="/assets/ui_podium.png" alt="" style={{width:16,height:16,objectFit:"contain"}}/></button>
          </div>
        </div>; })}
        {/* Hint that more planets await */}
        {nextLocked<PLANETS.length-1 && (
          <div style={{ background:"rgba(255,255,255,0.02)",border:`1px dashed ${C.border}`,borderRadius:14,padding:"14px",textAlign:"center",opacity:0.5 }}>
            <img src="/assets/ui_padlock.png" alt="" style={{width:40,height:40,objectFit:"contain",marginBottom:4}}/>
            <div style={{ fontSize:11,color:C.inkDim }}>征服 {PLANETS[nextLocked].name} 後解鎖下一個星球</div>
          </div>
        )}
      </div>
    </div>
  );
}

// 修復費用：基礎費 × 火箭等級倍率
// T1最便宜，T5最貴；戰損越重越貴
const REPAIR_BASE = { 1:400, 2:1000, 3:2200 }; // 戰損1/2/3的基礎費
const REPAIR_TIER = [1, 1.4, 2.2, 4.0, 7.5];   // T1~T5 的倍率
function repairCost(rocketId, wear) {
  if(wear<=0) return 0;
  return Math.round((REPAIR_BASE[wear]||1000) * (REPAIR_TIER[rocketId]||1));
}
// 道具購買價格
const ITEM_PRICES = { radar:1200, shield:1500, retry:2000, widen:1200, lightning:1800, slowland:1500 };

function RnD({ onBack, funds, rocketId, rocketUses={}, onUnlock, onRepair, onBuyItem, inventory={} }) {
  return (
    <div style={{ background:"#010407",height:"100dvh",maxHeight:"100dvh",fontFamily:"system-ui",color:C.ink,display:"flex",flexDirection:"column",position:"relative",overflow:"hidden" }}>
      <StarsBg/>
      <div style={{ padding:"14px 20px 10px",display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${C.border}`,position:"relative",zIndex:2 }}>
        <button onClick={()=>{ SFX.uiTap(); onBack(); }} style={{ background:"none",border:"none",color:C.inkDim,fontSize:22,cursor:"pointer",padding:0 }}>←</button>
        <span style={{ fontWeight:700,fontSize:12,letterSpacing:2,fontFamily:"monospace",display:"flex",alignItems:"center",gap:6 }}><img src="/assets/ui_wrench_gear.png" alt="" style={{width:18,height:18,objectFit:"contain"}}/> R&D CENTER</span>
        <div style={{ flex:1 }}/><span style={{ color:C.amber,fontSize:12,fontFamily:"monospace" }}>${funds.toLocaleString()}</span>
      </div>
      <div style={{ flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"16px 16px 40px",position:"relative",zIndex:2 }}>

        {/* ── 火箭研發 ── */}
        <div style={{ fontSize:9,color:C.inkDim,letterSpacing:2,fontFamily:"monospace",marginBottom:10 }}>火箭研發</div>
        {ROCKETS.filter((r,i)=>i<=rocketId+1).map((r,i)=>{
          const owned=i<=rocketId, canBuy=!owned&&i===rocketId+1&&funds>=r.cost, tooExp=!owned&&funds<r.cost;
          const wear=owned?wearLevel(rocketUses[r.id]||0):0;
          const rCost=owned&&wear>0?repairCost(r.id,wear):0;
          const canRepair=owned&&wear>0&&funds>=rCost;
          return (
            <div key={r.id} style={{ background:owned?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.03)",border:`1px solid ${owned?r.color+"44":C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:10,display:"flex",alignItems:"center",gap:12,opacity:tooExp&&!owned?0.55:1 }}>
              <div style={{ width:54,display:"flex",justifyContent:"center",opacity:owned?1:0.5,filter:owned?"none":"grayscale(0.6)" }}>
                <RocketImg rocket={r} wear={wear} height={64} glow={owned?8:0}/>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700,fontSize:13 }}>{r.name}</div>
                <div style={{ fontSize:10,color:C.inkDim,marginTop:1 }}>T-Minus 系列</div>
                {owned && wear>0 && <div style={{ fontSize:10,color:wear>=2?C.red:C.amber,marginTop:2,fontFamily:"monospace" }}>⚠ {WEAR_LABEL[wear]}</div>}
                {!owned && <div style={{ fontSize:10,color:tooExp?C.red:C.amber,marginTop:3,fontFamily:"monospace" }}>${r.cost.toLocaleString()}</div>}
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end" }}>
                {canBuy&&<button onClick={()=>{ SFX.uiTap(); onUnlock(r); }} style={{ background:`linear-gradient(135deg,${C.amber},${C.amberGlow})`,border:"none",borderRadius:10,padding:"8px 14px",color:"#000",fontWeight:800,fontSize:11,cursor:"pointer",fontFamily:"monospace" }}>研發</button>}
                {tooExp&&!owned&&<div style={{ fontSize:10,color:C.inkDim,fontFamily:"monospace" }}>差 ${(r.cost-funds).toLocaleString()}</div>}
                {owned&&wear>0&&(
                  canRepair
                    ? <button onClick={()=>{ SFX.uiTap(); onRepair(r.id,rCost); }}
                        style={{ background:"rgba(52,211,153,0.15)",border:"1px solid rgba(52,211,153,0.4)",borderRadius:10,padding:"6px 12px",color:C.green,fontWeight:700,fontSize:10,cursor:"pointer",fontFamily:"monospace",whiteSpace:"nowrap" }}>
                        🔧 修復 ${rCost.toLocaleString()}
                      </button>
                    : <div style={{ fontSize:9,color:C.red,fontFamily:"monospace" }}>差 ${(rCost-funds).toLocaleString()}</div>
                )}
                {owned&&wear===0&&<div style={{ fontSize:10,color:C.green,fontFamily:"monospace" }}>✓ 完好</div>}
              </div>
            </div>
          );
        })}
        {rocketId+1<ROCKETS.length-1&&(
          <div style={{ background:"rgba(255,255,255,0.02)",border:`1px dashed ${C.border}`,borderRadius:14,padding:"14px",textAlign:"center",opacity:0.5,marginBottom:10 }}>
            <img src="/assets/ui_padlock.png" alt="" style={{width:40,height:40,objectFit:"contain",marginBottom:4}}/>
            <div style={{ fontSize:11,color:C.inkDim }}>研發出下一台火箭後解鎖更多型號</div>
          </div>
        )}

        {/* ── 道具商店 ── */}
        <div style={{ fontSize:9,color:C.inkDim,letterSpacing:2,fontFamily:"monospace",margin:"16px 0 10px" }}>道具商店</div>
        {ITEMS.map(it=>{
          const price=ITEM_PRICES[it.id]||1500;
          const canAfford=funds>=price;
          const owned=(inventory[it.id]||0)>0;
          const totalItems=Object.values(inventory).reduce((a,b)=>a+b,0);
          const full=totalItems>=MAX_INVENTORY;
          return (
            <div key={it.id} style={{ background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:14,padding:"12px 14px",marginBottom:8,display:"flex",alignItems:"center",gap:12,opacity:!canAfford&&!owned?0.55:1 }}>
              <img src={it.img} alt={it.name} style={{ width:40,height:40,objectFit:"contain",filter:"drop-shadow(0 0 4px rgba(0,0,0,0.5))" }}/>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13,fontWeight:700 }}>{it.name}</div>
                <div style={{ fontSize:10,color:C.inkDim,marginTop:2 }}>{it.desc}</div>
                {owned&&<div style={{ fontSize:9,color:C.amber,marginTop:2,fontFamily:"monospace" }}>持有 {inventory[it.id]} 個</div>}
              </div>
              <div style={{ textAlign:"right" }}>
                {full&&!owned
                  ? <div style={{ fontSize:9,color:C.inkDim,fontFamily:"monospace" }}>道具欄已滿</div>
                  : canAfford
                    ? <button onClick={()=>{ SFX.uiTap(); onBuyItem(it.id,price); }}
                        style={{ background:"rgba(245,166,35,0.15)",border:"1px solid rgba(245,166,35,0.4)",borderRadius:10,padding:"6px 12px",color:C.amber,fontWeight:700,fontSize:10,cursor:"pointer",fontFamily:"monospace",whiteSpace:"nowrap" }}>
                        購買 ${price.toLocaleString()}
                      </button>
                    : <div style={{ fontSize:9,color:C.red,fontFamily:"monospace" }}>差 ${(price-funds).toLocaleString()}</div>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Save system (big-stage checkpoints only; localStorage) ─────────────────────
const SAVE_KEY = "tminus_save_v1";
function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw)return null;
    const s=JSON.parse(raw);
    if(typeof s!=="object"||s===null)return null;
    return s;
  }catch(e){ return null; }
}
function writeSave(data){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(data)); }catch(e){}
}
function clearSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

export default function App() {
  const saved = (typeof window!=="undefined") ? loadSave() : null;
  const [screen,setScreen]=useState("home");
  const [playerName]=useState(getPlayerName());
  const [survivalKey,setSurvivalKey]=useState(0); // 重新挑戰用
  const [leaderboardMode,setLeaderboardMode]=useState("survival");
  const [leaderboardPlanet,setLeaderboardPlanet]=useState(null);
  const [planet,setPlanet]=useState(null);
  const [funds,setFunds]=useState(saved?.funds ?? 0);
  // maxRocket = highest tier OWNED (unlocks via R&D). rocketId = currently SELECTED
  // rocket for missions (can be any 0..maxRocket). Buying a new rocket bumps maxRocket
  // and auto-selects it, but you can switch back to older rockets from the base.
  const [maxRocket,setMaxRocket]=useState(saved?.maxRocket ?? saved?.rocketId ?? 0);
  const [rocketId,setRocketId]=useState(saved?.rocketId ?? 0);
  const [launches,setLaunches]=useState(saved?.launches ?? 0);
  const [rocketUses,setRocketUses]=useState(saved?.rocketUses ?? {}); // {rocketId: timesUsed} → battle damage
  // Cumulative clear-score per planet id: {0: 165, 1: 80, ...}. A planet counts as
  // "cleared" once its total reaches UNLOCK_THRESHOLD[id]. Each pass adds its %.
  const [planetProgress,setPlanetProgress]=useState(saved?.planetProgress ?? {});
  // inventory: { itemId: count } e.g. { radar:1, retry:2 }
  const [inventory,setInventory]=useState(saved?.inventory ?? {});
  const [adCount,setAdCount]=useState(todayAdCount());

  // 看廣告換道具（假廣告，5秒後給道具）
  const watchAd=(onDone)=>{
    if(adCount>=MAX_AD_PER_DAY){ alert("今天廣告次數已用完，明天再來！"); return; }
    const total = Object.values(inventory).reduce((a,b)=>a+b,0);
    if(total>=MAX_INVENTORY){ alert("道具欄已滿（最多10個），先用掉再來！"); return; }
    // 模擬廣告播放（正式上架後換成 AdMob）
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;color:white";
    let sec = 5;
    overlay.innerHTML = `<div style="font-size:14px;color:#7A8EA0;letter-spacing:2px;margin-bottom:12px;font-family:monospace">廣告播放中</div><div id="ad-sec" style="font-size:48px;font-weight:900">${sec}</div><div style="font-size:11px;color:#7A8EA0;margin-top:12px">看完廣告獲得隨機道具</div>`;
    document.body.appendChild(overlay);
    const timer = setInterval(()=>{
      sec--;
      const el = document.getElementById("ad-sec");
      if(el) el.textContent = sec;
      if(sec<=0){
        clearInterval(timer);
        document.body.removeChild(overlay);
        // 給隨機道具
        const available = ITEMS.filter(it=>(inventory[it.id]||0)<1); // 沒有才給
        const pick = available.length>0
          ? available[Math.floor(Math.random()*available.length)]
          : ITEMS[Math.floor(Math.random()*ITEMS.length)];
        const ni = {...inventory, [pick.id]:(inventory[pick.id]||0)+1};
        setInventory(ni);
        addAdCount();
        setAdCount(todayAdCount());
        persist({ inventory:ni });
        onDone && onDone(pick);
      }
    },1000);
  };

  // 使用道具
  const useItem=(itemId)=>{
    if(!inventory[itemId]) return;
    const ni={...inventory,[itemId]:inventory[itemId]-1};
    if(ni[itemId]<=0) delete ni[itemId];
    setInventory(ni);
    persist({ inventory:ni });
  };

  // Persist a snapshot. Called only at big-stage checkpoints (not mid-mission).
  const persist=(over={})=>{
    writeSave({
      funds, maxRocket, rocketId, launches, rocketUses, planetProgress, inventory,
      savedAt: Date.now(), ...over,
    });
  };

  // A planet is "conquered" once accumulated clear-score ≥ its threshold.
  const isPlanetConquered=(pid)=> (planetProgress[pid]||0) >= UNLOCK_THRESHOLD[pid];
  // Highest conquered planet (for gating the next one).
  const maxPlanetCleared = (()=>{ let m=-1; for(let i=0;i<PLANETS.length;i++){ if(isPlanetConquered(i)) m=i; else break; } return m; })();

  const isPlanetUnlocked=(pid)=>{
    const prog = pid===0 || pid<=maxPlanetCleared+1;       // story progress
    const tier = maxRocket >= PLANETS[pid].unlockRocket;    // owns a strong-enough rocket
    return prog && tier;
  };
  // Does the player have progress but lack the rocket? (used to nudge upgrade)
  const planetNeedsBetterRocket=(pid)=> (pid===0||pid<=maxPlanetCleared+1) && maxRocket < PLANETS[pid].unlockRocket;
  const currentWear=wearLevel(rocketUses[rocketId]||0);

  return (
    <div style={{ maxWidth:GW,margin:"0 auto",height:"100dvh",overflow:["leaderboard","planets","rnd"].includes(screen)?"auto":"hidden" }} onClick={initAudio}>
      {screen==="home"&&<Home onLaunch={()=>setScreen("planets")} onRnD={()=>setScreen("rnd")}
        onSurvival={()=>{ setScreen("survival"); }}
        onLeaderboard={()=>{ setLeaderboardMode("survival"); setLeaderboardPlanet(null); setScreen("leaderboard"); }}
        playerName={playerName} funds={funds} rocketId={rocketId} maxRocket={maxRocket} onSelectRocket={(id)=>{ const nid=Math.max(0,Math.min(maxRocket,id)); setRocketId(nid); SFX.uiTap(); persist({ rocketId:nid }); }} launches={launches} rocketUses={rocketUses} inventory={inventory} adCount={adCount} onWatchAd={watchAd} onReset={()=>{ clearSave(); setFunds(0); setMaxRocket(0); setRocketId(0); setLaunches(0); setRocketUses({}); setPlanetProgress({}); setInventory({}); }}/>}
      {screen==="planets"&&<PlanetSelect onSelect={p=>{setPlanet(p);setScreen("mission");}} onBack={()=>setScreen("home")} funds={funds} rocketId={rocketId} isPlanetUnlocked={isPlanetUnlocked} planetNeedsBetterRocket={planetNeedsBetterRocket} maxPlanetCleared={maxPlanetCleared} planetProgress={planetProgress} onPlanetLeaderboard={p=>{ setLeaderboardMode("mission"); setLeaderboardPlanet(p); setScreen("leaderboard"); }}/>}
      {screen==="mission"&&planet&&<Mission planet={planet} rocket={ROCKETS[rocketId]} wear={currentWear} inventory={inventory} onUseItem={useItem} onFinish={(e,passed,pct)=>{
        const nf=funds+e, nl=launches+1;
        // 只有失敗才戰損，過關不磨損火箭
        const nu=passed ? rocketUses : {...rocketUses,[rocketId]:(rocketUses[rocketId]||0)+1};
        // Only a passing run (≥60%) adds its score toward conquering the planet.
        const np={...planetProgress}; if(passed){ np[planet.id]=(np[planet.id]||0)+(pct||0); }
        setFunds(nf); setLaunches(nl); setRocketUses(nu); setPlanetProgress(np);
        persist({ funds:nf, launches:nl, rocketUses:nu, planetProgress:np }); // checkpoint save
        setScreen("home");
      }} onBack={()=>setScreen("planets")}/>}
      {screen==="rnd"&&<RnD onBack={()=>setScreen("home")} funds={funds} rocketId={maxRocket} rocketUses={rocketUses} inventory={inventory}
        onUnlock={r=>{ if(funds>=r.cost){ const nf=funds-r.cost; setFunds(nf); setMaxRocket(r.id); setRocketId(r.id); persist({ funds:nf, maxRocket:r.id, rocketId:r.id }); } }}
        onRepair={(rid,cost)=>{ if(funds>=cost){ const nf=funds-cost; const nu={...rocketUses,[rid]:0}; setFunds(nf); setRocketUses(nu); persist({ funds:nf, rocketUses:nu }); } }}
        onBuyItem={(itemId,price)=>{
          const total=Object.values(inventory).reduce((a,b)=>a+b,0);
          if(funds>=price && total<MAX_INVENTORY){
            const nf=funds-price;
            const ni={...inventory,[itemId]:(inventory[itemId]||0)+1};
            setFunds(nf); setInventory(ni); persist({ funds:nf, inventory:ni });
          }
        }}/>}
      {screen==="survival"&&<SurvivalMode key={survivalKey} rocket={ROCKETS[rocketId]} wear={2} playerName={playerName}
        onBack={()=>setScreen("home")}
        onRestart={()=>setSurvivalKey(k=>k+1)}
        onShowLeaderboard={(mode,planet)=>{ setLeaderboardMode(mode); setLeaderboardPlanet(planet||null); setScreen("leaderboard"); }}/>}
      {screen==="leaderboard"&&<LeaderboardPage mode={leaderboardMode} planetId={leaderboardPlanet?.id??0} planetName={leaderboardPlanet?.name||""} onBack={()=>setScreen(leaderboardMode==="survival"&&!leaderboardPlanet?"home":leaderboardPlanet?"planets":"home")}/>}
      
    </div>
  );
}