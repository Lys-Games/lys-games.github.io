// The shared border, behind two calls: get() and add(delta), both in metres (+ = toward Sumida).
// pulled() also gives each ward's lifetime total as of the last call, {taito, sumida} in metres, or null.
//
// Online: Abacus (abacus.jasoncameron.dev), a free counter API with no account and open CORS.
// We only use its anonymous /hit (add 1) and /info (read), so nobody holds a key that could reset or delete
// the counters. Each ward has one counter per binary weight 1, 2, 4 ... 64 cm; a pull of 37 cm hits
// the 1, 4 and 32 cm counters of the puller's ward (at most 7 calls). Border = Taito sum - Sumida sum.
// Anyone can call /hit by hand, so this is a toy, not a ledger.
//
// Offline (no network, or ?offline=1): the same API over localStorage, for this browser only.

const API = 'https://abacus.jasoncameron.dev';
const BITS = [1, 2, 4, 8, 16, 32, 64];
const SIDES = ['taito', 'sumida'];
export const MAX_CM = 100;

const key = (side, b) => `${side}-${b}cm`;
const sumOf = vals => SIDES.map(side => BITS.reduce((t, b) => t + b * (vals[key(side, b)] || 0), 0));

export function makeStore({ns, offline}){
  return offline ? localStore(ns) : abacusStore(ns);
}

function abacusStore(ns){
  const vals = {};
  const total = () => { const [t, s] = sumOf(vals); return (t - s) / 100; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // the API allows 30 calls per 10 s per IP: a call that gets 429 waits and tries again, so a pull is not
  // lost and a read never mixes fresh counters with missing ones
  async function call(op, k, tries = 4){
    for (let i = 0; ; i++) {
      const r = await fetch(`${API}/${op}/${ns}/${k}`, {cache: 'no-store'});
      if (r.ok) { const j = await r.json(); return op === 'info' && !j.exists ? 0 : j.value; }
      if (r.status !== 429 || i + 1 >= tries) throw new Error(`${op} ${k}: ${r.status}`);
      await sleep(Math.min(10, +r.headers.get('retry-after') || 3) * 1000 + 300);
    }
  }
  return {
    online: true,
    pulled(){ const [t, s] = sumOf(vals); return {taito: t/100, sumida: s/100}; },
    async get(){
      const keys = SIDES.flatMap(side => BITS.map(b => key(side, b)));
      const got = await Promise.all(keys.map(k => call('info', k)));   // /info answers 200 for a counter never hit, /get a 404
      keys.forEach((k, i) => vals[k] = got[i]);
      return total();
    },
    // returns the new border; counters we didn't touch keep the value of the last get() (14 reads, so not after every pull)
    async add(delta){
      const cm = Math.min(MAX_CM, Math.round(Math.abs(delta) * 100));
      if (!cm) return total();
      const side = delta > 0 ? 'taito' : 'sumida';
      const ks = BITS.filter(b => cm & b).map(b => key(side, b));
      const got = await Promise.all(ks.map(k => call('hit', k)));
      ks.forEach((k, i) => vals[k] = got[i]);
      return total();
    },
  };
}

function localStore(ns){
  const K = 'border-tug.' + ns;
  const read = () => { try { return +localStorage.getItem(K) || 0; } catch { return 0; } };
  return {
    online: false,
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
