/* ============================= STORAGE HELPERS ============================= */
const DEFAULT_CONFIG = {
  name: "Apex Arena Barasat",
  address: "Barasat Kalikapur, North 24 Parganas, Beside Spencer's, Kolkata - 700124",
  sports: {
    football: { label: "Football", weekday: 800, weekend: 1000 },
    cricket:  { label: "Cricket",  weekday: 700, weekend: 900 }
  },
  slotDuration: 60,
  dayStart: 6,
  dayEnd: 23,
  advancePercent: 25,
  upiId: "avrosaha2005@oksbi",
  phone: "6291773827",
  printWidth: "80mm",
  adminPin: "1234"
};

async function loadConfig(){
  try{ const r = await window.storage.get('turf-config', true); return r ? JSON.parse(r.value) : structuredClone(DEFAULT_CONFIG); }
  catch(e){ return structuredClone(DEFAULT_CONFIG); }
}
async function saveConfig(cfg){ await window.storage.set('turf-config', JSON.stringify(cfg), true); }

async function loadBookings(){
  try{ const r = await window.storage.get('turf-bookings', true); return r ? JSON.parse(r.value) : []; }
  catch(e){ return []; }
}
async function saveBookings(list){ await window.storage.set('turf-bookings', JSON.stringify(list), true); }

async function loadBlocked(){
  try{ const r = await window.storage.get('turf-blocked', true); return r ? JSON.parse(r.value) : []; }
  catch(e){ return []; }
}
async function saveBlocked(list){ await window.storage.set('turf-blocked', JSON.stringify(list), true); }

async function loadOverrides(){
  try{ const r = await window.storage.get('turf-overrides', true); return r ? JSON.parse(r.value) : {}; }
  catch(e){ return {}; }
}
async function saveOverrides(obj){ await window.storage.set('turf-overrides', JSON.stringify(obj), true); }

/* ============================= BACKEND (Google Sheets via Apps Script) =============================
   Paste your deployed Apps Script Web App URL below (ends in /exec) to make Google Sheets
   the live database and turn on real 1-day-before reminders. Leave it blank to keep using
   this page's own built-in storage (handy for testing before you deploy). See SETUP.md. */
const API_URL = "https://script.google.com/macros/s/AKfycbyox7cj5lzLkfcveUJwl_1E2hxKQC0uR7C5GpqfEljyv8gK8lgfNSeID74KAGjJDshmmQ/exec";

const IMG = {
  hero: "assets/hero.jpg",
  g1: "assets/g1.jpg",
  g2: "assets/g2.jpg",
  g3: "assets/g3.jpg",
  g4: "assets/g4.jpg",
  g5: "assets/g5.jpg"
};


async function apiCall(action, payload){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
    body: JSON.stringify({ action, ...payload })
  });
  const json = await res.json();
  if(!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}

const Backend = {
  async getAll(){
    if(API_URL) return await apiCall('getAll', {});
    return {
      config: await loadConfig(),
      bookings: await loadBookings(),
      blocked: await loadBlocked(),
      overrides: await loadOverrides()
    };
  },
  async addBooking(booking){
    if(API_URL) return await apiCall('addBooking', { booking });
    const list = await loadBookings();
    booking.slots.forEach(startMin => list.push({ ...booking, startMin }));
    await saveBookings(list);
    return { id: booking.id };
  },
  async markFullPaid(id, pin){
    if(API_URL) return await apiCall('markFullPaid', { id, pin });
    const list = await loadBookings();
    list.forEach(b => { if(b.id === id) b.fullPaid = true; });
    await saveBookings(list);
  },
  async cancelBooking(id, pin){
    if(API_URL) return await apiCall('cancelBooking', { id, pin });
    const list = await loadBookings();
    list.forEach(b => { if(b.id === id) b.status = 'cancelled'; });
    await saveBookings(list);
  },
  async toggleBlock(date, sport, startMin, pin){
    if(API_URL) return await apiCall('toggleBlock', { date, sport, startMin, pin });
    const list = await loadBlocked();
    const idx = list.findIndex(x => x.date === date && x.sport === sport && x.startMin === startMin);
    if(idx >= 0) list.splice(idx, 1); else list.push({ date, sport, startMin });
    await saveBlocked(list);
  },
  async saveConfig(cfg, pin){
    if(API_URL) return await apiCall('saveConfig', { config: cfg, pin });
    await saveConfig(cfg);
    return cfg;
  }
};

/* ============================= APP STATE ============================= */
const State = {
  view: 'book', // book | admin-login | admin
  cfg: null, bookings: [], blocked: [], overrides: {},
  sport: 'football',
  date: todayStr(),
  selectedSlots: [],
  adminAuthed: false,
  adminPin: '',
  backendError: '',
  adminDate: todayStr(),
  lastBooking: null,
  lookupMobile: '',
  lookupResults: null,
  dueQrId: null
};

function todayStr(){ const d=new Date(); return d.toISOString().slice(0,10); }
function isWeekend(dateStr){ const d=new Date(dateStr+'T00:00:00'); const day=d.getDay(); return day===0||day===6; }
function fmtMoney(n){ return '₹' + Math.round(n).toLocaleString('en-IN'); }
function fmtDateNice(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  return d.toLocaleDateString('en-IN',{weekday:'short', day:'numeric', month:'short', year:'numeric'});
}
function pad(n){ return n.toString().padStart(2,'0'); }
function minsToLabel(mins){
  let h = Math.floor(mins/60), m = mins%60;
  const ap = h>=12 ? 'PM':'AM';
  let h12 = h%12; if(h12===0) h12=12;
  return `${pad(h12)}:${pad(m)} ${ap}`;
}

function generateSlots(cfg){
  const slots = [];
  const stepMin = cfg.slotDuration;
  let cur = cfg.dayStart*60;
  const end = cfg.dayEnd*60;
  while(cur + stepMin <= end){
    slots.push({ startMin: cur, endMin: cur+stepMin, startLabel: minsToLabel(cur), endLabel: minsToLabel(cur+stepMin) });
    cur += stepMin;
  }
  return slots;
}

function getRate(cfg, overrides, date, sport){
  if(overrides[date] && overrides[date][sport] != null) return overrides[date][sport];
  const s = cfg.sports[sport];
  return isWeekend(date) ? s.weekend : s.weekday;
}

function slotKey(date,sport,startMin){ return `${date}__${sport}__${startMin}`; }

function isSlotBooked(bookings, date, sport, startMin){
  return bookings.some(b => b.status!=='cancelled' && b.date===date && b.sport===sport && b.startMin===startMin);
}
function isSlotBlocked(blocked, date, sport, startMin){
  return blocked.some(x => x.date===date && x.sport===sport && x.startMin===startMin);
}

/* ============================= INIT ============================= */
async function init(){
  try{
    const all = await Backend.getAll();
    State.cfg = all.config;
    State.bookings = all.bookings;
    State.blocked = all.blocked;
    State.overrides = all.overrides;
    State.backendError = '';
  }catch(err){
    State.backendError = err.message || 'Could not reach the Google Sheet backend.';
    State.cfg = structuredClone(DEFAULT_CONFIG);
    State.bookings = []; State.blocked = []; State.overrides = {};
  }
  render();
}

async function refreshData(){
  try{
    const all = await Backend.getAll();
    State.cfg = all.config;
    State.bookings = all.bookings;
    State.blocked = all.blocked;
    State.overrides = all.overrides;
    State.backendError = '';
  }catch(err){
    State.backendError = err.message || 'Could not reach the Google Sheet backend.';
  }
}

/* ============================= RENDER ROOT ============================= */
function render(){
  const app = document.getElementById('app');
  const banner = State.backendError ? `
    <div class="mt-4 rounded-lg px-4 py-3 text-xs font-mono" style="background:rgba(230,57,70,0.12); border:1px solid rgba(230,57,70,0.4); color:#ffb3b8;">
      Can't reach the Google Sheet backend (${State.backendError}). Check that API_URL is correct and the deployment's
      access is set to "Anyone", then reload. Showing the app in local fallback mode for now.
    </div>` : '';
  if(State.view === 'book') app.innerHTML = banner + renderBookHeader() + renderBookView() + renderFooter();
  else if(State.view === 'lookup') app.innerHTML = banner + renderBookHeader() + renderLookupView() + renderFooter();
  else if(State.view === 'confirmed') app.innerHTML = banner + renderBookHeader() + renderConfirmedView() + renderFooter();
  else if(State.view === 'admin-login') app.innerHTML = banner + renderBookHeader() + renderAdminLogin() + renderFooter();
  else if(State.view === 'admin') app.innerHTML = banner + renderAdminHeader() + renderAdminView() + renderFooter();
  attachHandlers();
}

function renderBookHeader(){
  const cfg = State.cfg;
  const badges = ['Premium Artificial Turf','High Net Safety','Powerful Floodlights','Changing Room','No Water Clogging'];
  return `
  <div class="relative overflow-hidden rounded-2xl mt-6 mb-4">
    <div class="absolute inset-0">
      <div class="hero-slide" style="background-image:url('${IMG.hero}'); animation-delay:0s"></div>
      <div class="hero-slide" style="background-image:url('${IMG.g2}'); animation-delay:5s"></div>
      <div class="hero-slide" style="background-image:url('${IMG.g1}'); animation-delay:10s"></div>
    </div>
    <div class="absolute inset-0 hero-overlay"></div>
    <div class="relative z-10 p-5 md:p-9">
      <div class="text-[10px] font-mono tracking-[0.2em] text-[var(--floodlight)] mb-2 uppercase">Playground &middot; Est. 2026</div>
      <div class="font-display text-3xl md:text-5xl font-bold uppercase text-white leading-none">${cfg.name}</div>
      <div class="font-display text-base md:text-xl uppercase mt-1 tracking-wide" style="color:var(--floodlight)">Premium Turf Arena</div>
      <div class="text-xs md:text-sm font-mono text-[var(--chalk-dim)] mt-2 tracking-widest">PLAY &middot; COMPETE &middot; CELEBRATE</div>
      <div class="flex flex-wrap gap-2 mt-4">
        ${badges.map((b,i)=>`<span class="badge-glow text-[10px] font-mono px-2.5 py-1 rounded-full" style="animation-delay:${i*250}ms">${b}</span>`).join('')}
      </div>
      <div class="text-xs font-mono text-[var(--chalk-dim)] mt-4 leading-relaxed">
        📍 ${cfg.address || ''}<br>
        📞 <a class="underline text-white" href="tel:${cfg.phone}">${cfg.phone}</a>
      </div>
    </div>
  </div>

  <div class="flex gap-2 overflow-x-auto scrollbar-thin pb-1 mb-6">
    ${[IMG.g1,IMG.g3,IMG.g4,IMG.g5,IMG.g2,IMG.hero].map((src,i)=>`<img src="${src}" class="gallery-thumb rounded-lg" style="animation-delay:${i*90}ms">`).join('')}
  </div>

  <div class="flex items-center justify-end gap-3 text-xs font-mono mb-2">
    <button data-nav="book" class="pill px-3 py-1.5 rounded ${State.view==='book'?'bg-[var(--turf-light)]':''}">Book</button>
    <button data-nav="lookup" class="pill px-3 py-1.5 rounded ${State.view==='lookup'?'bg-[var(--turf-light)]':''}">My Booking</button>
  </div>`;
}

function renderAdminHeader(){
  return `
  <div class="pt-8 pb-6 flex items-center justify-between">
    <div>
      <div class="font-display text-2xl md:text-3xl font-bold text-[var(--floodlight)] uppercase">Admin · ${State.cfg.name}</div>
      <div class="text-xs text-[var(--chalk-dim)] font-mono mt-1">Slot, Tariff &amp; Bookings Control</div>
    </div>
    <div class="flex gap-3 text-xs font-mono">
      <button data-nav="book" class="pill px-3 py-1.5 rounded">Public Site</button>
      <button data-action="logout" class="pill px-3 py-1.5 rounded text-[var(--cricket)]">Logout</button>
    </div>
  </div>`;
}

function renderFooter(){
  return `<div class="text-center text-[10px] text-[var(--chalk-dim)] font-mono mt-10 opacity-60">
    ${State.view.startsWith('admin') ? '' : '<button data-nav="admin-login" class="underline">Admin</button>'}
  </div>`;
}

/* ============================= PUBLIC BOOKING VIEW ============================= */
function renderBookView(){
  const cfg = State.cfg;
  const sport = State.sport;
  const date = State.date;
  const rate = getRate(cfg, State.overrides, date, sport);
  const slots = generateSlots(cfg);
  const dur = cfg.slotDuration/60;
  const perSlotPrice = rate * dur;

  const slotButtons = slots.map(s=>{
    const booked = isSlotBooked(State.bookings, date, sport, s.startMin);
    const blocked = isSlotBlocked(State.blocked, date, sport, s.startMin);
    const selected = State.selectedSlots.some(x=>x.startMin===s.startMin);
    let cls = 'slot rounded-lg px-2 py-3 text-center text-xs';
    if(booked) cls += ' slot-booked';
    else if(blocked) cls += ' slot-blocked';
    else if(selected) cls += ' slot-selected';
    return `<button ${(booked||blocked)?'disabled':''} data-slot="${s.startMin}" class="${cls}">${s.startLabel}</button>`;
  }).join('');

  const total = State.selectedSlots.length * perSlotPrice;
  const advance = total * (cfg.advancePercent/100);
  const balance = total - advance;

  return `
  <div class="grid md:grid-cols-3 gap-6">
    <div class="md:col-span-2 space-y-5">

      <div class="card rounded-xl p-4">
        <div class="flex gap-2 mb-4">
          ${Object.entries(cfg.sports).map(([key,s])=>`
            <button data-sport="${key}" class="font-display uppercase text-sm px-4 py-2 rounded-lg flex-1 ${sport===key?'tab-active':'pill'}">${s.label}</button>
          `).join('')}
        </div>
        <label class="text-xs font-mono text-[var(--chalk-dim)] block mb-1">Select Date</label>
        <input type="date" id="date-input" value="${date}" min="${todayStr()}" class="input-field rounded-lg px-3 py-2 w-full font-mono">
      </div>

      <div class="card rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="font-display uppercase text-sm text-[var(--floodlight)]">Slots — ${fmtDateNice(date)}</div>
          <div class="font-mono text-xs text-[var(--chalk-dim)]">${fmtMoney(rate)}/hr ${isWeekend(date)?'(weekend)':'(weekday)'}</div>
        </div>
        <div class="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-80 overflow-y-auto scrollbar-thin pr-1">
          ${slotButtons || '<div class="col-span-full text-sm text-[var(--chalk-dim)]">No slots configured.</div>'}
        </div>
        <div class="flex gap-4 mt-3 text-[10px] font-mono text-[var(--chalk-dim)]">
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-[var(--turf-light)] inline-block"></span> Available</div>
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded inline-block" style="background:var(--floodlight)"></span> Selected</div>
          <div class="flex items-center gap-1"><span class="w-3 h-3 rounded inline-block" style="background:rgba(230,57,70,0.35)"></span> Booked / Blocked</div>
        </div>
      </div>
    </div>

    <div class="space-y-5">
      <div class="card rounded-xl p-4 sticky top-4">
        <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-3">Booking Summary</div>
        ${State.selectedSlots.length===0 ? `<div class="text-sm text-[var(--chalk-dim)]">Select one or more slots to continue.</div>` : `
          <div class="space-y-1 text-sm font-mono mb-3">
            ${State.selectedSlots.sort((a,b)=>a.startMin-b.startMin).map(s=>`<div class="flex justify-between"><span>${minsToLabel(s.startMin)}</span><span>${fmtMoney(perSlotPrice)}</span></div>`).join('')}
          </div>
          <div class="border-t border-[var(--turf-line)] pt-3 space-y-1 text-sm">
            <div class="flex justify-between"><span>Total</span><span class="font-mono">${fmtMoney(total)}</span></div>
            <div class="flex justify-between text-[var(--floodlight)]"><span>Advance (${cfg.advancePercent}%)</span><span class="font-mono">${fmtMoney(advance)}</span></div>
            <div class="flex justify-between text-[var(--chalk-dim)]"><span>Balance at venue</span><span class="font-mono">${fmtMoney(balance)}</span></div>
          </div>

          <div class="mt-4 space-y-2">
            <input id="cust-name" placeholder="Full name" class="input-field rounded-lg px-3 py-2 w-full text-sm">
            <input id="cust-mobile" placeholder="Mobile number" maxlength="10" class="input-field rounded-lg px-3 py-2 w-full text-sm font-mono">
          </div>
          <div class="mt-4 flex flex-col items-center gap-2">
            <div id="upi-qr" class="bg-white p-2 rounded-lg" style="width:150px; height:150px;"></div>
            <div class="text-[10px] font-mono text-[var(--chalk-dim)] text-center">Scan with any UPI app to pay advance ${fmtMoney(advance)}</div>
          </div>
          <div class="mt-3 text-xs text-[var(--chalk-dim)] bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
            UPI ID: <span class="font-mono text-[var(--chalk)]">${cfg.upiId}</span> · Call <span class="font-mono text-[var(--chalk)]">${cfg.phone}</span><br>Then confirm below once paid.
          </div>
          <button id="confirm-booking" class="btn-glow w-full mt-3 font-display uppercase text-sm py-2.5 rounded-lg" style="background:var(--floodlight); color:#1B1500;">I've Paid — Confirm Booking</button>
          <div id="booking-error" class="text-[var(--cricket)] text-xs mt-2"></div>
        `}
      </div>
    </div>
  </div>`;
}

/* ============================= UPI QR HELPERS ============================= */
function buildUpiLink(cfg, amount, note){
  const enc = encodeURIComponent;
  return `upi://pay?pa=${enc(cfg.upiId||'')}&pn=${enc(cfg.name||'Turf')}&am=${Math.max(1,Math.round(amount))}&cu=INR&tn=${enc(note||'')}`;
}

/** (Re)draws a UPI QR code into the given container element id. Safe to call
 *  every render — clears and redraws so the amount always stays current. */
function renderQrInto(containerId, text, size){
  const el = document.getElementById(containerId);
  if(!el || typeof QRCode === 'undefined') return;
  el.innerHTML = '';
  new QRCode(el, { text, width: size || 140, height: size || 140, correctLevel: QRCode.CorrectLevel.M });
}

function receiptButtons(id, type, downloadLabel){
  return `
    <button data-receipt="${type}" data-mode="download" data-id="${id}" class="pill px-2 py-1 rounded text-[10px] md:text-xs">${downloadLabel}</button>
    <button data-receipt="${type}" data-mode="print" data-id="${id}" class="pill px-2 py-1 rounded text-[10px] md:text-xs">Print</button>
    <button data-receipt="${type}" data-mode="whatsapp" data-id="${id}" class="px-2 py-1 rounded text-[10px] md:text-xs" style="border:1px solid #25D366; color:#25D366;">WhatsApp</button>
  `;
}

/* ============================= CONFIRMED VIEW ============================= */
function renderConfirmedView(){
  const b = State.lastBooking;
  if(!b) return `<div class="card rounded-xl p-6 text-center">No recent booking.</div>`;
  return `
  <div class="card rounded-xl p-6 max-w-md mx-auto text-center">
    <div class="font-display text-xl uppercase text-[var(--floodlight)] mb-1">Booking Confirmed</div>
    <div class="text-xs font-mono text-[var(--chalk-dim)] mb-4">ID: ${b.id}</div>
    <div class="text-left text-sm space-y-1 font-mono mb-4">
      <div class="flex justify-between"><span>Sport</span><span>${State.cfg.sports[b.sport].label}</span></div>
      <div class="flex justify-between"><span>Date</span><span>${fmtDateNice(b.date)}</span></div>
      <div class="flex justify-between"><span>Slots</span><span>${b.slots.map(s=>minsToLabel(s)).join(', ')}</span></div>
      <div class="flex justify-between"><span>Total</span><span>${fmtMoney(b.amount)}</span></div>
      <div class="flex justify-between text-[var(--floodlight)]"><span>Advance Paid</span><span>${fmtMoney(b.advance)}</span></div>
      <div class="flex justify-between text-[var(--chalk-dim)]"><span>Balance</span><span>${fmtMoney(b.amount-b.advance)}</span></div>
    </div>
    <div class="grid grid-cols-3 gap-2 mt-1">
      <button data-receipt="advance" data-mode="download" data-id="${b.id}" class="btn-glow font-display uppercase text-[11px] py-2.5 rounded-lg" style="background:var(--floodlight); color:#1B1500;">Download</button>
      <button data-receipt="advance" data-mode="print" data-id="${b.id}" class="pill font-display uppercase text-[11px] py-2.5 rounded-lg">Print</button>
      <button data-receipt="advance" data-mode="whatsapp" data-id="${b.id}" class="font-display uppercase text-[11px] py-2.5 rounded-lg" style="border:1px solid #25D366; color:#25D366;">WhatsApp</button>
    </div>
    <button data-nav="book" class="w-full mt-2 pill font-display uppercase text-sm py-2.5 rounded-lg">Book Another Slot</button>
  </div>`;
}

/* ============================= LOOKUP VIEW ============================= */
function renderLookupView(){
  const results = State.lookupResults;
  return `
  <div class="card rounded-xl p-6 max-w-lg mx-auto">
    <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-3">Find My Booking</div>
    <div class="flex gap-2">
      <input id="lookup-mobile" placeholder="Registered mobile number" maxlength="10" value="${State.lookupMobile}" class="input-field rounded-lg px-3 py-2 flex-1 text-sm font-mono">
      <button id="lookup-btn" class="pill px-4 rounded-lg font-display uppercase text-sm">Search</button>
    </div>
    ${results ? (results.length===0 ? `<div class="text-sm text-[var(--chalk-dim)] mt-4">No bookings found for this number.</div>` :
      `<div class="mt-4 space-y-3">
        ${results.map(b=>`
          <div class="pill rounded-lg p-3 text-sm">
            <div class="flex justify-between font-mono text-xs text-[var(--chalk-dim)]"><span>${b.id}</span><span>${fmtDateNice(b.date)}</span></div>
            <div class="mt-1">${State.cfg.sports[b.sport].label} · ${(b.slots || []).map(s=>minsToLabel(s)).join(', ')}</div>
            <div class="font-mono text-xs mt-1">Total ${fmtMoney(b.amount)} · Advance ${fmtMoney(b.advance)} · ${b.fullPaid?'Fully Paid':'Balance '+fmtMoney(b.amount-b.advance)}</div>
            <div class="flex flex-wrap gap-1.5 mt-2">
              ${receiptButtons(b.id,'advance','Advance PDF')}
                     
            </div>
            ${b.fullPaid ? `<div class="flex flex-wrap gap-1.5 mt-1.5">${receiptButtons(b.id,'full','Full PDF')}</div>` : `
              <button data-action="due-qr" data-id="${b.id}" class="pill px-3 py-1 rounded text-xs mt-1.5">${State.dueQrId===b.id ? 'Hide' : 'Pay Balance'} — ${fmtMoney(b.amount-b.advance)}</button>
              ${State.dueQrId===b.id ? `
                <div class="flex flex-col items-center gap-2 mt-2">
                  <div id="due-qr-${b.id}" class="bg-white p-2 rounded-lg" style="width:140px; height:140px;"></div>
                  <div class="text-[10px] font-mono text-[var(--chalk-dim)]">Scan to pay balance ${fmtMoney(b.amount-b.advance)}</div>
                </div>` : ''}
            `}
          </div>
        `).join('')}
      </div>`) : ''}
  </div>`;
}

/* ============================= ADMIN LOGIN ============================= */
function renderAdminLogin(){
  return `
  <div class="card rounded-xl p-6 max-w-sm mx-auto">
    <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-3">Admin Login</div>
    <input id="admin-pin" type="password" placeholder="Enter PIN" class="input-field rounded-lg px-3 py-2 w-full text-sm font-mono">
    <div id="admin-login-error" class="text-[var(--cricket)] text-xs mt-2"></div>
    <button id="admin-login-btn" class="btn-glow w-full mt-3 font-display uppercase text-sm py-2.5 rounded-lg" style="background:var(--floodlight); color:#1B1500;">Login</button>
  </div>`;
}

/* ============================= ADMIN VIEW ============================= */
function renderAdminView(){
  const cfg = State.cfg;
  const adate = State.adminDate;
  const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10);
  const dayBookings = State.bookings.filter(b=>b.date===adate && b.status!=='cancelled');
  const tomorrowBookings = State.bookings.filter(b=>b.date===tomorrow && b.status!=='cancelled');

  return `
  <div class="space-y-6">

    ${tomorrowBookings.length>0 ? `
    <div class="card rounded-xl p-4 border-[var(--floodlight)]" style="border-color:var(--floodlight-dim)">
      <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-2">Reminder — Tomorrow's Bookings (${fmtDateNice(tomorrow)})</div>
      <div class="text-xs text-[var(--chalk-dim)] font-mono mb-2">Automatic SMS/WhatsApp isn't wired up in this prototype — call/message these manually 1 day ahead. See note at the bottom of the admin panel for how to automate this.</div>
      <div class="space-y-1 text-sm font-mono">
        ${tomorrowBookings.map(b=>`<div class="flex justify-between"><span>${b.name} · <a class="underline" href="tel:${b.mobile}">${b.mobile}</a></span><span>${State.cfg.sports[b.sport].label} ${(b.slots || []).map(s=>minsToLabel(s)).join(', ')}</span></div>`).join('')}
      </div>
    </div>` : ''}

    <div class="card rounded-xl p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="font-display uppercase text-sm text-[var(--floodlight)]">Bookings</div>
        <div class="text-[10px] font-mono text-[var(--chalk-dim)] max-w-xs text-right">Booked slots are locked on the public page automatically. "Cancel" here frees a slot instantly — or free it directly in the Sheet by deleting that row, or setting its Status cell to "cancelled".</div>
      </div>
      <input type="date" id="admin-date" value="${adate}" class="input-field rounded-lg px-3 py-2 font-mono text-sm mb-3">
      <div class="overflow-x-auto scrollbar-thin">
        <table class="w-full text-xs font-mono">
          <thead><tr class="text-[var(--chalk-dim)] text-left border-b border-[var(--turf-line)]">
            <th class="py-1 pr-3">Sport</th><th class="pr-3">Slots</th><th class="pr-3">Name</th><th class="pr-3">Mobile</th><th class="pr-3">Total</th><th class="pr-3">Advance</th><th class="pr-3">Status</th><th class="pr-3">Actions</th>
          </tr></thead>
          <tbody>
          ${dayBookings.length===0 ? `<tr><td colspan="8" class="py-3 text-[var(--chalk-dim)]">No bookings for this date.</td></tr>` :
            dayBookings.map(b=>`
            <tr class="border-b border-[var(--turf-line)]">
              <td class="py-2 pr-3">${cfg.sports[b.sport].label}</td>
              <td class="pr-3">${(b.slots || []).map(s=>minsToLabel(s)).join(', ')}</td>
              <td class="pr-3">${b.name}</td>
              <td class="pr-3"><a class="underline" href="tel:${b.mobile}">${b.mobile}</a></td>
              <td class="pr-3">${fmtMoney(b.amount)}</td>
              <td class="pr-3">${fmtMoney(b.advance)}</td>
              <td class="pr-3">${b.fullPaid?'<span class="text-[var(--floodlight)]">Full Paid</span>':'Advance Only'}</td>
              <td class="pr-3 flex gap-2 py-2">
                ${!b.fullPaid ? `<button data-action="mark-full" data-id="${b.id}" class="pill px-2 py-1 rounded">Mark Full Paid</button>` : `<button data-action="download-full" data-id="${b.id}" class="pill px-2 py-1 rounded">Receipt</button>`}
                <button data-action="cancel-booking" data-id="${b.id}" class="pill px-2 py-1 rounded text-[var(--cricket)]">Cancel</button>
              </td>
            </tr>
          `).join('')}
          </tbody>
        </table>
      </div>
      <button id="export-csv" class="pill px-3 py-1.5 rounded text-xs mt-3">Export All Bookings (CSV)</button>
    </div>

    <div class="card rounded-xl p-4">
      <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-3">Tariff &amp; Slot Settings</div>
      <div class="grid sm:grid-cols-2 gap-4 text-sm">
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Turf Name</label>
          <input id="cfg-name" value="${cfg.name}" class="input-field rounded-lg px-3 py-2 w-full mt-1">
        </div>
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Advance %</label>
          <input id="cfg-advance" type="number" value="${cfg.advancePercent}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
        </div>
        ${Object.entries(cfg.sports).map(([key,s])=>`
        <div class="pill rounded-lg p-3">
          <div class="font-display uppercase text-xs mb-2">${s.label}</div>
          <label class="text-[10px] font-mono text-[var(--chalk-dim)]">Weekday rate / hr</label>
          <input data-sportkey="${key}" data-field="weekday" class="cfg-sport input-field rounded-lg px-3 py-2 w-full mt-1 font-mono" type="number" value="${s.weekday}">
          <label class="text-[10px] font-mono text-[var(--chalk-dim)] mt-2 block">Weekend rate / hr</label>
          <input data-sportkey="${key}" data-field="weekend" class="cfg-sport input-field rounded-lg px-3 py-2 w-full mt-1 font-mono" type="number" value="${s.weekend}">
        </div>`).join('')}
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Slot Duration (mins)</label>
          <input id="cfg-duration" type="number" value="${cfg.slotDuration}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
        </div>
        <div class="flex gap-2">
          <div class="flex-1">
            <label class="text-xs font-mono text-[var(--chalk-dim)]">Open Hour (0-23)</label>
            <input id="cfg-start" type="number" value="${cfg.dayStart}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
          </div>
          <div class="flex-1">
            <label class="text-xs font-mono text-[var(--chalk-dim)]">Close Hour (0-23)</label>
            <input id="cfg-end" type="number" value="${cfg.dayEnd}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
          </div>
        </div>
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">UPI ID for advance</label>
          <input id="cfg-upi" value="${cfg.upiId}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
        </div>
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Contact Phone</label>
          <input id="cfg-phone" value="${cfg.phone}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
        </div>
        <div class="sm:col-span-2">
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Address</label>
          <input id="cfg-address" value="${cfg.address || ''}" class="input-field rounded-lg px-3 py-2 w-full mt-1">
        </div>
        <div>
          <label class="text-xs font-mono text-[var(--chalk-dim)]">Change Admin PIN</label>
          <input id="cfg-pin" value="${cfg.adminPin}" class="input-field rounded-lg px-3 py-2 w-full mt-1 font-mono">
        </div>
      </div>
      <button id="save-cfg" class="btn-glow mt-4 font-display uppercase text-sm px-4 py-2 rounded-lg" style="background:var(--floodlight); color:#1B1500;">Save Settings</button>
      <span id="save-cfg-msg" class="text-xs text-[var(--floodlight)] ml-3"></span>
    </div>

    <div class="card rounded-xl p-4">
      <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-3">Block / Unblock Slots (maintenance, season hold)</div>
      <div class="flex flex-wrap gap-2 mb-3">
        <input type="date" id="block-date" value="${adate}" class="input-field rounded-lg px-3 py-2 font-mono text-sm">
        <select id="block-sport" class="input-field rounded-lg px-3 py-2 font-mono text-sm">
          ${Object.entries(cfg.sports).map(([k,s])=>`<option value="${k}">${s.label}</option>`).join('')}
        </select>
      </div>
      <div id="block-grid" class="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto scrollbar-thin"></div>
    </div>

    <div class="card rounded-xl p-4 text-xs text-[var(--chalk-dim)] leading-relaxed">
      <div class="font-display uppercase text-sm text-[var(--floodlight)] mb-2">Backend status</div>
      ${API_URL ? `
      • Connected to your Google Sheet — every booking, tariff edit, and block/unblock writes straight to it.<br>
      • Daily reminders run automatically once you've run <span class="font-mono">setupDailyTrigger</span> in the Apps Script editor (see SETUP.md).
      ` : `
      • <span class="text-[var(--cricket)]">No Sheet connected yet</span> — this is running on the page's own built-in storage. Set <span class="font-mono">API_URL</span> near the top of the script to your deployed Apps Script Web App URL to make Google Sheets the live database and turn on real reminders. Full steps are in SETUP.md.
      `}<br>
      • Advance "payment" is confirmed by the customer clicking a button after paying you via UPI/cash — there's no payment gateway wired in. For automatic verification, Razorpay or PayU can be added later.
    </div>
  </div>`;
}

/* ============================= HANDLERS ============================= */
function attachHandlers(){
  document.querySelectorAll('[data-nav]').forEach(el=>{
    el.onclick = ()=>{ State.view = el.dataset.nav; if(State.view==='book'){ State.selectedSlots=[]; } render(); };
  });
  const logoutBtn = document.querySelector('[data-action="logout"]');
  if(logoutBtn) logoutBtn.onclick = ()=>{ State.adminAuthed=false; State.view='book'; render(); };

  if(State.view==='book'){
    document.querySelectorAll('[data-sport]').forEach(el=>{
      el.onclick = ()=>{ State.sport = el.dataset.sport; State.selectedSlots=[]; render(); };
    });
    const dateInput = document.getElementById('date-input');
    if(dateInput) dateInput.onchange = (e)=>{ State.date = e.target.value; State.selectedSlots=[]; render(); };

    document.querySelectorAll('[data-slot]').forEach(el=>{
      el.onclick = ()=>{
        const startMin = parseInt(el.dataset.slot);
        const idx = State.selectedSlots.findIndex(x=>x.startMin===startMin);
        if(idx>=0) State.selectedSlots.splice(idx,1);
        else State.selectedSlots.push({startMin});
        render();
      };
    });

    const confirmBtn = document.getElementById('confirm-booking');
    if(confirmBtn) confirmBtn.onclick = handleConfirmBooking;

    if(document.getElementById('upi-qr') && State.selectedSlots.length > 0){
      const rate = getRate(State.cfg, State.overrides, State.date, State.sport);
      const perSlotPrice = rate * (State.cfg.slotDuration/60);
      const advanceAmt = State.selectedSlots.length * perSlotPrice * (State.cfg.advancePercent/100);
      renderQrInto('upi-qr', buildUpiLink(State.cfg, advanceAmt, `Advance-${State.sport}-${State.date}`), 150);
    }
  }

  if(State.view==='lookup'){
    const btn = document.getElementById('lookup-btn');
    if(btn) btn.onclick = async ()=>{
      const mob = document.getElementById('lookup-mobile').value.trim();
      State.lookupMobile = mob;
      await refreshData();
      State.lookupResults = State.bookings.filter(b=>b.mobile===mob && b.status!=='cancelled');
      State.dueQrId = null;
      render();
    };
    if(State.lookupResults){
      State.lookupResults.forEach(b=>{
        if(State.dueQrId===b.id){
          renderQrInto('due-qr-'+b.id, buildUpiLink(State.cfg, b.amount-b.advance, `Balance-${b.id}`), 140);
        }
      });
    }
  }

  document.querySelectorAll('[data-action="due-qr"]').forEach(el=>{
    el.onclick = ()=>{
      State.dueQrId = (State.dueQrId === el.dataset.id) ? null : el.dataset.id;
      render();
    };
  });

  document.querySelectorAll('[data-receipt]').forEach(el=>{
    el.onclick = ()=>{
      const id = el.dataset.id, type = el.dataset.receipt, mode = el.dataset.mode;
      const b = State.bookings.find(x=>x.id===id) || (State.lastBooking && State.lastBooking.id===id ? State.lastBooking : null);
      if(!b) return;
      if(mode==='download') downloadReceipt(b, type);
      else if(mode==='print') printReceipt(b, type);
      else if(mode==='whatsapp') shareReceiptWhatsApp(b, type);
    };
  });

  if(State.view==='admin-login'){
    const btn = document.getElementById('admin-login-btn');
    const pinInput = document.getElementById('admin-pin');
    const tryLogin = ()=>{
      const entered = String(pinInput.value || '').trim();
      const actual = String(State.cfg.adminPin || '').trim();
      if(entered && entered === actual){ State.adminPin = entered; State.adminAuthed=true; State.view='admin'; render(); }
      else document.getElementById('admin-login-error').textContent = 'Incorrect PIN.';
    };
    if(btn) btn.onclick = tryLogin;
    if(pinInput) pinInput.onkeydown = (e)=>{ if(e.key==='Enter') tryLogin(); };
  }

  if(State.view==='admin'){
    if(!State.adminAuthed){ State.view='admin-login'; render(); return; }
    const adminDate = document.getElementById('admin-date');
    if(adminDate) adminDate.onchange = (e)=>{ State.adminDate = e.target.value; render(); };

    document.querySelectorAll('[data-action="mark-full"]').forEach(el=>{
      el.onclick = async ()=>{
        try{ await Backend.markFullPaid(el.dataset.id, State.adminPin); State.dueQrId = null; await refreshData(); render(); }
        catch(err){ alert(err.message); }
      };
    });
    document.querySelectorAll('[data-action="cancel-booking"]').forEach(el=>{
      el.onclick = async ()=>{
        if(!confirm('Cancel this booking and release the slot?')) return;
        try{ await Backend.cancelBooking(el.dataset.id, State.adminPin); State.dueQrId = null; await refreshData(); render(); }
        catch(err){ alert(err.message); }
      };
    });
    if(State.dueQrId){
      const b = State.bookings.find(x=>x.id===State.dueQrId);
      if(b) renderQrInto('due-qr-'+b.id, buildUpiLink(State.cfg, b.amount-b.advance, `Balance-${b.id}`), 140);
    }
    const exportBtn = document.getElementById('export-csv');
    if(exportBtn) exportBtn.onclick = exportCSV;

    const saveCfgBtn = document.getElementById('save-cfg');
    if(saveCfgBtn) saveCfgBtn.onclick = handleSaveConfig;

    renderBlockGrid();
    const blockDate = document.getElementById('block-date');
    const blockSport = document.getElementById('block-sport');
    if(blockDate) blockDate.onchange = renderBlockGrid;
    if(blockSport) blockSport.onchange = renderBlockGrid;
  }
}

function renderBlockGrid(){
  const grid = document.getElementById('block-grid');
  if(!grid) return;
  const date = document.getElementById('block-date').value;
  const sport = document.getElementById('block-sport').value;
  const slots = generateSlots(State.cfg);
  grid.innerHTML = slots.map(s=>{
    const booked = isSlotBooked(State.bookings, date, sport, s.startMin);
    const blocked = isSlotBlocked(State.blocked, date, sport, s.startMin);
    let cls = 'slot rounded-lg px-2 py-2 text-center text-[10px]';
    if(booked) cls += ' slot-booked';
    else if(blocked) cls += ' slot-selected';
    return `<button ${booked?'disabled':''} data-blockslot="${s.startMin}" class="${cls}">${s.startLabel}</button>`;
  }).join('');
  grid.querySelectorAll('[data-blockslot]').forEach(el=>{
    el.onclick = async ()=>{
      const startMin = parseInt(el.dataset.blockslot);
      try{
        await Backend.toggleBlock(date, sport, startMin, State.adminPin);
        await refreshData();
        renderBlockGrid();
      }catch(err){ alert(err.message); }
    };
  });
}

async function handleConfirmBooking(){
  const name = document.getElementById('cust-name').value.trim();
  const mobile = document.getElementById('cust-mobile').value.trim();
  const errBox = document.getElementById('booking-error');
  errBox.textContent='';
  if(!name){ errBox.textContent='Please enter your name.'; return; }
  if(!/^[6-9]\d{9}$/.test(mobile)){ errBox.textContent='Please enter a valid 10-digit mobile number.'; return; }
  if(State.selectedSlots.length===0){ errBox.textContent='Select at least one slot.'; return; }

  await refreshData();
  const cfg = State.cfg;
  for(const s of State.selectedSlots){
    if(isSlotBooked(State.bookings, State.date, State.sport, s.startMin) || isSlotBlocked(State.blocked, State.date, State.sport, s.startMin)){
      errBox.textContent = 'Sorry, one of the selected slots was just taken. Please re-select.';
      State.selectedSlots = [];
      render();
      return;
    }
  }

  const rate = getRate(cfg, State.overrides, State.date, State.sport);
  const perSlotPrice = rate * (cfg.slotDuration/60);
  const amount = State.selectedSlots.length * perSlotPrice;
  const advance = amount * (cfg.advancePercent/100);

  const booking = {
    id: 'TF' + Date.now().toString(36).toUpperCase(),
    date: State.date,
    sport: State.sport,
    slots: State.selectedSlots.map(s=>s.startMin).sort((a,b)=>a-b),
    startMin: State.selectedSlots[0].startMin, // for per-slot conflict lookups
    name, mobile,
    amount, advance,
    fullPaid: false,
    status: 'confirmed',
    createdAt: new Date().toISOString()
  };
  try{
    await Backend.addBooking(booking);
  }catch(err){
    errBox.textContent = err.message === 'slot_taken'
      ? 'Sorry, one of the selected slots was just taken. Please re-select.'
      : 'Something went wrong — please try again.';
    State.selectedSlots = [];
    await refreshData();
    render();
    return;
  }

  State.lastBooking = booking;
  State.selectedSlots = [];
  State.view = 'confirmed';
  render();
}

async function handleSaveConfig(){
  const cfg = {...State.cfg};
  cfg.name = document.getElementById('cfg-name').value.trim() || cfg.name;
  cfg.advancePercent = parseFloat(document.getElementById('cfg-advance').value) || cfg.advancePercent;
  cfg.slotDuration = parseInt(document.getElementById('cfg-duration').value) || cfg.slotDuration;
  cfg.dayStart = parseInt(document.getElementById('cfg-start').value);
  cfg.dayEnd = parseInt(document.getElementById('cfg-end').value);
  cfg.upiId = document.getElementById('cfg-upi').value.trim();
  cfg.phone = document.getElementById('cfg-phone').value.trim();
  cfg.address = document.getElementById('cfg-address').value.trim();
  cfg.printWidth = document.getElementById('cfg-printwidth').value;
  const newPin = document.getElementById('cfg-pin').value.trim() || cfg.adminPin;
  cfg.adminPin = newPin;
  document.querySelectorAll('.cfg-sport').forEach(el=>{
    const key = el.dataset.sportkey, field = el.dataset.field;
    cfg.sports[key][field] = parseFloat(el.value) || cfg.sports[key][field];
  });
  const msgEl = document.getElementById('save-cfg-msg');
  try{
    const saved = await Backend.saveConfig(cfg, State.adminPin);
    State.cfg = saved || cfg;
    State.adminPin = newPin; // keep session authenticated if PIN was just changed
    msgEl.textContent = 'Saved.';
    setTimeout(()=>render(), 600);
  }catch(err){
    msgEl.textContent = 'Error: ' + err.message;
  }
}

async function exportCSV(){
  await refreshData();
  const rows = [['Booking ID','Date','Sport','Slot Start','Name','Mobile','Amount','Advance','Full Paid','Status','Created']];
  // dedupe by id+startMin already unique rows
  const seen = new Set();
  State.bookings.forEach(b=>{
    const key = b.id+b.startMin;
    if(seen.has(key)) return; seen.add(key);
    rows.push([b.id,b.date,State.cfg.sports[b.sport].label,minsToLabel(b.startMin),b.name,b.mobile,b.amount,b.advance,b.fullPaid?'Yes':'No',b.status,b.createdAt]);
  });
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'turf-bookings.csv'; a.click();
  URL.revokeObjectURL(url);
}

function buildReceiptDoc(b, type){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const cfg = State.cfg;
  doc.setFont('helvetica','bold'); doc.setFontSize(18);
  doc.text(cfg.name, 20, 20);
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(type==='advance' ? 'ADVANCE PAYMENT RECEIPT' : 'FULL PAYMENT RECEIPT', 20, 28);
  doc.setDrawColor(180); doc.line(20,32,190,32);

  let y = 42;
  const line = (label,val)=>{ doc.setFont('helvetica','bold'); doc.text(label,20,y); doc.setFont('helvetica','normal'); doc.text(String(val),80,y); y+=8; };
  line('Receipt No:', b.id);
  line('Date of Play:', fmtDateNice(b.date));
  line('Sport:', cfg.sports[b.sport].label);
  line('Slot(s):', b.slots.map(s=>minsToLabel(s)).join(', '));
  line('Customer Name:', b.name);
  line('Mobile:', b.mobile);
  line('Total Amount:', fmtMoney(b.amount));
  line('Advance Paid:', fmtMoney(b.advance));
  if(type==='full'){
    line('Balance Paid:', fmtMoney(b.amount-b.advance));
    line('Payment Status:', 'FULLY PAID');
  } else {
    line('Balance Due at Venue:', fmtMoney(b.amount-b.advance));
    line('Payment Status:', 'ADVANCE CONFIRMED');
  }
  line('Issued On:', new Date().toLocaleString('en-IN'));

  y += 6; doc.setDrawColor(220); doc.line(20,y,190,y); y+=10;
  doc.setFontSize(9); doc.setTextColor(120);
  doc.text('Thank you for booking with ' + cfg.name + '. Please carry this receipt to the venue.', 20, y);

  return doc;
}

function receiptFileName(b, type){ return `${b.id}-${type}-receipt.pdf`; }

function downloadReceipt(b, type){
  buildReceiptDoc(b, type).save(receiptFileName(b, type));
}

/** Builds a plain HTML receipt sized for a thermal roll (58mm or 80mm,
 *  per cfg.printWidth) instead of an A4 PDF — this is what most thermal
 *  printers expect when printed through the normal browser print dialog. */
function thermalReceiptHTML(b, type){
  const cfg = State.cfg;
  const width = cfg.printWidth || '80mm';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const rows = [
    ['Receipt No', b.id],
    ['Date', fmtDateNice(b.date)],
    ['Sport', cfg.sports[b.sport].label],
    ['Slot(s)', b.slots.map(s=>minsToLabel(s)).join(', ')],
    ['Name', b.name],
    ['Mobile', b.mobile]
  ];
  const amountRows = type==='full'
    ? [['Total', fmtMoney(b.amount)], ['Advance Paid', fmtMoney(b.advance)], ['Balance Paid', fmtMoney(b.amount-b.advance)], ['Status', 'FULLY PAID']]
    : [['Total', fmtMoney(b.amount)], ['Advance Paid', fmtMoney(b.advance)], ['Balance Due', fmtMoney(b.amount-b.advance)], ['Status', 'ADVANCE CONFIRMED']];

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(b.id)}</title>
  <style>
    @page{ size:${width} auto; margin:3mm; }
    *{ box-sizing:border-box; }
    body{ font-family:'Courier New',monospace; width:${width}; margin:0; padding:0; color:#000; font-size:12px; }
    .center{ text-align:center; }
    .bold{ font-weight:700; }
    .big{ font-size:15px; }
    .line{ border-top:1px dashed #000; margin:6px 0; }
    table{ width:100%; border-collapse:collapse; }
    td{ padding:1px 0; font-size:11.5px; vertical-align:top; }
    td.val{ text-align:right; }
    .foot{ font-size:10px; margin-top:8px; }
  </style></head>
  <body onload="window.print(); setTimeout(function(){ window.close(); }, 300);">
    <div class="center bold big">${esc(cfg.name)}</div>
    ${cfg.address ? `<div class="center" style="font-size:10px;">${esc(cfg.address)}</div>` : ''}
    ${cfg.phone ? `<div class="center" style="font-size:10px;">${esc(cfg.phone)}</div>` : ''}
    <div class="line"></div>
    <div class="center bold">${type==='full' ? 'FULL PAYMENT RECEIPT' : 'ADVANCE RECEIPT'}</div>
    <div class="line"></div>
    <table>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td class="val">${esc(r[1])}</td></tr>`).join('')}</table>
    <div class="line"></div>
    <table>${amountRows.map(r=>`<tr><td class="bold">${esc(r[0])}</td><td class="val bold">${esc(r[1])}</td></tr>`).join('')}</table>
    <div class="line"></div>
    <div class="center foot">Thank you for booking with ${esc(cfg.name)}!<br>Please carry this receipt to the venue.</div>
    <div class="center foot">Issued: ${esc(new Date().toLocaleString('en-IN'))}</div>
  </body></html>`;
}

/** Opens the thermal-formatted receipt in a small popup and triggers print
 *  immediately — pick your thermal printer in the print dialog that opens. */
function printReceipt(b, type){
  const html = thermalReceiptHTML(b, type);
  const w = window.open('', '_blank', 'width=380,height=600');
  if(!w){ alert('Please allow pop-ups for this site to print the receipt.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function receiptSummaryText(b, type){
  const cfg = State.cfg;
  const lines = [
    `${cfg.name} — ${type==='full' ? 'Full Payment' : 'Advance'} Receipt`,
    `Booking ID: ${b.id}`,
    `Date: ${fmtDateNice(b.date)}`,
    `Sport: ${cfg.sports[b.sport].label}`,
    `Slot(s): ${b.slots.map(s=>minsToLabel(s)).join(', ')}`,
    `Total: ${fmtMoney(b.amount)}`
  ];
  if(type==='full') lines.push('Status: Fully Paid');
  else lines.push(`Advance Paid: ${fmtMoney(b.advance)} · Balance due at venue: ${fmtMoney(b.amount-b.advance)}`);
  return lines.join('\n');
}

/** Tries the native share sheet with the PDF attached (works on most mobile
 *  browsers, including sharing straight into WhatsApp). If the browser can't
 *  share files, falls back to downloading the PDF and opening a pre-filled
 *  WhatsApp chat with the summary text — WhatsApp links can't attach a file
 *  directly, so the PDF has to be attached manually in that fallback case. */
async function shareReceiptWhatsApp(b, type){
  const doc = buildReceiptDoc(b, type);
  const fileName = receiptFileName(b, type);
  const summary = receiptSummaryText(b, type);

  try{
    const blob = doc.output('blob');
    const file = new File([blob], fileName, { type: 'application/pdf' });
    if(navigator.canShare && navigator.canShare({ files: [file] })){
      await navigator.share({ files: [file], title: fileName, text: summary });
      return;
    }
  }catch(e){ /* user cancelled or sharing unsupported — fall through */ }

  doc.save(fileName);
  const waUrl = 'https://wa.me/?text=' + encodeURIComponent(summary + '\n\n(PDF downloaded — attach it in the chat)');
  window.open(waUrl, '_blank');
}

init();