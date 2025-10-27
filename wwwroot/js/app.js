import { runDCA, runRaoorV1, runRaoorV2, runRaoorV21, runRaoorV3, toChartTime } from "./strategies.js";

/* ===== Theme ===== */
const THEME_KEY="dca_theme";
function setTheme(mode){ document.documentElement.setAttribute("data-theme",mode); localStorage.setItem(THEME_KEY,mode); }
(function(){ setTheme(localStorage.getItem(THEME_KEY)||"auto");
  document.getElementById("themeToggle").addEventListener("click",()=>{const cur=document.documentElement.getAttribute("data-theme"); setTheme(cur==="dark"?"light":cur==="light"?"auto":"dark"); if(window.__lastResult) renderAll(window.__lastResult); if(window.__cmpAuto) window.__cmpAuto();});
})();

/* ===== Tabs ===== */
const tabs=document.querySelectorAll(".tab-btn");
tabs.forEach(btn=>btn.addEventListener("click",()=>{tabs.forEach(b=>b.classList.remove("active")); btn.classList.add("active"); document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active")); document.getElementById("tab-"+btn.dataset.tab).classList.add("active");}));

/* ===== Utils ===== */
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>isFinite(n)?n.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d}):"-";
const pct=x=>isFinite(x)?(x*100).toFixed(2)+"%":"-";
const dstr=d=>d?new Date(d).toLocaleDateString():"-";
function isDark(){const m=document.documentElement.getAttribute("data-theme"); if(m==="dark")return true; if(m==="light")return false; return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;}
function ensureLW(){ if(!window.LightweightCharts||typeof LightweightCharts.createChart!=='function') throw new Error("Lightweight Charts 로드 실패"); }

/* ===== Stooq CSV ===== */
function toStooqSymbol(sym){ let s=sym.trim().toLowerCase(); if(!s.includes('.')) s+='.us'; return s; }
async function fetchCandlesStooq(symbol, interval='d', abortSignal){
  const s = toStooqSymbol(symbol);
  const url=`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=${interval}`;
  const res=await fetch(url,{signal:abortSignal,cache:'no-store'});
  if(!res.ok) throw new Error(`Stooq CSV HTTP ${res.status}`);
  const text=await res.text();
  const lines=text.trim().split(/\r?\n/);
  const header=lines.shift().split(',');
  const idxDate=header.indexOf('Date');
  const idxClose=header.indexOf('Close');
  if(idxDate<0 || idxClose<0) throw new Error('CSV columns missing');
  const out=[];
  for(const ln of lines){
    const cols=ln.split(',');
    const d=new Date(cols[idxDate]+'T00:00:00Z');
    const px=Number(cols[idxClose]);
    if(isFinite(px)) out.push({ date:d, close:px });
  }
  return out.sort((a,b)=>a.date-b.date);
}

/* ===== CSV Upload ===== */
async function parseUploadedCSV(file){
  const text=await file.text();
  const lines=text.trim().split(/\r?\n/);
  const header=lines.shift().split(',');
  const idxDate=header.indexOf('Date');
  const idxAdj=header.indexOf('Adj Close');
  const idxClose=header.indexOf('Close');
  if(idxDate<0 || (idxAdj<0 && idxClose<0)) throw new Error('CSV columns missing');
  const out=[];
  for(const ln of lines){
    const cols=ln.split(',');
    const d=new Date(cols[idxDate]+'T00:00:00Z');
    const px=Number(cols[idxAdj>=0?idxAdj:idxClose]);
    if(isFinite(px)) out.push({ date:d, close:px });
  }
  return out.sort((a,b)=>a.date-b.date);
}

/* ===== Charts ===== */
let lastPriceChart,lastEquityChart;
function chartLayout(){return{rightPriceScale:{visible:true},timeScale:{borderVisible:false},grid:{vertLines:{visible:false},horzLines:{visible:false}},layout:{background:{color:isDark()?'#0e1116':'#ffffff'},textColor:isDark()?'#e8e8e8':'#333'}};}
function renderPriceChart(priceSeries,buyDays){ ensureLW(); const el=$("priceChart"); if(lastPriceChart&&typeof lastPriceChart.remove==='function') lastPriceChart.remove(); el.innerHTML=""; const chart=LightweightCharts.createChart(el,chartLayout()); const line=chart.addLineSeries({}); line.setData(priceSeries); line.setMarkers(buyDays.map(b=>({time:b.time,position:'belowBar',shape:'arrowUp',text:'BUY'}))); chart.timeScale().fitContent(); lastPriceChart=chart; return chart; }
function renderEquityChart(equitySeries,investedSeries){ ensureLW(); const el=$("equityChart"); if(lastEquityChart&&typeof lastEquityChart.remove==='function') lastEquityChart.remove(); el.innerHTML=""; const chart=LightweightCharts.createChart(el,chartLayout()); const area=chart.addAreaSeries({}); area.setData(equitySeries); const investedLine=chart.addLineSeries({color:'#f1c40f',lineWidth:2}); investedLine.setData(investedSeries); chart.timeScale().fitContent(); lastEquityChart=chart; return chart; }

/* ===== Saved ===== */
const SAVE_KEY="dca_saves_v1";
const loadSaves=()=>{try{return JSON.parse(localStorage.getItem(SAVE_KEY)||"[]")}catch{return[]}};
const saveSaves=list=>localStorage.setItem(SAVE_KEY,JSON.stringify(list));
function renderSavedList(){const list=loadSaves(),box=$("savedList"),empty=$("savedEmpty"); box.innerHTML=""; if(!list.length){empty.style.display="block";return;} empty.style.display="none"; for(const s of list){const div=document.createElement("div"); div.className="saved-item"; div.innerHTML=`<h4>${s.name|| (s.symbol+" "+s.strategy)} <span class="muted">(${new Date(s.savedAt).toLocaleString()})</span></h4>
<div class="muted">심볼: <b>${s.symbol}</b> • 전략: <b>${s.strategy}${s.raoorVer?(" "+s.raoorVer):""}</b> • 금액: <b>${s.amount.toLocaleString()}</b></div>
<div class="muted">구간: ${new Date(s.start).toLocaleDateString()} ~ ${new Date(s.end).toLocaleDateString()}</div>
<div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
  <button class="btn-sm" data-act="open" data-id="${s.id}">열기</button>
  <button class="btn-sm" data-act="recalc" data-id="${s.id}">재계산</button>
  <button class="btn-sm btn-warn" data-act="del" data-id="${s.id}">삭제</button>
</div>`; box.appendChild(div);} }
$("tab-saved")?.addEventListener("click", (e)=>{const btn=e.target.closest("button[data-act]"); if(!btn)return; const list=loadSaves(); const item=list.find(x=>x.id===btn.dataset.id); if(!item)return;
  if(btn.dataset.act==="del"){saveSaves(list.filter(x=>x.id!==item.id)); renderSavedList(); return;}
  if(btn.dataset.act==="open"){applySummary(item.summary); renderPriceChart(item.series.price,item.series.buys); renderEquityChart(item.series.equity,item.series.invested);
    $("symbol").value=item.symbol; $("strategy").value=item.strategy; $("freq").value=item.freq||"Monthly"; $("amount").value=item.amount;
    $("raoorVer").value=item.raoorVer||"v1"; $("raoorSplits").value=item.raoorSplits||40; $("raoorTP").value=item.raoorTP||10;
    $("from").value=item.from||""; $("to").value=item.to||"";
    document.querySelector('.tab-btn[data-tab="run"]').click(); window.__lastResult=item.__lastResultSnapshot||null; return;}
  if(btn.dataset.act==="recalc"){document.querySelector('.tab-btn[data-tab="run"]').click();
    $("symbol").value=item.symbol; $("strategy").value=item.strategy; $("freq").value=item.freq||"Monthly"; $("amount").value=item.amount;
    $("raoorVer").value=item.raoorVer||"v1"; $("raoorSplits").value=item.raoorSplits||40; $("raoorTP").value=item.raoorTP||10;
    $("from").value=item.from||""; $("to").value=item.to||""; $("run").click(); return;}
});
renderSavedList();

/* ===== Summary/Render ===== */
function applySummary(out){const set=(id,v)=>$(id).textContent=v; set("rangeTxt",`${dstr(out.start)} ~ ${dstr(out.end)}`); set("investCount",String(out.investCount)); set("invested",fmt(out.invested,0)); set("finalValue",fmt(out.finalValue,0)); set("totalReturn",pct(out.totalReturn)); set("cagr",pct(out.cagr)); set("mdd",pct(out.maxDrawdown));}
function renderAll(result){applySummary(result.out); renderPriceChart(result.out.priceSeries,result.out.buyDays); renderEquityChart(result.out.equitySeries,result.out.investedSeries);}

/* ===== Run ===== */
let currentAbort=null;
$("run").addEventListener("click", async ()=>{
  if(currentAbort) currentAbort.abort(); currentAbort=new AbortController();

  const dataSource = $("dataSource")?.value || "stooq";
  const file = $("csvFile")?.files?.[0];

  const symbol = ($("symbol")?.value || "AAPL").trim();
  const strategy = $("strategy")?.value || "dca";
  const freq   = $("freq")?.value || "Monthly";
  const amount = Number(($("amount")?.value || 100000));
  const range  = $("range")?.value || "max"; // from/to에서 자름
  const from   = $("from")?.value ? new Date($("from").value+"T00:00:00Z") : null;
  const to     = $("to")?.value   ? new Date($("to").value  +"T23:59:59Z") : null;

  const raoorVer = $("raoorVer")?.value || "v1";
  const raoorSplits = Number($("raoorSplits")?.value || 40);
  const raoorTP = Number($("raoorTP")?.value || 10);

  const status=$("status"), btn=$("run"), saveBtn=$("save");
  btn.disabled=true; saveBtn.disabled=true; status.textContent="시세 불러오는 중…"; status.className="muted";

  try{
    let candles;
    if (dataSource === 'upload' && file) {
      candles = await parseUploadedCSV(file);
    } else {
      candles = await fetchCandlesStooq(symbol, 'd', currentAbort.signal);
    }

    let out;
    if (strategy === "raoor") {
      const opt={ splits: raoorSplits, tp: raoorTP, from, to };
      if(raoorVer==="v1") out=runRaoorV1(candles, amount, opt);
      else if(raoorVer==="v2") out=runRaoorV2(candles, amount, opt);
      else if(raoorVer==="v21") out=runRaoorV21(candles, amount, opt);
      else out=runRaoorV3(candles, amount, opt);
    } else {
      out=runDCA(candles, amount, freq, from, to);
    }
    if(!out) throw new Error("계산 실패");

    const result={out}; window.__lastResult=result; renderAll(result);
    window.__lastResultSnapshot={ price: out.priceSeries, equity: out.equitySeries, invested: out.investedSeries, buys: out.buyDays };
    saveBtn.disabled=false; status.textContent="완료"; status.className="ok";
  }catch(e){
    if(e.name!=="AbortError"){ console.error(e); status.textContent=e?.message||"오류가 발생했습니다."; status.className="err";
      ["rangeTxt","investCount","invested","finalValue","totalReturn","cagr","mdd"].forEach(id=>$(id).textContent="-"); }
  }finally{ btn.disabled=false; }
});

/* ===== Save ===== */
$("save").addEventListener("click",()=>{
  if(!window.__lastResult) return;
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now());
  const item={ id, name: $("saveName").value?.trim() || `${$("symbol").value} ${$("strategy").value}`,
    savedAt:Date.now(), symbol:$("symbol").value.trim(), strategy:$("strategy").value, freq:$("freq").value,
    amount:Number($("amount").value), raoorVer:$("raoorVer").value, raoorSplits:Number($("raoorSplits").value), raoorTP:Number($("raoorTP").value),
    from:$("from").value||"", to:$("to").value||"", start:window.__lastResult.out.start, end:window.__lastResult.out.end,
    summary:window.__lastResult.out, series:window.__lastResultSnapshot, __lastResultSnapshot:window.__lastResultSnapshot
  };
  const list=loadSaves(); list.unshift(item); saveSaves(list);
  $("saveName").value=""; document.querySelector('.tab-btn[data-tab="saved"]').click(); renderSavedList();
});

/* ===== Compare ===== */
let lastCompareChart;
function compareChartLayout(){return{rightPriceScale:{visible:true},timeScale:{borderVisible:false},grid:{vertLines:{visible:false},horzLines:{visible:false}},layout:{background:{color:isDark()?'#0e1116':'#ffffff'},textColor:isDark()?'#e8e8e8':'#333'}};}
function renderCompareChart(outA,outB){ ensureLW(); const el=$("compareChart"); if(!el) return; if(lastCompareChart&&typeof lastCompareChart.remove==='function') lastCompareChart.remove(); el.innerHTML=""; const chart=LightweightCharts.createChart(el, compareChartLayout());
  const lineA=chart.addLineSeries({color:'#3b82f6',lineWidth:2}); const lineB=chart.addLineSeries({color:'#10b981',lineWidth:2});
  lineA.setData(outA.equitySeries); lineB.setData(outB.equitySeries); chart.timeScale().fitContent(); lastCompareChart=chart; return chart; }

function setCmp(id,v){const el=$(id); if(el) el.textContent=v;}
function setCmpDelta(id, b, a, isPct=false){ if(a==null||b==null||!isFinite(a)||!isFinite(b)){setCmp(id,"-");return;} const d=b-a; setCmp(id, isPct ? (d*100).toFixed(2)+"%" : fmt(d,2)); }

function readCfg(prefix){ const g=id=>$(prefix+"_"+id); return {
  symbol:(g("symbol")?.value||"").trim(), strategy:g("strategy")?.value||"dca", freq:g("freq")?.value||"Monthly",
  amount:Number(g("amount")?.value||100000), range:g("range")?.value||"max",
  from:g("from")?.value? new Date(g("from").value+"T00:00:00Z"):null,
  to:g("to")?.value? new Date(g("to").value+"T23:59:59Z"):null,
  raoorVer:g("raoorVer")?.value||"v1", raoorSplits:Number(g("raoorSplits")?.value||40), raoorTP:Number(g("raoorTP")?.value||10)
};}

let cmpAbort=null;
async function runOne(cfg, signal){
  let candles;
  const ds = $("dataSource")?.value || "stooq";
  if (ds === 'upload') {
    const file = $("csvFile")?.files?.[0];
    if (!file) throw new Error("비교 탭에서 CSV 업로드 사용 시, 상단 실행 탭 입력에서 파일을 선택해주세요.");
    candles = await parseUploadedCSV(file);
  } else {
    candles = await fetchCandlesStooq(cfg.symbol, 'd', signal);
  }

  if(cfg.strategy==="raoor"){ const opt={splits:cfg.raoorSplits,tp:cfg.raoorTP,from:cfg.from,to:cfg.to};
    if(cfg.raoorVer==="v1") return runRaoorV1(candles,cfg.amount,opt);
    else if(cfg.raoorVer==="v2") return runRaoorV2(candles,cfg.amount,opt);
    else if(cfg.raoorVer==="v21") return runRaoorV21(candles,cfg.amount,opt);
    else return runRaoorV3(candles,cfg.amount,opt);
  } else { return runDCA(candles,cfg.amount,cfg.freq,cfg.from,cfg.to); }
}

$("compareRun").addEventListener("click", async ()=>{
  if(cmpAbort) cmpAbort.abort(); cmpAbort=new AbortController();
  const status=$("compareStatus"); status.textContent="비교 계산 중..."; status.className="muted";
  const A=readCfg("A"), B=readCfg("B");
  try{
    const [outA,outB]=await Promise.all([ runOne(A,cmpAbort.signal), runOne(B,cmpAbort.signal) ]);
    if(!outA||!outB) throw new Error("계산 실패");
    setCmp("cmp_period_A",`${dstr(outA.start)} ~ ${dstr(outA.end)}`); setCmp("cmp_period_B",`${dstr(outB.start)} ~ ${dstr(outB.end)}`);
    setCmp("cmp_count_A",String(outA.investCount)); setCmp("cmp_count_B",String(outB.investCount)); setCmpDelta("cmp_count_D",outB.investCount,outA.investCount,false);
    setCmp("cmp_invest_A",fmt(outA.invested,0)); setCmp("cmp_invest_B",fmt(outB.invested,0)); setCmpDelta("cmp_invest_D",outB.invested,outA.invested,false);
    setCmp("cmp_final_A",fmt(outA.finalValue,0)); setCmp("cmp_final_B",fmt(outB.finalValue,0)); setCmpDelta("cmp_final_D",outB.finalValue,outA.finalValue,false);
    setCmp("cmp_ret_A",(outA.totalReturn*100).toFixed(2)+"%"); setCmp("cmp_ret_B",(outB.totalReturn*100).toFixed(2)+"%"); setCmpDelta("cmp_ret_D",outB.totalReturn,outA.totalReturn,true);
    setCmp("cmp_cagr_A",(outA.cagr*100).toFixed(2)+"%"); setCmp("cmp_cagr_B",(outB.cagr*100).toFixed(2)+"%"); setCmpDelta("cmp_cagr_D",outB.cagr,outA.cagr,true);
    setCmp("cmp_mdd_A",(outA.maxDrawdown*100).toFixed(2)+"%"); setCmp("cmp_mdd_B",(outB.maxDrawdown*100).toFixed(2)+"%"); setCmpDelta("cmp_mdd_D",outB.maxDrawdown,outA.maxDrawdown,true);
    renderCompareChart(outA,outB);
    status.textContent="완료"; status.className="ok";
  }catch(e){ if(e.name!=="AbortError"){console.error(e); status.textContent=e?.message||"오류가 발생했습니다."; status.className="err";} }
});
// 테마 바뀌면 비교차트도 다시 그림
window.__cmpAuto = ()=>{ const btn=$("compareRun"); if(btn) btn.click(); };
