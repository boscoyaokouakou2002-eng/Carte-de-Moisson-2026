"use strict";

/* ================= CONFIG ================= */
var BUILDINGS = ["A","B","C","D","E","F","G","H","J","K","L","M","N","P","R","T"];
var ROOM_COUNT = { B:64 };
function roomCount(b){ return ROOM_COUNT[b] || 96; }

var supabase = null;
function initSupabaseClient(){
  if (supabase) return true;
  if (window.SUPABASE_CONFIG && window.supabase &&
      window.SUPABASE_CONFIG.url.indexOf("VOTRE-PROJET") === -1) {
    supabase = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    return true;
  }
  return false;
}
initSupabaseClient();

/* ================= STATE ================= */
var state = {
  user: null,
  rooms: {},          // id "B-27" -> room object
  pendingCount: 0,
  online: navigator.onLine,
  syncing: false,
  lastError: null,
  tab: "dashboard",
  route: null,
  filter: "all",
  search: "",
  lastSync: null
};

function defaultRoom(building, number){
  return {
    id: building + "-" + number, building: building, number: number,
    s1: { r:false, by:null, at:null },
    s2: { r:false, by:null, at:null },
    history: [], updated_at: null
  };
}
function getRoom(b, n){
  var id = b + "-" + n;
  return state.rooms[id] || defaultRoom(b, n);
}
function roomStatus(room){
  var c = (room.s1.r?1:0) + (room.s2.r?1:0);
  if(c===2) return "green";
  if(c===1) return "amber";
  return "red";
}

/* ================= INDEXEDDB (local, offline-first store) ================= */
var DB_NAME = "moisson-db", DB_VERSION = 1;
var idb = null;

function openDb(){
  return new Promise(function(resolve, reject){
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e){
      var db = e.target.result;
      if(!db.objectStoreNames.contains("rooms")) db.createObjectStore("rooms", { keyPath:"id" });
      if(!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath:"qid" });
      if(!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath:"key" });
    };
    req.onsuccess = function(e){ idb = e.target.result; resolve(idb); };
    req.onerror = function(e){ reject(e); };
  });
}
function idbTx(store, mode){ return idb.transaction(store, mode).objectStore(store); }
function idbGetAll(store){
  return new Promise(function(resolve){
    var out = [];
    var req = idbTx(store, "readonly").openCursor();
    req.onsuccess = function(e){
      var cur = e.target.result;
      if(cur){ out.push(cur.value); cur.continue(); } else resolve(out);
    };
    req.onerror = function(){ resolve(out); };
  });
}
function idbPut(store, value){
  return new Promise(function(resolve){
    var req = idbTx(store, "readwrite").put(value);
    req.onsuccess = function(){ resolve(); };
    req.onerror = function(){ resolve(); };
  });
}
function idbDelete(store, key){
  return new Promise(function(resolve){
    var req = idbTx(store, "readwrite").delete(key);
    req.onsuccess = function(){ resolve(); };
    req.onerror = function(){ resolve(); };
  });
}
function idbGet(store, key){
  return new Promise(function(resolve){
    var req = idbTx(store, "readonly").get(key);
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ resolve(null); };
  });
}

/* ================= USER PROFILE (local only, simple identity) ================= */
function loadUser(){
  return idbGet("meta", "user").then(function(row){
    if(row) state.user = row.value;
  });
}
function saveUser(name){
  state.user = { name: name };
  return idbPut("meta", { key:"user", value: state.user });
}

/* ================= LOAD LOCAL DATA FIRST (instant, offline-capable) ================= */
function loadLocalRooms(){
  return idbGetAll("rooms").then(function(rows){
    rows.forEach(function(r){ state.rooms[r.id] = r; });
  });
}
function loadQueueCount(){
  return idbGetAll("queue").then(function(rows){ state.pendingCount = rows.length; });
}

/* ================= SYNC UI ================= */
function setSyncUI(status, text){
  var dot = document.getElementById("syncDot");
  var txt = document.getElementById("syncText");
  if(!dot) return;
  dot.className = "dot " + status;
  txt.textContent = text;
}
function updateSyncPill(){
  if(!supabase){
    if(!window.SUPABASE_CONFIG || window.SUPABASE_CONFIG.url.indexOf("VOTRE-PROJET")!==-1){
      setSyncUI("amber", "Config Supabase manquante");
    } else if(!window.supabase){
      setSyncUI("amber", "Librairie non chargée");
    } else {
      setSyncUI("amber", "Mode local");
    }
    return;
  }
  if(!state.online){ setSyncUI("red", "Hors connexion"); return; }
  if(state.pendingCount>0){ setSyncUI("amber", "Sync… (" + state.pendingCount + ")"); return; }
  if(state.lastError){ setSyncUI("err", "Erreur de synchronisation"); return; }
  setSyncUI("green", "Synchronisé");
}

/* ================= REMOTE SYNC (Supabase) ================= */

/* pull rooms changed since last sync, merge into local store */
function pullFromServer(){
  if(!supabase) return Promise.resolve();
  var since = state.lastSync || "1970-01-01T00:00:00Z";
  return supabase.from("rooms").select("*").gt("updated_at", since)
    .then(function(res){
      if(res.error) throw res.error;
      var rows = res.data || [];
      var promises = rows.map(function(row){
        var room = remoteRowToRoom(row);
        state.rooms[room.id] = room;
        return idbPut("rooms", room);
      });
      return Promise.all(promises);
    }).then(function(){
      state.lastSync = new Date().toISOString();
      return idbPut("meta", { key:"lastSync", value: state.lastSync });
    });
}

function remoteRowToRoom(row){
  var existing = state.rooms[row.id] || defaultRoom(row.building, row.number);
  return {
    id: row.id, building: row.building, number: row.number,
    s1: { r: !!row.student1_reached, by: row.student1_by, at: row.student1_at },
    s2: { r: !!row.student2_reached, by: row.student2_by, at: row.student2_at },
    history: existing.history || [],
    updated_at: row.updated_at
  };
}

/* subscribe to live changes from other users while online */
function subscribeRealtime(){
  if(!supabase) return;
  supabase.channel("rooms-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"rooms" }, function(payload){
      if(payload.new){
        var room = remoteRowToRoom(payload.new);
        state.rooms[room.id] = room;
        idbPut("rooms", room);
        if(state.tab!=="room") render();
      }
    })
    .subscribe();
}

/* push one queued change to Supabase (column-level update = safe against
   concurrent edits to the OTHER student in the same room) */
function pushChange(change){
  var colReached = change.studentKey==="s1" ? "student1_reached" : "student2_reached";
  var colBy = change.studentKey==="s1" ? "student1_by" : "student2_by";
  var colAt = change.studentKey==="s1" ? "student1_at" : "student2_at";

  var payload = { id: change.roomId, building: change.building, number: change.number, updated_at: new Date().toISOString() };
  payload[colReached] = change.reached;
  payload[colBy] = change.by;
  payload[colAt] = change.at;

  return supabase.from("rooms").upsert(payload, { onConflict:"id" }).then(function(res){
    if(res.error) throw res.error;
    return supabase.from("visits").insert({
      room_id: change.roomId, student: change.studentKey==="s1"?1:2,
      action: change.reached ? "atteint" : "annulé", by_name: change.by, at: change.at
    });
  });
}

function processQueue(){
  if(!supabase || state.syncing) return Promise.resolve();
  state.syncing = true;
  return idbGetAll("queue").then(function(items){
    items.sort(function(a,b){ return a.qid.localeCompare(b.qid); });
    return items.reduce(function(chain, item){
      return chain.then(function(){
        return pushChange(item).then(function(){
          return idbDelete("queue", item.qid);
        });
      });
    }, Promise.resolve());
  }).then(function(){
    state.lastError = null;
    return loadQueueCount();
  }).catch(function(err){
    state.lastError = err;
  }).then(function(){
    state.syncing = false;
    updateSyncPill();
    render();
  });
}

window.addEventListener("online", function(){ state.online = true; updateSyncPill(); pullFromServer().then(processQueue).then(render); });
window.addEventListener("offline", function(){ state.online = false; updateSyncPill(); });
setInterval(function(){
  state.online = navigator.onLine;
  if(!supabase) initSupabaseClient(); // réessaie si le script Supabase a fini de charger en retard
  if(state.online && supabase){ pullFromServer().then(processQueue).then(render); }
  updateSyncPill();
}, 15000);

/* ================= APPLY A CHANGE (optimistic local write + queue) ================= */
function applyRoomChange(building, number, studentKey, reached){
  var id = building + "-" + number;
  var room = getRoom(building, number);
  var now = new Date().toISOString();
  var by = state.user ? state.user.name : "Inconnu";

  room[studentKey] = { r: reached, by: by, at: now };
  room.history = room.history || [];
  room.history.unshift({ student: studentKey, action: reached?"atteint":"annulé", by: by, at: now });
  if(room.history.length>50) room.history = room.history.slice(0,50);
  room.updated_at = now;
  state.rooms[id] = room;

  var change = {
    qid: now + "-" + Math.random().toString(36).slice(2,7),
    roomId: id, building: building, number: number,
    studentKey: studentKey, reached: reached, by: by, at: now
  };

  idbPut("rooms", room);
  idbPut("queue", change).then(function(){
    state.pendingCount++;
    updateSyncPill();
    render();
    if(state.online) processQueue();
  });
}

/* ================= STATS ================= */
function computeStats(){
  var totalRooms=0, green=0, amber=0, red=0, studentsReached=0, studentsTotal=0;
  var perBuilding = {};
  BUILDINGS.forEach(function(b){
    var rc = roomCount(b), bGreen=0;
    for(var i=1;i<=rc;i++){
      var st = roomStatus(getRoom(b,i));
      if(st==="green"){ green++; bGreen++; } else if(st==="amber") amber++; else red++;
      studentsTotal += 2;
      var room = getRoom(b,i);
      if(room.s1.r) studentsReached++;
      if(room.s2.r) studentsReached++;
    }
    totalRooms += rc;
    perBuilding[b] = { pct: rc? Math.round(bGreen/rc*100):0 };
  });
  return { totalRooms:totalRooms, green:green, amber:amber, red:red,
    studentsReached:studentsReached, studentsTotal:studentsTotal, perBuilding:perBuilding };
}
function pct(n,d){ return d? Math.round(n/d*100) : 0; }

/* ================= TOAST ================= */
var toastTimer;
function toast(msg){
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove("show"); }, 1800);
}

/* ================= RENDER ================= */
var app = document.getElementById("app");

function render(){
  document.getElementById("userSub").textContent = state.user ? ("Frère " + state.user.name) : "INP-HB Centre";
  document.querySelectorAll("nav.bottom .tab").forEach(function(t){
    t.classList.toggle("active", t.dataset.tab===state.tab);
  });
  if(!state.user){ renderNameModal(); return; }

  if(state.route && state.route.view==="building") return renderBuildingView(state.route.b);
  if(state.route && state.route.view==="room") return renderRoomView(state.route.b, state.route.n);

  if(state.tab==="dashboard") return renderDashboard();
  if(state.tab==="buildings") return renderBuildings();
  if(state.tab==="remaining") return renderRemaining();
  if(state.tab==="stats") return renderStats();
  if(state.tab==="admin") return renderAdmin();
}

function renderNameModal(){
  if(document.getElementById("nameModal")) return;
  var wrap = document.createElement("div");
  wrap.className = "modal-bg"; wrap.id = "nameModal";
  wrap.innerHTML =
    '<div class="modal"><h3>Bienvenue 🙏</h3>' +
    '<p class="muted">Indique ton prénom et nom pour associer tes visites.</p>' +
    '<input id="nameInput" placeholder="Ex. Yao Bosco KOUAKOU" />' +
    '<button class="btn block" style="margin-top:12px" id="nameBtn">Commencer</button></div>';
  document.body.appendChild(wrap);
  var input = wrap.querySelector("#nameInput");
  wrap.querySelector("#nameBtn").onclick = function(){
    var v = input.value.trim();
    if(!v){ input.focus(); return; }
    saveUser(v).then(function(){ document.body.removeChild(wrap); render(); });
  };
}

function statBox(n,l){ return '<div class="stat-box"><div class="n">'+n+'</div><div class="l">'+l+'</div></div>'; }

function renderDashboard(){
  var s = computeStats();
  var p = pct(s.green, s.totalRooms);
  app.innerHTML =
  '<div class="card"><div class="big-progress">' +
    '<div class="ring" style="--pct:'+p+'"><span>'+p+'%</span></div>' +
    '<div><h2 style="font-size:16px">Couverture globale</h2>' +
    '<div class="muted">'+s.green+' / '+s.totalRooms+' chambres complètement visitées</div></div></div>' +
    '<div class="stat-grid">' + statBox(s.totalRooms,"Chambres totales") + statBox(s.green,"Complètes 🟢") +
    statBox(s.amber,"Partielles 🟡") + statBox(s.red,"Non visitées 🔴") + '</div>' +
    '<div style="margin-top:10px" class="muted">Étudiants atteints</div>' +
    '<div class="bar-wrap"><div class="bar-fill" style="width:'+pct(s.studentsReached,s.studentsTotal)+'%"></div></div>' +
    '<div class="muted">'+s.studentsReached+' / '+s.studentsTotal+'</div></div>' +
  '<button class="btn block" id="nextRoomBtn">➡️ Chambre suivante à évangéliser</button><div style="height:10px"></div>' +
  '<div class="card"><h3 style="font-size:14px">Actions rapides</h3>' +
  '<div style="display:flex; gap:8px; margin-top:8px">' +
  '<button class="btn secondary sm" data-tab="buildings">Voir bâtiments</button>' +
  '<button class="btn secondary sm" data-tab="remaining">Chambres restantes</button></div></div>';
  app.querySelector("#nextRoomBtn").onclick = goNextRoom;
  app.querySelectorAll("[data-tab]").forEach(function(b){ b.onclick = function(){ state.tab=b.dataset.tab; state.route=null; render(); }; });
}

function goNextRoom(){
  for(var pass=0; pass<2; pass++){
    for(var bi=0; bi<BUILDINGS.length; bi++){
      var b = BUILDINGS[bi], rc = roomCount(b);
      for(var i=1;i<=rc;i++){
        var st = roomStatus(getRoom(b,i));
        if(pass===0 && st==="red"){ openRoom(b,i); return; }
        if(pass===1 && st==="amber"){ openRoom(b,i); return; }
      }
    }
  }
  toast("Toutes les chambres sont complètement visitées 🎉");
}

function renderBuildings(){
  var s = computeStats();
  var html = '<div class="card"><h3 style="font-size:14px">Bâtiments</h3><div class="bld-grid" style="margin-top:8px">';
  BUILDINGS.forEach(function(b){
    var p = s.perBuilding[b].pct;
    var dotColor = p===100 ? "var(--green)" : (p===0 ? "var(--red)" : "var(--amber)");
    html += '<div class="bld-cell" data-b="'+b+'"><div class="ring-mini" style="background:'+dotColor+'"></div>'+b+'<small>'+p+'%</small></div>';
  });
  html += '</div></div>';
  app.innerHTML = html;
  app.querySelectorAll(".bld-cell").forEach(function(c){ c.onclick = function(){ openBuilding(c.dataset.b); }; });
}

function openBuilding(b){ state.route = { view:"building", b:b }; render(); }
function openRoom(b,n){ state.route = { view:"room", b:b, n:n }; render(); }
function closeRoute(){ state.route = null; render(); }

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function chip(f,label){ return '<div class="chip '+(state.filter===f?"active":"")+'" data-f="'+f+'">'+label+'</div>'; }

function renderBuildingView(b){
  var rc = roomCount(b);
  var rows = [];
  for(var i=1;i<=rc;i++){ var room = getRoom(b,i); rows.push({n:i, room:room, st:roomStatus(room)}); }
  if(state.filter!=="all") rows = rows.filter(function(r){ return r.st===state.filter; });
  if(state.search){
    var q = state.search.toLowerCase();
    rows = rows.filter(function(r){ return (b+"-"+r.n).toLowerCase().indexOf(q)>=0 || (""+r.n).indexOf(q)>=0; });
  }
  var html = '<div class="backbar" id="backBtn">← Bâtiment '+b+'</div><div class="card">';
  html += '<div class="searchbar"><input id="searchIn" placeholder="Rechercher une chambre…" value="'+escapeHtml(state.search)+'"></div>';
  html += '<div class="filter-row">'+chip("all","Toutes")+chip("red","Non visitées")+chip("amber","Partielles")+chip("green","Complètes")+'</div>';
  if(rows.length===0){ html += '<div class="empty">Aucune chambre trouvée.</div>'; }
  else {
    rows.forEach(function(r){
      var statLabel = r.st==="green" ? "2/2 atteints" : (r.st==="amber" ? "1/2 atteint" : "Non visitée");
      html += '<div class="room-row" data-n="'+r.n+'"><div class="left"><div class="badge '+r.st+'"></div>' +
        '<div><div class="name">'+b+'-'+r.n+'</div><div class="stat">'+statLabel+'</div></div></div><div class="chev">›</div></div>';
    });
  }
  html += '</div>';
  app.innerHTML = html;
  document.getElementById("backBtn").onclick = closeRoute;
  app.querySelector("#searchIn").oninput = function(e){ state.search = e.target.value; renderBuildingView(b); };
  app.querySelectorAll(".chip").forEach(function(c){ c.onclick = function(){ state.filter = c.dataset.f; renderBuildingView(b); }; });
  app.querySelectorAll(".room-row").forEach(function(r){ r.onclick = function(){ openRoom(b, parseInt(r.dataset.n,10)); }; });
}

function studentCard(num, s){
  var key = "s"+num;
  return '<div class="student-card '+(s.r?"reached":"")+'"><div><div class="label">Étudiant '+num+'</div>' +
    '<div class="meta">'+(s.r ? ("Atteint par "+escapeHtml(s.by||"")+(s.at?(" · "+new Date(s.at).toLocaleDateString("fr-FR")):"")) : "Pas encore rencontré")+'</div></div>' +
    '<button class="toggle '+(s.r?"on":"")+'" data-s="'+key+'"><span class="knob"></span></button></div>';
}

function renderRoomView(b,n){
  var room = getRoom(b,n);
  var html = '<div class="backbar" id="backBtn">← '+b+'-'+n+'</div><div class="card">' +
    studentCard(1, room.s1) + studentCard(2, room.s2) + '</div>';
  html += '<div class="card"><h3 style="font-size:14px">Historique</h3><div id="histWrap">';
  if(!room.history || room.history.length===0){ html += '<div class="empty">Aucune visite enregistrée.</div>'; }
  else {
    room.history.forEach(function(h){
      var d = new Date(h.at);
      html += '<div class="hist-item">Étudiant '+h.student.replace("s","")+' — <b>'+h.action+'</b> par '+escapeHtml(h.by)+' · '+d.toLocaleString("fr-FR")+'</div>';
    });
  }
  html += '</div></div>';
  app.innerHTML = html;
  document.getElementById("backBtn").onclick = closeRoute;
  app.querySelectorAll(".toggle").forEach(function(t){
    t.onclick = function(){
      var sk = t.dataset.s;
      var newVal = !(room[sk].r);
      applyRoomChange(b, n, sk, newVal);
      toast("Étudiant "+sk.replace("s","")+" marqué comme "+(newVal?"atteint":"non atteint"));
    };
  });
}

function renderRemaining(){
  var list = [];
  BUILDINGS.forEach(function(b){
    var rc = roomCount(b);
    for(var i=1;i<=rc;i++){ var room = getRoom(b,i); var st = roomStatus(room); if(st!=="green") list.push({b:b,n:i,st:st}); }
  });
  if(state.search){ var q = state.search.toLowerCase(); list = list.filter(function(r){ return (r.b+"-"+r.n).toLowerCase().indexOf(q)>=0; }); }
  var html = '<div class="card"><h3 style="font-size:14px">Chambres restantes ('+list.length+')</h3>';
  html += '<div class="searchbar" style="margin-top:8px"><input id="searchIn" placeholder="Ex. B-27" value="'+escapeHtml(state.search)+'"></div>';
  if(list.length===0){ html += '<div class="empty">🎉 Toutes les chambres ont été complètement visitées !</div>'; }
  else {
    list.slice(0,300).forEach(function(r){
      var label = r.st==="amber" ? "1/2" : "0/2";
      html += '<div class="room-row" data-b="'+r.b+'" data-n="'+r.n+'"><div class="left"><div class="badge '+r.st+'"></div>' +
        '<div class="name">'+r.b+'-'+r.n+'</div></div><div class="stat">'+label+'</div></div>';
    });
    if(list.length>300) html += '<div class="muted" style="padding:8px 0">… et '+(list.length-300)+' autres. Affine ta recherche.</div>';
  }
  html += '</div>';
  app.innerHTML = html;
  app.querySelector("#searchIn").oninput = function(e){ state.search = e.target.value; renderRemaining(); };
  app.querySelectorAll(".room-row").forEach(function(r){ r.onclick = function(){ openRoom(r.dataset.b, parseInt(r.dataset.n,10)); }; });
}

function renderStats(){
  var s = computeStats();
  var html = '<div class="card"><h3 style="font-size:14px">Couverture des chambres</h3>' +
    '<div class="bar-wrap"><div class="bar-fill" style="width:'+pct(s.green,s.totalRooms)+'%"></div></div>' +
    '<div class="muted">'+pct(s.green,s.totalRooms)+'% ('+s.green+'/'+s.totalRooms+')</div>' +
    '<h3 style="font-size:14px; margin-top:14px">Couverture des étudiants</h3>' +
    '<div class="bar-wrap"><div class="bar-fill" style="width:'+pct(s.studentsReached,s.studentsTotal)+'%; background:var(--accent2)"></div></div>' +
    '<div class="muted">'+pct(s.studentsReached,s.studentsTotal)+'% ('+s.studentsReached+'/'+s.studentsTotal+')</div></div>';
  html += '<div class="card"><h3 style="font-size:14px">Progression par bâtiment</h3>';
  BUILDINGS.forEach(function(b){
    var p = s.perBuilding[b].pct;
    html += '<div style="margin:8px 0"><div style="display:flex; justify-content:space-between; font-size:12.5px">' +
      '<span><b>'+b+'</b></span><span>'+p+'%</span></div><div class="bar-wrap"><div class="bar-fill" style="width:'+p+'%"></div></div></div>';
  });
  html += '</div>';
  app.innerHTML = html;
}

function renderAdmin(){
  var html = '<div class="card"><h3 style="font-size:14px">Profil</h3>' +
    '<div class="muted">Connecté en tant que <b>'+escapeHtml(state.user?state.user.name:"—")+'</b></div>' +
    '<button class="btn secondary sm" id="changeNameBtn" style="margin-top:10px">Changer de nom</button></div>';
  html += '<div class="card"><h3 style="font-size:14px">Export des données</h3>' +
    '<div class="muted">Exporte l\'état actuel de toutes les chambres au format CSV.</div>' +
    '<button class="btn block" id="exportBtn" style="margin-top:10px">⬇️ Exporter en CSV</button></div>';
  html += '<div class="card"><h3 style="font-size:14px">Synchronisation</h3>' +
    '<div class="muted">' + (supabase ?
      "Connecté à Supabase. Les modifications se synchronisent automatiquement dès qu'il y a du réseau, et sont visibles par tous les frères qui utilisent l'application. Tes actions restent enregistrées localement (IndexedDB) même hors connexion." :
      "⚠️ config.js n'est pas encore rempli avec tes identifiants Supabase — l'application fonctionne pour l'instant uniquement en local sur cet appareil, sans partage avec les autres frères.") +
    '</div></div>';
  app.innerHTML = html;
  app.querySelector("#exportBtn").onclick = exportCsv;
  app.querySelector("#changeNameBtn").onclick = function(){ state.user = null; render(); };
}

function exportCsv(){
  var rows = [["Bâtiment","Chambre","Étudiant 1","Étudiant 2","Statut","Dernière mise à jour"]];
  BUILDINGS.forEach(function(b){
    var rc = roomCount(b);
    for(var i=1;i<=rc;i++){
      var room = getRoom(b,i);
      var c = (room.s1.r?1:0)+(room.s2.r?1:0);
      var lastAt = [room.s1.at, room.s2.at].filter(Boolean).sort().pop();
      rows.push([b, b+"-"+i, room.s1.r?"Oui":"Non", room.s2.r?"Oui":"Non", c+"/2", lastAt?new Date(lastAt).toLocaleString("fr-FR"):"-"]);
    }
  });
  var csv = rows.map(function(r){ return r.map(function(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }).join(","); }).join("\n");
  var blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = "carte-moisson-export.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Export CSV généré");
}

/* ================= PWA INSTALL PROMPT ================= */
var deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", function(e){
  e.preventDefault();
  deferredInstallPrompt = e;
  var banner = document.getElementById("installBanner");
  if(banner) banner.classList.add("show");
});
function wireInstallBanner(){
  var banner = document.getElementById("installBanner");
  if(!banner) return;
  banner.querySelector("#installBtn").onclick = function(){
    banner.classList.remove("show");
    if(deferredInstallPrompt) deferredInstallPrompt.prompt();
  };
  banner.querySelector("#dismissBtn").onclick = function(){ banner.classList.remove("show"); };
}

/* ================= NAV WIRING ================= */
document.querySelectorAll("nav.bottom .tab").forEach(function(t){
  t.onclick = function(){ state.tab = t.dataset.tab; state.route=null; state.filter="all"; state.search=""; render(); };
});

/* ================= SERVICE WORKER ================= */
if("serviceWorker" in navigator){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("service-worker.js").catch(function(){});
  });
}

/* ================= INIT ================= */
openDb()
  .then(function(){ return Promise.all([loadUser(), loadLocalRooms(), loadQueueCount(), idbGet("meta","lastSync")]); })
  .then(function(results){
    if(results[3]) state.lastSync = results[3].value;
    updateSyncPill();
    render();
    wireInstallBanner();
    if(supabase){
      subscribeRealtime();
      pullFromServer().then(processQueue).then(render);
    }
  })
  .catch(function(err){
    console.error("Erreur d'initialisation", err);
    render();
  });
