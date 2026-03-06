let QM = null;
if(typeof QMModule === 'function'){
  QMModule({
    locateFile: function(path){
      if(path.endsWith('.wasm')) return 'quantum/' + path;
      return path;
    }
  }).then(module => {
    QM = module;
    const energy = QM.solveHydrogenEnergy(1, 0);
    console.log('Hydrogen ground state energy:', energy);
    const u = getRadialU(1, 0);
    if(u){
      const prob = u.slice(0, 5).map(x => x * x);
      console.log('Hydrogen radial probability (first 5):', prob);
    }
  }).catch(err => {
    console.warn('QMModule init failed', err);
  });
}

/* ---------- Dynamic element dataset ---------- */
let ELEMENTS = {};
let trendChart = null;
let phaseUpdateRaf = 0;
let pendingPhaseTemperature = 298;

async function loadElementData() {
  try {
    const response = await fetch(`elements.json?v=${Date.now()}`);
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    ELEMENTS = await response.json();
    console.log('Cosmic data loaded:', Object.keys(ELEMENTS).length, 'elements found.');
    buildGroupDashboard();
    buildSearchResultsGrid();
    applyCurrentThermalState();
  } catch (error) {
    console.error('Data Load Error:', error);
    const groups = document.getElementById('groups');
    if(groups){
      groups.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding: 50px; color: var(--accent-pink);">
        <h3>Cosmic Connection Failed</h3>
        <p>Could not load elements.json. Use a local server (Live Server / python -m http.server) and ensure the file exists.</p>
      </div>`;
    }
  }
}

function parseKelvin(value){
  if(value === null || value === undefined) return null;
  if(typeof value === 'number') return Number.isFinite(value) ? value : null;
  if(typeof value === 'string'){
    if(value.trim().toLowerCase() === 'unknown') return null;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function updateElementPhases(tempK) {
  const tiles = document.querySelectorAll('.element-tile');
  tiles.forEach(tile => {
    const atomicNum = tile.dataset.atomic;
    const el = ELEMENTS[atomicNum];
    if(!el) return;

    tile.classList.remove('state-solid', 'state-liquid', 'state-gas');
    const meltK = parseKelvin(el.melt);
    const boilK = parseKelvin(el.boil);
    const fallbackBoilK = boilK ?? parseKelvin(el.sublimation);
    let phase = '';

    if(meltK === null){
      if(fallbackBoilK !== null && tempK >= fallbackBoilK){
        tile.classList.add('state-gas');
        phase = 'gas';
      } else {
        tile.classList.add('state-solid');
        phase = (el.phase || 'unknown').toLowerCase();
      }
    } else if(fallbackBoilK !== null && tempK >= fallbackBoilK){
      tile.classList.add('state-gas');
      phase = 'gas';
    } else if(tempK >= meltK){
      tile.classList.add('state-liquid');
      phase = 'liquid';
    } else {
      tile.classList.add('state-solid');
      phase = 'solid';
    }

    let indicator = tile.querySelector('.phase-indicator');
    if(!indicator){
      indicator = document.createElement('span');
      indicator.className = 'phase-indicator';
      tile.appendChild(indicator);
    }
    indicator.innerText = phase;
  });
}

function applyCurrentThermalState(){
  const slider = document.getElementById('tempSlider');
  if(!slider) return;
  updateElementPhases(parseInt(slider.value, 10));
}

function schedulePhaseUpdate(tempK){
  pendingPhaseTemperature = tempK;
  if(phaseUpdateRaf) return;
  phaseUpdateRaf = requestAnimationFrame(()=>{
    updateElementPhases(pendingPhaseTemperature);
    phaseUpdateRaf = 0;
  });
}

function toGroupNumber(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inferGroupId(el){
  const t = (el.type || '').toLowerCase();
  const g = toGroupNumber(el.group);
  const z = Number(el.number);

  // Prefer strict periodic-table group numbers when available.
  if(g === 17) return 'halogen';
  if(g === 18) return 'noble';
  if(g === 1 && z !== 1) return 'alkali'; // Hydrogen stays in nonmetal buckets.
  if(g === 2) return 'alkaline';

  if(t.includes('lanthanide')) return 'lanthanide';
  if(t.includes('actinide')) return 'actinide';
  if(t.includes('post-transition')) return 'post';
  if(t.includes('transition')) return 'transition';
  if(t.includes('metalloid')) return 'metalloid';
  if(t.includes('alkaline')) return 'alkaline';
  if(t.includes('alkali')) return 'alkali';
  if(t.includes('halogen')) return 'halogen';
  if(t.includes('noble')) return 'noble';
  if(t.includes('nonmetal') || t.includes('non-metal')) return 'nonmetal';
  return '';
}

function belongsToGroup(el, id){
  return inferGroupId(el) === id;
}

/* ---------- Group definitions ---------- */
const GROUPS = [
  { id:'alkali', title:'Alkali Metals', filter: el => belongsToGroup(el, 'alkali') },
  { id:'alkaline', title:'Alkaline Earth Metals', filter: el => belongsToGroup(el, 'alkaline') },
  { id:'transition', title:'Transition Metals', filter: el => belongsToGroup(el, 'transition') },
  { id:'post', title:'Post-transition Metals', filter: el => belongsToGroup(el, 'post') },
  { id:'metalloid', title:'Metalloids', filter: el => belongsToGroup(el, 'metalloid') },
  { id:'nonmetal', title:'Non-metals', filter: el => belongsToGroup(el, 'nonmetal') },
  { id:'halogen', title:'Halogens', filter: el => belongsToGroup(el, 'halogen') },
  { id:'noble', title:'Noble Gases', filter: el => belongsToGroup(el, 'noble') },
  { id:'lanthanide', title:'Lanthanides', filter: el => belongsToGroup(el, 'lanthanide') },
  { id:'actinide', title:'Actinides', filter: el => belongsToGroup(el, 'actinide') }
];

const COLOR_MAP = {
  alkali: '#ff6ad5',
  alkaline: '#ffcc66',
  transition: '#a78bfa',
  noble: '#4dfcff',
  metalloid: '#818cf8',
  non: '#4ade80',
  nonmetal: '#4ade80',
  halogen: '#22d3ee',
  post: '#f472b6',
  lanthanide: '#f59e0b',
  actinide: '#84cc16'
};

/* ---------- DOM builders & controls ---------- */
function buildGroupDashboard(){
  const groupsEl = document.getElementById('groups');
  groupsEl.innerHTML = '';

  GROUPS.forEach(g=>{
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.group = g.id;
    const color = COLOR_MAP[g.id] || '#ffffff';
    card.style.setProperty('--card-glow', color);
    card.style.background = `linear-gradient(145deg, ${color}11, transparent)`;
    card.style.borderColor = `${color}33`;

    if(g.id === 'transition' || g.id === 'noble'){
      card.classList.add('featured');
    }

    const elementsInGroup = Object.values(ELEMENTS).filter(g.filter);
    const previewSymbols = elementsInGroup.slice(0, 4).map(el =>
      `<span class="symbol-pill">${el.symbol}</span>`
    ).join('');

    card.innerHTML = `
      <div class="card-top">
        <div class="group-title">${g.title}</div>
        <div class="group-sub small" style="opacity:0.6">Scientific Classification</div>
        <div class="pill-container">${previewSymbols}</div>
      </div>
      <div class="card-bottom">
        <div class="small" style="color:var(--accent-cyan); font-family:var(--mono)">
          ${elementsInGroup.length} ELEMENTS
        </div>
        <div class="group-arrow">&rarr;</div>
      </div>
    `;

    card.addEventListener('click', ()=>{
      document.querySelectorAll('.group-card').forEach(c=>c.classList.remove('active'));
      card.classList.add('active');
      openGroup(g);
    });

    groupsEl.appendChild(card);
  });
}

function createElementTile(el){
  const typeClass = classForType(el.type) || '';
  const inferredGroup = inferGroupId(el);
  const groupKey = inferredGroup || (typeClass === 'non' ? 'non' : typeClass);
  const color = COLOR_MAP[groupKey] || 'var(--accent-cyan)';
  const tile = document.createElement('button');
  tile.className = `element-tile ${typeClass || inferredGroup}`.trim();
  tile.dataset.atomic = String(el.number);
  tile.dataset.number = String(el.number);
  tile.dataset.name = el.name.toLowerCase();
  tile.dataset.symbol = el.symbol.toLowerCase();
  tile.style.setProperty('--group-color', color);

  const groupClassSource = inferredGroup || typeClass;
  if(groupClassSource) tile.classList.add(`group-${groupClassSource === 'non' ? 'nonmetal' : groupClassSource}`);

  tile.innerHTML = `
    <div class="tile-number">${el.number}</div>
    <div class="tile-symbol">${el.symbol}</div>
    <div class="tile-name">${el.name}</div>
  `;

  tile.addEventListener('click', ()=>{
    tile.classList.add('clicked');
    setTimeout(()=> tile.classList.remove('clicked'), 600);
    openElement(el.number);
  });

  return tile;
}

function buildSearchResultsGrid(){
  const resultsEl = document.getElementById('elements');
  if(!resultsEl) return;
  resultsEl.innerHTML = '';
  const all = Object.values(ELEMENTS).sort((a,b)=>a.number-b.number);
  all.forEach(el => resultsEl.appendChild(createElementTile(el)));
  applyCurrentThermalState();
}

function openGroup(group){
  const dashboardView = document.getElementById('dashboardView');
  const searchResults = document.getElementById('elements');
  if(searchResults) searchResults.style.display = 'none';
  if(dashboardView) dashboardView.style.display = 'none';
  document.querySelector('.groups').style.display='none';
  const groupPanel = document.getElementById('groupPanel'); groupPanel.style.display='block';
  document.getElementById('groupTitle').textContent = group.title;
  const elementsGrid = document.getElementById('elementsGrid'); elementsGrid.innerHTML='';
  const list = Object.values(ELEMENTS).filter(group.filter).sort((a,b)=>a.number-b.number);
  if(list.length === 0){
    const empty = document.createElement('div');
    empty.className = 'small';
    empty.style.cssText = 'padding:16px;color:var(--text-soft);border:1px solid var(--glass-border);border-radius:12px;background:rgba(255,255,255,0.03);';
    empty.textContent = 'No elements matched this group in the loaded dataset.';
    elementsGrid.appendChild(empty);
  } else {
    list.forEach(el=> elementsGrid.appendChild(createElementTile(el)));
  }
  applyCurrentThermalState();
}

/* ---------- Electron configuration (Aufbau) ---------- */
const ORBITALS = [
  ['1s', 2],
  ['2s', 2], ['2p', 6],
  ['3s', 2], ['3p', 6],
  ['4s', 2], ['3d', 10], ['4p', 6],
  ['5s', 2], ['4d', 10], ['5p', 6],
  ['6s', 2], ['4f', 14], ['5d', 10], ['6p', 6],
  ['7s', 2], ['5f', 14], ['6d', 10], ['7p', 6]
];

const CONFIG_EXCEPTIONS = {
  24: [['1s', 2], ['2s', 2], ['2p', 6], ['3s', 2], ['3p', 6], ['4s', 1], ['3d', 5]],
  29: [['1s', 2], ['2s', 2], ['2p', 6], ['3s', 2], ['3p', 6], ['4s', 1], ['3d', 10]],
  42: [['1s', 2], ['2s', 2], ['2p', 6], ['3s', 2], ['3p', 6], ['4s', 2], ['3d', 10], ['4p', 6], ['5s', 1], ['4d', 5]]
};

function electronConfiguration(Z){
  if(CONFIG_EXCEPTIONS[Z]) return CONFIG_EXCEPTIONS[Z];

  let remaining = Z;
  const config = [];
  for(const [orbital, cap] of ORBITALS){
    if(remaining<=0) break;
    const used = Math.min(cap, remaining);
    config.push([orbital, used]);
    remaining -= used;
  }
  return config;
}

function shellsFromConfig(config){
  const shells = {};
  for(const [orbital, count] of config){
    const n = orbital[0];
    shells[n] = (shells[n] || 0) + count;
  }
  return Object.values(shells);
}

function shellsFromZ(Z){
  return shellsFromConfig(electronConfiguration(Z));
}

function smartMatch(query, el){
  if(!el) return false;
  const q = query.toLowerCase();
  const name = (el.name || '').toLowerCase();
  const symbol = (el.symbol || '').toLowerCase();
  return name.includes(q) || symbol.startsWith(q) || String(el.number) === q;
}

function classForType(type){
  if(!type) return '';
  const t = type.toLowerCase();
  const first = t.split(' ')[0];
  if(first === 'post-transition' || t.includes('post-transition')) return 'post';
  if(first === 'alkali' && !t.includes('alkaline')) return 'alkali';
  if(first === 'alkaline') return 'alkaline';
  if(first === 'transition') return 'transition';
  if(first === 'metalloid') return 'metalloid';
  if(first === 'non-metal' || first === 'non') return 'non';
  if(first === 'halogen') return 'halogen';
  if(first === 'noble') return 'noble';
  if(first === 'lanthanide') return 'lanthanide';
  if(first === 'actinide') return 'actinide';
  return first;
}

function groupForElement(el){
  return GROUPS.find(g => g.filter(el)) || null;
}

/* ---------- Fallback canvas atomic renderer ---------- */
let fallbackCanvas, fallbackCtx, animId=null, reduced=false, currentElement=null;
function initFallbackCanvas(){ fallbackCanvas = document.getElementById('fallbackCanvas'); if(!fallbackCanvas) return; fallbackCtx = fallbackCanvas.getContext('2d'); }
let densityCanvas = null;
let densityCtx = null;
let orbitalsEl = null;
let atomEl = null;
let nucleusEl = null;
let radialCDF = null;
let radialU = null;
let radialRMax = 30.0;
let currentOrbital = '1s';

function initAtomOverlays(){
  densityCanvas = document.getElementById('density-canvas');
  densityCtx = densityCanvas ? densityCanvas.getContext('2d') : null;
  orbitalsEl = document.querySelector('.orbitals');
  atomEl = document.getElementById('atom');
  nucleusEl = document.getElementById('nucleus');
}

function assignSpins(count){
  return Array.from({ length: count }, (_, i) => i % 2 === 0 ? 'up' : 'down');
}

function drawDensity(shells){
  if(!densityCanvas || !densityCtx) return;
  const w = densityCanvas.width = Math.max(360, Math.floor(document.getElementById('threeContainer').clientWidth || 360));
  const h = densityCanvas.height = Math.max(260, Math.floor(document.getElementById('threeContainer').clientHeight || 260));
  densityCtx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2;
  shells.forEach((count, i)=>{
    const r = 40 + i*25;
    const gradient = densityCtx.createRadialGradient(cx,cy,r*0.3,cx,cy,r);
    gradient.addColorStop(0, 'rgba(0,200,255,0.15)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    densityCtx.fillStyle = gradient;
    densityCtx.beginPath();
    densityCtx.arc(cx,cy,r,0,Math.PI*2);
    densityCtx.fill();
  });
}

function getRadialU(n, l){
  if(!QM || typeof QM.solveHydrogenRadial !== 'function') return null;
  const uVec = QM.solveHydrogenRadial(n, l);
  const arr = [];
  for(let i=0;i<uVec.size();i++){
    arr.push(uVec.get(i));
  }
  if(uVec.delete) uVec.delete();
  return arr;
}

function buildRadialCDF(u){
  const rMin = 1e-4;
  const rMax = 30.0;
  const n = u.length;
  const h = (rMax - rMin) / (n - 1);
  const cdf = new Float64Array(n);
  let sum = 0;
  for(let i=0;i<n;i++){
    const w = u[i] * u[i];
    sum += w;
    cdf[i] = sum;
  }
  if(sum > 0){
    for(let i=0;i<n;i++) cdf[i] /= sum;
  }
  radialCDF = { cdf, rMin, h, n };
}

function RofR(r, Rarray, rMax){
  const N = Rarray.length;
  const index = Math.floor((r / rMax) * (N - 1));
  return Rarray[Math.max(0, Math.min(index, N - 1))];
}

function sample1sElectron(Rarray, rMax){
  while(true){
    const x = (Math.random() * 2 - 1) * rMax;
    const y = (Math.random() * 2 - 1) * rMax;
    const z = (Math.random() * 2 - 1) * rMax;
    const r = Math.sqrt(x*x + y*y + z*z);
    if(r >= rMax) continue;
    const R = RofR(r, Rarray, rMax);
    const probability = R * R;
    if(Math.random() < probability) return { x, y, z };
  }
}

function samplePOrbital(Rarray, rMax, axis){
  while(true){
    const x = (Math.random() * 2 - 1) * rMax;
    const y = (Math.random() * 2 - 1) * rMax;
    const z = (Math.random() * 2 - 1) * rMax;
    const r = Math.sqrt(x*x + y*y + z*z);
    if(r >= rMax || r === 0) continue;
    const R = RofR(r, Rarray, rMax);
    let angular = 0;
    if(axis === 'px') angular = x * x;
    if(axis === 'py') angular = y * y;
    if(axis === 'pz') angular = z * z;
    const probability = R * R * angular;
    if(Math.random() < probability) return { x, y, z, sign: axis === 'px' ? Math.sign(x) : axis === 'py' ? Math.sign(y) : Math.sign(z) };
  }
}

function project(point, scale, cx, cy){
  return { x: cx + point.x * scale, y: cy + point.y * scale };
}

function draw1sOrbital(points){
  if(!densityCanvas || !densityCtx) return;
  const w = densityCanvas.width = Math.max(360, Math.floor(document.getElementById('threeContainer').clientWidth || 360));
  const h = densityCanvas.height = Math.max(260, Math.floor(document.getElementById('threeContainer').clientHeight || 260));
  densityCtx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2;
  const scale = Math.min(w, h) * 0.02;
  densityCtx.fillStyle = 'rgba(0, 255, 255, 0.04)';
  for(const p of points){
    const s = project(p, scale, cx, cy);
    densityCtx.beginPath();
    densityCtx.arc(s.x, s.y, 1.2, 0, Math.PI*2);
    densityCtx.fill();
  }
}

function drawOrbitalFromU(u, orbital){
  radialU = u;
  const points = [];
  const isMobile = window.innerWidth < 768;
  const count = orbital === '1s' ? (isMobile ? 800 : 3000) : (isMobile ? 1200 : 5000);
  if(orbital === '1s'){
    for(let i=0;i<count;i++) points.push(sample1sElectron(u, radialRMax));
    draw1sOrbital(points);
    return;
  }
  for(let i=0;i<count;i++) points.push(samplePOrbital(u, radialRMax, orbital));
  if(!densityCanvas || !densityCtx) return;
  const w = densityCanvas.width = Math.max(360, Math.floor(document.getElementById('threeContainer').clientWidth || 360));
  const h = densityCanvas.height = Math.max(260, Math.floor(document.getElementById('threeContainer').clientHeight || 260));
  densityCtx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2;
  const scale = Math.min(w, h) * 0.02;
  for(const p of points){
    const s = project(p, scale, cx, cy);
    const color = p.sign >= 0 ? 'rgba(0,200,255,0.05)' : 'rgba(255,80,180,0.05)';
    densityCtx.fillStyle = color;
    densityCtx.beginPath();
    densityCtx.arc(s.x, s.y, 1.2, 0, Math.PI*2);
    densityCtx.fill();
  }
}

function sampleR(){
  if(!radialCDF) return 0.0;
  const { cdf, rMin, h, n } = radialCDF;
  const x = Math.random();
  let lo = 0, hi = n - 1;
  while(lo < hi){
    const mid = (lo + hi) >> 1;
    if(cdf[mid] < x) lo = mid + 1; else hi = mid;
  }
  return rMin + lo * h;
}

function sampleDirection(orbital){
  while(true){
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const z = 2 * v - 1;
    const r = Math.sqrt(1 - z * z);
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    let weight = 1.0;
    if(orbital === 'px') weight = x * x;
    else if(orbital === 'py') weight = y * y;
    else if(orbital === 'pz') weight = z * z;
    if(Math.random() <= weight) return { x, y, z };
  }
}

function drawQuantumCloud(orbital){
  if(!densityCanvas || !densityCtx || !radialCDF) return;
  const w = densityCanvas.width = Math.max(360, Math.floor(document.getElementById('threeContainer').clientWidth || 360));
  const h = densityCanvas.height = Math.max(260, Math.floor(document.getElementById('threeContainer').clientHeight || 260));
  densityCtx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2;
  const scale = Math.min(w, h) * 0.015;
  const points = innerWidth < 768 ? 1200 : 2200;
  densityCtx.fillStyle = 'rgba(120,220,255,0.18)';
  for(let i=0;i<points;i++){
    const r = sampleR();
    const dir = sampleDirection(orbital);
    const x = cx + dir.x * r * scale;
    const y = cy + dir.y * r * scale;
    const alpha = 0.15 + (dir.z + 1) * 0.08;
    densityCtx.fillStyle = `rgba(120,220,255,${alpha.toFixed(3)})`;
    densityCtx.beginPath();
    densityCtx.arc(x, y, 1.2, 0, Math.PI*2);
    densityCtx.fill();
  }
}

function renderOrbitals(config){
  if(!orbitalsEl) return;
  orbitalsEl.innerHTML = '';
  let pIndex = 0;
  config.forEach(([orbital])=>{
    const type = orbital.includes('s') ? 's' : orbital.includes('p') ? 'p' : null;
    if(!type) return;
    const n = Number(orbital[0]) || 1;
    const orb = document.createElement('div');
    orb.className = `orbital ${type}`;
    const scale = 0.45 + (n - 1) * 0.12;
    orb.style.setProperty('--orbital-scale', scale.toFixed(2));
    if(type === 'p'){
      const rot = (pIndex * 45) % 180;
      orb.style.setProperty('--orbital-rotate', `${rot}deg`);
      pIndex += 1;
    }
    orbitalsEl.appendChild(orb);
  });
}

function renderElectrons(shells){
  if(!orbitalsEl) return;
  const shellsToRender = Math.max(1, Math.min(shells.length, 6));
  const container = document.getElementById('threeContainer');
  const size = Math.min(container.clientWidth || 520, container.clientHeight || 380);
  const maxOrbit = size * 0.42;
  const baseR = Math.max(38, maxOrbit / (shellsToRender + 1));
  const stepR = Math.max(20, (maxOrbit - baseR) / Math.max(1, shellsToRender - 1));
  const valenceIndex = shellsToRender - 1;
  shells.slice(0, shellsToRender).forEach((count, idx)=>{
    const orbitR = baseR + idx*stepR;
    const shell = document.createElement('div');
    shell.className = 'shell';
    shell.style.width = `${orbitR*2}px`;
    shell.style.height = `${orbitR*2}px`;
    shell.style.left = `calc(50% - ${orbitR}px)`;
    shell.style.top = `calc(50% - ${orbitR}px)`;
    shell.style.animationDuration = `${8 + idx*6}s`;
    const electrons = Math.max(1, count);
    const spins = assignSpins(electrons);
    for(let e=0;e<electrons;e++){
      const el = document.createElement('div');
      el.className = 'electron';
      if(idx === valenceIndex) el.classList.add('valence');
      el.setAttribute('data-spin', spins[e]);
      const size = electrons > 20 ? 4 : electrons > 12 ? 5 : 8;
      const angle = (e / electrons) * Math.PI*2;
      const cx = orbitR;
      const cy = orbitR;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.left = `${cx + Math.cos(angle)*orbitR - size/2}px`;
      el.style.top = `${cy + Math.sin(angle)*orbitR - size/2}px`;
      shell.appendChild(el);
    }
    orbitalsEl.appendChild(shell);
  });
}

function renderNucleus(protons, neutrons){
  if(!nucleusEl) return;
  nucleusEl.innerHTML = '';
  const pCount = Math.max(1, Math.min(24, Math.round(protons)));
  const nCount = Math.max(1, Math.min(24, Math.round(neutrons)));
  const total = Math.min(36, pCount + nCount);
  const nucleusSize = Math.max(20, nucleusEl.clientWidth || 30);
  const center = nucleusSize / 2;
  const maxR = Math.max(4, center - 4);
  for(let i=0;i<total;i++){
    const isProton = i < pCount;
    const dot = document.createElement('div');
    dot.className = `nucleus-dot ${isProton ? 'proton' : 'neutron'}`;
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * maxR;
    dot.style.left = `${center + Math.cos(a) * r}px`;
    dot.style.top = `${center + Math.sin(a) * r}px`;
    nucleusEl.appendChild(dot);
  }
}

/* ---------- Three.js atom renderer ---------- */
let threeState = null;
let glowTex = null;
function getGlowTexture(){
  if(glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64,64,0,64,64,64);
  g.addColorStop(0, 'rgba(0,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(0,200,255,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,128,128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let cloudTex = null;
function getCloudTexture(){
  if(cloudTex) return cloudTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0, 'rgba(120,220,255,0.85)');
  g.addColorStop(0.25, 'rgba(80,200,255,0.55)');
  g.addColorStop(0.6, 'rgba(40,140,220,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,256,256);
  cloudTex = new THREE.CanvasTexture(c);
  return cloudTex;
}

function initThree(){ return false; }

function resizeThree(){}

function clearThree(){}

function buildThreeAtom(shells){
  return false;
}

function animateThree(){}

function drawAtom(shells, t){
  const w = fallbackCanvas.width = Math.max(360, Math.floor(document.getElementById('threeContainer').clientWidth || 360));
  const h = fallbackCanvas.height = Math.max(260, Math.floor(document.getElementById('threeContainer').clientHeight || 260));
  fallbackCtx.clearRect(0,0,w,h);
  const cx=w/2, cy=h/2;
  const grad = fallbackCtx.createRadialGradient(cx,cy,20,cx,cy,Math.max(w,h));
  grad.addColorStop(0,'rgba(60,120,255,0.06)'); grad.addColorStop(1,'rgba(0,0,0,0)');
  fallbackCtx.fillStyle = grad; fallbackCtx.fillRect(0,0,w,h);
  // nucleus
  const nuc = Math.min(12, Math.max(6, Math.round((currentElement?.number||1)/10)+6));
  for(let i=0;i<nuc;i++){
    const a = i*2*Math.PI/nuc + t*0.3;
    const r = 6 + 2*Math.sin(t+i);
    fallbackCtx.beginPath(); fallbackCtx.fillStyle = i%2 ? 'rgba(255,110,110,0.95)' : 'rgba(220,220,255,0.95)';
    fallbackCtx.arc(cx+Math.cos(a)*6, cy+Math.sin(a)*6, r, 0, Math.PI*2); fallbackCtx.fill();
  }
  // shells
  const maxShells = Math.max(1, Math.min(shells.length, 6));
  const maxOrbit = Math.min(w, h) * 0.42;
  const baseR = Math.max(32, maxOrbit / (maxShells + 1));
  const stepR = Math.max(18, (maxOrbit - baseR) / Math.max(1, maxShells - 1));
  shells.slice(0, maxShells).forEach((count, idx)=>{
    const orbitR = baseR + idx*stepR;
    fallbackCtx.beginPath();
    fallbackCtx.strokeStyle = `rgba(120,180,255,${0.06+idx*0.02})`;
    fallbackCtx.setLineDash([4,6]);
    fallbackCtx.arc(cx,cy,orbitR,0,Math.PI*2);
    fallbackCtx.stroke();
    fallbackCtx.setLineDash([]);
  });
}

let tFrame = 0;
function startFallback(shells){
  stopFallback();
  tFrame = 0;
  function loop(){
    if(reduced) return;
    tFrame += 0.02;
    drawAtom(shells, tFrame);
    animId = requestAnimationFrame(loop);
  }
  loop();
}
function stopFallback(){ if(animId) cancelAnimationFrame(animId); animId=null; }

/* ---------- UI wiring ---------- */
let focusTrapHandler = null;
let prevFocus = null;
function openElementPanel(num){
  currentElement = ELEMENTS[num] ?? ELEMENTS[String(num)]; if(!currentElement) return;
  const atomicNum = Number.parseInt(currentElement.number, 10);
  if(!Number.isFinite(atomicNum)) return;
  const massNum = Number.parseFloat(currentElement.mass);
  const neutrons = Number.isFinite(massNum) ? Math.max(0, Math.round(massNum - atomicNum)) : 0;
  document.getElementById('elName').textContent = currentElement.name;
  document.getElementById('elSymbol').textContent = currentElement.symbol;
  document.getElementById('elNumber').textContent = atomicNum;
  document.getElementById('elMass').textContent = currentElement.mass;
  const meltEl = document.getElementById('elMelt');
  const boilEl = document.getElementById('elBoil');
  const discovererEl = document.getElementById('elDiscoverer');
  if(meltEl){
    const meltVal = currentElement.melt;
    meltEl.textContent = (meltVal !== null && meltVal !== undefined && meltVal !== 'Unknown') ? `${meltVal} K` : 'N/A';
  }
  if(boilEl){
    const boilVal = currentElement.boil;
    boilEl.textContent = (boilVal !== null && boilVal !== undefined && boilVal !== 'Unknown') ? `${boilVal} K` : 'N/A';
  }
  if(discovererEl){
    discovererEl.textContent = currentElement.discovered_by || 'Unknown';
  }
  document.getElementById('elProtons').textContent = atomicNum;
  document.getElementById('elElectrons').textContent = atomicNum;
  document.getElementById('elNeutrons').textContent = neutrons;
  document.getElementById('elConfig').textContent = JSON.stringify(shellsFromZ(atomicNum));
  document.getElementById('elGroupPeriod').textContent = `${currentElement.group||'-'} / ${currentElement.period||'-'}`;
  document.getElementById('elType').textContent = currentElement.type;
  document.getElementById('elFact').textContent = currentElement.fact || currentElement.summary || 'No summary available.';
  updateTrendChart(currentElement.type);
  document.getElementById('overlay').classList.add('visible'); document.getElementById('infoPanel').classList.add('visible');
  if(atomEl) atomEl.classList.add('reacting');
  if(nucleusEl) nucleusEl.classList.add('pulsing');
  const config = electronConfiguration(atomicNum);
  const shells = shellsFromConfig(config);
  renderNucleus(atomicNum, neutrons);
  renderOrbitals(config);
  renderElectrons(shells);
  if(QM && typeof QM.solveHydrogenRadial === 'function' && atomicNum === 1){
    const u = getRadialU(1, 0);
    if(u) drawOrbitalFromU(u, currentOrbital);
  }else{
    drawDensity(shells);
  }
  if(!reduced) startFallback(shells);
  prevFocus = document.activeElement;
  const panel = document.getElementById('infoPanel');
  const nodes = panel.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = nodes[0];
  const last = nodes[nodes.length-1];
  if(first) first.focus();
  focusTrapHandler = function(e){
    if(!panel.classList.contains('visible')) return;
    if(e.key !== 'Tab') return;
    const a = document.activeElement;
    if(e.shiftKey && a === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && a === last){ e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', focusTrapHandler);
}

function closeInfoPanel(){
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('infoPanel').classList.remove('visible');
  stopFallback();
  if(orbitalsEl) orbitalsEl.innerHTML = '';
  if(atomEl) atomEl.classList.remove('reacting');
  if(nucleusEl) nucleusEl.classList.remove('pulsing');
  if(focusTrapHandler){ document.removeEventListener('keydown', focusTrapHandler); focusTrapHandler=null; }
  if(prevFocus && typeof prevFocus.focus==='function') prevFocus.focus();
  prevFocus = null;
}

function wireControls(){
  document.getElementById('backBtn').addEventListener('click', ()=>{
    const dashboardView = document.getElementById('dashboardView');
    if(dashboardView) dashboardView.style.display = 'block';
    document.getElementById('groupPanel').style.display='none';
    document.querySelector('.groups').style.display='grid';
    const resultsEl = document.getElementById('elements');
    if(resultsEl) resultsEl.style.display = 'none';
    window.scrollTo(0, 0);
  });
  document.getElementById('closeInfo').addEventListener('click', closeInfoPanel);
  document.getElementById('overlay').addEventListener('click', closeInfoPanel);
  document.getElementById('groupSearch').addEventListener('input', ()=>{
    const q = (document.getElementById('groupSearch').value||'').trim().toLowerCase();
    Array.from(document.getElementById('elementsGrid').children).forEach(tile=>{
      const idx = Number(tile.dataset.atomic); const el = ELEMENTS[idx];
      const match = !q || smartMatch(q, el);
      tile.style.display = match ? '' : 'none';
    });
  });
  document.getElementById('reduceMotion').addEventListener('click', ()=>{
    reduced = !reduced;
    document.body.classList.toggle('reduced-motion', reduced);
    document.getElementById('reduceMotion').textContent = reduced ? 'Motion Reduced' : 'Reduce Motion';
    if(reduced) stopFallback(); else if(currentElement) startFallback(shellsFromZ(currentElement.number));
  });
  const slider = document.getElementById('tempSlider');
  const tempDisplay = document.getElementById('tempDisplay');
  if(slider && tempDisplay){
    slider.addEventListener('input', (e)=>{
      const currentK = parseInt(e.target.value, 10);
      tempDisplay.innerText = `${currentK}`;
      schedulePhaseUpdate(currentK);
    });
  }
  const globalInput = document.getElementById('globalSearch');
  if(globalInput){
    const dashboardView = document.getElementById('dashboardView');
    const groupsEl = document.getElementById('groups');
    const resultsEl = document.getElementById('elements');
    const groupPanel = document.getElementById('groupPanel');

    globalInput.addEventListener('input', (e)=>{
      const query = (e.target.value || '').toLowerCase().trim();
      const tiles = resultsEl ? resultsEl.querySelectorAll('.element-tile') : [];

      if(query.length > 0){
        if(groupPanel) groupPanel.style.display = 'none';
        if(dashboardView) dashboardView.style.display = 'block';
        if(groupsEl) groupsEl.style.display = 'none';
        if(resultsEl) resultsEl.style.display = 'grid';

        tiles.forEach(tile => {
          const name = tile.dataset.name || '';
          const symbol = tile.dataset.symbol || '';
          const num = tile.dataset.number || '';
          const match = name.includes(query) || symbol.includes(query) || num === query;
          const wasHidden = tile.style.display === 'none';
          tile.style.display = match ? '' : 'none';
          if(match && wasHidden) tile.style.animation = 'warpIn 0.4s ease forwards';
        });
        return;
      }

      if(resultsEl) resultsEl.style.display = 'none';
      if(dashboardView) dashboardView.style.display = 'block';
      if(groupsEl) groupsEl.style.display = 'grid';
      tiles.forEach(tile => {
        tile.style.display = '';
        tile.style.animation = '';
      });
    });

    globalInput.addEventListener('keydown', (e)=>{
      if(e.key !== 'Enter') return;
      const q = (globalInput.value||'').trim();
      if(!q) return;
      const hit = Object.values(ELEMENTS).find(el => smartMatch(q, el));
      if(hit){
        openElementPanel(hit.number);
      }
    });
  }
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;
    if(document.getElementById('infoPanel').classList.contains('visible')){
      closeInfoPanel();
      return;
    }
    if(document.getElementById('groupPanel').style.display==='block'){
      const dashboardView = document.getElementById('dashboardView');
      if(dashboardView) dashboardView.style.display = 'block';
      document.getElementById('groupPanel').style.display='none';
      document.querySelector('.groups').style.display='grid';
      return;
    }
    const resultsEl = document.getElementById('elements');
    const groupsEl = document.getElementById('groups');
    const globalInputEl = document.getElementById('globalSearch');
    if(resultsEl && resultsEl.style.display === 'grid'){
      resultsEl.style.display = 'none';
      if(groupsEl) groupsEl.style.display = 'grid';
      if(globalInputEl) globalInputEl.value = '';
    }
  });
}

/* ---------- Initialization ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  initFallbackCanvas();
  initAtomOverlays();
  wireControls();
  loadElementData();
});

/* expose for tiles */
window.openElement = (n)=> openElementPanel(n);
function openElement(n){ openElementPanel(n); }
window.setOrbital = (orbital)=>{
  currentOrbital = orbital;
  if(QM && currentElement && currentElement.number === 1 && typeof QM.solveHydrogenRadial === 'function'){
    const u = getRadialU(1, 0);
    if(u) drawOrbitalFromU(u, currentOrbital);
  }
};

/* ---------- Starfield background ---------- */
const starCanvas = document.getElementById('starfield');
const sctx = starCanvas ? starCanvas.getContext('2d') : null;
let stars = [];
let starTwinkle = 0;

function resizeStars(){
  if(!starCanvas) return;
  starCanvas.width = innerWidth;
  starCanvas.height = innerHeight;
  const count = innerWidth < 768 ? 120 : 220;
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * starCanvas.width,
    y: Math.random() * starCanvas.height,
    r: Math.random() * 1.5,
    phase: Math.random() * Math.PI * 2,
    amp: Math.random() * 0.5 + 0.2
  }));
}

window.addEventListener('resize', ()=>{ resizeStars(); if(currentElement) drawDensity(shellsFromZ(currentElement.number)); });
resizeStars();

function animateStars(){
  if(!sctx) return requestAnimationFrame(animateStars);
  if(reduced) return requestAnimationFrame(animateStars);
  sctx.clearRect(0, 0, starCanvas.width, starCanvas.height);
  starTwinkle += 0.02;
  stars.forEach(star => {
    const alpha = 0.25 + ((Math.sin(star.phase + starTwinkle) + 1) * 0.5) * star.amp;
    sctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    sctx.beginPath();
    sctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    sctx.fill();
  });
  requestAnimationFrame(animateStars);
}
animateStars();

window.addEventListener('deviceorientation', e=>{
  if(reduced) return;
  const gamma = Math.max(-30, Math.min(30, e.gamma || 0));
  const beta = Math.max(-30, Math.min(30, e.beta || 0));
  applyParallax(gamma / 60, beta / 60);
});

let parallaxTarget = { x: 0, y: 0 };
let parallaxRaf = 0;
function applyParallax(nx, ny){
  const nebula = document.querySelector('.nebula');
  const starsOverlay = document.querySelector('.stars-overlay');
  const main = document.querySelector('.main');
  if(nebula){
    nebula.style.transform = `translate(${nx * 25}px, ${ny * 25}px) scale(1.1)`;
  }
  if(starCanvas){
    starCanvas.style.transform = `translate(${nx * -40}px, ${ny * -40}px)`;
  }
  if(starsOverlay){
    starsOverlay.style.transform = `translate(${nx * -50}px, ${ny * -50}px)`;
  }
  if(main){
    main.style.transform = `perspective(1000px) rotateY(${nx * 2}deg) rotateX(${ny * -2}deg)`;
  }
}

function updateTrendChart(type){
  if(typeof Chart === 'undefined') return;
  const canvas = document.getElementById('trendChart');
  if(!canvas) return;

  const rows = Object.values(ELEMENTS)
    .filter(el => (el.type || '').toLowerCase() === (type || '').toLowerCase())
    .sort((a,b) => Number(a.number) - Number(b.number))
    .map(el => ({ x: Number(el.number), y: Number.parseFloat(el.mass) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

  if(trendChart){
    trendChart.destroy();
    trendChart = null;
  }
  if(rows.length < 2) return;

  trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      datasets: [{
        label: `${type} mass trend`,
        data: rows,
        parsing: false,
        borderColor: '#00f2ff',
        backgroundColor: 'rgba(0, 242, 255, 0.12)',
        pointRadius: 2,
        borderWidth: 2,
        tension: 0.25,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Atomic Number', color: '#9fdcff' },
          ticks: { color: '#9fdcff' },
          grid: { color: 'rgba(255,255,255,0.08)' }
        },
        y: {
          title: { display: true, text: 'Atomic Mass', color: '#9fdcff' },
          ticks: { color: '#9fdcff' },
          grid: { color: 'rgba(255,255,255,0.08)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#d9f6ff' } }
      }
    }
  });
}

window.addEventListener('mousemove', (e)=>{
  if(reduced) return;
  parallaxTarget.x = (e.clientX / window.innerWidth) - 0.5;
  parallaxTarget.y = (e.clientY / window.innerHeight) - 0.5;
  if(parallaxRaf) return;
  parallaxRaf = requestAnimationFrame(()=>{
    applyParallax(parallaxTarget.x, parallaxTarget.y);
    parallaxRaf = 0;
  });
});




