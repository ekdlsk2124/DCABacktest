// wwwroot/js/app.js
import { runDCA, runRaoorV1, runRaoorV2, runRaoorV21, runRaoorV3, toChartTime } from "/js/strategies.js";

// ===== Theme =====
const THEME_KEY = "dca_theme";
function setTheme(mode) { document.documentElement.setAttribute("data-theme", mode); localStorage.setItem(THEME_KEY, mode); }
(function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    setTheme(saved || "auto");
    document.getElementById("themeToggle").addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme");
        const next = cur === "dark" ? "light" : cur === "light" ? "auto" : "dark";
        setTheme(next);
        // re-render charts with new palette
        if (window.__lastResult) { renderAll(window.__lastResult); }
    });
})();

// ===== Tabs =====
const tabs = document.querySelectorAll(".tab-btn");
tabs.forEach(btn => btn.addEventListener("click", () => {
    tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
}));

// ===== Utils =====
const $ = id => document.getElementById(id);
const fmt = (n, d = 2) => isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "-";
const pct = x => isFinite(x) ? (x * 100).toFixed(2) + "%" : "-";
const dstr = d => d ? new Date(d).toLocaleDateString() : "-";
function isDark() {
    const mode = document.documentElement.getAttribute("data-theme");
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function ensureLW() {
    if (!window.LightweightCharts || typeof LightweightCharts.createChart !== 'function') {
        throw new Error("Lightweight Charts 로드 실패");
    }
}
function normalizeSymbol(sym) { return sym.trim().replace(/\s+/g, "").replace(/\./g, "-"); }

// ===== Fetch via proxy =====
async function fetchCandles(symbol, range, abortSignal) {
    const sym = normalizeSymbol(symbol);
    const url = `/api/yahoo?symbol=${encodeURIComponent(sym)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-store' }, signal: abortSignal });
    if (!res.ok) throw new Error(`Yahoo proxy HTTP ${res.status}`);
    const json = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r) throw new Error("Yahoo 응답 비어있음");
    const t = r.timestamp;
    const adj = r.indicators?.adjclose?.[0]?.adjclose;
    const close = r.indicators?.quote?.[0]?.close;
    const prices = (adj && adj.some(v => v != null)) ? adj : close;
    if (!t || !prices) throw new Error("타임스탬프/가격 없음");
    const out = [];
    for (let i = 0; i < t.length; i++) {
        const ts = t[i], px = prices[i];
        if (ts == null || px == null || !isFinite(px)) continue;
        out.push({ date: new Date(ts * 1000), close: Number(px) });
    }
    return out;
}

// ===== Charts =====
let lastPriceChart, lastEquityChart;
function chartLayout() {
    return {
        rightPriceScale: { visible: true },
        timeScale: { borderVisible: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        layout: { background: { color: isDark() ? '#0e1116' : '#ffffff' }, textColor: isDark() ? '#e8e8e8' : '#333' },
    };
}
function renderPriceChart(priceSeries, buyDays) {
    ensureLW();
    const el = $("priceChart");
    if (lastPriceChart && typeof lastPriceChart.remove === 'function') lastPriceChart.remove();
    el.innerHTML = "";
    const chartApi = LightweightCharts.createChart(el, chartLayout());
    const line = chartApi.addLineSeries({});
    line.setData(priceSeries);
    line.setMarkers(buyDays.map(b => ({ time: b.time, position: 'belowBar', shape: 'arrowUp', text: 'BUY' })));
    chartApi.timeScale().fitContent();
    lastPriceChart = chartApi;
    return chartApi;
}
function renderEquityChart(equitySeries, investedSeries) {
    ensureLW();
    const el = $("equityChart");
    if (lastEquityChart && typeof lastEquityChart.remove === 'function') lastEquityChart.remove();
    el.innerHTML = "";
    const chartApi = LightweightCharts.createChart(el, chartLayout());
    const area = chartApi.addAreaSeries({});
    area.setData(equitySeries);
    const investedLine = chartApi.addLineSeries({ color: '#f1c40f', lineWidth: 2 });
    investedLine.setData(investedSeries);
    chartApi.timeScale().fitContent();
    lastEquityChart = chartApi;
    return chartApi;
}

// ===== Saved (localStorage) =====
const SAVE_KEY = "dca_saves_v1";
const loadSaves = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); } catch { return []; } };
const saveSaves = (list) => localStorage.setItem(SAVE_KEY, JSON.stringify(list));
function renderSavedList() {
    const list = loadSaves(), box = $("savedList"), empty = $("savedEmpty");
    box.innerHTML = "";
    if (!list.length) { empty.style.display = "block"; return; }
    empty.style.display = "none";
    for (const s of list) {
        const div = document.createElement("div");
        div.className = "saved-item";
        div.innerHTML = `
      <h4>${s.name || (s.symbol + " " + s.strategy)} <span class="muted">(${new Date(s.savedAt).toLocaleString()})</span></h4>
      <div class="muted">심볼: <b>${s.symbol}</b> • 전략: <b>${s.strategy}${s.raoorVer ? (" " + s.raoorVer) : ""}</b> • 금액: <b>${s.amount.toLocaleString()}</b></div>
      <div class="muted">구간: ${new Date(s.start).toLocaleDateString()} ~ ${new Date(s.end).toLocaleDateString()} • 조회: ${s.range}</div>
      <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn-sm" data-act="open" data-id="${s.id}">열기</button>
        <button class="btn-sm" data-act="recalc" data-id="${s.id}">재계산</button>
        <button class="btn-sm btn-warn" data-act="del" data-id="${s.id}">삭제</button>
      </div>
    `;
        box.appendChild(div);
    }
}
$("tab-saved").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const list = loadSaves();
    const item = list.find(x => x.id === btn.dataset.id);
    if (!item) return;

    if (btn.dataset.act === "del") {
        saveSaves(list.filter(x => x.id !== item.id));
        renderSavedList();
        return;
    }
    if (btn.dataset.act === "open") {
        applySummary(item.summary);
        renderPriceChart(item.series.price, item.series.buys);
        renderEquityChart(item.series.equity, item.series.invested);
        // 폼 반영
        $("symbol").value = item.symbol; $("strategy").value = item.strategy; $("freq").value = item.freq || "Monthly";
        $("amount").value = item.amount; $("range").value = item.range; $("raoorVer").value = item.raoorVer || "v1";
        $("raoorSplits").value = item.raoorSplits || 40; $("raoorTP").value = item.raoorTP || 10;
        $("from").value = item.from || ""; $("to").value = item.to || "";
        document.querySelector('.tab-btn[data-tab="run"]').click();
        window.__lastResult = item.__lastResultSnapshot || null;
        return;
    }
    if (btn.dataset.act === "recalc") {
        document.querySelector('.tab-btn[data-tab="run"]').click();
        $("symbol").value = item.symbol; $("strategy").value = item.strategy; $("freq").value = item.freq || "Monthly";
        $("amount").value = item.amount; $("range").value = item.range; $("raoorVer").value = item.raoorVer || "v1";
        $("raoorSplits").value = item.raoorSplits || 40; $("raoorTP").value = item.raoorTP || 10;
        $("from").value = item.from || ""; $("to").value = item.to || "";
        $("run").click();
        return;
    }
});
renderSavedList();

// ===== Summary/Render =====
function applySummary(out) {
    const set = (id, v) => $(id).textContent = v;
    set("rangeTxt", `${dstr(out.start)} ~ ${dstr(out.end)}`);
    set("investCount", String(out.investCount));
    set("invested", fmt(out.invested, 0));
    set("finalValue", fmt(out.finalValue, 0));
    set("totalReturn", pct(out.totalReturn));
    set("cagr", pct(out.cagr));
    set("mdd", pct(out.maxDrawdown));
}
function renderAll(result) {
    applySummary(result.out);
    renderPriceChart(result.out.priceSeries, result.out.buyDays);
    renderEquityChart(result.out.equitySeries, result.out.investedSeries);
}

// ===== Run Button =====
let currentAbort = null;
$("run").addEventListener("click", async () => {
    if (currentAbort) currentAbort.abort();
    currentAbort = new AbortController();

    const symbol = ($("symbol")?.value || "AAPL").trim();
    const strategy = $("strategy")?.value || "dca";
    const freq = $("freq")?.value || "Monthly";
    const amount = Number(($("amount")?.value || 100000));
    const range = ($("range")?.value || "max");
    const from = $("from")?.value ? new Date($("from").value + "T00:00:00") : null;
    const to = $("to")?.value ? new Date($("to").value + "T23:59:59") : null;

    const raoorVer = $("raoorVer")?.value || "v1";
    const raoorSplits = Number($("raoorSplits")?.value || 40);
    const raoorTP = Number($("raoorTP")?.value || 10);

    const status = $("status"); const btn = $("run"); const saveBtn = $("save");
    btn.disabled = true; saveBtn.disabled = true;
    status.textContent = "시세 불러오는 중…"; status.className = "muted";

    try {
        const candles = await fetchCandles(symbol, range, currentAbort.signal);
        let out;
        if (strategy === "raoor") {
            const opt = { splits: raoorSplits, tp: raoorTP, from, to };
            if (raoorVer === "v1") out = runRaoorV1(candles, amount, opt);
            else if (raoorVer === "v2") out = runRaoorV2(candles, amount, opt);
            else if (raoorVer === "v21") out = runRaoorV21(candles, amount, opt);
            else out = runRaoorV3(candles, amount, opt);
        } else {
            out = runDCA(candles, amount, freq, from, to);
        }
        if (!out) throw new Error("계산 실패");

        const result = { out };
        window.__lastResult = result;
        renderAll(result);

        // 저장 스냅샷
        window.__lastResultSnapshot = {
            price: out.priceSeries, equity: out.equitySeries, invested: out.investedSeries, buys: out.buyDays
        };
        $("save").disabled = false;
        status.textContent = "완료"; status.className = "ok";
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error(e);
            status.textContent = e?.message || "오류가 발생했습니다.";
            status.className = "err";
            ["rangeTxt", "investCount", "invested", "finalValue", "totalReturn", "cagr", "mdd"].forEach(id => $(id).textContent = "-");
        }
    } finally {
        btn.disabled = false;
    }
});

// ===== Save Button =====
$("save").addEventListener("click", () => {
    if (!window.__lastResult) return;
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const item = {
        id, name: $("saveName").value?.trim() || `${$("symbol").value} ${$("strategy").value}`,
        savedAt: Date.now(),
        symbol: $("symbol").value.trim(),
        strategy: $("strategy").value,
        freq: $("freq").value,
        amount: Number($("amount").value),
        range: $("range").value,
        raoorVer: $("raoorVer").value,
        raoorSplits: Number($("raoorSplits").value),
        raoorTP: Number($("raoorTP").value),
        from: $("from").value || "", to: $("to").value || "",
        start: window.__lastResult.out.start, end: window.__lastResult.out.end,
        summary: window.__lastResult.out,
        series: window.__lastResultSnapshot,
        __lastResultSnapshot: window.__lastResultSnapshot
    };
    const list = loadSaves(); list.unshift(item); saveSaves(list);
    $("saveName").value = "";
    document.querySelector('.tab-btn[data-tab="saved"]').click();
    renderSavedList();
});
