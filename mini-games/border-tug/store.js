// The shared border, behind two calls: get() and add(delta), both in metres (+ = toward Sumida).
// pulled() also gives each ward's lifetime total as of the last call, {taito, sumida} in metres, or null.
// cached() gives the border from the last answer this device saw, or null, so the page can show it at once.
//
// Online: our own counter, a Cloudflare Worker over a D1 database (source: tools/counter-worker.js).
// GET /totals and POST /pull {side, cm}; each ward's total is the centimetres it has pulled, and the
// border is Taito's total minus Sumida's. Anyone can call /pull by hand, so this is a toy, not a ledger.
// Every call gives up after a few seconds. A pull that can't be sent waits on this device and goes out
// with the next call that gets through, so a slow or unreachable server never loses a pull.
//
// Offline (?offline=1): the same API over localStorage, for this browser only.

const API = 'https://border-tug-counter.lysgamedev.workers.dev';
const LIVE_NS = 'lysgames-border-tug-v2';
const TIMEOUT_MS = 6000;
const SIDES = ['taito', 'sumida'];
export const MAX_CM = 100;

export function makeStore({ns, offline}){
  return offline ? localStore(ns) : workerStore(ns);
}

const load = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function workerStore(ns){
  const q = '?ns=' + (ns === LIVE_NS ? 'live' : 'dev');
  const CACHE = 'border-tug.cache.' + ns, PENDING = 'border-tug.pending.' + ns;
  let vals = load(CACHE);   // {taito, sumida} in cm, from the last answer
  const total = () => vals ? (vals.taito - vals.sumida) / 100 : 0;
  const take = v => { vals = {taito: +v.taito || 0, sumida: +v.sumida || 0}; save(CACHE, vals); return total(); };

  async function call(path, body){
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(API + path + q, body ? {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body), signal: ctl.signal, cache: 'no-store'} : {signal: ctl.signal, cache: 'no-store'});
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  // send what earlier calls couldn't, at most 1 m per call as the server asks
  async function flush(){
    const p = load(PENDING);
    if (!p) return;
    for (const side of SIDES) {
      while (p[side] > 0) {
        const cm = Math.min(MAX_CM, p[side]);
        take(await call('/pull', {side, cm}));
        p[side] -= cm; save(PENDING, p);
      }
    }
    try { localStorage.removeItem(PENDING); } catch {}
  }

  return {
    online: true,
    cached(){ return vals ? total() : null; },
    pulled(){ return vals ? {taito: vals.taito/100, sumida: vals.sumida/100} : null; },
    async get(){
      await flush();
      return take(await call('/totals'));
    },
    // returns the new border; if the server can't be reached the pull waits here and the call still throws
    async add(delta){
      const cm = Math.min(MAX_CM, Math.round(Math.abs(delta) * 100));
      if (!cm) return total();
      const side = delta > 0 ? 'taito' : 'sumida';
      try {
        await flush();
        return take(await call('/pull', {side, cm}));
      } catch (e) {
        const p = load(PENDING) || {taito: 0, sumida: 0};
        p[side] = (p[side] || 0) + cm; save(PENDING, p);
        if (vals) { vals = {...vals, [side]: vals[side] + cm}; }   // show it as counted on this device meanwhile
        throw e;
      }
    },
  };
}

function localStore(ns){
  const K = 'border-tug.' + ns;
  const read = () => { try { return +localStorage.getItem(K) || 0; } catch { return 0; } };
  return {
    online: false,
    cached(){ return read(); },
    pulled(){ return null; },
    async get(){ return read(); },
    async add(delta){
      const cm = Math.min(MAX_CM, Math.round(Math.abs(delta) * 100)) * Math.sign(delta);
      const v = Math.round(read() * 100 + cm) / 100;
      try { localStorage.setItem(K, v); } catch {}
      return v;
    },
  };
}
