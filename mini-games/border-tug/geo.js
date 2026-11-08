// Border geometry in real metres. Pure functions, no DOM: index.html draws with them, tools/check.mjs tests them.
//
// Frame: a local plane centred on the bridge (WGS84 radii of curvature at that latitude), rotated so
// +x is the normal to the border at the bridge, pointing at Sumida, and +y runs along the border.
// The border is y-monotone in this frame, so it is a function x = g(y). Beyond its two ends the line
// goes on as straight rays, tilted just enough that neither ward has land on the wrong side.
// A shift of s metres moves the whole line by s along +x: s > 0 hands Sumida land to Taito,
// s < 0 hands Taito land to Sumida.

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), RAD = Math.PI / 180;
export const FAR = 40000;   // metres; the rays end well outside both wards

export function makeGeo(data){
  const [lon0, lat0] = data.bridge.lonlat, nl = Math.hypot(...data.bridge.normal_en);
  const nx = data.bridge.normal_en[0] / nl, ny = data.bridge.normal_en[1] / nl;
  const s = Math.sin(lat0 * RAD);
  const kx = RAD * A / Math.sqrt(1 - E2*s*s) * Math.cos(lat0 * RAD);
  const ky = RAD * A * (1 - E2) / Math.pow(1 - E2*s*s, 1.5);
  // east/north metres -> frame: x along the normal, y along the border (u = n rotated +90deg)
  const toXY = ([lon, lat]) => { const e = (lon - lon0) * kx, n = (lat - lat0) * ky; return [e*nx + n*ny, -e*ny + n*nx]; };
  const toLonLat = ([x, y]) => { const e = x*nx - y*ny, n = x*ny + y*nx; return [lon0 + e/kx, lat0 + n/ky]; };

  const ccw = r => area(r) < 0 ? r.slice().reverse() : r;
  const T = ccw(data.taito.ring.map(toXY)), S = ccw(data.sumida.ring.map(toXY));
  let G = data.border.map(toXY);
  if (G[0][1] > G[G.length-1][1]) G.reverse();             // ascending y
  G = G.filter((p, i) => i === 0 || p[1] - G[i-1][1] > 1e-9);
  for (let i = 1; i < G.length; i++) if (G[i][1] < G[i-1][1]) throw new Error('border is not y-monotone');

  // ray slopes (metres of x per metre of y, beyond each end) that keep Sumida east and Taito west
  const [x0, y0] = G[0], [x1, y1] = G[G.length-1];
  const slope = (ward, beyond, sign) => ward.filter(beyond).map(([x, y]) => (x - x0e(sign)) / Math.abs(y - y0e(sign)));
  const x0e = sign => sign < 0 ? x0 : x1, y0e = sign => sign < 0 ? y0 : y1;
  // Sumida points past an end need x >= xEnd + k*dy, so k <= (x - xEnd)/dy; Taito points need k > that
  const kS = Math.min(0, ...slope(S, p => p[1] < y0, -1));
  const kN = Math.min(0, ...slope(S, p => p[1] > y1, +1));
  if (Math.max(-Infinity, ...slope(T, p => p[1] < y0, -1)) >= kS || Math.max(-Infinity, ...slope(T, p => p[1] > y1, +1)) >= kN)
    console.warn('border rays cut a ward');
  const line0 = [[x0 + kS*FAR, y0 - FAR], ...G, [x1 + kN*FAR, y1 + FAR]];

  const line = shift => line0.map(([x, y]) => [x + shift, y]);
  // the part of the plane on Taito's side of the shifted line, as one simple polygon
  const westPoly = shift => { const L = line(shift); return [...L, [-3*FAR, L[L.length-1][1]], [-3*FAR, L[0][1]]]; };
  // area of `ring` west of the shifted line: clip it to each slab of the line, where the line is straight
  function westArea(ring, shift){
    let tot = 0;
    for (let i = 0; i < line0.length - 1; i++) {
      const [ax, ay] = line0[i], [bx, by] = line0[i+1];
      let c = clip(ring, 0, -1, ay);                       // y >= ay
      c = clip(c, 0, 1, -by);                              // y <= by
      c = clip(c, by - ay, -(bx - ax), (bx - ax)*ay - (by - ay)*(ax + shift));   // left of a->b
      if (c.length > 2) tot += area(c);
    }
    return tot;
  }
  const areaT = area(T), areaS = area(S);
  function areas(shift){
    if (shift >= 0) { const g = westArea(S, shift); return {taito: areaT + g, sumida: Math.max(0, areaS - g)}; }
    const g = areaT - westArea(T, shift); return {taito: Math.max(0, areaT - g), sumida: areaS + g};
  }
  // the shift at which each ward is gone: past the far edge of its own land
  const ext = (ring, f) => f(...ring.map(([x, y]) => x - gAt(y)));
  function gAt(y){
    for (let i = 0; i < line0.length - 1; i++) {
      const [ax, ay] = line0[i], [bx, by] = line0[i+1];
      if (y <= by || i === line0.length - 2) return ax + (bx - ax) * (y - ay) / (by - ay);
    }
  }
  const sumidaGoneAt = ext(S, Math.max), taitoGoneAt = ext(T, Math.min);
  // where a horizontal line (constant y) crosses a ring, sorted
  const crossings = (ring, y) => {
    const xs = [];
    for (let i = 0, n = ring.length; i < n; i++) { const [ax, ay] = ring[i], [bx, by] = ring[(i+1) % n]; if ((ay <= y) !== (by <= y)) xs.push(ax + (bx - ax) * (y - ay) / (by - ay)); }
    return xs.sort((a, b) => a - b);
  };
  const centroid = r => { let cx = 0, cy = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i+1) % n], c = p[0]*q[1] - q[0]*p[1]; cx += (p[0]+q[0])*c; cy += (p[1]+q[1])*c; } const a6 = 6*area(r); return [cx/a6, cy/a6]; };
  // a spot for each ward's name inside what it holds now, at the height of its centroid
  function labelAt(ward, shift){
    const ring = ward === 'taito' ? T : S, [x, y] = centroid(ring), xs = crossings(ring, y), g = gAt(y) + shift;
    if (ward === 'taito') { const lo = xs[0], hi = Math.min(xs[xs.length-1], g); return hi - lo > 50 && x > hi - 400 ? [(lo + hi)/2, y] : [x, y]; }
    const lo = Math.max(xs[0], g), hi = xs[xs.length-1]; return hi - lo > 50 && x < lo + 400 ? [(lo + hi)/2, y] : [x, y];
  }
  // The point of the shifted line that stands for the bridge: on the line, inside the two wards'
  // original outline, as close to the bridge's crossing (y = 0) as it gets. At shift 0 it is the bridge.
  const inRing = (r, x, y) => { let c = false; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < xi + (xj - xi) * (y - yi) / (yj - yi)) c = !c; } return c; };
  const inWards = ([x, y]) => inRing(T, x, y) || inRing(S, x, y);
  function anchor(shift){
    // y values where the shifted line crosses either ward's outline, plus its own bends
    const ys = new Set(line0.map(p => p[1]));
    for (const ring of [T, S]) for (let i = 0, n = ring.length; i < n; i++) {
      const [ax, ay] = ring[i], [bx, by] = ring[(i+1) % n];
      for (let k = 0; k < line0.length - 1; k++) {
        const [px, py] = line0[k], [qx, qy] = line0[k+1];
        const d = (qx - px) * (by - ay) - (qy - py) * (bx - ax);
        if (!d) continue;
        const t = ((ax - px - shift) * (by - ay) - (ay - py) * (bx - ax)) / d, u = ((ax - px - shift) * (qy - py) - (ay - py) * (qx - px)) / d;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ys.add(py + t * (qy - py));
      }
    }
    const at = y => [gAt(y) + shift, y];
    if (inWards(at(0))) return at(0);
    // between two crossings the line is wholly in or out: test each span's middle, keep the nearest inside span
    const sorted = [...ys].sort((a, b) => a - b);
    let best = null, bestD = Infinity;
    for (let i = 0; i < sorted.length - 1; i++) {
      const lo = sorted[i], hi = sorted[i+1];
      if (hi - lo < 1e-6 || !inWards(at((lo + hi) / 2))) continue;
      const m = Math.min(5, (hi - lo) / 2);             // a few metres in from the edge, never past the middle
      const y = hi <= 0 ? hi - m : lo + m, dist = Math.abs(y);
      if (dist < bestD) { bestD = dist; best = y; }
    }
    return best == null ? [shift, 0] : at(best);
  }
  return {toXY, toLonLat, T, S, line0, line, westPoly, areas, areaT, areaS, sumidaGoneAt, taitoGoneAt, labelAt,
          anchor, inWards, bridgeAt: shift => toLonLat(anchor(shift))};
}

export function area(r){
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i+1) % n]; a += p[0]*q[1] - q[0]*p[1]; }
  return a / 2;
}
// Sutherland-Hodgman against one half-plane a*x + b*y + c <= 0. The subject may be concave: the result can
// carry zero-width seams, which leave the area exact.
function clip(poly, a, b, c){
  const out = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i+1) % n], vp = a*p[0] + b*p[1] + c, vq = a*q[0] + b*q[1] + c;
    if (vp <= 0) out.push(p);
    if ((vp < 0 && vq > 0) || (vp > 0 && vq < 0)) { const t = vp / (vp - vq); out.push([p[0] + t*(q[0]-p[0]), p[1] + t*(q[1]-p[1])]); }
  }
  return out;
}
