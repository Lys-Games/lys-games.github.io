// The result picture a player shares: 1200x675 (16:9). Title, map, pull and border line sit in the middle
// 675x675 square, so a square crop keeps them; the two ward boxes sit in the side margins.
//
// GSI tiles send Access-Control-Allow-Origin: *, so they are drawn with crossOrigin and the canvas stays
// exportable. A tile that fails to load leaves the plain background.

export const W = 1200, H = 675;
const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const INK = '#111', YELLOW = '#ffe14a', FONT = '"Dela Gothic One", "Hiragino Sans", system-ui, sans-serif';
const COLOR = {taito: '#e8392b', sumida: '#1f78e0'};

// Web Mercator, in pixels at zoom z
const mx = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z;
const my = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z; };

function loadTile(url){
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    const t = setTimeout(() => res(null), 6000);
    img.onload = () => { clearTimeout(t); res(img); }; img.onerror = () => { clearTimeout(t); res(null); };
    img.src = url;
  });
}

function text(cx, str, x, y, size, fill, {align = 'center', stroke = size * .26, font = FONT, weight = '', maxW} = {}){
  cx.font = `${weight} ${size}px ${font}`; cx.textAlign = align; cx.textBaseline = 'middle'; cx.lineJoin = 'round';
  if (maxW) { const w = cx.measureText(str).width; if (w > maxW) { size *= maxW / w; cx.font = `${weight} ${size}px ${font}`; stroke *= maxW / w; } }
  if (stroke) { cx.lineWidth = stroke; cx.strokeStyle = INK; cx.strokeText(str, x, y + size * .06); cx.strokeText(str, x, y); }
  cx.fillStyle = fill; cx.fillText(str, x, y);
}

// r: {geo, data, shift (border now), moved (this pull, m), sign (+1 Taito), sideJa, rankJa, lineJa, areas {taito, sumida}, gain}
export async function drawShareImage(r){
  const {geo, data} = r;
  await document.fonts?.load(`60px ${FONT}`, '区境つなひき台東区墨田区のために級はいま側へ消滅0123456789.+m²');
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#dfeaf2'; cx.fillRect(0, 0, W, H);

  // fit both wards into the map box in the middle of the square
  const ll = [...data.taito.ring, ...data.sumida.ring];
  const lons = ll.map(p => p[0]), lats = ll.map(p => p[1]);
  const box = {x0: 380, x1: 760, y0: 104, y1: 440};
  const z0 = 10, bw = mx(Math.max(...lons), z0) - mx(Math.min(...lons), z0), bh = my(Math.min(...lats), z0) - my(Math.max(...lats), z0);
  const z = z0 + Math.log2(Math.min((box.x1 - box.x0) / bw, (box.y1 - box.y0) / bh));
  const cxm = (mx(Math.min(...lons), z) + mx(Math.max(...lons), z)) / 2, cym = (my(Math.min(...lats), z) + my(Math.max(...lats), z)) / 2;
  const ox = (box.x0 + box.x1) / 2 - cxm, oy = (box.y0 + box.y1) / 2 - cym;
  const P = ([lon, lat]) => [mx(lon, z) + ox, my(lat, z) + oy];
  const XY = xy => P(geo.toLonLat(xy));

  // tiles one zoom level up, scaled down, so labels stay small
  const zi = Math.min(18, Math.ceil(z)), k = 2 ** (z - zi), ts = 256 * k;
  const tx0 = Math.floor(-ox / ts), tx1 = Math.floor((W - ox) / ts), ty0 = Math.floor(-oy / ts), ty1 = Math.floor((H - oy) / ts);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++)
    jobs.push(loadTile(TILE.replace('{z}', zi).replace('{x}', tx).replace('{y}', ty)).then(img => { if (img) cx.drawImage(img, tx * ts + ox, ty * ts + oy, ts + .5, ts + .5); return img; }));
  const tiles = await Promise.all(jobs);
  const usedTiles = tiles.some(Boolean);
  cx.fillStyle = 'rgba(255,255,255,.35)'; cx.fillRect(0, 0, W, H);

  // wards as they are now, and the land that changed hands since the start
  const path = pts => pts.forEach((p, i) => { const [x, y] = P(p); i ? cx.lineTo(x, y) : cx.moveTo(x, y); });
  const xyPath = pts => pts.forEach((p, i) => { const [x, y] = XY(p); i ? cx.lineTo(x, y) : cx.moveTo(x, y); });
  const FAR = 60000, L = geo.line(r.shift);
  cx.save();
  cx.beginPath(); path(data.taito.ring); path(data.sumida.ring); cx.clip();
  cx.globalAlpha = .5;
  cx.fillStyle = COLOR.taito; cx.beginPath(); xyPath([...L, [-FAR, L.at(-1)[1]], [-FAR, L[0][1]]]); cx.fill();
  cx.fillStyle = COLOR.sumida; cx.beginPath(); xyPath([...L, [FAR, L.at(-1)[1]], [FAR, L[0][1]]]); cx.fill();
  if (Math.abs(r.shift) > .5) { cx.globalAlpha = .35; cx.fillStyle = r.shift > 0 ? COLOR.taito : COLOR.sumida; cx.beginPath(); xyPath([...geo.line0, ...geo.line(r.shift).reverse()]); cx.fill(); }
  cx.globalAlpha = 1;
  cx.setLineDash([7, 5]); cx.lineWidth = 2; cx.strokeStyle = 'rgba(17,17,17,.7)'; cx.beginPath(); xyPath(geo.line0); cx.stroke(); cx.setLineDash([]);
  cx.lineJoin = 'round'; cx.lineWidth = 9; cx.strokeStyle = INK; cx.beginPath(); xyPath(L); cx.stroke();
  cx.lineWidth = 5; cx.strokeStyle = YELLOW; cx.stroke();
  cx.restore();
  cx.lineWidth = 2.5; cx.strokeStyle = 'rgba(17,17,17,.65)';
  cx.beginPath(); path(data.taito.ring); cx.stroke(); cx.beginPath(); path(data.sumida.ring); cx.stroke();

  // the spot this pull moved, and a magnifier on it (1 m = 60 px) where the strip it took is visible
  const A = geo.anchor(r.shift), [ax, ay] = XY(A);
  const I = {x: 862, y: 300, r: 70, k: 60};
  if (r.moved > 0) {
    cx.strokeStyle = INK; cx.lineWidth = 4; cx.beginPath(); cx.moveTo(ax, ay); cx.lineTo(I.x - I.r * .8, I.y + I.r * .3); cx.stroke();
    magnifier(cx, r, A, I);
  }
  cx.fillStyle = '#fff'; cx.strokeStyle = INK; cx.lineWidth = 4; cx.beginPath(); cx.arc(ax, ay, 9, 0, 7); cx.fill(); cx.stroke();

  // text: title, the pull, rank, border line, URL
  const g = cx.createLinearGradient(0, 450, 0, H); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.35, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,.9)');
  cx.fillStyle = g; cx.fillRect(0, 450, W, H - 450);
  text(cx, '区境つなひき', W/2, 54, 64, YELLOW, {stroke: 16});
  const pull = r.moved > 0 ? `+${r.moved.toFixed(2)} m` : '±0.00 m';
  text(cx, pull, W/2, 506, 92, r.sign > 0 ? '#ff6b5c' : '#5aa8ff', {stroke: 22});
  text(cx, `${r.sideJa}のために ・ ${r.rankJa}`, W/2, 572, 36, '#fff', {stroke: 10, maxW: 640});
  text(cx, r.lineJa, W/2, 614, 27, YELLOW, {stroke: 8, maxW: 640});
  text(cx, 'lys-games.github.io/mini-games/border-tug/', W/2, 652, 21, INK, {stroke: 0, font: 'system-ui, sans-serif', weight: 800, maxW: 640});

  // ward boxes in the side margins
  wardBox(cx, 34, 214, 'taito', '台東区', r.areas.taito, r.sign > 0 ? r.gain : -r.gain);
  wardBox(cx, W - 34 - 210, 214, 'sumida', '墨田区', r.areas.sumida, r.sign < 0 ? r.gain : -r.gain);

  cx.font = '600 13px system-ui, sans-serif'; cx.textAlign = 'right'; cx.textBaseline = 'bottom'; cx.fillStyle = '#333';
  cx.fillText((usedTiles ? '地理院タイル | ' : '') + '区境 © OpenStreetMap contributors', W - 10, H - 8);
  cx.textAlign = 'left'; cx.fillText('Lys Games', 10, H - 8);

  return await new Promise(res => cv.toBlob(res, 'image/png'));
}

function wardBox(cx, x, y, k, name, area, delta){
  const w = 210, h = 150, gone = area < 1;
  cx.fillStyle = gone ? '#444' : COLOR[k]; cx.strokeStyle = INK; cx.lineWidth = 5;
  cx.beginPath(); cx.roundRect(x, y + 6, w, h, 18); cx.fillStyle = INK; cx.fill();
  cx.beginPath(); cx.roundRect(x, y, w, h, 18); cx.fillStyle = gone ? '#444' : COLOR[k]; cx.fill(); cx.stroke();
  text(cx, name + (gone ? ' 消滅' : ''), x + w/2, y + 32, 30, '#fff', {stroke: 8});
  text(cx, Math.round(area).toLocaleString('en-US'), x + w/2, y + 78, 32, '#fff', {stroke: 8, maxW: w - 24});
  text(cx, 'm²', x + w/2, y + 108, 18, '#fff', {stroke: 5});
  if (Math.abs(delta) >= .5) text(cx, (delta > 0 ? '+' : '−') + Math.round(Math.abs(delta)).toLocaleString('en-US') + ' m²', x + w/2, y + 134, 20, YELLOW, {stroke: 6});
}

function magnifier(cx, r, A, I){
  const {geo} = r;
  // frame metres around the anchor -> magnifier pixels, north up like the map
  const e1 = geo.toLonLat([A[0] + 1, A[1]]), e0 = geo.toLonLat(A), e2 = geo.toLonLat([A[0], A[1] + 1]);
  const mPerLon = 111320 * Math.cos(e0[1] * Math.PI / 180), mPerLat = 110950;
  const ux = [(e1[0] - e0[0]) * mPerLon, -(e1[1] - e0[1]) * mPerLat], uy = [(e2[0] - e0[0]) * mPerLon, -(e2[1] - e0[1]) * mPerLat];
  const S = ([x, y]) => [I.x + ((x - A[0]) * ux[0] + (y - A[1]) * uy[0]) * I.k, I.y + ((x - A[0]) * ux[1] + (y - A[1]) * uy[1]) * I.k];
  const seg = (x0, x1, ext = 4) => [[x0, A[1] - ext], [x0, A[1] + ext], [x1, A[1] + ext], [x1, A[1] - ext]];
  const poly = pts => { cx.beginPath(); pts.forEach((p, i) => { const [x, y] = S(p); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }); cx.closePath(); };
  const line = x => { const a = S([x, A[1] - 4]), b2 = S([x, A[1] + 4]); cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b2[0], b2[1]); };
  const now = A[0], before = now - r.sign * r.moved;
  cx.save();
  cx.beginPath(); cx.arc(I.x, I.y, I.r, 0, 7); cx.fillStyle = '#efe7d6'; cx.fill(); cx.clip();
  // half-metre paving, square to the border
  cx.strokeStyle = '#d2c7b0'; cx.lineWidth = 1.5;
  for (let d = -3; d <= 3; d += .5) { line(Math.round(now * 2) / 2 + d); cx.stroke(); const a = S([now - 4, A[1] + d]), b2 = S([now + 4, A[1] + d]); cx.beginPath(); cx.moveTo(a[0], a[1]); cx.lineTo(b2[0], b2[1]); cx.stroke(); }
  cx.globalAlpha = .3; cx.fillStyle = COLOR.taito; poly(seg(now - 6, now)); cx.fill(); cx.fillStyle = COLOR.sumida; poly(seg(now, now + 6)); cx.fill();
  cx.globalAlpha = .7; cx.fillStyle = r.sign > 0 ? COLOR.taito : COLOR.sumida; poly(seg(Math.min(before, now), Math.max(before, now))); cx.fill();
  cx.globalAlpha = 1;
  cx.setLineDash([6, 5]); cx.lineWidth = 3; cx.strokeStyle = INK; line(before); cx.stroke(); cx.setLineDash([]);
  cx.lineWidth = 9; line(now); cx.stroke(); cx.lineWidth = 5; cx.strokeStyle = YELLOW; cx.stroke();
  cx.restore();
  cx.lineWidth = 6; cx.strokeStyle = INK; cx.beginPath(); cx.arc(I.x, I.y, I.r, 0, 7); cx.stroke();
  cx.lineWidth = 2.5; cx.strokeStyle = '#fff'; cx.beginPath(); cx.arc(I.x, I.y, I.r - 4.5, 0, 7); cx.stroke();
  // a 1 m ruler under the lens
  const rx = I.x - I.k / 2, ry = I.y + I.r + 20;
  cx.fillStyle = YELLOW; cx.strokeStyle = INK; cx.lineWidth = 3; cx.fillRect(rx, ry - 7, I.k, 14); cx.strokeRect(rx, ry - 7, I.k, 14);
  text(cx, '1 m', I.x, ry + 24, 18, '#fff', {stroke: 5});
}
