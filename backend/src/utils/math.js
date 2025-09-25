
export function ema(period, closes){
  const k = 2/(period+1);
  const out = new Array(closes.length).fill(null);
  let prev = closes[0];
  out[0] = prev;
  for(let i=1;i<closes.length;i++){
    prev = closes[i]*k + prev*(1-k);
    out[i] = prev;
  }
  return out;
}

export function slopeUp(arr, lookback=3){
  if(!arr || arr.length<2) return false;
  const a = arr[0], b = arr[arr.length-1];
  return b > a;
}

export function slopeDown(arr, lookback=3){
  if(!arr || arr.length<2) return false;
  const a = arr[0], b = arr[arr.length-1];
  return b < a;
}

export function equityStats(curve){
  if(!curve?.length) return {start:0,end:0,maxDD:0,returnPct:0};
  const start = curve[0].equity;
  const end = curve[curve.length-1].equity;
  let peak = -Infinity, maxDD = 0;
  for(const p of curve){
    if(p.equity>peak) peak = p.equity;
    const dd = peak - p.equity;
    if(dd>maxDD) maxDD = dd;
  }
  const returnPct = start ? ((end-start)/start)*100 : 0;
  return { start, end, maxDD, returnPct };
}
