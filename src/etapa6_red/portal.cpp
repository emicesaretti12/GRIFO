#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "portal.h"
#include "ajustes.h"

static WebServer  servidor(80);
static DNSServer  dns;
static bool       activo   = false;
static bool       guardado = false;
static String     redElegida;

// ── La página ───────────────────────────────────────────────────────────────
// Va entera acá adentro, en la flash del programa, porque el portal tiene que
// funcionar justo cuando NO hay internet: no puede pedirle una hoja de estilos
// ni una fuente a ningún servidor de afuera.
//
//   Es una página sin una sola dependencia externa. Todo inline, a propósito.
static const char PAGINA[] PROGMEM = R"PAGINA(<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Configurar la canilla</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:20px 16px 40px;background:#17130d;color:#f3ece1;
     font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.caja{max-width:460px;margin:0 auto}
h1{margin:0 0 4px;font-size:21px;letter-spacing:-.2px}
.sub{color:#a2957f;margin:0 0 22px;font-size:13.5px}
.marca{display:flex;align-items:center;gap:10px;margin-bottom:18px}
.gota{width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;
      background:linear-gradient(160deg,#e8a72c,#b9701a);font-size:19px}
label{display:block;font-size:12.5px;text-transform:uppercase;letter-spacing:.6px;
      color:#a2957f;margin:16px 0 6px}
input{width:100%;padding:12px 13px;border-radius:10px;font-size:16px;
      border:1px solid #3a3128;background:#211a12;color:#f3ece1}
input:focus{outline:none;border-color:#e8a72c}
button{width:100%;padding:13px;border:0;border-radius:10px;font-size:15.5px;font-weight:650;
       background:#e8a72c;color:#231a0c;cursor:pointer;margin-top:20px}
button:disabled{opacity:.45;cursor:default}
ul{list-style:none;margin:0;padding:0;border:1px solid #3a3128;border-radius:12px;overflow:hidden}
li{display:flex;align-items:center;gap:11px;padding:12px 13px;cursor:pointer;
   border-bottom:1px solid #2a2219}
li:last-child{border-bottom:0}
li[aria-selected=true]{background:#332811}
.nom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.barras{display:flex;gap:2px;align-items:flex-end;height:14px;flex:none}
.barras i{width:3px;background:#4d4235;border-radius:1px}
.barras i.on{background:#e8a72c}
.cand{font-size:12px;color:#a2957f;flex:none}
.vacio{padding:16px 13px;color:#a2957f;font-size:13.5px}
.aviso{margin-top:20px;padding:12px 13px;border-radius:10px;font-size:13.5px;
       background:#221b10;border:1px solid #3a3128;color:#c9bda8}
.ok{text-align:center;padding:40px 0}
.ok h2{font-size:19px;margin:14px 0 8px}
.tic{width:58px;height:58px;border-radius:50%;margin:0 auto;display:grid;place-items:center;
     background:#1f3a22;color:#6fd479;font-size:30px}
a.link{color:#e8a72c;font-size:13px;display:inline-block;margin-top:14px}
</style></head><body><div class=caja id=app>

<div class=marca><div class=gota>&#127866;</div>
  <div><h1>Configurar la canilla</h1>
  <p class=sub style="margin:0">Elegí la red del bar y poné la clave.</p></div></div>

<label>Redes que se ven desde acá</label>
<ul id=redes><li class=vacio>Buscando redes&hellip;</li></ul>

<label for=s>Red</label>
<input id=s placeholder="Nombre de la red" autocapitalize=off autocorrect=off spellcheck=false>

<label for=p>Clave</label>
<input id=p type=password placeholder="Clave del WiFi" autocapitalize=off autocorrect=off spellcheck=false>
<a class=link href="#" id=ver>Mostrar la clave</a>

<button id=b disabled>Guardar y conectar</button>

<div class=aviso>Si la clave queda mal, la canilla <b>vuelve sola</b> a la red
anterior. No se rompe nada por probar.</div>
</div>

<script>
var $=function(i){return document.getElementById(i)}
var elegida=''
function barras(r){var n=r>=-55?4:r>=-67?3:r>=-78?2:1,h=''
  for(var i=1;i<=4;i++)h+='<i class="'+(i<=n?'on':'')+'" style="height:'+(i*3+2)+'px"></i>'
  return '<span class=barras>'+h+'</span>'}
function pinta(d){var u=$('redes')
  if(!d.listo){u.innerHTML='<li class=vacio>Buscando redes&hellip;</li>';return}
  if(!d.redes.length){u.innerHTML='<li class=vacio>No se ve ninguna red. Acercá la canilla al router.</li>';return}
  u.innerHTML=d.redes.map(function(r){
    return '<li data-s="'+r.s.replace(/"/g,'&quot;')+'" aria-selected="'+(r.s===elegida)+'">'+
      barras(r.r)+'<span class=nom></span><span class=cand>'+(r.c?'&#128274;':'abierta')+'</span></li>'}).join('')
  var li=u.querySelectorAll('li'),i
  for(i=0;i<li.length;i++){li[i].querySelector('.nom').textContent=d.redes[i].s
    li[i].onclick=(function(n){return function(){elegida=n;$('s').value=n;$('p').focus();chequear();traer()}})(d.redes[i].s)}}
function traer(){fetch('/redes').then(function(r){return r.json()}).then(pinta).catch(function(){})}
function chequear(){$('b').disabled=$('s').value.trim()===''}
$('s').oninput=function(){elegida=$('s').value;chequear()}
$('ver').onclick=function(e){e.preventDefault()
  var p=$('p');p.type=p.type==='password'?'text':'password'
  this.textContent=p.type==='password'?'Mostrar la clave':'Ocultar la clave'}
$('b').onclick=function(){
  var s=$('s').value.trim(),p=$('p').value
  $('b').disabled=true;$('b').textContent='Guardando…'
  var c=new URLSearchParams();c.append('ssid',s);c.append('pass',p)
  fetch('/guardar',{method:'POST',body:c}).then(function(r){return r.text()}).then(function(){
    $('app').innerHTML='<div class=ok><div class=tic>&#10003;</div>'+
      '<h2>Listo</h2><p class=sub>La canilla se reinicia y se conecta a <b></b>.<br>'+
      'Esta red va a desaparecer en unos segundos: es normal.</p></div>'
    $('app').querySelector('b').textContent=s
  }).catch(function(){$('b').disabled=false;$('b').textContent='Guardar y conectar'})}
traer();setInterval(traer,4000)
</script></body></html>)PAGINA";


/** Escapa lo que va adentro de un string JSON. Un SSID puede tener comillas o
 *  barras: sin esto, una red con un nombre raro rompe la página entera. */
static String escapar(const String &s) {
  String r;
  r.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\')      { r += '\\'; r += c; }
    else if ((uint8_t)c < 0x20)     { r += ' '; }
    else                            { r += c; }
  }
  return r;
}

/** Las redes que se ven, en JSON.
 *
 *  El escaneo se pide **asincrónico**: bloquear tres segundos acá dejaría al
 *  servidor sin atender y al watchdog mirando. Mientras no terminó, se contesta
 *  `listo: false` y la página vuelve a preguntar. */
static void manejarRedes() {
  int n = WiFi.scanComplete();

  if (n == WIFI_SCAN_FAILED) {          // -2: nunca se pidió, o el anterior murió
    WiFi.scanNetworks(true);
    servidor.send(200, "application/json", "{\"listo\":false,\"redes\":[]}");
    return;
  }
  if (n == WIFI_SCAN_RUNNING) {         // -1: en curso
    servidor.send(200, "application/json", "{\"listo\":false,\"redes\":[]}");
    return;
  }

  String j = "{\"listo\":true,\"redes\":[";
  int puestas = 0;
  for (int i = 0; i < n && puestas < 20; i++) {
    String s = WiFi.SSID(i);
    if (s.length() == 0) continue;      // redes ocultas: no hay nada que mostrar
    if (puestas++) j += ',';
    j += "{\"s\":\"" + escapar(s) + "\",\"r\":" + String(WiFi.RSSI(i)) +
         ",\"c\":" + String(WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? 0 : 1) + "}";
  }
  j += "]}";

  WiFi.scanDelete();
  WiFi.scanNetworks(true);              // ya deja pedido el próximo
  servidor.send(200, "application/json", j);
}

static void manejarGuardar() {
  String ssid = servidor.arg("ssid");
  String pass = servidor.arg("pass");
  ssid.trim();

  if (ssid.length() == 0) {
    servidor.send(400, "text/plain", "falta la red");
    return;
  }

  if (!ajustesGuardarWifi(ssid.c_str(), pass.c_str())) {
    servidor.send(500, "text/plain", "no se pudo guardar");
    return;
  }

  redElegida = ssid;
  servidor.send(200, "text/plain", "ok");

  // Se marca DESPUÉS de contestar. Si se marcara antes, el que llama podría
  // reiniciar la placa con la respuesta todavía sin salir y el que configuró
  // vería un error en el celular justo cuando la cosa salió bien.
  guardado = true;
}

/** Cualquier otra dirección cae acá y se redirige al portal.
 *
 *  Es lo que hace que al conectarte se abra sola la página. El celular, apenas
 *  entra a una red, pide una URL conocida para ver si hay internet de verdad;
 *  como el DNS de la canilla contesta su propia IP a todo, esa consulta termina
 *  acá, y esta redirección es la señal de "acá hay un portal". */
static void manejarPerdido() {
  servidor.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true);
  servidor.send(302, "text/plain", "");
}

void portalArrancar(const char *nombreAp, const char *clave) {
  if (activo) return;

  guardado = false;
  redElegida = "";

  // AP_STA y no AP a secas: en modo mixto el chip puede escanear las redes de
  // alrededor mientras mantiene su propia red levantada. Con AP solo, la lista
  // de redes vendría vacía y habría que escribir el nombre a mano.
  WiFi.mode(WIFI_AP_STA);
  WiFi.disconnect(false, false);

  bool ok = (clave != NULL && strlen(clave) >= 8)
              ? WiFi.softAP(nombreAp, clave)
              : WiFi.softAP(nombreAp);

  IPAddress ip = WiFi.softAPIP();

  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", ip);               // todo nombre resuelve a la canilla

  servidor.on("/", HTTP_GET, []() {
    servidor.send_P(200, "text/html", PAGINA);
  });
  servidor.on("/redes",   HTTP_GET,  manejarRedes);
  servidor.on("/guardar", HTTP_POST, manejarGuardar);
  servidor.onNotFound(manejarPerdido);
  servidor.begin();

  WiFi.scanNetworks(true);              // que haya algo para mostrar al entrar

  activo = true;

  Serial.println();
  Serial.println("+---------------------------------------------------+");
  Serial.println("|  PORTAL DE CONFIGURACION                          |");
  Serial.printf ("|  1. Conectate con el celular a la red: %-10s |\n", nombreAp);
  if (clave != NULL && strlen(clave) >= 8)
    Serial.printf("|  2. Clave de esa red: %-27s |\n", clave);
  Serial.printf ("|  3. Si no se abre sola, entra a http://%-11s|\n", ip.toString().c_str());
  Serial.println("+---------------------------------------------------+");
  if (!ok) Serial.println("[portal] ojo: softAP() devolvio error");
  Serial.println();
}

bool portalActivo() { return activo; }

void portalAtender() {
  if (!activo) return;
  dns.processNextRequest();
  servidor.handleClient();
}

bool portalGuardoWifi() { return guardado; }

void portalParar() {
  if (!activo) return;
  servidor.stop();
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  activo = false;
  Serial.println("[portal] cerrado");
}
