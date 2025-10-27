// 공통 유틸
export const toChartTime = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
const monthKey = d => d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + (1 - day));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week = Math.ceil((((d - yearStart)/86400000) + (yearStart.getUTCDay()||7) - 1)/7);
  return d.getUTCFullYear()+"-W"+String(week).padStart(2,"0");
}

// =============== 일반 DCA ===============
export function runDCA(candles, amountPer, freq, from, to) {
  if (!candles?.length || !(amountPer>0)) return null;
  const asc = candles.slice().sort((a,b)=>a.date-b.date);
  const start = from || asc[0].date;
  const end   = to   || asc[asc.length-1].date;
  const ranged = asc.filter(c=>c.date>=start && c.date<=end && c.close>0 && isFinite(c.close));
  if (!ranged.length) return null;

  const investDays=[];
  if (freq==="Daily") investDays.push(...ranged);
  else if (freq==="Weekly") {
    const seen=new Set();
    for (const c of ranged) { const k=isoWeekKey(c.date); if(!seen.has(k)){investDays.push(c); seen.add(k);} }
  } else {
    const seen=new Set();
    for (const c of ranged) { const k=monthKey(c.date); if(!seen.has(k)){investDays.push(c); seen.add(k);} }
  }

  let shares=0, invested=0;
  const equityCurve=[], priceSeries=[], buyDays=[], investedCurve=[];
  const investSet = new Set(investDays.map(d => +d.date));

  for (const c of ranged) {
    if (investSet.has(+c.date)) {
      const qty = amountPer / c.close; shares += qty; invested += amountPer;
      buyDays.push({ time: toChartTime(c.date), price: c.close });
    }
    equityCurve.push({ date: c.date, equity: shares*c.close });
    investedCurve.push({ date: c.date, invested });
    priceSeries.push({ time: toChartTime(c.date), value: c.close });
  }

  const last=ranged[ranged.length-1];
  const finalValue=shares*last.close;
  const totalReturn= invested? (finalValue-invested)/invested : 0;

  const firstInvest= investDays[0]?.date || ranged[0].date;
  const years=(last.date-firstInvest)/(365.25*24*3600*1000);
  const cagr=(years>0 && invested>0 && finalValue>0)? Math.pow(finalValue/invested,1/years)-1 : 0;

  let peak=-Infinity, maxDD=0;
  for (const p of equityCurve){ peak=Math.max(peak,p.equity); if(peak>0) maxDD=Math.min(maxDD,(p.equity-peak)/peak); }

  return {
    investCount: investDays.length,
    invested, finalValue, totalReturn, cagr, maxDrawdown:maxDD,
    start:firstInvest, end:last.date,
    priceSeries,
    equitySeries: equityCurve.map(p => ({ time: toChartTime(p.date), value: p.equity })),
    investedSeries: investedCurve.map(p => ({ time: toChartTime(p.date), value: p.invested })),
    buyDays
  };
}

// =============== 라오어 v1 ===============
export function runRaoorV1(candles, unitPerRound, opt={}) {
  const splits = Number(opt.splits ?? 40);
  const tpPct  = Number(opt.tp ?? 10) / 100;
  const from   = opt.from || null;
  const to     = opt.to   || null;

  if (!candles?.length || !(unitPerRound>0) || !(splits>0)) return null;

  const asc = candles.slice().sort((a,b)=>a.date-b.date);
  const start = from || asc[0].date;
  const end   = to   || asc[asc.length-1].date;
  const ranged = asc.filter(c=>c.date>=start && c.date<=end && c.close>0 && isFinite(c.close));
  if (!ranged.length) return null;

  let shares=0, investedLive=0, investedCum=0, usedRounds=0, cash=0;
  const priceSeries=[], buyMarkers=[], equityCurve=[], investedCurve=[];
  const avgCost = () => shares>0 ? investedLive/shares : 0;
  const canBuy = (r) => usedRounds + r <= splits + 1e-9;

  for (const c of ranged) {
    // 최소 0.5회차
    if (canBuy(0.5)) {
      const amt = unitPerRound*0.5, qty=amt/c.close;
      shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
      buyMarkers.push({ time: toChartTime(c.date), price: c.close });
    }
    // 평단 아래면 추가 0.5
    if (shares>0 && c.close < avgCost() && canBuy(0.5)) {
      const amt = unitPerRound*0.5, qty=amt/c.close;
      shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
      buyMarkers.push({ time: toChartTime(c.date), price: c.close });
    }
    // 평단 + tp% 익절 → 전량 매도
    if (shares>0 && c.close >= avgCost()*(1+tpPct)) {
      cash += shares*c.close; shares=0; investedLive=0; usedRounds=0;
    }

    priceSeries.push({ time: toChartTime(c.date), value: c.close });
    const equityNow = cash + shares*c.close;
    equityCurve.push({ time: toChartTime(c.date), value: equityNow });
    investedCurve.push({ time: toChartTime(c.date), value: investedCum });
  }

  const last=ranged[ranged.length-1];
  const finalEquity = cash + shares*last.close;
  const totalInvested = investedCum;
  const totalReturn = totalInvested ? (finalEquity-totalInvested)/totalInvested : 0;

  const firstBuyIdx = investedCurve.findIndex(p=>p.value>0);
  const firstInvestDate = firstBuyIdx>=0 ? ranged[firstBuyIdx].date : ranged[0].date;
  const years = (last.date-firstInvestDate)/(365.25*24*3600*1000);
  const cagr = (years>0 && totalInvested>0 && finalEquity>0) ? Math.pow(finalEquity/totalInvested,1/years)-1 : 0;

  let peak=-Infinity, maxDD=0;
  for (const p of equityCurve){ peak=Math.max(peak,p.value); if(peak>0) maxDD=Math.min(maxDD,(p.value-peak)/peak); }

  return {
    investCount: buyMarkers.length,
    invested: totalInvested,
    finalValue: finalEquity,
    totalReturn, cagr, maxDrawdown:maxDD,
    start:ranged[0].date, end:last.date,
    priceSeries,
    equitySeries: equityCurve,
    investedSeries: investedCurve,
    buyDays: buyMarkers
  };
}

// =============== 라오어 v2 ===============
export function runRaoorV2(candles, unitPerRound, opt={}) {
  const splits = Number(opt.splits ?? 40);
  const tp1 = 0.05, tp2 = 0.10;
  const from = opt.from || null, to = opt.to || null;
  if (!candles?.length || !(unitPerRound>0) || !(splits>0)) return null;

  const asc = candles.slice().sort((a,b)=>a.date-b.date);
  const start = from || asc[0].date, end = to || asc[asc.length-1].date;
  const ranged = asc.filter(c=>c.date>=start && c.date<=end && c.close>0 && isFinite(c.close));
  if (!ranged.length) return null;

  let shares=0, investedLive=0, investedCum=0, usedRounds=0, cash=0;
  const priceSeries=[], buyMarkers=[], equityCurve=[], investedCurve=[];
  const avgCost = () => shares>0 ? investedLive/shares : 0;
  const canBuy = (r) => usedRounds + r <= splits + 1e-9;

  for (const c of ranged) {
    if (canBuy(0.5)) {
      const amt=unitPerRound*0.5, qty=amt/c.close;
      shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
      buyMarkers.push({ time: toChartTime(c.date), price: c.close });
    }
    if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
      const amt=unitPerRound*0.5, qty=amt/c.close;
      shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
      buyMarkers.push({ time: toChartTime(c.date), price: c.close });
    }

    if (shares>0) {
      const ac = avgCost();
      if (c.close >= ac*(1+tp1) && c.close < ac*(1+tp2)) {
        const sellQty = shares*0.5;
        cash += sellQty*c.close;
        investedLive *= 0.5;
        shares -= sellQty;
      } else if (c.close >= ac*(1+tp2)) {
        cash += shares*c.close;
        shares=0; investedLive=0; usedRounds=0;
      }
    }

    priceSeries.push({ time: toChartTime(c.date), value: c.close });
    const equityNow = cash + shares*c.close;
    equityCurve.push({ time: toChartTime(c.date), value: equityNow });
    investedCurve.push({ time: toChartTime(c.date), value: investedCum });
  }

  const last=ranged[ranged.length-1];
  const finalEquity = cash + shares*last.close;
  const totalInvested = investedCum;
  const totalReturn = totalInvested ? (finalEquity-totalInvested)/totalInvested : 0;
  const firstBuyIdx = investedCurve.findIndex(p=>p.value>0);
  const firstInvestDate = firstBuyIdx>=0 ? ranged[firstBuyIdx].date : ranged[0].date;
  const years = (last.date-firstInvestDate)/(365.25*24*3600*1000);
  const cagr = (years>0 && totalInvested>0 && finalEquity>0) ? Math.pow(finalEquity/totalInvested,1/years)-1 : 0;

  let peak=-Infinity, maxDD=0;
  for (const p of equityCurve){ peak=Math.max(peak,p.value); if(peak>0) maxDD=Math.min(maxDD,(p.value-peak)/peak); }

  return {
    investCount: buyMarkers.length, invested: totalInvested, finalValue: finalEquity,
    totalReturn, cagr, maxDrawdown:maxDD,
    start:ranged[0].date, end:last.date,
    priceSeries, equitySeries: equityCurve, investedSeries: investedCurve, buyDays: buyMarkers
  };
}

// =============== 라오어 v2.1 ===============
export function runRaoorV21(candles, unitPerRound, opt={}) {
  const splits = Number(opt.splits ?? 40);
  const half = splits * 0.5;
  const tp1 = 0.05, tp2 = 0.10;
  const from = opt.from || null, to = opt.to || null;
  if (!candles?.length || !(unitPerRound>0) || !(splits>0)) return null;

  const asc = candles.slice().sort((a,b)=>a.date-b.date);
  const start = from || asc[0].date, end = to || asc[asc.length-1].date;
  const ranged = asc.filter(c=>c.date>=start && c.date<=end && c.close>0 && isFinite(c.close));
  if (!ranged.length) return null;

  let shares=0, investedLive=0, investedCum=0, usedRounds=0, cash=0;
  const priceSeries=[], buyMarkers=[], equityCurve=[], investedCurve=[];
  const avgCost = () => shares>0 ? investedLive/shares : 0;
  const canBuy = (r) => usedRounds + r <= splits + 1e-9;

  for (const c of ranged) {
    const conservative = usedRounds >= half;

    if (!conservative) {
      if (canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
      }
      if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
      }
    } else {
      if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
        if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
          const amt2=unitPerRound*0.5, qty2=amt2/c.close;
          shares+=qty2; investedLive+=amt2; investedCum+=amt2; usedRounds+=0.5;
          buyMarkers.push({ time: toChartTime(c.date), price: c.close });
        }
      }
    }

    if (shares>0) {
      const ac = avgCost();
      if (c.close >= ac*(1+tp1) && c.close < ac*(1+tp2)) {
        const sellQty = shares*0.5;
        cash += sellQty*c.close;
        investedLive *= 0.5;
        shares -= sellQty;
      } else if (c.close >= ac*(1+tp2)) {
        cash += shares*c.close;
        shares=0; investedLive=0; usedRounds=0;
      }
    }

    priceSeries.push({ time: toChartTime(c.date), value: c.close });
    const equityNow = cash + shares*c.close;
    equityCurve.push({ time: toChartTime(c.date), value: equityNow });
    investedCurve.push({ time: toChartTime(c.date), value: investedCum });
  }

  const last=ranged[ranged.length-1];
  const finalEquity = cash + shares*last.close;
  const totalInvested = investedCum;
  const totalReturn = totalInvested ? (finalEquity-totalInvested)/totalInvested : 0;
  const firstBuyIdx = investedCurve.findIndex(p=>p.value>0);
  const firstInvestDate = firstBuyIdx>=0 ? ranged[firstBuyIdx].date : ranged[0].date;
  const years = (last.date-firstInvestDate)/(365.25*24*3600*1000);
  const cagr = (years>0 && totalInvested>0 && finalEquity>0) ? Math.pow(finalEquity/totalInvested,1/years)-1 : 0;

  let peak=-Infinity, maxDD=0;
  for (const p of equityCurve){ peak=Math.max(peak,p.value); if(peak>0) maxDD=Math.min(maxDD,(p.value-peak)/peak); }

  return {
    investCount: buyMarkers.length, invested: totalInvested, finalValue: finalEquity,
    totalReturn, cagr, maxDrawdown:maxDD,
    start:ranged[0].date, end:last.date,
    priceSeries, equitySeries: equityCurve, investedSeries: investedCurve, buyDays: buyMarkers
  };
}

// =============== 라오어 v3 ===============
export function runRaoorV3(candles, unitPerRound, opt={}) {
  const splits = Number(opt.splits ?? 40);
  const half = splits * 0.5;
  const tp1 = 0.05, tp2 = 0.10;
  const from = opt.from || null, to = opt.to || null;
  if (!candles?.length || !(unitPerRound>0) || !(splits>0)) return null;

  const asc = candles.slice().sort((a,b)=>a.date-b.date);
  const start = from || asc[0].date, end = to || asc[asc.length-1].date;
  const ranged = asc.filter(c=>c.date>=start && c.date<=end && c.close>0 && isFinite(c.close));
  if (!ranged.length) return null;

  let shares=0, investedLive=0, investedCum=0, usedRounds=0, cash=0;
  const priceSeries=[], buyMarkers=[], equityCurve=[], investedCurve=[];
  const avgCost = () => shares>0 ? investedLive/shares : 0;
  const canBuy = (r) => usedRounds + r <= splits + 1e-9;

  for (let i=0;i<ranged.length;i++) {
    const c = ranged[i];
    const conservative = usedRounds >= half;

    if (!conservative) {
      if (canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
      }
      if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
      }
    } else {
      if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
        const amt=unitPerRound*0.5, qty=amt/c.close;
        shares+=qty; investedLive+=amt; investedCum+=amt; usedRounds+=0.5;
        buyMarkers.push({ time: toChartTime(c.date), price: c.close });
        if (shares>0 && c.close<avgCost() && canBuy(0.5)) {
          const amt2=unitPerRound*0.5, qty2=amt2/c.close;
          shares+=qty2; investedLive+=amt2; investedCum+=amt2; usedRounds+=0.5;
          buyMarkers.push({ time: toChartTime(c.date), price: c.close });
        }
      }
    }

    if (shares>0) {
      const ac = avgCost();
      if (c.close >= ac*(1+tp1) && c.close < ac*(1+tp2)) {
        const sellQty = shares*0.5;
        cash += sellQty*c.close;
        investedLive *= 0.5;
        shares -= sellQty;
      } else if (c.close >= ac*(1+tp2)) {
        cash += shares*c.close;
        shares=0; investedLive=0; usedRounds=0;
      }
    }

    priceSeries.push({ time: toChartTime(c.date), value: c.close });
    const equityNow = cash + shares*c.close;
    equityCurve.push({ time: toChartTime(c.date), value: equityNow });
    investedCurve.push({ time: toChartTime(c.date), value: investedCum });
  }

  const last=ranged[ranged.length-1];
  const finalEquity = cash + shares*last.close;
  const totalInvested = investedCum;
  const totalReturn = totalInvested ? (finalEquity-totalInvested)/totalInvested : 0;
  const firstBuyIdx = investedCurve.findIndex(p=>p.value>0);
  const firstInvestDate = firstBuyIdx>=0 ? ranged[firstBuyIdx].date : ranged[0].date;
  const years = (last.date-firstInvestDate)/(365.25*24*3600*1000);
  const cagr = (years>0 && totalInvested>0 && finalEquity>0) ? Math.pow(finalEquity/totalInvested,1/years)-1 : 0;

  let peak=-Infinity, maxDD=0;
  for (const p of equityCurve){ peak=Math.max(peak,p.value); if(peak>0) maxDD=Math.min(maxDD,(p.value-peak)/peak); }

  return {
    investCount: buyMarkers.length, invested: totalInvested, finalValue: finalEquity,
    totalReturn, cagr, maxDrawdown:maxDD,
    start:ranged[0].date, end:last.date,
    priceSeries, equitySeries: equityCurve, investedSeries: investedCurve, buyDays: buyMarkers
  };
}
