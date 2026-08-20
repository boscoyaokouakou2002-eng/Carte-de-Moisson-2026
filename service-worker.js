// Service worker — met en cache l'application (HTML/CSS/JS/icônes)
// pour qu'elle s'ouvre même sans connexion Internet.
// Les données (chambres/visites) sont gérées séparément par IndexedDB
// dans app.js, pas par ce cache.

var CACHE_NAME = "moisson-cache-v3";
var NETWORK_FIRST = ["config.js", "index.html", "./"]; // toujours vérifier le réseau d'abord pour ces fichiers
var APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./campus-bg.jpg"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(event){
  var url = new URL(event.request.url);

  // Never cache/interfere with Supabase API calls — those need the network.
  if(url.hostname.indexOf("supabase.co") !== -1){
    return;
  }

  var isNetworkFirst = NETWORK_FIRST.some(function(name){ return url.pathname.indexOf(name.replace("./","")) !== -1 || event.request.mode==="navigate"; });

  if(isNetworkFirst){
    // Réseau en priorité (avec le cache seulement en secours si hors-ligne)
    event.respondWith(
      fetch(event.request).then(function(resp){
        if(event.request.method==="GET" && resp && resp.status===200 && url.origin===location.origin){
          var respClone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, respClone); });
        }
        return resp;
      }).catch(function(){
        return caches.match(event.request).then(function(cached){
          return cached || (event.request.mode==="navigate" ? caches.match("./index.html") : undefined);
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(resp){
        if(event.request.method==="GET" && resp && resp.status===200 && url.origin===location.origin){
          var respClone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, respClone); });
        }
        return resp;
      }).catch(function(){
        if(event.request.mode === "navigate") return caches.match("./index.html");
      });
    })
  );
});
