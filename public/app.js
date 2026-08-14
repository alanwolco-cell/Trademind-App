// Prevent browser from restoring scroll position on reload
if(history.scrollRestoration)history.scrollRestoration='manual';
window.scrollTo(0,0);

// ── Missing-headshot safety net ──────────────────────────────────────────────
// Sleeper has no photo for every player (rookies, practice-squad call-ups) and
// no logo for every team edge case, so those .jpg/.png files 404. Nearly every
// <img> in the app hides itself on error (display:none / visibility:hidden),
// which leaves an empty hole in a row of faces. Catch those failures once,
// globally, in the capture phase - before each element's own inline onerror can
// hide it - and drop in a neutral silhouette (players) or generic mark (logos)
// so a slot always reads as "no photo" instead of a broken gap. One net covers
// trade rows, autocomplete, player cards, mock draft, community and the ticker.
var TM_PH_PLAYER="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2a2140"/><circle cx="20" cy="15" r="7" fill="#5a4d7a"/><path d="M6 38c0-8 6.5-13 14-13s14 5 14 13z" fill="#5a4d7a"/></svg>');
var TM_PH_TEAM="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="#5a4d7a" stroke-width="2.5"/><path d="M12 20h16M20 12v16" stroke="#5a4d7a" stroke-width="2.5"/></svg>');
window.addEventListener('error',function(e){
  var img=e.target;
  if(!img||img.tagName!=='IMG')return;
  if(img.dataset.tmPh)return;                 // already swapped - avoid any loop
  var src=img.getAttribute('src')||'';
  var isPlayer=src.indexOf('players/thumb/')!==-1||src.indexOf('players%2Fthumb')!==-1;
  var isTeam=src.indexOf('team_logos/')!==-1||src.indexOf('team_logos%2F')!==-1;
  if(!isPlayer&&!isTeam)return;               // leave news/community images alone
  img.dataset.tmPh='1';
  e.stopImmediatePropagation();               // stop the inline onerror from hiding it
  img.src=isPlayer?TM_PH_PLAYER:TM_PH_TEAM;
  img.style.visibility='visible';
  if(img.style.display==='none')img.style.display='';
},true);

// ── Account key ─────────────────────────────────────────────────────────────
// One random secret per browser, minted on first visit. It is what proves "this
// is the same person" to the server: a Sleeper username is public, so anyone
// could type yours, and the server can no longer take a username's word for it.
// This key is what actually owns your published trades, your Pro subscription
// and your votes. It never leaves this browser except as a request header.
function tmAcct(){
  try{
    var k=localStorage.getItem('tm_acct');
    if(k&&/^[A-Za-z0-9_-]{24,128}$/.test(k))return k;
    var b=new Uint8Array(32);
    (window.crypto||window.msCrypto).getRandomValues(b);
    k=Array.prototype.map.call(b,function(x){return ('0'+x.toString(16)).slice(-2);}).join('');
    localStorage.setItem('tm_acct',k);
    return k;
  }catch(_){
    // Private mode with storage blocked: fall back to a per-session key so the
    // app still works, accepting that ownership resets when the tab closes.
    if(!window._tmAcctMem)window._tmAcctMem=String(Date.now())+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    return window._tmAcctMem;
  }
}
// Attach the key to every same-origin /api call, so no individual call site has
// to remember to do it.
(function(){
  var _fetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    try{
      var url=(typeof input==='string')?input:(input&&input.url)||'';
      var sameOrigin=url.indexOf('/api/')===0||url.indexOf(location.origin+'/api/')===0;
      if(sameOrigin){
        init=init||{};
        var h=new Headers(init.headers||(typeof input==='object'&&input.headers)||{});
        h.set('x-tm-acct',tmAcct());
        init=Object.assign({},init,{headers:h});
      }
    }catch(_){}
    return _fetch(input,init);
  };
})();


// Theme: dark by default, persisted
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  var b=document.getElementById('theme-toggle');
  if(b){
    // icon shows what you'd switch TO: moon while in light mode, sun while in dark
    b.innerHTML=t==='light'
      ?'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
      :'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    b.title=t==='light'?'Switch to dark':'Switch to light';
  }
  try{localStorage.setItem('tm_theme',t);}catch(_){}
}
function toggleTheme(){
  applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');
}
// Always run at startup (not only when light is saved) so the icon button is never empty
try{applyTheme(localStorage.getItem('tm_theme')==='light'?'light':'dark');}catch(_){applyTheme('dark');}

// Nav search collapses to an icon; expands on demand
function navSearchToggle(){
  var wrap=document.getElementById('nav-search-wrap');
  var inp=document.getElementById('nav-search');
  if(!wrap||!inp)return;
  if(wrap.classList.toggle('open')){
    inp.focus();                          // immediately - keys typed mid-animation must land
    setTimeout(function(){inp.focus();},80);  // and again after the width transition
  }
  else inp.blur();
}
function navSearchBlur(){
  // Delay so a click on a result in the dropdown still lands before we collapse
  setTimeout(function(){
    var wrap=document.getElementById('nav-search-wrap');
    var inp=document.getElementById('nav-search');
    var dd=document.getElementById('nav-search-dd');
    if(!wrap||!inp)return;
    if(document.activeElement===inp)return;
    // Hide via the .open class only - never set an inline display, or it sticks
    // and overrides .ac-dropdown.open on the next search (the "won't drop down" bug).
    if(!inp.value.trim()){wrap.classList.remove('open');if(dd)dd.classList.remove('open');}
  },220);
}

const SLEEPER='https://api.sleeper.app/v1';
let userId=null,allPlayers={},myRoster=[],oppRoster=[],leagueRosters=[],leagueUsers=[],leagueId=null,leagueName='',leagueSeason='';
let ACTIVE_SEASON='2026';
// Live NFL calendar state - drives season-aware copy (no "playoff push" talk in July)
var NFL_WEEK=0;
var NFL_SEASON_TYPE='off'; // 'off' | 'pre' | 'regular' | 'post'
function seasonPhase(){
  if(NFL_SEASON_TYPE!=='regular'&&NFL_SEASON_TYPE!=='post')return 'offseason';
  if(NFL_SEASON_TYPE==='post')return 'playoffs';
  if(NFL_WEEK<=4)return 'early';
  if(NFL_WEEK<=9)return 'mid';
  if(NFL_WEEK<=13)return 'stretch';
  return 'playoffs';
}
let myPicks=[];           // [{season,round,label}]
let oppPicks=[];          // opponent picks
let leaguePicks=[];       // all traded picks in league
let leagueTrades=[];      // all completed trade transactions this season
let tradeStats={};        // per-roster behavioral stats computed from leagueTrades
let leagueDraftId=null;
let ktcValues={};     // byName: {name: value}
let _pickValCache={};  // generic round-N pick value, memoised: the lookup below scans every
                       // key in ktcValues and gets called tens of thousands of times per
                       // trade search, which was freezing the UI for over a second
let ktcById={};       // byId: {sleeperId: value}
let ktcFull={};       // byId: {sleeperId: {value, overallRank, positionRank, trend30Day, espnId, ...}}
let leagueFormat={totalTeams:12,ppr:1,hasSuperFlex:false,has2QB:false,flexCount:1,recFlexCount:0,numQBs:1,numRBs:2,numWRs:2,numTEs:1,benchSpots:6,scoringLabel:'PPR',formatLabel:'Standard'};
// 'dynasty' or 'redraft' - auto-detected when a league loads. Without a league
// the app talks REDRAFT: that is what the mock-first landing sells, and the
// setup UI already says Redraft - the engine must agree with the label.
let leagueMode='redraft';
// Monotonic tokens so a slow background response from a league/format you already
// switched away from can't clobber the data for the one you're looking at now.
let _leagueLoadSeq=0;     // bumped every loadLeague/import; identifies the active load
let _ktcReq=0;            // bumped every fetchKtcValues; only the newest may write
const answers=[null,null,null];
const youAnswers=[null,null,null];
let currentQ=0,currentYQ=0,lastResult=null; // currentQ kept for backward compat with goBack/selectOpt

const FALLBACK_PLAYERS=[
  {name:"JaMarr Chase",pos:"WR",team:"CIN"},{name:"Justin Jefferson",pos:"WR",team:"MIN"},
  {name:"CeeDee Lamb",pos:"WR",team:"DAL"},{name:"Amon-Ra St Brown",pos:"WR",team:"DET"},
  {name:"Puka Nacua",pos:"WR",team:"LAR"},{name:"Malik Nabers",pos:"WR",team:"NYG"},
  {name:"Marvin Harrison Jr",pos:"WR",team:"ARI"},{name:"Brian Thomas Jr",pos:"WR",team:"JAC"},
  {name:"Garrett Wilson",pos:"WR",team:"NYJ"},{name:"Drake London",pos:"WR",team:"ATL"},
  {name:"Davante Adams",pos:"WR",team:"LAR"},{name:"Tyreek Hill",pos:"WR",team:"FA"},
  {name:"Cooper Kupp",pos:"WR",team:"SEA"},{name:"Jaylen Waddle",pos:"WR",team:"DEN"},
  {name:"Deebo Samuel",pos:"WR",team:"FA"},{name:"DeVonta Smith",pos:"WR",team:"PHI"},
  {name:"Rashee Rice",pos:"WR",team:"KC"},{name:"Zay Flowers",pos:"WR",team:"BAL"},
  {name:"Chris Olave",pos:"WR",team:"NO"},{name:"Stefon Diggs",pos:"WR",team:"FA"},
  {name:"Christian McCaffrey",pos:"RB",team:"SF"},{name:"Breece Hall",pos:"RB",team:"NYJ"},
  {name:"Bijan Robinson",pos:"RB",team:"ATL"},{name:"Jahmyr Gibbs",pos:"RB",team:"DET"},
  {name:"Devon Achane",pos:"RB",team:"MIA"},{name:"Jonathan Taylor",pos:"RB",team:"IND"},
  {name:"Derrick Henry",pos:"RB",team:"BAL"},{name:"Saquon Barkley",pos:"RB",team:"PHI"},
  {name:"Josh Jacobs",pos:"RB",team:"GB"},{name:"Rachaad White",pos:"RB",team:"WAS"},
  {name:"Tony Pollard",pos:"RB",team:"TEN"},{name:"James Cook",pos:"RB",team:"BUF"},
  {name:"Travis Etienne",pos:"RB",team:"NO"},{name:"David Montgomery",pos:"RB",team:"HOU"},
  {name:"Kyren Williams",pos:"RB",team:"LAR"},{name:"Javonte Williams",pos:"RB",team:"DAL"},
  {name:"Joe Mixon",pos:"RB",team:"FA"},{name:"Isiah Pacheco",pos:"RB",team:"DET"},
  {name:"Alvin Kamara",pos:"RB",team:"NO"},{name:"Aaron Jones",pos:"RB",team:"MIN"},
  {name:"Patrick Mahomes",pos:"QB",team:"KC"},{name:"Josh Allen",pos:"QB",team:"BUF"},
  {name:"Lamar Jackson",pos:"QB",team:"BAL"},{name:"Jalen Hurts",pos:"QB",team:"PHI"},
  {name:"Joe Burrow",pos:"QB",team:"CIN"},{name:"Dak Prescott",pos:"QB",team:"DAL"},
  {name:"Tua Tagovailoa",pos:"QB",team:"ATL"},{name:"Jayden Daniels",pos:"QB",team:"WAS"},
  {name:"Caleb Williams",pos:"QB",team:"CHI"},{name:"Bo Nix",pos:"QB",team:"DEN"},
  {name:"Jordan Love",pos:"QB",team:"GB"},{name:"Anthony Richardson",pos:"QB",team:"IND"},
  {name:"Sam LaPorta",pos:"TE",team:"DET"},{name:"Trey McBride",pos:"TE",team:"ARI"},
  {name:"Brock Bowers",pos:"TE",team:"LV"},{name:"Travis Kelce",pos:"TE",team:"KC"},
  {name:"Mark Andrews",pos:"TE",team:"BAL"},{name:"Dallas Goedert",pos:"TE",team:"PHI"},
  {name:"TJ Hockenson",pos:"TE",team:"MIN"},{name:"Evan Engram",pos:"TE",team:"DEN"},
  {name:"Jake Ferguson",pos:"TE",team:"DAL"},{name:"Pat Freiermuth",pos:"TE",team:"PIT"}
];


// Global player search in the nav, with recent searches
function _getRecentSearches(){
  try{return JSON.parse(localStorage.getItem('tm_recent_searches')||'[]');}catch(_){return [];}
}
function _saveRecentSearch(p){
  try{
    var list=_getRecentSearches().filter(function(r){return r.id!==p.id;});
    list.unshift({id:p.id,name:p.name,pos:p.pos,team:p.team||'FA'});
    localStorage.setItem('tm_recent_searches',JSON.stringify(list.slice(0,6)));
  }catch(_){}
}
function clearRecentSearches(){
  try{localStorage.removeItem('tm_recent_searches');}catch(_){}
  var dd=document.getElementById('nav-search-dd');
  if(dd)dd.classList.remove('open');
}
// Inner HTML for one search row: player photo, name (filled via children[1]),
// team logo, and pos / team. Shared by the results list and the recent list.
function _searchRowInner(p){
  var logo=(p.team&&p.team!=='FA')?'<img src="https://sleepercdn.com/images/team_logos/nfl/'+p.team.toLowerCase()+'.png" style="width:18px;height:18px;object-fit:contain;flex-shrink:0" onerror="this.style.display=\'none\'">':'';
  return '<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'"><span style="flex:1"></span>'+logo+'<span style="font-size:10px;color:var(--muted)">'+p.pos+' · '+(p.team||'FA')+'</span>';
}
function _renderSearchRow(dd,p,inp){
  var d=document.createElement('div');
  d.className='ac-item';
  d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer';
  d.innerHTML=_searchRowInner(p);
  d.children[1].textContent=p.name;
  d.addEventListener('mousedown',function(ev){ev.preventDefault();dd.classList.remove('open');inp.value='';_saveRecentSearch(p);openPlayerCard(p.id,p.name);});
  dd.appendChild(d);
}
async function navSearch(){
  var inp=document.getElementById('nav-search');
  var dd=document.getElementById('nav-search-dd');
  if(!inp||!dd)return;
  dd.style.display='';  // clear any stale inline display so .open controls visibility
  var q=inp.value.toLowerCase().trim();
  if(q.length<2){
    // Empty search: offer recent searches
    var rec=_getRecentSearches();
    if(!rec.length){dd.classList.remove('open');return;}
    dd.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px 3px"><span style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Recent</span><span onmousedown="event.preventDefault();clearRecentSearches()" style="font-size:9px;color:var(--muted);cursor:pointer">Clear</span></div>';
    rec.forEach(function(p){_renderSearchRow(dd,p,inp);});
    dd.classList.add('open');
    return;
  }
  if(Object.keys(allPlayers).length<100)await ensurePlayersLoaded();
  var results=Object.values(allPlayers).filter(function(p){
    return p.name&&p.name.toLowerCase().indexOf(q)>=0&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;
  }).sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,7);
  if(!results.length){dd.classList.remove('open');return;}
  dd.innerHTML='';
  results.forEach(function(p){_renderSearchRow(dd,p,inp);});
  dd.classList.add('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('#nav-search-wrap')){var dd=document.getElementById('nav-search-dd');if(dd)dd.classList.remove('open');}
});

function goHome(){
  // The wordmark is the front door: it opens the HOME page (landing only),
  // a separate page from the Analyze tool.
  _heroDismissed=false;
  window._noAnchorOnce=true;
  switchScreen('home');
  window.scrollTo({top:0,behavior:'smooth'});
}
function scrollToEl(el,center){
  if(!el)return;
  var top=el.getBoundingClientRect().top+window.pageYOffset-(center?window.innerHeight/3:76);
  window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
}
// Escape hatch for anyone who lands on a tool page and feels lost.
function _sageEscHtml(){return '<div style="margin-top:16px;font-size:13px;color:var(--muted2)">New here? <span onclick="switchScreen(\'sage\')" style="color:var(--accent-bright);cursor:pointer;font-weight:700">Just ask Mac &rarr;</span></div>';}
function goConnectLeague(){
  // Connect from wherever you are: a modal, not a trip back to the analyzer.
  var cur=document.querySelector('.screen.active');
  window._returnScreen=cur?cur.id:null;
  openConnectModal();
}
function openConnectModal(){
  var m=document.getElementById('connect-modal');
  if(!m){
    m=document.createElement('div');
    m.id='connect-modal';
    m.innerHTML='<div class="cm-card">'
      +'<button class="cm-x" aria-label="Close" onclick="closeConnectModal()">&times;</button>'
      +'<div class="cm-title">Connect your league</div>'
      +'<div class="cm-sub">Your Sleeper username. Rosters and leagues load in a few seconds.</div>'
      +'<div style="display:flex;gap:8px;margin-top:14px">'
      +'<input type="text" id="cm-user" class="tm-input" style="flex:1" placeholder="Sleeper username" autocomplete="off" '
      +'onkeydown="if(event.key===\'Enter\')connectModalGo()">'
      +'<button class="btn-primary" id="cm-go" style="padding:10px 18px;font-size:13px" onclick="connectModalGo()">Let\'s go &rarr;</button></div>'
      +'<div class="cm-status" id="cm-status"></div>'
      +'<div id="cm-list"></div>'
      +'</div>';
    m.addEventListener('click',function(e){if(e.target===m)closeConnectModal();});
    document.body.appendChild(m);
  }
  m.style.display='flex';
  // Modal is now the active connection flow: retire any inline Mac sign-in so
  // the user never faces two prompts at once.
  var inl=document.getElementById('sage-inline-signin');if(inl)inl.remove();
  var inp=document.getElementById('cm-user');
  inp.value=localStorage.getItem('tm_username')||'';
  document.getElementById('cm-status').textContent='';
  document.getElementById('cm-list').innerHTML='';
  setTimeout(function(){inp.focus();},60);
  // an account we already know: fetch its leagues right away
  if(inp.value.trim())connectModalGo();
}
function closeConnectModal(){
  var m=document.getElementById('connect-modal');
  if(m)m.style.display='none';
}
async function connectModalGo(){
  var inp=document.getElementById('cm-user');
  var st=document.getElementById('cm-status');
  var go=document.getElementById('cm-go');
  var name=(inp.value||'').trim();
  if(!name){st.textContent='Enter your Sleeper username.';return;}
  go.disabled=true;st.textContent='Looking up '+name+'...';
  try{
    var r=await fetch('/api/sleeper/user/'+encodeURIComponent(name));
    if(!r.ok){st.textContent=r.status===404?'Username not found. That is the handle you log into Sleeper with, not your team name.':'Sleeper error. Try again.';go.disabled=false;return;}
    var user=await r.json();
    if(!user||!user.user_id){st.textContent='No account found for that username.';go.disabled=false;return;}
    userId=user.user_id;
    localStorage.setItem('tm_username',name);
    try{sageSyncUser();}catch(_){}
    try{initBK(name);}catch(_){}
    try{updateUserPill();}catch(_){}
    var state=await sleeperGet('/state/nfl').catch(function(){return null;});
    if(state&&state.league_season)ACTIVE_SEASON=state.league_season;
    var cur=ACTIVE_SEASON, prev=String(parseInt(cur)-1);
    var res=await Promise.all([
      sleeperGet('/user/'+userId+'/leagues/nfl/'+cur).catch(function(){return [];}),
      sleeperGet('/user/'+userId+'/leagues/nfl/'+prev).catch(function(){return [];})
    ]);
    var seenIds={},seenNames={};
    var combined=[].concat(res[0]||[]).concat(res[1]||[]).filter(function(l){
      if(!l||seenIds[l.league_id])return false;
      seenIds[l.league_id]=true;
      var norm=(l.name||'').toLowerCase().trim().replace(/\s+\d{4}$/,'').replace(/\s+season\s*\d*/i,'').trim();
      if(norm&&seenNames[norm])return false;
      if(norm)seenNames[norm]=true;
      return true;
    });
    window._myLeagues=combined;
    if(!combined.length){st.textContent='No leagues found on that account.';go.disabled=false;return;}
    st.textContent='';go.disabled=false;
    _renderCmList(combined,'');
  }catch(e){st.textContent='Error: '+e.message;go.disabled=false;}
}
function _renderCmList(leagues,q){
  var box=document.getElementById('cm-list');
  if(!box)return;
  var ql=(q||'').toLowerCase().trim();
  var hits=leagues.filter(function(l){return !ql||(l.name||'').toLowerCase().indexOf(ql)>=0;});
  var html='';
  if(leagues.length>6){
    html+='<input type="text" id="cm-q" class="tm-input" style="width:100%;margin:10px 0 8px;font-size:12px;padding:8px 12px" '
      +'placeholder="Search your leagues..." autocomplete="off" value="'+(q||'').replace(/"/g,'&quot;')+'" '
      +'oninput="_renderCmList(window._myLeagues||[],this.value)">';
  }else{html+='<div style="height:10px"></div>';}
  html+='<div class="cm-leagues">'+(hits.length?hits.map(function(l){
    var isDyn=!!((l.settings&&l.settings.type===2)||(l.name||'').toLowerCase().indexOf('dynasty')>=0);
    var nm=(l.name||'Unnamed').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return '<div class="cm-league" onclick="_cmPick(\''+l.league_id+'\')">'
      +'<div><div class="cm-lname">'+nm+'</div>'
      +'<div class="cm-lmeta">'+(l.total_rosters||'?')+' teams · '+(l.season||'')+' · '+(isDyn?'Dynasty':'Redraft')+'</div></div>'
      +'<span style="color:var(--muted)">&rsaquo;</span></div>';
  }).join(''):'<div style="padding:10px 2px;font-size:11.5px;color:var(--muted)">No league matches that.</div>')+'</div>';
  box.innerHTML=html;
  var qi=document.getElementById('cm-q');
  if(qi&&q){qi.focus();qi.setSelectionRange(q.length,q.length);}
}
function _cmPick(lid){
  var l=(window._myLeagues||[]).find(function(x){return x.league_id===lid;});
  closeConnectModal();
  loadLeague(lid,(l&&l.name)||'League',(l&&l.total_rosters)||null,(l&&l.season)||ACTIVE_SEASON);
}
function _legacyGoConnect(){
  switchScreen('analyze');showAnalyzeTab('analyzer');
  setTimeout(function(){scrollToEl(document.getElementById('login-panel')||document.getElementById('analyzer'));},80);
}
function teamLogo(team,size){
  if(!team||team==='FA')return '';
  var s=size||16;
  return '<img src="https://sleepercdn.com/images/team_logos/nfl/'+String(team).toLowerCase()+'.png" style="width:'+s+'px;height:'+s+'px;object-fit:contain;vertical-align:middle;margin:0 3px 2px 0" onerror="this.style.display=\'none\'">';
}
async function sleeperGet(path){
  var url='/api/sleeper'+path;
  var r;
  try{ r=await fetch(url); }
  catch(e){ throw new Error("Cannot reach Sleeper API. Check internet connection."); }
  if(!r.ok) throw new Error("Sleeper returned "+r.status);
  return r.json();
}

function setStatus(msg,color){
  var el=document.getElementById("status");
  if(!el)return;
  el.textContent=msg;
  el.style.color=color||"var(--muted)";
}

function setSageState(state){
  var w=document.getElementById('sage-wrap');
  if(!w)return;
  w.className='sage-wrap '+state;
  var asset=w.querySelector('.sage-asset');
  if(asset){
    var name=state==='win'?'win':state==='reject'?'no':state==='even'?'even':'thinking';
    asset.dataset.state=name;
    asset.setAttribute('aria-label',state==='win'?'Mac approves the trade':state==='reject'?'Mac advises against the trade':'Mac is reviewing the trade');
    // The owl mascot expresses the verdict with a real face per state
    if(asset.tagName==='IMG'){
      var expr=state==='win'?'excited':state==='reject'?'skeptical':state==='even'?'deadpan':state==='thinking'?'thinking':'';
      asset.src='/sage/'+(expr?'sage-'+expr:'sage')+'-256.png';
    }
  }
}

/* Mac is a product character. The real mascot is the purple three-lobe face
   that already ships inline as SVG on the hero, the "Meet Mac" card, the Ask
   Mac greeting and every verdict. An earlier pass swapped all of those for a
   flat "S" letter-mark placeholder - that "S in a circle" was the tell in Ask
   Mac. We keep the real SVG mascot everywhere instead; it already expresses
   the verdict (win/reject/gaze mouths via .sage-wrap state classes), so there
   is nothing to upgrade. Left as a no-op so any cached caller stays safe. */
function upgradeSageAssets(){ /* intentionally left blank: keep the real SVG mascot */ }
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',upgradeSageAssets);
else upgradeSageAssets();

// The Ask Mac greeting owl peeks: every few seconds it flashes a quick
// expression (mostly a thoughtful glance, rarely a shocked double-take) and
// settles back into its perch pose. Skipped under prefers-reduced-motion.
(function sageGreetPeek(){
  try{if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;}catch(_){}
  var HOME='/sage/sage-128.png';
  function peek(){
    var el=document.getElementById('sage-greet-owl');
    if(el&&el.offsetParent){ // only while Ask Mac is actually on screen
      var r=Math.random();
      var expr=r<0.45?'thinking':r<0.75?'scrutiny':r<0.92?'excited':'shocked';
      el.src='/sage/sage-'+expr+'-128.png';
      setTimeout(function(){el.src=HOME;},900);
    }
    setTimeout(peek,5200+Math.random()*4200);
  }
  setTimeout(peek,3500);
})();
// Mac idle behaviors: gaze + blink
(function sageIdleInit(){
  function sageLook(){
    var w=document.getElementById('sage-wrap');
    if(w&&!w.classList.contains('thinking')&&!w.classList.contains('win')&&!w.classList.contains('reject')){
      w.classList.remove('gaze-left','gaze-right');
      var r=Math.random();
      if(r<0.28)w.classList.add('gaze-left');
      else if(r<0.56)w.classList.add('gaze-right');
    }
    setTimeout(sageLook,1800+Math.random()*3200);
  }
  function sageBlink(){
    var blink=function(sel){
      var eyes=document.querySelectorAll(sel);
      if(!eyes.length)return;
      eyes.forEach(function(e){e.style.transform='scaleY(0.07)';e.style.transformBox='fill-box';e.style.transformOrigin='center';});
      setTimeout(function(){eyes.forEach(function(e){e.style.transform='';e.style.transformBox='';e.style.transformOrigin='';});},120);
    };
    blink('#sage-wrap .sage-eye-l, #sage-wrap .sage-eye-r');
    blink('.sage-hero-eye');
    setTimeout(sageBlink,2800+Math.random()*4500);
  }
  setTimeout(sageLook,1200);
  setTimeout(sageBlink,2000+Math.random()*2000);
})();

function toggleSageMore(btn){
  var d=document.getElementById('sage-more-detail');
  if(!d)return;
  var open=d.classList.toggle('open');
  if(btn)btn.innerHTML=open?'Show less <span>&#9652;</span>':'Why Mac says this <span>&#9662;</span>';
}

function toggleBreakdown(){
  var d=document.getElementById('breakdown-detail');
  var c=document.getElementById('breakdown-caret');
  if(!d)return;
  var open=d.classList.toggle('open');
  if(c)c.textContent=open?'▴':'▾';
}

async function fetchKtcValues(numQbs, pprVal, isDynasty, _retryReq){
  // Fresh call claims a new token; a retry reuses the token it was started with,
  // so a newer format request (which bumps _ktcReq) still wins over a stale retry.
  var _req=_retryReq||(++_ktcReq);
  try{
    var dyn=(isDynasty===false)?'false':'true';
    var qs='?numQbs='+(numQbs||1)+'&ppr='+(pprVal!=null?pprVal:1)+'&isDynasty='+dyn;
    var r=await fetch("/api/ktc/rankings"+qs);
    if(!r.ok)throw new Error("Values unavailable");
    var data=await r.json();
    if(!data.byId||!Object.keys(data.byId).length)throw new Error("Empty values response");
    // A newer format request started while this one was in flight - discard this
    // stale response so dynasty values can't overwrite the redraft ones you switched to.
    if(_req!==_ktcReq)return;
    // Reset so stale dynasty values don't bleed into redraft or vice versa
    ktcById={}; ktcValues={}; ktcFull={}; _pickValCache={};
    Object.assign(ktcById, data.byId);
    if(data.byName) Object.assign(ktcValues, data.byName);
    if(data.byIdFull) Object.assign(ktcFull, data.byIdFull);
    // Tier cutoffs as PERCENTILES of the live value pool, not absolute
    // FantasyCalc numbers - the scale drifts with the market, so a fixed
    // 7000 meant 8 players one month and 20 the next. Elite = top 5%,
    // premium = top 15%, starter = top 30%, flex = top 50% of positively
    // valued QB/RB/WR/TE (checked 7/2026: the p5 line lands at the
    // Puka Nacua / James Cook tier, which reads right).
    try{
      var _tv=Object.values(ktcFull).filter(function(v){return v&&v.value>100&&['QB','RB','WR','TE'].indexOf(v.position)>=0;})
        .map(function(v){return v.value;}).sort(function(a,b){return b-a;});
      if(_tv.length>=40)window._tierCuts={elite:_tv[Math.floor(_tv.length*0.05)],premium:_tv[Math.floor(_tv.length*0.15)],starter:_tv[Math.floor(_tv.length*0.30)],roster:_tv[Math.floor(_tv.length*0.50)]};
    }catch(_){}
    console.log("[TM] FantasyCalc loaded:",Object.keys(ktcById).length,"players (isDynasty="+dyn+")");
    window._ktcIsDyn=(dyn==='true'); // which dataset is in memory right now
    updateModeUI();
    try{renderTradeBoards();}catch(_){}   // values arrived: tiles pick them up
  }catch(e){
    console.log("FantasyCalc unavailable:",e.message);
    // One automatic retry after 2s - transient failures are common on cold serverless starts.
    // Reuse this call's token so the retry still yields to any newer format request.
    if(!_retryReq){setTimeout(function(){fetchKtcValues(numQbs,pprVal,isDynasty,_req);},2000);}
  }
}

function styleModeButtons(m){
  // State lives in a class so home.css can style the segmented control per theme
  document.querySelectorAll('[data-modebtn]').forEach(function(b){
    b.classList.toggle('on',b.dataset.modebtn===m);
  });
}
function setLeagueModeManual(m){
  if(m!=='dynasty'&&m!=='redraft')return;
  // Auto-detection sets the default, but the user owns the final call - a
  // mislabeled or keeper league should never trap them on the wrong values.
  leagueMode=m;
  try{sndPickSoft();}catch(_){}
  styleModeButtons(m);
  fetchKtcValues(leagueFormat.has2QB||leagueFormat.hasSuperFlex?2:1, leagueFormat.ppr, m==='dynasty');
  updateModeUI();
  try{renderTradeBoards();}catch(_){}
  try{if(typeof _runFilterPlayersDB==='function')setTimeout(_runFilterPlayersDB,900);}catch(_){}
}
function _updateOppExplainCopy(){
  var b=document.getElementById('opp-explain-box'); if(!b)return;
  var isR=leagueMode==='redraft';
  var hist=isR?'how often they trade and whether they win or lose value in deals':'how often they trade, whether they hoard or ship picks, and whether they win or lose value in deals';
  var urg=isR?'pushed higher if they have been dealing aggressively to win now':'pushed higher if they\'ve been trading picks away for players (win-now behavior)';
  b.innerHTML='These are <strong style="color:var(--text)">behavioral estimates, not probabilities</strong>. We build them from two real signals: their <strong style="color:var(--text)">roster shape</strong> (average experience and total market value - which manager archetype they fit) and their <strong style="color:var(--text)">actual trade history in this league</strong> ('+hist+').<br><strong style="color:var(--text)">Urgency</strong> - archetype baseline, '+urg+'.<br><strong style="color:var(--text)">Stubbornness</strong> - pushed higher if they barely trade, lower if they\'re a high-volume dealer.<br><strong style="color:var(--text)">Hype chaser</strong> - how much their archetype historically overvalues recent performance. Use it to decide WHICH of your players to feature in the pitch.';
}
function updateModeUI(){
  try{_updateOppExplainCopy();}catch(_){}
  var badge=document.getElementById("mode-badge");
  if(badge){
    badge.textContent=leagueMode==='redraft'?'Redraft Mode':'Dynasty Mode';
    badge.style.background=leagueMode==='redraft'?'rgba(251,191,36,.15)':'rgba(99,102,241,.15)';
    badge.style.color=leagueMode==='redraft'?'var(--yellow)':'var(--accent-bright)';
  }
  updateQuestionsForMode();
}

function updateQuestionsForMode(){
  var isR=leagueMode==='redraft';
  var sub=document.querySelector('.your-sub');
  if(sub) sub.textContent=isR
    ?'Three quick questions so the verdict fits YOUR season, not a generic one.'
    :'Three quick questions so the verdict fits YOUR team, not a generic one.';

  var q0=document.getElementById('yq0-text'),h0=document.getElementById('yq0-hint'),o0=document.getElementById('yq0-opts');
  var q1=document.getElementById('yq1-text'),h1=document.getElementById('yq1-hint'),o1=document.getElementById('yq1-opts');
  var q2=document.getElementById('yq2-text'),h2=document.getElementById('yq2-hint'),o2=document.getElementById('yq2-opts');

  if(isR){
    // Approved redraft set. Option indices are remapped to the verdict's
    // situation/reason semantics inside showYouVerdict (feel already aligns).
    if(q0) q0.textContent="What's your read on your team this year?";
    if(h0) h0.textContent='Redraft is this season only - this sets how much risk is worth taking';
    if(o0) o0.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,0,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Contender - I like this roster to make a run</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,1)"><span class="q-opt-key">B</span><span class="q-opt-text">In the mix - a piece or two away</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,2)"><span class="q-opt-key">C</span><span class="q-opt-text">Middle - could go either way</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,3)"><span class="q-opt-key">D</span><span class="q-opt-text">Longshot - thin or slow start, swinging for upside</span></div>';
    if(q1) q1.textContent="What's this trade for?";
    if(h1) h1.textContent='The best trades fix a real lineup problem, not a bench one';
    if(o1) o1.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,1,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Fill a hole in my starting lineup</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,1)"><span class="q-opt-key">B</span><span class="q-opt-text">Upgrade a spot I am already fine at</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,2)"><span class="q-opt-key">C</span><span class="q-opt-text">Sell a hot player before he cools</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,3)"><span class="q-opt-key">D</span><span class="q-opt-text">Buy a struggling stud at a discount</span></div>';
    if(q2) q2.textContent='Gut check - how does it feel?';
    if(h2) h2.textContent='Your gut knows things the numbers do not';
    if(o2) o2.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,2,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Love it, just want a sanity check</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,1)"><span class="q-opt-key">B</span><span class="q-opt-text">Could go either way</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,2)"><span class="q-opt-key">C</span><span class="q-opt-text">Something feels off</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,3)"><span class="q-opt-key">D</span><span class="q-opt-text">Honestly, I am forcing it</span></div>';
  } else {
    if(q0) q0.textContent='Where are you in your dynasty window?';
    if(h0) h0.textContent='No wrong answers, the same trade can be great for one team and awful for another';
    if(o0) o0.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,0,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Contending. My window is open and I want the title this year</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,1)"><span class="q-opt-key">B</span><span class="q-opt-text">Building. Young core, one more offseason from being scary</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,2)"><span class="q-opt-key">C</span><span class="q-opt-text">Rebuilding. Stacking picks and young guys, patience mode</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,0,3)"><span class="q-opt-key">D</span><span class="q-opt-text">Honestly? Stuck somewhere in the middle</span></div>';
    if(q1) q1.textContent='What is this trade actually for?';
    if(h1) h1.textContent='What is actually driving this move?';
    if(o1) o1.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,1,0)"><span class="q-opt-key">A</span><span class="q-opt-text">I am hunting one specific player on their roster</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,1)"><span class="q-opt-key">B</span><span class="q-opt-text">They offered, and I am deciding if the price is fair</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,2)"><span class="q-opt-key">C</span><span class="q-opt-text">I have a weak spot that keeps costing me matchups</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,1,3)"><span class="q-opt-key">D</span><span class="q-opt-text">One of my guys is at peak value and I want out at the top</span></div>';
    if(q2) q2.textContent='If this trade goes through, how will you feel in a month?';
    if(h2) h2.textContent='Your gut knows things the spreadsheets do not';
    if(o2) o2.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,2,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Relieved. Been wanting to move these guys for a while</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,1)"><span class="q-opt-key">B</span><span class="q-opt-text">Fine. Good players, just not MY guys</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,2)"><span class="q-opt-key">C</span><span class="q-opt-text">I would miss them. These are my building blocks</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,3)"><span class="q-opt-key">D</span><span class="q-opt-text">The math says yes but my gut keeps whispering no</span></div>';
  }

  // Pick-aware wording: if the deal involves a draft pick, the player-centric
  // questions ("hunting a player", "I'd miss my guys") read wrong. Reword them
  // WITHOUT changing what each A/B/C/D means, so the verdict logic is untouched.
  var pk=_tradePicks();
  if(pk.get&&q1&&o1){
    // You're acquiring draft capital - Q1 option A ("hunting a player") doesn't fit.
    var a1=o1.querySelector('.q-opt .q-opt-text');
    if(a1)a1.textContent=isR?'Turning a player into future flexibility':'Selling a player for draft capital to build with';
  }
  if(pk.give&&q2&&o2){
    // You're moving a pick - "how much do they ride your bench / I'd miss them"
    // makes no sense for a pick. Same feel scale (fine / hesitant / regret / numbers).
    if(q2)q2.textContent='How do you feel about moving that pick?';
    if(h2)h2.textContent='A pick is potential; a proven player is points now';
    o2.innerHTML=''+
      '<div class="q-opt" onclick="selectYou(this,2,0)"><span class="q-opt-key">A</span><span class="q-opt-text">Good. I would rather have the proven player than the pick</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,1)"><span class="q-opt-key">B</span><span class="q-opt-text">Fine. Solid return for a lottery ticket</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,2)"><span class="q-opt-key">C</span><span class="q-opt-text">Torn. That pick could turn into a star</span></div>'+
      '<div class="q-opt" onclick="selectYou(this,2,3)"><span class="q-opt-key">D</span><span class="q-opt-text">Only for the value - my gut says keep the pick</span></div>';
  }
}
// Does the current trade involve a draft pick on either side?
function _tradePicks(){
  var g=false,t=false;
  try{
    document.querySelectorAll('#give-players input').forEach(function(i){if(/round|pick/i.test(i.value))g=true;});
    document.querySelectorAll('#get-players input').forEach(function(i){if(/round|pick/i.test(i.value))t=true;});
  }catch(_){}
  return {give:g,get:t};
}

function parseLeagueFormat(info){
  if(!info)return;
  var positions=info.roster_positions||[];
  var scoring=info.scoring_settings||{};
  var hasSuperFlex=positions.indexOf('SUPER_FLEX')>=0;
  var has2QB=(positions.filter(function(p){return p==='QB';}).length)>=2;
  var flexCount=positions.filter(function(p){return p==='FLEX';}).length;
  var recFlexCount=positions.filter(function(p){return p==='REC_FLEX';}).length;
  var numQBs=positions.filter(function(p){return p==='QB';}).length;
  var numRBs=positions.filter(function(p){return p==='RB';}).length;
  var numWRs=positions.filter(function(p){return p==='WR';}).length;
  var numTEs=positions.filter(function(p){return p==='TE';}).length;
  var benchSpots=positions.filter(function(p){return p==='BN';}).length;
  var ppr=scoring.rec!=null?scoring.rec:1;
  // the rules that re-price positions: 6pt passing TDs, TE premium, first downs
  var passTd=scoring.pass_td!=null?Number(scoring.pass_td):4;
  var tePrem=Number(scoring.bonus_rec_te||0);
  var fdBonus=Object.keys(scoring).some(function(k){return /(^|_)fd(_|$)|first_down/.test(k)&&Number(scoring[k])>0;});
  var scoringLabel=ppr>=1?'Full PPR':ppr>=0.5?'Half PPR':'Standard';
  var totalTeams=info.total_rosters||12;
  var modeStr=hasSuperFlex?'SuperFlex':has2QB?'2QB':flexCount>1?flexCount+'-FLEX':'Standard';
  var formatLabel=modeStr+' · '+totalTeams+' teams · '+scoringLabel;
  leagueFormat={
    totalTeams:totalTeams,rosterPositions:positions,hasSuperFlex:hasSuperFlex,
    has2QB:has2QB||hasSuperFlex,flexCount:flexCount,recFlexCount:recFlexCount,
    numQBs:numQBs,numRBs:numRBs,numWRs:numWRs,numTEs:numTEs,
    benchSpots:benchSpots,ppr:ppr,scoringLabel:scoringLabel,formatLabel:formatLabel,
    passTd:passTd,tePrem:tePrem,fdBonus:fdBonus
  };
  try{
    var _ur=document.getElementById('md-uselg-row');if(_ur)_ur.style.display='flex';
    var _uc=document.getElementById('md-uselg');if(_uc)_uc.checked=localStorage.getItem('tm_mock_uselg')!=='0';
    var _lc=document.getElementById('md-lg-current');
    if(_lc){
      _lc.style.display='flex';
      var _n=document.getElementById('md-lg-name');if(_n)_n.textContent=leagueName||'your league';
      var _f=document.getElementById('md-lg-fmt');if(_f)_f.textContent=formatLabel?'('+formatLabel+')':'';
    }
    // switching leagues mid-session re-prefills teams/scoring/format too
    if(typeof mdPrefillFromLeague==='function')mdPrefillFromLeague();
  }catch(_){}
}

// League switching from the mock setup: same loadLeague flow the rest of
// the app uses - settings, rosters and the "drafting for" line all follow
function mdSwitchLeague(){
  var box=document.getElementById('md-lg-list');
  if(!box)return;
  if(box.style.display!=='none'){box.style.display='none';return;}
  var ls=window._myLeagues||[];
  if(!ls.length){box.innerHTML='<div style="padding:10px 12px;font-size:11.5px;color:var(--muted)">No other leagues on this account.</div>';box.style.display='block';return;}
  box.innerHTML=ls.map(function(l){
    var active=l.league_id===leagueId;
    var nm=(l.name||'League').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return '<div style="padding:9px 12px;cursor:pointer;font-size:12.5px;'+(active?'color:var(--accent-bright);font-weight:700':'color:var(--text)')+'" '
      +'onclick="mdPickLeague(\''+l.league_id+'\')">'+(active?'&#9679; ':'')+nm
      +' <span style="font-size:10px;color:var(--muted)">'+(l.season||'')+'</span></div>';
  }).join('');
  box.style.display='block';
}
async function mdPickLeague(lid){
  var box=document.getElementById('md-lg-list');
  if(box)box.style.display='none';
  if(lid===leagueId)return;   // same league: keep whatever they already typed
  var _n=document.getElementById('md-lg-name');if(_n)_n.textContent='switching...';
  // Different league now - the old "how does your league draft" notes belong to
  // the previous league, so wipe the box (and its confirmation line) clean.
  var _cb=document.getElementById('md-context');if(_cb)_cb.value='';
  var _cr=document.getElementById('md-context-read');if(_cr){_cr.textContent='';_cr.style.display='none';}
  try{await switchToLeague(lid);}catch(_){}
  // switchToLeague scrolls back to the analyzer; return to the mock setup so the
  // Start button stays in view instead of getting scrolled off.
  try{switchScreen('mock');mdShowSection('solo');mdPrefillFromLeague();
    setTimeout(function(){var s=document.getElementById('md-start-btn');if(s)s.scrollIntoView({behavior:'smooth',block:'center'});},120);
  }catch(_){}
}

// EVERYTHING the connected league's settings say about how its drafts go:
// scoring rules that re-price positions, starter slots that raise demand,
// and whether the league even rosters kickers or defenses.
function _mdLeagueAdjust(){
  var out={bias:{},notes:[],noK:false,noD:false};
  var lf=window.leagueFormat;if(!lf)return out;
  if(lf.passTd>=5)out.notes.push(lf.passTd+'pt passing TDs: high-passTD QBs rise most');
  if(lf.tePrem>0){out.bias.TE=1.15;out.notes.push('TE premium');}
  if(lf.fdBonus){out.bias.RB=1.05;out.bias.WR=Math.max(out.bias.WR||1,1.05);out.notes.push('first-down points');}
  if(lf.numWRs>=3){out.bias.WR=Math.max(out.bias.WR||1,1.06);out.notes.push(lf.numWRs+' WR starters');}
  if(lf.numRBs>=3){out.bias.RB=Math.max(out.bias.RB||1,1.06);out.notes.push(lf.numRBs+' RB starters');}
  if(lf.numTEs>=2){out.bias.TE=Math.max(out.bias.TE||1,1.1);out.notes.push(lf.numTEs+' TE starters');}
  if(lf.recFlexCount>0){out.bias.WR=Math.max(out.bias.WR||1,1.04);out.bias.TE=Math.max(out.bias.TE||1,1.04);out.notes.push('receiver flex');}
  var rp=lf.rosterPositions||[];
  if(rp.length){
    if(rp.indexOf('K')<0){out.noK=true;out.notes.push('no kicker slot');}
    if(rp.indexOf('DEF')<0){out.noD=true;out.notes.push('no defense slot');}
  }
  return out;
}
function mdLeagueOff(){
  localStorage.setItem('tm_mock_uselg','0');
  var c=document.getElementById('md-uselg');if(c)c.checked=false;
  var n=document.getElementById('md-lg-note');
  if(n)n.textContent='League settings off. Restart the draft for a generic room.';
}

function playerTierLabel(ktcVal, pid){
  var isR=leagueMode==='redraft';
  // Position rank beats raw value when we have it: a top-20 RB is a starter no
  // matter what the absolute number says, and 2QB leagues re-price QBs entirely.
  var fc=pid&&ktcFull[pid];
  if(fc&&fc.positionRank&&allPlayers[pid]){
    var pos=allPlayers[pid].pos,r=fc.positionRank;
    if(r<=5)return{label:'a top-5 '+pos+' - elite at the position',rank:5,short:'elite'};
    if(r<=12)return{label:'a clear starter - '+pos+' #'+r,rank:4,short:pos+' #'+r};
    if(r<=24)return{label:'a weekly starter - '+pos+' #'+r,rank:3,short:pos+' #'+r};
    if(r<=36)return{label:'a rotation player with a real role',rank:2,short:pos+' #'+r};
    return{label:'a bench player with upside to earn more',rank:1,short:pos+' #'+r};
  }
  if(!ktcVal||ktcVal<50)return{label:isR?'a fringe add - unlikely to help much this season':'a speculative stash',rank:0,short:'stash'};
  // Live percentile cutoffs (top 5/15/30/50% of the valued pool, computed at
  // value-load time in fetchKtcValues) with the historical absolute numbers
  // as the fallback for the first paint before values land.
  var _c=window._tierCuts;
  if(ktcVal>=(_c?_c.elite:7000))return{label:isR?'a must-start elite - top tier weekly producer':'genuinely elite - one of the most valuable players in all of dynasty',rank:5,short:'elite'};
  if(ktcVal>=(_c?_c.premium:5500))return{label:isR?'a high-end starter - strong weekly floor':'a premium dynasty player',rank:4,short:'premium'};
  if(ktcVal>=(_c?_c.starter:4000))return{label:isR?'a solid starter - reliable weekly scorer':'a strong starter',rank:3,short:'starter'};
  if(ktcVal>=(_c?_c.roster:2500))return{label:isR?'a flex-worthy option':'a solid roster player',rank:2,short:'roster'};
  return{label:isR?'a matchup-based option':'a bench stash',rank:1,short:'bench'};
}

var PLAYER_NOTES = {
  // ── QBs ── (updated July 2026: 2025 season + 2026 offseason)
  "josh allen": {note:"~3,668 pass yds + 41 total TDs in 2025 with the fewest turnovers of his career; lost 33-30 in OT to Denver in the Divisional Round; ESPN's #1 QB entering 2026 - ahead of Mahomes for the first time since 2022", curve:"30 - peak prime; locked-in dynasty QB1"},
  "lamar jackson": {note:"injury-wrecked 2025 - hamstring in Week 4 plus toe/ankle/back; only 2,311 pass yds and career-low rushing volume; missed the final 5 games and the Wild Card loss to Cincinnati; still elite when healthy", curve:"29 - first real injury data point; buy-low if you trust the profile"},
  "patrick mahomes": {note:"tore his ACL Week 15 of 2025 - KC missed the playoffs for the first time in his starting career; had a career-high 422 rush yds before the injury; on track for Week 1 2026 and KC traded for Justin Fields as insurance", curve:"30 - buy-low window if you trust the ACL recovery"},
  "jalen hurts": {note:"3,224 pass yds, 25 TD, 8 rush TDs in 2025; Eagles lost the Wild Card to the 49ers; OC fired - Sean Mannion now runs a Shanahan-style offense in Philly, the swing variable for 2026", curve:"27 - prime; rushing TD floor intact"},
  "jayden daniels": {note:"disaster 2025 - knee, hamstring, and a twice-injured elbow limited him to 7 games and 1,262 pass yds; Kingsbury fired, new OC redesigned the scheme to protect him; talent is fully intact", curve:"25 - buy-low aggressively; injury year, not a decline year"},
  "cj stroud": {note:"3,041 yds in 14 games in 2025 with career lows, then threw 4 INTs in the Divisional Round exit; HOU rebuilt the O-line with 3 new starters and traded for David Montgomery - environment finally improving", curve:"25 - hold; year-4 bounce-back setup is real"},
  "caleb williams": {note:"broke out under Ben Johnson in 2025 - franchise-record 3,942 pass yds, 27/7 TD-INT; Bears won the NFC North and their first playoff game since 2010; ascending fast", curve:"24 - rising; arguably a top-5 dynasty QB now"},
  "jordan love": {note:"best season of his career in 2025 - 3,381 yds, 23/6, top-3 in QBR, third straight playoff berth; efficient but no rushing production caps the fantasy ceiling", curve:"27 - hold; high floor, modest ceiling"},
  "dak prescott": {note:"led the NFL in completions, attempts and yards (~4,550) with 30 TDs in 2025 - fantasy QB6 - but Dallas missed the playoffs again on a league-worst scoring defense", curve:"32 - win-now piece only; dynasty sell at value"},
  "brock purdy": {note:"only 9 games in 2025 (2,167 yds, 20 TD) but graded 4th among QBs by PFF; 49ers won their Wild Card game; efficiency is elite - availability is now the question", curve:"26 - hold; scheme-boosted floor, health variable"},
  "cam ward": {note:"rookie year on a 3-14 Titans team: 3,169 yds, 15 TD behind an NFL-worst 55 sacks; 10 of his 15 TDs came from Week 11 on - the late-season arrow points up; TEN drafted WR Carnell Tate #4 overall to help", curve:"24 - cautious rise; supporting cast was the problem"},
  "shedeur sanders": {note:"took over mid-season in CLE - 7/10 TD-INT in 8 games with one 364-yd, 3-TD spike week; in an open camp battle under new HC Todd Monken; no first-round rookie QB was added", curve:"24 - speculative hold; no guaranteed 2026 job"},
  // gap-fill batch (July 2026): the top of the superflex/PPR board was going
  // note-less in round 1, which left Mac's Take and Keep-in-mind empty
  "drake maye": {note:"year-2 leap in 2025 - among the league leaders in completion percentage and EPA, dragged New England back to relevance; adds steady if unspectacular rushing; the arrow points straight up", curve:"23 - ascending; top-5 dynasty QB trajectory", curveRed:"a top-5 upside pick THIS season; efficiency plus a stable rushing floor"},
  "justin herbert": {note:"top-10 fantasy production in most of his healthy seasons on pure arm talent; Harbaugh's run-lean shape caps the weekly ceiling more than the player does; high floor, muted spike weeks", curve:"28 - prime; value tracks the offense's pass rate", curveRed:"high-floor QB1 range; ceiling depends on pass volume, not talent"},
  "jaxon smithnjigba": {note:"led the NFL in receiving yards in 2025 - a target-monopoly season with Sam Darnold; route wins, YAC and volume all elite; the offense runs through him", curve:"24 - cornerstone; top-3 dynasty WR conversation", curveRed:"alpha target share locked in; WR1-overall upside this season"},
  "jaxson dart": {note:"took the Giants' starting job as a rookie in 2025 and kept it - dual-threat flashes with rushing TDs in bunches; year two comes with a full offseason as the unquestioned QB1", curve:"23 - riser; rushing floor makes the profile", curveRed:"Konami-code upside pick; the rushing production is the fantasy case"},
  "nico collins": {note:"Houston's alpha X with back-to-back seasons among the league's best in yards per route run; elite target quality whenever he is on the field - availability is the only knock", curve:"27 - prime window; value rides Stroud's arrow", curveRed:"target-quality WR1 when active; price in a couple of missed weeks"},
  "tee higgins": {note:"paid in Cincinnati and still the most dangerous 1B in football; the whole offense sagged with Burrow hurt in 2025, but his per-target efficiency with Burrow healthy is WR1-adjacent", curve:"27 - prime; tied to Burrow's health", curveRed:"WR2 price with WR1 weeks if Burrow stays upright - a health bet worth making"},
  "jameson williams": {note:"top of the league in yards per catch again in 2025 and Detroit fed him a career-high target load; boom-bust week to week, but the booms win weeks outright", curve:"25 - ascending deep threat; role still growing", curveRed:"volatile WR2/3 with league-winning spike weeks; start him and live with it"},
  // ── RBs ──
  "christian mccaffrey": {note:"monster 2025: 2,126 scrimmage yds and 17 TDs on a career-high 413 touches, all 17 games; turned 30 in June 2026 and SF says it wants to cut his workload - history is brutal on 400-touch age-30 seasons", curve:"30 - sell-high window is right now"},
  "saquon barkley": {note:"big 2025 disappointment - 1,140 rush yds and 9 TDs, finishing RB14; touches down ~140 from his historic 2024; still the highest-paid RB but the efficiency arrows point down", curve:"29 - falling; sell to a contender while the name value holds"},
  "bijan robinson": {note:"1,478 rush yds at 5.1 YPC plus 79 catches for 820 yds and 11 TDs in 2025; second Pro Bowl; market-topping extension expected before the 2026 season", curve:"24 - dynasty cornerstone; prime years all ahead"},
  "de'von achane": {note:"led the NFL at 5.7 YPC with 1,350 rush yds and 12 TDs in 2025 - highest PFF RB grade in football; Miami paid him: 4yr/$64M extension in May 2026", curve:"24 - rising; elite efficiency now backed by elite volume"},
  "jahmyr gibbs": {note:"1,223 rush yds, 77 catches and 18 total TDs in 2025 even as Detroit slipped to 9-8; fifth-year option exercised and a top-of-market extension is expected", curve:"24 - elite hold; one of the safest RB holds in dynasty"},
  "breece hall": {note:"first career 1,000-yd season in 2025 (1,065 yds) but only 5 TDs in a weak Jets offense; franchise-tagged then re-signed 3yr/$45.75M - the job is secure, the ceiling is the offense", curve:"25 - hold; paid and locked in, TD upside capped"},
  "kyren williams": {note:"third straight 1,000-yd season - 1,252 yds and 13 total TDs in 2025; Rams reached the NFC Championship before losing to eventual-champion Seattle; volume is bankable", curve:"25 - hold; TD-dependent but volume-secure"},
  "james cook": {note:"2025 NFL rushing champion - 1,621 yds and 14 total TDs in Buffalo's elite offense; modest receiving role is the only thing between him and the top tier", curve:"26 - hold/slight rise; volume king in the right offense"},
  "derrick henry": {note:"still defying age: 1,595 yds at 5.2 YPC with 16 rush TDs in 2025 at age 31; Ravens missed the playoffs on a Week 18 missed FG; every year is borrowed time now", curve:"32 - win-now only; do not pay dynasty prices"},
  "jonathan taylor": {note:"led the NFL with 323 carries, 18 rush TDs and 20 total TDs in 2025; Colts collapsed from 8-2 to 8-9; TD regression from 20 is near-certain - the sell-high window is open", curve:"27 - sell-high; elite volume, aging curve approaching"},
  "josh jacobs": {note:"929 yds and 14 TDs in 2025, but arrested in May 2026 on domestic-abuse-related counts including a felony charge - suspension risk is unresolved and real", curve:"28 - falling; legal risk on top of declining efficiency"},
  "alvin kamara": {note:"career-worst 2025 - 471 rush yds, 1 TD, last among all RBs in PFF grade; Saints signed Travis Etienne and are shopping him; Kamara has hinted he'd rather retire than relocate", curve:"30 - near-droppable; murky role and roster status"},
  "ashton jeanty": {note:"PFWA All-Rookie in 2025: 1,321 scrimmage yds and 10 TDs despite a bad Raiders offense and 3.7 YPC behind a poor OL; LV drafted QB Fernando Mendoza #1 overall - the offense should improve around him", curve:"22 - rising; efficiency was capped by context, not talent"},
  // ── WRs ──
  "justin jefferson": {note:"career-worst 84-1,048-2 in 2025 - dragged down entirely by Minnesota's QB carousel; still extended his streak to 6 straight 1,000-yd seasons to open a career; talent has not moved an inch", curve:"27 - buy-low of the decade if you believe the QB gets fixed"},
  "jamarr chase": {note:"125 catches, 1,412 yds on a league-high 185 targets in 2025 - first-team All-Pro again; the Bengals passing game runs through him at the highest paid-WR rate in football", curve:"26 - elite hold; top-2 dynasty WR, no debate"},
  "ceedee lamb": {note:"75-1,077-3 in 14 injury-shortened games in 2025 - his 5th straight 1,000-yd season, but George Pickens (93-1,429-9, All-Pro) out-produced him and was franchise-tagged to stay", curve:"27 - hold; target competition is real for the first time"},
  "amon-ra st brown": {note:"117 catches, 1,401 yds and 11 TDs in 2025 - a top-3 fantasy WR yet again even as Detroit missed the playoffs; first fully healthy offseason in two years", curve:"27 - elite hold; the most reliable PPR machine in football"},
  "garrett wilson": {note:"knee injuries limited him to 7 games (36-395-4) in 2025 - hyperextension, re-injury, then shut down; expected fully healthy for 2026 camp; the Jets QB situation is still the cap on his value", curve:"25 - buy-low; talent intact, situation pending"},
  "brian thomas jr": {note:"major sophomore slump - 48-707-2 in 2025 after his historic rookie year; the age, draft capital and rookie tape all argue for a bounce; classic buy-low profile", curve:"24 - buy the dip before the bounce-back"},
  "malik nabers": {note:"tore his ACL and meniscus in Week 4 of 2025; a second scar-tissue surgery means he opens 2026 camp on PUP and could miss the first month; tied to ascending QB Jaxson Dart (15:5 TD-INT as a rookie)", curve:"22 - hold through the noise; 23-year-old alphas recover"},
  "drake london": {note:"68-919-7 with a top-5 PFF receiving grade in 2025; Atlanta made him the 3rd-highest-paid WR in football (4yr/$141M, $100M guaranteed) - total organizational commitment", curve:"24 - rising; QB is the only drag on a locked-in alpha"},
  "ladd mcconkey": {note:"sophomore dip to 66-789-6 in 2025 behind a collapsing Chargers OL and Keenan Allen's 122 targets - then exploded for 9-197-1 in the playoff loss; Allen is gone in 2026 and the target tree opens up", curve:"24 - buy-low; the volume is coming back"},
  "marvin harrison jr": {note:"another lost year - 41-608-4 in 12 games through appendicitis, heel injuries and a concussion; Arizona is rebuilding post-Kyler Murray and MHJ is in ACTIVE trade rumors; landing spot will swing his value hard", curve:"24 - volatile; the talent bet is still live but needs a home"},
  "rome odunze": {note:"44-661-6 before a heel injury ended his 2025 in Week 9; Chicago traded DJ Moore away this offseason and Odunze is the clear X receiver - though fellow sophomore Luther Burden also grows into a bigger role, so the vacated targets get split two ways", curve:"24 - rising; a real share bump, but not the whole pie"},
  "puka nacua": {note:"NFL-best 129 receptions and 1,715 yds (2nd in the league) with 10 TDs in 2025 - first-team All-Pro; the only long-term question is who replaces Stafford eventually", curve:"25 - top-3 dynasty WR; hold at any price"},
  "tyreek hill": {note:"dislocated his knee with ACL damage in Week 4 of 2025, then Miami released him in March 2026; still unsigned in July and may not play at all this season", curve:"31 - near-zero dynasty value; dart throw only"},
  "davante adams": {note:"789 yds but a league-leading 14 receiving TDs opposite Nacua in the Rams' NFC Championship run; still a red-zone monster at 33", curve:"33 - win-now piece only; sell in dynasty if anyone pays"},
  "stefon diggs": {note:"bounced back with an 85-1,013-4 Pro Bowl season catching from Drake Maye in 2025 - then New England released him in March and traded for AJ Brown instead; still unsigned in July 2026", curve:"32 - productive but homeless; wait for a landing spot"},
  "dk metcalf": {note:"59-850-6 in 2025, then a 2-game suspension for an altercation with a fan voided $25M in guarantees; Pittsburgh reaffirmed commitment but also traded for Michael Pittman Jr - target competition rising", curve:"28 - hold with caution; leverage and target share both dented"},
  "devonta smith": {note:"77-1,008-4 in 2025 and the clear #1 in Philadelphia after the AJ Brown trade to New England; one watch-out is the Eagles spending a high pick on rookie WR Makai Lemon, so the target share won't be uncontested for long", curve:"27 - rising, but a rookie WR now shares the room"},
  "aj brown": {note:"traded to the Patriots in June 2026 after a frustrated 78-1,003-7 final season in Philly; now catching from Drake Maye - a genuine volume and QB upgrade at the cost of a new system at 29", curve:"29 - mild rise; the situation finally matches the talent again"},
  "jaylen waddle": {note:"64-910-6 as Miami's top option in 2025 after the Hill injury, then traded to Denver in March 2026; the Bo Nix pairing is decent - value flat pending role clarity", curve:"27 - hold; new team, similar profile"},
  "cooper kupp": {note:"modest 47-593 regular season as Seattle's #2, but led the Seahawks in receiving in two playoff games including the Super Bowl LX win; explicitly not retiring", curve:"33 - ring-chasing veteran; fantasy WR4/5 at best"},
  "keenan allen": {note:"81 catches on 122 targets in 2025 (11th in the NFL in receptions) - then hit free agency at 34 and remains unsigned in July 2026", curve:"33 - end-of-career volume compiler with no team"},
  "travis hunter": {note:"two-way rookie year cut short - 28-298-1 on offense plus CB snaps in 7 games before LCL surgery; fully cleared and Jacksonville reportedly plans to 'unleash' him in 2026", curve:"23 - buy-low on generational talent; usage is the wildcard"},
  "tetairoa mcmillan": {note:"2025 Offensive Rookie of the Year - 70-1,014-7 in 17 starts for Carolina at 14.5 yds a catch; ascending with Bryce Young", curve:"23 - rising fast; top-10 dynasty WR trajectory"},
  "luther burden iii": {note:"47-652-2 as a rookie with an elite-YAC heater to close (21-324-1 over the final 4 games); DJ Moore is gone and Burden's role expands next to Odunze in a breakout Bears offense", curve:"22 - prime 2026 breakout candidate; buy now"},
  // ── TEs ──
  "travis kelce": {note:"still led KC with 76-851-5 in 2025, then re-signed for three more years in March 2026 - his age-37 season; did not retire but the long-term value is zero", curve:"36 - win-now piece only; TE1-fringe weeks remain"},
  "brock bowers": {note:"injury-marred 2025 - 64-680-7 in 12 games on a lingering knee, finished on IR; Raiders drafted QB Fernando Mendoza #1 overall, the QB upgrade he's been waiting for", curve:"23 - elite buy-low; the dynasty TE1 when healthy"},
  "trey mcbride": {note:"broke the single-season TE reception RECORD with 126 catches, 1,239 yds and 11 TDs in 2025 - first-team All-Pro, first TE ever with back-to-back 100-catch seasons", curve:"26 - elite TE1 in his prime; hold forever"},
  "sam laporta": {note:"season ended by a herniated disc and back surgery after 9 games (40-489-3) in 2025; expected fully ready for 2026 camp and widely tabbed as a resurgence candidate", curve:"25 - buy-low TE1 candidate; injury, not decline"},
  "george kittle": {note:"PFF's #1 graded TE in 2025 (57-628-7 in 11 games) - then tore his Achilles in the Wild Card win; aiming for Week 1 2026 but an Achilles at 32 is a serious flag", curve:"32 - high risk; do not pay for the name"},
  "mark andrews": {note:"career-low 48-422-5 in 2025 but signed a 3-year extension, and both Isaiah Likely and Charlie Kolar left in free agency - his target share should rebound under a new OC", curve:"30 - bounce-back TE2 with TE1 upside; cheap"},
  "jake ferguson": {note:"career-high 82 catches in 2025 but only 600 yds - TE1 through Week 7, TE22 after; Lamb and Pickens combine for 250 targets in Dallas", curve:"27 - volume-based mid-TE; low ceiling"},
  // ── 2026 Rookie Class ──
  "fernando mendoza":  {note:"#1 overall pick in the 2026 draft to the Raiders; likely Year 1 starter with Bowers and Jeanty around him; consensus rookie 1.02 in dynasty (1.01 in Superflex)", curve:"22 - dynasty buy; the situation is better than most #1 picks get"},
  "jeremiyah love":    {note:"#3 overall to Arizona - the consensus dynasty rookie 1.01 with a wide gap to 1.02; described as a league-swinging RB talent out of Notre Dame", curve:"21 - dynasty RB cornerstone; pay whatever it costs"},
  "carnell tate":      {note:"#4 overall to Tennessee - first WR off the board in 2026; pairs with ascending Cam Ward as the Titans rebuild the offense", curve:"21 - dynasty buy; instant alpha path"},
  "jordyn tyson":      {note:"#8 overall to New Orleans; top-5 dynasty rookie in 2026 class rankings", curve:"21 - dynasty buy; draft capital and profile both check out"},
  "ty simpson":        {note:"#13 overall to the Rams as the presumptive Stafford heir; may sit in 2026 - Superflex stash with a clear runway", curve:"23 - patient hold; the seat opens soon"},
  "kenyon sadiq":      {note:"#16 overall to the Jets - only Round 1 TE in 2026; ran a 4.39 forty, the fastest TE combine time in 20+ years; clear rookie TE1 in dynasty", curve:"21 - dynasty TE buy; rare athletic profile"},
  "makai lemon":       {note:"#20 overall to Philadelphia; ranked ~4th in dynasty rookie rankings despite the later slot - some of the AJ Brown target vacuum is his, but DeVonta Smith is the entrenched #1, so it is a share, not a handoff", curve:"22 - dynasty buy; landing spot is good, not a clear runway"},
  "kc concepcion":     {note:"#24 overall to Cleveland; top-8 dynasty rookie with immediate slot-role projection", curve:"21 - dynasty buy; volume path is open on a rebuilding roster"}
};

// Mode-aware read of a note: a redraft user is asking about THIS season, so
// the dynasty curve line steps aside unless a redraft line (curveRed) exists.
function noteForMode(entry){
  if(!entry)return null;
  var isR=(typeof leagueMode!=='undefined'&&leagueMode==='redraft');
  return {note:entry.note,curve:isR?(entry.curveRed||null):(entry.curve||null)};
}
// One trend vocabulary for the whole product: thresholds and words come from
// here so a card can never say "Falling" in one corner and "Stable" in another.
function trendLabel(t){
  var n=Number(t)||0;
  if(n>250)return {word:'Rising fast',dir:1};
  if(n>60)return {word:'Rising',dir:1};
  if(n<-250)return {word:'Falling fast',dir:-1};
  if(n<-60)return {word:'Falling',dir:-1};
  return {word:'Steady',dir:0};
}
function getPlayerContextNote(name){
  if(!name)return null;
  var key=name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  if(PLAYER_NOTES[key])return PLAYER_NOTES[key];
  var parts=key.split(' ');
  if(parts.length>=2){
    var found=Object.keys(PLAYER_NOTES).find(function(k){
      var kp=k.split(' ');
      return kp[0]===parts[0]&&kp[kp.length-1]===parts[parts.length-1];
    });
    if(found)return PLAYER_NOTES[found];
  }
  return null;
}

function buildScoutBlock(inputEls,borderColor){
  var lines=[];
  // Lead the scout take with the highest-value player so it matches the
  // headliner named in the verdict body, the VS battle, and the scenarios.
  var ordered=inputEls.slice().sort(function(a,b){
    return (getKtcValue(b.value.trim(),b.dataset.playerId)||0)-(getKtcValue(a.value.trim(),a.dataset.playerId)||0);
  });
  ordered.forEach(function(i){
    var n=i.value.trim();
    if(!n)return;
    var pid=i.dataset.playerId;
    var pos=(pid&&allPlayers[pid])?allPlayers[pid].pos:'?';
    var entry=getPlayerContextNote(n);
    if(entry){
      lines.push('<div style="margin-top:5px;display:flex;gap:7px;align-items:flex-start"><span style="font-size:9px;font-weight:700;padding:2px 5px;border-radius:3px;background:'+borderColor+';color:#fff;white-space:nowrap;margin-top:1px">'+pos+'</span><span style="font-size:11px;color:var(--muted2);line-height:1.5"><strong style="color:var(--text)">'+n+'</strong> - '+entry.note+'<span style="color:var(--muted)"> ('+entry.curve+')</span></span></div>');
    }
  });
  return lines.join('');
}

// Deterministic per-string variant picker: same name -> same phrasing every
// time, but different names spread across the list. Keeps templated prose from
// reading verbatim when two similar players land in one verdict.
function _fmtPick(str,arr){
  var s=String(str||''),h=0;
  for(var i=0;i<s.length;i++){h=((h<<5)-h+s.charCodeAt(i))|0;}
  return arr[Math.abs(h)%arr.length];
}

function describePlayer(name, pid, pos, ktcVal){
  var isR=leagueMode==='redraft';
  // Draft picks are NOT players - never run tier/position logic on them (that
  // produced junk like "a solid roster player ?"). Describe the pick itself.
  var isPick = pos==='PK' || /\bround\s*\d/i.test(name||'') || /^\s*20\d{2}\s+\d\.\d/.test(name||'');
  if(isPick){
    var ym=(name||'').match(/20\d{2}/); var yr=ym?ym[0]:'';
    var rm=(name||'').match(/round\s*(\d)/i)||(name||'').match(/\b(\d)\.\d{2}/); var rnd=rm?rm[1]:'';
    // The trade already shows "2027 Round 1" - restating "a 2027 first-round rookie
    // pick" is stating the obvious, so just name it.
    return '<strong>'+name+'</strong>';
  }
  var fc=pid?ktcFull[pid]:null;
  var posRank=fc&&fc.positionRank?fc.positionRank:null;
  var rankDesc='';
  var knownPos=(pos&&pos!=='?');
  var pp=knownPos?(' '+pos):'';
  if(isR){
    // REDRAFT: the stored position rank is dynasty-flavored (a young ascending QB
    // can be a dynasty top-3 but a redraft afterthought), so it makes two very
    // different players read the same. Describe by THIS season's value instead -
    // the same number driving the verdict - so the words never contradict it.
    var v=ktcVal||0;
    if(v>=6500) rankDesc='an elite'+pp+' - a must-start every week';
    else if(v>=5000) rankDesc='a strong weekly'+pp+' starter';
    else if(v>=3500) rankDesc='a solid'+pp+' starter';
    else if(v>=2000) rankDesc='a back-end'+pp+' starter';
    else if(v>=800) rankDesc='a matchup-based'+pp+' option';
    else rankDesc='a deep-league'+pp+' flier';
  } else if(posRank){
    // Dynasty: the position rank IS the right dataset here - name it exactly.
    var tag=posRank<=3?'an elite ':posRank>48?'a deep-bench ':'the ';
    rankDesc=tag+pos+posRank+' in dynasty';
  } else {
    rankDesc = knownPos ? (playerTierLabel(ktcVal).label+' '+pos) : playerTierLabel(ktcVal).label;
  }
  var formatNote='';
  if(leagueFormat.hasSuperFlex&&pos==='QB'){
    if(posRank&&posRank<=8) formatNote=isR?' - elite QB in SuperFlex, hard to replace':' - in SuperFlex leagues top QBs are the most expensive players in the game. Your format amplifies this.';
    else formatNote=' - still worth more in your SuperFlex format than a standard 1QB league';
  } else if(leagueFormat.ppr>=1&&pos==='WR'&&posRank&&posRank<=10){
    // Rotate the PPR note off a stable per-player index so two top-10 WRs in the
    // same verdict never read the exact same sentence (the "verbatim template"
    // tell). Deterministic: the same player always gets the same phrasing.
    formatNote=_fmtPick(name,[
      ', and full PPR turns his target volume into a weekly points floor',
      ', and in full PPR his reception share is worth a tier more than the raw ranking shows',
      ', and your PPR scoring rewards exactly the catches he lives on'
    ]);
  } else if(leagueFormat.ppr>=1&&pos==='RB'&&posRank&&posRank<=10){
    // Same idea for pass-catching backs - vary the phrasing per player so Gibbs
    // and McCaffrey don't get the identical "catches out of the backfield" line.
    formatNote=_fmtPick(name,[
      ', and in full PPR the work he sees in the passing game adds a floor most backs never have',
      ', and your PPR scoring cashes in every checkdown and screen he turns into a reception',
      ', and full PPR rewards his receiving role on top of the carries',
      ', and those catches out of the backfield are worth real points in your PPR format'
    ]);
  }
  // Parenthetical so it slots into any sentence: "Handing over X (a top-3 WR)..."
  return '<strong>'+name+'</strong> ('+rankDesc+formatNote+')';
}

function buildTradeBodyText(giveInputEls, getInputEls, valueTier, ktcGap, oppProfile){
  var giveDescs=giveInputEls.map(function(i){
    var n=i.value.trim(); var pid=i.dataset.playerId;
    var ktcV=getKtcValue(n,pid);
    var pos=(pid&&allPlayers[pid])?allPlayers[pid].pos:'?';
    return describePlayer(n,pid,pos,ktcV);
  });
  var getDescs=getInputEls.map(function(i){
    var n=i.value.trim(); var pid=i.dataset.playerId;
    var ktcV=getKtcValue(n,pid);
    var pos=(pid&&allPlayers[pid])?allPlayers[pid].pos:'?';
    return describePlayer(n,pid,pos,ktcV);
  });
  var oppCtx=' Your opponent ('+oppName(oppProfile)+'): '+oppDesc(oppProfile);
  var isRedraft=leagueMode==='redraft';
  var horizon=isRedraft?'this season':'long-term';
  // Redraft verdicts speak ONLY redraft: who scores more this season. Never
  // mention dynasty, age curves, or long-term anything in a redraft verdict.
  var context=isRedraft?(seasonPhase()==='offseason'
    ?' The only question that matters: who puts up more points this season.'
    :' The only question that matters: who puts up more points'+(seasonPhase()==='stretch'||seasonPhase()==='playoffs'?' down the stretch of your playoff push':' the rest of the way')+'.'):' ';
  var r=Math.floor(Math.random()*5);
  // Three or more players described one by one reads like a ransom note.
  // Name the headliner, sum the rest.
  function sideText(descs,els){
    if(descs.length<=2)return descs.join(' and ');
    var vals=els.map(function(i){return {el:i,v:getKtcValue(i.value.trim(),i.dataset.playerId)||0};})
      .sort(function(a,b){return b.v-a.v;});
    var dsc=function(x){var pid=x.el.dataset.playerId;return describePlayer(x.el.value.trim(),pid,(pid&&allPlayers[pid])?allPlayers[pid].pos:'?',x.v);};
    // Name the two biggest pieces so a multi-player haul actually reads like a
    // multi-player haul - then sum the rest without dismissing them.
    var top=dsc(vals[0]), second=dsc(vals[1]);
    var rest=vals.slice(2);
    if(!rest.length)return top+' and '+second;
    return top+', '+second+', and '+rest.length+' more piece'+(rest.length>1?'s':'');
  }
  var g=sideText(giveDescs,giveInputEls), ge=sideText(getDescs,getInputEls);
  var giveScout=buildScoutBlock(giveInputEls,'rgba(217,138,160,.85)');
  var getScout=buildScoutBlock(getInputEls,'rgba(34,197,94,.8)');
  var scoutBlock='';
  if(giveScout||getScout){
    scoutBlock='<div style="margin-top:10px;padding:10px 12px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">';
    scoutBlock+='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px">Scout\'s Take</div>';
    if(giveScout)scoutBlock+='<div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-bottom:2px">You give</div>'+giveScout;
    if(getScout)scoutBlock+=(giveScout?'<div style="font-size:10px;color:var(--muted);font-weight:600;text-transform:uppercase;margin-top:8px;margin-bottom:2px">You get</div>':'')+''+getScout;
    // Show the methodology right where the read is made, not just in the footer -
    // naming the source is what turns "an opinion" into "a sourced call". No raw
    // numbers: the owner's rule is tier/direction only, never the vendor index.
    scoutBlock+='<div style="margin-top:9px;padding-top:8px;border-top:1px solid var(--border);font-size:10px;color:var(--muted)">Player values from FantasyCalc live market data</div>';
    scoutBlock+='</div>';
  }
  if(valueTier==='getting_fleeced'){
    var fleeced=[
      'This trade is lopsided. You\'re giving '+g+'. You\'re getting back '+ge+'. That gap is glaring - they\'ll accept before you finish typing. Counter completely or walk away.'+context,
      'Hard no. Handing over '+g+' for '+ge+' makes no sense '+horizon+'. The value difference here is not subtle. They\'re getting the better end by a mile.'+context+' '+(leagueMode==='redraft'?'Counter with something that actually helps your lineup this week.':'Come back with a completely different ask.')+'',
      'You\'re giving up more than you\'re getting here. '+g+' for '+ge+' - '+horizon+' that doesn\'t add up. Your opponent will accept this instantly, which is always a tell.'+context+' Don\'t send it.',
      'This is a bad deal for you. Parting with '+g+' and only getting '+ge+' back? The value gap is real. Walk away or completely restructure the offer.'+context,
      'They\'re laughing. You\'re trading '+g+' for '+ge+'. That\'s not a trade, that\'s a gift. Counter or move on - there\'s no version of this that makes sense.'+context
    ];
    return fleeced[r]+scoutBlock;
  } else if(valueTier==='losing'){
    var losing=[
      'You\'re overpaying '+horizon+'. Giving '+g+', getting back '+ge+'. The gap isn\'t massive but it\'s real. Push for a sweetener before you pull the trigger.'+context+oppCtx,
      'Value edge goes to your opponent here. You\'re sending '+g+' for '+ge+' - '+horizon+' you\'re the one giving more. Ask them to add something before you agree.'+context+oppCtx,
      'Not quite balanced. '+g+' for '+ge+' leaves you on the losing end of the ledger. Counter with an addition or adjust what you\'re giving up.'+context+oppCtx,
      'You\'re giving a little more than you\'re getting '+horizon+'. Parting with '+g+', receiving '+ge+'. Hold out for another player to be added - you have leverage.'+context+oppCtx,
      'Slight overpay on your end. Handing over '+g+' for '+ge+' isn\'t robbery, but you\'re leaving value on the table. Make them sweeten the deal.'+context+oppCtx
    ];
    return losing[r]+scoutBlock;
  } else if(valueTier==='even'){
    var even=[
      'Roughly fair deal '+horizon+'. Giving '+g+', getting back '+ge+'. Decision comes down to roster fit and where you are in your window.'+context+oppCtx,
      'This is pretty balanced. '+g+' for '+ge+' - neither side is giving up much more than they\'re getting. If the fit is there, it\'s worth doing.'+context+oppCtx,
      'Lateral move in terms of raw value. You\'re sending '+g+' and receiving '+ge+'. The edge is whether this trade improves your specific roster.'+context+oppCtx,
      'Near-even swap '+horizon+'. '+g+' for '+ge+'. It\'s a fair ask - just make sure it addresses a real need on your team before you agree.'+context+oppCtx,
      'Value is close on both sides. Giving '+g+', getting '+ge+'. No one\'s getting robbed here - but try squeezing a small add before you finalize.'+context+oppCtx
    ];
    return even[r]+scoutBlock;
  } else if(valueTier==='winning'){
    var winning=[
      'You\'re coming out ahead '+horizon+'. You get '+ge+' while giving '+g+'. Value is in your favor - send it.'+context+oppCtx,
      'Edge goes your way. Receiving '+ge+' for '+g+' is a solid return '+horizon+'. Don\'t overthink it - if the fit is there, this is a good trade.'+context+oppCtx,
      'You\'re winning the value battle here. Trading '+g+' for '+ge+' leaves your side with the better players '+horizon+'. Pull the trigger.'+context+oppCtx,
      'This works in your favor. You land '+ge+' and give away '+g+' - the math is on your side '+horizon+'. Move before they reconsider.'+context+oppCtx,
      'Solid pickup. Getting '+ge+' in exchange for '+g+' is a net positive '+horizon+'. Your opponent might be overvaluing what you\'re sending.'+context+oppCtx+' Life is good.'
    ];
    return winning[r]+scoutBlock;
  } else {
    var crushing=[
      'You\'re winning this clearly '+horizon+'. You get '+ge+' for '+g+'. Send this before they change their mind.'+context+oppCtx,
      'This is a big win. Walking away with '+ge+' and only giving up '+g+' is a significant haul '+horizon+'. Lock it in immediately.'+context+oppCtx,
      'Don\'t wait on this one. You\'re getting '+ge+' for '+g+' - that\'s a real value gap in your favor. Your opponent either needs a player badly or just misread the trade.'+context+oppCtx,
      'You\'re robbing them (respectfully). Receiving '+ge+' in exchange for '+g+' is lopsided in your favor '+horizon+'. This is a no-brainer - send it.'+context+oppCtx,
      'Slam dunk '+horizon+'. You get '+ge+' for '+g+'. The value here is strongly in your corner. Hit send and don\'t look back.'+context+oppCtx
    ];
    return crushing[r]+scoutBlock;
  }
}

function normalizeName(n){
  return n.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}

function getKtcValue(name, sleeperId){
  if(!name&&!sleeperId) return 0;
  // 1. Exact match by Sleeper ID (most accurate - no name ambiguity)
  if(sleeperId && ktcById[sleeperId]) return ktcById[sleeperId];
  if(!name) return 0;
  // 2. Exact name match (lowercase)
  var key=name.toLowerCase();
  if(ktcValues[key]) return ktcValues[key];
  // 3. Normalized name match (strips apostrophes, accents)
  var norm=normalizeName(name);
  if(ktcValues[norm]) return ktcValues[norm];
  // 4. Draft picks get explicit handling. Without this, "2026 Round 1" fell
  // through to the substring matcher and hit FantasyCalc's "2026 pick 1.01" -
  // every round-1 pick was priced as the 1.01, round 2 as the 1.02, and so on.
  if(/round\s*\d|pick/i.test(name)){
    // two digits: "2027 Round 10" used to capture the 1 and get priced as a first
    var pm=norm.match(/(\d{4})\s*round\s*(\d{1,2})/)||norm.match(/(\d{4})\s*(\d{1,2})(?:st|nd|rd|th)/);
    if(pm){
      var pYr=pm[1],pRd=pm[2];
      var ck=pYr+':'+pRd;
      if(_pickValCache[ck]!==undefined) return _pickValCache[ck];
      // market value of a generic round-N pick = the average of that round's slots
      var slotKeys=Object.keys(ktcValues).filter(function(k){return k.indexOf(pYr+' pick '+pRd+'.')===0;});
      if(slotKeys.length){var pSum=0;slotKeys.forEach(function(k){pSum+=ktcValues[k];});return (_pickValCache[ck]=Math.round(pSum/slotKeys.length));}
      // that year missing from the feed: same round from any listed year, discounted for distance
      var anyYear=Object.keys(ktcValues).filter(function(k){return /^\d{4} pick \d\./.test(k)&&k.indexOf(' pick '+pRd+'.')>0;});
      if(anyYear.length){var aSum=0;anyYear.forEach(function(k){aSum+=ktcValues[k];});return (_pickValCache[ck]=Math.round((aSum/anyYear.length)*0.85));}
      return (_pickValCache[ck]=0);   // no pick market at all (redraft): a pick is worth nothing here
    }
  }
  // 5. First+last name partial match (avoids false positives from single last name)
  var parts=norm.split(' ');
  if(parts.length>=2){
    var first=parts[0], last=parts[parts.length-1];
    var match=Object.keys(ktcValues).find(function(k){
      return k.indexOf(first)>=0 && k.indexOf(last)>=0;
    });
    if(match) return ktcValues[match];
  }
  return 0;
}

async function loadUser(autoLeagueId){
  var username=document.getElementById("sleeper-username").value.trim();
  if(!username){ setStatus("Enter your Sleeper username first.","var(--red)"); return; }
  var btn=document.querySelector(".btn-load");
  if(btn){btn.disabled=true; btn.textContent="Loading...";}

  function log(msg,color){ setStatus(msg,color||"var(--muted2)"); console.log("[TM]",msg); }

  try{
    var userRes;
    try{ userRes=await fetch("/api/sleeper/user/"+encodeURIComponent(username)); }
    catch(netErr){
      log("Can't reach Sleeper. Check your connection.","var(--red)");
      if(btn){btn.disabled=false;btn.textContent="Connect league →";}
      return;
    }
    if(!userRes.ok){
      log(userRes.status===404?"We could not find that username on Sleeper. It is the handle you log into the Sleeper app with, not your team or league name. If you do not use Sleeper, import an ESPN league below instead.":"Sleeper error. Try again.","var(--red)");
      if(btn){btn.disabled=false;btn.textContent="Connect league →";}
      return;
    }
    var user=await userRes.json();
    if(!user||!user.user_id){
      log("No account found for that username.","var(--red)");
      if(btn){btn.disabled=false;btn.textContent="Connect league →";}
      return;
    }
    userId=user.user_id;
    localStorage.setItem('tm_username', username);
    try{if(window.posthog&&posthog.identify)posthog.identify(username);tmTrack('league_connected',{platform:'sleeper'});}catch(_){}
    try{sageSyncUser();}catch(_){}
    initBK(username);
    updateUserPill();
    // Referral: connecting a real Sleeper league is the un-fakeable action that
    // credits whoever's link brought you here (backend enforces one-per-device etc).
    try{_claimReferralIfPending(username);}catch(_){}

    // Fetch NFL state first so we know the correct current season before requesting leagues
    var state=await sleeperGet("/state/nfl").catch(function(){return null;});
    if(state&&state.league_season){ACTIVE_SEASON=state.league_season;}
    var curSeason=ACTIVE_SEASON;
    var prevSeason=String(parseInt(curSeason)-1);
    var [leagues,prevLeagues]=await Promise.all([
      sleeperGet("/user/"+userId+"/leagues/nfl/"+curSeason).catch(function(){return [];}),
      sleeperGet("/user/"+userId+"/leagues/nfl/"+prevSeason).catch(function(){return [];})
    ]);
    // Combine both seasons, current first. Dedup by league_id then by normalized name
    // (same dynasty league has different IDs across seasons)
    var seenLeagueIds={};
    var seenLeagueNames={};
    var combined=[].concat(leagues||[]).concat(prevLeagues||[]).filter(function(l){
      if(!l||seenLeagueIds[l.league_id])return false;
      seenLeagueIds[l.league_id]=true;
      var norm=(l.name||'').toLowerCase().trim().replace(/\s+\d{4}$/,'').replace(/\s+season\s*\d*/i,'').trim();
      if(norm&&seenLeagueNames[norm])return false;
      if(norm)seenLeagueNames[norm]=true;
      return true;
    });
    leagues=combined;
    window._myLeagues=combined;
    if(!leagues.length){
      log("No leagues found for this account. Make sure you have an active league on Sleeper.","var(--red)");
      if(btn){btn.disabled=false;btn.textContent="Connect league →";}
      return;
    }
    if(btn){btn.disabled=false;btn.textContent="Connect league →";}
    setStatus("");
    renderLeagues(leagues, autoLeagueId);
  }catch(e){
    log("Error: "+e.message,"var(--red)");
    if(btn){btn.disabled=false;btn.textContent="Connect league →";}
  }
}

function renderLeagues(leagues, autoSelectId){
  document.getElementById("league-panel").style.display="block";
  // Bring the league list into view immediately so the user sees the next step
  if(!window._autoRestoring){setTimeout(function(){
    var lp=document.getElementById("league-panel");
    if(lp)scrollToEl(lp,true);
  },100);}
  var list=document.getElementById("league-list");
  list.innerHTML="";
  var savedName=(localStorage.getItem('tm_league_name')||'').toLowerCase().trim();
  var autoCard=null;
  leagues.forEach(function(l){
    var card=document.createElement("div");
    card.className="league-card";
    var season=l.season||ACTIVE_SEASON;
    var status=l.status==="in_season"?"In Season":l.status==="pre_draft"?"Pre-Draft":l.status==="complete"?"Complete":(l.status||"");
    var isDyn=!!((l.settings&&l.settings.type===2)||(l.name||"").toLowerCase().indexOf("dynasty")>=0);
    var modePill='<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:100px;margin-left:6px;background:'+(isDyn?'rgba(99,102,241,.15)':'rgba(251,191,36,.15)')+';color:'+(isDyn?'var(--accent-bright)':'var(--yellow)')+';">'+(isDyn?'Dynasty':'Redraft')+'</span>';
    card.innerHTML="<div><div class='league-card-name'>"+(l.name||"Unnamed")+modePill+"</div><div class='league-card-meta'>"+(l.total_rosters||"?")+" teams · Season "+season+" · "+status+"</div></div><div class='league-card-arrow'>→</div>";
    card.onclick=function(){loadLeague(l.league_id,l.name,l.total_rosters,season);};
    list.appendChild(card);
    // Only auto-select if this league is in the current active season and name matches
    if(!autoCard&&((autoSelectId&&l.league_id===autoSelectId)||(savedName&&(l.name||'').toLowerCase().trim()===savedName&&l.season===ACTIVE_SEASON))) autoCard=card;
  });
  if(autoCard) setTimeout(function(){autoCard.click();},200);
}

async function loadLeague(lid,name,rosters,season){
  var _seq=++_leagueLoadSeq;   // identifies this load; guards late background writes
  resetTradeWorkspace();       // clear the previous league's trade before loading the new one
  leagueId=lid; leagueName=name||leagueName; leagueSeason=season||leagueSeason||ACTIVE_SEASON;
  setStatus("Loading...");

  // Fetch everything in parallel
  var playersNeeded=Object.keys(allPlayers).length===0;
  var [rawPlayers,rosterData,userData,pRes,tRes,leagueInfo]=await Promise.all([
    playersNeeded?sleeperGet("/players/nfl/slim").catch(function(){return null;}):Promise.resolve(null),
    sleeperGet("/league/"+lid+"/rosters").catch(function(){return [];}),
    sleeperGet("/league/"+lid+"/users").catch(function(){return [];}),
    sleeperGet("/league/"+lid+"/traded_picks").catch(function(){return [];}),
    sleeperGet("/league/"+lid+"/all-transactions").catch(function(){return [];}),
    sleeperGet("/league/"+lid).catch(function(){return {};})
  ]);
  // seasons whose draft already RAN produce no tradable picks anymore
  try{
    var drs=await sleeperGet("/league/"+lid+"/drafts").catch(function(){return [];});
    window._doneDraftSeasons={};
    (drs||[]).forEach(function(d){if(d&&d.status==='complete'&&d.season)window._doneDraftSeasons[parseInt(d.season)]=1;});
    // How many rounds THIS league's rookie draft actually has. We were assuming
    // four for everyone, so a league with five or six rounds simply never saw
    // its later picks - they existed on Sleeper and not here.
    var _rr=0;
    (drs||[]).forEach(function(d){
      var n=d&&d.settings&&parseInt(d.settings.rounds);
      if(n>0&&n<=10&&n>_rr)_rr=n;
    });
    window._draftRounds=_rr||0;
  }catch(_){window._doneDraftSeasons={};}

  if(rawPlayers){
    Object.keys(rawPlayers).forEach(function(id){
      var p=rawPlayers[id];
      if(p.fantasy_positions&&p.fantasy_positions.some(function(x){return["QB","RB","WR","TE","K","DEF"].indexOf(x)>=0;})){
        allPlayers[id]={id:id,name:((p.first_name||"")+" "+(p.last_name||"")).trim(),pos:p.fantasy_positions[0]||"?",team:p.team||"FA",exp:p.years_exp!=null?p.years_exp:3,age:p.age||null};
      }
    });
  }
  if(!Object.keys(allPlayers).length){
    FALLBACK_PLAYERS.forEach(function(p){allPlayers["fb_"+p.name]=p;});
  }

  if(!rosterData||!rosterData.length){
    setStatus("Failed to load rosters. Try again.","var(--red)"); return;
  }
  leagueRosters=rosterData;
  leagueUsers=userData||[];

  leaguePicks=pRes||[];
  var thisSeason=(tRes||[]).map(function(t){t._season=season;return t;});
  leagueTrades=thisSeason;
  tradeStats=computeTradeStats(leagueTrades);
  // Load previous-season history in the BACKGROUND - don't make the user wait for it
  var prevId=leagueInfo&&leagueInfo.previous_league_id;
  if(prevId&&prevId!=="0"&&prevId!==0){
    var prevSeason=String(parseInt(season)-1);
    Promise.all([
      sleeperGet("/league/"+prevId+"/all-transactions").catch(function(){return [];}),
      sleeperGet("/league/"+prevId+"/traded_picks").catch(function(){return [];})
    ]).then(function(results){
      // User switched leagues while this previous-season history was loading -
      // dropping it here is what stops the old league's trades from reappearing.
      if(_leagueLoadSeq!==_seq)return;
      var prevTrades=(results[0]||[]).map(function(t){t._season=prevSeason;return t;});
      leaguePicks=leaguePicks.concat(results[1]||[]);
      leagueTrades=thisSeason.concat(prevTrades);
      tradeStats=computeTradeStats(leagueTrades);
    }).catch(function(){});
  }
  parseLeagueFormat(leagueInfo);
  // Detect dynasty vs redraft from Sleeper league settings.
  // settings.type is authoritative: 0=redraft, 1=keeper, 2=dynasty.
  // Do NOT use previous_league_id - renewed redraft leagues have it too.
  var isDynastyLeague;
  if(leagueInfo&&leagueInfo.settings&&leagueInfo.settings.type!=null){
    // 2 = dynasty. 1 = KEEPER: redraft values are the right lens (you keep a
    // few, you do not own the roster forever), with a keeper flag for Mac.
    isDynastyLeague=leagueInfo.settings.type===2;
    window._isKeeper=leagueInfo.settings.type===1;
    window._detectedMode=isDynastyLeague?'dynasty':'redraft';
  }else{
    // No settings.type on this league object - fall back to the name. CRITICAL:
    // still refresh _detectedMode here, or a previous dynasty league leaves it
    // stale and the next (redraft) league inherits a phantom "dynasty" lock.
    isDynastyLeague=(leagueInfo&&(leagueInfo.name||"").toLowerCase().indexOf("dynasty")>=0);
    window._detectedMode=isDynastyLeague?'dynasty':'redraft';
    window._isKeeper=false;
  }
  leagueMode=isDynastyLeague?'dynasty':'redraft';
  try{updateModeUI();}catch(_){}  // refresh the Dynasty/Redraft badge on every league load or switch
  localStorage.setItem('tm_league_id', lid);
  localStorage.setItem('tm_league_name', name||'Unknown');
  // Always re-fetch KTC with correct format + dynasty/redraft mode
  fetchKtcValues(leagueFormat.has2QB||leagueFormat.hasSuperFlex?2:1, leagueFormat.ppr, isDynastyLeague);

  // Load live ticker feed in background (don't block league setup)
  loadLiveFeed(lid, season);

  // Find my roster
  var myRosterObj=leagueRosters.find(function(r){return r.owner_id===userId;});
  if(!myRosterObj){
    setStatus("Could not find your roster in this league.","var(--red)"); return;
  }

  myRoster=(myRosterObj.players||[]).map(function(pid){return allPlayers[pid];}).filter(Boolean).sort(function(a,b){return po(a.pos)-po(b.pos);});
  myPicks=buildPicksForRoster(myRosterObj,leaguePicks,season);
  _boardExpand={give:false,get:false};
  try{renderTradeBoards();}catch(_){}

  // Build opponent dropdown
  var sel=document.getElementById("opp-select");
  sel.innerHTML="<option value=''>- Select opponent - </option>";
  userData.forEach(function(u){
    if(u.user_id===userId)return;
    var opt=document.createElement("option");
    opt.value=u.user_id;
    opt.textContent=(u.metadata&&u.metadata.team_name)||u.display_name||"Unknown";
    sel.appendChild(opt);
  });

  // Show builder
  document.getElementById("league-panel").style.display="none";
  document.getElementById("login-panel").style.display="none";
  document.getElementById("builder-panel").style.display="block";
  document.getElementById("league-name").textContent=name||"League";
  document.getElementById("league-meta").textContent=leagueFormat.formatLabel+" · Season "+leagueSeason+" · "+myRoster.length+" players";
  setStatus("");
  // Show trade ideas
  var ip=document.getElementById("ideas-panel");
  if(ip){ip.style.display="block";}
  var ph=document.getElementById("right-placeholder");if(ph)ph.style.display="none";
  setTimeout(generateTradeIdeas,300);
  if(window._autoRestoring){
    window._autoRestoring=false;
    // The league views may have painted their empty "connect" state before this
    // background restore finished - now that the roster is loaded, refresh them so
    // a signed-in user never sees a dead "Connect your league" wall.
    try{
      if(typeof renderRosterGrade==='function')renderRosterGrade();
      if(typeof renderBuySell==='function')renderBuySell();
      if(typeof renderIdeasTab==='function')renderIdeasTab();
      if(typeof renderLeagueTrades==='function')renderLeagueTrades();
    }catch(_){}
    return;   // no scroll, hero stays
  }
  var heroEl=document.querySelector('.hero');if(heroEl)heroEl.style.display='none';_heroDismissed=true;
  var howEl=document.getElementById('how');if(howEl)howEl.style.display='none';
  var howMini=document.getElementById('how-mini');if(howMini)howMini.style.display='';
  // If the user came from another tab (Buy/Sell, Roster Grade...), send them back there
  if(window._returnScreen&&window._returnScreen!=='screen-analyze'){
    var backTo=window._returnScreen.replace('screen-','');
    window._returnScreen=null;
    switchScreen(backTo,true);
    if(backTo==='research')renderBuySell();
    if(backTo==='league')renderRosterGrade();
    window.scrollTo({top:0,behavior:'smooth'});
  } else {
    window._returnScreen=null;
    setTimeout(function(){
      var anchor=document.getElementById('analyzer');
      if(anchor){var top=anchor.getBoundingClientRect().top+window.pageYOffset-76;window.scrollTo({top:Math.max(0,top),behavior:'smooth'});}
    },100);
  }
}

function po(pos){ return {QB:0,RB:1,WR:2,TE:3}[pos]!==undefined?{QB:0,RB:1,WR:2,TE:3}[pos]:9; }

// ── OTHER PLATFORMS: ESPN import + manual roster (Yahoo/NFL/anything) ────────
function toggleEspnImport(){
  var e=document.getElementById('espn-import-box'),m=document.getElementById('manual-roster-box');
  if(m)m.style.display='none';
  if(e)e.style.display=e.style.display==='none'?'block':'none';
}
function toggleManualRoster(){
  var e=document.getElementById('espn-import-box'),m=document.getElementById('manual-roster-box');
  if(e)e.style.display='none';
  if(m)m.style.display=m.style.display==='none'?'block':'none';
}
async function ensurePlayersLoaded(){
  if(Object.keys(allPlayers).length>100)return;
  var raw=await sleeperGet('/players/nfl/slim').catch(function(){return null;});
  if(raw)Object.keys(raw).forEach(function(id){
    var p=raw[id];
    if(p.fantasy_positions&&p.fantasy_positions.some(function(x){return['QB','RB','WR','TE','K','DEF'].indexOf(x)>=0;})){
      allPlayers[id]={id:id,name:((p.first_name||'')+' '+(p.last_name||'')).trim(),pos:p.fantasy_positions[0]||'?',team:p.team||'FA',exp:p.years_exp!=null?p.years_exp:3,age:p.age||null,inj:p.injury_status||null,status:p.status||null};
    }
  });
}
function _showBuilderUI(name,metaLabel){
  try{renderTradeBoards();}catch(_){}
  var lp=document.getElementById('league-panel');if(lp)lp.style.display='none';
  document.getElementById('login-panel').style.display='none';
  document.getElementById('builder-panel').style.display='block';
  document.getElementById('league-name').textContent=name;
  document.getElementById('league-meta').textContent=metaLabel;
  // Yahoo API terms: attribution shows only while a Yahoo-imported roster is active.
  var _ya=document.getElementById('yahoo-attrib');if(_ya)_ya.style.display=(userId==='yahoo')?'block':'none';
  var ph=document.getElementById('right-placeholder');if(ph)ph.style.display='none';
  var heroEl=document.querySelector('.hero');if(heroEl)heroEl.style.display='none';_heroDismissed=true;
  var howMini=document.getElementById('how-mini');if(howMini)howMini.style.display='';
  setTimeout(function(){
    var anchor=document.getElementById('analyzer');
    if(anchor){var top=anchor.getBoundingClientRect().top+window.pageYOffset-76;window.scrollTo({top:Math.max(0,top),behavior:'smooth'});}
  },100);
}
var _espnData=null;
async function importEspnLeague(){
  var st=document.getElementById('espn-status');
  var lid=(document.getElementById('espn-league-id')||{}).value||'';
  lid=lid.trim().replace(/\D/g,'');
  if(!lid){if(st)st.textContent='Enter your ESPN league ID.';return;}
  if(st)st.textContent='Importing ESPN league...';
  try{
    var r=await fetch('/api/espn/league/'+lid+'?season='+ACTIVE_SEASON);
    var data=await r.json();
    if(!r.ok){if(st)st.textContent=data.message||'Could not import - is the league public?';return;}
    await ensurePlayersLoaded();
    _espnData=data;
    var sel=document.getElementById('espn-team-select');
    sel.innerHTML='<option value="">Select your team...</option>';
    data.teams.forEach(function(t){
      var o=document.createElement('option');o.value=t.id;o.textContent=t.name;sel.appendChild(o);
    });
    document.getElementById('espn-team-pick').style.display='block';
    if(st)st.textContent='Found "'+data.leagueName+'" - '+data.teams.length+' teams. Pick yours above.';
  }catch(e){if(st)st.textContent='Import failed: '+e.message;}
}
function _resolveNames(names){
  var resolved=[],missed=[];
  names.forEach(function(n){
    var pid=getPlayerIdByName(n);
    if(pid&&allPlayers[pid])resolved.push(allPlayers[pid]);else missed.push(n);
  });
  return {players:resolved,missed:missed};
}
function finishEspnImport(){
  if(!_espnData)return;
  var teamId=parseInt((document.getElementById('espn-team-select')||{}).value);
  if(!teamId)return;
  userId='espn_'+teamId;
  leagueRosters=_espnData.teams.map(function(t){
    var res=_resolveNames(t.players.map(function(p){return p.name;}));
    return {roster_id:t.id,owner_id:'espn_'+t.id,players:res.players.map(function(p){return p.id;}),settings:{}};
  });
  leagueUsers=_espnData.teams.map(function(t){return {user_id:'espn_'+t.id,display_name:t.name,metadata:{}};});
  var mine=leagueRosters.find(function(r){return r.owner_id===userId;});
  myRoster=(mine?mine.players:[]).map(function(pid){return allPlayers[pid];}).filter(Boolean).sort(function(a,b){return po(a.pos)-po(b.pos);});
  _leagueLoadSeq++;resetTradeWorkspace();  // invalidate any in-flight Sleeper background load + clear old trade
  myPicks=[];leaguePicks=[];leagueTrades=[];tradeStats={};
  leagueName=_espnData.leagueName;leagueSeason=String(_espnData.season);
  leagueMode='redraft'; // ESPN imports default to redraft - most ESPN leagues are
  leagueFormat.ppr=_espnData.scoringPpr>=1?1:_espnData.scoringPpr>=0.5?0.5:0;
  fetchKtcValues(1,leagueFormat.ppr,false);
  var sel=document.getElementById('opp-select');
  sel.innerHTML="<option value=''>- Select opponent - </option>";
  leagueUsers.forEach(function(u){
    if(u.user_id===userId)return;
    var o=document.createElement('option');o.value=u.user_id;o.textContent=u.display_name;sel.appendChild(o);
  });
  updateModeUI();
  _showBuilderUI(leagueName,'ESPN import · Season '+leagueSeason+' · '+myRoster.length+' players');
  var ip=document.getElementById('ideas-panel');if(ip)ip.style.display='block';
  setTimeout(generateTradeIdeas,300);
}
async function importManualRoster(){
  var st=document.getElementById('manual-status');
  var txt=(document.getElementById('manual-roster-text')||{}).value||'';
  var names=txt.split(/\n|,/).map(function(s){return s.trim();}).filter(Boolean);
  if(names.length<3){if(st)st.textContent='Add at least 3 players.';return;}
  if(st)st.textContent='Matching players...';
  await ensurePlayersLoaded();
  var res=_resolveNames(names);
  if(res.players.length<3){if(st)st.textContent='Could only match '+res.players.length+' players - check spelling.';return;}
  userId='manual';
  myRoster=res.players.sort(function(a,b){return po(a.pos)-po(b.pos);});
  leagueRosters=[{roster_id:1,owner_id:'manual',players:myRoster.map(function(p){return p.id;}),settings:{}}];
  leagueUsers=[{user_id:'manual',display_name:'My Team',metadata:{}}];
  _leagueLoadSeq++;resetTradeWorkspace();  // invalidate any in-flight Sleeper background load + clear old trade
  myPicks=[];leaguePicks=[];leagueTrades=[];tradeStats={};
  leagueName='My Roster';leagueSeason=ACTIVE_SEASON;leagueMode='redraft';
  fetchKtcValues(1,1,false);
  var sel=document.getElementById('opp-select');
  sel.innerHTML="<option value=''>- No league connected - </option>";
  updateModeUI();
  _showBuilderUI('My Roster','Manual entry · '+myRoster.length+' players matched'+(res.missed.length?' · '+res.missed.length+' not found':''));
  if(st)st.textContent='';
}

// ── Yahoo OAuth import (button appears only when the server has Yahoo app creds) ──
var _yahooTeams=null;
function initYahooOAuth(){
  fetch('/api/yahoo/status').then(function(r){return r.json();}).then(function(d){
    if(d&&d.configured){var row=document.getElementById('yahoo-oauth-row');if(row)row.style.display='block';}
  }).catch(function(){});
}
function startYahooLogin(){
  var mb=document.getElementById('manual-roster-box');if(mb)mb.style.display='block';
  var st=document.getElementById('yahoo-status');
  if(st)st.textContent='Waiting for Yahoo login...';
  var w=520,h=680,x=(screen.width-w)/2,y=(screen.height-h)/2;
  window.open('/api/yahoo/login','trademind-yahoo','width='+w+',height='+h+',left='+x+',top='+y);
}
window.addEventListener('message',function(ev){
  var d=ev.data;
  if(!d||d.type!=='trademind-yahoo'||!d.payload)return;
  var st=document.getElementById('yahoo-status');
  if(d.payload.error){if(st)st.textContent=d.payload.error;return;}
  _yahooTeams=d.payload.teams||[];
  if(!_yahooTeams.length){if(st)st.textContent='No fantasy football teams found on that Yahoo account.';return;}
  if(_yahooTeams.length===1){finishYahooImport(0);return;}
  var pick=document.getElementById('yahoo-team-pick');
  var sel=document.getElementById('yahoo-team-select');
  if(sel){
    sel.innerHTML='<option value="">Select your team...</option>';
    _yahooTeams.forEach(function(t,i){
      var o=document.createElement('option');o.value=i;o.textContent=t.team_name+' ('+t.players.length+' players)';sel.appendChild(o);
    });
  }
  if(pick)pick.style.display='block';
  if(st)st.textContent='Found '+_yahooTeams.length+' teams on your Yahoo account. Pick yours above.';
});
initYahooOAuth();

// ── Mac AI chat (shows itself when the server has an Anthropic key) ─────────
var _sageChat=[];
var MAC_SUGGESTIONS=[
  'Should I trade Rashee Rice for Jordan Addison and a 2027 2nd?',
  'Build a rebuild plan for my 2-8 dynasty team',
  'Paste a league convo - Mac writes your reply',
  'Top 3 buy-low WRs right now?'
];
function _sageRenderSuggestions(){
  var box=document.getElementById('sage-suggestions');
  if(!box)return;
  if(_sageChat.length){box.style.display='none';return;}
  box.style.display='flex';
  box.innerHTML=MAC_SUGGESTIONS.map(function(q){
    var isHint=q.indexOf('Paste a league convo')===0;
    if(isHint)return '<button class="sage-sugg" onclick="var i=document.getElementById(\'sage-chat-input\');if(!i.disabled){i.placeholder=\'Paste the conversation and what you want out of the trade...\';i.focus();}">'+q+'</button>';
    return '<button class="sage-sugg" onclick="var i=document.getElementById(\'sage-chat-input\');if(!i.disabled){i.value=this.textContent;i.focus();try{sageGrowInput(i);}catch(_){}}">'+q+'</button>';
  }).join('');
}
// ── Chat threads: every visit starts fresh, history lives in the sidebar ─────
var _sageThreads=[];      // [{id, ts, title, msgs}] newest first, capped at 20
var _sageActive=null;     // id of the thread the current conversation writes into
function _sageTitleFor(msgs){
  var m=msgs.find(function(x){return x.role==='user';});
  var t=(m&&m.content||'Chat').replace(/\s+/g,' ').trim();
  return t.length>44?t.slice(0,44)+'...':t;
}
// Chats are scoped to the signed-in account so switching users never shows
// someone else's history. (localStorage is per-device, so this is per-account
// on the same device, not cross-person.)
var _sageLoadedUser=null;
function _sageThreadsKey(){return 'tm_sage_threads_'+((localStorage.getItem('tm_username')||'anon').toLowerCase());}
function _sageStoreThreads(){
  try{localStorage.setItem(_sageThreadsKey(),JSON.stringify(_sageThreads.slice(0,20)));}catch(_){}
}
function _sageLoadThreads(){
  try{_sageThreads=JSON.parse(localStorage.getItem(_sageThreadsKey())||'[]');}catch(_){_sageThreads=[];}
  // migrate the old un-scoped global store into this account's key once
  try{
    if(!_sageThreads.length){
      var g=JSON.parse(localStorage.getItem('tm_sage_threads')||'[]');
      if(g.length){_sageThreads=g;localStorage.removeItem('tm_sage_threads');}
    }
  }catch(_){}
  // one-time migration: the old single saved conversation becomes the first thread
  try{
    var old=JSON.parse(localStorage.getItem('tm_sage_chat')||'[]');
    if(old.length){
      _sageThreads.unshift({id:'t'+Date.now(),ts:Date.now(),title:_sageTitleFor(old),msgs:old});
      localStorage.removeItem('tm_sage_chat');
    }
  }catch(_){}
  // Yahoo API terms (Exhibit A, 3.e): a Mac conversation may contain analysis of
  // a Yahoo-imported roster (Input/Output), which must not be retained beyond 30
  // days. Purge stale threads on every load so nothing Yahoo-derived lingers.
  try{var _cut=Date.now()-30*86400000;_sageThreads=_sageThreads.filter(function(t){return t&&t.ts&&t.ts>=_cut;});}catch(_){}
  _sageStoreThreads();
  _sageLoadedUser=(localStorage.getItem('tm_username')||'anon').toLowerCase();
}
// Reset the Ask Mac view to the current account's chats (call on account switch).
function sageReloadForUser(){
  _sageActive=null;_sageChat=[];
  _sageLoadThreads();
  try{var log=document.getElementById('sage-chat-log');if(log)log.innerHTML='';}catch(_){}
  try{_sageRenderThreads();}catch(_){}
  try{sageUpdateQuota();}catch(_){}
}
// If the signed-in account changed since chats were loaded, switch to its chats.
function sageSyncUser(){
  var u=(localStorage.getItem('tm_username')||'anon').toLowerCase();
  if(u!==_sageLoadedUser)sageReloadForUser();
}
function _sageSaveChat(){
  if(!_sageChat.length)return;
  if(_sageActive==null){
    _sageActive='t'+Date.now();
    _sageThreads.unshift({id:_sageActive,ts:Date.now(),title:_sageTitleFor(_sageChat),msgs:_sageChat.slice()});
  }else{
    var t=_sageThreads.find(function(x){return x.id===_sageActive;});
    if(t){t.msgs=_sageChat.slice();t.ts=Date.now();t.title=_sageTitleFor(_sageChat);}
  }
  _sageStoreThreads();
  _sageRenderThreads();
}
function _sageTimeAgo(ts){
  var m=Math.round((Date.now()-ts)/60000);
  if(m<60)return m<=1?'now':m+'m ago';
  var h=Math.round(m/60); if(h<24)return h+'h ago';
  return Math.round(h/24)+'d ago';
}
function _sageRenderThreads(){
  var box=document.getElementById('sage-side');
  if(!box)return;
  var html='<button class="sage-side-new" onclick="sageNewChat()">'
    +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
    +'New chat</button>';
  if(_sageThreads.length){
    html+='<div class="sage-side-label">Chats</div>';
    html+=_sageThreads.map(function(t){
      var esc=t.title.replace(/&/g,'&amp;').replace(/</g,'&lt;');
      return '<div class="sage-thread'+(t.id===_sageActive?' active':'')+'" onclick="sageOpenThread(\''+t.id+'\')">'
        +'<span class="sage-thread-title">'+esc+'</span>'
        +'<span class="sage-thread-ts">'+_sageTimeAgo(t.ts)+'</span>'
        +'<button class="sage-thread-x" title="Delete chat" aria-label="Delete chat" onclick="sageDeleteThread(\''+t.id+'\',event)">&times;</button>'
        +'</div>';
    }).join('');
  }else{
    html+='<div class="sage-side-empty">Your past chats will show up here.</div>';
  }
  box.innerHTML=html;
}
function sageOpenThread(id){
  var t=_sageThreads.find(function(x){return x.id===id;});
  if(!t)return;
  _sageActive=id;
  _sageChat=t.msgs.slice();
  var log=document.getElementById('sage-chat-log');
  if(log){log.innerHTML='';_sageChat.forEach(function(m){_sageChatAppend(m.role==='user'?'user':'sage',m.content);});}
  _sageHideGreeting();
  var nb=document.getElementById('sage-new-chat'); if(nb)nb.style.display='';
  _sageRenderSuggestions();
  _sageRenderThreads();
}
function sageDeleteThread(id,ev){
  if(ev)ev.stopPropagation();
  _sageThreads=_sageThreads.filter(function(t){return t.id!==id;});
  _sageStoreThreads();
  if(_sageActive===id)sageNewChat(); else _sageRenderThreads();
}
function sageNewChat(){
  _sageChat=[];
  _sageActive=null;
  var log=document.getElementById('sage-chat-log');
  if(log)log.innerHTML='';
  var nb=document.getElementById('sage-new-chat');
  if(nb)nb.style.display='none';
  var g=document.getElementById('sage-greeting');
  if(g)g.style.display='';
  var cc=document.getElementById('sage-chat-card');if(cc)cc.classList.add('sage-centered');
  _sageRenderSuggestions();
  _sageRenderThreads();
}
function sageGrowInput(el){
  el.style.height='auto';
  el.style.height=Math.min(220,el.scrollHeight)+'px';
}
function _sageHideGreeting(){
  var g=document.getElementById('sage-greeting');
  if(g)g.style.display='none';
  var cc=document.getElementById('sage-chat-card');if(cc)cc.classList.remove('sage-centered');
}
function initSageChat(){
  // Every visit is a fresh chat; history is one click away in the sidebar
  _sageLoadThreads();
  _sageChat=[];
  _sageActive=null;
  _sageRenderThreads();
  _sageRenderSuggestions();
  fetch('/api/sage/status').then(function(r){return r.json();}).then(function(d){
    if(d&&d.configured){
      var inp=document.getElementById('sage-chat-input');
      var btn=document.getElementById('sage-chat-send');
      if(inp){inp.disabled=false;inp.placeholder='Ask Mac anything about fantasy football...';}
      if(btn){btn.disabled=false;}
    }
  }).catch(function(){});
}
function _sageChatAppend(role,text){
  var log=document.getElementById('sage-chat-log');
  if(!log)return;
  var div=document.createElement('div');
  div.className='sage-msg '+(role==='user'?'user':'sage');
  if(role!=='user'){
    var tag=document.createElement('span');tag.className='sage-msg-tag';tag.textContent='Mac';div.appendChild(tag);
  }
  div.appendChild(document.createTextNode(text));
  log.appendChild(div);
  log.scrollTop=log.scrollHeight;
}
// Upgrade CTA appended to the chat when a free user runs out of questions.
function _sageUpgradeButton(){
  var log=document.getElementById('sage-chat-log');
  if(!log)return;
  var wrap=document.createElement('div');
  wrap.className='sage-msg sage';
  wrap.style.cssText='display:flex;flex-direction:column;gap:8px;align-items:flex-start';
  var btn=document.createElement('button');
  btn.textContent='Upgrade to Pro - $6.99/mo';
  btn.className='btn-primary';
  btn.style.cssText='display:inline-block;font-size:13px;padding:10px 18px;cursor:pointer';
  btn.onclick=sageUpgrade;
  var sub=document.createElement('div');
  sub.style.cssText='font-size:11px;color:var(--muted)';
  sub.textContent='Unlimited Mac. Cancel anytime.';
  wrap.appendChild(btn);wrap.appendChild(sub);
  log.appendChild(wrap);
  log.scrollTop=log.scrollHeight;
}
// Show the Pro benefits, then run Stripe's EMBEDDED checkout on our own page.
function _proBenefit(t,d){
  return '<div style="display:flex;gap:11px;align-items:flex-start">'
    +'<span style="flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent-bright);color:#0a0611;display:inline-flex;align-items:center;justify-content:center;font-size:12px;margin-top:1px">&#10003;</span>'
    +'<div><div style="font-size:14px;font-weight:700;color:var(--text)">'+t+'</div><div style="font-size:12px;color:var(--muted);line-height:1.5">'+d+'</div></div></div>';
}
function _proBenefitsHtml(){
  return '<div style="text-align:center;margin-bottom:20px">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-bright)">Mac Draft</div>'
      +'<div style="font-family:var(--font-head);font-size:30px;font-weight:800;letter-spacing:-.02em;margin-top:2px">Go <span class="hl">Pro</span></div>'
      +'<div style="font-size:13px;color:var(--muted2);margin-top:5px">Unlimited Mac. For managers who mean it.</div>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:13px;margin-bottom:22px">'
      +_proBenefit('Unlimited Mac','Ask as much as you want, all season long. No daily or weekly caps.')
      +_proBenefit('The sharpest read','Every trade weighed with our most capable AI, not a lite model.')
      +_proBenefit('The deep stuff','Opponent tendencies, negotiation coaching, and player scouting on demand.')
      +_proBenefit('Always in your corner','One clear answer before every move. Cancel anytime.')
    +'</div>'
    +'<button class="btn-primary" style="width:100%;padding:14px;font-size:15px;cursor:pointer" onclick="sageCheckout(this)">Continue &nbsp;&middot;&nbsp; $6.99/mo</button>'
    +'<div style="text-align:center;margin-top:11px"><span onclick="sageCloseUpgrade()" style="font-size:12px;color:var(--muted);cursor:pointer">Not right now</span></div>'
    +'<div style="text-align:center;margin-top:13px;font-size:11px;color:var(--muted)">Secure payment, powered by Stripe</div>';
}
function sageUpgrade(){
  try{tmTrack('go_pro_clicked');}catch(_){}
  var user=localStorage.getItem('tm_username')||'';
  if(!user){try{sageShowSignin();}catch(_){}return;}
  var m=document.getElementById('pro-modal');
  if(!m){
    m=document.createElement('div');m.id='pro-modal';
    m.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(5,3,12,.72);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto';
    m.onclick=function(e){if(e.target===m)sageCloseUpgrade();};
    m.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:20px;max-width:460px;width:100%;padding:30px 26px 26px;position:relative;margin:auto">'
      +'<button onclick="sageCloseUpgrade()" aria-label="Close" style="position:absolute;top:12px;right:15px;background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer;line-height:1;z-index:2">&times;</button>'
      +'<div id="pro-modal-body"></div>'
    +'</div>';
    document.body.appendChild(m);
  }
  var body=document.getElementById('pro-modal-body');
  if(body)body.innerHTML=_proBenefitsHtml();
  m.style.display='flex';
}
function sageCloseUpgrade(){
  var m=document.getElementById('pro-modal');if(m)m.style.display='none';
  try{if(window._embeddedCheckout){window._embeddedCheckout.destroy();window._embeddedCheckout=null;}}catch(_){}
}
function _loadStripeJs(){
  return new Promise(function(res,rej){
    if(window.Stripe)return res();
    var s=document.createElement('script');s.src='https://js.stripe.com/v3/';
    s.onload=function(){res();};s.onerror=function(){rej(new Error('stripe.js'));};
    document.head.appendChild(s);
  });
}
// Mount Stripe's embedded checkout inside the modal - the card form stays ON our
// site (Stripe iframe, so no card data touches us). Completes -> return_url.
async function sageCheckout(btn){
  var user=localStorage.getItem('tm_username')||'';
  if(!user){try{sageShowSignin();}catch(_){}return;}
  if(btn){btn.disabled=true;btn.textContent='Loading secure checkout...';}
  try{
    await _loadStripeJs();
    var cfg=await (await fetch('/api/billing/config')).json();
    var r=await fetch('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:user,embedded:true})});
    var d=await r.json().catch(function(){return {};});
    if(!d.clientSecret){alert(d.error||'Could not start checkout. Try again in a moment.');if(btn){btn.disabled=false;btn.innerHTML='Continue &nbsp;&middot;&nbsp; $6.99/mo';}return;}
    var body=document.getElementById('pro-modal-body');
    if(body)body.innerHTML='<div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-bright);text-align:center;margin-bottom:14px">Mac Draft Pro &middot; $6.99/mo</div><div id="embedded-checkout"></div>';
    var stripe=Stripe(cfg.publishableKey);
    window._embeddedCheckout=await stripe.initEmbeddedCheckout({clientSecret:d.clientSecret});
    window._embeddedCheckout.mount('#embedded-checkout');
  }catch(e){
    alert('Could not load checkout. Try again in a moment.');
    if(btn){btn.disabled=false;btn.innerHTML='Continue &nbsp;&middot;&nbsp; $6.99/mo';}
  }
}
// Show how many free questions are left (or Pro status) under the Ask Mac box.
// A stable per-BROWSER id so the free allowance is scoped to the device, not the
// account - signing out and using another username gives no extra questions.
function _deviceId(){
  var d=localStorage.getItem('tm_device_id');
  if(!d){
    try{d='dev-'+((window.crypto&&crypto.randomUUID)?crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2,12)));}
    catch(_){d='dev-'+Date.now();}
    try{localStorage.setItem('tm_device_id',d);}catch(_){}
  }
  return d;
}

// ── Referrals ────────────────────────────────────────────────────────────────
// Capture ?ref= once, before any league is connected. We never claim it here -
// only when the visitor connects a REAL Sleeper league (the un-fakeable action).
(function _captureRef(){
  try{
    var r=new URLSearchParams(location.search).get('ref');
    if(!r)return;
    r=r.trim().toLowerCase().slice(0,40);
    var me=(localStorage.getItem('tm_username')||'').toLowerCase();
    if(r&&r!==me&&!localStorage.getItem('tm_ref_claimed'))localStorage.setItem('tm_ref_pending',r);
  }catch(_){}
})();
function _claimReferralIfPending(username){
  var ref=null;try{ref=localStorage.getItem('tm_ref_pending');}catch(_){}
  if(!ref)return;
  if(ref.toLowerCase()===String(username||'').toLowerCase()){try{localStorage.removeItem('tm_ref_pending');}catch(_){}return;}
  fetch('/api/community/referral/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({referrer:ref,newUser:username,device:_deviceId()})})
    .then(function(r){return r.json();}).then(function(){
      try{localStorage.removeItem('tm_ref_pending');localStorage.setItem('tm_ref_claimed','1');}catch(_){}
      try{sageUpdateQuota();}catch(_){}
    }).catch(function(){});
}
function referralLink(){return location.origin+'/?ref='+encodeURIComponent((localStorage.getItem('tm_username')||'').toLowerCase());}
async function openReferral(){
  var u=localStorage.getItem('tm_username')||'';
  if(!u){goConnectLeague();return;}
  var st={bonus:0,referred:0,cap:10};
  try{st=await (await fetch('/api/community/referral/status?username='+encodeURIComponent(u))).json();}catch(_){}
  var link=referralLink();
  var m=document.getElementById('referral-modal');
  if(!m){m=document.createElement('div');m.id='referral-modal';m.onclick=function(e){if(e.target===m)closeReferral();};document.body.appendChild(m);}
  m.style.cssText='position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:20px';
  m.innerHTML="<div style='max-width:440px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px 22px'>"
    +"<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:10px'><div style='font-family:var(--font-head);font-size:22px;font-weight:800;letter-spacing:-.02em'>Refer friends, earn Mac</div><span onclick='closeReferral()' style='cursor:pointer;color:var(--muted);font-size:20px;line-height:1'>&times;</span></div>"
    +"<div style='font-size:13px;color:var(--muted2);line-height:1.55;margin:6px 0 16px'>Send this link to a friend. When they connect a real Sleeper league, you both get two extra Ask Mac questions that day. Up to "+(st.cap||10)+" from referrals.</div>"
    +"<div style='display:flex;gap:8px;margin-bottom:14px'><input id='referral-link-input' readonly value='"+link.replace(/'/g,"&#39;")+"' style='flex:1;min-width:0;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:11px 12px;font-size:12.5px;color:var(--text);outline:none'><button onclick='copyReferral(this)' class='ideas-refresh' style='white-space:nowrap'>Copy</button></div>"
    +"<div style='display:flex;gap:10px'>"
    +"<div style='flex:1;text-align:center;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px'><div style='font-family:var(--font-head);font-size:26px;font-weight:800;color:var(--accent-bright)'>"+(st.referred||0)+"</div><div style='font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em'>Friends joined</div></div>"
    +"<div style='flex:1;text-align:center;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px'><div style='font-family:var(--font-head);font-size:26px;font-weight:800;color:var(--green)'>+"+(st.bonus||0)+"</div><div style='font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em'>Bonus questions</div></div>"
    +"</div></div>";
  m.style.display='flex';
}
function closeReferral(){var m=document.getElementById('referral-modal');if(m)m.style.display='none';}
function copyReferral(btn){
  var i=document.getElementById('referral-link-input');
  if(!i)return;
  try{i.select();}catch(_){}
  var done=function(){if(btn){var t=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=t;},1500);}};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(i.value).then(done).catch(function(){try{document.execCommand('copy');done();}catch(_){}});}
  else{try{document.execCommand('copy');done();}catch(_){}}
}
// Open Stripe's Customer Portal so Pro users can update card or cancel anytime.
// Manage subscription IN-APP (no redirect to Stripe): a modal with plan, renewal
// date, and cancel/resume. Card updates still use Stripe, added separately if needed.
async function sageManageBilling(){
  var user=localStorage.getItem('tm_username')||'';
  if(!user)return;
  var host=document.getElementById('manage-modal');
  if(!host){
    host=document.createElement('div');host.id='manage-modal';
    host.style.cssText='position:fixed;inset:0;background:rgba(6,4,12,.66);z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px';
    host.addEventListener('click',function(ev){if(ev.target===host)host.style.display='none';});
    document.body.appendChild(host);
  }
  host.style.display='flex';
  host.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:420px;width:100%;padding:26px;text-align:center;color:var(--muted)">Loading your plan&hellip;</div>';
  try{
    var d=await (await fetch('/api/billing/subscription?user='+encodeURIComponent(user))).json();
    _renderManageModal(d);
  }catch(_){ if(host.firstChild)host.firstChild.textContent='Could not load your plan. Try again in a moment.'; }
}
function _manageClose(){var h=document.getElementById('manage-modal');if(h)h.style.display='none';}
function _renderManageModal(d){
  var host=document.getElementById('manage-modal');if(!host)return;
  var card='background:var(--surface);border:1px solid var(--border);border-radius:16px;max-width:420px;width:100%;padding:28px;text-align:center;position:relative';
  if(!d||(!d.pro&&!d.status)){
    host.innerHTML='<div style="'+card+'">'
      +'<button onclick="_manageClose()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">&times;</button>'
      +'<div style="font-family:var(--font-head);font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">You have not gone Pro yet</div>'
      +'<button class="btn-primary" style="padding:11px 22px;font-size:14px;margin-top:6px" onclick="_manageClose();sageUpgrade()">Go Pro</button></div>';
    return;
  }
  var when=d.periodEnd?new Date(d.periodEnd*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
  var price=(d.amount!=null)?('$'+Number(d.amount).toFixed(2)+' / '+(d.interval||'month')):'';
  var canceling=d.cancelAtPeriodEnd;
  host.innerHTML='<div style="'+card+'">'
    +'<button onclick="_manageClose()" style="position:absolute;top:12px;right:14px;background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">&times;</button>'
    +'<div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-bright);margin-bottom:8px">Mac Draft Pro</div>'
    +'<div style="font-family:var(--font-head);font-size:30px;font-weight:800;color:var(--text)">'+price+'</div>'
    +'<div style="font-size:13px;color:'+(canceling?'var(--yellow)':'var(--muted2)')+';margin:10px 0 22px;line-height:1.5">'
      +(canceling?('Your plan ends on <strong>'+when+'</strong>. You keep Pro until then.'):('Renews on <strong style="color:var(--text)">'+when+'</strong>.'))
    +'</div>'
    // Changing the plan stays with the browser that bought it, so on any other
    // device we show the plan and say where to manage it. Showing a button that
    // would just fail, or worse an upgrade offer to someone already paying, is
    // how a subscriber ends up thinking they were charged for nothing.
    +(d.manageable===false
        ?'<div style="font-size:12.5px;color:var(--muted2);line-height:1.55;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:12px 14px">Your plan is active here. To change or cancel it, open Mac Draft on the device you subscribed from.</div>'
        :(canceling
          ?'<button class="btn-primary" style="padding:11px 24px;font-size:14px" onclick="_manageResume()">Resume subscription</button>'
          :'<button onclick="_manageCancel()" style="padding:11px 24px;font-size:14px;background:none;border:1px solid var(--border2);color:var(--muted2);border-radius:100px;cursor:pointer;font-weight:600">Cancel subscription</button>'))
    +'<div style="margin-top:16px"><span onclick="_manageClose()" style="font-size:12px;color:var(--muted);cursor:pointer">Keep browsing Mac Draft</span></div></div>';
}
async function _manageRefresh(){
  var user=localStorage.getItem('tm_username')||'';
  try{var s=await (await fetch('/api/billing/subscription?user='+encodeURIComponent(user))).json();_renderManageModal(s);try{_refreshProStatus();}catch(_){}}catch(_){}
}
async function _manageCancel(){
  var user=localStorage.getItem('tm_username')||'';if(!user)return;
  if(!confirm('Cancel Mac Draft Pro? You keep Pro until the end of your current billing period.'))return;
  try{var d=await (await fetch('/api/billing/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:user})})).json();
    if(d.ok)_manageRefresh();else alert(d.error||'Could not cancel right now.');
  }catch(_){alert('Could not cancel right now.');}
}
async function _manageResume(){
  var user=localStorage.getItem('tm_username')||'';if(!user)return;
  try{var d=await (await fetch('/api/billing/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:user})})).json();
    if(d.ok)_manageRefresh();else alert(d.error||'Could not resume right now.');
  }catch(_){alert('Could not resume right now.');}
}
async function sageUpdateQuota(){
  var el=document.getElementById('sage-quota');if(!el)return;
  var user=localStorage.getItem('tm_username')||'';
  if(!user){el.style.display='none';return;}
  try{
    var d=await (await fetch('/api/sage/quota?user='+encodeURIComponent(user)+'&device='+encodeURIComponent(_deviceId()))).json();
    if(d.pro){el.innerHTML='<span style="color:var(--accent-bright);font-weight:700">Pro</span> &middot; Unlimited Mac &middot; <span onclick="sageManageBilling()" style="cursor:pointer;text-decoration:underline">Manage</span>';el.style.display='block';return;}
    var left=Math.min(d.dailyLeft,d.weeklyLeft);
    var span=(d.weeklyLeft<d.dailyLeft)?'this week':'today';
    var go=' &middot; <span style="color:var(--accent-bright);cursor:pointer;text-decoration:underline" onclick="sageUpgrade()">Go Pro for unlimited</span>';
    // Referrals used to live only in the account dropdown, where nobody looks.
    // Running low on questions is the one moment a manager actually wants more,
    // so the offer sits here - and only then, so it never nags someone who has
    // plenty left. Hidden once they hit the referral cap.
    var ref='';
    if(left<=2&&(d.referralBonus||0)<10){
      ref=' &middot; <span style="cursor:pointer;text-decoration:underline" onclick="openReferral()">Invite a friend, you both get two</span>';
    }
    el.innerHTML=(left>0?(left+' question'+(left===1?'':'s')+' left '+span):('No questions left '+span))+go+ref;
    el.style.display='block';
  }catch(_){el.style.display='none';}
}
// Mac figures out the user's window HIMSELF: roster value rank in the league,
// record, and the age of the core decide contending vs rebuilding. Shipped with
// every chat message so he never has to ask.
// The connected league's scoring rules in one line so Mac weighs positions
// the way THIS league scores, not the way a generic league does
function _lfRules(){
  try{
    var lf=window.leagueFormat||{};var rl=[];
    if(lf.scoringLabel)rl.push(lf.scoringLabel);
    if(lf.passTd>=5)rl.push(lf.passTd+'pt passing TDs (lifts QB value)');
    if(lf.tePrem>0)rl.push('TE premium +'+lf.tePrem+' per TE catch (lifts TE value)');
    if(lf.fdBonus)rl.push('bonus points per first down (lifts volume runners and possession receivers)');
    return rl.join(', ');
  }catch(_){return '';}
}
// What the manager actually told us, in their own words. These three answers
// were collected right before the analysis and then dropped on the floor: they
// never reached Mac, who instead got a `situation` the app INFERRED from
// roster value and age. So a manager could say "I'm contending", get ranked
// 9th by the algorithm, and be answered as a rebuilder. Stated beats inferred.
const _YOU_WINDOW=['contending, likes this roster to make a run',
                   'in the mix, a piece or two away',
                   'middle, could go either way',
                   'longshot, thin or slow start, swinging for upside'];
const _YOU_GOAL=['fill a hole in the starting lineup',
                 'upgrade a spot already covered',
                 'sell a hot player before he cools',
                 'buy a struggling stud at a discount'];
const _YOU_LEAN=['likes the trade, wants a sanity check',
                 'undecided, could go either way',
                 'leaning against it',
                 'wants to be talked out of it'];
function _youSaid(){
  var o={};
  if(youAnswers[0]!=null&&_YOU_WINDOW[youAnswers[0]])o.window=_YOU_WINDOW[youAnswers[0]];
  if(youAnswers[1]!=null&&_YOU_GOAL[youAnswers[1]])o.goal=_YOU_GOAL[youAnswers[1]];
  if(youAnswers[2]!=null&&_YOU_LEAN[youAnswers[2]])o.lean=_YOU_LEAN[youAnswers[2]];
  return Object.keys(o).length?o:null;
}
function _sageLeagueCtx(){
  try{
    if(!leagueRosters||!leagueRosters.length||!Object.keys(ktcById||{}).length)return {mode:leagueMode};
    var mine=leagueRosters.find(function(r){return r.owner_id===userId;});
    var totals=leagueRosters.map(function(r){
      return {r:r,val:(r.players||[]).reduce(function(s,pid){return s+(ktcById[pid]||0);},0)};
    }).sort(function(a,b){return b.val-a.val;});
    var n=leagueRosters.length;
    var myRank=mine?totals.findIndex(function(t){return t.r===mine;})+1:0;
    var st=(mine&&mine.settings)||{};
    var w=st.wins||0,l=st.losses||0,g=w+l+(st.ties||0);
    var ages=[];
    ((mine&&mine.players)||[]).map(function(pid){return {v:ktcById[pid]||0,a:(allPlayers[pid]||{}).age};})
      .sort(function(x,y){return y.v-x.v;}).slice(0,10).forEach(function(x){if(x.a)ages.push(x.a);});
    var avgAge=ages.length?ages.reduce(function(a,b){return a+b;},0)/ages.length:null;
    var sit='',why='';
    if(myRank){
      var top=myRank<=Math.max(1,Math.ceil(n/3)),bottom=myRank>Math.ceil(2*n/3);
      why='roster value ranks '+myRank+' of '+n+(avgAge?', top-10 avg age '+avgAge.toFixed(1):'')+(g?', record '+w+'-'+l:'');
      if(leagueMode==='redraft'){
        // every redraft team plays to win now - describe STRENGTH, not window
        sit=top?'strong roster, top tier of the league':bottom?'thin roster, needs upside swings':'middle of the pack';
      }else{
        var young=avgAge&&avgAge<25.5,old=avgAge&&avgAge>=27.5;
        if(top)sit=old?'contending with an aging core, window is NOW':'contending';
        else if(bottom)sit=young?'rebuilding, on schedule':'rebuilding, should sell vets for youth and picks';
        else sit=old?'stuck in the middle with an aging core, should pick a direction':'middle of the pack with time to push up';
      }
    }
    // full league visibility: every team's core, names included, mine flagged
    var rosters=[];
    try{
      leagueRosters.forEach(function(r0){
        var u=leagueUsers.find(function(x){return x.user_id===r0.owner_id;});
        var tn=(u&&(u.metadata&&u.metadata.team_name||u.display_name))||('Roster '+r0.roster_id);
        var core=(r0.players||[]).map(function(pid){return {pid:pid,v:ktcById[pid]||0};})
          .sort(function(a2,b2){return b2.v-a2.v;}).slice(0,10)
          .map(function(x){var pl=allPlayers[x.pid];return pl?pl.name+' ('+pl.pos+')':null;})
          .filter(Boolean);
        if(core.length)rosters.push({team:String(tn).slice(0,28),mine:r0.owner_id===userId,core:core});
      });
    }catch(_){}
    return {mode:leagueMode,keeper:!!window._isKeeper,league:leagueName||'',teams:n,record:g?(w+'-'+l):'',situation:sit,why:why,youSaid:_youSaid(),rules:_lfRules(),lastMock:_sageLastMock(),rosters:rosters};
  }catch(_){return {mode:leagueMode,keeper:!!window._isKeeper,youSaid:_youSaid(),rules:_lfRules(),lastMock:_sageLastMock()};}
}
// Latest mock draft as one compact line so Mac can grade it in chat
function _sageLastMock(){
  try{
    var m=JSON.parse(localStorage.getItem('tm_last_mock')||'null');
    if(!m||!m.picks||!m.picks.length)return '';
    var age=Math.round((Date.now()-m.ts)/3600000);
    return (m.teams+'-team '+(m.sf?'superflex':'1QB')+' mock, slot '+m.slot+', '+m.strat+' strategy, value grade '+m.grade
      +', drafted '+(age<1?'just now':age<24?age+'h ago':Math.round(age/24)+'d ago')+': '
      +m.picks.map(function(p){return p.name+' ('+p.pos+', pick '+p.overall+', market rank '+p.marketRank+')';}).join('; ')).slice(0,900);
  }catch(_){return '';}
}
// The analyzer's math can't know what's happening in your league. Whatever the
// user types in the context box gets a short live Mac read under the verdict.
async function sageContextRead(give,get,valueTier){
  var box=document.getElementById('trade-context');
  var txt=box?box.value.trim():'';
  var old=document.getElementById('verdict-ctx');
  if(!txt){if(old)old.remove();return;}
  var body=document.getElementById('verdict-body');
  if(!body)return;
  if(!localStorage.getItem('tm_username')){if(old)old.remove();return;}
  var el=old;
  if(!el){
    el=document.createElement('div');
    el.id='verdict-ctx';
    el.style.cssText='margin:10px 0 12px;padding:11px 14px;background:var(--surface2);border:1px solid rgba(155,114,232,.3);border-radius:11px;font-size:12.5px;color:var(--muted2);line-height:1.6';
    body.parentElement.insertBefore(el,body.nextSibling);
  }
  el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac on your context</div><span class="sage-status">Factoring it in...</span>';
  var tierWord={crushing:'a clear win for me',winning:'a win for me',even:'even',losing:'a loss for me',getting_fleeced:'a big loss for me'}[valueTier]||'close';
  var giveN=(give||[]).join(', ')||'my players';
  var getN=(get||[]).join(', ')||'their players';
  try{
    var res=await fetch('/api/sage/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      leagueContext:_sageLeagueCtx(),
      user:localStorage.getItem('tm_username')||'',
      device:_deviceId(),
      messages:[{role:'user',content:'TRADE CONTEXT CHECK. I am giving away '+giveN+' and getting '+getN+'. On pure value the analyzer calls it '+tierWord+'. Extra context you should weigh: "'+txt.slice(0,500)+'". In 2 to 4 sentences, tell me whether this context changes the verdict, and which way. No greeting, straight to it.'}]
    })});
    var ctype=res.headers.get('content-type')||'';
    var full='';
    if(ctype.indexOf('text/event-stream')<0){
      var d=await res.json().catch(function(){return {};});
      full=d.answer||'';
    }else{
      var reader=res.body.getReader();var dec=new TextDecoder();var buf='';
      while(true){
        var r2=await reader.read();if(r2.done)break;
        buf+=dec.decode(r2.value,{stream:true});
        var lines=buf.split('\n\n');buf=lines.pop();
        lines.forEach(function(ln){
          ln=ln.trim();if(ln.indexOf('data: ')!==0)return;
          try{var ev=JSON.parse(ln.slice(6));if(ev.t){full+=ev.t;
            el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac on your context</div>'+full.replace(/</g,'&lt;').replace(/\n/g,'<br>');}}catch(_){}
        });
      }
    }
    if(!full.trim())el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac on your context</div>Could not get a read right now - the verdict above stands on the numbers.';
    else if(ctype.indexOf('text/event-stream')<0)el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac on your context</div>'+full.replace(/</g,'&lt;').replace(/\n/g,'<br>');
  }catch(_){
    el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac on your context</div>Could not get a read right now - the verdict above stands on the numbers.';
  }
}
// Inline sign-in, right inside the chat: username in, no password, no leaving
function sageShowSignin(){
  var log=document.getElementById('sage-chat-log');
  if(!log)return;
  // One connection flow at a time. If the modal is already open, it owns the
  // sign-in - don't stack an inline prompt behind it.
  var cm=document.getElementById('connect-modal');
  if(cm&&cm.style.display==='flex'){return;}
  // The greeting's "connect your league" nudge is a second entry point; fold it
  // away while the inline sign-in is up so the two never sit on screen together.
  var hint=document.getElementById('sage-connect-hint');if(hint)hint.style.display='none';
  if(document.getElementById('sage-inline-signin')){
    var si=document.getElementById('sage-si-input');if(si)si.focus();
    return;
  }
  var box=document.createElement('div');
  box.className='sage-msg sage';
  box.id='sage-inline-signin';
  box.innerHTML='<span class="sage-msg-tag">Mac</span>'
    +'<div style="font-size:13px;line-height:1.6;margin-bottom:10px">Sign in with your Sleeper username first so I know whose league I am looking at. No password, takes ten seconds.</div>'
    +'<div style="display:flex;gap:8px;max-width:380px">'
    +'<input type="text" id="sage-si-input" class="tm-input" style="flex:1;font-size:14px" placeholder="Your Sleeper username" onkeydown="if(event.key===\'Enter\')sageInlineSignIn()">'
    +'<button class="btn-load" style="width:auto;padding:10px 20px" onclick="sageInlineSignIn()">Sign in</button></div>'
    +'<div id="sage-si-status" style="font-size:11.5px;color:var(--muted);margin-top:6px"></div>';
  log.appendChild(box);
  log.scrollTop=log.scrollHeight;
  var inp=document.getElementById('sage-si-input');if(inp)inp.focus();
}
async function sageInlineSignIn(){
  var inp=document.getElementById('sage-si-input');
  var st=document.getElementById('sage-si-status');
  var name=(inp&&inp.value.trim())||'';
  if(!name){if(st)st.textContent='Type your Sleeper username first.';return;}
  if(st)st.textContent='Connecting...';
  var main=document.getElementById('sleeper-username');
  if(main)main.value=name;
  try{await loadUser();}catch(_){}
  if(localStorage.getItem('tm_username')){
    switchScreen('sage'); // stay in the chat, whatever loadUser scrolled to
    var box=document.getElementById('sage-inline-signin');if(box)box.remove();
    var sch=document.getElementById('sage-connect-hint');if(sch)sch.style.display='none';
    _sageChatAppend('sage','You are in, '+name+'. Ask me anything - and if you connect a league from the Analyze tab, I can see your whole roster too.');
  }else{
    if(st)st.textContent='No Sleeper account found under that name. Check the spelling - it is case sensitive.';
  }
}
// Mac can send the user to any tool. It emits [[go:KEY]] in its reply; we strip
// that from the text and render a clickable chip that navigates there.
var MAC_NAV={
  home:{label:'Home',go:function(){switchScreen('home');}},
  analyze:{label:'Open the Trade Analyzer',go:function(){switchScreen('analyze');try{showAnalyzeTab('analyzer');}catch(_){}}},
  ideas:{label:'See Trade Ideas',go:function(){switchScreen('analyze');try{showAnalyzeTab('ideas');}catch(_){}}},
  league:{label:'Open My League',go:function(){switchScreen('league');}},
  research:{label:'Open Research',go:function(){switchScreen('research');}},
  draft:{label:'Open the Draft room',go:function(){switchScreen('mock');try{mdRenderStrats();}catch(_){}}},
  mock:{label:'Open the Draft room',go:function(){switchScreen('mock');}},
  news:{label:'Open News',go:function(){switchScreen('news');try{loadNewsGrid();loadAnalystCorner();}catch(_){}}},
  community:{label:'Open Community',go:function(){switchScreen('community');try{loadCommunityFeed();}catch(_){}}},
  learn:{label:'Fantasy 101',go:function(){goLearn();}}
};
function _sageStripNav(txt){return String(txt).replace(/\[\[go:[a-z]*\]\]/gi,'').replace(/\[\[go:[a-z]*$/i,'').replace(/[ \t]+(\n|$)/g,'$1').replace(/\s+$/,'');}
function _sageNavKeys(txt){var out=[],seen={},m,re=/\[\[go:([a-z]+)\]\]/gi;while((m=re.exec(String(txt)))){var k=m[1].toLowerCase();if(MAC_NAV[k]&&!seen[k]){seen[k]=1;out.push(k);}}return out.slice(0,2);}
function _sageRenderNav(container,txt){
  var keys=_sageNavKeys(txt);if(!keys.length||!container)return;
  var wrap=document.createElement('div');
  wrap.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:11px';
  keys.forEach(function(k){
    var nav=MAC_NAV[k];var b=document.createElement('button');
    b.className='sage-nav-chip';b.innerHTML=nav.label+' <span style="opacity:.75">&rarr;</span>';
    b.onclick=function(){try{nav.go();}catch(_){}};
    wrap.appendChild(b);
  });
  container.appendChild(wrap);
}
async function sageChatSend(){
  var inp=document.getElementById('sage-chat-input');
  var btn=document.getElementById('sage-chat-send');
  var log=document.getElementById('sage-chat-log');
  if(!inp||!log)return;
  var q=inp.value.trim();
  if(!q||window._sageBusy)return;
  try{tmTrack('sage_asked');}catch(_){}
  // Mac talks to signed-in managers only (protects the whole community's access)
  if(!localStorage.getItem('tm_username')){
    _sageHideGreeting();
    sageShowSignin();
    return;
  }
  window._sageBusy=true;
  inp.value='';
  if(btn)btn.disabled=true;
  _sageHideGreeting();
  inp.style.height='auto';
  _sageChatAppend('user',q);
  _sageChat.push({role:'user',content:q});
  var sugg=document.getElementById('sage-suggestions');
  if(sugg)sugg.style.display='none';
  // Status line while Mac gets going, replaced by live text the moment he writes
  var typing=document.createElement('div');
  typing.className='sage-msg sage';
  typing.innerHTML='<span class="sage-msg-tag"><img src="/sage/sage-thinking-64.png" alt="" style="width:20px;height:20px;object-fit:contain;vertical-align:-6px;margin-right:4px" onerror="this.style.display=\'none\'">Mac</span><span class="sage-status">Reading the market...</span>';
  log.appendChild(typing);log.scrollTop=log.scrollHeight;
  var statusEl=typing.querySelector('.sage-status');
  var liveText=null;var full='';
  function onDelta(t){
    if(!liveText){
      if(statusEl)statusEl.remove();
      liveText=document.createElement('span');
      typing.appendChild(liveText);
    }
    full+=t;
    liveText.textContent=_sageStripNav(full);
    log.scrollTop=log.scrollHeight;
  }
  try{
    // Ship the scout notes for every player named in the conversation - this is
    // how Mac knows the situation (who left, who arrived), not just the value.
    var _noteMatches=[];
    try{
      var convoTxt=_sageChat.slice(-6).map(function(m){return m.content;}).join(' ').toLowerCase()
        .replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ');
      Object.keys(PLAYER_NOTES).forEach(function(k){
        if(_noteMatches.length>=8)return;
        if(convoTxt.indexOf(k)>=0||convoTxt.indexOf(k.split(' ').slice(-1)[0])>=0&&k.split(' ').slice(-1)[0].length>=6){
          var n=noteForMode(PLAYER_NOTES[k]);
          _noteMatches.push({name:k,note:n.note,curve:n.curve});
        }
      });
    }catch(_){}
    var res=await fetch('/api/sage/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:_sageChat,playerNotes:_noteMatches,leagueContext:_sageLeagueCtx(),user:localStorage.getItem('tm_username')||'',device:_deviceId()})});
    var ctype=res.headers.get('content-type')||'';
    if(ctype.indexOf('text/event-stream')<0){
      // Non-streaming fallback (errors come back as JSON)
      var d=await res.json().catch(function(){return {};});
      typing.remove();
      if(res.ok&&d.answer){full=d.answer;_sageChatAppend('sage',_sageStripNav(full));}
      else if(d&&d.error&&(res.status===401||res.status===429)){_sageChatAppend('sage',d.error);if(d.upgrade){_sageUpgradeButton();}_sageChat.pop();full='';}
      else{_sageChatAppend('sage','Hit a snag on my end. Give it another shot in a moment.');_sageChat.pop();full='';}
    }else{
      var reader=res.body.getReader();
      var dec=new TextDecoder();
      var buf='';
      var errored=false;
      while(true){
        var chunk=await reader.read();
        if(chunk.done)break;
        buf+=dec.decode(chunk.value,{stream:true});
        var lines=buf.split('\n\n');
        buf=lines.pop();
        for(var li=0;li<lines.length;li++){
          var line=lines[li].trim();
          if(line.indexOf('data: ')!==0)continue;
          try{
            var ev=JSON.parse(line.slice(6));
            if(ev.t)onDelta(ev.t);
            else if(ev.status&&statusEl&&!liveText)statusEl.textContent=ev.status;
            else if(ev.error&&!full){errored=true;}
          }catch(_){}
        }
      }
      if(errored||!full.trim()){
        typing.remove();
        _sageChatAppend('sage','Hit a snag on my end. Give it another shot in a moment.');
        _sageChat.pop();full='';
      }else{
        try{liveText.textContent=_sageStripNav(full);}catch(_){}
        _sageRenderNav(typing,full);
      }
    }
    if(full.trim()){
      _sageChat.push({role:'assistant',content:full.replace(/\[\[go:[a-z]+\]\]/gi,'').trim()});
      _sageSaveChat();
      var nb=document.getElementById('sage-new-chat');
      if(nb)nb.style.display='';
    }
  }catch(_){
    typing.remove();
    _sageChatAppend('sage','Hit a snag on my end. Give it another shot in a moment.');
    _sageChat.pop();
  }
  window._sageBusy=false;
  if(btn)btn.disabled=false;
  inp.focus();
  try{sageUpdateQuota();}catch(_){}
}
initSageChat();

// ═══ TRADING HUB FEATURES ═══════════════════════════════════════════════════

// ── 1. TRADE BLOCK ──────────────────────────────────────────────────────────
var _blockFilter='';var _blockPick=null;
function setBlockFilter(btn){
  _blockFilter=btn.dataset.f||'';
  document.querySelectorAll('#block-filters .md-pos-chip').forEach(function(c){c.classList.toggle('active',c===btn);});
  loadTradeBlock();
}
async function blockPlayerSearch(){
  var inp=document.getElementById('block-player');
  var dd=document.getElementById('block-player-dd');
  if(!inp||!dd)return;
  var q=inp.value.toLowerCase().trim();
  _blockPick=null;
  if(q.length<2){dd.classList.remove('open');return;}
  await ensurePlayersLoaded();
  var results=Object.values(allPlayers).filter(function(p){
    return p.name&&p.name.toLowerCase().indexOf(q)>=0&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;
  }).sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,6);
  dd.innerHTML='';
  results.forEach(function(p){
    var d=document.createElement('div');
    d.className='ac-item';d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer';
    d.innerHTML='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'"><span style="flex:1"></span><span style="font-size:10px;color:var(--muted)">'+p.pos+' · '+(p.team||'FA')+'</span>';
    d.children[1].textContent=p.name;
    d.addEventListener('mousedown',function(ev){ev.preventDefault();_blockPick=p;inp.value=p.name;dd.classList.remove('open');});
    dd.appendChild(d);
  });
  dd.classList.toggle('open',results.length>0);
}
async function postBlockListing(){
  var st=document.getElementById('block-status');
  if(!bkUsername){if(st)st.textContent='Connect your league first so listings have your name on them.';return;}
  var inp=document.getElementById('block-player');
  var name=(_blockPick&&_blockPick.name)||((inp&&inp.value)||'').trim();
  if(!name||name.length<3){if(st)st.textContent='Pick a player first.';return;}
  var payload={
    username:bkUsername,type:(document.getElementById('block-type')||{}).value||'shopping',
    player_id:_blockPick?_blockPick.id:null,player_name:name,
    pos:_blockPick?_blockPick.pos:'',team:_blockPick?_blockPick.team:'',
    note:((document.getElementById('block-note')||{}).value||'').trim(),
    league_type:leagueMode||'dynasty'
  };
  if(st)st.textContent='Listing...';
  try{
    var r=await fetch('/api/community/block',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok)throw new Error('server');
    if(st)st.textContent='';
    if(inp)inp.value='';var note=document.getElementById('block-note');if(note)note.value='';_blockPick=null;
    loadTradeBlock();
  }catch(_){if(st)st.textContent='Could not post the listing. Try again in a moment.';}
}
async function removeBlockListing(id){
  // The server matches the listing against the account key header, not a name.
  try{await fetch('/api/community/block/'+id,{method:'DELETE'});}catch(_){}
  loadTradeBlock();
}
function analyzeBlockListing(idx){
  var l=window._blockListings&&window._blockListings[idx];
  if(!l)return;
  switchScreen('analyze');showAnalyzeTab('analyzer');
  // Shopping = someone is open to moving him: he lands on YOUR "get" side.
  // Wanted = they are hunting him: see what he costs by putting him on "give".
  var side=l.type==='shopping'?'get':'give';
  clearTradeSide(side+'-players',side);
  var input=document.querySelector('#'+side+'-players input');
  if(input&&l.player_id){
    input.value=l.player_name;
    input.dataset.playerId=l.player_id;
    input.dataset.playerPos=l.pos||'';
    updateKtcLive();
  }
  setTimeout(function(){scrollToEl(document.getElementById('builder-panel')||document.getElementById('analyzer'));},150);
}
async function loadTradeBlock(){
  var el=document.getElementById('block-list');
  if(!el)return;
  await ensurePlayersLoaded();
  try{
    var r=await fetch('/api/community/block');
    var d=await r.json();
    var list=(d.listings||[]).filter(function(l){return !_blockFilter||l.type===_blockFilter;});
    window._blockListings=list;
    if(!list.length){el.innerHTML='<div class="empty-state">Nothing on the block'+(_blockFilter?' in this filter':'')+' yet. List a player above and start the market.</div>';return;}
    el.innerHTML=list.map(function(l,i){
      var isShopping=l.type==='shopping';
      var badge='<span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:100px;text-transform:uppercase;letter-spacing:.05em;background:'+(isShopping?'rgba(245,158,11,.15);color:#f59e0b':'rgba(34,197,94,.15);color:var(--green)')+'">'+(isShopping?'Shopping':'Wanted')+'</span>';
      var img=l.player_id?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+l.player_id+'.jpg" style="width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid var(--border);cursor:pointer" onclick="openPlayerCard(\''+l.player_id+'\',\''+(l.player_name||'').replace(/'/g,"\\'")+'\')" onerror="this.style.display=\'none\'">':'';
      var mine=bkUsername&&l.username===bkUsername;
      var val='';
      return '<div class="comm-card" style="display:flex;gap:12px;align-items:flex-start">'
        +img
        +'<div style="flex:1;min-width:0">'
        +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:14px;font-weight:700;color:var(--text)">'+l.player_name+'</span>'
        +(l.pos?'<span style="font-size:10px;color:var(--muted)">'+l.pos+(l.team?' · '+l.team:'')+'</span>':'')+val+badge
        +'<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+(l.league_type==='redraft'?'rgba(245,158,11,.12);color:#f59e0b':'rgba(167,139,250,.12);color:var(--accent-bright)')+';text-transform:uppercase">'+(l.league_type||'dynasty')+'</span></div>'
        +'<div style="font-size:11px;color:var(--muted);margin-top:3px">@'+escHtml(l.username)+' · '+timeAgo(l.created_at)+(l.note?'</div><div style="font-size:12px;color:var(--muted2);margin-top:5px;line-height:1.5">'+escHtml(l.note):'')+'</div>'
        +'</div>'
        +'<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">'
        +'<button class="idea-use-btn" style="margin-top:0" onclick="analyzeBlockListing('+i+')">Analyze →</button>'
        +(mine?'<button class="btn-sm" style="font-size:9px" onclick="removeBlockListing(\''+l.id+'\')">Take down</button>':'')
        +'</div></div>';
    }).join('');
  }catch(_){el.innerHTML='<div class="empty-state">The block is unavailable right now.</div>';}
}

// ── 2. MARKET INDEX: most traded on Mac Draft ───────────────────────────────
function renderTmTradeIndex(){
  var el=document.getElementById('mkt-tm-index');
  if(!el||window._tmIndexLoaded)return;
  window._tmIndexLoaded=true;
  fetch('/api/community/trade-index').then(function(r){return r.json();}).then(function(d){
    var list=d.players||[];
    if(!list.length){el.innerHTML='<div class="mkt-empty">Not enough Mac Draft trades in the last 30 days yet. Every trade shared to the Community feed builds this index.</div>';return;}
    el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px">'+list.map(function(p,i){
      var pid=p.sleeper_id||getPlayerIdByName(p.name);
      return '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;cursor:pointer" onclick="openPlayerCard(\''+(pid||'')+'\',\''+p.name.replace(/'/g,"\\'")+'\')">'
        +'<span style="font-family:var(--font-head);font-weight:800;color:var(--muted);font-size:13px;min-width:18px">'+(i+1)+'</span>'
        +(pid?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" style="width:28px;height:28px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'">':'')
        +'<span style="flex:1;font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+'</span>'
        +'<span style="font-size:11px;font-weight:700;color:var(--accent-bright)">'+p.count+'x</span></div>';
    }).join('')+'</div>'
    +'<div style="font-size:10px;color:var(--muted);margin-top:8px">From '+(d.total_trades||0)+' trades analyzed and shared on Mac Draft in the last 30 days.</div>';
  }).catch(function(){el.innerHTML='<div class="mkt-empty">Index unavailable right now.</div>';});
}

// ── 3. TRADE ALERTS (in-app bell) ───────────────────────────────────────────
async function loadTradeAlerts(){
  var dd=document.getElementById('alerts-dd');
  var badge=document.getElementById('alerts-badge');
  if(!dd)return;
  var leagues=(window._myLeagues||[]).slice(0,3);
  if(leagueId&&!leagues.some(function(l){return l.league_id===leagueId;}))leagues.unshift({league_id:leagueId,name:leagueName});
  // Was a dead end: it told you to connect a league without giving you any way
  // to do it, so the panel looked broken. Now the message IS the action.
  if(!leagues.length){dd.innerHTML='<div style="padding:14px;text-align:center">'
    +'<div style="font-size:12px;color:var(--muted2);line-height:1.5;margin-bottom:10px">Connect a league and Mac will tell you the moment a trade lands.</div>'
    +'<button class="btn-sm" onclick="closeAllDropdowns();goConnectLeague()">Connect a league</button></div>';return;}
  var seen=0;try{seen=parseInt(localStorage.getItem('tm_alerts_seen')||'0');}catch(_){}
  var items=[];
  for(var i=0;i<leagues.length;i++){
    try{
      var r=await fetch('/api/sleeper/league/'+leagues[i].league_id+'/all-transactions');
      var trades=r.ok?await r.json():[];
      trades.slice(0,20).forEach(function(t){
        if(!t.created)return;
        items.push({t:t,league:leagues[i].name||'League',created:t.created});
      });
    }catch(_){}
  }
  items.sort(function(a,b){return b.created-a.created;});
  items=items.slice(0,12);
  window._alertItems=items;
  var fresh=items.filter(function(it){return it.created>seen;}).length;
  if(badge){badge.style.display=fresh?'flex':'none';badge.textContent=fresh>9?'9+':fresh;}
  await ensurePlayersLoaded();
  dd.innerHTML=items.length?items.map(function(it){
    var names=Object.keys(it.t.adds||{}).map(function(pid){var p=allPlayers[pid];return p?p.name:null;}).filter(Boolean).slice(0,4);
    return '<div style="padding:9px 12px;border-bottom:1px solid var(--border)">'
      +'<div style="font-size:11.5px;color:var(--text);font-weight:600;line-height:1.4">'+(names.join(', ')||'Draft picks')+' traded</div>'
      +'<div style="font-size:10px;color:var(--muted);margin-top:2px">'+it.league+' · '+timeAgo(it.created)+'</div></div>';
  }).join(''):'<div style="padding:12px;font-size:11px;color:var(--muted)">No trades in your leagues yet. Quiet market.</div>';
}
function toggleAlerts(){
  var wrap=document.getElementById('alerts-wrap');
  if(!wrap)return;
  var open=wrap.classList.toggle('open');
  if(open){
    try{localStorage.setItem('tm_alerts_seen',String(Date.now()));}catch(_){}
    var badge=document.getElementById('alerts-badge');
    if(badge)badge.style.display='none';
    if(!window._alertsLoaded){window._alertsLoaded=true;loadTradeAlerts();}
  }
}

// ── 4. COUNTER OFFERS on shared trade links ─────────────────────────────────
function counterSharedTrade(){
  var t=window._sharedTrade;
  if(!t)return;
  switchScreen('analyze');showAnalyzeTab('analyzer');
  // You are the receiver: their "get" is what they asked FROM you -> your give side
  fillTradeSideFromNames('give',t.get||[]);
  fillTradeSideFromNames('get',t.give||[]);
  setTimeout(function(){scrollToEl(document.getElementById('builder-panel')||document.getElementById('analyzer'));},150);
}
async function fillTradeSideFromNames(side,names){
  await ensurePlayersLoaded();
  clearTradeSide(side+'-players',side);
  var c=document.getElementById(side+'-players');
  if(!c)return;
  names.forEach(function(nm,i){
    var pid=getPlayerIdByName(nm);
    var input;
    if(i===0)input=c.querySelector('input');
    else{addRow(side+'-players',side);var inputs=c.querySelectorAll('input');input=inputs[inputs.length-1];}
    if(input){
      input.value=nm;
      if(pid){input.dataset.playerId=pid;input.dataset.playerPos=(allPlayers[pid]||{}).pos||'';}
      input.blur();
    }
  });
  updateKtcLive();
  try{_boardSyncFromRows(side);}catch(_){}   // mirror shared/counter trades onto the boards
}

// ── 5. NEGOTIATION COACH ────────────────────────────────────────────────────
async function coachSend(){
  var inp=document.getElementById('coach-input');
  var out=document.getElementById('coach-output');
  var btn=document.getElementById('coach-send');
  if(!inp||!out)return;
  var text=inp.value.trim();
  if(!text||window._coachBusy)return;
  window._coachBusy=true;
  if(btn){btn.disabled=true;btn.textContent='Mac is drafting...';}
  out.style.display='block';out.textContent='Thinking through the negotiation...';
  try{
    var res=await fetch('/api/sage/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueContext:_sageLeagueCtx(),user:localStorage.getItem('tm_username')||'',device:_deviceId(),messages:[{role:'user',content:'NEGOTIATION COACH MODE. Below is a trade conversation from my league chat plus what I want. Draft the exact next message I should send - persuasive, casual league-chat tone, no salesman energy. Then add one line of strategy advice.\n\n'+text.slice(0,1600)}]})});
    var d=await res.json().catch(function(){return {};});
    out.textContent=(res.ok&&d.answer)?d.answer:'Mac hit a snag. Try again in a moment.';
  }catch(_){out.textContent='Mac hit a snag. Try again in a moment.';}
  window._coachBusy=false;
  if(btn){btn.disabled=false;btn.textContent='Draft my reply';}
}

// ── 6. PUBLIC PLAYER PAGES ──────────────────────────────────────────────────
function playerSlug(name){return String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function copyPlayerLink(name){
  var url=window.location.origin+'/player/'+playerSlug(name);
  navigator.clipboard.writeText(url).then(function(){
    var b=document.getElementById('pm-copy-link');
    if(b){b.textContent='Link copied';setTimeout(function(){b.textContent='Copy link';},1600);}
  });
}
(function handlePlayerUrl(){
  var m=window.location.pathname.match(/^\/player\/([a-z0-9-]+)/i);
  if(!m)return;
  var slug=m[1].toLowerCase();
  ensurePlayersLoaded().then(function(){
    var found=Object.values(allPlayers).find(function(p){return p.name&&playerSlug(p.name)===slug;});
    if(found)setTimeout(function(){openPlayerCard(found.id,found.name);},400);
  });
})();

// Quiet startup badge: count active-league trades newer than last seen (no network)
setTimeout(function(){
  try{
    var seen=parseInt(localStorage.getItem('tm_alerts_seen')||'0');
    var fresh=(leagueTrades||[]).filter(function(t){return (t.created||0)>seen;}).length;
    var badge=document.getElementById('alerts-badge');
    if(badge&&fresh){badge.style.display='flex';badge.textContent=fresh>9?'9+':fresh;}
  }catch(_){}
},7000);

// Coach input activates alongside the chat when the key is present
(function initCoach(){
  fetch('/api/sage/status').then(function(r){return r.json();}).then(function(d){
    if(d&&d.configured){
      var inp=document.getElementById('coach-input');
      var btn=document.getElementById('coach-send');
      if(inp){inp.disabled=false;inp.placeholder='Paste the conversation and what you want out of it...';}
      if(btn)btn.disabled=false;
    }
  }).catch(function(){});
})();


// Pull the live NFL calendar once at startup so all copy is week-aware
(function initNflState(){
  sleeperGet('/state/nfl').then(function(st){
    if(!st)return;
    NFL_WEEK=st.week||0;
    NFL_SEASON_TYPE=st.season_type||'off';
    if(st.league_season)ACTIVE_SEASON=st.league_season;
    updateQuestionsForMode();
  }).catch(function(){});
})();
async function finishYahooImport(idx){
  var st=document.getElementById('yahoo-status');
  if(idx===undefined){
    var sel=document.getElementById('yahoo-team-select');
    if(!sel||sel.value==='')return;
    idx=parseInt(sel.value);
  }
  var team=_yahooTeams&&_yahooTeams[idx];
  if(!team)return;
  if(st)st.textContent='Matching players...';
  await ensurePlayersLoaded();
  var res=_resolveNames(team.players.map(function(p){return p.name;}));
  if(res.players.length<3){if(st)st.textContent='Could only match '+res.players.length+' players from that roster.';return;}
  userId='yahoo';
  myRoster=res.players.sort(function(a,b){return po(a.pos)-po(b.pos);});
  leagueRosters=[{roster_id:1,owner_id:'yahoo',players:myRoster.map(function(p){return p.id;}),settings:{}}];
  leagueUsers=[{user_id:'yahoo',display_name:team.team_name,metadata:{}}];
  _leagueLoadSeq++;resetTradeWorkspace();  // invalidate any in-flight Sleeper background load + clear old trade
  myPicks=[];leaguePicks=[];leagueTrades=[];tradeStats={};
  leagueName=team.team_name;leagueSeason=ACTIVE_SEASON;leagueMode='redraft';
  fetchKtcValues(1,1,false);
  var osel=document.getElementById('opp-select');
  if(osel)osel.innerHTML="<option value=''>- No league connected - </option>";
  updateModeUI();
  _showBuilderUI(team.team_name,'Yahoo import · '+myRoster.length+' players matched'+(res.missed.length?' · '+res.missed.length+' not found':''));
  if(st)st.textContent='';
}

function getRosterOwnerName(rosterId){
  var roster=leagueRosters.find(function(r){return r.roster_id===rosterId;});
  if(!roster)return null;
  var user=leagueUsers.find(function(u){return u.user_id===roster.owner_id;});
  return user?(user.display_name||user.username||null):null;
}

function resetAll(){
  document.getElementById("builder-panel").style.display="none";
  document.getElementById("result-panel").classList.remove("visible");
  document.getElementById("league-panel").style.display="block";
  document.getElementById("login-panel").style.display="block";
  var ip=document.getElementById("ideas-panel");if(ip)ip.style.display="none";
  var ph=document.getElementById("right-placeholder");if(ph)ph.style.display="flex";
  leagueId=null; myRoster=[]; oppRoster=[]; myPicks=[]; oppPicks=[];
}

// ── In-place league switcher: searchable dropdown, no trip back to login ─────
function openLeagueSwitcher(){
  var dd=document.getElementById('lg-switch-dd');
  if(!dd)return;
  if(dd.style.display==='block'){dd.style.display='none';return;}
  _renderLeagueSwitcher('');
  dd.style.display='block';
  var inp=document.getElementById('lg-switch-q');
  if(inp)setTimeout(function(){inp.focus();},40);
}
function _renderLeagueSwitcher(q){
  var dd=document.getElementById('lg-switch-dd');
  if(!dd)return;
  var leagues=window._myLeagues||[];
  var ql=q.toLowerCase().trim();
  var hits=leagues.filter(function(l){return !ql||(l.name||'').toLowerCase().indexOf(ql)>=0;});
  var html='<div style="padding:8px 8px 6px;position:sticky;top:0;background:var(--surface2);z-index:1">'
    +'<input type="text" id="lg-switch-q" class="tm-input" style="width:100%;font-size:12px;padding:7px 11px" '
    +'placeholder="Search your leagues..." autocomplete="off" value="'+q.replace(/"/g,'&quot;')+'" '
    +'oninput="_renderLeagueSwitcher(this.value)" onclick="event.stopPropagation()"></div>';
  if(hits.length){
    html+=hits.map(function(l){
      var active=l.league_id===leagueId;
      var nm=(l.name||'League').replace(/&/g,'&amp;').replace(/</g,'&lt;');
      return '<div class="ac-item" style="'+(active?'color:var(--accent-bright);':'')+'padding:9px 12px;cursor:pointer" '
        +'onmousedown="switchToLeague(\''+l.league_id+'\')">'
        +(active?'&#9679; ':'')+nm
        +' <span style="font-size:10px;color:var(--muted)">'+(l.season||'')+'</span></div>';
    }).join('');
  }else{
    html+='<div style="padding:11px 12px;font-size:11.5px;color:var(--muted)">'
      +(leagues.length?'No league matches that.':'No leagues loaded for this account.')+'</div>';
  }
  html+='<div style="border-top:1px solid var(--border);padding:8px 12px">'
    +'<span style="font-size:11px;color:var(--muted);cursor:pointer" onmousedown="document.getElementById(\'lg-switch-dd\').style.display=\'none\';resetAll();scrollToEl(document.getElementById(\'login-panel\'))">Use a different Sleeper account</span></div>';
  dd.innerHTML=html;
  // preserve caret position while typing
  var inp=document.getElementById('lg-switch-q');
  if(inp&&q){inp.focus();inp.setSelectionRange(q.length,q.length);}
}
function switchToLeague(lid){
  var dd=document.getElementById('lg-switch-dd');
  if(dd)dd.style.display='none';
  if(lid===leagueId)return;
  var l=(window._myLeagues||[]).find(function(x){return x.league_id===lid;});
  loadLeague(lid,(l&&l.name)||'League',null,(l&&l.season)||ACTIVE_SEASON);
}
document.addEventListener('click',function(e){
  if(!e.target.closest('#lg-switch-wrap')){
    var dd=document.getElementById('lg-switch-dd');
    if(dd)dd.style.display='none';
  }
});

var _lastOppUid=null;
// A roster's owner_id is only its PRIMARY owner. Sleeper also has co-owners,
// and the opponent dropdown is built from leagueUsers (user_id), so a
// co-owned team appeared in the list and then matched no roster at all: the
// board rendered empty with nothing explaining why. Check co_owners too.
function _rosterForUser(uid){
  if(!uid||!Array.isArray(leagueRosters))return null;
  return leagueRosters.find(function(r){return r.owner_id===uid;})
      || leagueRosters.find(function(r){return Array.isArray(r.co_owners)&&r.co_owners.indexOf(uid)>=0;})
      || null;
}
async function loadOppRoster(){
  var uid=document.getElementById("opp-select").value;
  if(!uid)return;
  // New opponent = their old players are stale - clear the "you get" side
  if(_lastOppUid!==null&&_lastOppUid!==uid){
    clearTradeSide('get-players','get');
    resetYourQuestions();
  }
  _lastOppUid=uid;
  // The player pool loads async on a fresh session: an opponent picked before it
  // lands rendered an empty roster. Wait for it, then always re-render the board.
  if(Object.keys(allPlayers).length<100){
    try{await ensurePlayersLoaded();}catch(_){}
  }
  var obj=_rosterForUser(uid);
  oppRoster=obj?(obj.players||[]).map(function(pid){return allPlayers[pid];}).filter(Boolean).sort(function(a,b){return po(a.pos)-po(b.pos);}):[];
  // Never fail silently. An empty board with no explanation reads as broken,
  // and this is the step right before someone analyses a trade.
  if(!obj||!oppRoster.length){
    var _b=document.getElementById('board-opp');
    if(_b)_b.innerHTML='<div class="bb-empty">Could not load that roster. Pick another team, or reload your league from the top of this page.</div>';
    console.warn('[TM] opponent roster not resolved for user',uid,'rosters:',(leagueRosters||[]).length);
  }
  // Get the selected season from league meta
  var season=ACTIVE_SEASON;
  oppPicks=obj?buildPicksForRoster(obj,leaguePicks,season):[];
  try{renderTradeBoards();}catch(_){}
}

function buildPicksForRoster(rosterObj,tradedPicks,season){
  var rid=rosterObj.roster_id;
  var picks=[];
  var curYear=parseInt(season)||2026;
  // How far out and how deep this league actually trades. Both used to be
  // hardcoded (two seasons, four rounds) and dynasty rosters lost real assets
  // because of it: Sleeper carries three future drafts by default, and plenty
  // of leagues run five- or six-round rookie drafts. Take the league's own
  // numbers, and widen to whatever its traded-pick ledger proves it uses.
  var maxRnd=Math.max(4, parseInt(window._draftRounds)||0);
  var lastYr=curYear+2;
  (tradedPicks||[]).forEach(function(p){
    var y=parseInt(p.season), r=parseInt(p.round);
    if(y>lastYr&&y<=curYear+6)lastYr=y;
    if(r>maxRnd&&r<=10)maxRnd=r;
  });
  for(var yr=curYear;yr<=lastYr;yr++){
    if(window._doneDraftSeasons&&window._doneDraftSeasons[yr])continue; // that draft already happened
    for(var rnd=1;rnd<=maxRnd;rnd++){
      // Check if this pick has been traded away
      var traded=tradedPicks.find(function(p){
        return p.roster_id===rid&&parseInt(p.season)===yr&&p.round===rnd&&p.owner_id!==rid;
      });
      if(!traded){
        picks.push({season:yr,round:rnd,name:yr+" Round "+rnd,label:yr+" Round "+rnd,pos:"PK",team:""});
      }
    }
  }
  // Add picks received via trades - include original owner name
  tradedPicks.forEach(function(p){
    if(window._doneDraftSeasons&&window._doneDraftSeasons[parseInt(p.season)])return;
    if(p.owner_id===rid&&p.roster_id!==rid){
      var exists=picks.find(function(x){return x.season===parseInt(p.season)&&x.round===p.round&&x.ownerRosterId===p.roster_id;});
      if(!exists){
        var ownerName=getRosterOwnerName(p.roster_id);
        picks.push({season:parseInt(p.season),round:p.round,name:p.season+" Round "+p.round+" (via trade)",label:p.season+" Round "+p.round+" (via trade)",pos:"PK",team:"",ownerRosterId:p.roster_id,ownerName:ownerName});
      }
    }
  });
  // Sort by year then round
  picks.sort(function(a,b){return a.season!==b.season?a.season-b.season:a.round-b.round;});
  return picks;
}

function acInput(input){
  var q=input.value.toLowerCase().trim();
  var wrap=input.closest(".ac-wrap");
  var dd=wrap?wrap.querySelector(".ac-dropdown"):null;
  if(!dd)return;
  // No league yet? Load the full player DB, then re-run so results fill in.
  if(Object.keys(allPlayers).length<100&&!window._acLoading){
    window._acLoading=true;
    ensurePlayersLoaded().then(function(){window._acLoading=false;try{acInput(input);}catch(_){}}).catch(function(){window._acLoading=false;});
  }
  var side=input.dataset.side;
  var playerPool=side==="give"?myRoster:oppRoster;
  var pickPool=side==="give"?myPicks:oppPicks;
  var combined=playerPool.concat(pickPool);
  var src=combined.length>0?combined:(Object.keys(allPlayers).length>0?Object.values(allPlayers):FALLBACK_PLAYERS);
  // Get names already selected on this side (excluding the current input)
  var sideId=side==="give"?"give-players":"get-players";
  var sideContainer=document.getElementById(sideId);
  var usedNames=sideContainer
    ? Array.from(sideContainer.querySelectorAll("input"))
        .filter(function(inp){return inp!==input&&inp.value.trim();})
        .map(function(inp){return inp.value.trim().toLowerCase();})
    : [];

  var res;
  if(!q){
    if(!src.length){dd.classList.remove("open");return;}
    res=src.slice()
      .sort(function(a,b){return getKtcValue(b.name,b.id)-getKtcValue(a.name,a.id);})
      .filter(function(p){return !usedNames.includes(p.name.toLowerCase());})
      .slice(0,16);
  } else {
    res=src.filter(function(p){
      return p&&p.name&&p.name.toLowerCase().indexOf(q)>=0&&!usedNames.includes(p.name.toLowerCase());
    }).slice(0,14);
  }
  if(!res.length){ dd.classList.remove("open"); return; }
  var rows=[];
  for(var i=0;i<res.length;i++){
    var p=res[i];
    var isPick=(p.pos==="PK");
    var pos=p.pos||"?";
    var team=isPick?"Pick":(p.team||"FA");
    var ktc=isPick?0:getKtcValue(p.name,p.id);
    var ktcStr="";
    var pid=p.id||"";
    var safe=p.name.replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    var imgStr;
    if(!isPick&&pid){
      imgStr="<span onmousedown=\"event.stopPropagation();openPlayerCard('"+pid+"','"+safe+"')\" style='cursor:pointer;flex-shrink:0' title='View player card'><img class=\"ac-thumb\" src=\"https://sleepercdn.com/content/nfl/players/thumb/"+pid+".jpg\" onerror=\"this.style.display='none'\" alt=\"\"></span>";
    } else if(isPick){
      imgStr="<div class=\"ac-thumb-placeholder\">"+p.round+"</div>";
    } else {
      imgStr="<div class=\"ac-thumb-placeholder\">"+pos+"</div>";
    }
    var teamLogoStr="";
    if(!isPick&&team&&team!=="FA"){
      teamLogoStr="<img class=\"ac-team-logo\" src=\"https://sleepercdn.com/images/team_logos/nfl/"+team.toLowerCase()+".png\" onerror=\"this.style.display='none'\" alt=\""+team+"\">";
    }
    var posColor=isPick?"background:rgba(167,139,250,0.15);color:#a78bfa":"";
    var pickOwnerStr="";
    if(isPick&&p.ownerName){pickOwnerStr="<span style='color:var(--accent-bright);font-weight:600'>"+p.ownerName+"'s pick</span>";}
    else if(isPick){pickOwnerStr="<span style='color:var(--muted)'>own pick</span>";}
    var subLine=isPick?pickOwnerStr:(teamLogoStr+team);
    var row="<div class=\"ac-item\" onmousedown=\"acSelect(this,&quot;"+safe+"&quot;,'"+pos+"','"+pid+"')\">"+imgStr+"<span style=\"flex:1\"><span style=\"display:block;font-size:13px;color:var(--text)\">"+p.name+"</span><span style=\"font-size:11px;color:var(--muted);display:flex;align-items:center;gap:4px\">"+subLine+"</span></span><span class=\"ac-pos\" style=\""+posColor+"\">"+pos+"</span>"+ktcStr+"</div>";
    rows.push(row);
  }
  dd.innerHTML=rows.join("");
  dd.classList.add("open");
}

function acSelect(el,name,pos,playerId){
  // Decode HTML entities in name
  var decoded=name.replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  var row=el.closest(".player-row")||el.closest(".player-input-row");
  if(!row){ var wrap=el.closest(".ac-wrap"); if(wrap)row=wrap.parentElement; }
  if(!row)return;
  var inp=row.querySelector("input");
  var badge=row.querySelector(".pos-tag,.pos-badge");
  if(inp){
    inp.value=decoded;
    inp.dataset.playerId=playerId||"";
    inp.dataset.playerPos=pos||"";
  }
  if(badge){
    badge.textContent=pos;
    badge.style.visibility="visible";
    var base=badge.classList.contains("pos-tag")?"pos-tag ":"pos-badge ";
    badge.className=base+pos;
  }
  var dd=el.closest(".ac-dropdown");
  if(dd)dd.classList.remove("open");

  // Inject/update clickable player avatar for the info modal
  var isPick=(pos==="PK"||!playerId);
  var existing=row.querySelector(".player-info-btn");
  if(existing)existing.remove();
  var btn=document.createElement("button");
  btn.className="player-info-btn";
  btn.title="View player card";
  var safeId=playerId||"";
  var safeName=decoded.replace(/'/g,"\\'");
  btn.setAttribute("onclick","openPlayerCard('"+safeId+"','"+safeName+"')");
  if(!isPick&&playerId){
    btn.innerHTML="<img src='https://sleepercdn.com/content/nfl/players/thumb/"+playerId+".jpg' onerror='this.parentNode.innerHTML=\"<div class=ph>\"+\""+pos+"\"+\"</div>\"' alt=''>";
  } else {
    btn.innerHTML="<div class='ph'>"+pos+"</div>";
  }
  // Insert before the remove button
  var removeBtn=row.querySelector(".remove-btn");
  if(removeBtn)row.insertBefore(btn,removeBtn);
  else row.appendChild(btn);

  updateKtcLive();
  // Re-render the 3 questions so pick-aware wording kicks in the moment a pick
  // is added to either side.
  try{updateQuestionsForMode();}catch(_){}
}

function acHide(inp){
  setTimeout(function(){
    var wrap=inp.closest(".ac-wrap");
    var dd=wrap?wrap.querySelector(".ac-dropdown"):null;
    if(dd)dd.classList.remove("open");
  },200);
}

function addRow(cid,side){
  var c=document.getElementById(cid);
  var row=document.createElement("div");
  row.className="player-row";
  row.innerHTML="<span class='pos-tag' style='visibility:hidden'>--</span><div class='ac-wrap'><input type='text' class='tm-input' style='width:100%' placeholder='Search players...' data-side='"+side+"' oninput='acInput(this)' onfocus='acInput(this)' onblur='acHide(this)' autocomplete='off'><div class='ac-dropdown'></div></div><button class='remove-btn' onclick='removeRow(this)' title='Remove'>×</button>";
  c.appendChild(row);
  setTimeout(function(){var inp=row.querySelector('input');if(inp)inp.focus();},50);
}

function removeRow(btn){
  var row=btn.closest(".player-row")||btn.closest(".player-input-row");
  if(!row)return;
  var container=row.parentElement;
  // Always keep at least one row per side
  if(container.querySelectorAll(".player-row,.player-input-row").length>1){
    row.remove();
  } else {
    // Just clear the input instead of removing
    var inp=row.querySelector("input");
    if(inp){inp.value="";inp.dataset.playerId="";inp.dataset.playerPos="";}
    var badge=row.querySelector(".pos-tag,.pos-badge");
    if(badge){badge.style.visibility="hidden";}
  }
  updateKtcLive();
  try{updateQuestionsForMode();}catch(_){}
}

// Reset one side of the trade to a single empty search row
function clearTradeSide(cid,side){
  var c=document.getElementById(cid);
  if(!c)return;
  c.innerHTML="<div class='player-row'>"
    +"<span class='pos-tag' style='visibility:hidden'>--</span>"
    +"<div class='ac-wrap'><input type='text' class='tm-input' style='width:100%' placeholder='"+(side==='give'?'Search your players...':'Search their players...')+"' data-side='"+side+"' oninput='acInput(this)' onfocus='acInput(this)' onblur='acHide(this)' autocomplete='off'><div class='ac-dropdown'></div></div>"
    +"<button class='remove-btn' onclick='removeRow(this)' title='Remove'>×</button></div>";
  // Cleared by the user (not by a board sync): the board selection empties too
  if(!_syncingBoard&&typeof _boardSel!=='undefined'&&_boardSel[side]){
    _boardSel[side]={};
    try{renderTradeBoards();}catch(_){}
  }
  updateKtcLive();
}

// A different trade deserves fresh answers - wipe the 3 questions back to step one
function resetYourQuestions(){
  var had=youAnswers[0]!=null||youAnswers[1]!=null||youAnswers[2]!=null;
  youAnswers[0]=null;youAnswers[1]=null;youAnswers[2]=null;
  currentYQ=0;
  for(var i=0;i<3;i++){
    var st=document.getElementById('yq-'+i);
    if(!st)continue;
    st.querySelectorAll('.q-opt').forEach(function(o){o.classList.remove('sel','selected');});
    st.classList.toggle('active',i===0);
  }
  return had;
}

// Loading a different league must not leave the previous league's trade on screen.
// Wipe both sides, the 3 questions, the chosen opponent and the verdict panel so
// nothing stale carries across the switch.
function resetTradeWorkspace(){
  _boardSel={give:{},get:{}};
  try{ clearTradeSide('give-players','give'); }catch(_){}
  try{ clearTradeSide('get-players','get'); }catch(_){}
  try{ resetYourQuestions(); }catch(_){}
  oppRoster=[]; oppPicks=[];
  var sel=document.getElementById('opp-select'); if(sel)sel.value='';
  var rp=document.getElementById('result-panel'); if(rp)rp.classList.remove('visible');
  _lastTradeSig='';
  try{ renderTradeBoards(); }catch(_){}
}

// ── ROSTER BOARD BUILDER ─────────────────────────────────────────────────────
// Tap players on both rosters to build the trade, Sleeper-style. The boards
// write into the classic builder's (hidden) rows, so updateKtcLive, the value
// bar, the 3-question reveal, analysis, share links and counters all work
// exactly as before. The classic builder stays available behind a toggle.
var _boardSel={give:{},get:{}};       // side -> {key: asset}
var _boardExpand={give:false,get:false};
var _syncingBoard=false;              // guards clearTradeSide recursion
var _BB_POS_COLORS={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',PK:'#8b6bff'};
var _BB_VISIBLE=12;                   // tiles shown before "+N more"

function _boardAssets(side){
  // players first (pos order then value), then picks in dynasty leagues
  var players=(side==='give'?myRoster:oppRoster)||[];
  var picks=(side==='give'?myPicks:oppPicks)||[];
  var list=players.map(function(p){
    return {key:'p'+p.id,kind:'p',id:p.id,name:p.name,pos:p.pos,team:p.team,
            val:getKtcValue(p.name,p.id)||0};
  }).sort(function(a,b){
    var pa=po((allPlayers[a.id]||{}).pos),pb=po((allPlayers[b.id]||{}).pos);
    return pa-pb||b.val-a.val;
  });
  if(leagueMode==='dynasty'){
    list=list.concat(picks.map(function(k,ki){
      // key must be UNIQUE per pick: two traded "2027 Round 1 (via trade)" picks share
      // a name, and a name-based key made one click select all of them
      return {key:'k'+(k.season||'')+'r'+(k.round||'')+'o'+(k.ownerRosterId!=null?k.ownerRosterId:'own')+'i'+ki,
              kind:'k',name:k.name,pos:'PK',team:'',
              season:k.season,round:k.round,via:k.ownerName||'',ownerRosterId:k.ownerRosterId,
              val:getKtcValue(k.name)||0};
    }));
  }
  return list;
}
function renderTradeBoards(){
  var boards={give:document.getElementById('board-mine'),get:document.getElementById('board-opp')};
  if(!boards.give&&!boards.get)return;
  ['give','get'].forEach(function(side){
    var box=boards[side]; if(!box)return;
    var assets=_boardAssets(side);
    if(!assets.length){
      box.innerHTML='<div class="bb-empty">'+(side==='give'
        ?'Connect a league to see your roster here.'
        :'Pick an opponent above to see their roster.')+'</div>';
      var c0=document.getElementById('bb-count-'+side); if(c0)c0.textContent='';
      return;
    }
    var showAll=_boardExpand[side];
    var visible=showAll?assets:assets.slice(0,_BB_VISIBLE);
    var html=visible.map(function(a){
      var on=!!_boardSel[side][a.key];
      var col=_BB_POS_COLORS[a.pos]||'var(--muted)';
      var parts=a.name.split(' ');
      // Picks show their PROJECTED slot (e.g. "2027 1.05") when we can estimate it,
      // falling back to the round. Own picks project your slot; via-trade picks
      // project the original owner's.
      // Picks: show the PROJECTED slot (e.g. "1.09") INSIDE the bubble, and just the
      // year ("2027") as the name. Own picks project your slot; via-trade picks the
      // original owner's. Falls back to "R1" when we can't estimate.
      var short,_pickNo;
      if(a.kind==='k'){
        var _oid=(a.ownerRosterId!=null)?a.ownerRosterId:_myRosterId();
        var _sl=null;try{_sl=estimatePickSlot(_oid);}catch(_){}
        _pickNo=_sl?(a.round+'.'+String(_sl.slot).padStart(2,'0')):('R'+a.round);
        short=(a.season||'')+'';
      } else short=a.name; // full name, tile wraps
      var faceInner=a.kind==='p'
        ?(a.pos==='DEF'
            ?'<img class="bb-def" src="https://sleepercdn.com/images/team_logos/nfl/'+String(a.team||a.id).toLowerCase()+'.png" alt="" loading="lazy" onerror="this.remove()">'
            :'<span class="bb-ini">'+(parts[0].charAt(0)+(parts[1]?parts[1].charAt(0):'')).toUpperCase()+'</span>'
              +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+a.id+'.jpg" alt="" loading="lazy" onerror="this.remove()">')
        :'<span class="bb-ini bb-pick">'+(_pickNo||('R'+((a.name.match(/Round (\d)/)||[,'?'])[1])))+'</span>';
      return '<button type="button" class="bb-tile'+(on?' on':'')+'" style="--bbp:'+col+'" '
        +'aria-pressed="'+on+'" aria-label="'+a.name.replace(/"/g,'&quot;')+'" '
        +'onclick="boardToggle(\''+side+'\',\''+a.key.replace(/'/g,"\\'")+'\')">'
        +'<span class="bb-tick"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></span>'
        +'<span class="bb-face">'+faceInner+'</span>'
        +'<span class="bb-nm" title="'+a.name.replace(/"/g,'&quot;')+'">'+short+'</span>'
        +'<span class="bb-meta"><b style="color:'+col+'">'+(a.kind==='k'?'PICK':a.pos)+'</b>'
        +(a.kind==='p'?teamLogo(a.team,11):'')
        +(a.kind==='k'?'<span>'+(a.via?'via '+a.via.replace(/</g,'&lt;'):'your pick')+'</span>':'')
        +(a.kind==='p'&&allPlayers[a.id]&&allPlayers[a.id].age?'<span class="bb-age">Age '+allPlayers[a.id].age+'</span>':'')+'</span>'
        +'</button>';
    }).join('');
    if(!showAll&&assets.length>_BB_VISIBLE){
      html+='<button type="button" class="bb-tile bb-more" onclick="_boardExpand.'+side+'=true;renderTradeBoards()">'
        +'<span class="bb-more-n">+'+(assets.length-_BB_VISIBLE)+'</span><span class="bb-nm">more</span></button>';
    }else if(showAll&&assets.length>_BB_VISIBLE){
      html+='<button type="button" class="bb-tile bb-more" onclick="_boardExpand.'+side+'=false;renderTradeBoards()">'
        +'<span class="bb-more-n">&minus;</span><span class="bb-nm">show less</span></button>';
    }
    box.innerHTML=html;
    var n=Object.keys(_boardSel[side]).length;
    var c=document.getElementById('bb-count-'+side);
    if(c)c.textContent=n?n+' selected':'';
  });
  // Portrait phones stack the two boards until an opponent roster is loaded, so
  // "You send" reads full width instead of being squeezed beside a tall empty
  // "You receive" column. The class flips the layout to side-by-side once the
  // opponent's players exist. Desktop ignores it (always side-by-side).
  var _wrap=(boards.get||boards.give);
  _wrap=_wrap&&_wrap.closest('.bb-boards');
  if(_wrap)_wrap.classList.toggle('has-opp',_boardAssets('get').length>0);
}
function boardToggle(side,key){
  var asset=_boardAssets(side).find(function(a){return a.key===key;});
  if(!asset)return;
  try{sndPickSoft();}catch(_){}
  if(_boardSel[side][key])delete _boardSel[side][key];
  else _boardSel[side][key]=asset;
  renderTradeBoards();
  _syncRowsFromBoard(side);
}
function _syncRowsFromBoard(side){
  var cid=side+'-players';
  var c=document.getElementById(cid);
  if(!c)return;
  _syncingBoard=true;
  try{
    clearTradeSide(cid,side);                       // one empty row
    var sel=Object.keys(_boardSel[side]).map(function(k){return _boardSel[side][k];});
    sel.forEach(function(a,i){
      var input;
      if(i===0)input=c.querySelector('input');
      else{addRow(cid,side);var inputs=c.querySelectorAll('input');input=inputs[inputs.length-1];}
      if(!input)return;
      input.value=a.name;
      if(a.kind==='p'){input.dataset.playerId=a.id;input.dataset.playerPos=a.pos;}
      else{input.dataset.playerId='';input.dataset.playerPos='';}
      var badge=input.closest('.player-row')&&input.closest('.player-row').querySelector('.pos-tag');
      if(badge){badge.textContent=a.kind==='k'?'PK':a.pos;badge.style.visibility='visible';}
    });
  }finally{_syncingBoard=false;}
  updateKtcLive();
}
function _boardSyncFromRows(side){
  // shared trade links and counters fill the classic rows: mirror them onto the board
  var c=document.getElementById(side+'-players');
  if(!c)return;
  _boardSel[side]={};
  Array.from(c.querySelectorAll('input')).forEach(function(i){
    var v=i.value.trim(); if(!v)return;
    if(i.dataset.playerId){
      var p=allPlayers[i.dataset.playerId];
      _boardSel[side]['p'+i.dataset.playerId]={key:'p'+i.dataset.playerId,kind:'p',id:i.dataset.playerId,
        name:v,pos:(p||{}).pos||'?',team:(p||{}).team||'',val:getKtcValue(v,i.dataset.playerId)||0};
    }else if(/round|pick/i.test(v)){
      _boardSel[side]['k'+v]={key:'k'+v,kind:'k',name:v,pos:'PK',team:'',val:getKtcValue(v)||0};
    }
  });
  renderTradeBoards();
}
function boardClearAll(){
  clearTradeSide('give-players','give');
  clearTradeSide('get-players','get');
  resetYourQuestions();
}
function toggleClassicBuilder(){
  var cb=document.getElementById('classic-builder');
  var t=document.getElementById('classic-toggle');
  if(!cb)return;
  var open=cb.style.display!=='none';
  cb.style.display=open?'none':'block';
  if(t)t.textContent=open?'Prefer typing? Open the classic builder':'Hide the classic builder';
  if(open){['give','get'].forEach(_boardSyncFromRows);}   // typed edits flow back to the boards
}

var _lastTradeSig='';
function _tradeSigCheck(){
  // Signature only counts CONFIRMED players (picked from the dropdown), so typing doesn't trigger it
  var ids=Array.from(document.querySelectorAll('#give-players input,#get-players input'))
    .map(function(i){return i.dataset.playerId||(/round|pick/i.test(i.value)?i.value.trim().toLowerCase():'');})
    .filter(Boolean).join('|');
  if(ids!==_lastTradeSig){
    var changed=_lastTradeSig!=='';
    _lastTradeSig=ids;
    if(changed)resetYourQuestions();
  }
}

function updateKtcLive(){
  _tradeSigCheck();
  var giveInputs=Array.from(document.querySelectorAll("#give-players input"));
  var getInputs=Array.from(document.querySelectorAll("#get-players input"));
  var giveTotal=giveInputs.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var getTotal=getInputs.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var hasAny=giveTotal>0||getTotal>0;
  var live=document.getElementById("ktc-live");
  if(!live)return;
  if(!hasAny){live.style.display="none";return;}
  live.style.display="flex";
  document.getElementById("ktc-give-live").textContent="";
  document.getElementById("ktc-get-live").textContent="";
  var gap=getTotal-giveTotal;
  var gapEl=document.getElementById("ktc-gap-live");
  if(giveTotal&&getTotal){
    var gapLabel=Math.abs(gap)<200?"roughly even":gap>=1000?"big edge your way":gap>=200?"slight edge your way":gap<=-1000?"big edge their way":"slight edge their way";
    gapEl.textContent=gapLabel;
    gapEl.style.color=gap>=200?"var(--green)":gap<=-200?"var(--red)":"var(--muted)";
  } else { gapEl.textContent=""; }
  var hasGive=Array.from(document.querySelectorAll("#give-players input")).some(function(i){return i.value.trim();});
  var hasGet=Array.from(document.querySelectorAll("#get-players input")).some(function(i){return i.value.trim();});
  var ys=document.getElementById("your-section");
  if(ys){ys.style.display=(hasGive&&hasGet)?"block":"none";}
}

function updatePips(cur){
  for(var i=0;i<3;i++){
    var p=document.getElementById("pip-"+i);
    if(!p)continue;
    p.classList.remove("done","active");
    if(i<cur)p.classList.add("done");
    else if(i===cur)p.classList.add("active");
  }
}

function selectOpt(el,qi,oi){
  var step=document.getElementById("q-"+qi);
  if(!step)return;
  // Only deselect opts within THIS step
  var opts=step.querySelectorAll(".q-opt");
  for(var i=0;i<opts.length;i++) opts[i].classList.remove("sel","selected");
  el.classList.add("sel");
  answers[qi]=oi;
  setTimeout(function(){
    var maxQ=2; // 3 questions: 0,1,2
    if(qi<maxQ){
      step.classList.remove("active");
      currentQ=qi+1;
      var nextStep=document.getElementById("q-"+currentQ);
      if(nextStep) nextStep.classList.add("active");
      updatePips(currentQ);
    }else{
      showProfile();
    }
  },280);
}

function goBack(qi){
  document.getElementById("q-"+qi).classList.remove("active");
  currentQ=qi-1;
  document.getElementById("q-"+currentQ).classList.add("active");
  updatePips(currentQ);
  document.getElementById("profile-badge").classList.remove("show");
}

// Each archetype carries a dynasty desc AND a redraft desc (descR). Redraft
// leagues reset every year, so any language about multi-season decline, future
// picks, or "windows" only makes sense in dynasty. oppDesc()/oppName() below
// pick the right variant from leagueMode so a redraft opponent never gets a
// dynasty read (and vice versa). nameR overrides names that are dynasty-only.
const profiles={
  young_contender:{name:"The Young Contender",icon:"X",
    desc:"They're stacked with young talent and their window is just opening. They don't need your guys and they know it. Good luck.",
    descR:"Their starting lineup is loaded top to bottom and they know it. They don't need your guys - you'll have to overpay to pry anything loose.",
    boosts:{acceptance:-14,winNow:10,attachment:14,recency:5}},
  window_closer:{name:"The Closing Window",icon:"C",
    desc:"Their core is getting old and they're lowkey panicking. Dangle a proven starter and they'll probably overpay. Clock is ticking for them.",
    descR:"They're all-in on this season and feeling the playoff race. Dangle a proven weekly starter and they'll probably overpay to lock up a spot.",
    boosts:{acceptance:20,winNow:25,attachment:10,recency:8}},
  ktc_robot:{name:"The Spreadsheet Guy",icon:"$",
    desc:"This person literally has the values pulled up right now. They will not accept anything that doesn't add up. Don't even try to lowball.",
    descR:"This person has rest-of-season rankings pulled up right now. They won't take anything that doesn't add up on projected points. Don't lowball.",
    boosts:{acceptance:-10,winNow:0,attachment:-8,recency:-12}},
  star_hoarder:{name:"The Star Hoarder",icon:"S",
    desc:"Their studs are basically their personality. They'd rather finish last than trade their guys. Go after the depth they forgot they have.",
    descR:"Their studs are basically their personality. They'd rather miss the playoffs than deal them. Go after the flex and bench depth they forgot they have.",
    boosts:{acceptance:-5,winNow:5,attachment:20,recency:6}},
  flip_addict:{name:"The Flip Addict",icon:"F",
    desc:"This person trades for fun. They don't need a reason, they need something interesting. Make the offer look exciting and they'll bite.",
    descR:"This person trades for fun. They don't need a reason, they need something interesting. Make the offer look exciting and they'll bite.",
    boosts:{acceptance:22,winNow:5,attachment:-15,recency:10}},
  denial_manager:{name:"The Denial Manager",icon:"D",
    desc:"Their team fell off two seasons ago but they still think they're competing. Easy to manipulate - just frame it right.",
    descR:"They came in with big expectations this year but the results aren't there - and they still think they're a contender. Frame a deal as the move that saves their season.",
    boosts:{acceptance:18,winNow:20,attachment:12,recency:15}},
  counter_king:{name:"The Counter King",icon:"K",
    desc:"They will NEVER take your first offer. Just build in room to move, let them feel like they won the counter, and you actually get what you wanted.",
    descR:"They will NEVER take your first offer. Just build in room to move, let them feel like they won the counter, and you actually get what you wanted.",
    boosts:{acceptance:-6,winNow:4,attachment:8,recency:4}},
  no_mans_land:{name:"The Forever Almost",icon:"M",
    desc:"Not rebuilding, not really winning either. Stuck in the middle every single year. They'll say they're 'one piece away' until the end of time.",
    descR:"Not good enough to contend, not bad enough to punt the year. Stuck mid-standings, insisting they're 'one piece away' every single week.",
    boosts:{acceptance:10,winNow:-5,attachment:5,recency:8}},
  rebuilder:{name:"The Full Send Rebuilder",icon:"R",
    desc:"Tanking on purpose and totally fine with it. They only want picks and young players. Don't come at them with old heads.",
    nameR:"The Checked-Out Seller",
    descR:"Their season is cooked and they know it. They'll move their best players cheap just to shake things up - pounce before someone else beats you to it.",
    boosts:{acceptance:14,winNow:-15,attachment:-10,recency:5}}
};
// Format-aware resolvers - use these anywhere an opponent read is shown to the user.
function oppDesc(p){return (leagueMode==='redraft'&&p&&p.descR)?p.descR:(p?p.desc:'');}
function oppName(p){return (leagueMode==='redraft'&&p&&p.nameR)?p.nameR:(p?p.name:'');}

// Renders the archetype explainer on the Learn tab from the same profiles Mac actually uses
function renderArchetypeGuide(){
  var el=document.getElementById('archetype-guide');
  if(!el)return;
  var detect={
    young_contender:"a young roster (avg under ~2 yrs experience) that's already top-tier in market value",
    window_closer:"a veteran-heavy roster still holding value, or a trade history of converting picks into players",
    ktc_robot:"quiz answers that show they check value charts before everything else",
    star_hoarder:"a roster worth 120%+ of yours, or a manager who almost never trades",
    flip_addict:"6+ trades in a season - the highest activity level we track",
    denial_manager:"an aging roster that's lost most of its value, or a history of losing 800+ value across trades",
    counter_king:"3+ trades that all land near even value - they grind every negotiation",
    no_mans_land:"a middle-aged, middle-value roster with no clear direction",
    rebuilder:"a very young roster below average value, or a history of shipping players out for picks"
  };
  el.innerHTML=Object.keys(profiles).map(function(k){
    var p=profiles[k];
    return '<div class="d101-section"><div class="d101-term">'+p.icon+' '+p.name+'</div>'
      +'<div class="d101-def">'+p.desc+'<br><span style="color:var(--muted)"><strong style="color:var(--text)">How Mac detects it:</strong> '+(detect[k]||'roster and trade patterns')+'.</span></div></div><div class="d101-divider"></div>';
  }).join('');
}

function getProfile(ans){
  var dir=ans[0],d=ans[1],h=ans[2];
  var scores={young_contender:0,window_closer:0,ktc_robot:0,star_hoarder:0,flip_addict:0,denial_manager:0,counter_king:0,no_mans_land:0,rebuilder:0};
  if(dir===4){scores.young_contender+=40;scores.star_hoarder+=8;}
  if(dir===0){scores.window_closer+=40;scores.denial_manager+=8;}
  if(dir===1){scores.rebuilder+=40;scores.flip_addict+=6;}
  if(dir===2){scores.denial_manager+=40;scores.window_closer+=12;}
  if(dir===3){scores.no_mans_land+=40;scores.denial_manager+=6;}
  if(d===0){scores.ktc_robot+=20;scores.rebuilder+=8;scores.young_contender+=6;}
  if(d===1){scores.flip_addict+=20;scores.denial_manager+=10;scores.no_mans_land+=8;}
  if(d===2){scores.star_hoarder+=20;scores.window_closer+=10;scores.denial_manager+=6;}
  if(d===3){scores.flip_addict+=16;scores.no_mans_land+=12;scores.denial_manager+=8;}
  if(h===0){scores.flip_addict+=8;scores.ktc_robot+=6;scores.rebuilder+=6;}
  if(h===1){scores.counter_king+=30;}
  if(h===2){scores.ktc_robot+=8;scores.young_contender+=6;scores.star_hoarder+=5;}
  var best="denial_manager",bestScore=-1;
  Object.keys(scores).forEach(function(k){if(scores[k]>bestScore){bestScore=scores[k];best=k;}});
  return profiles[best];
}

function showProfile(){
  var p=getProfile(answers);
  document.getElementById("profile-icon").textContent=p.icon;
  document.getElementById("profile-type").textContent=oppName(p);
  document.getElementById("profile-desc").textContent=oppDesc(p);
  document.getElementById("profile-badge").classList.add("show");
  window._profile=p;
  document.getElementById("your-section").style.display="block";
  try{_initYouSection();}catch(_){}
  document.getElementById("your-section").scrollIntoView({behavior:"smooth",block:"nearest"});
}

// Short label for a Q1 option (e.g. "Contending", "Contender") for the remembered chip.
function _q1Label(oi){
  var el=document.querySelectorAll('#yq0-opts .q-opt-text')[oi];
  if(!el)return 'Option '+String.fromCharCode(65+oi);
  return el.textContent.split(/[-,]/)[0].trim();
}
function _showQ1Chip(oi){
  var chip=document.getElementById('q1-chip');if(!chip)return;
  chip.innerHTML="<span style=\"color:var(--muted2)\">You're set as</span> <strong style=\"color:var(--text)\">"+escHtml(_q1Label(oi))+"</strong>"
    +"<button type=\"button\" onclick=\"changeQ1()\" style=\"margin-left:10px;display:inline-flex;align-items:center;gap:5px;font-family:var(--font-body);font-size:12px;font-weight:700;color:var(--accent-bright);background:var(--accent-dim);border:1px solid rgba(155,114,232,.45);border-radius:100px;padding:4px 12px;cursor:pointer;vertical-align:middle;transition:background .15s,border-color .15s\" onmouseover=\"this.style.background='rgba(155,114,232,.28)';this.style.borderColor='var(--accent-bright)'\" onmouseout=\"this.style.background='var(--accent-dim)';this.style.borderColor='rgba(155,114,232,.45)'\">"
    +"<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 12a9 9 0 0 1 15-6.7L21 8\"/><path d=\"M21 3v5h-5\"/></svg>Change</button>";
  chip.style.display='inline-flex';
}
// On each analysis: if Q1 was answered earlier this session, pre-fill it, skip its
// step, and show the "You're set as ... change" chip so you start on Q2.
function _initYouSection(){
  var saved=null;try{saved=localStorage.getItem('tm_q1_'+leagueMode);}catch(_){}
  var chip=document.getElementById('q1-chip');
  if(saved!==null&&saved!==''){
    var oi=parseInt(saved,10);
    if(!isNaN(oi)&&oi>=0&&oi<=3){
      youAnswers[0]=oi;
      _showQ1Chip(oi);
      ['yq-0','yq-1','yq-2'].forEach(function(id){var s=document.getElementById(id);if(s)s.classList.remove('active');});
      var yq1=document.getElementById('yq-1');if(yq1)yq1.classList.add('active');
      currentYQ=1;updateYPips(1);
      var p0=document.getElementById('ypip-0');if(p0)p0.classList.add('done');
      return;
    }
  }
  if(chip)chip.style.display='none';
}
function changeQ1(){
  try{localStorage.removeItem('tm_q1_'+leagueMode);}catch(_){}
  youAnswers[0]=null;
  var chip=document.getElementById('q1-chip');if(chip)chip.style.display='none';
  ['yq-0','yq-1','yq-2'].forEach(function(id){var s=document.getElementById(id);if(s)s.classList.remove('active');});
  document.querySelectorAll('#yq-0 .q-opt').forEach(function(o){o.classList.remove('sel','selected');});
  var yq0=document.getElementById('yq-0');if(yq0)yq0.classList.add('active');
  currentYQ=0;updateYPips(0);
  var p0=document.getElementById('ypip-0');if(p0)p0.classList.remove('done');
}
// Skip the personalized questions and run the analysis now - the value read renders,
// plus a call based on your remembered team window (Q2/Q3 left blank).
function skipYouQuestions(){
  ['yq-0','yq-1','yq-2'].forEach(function(id){var s=document.getElementById(id);if(s)s.classList.remove('active');});
  var dots=document.querySelector('#your-section .progress-dots');if(dots)dots.style.display='none';
  try{showYouVerdict();}catch(_){}
}

function updateYPips(cur){
  for(var i=0;i<3;i++){
    var p=document.getElementById("ypip-"+i);
    if(!p)continue;
    p.classList.remove("done","active");
    if(i<cur)p.classList.add("done");
    else if(i===cur)p.classList.add("active");
  }
}

function selectYou(el,qi,oi){
  var step=document.getElementById("yq-"+qi);
  if(!step)return;
  var opts=step.querySelectorAll(".q-opt");
  for(var i=0;i<opts.length;i++) opts[i].classList.remove("sel","selected");
  el.classList.add("sel");
  youAnswers[qi]=oi;
  // Q1 (your situation) is stable across a session - remember it so you don't
  // re-answer it on every trade. Q2/Q3 stay per-trade (they genuinely change).
  if(qi===0){try{localStorage.setItem('tm_q1_'+leagueMode,String(oi));}catch(_){}try{_showQ1Chip(oi);}catch(_){}}
  setTimeout(function(){
    if(qi<2){
      step.classList.remove("active");
      currentYQ=qi+1;
      var nextStep=document.getElementById("yq-"+currentYQ);
      if(nextStep) nextStep.classList.add("active");
      updateYPips(currentYQ);
    }else{
      showYouVerdict();
    }
  },280);
}

function goBackYou(qi){
  document.getElementById("yq-"+qi).classList.remove("active");
  currentYQ=qi-1;
  document.getElementById("yq-"+currentYQ).classList.add("active");
  updateYPips(currentYQ);
  document.getElementById("you-badge").classList.remove("show");
}

// ─── BLENDED TRADE VERDICT ───────────────────────────────────────────────────
// The value is the fact and dominates; strategic context and gut feeling are a
// soft nudge that can lift a close call but can never flip a real value edge.
// This replaces the old hard overrides where feel===2 ("I'd regret it") forced a
// hard NO no matter how lopsided the value was in the user's favor. Now the value
// has to beat a soft hesitation, not be vetoed by it. See tradeScore() below.
function _tmClamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}

// compCONTEXTO (±20, ±16.5 redraft): strategic fit from window (Q1) x goal (Q2).
// Dynasty semantics -> sit: 0=contending 1=building 2=rebuilding 3=unsure(window);
// reason: 0=initiated 1=inbound 2=fill-need 3=sell-high. The window x goal matrix
// is the mandatory minimum; we deliberately do NOT invent the finer signals
// (need/age/scarcity/timing) here because clean data for them is not available at
// this call site.
function _tmContext(sit,reason,redraft){
  var ctx=0, halve=false, unsurePenalty=0;
  if(sit===3){ halve=true; unsurePenalty=-1; } // window Unsure: soften everything, small tax
  if(sit===0){ // contending
    if(reason===2)ctx+=7;        // contending + fill-need
    else if(reason===3)ctx+=5;   // contending + sell-high
    else if(reason===0)ctx+=3;   // contending + initiated
    else if(reason===1)ctx-=2;   // contending + inbound (they need something from you)
  } else if(sit===1){ // building
    if(reason===2)ctx+=6;        // building + fill-need
    else if(reason===3)ctx+=3;   // building + sell-high
    else if(reason===0)ctx+=2;   // building + initiated
  } else if(sit===2){ // rebuilding
    if(reason===3)ctx+=6;        // rebuilding + sell-high
    else if(reason===1)ctx+=7;   // rebuilding + inbound ~= receiving youth/picks (your currency)
    else if(reason===2)ctx-=3;   // rebuilding + fill-need (wrong direction for a rebuild)
  }
  if(halve){ ctx=ctx*0.5 + unsurePenalty; }
  var cap=redraft?16.5:20;
  return _tmClamp(ctx,-cap,cap);
}

// Map score -> verdict banner. Bands: >=72 SEND IT, 58-72 DO IT (value wins),
// 46-58 CLOSE, 32-46 COUNTER FIRST, <32 WALK AWAY.
function _tmBand(score,feel){
  if(score>=72)return {score:score,verdict:"SEND IT",icon:"GO",desc:"This is a clear win. Do it."};
  if(score>=58){
    // When the gut is hesitant but the value still wins, name the tension out loud
    // so the recommendation reads as deliberate, not as ignoring the user's feel.
    var d=(feel===1||feel===2)
      ?"Your gut says no, but the value coming back is enough. In dynasty a gap this size outweighs a soft hesitation. Make it."
      :"The value is on your side and the fit works. Make it.";
    return {score:score,verdict:"DO IT, THE VALUE WINS",icon:"GO",desc:d};
  }
  if(score>=46)return {score:score,verdict:"CLOSE, YOUR CALL",icon:"WARN",desc:"The value is near even, so your read is the tiebreaker. Counter if you want an edge."};
  if(score>=32)return {score:score,verdict:"COUNTER FIRST",icon:"WARN",desc:"You are paying up here. Ask for a bit more before you send it."};
  return {score:score,verdict:"WALK AWAY",icon:"STOP",desc:"The value is not there. Pass."};
}

// tradeScore: Score = 50 (even) + compVALOR (the fact, ±30) + softTotal, clamped
// to [0,100]. softTotal = clamp(compCONTEXTO + modFEEL, -26, +22) is the guarantee
// that sentiment can nudge but never flip a real value edge.
function tradeScore(effGap,giveKtc,getKtc,youAnswers,leagueMode,hasKtc){
  var redraft=leagueMode==='redraft';
  var sit=youAnswers?youAnswers[0]:null;
  var reason=youAnswers?youAnswers[1]:null;
  var feel=youAnswers?youAnswers[2]:null;
  // Redraft asks the same questions in a different option order; remap Q1/Q2 to
  // the dynasty semantics compCONTEXTO expects. Q3 (feel) already aligns.
  if(redraft){
    var _rSit={0:0,1:1,2:3,3:2}, _rRea={0:2,1:0,2:3,3:0};
    if(sit!=null&&_rSit[sit]!=null)sit=_rSit[sit];
    if(reason!=null&&_rRea[reason]!=null)reason=_rRea[reason];
  }
  // modFEEL (Q3 lean, additive, separate from context): fine +2, hesitant -5,
  // would-regret -12, only-numbers -4.
  var modFEEL=0;
  if(feel===0)modFEEL=2;else if(feel===1)modFEEL=-5;else if(feel===2)modFEEL=-12;else if(feel===3)modFEEL=-4;

  // No KTC: the ONLY regime where feel is allowed to dominate the read.
  if(!hasKtc){
    var ctxNo=_tmContext(sit,reason,redraft);
    return _tmBand(_tmClamp(50 + 1.5*ctxNo + 2*modFEEL, 0, 100), feel);
  }

  // Dealbreaker gate (runs BEFORE the score). D1 hard fleece: a big raw value
  // loss walks, regardless of feel or context. (feel===2 is NO LONGER a
  // dealbreaker - it is just -12 in modFEEL.) D2-D4 need flags we do not have
  // clean data for at this call site, so they are omitted cleanly.
  if(effGap<=-1500){
    return {score:12,verdict:"WALK AWAY",icon:"STOP",desc:"This is a big value loss. Walk away."};
  }

  // compVALOR (±30, ±33 redraft): tanh keeps it bounded; tau adapts to deal size
  // so a 1000-gap on smalls is not read like a 1000-gap on a blockbuster.
  var base=Math.max(giveKtc,getKtc);
  var tau=900*_tmClamp(base/5000,0.5,2);
  var valAmp=redraft?33:30; // redraft: age does not count, so value carries more
  var compVALOR=valAmp*Math.tanh(effGap/tau);

  // compCONTEXTO caps at ±16.5 in redraft (age drops out, context is worth less).
  var compCTX=_tmContext(sit,reason,redraft);

  // softTotal clamp is the hard ceiling/floor on sentiment - value stays in charge.
  var softTotal=_tmClamp(compCTX+modFEEL,-26,22);
  return _tmBand(_tmClamp(50 + compVALOR + softTotal, 0, 100), feel);
}

function showYouVerdict(){
  var icon,verdict,desc;
  // Blend the gut-check answers with whatever value is on the board so the
  // standalone verdict matches the full Analyze read. If no players are entered
  // yet, hasKtc is false and tradeScore falls back to a context+feel verdict.
  var giveEls=Array.from(document.querySelectorAll("#give-players input")).filter(function(i){return i.value.trim();});
  var getEls=Array.from(document.querySelectorAll("#get-players input")).filter(function(i){return i.value.trim();});
  var giveKtc=giveEls.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var getKtc=getEls.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var hasKtc=giveKtc>0||getKtc>0;
  var effGap=getKtc-giveKtc;
  var r=tradeScore(effGap,giveKtc,getKtc,youAnswers,leagueMode,hasKtc);
  verdict=r.verdict;desc=r.desc;icon=r.icon;
  document.getElementById("you-type").textContent=verdict;
  document.getElementById("you-badge").style.background=icon==="GO"?"rgba(34,197,94,0.1)":icon==="STOP"?"rgba(239,68,68,0.1)":"rgba(245,158,11,0.1)";
  document.getElementById("you-badge").style.borderColor=icon==="GO"?"rgba(34,197,94,0.35)":icon==="STOP"?"rgba(239,68,68,0.35)":"rgba(245,158,11,0.35)";
  document.getElementById("you-desc").textContent=desc;
  document.getElementById("you-badge").classList.add("show");
  window._youVerdict=verdict;
}

// ─── LIVE TICKER FEED ────────────────────────────────────────────────────────

async function loadLiveFeed(lid, season){
  try{
    var nflWeek=1;
    try{var st=await sleeperGet("/state/nfl");nflWeek=st.week||1;}catch(_){}

    var [activity, news] = await Promise.all([
      sleeperGet("/league/"+lid+"/recent-activity?week="+nflWeek).catch(function(){return [];}),
      fetch("/api/news/nfl").then(function(r){return r.json();}).catch(function(){return {headlines:[],trending_add:[],trending_drop:[]};})
    ]);

    var items=[];

    // League activity items
    var acts=activity||[];
    acts.slice(0,20).forEach(function(t){
      var rname=getRosterName(t.roster_ids&&t.roster_ids[0]);
      if(t.type==="trade"){
        var parts=[],firstPid=null;
        Object.entries(t.adds||{}).forEach(function(e){
          var p=allPlayers[e[0]];if(p){parts.push(p.name);if(!firstPid)firstPid=e[0];}
        });
        if(parts.length) items.push({text:"TRADE · "+rname,sub:parts.slice(0,2).join(" + ")+" changed hands",color:"var(--accent-bright)",pid:firstPid});
      } else if(t.type==="free_agent"||t.type==="waiver"){
        var added=[],dropped=[],addPid=null,dropPid=null;
        Object.entries(t.adds||{}).forEach(function(e){var p=allPlayers[e[0]];if(p){added.push(p.name);if(!addPid)addPid=e[0];}});
        Object.entries(t.drops||{}).forEach(function(e){var p=allPlayers[e[0]];if(p){dropped.push(p.name);if(!dropPid)dropPid=e[0];}});
        if(added.length) items.push({text:rname+" added",sub:added[0],color:"var(--green)",pid:addPid});
        if(dropped.length) items.push({text:rname+" dropped",sub:dropped[0],color:"var(--red)",pid:dropPid});
      }
    });

    // Trending adds (buy-low signal)
    var tAdd=news.trending_add||[];
    tAdd.slice(0,5).forEach(function(p){
      var player=allPlayers[p.player_id];
      if(player) items.push({text:"Trending add across Sleeper",sub:player.name+" · "+player.pos,color:"var(--green)",pid:player.id});
    });

    // Trending drops (sell-high / avoid signal)
    var tDrop=news.trending_drop||[];
    tDrop.slice(0,5).forEach(function(p){
      var player=allPlayers[p.player_id];
      if(player) items.push({text:"People are dropping",sub:player.name+" · "+player.pos,color:"var(--red)"});
    });

    // Real ESPN headlines only. (Invented "beat reporter" headlines used to live
    // here - they were removed because attributing made-up trades and injuries to
    // real outlets is not something the site should show.)
    var headlines=news.headlines||[];
    headlines.slice(0,12).forEach(function(h){
      items.push({text:"NFL NEWS",sub:h,color:"var(--muted)"});
    });

    if(!items.length) return;

    // If the user switched leagues while this feed loaded, don't paint the old one's ticker
    if(lid!==leagueId) return;

    // Duplicate for infinite scroll
    var all=items.concat(items);
    var ticker=document.getElementById("live-ticker");
    if(!ticker)return;
    var bar=document.getElementById("ticker-bar");
    if(bar&&all.length){bar.style.display="block";document.body.classList.add("ticker-on");}
    ticker.innerHTML=all.map(function(it){
      var img=it.pid?"<img src='https://sleepercdn.com/content/nfl/players/thumb/"+it.pid+".jpg' style='width:18px;height:18px;border-radius:50%;object-fit:cover' onerror=\"this.style.display='none'\">"+((allPlayers[it.pid]||{}).team?teamLogo(allPlayers[it.pid].team,14):""):"";
      return "<div class='ticker-item'><span class='dot' style='background:"+it.color+"'></span>"+img+"<span style='color:"+it.color+"'>"+it.text+"</span> · "+it.sub+"</div>";
    }).join("");

    // Duration follows the content so the ticker always moves at the same
    // speed. The old 20s floor quietly broke that: a short feed is only a few
    // hundred pixels wide, so forcing 20s dragged it down to roughly 20px per
    // second and it read as frozen. The floor now only guards against a
    // near-empty feed spinning absurdly fast.
    var speed=115; // px per second
    var applyDur=function(){
      var w=ticker.scrollWidth/2;
      if(!w)return;
      ticker.style.animationDuration=Math.max(8,w/speed)+"s";
    };
    // Player thumbnails land after the first measure and change the width, so
    // measure again once they are in.
    setTimeout(applyDur,100);
    setTimeout(applyDur,1500);
  }catch(e){
    console.warn("Live feed failed:",e.message);
  }
}

// ─── TRADE HISTORY ANALYTICS ────────────────────────────────────────────────

function computeTradeStats(trades){
  var stats={};
  trades.forEach(function(t){
    (t.roster_ids||[]).forEach(function(rid){
      if(!stats[rid]) stats[rid]={tradeCount:0,valueGiven:0,valueReceived:0,picksGiven:0,picksReceived:0,playersGiven:0,playersReceived:0,trades:[]};
      stats[rid].tradeCount++;
      stats[rid].trades.push(t);
    });
    // Player values: adds = {playerId: receivingRosterId}, drops = {playerId: givingRosterId}
    Object.entries(t.adds||{}).forEach(function(e){
      var pid=e[0],rid=e[1];
      var val=ktcById[pid]||0;
      if(stats[rid]){stats[rid].valueReceived+=val;stats[rid].playersReceived++;}
    });
    Object.entries(t.drops||{}).forEach(function(e){
      var pid=e[0],rid=e[1];
      var val=ktcById[pid]||0;
      if(stats[rid]){stats[rid].valueGiven+=val;stats[rid].playersGiven++;}
    });
    // Draft picks
    (t.draft_picks||[]).forEach(function(pk){
      if(stats[pk.previous_owner_id]) stats[pk.previous_owner_id].picksGiven++;
      if(stats[pk.owner_id])          stats[pk.owner_id].picksReceived++;
    });
  });
  return stats;
}

function getRosterName(rosterId){
  var r=leagueRosters.find(function(x){return x.roster_id===rosterId;});
  if(!r)return "Team "+rosterId;
  var u=leagueUsers.find(function(x){return x.user_id===r.owner_id;});
  return u?(u.metadata&&u.metadata.team_name?u.metadata.team_name:u.display_name||"Team "+rosterId):"Team "+rosterId;
}

function _withWhy(profile,why){
  var p=Object.assign({},profile);
  p.why=why;
  return p;
}
function rosterRecord(rosterId){
  var r=leagueRosters.find(function(x){return x.roster_id===rosterId;});
  var st=(r&&r.settings)||{};
  var w=st.wins||0,l=st.losses||0,t=st.ties||0,g=w+l+t;
  return {wins:w,losses:l,ties:t,games:g,pct:g?(w+t*0.5)/g:null,fpts:(st.fpts||0)+((st.fpts_decimal||0)/100)};
}
function inferOppProfileFromHistory(roster,rosterId){
  var s=tradeStats[rosterId];
  var res=_inferFromHistoryRaw(roster,rosterId,s);
  // Reality check against the standings: a team that is WINNING is not "in denial"
  // and nobody is "feeding on" them - results outrank the value spreadsheet.
  var rec=rosterRecord(rosterId);
  if(res&&res.name===profiles.denial_manager.name&&rec.games>=3&&rec.pct>=0.5){
    var recTxt=rec.wins+"-"+rec.losses+(rec.ties?"-"+rec.ties:"");
    return _withWhy(profiles.window_closer,"the spreadsheet says they overpay, but they're "+recTxt+" - the aggression is working. They trade for wins, not value, so charge a premium for anything that helps them now");
  }
  return res;
}
function _inferFromHistoryRaw(roster,rosterId,s){
  if(!s||s.tradeCount===0) return inferOppProfile(roster);
  var netValue=s.valueReceived-s.valueGiven;
  var pickBal=s.picksReceived-s.picksGiven;
  var rec=rosterRecord(rosterId);
  var winning=rec.games>=3&&rec.pct>=0.5;
  // High volume trader
  if(s.tradeCount>=14) return _withWhy(profiles.flip_addict,""+s.tradeCount+" trades in two seasons. This manager just likes making deals, which means your offer WILL get read");
  // Clearly selling players for picks → rebuilder
  if(pickBal>=2&&s.playersGiven>s.playersReceived) return _withWhy(profiles.rebuilder,"they've shipped "+s.playersGiven+" players out and stacked "+s.picksReceived+" picks. Full teardown mode: offer picks and youth, keep your vets");
  // Clearly trading picks for players → window closer
  if(pickBal<=-2&&s.playersReceived>s.playersGiven) return _withWhy(profiles.window_closer,"they've burned "+s.picksGiven+" picks chasing a title. Their future is mortgaged, so sell them ready-now starters at a premium");
  // Consistently losing value → denial manager, but ONLY if the losses show up in the standings too
  if(netValue<-800&&s.tradeCount>=2&&!winning) return _withWhy(profiles.denial_manager,"they're down about "+Math.abs(Math.round(netValue))+" in value across "+s.tradeCount+" deals and the record shows it. Bring them a deal that looks like hope");
  // Barely trades, sits on roster → star hoarder
  if(s.tradeCount<=2) return _withWhy(profiles.star_hoarder,""+s.tradeCount+" trade"+(s.tradeCount===1?"":"s")+" in two seasons. Getting a deal done here takes patience and a genuinely fair offer");
  // Lots of countering / moderate activity → counter king
  if(s.tradeCount>=6&&Math.abs(pickBal)<=1&&Math.abs(netValue)<500) return _withWhy(profiles.counter_king,""+s.tradeCount+" deals, all landing near even. They counter everything, so build slack into your first offer and let them 'win' the negotiation");
  return inferOppProfile(roster);
}

function renderLeagueTrades(){
  renderLeaguePersonalities();
  // a report built for a different league must not stay on screen after a switch
  if(typeof LX !== 'undefined' && LX && LX.built &&
     (LX.lid !== leagueId || LX.mode !== (typeof leagueMode !== 'undefined' ? leagueMode : ''))){
    LX.built = false; LX.teams = null; LX.deals = null; LX.open = {};
    var _lxo = document.getElementById('lx-out');
    if(_lxo) _lxo.innerHTML = '';
  }
  var el=document.getElementById("league-trades-list");
  if(!el)return;
  if(!leagueTrades.length){
    el.innerHTML=leagueRosters.length
      ?"<div class='empty-state'>No trades in this league yet.</div>"
      :"<div class='empty-state'>No trade history loaded yet.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";
    return;
  }

  // Sort newest first
  var sorted=leagueTrades.slice().sort(function(a,b){return b.created-a.created;});

  // League table: synced standings + the trade data Sleeper doesn't show you.
  // Per-trade win/loss: a side "won" a deal if it came out 300+ value ahead.
  var perTrade={};
  leagueTrades.forEach(function(t){
    var side={};
    (t.roster_ids||[]).forEach(function(rid){side[rid]=0;});
    Object.entries(t.adds||{}).forEach(function(e){if(side[e[1]]!==undefined)side[e[1]]+=(ktcById[e[0]]||0);});
    Object.entries(t.drops||{}).forEach(function(e){if(side[e[1]]!==undefined)side[e[1]]-=(ktcById[e[0]]||0);});
    Object.keys(side).forEach(function(rid){
      if(!perTrade[rid])perTrade[rid]={won:0,lost:0,even:0};
      if(side[rid]>=300)perTrade[rid].won++;
      else if(side[rid]<=-300)perTrade[rid].lost++;
      else perTrade[rid].even++;
    });
  });
  var hasGames=leagueRosters.some(function(r){return r.settings&&((r.settings.wins||0)+(r.settings.losses||0))>0;});
  var tableRows=leagueRosters.map(function(r){
    var rec=rosterRecord(r.roster_id);
    var s=tradeStats[r.roster_id]||{tradeCount:0,valueReceived:0,valueGiven:0};
    var pt=perTrade[r.roster_id]||{won:0,lost:0,even:0};
    return {rid:r.roster_id,name:getRosterName(r.roster_id),isMe:r.owner_id===userId,rec:rec,
      trades:s.tradeCount,won:pt.won,lost:pt.lost,net:Math.round(s.valueReceived-s.valueGiven)};
  }).sort(function(a,b){
    if(hasGames){if(b.rec.pct!==a.rec.pct)return (b.rec.pct||0)-(a.rec.pct||0);return b.rec.fpts-a.rec.fpts;}
    return b.net-a.net;
  });
  var lbHtml="<div style='margin-bottom:6px'><div style='font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px'>League table - standings and trade record"+(hasGames?"":" (no games yet - sorted by trade value until the season starts)")+"</div>"
    +"<div class='stand-wrap'><table class='stand-table'><thead><tr>"
    +"<th>#</th><th>Team</th>"+(hasGames?"<th>Record</th><th>PF</th>":"")+"<th>Trades</th><th>Trade W-L</th><th>Value +/-</th>"
    +"</tr></thead><tbody>";
  tableRows.forEach(function(row,i){
    var netColor=row.net>=300?"var(--green)":row.net<=-300?"var(--red)":"var(--accent-bright)";
    var netTxt=row.net>=1000?"Big wins":row.net>=300?"Ahead":row.net<=-1000?"Big losses":row.net<=-300?"Behind":"Win-win trader";
    lbHtml+="<tr"+(row.isMe?" class='st-me'":"")+"><td class='st-num'>"+(i+1)+"</td>"
      +"<td class='st-team'>"+row.name+(row.isMe?" <span style='font-size:9px;color:var(--accent-bright);font-weight:700'>YOU</span>":"")+"</td>"
      +(hasGames?"<td class='st-num'>"+row.rec.wins+"-"+row.rec.losses+(row.rec.ties?"-"+row.rec.ties:"")+"</td><td class='st-num'>"+Math.round(row.rec.fpts).toLocaleString()+"</td>":"")
      +"<td class='st-num'>"+row.trades+"</td>"
      +"<td class='st-num'>"+(row.trades?row.won+"-"+row.lost+(row.even?" <span style='color:var(--muted);font-size:10px'>("+row.even+" even)</span>":""):"-")+"</td>"
      +"<td class='st-num' style='color:"+netColor+";font-weight:700'>"+(row.trades?netTxt:"-")+"</td></tr>";
  });
  lbHtml+="</tbody></table></div>"
    +"<div style='font-size:10px;color:var(--muted);margin:8px 0 20px'>Trade W-L counts deals where a side came out 300+ market value ahead at today's prices. PF = points for.</div></div>";

  // Trade list HTML
  var tradesHtml="<div style='font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px'>All trades (this season + last)</div><div style='display:grid;gap:10px'>";
  sorted.forEach(function(t){
    var rids=t.roster_ids||[];
    // 3+ team trades: the 1-vs-1 value math below only looks at rids[0]/rids[1],
    // so a third team's players get dropped and the "winner" would be a lie built
    // on partial data. Render an honest multi-team card instead and bail out.
    if(rids.length>2){
      var recv={};
      rids.forEach(function(rid){recv[rid]=[];});
      Object.entries(t.adds||{}).forEach(function(e){
        var pid=e[0],receiver=e[1];
        var pname=(allPlayers[pid]&&allPlayers[pid].name)||("Player "+pid);
        if(recv[receiver])recv[receiver].push({name:pname,val:ktcById[pid]||0,pid:pid});
      });
      (t.draft_picks||[]).forEach(function(pk){
        var label=pk.season+" Round "+pk.round;
        var pickKey=(pk.season+" round "+pk.round).toLowerCase();
        var nowOwner=pk.owner_id;
        if(recv[nowOwner])recv[nowOwner].push({name:label,val:ktcValues[pickKey]||0,isPick:true});
      });
      var mDate=new Date(t.created).toLocaleDateString("en-US",{month:"short",day:"numeric"});
      var mSeason=t._season?" · "+t._season:"";
      var mHtml="<div style='border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;background:var(--surface)'>";
      mHtml+="<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>";
      mHtml+="<div style='font-size:11px;color:var(--muted)'>"+mDate+mSeason+"</div>";
      mHtml+="<div style='font-size:11px;font-weight:600;color:var(--accent-bright)'>"+rids.length+"-team trade</div></div>";
      mHtml+="<div style='display:grid;gap:8px'>";
      rids.forEach(function(rid){
        var got=recv[rid]||[];
        var tot=got.reduce(function(s,x){return s+x.val;},0);
        mHtml+="<div style='padding:10px;background:var(--surface3);border-radius:6px;border:1px solid var(--border)'>";
        mHtml+="<div style='font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px'>"+getRosterName(rid)+"</div>";
        mHtml+="<div style='font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px'>received</div>";
        if(got.length){
          got.forEach(function(it){
            mHtml+="<div style='font-size:12px;color:var(--text);margin-bottom:3px;display:flex;align-items:center;gap:6px'>";
            if(!it.isPick&&it.pid){
              mHtml+="<img src='https://sleepercdn.com/content/nfl/players/thumb/"+it.pid+".jpg' style='width:20px;height:20px;border-radius:50%;object-fit:cover;cursor:pointer' onclick='openPlayerCard(\""+it.pid+"\",\""+String(it.name).replace(/\"/g,"")+"\")' onerror='this.style.display=\"none\"'>";
            }else{
              mHtml+="<div style='width:20px;height:20px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--accent-bright);flex-shrink:0'>PK</div>";
            }
            mHtml+=it.name+(it.val?"<span style='color:var(--muted);font-size:11px;margin-left:4px'>"+playerTierLabel(it.val).short+"</span>":"");
            mHtml+="</div>";
          });
        }else{
          mHtml+="<div style='font-size:12px;color:var(--muted)'>-</div>";
        }
        if(tot)mHtml+="<div style='margin-top:6px;font-size:12px;font-weight:700;color:var(--muted)'>"+playerTierLabel(tot).short+" haul</div>";
        mHtml+="</div>";
      });
      mHtml+="</div>";
      mHtml+="<div style='font-size:10px;color:var(--muted);margin-top:8px'>Multi-team deals move value in a loop, so there is no single winner to crown here.</div>";
      mHtml+="</div>";
      tradesHtml+=mHtml;
      return;
    }
    var r1=rids[0],r2=rids[1];
    var n1=getRosterName(r1),n2=getRosterName(r2);

    // What r1 gave → r2 received
    var r1gave=[],r2gave=[];
    Object.entries(t.adds||{}).forEach(function(e){
      var pid=e[0],receiver=e[1];
      var pname=(allPlayers[pid]&&allPlayers[pid].name)||("Player "+pid);
      var val=ktcById[pid]||0;
      if(receiver===r2) r1gave.push({name:pname,val:val,pid:pid});
      else if(receiver===r1) r2gave.push({name:pname,val:val,pid:pid});
    });
    (t.draft_picks||[]).forEach(function(pk){
      var label=pk.season+" Round "+pk.round;
      var val=0;
      // Try to find KTC value for this pick
      var pickKey=(pk.season+" round "+pk.round).toLowerCase();
      if(ktcValues[pickKey]) val=ktcValues[pickKey];
      if(pk.previous_owner_id===r1) r1gave.push({name:label,val:val,isPick:true});
      else if(pk.previous_owner_id===r2) r2gave.push({name:label,val:val,isPick:true});
    });

    // v1 = value r1 gave away; v2 = value r2 gave away
    // r1 received: r2gave  |  r2 received: r1gave
    var v1=r1gave.reduce(function(s,x){return s+x.val;},0); // what r1 gave (= r2 received)
    var v2=r2gave.reduce(function(s,x){return s+x.val;},0); // what r2 gave (= r1 received)
    // winner: team that came out 300+ market value ahead. Same threshold the
    // standings W-L table uses, so the label and the record never disagree - a
    // thin edge reads as "Even" here just like it counts as neither W nor L there.
    var r1won=(v2-v1)>=300,r2won=(v1-v2)>=300;
    var winner=r1won?n1:r2won?n2:"Even";
    var date=new Date(t.created).toLocaleDateString("en-US",{month:"short",day:"numeric"});
    var seasonLabel=t._season?" · "+t._season:"";

    function sideHtml(name,received,receivedTotal,won){
      var color=won===true?"var(--green)":won===false?"var(--red)":"var(--muted)";
      var verdict=won===true?"✓ Got the better deal":won===false?"✗ Got the short end":"-";
      var html="<div style='flex:1;padding:10px;background:var(--surface3);border-radius:6px;border:1px solid "+(won===true?"var(--green-dim)":won===false?"var(--red-dim)":"var(--border)")+"'>";
      html+="<div style='font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px'>"+name+"</div>";
      html+="<div style='font-size:10px;font-weight:600;color:"+color+";text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px'>received</div>";
      if(received.length){
        received.forEach(function(it){
          var img=it.isPick?"":"";
          html+="<div style='font-size:12px;color:var(--text);margin-bottom:3px;display:flex;align-items:center;gap:6px'>";
          if(!it.isPick&&it.pid){
            html+="<img src='https://sleepercdn.com/content/nfl/players/thumb/"+it.pid+".jpg' style='width:20px;height:20px;border-radius:50%;object-fit:cover;cursor:pointer' onclick='openPlayerCard(\""+it.pid+"\",\""+String(it.name).replace(/\"/g,"")+"\")' onerror='this.style.display=\"none\"'>";
          } else {
            html+="<div style='width:20px;height:20px;border-radius:50%;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--accent-bright);flex-shrink:0'>PK</div>";
          }
          html+=it.name+(it.val?"<span style='color:var(--muted);font-size:11px;margin-left:4px'>"+playerTierLabel(it.val).short+"</span>":"");
          html+="</div>";
        });
      }else{
        html+="<div style='font-size:12px;color:var(--muted)'>-</div>";
      }
      if(receivedTotal){html+="<div style='margin-top:6px;font-size:12px;font-weight:700;color:"+color+"'>"+playerTierLabel(receivedTotal).short+" haul</div>";}
      html+="<div style='font-size:10px;color:"+color+";margin-top:2px'>"+verdict+"</div>";
      return html+"</div>";
    }

    tradesHtml+="<div style='border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px;background:var(--surface)'>";
    tradesHtml+="<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>";
    tradesHtml+="<div style='font-size:11px;color:var(--muted)'>"+date+seasonLabel+"</div>";
    if(winner!=="Even") tradesHtml+="<div style='font-size:11px;font-weight:600;color:var(--green)'>"+winner+" won this trade</div>";
    else tradesHtml+="<div style='font-size:11px;color:var(--muted)'>Even trade</div>";
    tradesHtml+="</div>";
    tradesHtml+="<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>";
    // n1 received = r2gave (v2 total), n2 received = r1gave (v1 total)
    tradesHtml+=sideHtml(n1,r2gave.map(function(x){return Object.assign({},x,{pid:x.pid});}),v2||null,r1won===r2won?null:r1won);
    tradesHtml+=sideHtml(n2,r1gave.map(function(x){return Object.assign({},x,{pid:x.pid});}),v1||null,r1won===r2won?null:r2won);
    tradesHtml+="</div>";
    // Expandable explanation of WHY the winner won
    if(winner!=="Even"&&(v1||v2)){
      var wSide=r1won?r2gave:r1gave;           // what the winner received
      var lSide=r1won?r1gave:r2gave;           // what the loser received... careful: r1won means r1 received r2gave
      var wName=winner, lName=r1won?n2:n1;
      var wVal=r1won?v2:v1, lVal=r1won?v1:v2;
      var diff=Math.abs(wVal-lVal);
      var wBest=wSide.slice().sort(function(a,b){return b.val-a.val;})[0];
      var lBest=lSide.slice().sort(function(a,b){return b.val-a.val;})[0];
      var wPicks=wSide.filter(function(x){return x.isPick;}).length;
      var lPicks=lSide.filter(function(x){return x.isPick;}).length;
      var wPlayers=wSide.filter(function(x){return !x.isPick&&x.pid&&allPlayers[x.pid];}).map(function(x){return allPlayers[x.pid];});
      var lPlayers=lSide.filter(function(x){return !x.isPick&&x.pid&&allPlayers[x.pid];}).map(function(x){return allPlayers[x.pid];});
      var expl='';
      if(wBest){
        var wbp=wBest.pid&&allPlayers[wBest.pid];
        expl+='This deal is really about <strong style="color:var(--text)">'+wBest.name+'</strong>'+(wbp&&wbp.age?' ('+wbp.pos+', age '+wbp.age+')':'')+'. ';
        expl+=wName+' landed the biggest prize on the table';
        if(lBest&&lBest.val&&wBest.val>lBest.val*1.5)expl+=' and nothing coming back was close - '+lName+'\'s best player coming back was '+lBest.name;
        expl+='. ';
      }
      var wYoung=wPlayers.filter(function(p){return p.age&&p.age<=25;}).length;
      var lOld=lPlayers.filter(function(p){return p.age&&p.age>=29;}).length;
      if(wYoung&&lOld)expl+=wName+' also got younger while sending back aging players - that\'s winning the deal twice, once on talent and once on the calendar. ';
      if(wPicks>lPicks)expl+='Banking '+wPicks+' pick'+(wPicks>1?'s':'')+' on top gives '+wName+' outs if anything goes wrong, while '+lName+' is fully committed to the players they got. ';
      else if(lPicks>wPicks)expl+=lName+' chose lottery tickets over proven production. Picks feel safe, but hitting on them is harder than it looks - most 2nds never return a starter. ';
      var gapWord=diff>=1200?'wide':diff>=450?'clear':'thin';
      if(gapWord==='thin')expl+='The market gap here is thin - this is close to a win-win, and if both sides filled a need, it IS one. ';
      else expl+='On sheer market price the gap is '+gapWord+'. That said, prices are opinions: if '+lName+'\'s side outplays its price tag, this verdict flips. That\'s what makes it a trade.';
      var xid='tw_'+t.transaction_id;
      tradesHtml+="<div style='margin-top:8px'><span onclick=\"var e=document.getElementById('"+xid+"');var open=e.style.display!=='none';e.style.display=open?'none':'block';this.textContent=open?'Why did "+wName.replace(/'/g,'')+" win? ▾':'Hide ▴';\" style='font-size:11px;font-weight:600;color:var(--accent-bright);cursor:pointer'>Why did "+wName.replace(/'/g,'')+" win? ▾</span>";
      tradesHtml+="<div id='"+xid+"' style='display:none;margin-top:6px;font-size:11px;color:var(--muted2);line-height:1.7;background:var(--surface2);border-radius:8px;padding:10px 12px'>"+expl+"</div></div>";
    }
    tradesHtml+="</div>";
  });
  tradesHtml+="</div>";

  el.innerHTML=lbHtml+tradesHtml;
}

// ─────────────────────────────────────────────────────────────────────────────

function inferOppProfile(roster){
  if(!roster||!roster.length) return profiles.denial_manager;
  var exps=roster.filter(function(p){return p&&p.exp!=null;}).map(function(p){return p.exp;});
  var avgExp=exps.length?exps.reduce(function(a,b){return a+b;},0)/exps.length:3;
  var oppKtc=roster.reduce(function(s,p){return s+getKtcValue(p.name,p.id);},0);
  var myKtc=myRoster.reduce(function(s,p){return s+getKtcValue(p.name,p.id);},0);
  var ktcRatio=myKtc>0?oppKtc/myKtc:1;
  var rbs=roster.filter(function(p){return p.pos==="RB";}).length;
  var wrs=roster.filter(function(p){return p.pos==="WR";}).length;
  var tes=roster.filter(function(p){return p.pos==="TE";}).length;
  var totalKtc=roster.reduce(function(s,p){return s+getKtcValue(p.name,p.id);},0);
  var rosterSize=roster.length||1;
  var avgKtcPerPlayer=totalKtc/rosterSize;
  var expTxt=avgExp.toFixed(1);
  var isR=leagueMode==='redraft';
  if(isR){
    // Redraft reads: it's about roster strength this season, not windows
    if(ktcRatio>=1.2) return _withWhy(profiles.star_hoarder,"their roster is loaded - roughly "+Math.round(ktcRatio*100)+"% of your total value. They don't NEED anything, so your offer has to be genuinely tempting");
    if(ktcRatio>=0.95) return _withWhy(profiles.young_contender,"strong roster, right in the playoff hunt - they'll trade, but only for pieces that help them win THIS week");
    if(ktcRatio<0.8) return _withWhy(profiles.denial_manager,"their roster is thin but they keep playing to win - desperate managers overpay for name-brand players");
    return _withWhy(profiles.no_mans_land,"a middle-of-the-pack roster - could buy, could sell, probably hasn't decided. Your pitch decides for them");
  }
  // High avgKtc + low exp = elite young roster = young contender
  if(avgExp<=2&&ktcRatio>=0.95) return _withWhy(profiles.young_contender,"very young roster (avg "+expTxt+" yrs experience) that's already worth as much as yours - young AND loaded");
  // Very low exp + low ktcRatio = rebuilding
  if(avgExp<=2.5&&ktcRatio<0.95) return _withWhy(profiles.rebuilder,"one of the youngest rosters in the league (avg "+expTxt+" yrs experience) with below-average total value - textbook rebuild shape");
  // High exp + decent ktc = window closing
  if(avgExp>=5&&ktcRatio>=0.85) return _withWhy(profiles.window_closer,"veteran-heavy roster (avg "+expTxt+" yrs experience) still holding real value - their window is now or never");
  // High exp + lower ktc = denial (window closed but doesn't know)
  if(avgExp>=4.5&&ktcRatio<0.85) return _withWhy(profiles.denial_manager,"old roster (avg "+expTxt+" yrs experience) that has lost most of its value - the window closed but the roster says they haven't accepted it");
  // High ktcRatio = star hoarder (has more value than you)
  if(ktcRatio>=1.2) return _withWhy(profiles.star_hoarder,"their roster is worth ~"+Math.round(ktcRatio*100)+"% of yours in market value - they're sitting on a stacked roster");
  // Mid exp, mid ktc = perma-mid
  if(avgExp>=3&&avgExp<5) return _withWhy(profiles.no_mans_land,"middle-aged roster (avg "+expTxt+" yrs experience), middling value - not rebuilding, not contending, just... there");
  return _withWhy(profiles.denial_manager,"roster shape doesn't match a clear strategy - the most common reason is a manager who hasn't picked a lane");
}

// Staged analysis narration: quick cycling status pill so hitting Analyze
// feels like Mac actually working through it, then it gets out of the way.
function _anzToast(){
  try{
    var old=document.getElementById('anz-toast');if(old)old.remove();
    var t=document.createElement('div');
    t.id='anz-toast';
    t.style.cssText='position:fixed;left:50%;bottom:9vh;transform:translateX(-50%);z-index:250;background:var(--surface3,#1a1530);border:1px solid rgba(155,114,232,.4);border-radius:100px;padding:10px 22px;font-size:13px;font-weight:600;color:var(--text);box-shadow:0 10px 34px rgba(5,4,12,.5);white-space:nowrap;transition:opacity .3s ease';
    document.body.appendChild(t);
    var steps=['Thinking...','Reviewing your roster...','Checking league settings...','Analyzing your opponent...','Comparing player values...','Recommendation ready.'];
    var i=0;
    t.textContent=steps[0];
    var iv=setInterval(function(){
      i++;
      if(i>=steps.length){clearInterval(iv);t.style.opacity='0';setTimeout(function(){t.remove();},350);return;}
      t.textContent=steps[i];
      if(i===steps.length-1)t.style.borderColor='var(--green,#22c55e)';
    },420);
  }catch(_){}
}
async function runAnalysis(){
  try{tmTrack('trade_analyzed');}catch(_){}
  // clean slate: a failed or interrupted run must never leave the PREVIOUS
  // trade's text under the NEW trade's crown
  try{
    var _vh=document.getElementById('verdict-headline');if(_vh)_vh.textContent='Analyzing...';
    var _vb=document.getElementById('verdict-body');if(_vb)_vb.innerHTML='';
    var _vx=document.getElementById('verdict-ctx');if(_vx)_vx.remove();
  }catch(_){}
  var giveInputEls=Array.from(document.querySelectorAll("#give-players input")).filter(function(i){return i.value.trim();});
  var getInputEls=Array.from(document.querySelectorAll("#get-players input")).filter(function(i){return i.value.trim();});
  var give=giveInputEls.map(function(i){return i.value.trim();});
  var get=getInputEls.map(function(i){return i.value.trim();});
  // Validate - must have at least one player on each side
  var resultsEl=document.getElementById("results");
  if(!give.length&&!get.length){
    if(resultsEl)resultsEl.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">Add players to both sides of the trade first, then click Analyze.</div>';
    return;
  }
  if(!give.length||!get.length){
    if(resultsEl)resultsEl.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted);font-size:14px">You need players on <strong style="color:var(--text)">both sides</strong> to analyze. Fill in what you\'re giving AND what you\'re getting.</div>';
    return;
  }
  // StoryBrand micro-moment: Mac visibly working through the steps
  try{
    var _tz=document.getElementById('anz-toast');
    if(!_tz){_tz=document.createElement('div');_tz.id='anz-toast';
      _tz.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:260;background:var(--surface3);border:1px solid rgba(155,114,232,.4);border-radius:100px;padding:9px 20px;font-size:12.5px;font-weight:600;color:var(--text);box-shadow:0 8px 30px rgba(5,4,12,.5);transition:opacity .3s;pointer-events:none';
      document.body.appendChild(_tz);}
    _tz.style.opacity='1';_tz.style.display='block';
    var _steps=['Thinking...','Reviewing your roster...','Checking league settings...','Analyzing your opponent...','Comparing player values...','Recommendation ready.'];
    _steps.forEach(function(s,i){setTimeout(function(){_tz.textContent=s;},i*330);});
    setTimeout(function(){_tz.style.opacity='0';setTimeout(function(){_tz.style.display='none';},350);},_steps.length*330+700);
  }catch(_){}
  _anzToast(); // staged "Mac is working" lines while the battle plays
  // Deduct BK (only if user is logged in)
  var bkOk=await chargeBK();
  if(!bkOk)return;
  setSageState('thinking');
  // If market values never loaded (e.g. cold start failure), try once more before analyzing
  if(!Object.keys(ktcById).length){
    try{await fetchKtcValues(leagueFormat.has2QB||leagueFormat.hasSuperFlex?2:1,leagueFormat.ppr,leagueMode!=='redraft',true);}catch(_){}
  }
  var oppRosterObj=_rosterForUser(document.getElementById("opp-select").value);
  var oppRosterId=oppRosterObj?oppRosterObj.roster_id:null;
  var p=oppRosterId?inferOppProfileFromHistory(oppRoster,oppRosterId):inferOppProfile(oppRoster);
  var sit=youAnswers[0],feel=youAnswers[2];
  var selfBoost=0;
  if(sit===0&&feel===0)selfBoost+=6;
  if(sit===2)selfBoost+=8;
  if(feel===2)selfBoost-=20;
  var giveKtc=giveInputEls.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var getKtc=getInputEls.reduce(function(s,i){return s+getKtcValue(i.value.trim(),i.dataset.playerId);},0);
  var ktcGap=getKtc-giveKtc;
  var hasKtc=giveKtc>0||getKtc>0;
  var gc=give.length||1,rc=get.length||1;

  // - -- ACCEPTANCE likelihood (secondary - will THEY accept?) - --
  var base=44+Math.floor(Math.random()*14);
  var acceptBoost=hasKtc?(ktcGap>1000?12:ktcGap>0?5:ktcGap>-1000?-3:-10):(rc-gc)*5;
  var acc=Math.min(94,Math.max(14,base+acceptBoost+p.boosts.acceptance+selfBoost+Math.floor(Math.random()*6)));

  // - -- TRADE VALUE for YOU (primary - should YOU do it?) - --
  // Roster-spot economics: raw value isn't the whole story once player counts differ.
  // Small leagues (<12): waivers are rich and spots are precious - consolidating
  // (2-for-1 where you get the 1) is worth a premium; splitting is taxed.
  // Big leagues (12+): if you're getting two players for one, your team needs help,
  // and BOTH incoming pieces have a real shot at outplaying the guy you send,
  // the two bites at the apple are worth more than the sheet says.
  var _depthNote='';
  var effGap=ktcGap;
  if(hasKtc&&gc!==rc){
    var leagueSize=leagueRosters.length>=4?leagueRosters.length:12;
    var giveVals=giveInputEls.map(function(i){return getKtcValue(i.value.trim(),i.dataset.playerId);}).filter(function(v){return v>0;}).sort(function(a,b){return b-a;});
    var getVals=getInputEls.map(function(i){return getKtcValue(i.value.trim(),i.dataset.playerId);}).filter(function(v){return v>0;}).sort(function(a,b){return b-a;});
    var consolidating=gc>rc;
    if(leagueSize<12){
      if(consolidating){effGap+=300;_depthNote='In a '+leagueSize+'-team league, sending two for the best player is the right shape: waivers replace your depth anyway and the open roster spot has value of its own.';}
      else{effGap-=300;_depthNote='Careful with 1-for-2 in a '+leagueSize+'-team league: depth is cheap on waivers here, so extra bodies are worth less than the sheet says. Make sure the value edge is real.';}
    } else if(!consolidating&&rc>gc){
      var needsHelp=sit!=null&&sit>=1;
      var anchor=giveVals[0]||0;
      var bothViable=getVals.length>=2&&anchor>0&&getVals[1]>=anchor*0.55;
      if(needsHelp&&bothViable){effGap+=300;_depthNote='In a '+leagueSize+'-team league with your roster needing help, two players who can both outplay the one you send is a bet worth making: two chances to hit beats one.';}
  }
  // Universal starting-lineup reality, any league size: only your best one or two
  // incoming players ever crack the lineup. A third, fourth, fifth body is bench
  // filler, so receiving a pile for one star gets taxed hard - and consolidating
  // three-plus roster players into the best player in the deal earns a bonus.
  {
    var _inC=(typeof rc!=='undefined')?rc:0, _outC=(typeof gc!=='undefined')?gc:0;
    if(_inC>=3){effGap-=280*(_inC-2);_depthNote='You are getting too many players who probably will not start for you, and you are giving away your superstar. Only the best one or two of them will ever see your lineup.';}
    if(_outC>=3&&_inC<=2){effGap+=150*(_outC-2);}
      else if(!needsHelp&&bothViable){_depthNote='The 2-for-1 math favors quantity when a team needs help - yours doesn\'t. From strength, take the best player, not the most players.';}
    }
  }
  var valueTier;
  if(hasKtc){
    if(effGap>=1000) valueTier="crushing";
    else if(effGap>=350) valueTier="winning";
    else if(effGap>=-350) valueTier="even";
    else if(effGap>=-1500) valueTier="losing";
    else valueTier="getting_fleeced";
  } else {
    valueTier=rc>gc?"winning":rc===gc?"even":"losing";
  }

  // Headline = value-first verdict (this is what matters for YOU)
  var headline;
  if(valueTier==="getting_fleeced"){
    headline=["HELL NO","DON'T SEND THIS","YOU'RE GETTING ROBBED","HARD PASS","WALK AWAY","NOT EVEN CLOSE","THEY'RE LAUGHING AT YOU","ABORT MISSION","DELETE THIS OFFER","RUN"][Math.floor(Math.random()*10)];
  } else if(valueTier==="losing"){
    headline=["ASK FOR MORE","BAD DEAL, PUSH BACK","YOU'RE OVERPAYING","NEGOTIATE FIRST","MISSING SOMETHING","CLOSE BUT NO","NEED A SWEETENER","DON'T SEND YET","HOLD OUT","GET SOMETHING BACK"][Math.floor(Math.random()*10)];
  } else if(valueTier==="even"){
    headline=["WIN-WIN TRADE","BOTH TEAMS EAT","TWO WINNERS HERE","FAIR SWAP, GOOD TRADE","BOTH SIDES IMPROVE","CLEAN, BALANCED DEAL","EVEN MONEY, GOOD DEAL","FAIR FIGHT","IF IT FITS, SEND IT","BALANCED SWAP"][Math.floor(Math.random()*10)];
  } else if(valueTier==="winning"){
    headline=acc>=55?["SEND IT","DO IT NOW","YEAH, DO THIS","GREEN LIGHT","GO FOR IT","YES, OBVIOUSLY","THIS IS YOUR MOVE","PULL THE TRIGGER","LOCK IT IN, NOW","EASY CALL"][Math.floor(Math.random()*10)]:["GOOD DEAL, KEEP PUSHING","YOU'RE WINNING, STAY ON IT","LOCK IT IN","YOU'RE AHEAD","WORTH IT","LEAN YES","GOOD VALUE","EDGE IN YOUR FAVOR","SLIGHT WIN, TAKE IT","YOUR CALL BUT GOOD"][Math.floor(Math.random()*10)];
  } else {
    headline=["FIRE DEAL, SEND IT","YOU'RE WINNING BIG","EASY YES","ROB THEM BLIND","SLAM DUNK","HIGHWAY ROBBERY","DON'T WAIT","SEND BEFORE THEY WAKE UP","THEY'LL REGRET THIS","TAKE THE W"][Math.floor(Math.random()*10)];
  }

  var isGood=valueTier==="winning"||valueTier==="crushing"||valueTier==="even";
  var bodyText=buildTradeBodyText(giveInputEls,getInputEls,valueTier,ktcGap,p);
  // Deterministic reads: baseline + archetype signal + (when available) their real trade history
  var _s=oppRosterId?tradeStats[oppRosterId]:null;
  var _histUrg=_s&&_s.tradeCount>=2?Math.min(12,(_s.picksGiven-_s.picksReceived)*4):0; // trading picks away = urgency
  // A losing record makes people do things: urgency climbs when they're under .500,
  // and a manager who has already made 3+ trades this season is clearly hunting.
  try{
    var _rec=rosterRecord(oppRosterObj.roster_id);
    if(_rec&&(_rec.w+_rec.l)>=3){
      var _pct=_rec.w/(_rec.w+_rec.l);
      if(_pct<0.4)_histUrg+=14; else if(_pct<0.5)_histUrg+=8; else if(_pct>0.7)_histUrg-=6;
    }
    if(_s&&_s.tradeCount>=3)_histUrg+=6;
  }catch(_){}
  var _histStub=_s?(_s.tradeCount<=1?12:_s.tradeCount>=5?-8:0):0;                      // low volume = stubborn
  var winNow=Math.min(95,Math.max(8,45+p.boosts.winNow+_histUrg));
  var attach=Math.min(95,Math.max(8,46+p.boosts.attachment+_histStub));
  // Hype chasing measured from behavior, not just archetype: do the players
  // they trade FOR tend to be 30-day risers (buying hot) or dippers (buying value)?
  var _riserBias=0;
  try{
    var _rid2=oppRosterObj.roster_id, _got=[], _tSum=0;
    (leagueTrades||[]).forEach(function(t){
      Object.entries(t.adds||{}).forEach(function(e){
        if(e[1]===_rid2&&ktcFull[e[0]]&&typeof ktcFull[e[0]].trend30Day==='number'){_got.push(e[0]);_tSum+=ktcFull[e[0]].trend30Day;}
      });
    });
    if(_got.length>=2){
      var _avgT=_tSum/_got.length;
      if(_avgT>75)_riserBias=15; else if(_avgT>25)_riserBias=7;
      else if(_avgT<-75)_riserBias=-12; else if(_avgT<-25)_riserBias=-6;
    }
  }catch(_){}
  var recency=Math.min(95,Math.max(8,40+p.boosts.recency+_riserBias));
  // vs = "Fits YOUR roster?" - net positional change (what you receive minus what you give at same position)
  var getPositions=get.map(function(n){var pl=Object.values(allPlayers).find(function(p){return p.name===n;});return pl?pl.pos:"?";});
  var givePositions=give.map(function(n){var pl=Object.values(allPlayers).find(function(p){return p.name===n;});return pl?pl.pos:"?";});
  var myPosCount={QB:myRoster.filter(function(p){return p.pos==="QB";}).length,RB:myRoster.filter(function(p){return p.pos==="RB";}).length,WR:myRoster.filter(function(p){return p.pos==="WR";}).length,TE:myRoster.filter(function(p){return p.pos==="TE";}).length};
  var netPos={QB:0,RB:0,WR:0,TE:0};
  getPositions.forEach(function(pos){if(netPos[pos]!==undefined)netPos[pos]++;});
  givePositions.forEach(function(pos){if(netPos[pos]!==undefined)netPos[pos]--;});
  var fitBonus=Object.keys(netPos).reduce(function(s,pos){
    var net=netPos[pos];
    if(net<=0)return s; // giving away same or more of this position = no benefit
    return s+(myPosCount[pos]<2?18:myPosCount[pos]<3?8:-3);
  },0);
  var vsBase=fitBonus>0?(hasKtc?(isGood?62:40):50):(fitBonus<0?28:42);
  var vs=Math.min(95,Math.max(10, vsBase + fitBonus + Math.floor(Math.random()*8)));
  // ns = "Fits THEIR roster?" - based on what they're getting vs their positional needs
  // givePositions already defined above;
  var oppPosCount={QB:oppRoster.filter(function(p){return p.pos==="QB";}).length,RB:oppRoster.filter(function(p){return p.pos==="RB";}).length,WR:oppRoster.filter(function(p){return p.pos==="WR";}).length,TE:oppRoster.filter(function(p){return p.pos==="TE";}).length};
  var oppFitBonus=givePositions.reduce(function(s,pos){return s+(oppPosCount[pos]<2?15:oppPosCount[pos]<3?5:-5);},0);
  var ns=Math.min(95,Math.max(10, 45 + oppFitBonus + Math.floor(Math.random()*10)));
  // ps = timing - based on opp profile and your situation
  var timingBase=sit===0?60:sit===2?55:45;
  var ps=Math.min(95,Math.max(10, timingBase + (p.name===profiles.window_closer.name||p.name===profiles.denial_manager.name?15:p.name===profiles.young_contender.name?-10:0) + Math.floor(Math.random()*10)));
  // Gate the opponent read behind a Calculate button so it lands as a moment
  // (count-up + sound) instead of just appearing.
  window._oppReadVals={sig1:winNow,sig2:attach,sig3:recency};
  _resetOppRead();
  renderVsBattle(giveInputEls,getInputEls,ktcGap,hasKtc,valueTier);
  // First verdict a user ever sees: introduce Mac ONCE, right at the moment
  // of full attention. Never shown again - the tool sells itself after that.
  try{
    if(!localStorage.getItem('tm_met_sage')){
      localStorage.setItem('tm_met_sage','1');
      var vh=document.getElementById('verdict-headline');
      if(vh&&!document.getElementById('meet-sage-strip')){
        var ms=document.createElement('div');
        ms.id='meet-sage-strip';
        ms.style.cssText='margin:0 0 14px;padding:12px 16px;background:var(--surface2);border:1px solid rgba(155,114,232,.35);border-radius:12px;font-size:12.5px;color:var(--muted2);line-height:1.6';
        ms.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">Meet Mac</div>'
          +'Knows your team. Knows your league. Never gets emotional. Always in your corner. What you are about to read is one clear recommendation, built for YOUR situation - not a ranking.'
          +'<span style="float:right;cursor:pointer;color:var(--muted);font-size:15px;line-height:1;margin-left:10px" onclick="this.parentElement.remove()">&times;</span>';
        vh.parentElement.insertBefore(ms,vh);
      }
    }
  }catch(_){}
  // good trades: battle impacts only. Bad trades get their own distinct low
  // warning tone so your ears know before your eyes do.
  try{if(valueTier==='losing'||valueTier==='getting_fleeced')setTimeout(function(){sndVerdict(valueTier);},700);}catch(_){}
  generatePitch(give,get,p,youAnswers,answers,valueTier);
  try{sageContextRead(give,get,valueTier);}catch(_){}

  // ── Correlated situation verdict - crosses value WITH your answers ──────────
  // sit: 0=contender, 1=building, 2=rebuilding, 3=unsure
  // reason: 0=I initiated, 1=inbound, 2=fill a hole, 3=sell high
  // feel: 0=fine with it, 1=hesitant, 2=would regret, 3=only for numbers
  // Blended situation verdict. The old discrete if-tree hard-overrode a great
  // value to a NO whenever feel===2 ("I'd regret it"); tradeScore replaces that
  // with a value-first score where a soft hesitation is a -12 nudge, never a veto.
  // youAnswers is passed RAW (tradeScore does its own redraft remap internally).
  var feel=youAnswers?youAnswers[2]:null;
  var hasAnswers=(youAnswers&&(youAnswers[0]!==null||youAnswers[2]!==null));
  var yv, yd, yicon;
  if(hasAnswers){
    // effGap already carries the roster-math depth adjustments from above.
    var _sv=tradeScore(effGap,giveKtc,getKtc,youAnswers,leagueMode,hasKtc);
    yv=_sv.verdict; yd=_sv.desc; yicon=_sv.icon;
  }
  // ── End correlated verdict ──────────────────────────────────────────────────

  lastResult={give:give,get:get,profile:p.name,acc:acc,ktcGap:hasKtc?ktcGap:null,giveKtc:giveKtc,getKtc:getKtc,headline:headline,timestamp:Date.now(),leagueId:leagueId};
  var panel=document.getElementById("result-panel");
  panel.classList.add("visible");
  var ph=document.getElementById("right-placeholder");if(ph)ph.style.display="none";
  // Scroll after the panel has laid out, and leave headroom so the Versus
  // Battle (and the crown that pops above the winning bubbles) stays in view
  setTimeout(function(){
    var arena=document.getElementById('vs-arena-box');
    var target=(arena&&arena.offsetHeight>10)?arena:panel;
    var top=target.getBoundingClientRect().top+window.pageYOffset-140;
    window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
  },400);
  document.getElementById("verdict-headline").textContent=headline;
  // Headline stays clean and light - the severity reads from the accent bar and
  // the balance meter, not from a wall of red text.
  document.getElementById("verdict-headline").style.color='var(--text)';
  var rexState=valueTier==="crushing"||valueTier==="winning"?"win":valueTier==="even"?"neutral":"reject";
  setTimeout(function(){setSageState(rexState);},120);
  var vc=document.getElementById("verdict-card");
  if(vc){
    vc.style.borderTop=valueTier==="getting_fleeced"||valueTier==="losing"?"4px solid var(--red)":valueTier==="even"?"4px solid var(--yellow)":"4px solid var(--green)";
    vc.style.background=valueTier==="getting_fleeced"?"rgba(217,138,160,0.05)":valueTier==="losing"?"rgba(217,138,160,0.03)":valueTier==="even"?"rgba(230,192,122,0.03)":"rgba(34,197,94,0.03)";
  }
  // Wolco's manager profile - drives Mac's personalized coaching line
var USER_PROFILE={risk:'upside',window:'builder-adaptive-active',youth:'context',nego:'fair-options'};
function sageStyleNote(valueTier){
  // A line that reflects HOW this manager likes to play, tuned to the verdict
  if(valueTier==='crushing'||valueTier==='winning')
    return "Clear win with ceiling attached. Send it.";
  if(valueTier==='even')
    return "Dead even, so take the higher ceiling. That is your game.";
  if(valueTier==='losing')
    return "You are paying a premium for the upside. Counter fair, give them two versions, let them pick.";
  return "Even a ceiling-chaser passes here. Walk away.";
}

  var whyHtml=p.why?"<div style='margin-top:6px;font-size:11px;color:var(--muted2);line-height:1.5'><strong style='color:var(--text)'>Why "+p.name.replace(/^The /,'')+"?</strong> Because "+p.why+".</div>":"";
  var styleHtml=""; // "For your style" block removed by request
  // Keep the verdict tight: headline + one-liner + profile chip. The reasoning
  // lives behind a small toggle so the read stays easy.
  var depthHtml=_depthNote?"<div style='margin-top:8px;font-size:11px;color:var(--muted2);line-height:1.6'><strong style='color:var(--text)'>Roster math:</strong> "+_depthNote+"</div>":"";
  var moreHtml=(whyHtml||styleHtml||depthHtml)
    ?"<button class='sage-more-toggle' onclick='toggleSageMore(this)'>Why Mac says this <span>&#9662;</span></button><div id='sage-more-detail'>"+whyHtml+depthHtml+styleHtml+"</div>"
    :"";
  if(valueTier==='even')bodyText+=' A fair trade is not a failed trade: if each side fills a different need, you both walk away better. That is what trading is for.';
  document.getElementById("verdict-body").innerHTML=bodyText+"<div style='margin-top:12px'><span style='font-size:11px;font-weight:600;color:var(--accent-bright);background:var(--accent-dim);border:1px solid rgba(167,139,250,.3);border-radius:100px;padding:4px 11px;display:inline-block'>"+p.icon+" Opponent profile: "+oppName(p)+"</span></div>"+moreHtml;
  // Trade balance bar (50% = even, >50% = you win, <50% = you lose)
  // Scale: ±3000 KTC maps to ±40% from center (50±40 = 10–90%), clamped to 5–95%
  var balancePct=hasKtc
    ? Math.min(95,Math.max(5, 50 + (ktcGap/3000)*40))
    : valueTier==="crushing"?82:valueTier==="winning"?65:valueTier==="even"?50:valueTier==="losing"?35:18;
  balancePct=Math.min(95,Math.max(5,Math.round(balancePct)));
  var barColor=valueTier==="getting_fleeced"?"var(--red)":valueTier==="losing"?"var(--red)":valueTier==="even"?"var(--yellow)":"var(--green)";
  var balanceLabel=valueTier==="getting_fleeced"?"You're getting robbed":valueTier==="losing"?"You're losing value":valueTier==="even"?"Pretty even":valueTier==="winning"?"You're winning this":"You're crushing this";
  setTimeout(function(){
    var bar=document.getElementById("balance-bar");
    if(bar){bar.style.width=balancePct+"%";bar.style.background=barColor;}
  },100);
  var bl=document.getElementById("balance-label");
  if(bl){bl.textContent=balanceLabel;bl.style.color=barColor;}
  var yg=document.getElementById("you-give-label");
  var ygv=document.getElementById("you-get-label");
  // Render names with a team logo in front (picks have none).
  function _namesLogos(arr){
    if(!arr.length)return "players";
    return arr.map(function(nm){
      if(/round|pick/i.test(nm))return escHtml(nm);
      var pid=getPlayerIdByName(nm);
      var tm=pid&&allPlayers[pid]?allPlayers[pid].team:'';
      return (tm&&tm!=='FA'?teamLogo(tm,14):'')+escHtml(nm);
    }).join(", ");
  }
  if(yg)yg.innerHTML="You give: "+_namesLogos(give);
  if(ygv)ygv.innerHTML="You get: "+_namesLogos(get);
  // "Player values / Giving elite - Getting elite" strip removed by request;
  // the verdict body and value bar already carry this information.
  // ── 3 cards: all driven by valueTier first, positional fit secondary ────────
  var samePosTrade=fitBonus===0&&getPositions.length>0&&getPositions.every(function(p){return givePositions.indexOf(p)>=0;});
  var bcLabel,bcColor,bcDesc,bcNeedLabel,bcNeedColor,bcNeedDesc,bcPsychLabel,bcPsychColor,bcPsychDesc;
  // Card 1: Do YOU need this? (redraft: "for your playoff push", dynasty: long-term)
  var _ph=seasonPhase();
  var needCtx=leagueMode==='redraft'?(_ph==='offseason'?' for opening day':_ph==='early'?' this season':_ph==='mid'?' to stay in the race':' for your playoff push'):' long-term';
  var holeWord=leagueMode==='redraft'?'starting spot':'dynasty hole';
  if(samePosTrade){
    if(valueTier==="getting_fleeced"||valueTier==="losing"){
      bcLabel="NOT WORTH IT AT THIS PRICE";bcColor="var(--red)";
      bcDesc="Same position swap and you're overpaying. No positional gain and negative value - worst of both worlds.";
    } else if(valueTier==="winning"||valueTier==="crushing"){
      bcLabel="VALUE WIN, NOT A FILL";bcColor="var(--yellow)";
      bcDesc="You're not filling a hole - you're upgrading at the same position. Getting the better player is reason enough.";
    } else {
      bcLabel="UPGRADE, NOT A FILL";bcColor="var(--yellow)";
      bcDesc="Same position swap - no hole gets filled, but upgrading at a position of strength can still make sense.";
    }
  } else if(valueTier==="getting_fleeced"){
    bcLabel="NOT AT THIS COST";bcColor="var(--red)";
    bcDesc=vs>=60?"You might need that position"+needCtx+", but not badly enough to give away this much value. Counter hard.":"Doesn't fill a real "+holeWord+" AND you're overpaying. No reason to do this deal.";
  } else if(valueTier==="losing"){
    bcLabel=vs>=60?"NEED IT, BUT OVERPAYING":"WEAK FIT + BAD VALUE";
    bcColor="var(--yellow)";
    bcDesc=vs>=60?"The position helps"+needCtx+", but you're giving more than you're getting. Negotiate before agreeing.":"Doesn't solve a roster need and you're paying a premium. Hard to justify.";
  } else if(valueTier==="even"){
    bcLabel=vs>=60?"YEAH, YOU NEED THIS":"NOT URGENT";
    bcColor=vs>=60?"var(--green)":"var(--muted)";
    bcDesc=vs>=60?"Fills a real "+holeWord+" and the value is fair. Solid trade.":"Value is even but doesn't fix anything critical"+needCtx+". Up to you.";
  } else {
    bcLabel=vs>=60?"YES - NEED IT AND WINNING":"NICE UPGRADE";
    bcColor="var(--green)";
    bcDesc=vs>=60?"You fill a "+holeWord+" AND get the better end of this deal. Strong yes.":"You're winning the value"+needCtx+" even if it's not a must-have spot. Easy yes.";
  }
  // Card 2: Do THEY want this? - inversely correlated with your value tier
  if(valueTier==="getting_fleeced"){
    bcNeedLabel="THEY'LL JUMP AT IT";bcNeedColor="var(--red)";
    bcNeedDesc="They'll say yes immediately - which tells you everything. When the other side is eager, you're the one getting played.";
  } else if(valueTier==="losing"){
    bcNeedLabel="THEY WANT THIS";bcNeedColor="var(--yellow)";
    bcNeedDesc="This trade favors them. They'll be happy to accept. Negotiate before you hit send.";
  } else if(valueTier==="even"){
    bcNeedLabel=ns>=60?"YEAH, FITS THEM":"EH, MAYBE";
    bcNeedColor=ns>=60?"var(--green)":"var(--muted)";
    bcNeedDesc=ns>=60?"Hits a real need on their side - fair deal and they want it.":"They can take it or leave it. Might need a small sweetener to close.";
  } else {
    bcNeedLabel="THEY'LL PUSH BACK";bcNeedColor="var(--yellow)";
    bcNeedDesc=valueTier==="crushing"?"You're clearly winning this - they know it too. Expect a hard counter or a no.":"You're getting the better side. They might still bite, but expect pushback or a counter.";
  }
  // Card 3: Good time to ask? - correlated with value tier
  if(valueTier==="getting_fleeced"){
    bcPsychLabel="COUNTER FIRST";bcPsychColor="var(--red)";
    bcPsychDesc="Don't send this as-is. Counter with something more balanced - this offer just gives your leverage away.";
  } else if(valueTier==="losing"){
    bcPsychLabel="RENEGOTIATE FIRST";bcPsychColor="var(--yellow)";
    bcPsychDesc="Get better value before sending. Timing only matters once the deal is fair.";
  } else if(valueTier==="crushing"){
    bcPsychLabel="SEND IT NOW";bcPsychColor="var(--green)";
    bcPsychDesc="You're winning this clearly. Don't overthink it - before they figure it out.";
  } else {
    bcPsychLabel=ps>=60?"GOOD TIME TO ASK":ps>=45?"TIMING IS MEH":"BAD TIMING";
    bcPsychColor=ps>=60?"var(--green)":ps>=45?"var(--yellow)":"var(--red)";
    bcPsychDesc=ps>=60?"Timing is working in your favor - hit them now.":ps>=45?"Nothing's pushing them either way. The offer has to stand on its own.":"Wait for a better moment, or give them a reason to deal now.";
  }
  // Titles stay neutral (clean); the good/bad sentiment shows on the card's left
  // accent bar instead of as loud colored text.
  // The cards wear the shared lilac->cyan gradient bar now (CSS ::before), so we
  // no longer paint a per-sentiment solid left border - the label carries the read.
  var _bv=document.getElementById("bc-value"),_cy=document.getElementById("fit-you");
  _bv.textContent=bcLabel;_bv.style.color='var(--text)';
  document.getElementById("bc-value-desc").textContent=bcDesc;
  var _bn=document.getElementById("bc-need"),_ct=document.getElementById("fit-them");
  _bn.textContent=bcNeedLabel;_bn.style.color='var(--text)';
  document.getElementById("bc-need-desc").textContent=bcNeedDesc;
  var _bp=document.getElementById("bc-psych"),_ctm=document.getElementById("fit-timing");
  _bp.textContent=bcPsychLabel;_bp.style.color='var(--text)';
  document.getElementById("bc-psych-desc").textContent=bcPsychDesc;
  // Timing goes deeper async: the target's next matchups + the seller's record.
  // Tough slate coming = you can wait for the dip. Soft slate = pay now, even a
  // little over. A losing seller gets cheaper with every L.
  try{ _timingSchedulePass(getInputEls,oppRosterObj,valueTier); }catch(_){}

  // Opponent perception
  var oppPercEl=document.getElementById("opp-perception");
  var oppPercTxt=document.getElementById("opp-perception-text");
  if(oppPercEl&&oppPercTxt){
    var percText=getOppPerception(acc,valueTier,p);
    oppPercTxt.textContent=percText;
    oppPercEl.style.display="block";
  }

  // Scenarios card
  var scenCard=document.getElementById("scenarios-card");
  var scenBest=document.getElementById("scenario-best");
  var scenWorst=document.getElementById("scenario-worst");
  if(scenCard&&scenBest&&scenWorst){
    var scen=generateScenarios(give,get,valueTier,ktcGap,giveKtc,getKtc);
    scenBest.textContent=scen.best;
    scenWorst.textContent=scen.worst;
    scenCard.style.display="grid";
  }

  // ── Trade Adjustment Callout ───────────────────────────────────────────────
  var adjEl=document.getElementById("trade-adjustment");
  if(adjEl){
    adjEl.style.display="none";
    adjEl.innerHTML="";
    if(valueTier==="crushing"&&hasKtc){
      // Too lopsided in your favor - suggest adding a piece from your side
      var myFlatPlayers=myRoster.map(function(p){return {id:p.id,name:p.name,pos:p.pos,ktc:getKtcValue(p.name,p.id)};}).filter(function(p){return p.ktc>0;}).sort(function(a,b){return a.ktc-b.ktc;});
      var giveNames=giveInputEls.map(function(i){return i.value.trim().toLowerCase();});
      var sweetener=myFlatPlayers.find(function(p){
        return giveNames.indexOf(p.name.toLowerCase())<0&&p.ktc>500&&p.ktc<ktcGap*0.6;
      });
      var html='<div class="verdict-panel" style="padding:.8rem 1rem .8rem 1.1rem">'
        +'<div style="font-size:11px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Heads up - they probably won\'t bite</div>'
        +'<div style="font-size:12px;color:var(--muted2);line-height:1.6">You\'re winning this trade by a big margin. Most managers will reject or counter hard. Consider sweetening the deal to get it done.</div>';
      if(sweetener){
        html+='<div style="margin-top:8px;display:flex;align-items:center;gap:8px">'
          +'<div style="font-size:11px;color:var(--muted);font-weight:600">Try adding:</div>'
          +'<div style="display:flex;align-items:center;gap:6px;background:var(--surface3);border-radius:20px;padding:3px 10px 3px 3px">'
          +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+sweetener.id+'.jpg" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
          +'<span style="font-size:12px;font-weight:600;color:var(--text)">'+sweetener.name+'</span>'
          +'<span style="font-size:11px;color:var(--muted)">'+sweetener.pos+'</span>'
          +'</div></div>';
      }
      html+='</div>';
      adjEl.innerHTML=html;
      adjEl.style.display="block";
    } else if((valueTier==="getting_fleeced"||valueTier==="losing")&&hasKtc&&Math.abs(ktcGap)>=400){
      // You're losing the deal by a REAL margin - suggest a piece that actually closes the gap.
      // (Small gaps don't get a counter: asking for a throwaway player just annoys the other manager.)
      var targetGap=Math.abs(ktcGap);
      var getNames=getInputEls.map(function(i){return i.value.trim().toLowerCase();});
      var oppCandidates=oppRoster.map(function(p){return {id:p.id,name:p.name,pos:p.pos,ktc:getKtcValue(p.name,p.id)};}).filter(function(p){return p.ktc>0;}).sort(function(a,b){return Math.abs(a.ktc-targetGap*0.85)-Math.abs(b.ktc-targetGap*0.85);});
      var addTarget=oppCandidates.find(function(p){
        return getNames.indexOf(p.name.toLowerCase())<0&&p.ktc>=targetGap*0.5&&p.ktc<=targetGap*1.2;
      });
      var isFleeced=valueTier==="getting_fleeced";
      // Express the gap in words, never a raw market-value number.
      var gapW=targetGap>=1400?'by a wide margin':targetGap>=700?'by a clear margin':'by a real but closable margin';
      var html2='<div class="verdict-panel" style="padding:.8rem 1rem .8rem 1.1rem">'
        +'<div style="font-size:11px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">'+(isFleeced?'No. Counter or walk':'Don\'t accept as-is - counter')+'</div>'
        +'<div style="font-size:12px;color:var(--muted2);line-height:1.6">'+(isFleeced?'This is a clear no at the current price - you\'re giving up more '+gapW+'. The only way this becomes a trade is if they add real value.':'You\'re losing this deal '+gapW+'. Fixable - ask them to add a piece before you agree.')+'</div>';
      if(addTarget){
        html2+='<div style="margin-top:8px;display:flex;align-items:center;gap:8px">'
          +'<div style="font-size:11px;color:var(--muted);font-weight:600">Ask them to add:</div>'
          +'<div style="display:flex;align-items:center;gap:6px;background:var(--surface3);border-radius:20px;padding:3px 10px 3px 3px;cursor:pointer" onclick="openPlayerCard(\''+addTarget.id+'\',\''+addTarget.name.replace(/'/g,"\\'")+'\')">'
          +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+addTarget.id+'.jpg" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
          +'<span style="font-size:12px;font-weight:600;color:var(--text)">'+addTarget.name+'</span>'
          +'<span style="font-size:11px;color:var(--muted)">'+addTarget.pos+'</span>'
          +'</div></div>';
      }
      html2+='</div>';
      adjEl.innerHTML=html2;
      adjEl.style.display="block";
    }
  }

  // ── Alternative Targets from opp roster ───────────────────────────────────
  var altEl=document.getElementById("alt-targets");
  if(altEl&&oppRoster.length){
    altEl.style.display="none";
    altEl.innerHTML="";
    var targetPositions={};
    getInputEls.forEach(function(i){
      var pid=i.dataset.playerId;
      var pName=i.value.trim();
      var pos=(pid&&allPlayers[pid])?allPlayers[pid].pos:(pName.match(/^(\d{4})\s+round/i)?'PK':null);
      if(pos&&pos!=='PK'&&['QB','RB','WR','TE'].indexOf(pos)>=0) targetPositions[pos]=true;
    });
    var targetPos=Object.keys(targetPositions);
    if(targetPos.length){
      var getNameSet=getInputEls.map(function(i){return i.value.trim().toLowerCase();});
      var alts=[];
      targetPos.forEach(function(pos){
        var atPos=oppRoster.filter(function(p){return p.pos===pos&&getNameSet.indexOf(p.name.toLowerCase())<0&&p.ktc>1000;})
          .sort(function(a,b){return b.ktc-a.ktc;}).slice(0,3);
        atPos.forEach(function(p){alts.push(p);});
      });
      if(alts.length){
        var posColors={QB:"#a78bfa",RB:"#4ade80",WR:"#fbbf24",TE:"#f87171"};
        var altHtml='<div style="padding:.75rem 1rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius)">'
          +'<div style="font-size:11px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Other targets on their roster</div>'
          +'<div style="display:flex;flex-wrap:wrap;gap:6px">';
        alts.forEach(function(p){
          var col=posColors[p.pos]||"var(--muted)";
          altHtml+='<div style="display:flex;align-items:center;gap:5px;background:var(--surface3);border-radius:20px;padding:3px 10px 3px 3px;cursor:pointer" onclick="openPlayerCard(\''+p.id+'\',\''+p.name.replace(/'/g,"\\'")+'\')">'
            +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
            +'<span style="font-size:12px;font-weight:600;color:var(--text)">'+p.name+'</span>'
            +'<span style="font-size:11px;font-weight:600;color:'+col+'">'+p.pos+'</span>'
            +(p.ktc?'<span style="font-size:10px;color:var(--muted)">'+playerTierLabel(p.ktc).short+'</span>':'')
            +'</div>';
        });
        altHtml+='</div></div>';
        altEl.innerHTML=altHtml;
        altEl.style.display="block";
      }
    }
  }

  // Show share button + trade-direction selector after analysis (only if logged in)
  var shareBtn=document.getElementById('share-community-btn');
  if(shareBtn&&userId)shareBtn.style.display='flex';
  var ctxRow=document.getElementById('share-context-row');
  if(ctxRow&&userId)ctxRow.style.display='block';
}

// League settings snapshot attached to a published trade, so people who open the
// thread can judge it in context (a 1-QB PPR read is not a superflex read).
function _communityLeagueSettings(){
  var lf=leagueFormat||{};
  return {
    teams:lf.totalTeams||null,
    scoring:lf.scoringLabel||(lf.ppr>=1?'PPR':lf.ppr>0?'Half-PPR':'Standard'),
    superflex:!!(lf.hasSuperFlex||lf.has2QB),
    format:leagueMode||'dynasty'
  };
}
// Which direction the trade came from, sent with the community post.
var _shareContext='outgoing';
function setShareContext(btn){
  _shareContext=btn.getAttribute('data-ctx')||'outgoing';
  var seg=document.getElementById('share-context-seg');
  if(seg)seg.querySelectorAll('.ctx-seg-btn').forEach(function(b){b.classList.toggle('active',b===btn);});
}

async function _timingSchedulePass(getInputEls,oppRosterObj,valueTier){
  var el=document.getElementById('bc-psych-desc');
  if(!el||!getInputEls||!getInputEls.length)return;
  // On a deal Mac already calls bad, timing advice like "pulling the trigger
  // now is still fine" flatly contradicts the verdict. The value gap doesn't get
  // fixed by a soft schedule - so skip the timing tip entirely on bad deals.
  if(valueTier==='getting_fleeced'||valueTier==='losing')return;
  // best incoming player = the one whose price timing matters
  var best=null,bv=0;
  getInputEls.forEach(function(i){
    var v=getKtcValue(i.value.trim(),i.dataset.playerId)||0;
    if(v>bv&&i.dataset.playerId){bv=v;best={name:i.value.trim()};}
  });
  if(!best)return;
  var wk=(typeof NFL_WEEK==='number'&&NFL_WEEK>0)?NFL_WEEK:1;
  var games=[];
  for(var w=wk;w<wk+2;w++){
    try{
      var r=await fetch('/api/stats/matchup?name='+encodeURIComponent(best.name)+'&week='+w);
      var d=await r.json();
      if(d&&d.found&&d.opp&&d.defAvgAllowed!=null&&d.avgPts)games.push(d);
    }catch(_){}
  }
  var extra='';
  if(games.length){
    // self-calibrating: opponent defenses vs this player's own scoring baseline
    var hard=games.filter(function(g){return g.defAvgAllowed<=g.avgPts*0.9;}).length;
    var easy=games.filter(function(g){return g.defAvgAllowed>=g.avgPts*1.05;}).length;
    var opps=games.map(function(g){return g.opp;}).join(', ');
    if(hard>=games.length&&games.length>=1&&hard>0){
      extra=' Schedule check: '+best.name+' draws tough defenses next ('+opps+'). If you can wait two weeks, his price may dip - but if the deal is already fair, pulling the trigger now is still fine.';
    }else if(easy>=games.length&&games.length>=1&&easy>0){
      extra=' Schedule check: '+best.name+'\'s slate softens next ('+opps+'). He is about to look better than his price - moving now, even paying slightly over, beats waiting.';
    }
  }
  try{
    var rec=oppRosterObj&&rosterRecord(oppRosterObj.roster_id);
    if(rec&&(rec.w+rec.l)>=3&&rec.w/(rec.w+rec.l)<0.4){
      extra+=' Their manager is '+rec.w+'-'+rec.l+': one more loss and they will take less. Waiting a week can also work in your favor.';
    }
  }catch(_){}
  if(extra)el.textContent=el.textContent+extra;
}
function sndVerdict(tier){
  if(!_sndOn)return;
  try{
    if(tier==='crushing'||tier==='winning'){ // good news: soft two-note rise
      sndPickSoft(); setTimeout(function(){var c=_ac();if(!c)return;var t=c.currentTime;
        [783.99,1046.5].forEach(function(f,i){var o=c.createOscillator();o.type='sine';o.frequency.value=f;
          var g=c.createGain();g.gain.setValueAtTime(.0001,t+i*.09);g.gain.linearRampToValueAtTime(.05,t+i*.09+.01);
          g.gain.exponentialRampToValueAtTime(.0001,t+i*.09+.6);o.connect(g);g.connect(c.destination);o.start(t+i*.09);o.stop(t+i*.09+.7);});},60);
    } else if(tier==='losing'||tier==='getting_fleeced'){ // one low honest tone
      var c=_ac();if(!c)return;var t=c.currentTime;
      var o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(146.83,t);
      var g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.08,t+.008);
      g.gain.exponentialRampToValueAtTime(.0001,t+.45);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.5);
    } else { sndPickSoft(); }
  }catch(_){}
}
function getOppPerception(acc,valueTier,p){
  var pn=oppName(p);
  if(valueTier==="getting_fleeced"){
    return pn+" is going to say yes immediately. That's the problem - when someone jumps at your offer that fast, you're the one getting played.";
  } else if(valueTier==="losing"){
    return "They'll probably take this. "+pn+" - "+oppDesc(p).split(".")[0]+". You're making it easy for them.";
  } else if(valueTier==="even"){
    return acc>=58
      ? pn+" sees this as fair. They might say yes or ask for something small. Either way you're fine."
      : pn+" is going to counter. They think this deal leans your way and they want more.";
  } else if(valueTier==="winning"){
    return acc>=55
      ? "Honestly surprised, but "+pn+" might still bite. They trade more than most so the odds are decent."
      : pn+" is going to push back. They know what they're giving up. Be ready to hold firm.";
  } else {
    return "They're not taking this. "+pn+" knows this trade is bad for them. Expect a hard no or a wild counter.";
  }
}

function generateScenarios(give,get,valueTier,ktcGap,giveKtc,getKtc){
  var isPick=function(n){return /round|pick/i.test(n);};
  var givePicks=give.filter(isPick);
  var getPicks=get.filter(isPick);
  // Sort by value so the headliner named in best/worst case is the SAME player
  // the verdict body leads with - never just whoever happened to be typed first.
  var byVal=function(a,b){return (getKtcValue(b)||0)-(getKtcValue(a)||0);};
  var givePlayers=give.filter(function(n){return !isPick(n);}).sort(byVal);
  var getPlayers=get.filter(function(n){return !isPick(n);}).sort(byVal);
  var main=getPlayers[0]||getPicks[0]||"what you're getting";
  var gave=givePlayers[0]||givePicks[0]||"what you gave";

  if(valueTier==="getting_fleeced"){
    return {
      best:""+main+" goes absolutely off"+(givePicks.length||getPicks.length?", the picks bust,":"")+" and somehow you come out okay. It would take a miracle honestly.",
      worst:"Everything plays out exactly like the numbers say. "+main+" underperforms, "+gave+" thrives for your opponent, and you're left watching the gap play out all season. You just lost."
    };
  }
  if(valueTier==="losing"){
    return {
      best:""+main+" immediately pops off and makes you look smart. The gap gets erased fast and you forget you overpaid.",
      worst:"Nobody overperforms. You overpaid and "+gave+" keeps cooking for your opponent all season."
    };
  }
  if(valueTier==="even"){
    if(getPicks.length&&givePlayers.length){
      return {
        best:"Picks land top-3, the kids develop, and you end up with more value than you gave. Looks like a genius move in two years.",
        worst:"Picks fall late, players bust, and you gave up a guy who was actually solid. Hurts to watch."
      };
    }
    if(getPicks.length){
      return {
        best:"Picks land early in a deep class. Your future looks a lot better than it did yesterday.",
        worst:"Picks slide to the back half, the players don't develop, and you gave up a real piece for nothing useful."
      };
    }
    if(givePicks.length){
      return {
        best:""+main+" pays off right away. You turned a pick that might never hit into a player producing for you now - great timing.",
        worst:main+" underwhelms and the pick you moved lands on a stud. You'll wish you had kept the flier."
      };
    }
    return {
      best:""+main+" goes crazy this season. You sold "+gave+" at the exact right time and now you have the better player.",
      worst:"Neither side pulls ahead. Nothing really changes, the trade didn't matter, and now your roster is shuffled for no reason."
    };
  }
  if(valueTier==="winning"){
    if(getPicks.length&&givePlayers.length){
      return {
        best:"Picks land early, those guys become real starters, and "+gave+" falls off right after you moved him. Clean.",
        worst:""+gave+" has a monster year and your picks land at the back of the draft. You won on paper but lost in real life."
      };
    }
    return {
      best:""+main+" becomes exactly who you thought he was. Anchors your team, helps you actually compete.",
      worst:"Injury or a bad season kills the upside. "+gave+" stays productive over there and the gap between your teams grows."
    };
  }
  // crushing
  return {
    best:"You already won. If these players also overperform, people in your league are going to be mad at you.",
    worst:"Even in the worst case scenario here, the numbers are too far in your favor to blow it. You got a good deal."
  };
}



// Battle sounds: synthesized, no audio files. Toggle persisted.
var _sndOn=true;try{_sndOn=localStorage.getItem('tm_sound')!=='off';}catch(_){}
function toggleSound(btn){
  _sndOn=!_sndOn;
  try{localStorage.setItem('tm_sound',_sndOn?'on':'off');}catch(_){}
  if(btn)btn.textContent=_sndOn?'Sound on':'Sound off';
}
var _actx=null;
function _ac(){
  if(!_actx){try{_actx=new (window.AudioContext||window.webkitAudioContext)();}catch(_){}}
  // iOS keeps the context suspended until it is resumed inside a user gesture -
  // every sound call runs from a tap, so resuming here unlocks phone audio.
  if(_actx&&_actx.state==='suspended'){try{_actx.resume();}catch(_){}}
  return _actx;
}
// belt and braces for iPhone: the first touch unlocks WebAudio AND plays a
// silent <audio> element - that second part moves Safari to the playback
// audio session, which is what lets sound out even with the ring switch off.
(function(){
  var done=false;
  function unlock(){
    if(done)return;done=true;
    try{var c=_ac();if(c&&c.state==='suspended')c.resume();}catch(_){}
    try{
      var a=document.createElement('audio');
      a.setAttribute('playsinline','');
      // 1-sample silent wav
      a.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      a.volume=0.01;
      var p=a.play();if(p&&p.catch)p.catch(function(){});
    }catch(_){}
    document.removeEventListener('touchend',unlock);document.removeEventListener('click',unlock);
  }
  document.addEventListener('touchend',unlock,{passive:true});
  document.addEventListener('click',unlock);
})();
// ── Phone menu: the tab row hides on small screens, this reaches everything ──
// The hamburger menu lives inside <nav>, but the nav has backdrop-filter:blur -
// which makes it the containing block for position:fixed children. That trapped
// the full-screen menu inside the 60px nav bar, clipping the whole feature list
// (the "three stripes show nothing" bug). Reparent it to <body> so fixed works.
(function _liftMobMenu(){
  try{var m=document.getElementById('mob-menu');if(m&&m.parentElement!==document.body)document.body.appendChild(m);}catch(_){}
})();
function mobMenuToggle(){
  var m=document.getElementById('mob-menu');
  if(!m)return;
  if(m.parentElement!==document.body){try{document.body.appendChild(m);}catch(_){}}
  var opening=!m.classList.contains('open');
  m.classList.toggle('open');
  // lock the page behind the menu so it never scrolls under the drawer
  try{document.body.style.overflow=opening?'hidden':'';}catch(_){}
}
function mobGo(screen,tab){
  mobMenuToggle();
  try{
    switchScreen(screen);
    if(screen==='mock'){try{mdRenderStrats();mdPrefillFromLeague();if(tab)mdShowSection(tab);}catch(_){}}
    if(screen==='news'){try{loadNewsGrid();loadAnalystCorner();}catch(_){}}
    if(screen==='community'){try{loadCommunityFeed();}catch(_){}if(tab){try{switchCommunityTab(tab);}catch(_){}}}
    if(tab&&screen==='research')openResearchTab(tab);
  }catch(_){}
}
// The drawer listed all nineteen destinations at once, so reaching Community
// meant scrolling past every Research and Draft subsection. Group them and keep
// exactly one group open, which is what makes the list short enough to scan.
function mobGroupToggle(btn){
  var group=btn.parentElement;
  if(!group)return;
  var wasOpen=group.classList.contains('open');
  var panel=group.parentElement||document;
  panel.querySelectorAll('.mob-group.open').forEach(function(g){
    g.classList.remove('open');
    var p=g.querySelector('.mob-parent');
    if(p)p.setAttribute('aria-expanded','false');
  });
  if(!wasOpen){
    group.classList.add('open');
    btn.setAttribute('aria-expanded','true');
  }
}
function sndWhoosh(){
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;
  var t=ctx.currentTime;
  var buf=ctx.createBuffer(1,ctx.sampleRate*0.25,ctx.sampleRate);
  var d=buf.getChannelData(0);
  for(var i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
  var src=ctx.createBufferSource();src.buffer=buf;
  var f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.setValueAtTime(400,t);f.frequency.exponentialRampToValueAtTime(2400,t+0.22);
  var g=ctx.createGain();g.gain.setValueAtTime(0.16,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.25);
  src.connect(f);f.connect(g);g.connect(ctx.destination);src.start(t);
}
// Draft lock-in: a deep soft thump with a whisper of air and one high glint.
// Feels like the pick sliding into place - short, warm, zero harshness.
function sndImpact(){
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;
  var t=ctx.currentTime;
  // deep thump, pitch falls 150->70Hz
  var o=ctx.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(70,t+.12);
  var g=ctx.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.11,t+.006);
  g.gain.exponentialRampToValueAtTime(.0001,t+.22);
  o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.26);
  // whisper of air rising with it
  var buf=ctx.createBuffer(1,Math.floor(ctx.sampleRate*.12),ctx.sampleRate);
  var d=buf.getChannelData(0);
  for(var i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);
  var src=ctx.createBufferSource();src.buffer=buf;
  var f=ctx.createBiquadFilter();f.type='bandpass';f.Q.value=1.2;
  f.frequency.setValueAtTime(500,t);f.frequency.exponentialRampToValueAtTime(2200,t+.11);
  var g2=ctx.createGain();g2.gain.setValueAtTime(.028,t);g2.gain.exponentialRampToValueAtTime(.0001,t+.12);
  src.connect(f);f.connect(g2);g2.connect(ctx.destination);src.start(t);
  // one high glint on the landing
  var o3=ctx.createOscillator();o3.type='sine';o3.frequency.value=1567.98;
  var g3=ctx.createGain();g3.gain.setValueAtTime(.0001,t+.06);g3.gain.linearRampToValueAtTime(.014,t+.07);
  g3.gain.exponentialRampToValueAtTime(.0001,t+.4);
  o3.connect(g3);g3.connect(ctx.destination);o3.start(t+.06);o3.stop(t+.45);
}
function sndPickSoft(){
  // T5 felt piano (his pick): one muffled low piano note, soft pedal down.
  // Harmonics 1/2/3 of A3 through a warm lowpass, long gentle decay.
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;
  var t=ctx.currentTime;
  [[220,.06],[440,.018],[660,.006]].forEach(function(pr){
    var o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(pr[0],t);
    var f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=700;
    var g=ctx.createGain();
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(pr[1],t+.006);
    g.gain.exponentialRampToValueAtTime(.0001,t+.4);
    o.connect(f);f.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.45);
  });
}
function sndYourTurn(){
  // "You're on the clock" - a bright, friendly two-note ascending bell chime,
  // like a draft-room turn alert. Clear enough to notice, not harsh.
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;
  var t=ctx.currentTime;
  [[659.25,0],[987.77,0.15]].forEach(function(pr){          // E5 -> B5, a bright lift
    var f0=pr[0],start=t+pr[1];
    [[f0,'triangle',0.10,1.2],[f0*2.01,'sine',0.03,0.9]].forEach(function(v){
      var o=ctx.createOscillator();o.type=v[1];o.frequency.setValueAtTime(v[0],start);
      var g=ctx.createGain();
      g.gain.setValueAtTime(.0001,start);g.gain.linearRampToValueAtTime(v[2],start+.008);
      g.gain.exponentialRampToValueAtTime(.0001,start+v[3]);
      o.connect(g);g.connect(ctx.destination);o.start(start);o.stop(start+v[3]+.05);
    });
  });
}
function sndWin(){
  // warm resolving chord, gentle attack - no blare
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;
  var t=ctx.currentTime;
  [261.63,392,523.25,783.99].forEach(function(fr,i){
    var o=ctx.createOscillator();o.type='sine';o.frequency.setValueAtTime(fr,t+i*.05);
    var g=ctx.createGain();
    g.gain.setValueAtTime(.0001,t+i*.05);g.gain.linearRampToValueAtTime(.05,t+i*.05+.06);
    g.gain.exponentialRampToValueAtTime(.0001,t+i*.05+.9);
    o.connect(g);g.connect(ctx.destination);o.start(t+i*.05);o.stop(t+i*.05+1);
  });
}

// The Versus Battle: the two sides' headline players face off; the market winner breaks the loser
function renderVsBattle(giveInputEls,getInputEls,ktcGap,hasKtc,valueTier){
  // A fair, win-win trade ("both teams eat") crowns BOTH sides - nobody loses.
  var bothEat=(valueTier==='even');
  var box=document.getElementById('vs-arena-box');
  if(!box)return;
  box.innerHTML='';
  function sideOf(els){
    return els.map(function(i){
      var nm=i.value.trim();
      var isPick=/round|pick/i.test(nm);
      var pid=i.dataset.playerId||(isPick?'':getPlayerIdByName(nm))||'';
      // the face and the label must be the SAME player: once we have an id,
      // the display name comes from the player record, never the raw input
      if(pid&&allPlayers[pid])nm=allPlayers[pid].name;
      return {pid:pid,name:nm,isPick:isPick,v:getKtcValue(nm,pid)};
    }).filter(function(a){return a.name;})   // picks fight too - they are part of the deal
     .sort(function(a,b){return b.v-a.v;}).slice(0,4);
  }
  var gs=sideOf(giveInputEls),ts=sideOf(getInputEls);
  if(!gs.length||!ts.length)return;
  var g=gs[0],t=ts[0];
  // Crown from valueTier, the SAME signal the verdict headline uses, not the raw
  // ktcGap. On uneven trades effGap (roster-spot economics) can flip the sign vs
  // raw market value, so crowning off ktcGap would crown the opposite side from
  // the headline sitting right below it. bothEat already reads valueTier for the
  // same reason - this keeps giveWins/even in step with it.
  var giveWins=(valueTier==='losing'||valueTier==='getting_fleeced'); // you lose = the give side "won"
  var even=(valueTier==='even');
  function bubbles(side,cls){
    return side.map(function(a,i){
      var big=i===0;
      var inner=a.isPick||!a.pid
        ?'<div style="width:100%;height:100%;border-radius:50%;background:var(--accent-dim);border:3px solid var(--border2);display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-weight:800;font-size:'+(big?'15px':'11px')+';color:var(--accent-bright)">PICK</div>'
        :'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+a.pid+'.jpg" onerror="this.src=\'\';this.style.background=\'var(--surface3)\'">';
      return '<div class="vs-bubble '+cls+(side.length>=3?' vs-mini':'')+'" style="'+(big?'':'width:64px;height:64px;margin-top:20px')+'">'+inner+'<div class="vs-crack"></div><div class="vs-label">'+a.name.split(' ').slice(-1)[0]+'</div></div>';
    }).join('');
  }
  box.innerHTML='<div class="vs-arena">'
    +'<div style="display:flex;gap:8px;align-items:flex-start" id="vsb-l">'+bubbles(gs,'vs-left')+'</div>'
    +'<div class="vs-vs">VS</div>'
    +'<div style="display:flex;gap:8px;align-items:flex-start" id="vsb-r">'+bubbles(ts,'vs-right')+'</div>'
    +'</div>'
    +'<div style="text-align:center;margin-top:-14px;margin-bottom:10px"><button class="btn-sm" style="font-size:10px;padding:3px 10px" onclick="toggleSound(this)">'+(_sndOn?'Sound on':'Sound off')+'</button></div>';
  var L=document.getElementById('vsb-l'),R=document.getElementById('vsb-r');
  function each(el,fn){el.querySelectorAll('.vs-bubble').forEach(fn);}
  setTimeout(function(){each(L,function(b){b.classList.add('fight');});each(R,function(b){b.classList.add('fight');});sndWhoosh();},250);
  setTimeout(sndWhoosh,800);
  setTimeout(function(){
    L.classList.remove('fight');R.classList.remove('fight');
    sndImpact();setTimeout(sndWin,300);
    // Screen flash + shake + shattering shards off the loser
    var flash=document.createElement('div');flash.className='vs-flash';document.body.appendChild(flash);
    setTimeout(function(){flash.remove();},450);
    box.classList.add('vs-shake');setTimeout(function(){box.classList.remove('vs-shake');},500);
    var loserEl=(bothEat||even)?null:(giveWins?R:L);
    if(loserEl){
      loserEl.querySelectorAll('.vs-bubble').forEach(function(b){
        for(var si=0;si<6;si++){
          var sh=document.createElement('div');sh.className='vs-shard';
          sh.style.left='45%';sh.style.top='40%';
          sh.style.setProperty('--sx',(Math.random()*160-80)+'px');
          sh.style.setProperty('--sy',(Math.random()*-120-20)+'px');
          sh.style.setProperty('--sr',(Math.random()*720-360)+'deg');
          b.appendChild(sh);
          setTimeout(function(s){return function(){s.remove();};}(sh),950);
        }
      });
    }
    function crown(el,cls){each(el,function(b){b.classList.add(cls);});}
    // A crown means you WON the trade. Even trades crown nobody - crowning both
    // sides read as a bug (and contradicted a negative verdict below it).
    if(bothEat){crown(L,'winner');crown(R,'winner');}   // both teams eat - crown both
    else if(even){/* no crowns on a wash */}
    else if(giveWins){crown(L,'winner');crown(R,'loser');}
    else {crown(R,'winner');crown(L,'loser');}
  },1500);
}

function generatePitch(give,get,oppProfile,you,opp,valueTier){
  var card=document.getElementById("pitch-card");
  var anglesEl=document.getElementById("pitch-angles");
  var avoidEl=document.getElementById("pitch-avoid-wrap");
  var msgEl=document.getElementById("pitch-message-text");
  if(!card)return;
  if(valueTier==='getting_fleeced'){
    card.style.display="block";
    card.innerHTML='<div class="pitch-header"><div><div class="pitch-title" style="color:var(--text)">Do not make this trade</div><div class="pitch-sub">The value gap is too large. There is no good way to pitch this - it is just a bad deal for you.</div></div></div>';
    return;
  }
  card.style.display="block";
  var youGiving=give.length?give.join(" and "):"your players";
  var youGetting=get.length?get.join(" and "):"their players";
  var dir=opp[0],style=opp[1],hist=opp[2];
  var oppRosterNames=oppRoster.slice(0,6).map(function(p){return p.name;});
  var oppRBs=oppRoster.filter(function(p){return p.pos==="RB";}).slice(0,3).map(function(p){return p.name;});
  var oppWRs=oppRoster.filter(function(p){return p.pos==="WR";}).slice(0,3).map(function(p){return p.name;});
  var oppQBs=oppRoster.filter(function(p){return p.pos==="QB";}).slice(0,2).map(function(p){return p.name;});
  var oppTEs=oppRoster.filter(function(p){return p.pos==="TE";}).slice(0,2).map(function(p){return p.name;});
  var weakPos="",weakNames="";
  if(oppRBs.length<2){weakPos="RB";weakNames=oppRBs.join(", ")||"thin";}
  else if(oppWRs.length<3){weakPos="WR";weakNames=oppWRs.join(", ")||"thin";}
  else if(oppTEs.length<1){weakPos="TE";weakNames="nothing at TE";}
  var angles=[],avoid=[],message="";
  if(dir===0||oppProfile.name==="The Closing Window"){
    angles.push({color:"var(--accent-bright)",label:"Lead with the championship frame",text:"Tell them: "+youGiving+" gives them the proven veteran that pushes a contender over the top. Their window is open right now. Frame this as the move that separates teams that almost win from teams that actually win."+(oppRBs.length?" They already have "+oppRBs[0]+(oppRBs[1]?" and "+oppRBs[1]:"")+" in their backfield. Show how "+youGiving+" fits alongside what they have.":"")});
    if(weakPos)angles.push({color:"var(--yellow)",label:"Attack their weak spot at "+weakPos,text:"Look at their "+weakPos+" situation: "+weakNames+". If "+youGiving+" addresses that position, say it explicitly. Tell them: I know "+weakPos+" has been a concern - this solves it."});
    angles.push({color:"var(--green)",label:"Create urgency with scarcity",text:"End with: I am shopping "+youGiving+" to a couple of teams - wanted to give you first look since it fits your roster best. Win-now managers hate missing a move that could have helped them."});
    avoid.push("Do not mention "+youGetting+" depreciation or age if they are veterans. They do not want to hear about decline curves.");
    avoid.push("Do not give them time to overthink. Win-now managers who sleep on deals talk themselves out of them.");
    message="Hey, wanted to run something by you before I shop it elsewhere. I think "+youGiving+" makes your team a real contender this year - you have the core, this fills the gap."+(weakPos?" Especially at "+weakPos+" where I know you have been thin.":"")+" Offering "+youGiving+" for "+youGetting+". Let me know - I want to get this done this week.";
  } else if(dir===1||oppProfile.name==="The Full Send Rebuilder"){
    angles.push({color:"var(--green)",label:"Talk picks and age, not production",text:"Rebuilders think in age curves and draft capital. Frame "+youGiving+" in terms of draft profile, age, and upside - not current stats. A 23-year-old WR with upside is worth more to a rebuilder than a 28-year-old WR1."+(oppRosterNames.length?" Looking at their roster ("+oppRosterNames.join(", ")+"), they are clearly building young. "+youGiving+" fits that identity.":"")});
    angles.push({color:"var(--accent-bright)",label:"Make them feel like the smart one",text:"Say: I know you are building the right way - I respect it. I just need "+youGetting+" for my push this year and I think "+youGiving+" is perfect for where you are. Rebuilders love being validated on their strategy."});
    avoid.push("Never pitch veteran production to a rebuilder. They are thinking 3 years out.");
    message="Hey, think we can help each other. You get "+youGiving+(oppRosterNames.length?" - fits right into what you are building with "+oppRosterNames.slice(0,2).join(" and "):"")+". I get "+youGetting+" for my window. Clean swap.";
  } else if(dir===2||oppProfile.name==="The Denial Manager"){
    angles.push({color:"var(--yellow)",label:"Validate their belief, then pivot",text:"They think they can still compete. Do not argue. Start with: I think you are closer than your record shows. Then explain how "+youGiving+" bridges the gap. Never say rebuild."+(oppRBs.length&&oppWRs.length?" They have "+oppRBs[0]+" and "+oppWRs[0]+" already. "+youGiving+" next to those creates a real contention argument.":"")});
    angles.push({color:"var(--accent-bright)",label:"Give them permission to believe",text:"Say: one or two moves and you are right there. This trade is that move. Denial managers need someone else to see the vision first. Give it to them."});
    avoid.push("Do not use the word rebuild or suggest they should be selling. It will kill the deal immediately.");
    message="Honestly I think you are sleeping on how good your team is. "+youGiving+" next to what you already have? That is a legitimate contender. I need "+youGetting+" for my own roster - I think this helps both of us. Worth a conversation?";
  } else if(dir===4||oppProfile.name==="The Young Contender"){
    angles.push({color:"var(--red)",label:"Be direct - they hold the leverage too",text:"Young contenders know their value. Come with a specific reason why this helps THEM."+(weakPos?" Their "+weakPos+" depth is "+weakNames+" - lead with that specific need.":"")+" Generic offers will be ignored."});
    angles.push({color:"var(--accent-bright)",label:"Show respect and data",text:"Open by acknowledging their strength: Your team is set up really well. Then present this as a chess move that gets them to the title even faster. Be a peer, not a salesman."});
    avoid.push("Do not lowball. They will reject it and post it in the group chat.");
    avoid.push("Do not use urgency tactics. They have time and they know it.");
    message="Your roster is legitimately one of the best in the league. I think there is one move that gets you to the title faster - "+youGiving+" fills the one hole you have"+(weakPos?" at "+weakPos:"")+". I need "+youGetting+". Straight deal.";
  } else if(oppProfile.name==="The Flip Addict"){
    angles.push({color:"var(--accent-bright)",label:"Make it sound exciting, not logical",text:"Do not explain the trade rationally. Flip addicts trade for stimulation. Say: What if I told you there is a deal that completely changes both our rosters? They respond to that faster than any value argument."});
    angles.push({color:"var(--yellow)",label:"Speed matters - send the offer now",text:"Flip addicts act impulsively. A 48-hour delay lets them lose interest and start thinking about a different trade. Strike immediately after this conversation."});
    avoid.push("Do not over-explain. Two sentences max. They will not read a paragraph.");
    message="What if - and hear me out - "+youGiving+" for "+youGetting+"? Think it shakes both rosters up in a good way. Let me know.";
  } else if(oppProfile.name==="The Spreadsheet Guy"){
    angles.push({color:"var(--accent-bright)",label:"Come with the actual numbers",text:"Open your message with the values, not the player names. They will check anyway - save them the step. Transparency reads as respect to an analytics-first manager."+(oppRosterNames.length?" They know their roster well: "+oppRosterNames.join(", ")+". Show you did your homework on their positional values too.":"")});
    angles.push({color:"var(--green)",label:"Acknowledge if value is slightly off",text:"If the numbers are not perfectly even, acknowledge it before they bring it up. Say: I know the market has this slightly in your favor - I am fine with that because this fills a need. Honesty disarms them completely."});
    avoid.push("Do not use emotional arguments. He is a great teammate will make them respect you less.");
    message="Hey, ran the numbers on this - the market has "+youGiving+" at roughly even value with "+youGetting+". Think the trade makes sense for both rosters from a value standpoint. Worth a look?";
  } else if(oppProfile.name==="The Star Hoarder"){
    angles.push({color:"var(--yellow)",label:"Target their depth, not their studs",text:"If you target their WR1 or RB1 in a first offer, you get a hard no and poison future negotiations. Find the player who is good but not untouchable."+(oppRosterNames.length?" Look at the back of their roster: "+oppRosterNames.slice(3).join(", ")+". That is where you negotiate from.":"")});
    angles.push({color:"var(--accent-bright)",label:"Lead entirely with what they receive",text:"Write your entire message about "+youGiving+" - what it does for their team, why they should want it. Do not mention "+youGetting+" unless asked. The moment you talk about what you want, they start protecting it."});
    avoid.push("Never make your first offer for their best player. Even if it is fair value.");
    message="Hey, wanted to put something out there - I think "+youGiving+" could be a real piece for your roster. Fits well with what you already have."+(oppRosterNames.length?" You have "+oppRosterNames.slice(0,2).join(" and ")+" doing work - this adds another weapon.":"")+" Would love to chat if you are open.";
  } else if(oppProfile.name==="The Counter King"){
    angles.push({color:"var(--accent-bright)",label:"Send worse than your real offer first",text:"Your first offer should be slightly below what you actually want to pay. They will counter. That counter IS the deal you wanted. If you send your real price first, they counter below it and you overpay."});
    angles.push({color:"var(--yellow)",label:"After their counter, pause before accepting",text:"When they counter, wait 6-12 hours before responding. Even if you would take it instantly - wait. Then say: I had to think about it and accept. They need to feel they negotiated you down."});
    avoid.push("Never say final offer. They will call your bluff.");
    avoid.push("Never accept immediately. Even if it is perfect.");
    message="Hey - would you do "+youGiving+" for "+youGetting+"? Open to adjusting if we are close.";
  } else {
    angles.push({color:"var(--accent-bright)",label:"Give them a direction to believe in",text:"Managers stuck in the middle respond to clarity. Tell them what this trade does for their roster identity. Unfocused managers need someone else to see the vision first."});
    angles.push({color:"var(--yellow)",label:"Ask a question before the offer",text:"Message them first: Are you trying to compete this year or build for the future? Their answer tells you exactly how to frame the deal. It also makes you look like the smartest GM in the league."});
    avoid.push("Do not send a generic offer with no context. They will decline out of confusion.");
    message="Quick one - are you competing this year or building? Got a trade in mind either way.";
  }
  if(hist===1)angles.push({color:"var(--muted2)",label:"They will counter - plan for it",text:"Based on your history, expect a counter and plan for it. Build a small buffer into your offer - offer slightly less than your real ceiling so you have room to give. Their counter is the real negotiation."});
  // Keep it tight: one lead angle, one thing to avoid. The message does the rest.
  var anglesHtml="";
  angles.slice(0,1).forEach(function(a){anglesHtml+="<div class='pitch-angle'><div class='pitch-angle-label'><span class='angle-dot' style='background:"+a.color+"'></span><span style='color:"+a.color+"'>"+a.label+"</span></div><div class='pitch-angle-text'>"+a.text+"</div></div>";});
  if(anglesEl){anglesEl.innerHTML=anglesHtml;anglesEl.style.display='none';}
  // Start collapsed so the initial verdict view stays light - it's one tap to open.
  var _pchev=document.getElementById('pitch-chevron');if(_pchev)_pchev.style.transform='';
  // "One thing to avoid" and "Message to send" removed by request: the angle is
  // the useful part; canned DMs and warnings were noise.
  if(avoidEl)avoidEl.innerHTML='';
  if(msgEl)msgEl.textContent='';
  window._pitchMessage=message;
}
// Collapse/expand the "How to sell this trade" pitch, collapsed by default.
function togglePitch(){
  var a=document.getElementById('pitch-angles');var c=document.getElementById('pitch-chevron');
  if(!a)return;
  var open=a.style.display!=='none';
  a.style.display=open?'none':'block';
  if(c)c.style.transform=open?'':'rotate(180deg)';
}

function copyPitch(){
  if(!window._pitchMessage)return;
  navigator.clipboard.writeText(window._pitchMessage).then(function(){
    var btn=document.querySelector(".pitch-copy-btn");
    if(btn){btn.textContent="Copied!";setTimeout(function(){btn.textContent="Copy";},2000);}
  });
}

function getHistory(){try{return JSON.parse(localStorage.getItem("tm_history")||"[]");}catch(e){return[];}}
function saveHistory(h){try{localStorage.setItem("tm_history",JSON.stringify(h));}catch(e){}}

function saveToHistory(){
  if(!lastResult)return;
  var h=getHistory();h.unshift(lastResult);
  if(h.length>50)h.length=50;
  saveHistory(h);renderHistory();
  switchTab(document.querySelectorAll(".tab")[1],"tab-history");
}

function renderHistory(){
  var list=document.getElementById("history-list");
  if(!list)return;
  var h=getHistory();
  if(!h.length){list.innerHTML="<div class='empty-state'>No saved trades yet. Analyze a trade and click Save to history.</div>";return;}
  list.innerHTML=h.map(function(t){
    var color=t.acc>=65?"var(--green)":t.acc>=45?"var(--yellow)":"var(--red)";
    var time=new Date(t.timestamp).toLocaleDateString();
    return "<div class='history-item'><div class='h-pct' style='color:"+color+"'>"+t.acc+"%</div><div><div class='h-trade'>"+(t.give||[]).join(", ")+" for "+(t.get||[]).join(", ")+"</div><div class='h-meta'>"+t.profile+" - "+t.headline+"</div></div><div class='h-time'>"+time+"</div></div>";
  }).join("");
}

function clearHistory(){localStorage.removeItem("tm_history");renderHistory();}

function renderLeaguePersonalities(){
  var el=document.getElementById("league-personalities");
  if(!el)return;
  if(!leagueRosters.length){el.innerHTML="<div class='empty-state'>Connect a league to see who's who.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";return;}
  var archColors={K:'#f59e0b',F:'#f87171',D:'#fb923c',R:'#4ade80',M:'#94a3b8',W:'#facc15',Y:'#60a5fa',S:'#a78bfa',T:'#34d399'};
  var rows=leagueRosters.map(function(r){
    var u=leagueUsers.find(function(x){return x.user_id===r.owner_id;});
    var name=(u&&(u.metadata&&u.metadata.team_name||u.display_name))||"Team "+r.roster_id;
    var avatar=u&&(u.metadata&&u.metadata.avatar||u.avatar)||null;
    var avatarUrl=avatar?(String(avatar).indexOf('http')===0?avatar:'https://sleepercdn.com/avatars/thumbs/'+avatar):null;
    var roster=(r.players||[]).map(function(pid){return allPlayers[pid];}).filter(Boolean);
    var prof=inferOppProfileFromHistory(roster,r.roster_id);
    var isMe=r.owner_id===userId;
    return {name:name,prof:prof,isMe:isMe,avatarUrl:avatarUrl};
  });
  el.innerHTML=rows.map(function(row){
    var c=archColors[row.prof.icon]||'#a78bfa';
    var avatarHtml=row.avatarUrl
      ?"<img src='"+row.avatarUrl+"' style='width:42px;height:42px;border-radius:12px;object-fit:cover;flex-shrink:0;border:2px solid "+c+"' onerror=\"this.style.display='none'\">"
      :"<div style='width:42px;height:42px;border-radius:12px;background:"+c+"22;color:"+c+";display:flex;align-items:center;justify-content:center;font-family:var(--font-head);font-weight:800;font-size:17px;flex-shrink:0;border:2px solid "+c+"55'>"+row.prof.icon+"</div>";
    return "<div class='lb-row'"+(row.isMe?" style='border-color:rgba(155,114,232,.4);background:rgba(155,114,232,.06)'":"")+">"
      +avatarHtml
      +"<div class='lb-info'><div class='lb-trade' style='font-size:14px'>"+row.name+(row.isMe?" <span style='font-size:10px;color:var(--accent-bright)'>YOU</span>":"")+"</div>"
      +"<div class='lb-meta'><span style='display:inline-block;padding:1px 9px;border-radius:100px;background:"+c+"22;color:"+c+";font-weight:700;font-size:11px;margin-right:6px'>"+oppName(row.prof)+"</span>"+(row.prof.why||"")+"</div></div>"
      +"</div>";
  }).join("");
}

function renderLeaderboard(){
  // Leaderboard tab removed - personalities now live in the League Trades tab
  renderLeaguePersonalities();
  var list=document.getElementById("leaderboard-list");
  if(!list)return;
  var h=getHistory().filter(function(t){return t.ktcGap!==null&&t.leagueId===leagueId;});
  if(!h.length){list.innerHTML="<div class='empty-state'>No saved trades for this league yet.</div>";return;}
  var sorted=h.slice().sort(function(a,b){return b.ktcGap-a.ktcGap;});
  list.innerHTML=sorted.map(function(t,i){
    var won=t.ktcGap>=0;
    var lbLabel=Math.abs(t.ktcGap)<200?"Even":t.ktcGap>=1000?"Big Win":t.ktcGap>=200?"Win":t.ktcGap<=-1000?"Got Robbed":"Loss";
    return "<div class='lb-row'><div class='lb-rank'>"+(i+1)+"</div><div class='lb-info'><div class='lb-trade'>"+(t.give||[]).join(" + ")+" for "+(t.get||[]).join(" + ")+"</div><div class='lb-meta'>"+t.profile+" - "+new Date(t.timestamp).toLocaleDateString()+"</div></div><div class='lb-ktc "+(won?"lb-win":"lb-lose")+"'>"+lbLabel+"</div></div>";
  }).join("");
}

function openShareModal(){
  if(!lastResult)return;
  var data=encodeURIComponent(btoa(JSON.stringify({give:lastResult.give,get:lastResult.get,acc:lastResult.acc,profile:lastResult.profile,headline:lastResult.headline,ktcGap:lastResult.ktcGap,gv:lastResult.giveKtc||0,tv:lastResult.getKtc||0})));
  var url=window.location.origin+"/?trade="+data;
  document.getElementById("share-url").textContent=url;
  document.getElementById("share-modal").classList.add("open");
}

function copyShareUrl(){
  var url=document.getElementById("share-url").textContent;
  navigator.clipboard.writeText(url).then(function(){
    var el=document.getElementById("copy-confirm");
    if(el){el.style.display="block";setTimeout(function(){el.style.display="none";},2000);}
  });
}

function closeShareModal(){document.getElementById("share-modal").classList.remove("open");}

async function checkShareParam(){
  var params=new URLSearchParams(window.location.search);
  var data=params.get("trade");
  if(!data)return;
  try{
    // URL parsing turns base64 '+' into spaces on older links - restore them
    var t=JSON.parse(atob(data.replace(/ /g,'+')));
    var _heroEl=document.querySelector('.hero');if(_heroEl)_heroEl.style.display='none';_heroDismissed=true;
    var _howMini=document.getElementById('how-mini');if(_howMini)_howMini.style.display='none';
    document.getElementById("login-panel").style.display="none";
    var _ph=document.getElementById("right-placeholder");if(_ph)_ph.style.display="none";
    var panel=document.getElementById("result-panel");
    panel.classList.add("visible");
    document.getElementById("verdict-headline").textContent=t.headline||"TRADE ANALYSIS";
    // Resolve player photos, then render rich chips
    await ensurePlayersLoaded();
    function chip(name,color){
      var pid=getPlayerIdByName(name);
      var p=pid?allPlayers[pid]:null;
      var img=pid?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:2px solid '+color+'" onerror="this.style.display=\'none\'">':'';
      return '<span style="display:inline-flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:100px;padding:5px 15px 5px 5px;margin:3px;font-size:13px;font-weight:600;color:var(--text)">'+img+name+(p?' <span style="font-size:10px;color:'+color+';font-weight:700">'+p.pos+'</span>':'')+'</span>';
    }
    var giveChips=(t.give||[]).map(function(n){return chip(n,'var(--green)');}).join('');
    var getChips=(t.get||[]).map(function(n){return chip(n,'var(--accent-bright)');}).join('');
    var gapHtml='';
    if(t.ktcGap!=null){
      var g=t.ktcGap;
      var gLabel=Math.abs(g)<350?'Roughly even':g>=1000?'Big win':g>=350?'Winning side':g<=-1000?'Getting robbed':'Losing side';
      var gColor=g>=350?'var(--green)':g<=-350?'var(--red)':'var(--yellow)';
      gapHtml='<div style="display:inline-flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid '+gColor+';border-radius:100px;padding:6px 16px;margin-top:12px"><span style="width:8px;height:8px;border-radius:50%;background:'+gColor+'"></span><span style="font-size:12px;font-weight:700;color:'+gColor+'">'+gLabel+'</span></div>';
    }
    window._sharedTrade=t;
    document.getElementById("verdict-body").innerHTML=
      '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin:14px 0;text-align:center">'
      +'<div><div style="font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">They give up</div>'+giveChips+'</div>'
      +'<div style="font-size:20px;color:var(--muted)">&#8646;</div>'
      +'<div><div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">They get back</div>'+getChips+'</div>'
      +'</div>'
      +(gapHtml?'<div style="text-align:center">'+gapHtml+'</div>':'')
      +((t.gv||t.tv)?(function(){
          var max=Math.max(t.gv||0,t.tv||0)||1;
          function bar(label,val,color){
            return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px"><span style="color:var(--muted2)">'+label+'</span></div>'
              +'<div style="height:8px;background:var(--surface3);border-radius:4px;overflow:hidden"><div style="width:'+Math.round(val/max*100)+'%;height:100%;background:'+color+';border-radius:4px"></div></div></div>';
          }
          return '<div style="max-width:380px;margin:16px auto 0">'
            +'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;text-align:center">Market value breakdown</div>'
            +bar('Give side total',t.gv||0,'var(--green)')+bar('Get side total',t.tv||0,'var(--accent-bright)')+'</div>';
        })():'')
      +'<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--muted)">Mac read the opponent as: <strong style="color:var(--accent-bright)">'+(t.profile||'Unknown')+'</strong></div>'
      +'<div style="text-align:center;margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'
      +'<button onclick="counterSharedTrade()" style="background:var(--surface2);border:1px solid rgba(155,114,232,.45);color:var(--accent-bright);font-weight:700;font-size:13px;padding:10px 24px;border-radius:100px;cursor:pointer;font-family:var(--font-body)">Counter this offer</button>'
      +'<a href="/" style="display:inline-block;background:#9b72e8;color:#fff;font-weight:700;font-size:13px;padding:10px 26px;border-radius:100px;text-decoration:none">Analyze YOUR trade</a></div>';
    if(t.acc){
      var bar=document.getElementById("balance-bar");
      if(bar){var pct=Math.min(95,Math.max(5,t.acc));bar.style.width=pct+"%";bar.style.background=pct>=60?"var(--green)":pct>=45?"var(--yellow)":"var(--red)";}
    }
    scrollToEl(panel);
  }catch(e){ console.warn("Invalid share param",e); }
}

var _VALID_SCREENS=['home','analyze','league','research','learn','community','news','mock','sage'];
var _heroDismissed=false; // once hidden (league connected), stays hidden
function switchScreen(name,_noPush){
  // Learn and News were relocated into Community tabs; reroute any stray
  // navigation (old deep links, cached handlers) to their new home.
  if(name==='learn'){goLearn();return;}
  if(name==='news'){goNews();return;}
  // News polling now lives with the Community News tab (_newsPollControl); if we
  // are navigating away from Community entirely, make sure it is stopped.
  if(name!=='community'){try{_newsPollControl(false);}catch(_){}}
  document.querySelectorAll(".screen").forEach(function(s){s.classList.remove("active");});
  document.querySelectorAll(".screen-nav").forEach(function(n){n.classList.remove("active");});
  var screen=document.getElementById("screen-"+name);
  if(screen)screen.classList.add("active");
  var nav=document.querySelector("[data-screen='"+name+"']");
  if(nav)nav.classList.add("active");
  // Mac chat: the "connect your league" nudge is about roster context, so it
  // only makes sense for a manager who is already signed in but has no league
  // loaded yet. For a signed-out visitor it would be a second, competing entry
  // point next to the inline sign-in - which is exactly the double prompt we are
  // killing - so we keep it hidden and let the inline sign-in own onboarding.
  if(name==='sage'){var sch=document.getElementById('sage-connect-hint');if(sch)sch.style.display=(localStorage.getItem('tm_username')&&!leagueId)?'inline-flex':'none';try{sageSyncUser();}catch(_){}try{sageUpdateQuota();}catch(_){}}
  // HOME is the landing page (hero + story + news rail); every other screen is
  // a tool page. The hero and marketing live ONLY on home now - the Analyze
  // page shows just the tool.
  var isHome=(name==='home');
  var heroEl=document.querySelector('.hero');
  if(heroEl)heroEl.style.display=isHome?'':'none';
  var hn=document.getElementById('home-news-wrap');
  if(hn)hn.style.display=(isHome&&hn.dataset.loaded==='1')?'block':'none';
  var hs=document.getElementById('home-story');
  if(hs)hs.style.display=isHome?'block':'none';
  // The founder manifesto is landing copy. It had no id and no toggle, so it
  // rendered under every tool page (Community, Research...) - the #1 "made fast"
  // tell. It is home-only, same as the rest of the story.
  var hf=document.getElementById('home-founder');
  if(hf)hf.style.display=isHome?'':'none';
  var hhow=document.getElementById('home-how');
  if(hhow)hhow.style.display=isHome?'':'none';
  var hp=document.getElementById('home-problem');
  // Back to the default block flow. This used to be forced to flex so the
  // section could centre its content inside a full-viewport box; it is now
  // sized by its own content, and forcing flex here laid the headline and the
  // copy out as a row instead of a column.
  if(hp)hp.style.display=isHome?'':'none';  // the problem narrative is home-only too
  // Hide the tool section entirely on home. Its inner screens are already
  // inactive, but the <section> keeps its 60px top+bottom padding, which was
  // showing as ~120px of empty space between the hero and the story below.
  var az=document.getElementById('analyzer');
  if(az)az.style.display=isHome?'none':'';
  if(!_noPush){history.pushState({screen:name},'','/'+(isHome?'':name));}
  // Scroll: home goes to the very top (hero); tool pages jump to the tool.
  // goHome sets _noAnchorOnce so the wordmark lands at the top smoothly.
  if(window._noAnchorOnce){window._noAnchorOnce=false;}
  else if(isHome){window.scrollTo({top:0,behavior:'auto'});}
  else{
    var anchor=document.getElementById("analyzer");
    // instant jump: the smooth scroll here made every tab look like it was
    // sliding up from the bottom of the page
    if(anchor){setTimeout(function(){anchor.scrollIntoView({behavior:"auto",block:"start"});},0);}
  }
}
// Tab-level history sync: tab changes inside a screen push a descriptive hash
// (for example /research#tab-market) so the browser back button walks tabs
// instead of leaving the site. Restores triggered by popstate run with
// _tabRestoring set, so they never push again and cannot loop.
var _TAB_DEFAULTS={analyze:'analyzer',league:'tab-roster-grade',research:'tab-buysell',community:'trades',mock:'solo'};
function _tabPush(token,scr){
  if(window._tabRestoring)return;
  if((window.location.pathname.replace('/','')||'home')!==scr)return;
  var cur=window.location.hash.slice(1);
  if(cur===token)return;
  // default tab on a fresh screen entry: the screen entry already covers it
  if(!cur&&_TAB_DEFAULTS[scr]===token)return;
  try{history.pushState({screen:scr,tab:token},'',window.location.pathname+window.location.search+'#'+token);}catch(_){}
}
function _applyTabHash(){
  var scr=window.location.pathname.replace('/','')||'home';
  if(!(scr in _TAB_DEFAULTS))return;
  var token=window.location.hash.slice(1)||_TAB_DEFAULTS[scr];
  window._tabRestoring=true;
  try{
    if(scr==='analyze'){showAnalyzeTab(token==='ideas'?'ideas':'analyzer');}
    else if(scr==='league'||scr==='research'){
      if(document.getElementById(token)){
        var screen=document.getElementById('screen-'+scr);
        var btn=null;
        if(screen){
          var btns=screen.querySelectorAll('.inner-tab');
          for(var i=0;i<btns.length;i++){if((btns[i].getAttribute('onclick')||'').indexOf("'"+token+"'")>=0){btn=btns[i];break;}}
        }
        if(btn){if(!btn.classList.contains('active'))btn.click();}
        else{switchInnerTab(null,token,'screen-'+scr);}
      }
    }
    else if(scr==='community'){
      if(['trades','mine','forum','news','learn','feedback'].indexOf(token)>=0&&activeCommunityTab!==token)switchCommunityTab(token);
    }
    else if(scr==='mock'){
      if(['solo','friends','live','history'].indexOf(token)>=0&&window._mdSection!==token)mdShowSection(token);
    }
  }catch(_){}
  window._tabRestoring=false;
}
window.addEventListener('popstate',function(e){
  var name=(e.state&&e.state.screen)||(window.location.pathname.replace('/',''))||'home';
  if(_VALID_SCREENS.indexOf(name)===-1)name='home';
  switchScreen(name,true);
  _applyTabHash();
});

async function syncRoster(){
  var _sb=document.getElementById("sync-btn");if(_sb){_sb.textContent="Syncing...";_sb.disabled=true;setTimeout(function(){_sb.textContent="↺ Sync Roster";_sb.disabled=false;},2500);}
  if(!leagueId){setStatus('No league loaded - select a league first.','var(--red)');return;}
  var btn=document.getElementById('sync-btn');
  if(btn){btn.textContent='Syncing...';btn.disabled=true;}
  try{ await fetch('/api/sleeper/cache/clear',{method:'POST'}); }catch(_){}
  // Force allPlayers to re-fetch by clearing it
  allPlayers={};
  await loadLeague(leagueId, leagueName, null, leagueSeason||ACTIVE_SEASON);
  if(btn){btn.textContent='↺ Sync Roster';btn.disabled=false;}
  var active=document.querySelector('#screen-league .tab-content.active');
  if(active){
    if(active.id==='tab-roster-grade')renderRosterGrade();
    else if(active.id==='tab-history')renderHistory();
    else if(active.id==='tab-leaderboard')renderLeaderboard();
  }
}

function openResearchTab(tabId){
  switchScreen('research');
  var bar=document.querySelector('#screen-research .inner-tab-bar')||document.querySelector('#screen-research');
  var btn=bar?Array.prototype.slice.call(bar.querySelectorAll('.inner-tab')).find(function(t){return (t.getAttribute('onclick')||'').indexOf("'"+tabId+"'")>=0;}):null;
  if(btn){btn.click();}
  else{switchInnerTab(null,tabId,'screen-research');}
  closeAllDropdowns&&closeAllDropdowns();
}
function switchInnerTab(el,id,screenId){
  var screen=document.getElementById(screenId);
  if(!screen)return;
  screen.querySelectorAll(".inner-tab").forEach(function(t){t.classList.remove("active");});
  screen.querySelectorAll(".tab-content").forEach(function(t){t.classList.remove("active");});
  if(el)el.classList.add("active");
  var content=document.getElementById(id);
  if(content)content.classList.add("active");
  _revealSafety(content);
  if(screenId==='screen-league')_tabPush(id,'league');
  else if(screenId==='screen-research')_tabPush(id,'research');
}

// Safety net: if the scroll-reveal observer hasn't fired for now-visible cards
// (slow devices, throttled tabs), show them anyway shortly after a tab switch
function _revealSafety(root){
  setTimeout(function(){
    (root||document).querySelectorAll('.reveal:not(.in)').forEach(function(el){
      var r=el.getBoundingClientRect();
      if(r.top<window.innerHeight+200&&r.bottom>-200)el.classList.add('in');
    });
  },600);
}

function switchTab(el,id){
  document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active");});
  document.querySelectorAll(".tab-content").forEach(function(t){t.classList.remove("active");});
  if(el)el.classList.add("active");
  var content=document.getElementById(id);
  if(content)content.classList.add("active");
  if(id==="tab-history")renderHistory();
  if(id==="tab-leaderboard")renderLeaderboard();
  if(id==="tab-roster-grade")renderRosterGrade();
  if(id==="tab-buysell"){renderBuySell();renderWaiverTargets();}
}

function showTab(name){
  document.getElementById("analyzer").scrollIntoView({behavior:"smooth"});
  var map={analyzer:0,history:1,leaderboard:2};
  var idx=map[name];
  if(idx===undefined)return;
  var tabs=document.querySelectorAll(".tab");
  var contents=document.querySelectorAll(".tab-content");
  tabs.forEach(function(t,i){t.classList.toggle("active",i===idx);});
  contents.forEach(function(cv,i){cv.classList.toggle("active",i===idx);});
  if(name==="history")renderHistory();
  if(name==="leaderboard")renderLeaderboard();
}

function newTrade(){
  document.getElementById("result-panel").classList.remove("visible");
  scrollToEl(document.getElementById("builder-panel"));
  document.querySelectorAll("#give-players input,#get-players input").forEach(function(i){i.value="";});
  answers.fill(null);currentQ=0;
  youAnswers.fill(null);currentYQ=0;
  document.querySelectorAll(".q-step").forEach(function(s){s.classList.remove("active");});
  var q0=document.getElementById("q-0");if(q0)q0.classList.add("active");
  var yq0=document.getElementById("yq-0");if(yq0)yq0.classList.add("active");
  updatePips(0);updateYPips(0);
  document.getElementById("profile-badge").classList.remove("show");
  var ys=document.getElementById("your-section");if(ys)ys.style.display="none";
  document.getElementById("you-badge").classList.remove("show");
  document.querySelectorAll(".q-opt").forEach(function(o){o.classList.remove("sel","selected");});
  var pc=document.getElementById("pitch-card");if(pc)pc.style.display="none";
  var kl=document.getElementById("ktc-live");if(kl)kl.style.display="none";
  window._profile=null;window._selfBoost=0;lastResult=null;
}

// ─── TRADE IDEAS ──────────────────────────────────────────────────────────────
function rosterPosSummary(playerIds){
  var summary={QB:[],RB:[],WR:[],TE:[]};
  (playerIds||[]).forEach(function(pid){
    var p=allPlayers[pid];
    if(!p||!summary[p.pos])return;
    summary[p.pos].push({id:pid,name:p.name,pos:p.pos,team:p.team||"FA",age:p.age||null,exp:p.exp||0,ktc:getKtcValue(p.name,pid)});
  });
  Object.keys(summary).forEach(function(pos){
    summary[pos].sort(function(a,b){return b.ktc-a.ktc;});
  });
  return summary;
}

function posNeed(summary){
  var qbIdeal=leagueFormat.hasSuperFlex||leagueFormat.has2QB?3:2;
  var rbIdeal=Math.max(3,leagueFormat.numRBs+leagueFormat.flexCount+2);
  var wrIdeal=Math.max(4,leagueFormat.numWRs+leagueFormat.flexCount+leagueFormat.recFlexCount+2);
  var teIdeal=leagueFormat.numTEs>=2?3:2;
  var IDEAL={QB:qbIdeal,RB:rbIdeal,WR:wrIdeal,TE:teIdeal};
  return Object.keys(summary).map(function(pos){
    var players=summary[pos];
    var count=players.length;
    var total=players.reduce(function(s,p){return s+p.ktc;},0);
    var avg=count?total/count:0;
    var deficit=Math.max(0,IDEAL[pos]-count)*1500+(count&&avg<2500?2500-avg:0);
    return {pos:pos,count:count,avg:avg,total:total,deficit:deficit};
  }).sort(function(a,b){return b.deficit-a.deficit;});
}

function _ordinal(n){n=Number(n)||0;var s=["th","st","nd","rd"],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
function estimatePickSlot(ownerRosterId){
  if(!leagueRosters.length)return null;
  var total=leagueRosters.length;
  var hasRecords=leagueRosters.some(function(r){return r.settings&&((r.settings.wins||0)+(r.settings.losses||0))>0;});
  var sorted;
  if(hasRecords){
    // In-season: draft order is reverse standings (worst record picks first)
    sorted=leagueRosters.slice().sort(function(a,b){
      var wA=a.settings&&a.settings.wins||0,lA=a.settings&&a.settings.losses||0;
      var wB=b.settings&&b.settings.wins||0,lB=b.settings&&b.settings.losses||0;
      var gA=wA+lA,gB=wB+lB;
      var pA=gA?wA/gA:0.5,pB=gB?wB/gB:0.5;
      return pA!==pB?pA-pB:(lA-wA)-(lB-wB);
    });
  }else{
    // Offseason: no records yet, so PROJECT the order from roster strength -
    // the weakest roster (lowest total market value) is projected to pick first,
    // just like a real league. Uses live KTC values.
    var strength=function(r){return (r.players||[]).reduce(function(s,pid){return s+(ktcById[pid]||0);},0);};
    sorted=leagueRosters.slice().sort(function(a,b){return strength(a)-strength(b);});
  }
  var slot=sorted.findIndex(function(r){return r.roster_id===ownerRosterId;})+1;
  return slot>0?{slot:slot,total:total,projected:!hasRecords}:null;
}
// Your own roster id in the connected league (for projecting your own picks' slots).
function _myRosterId(){
  var r=(leagueRosters||[]).find(function(x){return x.owner_id===userId;});
  return r?r.roster_id:null;
}

function pickSlotLabel(slot,total){
  var t=Math.ceil(total*0.25);
  if(slot<=t)return "top-"+t+" pick projected";
  if(slot<=Math.ceil(total*0.5))return "mid-round pick projected";
  return "late-round pick projected";
}

function getPickKtcValue(season,round){
  var name=(season+" round "+round).toLowerCase();
  return ktcValues[name]||0;
}

function getMyBuildPhase(mySum){
  var all=[];
  ['QB','RB','WR','TE'].forEach(function(pos){(mySum[pos]||[]).forEach(function(p){all.push(p);});});
  var withAge=all.filter(function(p){return p.age;});
  var avgAge=withAge.length?withAge.reduce(function(s,p){return s+p.age;},0)/withAge.length:25;
  var totalKtc=all.reduce(function(s,p){return s+p.ktc;},0);
  var avgKtc=all.length?totalKtc/all.length:0;
  var leagueRank=0,totalTeams=leagueRosters.length;
  if(totalTeams){
    var sorted=leagueRosters.slice().sort(function(a,b){
      var wA=a.settings&&a.settings.wins||0,lA=a.settings&&a.settings.losses||0;
      var wB=b.settings&&b.settings.wins||0,lB=b.settings&&b.settings.losses||0;
      var gA=wA+lA,gB=wB+lB;
      return (gB?(wB/gB):0.5)-(gA?(wA/gA):0.5);
    });
    var myRosterObj2=leagueRosters.find(function(r){return r.owner_id===userId;});
    if(myRosterObj2){leagueRank=sorted.findIndex(function(r){return r.roster_id===myRosterObj2.roster_id;})+1;}
  }
  var phase=avgAge<24.5||avgKtc<2000?'rebuilding':avgAge<26.5?'building':'contending';
  return {phase:phase,avgAge:Math.round(avgAge*10)/10,avgKtc:Math.round(avgKtc),leagueRank:leagueRank,totalTeams:totalTeams};
}


// ═══ TARGET A PLAYER — you name the prize, we price it ═══════════════════════
// The Ideas tab answers "who should I trade for?". This answers the question a
// manager actually walks in with: "I want THAT guy - what does it cost me?"
// Pick a rival, pick one or more of his players, and the board comes back with
// three real packages built out of your own roster and picks.
var TGT = { rosterId: null, targets: [] };

// The acquiring side pays. Nobody sells their starter at sticker price, and a
// package of parts is worth less to the receiver than one clean piece (he has
// roster spots to fill and only so many starting slots). Both are documented
// market behaviour, not invented numbers:
//   PREMIUM  - the "trade tax" every buyer pays to pry a player loose.
//   PARTS    - each extra piece beyond the first is discounted on their side.
var TGT_PREMIUM = 1.08;
var TGT_PARTS_DISCOUNT = 0.06;   // per extra piece, capped below

// ...but a flat premium prices every manager the same, and they are not. The
// app already reads each rival - archetype, two seasons of their real trades,
// their record - into an attachment score (how hard they cling to their own
// players) and an acceptance lean. A hoarder with one trade in two years does
// not sell at the same number as someone who flips his roster every August.
// Attachment carries the move; acceptance nudges it. Bounds are deliberate:
// never below sticker (nobody gifts a starter) and never past a quarter over
// (past that you are not negotiating, you are overpaying).
function _tgtPremiumFor(rosterId){
  var base = { mult: TGT_PREMIUM, why: '', who: '' };
  try{
    var r = leagueRosters.find(function(x){ return x.roster_id === rosterId; });
    if(!r) return base;
    var prof = inferOppProfileFromHistory(r, rosterId);
    if(!prof || !prof.boosts) return base;
    var st = (typeof tradeStats !== 'undefined' && tradeStats) ? tradeStats[rosterId] : null;
    var attach = 46 + (prof.boosts.attachment || 0) + (st ? (st.tradeCount <= 1 ? 12 : st.tradeCount >= 5 ? -8 : 0) : 0);
    var mult = TGT_PREMIUM + (attach - 46) * 0.0030 - (prof.boosts.acceptance || 0) * 0.0015;
    mult = Math.max(1.02, Math.min(1.24, mult));
    return { mult: mult, why: prof.why || '', who: prof.name || '' };
  }catch(_){ return base; }
}

function _tgtVal(p){ return p.pick ? getKtcValue(p.name, null) : (ktcById[p.id] || 0); }

// what a package is WORTH TO THEM: raw value minus the friction of extra parts
function _tgtPkgWorth(pkg){
  var raw = pkg.reduce(function(s,p){ return s + _tgtVal(p); }, 0);
  var extra = Math.max(0, pkg.length - 1);
  return raw * (1 - Math.min(0.18, extra * TGT_PARTS_DISCOUNT));
}

function _tgtMyAssets(){
  var mine = leagueRosters.find(function(r){ return r.owner_id === userId; });
  if(!mine) return [];
  var excl = (window._ideaExclude || []).map(function(n){ return String(n).toLowerCase(); });
  var out = [];
  (mine.players || []).forEach(function(pid){
    var ap = allPlayers[pid]; if(!ap || !ap.name) return;
    if(excl.indexOf(ap.name.toLowerCase()) >= 0) return;      // "won't trade" list is law
    var v = ktcById[pid] || 0; if(v <= 0) return;
    out.push({ id: pid, name: ap.name, pos: ap.pos, team: ap.team, v: v });
  });
  try{
    buildPicksForRoster(mine, leaguePicks, ACTIVE_SEASON).forEach(function(pk){
      var v = getKtcValue(pk.name, null);
      if(v > 0) out.push({ id: null, pick: true, name: pk.name, pos: 'PK', team: '', v: v });
    });
  }catch(_){}
  return out.sort(function(a,b){ return b.v - a.v; });
}

// Their roster needs, so the package leans on positions they are thin at - a
// deal is likelier when the parts actually help the guy accepting it.
function _tgtTheirNeed(rosterId){
  var r = leagueRosters.find(function(x){ return x.roster_id === rosterId; });
  var have = { QB:0, RB:0, WR:0, TE:0 };
  ((r && r.players) || []).forEach(function(pid){
    var ap = allPlayers[pid]; if(!ap) return;
    if(have[ap.pos] != null && (ktcById[pid] || 0) > 2500) have[ap.pos]++;
  });
  var want = { QB: leagueFormat.hasSuperFlex ? 2 : 1, RB: 2, WR: 3, TE: 1 };
  var need = {};
  Object.keys(want).forEach(function(k){ need[k] = Math.max(0, want[k] - have[k]); });
  return need;
}

function tgtRenderPanel(){
  var host = document.getElementById('tgt-panel');
  if(!host) return;
  if(!leagueRosters.length || !userId){
    host.innerHTML = '<div class="ideas-empty">Connect a league and this turns into a shopping list: pick anyone on a rival roster and see the price.</div>';
    return;
  }
  var others = leagueRosters.filter(function(r){ return r.owner_id !== userId; });
  var opts = '<option value="">Whose player do you want?</option>' + others.map(function(r){
    return '<option value="' + r.roster_id + '"' + (TGT.rosterId === r.roster_id ? ' selected' : '') + '>' +
      String(getRosterName(r.roster_id)).replace(/</g,'&lt;') + '</option>';
  }).join('');
  var html = '<div class="tgt-row"><select class="opp-select" id="tgt-team" style="min-width:220px" onchange="tgtPickTeam(this.value)">' + opts + '</select>' +
    '<span class="tgt-hint" id="tgt-hint">Pick a manager, then tap the players you want.</span></div>' +
    '<div id="tgt-roster" class="tgt-roster"></div>' +
    '<div id="tgt-out"></div>';
  host.innerHTML = html;
  if(TGT.rosterId) tgtPickTeam(TGT.rosterId, true);
}

function tgtPickTeam(rid, keep){
  rid = parseInt(rid, 10);
  if(!keep) TGT.targets = [];
  TGT.rosterId = rid || null;
  var box = document.getElementById('tgt-roster');
  var out = document.getElementById('tgt-out');
  if(out) out.innerHTML = '';
  if(!box) return;
  if(!TGT.rosterId){ box.innerHTML = ''; return; }
  var r = leagueRosters.find(function(x){ return x.roster_id === TGT.rosterId; });
  var list = ((r && r.players) || []).map(function(pid){
    var ap = allPlayers[pid] || {};
    return { id: pid, name: ap.name || pid, pos: ap.pos || '?', team: ap.team || '', v: ktcById[pid] || 0 };
  }).filter(function(p){ return p.v > 0; }).sort(function(a,b){ return b.v - a.v; });
  if(!list.length){ box.innerHTML = '<div class="ideas-empty">No valued players on that roster yet.</div>'; return; }
  var pc = { QB:'var(--pos-qb)', RB:'var(--pos-rb)', WR:'var(--pos-wr)', TE:'var(--pos-te)' };
  box.innerHTML = list.map(function(p){
    var on = TGT.targets.indexOf(p.id) >= 0;
    return '<button class="tgt-chip' + (on ? ' on' : '') + '" onclick="tgtToggle(\'' + p.id + '\')">' +
      '<span class="tgt-pos" style="color:' + (pc[p.pos] || 'var(--muted)') + '">' + p.pos + '</span>' +
      '<span class="tgt-nm">' + String(p.name).replace(/</g,'&lt;') + '</span></button>';
  }).join('');
  tgtBuild();
}

function tgtToggle(pid){
  var i = TGT.targets.indexOf(pid);
  if(i >= 0) TGT.targets.splice(i, 1); else TGT.targets.push(pid);
  tgtPickTeam(TGT.rosterId, true);
}

function tgtClear(){ TGT.targets = []; tgtPickTeam(TGT.rosterId, true); }

// The search: every combination of up to four of your assets, scored on how
// cleanly it clears their ask. Exhaustive at this size (a roster is ~25 assets),
// so there is no "close enough" - if a package exists, it is found.
function _tgtSearch(assets, ask, need){
  var best = { cheap: null, fair: null, closer: null };
  var MAXN = 4;
  var idx = assets.slice(0, 26);
  function consider(pkg){
    var worth = _tgtPkgWorth(pkg);
    if(worth < ask * 0.98) return;                       // does not get it done
    var over = worth - ask;
    // a package that fills their holes is worth more than the raw number says
    var fit = pkg.reduce(function(s,p){ return s + ((need[p.pos] || 0) > 0 ? 1 : 0); }, 0);
    var cost = pkg.reduce(function(s,p){ return s + p.v; }, 0);   // what it costs YOU
    if(!best.cheap || cost < best.cheap.cost || (cost === best.cheap.cost && fit > best.cheap.fit))
      best.cheap = { pkg: pkg.slice(), cost: cost, worth: worth, over: over, fit: fit };
    var fairScore = Math.abs(worth - ask) - fit * 60;
    if(!best.fair || fairScore < best.fair.score)
      best.fair = { pkg: pkg.slice(), cost: cost, worth: worth, over: over, fit: fit, score: fairScore };
    if(worth >= ask * 1.12 && worth <= ask * 1.35){
      var cScore = cost - fit * 80;
      if(!best.closer || cScore < best.closer.score)
        best.closer = { pkg: pkg.slice(), cost: cost, worth: worth, over: over, fit: fit, score: cScore };
    }
  }
  (function rec(start, pkg){
    if(pkg.length){ consider(pkg); }
    if(pkg.length >= MAXN) return;
    for(var i = start; i < idx.length; i++){ pkg.push(idx[i]); rec(i + 1, pkg); pkg.pop(); }
  })(0, []);
  return best;
}


// What the deal does to YOUR starting lineup. A package that "wins on value"
// while leaving you one injury from starting nobody at receiver is not a win,
// and the tool should say so before you send it.
function _tgtRosterAfter(pkg, targets){
  try{
    var mine = leagueRosters.find(function(r){ return r.owner_id === userId; });
    if(!mine) return null;
    var gone = {}; pkg.forEach(function(p){ if(p.id) gone[p.id] = 1; });
    var startable = { QB:0, RB:0, WR:0, TE:0 }, before = { QB:0, RB:0, WR:0, TE:0 };
    // "startable" = the tier a real lineup leans on, not every warm body
    var BAR = 2200;
    (mine.players || []).forEach(function(pid){
      var ap = allPlayers[pid]; if(!ap || before[ap.pos] == null) return;
      if((ktcById[pid] || 0) < BAR) return;
      before[ap.pos]++;
      if(!gone[pid]) startable[ap.pos]++;
    });
    (targets || []).forEach(function(pid){
      var ap = allPlayers[pid]; if(!ap || startable[ap.pos] == null) return;
      if((ktcById[pid] || 0) >= BAR) startable[ap.pos]++;
    });
    var req = _lxReq();          // one definition of "a starter", flex included
    var holes = [], thin = [];
    ['QB','RB','WR','TE'].forEach(function(ps){
      if(startable[ps] < req[ps]) holes.push({ pos: ps, have: startable[ps], need: req[ps] });
      else if(startable[ps] === req[ps] && before[ps] > req[ps]) thin.push(ps);
    });
    return { holes: holes, thin: thin, after: startable };
  }catch(_){ return null; }
}
function tgtBuild(){
  var out = document.getElementById('tgt-out');
  var hint = document.getElementById('tgt-hint');
  if(!out) return;
  if(!TGT.targets.length){
    out.innerHTML = '';
    if(hint) hint.textContent = 'Pick a manager, then tap the players you want.';
    return;
  }
  var got = TGT.targets.map(function(pid){
    var ap = allPlayers[pid] || {};
    return { id: pid, name: ap.name || pid, pos: ap.pos || '?', v: ktcById[pid] || 0 };
  });
  var targetVal = got.reduce(function(s,p){ return s + p.v; }, 0);
  var prem = _tgtPremiumFor(TGT.rosterId);
  var ask = targetVal * prem.mult;
  if(hint) hint.innerHTML = 'Going after <b>' + got.map(function(p){ return String(p.name).replace(/</g,'&lt;'); }).join(' + ') +
    '</b> &middot; <span onclick="tgtClear()" style="color:var(--accent-bright);cursor:pointer">clear</span>';

  var assets = _tgtMyAssets();
  if(!assets.length){ out.innerHTML = '<div class="ideas-empty">No tradeable assets on your roster yet.</div>'; return; }
  var need = _tgtTheirNeed(TGT.rosterId);
  var best = _tgtSearch(assets, ask, need);

  var cards = [];
  var seen = {};
  [['cheap','The cheapest that works','What they would probably take, and not a dollar more.'],
   ['fair','The even one','Both sides look at this and see a fair deal.'],
   ['closer','The closer','Clearly good for them. Use it when you actually want the guy.']]
  .forEach(function(t){
    var b = best[t[0]]; if(!b) return;
    var key = b.pkg.map(function(p){ return p.id || p.name; }).sort().join('|');
    if(seen[key]) return; seen[key] = 1;
    cards.push({ kind: t[0], title: t[1], sub: t[2], b: b });
  });

  if(!cards.length){
    out.innerHTML = '<div class="ideas-empty">Your roster does not have enough to get there - even everything tradeable falls short of what ' +
      String(getRosterName(TGT.rosterId)).replace(/</g,'&lt;') + ' would want for that. Aim smaller, or add a piece to your roster first.</div>';
    return;
  }
  var pc = { QB:'var(--pos-qb)', RB:'var(--pos-rb)', WR:'var(--pos-wr)', TE:'var(--pos-te)', PK:'var(--accent-bright)' };
  var whoLine = '';
  if(prem.mult >= TGT_PREMIUM + 0.03)
    whoLine = '<div class="tgt-who tgt-who-hard">' + String(getRosterName(TGT.rosterId)).replace(/</g,'&lt;') + ' holds on tight' +
      (prem.why ? ' - ' + String(prem.why).replace(/</g,'&lt;') : '') + '. Expect to pay over the odds.</div>';
  else if(prem.mult <= TGT_PREMIUM - 0.03)
    whoLine = '<div class="tgt-who tgt-who-soft">' + String(getRosterName(TGT.rosterId)).replace(/</g,'&lt;') + ' deals often' +
      (prem.why ? ' - ' + String(prem.why).replace(/</g,'&lt;') : '') + '. You will not need to overpay here.</div>';
  out.innerHTML = whoLine + '<div class="tgt-ask">You are asking for <b>' + (targetVal>=1000?(targetVal/1000).toFixed(1)+'k':targetVal) + '</b> of value. Here is what it takes.</div>' +
    cards.map(function(c, i){
      var b = c.b;
      var pieces = b.pkg.map(function(p){
        return '<span class="tgt-piece"><span class="tgt-pos" style="color:' + (pc[p.pos] || 'var(--muted)') + '">' + p.pos + '</span>' +
          String(p.name).replace(/</g,'&lt;') + '</span>';
      }).join('');
      var edge = b.worth - ask;
      var read = edge < ask * 0.03 ? 'Right at their line - expect a counter.'
        : edge < ask * 0.12 ? 'A little over their line. This is the one that usually gets a yes.'
        : 'Comfortably over. Hard for them to say no.';
      var fitTxt = b.fit ? ' It also fills a hole on their roster, which matters more than the numbers.' : '';
      var health = _tgtRosterAfter(b.pkg, TGT.targets);
      var warn = '';
      if(health && health.holes.length){
        warn = '<div class="tgt-warn">After this you would start ' +
          health.holes.map(function(h){ return h.have + ' ' + h.pos + (h.have === 1 ? '' : 's') + ' where your lineup needs ' + h.need; }).join(' and ') +
          '. The value works; your Sunday might not.</div>';
      } else if(health && health.thin.length){
        warn = '<div class="tgt-thin">Leaves you exactly at the limit at ' + health.thin.join(' and ') + ' - no cover for a bye or an injury.</div>';
      }
      return '<div class="tgt-card">' +
        '<div class="tgt-card-h"><span class="tgt-kind">' + c.title + '</span>' +
          '<button class="btn-sm" onclick="tgtLoad(' + i + ')">Open in the analyzer &rarr;</button></div>' +
        '<div class="tgt-sub">' + c.sub + '</div>' +
        '<div class="tgt-pieces">' + pieces + '</div>' +
        '<div class="tgt-read">' + read + fitTxt + '</div>' + warn +
      '</div>';
    }).join('');
  window._tgtCards = cards;
}

// Hand the package to the real analyzer, which owns the verdict.
function tgtLoad(i){
  var c = (window._tgtCards || [])[i]; if(!c) return;
  try{
    switchScreen('analyze'); showAnalyzeTab('analyzer');
    setTimeout(function(){
      try{
        ['give-players','get-players'].forEach(function(cid){
          var c=document.getElementById(cid); if(!c) return;
          c.querySelectorAll('input').forEach(function(i,ix){ if(ix){ var r=i.closest('.player-row'); if(r) r.remove(); } else { i.value=''; delete i.dataset.playerId; } });
        });
        c.b.pkg.forEach(function(p, n){ _tgtFill('give', n, p.name, p.id, p.pos); });
        TGT.targets.forEach(function(pid, n){
          var ap = allPlayers[pid] || {};
          _tgtFill('get', n, ap.name || pid, pid, ap.pos || '');
        });
        updateKtcLive();
        var an = document.getElementById('analyzer');
        if(an && an.scrollIntoView) an.scrollIntoView({ behavior:'smooth', block:'start' });
      }catch(_){}
    }, 120);
  }catch(_){}
}
function _tgtFill(side, n, name, pid, pos){
  var cid = side + '-players';
  var host = document.getElementById(cid); if(!host) return;
  var rows = host.querySelectorAll('input');
  while(rows.length <= n){ addRow(cid, side); rows = host.querySelectorAll('input'); }
  var inp = rows[n]; if(!inp) return;
  inp.value = name;
  if(pid) inp.dataset.playerId = pid;
  if(pos) inp.dataset.pos = pos;
  // the row's own pos tag + avatar come from the app's normal selection path
  try{ var tag = inp.closest('.player-row').querySelector('.pos-tag');
       if(tag && pos){ tag.textContent = pos; tag.style.visibility = 'visible'; } }catch(_){}
}

/* ============================================================================
   LEAGUE X-RAY
   Reads every roster in the league at once and answers the three things that
   actually get asked in a group chat:
     1. who is contending, who is tearing it down, and what does each one want
     2. "they want my guy - what do I ask for?"
     3. "they sent me this and it feels like a lot - what do I send back?"
   Everything here leans on values, ages and trade history already loaded for
   the league, so it costs one button press and no network calls.
   ========================================================================== */

var LX = { teams: null, deals: null, open: {}, built: false };

// A player only counts as a real starter above this value. Same bar the trade
// builder uses for roster health, kept identical on purpose so the two tools
// never disagree about whether you have a hole.
var LX_BAR = 2200;
// Dynasty "prime" runs about 24-27, so 26 is the pivot where a roster stops
// reading as building and starts reading as win-now. Span is the spread that
// turns an age gap into a full -1..1 signal.
var LX_AGE_PIVOT = 26.0, LX_AGE_SPAN = 2.5;

// How many startable players this league actually makes you field. Flex slots
// were missing here, which quietly mislabelled every flex starter as a spare
// part: in a 1QB/2RB/3WR/1TE/2FLEX league the real answer is nine starters and
// this used to return seven, so your RB3 and WR4 were offered as free currency.
// Flex has no position of its own, so it is spread over the spots that fill it:
// the receiver-only flex goes to WR, and the open flex alternates WR then RB,
// which is how flex is started in PPR far more often than not.
function _lxReq(){
  var lf = (typeof leagueFormat !== 'undefined' && leagueFormat) ? leagueFormat : {};
  var req = { QB: lf.hasSuperFlex ? 2 : (lf.numQBs || 1), RB: lf.numRBs || 2, WR: lf.numWRs || 2, TE: lf.numTEs || 1 };
  req.WR += (lf.recFlexCount || 0);
  var flex = lf.flexCount || 0;
  for(var i = 0; i < flex; i++){ if(i % 2 === 0) req.WR++; else req.RB++; }
  return req;
}

// Age of the VALUE on a roster, not of the roster. A 22-year-old last man on
// the bench should not make a win-now team read as young.
function _lxCoreAge(r){
  var tot = 0, sum = 0;
  ((r && r.players) || []).forEach(function(pid){
    var ap = allPlayers[pid]; if(!ap || !ap.age) return;
    var v = ktcById[pid] || 0; if(v < 1000) return;
    tot += v; sum += v * ap.age;
  });
  return tot > 0 ? (sum / tot) : null;
}

function _lxInventory(r){
  var inv = { QB: [], RB: [], WR: [], TE: [] };
  ((r && r.players) || []).forEach(function(pid){
    var ap = allPlayers[pid]; if(!ap || !inv[ap.pos]) return;
    var v = ktcById[pid] || 0; if(v <= 0) return;
    inv[ap.pos].push({ id: pid, name: ap.name, pos: ap.pos, team: ap.team, age: ap.age || null, v: v });
  });
  Object.keys(inv).forEach(function(k){ inv[k].sort(function(a,b){ return b.v - a.v; }); });
  return inv;
}

// Strength = what the required starters are worth. Bench depth is nice but it
// is not what wins the week, and counting it makes hoarders look like champs.
function _lxStrength(inv, req){
  var s = 0;
  Object.keys(req).forEach(function(ps){
    (inv[ps] || []).slice(0, req[ps]).forEach(function(p){ s += p.v; });
  });
  return s;
}

function _lxPickBal(rid){
  var s = (typeof tradeStats !== 'undefined' && tradeStats) ? tradeStats[rid] : null;
  if(!s) return 0;
  return (s.picksReceived || 0) - (s.picksGiven || 0);
}

function _lxClamp(x){ return Math.max(-1, Math.min(1, x)); }

// Holes, thin spots and genuine surplus, measured against what the league
// actually starts. Surplus is the trade currency: anything above the required
// starters plus one body of insurance is a player you can afford to move.
function _lxShape(inv, req){
  var holes = [], thin = [], surplus = [];
  Object.keys(req).forEach(function(ps){
    var list = (inv[ps] || []).filter(function(p){ return p.v >= LX_BAR; });
    var need = req[ps];
    if(list.length < need) holes.push({ pos: ps, have: list.length, need: need });
    else if(list.length === need) thin.push(ps);
    // keep starters + one insurance body, everything past that is movable
    list.slice(need + 1).forEach(function(p){ surplus.push(p); });
  });
  surplus.sort(function(a,b){ return b.v - a.v; });
  return { holes: holes, thin: thin, surplus: surplus };
}

// What a team is shopping for, once you know where it sits in its window.
function _lxAppetite(win){
  // the bounds and the label must say the same thing: they used to disagree, so
  // a 25-year-old collected the rebuild bonus on a card promising "24 and under"
  if(win === 'contend') return { lo: 25, hi: 30, label: 'proven producers, 25 to 30', wantsPicks: false, sellsPicks: true,
    gives: 'picks and unproven youth', wants: 'anyone who starts for them this year' };
  if(win === 'rebuild') return { lo: 21, hi: 24, label: 'players 24 and under, plus picks', wantsPicks: true, sellsPicks: false,
    gives: 'veterans on the wrong side of the curve', wants: 'young pieces and draft capital' };
  return { lo: 24, hi: 27, label: 'prime-age players, 24 to 27', wantsPicks: false, sellsPicks: false,
    gives: 'whoever is blocked on their depth chart', wants: 'a clean upgrade at a starting spot' };
}

function _lxTeam(r, medStrength){
  var rid = r.roster_id;
  var inv = _lxInventory(r);
  var req = _lxReq();
  var strength = _lxStrength(inv, req);
  var coreAge = _lxCoreAge(r);
  var rec = rosterRecord(rid);
  var pickBal = _lxPickBal(rid);

  // Four independent reads on the same question, each scaled to -1..1.
  var recTerm = (rec.games >= 3 && rec.pct != null) ? _lxClamp((rec.pct - 0.5) * 2) : null;
  var strTerm = medStrength > 0 ? _lxClamp((strength - medStrength) / medStrength) : 0;
  var ageTerm = coreAge != null ? _lxClamp((coreAge - LX_AGE_PIVOT) / LX_AGE_SPAN) : 0;
  var pickTerm = _lxClamp(-pickBal / 3);

  // Record is the most honest signal when it exists, so it carries the most
  // weight. With no games played its share is spread over the other three.
  var w = { rec: 0.30, str: 0.30, age: 0.22, pick: 0.18 };
  var score, parts = [];
  if(recTerm == null){
    var k = 1 / (w.str + w.age + w.pick);
    score = (strTerm * w.str + ageTerm * w.age + pickTerm * w.pick) * k;
  } else {
    score = recTerm * w.rec + strTerm * w.str + ageTerm * w.age + pickTerm * w.pick;
  }
  var win = score >= 0.22 ? 'contend' : (score <= -0.22 ? 'rebuild' : 'fringe');

  if(recTerm != null) parts.push(rec.wins + '-' + rec.losses + (rec.ties ? '-' + rec.ties : '') + ' record');
  parts.push(strTerm >= 0.12 ? 'a top-heavy starting lineup' : (strTerm <= -0.12 ? 'a starting lineup below league average' : 'a middle-of-the-pack lineup'));
  if(coreAge != null) parts.push('core age ' + coreAge.toFixed(1));
  if(pickBal >= 2) parts.push('has been stockpiling picks');
  else if(pickBal <= -2) parts.push('has been spending picks');

  var shape = _lxShape(inv, req);
  var prof = null;
  try{ prof = inferOppProfileFromHistory(r, rid); }catch(_){}
  var prem = 1.08;
  try{ prem = _tgtPremiumFor(rid).mult; }catch(_){}

  return {
    rid: rid, name: getRosterName(rid), isMe: r.owner_id === userId, raw: r,
    inv: inv, req: req, strength: strength, coreAge: coreAge, rec: rec,
    pickBal: pickBal, score: score, win: win, why: parts.join(', '),
    holes: shape.holes, thin: shape.thin, surplus: shape.surplus, noGames: recTerm == null,
    appetite: _lxAppetite(win), prof: prof, prem: prem
  };
}

function lxBuildTeams(){
  if(!leagueRosters.length) return [];
  var req = _lxReq();
  // two passes: strength is only meaningful against the rest of the league
  var raw = leagueRosters.map(function(r){ return _lxStrength(_lxInventory(r), req); }).sort(function(a,b){ return a - b; });
  var med = raw.length ? raw[Math.floor(raw.length / 2)] : 0;
  return leagueRosters.map(function(r){ return _lxTeam(r, med); });
}

/* --- the deal engine ------------------------------------------------------
   A trade happens when BOTH managers think they came out ahead, not when a
   spreadsheet says the values match. So every asset is re-priced through the
   eyes of the team receiving it: a hole at the position is worth a premium, a
   position they are already stacked at is worth a discount, and age either
   fits their window or it does not. On top of that each manager overrates
   their own guys by exactly the amount the personality model says they do.
   A deal is only reported when both sides clear their own bar.
--------------------------------------------------------------------------- */

// How much team t values an incoming asset above or below its market number.
// What an asset is worth to a team relative to its market price. The question
// that decides it is whether the player would crack their starting lineup:
// a body who rides the bench is worth less than market to ANYONE, which is why
// a positional shortage must not make a team's own backup expensive to trade.
// Only once a player actually starts do holes, depth and age come into play.
function _lxFit(t, a){
  // Memoised per team for the life of one report. What an asset is worth to a
  // team cannot change while the board is being built, and the search asks the
  // same question hundreds of thousands of times: 382,800 calls on a 12-team
  // league, each rebuilding a filtered array, which cost seconds of wall clock.
  var fc = t._fit || (t._fit = {});
  var ck = a.id || a.name;
  if(fc[ck] !== undefined) return fc[ck];
  if(a.pick) return (fc[ck] = 1 + (t.appetite.wantsPicks ? 0.12 : (t.appetite.sellsPicks ? -0.10 : 0)));
  var m = 1;
  // Peers are counted the same way holes are (above the starter bar), because
  // measuring the two over different populations paid a hole premium to a
  // player who does not actually fix the hole: a 2,150 QB beating a 2,100
  // incumbent still leaves a superflex team short.
  var peers = (t.inv[a.pos] || []).filter(function(p){ return p.id !== a.id && p.v >= LX_BAR; });
  var need = t.req[a.pos] || 1;
  var incumbent = peers.length >= need ? peers[need - 1].v : 0;   // worst starter they would bench
  var stacked = peers.length > need + 1;
  if(a.v < LX_BAR || a.v <= incumbent){
    m -= 0.12;                                                    // depth piece, not a starter
    if(stacked) m -= 0.06;                                        // and they are already deep there
  } else {
    // Reaching here means the player would crack their lineup, so the old
    // discount for a stacked position was pointed the wrong way: it marked
    // down precisely the upgrade a deep team would pay up for.
    var hole = t.holes.some(function(h){ return h.pos === a.pos; });
    var thin = t.thin.indexOf(a.pos) >= 0;
    m += hole ? 0.15 : (thin ? 0.06 : 0.02);
  }
  if(a.age){
    if(a.age >= t.appetite.lo && a.age <= t.appetite.hi) m += 0.07;
    else if(a.age < t.appetite.lo - 3 || a.age > t.appetite.hi + 3) m -= 0.07;
  }
  return (fc[ck] = m);
}

function _lxWorthTo(t, pkg){
  return pkg.reduce(function(s, a){ return s + a.v * _lxFit(t, a); }, 0);
}
// What it costs a manager to give something up. The same fit lens applies to
// the giver: your fourth receiver is cheap to lose when you are short at back,
// and the guy plugging your only hole is expensive. Without this the two sides
// are priced on different scales and no trade can ever clear - which is
// exactly what happened the first time this ran. Friction on top is the
// manager's attachment to their own roster, at half the negotiating premium:
// prying a player loose in a targeted ask costs more than a mutual swap.
function _lxCostTo(t, pkg){
  return pkg.reduce(function(s, a){ return s + a.v * _lxFit(t, a); }, 0) * (1 + (t.prem - 1) * 0.5);
}

// What a team can realistically put on the table. Strict surplus (two spare
// starters at a position) is too rare to build a board on - plenty of real
// rosters have none, and requiring it left every team with nothing to offer.
// The honest currency is anyone who is not a required starter, plus draft
// capital, which in dynasty is what most deals actually move.
function _lxMovable(t){
  var out = [];
  Object.keys(t.req).forEach(function(ps){
    (t.inv[ps] || []).slice(t.req[ps]).forEach(function(p){ if(p.v > 0) out.push(p); });
  });
  // a rebuilder will listen on any aging starter, not just the bench
  if(t.win === 'rebuild'){
    Object.keys(t.req).forEach(function(ps){
      (t.inv[ps] || []).slice(0, t.req[ps]).forEach(function(p){
        if(p.age && p.age >= 28 && out.indexOf(p) < 0) out.push(p);
      });
    });
  }
  try{
    buildPicksForRoster(t.raw, leaguePicks, ACTIVE_SEASON).forEach(function(pk){
      var v = getKtcValue(pk.name, null);
      if(v > 0) out.push({ id: 'pk:' + t.rid + ':' + pk.name, pick: true, name: pk.name, pos: 'PK', team: '', age: null, v: v });
    });
  }catch(_){}
  out.sort(function(a, b){ return b.v - a.v; });
  return out.slice(0, 10);
}

// Does this deal drop a side below the starters its league requires? A team
// tearing it down will happily sell an aging starter, so this is not a reason
// to hide the deal - but it IS a reason to say so out loud instead of quietly
// recommending a lineup the manager cannot fill.
function _lxLeavesShort(t, out, incoming){
  var gone = {}; out.forEach(function(p){ if(p.id) gone[p.id] = 1; });
  var short = [];
  Object.keys(t.req).forEach(function(ps){
    var need = t.req[ps];
    var before = (t.inv[ps] || []).filter(function(p){ return p.v >= LX_BAR; }).length;
    var after = (t.inv[ps] || []).filter(function(p){ return !gone[p.id] && p.v >= LX_BAR; }).length
      + incoming.filter(function(p){ return !p.pick && p.pos === ps && p.v >= LX_BAR; }).length;
    // Flag it when the deal takes them below the line OR digs an existing hole
    // deeper. "Not the cause" is not the same as "not worse", and skipping the
    // already-short case stayed quiet exactly where the roster was most fragile.
    if(after < need && after < before) short.push(ps);
  });
  return short;
}

function _lxPairDeals(A, B){
  var best = null;
  // cached per team: this used to be rebuilt once per PAIR, so a 12-team league
  // recomputed every roster's movable list (and re-priced its picks) 132 times
  var aList = A._mov || (A._mov = _lxMovable(A));
  var bList = B._mov || (B._mov = _lxMovable(B));
  if(!aList.length || !bList.length) return [];

  function tryDeal(give, get){
    // give = leaves A, get = leaves B
    var aGain = _lxWorthTo(A, get) - _lxCostTo(A, give);
    var bGain = _lxWorthTo(B, give) - _lxCostTo(B, get);
    // a floor, not just "above zero": clearing an 8,000-value package by three
    // points is noise, and the board tells the reader both sides come out ahead
    var tot = 0;
    for(var fi = 0; fi < give.length; fi++) tot += give[fi].v;
    for(var gi = 0; gi < get.length; gi++) tot += get[gi].v;
    var floor = Math.max(1, tot) * 0.015;
    if(aGain <= floor || bGain <= floor) return;
    // both sides ahead: the tighter the two gains, the likelier it gets signed
    var raw = Math.max(1, give.reduce(function(s,p){ return s + p.v; }, 0));
    var fair = Math.min(aGain, bGain) / raw;
    var lopsided = Math.abs(aGain - bGain) / raw;
    var score = fair - lopsided * 0.5;
    // a deal that fixes an actual hole on either side is the kind that gets
    // sent, not the kind that just balances on a calculator
    var fixes = 0;
    get.forEach(function(p){ if(A.holes.some(function(h){ return h.pos === p.pos; })) fixes++; });
    give.forEach(function(p){ if(B.holes.some(function(h){ return h.pos === p.pos; })) fixes++; });
    score += fixes * 0.05;
    // applied to BOTH sides: which team is A and which is B is just roster order
    try{
      if(A.prof && A.prof.name === profiles.star_hoarder.name) score -= 0.04;
      if(B.prof && B.prof.name === profiles.star_hoarder.name) score -= 0.04;
    }catch(_){}
    // only the leader is kept. Collecting every survivor and sorting at the end
    // allocated a large array per pair and the churn showed up as GC jitter.
    if(!best || score > best.score)
      best = { a: A, b: B, give: give.slice(), get: get.slice(), aGain: aGain, bGain: bGain, fixes: fixes, score: score };
  }

  for(var i = 0; i < aList.length; i++){
    for(var j = 0; j < bList.length; j++){
      tryDeal([aList[i]], [bList[j]]);
      for(var k = j + 1; k < bList.length; k++) tryDeal([aList[i]], [bList[j], bList[k]]);
      for(var m = i + 1; m < aList.length; m++) tryDeal([aList[i], aList[m]], [bList[j]]);
    }
  }
  // one headline deal per pair keeps the board readable. The lineup check only
  // runs on that survivor: doing it inside tryDeal ran it across every one of
  // the tens of thousands of candidates and cost seconds of wall clock.
  if(!best) return [];
  best.aShort = _lxLeavesShort(best.a, best.give, best.get);
  best.bShort = _lxLeavesShort(best.b, best.get, best.give);
  return [best];
}

function lxBuildDeals(teams){
  var out = [];
  for(var i = 0; i < teams.length; i++)
    for(var j = i + 1; j < teams.length; j++)
      out = out.concat(_lxPairDeals(teams[i], teams[j]));
  out.sort(function(a, b){
    var am = (a.a.isMe || a.b.isMe) ? 1 : 0, bm = (b.a.isMe || b.b.isMe) ? 1 : 0;
    if(am !== bm) return bm - am;           // deals you can actually make come first
    return b.score - a.score;
  });
  return out;
}

/* --- rendering ---------------------------------------------------------- */

// Escapes for ANY position, attributes included. Team names come from Sleeper
// and are whatever a manager typed. Only escaping "<" happens to be enough in a
// text node, but it makes the helper a trap: the first time someone drops one
// of these into a title= or an onclick, a team named with a stray quote turns
// into a live hole. Ampersand must go first or the other entities get mangled.
function _lxEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _lxNm(p){ return _lxEsc(p.name) + (p.pos && p.pos !== 'PK' ? ' <span class="lx-pos lx-' + p.pos + '">' + p.pos + '</span>' : ''); }
var LX_WIN = { contend: ['Contending', 'lx-contend'], fringe: ['On the fence', 'lx-fringe'], rebuild: ['Rebuilding', 'lx-rebuild'] };

function lxRun(){
  var host = document.getElementById('lx-out');
  if(!host) return;
  if(leagueRosters.length < 2){
    host.innerHTML = '<div class="empty-state">' + (leagueRosters.length
      ? 'This league only has your roster loaded, so there is nobody to compare you against or trade with.'
      : 'Connect a league first and this reads every roster in it.') + '</div>';
    return;
  }
  host.innerHTML = '<div class="empty-state">Reading every roster...</div>';
  setTimeout(function(){
    try{
      LX.teams = lxBuildTeams();
      LX.deals = lxBuildDeals(LX.teams);
      LX.built = true;
      LX.lid = leagueId; LX.mode = (typeof leagueMode !== 'undefined' ? leagueMode : '');
      lxRender();
    }catch(e){
      host.innerHTML = '<div class="empty-state">Could not build the report: ' + _lxEsc(e && e.message) + '</div>';
    }
  }, 30);
}

function lxToggle(rid){ LX.open[rid] = !LX.open[rid]; lxRender(); }

function lxRender(){
  var host = document.getElementById('lx-out');
  if(!host || !LX.built) return;
  var teams = LX.teams.slice().sort(function(a, b){ return b.score - a.score; });
  var h = '';

  // --- who is who
  h += '<div class="lx-sec">Where every team actually sits</div>';
  h += '<div class="lx-grid">';
  teams.forEach(function(t){
    var wl = LX_WIN[t.win];
    var open = !!LX.open[t.rid];
    h += '<div class="lx-card' + (t.isMe ? ' lx-me' : '') + '">';
    h += '<div class="lx-head" onclick="lxToggle(' + t.rid + ')">';
    h += '<div class="lx-nm">' + _lxEsc(t.name) + (t.isMe ? ' <span class="lx-you">YOU</span>' : '') + '</div>';
    h += '<span class="lx-badge ' + wl[1] + '">' + wl[0] + '</span></div>';
    h += '<div class="lx-why">' + _lxEsc(t.why) + (t.noGames ? ' <i>(no games played yet, so this reads the roster, not results)</i>' : '') + '</div>';

    var needTxt = t.holes.length
      ? t.holes.map(function(x){ return x.pos + ' (' + x.have + ' of ' + x.need + ')'; }).join(', ')
      : (t.thin.length ? 'nothing urgent, thin at ' + t.thin.join(' and ') : 'no holes to fill');
    h += '<div class="lx-line"><b>Needs</b> ' + _lxEsc(needTxt) + '</div>';
    h += '<div class="lx-line"><b>Shopping for</b> ' + _lxEsc(t.appetite.label) + '</div>';
    h += '<div class="lx-line"><b>Picks</b> ' + (t.appetite.wantsPicks ? 'wants them, will sell you a veteran to get them'
      : (t.appetite.sellsPicks ? 'will trade them away for help right now' : 'no strong lean either way')) + '</div>';

    if(open){
      if(t.surplus.length)
        h += '<div class="lx-line"><b>Can afford to move</b> ' + t.surplus.slice(0, 4).map(_lxNm).join(', ') + '</div>';
      if(t.prof)
        h += '<div class="lx-line"><b>' + _lxEsc(t.prof.name) + '</b> ' + _lxEsc(t.prof.why || t.prof.descR || t.prof.desc || '') + '</div>';
      var _pt = t.prem >= 1.15 ? 'They hold their players tightly, so expect to overpay to pry anyone loose.'
        : (t.prem <= 1.05 ? 'They deal readily, so a fair offer has a real chance.'
        : 'Expect to pay a modest premium over market to get a deal done.');
      h += '<div class="lx-line lx-dim">' + _pt + '</div>';
    }
    h += '<div class="lx-more" onclick="lxToggle(' + t.rid + ')">' + (open ? 'Less' : 'More') + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // --- the trade board
  var mine = LX.deals.filter(function(d){ return d.a.isMe || d.b.isMe; });
  var rest = LX.deals.filter(function(d){ return !d.a.isMe && !d.b.isMe; });

  function dealRow(d){
    // always show it from the reader's side when they are in it
    var them = d.b.isMe ? d.a : d.b;
    var iGive = d.b.isMe ? d.get : d.give, iGet = d.b.isMe ? d.give : d.get;
    var involved = d.a.isMe || d.b.isMe;
    var why = [];
    if(d.fixes) why.push('fills a real hole');
    if(them.appetite.wantsPicks && iGive.some(function(p){ return p.pick; })) why.push('they are collecting picks');
    if(them.win === 'contend') why.push('they are pushing for this year');
    else if(them.win === 'rebuild') why.push('they are tearing it down');
    return '<div class="lx-deal' + (involved ? ' lx-deal-me' : '') + '">'
      + '<div class="lx-deal-t">' + (involved ? 'You' : _lxEsc(d.a.name)) + ' <span class="lx-arrow">&harr;</span> ' + _lxEsc(involved ? them.name : d.b.name) + '</div>'
      + '<div class="lx-deal-b"><span class="lx-out">' + (involved ? iGive : d.give).map(_lxNm).join(' + ') + '</span>'
      + '<span class="lx-arrow">&rarr;</span>'
      + '<span class="lx-in">' + (involved ? iGet : d.get).map(_lxNm).join(' + ') + '</span></div>'
      + (why.length ? '<div class="lx-deal-w">' + _lxEsc(why.join(', ')) + '</div>' : '')
      + (function(){
          var w = [];
          if(d.aShort && d.aShort.length) w.push((d.a.isMe ? 'you' : d.a.name) + ' would be left short at ' + d.aShort.join(' and '));
          if(d.bShort && d.bShort.length) w.push((d.b.isMe ? 'you' : d.b.name) + ' would be left short at ' + d.bShort.join(' and '));
          return w.length ? '<div class="tgt-warn">' + _lxEsc(w.join('; ')) + '</div>' : '';
        })()
      + '</div>';
  }

  h += '<div class="lx-sec">Trades that make sense for you</div>';
  if(mine.length > 1) h += '<div class="lx-none" style="padding:0 2px 8px">These are alternatives, not a plan. Several of them move the same player, so you can only do one of those.</div>';
  h += mine.length ? mine.slice(0, 8).map(dealRow).join('')
    : '<div class="lx-none">Nothing clean right now. Your roster shape does not line up with what anyone is short of.</div>';

  h += '<div class="lx-sec">Deals brewing elsewhere in the league</div>';
  h += rest.length ? rest.slice(0, 8).map(dealRow).join('')
    : '<div class="lx-none">No obvious matches between the other teams.</div>';
  h += '<div class="lx-foot">Every deal above clears by a real margin for both sides, counting what each manager needs, the ages they are shopping for and how much they overrate their own players. These are conversation starters priced off dynasty values, not guarantees anyone says yes.</div>';

  host.innerHTML = h;
}

/* ============================================================================
   THE OFFER DESK
   Two questions, one panel. Pick the manager, tick what they want from you,
   and if they already named their price tick that too.
     - nothing on their side  -> what should I be asking for?
     - something on their side -> is this fair, and what do I counter with?
   ========================================================================== */

var OFR = { rid: null, want: [], give: [] };

// What THEY will pay for YOUR player. This is the opposite question to
// _tgtPremiumFor, which measures how tightly a manager holds their own roster.
// Reusing that number here priced the league's most eager trader as the one
// who would pay you least, which is backwards: what matters when you are the
// one being asked is how readily they close deals and how badly they need help
// this season.
// ONE builder for your side of the desk. This existed twice, and when an index
// was added to the pick ids in one copy and not the other, the chips you clicked
// stopped matching the pool they were resolved against: your own picks silently
// vanished from the ask. Two functions that must agree is a bug waiting to happen,
// so there is now only one. The index keeps two picks of the same name apart.
function _ofrMyAssets(){
  return _tgtMyAssets().map(function(a, i){
    return { id: a.id || ('pk:' + i + ':' + a.name), name: a.name, pos: a.pos, v: a.v, pick: !!a.pick };
  });
}

function _ofrAskPremium(rosterId){
  var base = { mult: 1.08, why: '', who: '' };
  try{
    var r = leagueRosters.find(function(x){ return x.roster_id === rosterId; });
    if(!r) return base;
    var prof = inferOppProfileFromHistory(r, rosterId);
    if(!prof || !prof.boosts) return base;
    var mult = 1.08 + (prof.boosts.acceptance || 0) * 0.0018 + (prof.boosts.winNow || 0) * 0.0015;
    mult = Math.max(1.02, Math.min(1.24, mult));
    return { mult: mult, why: prof.why || '', who: prof.name || '' };
  }catch(_){ return base; }
}

function ofrRender(){
  var host = document.getElementById('ofr-panel');
  if(!host) return;
  if(!leagueRosters.length || !userId){
    host.innerHTML = '<div class="ideas-empty">Connect a league and this turns into your negotiating desk.</div>';
    return;
  }
  var others = leagueRosters.filter(function(r){ return r.owner_id !== userId; });
  var opts = '<option value="">Who is asking?</option>' + others.map(function(r){
    return '<option value="' + r.roster_id + '"' + (OFR.rid === r.roster_id ? ' selected' : '') + '>' + _lxEsc(getRosterName(r.roster_id)) + '</option>';
  }).join('');
  host.innerHTML = '<div class="tgt-row"><select class="opp-select" id="ofr-team" style="min-width:220px" onchange="ofrPickTeam(this.value)">' + opts + '</select>'
    + '<span class="tgt-hint" id="ofr-hint">Pick the manager who messaged you.</span></div>'
    + '<div id="ofr-body"></div><div id="ofr-out"></div>';
  if(OFR.rid) ofrPickTeam(OFR.rid, true);
}

function _ofrList(players, side){
  var pc = { QB:'var(--pos-qb)', RB:'var(--pos-rb)', WR:'var(--pos-wr)', TE:'var(--pos-te)' };
  return players.map(function(p){
    var on = OFR[side].indexOf(p.id) >= 0;
    return '<button class="tgt-chip' + (on ? ' on' : '') + '" onclick="ofrToggle(\'' + side + '\',\'' + p.id + '\')">'
      + '<span class="tgt-pos" style="color:' + (pc[p.pos] || 'var(--muted)') + '">' + (p.pos || 'PK') + '</span>'
      + '<span class="tgt-nm">' + _lxEsc(p.name) + '</span></button>';
  }).join('');
}

function ofrPickTeam(rid, keep){
  rid = parseInt(rid, 10);
  if(!keep){ OFR.want = []; OFR.give = []; }
  OFR.rid = rid || null;
  var body = document.getElementById('ofr-body'), out = document.getElementById('ofr-out');
  if(out) out.innerHTML = '';
  if(!body) return;
  if(!OFR.rid){ body.innerHTML = ''; return; }

  var mineAssets = _ofrMyAssets();
  var theirR = leagueRosters.find(function(x){ return x.roster_id === OFR.rid; });
  var theirs = ((theirR && theirR.players) || []).map(function(pid){
    var ap = allPlayers[pid] || {};
    return { id: pid, name: ap.name || pid, pos: ap.pos || '?', v: ktcById[pid] || 0 };
  }).filter(function(p){ return p.v > 0; }).sort(function(a, b){ return b.v - a.v; });
  try{
    buildPicksForRoster(theirR, leaguePicks, ACTIVE_SEASON).forEach(function(pk){
      var v = getKtcValue(pk.name, null);
      if(v > 0) theirs.push({ id: 'pk:' + theirs.length + ':' + pk.name, name: pk.name, pos: 'PK', v: v, pick: true });
    });
  }catch(_){}

  body.innerHTML = '<div class="ofr-col"><div class="ofr-lbl">What they want from you</div><div class="tgt-roster">' + _ofrList(mineAssets, 'want') + '</div></div>'
    + '<div class="ofr-col"><div class="ofr-lbl">What they are offering <span class="lx-dim">(leave empty to ask what you should demand)</span></div><div class="tgt-roster">' + _ofrList(theirs, 'give') + '</div></div>';
  ofrEvaluate();
}

function ofrToggle(side, pid){
  var i = OFR[side].indexOf(pid);
  if(i >= 0) OFR[side].splice(i, 1); else OFR[side].push(pid);
  ofrPickTeam(OFR.rid, true);
}

function _ofrResolve(ids, pool){
  return ids.map(function(id){ return pool.find(function(p){ return p.id === id; }); }).filter(Boolean);
}

function ofrEvaluate(){
  var out = document.getElementById('ofr-out');
  var hint = document.getElementById('ofr-hint');
  if(!out) return;
  if(!OFR.rid || !OFR.want.length){
    out.innerHTML = '';
    if(hint) hint.textContent = 'Tick whoever they asked for. Add their offer if they already made one.';
    return;
  }
  var mineAssets = _ofrMyAssets();
  var theirR = leagueRosters.find(function(x){ return x.roster_id === OFR.rid; });
  var theirs = ((theirR && theirR.players) || []).map(function(pid){
    var ap = allPlayers[pid] || {};
    return { id: pid, name: ap.name || pid, pos: ap.pos || '?', v: ktcById[pid] || 0 };
  }).filter(function(p){ return p.v > 0; });
  try{
    buildPicksForRoster(theirR, leaguePicks, ACTIVE_SEASON).forEach(function(pk){
      var v = getKtcValue(pk.name, null);
      if(v > 0) theirs.push({ id: 'pk:' + theirs.length + ':' + pk.name, name: pk.name, pos: 'PK', v: v, pick: true });
    });
  }catch(_){}

  var want = _ofrResolve(OFR.want, mineAssets);
  var give = _ofrResolve(OFR.give, theirs);
  if(!want.length){ out.innerHTML = ''; return; }

  var wantVal = want.reduce(function(s, p){ return s + p.v; }, 0);
  var prem = 1.08, who = '', why = '';
  try{ var pr = _ofrAskPremium(OFR.rid); prem = pr.mult; who = pr.who; why = pr.why; }catch(_){}
  if(hint) hint.innerHTML = 'They want <b>' + want.map(function(p){ return _lxEsc(p.name); }).join(' + ') + '</b>';

  var h = '';
  // What YOU should be getting back. They are prying your guy loose, so the
  // premium runs the other way here: they pay it, not you.
  var fairAsk = wantVal * prem;

  if(!give.length){
    h += '<div class="ofr-verdict ofr-neutral">Ask for about ' + Math.round(fairAsk).toLocaleString() + ' in value back'
      + (who ? ' - you are dealing with ' + _lxEsc(who) : '') + '.</div>';
    if(why) h += '<div class="ofr-why">' + _lxEsc(why) + '</div>';
    // the package comes TO you, so the tiebreak is which of their players fills
    // YOUR holes. Ranking it by their needs demanded the guys they least want
    // to send, which is the wrong end of the negotiation.
    var _mine = leagueRosters.find(function(r){ return r.owner_id === userId; });
    var myNeed = _mine ? _tgtTheirNeed(_mine.roster_id) : {};
    var found = _tgtSearch(theirs.slice().sort(function(a,b){ return b.v - a.v; }), fairAsk, myNeed);
    var picked = [], seenPkg = {};
    function _key(r){ return r.pkg.map(function(p){ return p.id; }).sort().join('|'); }
    [['What to ask for', found.fair], ['The lighter version they are likelier to accept', found.cheap]].forEach(function(pair){
      if(!pair[1]) return;
      var k = _key(pair[1]);
      if(seenPkg[k]) return;                 // same package under two labels helps nobody
      seenPkg[k] = 1; picked.push(pair);
    });
    if(picked.length){
      h += '<div class="ofr-sec">Off their roster, this is what clears that bar</div>';
      picked.forEach(function(pair){
        h += '<div class="lx-deal"><div class="lx-deal-t">' + pair[0] + '</div><div class="lx-deal-b">'
          + '<span class="lx-out">' + want.map(_lxNm).join(' + ') + '</span><span class="lx-arrow">&rarr;</span>'
          + '<span class="lx-in">' + pair[1].pkg.map(_lxNm).join(' + ') + '</span></div></div>';
      });
    } else {
      h += '<div class="lx-none">Nothing on their roster covers that ask on its own. Either they add a pick, or you are better off keeping your guy.</div>';
    }
    out.innerHTML = h;
    return;
  }

  // They named a price. Judge it, then find a cheaper way to say yes.
  var giveVal = give.reduce(function(s, p){ return s + p.v; }, 0);
  var edge = giveVal - fairAsk;
  var pct = fairAsk > 0 ? (edge / fairAsk) : 0;
  var cls = pct >= 0.05 ? 'ofr-good' : (pct <= -0.12 ? 'ofr-bad' : 'ofr-neutral');
  var verdict = pct >= 0.15 ? 'Take it. They are paying over the odds.'
    : pct >= 0.05 ? 'Good offer. You come out ahead.'
    : pct >= -0.05 ? 'Basically fair. It comes down to whether you want the pieces.'
    : pct >= -0.12 ? 'Light. Close enough to counter rather than decline.'
    : 'They are asking too much. Do not send this back as is.';
  h += '<div class="ofr-verdict ' + cls + '">' + verdict + '</div>';
  h += '<div class="ofr-math">They are offering about ' + Math.round(giveVal).toLocaleString()
    + ' against a fair ask of ' + Math.round(fairAsk).toLocaleString()
    + ' for ' + want.map(function(p){ return _lxEsc(p.name); }).join(' + ') + '.</div>';
  if(why) h += '<div class="ofr-why">' + _lxEsc(why) + '</div>';

  // The counter: keep what they are giving, find the cheapest thing of yours
  // that still clears their bar. This is the "it feels like a lot" answer.
  var theirBar = giveVal / prem;
  // "send this instead" has to mean instead: a counter that still ships the
  // player they asked for is not a counter, and the line claiming it keeps
  // those players would be a lie.
  var askedFor = {}; want.forEach(function(p){ askedFor[p.id] = 1; });
  var pool = mineAssets.filter(function(a){ return !askedFor[a.id]; }).sort(function(a, b){ return b.v - a.v; });
  var alt = _tgtSearch(pool, theirBar, _tgtTheirNeed(OFR.rid));
  var options = [];
  [['Cheapest way to say yes', alt.cheap], ['The clean version', alt.fair]].forEach(function(pair){
    if(!pair[1]) return;
    var cost = pair[1].pkg.reduce(function(s, p){ return s + p.v; }, 0);
    if(cost >= wantVal * 0.99) return;                 // not actually cheaper
    var ok2 = pair[1].pkg.map(function(p){ return p.id; }).sort().join('|');
    if(options.some(function(o){ return o.key === ok2; })) return;
    options.push({ label: pair[0], pkg: pair[1].pkg, cost: cost, key: ok2 });
  });
  if(options.length){
    h += '<div class="ofr-sec">Send this instead and keep everything they offered</div>';
    options.forEach(function(o){
      h += '<div class="lx-deal"><div class="lx-deal-t">' + o.label + ' - saves you about ' + Math.round(wantVal - o.cost).toLocaleString() + ' in value</div>'
        + '<div class="lx-deal-b"><span class="lx-out">' + o.pkg.map(_lxNm).join(' + ') + '</span>'
        + '<span class="lx-arrow">&rarr;</span><span class="lx-in">' + give.map(_lxNm).join(' + ') + '</span></div></div>';
    });
  } else if(pct < -0.05){
    h += '<div class="lx-none">There is no cheaper package of yours that still gets it done. Counter by asking them to add, not by swapping your side.</div>';
  }

  // Does the deal leave you able to field a lineup
  try{
    var health = _tgtRosterAfter(want, give.filter(function(p){ return !p.pick; }).map(function(p){ return p.id; }));
    if(health && health.holes.length){
      h += '<div class="tgt-warn">Careful: sending what they asked for leaves you short at '
        + health.holes.map(function(x){ return x.pos + ' (' + x.have + ' of ' + x.need + ')'; }).join(', ')
        + (options.length ? '. The counter above keeps those players.' : '.') + '</div>';
    } else if(health && health.thin.length){
      h += '<div class="tgt-thin">Sending what they asked for leaves you with no cover at ' + health.thin.join(' and ') + '.</div>';
    }
  }catch(_){}

  out.innerHTML = h;
}

function generateTradeIdeas(){
  try{tgtRenderPanel();}catch(_){}
  try{ofrRender();}catch(_){}   // the shopping list rides along with the ideas
  // header: which league these ideas are for + in-place switcher
  try{
    var ih=document.getElementById('ideas-header');
    if(ih&&leagueId){
      ih.style.display='flex';
      var nm=document.getElementById('ideas-league-name'); if(nm)nm.textContent=leagueName||'your league';
    }
    // Populate every league switcher on the page (inline ideas + the Trade Ideas
    // tab). Only show it when you actually have more than one league to switch to.
    var _ls=window._myLeagues||[];
    var _opts='<option value="">Switch league...</option>'+_ls.map(function(l){
      return '<option value="'+l.league_id+'"'+(l.league_id===leagueId?' disabled':'')+'>'+(l.name||'League').replace(/</g,'&lt;')+'</option>';
    }).join('');
    // Signature of the current options. "New ideas" re-runs this whole function,
    // and blindly rewriting the <select>'s innerHTML each time yanks it back to
    // "Switch league..." mid-interaction and makes it flicker/glitch. Only touch
    // the DOM when the league list or active league actually changed.
    var _sig=leagueId+'|'+_opts;
    ['ideas-league-switch','ideas-tab-league-switch'].forEach(function(id){
      var sel=document.getElementById(id);
      if(!sel)return;
      if(sel._tmOptSig!==_sig){sel.innerHTML=_opts;sel._tmOptSig=_sig;}
      sel.style.display=_ls.length>1?'':'none';
    });
  }catch(_){}
  var el=document.getElementById("ideas-list-tab")||document.getElementById("ideas-list");
  if(!el)return;
  if(!leagueRosters.length||!userId){
    el.innerHTML="<div class='ideas-empty'>Connect a league first to get trade ideas.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";
    return;
  }
  el.innerHTML="<div class='ideas-empty'>Analyzing your roster and finding the best moves...</div>";

  var myRosterObj=leagueRosters.find(function(r){return r.owner_id===userId;});
  if(!myRosterObj){
    // Try matching by any roster if userId comparison fails
    el.innerHTML="<div class='ideas-empty'>Could not find your roster - try reloading your league.</div>";
    return;
  }
  var myRid=myRosterObj.roster_id;
  var mySum=rosterPosSummary(myRosterObj.players||[]);
  var myNeeds=posNeed(mySum);
  var build=getMyBuildPhase(mySum);

  var myAllPlayers=[];
  ['QB','RB','WR','TE'].forEach(function(pos){(mySum[pos]||[]).forEach(function(p){myAllPlayers.push(p);});});
  myAllPlayers.sort(function(a,b){return b.ktc-a.ktc;});

  var offSeason=!leagueRosters.some(function(r){return r.settings&&((r.settings.wins||0)+(r.settings.losses||0))>0;});

  var ideas=[],seenGive={},seenGet={};

  // --- Strategy 1: Positional need swaps (player↔player) ---
  leagueRosters.forEach(function(oppRosterObj){
    if(oppRosterObj.owner_id===userId)return;
    var oppUser=leagueUsers.find(function(u){return u.user_id===oppRosterObj.owner_id;});
    var oppName=(oppUser&&(oppUser.metadata&&oppUser.metadata.team_name||oppUser.display_name))||"Opponent";
    var oppSum=rosterPosSummary(oppRosterObj.players||[]);
    var oppNeeds=posNeed(oppSum);
    for(var ni=0;ni<Math.min(3,myNeeds.length);ni++){
      var needPos=myNeeds[ni].pos;
      var oppAtPos=oppSum[needPos]||[];
      if(oppAtPos.length<2)continue;
      var theyNeed=oppNeeds[0]&&oppNeeds[0].pos;
      if(!theyNeed)continue;
      var iHave=mySum[theyNeed]||[];
      if(iHave.length<2)continue;
      var iGive=iHave[1],theyGive=oppAtPos[1];
      if(!iGive||!theyGive||!iGive.ktc||!theyGive.ktc)continue;
      var gap=theyGive.ktc-iGive.ktc;
      // Keep ideas realistic: skip if the opponent clearly loses (they'd never accept)
      // or if the user loses real value (never suggest bad deals to our own user)
      if(gap>500||gap<0)continue;   // only fair-or-better for the user: the analyzer must never reject our own suggestion
      var tag,tagClass;
      if(gap>80){tag="Fill Roster Need";tagClass="win";}
      else {tag="Fair Deal";tagClass="fair";}
      // Specific per-side reasoning: why you send yours, why you want theirs
      var giveNote=getPlayerContextNote(iGive.name);
      var getNote=getPlayerContextNote(theyGive.name);
      var whySend="<strong style='color:var(--text)'>Why send "+iGive.name+":</strong> you have "+iHave.length+" players at "+theyNeed+" and he's not your top option there"+(giveNote?" - "+giveNote.note.split(';')[0].trim():"")+".";
      var myBestAtNeed=(mySum[needPos]||[])[0];
      var startsNow=!myBestAtNeed||theyGive.ktc>myBestAtNeed.ktc*0.85;
      var roleTxt=startsNow?"he slots straight into your lineup":"he deepens the position now and grows into a starter - a dynasty play, not a week-one fix";
      var whyGet=" <strong style='color:var(--text)'>Why get "+theyGive.name+":</strong> you're thin at "+needPos+" and "+roleTxt+(getNote?" - "+getNote.note.split(';')[0].trim():"")+".";
      var whyThem=" <strong style='color:var(--text)'>Why "+oppName+" says yes:</strong> they need "+theyNeed+" help more than "+needPos+" depth"+(gap>80?", and the small value edge to you is inside normal negotiation range":"")+".";
      var reason=whySend+whyGet+whyThem;
      ideas.push({iGive:[iGive],theyGive:[theyGive],oppName:oppName,oppUserId:oppRosterObj.owner_id,tag:tag,tagClass:tagClass,reason:reason,gap:gap});
    }
  });

  // Rank by closeness to a +250 sweet spot: fair enough that they'll engage,
  // with a slight edge to our user
  ideas.sort(function(a,b){return Math.abs(a.gap-250)-Math.abs(b.gap-250);});
  var topIdeas=[];
  ideas.forEach(function(idea){
    if(topIdeas.length>=12)return;
    var gKey=idea.iGive.map(function(p){return p.id||p.name;}).join(",");
    var gkKey=idea.theyGive.map(function(p){return p.id||p.name;}).join(",");
    if(seenGive[gKey]||seenGet[gkKey])return;
    seenGive[gKey]=true;seenGet[gkKey]=true;
    topIdeas.push(idea);
  });

  // --- Strategy 2: Sell aging vet for future picks (rebuilding/building) ---
  if(build.phase==='rebuilding'||build.phase==='building'){
    // Cap "sell for picks" to a handful so the list isn't a wall of identical picks
    var s2cap=topIdeas.length+3;
    leagueRosters.forEach(function(oppRosterObj){
      if(oppRosterObj.owner_id===userId||topIdeas.length>=s2cap)return;
      var oppUser=leagueUsers.find(function(u){return u.user_id===oppRosterObj.owner_id;});
      var oppName=(oppUser&&(oppUser.metadata&&oppUser.metadata.team_name||oppUser.display_name))||"Opponent";
      [1,2].forEach(function(rnd){
        if(topIdeas.length>=s2cap)return;
        var seasons=offSeason?[parseInt(leagueSeason)+1]:([parseInt(leagueSeason),parseInt(leagueSeason)+1]);
        seasons.forEach(function(yr){
          if(topIdeas.length>=s2cap)return;
          var pickKtc=getPickKtcValue(yr,rnd);
          if(!pickKtc)return;
          var pickKey="pick_"+yr+"_"+rnd+"_"+oppRosterObj.roster_id;
          if(seenGet[pickKey])return;
          // Realistic only: the vet must be worth ROUGHLY the pick. Nobody gives up
          // a pick for a much cheaper player, so the vet has to be worth at least
          // ~the pick (opponent says yes) and not wildly more (fair for you too).
          var giveVet=myAllPlayers.find(function(p){
            var k=p.id||p.name;
            return !seenGive[k]&&p.ktc>0&&(p.age||0)>=27&&p.ktc>=pickKtc-150&&p.ktc<=pickKtc+400;
          });
          if(!giveVet)return;
          var gKey=giveVet.id||giveVet.name;
          seenGive[gKey]=true;seenGet[pickKey]=true;
          var slotEst=offSeason?null:estimatePickSlot(oppRosterObj.roster_id);
          var slotStr=slotEst?" ("+pickSlotLabel(slotEst.slot,slotEst.total)+")":"";
          var roundNames=["1st","2nd","3rd","4th"];
          var pickLabel=yr+" "+roundNames[rnd-1]+" round"+slotStr;
          var gap=pickKtc-giveVet.ktc;
          topIdeas.push({
            iGive:[giveVet],
            theyGive:[{id:"",name:yr+" Round "+rnd,pos:"PK",team:"",season:yr,round:rnd,ktc:pickKtc,ownerRosterId:oppRosterObj.roster_id,ownerName:oppName}],
            oppName:oppName,oppUserId:oppRosterObj.owner_id,
            tag:"Long-Term Investment",tagClass:"win",
            reason:"Move "+giveVet.name+" (age "+(giveVet.age||"?")+") while his value is high. "+oppName+"'s "+pickLabel+" is the kind of pick that gains value as the draft gets closer."+(build.phase==='rebuilding'?" Fits your rebuild perfectly.":""),
            gap:gap
          });
        });
      });
    });
  }

  // --- Strategy 3: Trade picks for proven player (contending) ---
  if(build.phase==='contending'||build.phase==='building'){
    var myGoodPicks=myPicks.filter(function(p){return p.round<=2;}).sort(function(a,b){return a.round-b.round||(a.season-b.season);});
    if(myGoodPicks.length){
      var topNeed=myNeeds[0]&&myNeeds[0].pos;
      leagueRosters.forEach(function(oppRosterObj){
        if(oppRosterObj.owner_id===userId||topIdeas.length>=16)return;
        var oppUser=leagueUsers.find(function(u){return u.user_id===oppRosterObj.owner_id;});
        var oppName=(oppUser&&(oppUser.metadata&&oppUser.metadata.team_name||oppUser.display_name))||"Opponent";
        var oppSum=rosterPosSummary(oppRosterObj.players||[]);
        var myBestPick=myGoodPicks[0];
        var myPickKtc=getPickKtcValue(myBestPick.season,myBestPick.round);
        if(!myPickKtc)return;
        var pos=topNeed||'WR';
        var target=oppSum[pos]&&(oppSum[pos][1]||oppSum[pos][0]);
        if(!target||!target.ktc||seenGet[target.id])return;
        var pickKey="mypick_"+myBestPick.season+"_"+myBestPick.round;
        if(seenGive[pickKey])return;
        if(Math.abs(target.ktc-myPickKtc)>900)return;
        var mySlot=offSeason?null:estimatePickSlot(myRid);
        var mySlotStr=mySlot?" ("+pickSlotLabel(mySlot.slot,mySlot.total)+")":"";
        var roundNames=["1st","2nd","3rd","4th"];
        seenGive[pickKey]=true;seenGet[target.id]=true;
        topIdeas.push({
          iGive:[{id:"",name:myBestPick.name||myBestPick.season+" Round "+myBestPick.round,pos:"PK",team:"",season:myBestPick.season,round:myBestPick.round,ktc:myPickKtc,ownerRosterId:myRid}],
          theyGive:[target],
          oppName:oppName,oppUserId:oppRosterObj.owner_id,
          tag:"Contend Now",tagClass:"win",
          reason:"Trade your "+myBestPick.season+" "+roundNames[myBestPick.round-1]+mySlotStr+" to win now. "+target.name+" fills your "+pos+" need immediately."+(build.phase==='contending'?" Your window is open - cash in your veterans before they age out.":""),
          gap:target.ktc-myPickKtc
        });
      });
    }
  }

  // --- Strategy 4: High Risk / High Reward - buy young breakout candidate ---
  leagueRosters.forEach(function(oppRosterObj){
    if(oppRosterObj.owner_id===userId||topIdeas.length>=16)return;
    var oppUser=leagueUsers.find(function(u){return u.user_id===oppRosterObj.owner_id;});
    var oppName=(oppUser&&(oppUser.metadata&&oppUser.metadata.team_name||oppUser.display_name))||"Opponent";
    var oppSum=rosterPosSummary(oppRosterObj.players||[]);
    ['WR','RB','TE','QB'].forEach(function(pos){
      if(topIdeas.length>=16)return;
      (oppSum[pos]||[]).forEach(function(p){
        if(topIdeas.length>=5||seenGet[p.id])return;
        if((p.age||99)>24||(p.exp||99)>3)return;
        if(!p.ktc||p.ktc<1800||p.ktc>7500)return;
        var iGiveP=myAllPlayers.find(function(mp){
          var k=mp.id||mp.name;
          return !seenGive[k]&&mp.ktc>=p.ktc*0.65&&mp.ktc<=p.ktc*1.25&&(mp.age||0)>=(p.age||0)+3;
        });
        if(!iGiveP)return;
        var gk=iGiveP.id||iGiveP.name;
        seenGive[gk]=true;seenGet[p.id]=true;
        var _ageGap=(iGiveP.age&&p.age)?(iGiveP.age-p.age):0;
        var _yr=(p.exp!=null?p.exp+1:null);
        var _isR=leagueMode==='redraft';
        var _samePos=iGiveP.pos===p.pos;
        var _reason;
        if(_isR){
          // Redraft: only who scores more THIS season. Same-position swaps are a
          // straight who's-better call (no "cover the position elsewhere" - you're
          // getting that position back); cross-position deals reshape the lineup.
          // Vary the wording by player so cards don't all read identically.
          var _h=0,_hs=(p.id||p.name)+'';for(var _hi=0;_hi<_hs.length;_hi++)_h=(_h*31+_hs.charCodeAt(_hi))>>>0;
          if(_samePos){
            var _rp=[
              "Straight "+p.pos+" swap: the whole bet is that "+p.name+" outscores "+iGiveP.name+" the rest of the season. Do it if you buy his role and ceiling - stand pat if you trust "+iGiveP.name+"'s.",
              "Same position, so it's one question: who puts up more "+p.pos+" points from here? Pull the trigger if you think "+p.name+" has the higher week-to-week ceiling.",
              "You're not changing your lineup shape, just raising the ceiling at "+p.pos+". Worth it if "+p.name+"'s role is trending up while "+iGiveP.name+"'s holds or fades."
            ];
            _reason=_rp[_h%_rp.length];
          } else {
            _reason="This reshapes your lineup: you add "+p.name+" ("+p.pos+") but open a hole at "+iGiveP.pos+" where "+iGiveP.name+" was starting. "+p.name+" has the bigger weekly ceiling - only make it if your "+p.pos+" need outweighs losing a starting "+iGiveP.pos+", and you can still fill "+iGiveP.pos+".";
          }
        } else {
          // Dynasty: youth matters, but QBs age far slower than RB/WR, so a raw
          // cross-position age gap is misleading. Never cite the value number.
          var _angle;
          if(p.pos==='QB'){
            _angle=p.name+" is a young QB, and QB is the slowest-aging position - that is a long window you are buying.";
          } else if(iGiveP.pos==='QB'){
            _angle="Careful: you are moving a QB, and QBs hold value years longer than "+p.pos+"s, so this is not the age win it looks like - only do it if you truly believe in "+p.name+".";
          } else if(_samePos&&_ageGap>=2){
            _angle="Same position, "+_ageGap+" more years of prime coming your way.";
          } else {
            _angle=p.name+" is the younger, higher-upside piece with more runway left.";
          }
          _reason="You send "+iGiveP.name+" ("+iGiveP.pos+") for "+p.name+" ("+p.pos+(_yr?", year "+_yr:"")+"). "+_angle+" The move: buy the ascending player before the breakout, not after. Right call if you are building rather than chasing this year.";
        }
        topIdeas.push({
          iGive:[iGiveP],theyGive:[p],
          oppName:oppName,oppUserId:oppRosterObj.owner_id,
          tag:"High Risk / High Reward",tagClass:"counter",
          reason:_reason,
          gap:p.ktc-iGiveP.ktc
        });
      });
    });
  });

  // --- Strategy 5: Pure value upgrade fallback ---
  if(topIdeas.length<3){
    var upgrades=[];
    leagueRosters.forEach(function(oppRosterObj){
      if(oppRosterObj.owner_id===userId)return;
      var oppUser=leagueUsers.find(function(u){return u.user_id===oppRosterObj.owner_id;});
      var oppName=(oppUser&&(oppUser.metadata&&oppUser.metadata.team_name||oppUser.display_name))||"Opponent";
      var oppSum=rosterPosSummary(oppRosterObj.players||[]);
      ['WR','RB','QB','TE'].forEach(function(pos){
        var myAtPos=mySum[pos]||[];
        var oppAtPos=oppSum[pos]||[];
        if(myAtPos.length<2||oppAtPos.length<2)return;
        for(var gi=myAtPos.length-1;gi>=1;gi--){
          var iGive=myAtPos[gi],theyGive=oppAtPos[1];
          if(!iGive||!theyGive||!iGive.ktc||!theyGive.ktc)continue;
          var gap=theyGive.ktc-iGive.ktc;
          if(gap<80||gap>700)continue;
          var gKey=iGive.id||iGive.name,gkKey=theyGive.id;
          if(seenGive[gKey]||seenGet[gkKey])continue;
          upgrades.push({iGive:[iGive],theyGive:[theyGive],oppName:oppName,oppUserId:oppRosterObj.owner_id,tag:"Value Win",tagClass:"win",reason:"Straight upgrade at "+pos+" - you get the better player. "+oppName+" may need your side and accept.",gap:gap});
          break;
        }
      });
    });
    upgrades.sort(function(a,b){return b.gap-a.gap;});
    upgrades.forEach(function(idea){
      if(topIdeas.length>=4)return;
      var gk=idea.iGive[0].id||idea.iGive[0].name,gkk=idea.theyGive[0].id;
      if(seenGive[gk]||seenGet[gkk])return;
      seenGive[gk]=true;seenGet[gkk]=true;
      topIdeas.push(idea);
    });
  }

  if(!topIdeas.length){
    el.innerHTML="<div class='ideas-empty'>No ideas found yet - market values may still be loading. Try again in a moment.</div>";
    return;
  }

  function assetHtml(p){
    if(p.pos==="PK"){
      var rnd=p.round||1;
      var roundNames=["1st","2nd","3rd","4th"];
      var roundLabel=roundNames[rnd-1]||(rnd+"th");
      // Projected exact slot, e.g. 2.03 (round.pick). Falls back to "2nd" if unknown.
      var sl=p.ownerRosterId?estimatePickSlot(p.ownerRosterId):null;
      var pickNum=sl?(rnd+"."+String(sl.slot).padStart(2,"0")):roundLabel;
      var pickSub=sl?(sl.projected?"Projected · "+_ordinal(sl.slot)+" of "+sl.total:_ordinal(sl.slot)+" of "+sl.total):"Draft pick";
      return "<div class='idea-side'>"
        +"<div class='idea-pk'>"+rnd+"</div>"
        +"<div><div class='idea-player-name'>"+(p.season||"")+" "+pickNum+"</div>"
        +"<div class='idea-player-sub'>"+pickSub+"</div></div></div>";
    }
    var posColors={QB:"#a78bfa",RB:"#4ade80",WR:"#fbbf24",TE:"#f87171"};
    var col=posColors[p.pos]||"var(--muted)";
    var ageSub=p.age?" · age "+p.age:"";
    return "<div class='idea-side' onclick='openPlayerCard(\""+p.id+"\",\""+p.name.replace(/"/g,"&quot;")+"\")' style='cursor:pointer'>"
      +"<img class='idea-avatar' src='https://sleepercdn.com/content/nfl/players/thumb/"+p.id+".jpg' onerror='this.style.display=\"none\"' alt=''>"
      +"<div><div class='idea-player-name'>"+p.name+"</div>"
      +"<div class='idea-player-sub' style='color:"+col+"'>"+p.pos+(p.team?" · "+teamLogo(p.team,13)+p.team:"")+ageSub+"</div></div></div>";
  }

  var buildNote=build.phase==='rebuilding'?"Rebuilding":build.phase==='contending'?"Contending":"Building";
  var rankNote=build.leagueRank&&build.totalTeams?" · #"+build.leagueRank+"/"+build.totalTeams+" in league":"";
  var _fmtBadge="<span style='font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:100px;margin-right:8px;"+(leagueMode==='redraft'?"background:rgba(245,158,11,.16);color:#f59e0b":"background:rgba(167,139,250,.16);color:var(--accent-bright)")+"'>"+(leagueMode==='redraft'?'Redraft':'Dynasty')+"</span>";
  var phaseHtml="<div style='font-size:11.5px;color:var(--muted2);margin-bottom:14px;padding:10px 14px;background:rgba(155,114,232,.09);border:1px solid rgba(167,139,250,.2);border-left:3px solid var(--accent-bright);border-radius:10px'>"+_fmtBadge+"Team build: <strong style='color:var(--text)'>"+buildNote+"</strong> &middot; avg age "+build.avgAge+rankNote+"</div>";

  // Apply the user's filters: never offer a player they said they won't trade, and
  // if their context names a position they want, float those ideas to the top.
  var _exc=(window._ideaExclude||[]).map(function(n){return String(n).toLowerCase();});
  if(_exc.length){
    topIdeas=topIdeas.filter(function(idea){
      return !(idea.iGive||[]).some(function(pl){return _exc.indexOf((pl.name||'').toLowerCase())>=0;});
    });
  }
  var _want=window._ideaWantPos||'';
  if(_want){
    // Hard filter: only show deals that actually land you the position you asked for.
    var _wf=topIdeas.filter(function(idea){return (idea.theyGive||[]).some(function(pl){return pl.pos===_want;});});
    if(_wf.length){topIdeas=_wf;}
    else{
      el.innerHTML=phaseHtml+"<div class='ideas-empty'>No trade ideas that land you a "+_want+" right now. Hit \"New ideas\" for a fresh batch, or clear the target position.</div>";
      return;
    }
  }
  if(!topIdeas.length){
    el.innerHTML=phaseHtml+"<div class='ideas-empty'>No ideas match your filters. Loosen your \"won't trade\" list or clear the target position.</div>";
    return;
  }
  // Rotate through the idea pool on each Refresh so the user sees fresh options
  window._ideaPool=topIdeas;
  var offset=(window._ideaOffset||0)%Math.max(1,topIdeas.length);
  var shown=topIdeas.slice(offset,offset+4);
  if(shown.length<4)shown=shown.concat(topIdeas.slice(0,4-shown.length));
  // Dedupe in case pool is small
  var seenIdx={};shown=shown.filter(function(x){var k=topIdeas.indexOf(x);if(seenIdx[k])return false;seenIdx[k]=true;return true;});
  window._shownIdeas=shown;
  el.innerHTML=phaseHtml+shown.map(function(idea,idx){
    var giveHtml=idea.iGive.map(assetHtml).join("");
    var getHtml=idea.theyGive.map(assetHtml).join("");
    return "<div class='idea-item'>"
      +"<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'>"
      +"<div class='idea-opp'>vs "+idea.oppName+"</div>"
      +"<span class='idea-tag "+idea.tagClass+"'>"+idea.tag+"</span></div>"
      +"<div class='idea-players'>"
      +"<div><div style='font-size:10px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px'>You give</div>"+giveHtml+"</div>"
      +"<div class='idea-arrow'>→</div>"
      +"<div><div style='font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px'>You get</div>"+getHtml+"</div>"
      +"</div>"
      +"<div class='idea-reason'>"+idea.reason+"</div>"
      +"<button class='idea-use-btn' onclick='useTradeIdea("+idx+")'>Load into analyzer →</button>"
      +"</div>";
  }).join("");
}

// ── Trade Ideas filters: target position (from context) + "won't trade" list ──
window._ideaExclude=window._ideaExclude||[];
window._ideaWantPos='';
function applyIdeaFilters(){
  var ci=document.getElementById('ideas-context-input');
  var txt=(ci?ci.value:'').toUpperCase();
  var pos='';
  ['QB','RB','WR','TE'].forEach(function(P){if(new RegExp('\\b'+P+'\\b').test(txt))pos=P;});
  window._ideaWantPos=pos;
  window._ideaOffset=0;
  try{generateTradeIdeas();}catch(_){}
}
function ideaExcludeSearch(){
  var inp=document.getElementById('ideas-exclude-input');
  var dd=document.getElementById('ideas-exclude-dd');
  if(!inp||!dd)return;
  var q=inp.value.toLowerCase().trim();
  if(q.length<2){dd.classList.remove('open');return;}
  // Only your own players - you can only refuse to move guys you actually roster.
  var results=(myRoster||[]).filter(function(p){return p.name&&p.name.toLowerCase().indexOf(q)>=0;}).slice(0,6);
  dd.innerHTML='';
  results.forEach(function(p){
    // Same row builder as the nav search dropdown, so it looks identical to the others.
    var d=document.createElement('div');
    d.className='ac-item';d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer';
    d.innerHTML=_searchRowInner(p);
    d.children[1].textContent=p.name;
    d.addEventListener('mousedown',function(ev){ev.preventDefault();ideaAddExclude(p.name);inp.value='';dd.classList.remove('open');});
    dd.appendChild(d);
  });
  dd.classList.toggle('open',results.length>0);
}
function ideaAddExclude(name){
  if(!name)return;
  if(window._ideaExclude.map(function(n){return n.toLowerCase();}).indexOf(name.toLowerCase())<0)window._ideaExclude.push(name);
  _renderExcludeChips();
  applyIdeaFilters();
}
function ideaRemoveExclude(name){
  window._ideaExclude=window._ideaExclude.filter(function(n){return n.toLowerCase()!==String(name).toLowerCase();});
  _renderExcludeChips();
  applyIdeaFilters();
}
function _renderExcludeChips(){
  var box=document.getElementById('ideas-exclude-chips');if(!box)return;
  box.innerHTML=(window._ideaExclude||[]).map(function(n){
    var pid=getPlayerIdByName(n);
    var face=pid?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0" onerror="this.style.display=\'none\'">':'';
    return '<span class="ideas-excl-chip">'+face+escHtml(n)+'<b onclick="ideaRemoveExclude(\''+n.replace(/'/g,"\\'")+'\')">&times;</b></span>';
  }).join('');
}
function useTradeIdea(idx){
  var idea=window._shownIdeas&&window._shownIdeas[idx];
  if(!idea)return;
  loadTradeIdea(idea.oppUserId,
    idea.iGive.map(function(p){return {id:p.id||"",name:p.name,pos:p.pos};}),
    idea.theyGive.map(function(p){return {id:p.id||"",name:p.name,pos:p.pos};}));
}

function refreshTradeIdeas(){
  window._ideaOffset=(window._ideaOffset||0)+4;
  generateTradeIdeas();
}

function loadTradeIdea(oppUserId, givePlayers, getPlayers){
  // Jump straight to the Trade Analyzer tab so the user lands on the filled-in trade
  showAnalyzeTab('analyzer');
  // Set opponent
  var sel=document.getElementById("opp-select");
  if(sel){sel.value=oppUserId;loadOppRoster();}

  // Clear give side and fill
  var giveC=document.getElementById("give-players");
  if(giveC){
    giveC.innerHTML="";
    givePlayers.forEach(function(p,i){
      var row=document.createElement("div");
      row.className="player-row";
      row.innerHTML="<span class='pos-tag pos-badge "+p.pos+"' style='visibility:visible'>"+p.pos+"</span>"
        +"<div class='ac-wrap'><input type='text' class='tm-input' style='width:100%' data-side='give' data-player-id='"+p.id+"' data-player-pos='"+p.pos+"' value='"+p.name.replace(/'/g,"&#39;")+"' oninput='acInput(this)' onfocus='acInput(this)' onblur='acHide(this)' autocomplete='off'><div class='ac-dropdown'></div></div>"
        +"<button class='remove-btn' onclick='removeRow(this)' title='Remove'>×</button>";
      giveC.appendChild(row);
      // Add avatar
      var btn=document.createElement("button");
      btn.className="player-info-btn";
      btn.title="View player card";
      btn.setAttribute("onclick","openPlayerCard('"+p.id+"','"+p.name.replace(/'/g,"\\'")+"')");
      btn.innerHTML="<img src='https://sleepercdn.com/content/nfl/players/thumb/"+p.id+".jpg' onerror='this.parentNode.innerHTML=\"<div class=ph>"+p.pos+"</div>\"' alt=''>";
      var rb=row.querySelector(".remove-btn");
      if(rb)row.insertBefore(btn,rb);
    });
  }

  // Clear get side and fill
  var getC=document.getElementById("get-players");
  if(getC){
    getC.innerHTML="";
    getPlayers.forEach(function(p){
      var row=document.createElement("div");
      row.className="player-row";
      row.innerHTML="<span class='pos-tag pos-badge "+p.pos+"' style='visibility:visible'>"+p.pos+"</span>"
        +"<div class='ac-wrap'><input type='text' class='tm-input' style='width:100%' data-side='get' data-player-id='"+p.id+"' data-player-pos='"+p.pos+"' value='"+p.name.replace(/'/g,"&#39;")+"' oninput='acInput(this)' onfocus='acInput(this)' onblur='acHide(this)' autocomplete='off'><div class='ac-dropdown'></div></div>"
        +"<button class='remove-btn' onclick='removeRow(this)' title='Remove'>×</button>";
      getC.appendChild(row);
      var btn=document.createElement("button");
      btn.className="player-info-btn";
      btn.title="View player card";
      btn.setAttribute("onclick","openPlayerCard('"+p.id+"','"+p.name.replace(/'/g,"\\'")+"')");
      btn.innerHTML="<img src='https://sleepercdn.com/content/nfl/players/thumb/"+p.id+".jpg' onerror='this.parentNode.innerHTML=\"<div class=ph>"+p.pos+"</div>\"' alt=''>";
      var rb=row.querySelector(".remove-btn");
      if(rb)row.insertBefore(btn,rb);
    });
  }

  updateKtcLive();
  // Mirror the loaded trade onto the roster boards - without this the boards
  // looked empty while the hidden rows held the trade
  try{_boardSyncFromRows('give');_boardSyncFromRows('get');}catch(_){}
  scrollToEl(document.getElementById("builder-panel"));
}
// ─── END TRADE IDEAS ──────────────────────────────────────────────────────────

// ─── PLAYER CARD MODAL ────────────────────────────────────────────────────────
// ── Player trade history: every deal this player has been part of ──────────
function _tradeRowHtml(t,pid,leagueLabel,rosterNames){
  var when=t.created?new Date(t.created).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
  var sides={};
  Object.entries(t.adds||{}).forEach(function(e){
    var rid=e[1];if(!sides[rid])sides[rid]=[];
    var pl=allPlayers[e[0]];
    sides[rid].push({id:e[0],name:pl?pl.name:'Player '+e[0],team:pl?pl.team:'',pos:pl?pl.pos:'',hot:String(e[0])===String(pid)});
  });
  (t.draft_picks||[]).forEach(function(pk){
    var rid=pk.owner_id;if(!sides[rid])sides[rid]=[];
    sides[rid].push({id:null,name:pk.season+' Round '+pk.round+' pick',team:'',pos:'PK',hot:false});
  });
  // the one position palette the whole app uses (theme.css --pos-* tokens)
  var posC={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  var sideHtml=Object.keys(sides).map(function(rid){
    var who=rosterNames?(rosterNames(parseInt(rid))||'Team '+rid):'Team '+rid;
    return '<div style="flex:1;min-width:150px"><div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">'+who+' got</div>'
      +sides[rid].map(function(a){
        var face=a.id
          ?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+a.id+'.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1.5px solid '+(a.hot?'var(--accent-bright)':'var(--border)')+'" onerror="this.style.visibility=\'hidden\'">'
          :'<div style="width:24px;height:24px;border-radius:50%;background:var(--accent-dim);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:var(--accent-bright)">PK</div>';
        return '<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;cursor:'+(a.id?'pointer':'default')+'" '+(a.id?'onclick="openPlayerCard(\''+a.id+'\',\''+a.name.replace(/'/g,"\\'")+'\')"':'')+'>'
          +face
          +'<span style="font-size:12px;'+(a.hot?'color:var(--accent-bright);font-weight:800':'color:var(--muted2);font-weight:600')+'">'+a.name+'</span>'
          +(a.pos&&a.pos!=='PK'?'<span style="font-size:9px;font-weight:700;color:'+(posC[a.pos]||'var(--muted)')+'">'+a.pos+'</span>':'')
          +(a.team&&a.team!=='FA'?'<span style="display:inline-flex;align-items:center;gap:2px;font-size:9px;color:var(--muted)">'+teamLogo(a.team,13)+a.team+'</span>':'')
          +'</div>';
      }).join('')+'</div>';
  }).join('<div style="align-self:center;color:var(--muted);font-size:14px">⇄</div>');
  return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px">'
    +'<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-bottom:7px"><span style="font-weight:700">'+leagueLabel+'</span><span>'+when+'</span></div>'
    +'<div style="display:flex;gap:10px;flex-wrap:wrap">'+sideHtml+'</div></div>';
}
function renderPlayerTrades(pid,displayName){
  var box=document.getElementById('pm-trades');
  if(!box)return;
  box.innerHTML='';
  if(!pid)return;
  var mine=(leagueTrades||[]).filter(function(t){return t.adds&&t.adds[pid]!==undefined;});
  var html='<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:4px 0 8px">Trade history</div>';
  if(mine.length){
    html+=mine.sort(function(a,b){return (b.created||0)-(a.created||0);}).map(function(t){
      return _tradeRowHtml(t,pid,leagueName||'Your league',getRosterName);
    }).join('');
  }else if(leagueRosters.length){
    html+='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">No trades involving '+displayName+' in '+(leagueName||'this league')+' yet.</div>';
  }else{
    html+='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Connect a league to see this player\'s trade history.</div>';
  }
  var leagues=window._myLeagues||[];
  if(leagues.length>1){
    html+='<button class="btn-sm" style="font-size:10px;margin-right:6px" onclick="searchPlayerTradesAllLeagues(\''+pid+'\',this)">Search all my leagues ('+Math.min(leagues.length,8)+')</button>';
  }
  html+='<button class="btn-sm" style="font-size:10px" id="pm-copy-link" onclick="copyPlayerLink(\''+displayName.replace(/'/g,"\\'")+'\')">Copy link</button><div id="pm-trades-all"></div><div id="pm-comps"></div>';
  box.innerHTML=html;
  // Community comps: what this player has fetched in Mac Draft deals
  fetch('/api/community/player-trades?name='+encodeURIComponent(displayName)).then(function(r){return r.json();}).then(function(d){
    var comps=d.deals||[];
    var cbox=document.getElementById('pm-comps');
    if(!cbox||!comps.length)return;
    cbox.innerHTML='<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:12px 0 8px">Mac Draft market comps</div>'
      +comps.map(function(dl){
        var give=(dl.give_side||[]).map(function(a){return a&&(a.name||a);}).join(' + ');
        var get=(dl.get_side||[]).map(function(a){return a&&(a.name||a);}).join(' + ');
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:11.5px;color:var(--muted2)">'
          +give+' <span style="color:var(--muted)">⇄</span> '+get
          +'<div style="font-size:10px;color:var(--muted);margin-top:3px">@'+escHtml(dl.username||'')+' · '+(dl.league_type||'dynasty')+' · '+timeAgo(dl.created_at)+'</div></div>';
      }).join('');
  }).catch(function(){});
}
async function _leagueNameResolver(leagueIdStr){
  // Real fantasy team names for any league: rosters + users, cached
  window._leagueNameCache=window._leagueNameCache||{};
  if(window._leagueNameCache[leagueIdStr])return window._leagueNameCache[leagueIdStr];
  try{
    var results=await Promise.all([
      fetch('/api/sleeper/league/'+leagueIdStr+'/rosters').then(function(r){return r.json();}),
      fetch('/api/sleeper/league/'+leagueIdStr+'/users').then(function(r){return r.json();})
    ]);
    var rosters=results[0]||[],users=results[1]||[];
    var map={};
    rosters.forEach(function(r){
      var u=users.find(function(x){return x.user_id===r.owner_id;});
      map[r.roster_id]=u?((u.metadata&&u.metadata.team_name)||u.display_name||null):null;
    });
    var fn=function(rid){return map[rid]||null;};
    window._leagueNameCache[leagueIdStr]=fn;
    return fn;
  }catch(_){return null;}
}
async function searchPlayerTradesAllLeagues(pid,btn){
  var out=document.getElementById('pm-trades-all');
  if(!out)return;
  if(btn){btn.disabled=true;btn.textContent='Searching...';}
  var leagues=(window._myLeagues||[]).slice(0,8);
  window._leagueTradeCache=window._leagueTradeCache||{};
  var found=0;
  for(var i=0;i<leagues.length;i++){
    var lg=leagues[i];
    if(lg.league_id===leagueId)continue; // active league already shown
    try{
      if(!window._leagueTradeCache[lg.league_id]){
        var r=await fetch('/api/sleeper/league/'+lg.league_id+'/all-transactions');
        window._leagueTradeCache[lg.league_id]=r.ok?await r.json():[];
      }
      var hits=(window._leagueTradeCache[lg.league_id]||[]).filter(function(t){return t.adds&&t.adds[pid]!==undefined;});
      if(hits.length){
        var resolver=await _leagueNameResolver(lg.league_id);
        hits.sort(function(a,b){return (b.created||0)-(a.created||0);}).forEach(function(t){
          out.innerHTML+=_tradeRowHtml(t,pid,lg.name||'League',resolver);
          found++;
        });
      }
    }catch(_){}
  }
  if(btn){
    btn.remove();
  }
  if(!found)out.innerHTML+='<div style="font-size:11px;color:var(--muted);margin-top:4px">No trades in your other leagues either. Untouchable, apparently.</div>';
}

// Vegas layer: fetched once per visit from our blob-cached snapshot (the
// server refreshes upstream at most once a week, so this never burns credits).
// Player prop projections are the signal now; team totals stay internal only.
(function loadVegas(){
  fetch('/api/odds/implied').then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d)return;
    if(d.implied&&Object.keys(d.implied).length)window._impliedTotals=d.implied;
    if(d.projections&&Object.keys(d.projections).length)window._vegasProj=d.projections;
  }).catch(function(){});
})();
// prop lookup tolerant of punctuation and Jr/Sr/II suffixes
function vegasProjFor(name){
  if(!name||!window._vegasProj)return null;
  var norm=function(s){return s.toLowerCase().replace(/[.'']/g,'').replace(/\s+(jr|sr|ii|iii|iv|v)$/,'').trim();};
  var want=norm(name);
  if(window._vegasProj[name.toLowerCase()]!=null)return window._vegasProj[name.toLowerCase()];
  var keys=Object.keys(window._vegasProj);
  for(var i=0;i<keys.length;i++){if(norm(keys[i])===want)return window._vegasProj[keys[i]];}
  return null;
}
// Percentage of the player's own value, so the sentence means something
// without knowing the vendor's scale. Falls back to a plain direction when we
// cannot work out what he was worth before the move.
function pctMove(p){
  var t=Number(p&&p.trend)||0, v=Number(p&&(p.value!=null?p.value:p.dyn))||0, base=v-t;
  var pc=base>0?Math.round(Math.abs(t)/base*100):0;
  return pc?pc+'%':'sharply';
}
function capFirst(x){return String(x||'').charAt(0).toUpperCase()+String(x||'').slice(1);}
// One shared market opinion so the site never contradicts itself: the same
// signals drive the Buy/Sell lists and the player card chip.
// Inside a live room the trade language ("sell-high window") is nonsense -
// you are not cashing anyone out, you are deciding a pick. This read replaces
// it with what actually matters at the table, and NEVER comes back empty:
// where he sits vs the board, whether he survives your turn, the run, the
// tier, the money. Falls through to the market read outside a draft.
function mdDraftRead(pid){
  try{
    var bd=document.getElementById('md-board');
    if(!bd||bd.dataset.live!=='1')return null;
    var p=null,i;
    for(i=0;i<(MD.pool||[]).length;i++)if(MD.pool[i].id===pid){p=MD.pool[i];break;}
    var took=null;
    (MD.picks||[]).forEach(function(pk){if(pk&&pk.p&&pk.p.id===pid)took=pk;});
    var ACC='var(--accent-bright)',GRN='var(--green)',YEL='var(--yellow)',RED='var(--red)';
    // already gone: say who has him and what it cost
    if(took){
      var who=took.mine?'You':(((MD.bots&&MD.bots[took.slot]||{}).name)||('Team '+took.slot));
      if(AU.active){
        var sale=null;(AU.sold||[]).forEach(function(s0){if(s0&&s0.p&&s0.p.id===pid)sale=s0;});
        return {k:'sold',label:took.mine?'You bought him':'Off the board',color:took.mine?GRN:'var(--muted)',
          why:sale?(who+' landed him for $'+sale.price+(sale.value?' - room value said $'+sale.value:'')+'.'):(who+' owns him now.')};
      }
      return {k:'gone',label:took.mine?'Your pick':'Off the board',color:took.mine?GRN:'var(--muted)',
        why:who+' took him at '+took.round+'.'+(took.pickNo<10?'0':'')+took.pickNo+'.'};
    }
    if(!p)return null;
    // AUCTION: money talk
    if(AU.active){
      var val=auValue(p),worth=null;
      try{worth=auMyWorth(p);}catch(_){}
      var lot=AU.lot;
      if(lot&&lot.p&&lot.p.id===pid)
        return {k:'onblock',label:'On the block now',color:ACC,
          why:'Bidding is at $'+lot.bid+(worth?' - he is worth up to $'+worth+' to your roster.':'.')};
      return {k:'avail',label:'Still unsold',color:ACC,
        why:'Room value $'+val+(worth?' · worth up to $'+worth+' to you':'')+'. Nominate him when you want him priced.'};
    }
    // SNAKE: survival talk
    var ov=(MD.pickIdx||0)+1, nextMine=null;
    for(i=MD.pickIdx||0;i<(MD.order||[]).length;i++)if(MD.order[i]===MD.mySlot){nextMine=i+1;break;}
    var tier=(MD.tierOf&&MD.tierOf[pid])||null;
    var left=tier?(MD.pool||[]).filter(function(x){return x.pos===p.pos&&MD.tierOf[x.id]===tier;}).length:0;
    if(tier&&left<=2)
      return {k:'cliff',label:left===1?'Last one in his tier':'Two left in his tier',color:RED,
        why:'After him the '+p.pos+' board drops a level. If you want this tier, it is now.'};
    if(nextMine&&p.adp){
      var gap=Math.round(nextMine-p.adp);
      if(gap>=8)return {k:'value',label:'Falling past his price',color:GRN,
        why:'The board had him around '+Math.round(p.adp)+' and he is still here at '+ov+'. That is value sitting on the table.'};
      if(gap>=-4)return {k:'coinflip',label:'Coin flip to survive',color:YEL,
        why:'Your next pick is '+nextMine+' and his price is '+Math.round(p.adp)+'. He might make it back, he might not.'};
      return {k:'gonebyturn',label:'Will not last',color:RED,
        why:'He goes around '+Math.round(p.adp)+' and your next turn is '+nextMine+'. Take him now or lose him.'};
    }
    // last resort: never blank
    return {k:'onboard',label:'On the board',color:ACC,
      why:p.adp?('The market drafts him around '+Math.round(p.adp)+'; you are at pick '+ov+'.'):'Still available in this room.'};
  }catch(_){return null;}
}
function sageMarketRead(pid){
  var fc=ktcFull[pid]; var p=allPlayers[pid];
  if(!fc||!p)return null;
  var t=fc.trend30Day||0, age=p.age||26, isR=leagueMode==='redraft';
  // Movement as a percentage of the player's own value, never the raw index
  // number. "+331" sounds like a fact about the player when it is really a
  // fact about one vendor's scale, and it means nothing without knowing what
  // he was worth to begin with. "up 9%" travels on its own.
  var _base=(fc.value||0)-t, _pct=_base>0?Math.round(Math.abs(t)/_base*100):0;
  var moved=function(dir){ return dir+(_pct?' '+_pct+'%':'')+' in 30 days'; };
  if(t>=100&&(isR||age>=27))return {k:'sell-high',label:'Sell-high window',color:'var(--red)',
    why:'Price is '+moved('up')+(isR?'':' at age '+age)+' - this is when you cash out, not buy in.'};
  if(t<=-150&&!isR&&age<=25)return {k:'buy-low',label:'Buy-low window',color:'var(--green)',
    why:capFirst(moved('down'))+' at age '+age+' - the market is discounting a young player.'};
  if(t<=-150&&(isR||age>=29))return {k:'fading',label:'Fading - be careful',color:'var(--yellow)',
    why:capFirst(moved('down'))+(isR?'':' at age '+age)+' - could keep sliding. Only buy at a real discount.'};
  if(t>=100)return {k:'rising',label:'Rising - pay up or pass',color:'var(--accent-bright)',
    why:capFirst(moved('up'))+'. Buying now means paying the hot price - fine if you believe it, but you are not early.'};
  return {k:'hold',label:'Stable market',color:'var(--muted)',
    why:'No strong market signal either way - trade him on fit and value, not timing.'};
}
// Market movement in words, not raw numbers. The underlying value scale is
// FantasyCalc's internal one, so "+120" reads like a fact about the player when
// it is really a fact about one vendor's index. Managers think in direction and
// strength, so say that instead. Positional ranks stay: RB26 is meaningful on
// its own, a 120-point swing is not.
function trendWord(t){
  // delegates to the shared vocabulary so every surface says the same thing
  var l=trendLabel(t);return {txt:l.word,dir:l.dir};
}
function openPlayerCard(pid, name){
  var modal=document.getElementById("player-modal");
  if(!modal)return;
  // consistent market chip (same logic as Buy/Sell lists)
  setTimeout(function(){
    try{
      var info=modal.querySelector('.pm-info');
      if(!info)return;
      var chip=document.getElementById('pm-market-read');
      if(!chip){chip=document.createElement('div');chip.id='pm-market-read';
        chip.style.cssText='margin-top:7px;font-size:11px;line-height:1.5';info.appendChild(chip);}
      var rid=(pid&&allPlayers[pid])?pid:null;
      var mr=rid?(mdDraftRead(rid)||sageMarketRead(rid)):null;
      var veg='';
      try{
        var nm=rid&&allPlayers[rid]&&allPlayers[rid].name;
        var vp=nm?vegasProjFor(nm):null;
        if(vp!=null)
          veg=' <span style="color:var(--muted)">· Vegas props project him around '+vp.toFixed(1)+' points this week.</span>';
      }catch(_){}
      chip.innerHTML=mr?('<span style="font-weight:700;padding:2px 8px;border-radius:100px;border:1px solid '+mr.color+';color:'+mr.color+'">'+mr.label+'</span> <span style="color:var(--muted2)">'+mr.why+'</span>'+veg):'';
    }catch(_){}
  },50);

  // Resolve player from Sleeper data
  var p=(pid&&allPlayers)?allPlayers[pid]:null;
  if(!p&&name&&allPlayers){
    var nl=name.toLowerCase();
    var found=Object.values(allPlayers).find(function(x){return x&&x.name&&x.name.toLowerCase()===nl;});
    if(found){p=found;pid=found.id||pid;}
  }

  var fc=pid?ktcFull[pid]:null;
  var displayName=p?p.name||name:name;
  var pos=p?p.pos||"?":"?";
  var team=p?p.team||"FA":"FA";
  var injury=p&&p.injury_status&&p.injury_status!=="Active"?p.injury_status:"";
  var injNotes=p&&p.injury_notes?p.injury_notes:"";
  var college=p&&p.college?p.college:"";
  var jersey=p&&p.number?"#"+p.number:"";
  var espnId=fc&&fc.espnId?fc.espnId:null;

  // ── Header ──
  document.getElementById("pm-name").textContent=displayName;
  document.getElementById("pm-team-name").innerHTML=team==="FA"?"Free Agent":(teamLogo(team,17)+team);
  document.getElementById("pm-number").textContent=jersey;
  document.getElementById("pm-college").textContent=college;
  var pb=document.getElementById("pm-pos-badge");
  pb.textContent=pos; pb.className="pm-pos-badge "+pos;

  // ── Injury ──
  var inj=document.getElementById("pm-injury");
  if(injury){inj.textContent="Injury: "+injury+(injNotes?" - "+injNotes:"");inj.style.display="block";}
  else{inj.style.display="none";}

  // ── Photo: Sleeper thumb (always works), ESPN fallback not needed ──
  var photoEl=document.getElementById("pm-photo");
  photoEl.style.display="block";
  photoEl.style.visibility="visible";
  photoEl.onerror=null; // clear any previous handler first
  if(pid){
    photoEl.onerror=function(){this.style.visibility="hidden";this.onerror=null;};
    photoEl.src="https://sleepercdn.com/content/nfl/players/thumb/"+pid+".jpg";
  } else {
    photoEl.style.visibility="hidden";
    photoEl.src="data:,";
  }

  // ── Team logo ──
  var logoEl=document.getElementById("pm-team-logo");
  if(team&&team!=="FA"){logoEl.src="https://sleepercdn.com/images/team_logos/nfl/"+team.toLowerCase()+".png";logoEl.style.display="block";}
  else{logoEl.style.display="none";}

  // ── Trade history for this player (the hub view) ──
  renderPlayerTrades(pid,displayName);

  // ── Dynasty value ──
  var ktc=fc?fc.value:getKtcValue(displayName,pid);
  // words, never the raw market number - values run the math in the background
  document.getElementById("pm-ktc-val").textContent=ktc?playerTierLabel(ktc,pid).label:"-";
  var tierEl=document.getElementById("pm-ktc-tier");
  if(ktc&&fc){
    var _tl=trendLabel(fc.trend30Day||0);
    var tc=_tl.dir>0?"#22c55e":_tl.dir<0?"#f87171":"var(--muted)";
    var tbg=_tl.dir>0?"rgba(34,197,94,.12)":_tl.dir<0?"rgba(239,68,68,.12)":"var(--surface2)";
    tierEl.textContent=_tl.word;tierEl.style.color=tc;tierEl.style.background=tbg;tierEl.style.border="1px solid "+tbg;
  } else { tierEl.textContent=""; }
  // Labels follow the mode: a redraft user must never read "Dynasty Rank"
  var _isRed=(typeof leagueMode!=='undefined'&&leagueMode==='redraft');
  var _rankLbl=_isRed?"Redraft Rank":"Dynasty Rank";
  var _secLbl=_isRed?"Market":"Dynasty";

  // ── Dynasty meta stats from FantasyCalc ──
  var trend=fc&&fc.trend30Day?fc.trend30Day:null;
  var trendStr=trend!=null?((trendWord(trend).dir>0?"▲ ":trendWord(trend).dir<0?"▼ ":"→ ")+trendWord(trend).txt+" (30d)"):"-";
  var trendColor=trend>0?"var(--green)":trend<0?"var(--red)":"var(--muted)";
  var overallRank=fc&&fc.overallRank?"#"+fc.overallRank:"-";
  var posRank=fc&&fc.positionRank?pos+" #"+fc.positionRank:"-";
  var rosterPct=fc&&fc.rosterPercent!=null?fc.rosterPercent+"%":"-";

  // ── Placeholder stats grid until ESPN data arrives ──
  var grid=document.getElementById("pm-stats-grid");
  var depthOrder=p&&p.depth_chart_order!=null?p.depth_chart_order:null;
  var depthLabel=depthOrder===1?"Starter":depthOrder===2?"Backup":depthOrder!=null?"Depth #"+depthOrder:"-";
  if(grid){
    grid.innerHTML=
      stat(overallRank,_rankLbl)+
      stat(posRank,"Pos Rank")+
      stat("<span style='color:"+trendColor+"'>"+trendStr+"</span>","30-Day Trend")+
      stat(rosterPct,"Roster %")+
      stat(p&&p.age||"-","Age")+
      stat(depthLabel,"Depth Chart");
  }

  // ── Mac's Take: an opinionated read on the player, with the why ──
  var takeEl=document.getElementById('pm-sage-take');
  if(!takeEl&&grid){
    takeEl=document.createElement('div');
    takeEl.id='pm-sage-take';
    grid.parentNode.insertBefore(takeEl,grid.nextSibling);
  }
  if(takeEl){
    var noteEntry=getPlayerContextNote(displayName);
    if(noteEntry){
      // redraft mode never leads with the dynasty curve: the headline becomes
      // the first clause of the season note unless a curveRed line exists
      var _nm4=noteForMode(noteEntry);
      var curveTxt=(_nm4&&_nm4.curve)||'';
      var _clauses4=noteEntry.note.split(';').map(function(s){return s.trim();});
      var takeLine=curveTxt?(curveTxt.indexOf(' - ')>=0?curveTxt.split(' - ').slice(1).join(' - '):curveTxt):_clauses4[0];
      // when the headline came from the note itself, the why must not repeat it
      var whyParts=(curveTxt?_clauses4.slice(0,2):_clauses4.slice(1,3)).join('; ')||_clauses4[0];
      takeEl.innerHTML='<div style="margin:14px 0 4px;padding:14px 16px;background:var(--surface2);border:1px solid rgba(155,114,232,.25);border-radius:12px">'
        +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Mac\'s Take</div>'
        +'<div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--text);line-height:1.4;margin-bottom:6px">'+takeLine.charAt(0).toUpperCase()+takeLine.slice(1)+'</div>'
        +'<div style="font-size:12px;color:var(--muted2);line-height:1.6"><strong style="color:var(--text)">Why:</strong> '+whyParts+'.</div>'
        +'</div>';
      takeEl.style.display='block';
    } else {
      takeEl.style.display='none';
    }
  }

  // ── Identity rail extras: ADP + market direction under the bio ──
  try{
    var _info=modal.querySelector('.pm-info');
    var _dm=document.getElementById('pm-draftmeta');
    if(!_dm&&_info){_dm=document.createElement('div');_dm.id='pm-draftmeta';_dm.style.cssText='font-size:12px;color:var(--muted2);margin-top:8px;font-weight:600';_info.appendChild(_dm);}
    if(_dm){
      var _bits=[];
      var _adp=(pid&&window._adpById)?window._adpById[pid]:null;
      if(_adp!=null)_bits.push('ADP '+(+_adp).toFixed(1));
      if(fc)_bits.push(trendLabel(fc.trend30Day||0).word.toLowerCase()+' market');
      _dm.textContent=_bits.join(' · ');
    }
  }catch(_){}
  // ── Keep in mind: the curated draft narratives that apply to THIS player ──
  try{
    var _host=takeEl&&takeEl.parentNode;
    var _km=document.getElementById('pm-keepmind');
    if(!_km&&_host){_km=document.createElement('div');_km.id='pm-keepmind';_host.insertBefore(_km,takeEl.nextSibling);}
    if(_km){
      var _narr=(typeof mdNarratives==='function')?mdNarratives({id:pid,name:displayName,pos:pos,team:team}):[];
      _km.innerHTML=_narr.length
        ?'<div style="margin:0 0 12px;padding:12px 14px;background:var(--surface2);border-left:2px solid var(--border2);border-radius:10px">'
          +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Keep in mind</div>'
          +_narr.map(function(n){return '<div style="font-size:12px;color:var(--muted2);line-height:1.6;margin-top:4px">'+n+'</div>';}).join('')
          +'</div>'
        :'';
    }
  }catch(_){}
  // ── Draft day: if a mock is LIVE and he is still on the board, Mac's risk
  // lanes are one click away right here in the card ──
  try{
    var _sw=document.getElementById('pm-sage-wrap');
    if(!_sw&&takeEl&&takeEl.parentNode){
      _sw=document.createElement('div');_sw.id='pm-sage-wrap';
      var _kmEl=document.getElementById('pm-keepmind');
      takeEl.parentNode.insertBefore(_sw,_kmEl?_kmEl.nextSibling:takeEl.nextSibling);
    }
    if(_sw){
      var _bd=document.getElementById('md-board');
      var _inPool=!!(_bd&&_bd.dataset.live==='1'&&!MP.active&&MD.pool&&MD.pool.some(function(x){return x.id===pid;}));
      _sw.innerHTML=_inPool
        ?'<div style="margin:0 0 12px;padding:12px 14px;background:var(--surface2);border:1px solid rgba(155,114,232,.3);border-radius:10px">'
          +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Draft day</div>'
          +'<div style="font-size:12px;color:var(--muted2);line-height:1.55;margin-bottom:8px">Still on the board in your mock. One call gets Mac\'s risk lanes for this exact pick.</div>'
          +'<button class="btn-sm md-sage-ask" onclick="mdAskSageLive(\''+pid+'\',\'pm-sage-live\')">Ask Mac: my options here</button>'
          +'<div id="pm-sage-live" style="display:none"></div></div>'
        :'';
    }
  }catch(_){}

  // ── Season outlook ──
  renderOutlook(null, []); // clear while loading

  // External link removed per user request - all content shown inline

  modal.classList.add("open");
  document.body.style.overflow="hidden";

  // ── Fetch ESPN stats async - fills in the stats section ──
  if(espnId){
    fetch("/api/news/player/"+espnId+"?name="+encodeURIComponent(name||""))
      .then(function(r){return r.ok?r.json():null;})
      .then(function(espn){
        if(!espn||!espn.stats)return;
        // Better photo from ESPN if we have it
        if(espn.headshot){
          var ph=document.getElementById("pm-photo");
          if(ph&&!ph._espnLoaded){ph.src=espn.headshot;ph._espnLoaded=true;}
        }
        // Build stat grid: dynasty meta + real game stats
        var gameStats=espn.stats.map(function(s){return stat(s.val,s.name);}).join("");
        var dynStats=
          stat(overallRank,_rankLbl)+
          stat(posRank,"Pos Rank")+
          stat("<span style='color:"+trendColor+"'>"+trendStr+"</span>","30-Day Trend")+
          stat(rosterPct,"Roster %");
        if(grid){
          grid.innerHTML="<div style='grid-column:1/-1;font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;padding-bottom:2px;border-bottom:1px solid var(--border);margin-bottom:2px'>"+(espn.statsLabel||"Season Stats")+"</div>"
            +gameStats
            +"<div style='grid-column:1/-1;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:6px 0 2px;border-bottom:1px solid var(--border);margin-bottom:2px'>"+_secLbl+"</div>"
            +dynStats;
        }
        // Bio info
        var bio=[];
        if(espn.draft) bio.push("Draft: "+espn.draft);
        if(espn.experience) bio.push(espn.experience);
        if(espn.birthPlace) bio.push("From "+espn.birthPlace);
        if(espn.height&&espn.weight) bio.push(espn.height+" · "+espn.weight);
        renderOutlook(bio.length?bio.join("  ·  "):null, espn.articles||[]);
      })
      .catch(function(){});
  }
}

function renderOutlook(text, articles){
  var el=document.getElementById("pm-outlook");
  if(!el)return;
  var html="";
  if(text) html+="<div style='color:var(--muted2);margin-bottom:"+(articles&&articles.length?"8px":"0")+"'>"+text+"</div>";
  if(articles&&articles.length){
    html+="<div style='font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px'>Latest News</div>";
    var _esc=function(s){return String(s||'').replace(/</g,'&lt;');};
    html+=articles.map(function(a){
      var m=(typeof _srcMeta==='function'&&a.source)?_srcMeta(a.source):{c:'var(--muted)',label:a.source||''};
      var hl=_esc(a.headline);
      if(a.link)hl="<a href='"+a.link+"' target='_blank' rel='noopener' style='color:var(--text);text-decoration:none'>"+hl+" ↗</a>";
      var img=a.image?"<img src='"+a.image+"' style='width:54px;height:54px;border-radius:8px;object-fit:cover;flex-shrink:0' loading='lazy' onload=\"try{this.animate([{opacity:0},{opacity:1}],{duration:350,easing:'ease'})}catch(e){}\" onerror=\"this.style.display='none'\">":"";
      return "<div style='display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)'>"
        +img
        +"<div style='min-width:0;flex:1'>"
        +(m.label?"<div style='font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:"+m.c+";margin-bottom:2px'>"+m.label+"</div>":"")
        +"<div style='font-size:12px;color:var(--text);line-height:1.4;font-weight:500'>"+hl+"</div>"
        +(a.description?"<div style='font-size:11px;color:var(--muted);margin-top:2px;line-height:1.4'>"+_esc(a.description)+"</div>":"")
        +"</div></div>";
    }).join("");
  }
  if(html){el.innerHTML=html;el.style.display="block";}
  else{el.style.display="none";}
}

function stat(val,label){
  return "<div class='pm-stat'><div class='pm-stat-val'>"+val+"</div><div class='pm-stat-key'>"+label+"</div></div>";
}

function closePlayerCard(){
  var modal=document.getElementById("player-modal");
  if(modal)modal.classList.remove("open");
  document.body.style.overflow="";
}

document.addEventListener("keydown",function(e){if(e.key==="Escape")closePlayerCard();});
// ─── END PLAYER CARD MODAL ────────────────────────────────────────────────────

// ─── ROSTER GRADE ─────────────────────────────────────────────────────────────
function renderRosterGrade(){
  var el=document.getElementById("roster-grade-content");
  if(!el)return;
  if(!myRoster.length){
    el.innerHTML="<div class='empty-state'>Connect a league to grade your roster.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";
    return;
  }
  var numTeams=leagueRosters.length||10;
  // Compute every team's position KTC total (all players summed per position)
  var teamData=leagueRosters.map(function(roster){
    var pids=roster.players||[];
    var byPos={QB:0,RB:0,WR:0,TE:0,total:0};
    pids.forEach(function(pid){
      var p=allPlayers[pid],v=ktcById[pid]||0;
      if(p&&byPos[p.pos]!==undefined)byPos[p.pos]+=v;
      byPos.total+=v;
    });
    return{owner:roster.owner_id,byPos:byPos,isMe:roster.owner_id===userId};
  });
  var myTeam=teamData.find(function(t){return t.isMe;})||{byPos:{QB:0,RB:0,WR:0,TE:0,total:0}};
  function rankNum(myVal,key){
    var vals=teamData.map(function(t){return key?t.byPos[key]:t.byPos.total;});
    return vals.filter(function(v){return v>myVal;}).length+1;
  }
  function pctile(myVal,key){
    var vals=teamData.map(function(t){return key?t.byPos[key]:t.byPos.total;});
    if(!vals.length)return 50;
    return Math.round(vals.filter(function(v){return v<myVal;}).length/vals.length*100);
  }
  function pctToLetter(pct){
    if(pct>=90)return 'A+';if(pct>=78)return 'A';if(pct>=65)return 'B+';
    if(pct>=52)return 'B';if(pct>=38)return 'C+';if(pct>=25)return 'C';
    if(pct>=12)return 'D';return 'F';
  }
  var posGrades={};
  ['QB','RB','WR','TE'].forEach(function(pos){
    var myVal=myTeam.byPos[pos];
    var pct=pctile(myVal,pos);
    posGrades[pos]={
      pct:pct,rank:rankNum(myVal,pos),letter:pctToLetter(pct),
      gc:pct>=65?'var(--green)':pct>=38?'var(--yellow)':'var(--red)',
      players:myRoster.filter(function(p){return p.pos===pos;}).sort(function(a,b){return(ktcById[b.id]||0)-(ktcById[a.id]||0);})
    };
  });
  var overallPct=pctile(myTeam.byPos.total,null);
  var overallRank=rankNum(myTeam.byPos.total,null);
  var overallLetter=pctToLetter(overallPct);
  var gradeClass='grade-'+overallLetter.replace('+','');
  var skillPlayers=myRoster.filter(function(p){return['RB','WR','QB'].indexOf(p.pos)>=0&&(ktcById[p.id]||0)>2000;}).slice(0,8);
  var avgAge=skillPlayers.length?Math.round(skillPlayers.reduce(function(s,p){return s+(p.age||26);},0)/skillPlayers.length*10)/10:26;
  var winLabel,winColor,winDesc;
  if(avgAge<24){winLabel='Building';winColor='var(--accent-bright)';winDesc='Your core is young. Give it 1–2 years - this team will be scary.';}
  else if(avgAge<26){winLabel='Prime Window';winColor='var(--green)';winDesc='Your core is in peak years. Push chips in - this is your window.';}
  else if(avgAge<28.5){winLabel='Window Closing';winColor='var(--yellow)';winDesc='Your starters are hitting late-prime. Start thinking about selling veterans high.';}
  else{winLabel='Rebuild Time';winColor='var(--red)';winDesc='Your core is aging out. Move veterans for youth and picks while you still can.';}
  var pickCount=myPicks.length;
  var pickLabel=pickCount>=6?'Strong':pickCount>=3?'Average':'Light';
  var html='<div style="font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.5">How this works: we total the live market value of every roster in your league, position by position, and grade yours against them. A = top of the league, C = middle, F = bottom.</div>';
  html+='<div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;margin-bottom:20px">';
  html+='<div style="text-align:center"><div class="grade-letter '+gradeClass+'">'+overallLetter+'</div>';
  html+='<div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Overall</div>';
  html+='<div style="font-size:12px;font-weight:600;color:var(--muted2);margin-top:4px">#'+overallRank+' of '+numTeams+'</div></div>';
  html+='<div><div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:8px">'+leagueFormat.formatLabel+'</div>';
  if(leagueMode!=='redraft'){
    html+='<div style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:6px 12px;margin-bottom:8px">';
    html+='<div style="width:8px;height:8px;border-radius:50%;background:'+winColor+'"></div>';
    html+='<span style="font-size:13px;font-weight:600;color:'+winColor+'">'+winLabel+'</span></div>';
    html+='<div style="font-size:12px;color:var(--muted2);line-height:1.5">'+winDesc+'</div>';
  }
  html+='</div></div>';
  html+='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;margin-bottom:16px">';
  html+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px">Position Breakdown - Ranked vs. Your League</div>';
  ['QB','RB','WR','TE'].forEach(function(pos){
    var g=posGrades[pos];
    html+='<div class="pos-grade-row">';
    html+='<div style="font-size:18px;font-weight:700;font-family:var(--font-head);color:'+g.gc+'">'+g.letter+'</div>';
    html+='<div><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px">'+pos+'</div>';
    if(g.players.length){
      html+='<div style="display:flex;flex-wrap:wrap;gap:6px">';
      g.players.forEach(function(p){
        html+='<span onclick="openPlayerCard(\''+p.id+'\',\''+String(p.name).replace(/'/g,"\\'")+'\')" style="display:inline-flex;align-items:center;gap:7px;background:var(--surface3);border:1px solid var(--border);border-radius:100px;padding:4px 13px 4px 4px;font-size:12px;font-weight:600;color:var(--text);cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor=\'rgba(155,114,232,.5)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
          +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
          +p.name+'</span>';
      });
      html+='</div>';
    }
    html+='</div>';
    html+='<div style="text-align:right"><div style="font-size:12px;font-weight:700;color:'+g.gc+'">#'+g.rank+' of '+numTeams+'</div>';
    html+='<div style="font-size:10px;color:var(--muted)">'+g.pct+'th pct</div></div></div>';
  });
  html+='</div>';
  if(leagueMode!=='redraft'){
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
    var picksList='';
    if(myPicks.length){
      picksList='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">'+myPicks.map(function(pk){
        return '<span style="font-size:10px;font-weight:600;background:var(--accent-dim);color:var(--accent-bright);border-radius:100px;padding:2px 8px">'+(pk.label||pk.season+' R'+pk.round)+'</span>';
      }).join('')+'</div>';
    }
    html+='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px">Pick Capital</div><div style="font-size:22px;font-weight:700;color:var(--accent-bright)">'+pickLabel+'</div><div style="font-size:11px;color:var(--muted)">'+pickCount+' future picks</div>'+picksList+'</div>';
    html+='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px">Avg Core Age</div><div style="font-size:22px;font-weight:700;color:'+winColor+'">'+avgAge+'</div><div style="font-size:11px;color:var(--muted)">yrs (top skill players)</div></div>';
    html+='</div>';
  }
  window._gradeData={letter:overallLetter,rank:overallRank,teams:numTeams,pos:posGrades,winLabel:winLabel,winColor:winColor,avgAge:avgAge,picks:pickCount};
  html+='<div style="text-align:center;margin-top:14px"><button class="btn-load" style="width:auto;padding:11px 26px" onclick="downloadRosterCard()">Download roster card</button><div style="font-size:10px;color:var(--muted);margin-top:6px">A shareable image of your grade. Post it in the group chat.</div></div>';
  el.innerHTML=html;
}

// Shareable roster-card PNG, drawn on canvas with proxied headshots
async function downloadRosterCard(){
  var g=window._gradeData;
  if(!g)return;
  var W=1000,H=600,SCALE=2;
  var cv=document.createElement('canvas');cv.width=W*SCALE;cv.height=H*SCALE;
  var ctx=cv.getContext('2d');ctx.scale(SCALE,SCALE);
  // Background
  var grad=ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0,'#141828');grad.addColorStop(1,'#221a3f');
  ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
  ctx.fillStyle='rgba(155,114,232,.09)';
  ctx.beginPath();ctx.arc(W-120,90,220,0,7);ctx.fill();
  // Brand
  ctx.fillStyle='#9b72e8';ctx.font='700 26px Unbounded, sans-serif';
  ctx.fillText('MAC DRAFT',48,70);
  ctx.fillStyle='#7c8aaa';ctx.font='500 15px Outfit, sans-serif';
  ctx.fillText('ROSTER GRADE · '+(leagueName||'My League'),48,98);
  // Big letter
  ctx.fillStyle='#9b72e8';ctx.font='800 150px Unbounded, sans-serif';
  ctx.fillText(g.letter,48,265);
  ctx.fillStyle='#e8ecf8';ctx.font='600 22px Outfit, sans-serif';
  ctx.fillText('#'+g.rank+' of '+g.teams+' teams',48,300);
  ctx.fillStyle=g.winColor&&g.winColor.indexOf('var')<0?g.winColor:'#22c55e';
  ctx.font='700 20px Outfit, sans-serif';
  ctx.fillText(g.winLabel+'  ·  avg core age '+g.avgAge,48,332);
  // Position grades
  var px=48;
  ['QB','RB','WR','TE'].forEach(function(pos){
    var pg=g.pos[pos];if(!pg)return;
    ctx.fillStyle='rgba(255,255,255,.05)';
    ctx.fillRect(px,368,200,90);
    ctx.fillStyle='#7c8aaa';ctx.font='600 14px Outfit, sans-serif';
    ctx.fillText(pos,px+16,395);
    ctx.fillStyle='#e8ecf8';ctx.font='800 40px Unbounded, sans-serif';
    ctx.fillText(pg.letter,px+16,442);
    ctx.fillStyle='#7c8aaa';ctx.font='500 13px Outfit, sans-serif';
    ctx.fillText('#'+pg.rank+' of '+g.teams,px+85,438);
    px+=225;
  });
  // Top players with headshots via same-origin proxy
  var tops=myRoster.slice().sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,5);
  var hx=48;
  for(var i=0;i<tops.length;i++){
    var p=tops[i];
    try{
      var img=new Image();
      img.src='/api/sleeper/img?u='+encodeURIComponent('https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg');
      await new Promise(function(res){img.onload=res;img.onerror=res;setTimeout(res,2500);});
      if(img.naturalWidth){
        ctx.save();ctx.beginPath();ctx.arc(hx+30,520,30,0,7);ctx.clip();
        ctx.drawImage(img,hx,490,60,60);ctx.restore();
        ctx.strokeStyle='#9b72e8';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(hx+30,520,30,0,7);ctx.stroke();
      }
    }catch(_){}
    ctx.fillStyle='#a8b0c8';ctx.font='500 11px Outfit, sans-serif';
    var nm=p.name.split(' ');
    ctx.textAlign='center';
    ctx.fillText(nm[nm.length-1],hx+30,570);
    ctx.textAlign='left';
    hx+=110;
  }
  // Footer
  ctx.fillStyle='#7c8aaa';ctx.font='500 13px Outfit, sans-serif';
  ctx.textAlign='right';
  ctx.fillText('Mac Draft',W-40,H-24);
  ctx.textAlign='left';
  cv.toBlob(function(blob){
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='macdraft-roster-grade.png';
    a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);},4000);
  },'image/png');
}
// ─── END ROSTER GRADE ──────────────────────────────────────────────────────────

// Buy/Sell tab is split into two views so the page isn't one endless scroll.
function bsView(which,btn){
  var sig=document.getElementById('bs-view-signals');
  var st=document.getElementById('bs-view-stash');
  if(sig)sig.style.display=which==='signals'?'block':'none';
  if(st)st.style.display=which==='stash'?'block':'none';
  var seg=document.getElementById('bs-seg');
  if(seg)seg.querySelectorAll('.ctx-seg-btn').forEach(function(b){b.classList.toggle('active',btn?b===btn:false);});
  if(which==='stash'){try{renderWaiverTargets();}catch(_){}}
  else{try{renderBuySell();}catch(_){}}
}
// ─── BUY / SELL ALERTS ────────────────────────────────────────────────────────
function renderBuySell(){
  var el=document.getElementById("buysell-content");
  if(!el)return;
  if(!myRoster.length||!Object.keys(ktcFull).length){
    el.innerHTML="<div class='empty-state'>Connect a league first so player values can load.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";
    return;
  }
  // My positional depth vs. league average
  var myPosCount={QB:0,RB:0,WR:0,TE:0};
  myRoster.forEach(function(p){if(myPosCount[p.pos]!==undefined)myPosCount[p.pos]++;});
  var leaguePosCount={QB:0,RB:0,WR:0,TE:0};
  var numRosters=leagueRosters.length||1;
  leagueRosters.forEach(function(r){
    (r.players||[]).forEach(function(pid){var p=allPlayers[pid];if(p&&leaguePosCount[p.pos]!==undefined)leaguePosCount[p.pos]++;});
  });
  var leaguePosAvg={};
  Object.keys(leaguePosCount).forEach(function(pos){leaguePosAvg[pos]=leaguePosCount[pos]/numRosters;});
  // Count how many STARTABLE-caliber players you roster at each position (positional
  // rank inside a pool sized to the league), then compare to how many you must start.
  // Key nuances: one elite WR does NOT fill a WR room full of trash (you start 2-3),
  // but one elite TE DOES fill your lone TE slot - bench TE is then a want, not urgent.
  var lf=leagueFormat||{};
  var _slots={QB:(lf.numQBs||1)+((lf.hasSuperFlex||lf.has2QB)?0.6:0),RB:(lf.numRBs||2),WR:(lf.numWRs||2),TE:(lf.numTEs||1)};
  var _flex=(lf.flexCount||1)+(lf.recFlexCount||0);
  _slots.RB+=_flex*0.4;_slots.WR+=_flex*0.5;_slots.TE+=_flex*0.1;
  var _startableCeil={};['QB','RB','WR','TE'].forEach(function(p){_startableCeil[p]=Math.max(6,Math.ceil(numRosters*_slots[p]));});
  var myStartable={QB:0,RB:0,WR:0,TE:0};
  myRoster.forEach(function(pl){
    var fc=ktcFull[pl.id];
    if(fc&&fc.positionRank&&myStartable[pl.pos]!==undefined&&fc.positionRank<=_startableCeil[pl.pos])myStartable[pl.pos]++;
  });
  // Urgent starting need: not enough startable bodies to fill your starting slots.
  function needsPos(pos){return myStartable[pos]<Math.max(1,Math.round(_slots[pos]));}
  // Thin depth (a want, not urgent): starters covered, but no real backup behind them.
  function depthNeedPos(pos){return !needsPos(pos)&&myPosCount[pos]<=Math.ceil(_slots[pos]);}
  function hasDepth(pos){return myPosCount[pos]>(leaguePosAvg[pos]||3)*1.15;}

  var isR=leagueMode==='redraft';
  var myIds=new Set(myRoster.map(function(p){return p.id;}));
  var players=Object.entries(ktcFull).filter(function(e){
    return e[1].value>400&&['QB','RB','WR','TE'].indexOf(e[1].position)>=0;
  }).map(function(e){
    var pid=e[0],fc=e[1],p=allPlayers[pid];
    return{id:pid,name:fc.name||(p&&p.name)||pid,pos:fc.position,team:(p&&p.team)||'FA',
      value:isR&&fc.redraftValue>0?fc.redraftValue:fc.value,trend:fc.trend30Day||0,posRank:fc.positionRank||null,age:(p&&p.age)||25,iOwn:myIds.has(pid)};
  });

  function vary(p,arr){var h=0,s=String(p.id||p.name);for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return arr[h%arr.length];}
  // Football-situation reason pulled from the (July 2026) player notes:
  // captures things like new OC, new QB, target competition leaving, scheme change, injuries
  function footballReason(p){
    var note=getPlayerContextNote(p.name);
    if(!note)return '';
    var parts=note.note.split(';').map(function(s){return s.trim();}).filter(Boolean);
    return '<strong style="color:var(--text)">The football:</strong> '+parts.slice(0,2).join('; ')+'. ';
  }
  function fitReason(p,buying){
    if(buying){
      if(needsPos(p.pos))return '<strong style="color:var(--text)">Your roster:</strong> you\'re short on startable '+p.pos+'s - this fills a real starting hole.';
      if(depthNeedPos(p.pos))return '<strong style="color:var(--text)">Your roster:</strong> your '+p.pos+' starters are set, but you\'re thin behind them - useful depth, not urgent.';
      return '<strong style="color:var(--text)">Your roster:</strong> you\'re set at '+p.pos+', so only pay if the value is right.';
    }
    return hasDepth(p.pos)?'<strong style="color:var(--text)">Your roster:</strong> you have surplus '+p.pos+' depth - you can absorb this loss without breaking your lineup.':'<strong style="color:var(--text)">Your roster:</strong> you\'re thin at '+p.pos+' - only sell if the return fixes another position.';
  }

  // Sell High: own + trending UP + age 27+ (sell at peak before decline)
  var sellHigh=players.filter(function(p){return p.iOwn&&p.trend>=100&&(isR||p.age>=27);})
    .map(function(p){
      return Object.assign({},p,{reason:footballReason(p)+'<strong style="color:var(--text)">The market:</strong> '+vary(p,['age '+p.age+' and climbing. Peaks like this are when smart managers cash out','the price is up while the age curve says down. That gap is your profit','you will never sell him for more than right now. That is the whole case','veterans get paid on reputation right up until they do not. Sell into the reputation'])+'. '+fitReason(p,false)});
    }).sort(function(a,b){return b.trend-a.trend;}).slice(0,15);

  // Sell Now: own + trending DOWN + age 27+ (declining veteran)
  var sellNow=players.filter(function(p){return p.iOwn&&p.trend<=-150&&(isR||p.age>=27);})
    .filter(function(p){return !sellHigh.find(function(s){return s.id===p.id;});})
    .map(function(p){
      return Object.assign({},p,{reason:footballReason(p)+'<strong style="color:var(--text)">The market:</strong> '+vary(p,['sliding at age '+p.age+'. This price does not bounce back, it bleeds','every week you hold is money burning. Someone in your league still believes - find them','the market has decided and it is not changing its mind. Get whatever you can','age '+p.age+' with a falling price is the market telling you the story ended'])+'. '+fitReason(p,false)});
    }).sort(function(a,b){return a.trend-b.trend;}).slice(0,15);

  // Buy Low: don't own + trending DOWN. Elite players STAY eligible - you can buy low
  // on a star after a genuinely poor year (Jefferson, Nico). What we exclude is a small
  // wobble off a CAREER-YEAR peak (JSN, Maye) - that's early regression, not a discount.
  // The tell is magnitude relative to value: a real buy-low is a big markdown (>=5% of
  // value in 30 days); a peak wobble is a tiny % dip on a huge value.
  var buyLow=players.filter(function(p){
    if(p.iOwn||p.value<1500)return false;
    if(!(isR?p.value>=2500:p.age<=27))return false;
    var dropPct=p.value>0?(-p.trend/p.value):0; // trend is negative for a faller
    return p.trend<0&&dropPct>=0.05;
  })
    .map(function(p){
      return Object.assign({},p,{reason:footballReason(p)+'<strong style="color:var(--text)">The market:</strong> '+vary(p,leagueMode==='redraft'?['a proven scorer whose price just dipped. In redraft you buy the production, not the narrative','his owner is panicking over a slow stretch. Weekly points do not disappear that fast','the dip is noise. His role and targets are intact and that is what scores on Sunday','buy the down week. Sell the down month. This is a down week']:['a '+p.age+'-year-old on sale. Panicking managers are your best friends','the dip is real but the talent did not go anywhere. This is how you buy stars at starter prices','his owner is staring at the falling number and sweating. Text them today','young player, temporary problem, discounted price. That is the whole formula'])+'. '+fitReason(p,true)});
    }).sort(function(a,b){return b.value-a.value;}).slice(0,15);

  // Buy Now: don't own + trending UP + you need that position
  var buyNow=players.filter(function(p){return !p.iOwn&&p.trend>=150&&needsPos(p.pos);})
    .map(function(p){
      return Object.assign({},p,{reason:footballReason(p)+'<strong style="color:var(--text)">The market:</strong> '+vary(p,['the market is waking up to him. Every week you wait costs you more','momentum like this usually runs further than people expect. Get in front of it','his price is moving because the role is real. Pay today\'s price, not next month\'s','buy him before his next big week does the negotiating against you'])+'. '+fitReason(p,true)});
    }).sort(function(a,b){return b.trend-a.trend;}).slice(0,15);

  // Watch: rising + young, not already in buyNow
  var watchList=players.filter(function(p){
    return !p.iOwn&&p.trend>=200&&p.age<=26&&!buyNow.find(function(b){return b.id===p.id;});
  }).map(function(p){
    return Object.assign({},p,{reason:footballReason(p)+'<strong style="color:var(--text)">The market:</strong> up '+pctMove(p)+' in 30 days at age '+p.age+'. Not screaming buy yet, but if he keeps this pace the price gets away from you. '+fitReason(p,true)});
  }).sort(function(a,b){return b.trend-a.trend;}).slice(0,12);

  // Rotate the pools so Refresh shows different suggestions each time
  function _rot(arr){
    if(arr.length<=5)return arr;
    var off=(window._bsOffset||0)%arr.length;
    var out=arr.slice(off,off+5);
    if(out.length<5)out=out.concat(arr.slice(0,5-out.length));
    return out;
  }
  sellHigh=_rot(sellHigh);sellNow=_rot(sellNow);buyLow=_rot(buyLow);buyNow=_rot(buyNow);watchList=_rot(watchList).slice(0,4);

  // How to pay for buys: your cheapest surplus piece at your deepest position
  var deepPos=Object.keys(myPosCount).sort(function(a,b){return (myPosCount[b]/(leaguePosAvg[b]||3))-(myPosCount[a]/(leaguePosAvg[a]||3));})[0];
  var surplus=myRoster.filter(function(p){return p.pos===deepPos;})
    .map(function(p){return {name:p.name,ktc:getKtcValue(p.name,p.id)};})
    .filter(function(p){return p.ktc>800;})
    .sort(function(a,b){return a.ktc-b.ktc;});
  var payWith=surplus.length>2?surplus[Math.floor(surplus.length/2)]:null;
  var needPos1=Object.keys(myPosCount).sort(function(a,b){return (myPosCount[a]/(leaguePosAvg[a]||3))-(myPosCount[b]/(leaguePosAvg[b]||3));})[0];
  function payLine(){return payWith?' <strong style="color:var(--text)">How to pay:</strong> start the offer around '+payWith.name+' ('+deepPos+' depth you can spare) plus a pick, and adjust from there.':'';}
  function targetLine(){return ' <strong style="color:var(--text)">What to ask back:</strong> target '+needPos1+' help or picks - that\'s where your roster actually needs the value to land.';}
  buyNow.forEach(function(p){p.reason+=payLine();});
  buyLow.forEach(function(p){p.reason+=payLine();});
  sellHigh.forEach(function(p){p.reason+=targetLine();});
  sellNow.forEach(function(p){p.reason+=targetLine();});

  var posColors={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  window._bsPlayers=window._bsPlayers||[];
  window._bsPlayers.length=0;
  function pRow(p){
    var idx=window._bsPlayers.length;
    window._bsPlayers.push(p);
    var col=posColors[p.pos]||'var(--muted)';
    var trendCol=p.trend>0?'var(--green)':'var(--red)';
    var trendStr=trendWord(p.trend).txt;
    return '<div class="bs-row">'
      +'<div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="toggleBsWhy('+idx+')">'
      +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0" onclick="event.stopPropagation();openBsCard('+idx+')" onerror="this.style.display=\'none\'">'
      +'<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+p.name
      +' <span style="font-size:10px;font-weight:700;color:'+col+'">'+p.pos+'</span>'
      +(p.age?'<span style="font-size:10px;color:var(--muted);margin-left:4px">Age '+p.age+'</span>':'')+'</div>'
      +'<div style="font-size:11px;color:var(--muted)">'+(p.posRank?p.pos+' #'+p.posRank:playerTierLabel(p.value).short)+' · '+teamLogo(p.team)+(p.team||'FA')+'</div></div>'
      +'<div style="text-align:right"><div style="font-size:12px;font-weight:700;color:'+trendCol+'">'+trendStr+'</div>'
      +'<div style="font-size:10px;color:var(--muted)">30d</div></div>'
      +'<span id="bs-caret-'+idx+'" style="font-size:10px;color:var(--accent-bright);font-weight:700;white-space:nowrap;background:var(--accent-dim);border:1px solid rgba(155,114,232,.3);border-radius:100px;padding:3px 10px">Why?</span></div>'
      +(p.reason?'<div id="bs-why-'+idx+'" style="display:none;font-size:11px;color:var(--muted2);line-height:1.6;padding:10px 2px 2px 40px;margin-top:6px;border-top:1px solid var(--border)">'+p.reason+'</div>':'')
      +'</div>';
  }
  function section(pill,pillClass,list,empty){
    var h='<div style="margin-bottom:20px"><div style="margin-bottom:8px"><span class="signal-pill '+pillClass+'">'+pill+'</span></div>';
    h+=list.length?'<div>'+list.map(pRow).join('')+'</div>':'<div style="font-size:12px;color:var(--muted);padding:4px 0">'+empty+'</div>';
    return h+'</div>';
  }
  var html='<div style="font-size:11px;color:var(--muted);margin-bottom:16px;padding:8px 10px;background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border)">Signals factor in your team\'s positional needs, player age curve, and live FantasyCalc market values. Falling value on a young player = buy opportunity, not a sell signal.</div>';
  // auto-fit + min() so the two signal columns become one when there is not
  // room for both. Plain `1fr 1fr` never shrinks past its content, so on a
  // phone the second column started past the right edge of the screen and took
  // its player rows with it.
  html+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:20px">';
  html+='<div><div style="font-size:13px;font-weight:700;color:var(--green);border-bottom:2px solid var(--green);padding-bottom:6px;margin-bottom:14px">Buy Side</div>';
  if(!buyNow.length&&!buyLow.length&&!watchList.length){
    html+='<div style="font-size:12px;color:var(--muted)">No strong buy signals right now based on your team needs.</div>';
  } else {
    if(buyNow.length)html+=section('Buy Now - Fills Your Need','pill-buy',buyNow,'');
    if(buyLow.length)html+=section('Buy Low - Young + Down','pill-watch',buyLow,'');
    if(watchList.length)html+=section('Watch','pill-watch',watchList,'');
  }
  html+='</div>';
  html+='<div><div style="font-size:13px;font-weight:700;color:var(--red);border-bottom:2px solid var(--red);padding-bottom:6px;margin-bottom:14px">Sell Side (your roster)</div>';
  if(!sellHigh.length&&!sellNow.length){
    html+='<div style="font-size:12px;color:var(--muted)">No strong sell signals on your roster right now.</div>';
  } else {
    if(sellHigh.length)html+=section('Sell High - At Peak Value','pill-sell',sellHigh,'');
    if(sellNow.length)html+=section('Sell Now - Declining Veteran','pill-sell',sellNow,'');
  }
  html+='</div></div>';
  el.innerHTML=html;
}
function toggleBsWhy(idx){
  var w=document.getElementById('bs-why-'+idx);
  var c=document.getElementById('bs-caret-'+idx);
  if(!w)return;
  var open=w.style.display!=='none';
  w.style.display=open?'none':'block';
  if(c)c.textContent=open?'Why?':'Hide';
}
function openBsCard(idx){
  var p=window._bsPlayers&&window._bsPlayers[idx];
  if(p)openPlayerCard(p.id,p.name);
}
// ─── END BUY / SELL ────────────────────────────────────────────────────────────

// ─── COMPARE PLAYERS ──────────────────────────────────────────────────────────
var cmpSelected=[null,null,null];
var _cmpSlotN=3;
function addCompareSlot(){
  var grid=document.getElementById('cmp-slots');
  if(!grid)return;
  _cmpSlotN++;
  var i=_cmpSlotN;
  var d=document.createElement('div');
  d.innerHTML='<div class="field-label">Player '+i+'</div>'
    +'<div class="ac-wrap" style="display:block">'
    +'<input type="text" class="tm-input" style="width:100%" id="cmp-p'+i+'" placeholder="Search player..." oninput="cmpAcInput(this,'+i+')" onfocus="cmpAcInput(this,'+i+')" onblur="cmpAcHide('+i+')" autocomplete="off">'
    +'<div class="ac-dropdown" id="cmp-ac'+i+'"></div></div>';
  grid.appendChild(d);
  var inp=d.querySelector('input');if(inp)inp.focus();
}
function cmpAcInput(input,n){
  var q=input.value.toLowerCase().trim();
  var dd=document.getElementById('cmp-ac'+n);
  if(!dd)return;
  var src=Object.keys(allPlayers).length>0?Object.values(allPlayers):FALLBACK_PLAYERS;
  var results=src.filter(function(p){return p&&p.name&&(!q||p.name.toLowerCase().indexOf(q)>=0)&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;})
    .sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,q?8:10);
  if(!results.length){dd.classList.remove('open');return;}
  var posColors={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  dd.innerHTML='';
  results.forEach(function(p){
    var col=posColors[p.pos]||'var(--muted)';
    var ktc=ktcById[p.id]||0;
    var d=document.createElement('div');
    d.className='ac-item';
    d.style.cssText='display:flex;align-items:center;gap:8px';
    d.innerHTML='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--surface3)" onerror="this.style.visibility=\'hidden\'">'
      +'<span style="flex:1"></span>'
      +'<span class="ac-pos" style="color:'+col+';font-size:10px;font-weight:700">'+p.pos+'</span>'
      +(p.team&&p.team!=='FA'?'<img src="https://sleepercdn.com/images/team_logos/nfl/'+p.team.toLowerCase()+'.png" style="width:18px;height:18px;object-fit:contain" onerror="this.style.display=\'none\'">':'<span class="ac-team" style="font-size:10px">FA</span>');
    d.children[1].textContent=p.name;
    d.addEventListener('mousedown',function(){cmpSelect(n,p.id,p.name);});
    dd.appendChild(d);
  });
  dd.classList.add('open');
}
function cmpAcHide(n){setTimeout(function(){var dd=document.getElementById('cmp-ac'+n);if(dd)dd.classList.remove('open');},150);}
function cmpSelect(n,pid,name){
  try{sndPickSoft();}catch(_){}
  var input=document.getElementById('cmp-p'+n);
  if(input)input.value=name;
  cmpSelected[n-1]={id:pid,name:name};
  var dd=document.getElementById('cmp-ac'+n);
  if(dd)dd.classList.remove('open');
  if(cmpSelected[0]&&cmpSelected[1])renderCompare();   // 3rd slot optional - re-renders when picked
}
function renderCompare(){
  var el=document.getElementById('compare-result');
  if(!el)return;
  var ps=cmpSelected.filter(Boolean);
  if(ps.length<2){el.style.display='none';return;}
  var fcs=ps.map(function(p){return ktcFull[p.id]||null;});
  var aps=ps.map(function(p){return allPlayers[p.id]||null;});
  var vals=fcs.map(function(f){return f?f.value:0;});
  var poss=ps.map(function(p,i){return (fcs[i]&&fcs[i].position)||(aps[i]&&aps[i].pos)||'?';});
  var n=ps.length;

  function cmpRow(label,cells,lowerBetter){
    var nums=cells.map(function(v){var x=parseFloat(String(v).replace(/[^0-9.-]/g,''));return isNaN(x)?null:x;});
    var known=nums.filter(function(x){return x!==null;});
    var best=null,worst=null;
    if(known.length>=2){
      best=lowerBetter?Math.min.apply(null,known):Math.max.apply(null,known);
      worst=lowerBetter?Math.max.apply(null,known):Math.min.apply(null,known);
      if(best===worst){best=null;worst=null;}
    }
    var cellsHtml=cells.map(function(v,i){
      var c='var(--text)';
      if(nums[i]!==null&&best!==null){if(nums[i]===best)c='var(--green)';else if(nums[i]===worst)c='var(--red)';}
      return '<div style="text-align:center;font-size:13px;font-weight:600;color:'+c+'">'+v+'</div>';
    }).join('');
    return '<div style="display:grid;grid-template-columns:88px repeat('+n+',1fr);gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'
      +'<div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">'+label+'</div>'
      +cellsHtml+'</div>';
  }

  var posColors={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  var cards=ps.map(function(p,i){
    var col=posColors[poss[i]]||'var(--muted)';
    return '<div style="background:var(--surface2);border-radius:var(--radius);padding:12px;display:flex;align-items:center;gap:10px;min-width:0">'
      +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid '+col+'" onerror="this.style.visibility=\'hidden\'">'
      +'<div style="min-width:0"><div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+'</div>'
      +'<div style="font-size:11px;color:var(--muted)"><span style="color:'+col+';font-weight:700">'+poss[i]+'</span> · '+teamLogo(aps[i]&&aps[i].team,13)+((aps[i]&&aps[i].team)||'FA')+'</div></div></div>';
  }).join('');

  var html='<div style="display:grid;grid-template-columns:88px repeat('+n+',1fr);gap:8px;margin-bottom:14px"><div></div>'+cards+'</div>';
  html+=cmpRow((leagueMode==='redraft'?'Redraft':'Dynasty')+' Tier',vals.map(function(v,i){return v?playerTierLabel(v,ps[i]&&ps[i].id).label:'-';}),false);
  html+=cmpRow('Overall Rank',fcs.map(function(f){return f&&f.overallRank?'#'+f.overallRank:'-';}),true);
  html+=cmpRow('Pos Rank',fcs.map(function(f,i){return f&&f.positionRank?poss[i]+' #'+f.positionRank:'-';}),true);
  html+=cmpRow('30-Day Trend',fcs.map(function(f){var t=f&&f.trend30Day||0;return t>250?'Rising fast':t>60?'Rising':t<-250?'Falling fast':t<-60?'Falling':'Steady';}),false);
  html+=cmpRow('Age',aps.map(function(a){return a&&a.age?a.age+' yrs':'-';}),true);
  html+=cmpRow('Experience',aps.map(function(a){return a&&a.exp!=null?a.exp+'yr':'-';}),false);
  if(window._vegasProj){
    html+=cmpRow('Vegas prop projection',aps.map(function(a){
      var vp=a&&a.name?vegasProjFor(a.name):null;
      return vp!=null?vp.toFixed(1)+' pts':'-';}),false);
  }

  var ranked=ps.map(function(p,i){return {p:p,v:vals[i]};}).filter(function(x){return x.v;}).sort(function(a,b){return b.v-a.v;});
  if(ranked.length>=2){
    var top=ranked[0],second=ranked[1],gap=top.v-second.v;
    var gapDesc=gap>2000?'significantly more valuable':gap>700?'more valuable':'slightly ahead right now';
    html+='<div style="margin-top:12px;padding:12px;background:var(--accent-dim);border:1px solid rgba(155,114,232,.3);border-radius:var(--radius);font-size:12.5px;line-height:1.6;color:var(--muted2)">'
      +'<strong style="color:var(--text)">'+top.p.name+'</strong> is '+gapDesc
      +(ranked.length===3?' of the three':'')+'. ';
    if(gap<400)html+='Close enough that fit and age should break the tie.';
    else if(gap<1200)html+='The gap is real but the others are still solid players.';
    else html+='Do not trade '+second.p.name+' for '+top.p.name+' straight-up - the gap is too wide.';
    html+='</div>';
  }
  el.innerHTML=html;el.style.display='block';
}
// ─── END COMPARE ──────────────────────────────────────────────────────────────

// ─── ALL PLAYERS DATABASE ─────────────────────────────────────────────────────
var pdbAllPlayers=[];
var pdbFiltered=[];
var pdbAdvOpen=false;

// Advanced stats for top dynasty players (2023/2024 season data)
// Sources: Next Gen Stats, PFF, Matt Harmon Reception Perception, FantasyCalc
// routePct = Route Participation % (% of team dropbacks player runs a route)
// tgtShare = Target Share % (player targets / team targets)
// yprr     = Yards Per Route Run (receiving yards / routes run) - elite WR = 2.0+
// ayShare  = Air Yards Share % (player air yards / team air yards)
// yacRec   = YAC Per Reception (yards after catch per catch)
// snapPct  = Snap Participation %
// tier     = elite / starter / flex / bench
// Advanced stats come from nflverse (2025 season), computed from real play-by-play
// and keyed by NAME programmatically. This replaced a hand-typed id-keyed block
// that had 31 of 44 entries on the wrong player (the Najee Harris "target hog"
// era). Never key stats by hand-entered ids again.
window._advStats=null;
var _advStatsPromise=null;
function loadAdvStats(){
  if(_advStatsPromise)return _advStatsPromise;
  _advStatsPromise=fetch('/api/stats/adv').then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(d&&d.players){window._advStats=d.players;window._advSeason=d.season;window._advDst=d.dst||{};
      try{if(typeof filterPlayersDB==='function'&&document.getElementById('pdb-list'))filterPlayersDB();}catch(_){}}
    return d;
  }).catch(function(){_advStatsPromise=null;return null;});
  return _advStatsPromise;
}
var _adpPromises={};
var _adpData={};
// per-format store: re-selecting a format must re-install THAT board -
// the old promise cache only assigned on first fetch, so a format switch
// left every later draft priced off whichever board loaded last
function _adpInstall(d){window._adp=(d&&d.players)||null;window._adpById=(d&&d.byId)||{};window._adpQ6=(d&&d.q6)||{};window._adpSource=(d&&d.source)||'sleeper';}
function loadAdp(fmt){
  fmt=fmt||'ppr';
  if(_adpData[fmt]){_adpInstall(_adpData[fmt]);return Promise.resolve(_adpData[fmt]);}
  if(_adpPromises[fmt])return _adpPromises[fmt].then(function(d){if(_adpData[fmt])_adpInstall(_adpData[fmt]);return d;});
  _adpPromises[fmt]=fetch('/api/stats/adp?format='+fmt).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(d&&d.players){_adpData[fmt]=d;_adpInstall(d);}
    return d;
  }).catch(function(){delete _adpPromises[fmt];return null;});
  return _adpPromises[fmt];
}
function advByName(name){
  if(!window._advStats||!name)return null;
  var nm=name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
  if(window._advStats[nm])return window._advStats[nm];
  // suffix mismatch between sources: "Marvin Harrison" vs "Marvin Harrison Jr"
  if(!window._advAlias){
    window._advAlias={};
    Object.keys(window._advStats).forEach(function(k){
      var s=k.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
      if(s!==k&&!window._advStats[s])window._advAlias[s]=k;
    });
  }
  var ali=window._advAlias[nm.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'')];
  return ali?window._advStats[ali]:null;
}
function getAdvStats(pid){
  if(!window._advStats)return null;
  var p=allPlayers[pid];
  if(!p||!p.name)return null;
  var adv=advByName(p.name);
  if(!adv)return null;
  if(adv.pos&&p.pos&&adv.pos!==p.pos)return null; // same name, different player
  return adv;
}

var STAT_INFO = {
  routePct: {
    label:"Route Participation %",
    explain:"The percentage of a team's dropbacks where the player actually runs a pass route (vs. staying in to block or split out as a decoy). Elite dynasty WRs like Justin Jefferson run routes on 90%+ of dropbacks. Low route participation often means the scheme limits a player's involvement - a red flag for consistency. Matt Harmon uses this as a foundation metric in Reception Perception because you can only produce when you're actually running routes.",
    elite:"WR/TE: 85%+ = elite involvement. RB: 60%+ = top pass-catching back.",
    bad:"Under 70% for WR = scheme-limited or role player."
  },
  tgtShare: {
    label:"Target Share %",
    explain:"The percentage of a team's total targets directed at this player in a season. This is the single best predictor of dynasty floor. A WR with 25%+ target share is a true alpha - they're the first read in their offense. 20%+ is WR1 territory. Below 15% = volume-dependent week-to-week.",
    elite:"25%+ = alpha WR1. 20-24% = true starter. 15-19% = solid WR2.",
    bad:"Under 12% = floor risk regardless of efficiency."
  },
  yprr: {
    label:"Yards Per Route Run (YPRR)",
    explain:"Total receiving yards divided by the number of routes run. This is the dynasty world's favorite efficiency metric because it normalizes production by opportunity. A player with 1,000 yards on 400 routes (2.50 YPRR) is more valuable than one with 1,000 yards on 600 routes (1.67 YPRR). Matt Harmon and the advanced community consider 2.0+ YPRR elite for WRs - it means every time they run a route, they average at least 2 yards of value for the offense.",
    elite:"WR: 2.5+ = elite. 2.0-2.5 = very good. TE: 1.8+ = TE1 efficiency.",
    bad:"Under 1.5 for WR = volume-dependent, needs high target share to produce."
  },
  ayShare: {
    label:"Air Yards Share %",
    explain:"The percentage of a team's total air yards (yards the ball travels through the air on each pass) that are directed at this player. This measures how much of the passing game's 'ceiling' is focused on a player - high air yards share players are the downfield threats and big-play guys. Tyreek Hill leads all WRs at 30%+ in peak seasons. High air yards share + high target share = true alpha. High air yards share + low target share = boom/bust deep threat.",
    elite:"28%+ = dominant alpha. 20-27% = core target. Under 15% = role player.",
    bad:"Very high air yards share with low target share = deep shot specialist - high variance."
  },
  yacRec: {
    label:"YAC Per Reception",
    explain:"Yards gained after the catch, divided by total receptions. This measures open-field ability - runners after the catch who can turn short completions into big gains. Elite YAC players like Tyreek Hill and De'Von Achane make defenses respect every short route because they can house it. In PPR formats, high-YAC players score above their air yards because they turn checkdowns into big plays.",
    elite:"6.0+ = elite after-catch ability. 4.5-6.0 = solid. Under 3.5 = possession receiver.",
    bad:"Under 3.0 = relies on separation and air yards to produce - limited upside on short routes."
  }
};

function showStatInfo(key){
  var box=document.getElementById('pdb-stat-info');
  if(!box)return;
  var info=STAT_INFO[key];
  if(!info){box.style.display='none';return;}
  if(box.style.display==='block'&&box.dataset.key===key){box.style.display='none';return;}
  box.dataset.key=key;
  box.style.display='block';
  box.innerHTML='<strong style="color:var(--text)">'+info.label+'</strong><br>'+
    info.explain+'<br><br>'+
    '<span style="color:var(--green)">✓ Elite: </span>'+info.elite+'<br>'+
    '<span style="color:var(--red)">✗ Concern: </span>'+info.bad;
}

var pdbActiveChips={};
var CHIP_INFO={
  alpha:'<strong style="color:var(--text)">Alpha usage - 24%+ target share.</strong> Target share is the single best predictor of a receiver\'s weekly floor: the first read in the offense gets fed no matter the game script. These are the players you build lineups around.',
  bellcow:'<strong style="color:var(--text)">Bell-cows - 250+ touches.</strong> Volume survives bad games; efficiency does not. A back who owns his backfield can have a terrible day and still score, which is why touches are the RB stat that matters most.',
  efficient:'<strong style="color:var(--text)">Efficiency kings - 9+ yards per target or 5.5+ YAC per catch.</strong> These players create more than their role gives them. If their volume ever grows, production explodes - the classic buy signal.',
  ironman:'<strong style="color:var(--text)">Iron men - every game played in 2025.</strong> Availability is a skill. The difference between a league winner and a bust is often just games played.',
  breakout:'<strong style="color:var(--text)">Breakout profile - 24 or younger with an 18%+ target share already.</strong> Young players who ALREADY command real volume are the safest upside bets in fantasy: the role is proven, and the talent curve is still climbing.'
};
function togglePdbChip(btn){
  var key=btn.dataset.chip;
  var wasOn=!!pdbActiveChips[key];
  // Single-select: picking a chip clears the others so you can flip between views.
  // State is a class - home.css owns the look per theme.
  pdbActiveChips={};
  document.querySelectorAll('.pdb-chip').forEach(function(b){b.classList.remove('on');});
  if(!wasOn){
    pdbActiveChips[key]=true;
    btn.classList.add('on');
  }
  try{
    var info=document.getElementById('pdb-stat-info');
    if(info){
      if(!wasOn&&CHIP_INFO[key]){info.style.display='block';info.innerHTML=CHIP_INFO[key];}
      else info.style.display='none';
    }
  }catch(_){}
  _runFilterPlayersDB();
}

function clearPdbFilters(){
  var el=document.getElementById('pdb-search'); if(el)el.value='';
  ['pdb-pos','pdb-team'].forEach(function(id){
    var s=document.getElementById(id); if(s)s.selectedIndex=0;
  });
  pdbActiveChips={};
  document.querySelectorAll('.pdb-chip').forEach(function(b){b.classList.remove('on');});
  _runFilterPlayersDB();
}

async function renderPlayersDB(){
  var grid=document.getElementById('pdb-grid');
  var countEl=document.getElementById('pdb-count');
  if(!grid)return;
  loadAdvStats(); // nflverse profiles arrive async, list re-renders when ready

  if(Object.keys(allPlayers).length>100){
    pdbAllPlayers=Object.values(allPlayers).filter(function(p){return p.name&&p.pos&&p.pos!=='?';});
  } else {
    grid.innerHTML='<div style="grid-column:1/-1"><div class="tm-skel-feed"><div class="tm-skel"></div><div class="tm-skel"></div><div class="tm-skel"></div></div></div>';
    try{
      var res=await fetch('/api/sleeper/players/nfl/slim');
      var raw=await res.json();
      pdbAllPlayers=Object.entries(raw).map(function(e){
        var p=e[1];
        var pos=(p.fantasy_positions&&p.fantasy_positions[0])||p.position||'?';
        var name=((p.first_name||'')+(p.last_name?' '+p.last_name:'')).trim();
        if(!name||!pos||pos==='?')return null;
        return {id:e[0],name:name,pos:pos,team:p.team||'FA',age:p.age||null,exp:p.years_exp!=null?p.years_exp:null};
      }).filter(Boolean);
      if(!Object.keys(allPlayers).length){
        pdbAllPlayers.forEach(function(p){allPlayers[p.id]=p;});
      }
    }catch(err){
      grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--red);font-size:13px">Failed to load players. Try again.</div>';
      return;
    }
  }

  var teamSel=document.getElementById('pdb-team');
  if(teamSel&&teamSel.options.length<=1){
    var teams=[...new Set(pdbAllPlayers.map(function(p){return p.team;}).filter(function(t){return t&&t!=='FA';}))].sort();
    teams.forEach(function(t){var o=document.createElement('option');o.value=t;o.textContent=t;teamSel.appendChild(o);});
  }

  // Without market values everyone sorts to zero and the list leads with retired
  // free agents alphabetically - load values first so the top of the list is real
  if(!Object.keys(ktcFull).length){
    if(grid)grid.innerHTML='<div style="grid-column:1/-1"><div class="tm-skel-feed"><div class="tm-skel"></div><div class="tm-skel"></div><div class="tm-skel"></div></div></div>';
    try{await fetchKtcValues(1,1,true);}catch(_){}
  }

  _runFilterPlayersDB();
}

var _pdbTimer;
function filterPlayersDB(){clearTimeout(_pdbTimer);_pdbTimer=setTimeout(_runFilterPlayersDB,220);}
function _runFilterPlayersDB(){
  var grid=document.getElementById('pdb-grid');
  var countEl=document.getElementById('pdb-count');
  if(!grid||!pdbAllPlayers.length)return;
  var q=(document.getElementById('pdb-search')||{}).value||'';
  var pos=(document.getElementById('pdb-pos')||{}).value||'';
  var team=(document.getElementById('pdb-team')||{}).value||'';
  var ql=q.toLowerCase();
  var chips=pdbActiveChips;

  pdbFiltered=pdbAllPlayers.filter(function(p){
    if(ql&&p.name.toLowerCase().indexOf(ql)<0)return false;
    if(pos&&p.pos!==pos)return false;
    if(team&&p.team!==team)return false;
    var fc=ktcFull[p.id];
    if(chips.young&&(!p.age||p.age>=25))return false;
    if(chips.alpha||chips.bellcow||chips.efficient||chips.ironman||chips.breakout){
      var av=getAdvStats(p.id);
      if(!av)return false;
      if(chips.alpha&&!(av.tgtShare>=24))return false;
      if(chips.bellcow&&!(((av.ruAtt||0)+(av.rec||0))>=250))return false;
      if(chips.efficient&&!((av.ypt>=9&&av.tgt>=60)||(av.yacRec>=5.5&&av.rec>=40)))return false;
      if(chips.ironman&&!(av.g>=17))return false;
      if(chips.breakout&&!(p.age&&p.age<=24&&av.tgtShare>=18))return false;
    }
    if(chips.elite&&!(fc&&fc.positionRank&&fc.positionRank<=8))return false;
    if(chips.risers&&!(fc&&fc.trend30Day>150))return false;
    if(chips.fallers&&!(fc&&fc.trend30Day<-150))return false;
    // target-hog filter removed: it fed off hand-typed PLAYER_ADV_STATS ids
    // that were wrong for 31 of 44 players (Najee Harris and AJ Dillon were
    // wearing some receiver's target share). Never rebuild it from hand data.
    return true;
  }).sort(function(a,b){
    var mode=((document.getElementById('pdb-sort')||{}).value)||'value';
    if(mode==='age'){
      var aa=a.age||99,ba=b.age||99;
      if(aa!==ba)return aa-ba;
    }else if(mode==='trend'){
      var af=(ktcFull[a.id]||{}).trend30Day||0, bf=(ktcFull[b.id]||{}).trend30Day||0;
      if(bf!==af)return bf-af;
    }else if(mode==='name'){
      return a.name.localeCompare(b.name);
    }
    var av=getKtcValue(a.name,a.id)||0;
    var bv=getKtcValue(b.name,b.id)||0;
    if(bv!==av)return bv-av;
    return a.name.localeCompare(b.name);
  });

  if(countEl)countEl.textContent=pdbFiltered.length.toLocaleString()+' players'+
    (pdbFiltered.length>200?' (showing top 200 - search to narrow)':'');

  var posColors={QB:'rgba(167,139,250,.15)',RB:'rgba(74,222,128,.15)',WR:'rgba(251,191,36,.15)',TE:'rgba(248,113,113,.15)'};
  var posText={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  var tierBadge={elite:'Elite',starter:'Starter',flex:'Flex',bench:'Bench'};
  var tierColor={elite:'var(--accent-bright)',starter:'var(--green)',flex:'var(--yellow)',bench:'var(--muted)'};

  var shown=pdbFiltered.slice(0,200);
  grid.innerHTML=shown.map(function(p){
    var ktcV=getKtcValue(p.name,p.id);
    var bgC=posColors[p.pos]||'rgba(255,255,255,.05)';
    var txC=posText[p.pos]||'var(--muted)';
    var age=p.age?p.age+'y':'';
    var adv=getAdvStats(p.id);
    var advHtml='';
    if(adv){
      var metrics=[];
      if(adv.tgtShare)metrics.push('<span title="Target Share (2025)">Tgt '+adv.tgtShare+'%</span>');
      if(adv.ayShare)metrics.push('<span title="Air Yards Share (2025)">AY '+adv.ayShare+'%</span>');
      if(adv.yacRec)metrics.push('<span title="Yards After Catch per Reception (2025)">YAC '+adv.yacRec+'</span>');
      if(adv.ypc&&(p.pos==='RB'||p.pos==='QB'))metrics.push('<span title="Yards Per Carry (2025)">'+adv.ypc+' YPC</span>');
      if(metrics.length){
        advHtml='<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">'+
          metrics.map(function(m){return '<span style="font-size:9px;background:var(--surface3);border-radius:4px;padding:2px 5px;color:var(--muted2)">'+m+'</span>';}).join('')+
          '</div>';
      }
    }
    var safeName=p.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var safeId=p.id.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    // Surface and hover live in theme.css as .pdb-card so these cards share the
    // radius, border and hover colour of every other list row in the app.
    return '<div class="pdb-card" onclick="openPlayerCard(\''+safeId+'\',\''+safeName+'\')">' +
      '<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" '+
      'onerror="this.style.display=\'none\'" '+
      'style="width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;margin-bottom:7px;background:var(--surface3)">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+'</div>' +
      '<div style="display:flex;align-items:center;gap:5px;margin-top:3px">' +
      '<span style="font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;background:'+bgC+';color:'+txC+'">'+p.pos+'</span>' +
      '<span style="font-size:10px;color:var(--muted);display:inline-flex;align-items:center;gap:3px">'+teamLogo(p.team,13)+p.team+(age?' · '+age:'')+'</span>' +
      '</div>' +
            /* market value intentionally NOT shown on the grid card - click into the player card to see it */
      advHtml+
      '</div>';
  }).join('');
}

// ─── PLAYER STOCK MARKET ─────────────────────────────────────────────────────
// Values represent dynasty rankings (KTC/FantasyCalc scale 0-10000) at each season-end
// Years: [2020-end, 2021-end, 2022-end, 2023-end, 2024-end, 2025-current]
var PLAYER_HISTORY = {
  // Values: season-end dynasty value (KTC/FantasyCalc 0-10,000 scale)
  // Years:  ['20-end, '21-end, '22-end, '23-end, '24-end, '25-end, Jun-'26]
  // ── QBs ──
  "patrick mahomes":   {pos:'QB',team:'KC', values:[8200, 8500, 8000, 7800, 7000, 6600, 3063]},
  "josh allen":        {pos:'QB',team:'BUF',values:[6500, 7800, 7200, 7800, 8600, 8800, 5489]},
  "lamar jackson":     {pos:'QB',team:'BAL',values:[4800, 5500, 5200, 8500, 9200, 9000, 3884]},
  "joe burrow":        {pos:'QB',team:'CIN',values:[4500, 6800, 8200, 5200, 7400, 7200, 3507]},
  "jalen hurts":       {pos:'QB',team:'PHI',values:[3200, 5800, 7800, 7200, 7000, 6800, 2893]},
  "jordan love":       {pos:'QB',team:'GB', values:[null, 1800, 2200, 2800, 7000, 6400, 2181]},
  "jayden daniels":    {pos:'QB',team:'WAS',values:[null, null, null, null, 6200, 7600, 3955]},
  "cj stroud":         {pos:'QB',team:'HOU',values:[null, null, null, 4500, 6800, 6600, 1851]},
  "c.j. stroud":       {pos:'QB',team:'HOU',values:[null, null, null, 4500, 6800, 6600, 1851]},
  "caleb williams":    {pos:'QB',team:'CHI',values:[null, null, null, null, 5800, 6400, 3855]},
  "cam ward":          {pos:'QB',team:'TEN',values:[null, null, null, null, null, 5500, 2043]},
  "shedeur sanders":   {pos:'QB',team:'CLE',values:[null, null, null, null, null, 4500, 852]},
  "dak prescott":      {pos:'QB',team:'DAL',values:[5200, 5500, 5200, 5500, 4500, 4000, 2229]},
  "tua tagovailoa":    {pos:'QB',team:'ATL',values:[3800, 4500, 5500, 5800, 4200, 4600, 880]},
  "brock purdy":       {pos:'QB',team:'SF', values:[null, null, null, 5500, 6000, 5600, 2407]},
  // ── WRs ──
  "justin jefferson":  {pos:'WR',team:'MIN',values:[4200, 7800, 9200, 9600, 9000, 8800, 7048]},
  "ja'marr chase":     {pos:'WR',team:'CIN',values:[null,6800,8500,8800,9400,9200,9400]},
  "ceedee lamb":       {pos:'WR',team:'DAL',values:[5500, 6800, 7800, 9200, 9600, 9200, 6317]},
  "amon-ra st. brown": {pos:'WR',team:'DET',values:[null,2800,5200,7200,7600,7800,7600]},
  "garrett wilson":    {pos:'WR',team:'NYJ',values:[null, null, 4500, 7200, 7000, 7400, 4147]},
  "malik nabers":      {pos:'WR',team:'NYG',values:[null, null, null, null, 6200, 7400, 6566]},
  "brian thomas jr":   {pos:'WR',team:'JAC',values:[null,null,null,null,5400,7000,7200]},
  "marvin harrison jr":{pos:'WR',team:'ARI',values:[null, null, null, null, 5800, 6600, 3380]},
  "travis hunter":     {pos:'WR',team:'JAC',values:[null, null, null, null, null, 5500, 1943]},
  "tetairoa mcmillan": {pos:'WR',team:'CAR',values:[null,null,null,null,null,4800,5400]},
  "luther burden iii": {pos:'WR',team:'CHI',values:[null,null,null,null,null,4200,5000]},
  "drake london":      {pos:'WR',team:'ATL',values:[null, null, 3800, 5200, 6200, 6800, 5776]},
  "ladd mcconkey":     {pos:'WR',team:'LAC',values:[null, null, null, null, 5000, 6400, 3936]},
  "rome odunze":       {pos:'WR',team:'CHI',values:[null, null, null, null, 4200, 5400, 3255]},
  "puka nacua":        {pos:'WR',team:'LAR',values:[null, null, null, 3800, 4800, 5200, 8486]},
  "devonta smith":     {pos:'WR',team:'PHI',values:[3800, 5500, 6200, 6800, 6000, 5800, 3273]},
  "a.j. brown":        {pos:'WR',team:'NE',values:[6200, 5800, 7200, 7800, 6000, 5600, 3899]},
  "jaylen waddle":     {pos:'WR',team:'DEN',values:[null, 5200, 6500, 6200, 5400, 5200, 3289]},
  "tyreek hill":       {pos:'WR',team:'FA',values:[6500, 6800, 7200, 6200, 5000, 4000, 1033]},
  "dk metcalf":        {pos:'WR',team:'PIT',values:[5500, 5800, 5200, 5000, 4800, 5400, 1973]},
  "d.k. metcalf":      {pos:'WR',team:'PIT',values:[5500,5800,5200,5000,4800,5400,5200]},
  "stefon diggs":      {pos:'WR',team:'FA', values:[5800, 6200, 5800, 5200, 1800, 1200, 1272]},
  "davante adams":     {pos:'WR',team:'LAR', values:[5800, 6200, 5800, 4800, 2800, 1200, 1993]},
  "keenan allen":      {pos:'WR',team:'FA',values:[5500, 5800, 5200, 4800, 2600, 2000, 137]},
  "cooper kupp":       {pos:'WR',team:'SEA',values:[6500, 8800, 6800, 5200, 3200, 2400, 593]},
  "tank dell":         {pos:'WR',team:'HOU',values:[null, null, null, 3800, 3200, 4200, 1175]},
  "kyren williams":    {pos:'RB',team:'LAR',values:[null, null, null, 3800, 6400, 6200, 3633]},
  // ── RBs ──
  "christian mccaffrey":{pos:'RB',team:'SF',values:[8800,8500,8200,8800,5800,5000,4400]},
  "saquon barkley":    {pos:'RB',team:'PHI',values:[5800, 4800, 4200, 5200, 7200, 6200, 4123]},
  "bijan robinson":    {pos:'RB',team:'ATL',values:[null, null, null, 7800, 7600, 7800, 11097]},
  "de'von achane":     {pos:'RB',team:'MIA',values:[null, null, null, 5500, 8000, 8000, 6217]},
  "jahmyr gibbs":      {pos:'RB',team:'DET',values:[null, null, null, 5800, 7400, 7800, 10838]},
  "breece hall":       {pos:'RB',team:'NYJ',values:[null, null, 5500, 7200, 6400, 6600, 4227]},
  "james cook":        {pos:'RB',team:'BUF',values:[null, null, 2800, 5500, 6400, 6800, 5472]},
  "ashton jeanty":     {pos:'RB',team:'LV', values:[null, null, null, null, null, 5800, 7714]},
  "jonathan taylor":   {pos:'RB',team:'IND',values:[5500,8800,7800,5800,5400,5000,4800]},
  "josh jacobs":       {pos:'RB',team:'GB', values:[5200, 4800, 5500, 5800, 4600, 4200, 2962]},
  "derrick henry":     {pos:'RB',team:'BAL',values:[4800,3800,3200,2800,6200,3500,2800]},
  "isiah pacheco":     {pos:'RB',team:'DET', values:[null, null, 2200, 5200, 3600, 4000, 1287]},
  "alvin kamara":      {pos:'RB',team:'NO', values:[6800, 6200, 5500, 4800, 3600, 2600, 1245]},
  "rachaad white":     {pos:'RB',team:'WAS', values:[null, null, 2800, 4200, 4600, 4400, 1846]},
  "aaron jones":       {pos:'RB',team:'MIN',values:[4800, 4500, 4200, 4000, 3400, 2600, 1360]},
  "austin ekeler":     {pos:'RB',team:'FA', values:[5800, 6200, 6500, 5200, 2200, 1200, 31]},
  // ── TEs ──
  "brock bowers":      {pos:'TE',team:'LV', values:[null, null, null, null, 7000, 8600, 6960]},
  "trey mcbride":      {pos:'TE',team:'ARI',values:[null, null, 2200, 4500, 7400, 8000, 5996]},
  "travis kelce":      {pos:'TE',team:'KC', values:[8200, 8500, 8000, 7500, 5400, 3800, 1523]},
  "sam laporta":       {pos:'TE',team:'DET',values:[null, null, null, 4800, 5400, 5400, 2694]},
  "george kittle":     {pos:'TE',team:'SF', values:[5500, 5200, 5800, 6200, 5800, 5200, 1990]},
  "mark andrews":      {pos:'TE',team:'BAL',values:[6200, 7200, 6800, 5200, 4600, 4400, 1518]},
  "jake ferguson":     {pos:'TE',team:'DAL',values:[null, null, 1800, 4200, 5000, 4800, 1838]},
  "david njoku":       {pos:'TE',team:'LAC',values:[3200, 3500, 3800, 5500, 5000, 4600, 889]},
  "tj hockenson":      {pos:'TE',team:'MIN',values:[4800, 5200, 5800, 5800, 3200, 3000, 1290]},
  "t.j. hockenson":    {pos:'TE',team:'MIN',values:[4800, 5200, 5800, 5800, 3200, 3000, 1290]},
  "pat freiermuth":    {pos:'TE',team:'PIT',values:[null, 2800, 3500, 3800, 4200, 4400, 851]},
  "kyle pitts":        {pos:'TE',team:'ATL',values:[null, 6500, 4200, 4500, 5000, 5200, 2709]},
};
var MKT_YEARS = ["'20","'21","'22","'23","'24","'25","'26"];
var _mktRendered = false;

function renderMarketTab(){
  // Live 30-day market movement from FantasyCalc - refreshes continuously, not once a season
  // Self-heal: if values or the player DB haven't loaded (no league connected), load them now
  if(!Object.keys(ktcFull).length||Object.keys(allPlayers).length<100){
    if(!window._mktLoading){
      window._mktLoading=true;
      Promise.all([ensurePlayersLoaded(),fetchKtcValues(1,1,true)]).then(function(){
        window._mktLoading=false;renderMarketTab();
      }).catch(function(){window._mktLoading=false;});
    }
  }
  var movers=[];
  if(Object.keys(ktcFull).length){
    movers=Object.entries(ktcFull).map(function(e){
      var pid=e[0],fc=e[1],p=allPlayers[pid];
      if(!fc.value||fc.value<800||!fc.trend30Day)return null;
      if(['QB','RB','WR','TE'].indexOf(fc.position)<0)return null;
      var pct=Math.round(fc.trend30Day/(fc.value-fc.trend30Day||1)*100);
      return {name:fc.name||(p&&p.name)||pid,pid:pid,pos:fc.position,team:(p&&p.team)||'FA',cur:fc.value,pct:pct,trend:fc.trend30Day};
    }).filter(Boolean);
  }
  if(!movers.length){
    // Fallback: static history DB (only when live values haven't loaded)
    movers=Object.keys(PLAYER_HISTORY).map(function(nm){
      var h=PLAYER_HISTORY[nm],v=h.values,cur=v[6],prev=v[5];
      if(cur===null||prev===null)return null;
      return {name:displayName(nm),pid:findSleeperIdByName(nm),pos:h.pos,team:h.team,cur:cur,pct:Math.round(((cur-prev)/prev)*100),trend:cur-prev};
    }).filter(Boolean);
  }

  var risers=movers.filter(function(m){return m.trend>0;}).sort(function(a,b){return b.trend-a.trend;}).slice(0,8);
  var fallers=movers.filter(function(m){return m.trend<0;}).sort(function(a,b){return a.trend-b.trend;}).slice(0,8);

  var tracked=movers.length;
  var avgVal=tracked?Math.round(movers.reduce(function(s,m){return s+m.cur;},0)/tracked):0;
  var topRiser=risers[0],topFaller=fallers[0];
  document.getElementById('mkt-players-tracked').textContent=tracked;
  try{var _mav=document.getElementById('mkt-avg-val');if(_mav&&_mav.parentElement)_mav.parentElement.style.display='none';}catch(_){}
  document.getElementById('mkt-top-riser').textContent=topRiser?topRiser.name+' +'+topRiser.pct+'%':'-';
  document.getElementById('mkt-top-faller').textContent=topFaller?topFaller.name+' '+topFaller.pct+'%':'-';

  function moverReason(m,isUp){
    var note=getPlayerContextNote(m.name);
    if(note){
      var first=note.note.split(';')[0].trim();
      return first.charAt(0).toUpperCase()+first.slice(1);
    }
    // No hardcoded note - build a specific line from the player's real numbers
    // (magnitude + position + buy/sell implication), varied so no two read alike.
    var pct=Math.abs(m.pct||0),pos=m.pos||'player';
    var h=0,s=String(m.name||'');for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
    var pick=function(arr){return arr[h%arr.length];};
    if(isUp){
      if(pct>=12)return pick(["Up "+pct+"% in 30 days - one of the sharpest "+pos+" climbs on the board. Peak-sell territory if you own him.","A "+pct+"% jump in a month - the market is repricing this "+pos+" fast. You're paying full freight now.","Up "+pct+"% and accelerating. If you were ever going to sell this "+pos+", this is the window."]);
      if(pct>=6)return pick(["Steady "+pct+"% climb - buyers are warming to this "+pos+". Get ahead of it before the next jump.","Up "+pct+"% this month - real momentum for a "+pos+", still short of a breakout price.","A "+pct+"% rise - the market is stepping up on him. Worth acting before it runs further."]);
      return pick(["Up "+pct+"% - a quiet uptick at "+pos+". Momentum building, price still reasonable.","Small "+pct+"% bump - early interest in this "+pos+", nothing frothy yet.","Up "+pct+"% - a mild climb worth keeping an eye on."]);
    }
    if(pct>=12)return pick(["Down "+pct+"% in 30 days - a steep slide for a "+pos+". Either the market knows something or it's a real buy-low. Check the why first.","Off "+pct+"% in a month - sharp markdown on this "+pos+". Genuine discount if the talent is intact.","Down "+pct+"% and falling. This "+pos+" is on sale, but make sure it's a dip, not a decline."]);
    if(pct>=6)return pick(["Off "+pct+"% - this "+pos+"'s price is cooling. If you believe in the talent, this is where discounts start.","Down "+pct+"% this month - the market is easing off him. A soft buy window opening at "+pos+".","A "+pct+"% dip - not a fire sale, but the price is moving your way as a buyer."]);
    return pick(["Down "+pct+"% - a small dip. Not a fire sale, but worth watching if you've wanted him.","Off "+pct+"% - minor cooling at "+pos+". Barely moved, but the arrow's down.","Down "+pct+"% - a slight slide. Keep it on your radar."]);
  }
  function moverRow(m){
    var isUp=m.trend>=0;
    var col=isUp?'#22c55e':'#ef4444';
    var arrow=isUp?'▲':'▼';
    var pctStr=(isUp?'+':'')+m.pct+'%';
    var imgSrc=m.pid?'https://sleepercdn.com/content/nfl/players/thumb/'+m.pid+'.jpg':'';
    var posC={QB:'#a78bfa',WR:'#fbbf24',RB:'#4ade80',TE:'#f87171'};
    return '<div class="mkt-mover" onclick="showPlayerChart(\''+m.name.toLowerCase().replace(/'/g,"\\'")+'\')" style="cursor:pointer;flex-wrap:wrap">'
      +(imgSrc?'<img class="mkt-mover-img" src="'+imgSrc+'" onerror="this.style.display=\'none\'">':'<div class="mkt-mover-img"></div>')
      +'<div style="flex:1;min-width:0"><div class="mkt-mover-name">'+m.name+'</div>'
      +'<div class="mkt-mover-pos" style="color:'+(posC[m.pos]||'var(--muted)')+'">'+m.pos+' · '+teamLogo(m.team)+m.team+'</div></div>'
      +'<div class="mkt-mover-pct" style="color:'+col+'">'+arrow+' '+pctStr+'</div>'
      +'<div style="flex-basis:100%;font-size:10px;color:var(--muted);line-height:1.5;padding-left:2px;margin-top:2px">'+moverReason(m,isUp)+'</div>'
      +'</div>';
  }
  document.getElementById('mkt-risers').innerHTML=risers.map(moverRow).join('')||'<div class="mkt-empty">Values loading - connect a league or check back in a moment.</div>';
  document.getElementById('mkt-fallers').innerHTML=fallers.map(moverRow).join('')||'<div class="mkt-empty">Values loading - connect a league or check back in a moment.</div>';
  renderTrendingWeek();
  renderTmTradeIndex();
  renderMarketSignals();
}
// Market Signals: findings from the pattern miner (scripts/pattern-miner.mjs
// writes public/signals.json). The card only exists while the data is fresh -
// a missing or week-old file renders nothing at all, never a stale claim.
async function renderMarketSignals(){
  try{
    if(window._mdSignals===undefined)await mdLoadSignals();
    var box=document.getElementById('mkt-signals'),panel=document.getElementById('mkt-signals-panel');
    if(!box||!panel)return;
    var sg=window._mdSignals;
    if(!sg||!sg.data.signals.length){panel.style.display='none';return;}
    panel.style.display='block';
    box.innerHTML=sg.data.signals.map(function(s){
      var chips=(s.candidates||[]).map(function(c){
        var _e=(c.name||'').replace(/'/g,"\\'");
        return '<span onclick="openPlayerCard(\''+c.id+'\',\''+_e+'\')" style="display:inline-flex;align-items:center;min-height:32px;background:var(--surface3);border:1px solid var(--border);border-radius:100px;padding:3px 12px;font-size:11px;color:var(--text);margin:2px;cursor:pointer">'+escHtml(c.name)+'&nbsp;<span style="color:var(--muted)">ADP '+c.adp+'</span></span>';
      }).join('');
      return '<div style="padding:12px 0;border-bottom:1px solid var(--border)">'
        +'<div style="font-size:14px;font-weight:700;color:var(--text);line-height:1.5">'+escHtml(s.claim)+'</div>'
        +'<div style="font-size:11px;color:var(--muted2);line-height:1.55;margin-top:4px">'+escHtml(s.detail)+'</div>'
        +(chips?'<div style="margin-top:6px"><span style="font-size:9.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">This year\'s cohort</span><div style="margin-top:3px">'+chips+'</div></div>':'')
        +'</div>';
    }).join('')
      +'<div style="font-size:9.5px;color:var(--muted);margin-top:8px">Computed '+escHtml(sg.data.computed_at)+' from '+escHtml(sg.data.seasons)+' draft history. Small samples - read these as tendencies, not verdicts.</div>';
  }catch(_){}
}

// Most added / dropped this week - real waiver volume across all Sleeper leagues
function renderTrendingWeek(){
  if(window._trendWeekData){_paintTrendingWeek(window._trendWeekData);return;}
  if(window._trendWeekLoading)return;
  window._trendWeekLoading=true;
  fetch('/api/sleeper/trending-week').then(function(r){return r.json();}).then(function(d){
    window._trendWeekLoading=false;
    window._trendWeekData=d;
    _paintTrendingWeek(d);
  }).catch(function(){
    window._trendWeekLoading=false;
    var a=document.getElementById('mkt-adds'),b=document.getElementById('mkt-drops');
    if(a)a.innerHTML='<div class="mkt-empty">Waiver data unavailable right now.</div>';
    if(b)b.innerHTML='<div class="mkt-empty">Waiver data unavailable right now.</div>';
  });
}
function _paintTrendingWeek(d){
  var posC={QB:'#a78bfa',WR:'#fbbf24',RB:'#4ade80',TE:'#f87171'};
  function row(it,isAdd){
    var pid=it.player_id,p=allPlayers[pid];
    var name=p?p.name:null;
    if(!name)return '';
    var col=isAdd?'#22c55e':'#ef4444';
    var cnt=(it.count||0).toLocaleString();
    return '<div class="mkt-mover">'
      +'<img class="mkt-mover-img" src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" onerror="this.style.display=\'none\'">'
      +'<div style="flex:1;min-width:0"><div class="mkt-mover-name">'+name+'</div>'
      +'<div class="mkt-mover-pos" style="color:'+(posC[p.pos]||'var(--muted)')+'">'+p.pos+' · '+teamLogo(p.team)+p.team+'</div></div>'
      +'<div class="mkt-mover-pct" style="color:'+col+';font-size:11px">'+cnt+' '+(isAdd?'adds':'drops')+'</div>'
      +'</div>';
  }
  var addsEl=document.getElementById('mkt-adds'),dropsEl=document.getElementById('mkt-drops');
  var haveP=Object.keys(allPlayers).length>100;
  if(!haveP){
    // player DB still loading - renderMarketTab's self-heal will re-run us
    return;
  }
  if(addsEl)addsEl.innerHTML=(d.adds||[]).map(function(it){return row(it,true);}).join('')||'<div class="mkt-empty">No waiver data right now.</div>';
  if(dropsEl)dropsEl.innerHTML=(d.drops||[]).map(function(it){return row(it,false);}).join('')||'<div class="mkt-empty">No waiver data right now.</div>';
}

function displayName(nm){
  return nm.split(' ').map(function(w){return w.charAt(0).toUpperCase()+w.slice(1);}).join(' ');
}

function findSleeperIdByName(nm){
  var low = nm.toLowerCase();
  for(var id in allPlayers){
    if(allPlayers[id].name && allPlayers[id].name.toLowerCase()===low) return id;
  }
  // fallback check ktcFull
  for(var id in ktcFull){
    if(ktcFull[id].name && ktcFull[id].name.toLowerCase()===low) return id;
  }
  return null;
}

function mktSearch(){
  var inp=document.getElementById('mkt-search');
  var box=document.getElementById('mkt-search-results');
  if(!inp||!box)return;
  var q=inp.value.toLowerCase().trim();
  if(q.length<2){box.style.display='none';return;}
  var src=Object.keys(allPlayers).length?Object.values(allPlayers):[];
  var results=src.filter(function(p){return p.name&&p.name.toLowerCase().indexOf(q)>=0&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;})
    .sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,8);
  if(!results.length){box.style.display='none';return;}
  box.innerHTML='';
  results.forEach(function(p){
    var d=document.createElement('div');
    d.className='ac-item';
    d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer';
    d.innerHTML='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'"><span style="flex:1"></span><span style="font-size:10px;color:var(--muted)">'+p.pos+' · '+(p.team||'FA')+'</span>';
    d.children[1].textContent=p.name;
    d.addEventListener('mousedown',function(ev){ev.preventDefault();box.style.display='none';showPlayerChart(p.name.toLowerCase());});
    box.appendChild(d);
  });
  box.style.display='block';
}

function showPlayerChart(nm){
  document.getElementById('mkt-search-results').style.display='none';
  var inp = document.getElementById('mkt-search');
  if(inp) inp.value = displayName(nm);
  // Always bring the chart area into view when a player is picked
  var chartArea=document.getElementById('mkt-chart-content');
  if(chartArea)setTimeout(function(){scrollToEl(chartArea,true);},80);

  var h = PLAYER_HISTORY[nm];
  if(!h){
    // No multi-year history tracked - build a live chart from the market data we DO have:
    // the 30-day trend gives two anchor points, daily snapshots fill in as they accumulate
    if(chartArea){
      var pid=findSleeperIdByName(nm);
      if(!Object.keys(ktcFull).length){
        chartArea.innerHTML='<div class="mkt-empty">Loading market values...</div>';
        fetchKtcValues(1,1,true).then(function(){showPlayerChart(nm);}).catch(function(){});
        return;
      }
      var fc=pid?ktcFull[pid]:null;
      var note=getPlayerContextNote(nm);
      var sp=pid?allPlayers[pid]:null;
      var imgH=pid?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" onerror="this.style.display=\'none\'" style="width:52px;height:52px;border-radius:50%;border:2px solid var(--border2);object-fit:cover">':'';
      chartArea.innerHTML='<div style="padding:16px 20px">'
        +'<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'+imgH
        +'<div style="text-align:left"><div style="font-size:15px;font-weight:700;color:var(--text)">'+displayName(nm)+'</div>'
        +(fc?'<div style="font-size:12px;color:var(--muted2)"><strong style="color:var(--text)">'+playerTierLabel(fc.value,(sp&&sp.id)||null).label+'</strong> · <strong style="color:'+((fc.trend30Day||0)>=60?'var(--green)':(fc.trend30Day||0)<=-60?'var(--red)':'var(--muted2)')+'">'+((fc.trend30Day||0)>250?'rising fast':(fc.trend30Day||0)>60?'rising':(fc.trend30Day||0)<-250?'falling fast':(fc.trend30Day||0)<-60?'falling':'steady')+'</strong>'+(sp&&sp.pos?' · '+sp.pos+' '+(fc.positionRank?'#'+fc.positionRank:''):'')+'</div>':'<div style="font-size:12px;color:var(--muted)">No live market value for this player.</div>')
        +'</div></div>'
        +'<div id="mkt-snap-chart"></div>'
        +(note?'<div style="font-size:11px;color:var(--muted2);margin-top:10px;line-height:1.6;text-align:left">'+note.note+'</div>':'')
        +'</div>';
      var box=document.getElementById('mkt-snap-chart');
      function drawSeries(s,label){
        if(!box||s.length<2)return;
        var vals=s.map(function(p){return p.value;});
        var min=Math.min.apply(null,vals),max=Math.max.apply(null,vals),range=(max-min)||Math.max(1,max*0.1);
        var W=460,H=130,step=W/(s.length-1);
        var pts=s.map(function(p,i){return (i*step).toFixed(1)+','+(H-14-((p.value-min)/range)*(H-28)).toFixed(1);}).join(' ');
        var up=vals[vals.length-1]>=vals[0];
        var col=up?'#22c55e':'#ef4444';
        box.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:460px;margin-top:4px">'
          +'<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
          +'<circle cx="'+(W)+'" cy="'+(H-14-((vals[vals.length-1]-min)/range)*(H-28)).toFixed(1)+'" r="4.5" fill="'+col+'"/>'
          +'<text x="0" y="'+(H-2)+'" fill="var(--muted)" font-size="10">'+s[0].date+'</text>'
          +'<text x="'+W+'" y="'+(H-2)+'" text-anchor="end" fill="var(--muted)" font-size="10">'+s[s.length-1].date+'</text>'
          +'</svg><div style="font-size:10px;color:var(--muted)">'+label+'</div>';
      }
      // Immediate chart from the 30-day trend; snapshots replace it once we have 3+ days
      if(fc&&fc.value){
        var d30=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
        var today=new Date().toISOString().slice(0,10);
        var startVal=Math.max(0,fc.value-(fc.trend30Day||0));
        var mid=Math.round((startVal+fc.value)/2+(fc.trend30Day||0)*0.08);
        drawSeries([{date:d30,value:startVal},{date:'',value:mid},{date:today,value:fc.value}],'Last 30 days · FantasyCalc market trend');
      }
      if(pid){
        fetch('/api/ktc/history/'+pid).then(function(r){return r.json();}).then(function(d){
          var s=d.series||[];
          if(s.length>=3)drawSeries(s,s[0].date+' to '+s[s.length-1].date+' · daily tracked values');
        }).catch(function(){});
      }
    }
    return;
  }

  var v = h.values;
  var pts = [];
  for(var i=0;i<v.length;i++){if(v[i]!==null) pts.push({i:i,val:v[i],yr:MKT_YEARS[i]});}
  if(pts.length<2) return;

  var cur = pts[pts.length-1].val;
  var first = pts[0].val;
  var isUp = cur >= first;
  var chgAbs = cur - first;
  var chgPct = Math.round((chgAbs/first)*100);
  var lineColor = isUp ? '#22c55e' : '#ef4444';

  // 1-yr change
  var prev = v[5]; var yr1Pct = null;
  if(prev!==null) yr1Pct = Math.round(((cur-prev)/prev)*100);

  // SVG chart
  var W=560,H=180,PL=52,PB=28,PT=16,PR=16;
  var cW=W-PL-PR, cH=H-PB-PT;
  var minV=Math.min.apply(null,pts.map(function(p){return p.val;}));
  var maxV=Math.max.apply(null,pts.map(function(p){return p.val;}));
  var vRange=maxV-minV||maxV;
  var minI=pts[0].i, maxI=pts[pts.length-1].i, iRange=maxI-minI||1;

  function cx(i){return PL+((i-minI)/iRange)*cW;}
  function cy(val){return PT+cH-((val-minV)/vRange)*cH;}

  var lineD = pts.map(function(p,j){return (j===0?'M':'L')+cx(p.i).toFixed(1)+','+cy(p.val).toFixed(1);}).join(' ');
  var areaD = 'M'+cx(pts[0].i).toFixed(1)+','+(PT+cH)+' '+
    pts.map(function(p){return 'L'+cx(p.i).toFixed(1)+','+cy(p.val).toFixed(1);}).join(' ')+
    ' L'+cx(pts[pts.length-1].i).toFixed(1)+','+(PT+cH)+' Z';

  var gradId = 'mktGrad'+Date.now();
  var dots = pts.map(function(p,j){
    var isLast=j===pts.length-1;
    return '<circle cx="'+cx(p.i).toFixed(1)+'" cy="'+cy(p.val).toFixed(1)+'" r="'+(isLast?5:3.5)+'" fill="'+(isLast?lineColor:'var(--surface)')+'" stroke="'+lineColor+'" stroke-width="2"/>'
      +''
      +'<text x="'+cx(p.i).toFixed(1)+'" y="'+(PT+cH+18)+'" text-anchor="middle" fill="var(--muted)" font-size="11">'+p.yr+'</text>';
  }).join('');

  var svg = '<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">'
    +'<defs><linearGradient id="'+gradId+'" x1="0" y1="0" x2="0" y2="1">'
    +'<stop offset="0%" stop-color="'+lineColor+'" stop-opacity="0.25"/>'
    +'<stop offset="100%" stop-color="'+lineColor+'" stop-opacity="0"/>'
    +'</linearGradient></defs>'
    +'<path d="'+areaD+'" fill="url(#'+gradId+')" />'
    +'<path d="'+lineD+'" fill="none" stroke="'+lineColor+'" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
    +dots
    +'</svg>';

  var slId = findSleeperIdByName(nm);
  var imgHtml = slId ? '<img src="https://sleepercdn.com/content/nfl/players/thumb/'+slId+'.jpg" onerror="this.style.display=\'none\'" style="width:52px;height:52px;border-radius:50%;border:2px solid var(--border2);object-fit:cover">' : '';

  var posC = {QB:'#a78bfa',WR:'#fbbf24',RB:'#4ade80',TE:'#f87171'};
  var chgColor = isUp ? '#22c55e' : '#ef4444';
  var chgArrow = isUp ? '▲' : '▼';

  var yr1Html = yr1Pct!==null ? '<span style="font-size:11px;color:var(--muted);margin-left:10px">1-yr: '+(yr1Pct>=0?'+':'')+yr1Pct+'%</span>' : '';

  document.getElementById('mkt-chart-content').innerHTML =
    '<div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">'
    +imgHtml
    +'<div>'
    +'<div style="font-size:20px;font-weight:700;color:var(--text)">'+displayName(nm)+'</div>'
    +'<div style="font-size:11px;color:'+(posC[h.pos]||'var(--muted)')+';font-weight:600;margin-top:2px">'+h.pos+' · '+h.team+'</div>'
    +'</div>'
    +'<div style="margin-left:auto;text-align:right">'
    +'<div style="font-size:22px;font-weight:700;font-family:var(--font-head);color:var(--text)">'+playerTierLabel(cur,null).label+'</div>'
    +'<div style="font-size:13px;font-weight:600;color:'+chgColor+'">'+chgArrow+' '+(isUp?'+':'')+chgPct+'% vs '+pts[0].yr
    +yr1Html+'</div>'
    +'<div style="font-size:10px;color:var(--muted);margin-top:2px">Dynasty Value (KTC scale)</div>'
    +'</div>'
    +'</div>'
    +'<div style="position:relative">'+svg+'</div>'
    +'<div style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">Values represent dynasty ranking (KeepTradeCut / FantasyCalc scale, 0–10,000) at each season end</div>';
}

// ─── STASH / WAIVER TARGETS ───────────────────────────────────────────────────


// ── RANK 'EM: community head-to-head consensus ─────────────────────────────
var _rankPair=null,_rankVoting=false;
var _rankMode='dynasty';
function rankEmSetMode(mode){
  _rankMode=mode;
  var d=document.getElementById('rankem-mode-dynasty'),r=document.getElementById('rankem-mode-redraft');
  if(d)d.classList.toggle('active',mode==='dynasty');
  if(r)r.classList.toggle('active',mode==='redraft');
  window._rankValues=null;
  rankEmNext(true);
}
async function rankEmNext(skip){
  await ensurePlayersLoaded();
  // Each mode votes against its own value pool
  if(!window._rankValues){
    try{
      var vr=await fetch('/api/ktc/rankings?numQbs=1&ppr=1&isDynasty='+(_rankMode==='redraft'?'false':'true'));
      var vd=await vr.json();
      window._rankValues=(vd.byId&&Object.keys(vd.byId).length)?vd.byId:null;
    }catch(_){}
  }
  var vals=window._rankValues||ktcById;
  if(!Object.keys(vals).length){await fetchKtcValues(1,1,_rankMode!=='redraft');vals=ktcById;}
  var box=document.getElementById('rankem-matchup');
  if(!box)return;
  var modeEl=document.getElementById('rankem-mode-label');
  if(modeEl)modeEl.textContent=_rankMode==='redraft'?'Redraft: who scores more THIS season?':'Dynasty: who would you rather build with?';
  // Pull two different players from the top ~90 by value, weighted to nearby ranks for tension
  var top=Object.values(allPlayers).filter(function(p){return (vals[p.id]||0)>2500&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;})
    .sort(function(a,b){return (vals[b.id]||0)-(vals[a.id]||0);}).slice(0,90);
  if(top.length<2)return;
  var i=Math.floor((Date.now()+ (skip?7:0))%top.length);
  var a=top[i];
  // "Who scores more this season" only makes sense within a position: in redraft
  // mode the matchup is always same-position. Dynasty keeps cross-position value calls.
  var pool2=_rankMode==='redraft'?top.filter(function(p){return p.pos===a.pos&&p!==a;}):top.filter(function(p){return p!==a;});
  if(!pool2.length)pool2=top.filter(function(p){return p!==a;});
  var j2=Math.min(pool2.length-1,3+Math.floor((Date.now()/1000)%6));
  var b=pool2[j2]||pool2[0];
  _rankPair=[a,b];_rankVoting=false;
  function card(p,side){
    return '<div class="rankem-card" id="rankem-card-'+side+'" onclick="rankEmVote('+side+')" style="cursor:pointer;text-align:center;padding:16px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:14px;transition:all .15s">'
      +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid var(--border2)" onerror="this.style.visibility=\'hidden\'">'
      +'<div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--text);margin-top:8px">'+p.name+'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+p.pos+' · '+teamLogo(p.team,12)+(p.team||'FA')+'</div></div>';
  }
  box.innerHTML=card(a,0)+'<div style="font-family:var(--font-head);font-weight:800;color:var(--muted);font-size:14px">OR</div>'+card(b,1);
  rankEmBoard();
}
async function rankEmVote(side){
  if(_rankVoting||!_rankPair)return;
  _rankVoting=true;
  var w=_rankPair[side],l=_rankPair[side?0:1];
  // Green-light flash on the picked card, then roll the next matchup
  var winEl=document.getElementById('rankem-card-'+side);
  var loseEl=document.getElementById('rankem-card-'+(side?0:1));
  if(winEl){
    winEl.classList.add('rankem-picked');
    try{sndPickSoft();}catch(_){}
    try{
      var rp=document.createElement('div');
      rp.style.cssText='position:absolute;inset:0;border-radius:inherit;border:2px solid var(--green);pointer-events:none';
      winEl.style.position='relative';winEl.appendChild(rp);
      rp.animate([{opacity:.8,transform:'scale(1)'},{opacity:0,transform:'scale(1.12)'}],{duration:520,easing:'cubic-bezier(.16,1,.3,1)'});
      setTimeout(function(){rp.remove();},600);
    }catch(_){}
  }
  if(loseEl)loseEl.style.opacity='.35';
  fetch('/api/community/rank',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({winner:w.id,loser:l.id,winnerName:w.name,loserName:l.name,mode:_rankMode})}).catch(function(){});
  setTimeout(rankEmNext,520);
}
async function rankEmBoard(){
  var el=document.getElementById('rankem-board');
  if(!el)return;
  try{
    var r=await fetch('/api/community/rankings?mode='+_rankMode);var d=await r.json();
    var list=(d.rankings||[]).slice(0,15);
    if(!list.length){el.innerHTML='<div class="empty-state">Be the first vote - the board builds itself from here.</div>';return;}
    el.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">'+(_rankMode==='redraft'?'Redraft':'Dynasty')+' consensus board</div>'
      +list.map(function(p){
      return '<div class="lb-row" style="padding:8px 12px"><div style="width:24px;font-weight:800;color:var(--accent-bright);font-family:var(--font-head)">'+p.rank+'</div>'
        +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:30px;height:30px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'">'
        +'<div class="lb-info"><div class="lb-trade" style="font-size:13px">'+p.name+'</div><div class="lb-meta">'+(p.seeded?'market baseline - vote to make it the crowd\'s':p.votes+' votes · '+p.elo+' rating')+'</div></div></div>';
    }).join('');
  }catch(_){el.innerHTML='<div class="empty-state">Rankings unavailable right now.</div>';}
}

// ── MOCK DRAFT WITH MAC ─────────────────────────────────────────────────────
var MD_STRATS={
  bpa:{name:'Best Available',desc:'Take the highest-value player on the board every time.',icon:'★'},
  zerorb:{name:'Zero RB',desc:'Load up on WR/TE early, wait on RB until the mid rounds.',icon:'○'},
  herorb:{name:'Hero RB',desc:'One elite RB early, then hammer WR.',icon:'◆'},
  robustrb:{name:'Robust RB',desc:'Two RBs in the first three rounds, build a wall.',icon:'▲'},
  elitete:{name:'Elite TE',desc:'Grab a top-3 tight end early for the weekly edge.',icon:'◇'}
};
var MD={pool:[],order:[],pickIdx:0,mySlot:5,rounds:8,teams:12,mine:[],log:[],strat:'bpa',scoring:1,sf:false};

function mdRenderStrats(){
  var box=document.getElementById('md-strats');
  if(!box)return;
  box.innerHTML=Object.keys(MD_STRATS).map(function(k){
    var s=MD_STRATS[k];var on=MD.strat===k;
    return '<div class="md-strat-card'+(on?' on':'')+'" onclick="MD.strat=\''+k+'\';mdRenderStrats()">'
      +'<div style="font-size:13px;font-weight:700;color:'+(on?'var(--accent-bright)':'var(--text)')+'">'+s.icon+' '+s.name+'</div>'
      +'<div style="font-size:10px;color:var(--muted);line-height:1.4;margin-top:3px">'+s.desc+'</div></div>';
  }).join('');
}

// Draft value: adjust market value by scoring + format so the board matches the settings
function mdValue(p){
  var fc=ktcFull[p.id]||{};
  var v=fc.redraftValue>0?fc.redraftValue:(ktcById[p.id]||0);
  if(MD.sf&&p.pos==='QB')v*=1.7;               // superflex makes QBs premium
  else if(!MD.sf&&p.pos==='QB')v*=0.72;         // 1QB pushes QBs down
  if(MD.scoring>=1){if(p.pos==='WR')v*=1.06;if(p.pos==='TE')v*=1.05;}  // PPR lifts pass-catchers
  else if(MD.scoring===0){if(p.pos==='RB')v*=1.08;}                    // standard lifts RBs
  return v;
}

// Toggle a panel showing the players you've drafted so far, grouped by position.
function mdShowMyRoster(){
  var box=document.getElementById('md-player-peek');if(!box)return;
  if(box.dataset.roster==='1'){box.style.display='none';box.dataset.roster='';return;}
  var mine=MD.mine||[];
  if(!mine.length){box.innerHTML='<div style="font-size:12px;color:var(--muted)">You haven\'t drafted anyone yet.</div>';}
  else{
    var col={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'var(--muted)',DEF:'var(--muted)'};
    var by={QB:[],RB:[],WR:[],TE:[],K:[],DEF:[]};
    mine.forEach(function(p){if(by[p.pos])by[p.pos].push(p);});
    var html='<div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:8px">Your team ('+mine.length+')</div>';
    ['QB','RB','WR','TE','K','DEF'].forEach(function(pos){
      if(!by[pos].length)return;
      html+='<div style="margin-bottom:6px;line-height:1.6"><span style="font-size:10px;font-weight:800;color:'+col[pos]+';text-transform:uppercase">'+pos+'</span> <span style="font-size:12.5px;color:var(--muted2)">'+by[pos].map(function(p){return escHtml(p.name);}).join(', ')+'</span></div>';
    });
    box.innerHTML=html;
  }
  box.style.display='block';box.dataset.roster='1';
}
// The mock draft is the front door: one entry point shared by the nav, the
// hero and the home CTA. Lands on the solo setup with league prefill applied.
function goMock(sec){
  switchScreen('mock');
  try{mdRenderStrats();mdPrefillFromLeague();}catch(_){}
  try{mdShowSection(sec||'solo');}catch(_){}
}
// Hero starter: carry the typed league description straight into the setup so
// the star field arrives already filled.
function heroStartMock(){
  var v=((document.getElementById('hero-mock-ctx')||{}).value||'').trim();
  goMock('solo');
  if(v){
    var box=document.getElementById('md-context');
    if(box){box.value=v;try{localStorage.setItem('tm_md_context',v);}catch(_){}try{mdContextPreview();}catch(_){}}
  }
}
// The slot dropdown always matches the room size: change teams and the seat
// list rebuilds, keeping the current seat when it still exists.
function mdSyncSlots(){
  var t=parseInt((document.getElementById('md-teams')||{}).value)||12;
  var sl=document.getElementById('md-slot');
  if(!sl)return;
  var cur=parseInt(sl.value)||5;
  if(sl.options.length===t&&parseInt(sl.options[sl.options.length-1].value)===t){try{mdRenderProfiles();}catch(_){}return;}
  sl.innerHTML='';
  for(var i=1;i<=t;i++){
    var o=document.createElement('option');o.value=String(i);o.textContent=String(i);
    if(i===Math.min(cur,t))o.selected=true;
    sl.appendChild(o);
  }
  try{mdRenderProfiles();}catch(_){}  // seat rows follow the room size
}
// ── League drafter profiles: a name + drafting personality per seat ─────────
// The whole point: mock against YOUR league. Each seat can carry a real
// manager's name and one of the ten engine archetypes (MD_ARCHS below);
// "Random" keeps the normal random deal for that seat. Saved per league
// (tm_md_profiles_{leagueId}, or tm_md_profiles with no league) so the same
// room comes back every time this league mocks.
// PRECEDENCE (documented once, enforced in mdAdvance): the free-text context
// still outranks everything - on any position the user's context or league
// settings touched, EVERY archetype nudge (profiled or dealt) shrinks to a
// whisper (bAdj*=0.2 via MD.userPos). A profile only decides WHICH archetype
// a seat plays, standing in for the random deal - never overriding user data.
// MD_ARCHS: posAdj = dv nudge in the mid rounds; eliteAdj = a smaller nudge
// that IS allowed to reorder the top two rounds (a real zero-RB drafter
// passes on elite RBs too - the faller rescue keeps it from going absurd);
// reachP = odds of jumping early on a sleeper.
var MD_ARCHS=[
  {k:'zerorb',   posAdj:{RB:-420,WR:200,TE:60}, eliteAdj:{RB:-260,WR:120}, reachP:0.06},
  {k:'herorb',   posAdj:{WR:160},               eliteAdj:{RB:160},         reachP:0.05, hero:1},
  {k:'robustrb', posAdj:{RB:340,WR:-80},        eliteAdj:{RB:200},         reachP:0.03},
  {k:'earlyqb',  posAdj:{QB:380},               eliteAdj:{QB:240},         reachP:0.05},
  {k:'lateqb',   posAdj:{QB:-500},              eliteAdj:{QB:-220},        reachP:0.05},
  {k:'tehunter', posAdj:{TE:360},               eliteAdj:{TE:220},         reachP:0.04, teCap:2},
  {k:'bpa',      posAdj:{},                     eliteAdj:{},               reachP:0.01},
  {k:'hype',     posAdj:{},                     eliteAdj:{},               reachP:0.22, young:1},
  {k:'homer',    posAdj:{},                     eliteAdj:{},               reachP:0.06, homer:1},
  {k:'valuestrict',posAdj:{},                   eliteAdj:{},               reachP:0,    rescue:1}
];
// fan-heavy franchises a RANDOM homer roots for; a profiled homer picks any
var HOMER_TEAMS=['KC','PHI','DAL','SF','BUF','DET','GB','MIA','BAL','CIN','NYJ','MIN','LAC','SEA','PIT','DEN'];
var MD_NFL_TEAMS=['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'];
// human labels for the picker, in the panel's display order
var MD_PROFILE_LABELS=[
  ['zerorb','Zero RB truther'],['herorb','Hero RB'],['robustrb','Robust RB'],
  ['earlyqb','QB early'],['lateqb','QB late'],['tehunter','TE hunter'],
  ['bpa','Best available'],['hype','Hype chaser'],['homer','Homer'],
  ['valuestrict','Value strict']
];
// plain-English explanations (owner's call: a casual player has no idea what
// a "homer" or a "Zero RB truther" is) - option tooltips + the panel legend
var MD_PROFILE_DESC={
  zerorb:'Skips running backs early - loads up on receivers first',
  herorb:'One elite RB early, then hammers wide receivers',
  robustrb:'Pounds running backs in the first rounds, builds a wall',
  earlyqb:'Grabs a top quarterback rounds earlier than most people',
  lateqb:'Waits forever on QB - fills the other spots first',
  tehunter:'Reaches early for an elite tight end',
  bpa:'Pure value - always takes the best player on the board',
  hype:'Reaches for the hot young names the group chat loves',
  homer:'Overpays for players from their favorite NFL team',
  valuestrict:'Never reaches - pounces on anyone who slides'
};
// Fantazy 2026: the owner's real Yahoo room (league id 664858, "league 2021")
// as a one-tap preset. Names seat-ordered from the live league; seat 9 is the
// owner ("Alan goat") and renders as "You". Seat 6's nickname really carries
// quotes - typographic ones, because straight quotes are stripped by
// _mdProfName (they would break the title="" attributes the name lands in).
// Seats renamed to the TEAM names (owner's call, 8/2026) and personalities
// INFERRED FROM THE REAL 2025 DRAFT the owner supplied (15 rounds, pick by
// pick). Seat 9 (Falafel) is the owner. mods = per-seat tweaks on top of the
// base archetype:
//  - the two zero-RB seats run a SOFTENED fade (~70% of the archetype's) -
//    owner's read: "maybe that draft just fell that way"; they lean WR, they
//    don't leave value on the table (the universal slide-rescue still caps
//    any real faller for every bot).
//  - Family Feud is robust-RB but "pica rookies mucho": young reach flag.
var FZ26_SEED_V=3;
var FZ26_SEATS={
  1:{name:'Ness',arch:'bpa'},
  2:{name:'Tyjae Spears',arch:'zerorb',mods:{posAdj:{RB:-290,WR:140,TE:40},eliteAdj:{RB:-170,WR:80}}},
  3:{name:'THE DREAM TEAM',arch:'robustrb'},
  4:{name:'SUCK IT',arch:'robustrb'},
  5:{name:'H Yaazor',arch:'earlyqb'},
  6:{name:'Real Madrid',arch:'hype'},
  7:{name:'rana jr',arch:'zerorb',mods:{posAdj:{RB:-290,WR:140,TE:40},eliteAdj:{RB:-170,WR:80}}},
  8:{name:'Adrian Peterson',arch:'tehunter'},
  9:{name:'Falafel',arch:'valuestrict'},
  10:{name:'Family Feud ...',arch:'robustrb',mods:{young:1,reachP:0.10}}
};
// Which of the ten IS the user: seats are fixed by the 2025 draft order, so
// picking your team just moves your seat to that team's chair. Persisted so a
// reload keeps you as yourself.
function mdFz26SetMe(seat){
  seat=parseInt(seat,10);if(!seat)return;
  try{localStorage.setItem('tm_md_fz26_me',String(seat));}catch(_){}
  var sl=document.getElementById('md-slot');
  if(sl){sl.value=String(seat);try{mdSaveSettings();}catch(_){}}
  MD._fzSlot=seat;
  try{mdRenderProfiles();}catch(_){}
}
function _mdFz26Me(){
  try{var v=parseInt(localStorage.getItem('tm_md_fz26_me'),10);if(v>=1&&v<=10)return v;}catch(_){}
  return null;
}
// legacy alias for any straggler references: seat -> name
var FZ26_NAMES={};Object.keys(FZ26_SEATS).forEach(function(k){FZ26_NAMES[k]=FZ26_SEATS[k].name;});
// FZ26 auction market constants (owner-calibrated, see auBotMax):
var FZ26_RB_PREM_ELITE=1.18; // "Bijan $63 AAV se va 74-75" => ~1.18x on elite RBs
var FZ26_RB_PREM=1.10;       // the same lean on the rest of the RB board, softer
var FZ26_RB_ELITE_AAV=40;    // elite line for the premium: top-tier RB money
var AU_BID_CAP=1.15;         /* Measured, not guessed (8/2026): at 1.20 the elite mean was
                                1.096x and the worst sale $85; at 1.15 the mean is 1.071x and
                                the worst $81, with money still clearing (unspent $3.6 avg) and
                                the $1 endgame intact. Below 1.15 the mean stops moving (1.10
                                gives the same 1.071x) - so 1.15 is exactly where the ceiling
                                stops touching normal sales and only clips bidding wars. */
var AU_CAP_SPREAD=0.13;      // each lot's ceiling lives in [cap-spread, cap] so prices spread naturally
var FZ26_BID_CAP=AU_BID_CAP; // fz26 uses the same ceiling (kept as its own name for the premium's docs)
var FZ26_CAP_FLOOR=5;        // stickers under $5 are endgame money-dumps, not market prices - exempt from the ceiling
function _mdFz26On(){try{return localStorage.getItem('tm_md_fantazy26')==='1';}catch(_){return false;}}
function _mdProfilesKey(){
  // the preset owns its own bucket: enabling never clobbers the saved
  // profiles of the connected league (or the global set), and the
  // personalities the owner assigns to his rivals persist with the preset
  if(_mdFz26On())return 'tm_md_profiles_fantazy26';
  return (typeof leagueId!=='undefined'&&leagueId)?('tm_md_profiles_'+leagueId):'tm_md_profiles';
}
// Toggle the preset: ON snapshots the current setup (so OFF is a faithful
// restore, reload-proof), applies the league's real shape, and seeds the ten
// member names once. Settings mapped to knobs the engine actually has:
// 10 teams / half PPR / 1QB / 15 rounds (QB+2RB+2WR+TE+FLEX+K+DEF = 9
// starters + 6 bench; the 2 IR slots are never drafted) / 6pt passing TDs
// via the existing md-6pt toggle / owner default seat 9. Roster-construction
// targets stay on Auto ON PURPOSE: those selects mean TOTAL players drafted
// per position, not starters - writing the starter counts (RB2/WR2...) there
// would cap every bench at zero, which is not what the league does.
function mdFantazy26Toggle(on){
  try{
    var set=function(id,v){var e=document.getElementById(id);if(e)e.value=v;};
    if(on){
      var snap={};
      ['md-teams','md-scoring','md-format','md-rounds','md-slot','md-dtype','md-budget'].forEach(function(id){
        var e=document.getElementById(id);if(e)snap[id]=e.value;
      });
      snap['md-6pt']=!!(document.getElementById('md-6pt')||{}).checked;
      localStorage.setItem('tm_md_fantazy26_prev',JSON.stringify(snap));
      localStorage.setItem('tm_md_fantazy26','1');
      set('md-teams','10');try{mdSyncSlots();}catch(_){}
      set('md-scoring','0.5');set('md-format','1qb');set('md-rounds','15');
      set('md-slot',String(_mdFz26Me()||9));  // your team's chair, if you picked one
      // the league's 2026 draft IS an auction (owner's word) - the preset
      // seats the room in auction mode, $200 Yahoo-standard budgets
      set('md-dtype','auction');set('md-budget','200');
      try{mdDtypeSync();}catch(_){}
      var c6=document.getElementById('md-6pt');if(c6)c6.checked=true;
      var ft=document.getElementById('md-finetune');if(ft)ft.open=true; // the 6pt flip stays visible
      // versioned seed - enforced at the READ point (_mdFz26Bucket), because
      // a device whose toggle was already ON never re-runs this branch; the
      // call here just makes the first enable eager instead of lazy
      try{_mdFz26Bucket();}catch(_){}
      MD._fzSlot=_mdFz26Me()||9;
    }else{
      localStorage.removeItem('tm_md_fantazy26');
      var snap2=null;try{snap2=JSON.parse(localStorage.getItem('tm_md_fantazy26_prev')||'null');}catch(_){}
      if(snap2){
        if(snap2['md-teams']!=null){set('md-teams',snap2['md-teams']);try{mdSyncSlots();}catch(_){}}
        ['md-scoring','md-format','md-rounds','md-slot','md-dtype','md-budget'].forEach(function(id){
          if(snap2[id]!=null)set(id,snap2[id]);
        });
        try{mdDtypeSync();}catch(_){}
        var c6b=document.getElementById('md-6pt');if(c6b)c6b.checked=!!snap2['md-6pt'];
      }
      localStorage.removeItem('tm_md_fantazy26_prev');
      MD._fzSlot=null;
    }
    try{mdSaveSettings();}catch(_){}
    try{mdRenderProfiles();}catch(_){}
  }catch(_){}
}
// Fantazy 2026 seat move: the owner IS his seat ("Alan goat" follows him),
// so moving sends the displaced manager to the vacated seat - all nine named
// rivals stay in the room. No-op while the preset is off.
function _mdFz26SeatMoved(now){
  if(!_mdFz26On())return;
  var was=MD._fzSlot;
  if(now&&was&&now!==was){
    var o=mdGetProfiles();
    if(o[now]){o[was]=o[now];delete o[now];_mdProfilesSave(o);}
  }
  if(now)MD._fzSlot=now;
}
// The fz26 bucket, version-checked AT THE READ POINT: a device whose toggle
// was already ON when the seed evolved never re-runs mdFantazy26Toggle, so a
// toggle-time-only check left v1 buckets (old owner names, no _v) alive
// forever - the owner hit exactly that. A stale or missing bucket reseeds
// from FZ26_SEATS, OVERWRITING v1 personalities tied to the old names (the
// correct call: they described seats that no longer exist); tweaks made on
// the CURRENT version pass through untouched. Idempotent, and it costs the
// one JSON.parse every read already paid.
function _mdFz26Bucket(){
  var cur=null;try{cur=JSON.parse(localStorage.getItem('tm_md_profiles_fantazy26')||'null');}catch(_){}
  if(cur&&cur._v===FZ26_SEED_V)return cur;
  var seed={_v:FZ26_SEED_V};
  Object.keys(FZ26_SEATS).forEach(function(s){
    var e=FZ26_SEATS[s];
    seed[s]={name:e.name,arch:e.arch||''};
    if(e.mods)seed[s].mods=e.mods;
  });
  try{localStorage.setItem('tm_md_profiles_fantazy26',JSON.stringify(seed));}catch(_){}
  return seed;
}
function mdGetProfiles(){
  try{
    if(_mdFz26On())return _mdFz26Bucket();
    return JSON.parse(localStorage.getItem(_mdProfilesKey())||'null')||{};
  }catch(_){return {};}
}
function _mdProfilesSave(o){try{localStorage.setItem(_mdProfilesKey(),JSON.stringify(o));}catch(_){}}
// Display names of the connected league's members, in league order, minus the
// user (their seat is "You"). loadLeague fills leagueUsers from Sleeper.
function _mdLeagueMemberNames(){
  try{
    if(_mdFz26On())return [];  // the preset room is the Yahoo league, not the connected Sleeper one
    return (leagueUsers||[]).filter(function(u){return u.user_id!==userId;})
      .map(function(u){return ((u.metadata&&u.metadata.team_name)||u.display_name||'').trim();})
      .filter(Boolean);
  }catch(_){return [];}
}
// The profiles the ENGINE sees for a room of this size: saved edits merged
// over the league-name defaults, so a connected league drafts under its real
// member names even if the panel was never opened. More seats than members
// leaves the extras fully random.
function mdEffectiveProfiles(teams,mySlot){
  var saved=mdGetProfiles();
  var names=_mdLeagueMemberNames();
  var out={},ni=0;
  for(var s=1;s<=teams;s++){
    if(s===mySlot)continue;
    var pr=saved[s]||{};
    var nm=(pr.name!=null?pr.name:(names[ni]||'')).trim();
    ni++;
    if(!nm&&!pr.arch)continue;
    out[s]={name:nm,arch:pr.arch||'',team:pr.team||'',mods:pr.mods||null};
  }
  return out;
}
// escape once at write time: these names land in innerHTML all over the board
function _mdProfName(v){return String(v||'').replace(/[<>&"']/g,'').slice(0,20);}
function mdProfileSet(seat,field,val){
  var o=mdGetProfiles();
  o[seat]=o[seat]||{};
  o[seat][field]=field==='name'?_mdProfName(val):val;
  // a hand-picked personality is a clean statement: drop any inferred mods
  // (the softened fades / rookie flags from the 2025-draft seeding)
  if(field==='arch')delete o[seat].mods;
  _mdProfilesSave(o);
  if(field==='arch')mdRenderProfiles();  // homer shows/hides its team select
}
function mdProfilesRandomizeAll(){
  var teams=parseInt((document.getElementById('md-teams')||{}).value)||12;
  var mySlot=parseInt((document.getElementById('md-slot')||{}).value)||5;
  var o=mdGetProfiles();
  for(var s=1;s<=teams;s++){
    if(s===mySlot)continue;
    o[s]=o[s]||{};
    o[s].arch=MD_PROFILE_LABELS[Math.floor(Math.random()*MD_PROFILE_LABELS.length)][0];
    if(o[s].arch==='homer'&&!o[s].team)o[s].team=HOMER_TEAMS[Math.floor(Math.random()*HOMER_TEAMS.length)];
  }
  _mdProfilesSave(o);
  mdRenderProfiles();
}
function mdProfilesClear(){
  try{localStorage.removeItem(_mdProfilesKey());}catch(_){}
  mdRenderProfiles();
}
// The panel lives in JS, not index.html (same pattern as md-draftbar): it is
// injected once as a sibling of the fine-tune details. Styling: inherited
// setup classes (tm-input/opp-select) plus the #md-profiles rules in
// theme.css - all var(--...) driven, so the light-sheet token flip paints it.
function _mdEnsureProfilesPanel(){
  if(document.getElementById('md-profiles'))return;
  var ft=document.getElementById('md-finetune');
  if(!ft||!ft.insertAdjacentHTML)return;
  // The Fantazy 2026 switch lives OUTSIDE the collapsed panels, visible the
  // moment the setup opens (owner's call), and says exactly what it applies.
  ft.insertAdjacentHTML('beforebegin',
    '<div id="md-fz26-bar" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);margin:0 0 14px">'
    +'<label style="display:inline-flex;align-items:center;gap:10px;cursor:pointer;flex:1;min-width:0">'
    +'<input type="checkbox" id="md-fantazy26" class="md-fz26-tick" onchange="mdFantazy26Toggle(this.checked)" style="accent-color:var(--accent-bright);width:18px;height:18px;margin:0;flex:none">'
    +'<span style="min-width:0"><span style="display:block;font-size:13px;font-weight:800;color:var(--text)">Fantazy 2026</span>'
    +'<span style="display:block;font-size:11.5px;color:var(--muted2);margin-top:2px">Applies every league 2021 setting: Auction $200 &middot; 10 teams &middot; Half PPR &middot; 1QB &middot; 6pt pass TD &middot; your 10 managers in their seats</span></span>'
    +'</label></div>');
  ft.insertAdjacentHTML('afterend',
    '<details id="md-profiles" style="margin:-6px 0 16px">'
    +'<summary style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;cursor:pointer;padding:4px 0">Your league\'s drafters: names and personalities</summary>'
    +'<div style="padding:12px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);margin-top:8px">'
    +'<div id="md-profiles-note" style="font-size:11.5px;color:var(--muted2);margin-bottom:10px"></div>'
    +'<div id="md-profiles-rows" style="display:flex;flex-direction:column;gap:6px"></div>'
    +'<details style="margin-top:10px"><summary style="font-size:11px;font-weight:700;color:var(--accent-bright);cursor:pointer">What do these styles mean?</summary>'
    +'<div style="margin-top:8px;display:grid;gap:5px">'
    +MD_PROFILE_LABELS.map(function(al){
      return '<div style="font-size:11.5px;line-height:1.45"><strong style="color:var(--text)">'+al[1]+'</strong> <span style="color:var(--muted2)">- '+MD_PROFILE_DESC[al[0]]+'</span></div>';
    }).join('')
    +'</div></details>'
    +'<div style="display:flex;gap:8px;margin-top:12px">'
    +'<button class="btn-sm" onclick="mdProfilesRandomizeAll()" title="Deal every seat a random personality">Randomize all</button>'
    +'<button class="btn-sm" onclick="mdProfilesClear()" title="Back to random names and personalities">Clear</button>'
    +'</div></div></details>');
}
function mdRenderProfiles(){
  try{_mdEnsureProfilesPanel();}catch(_){}
  var box=document.getElementById('md-profiles-rows');
  if(!box)return;
  var teams=parseInt((document.getElementById('md-teams')||{}).value)||12;
  var mySlot=parseInt((document.getElementById('md-slot')||{}).value)||5;
  var saved=mdGetProfiles();
  var names=_mdLeagueMemberNames();
  var fzOn=_mdFz26On();
  var fzCb=document.getElementById('md-fantazy26');
  if(fzCb)fzCb.checked=fzOn;
  if(fzOn&&MD._fzSlot==null)MD._fzSlot=mySlot;  // reload with the preset on
  // "Which of these ten are you?" - the seats belong to the teams (2025 draft
  // order), so choosing your team simply seats you in its chair
  var meBox=document.getElementById('md-fz26-me');
  if(fzOn){
    if(!meBox){
      var host=document.getElementById('md-profiles-note');
      if(host&&host.insertAdjacentHTML){
        host.insertAdjacentHTML('afterend','<div id="md-fz26-me" style="display:flex;align-items:center;gap:9px;margin-bottom:12px;flex-wrap:wrap"></div>');
        meBox=document.getElementById('md-fz26-me');
      }
    }
    if(meBox){
      var meSeat=_mdFz26Me()||mySlot;
      meBox.innerHTML='<span style="font-size:12.5px;font-weight:700;color:var(--text)">In this league I am</span>'
        +'<select class="opp-select" style="width:auto;min-width:190px" onchange="mdFz26SetMe(this.value)">'
        +Object.keys(FZ26_SEATS).sort(function(a,b){return a-b;}).map(function(k){
          return '<option value="'+k+'"'+(String(meSeat)===String(k)?' selected':'')+'>'+FZ26_SEATS[k].name+'</option>';
        }).join('')+'</select>';
    }
  }else if(meBox){meBox.remove();}
  var note=document.getElementById('md-profiles-note');
  if(note)note.textContent=fzOn
    ?'Fantazy 2026 is on: the real "league 2021" room. Set each rival\'s personality once - it sticks for every mock of this league.'
    :(typeof leagueId!=='undefined'&&leagueId&&names.length)
    ?'Your league’s managers, straight from '+(leagueName||'your league')+'. Give each one the personality you know they draft with - the bots will play it.'
    :'Name the drafters in your room and give each a personality. Connect a Sleeper league and the real member names fill in by themselves.';
  var html='',ni=0;
  for(var s=1;s<=teams;s++){
    if(s===mySlot){
      html+='<div style="display:flex;align-items:center;gap:8px">'
        +'<span style="width:22px;font-size:11px;font-weight:700;color:var(--muted);text-align:right;flex:none">'+s+'</span>'
        +'<span style="flex:1;font-size:12.5px;font-weight:700;color:var(--accent-bright)">You</span></div>';
      continue;
    }
    var pr=saved[s]||{};
    var nm=pr.name!=null?pr.name:(names[ni]||'');
    ni++;
    var arch=pr.arch||'';
    var opts='<option value=""'+(arch?'':' selected')+'>Random</option>'
      +MD_PROFILE_LABELS.map(function(al){
        return '<option value="'+al[0]+'" title="'+(MD_PROFILE_DESC[al[0]]||'')+'"'+(arch===al[0]?' selected':'')+'>'+al[1]+'</option>';
      }).join('');
    var teamSel=arch==='homer'
      ?'<select class="opp-select" style="width:auto;font-size:12px" title="The NFL team this homer overpays for" onchange="mdProfileSet('+s+',\'team\',this.value)">'
        +MD_NFL_TEAMS.map(function(t2){return '<option'+(pr.team===t2?' selected':'')+'>'+t2+'</option>';}).join('')+'</select>'
      :'';
    html+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +'<span style="width:22px;font-size:11px;font-weight:700;color:var(--muted);text-align:right;flex:none">'+s+'</span>'
      +'<input type="text" class="tm-input" style="flex:1;min-width:110px;padding:7px 10px;font-size:12.5px" maxlength="20" placeholder="Random name" value="'+nm.replace(/"/g,'&quot;')+'" oninput="mdProfileSet('+s+',\'name\',this.value)">'
      +'<select class="opp-select" style="width:auto;min-width:140px;font-size:12px" onchange="mdProfileSet('+s+',\'arch\',this.value)">'+opts+'</select>'
      +teamSel
      +'</div>';
  }
  box.innerHTML=html;
}
// Auto-draft: Mac runs your picks - queue first, then his recommendation,
// then best available - until you flip it back off. Solo rooms only.
function mdAutoToggle(on){
  MD.autoPilot=!!on;
  var cb=document.getElementById('md-auto');
  if(cb&&cb.checked!==MD.autoPilot)cb.checked=MD.autoPilot;
  if(MD.autoPilot&&MD.onClock&&!MP.active)_mdAutoPick();
}
function _mdAutoPick(){
  if(MD._autoT)clearTimeout(MD._autoT);
  // short beat so the board visibly lands on you before the pick fires
  MD._autoT=setTimeout(function(){
    if(!MD.autoPilot||!MD.onClock||MP.active)return;
    var p=null;
    (MD.queue||[]).some(function(pid){var f=MD.pool.find(function(x){return x.id===pid;});if(f){p=f;return true;}return false;});
    if(!p&&MD.lastRec&&MD.pool.indexOf(MD.lastRec)>=0)p=MD.lastRec;
    if(!p)p=MD.pool.filter(function(x){return x.pos!=='K'&&x.pos!=='DEF';})[0]||MD.pool[0];
    if(p)mdUserPick(p);
  },900);
}
// Mac's REAL read on a pick: one on-demand API call (never per hover, never
// automatic) carrying the full draft context - your roster, the round, the
// board - so the answer is about THIS pick in THIS room.
async function mdAskSageLive(pid,hostId){
  // hostId lets the big player card host the lanes in place; the war room's
  // Mac box stays the default
  var host=document.getElementById(hostId||'md-sage-live');
  if(!host||MD._sageLiveBusy)return;
  var p=pid?(_mdById(pid)||MD.lastRec):(MD.selChoice||MD.lastRec);
  if(!p)return;
  MD._sageLiveBusy=true;
  document.querySelectorAll('.md-sage-ask').forEach(function(b){b.style.opacity='.5';b.style.pointerEvents='none';});
  host.style.display='block';
  host.innerHTML='<div style="margin-top:10px;font-size:12px;color:var(--muted)">Mac is reading the board...</div>';
  try{host.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}
  var round=MD.curRound||Math.floor(MD.pickIdx/MD.teams)+1;
  var overall=MD.pickIdx+1;
  var mine=MD.mine.map(function(x){return x.pos+' '+x.name;}).join(', ')||'no one yet';
  var avail=MD.pool.filter(function(x){return x.pos!=='K'&&x.pos!=='DEF';}).slice(0,10)
    .map(function(x){return x.name+' ('+x.pos+(x.adp?', ADP '+(+x.adp).toFixed(0):'')+')';}).join('; ');
  var notes=[];
  try{
    [p].concat(MD.pool.slice(0,4)).forEach(function(x){
      if(notes.length>=5||!x)return;
      var n=noteForMode(getPlayerContextNote(x.name));
      if(n)notes.push({name:x.name.toLowerCase(),note:n.note,curve:n.curve});
    });
  }catch(_){}
  // One call, several lanes: drafting is strategy preference, so Mac lays
  // out the risk paths and the drafter picks the lane - never one answer.
  // The prompt DECLARES the format: without it Mac drifts into dynasty
  // reasoning (age curves, long-term value) on a seasonal board.
  var _mockDyn=(((document.getElementById('md-mode')||{}).value)||((typeof leagueMode!=='undefined')?leagueMode:'redraft'))==='dynasty';
  var q='MOCK DRAFT, LIVE PICK. Round '+round+', overall pick '+overall+' in a '+MD.teams+'-team '
    +(MD.sf?'superflex':'1QB')+' '+(MD.scoring>=1?'full PPR':MD.scoring===0.5?'half PPR':'standard')
    +' snake draft ('+MD.rounds+' rounds).'
    +(_mockDyn
      ?' This is a DYNASTY STARTUP mock draft - long-term value, age and situation all count.'
      :' This is a SEASONAL REDRAFT mock draft for the 2026 NFL season - reason ONLY about this season: role, volume, floor and ceiling. No dynasty value, no age curves beyond this year, no future picks.')
    +' The current year is 2026; player experience comes from the notes provided - never assume anyone is a rookie.'
    +' My roster so far: '+mine+'. Best available: '+avail
    +'. I was eyeing '+p.name+' ('+p.pos+', '+(p.team||'FA')+').'
    +' Give me my options by risk appetite, each a DIFFERENT player from the best-available list.'
    +' SAFE: the highest floor, proven volume. UPSIDE: the biggest ceiling swing.'
    +' VALUE: only if a listed player is genuinely PAST his ADP at this pick (current overall pick is '+overall+'); if nobody has actually slid, omit the VALUE line entirely.'
    +' NEED: only include it if my roster has a real hole it fills.'
    +' FORMAT STRICTLY, no intro or outro: one line per option, "LABEL: Player Name - one sharp reason tied to his real usage, situation or my roster." 2 to 4 lines total.';
  var full='';
  try{
    var res=await fetch('/api/sage/chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({messages:[{role:'user',content:q}],playerNotes:notes,leagueContext:_sageLeagueCtx(),user:localStorage.getItem('tm_username')||'',device:_deviceId()})});
    var ctype=res.headers.get('content-type')||'';
    if(ctype.indexOf('text/event-stream')<0){
      var d=await res.json().catch(function(){return {};});
      full=(res.ok&&d.answer)?d.answer:((d&&d.error)||'');
    }else{
      var reader=res.body.getReader(),dec=new TextDecoder(),buf='';
      while(true){
        var ch=await reader.read();if(ch.done)break;
        buf+=dec.decode(ch.value,{stream:true});
        var lines=buf.split('\n\n');buf=lines.pop();
        for(var i=0;i<lines.length;i++){
          var ln=lines[i].trim();if(ln.indexOf('data: ')!==0)continue;
          try{var ev=JSON.parse(ln.slice(6));if(ev.t){full+=ev.t;host.innerHTML=_mdSageLiveHtml(full);}}catch(_){}
        }
      }
    }
  }catch(_){}
  if(full.trim()){
    MD.sageLive={pick:MD.pickIdx,text:full};
    // remember which player Mac placed in which lane: if the drafter takes
    // one of them, the pick records the lane - fuel for the tendency coaching
    // layer that reads the history later
    try{
      var laneMap={};
      _mdParseLanes(full).forEach(function(r){
        var nm=(r.body.split(/\s+-\s+|\s+–\s+/)[0]||'').toLowerCase().replace(/[^a-z ]/g,'').trim();
        if(nm)laneMap[nm]=r.lane;
      });
      MD.sageLanes={pick:MD.pickIdx,map:laneMap};
    }catch(_){}
    host.innerHTML=_mdSageLiveHtml(full);
  }else{
    host.innerHTML='<div style="margin-top:10px;font-size:12px;color:var(--muted)">Mac could not be reached for this one. The inline read above still stands.</div>';
  }
  MD._sageLiveBusy=false;
  document.querySelectorAll('.md-sage-ask').forEach(function(b){b.style.opacity='';b.style.pointerEvents='';});
}
function _mdSageLiveHtml(txt){
  // same nav-token stripping as the main chat, so [[go:...]] never shows raw
  try{txt=_sageStripNav(txt);}catch(_){txt=String(txt).replace(/\[\[go:[^\]]*\]\]/g,'').trim();}
  // Lane format: Mac answers in risk lanes (SAFE / UPSIDE / VALUE / NEED),
  // one per line. Render them as clean rows; fall back to prose if the model
  // ignored the format.
  var rows=_mdParseLanes(txt);
  if(rows.length>=2){
    return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">'
      +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px"><img src="/sage/sage-excited-64.png" alt="" style="width:24px;height:24px;object-fit:contain;vertical-align:-8px;margin-right:6px" onerror="this.style.display=\'none\'">Mac: pick your lane</div>'
      +rows.map(function(r){
        var parts=r.body.split(/\s+-\s+|\s+–\s+/);
        var who=parts.length>1?parts[0]:'';
        var why=parts.length>1?parts.slice(1).join(' - '):r.body;
        return '<div style="display:flex;gap:9px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border)">'
          +'<span style="flex:none;width:58px;font-size:9.5px;font-weight:800;letter-spacing:.06em;color:var(--accent-bright)">'+r.lane+'</span>'
          +'<span style="font-size:12.5px;line-height:1.55;color:var(--muted2)">'+(who?'<strong style="color:var(--text)">'+escHtml(who)+'</strong> · ':'')+escHtml(why)+'</span></div>';
      }).join('')+'</div>';
  }
  return '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">'
    +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px"><img src="/sage/sage-thinking-64.png" alt="" style="width:24px;height:24px;object-fit:contain;vertical-align:-8px;margin-right:6px" onerror="this.style.display=\'none\'">Mac\'s full read</div>'
    +'<div style="font-size:12.5px;color:var(--text);line-height:1.6;white-space:pre-wrap">'+escHtml(txt)+'</div></div>';
}
function _mdParseLanes(txt){
  var rows=[];var re=/^\s*\**(SAFE|UPSIDE|VALUE|NEED)\**\s*[:\-]\s*(.+)$/gim;var m;
  while((m=re.exec(txt||'')))rows.push({lane:m[1].toUpperCase(),body:m[2].replace(/\*+/g,'').trim()});
  return rows;
}
// ── Curated draft narratives ────────────────────────────────────────────────
// The contrarian, historically grounded patterns a sharp drafter carries into
// the room. Each one fires ONLY when the player on the panel matches its
// condition - no filler ever - and is phrased as a tendency, never as a fake
// absolute. Triggers come from data already on hand: /api/stats/adv (usage),
// Sleeper bio (age, experience) and the market trend.
function mdNarratives(p){
  var out=[];
  if(!p||p.pos==='K'||p.pos==='DEF')return out;
  var ap=allPlayers[p.id]||{};
  var a=null;try{a=advByName(p.name);if(a&&a.pos!==p.pos)a=null;}catch(_){}
  var age=ap.age||0;
  var exp=(ap.exp!=null?ap.exp:null);
  var fc=ktcFull[p.id]||{};
  var touches=a?((a.ruAtt||0)+(a.rec||0)):0;
  if(p.pos==='RB'){
    if(touches>=370)out.push('He handled '+touches+' touches last season. Historically, backs coming off that kind of workload see reduced usage or missed time the next year far more often than not.');
    else if(touches>=330)out.push(touches+' touches last season is a heavy load. History says elite repeat seasons off that volume are the exception, not the rule.');
    if(age>=30)out.push('He is '+age+'. Elite RB seasons at 30 or older are rare enough that the exceptions become legends - the age cliff at the position is the most reliable pattern in fantasy.');
    else if(age>=28)out.push('RBs decline earlier than every other position, and the fall-offs start clustering at 28. Price the risk in.');
    if(a&&a.rec>=55)out.push('With '+a.rec+' catches, his receiving role gives him a weekly floor that survives bad game scripts - reception volume is the stickiest RB skill year to year.');
  }
  if(p.pos==='WR'){
    if(exp===2)out.push('This is his third season - historically the classic WR breakout window, when target earners make the leap.');
    if(exp===0)out.push('Rookie WRs usually need a year: only a handful ever have finished top-12 as rookies. Draft the talent, but expect the ramp.');
    if(a&&a.tgt>=140)out.push('He earned '+a.tgt+' targets last season, and elite target volume is one of the most stable stats in fantasy - it rarely vanishes overnight.');
  }
  if(p.pos==='TE'){
    if(exp!=null&&exp<=1)out.push('Tight ends develop slowly - few produce fantasy-relevant seasons before year three. Treat him as a dart, not a starter you count on.');
  }
  if(p.pos==='QB'){
    if(a&&a.ruY>=550)out.push('He ran for '+Math.round(a.ruY)+' yards last season. Rushing QBs own the highest weekly ceilings in fantasy - and historically carry more hit and injury risk than pocket passers.');
    if(age>=36)out.push('He is '+age+'. QBs age better than anyone, but past the mid-30s the drop tends to arrive suddenly, not gradually.');
  }
  var t30=fc.trend30Day||0;
  if(t30>250)out.push('His price has been climbing fast this draft season. Steep risers carry a hype premium - you are paying closer to the best case.');
  else if(t30<-250)out.push('His price has been falling fast. Sometimes the market knows something; sometimes that is exactly where the value hides. Check the news before deciding which.');
  if(a&&a.g&&a.g<=11&&out.length<3)out.push('He played only '+a.g+' games last season. Injury-year discounts are how sharp drafters buy talent - just do not stack too many of them on one roster.');
  return out.slice(0,3);
}
// Wrapper: one draft can start at a time, and the button shows it is working so
// a cold first click can't turn into three impatient ones. All the heavy lifting
// (and its awaits) lives in _startMockDraftRun; any failure restores the button.
async function startMockDraft(){
  if(MD._starting)return;
  MD._starting=true;
  var _btn=document.getElementById('md-start-btn');
  var _bt=_btn?_btn.textContent:'';
  if(_btn){_btn.disabled=true;_btn.textContent='Loading…';_btn.style.opacity='.65';_btn.style.cursor='wait';}
  try{
    await _startMockDraftRun();
  }catch(e){
    try{console.error('[TM] startMockDraft failed',e);}catch(_){}
    var s=document.getElementById('md-setup');if(s)s.style.display='block';
    var b=document.getElementById('md-board');if(b){b.style.display='none';b.dataset.live='0';}
    alert('Could not start the draft - the player data was still loading. Give it a second and hit Start again.');
  }finally{
    MD._starting=false;
    if(_btn){_btn.disabled=false;_btn.textContent=_bt||'Start mock draft';_btn.style.opacity='';_btn.style.cursor='';}
  }
}
async function _startMockDraftRun(){
  // a restart can land mid-auction: kill the old room's timer chain FIRST or
  // its pending auAdvance/auBidStep beats keep firing into the new room's
  // state and the auction advances twice per lot
  if(AU.stepT)clearTimeout(AU.stepT);
  if(AU.pillT){clearInterval(AU.pillT);AU.pillT=null;}
  AU.active=false;AU.lot=null;
  await ensurePlayersLoaded();
  if(!Object.keys(ktcById).length)await fetchKtcValues(1,1,false);
  MD.mySlot=parseInt(document.getElementById('md-slot').value)||5;
  MD.rounds=parseInt(document.getElementById('md-rounds').value)||8;
  MD.teams=parseInt(document.getElementById('md-teams').value)||12;
  MD.scoring=parseFloat(document.getElementById('md-scoring').value);
  MD.sf=document.getElementById('md-format').value==='sf';
  MD.clockSecs=parseInt((document.getElementById('md-clock')||{}).value)||0;
  MD.mode=((document.getElementById('md-dtype')||{}).value==='auction')?'auction':'snake';
  MD.budget=parseInt((document.getElementById('md-budget')||{}).value)||200;
  try{mdSaveSettings();}catch(_){}  // remember this room on the device
  MD.queue=[];
  // fresh seed every draft: restarting must produce a DIFFERENT room, not a replay
  MD.seed=Math.floor(Math.random()*100000);
  // the room is PEOPLE now: every bot gets a name and a real drafting
  // ARCHETYPE - a strategy that genuinely diverges, not a small lean. The #1
  // complaint about mock tools is that every room drafts identically; a fresh
  // random mix of archetypes each draft is what makes two mocks with the same
  // settings produce visibly different boards.
  var BOT_NAMES=['Mike','Tony','Dre','Sarah','Marcus','Jess','Rob','Vinny','Trey','Zoe','Pablo','Kev','Nate','Carlos','Benny','Rico','Grace','Deion','Sam','Tank','Lena','Moose','Jorge','Duke','Cam','Ravi','Nico','Gus'];
  var shuffled=BOT_NAMES.slice().sort(function(){return Math.random()-0.5;});
  var archDeck=[];
  while(archDeck.length<MD.teams)archDeck=archDeck.concat(MD_ARCHS.slice().sort(function(){return Math.random()-0.5;}));
  MD.bots={};
  for(var bs=1;bs<=MD.teams;bs++){
    if(bs===MD.mySlot)continue;
    var _arch=archDeck.pop();
    MD.bots[bs]={
      name:shuffled[(bs-1)%shuffled.length],
      arch:_arch.k,
      posAdj:_arch.posAdj,eliteAdj:_arch.eliteAdj,
      reachP:_arch.reachP,hero:_arch.hero,young:_arch.young,rescue:_arch.rescue,
      teCap:_arch.teCap||1,
      homeTeam:_arch.homer?HOMER_TEAMS[Math.floor(Math.random()*HOMER_TEAMS.length)]:null
    };
  }
  // League drafter PROFILES override the random deal: a seat with a profile
  // keeps its custom (or league-member) name, and a chosen personality
  // replaces the dealt archetype - "Random" keeps the deal. Precedence with
  // the free-text context is documented at MD_ARCHS: profiles pick the
  // archetype, user data still outranks any archetype in mdAdvance.
  try{
    var _profs=mdEffectiveProfiles(MD.teams,MD.mySlot);
    Object.keys(_profs).forEach(function(pss){
      var seat=parseInt(pss,10),pr=_profs[pss];
      if(!MD.bots[seat]||!pr)return;
      // profiled = this seat carries a name the USER gave it (or the league
      // did) - the room-read advisor only cites seats by name when true
      if(pr.name){MD.bots[seat].name=_mdProfName(pr.name);MD.bots[seat].profiled=1;}
      var _pa=null;
      for(var ai=0;ai<MD_ARCHS.length;ai++)if(MD_ARCHS[ai].k===pr.arch){_pa=MD_ARCHS[ai];break;}
      if(_pa){
        MD.bots[seat].arch=_pa.k;
        MD.bots[seat].posAdj=_pa.posAdj;MD.bots[seat].eliteAdj=_pa.eliteAdj;
        MD.bots[seat].reachP=_pa.reachP;MD.bots[seat].hero=_pa.hero;
        MD.bots[seat].young=_pa.young;MD.bots[seat].rescue=_pa.rescue;
        MD.bots[seat].teCap=_pa.teCap||1;
        MD.bots[seat].homeTeam=_pa.homer?(pr.team||HOMER_TEAMS[Math.floor(Math.random()*HOMER_TEAMS.length)]):null;
        // per-seat mods on top of the archetype (real-league inference: a
        // softened zero-RB fade, a rookie reach flag) - replace, not merge,
        // so a mod is a complete statement of that dimension
        if(pr.mods){
          if(pr.mods.posAdj)MD.bots[seat].posAdj=pr.mods.posAdj;
          if(pr.mods.eliteAdj)MD.bots[seat].eliteAdj=pr.mods.eliteAdj;
          if(pr.mods.reachP!=null)MD.bots[seat].reachP=pr.mods.reachP;
          if(pr.mods.young!=null)MD.bots[seat].young=pr.mods.young;
        }
      }
    });
  }catch(_){}
  var _ctxTxt=((document.getElementById('md-context')||{}).value||'').trim();
  var _pc=mdParseContext(_ctxTxt);
  MD.bias=_pc.bias;MD.ctxForce=_pc.force||{};MD.ctxPosRound=_pc.posRound||{};
  // the context box outranks the dropdowns when it names a setting
  var ov=mdParseOverrides(_ctxTxt);
  if(ov.teams){MD.teams=ov.teams;var e1=document.getElementById('md-teams');if(e1)e1.value=String(ov.teams);}
  if(ov.rounds){MD.rounds=ov.rounds;var e2=document.getElementById('md-rounds');if(e2)e2.value=String(ov.rounds);}
  if(ov.sf!=null){MD.sf=ov.sf;var e3=document.getElementById('md-format');if(e3)e3.value=ov.sf?'sf':'1qb';}
  if(ov.scoring!=null){MD.scoring=ov.scoring;var e4=document.getElementById('md-scoring');if(e4)e4.value=String(ov.scoring);}
  if(ov.slot){MD.mySlot=Math.min(ov.slot,MD.teams);var e5=document.getElementById('md-slot');if(e5)e5.value=String(MD.mySlot);}
  if(ov.clock!=null){MD.clockSecs=ov.clock;var e6=document.getElementById('md-clock');if(e6)e6.value=String(ov.clock);}
  MD.noK=!!ov.noK;MD.noD=!!ov.noD;
  // the connected league's rules shape the room - unless the user turns it off
  MD.lgNotes=[];
  var _useLg=localStorage.getItem('tm_mock_uselg')!=='0';
  var _uCb=document.getElementById('md-uselg');if(_uCb&&_uCb.closest('label').style.display!=='none')_useLg=_uCb.checked;
  if(_useLg){
    try{
      var _la=_mdLeagueAdjust();
      Object.keys(_la.bias).forEach(function(ps){MD.bias[ps]=Math.max(MD.bias[ps]||1,_la.bias[ps]);});
      if(_la.noK)MD.noK=true;
      if(_la.noD)MD.noD=true;
      MD.lgNotes=_la.notes;
    }catch(_){}
  }
  // 6pt pass TD factor: the dedicated toggle first, then full strength from
  // the context box, scaled from the connected league (5pt = half effect)
  MD.sixPt=0;
  if((document.getElementById('md-6pt')||{}).checked)MD.sixPt=1;
  else if(/6\s*(pt|pts|point|points)?\s*(per\s*)?pass(ing)?\s*tds?|pass(ing)?\s*tds?\s*(are|is|=|worth)\s*6/.test(_ctxTxt.toLowerCase()))MD.sixPt=1;
  else if(_useLg&&window.leagueFormat&&window.leagueFormat.passTd>=5)MD.sixPt=(window.leagueFormat.passTd-4)/2;
  // TE premium toggle: same effect as typing it in the context box
  MD.tep=!!(document.getElementById('md-tep')||{}).checked;
  // TE premium re-prices the BOARD itself (pool build below), not just bot
  // appetite - the old bias path capped the effect at ~8 picks mid / 5 elite,
  // far under what the math says the format is worth.
  // roster construction: how many of each position a team drafts. "Auto" means
  // the engine's normal shape; a number becomes a target every bot respects.
  MD.rosterTarget={};
  ['QB','RB','WR','TE','K','DEF'].forEach(function(ps){
    var _rc=document.getElementById('md-rc-'+ps.toLowerCase());
    // NaN guard: a missing/blank control must mean "auto", never a NaN target
    // - NaN targets silently disable every positional cap (ros.QB >= NaN is
    // false), which is how the calibration harness first found bots drafting
    // backup QBs in round 4.
    if(_rc&&_rc.value!=='auto'){var _rcv=parseInt(_rc.value);if(!isNaN(_rcv))MD.rosterTarget[ps]=_rcv;}
  });
  if(MD.rosterTarget.K===0)MD.noK=true;
  if(MD.rosterTarget.DEF===0)MD.noD=true;
  // THE RULE: user data outranks the random personas. Any position the user's
  // context, toggles or league settings explicitly touched is owned by that
  // data - the archetypes step almost fully aside there (see mdAdvance).
  MD.userPos={};
  Object.keys(MD.bias||{}).forEach(function(ps){if(MD.bias[ps]!==1)MD.userPos[ps]=1;});
  Object.keys(MD.ctxPosRound||{}).forEach(function(ps){MD.userPos[ps]=1;});
  if(MD.tep)MD.userPos.TE=1;
  // Fantazy 2026 scoring honesty: the real league also pays passing at
  // 20yd/pt (vs the 25yd/pt default) and -2 per INT - the engine has NO knob
  // for passing-yardage rate, so that part is not modeled and this comment is
  // the record. The 6pt-passing-TD half IS real (preset flips md-6pt). What
  // fits cleanly: 20yd/pt is +25% points on air yards, worth roughly 1-2
  // extra picks on the top QBs beyond the 6pt repricing, minus a hair for
  // -2 INTs on the gunslingers - a light QB bias of 1.06 (declared market
  // heuristic; same scale the '3 WR starters' league nudge uses). Applied
  // AFTER the userPos pass on purpose: a preset nudge must not claim QB as
  // "user data", or it would mute the QB-early/QB-late personalities the
  // owner assigns to his rivals.
  if(_mdFz26On())MD.bias.QB=Math.max(MD.bias.QB||1,1.06);
  // the described room is per-league knowledge: remember it for THIS league so
  // the next mock of the same league starts with the same real managers
  try{
    localStorage.setItem('tm_md_context',_ctxTxt);
    if(typeof leagueId!=='undefined'&&leagueId)localStorage.setItem('tm_md_ctx_'+leagueId,_ctxTxt);
  }catch(_){}
  if(MD.mySlot>MD.teams)MD.mySlot=MD.teams;
  var cl=document.getElementById('md-clock-live');if(cl)cl.value=String(MD.clockSecs);
  mdStopClock();
  if(MD.mySlot>MD.teams)MD.mySlot=MD.teams;
  try{await loadAdvStats();}catch(_){}
  // the RIGHT board for the room: 2QB drafts use real 2QB ADP, standard uses
  // standard - no multiplier guesswork
  var _adpFmt=MD.sf?'2qb':(MD.scoring===0?'standard':MD.scoring===0.5?'half-ppr':'ppr');
  try{await loadAdp(_adpFmt);}catch(_){}
  MD.adpSource=window._adpSource||'sleeper';
  // Real season projections + bye weeks ride alongside the draft: fired here,
  // never awaited - the data columns appear when the feeds land, and the room
  // opens on time even if they never do.
  try{mdLoadProjections();}catch(_){}
  try{mdLoadByes();}catch(_){}
  try{mdLoadRiserRates();}catch(_){}
  try{mdLoadSignals();}catch(_){}
  // auction values are AWAITED (unlike the display feeds): the room's whole
  // economy prices off them, so a $0 board is worse than a 1s wait. On
  // failure the engine still opens with curve-derived values and says so.
  if(MD.mode==='auction'){try{await mdLoadAav();}catch(_){}}
  // Pool sized to the DRAFT, not to a value floor - the old (value>800) filter
  // left fewer players than a 12x15 draft needs and the board died mid-draft.
  var poolSize=Math.max(260,MD.teams*MD.rounds+80);
  var adpOf=function(p){
    var ids=window._adpById;if(ids&&ids[p.id]!=null)return ids[p.id];
    var m=window._adp;if(!m)return null;
    var k=p.name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
    var e=_mdByName(m,p.name);return e?e.adp:null;};
  MD.pool=Object.values(allPlayers).filter(function(p){
      return ['QB','RB','WR','TE'].indexOf(p.pos)>=0&&((ktcById[p.id]||0)>0||adpOf(p)!=null);
    })
    .map(function(p){
      var adp=adpOf(p);
      var dv;
      if(adp!=null){
        // the ADP feed already matches this room's exact format.
        // dv is an ORDINAL board scale: 1 ADP pick = 40dv by construction, so
        // dv ranks the room exactly like the market does. It is NOT a points
        // scale - real value-per-pick varies ~3.7 pts/pick in R2 down to ~0.3
        // in R9-11 (2026 projections) - so anything that needs point VALUE
        // (VORP words, tiers) reads projections, never dv gaps.
        dv=11000-adp*40;
        // The linear board goes NEGATIVE past pick 275 (an ADP of 400 scored
        // -5000), which sank real players below kickers and made them
        // undraftable at any depth. Beyond the linear range, decay gently but
        // stay positive so the deep tail keeps its order. Untouched for every
        // pick a real draft actually reaches.
        if(dv<200)dv=Math.max(20,200-(adp-270)*1.2);
        // 6pt passing TDs re-price QBs one by one: the bonus lives in the
        // passing TDs, so high-passTD pocket QBs rise most while runners -
        // whose rushing TDs were already worth 6 - move least
        if(MD.sixPt&&p.pos==='QB'){
          var _q6=(window._adpQ6||{})[p.id];
          // _q6 is NET points gained vs the replacement QB (server: 2 pts per
          // passing TD above ~QB12; negative for rushing QBs whose TDs were
          // always worth 6). ~5 season points buy one draft pick. Result:
          // Burrow +~3 picks, Allen +~0.4, Hurts -~2 - what 6pt actually does.
          if(_q6)dv+=Math.max(-2,Math.min(4,_q6/5))*40*MD.sixPt;
        }
      }else{
        // beyond the ADP horizon: market value orders the tail, capped so it
        // can never outrank a player real drafters actually take
        dv=Math.min(mdValue(p),2100);
      }
      return {id:p.id,name:p.name,pos:p.pos,team:p.team,dv:dv,adp:adp,exp:(p.exp!=null?p.exp:null)};
    })
    .sort(function(a,b){return b.dv-a.dv;}).slice(0,poolSize);
  // TE premium: +0.5 PPR per catch moves the top-12 TEs 23-30 overall slots
  // by pure 2026 projection math (derived 7/2026: Bowers 35->11, McBride
  // 50->23, LaPorta 80->53). Live TEP rooms reprice less than pure value, so
  // we apply ~60% of it: elite top-3 +14 picks, TE4-12 +16, the rest +8.
  // The damping factor is a market heuristic - no free TEP ADP feed exists
  // to fit it exactly (FFPC is paywalled).
  if(MD.tep){
    var _teRk=MD.pool.filter(function(x){return x.pos==='TE'&&x.adp;}).sort(function(a,b){return a.adp-b.adp;});
    _teRk.forEach(function(x,i){x.dv+=(i<3?14:i<12?16:8)*40;});
    MD.pool.sort(function(a,b){return b.dv-a.dv;});
  }
  // Room size, tier-aware: in shallow rooms the ELITE QBs/TEs keep their
  // premium (a real edge at a scarce position matters MORE when every RB/WR
  // room is stacked) while mid-tier QB/TE crater - QB7 is free on an 8-team
  // wire. Deep 14-team rooms start them two deep, so every QB/TE rises.
  // Derivation check (2026 projections, 7/2026): the replacement QB is FLAT
  // 295-303 pts from QB9 to QB15, and replacement TE 136-169 from TE9-TE15 -
  // so a mid QB/TE's edge over the wire is ~0-10 pts in an 8-10 team room
  // while the elite top-3 edge (QB +23-31, TE +66-99 pts) survives every
  // size. Direction confirmed; these magnitudes sit inside projection noise,
  // so they stay as market-calibrated picks rather than a fitted number.
  if(!MD.sf){
    var _shift=MD.teams<=8?10:MD.teams<=10?5:MD.teams>=14?-4:0;
    if(_shift!==0){
      ['QB','TE'].forEach(function(ps){
        var rk=MD.pool.filter(function(x){return x.pos===ps&&x.adp;}).sort(function(a,b){return a.adp-b.adp;});
        rk.forEach(function(x,i){
          // elite onesies gain a little in shallow rooms (per Wolco: the
          // scarce-position edge is worth MORE when RB/WR rooms are stacked)
          if(_shift>0&&i<3){x.dv+=Math.round(_shift*0.4)*40;return;}
          x.dv-=_shift*40;
        });
      });
      MD.pool.sort(function(a,b){return b.dv-a.dv;});
    }
  }
  // Kickers (ranked by real 2025 kicking points) and team defenses (ranked by
  // fewest fantasy points allowed) join with late-round values. The dv range
  // (K 190..76, DEF 205..91) is intentionally BELOW every draftable skill
  // player, and it never decides when they go - mdAdvance hard-gates K/DEF
  // to the final two rounds (-1e9 before then), so these numbers only order
  // kickers among kickers. Harness invariant (c) verifies the gate.
  try{
    if(MD.noK)throw 0;
    var ks=Object.values(allPlayers).filter(function(p){return p.pos==='K'&&p.team;})
      .map(function(p){var a=advByName(p.name);return {p:p,fpts:(a&&a.pos==='K'&&a.fpts)||0};})
      .filter(function(x){return x.fpts>0;})
      .sort(function(a,b){return b.fpts-a.fpts;}).slice(0,20);
    ks.forEach(function(x,i){MD.pool.push({id:x.p.id,name:x.p.name,pos:'K',team:x.p.team,dv:190-i*6,exp:(x.p.exp!=null?x.p.exp:null)});});
    if(MD.noD)throw 0;
    var dstAvg=window._advDst||{};
    var ds=Object.values(allPlayers).filter(function(p){return p.pos==='DEF';})
      .map(function(p){var avg=dstAvg[p.id]!=null?dstAvg[p.id]:dstAvg[p.team];return {p:p,avg:avg!=null?avg:999};})
      .sort(function(a,b){return a.avg-b.avg;}).slice(0,20);
    // short names on purpose: "LAC D/ST" fits every cell, "Los Angeles Chargers" fits none
    ds.forEach(function(x,i){MD.pool.push({id:x.p.id,name:(x.p.team||x.p.id)+' D/ST',pos:'DEF',team:x.p.team||x.p.id,dv:205-i*6});});
  }catch(_){}
  MD.pool.sort(function(a,b){return b.dv-a.dv;});
  // De-dupe by name: the source data can carry two Sleeper IDs for one player
  // (an old entry + the current one), which let the same name get drafted twice.
  // Pool is sorted by value, so we keep the higher-valued (real) one.
  // ...but "higher-valued" is not enough when the two entries are DIFFERENT
  // PEOPLE who share a name: Sleeper carries a retired WR "Kenneth Walker"
  // (no team) alongside the KC running back, and the wrong one was surviving
  // and showing up labelled WR. A player with no NFL team cannot be drafted,
  // so he loses every tie - and among real players the higher value wins.
  (function(){
    // The board carries retired namesakes (Sleeper keeps every player ever:
    // a WR "Kenneth Walker" with no team sits beside the KC running back) and
    // the name-keyed ADP lookup happily hands the ghost the real player's
    // number. Two guards, in order:
    //  1. POSITION MUST MATCH THE MARKET. If the ADP feed prices this name at
    //     a position, an entry claiming a different one is not that player.
    //  2. Among what's left, a real NFL team beats "FA", then value breaks ties.
    var mkt=window._adp||{};
    MD.pool=MD.pool.filter(function(p){
      if(p.pos==='DEF')return true;
      var k=_mdNormName(p.name);
      var m=_mdByName(mkt,p.name);
      return !(m&&m.pos&&m.pos!==p.pos);
    });
    var best={};
    MD.pool.forEach(function(p){
      if(p.pos==='DEF')return;
      var k=(p.name||'').toLowerCase().replace(/[^a-z]/g,'');
      if(!k)return;
      var cur=best[k];
      if(!cur){best[k]=p;return;}
      var rank=function(x){return ((x.team&&x.team!=='FA')?2:0)+((x.dv||0)/1e6);};
      if(rank(p)>rank(cur))best[k]=p;
    });
    MD.pool=MD.pool.filter(function(p){
      if(p.pos==='DEF')return true;
      var k=(p.name||'').toLowerCase().replace(/[^a-z]/g,'');
      return !k||best[k]===p;
    });
  })();
  // Replacement level per position for THIS room: the player still on the
  // board after every starter slot in the league is filled. The pick bar
  // turns the gap to this line into a VORP read - in words, never a number.
  // Effective starters INCLUDE the flex, derived by greedy lineup fill over
  // 2026 projections (12-team, 1QB/2RB/2WR/1TE/1FLEX, 7/2026): in full PPR
  // the flex went WR 11 of 12 times (WR 2.9 / RB 2.1 effective); in standard
  // it flips RB-ward (RB 2.7 / WR 2.3); half-PPR is the midpoint. The flex
  // never took a TE, so TE stays 1.0.
  MD.replDv={};MD.replId={};
  (function(){
    var starters=MD.scoring>=1?{QB:MD.sf?2:1,RB:2.1,WR:2.9,TE:1}
      :MD.scoring===0.5?{QB:MD.sf?2:1,RB:2.4,WR:2.6,TE:1}
      :{QB:MD.sf?2:1,RB:2.7,WR:2.3,TE:1};
    Object.keys(starters).forEach(function(ps){
      var rk=MD.pool.filter(function(x){return x.pos===ps;});
      var idx=Math.min(rk.length-1,Math.round(starters[ps]*MD.teams));
      MD.replDv[ps]=(idx>=0&&rk[idx])?rk[idx].dv:0;
      MD.replId[ps]=(idx>=0&&rk[idx])?rk[idx].id:null;
    });
  })();
  // Positional ranks + tiers: the rank feeds the rough projection, the tiers
  // drive the list separators and the cliff warnings. This dv pass (a break
  // every ~9 picks of gap) is only the OPENING read - the moment projections
  // land, mdRetierFromProj replaces it with real point-drop tiers, because a
  // fixed dv gap means very different point drops in different ADP zones.
  MD._posRank={};MD.tierOf={};
  ['QB','RB','WR','TE','K','DEF'].forEach(function(ps){
    var t=1,prev=null,n=0;
    MD.pool.forEach(function(p){
      if(p.pos!==ps)return;
      n++;MD._posRank[p.id]=n;
      if(prev!=null&&(prev-p.dv)>=350&&t<8)t++;
      MD.tierOf[p.id]=t;prev=p.dv;
    });
  });
  try{mdRetierFromProj();}catch(_){}  // projections already cached: use them now
  MD.order=[];
  for(var r=0;r<MD.rounds;r++){for(var s=1;s<=MD.teams;s++)MD.order.push(r%2===0?s:MD.teams+1-s);}
  MD.pickIdx=0;MD.mine=[];MD.log=[];MD.aiRosters={};MD.picks=[];MD.onClock=false;MD.posFilter='';MD.myOveralls=[];MD.lastSnipe='';
  MD.rookiesOnly=false;MD.showTaken=false;MD.availSort=null;
  // stale-selection guards: a selChoice or cached Mac answer from the LAST
  // draft must never surface in this one (selChoice points into the old pool,
  // and sageLive is keyed by pickIdx alone - both look valid and are not)
  MD.selChoice=null;MD.sageLive=null;MD.lastRec=null;MD.lastRecWhy='';
  // adaptive-advisor once-per-draft guards: each roster-shape callout and the
  // one history-tendency mention reset with every new room - and Mac's face
  // starts each room with nothing to say yet
  MD._shapeSaid={};MD._histSaid=0;MD._mac=null;
  MD.initialRanks={};MD.pool.forEach(function(p,i){MD.initialRanks[p.id]=i+1;});
  document.querySelectorAll('.md-pos-chip').forEach(function(c){c.classList.toggle('active',!c.dataset.pos);});
  document.querySelectorAll('.md-flag-chip').forEach(function(c){c.classList.remove('active');});
  var sb=document.getElementById('md-avail-search');if(sb)sb.value='';
  // Player/value feeds can still be in flight on a cold first click - bail loudly
  // instead of opening an empty board (this is what made Start "need 3 clicks").
  if(!MD.pool.length)throw new Error('draft data not ready');
  mdRenderBoard();
  document.getElementById('md-setup').style.display='none';
  var _bd=document.getElementById('md-board');_bd.style.display='block';_bd.dataset.live='1';
  // Room toolbar, pinned at the top of every room: restarting or walking out
  // were buried at the bottom of the page (and a bare glyph on phones).
  if(!document.getElementById('md-roombar')&&_bd.insertAdjacentHTML){
    _bd.insertAdjacentHTML('afterbegin',
      '<div id="md-roombar">'
      +'<button class="md-rb-btn" onclick="mdRestartDraft()" title="Same settings, fresh room">&#8635; Restart draft</button>'
      +'<button class="md-rb-btn" onclick="mdBackToSetup()" title="Change settings and start over">&larr; New draft</button>'
      +'</div>');
  }
  // inside a live room the section chips (Solo mock / With friends / Live
  // assist / History) are noise - you are already in the room. Back to setup
  // (mdBackToSetup / mdShowSection) brings them back.
  var _secs=document.getElementById('md-sections');if(_secs)_secs.style.display='none';
  // Land at the TOP of the draft board so the room and your picks are the first
  // thing you see - not scrolled past into the player list.
  // Offset for the real fixed chrome: 60px nav (+12 breathing room), plus the
  // ticker's extra 34px when a league is connected - otherwise the league note
  // lands hidden under the ticker.
  setTimeout(function(){var bd=document.getElementById('md-board');if(bd){var off=72+(document.body.classList.contains('ticker-on')?34:0);var y=bd.getBoundingClientRect().top+window.pageYOffset-off;window.scrollTo({top:Math.max(0,y),behavior:'smooth'});}},200);
  var _ln=document.getElementById('md-lg-note');
  if(_ln){
    // always name the market: half of all "why did he go there" confusion is
    // comparing a Superflex board against 1QB expectations
    var _fmtName={'2qb':'Superflex (2QB)','ppr':'Full PPR','half-ppr':'Half PPR','standard':'Standard'}[_adpFmt]||_adpFmt;
    // The plain "Market board: ..." line was noise; only surface the fallback
    // warning and any league adjustments.
    var _msg=MD.adpSource==='ffc'
      ?'Sleeper ADP was briefly unavailable - this board uses backup '+_fmtName+' ADP (FantasyCalc), which ranks some players differently. Restart in a minute for the Sleeper board.'
      :'';
    if(MD.lgNotes&&MD.lgNotes.length){
      _msg+=(_msg?' · ':'')+'Your league: '+MD.lgNotes.join(' · ')
        +' &nbsp;<span style="color:var(--muted);text-decoration:underline;cursor:pointer" onclick="mdLeagueOff()">turn off</span>';
    }
    _ln.innerHTML=_msg;
    _ln.style.display=_msg?'block':'none';
  }
  // snake and auction share everything up to here (pool, values, feeds, UI
  // shell); the room's clock and turn logic split below
  if(MD.mode==='auction'){auStart();return;}
  AU.active=false;
  var _auw=document.getElementById('au-wrap');if(_auw)_auw.style.display='none';
  var _dbw=document.getElementById('md-draftboard');if(_dbw)_dbw.style.display='';
  var _ubS=document.getElementById('md-undo-btn');if(_ubS)_ubS.style.display='';  // back from an auction room
  // ...and the board-bar controls the auction had shed come back for snake,
  // along with every node the 3-zone layout borrowed
  try{
    _auLayoutOff();
    var _vtS=document.querySelector('.md-view-btn');if(_vtS&&_vtS.parentElement)_vtS.parentElement.style.display='';
    var _clS=document.getElementById('md-clock-live');if(_clS)_clS.style.display='';
    var _ndS=document.getElementById('md-needs');if(_ndS)_ndS.style.display='';
    var _avS=document.getElementById('md-available');if(_avS)_avS.style.display='';
  }catch(_){}
  mdAdvance();
}
// Faces: players get their headshot, defenses get their team logo
function mdFaceUrl(p){
  if(p.pos==='DEF')return 'https://sleepercdn.com/images/team_logos/nfl/'+String(p.team||p.id).toLowerCase()+'.png';
  return 'https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg';
}
function mdAdvance(){
  if(MD.pickIdx>=MD.order.length){mdFinish();return;}
  var slot=MD.order[MD.pickIdx];
  var round=Math.floor(MD.pickIdx/MD.teams)+1;
  var pickNo=(MD.pickIdx%MD.teams)+1;
  if(slot===MD.mySlot){
    MD.onClock=true;MD.curRound=round;
    // same courtesy the auction gets: you should never miss your turn because
    // you looked away (the bots move fast between your picks)
    try{if(round>1)sndYourTurn();}catch(_){}
    document.getElementById('md-status').innerHTML='<span style="color:var(--muted)">R'+round+'.'+pickNo+'</span><span style="color:var(--accent-bright);font-weight:700">You are on the clock</span><span id="md-clk"></span>';
    mdRenderBoard(); // the ON THE CLOCK box must agree with the header (says YOU now)
    mdShowChoices(round);
    mdStartClock();
    if(MD.autoPilot)_mdAutoPick();
  } else {
    // Yahoo-style: always show how far away your next pick is
    var untilMe=-1;
    for(var qi=MD.pickIdx;qi<MD.order.length;qi++){if(MD.order[qi]===MD.mySlot){untilMe=qi-MD.pickIdx;break;}}
    var botName=(MD.bots&&MD.bots[slot]&&MD.bots[slot].name)||('Team '+slot);
    var stEl=document.getElementById('md-status');
    if(stEl)stEl.innerHTML='<span style="color:var(--muted)">R'+round+'.'+pickNo+'</span>Current drafter: <b style="color:var(--text)">'+botName+'</b>'
      +(untilMe>0?'<span style="color:var(--accent-bright)">you in '+untilMe+'</span>':'');
    // AI drafts by need-weighted value
    MD.aiRosters[slot]=MD.aiRosters[slot]||{QB:0,RB:0,WR:0,TE:0,K:0,DEF:0,list:[]};
    var ros=MD.aiRosters[slot];
    var best=null,bestScore=-1;
    // FULLY ADDITIVE scoring in dv-space. Every factor - noise, roster need,
    // league bias, personal lean - is a bounded points nudge, never a MULTIPLIER
    // on dv. A multiplier is worth ~12 picks at the top of the board (dv~10000)
    // and ~1 at the tail, which is what kept burying elite TEs like Bowers. Here
    // nothing can move a player more than a few picks except the faller rescue.
    // Window widened to 24 so a player who drifts still gets seen and rescued.
    // positional runs: real rooms panic. Two or more of one position inside
    // the last four picks pulls the next drafters toward it for a beat -
    // recomputed every pick, so the pull decays on its own.
    var runPos={};
    (MD.picks||[]).slice(-4).forEach(function(pk){
      var _rp=pk.p.pos;if(_rp==='K'||_rp==='DEF')return;
      runPos[_rp]=(runPos[_rp]||0)+1;
    });
    // ── STARTER-FILL GATE ── the same hard-guarantee pattern as the K/DEF
    // forced fill (which has never produced a miss): real rooms always field
    // a LEGAL lineup - personality plays freely inside that constraint. The
    // deep audit (40 live rooms x 9 bots) found ~28% of bots finishing
    // illegal (QB0, RB1, WR1...) because a capped archetype fade (-620dv)
    // out-muscles the +30 need nudge every single round. When the remaining
    // skill rounds (minus the final-round K/DEF reservations) are down to
    // exactly the open starter holes, the bot may ONLY pick among the
    // positions it still owes - best score within that subset, everything
    // else about the scoring unchanged. By construction this cannot trigger
    // before ~R9 of 15 (6 holes max), so early personality is untouched. A
    // user's explicit roster target overrides the default minimum (RB:1 set
    // on purpose IS the law), and a context-named player keeps his round rule
    // (user data outranks the gate, documented precedence).
    var _req={QB:MD.sf?2:1,RB:2,WR:2,TE:1};
    Object.keys(_req).forEach(function(ps){
      if(MD.rosterTarget&&MD.rosterTarget[ps]!=null)_req[ps]=Math.min(_req[ps],MD.rosterTarget[ps]);
    });
    var _gapPos={},_gapN=0;
    Object.keys(_req).forEach(function(ps){
      var _g2=_req[ps]-(ros[ps]||0);
      if(_g2>0){_gapPos[ps]=1;_gapN+=_g2;}
    });
    var _kdReserved=((!MD.noK&&!(ros.K>=1))?1:0)+((!MD.noD&&!(ros.DEF>=1))?1:0);
    var _gateOn=_gapN>0&&((MD.rounds-round+1)-_kdReserved)<=_gapN;
    var cands=MD.pool.slice(0,24);
    // the gate must always have someone to point at: pull the best player at
    // each owed position into the scan window (same pattern as ctxForce)
    if(_gateOn){
      Object.keys(_gapPos).forEach(function(ps){
        for(var pg=0;pg<MD.pool.length;pg++){
          if(MD.pool[pg].pos===ps){if(cands.indexOf(MD.pool[pg])<0)cands.push(MD.pool[pg]);break;}
        }
      });
    }
    // A round-pinned player who is DUE must be scored even when he sits below
    // the scan window - the named rule is a guarantee, not a suggestion
    try{
      if(MD.ctxForce)Object.keys(MD.ctxForce).forEach(function(nm){
        var fr=MD.ctxForce[nm];
        if(!fr||round<fr.r)return;
        for(var pi=0;pi<MD.pool.length;pi++){
          if(_mdNormName(MD.pool[pi].name)===nm){
            if(cands.indexOf(MD.pool[pi])<0)cands.push(MD.pool[pi]);
            break;
          }
        }
      });
    }catch(_){}
    cands.forEach(function(p){
      // gate active: only the owed starter positions may score (a context-
      // named player keeps his rule - user data outranks the gate)
      if(_gateOn&&!_gapPos[p.pos]&&!(MD.ctxForce&&MD.ctxForce[_mdNormName(p.name)]))return;
      var have=ros[p.pos]||0;
      // Rounds 1-2 sanity clamp: no bot reaches more than ~half a round in R1
      // (6 picks) or ~a round in R2 (10) past his OWN board's ADP - no real
      // room does, and no stack of archetype/6pt/bias nudges should compose
      // into it. A player the user's context named (ctxForce) is exempt.
      var _reachCap=round===1?6:10;
      if(round<=2&&p.adp&&p.adp>(MD.pickIdx+1)+_reachCap&&!(MD.ctxForce&&MD.ctxForce[_mdNormName(p.name)]))return;
      var elite=p.adp&&p.adp<=Math.max(MD.teams*2,24); // top ~2 rounds: pure value
      // variance grows with the draft: tight in the first two rounds, about
      // half a round of noise in R3-6, a full round from R7 on. This is the
      // main defense against the "every mock looks identical" failure.
      // toned down (owner: "a little less random"): ~3-4 picks of noise in
      // R3-6 and ~7 in R7+ - rooms still diverge via archetypes, not chaos
      var ampDv=round<=2?70:round<=6?(MD.teams*14):(MD.teams*28);
      var jitDv=((((MD.pickIdx*31+p.name.length*7+(MD.seed||0))%23)/22)-0.5)*2*ampDv;
      var sc=p.dv+jitDv;
      var bot0=MD.bots&&MD.bots[slot];
      // roster construction (mid-round only; elites are taken on value).
      // Scale note: 40dv = 1 ADP pick, so -350 = ~9 picks of hesitation on a
      // 4th player at one position and +30 = under a pick of pull toward a
      // thin RB/WR room - deliberate whispers; the harness invariants
      // (scripts/calibrate-room.mjs) are what verify the roster shapes stay
      // sane, not these two numbers alone.
      if(have>=3)sc-=350;
      else if(!elite){
        if((p.pos==='RB'||p.pos==='WR')&&have<2)sc+=30;
      }
      // positional sanity caps: no room hoards QBs or TEs (the old engine
      // could draft a third TE). Hard stops that only widen for a TE-hunter
      // archetype or an explicit roster-construction setting, with soft
      // pressure before the stop.
      var _tgt=MD.rosterTarget||{};
      var _qbMax=_tgt.QB!=null?_tgt.QB:(MD.sf?3:2);
      var _teMax=_tgt.TE!=null?_tgt.TE:((bot0&&bot0.teCap)||1);
      // Backup QB in 1QB: a hard gate before round 8 (like the K/DEF gate),
      // then -700dv (~17.5 picks) of drag after it. A soft penalty alone
      // could not hold the line: archetype (+620 cap) plus late-round jitter
      // (±336) stack past 700, and harness invariant (f) kept catching QB2s
      // in round 5. Real 1QB rooms draft their backup QBs in the double-digit
      // rounds; only an explicit user roster target may override the gate.
      // -450 on a TE2 = ~11 picks of drag, verified by invariant (d).
      if(p.pos==='QB'){
        if(ros.QB>=_qbMax)sc-=1e6;
        else if(ros.QB>=(MD.sf?2:1))sc-=(_tgt.QB==null&&!MD.sf&&round<8)?1e6:700;
      }
      if(p.pos==='TE'){
        if(ros.TE>=Math.max(2,_teMax))sc-=1e6;
        else if(ros.TE>=_teMax)sc-=450;
      }
      // user-set roster targets bind every position
      if(_tgt[p.pos]!=null&&p.pos!=='K'&&p.pos!=='DEF'){
        if(have>=_tgt[p.pos]+1)sc-=1e6;
        else if(have>=_tgt[p.pos])sc-=900;
      }
      // context box: a named player pinned to a round ("Bowers goes 4th") or
      // given a deadline ("Smith gone before the 4th"), and a position pinned
      // to a round ("everyone drafts RBs round 1"). These beat the elite gate
      // and the rescue below so the room drafts how HE described.
      var _fr=MD.ctxForce&&MD.ctxForce[_mdNormName(p.name)];
      var _frHold=!!(_fr&&_fr.mode==='at'&&round<_fr.r);
      // faller rescue, scaled by the round's REAL spread: live drafts run
      // ±1.4 picks of ADP stdev in round 1 but ±16+ by round 11 (FFC, 3,899
      // drafts, 7/2026 fit: stdev ≈ 2.3 + 0.095*adp). The old flat cap of 8
      // was right early and far too tight late - it made rounds 8+ draft in
      // near-perfect ADP order. Hard stop at ~1.5 stdev, soft pull from
      // ~0.75 stdev. Skip a player we are deliberately holding for later.
      // And the rescue never buys a BACKUP at an onesie position: the QB-
      // stocked teams pass on a sliding QB in real rooms too - the rescue
      // belongs to whoever still needs one (harness invariant (f) caught the
      // +6000 pull steamrolling the -700 backup penalty: bots took QB2s in
      // round 4 before this gate).
      var _canRescue=!((p.pos==='QB'&&ros.QB>=(MD.sf?2:1))||(p.pos==='TE'&&ros.TE>=1));
      if(p.adp&&!_frHold&&_canRescue){
        var _sdv=2.3+0.095*p.adp;
        var late=(MD.pickIdx+1)-p.adp;
        if(late>1.5*_sdv)sc+=6000;
        else if(late>0.75*_sdv)sc+=(late-0.75*_sdv)*70;
      }
      // K and D/ST: unpickable until the final rounds (the forced-fill above
      // seats them; this just keeps them out of the value board till then)
      if(p.pos==='K'||p.pos==='DEF')sc=(have>=1||round<Math.max(MD.rounds,15)-1)?-1e9:600;
      // league/context tendencies + the bot's archetype. THE RULE: the user's
      // described room always outranks the random personas - on any position
      // the user (or their league settings) spoke about, the archetype nudge
      // shrinks to a whisper and the user's bias carries real weight, in the
      // elite tier too, because "RBs fly early" has to be visible in round 1.
      // The faller rescue below still caps any slide near adp+8.
      var userSaid=MD.userPos&&MD.userPos[p.pos];
      var uBias=(MD.bias&&MD.bias[p.pos])?(MD.bias[p.pos]-1)*1800:0;
      sc+=elite?Math.max(-200,Math.min(200,uBias*0.5)):Math.max(-320,Math.min(320,uBias));
      if(bot0){
        var bAdj=elite?((bot0.eliteAdj&&bot0.eliteAdj[p.pos])||0):((bot0.posAdj&&bot0.posAdj[p.pos])||0);
        // hero-RB flips off RB the moment the hero is on the roster
        if(bot0.hero&&p.pos==='RB')bAdj=ros.RB>=1?-380:(elite?200:120);
        // outside the elite tier the archetype has to actually SHOW: doubled
        // and capped, it moves a drafter a visible handful of picks
        if(!elite){bAdj*=1.9;bAdj=Math.max(-620,Math.min(620,bAdj));}
        // punting QB in a superflex room is a rare breed - soften the fade
        if(MD.sf&&p.pos==='QB'&&bAdj<0)bAdj*=0.4;
        if(userSaid)bAdj*=0.2;
        sc+=bAdj;
        // the homer overpays for his NFL team in the middle rounds
        if(bot0.homeTeam&&p.team===bot0.homeTeam&&!elite)sc+=180;
        // the value-strict drafter pounces on anyone sliding at all
        if(bot0.rescue&&p.adp){var lateV=(MD.pickIdx+1)-p.adp;if(lateV>2)sc+=Math.min(500,(lateV-2)*90);}
      }
      // Round-pinned rules apply to EVERY tier - that is the whole point of them.
      if(_fr){
        if(_fr.mode==='at'){
          if(round<_fr.r)sc-=1e7;          // hold until his round
          else if(round===_fr.r)sc+=5000;  // grab him right on schedule
          else sc+=2000;                   // overdue, take him now
        }else{
          // deadline rule ("gone by round N"): fully NORMAL until the round
          // before the deadline (an early flat bonus made "gone before the
          // 3rd" go 1.01), a real pull at deadline-1, a guarantee at the
          // deadline itself
          if(round>=_fr.r)sc+=1e5;
          else if(round===_fr.r-1)sc+=600;
        }
      }
      var _pr=MD.ctxPosRound&&MD.ctxPosRound[p.pos];
      if(_pr&&round===_pr)sc+=2500;        // this position floods this round
      if(runPos[p.pos]>=2&&!elite)sc+=150; // join the run while it is on
      if(sc>bestScore){bestScore=sc;best=p;}
    });
    // the human moment, tamed: a reach is a guy going up to about a round
    // early - never a fourth-rounder in the second. Candidates must sit
    // 5-16 picks past the current pick on the ADP board.
    var bot=MD.bots&&MD.bots[slot];
    // no random flyers while the gate is closing starter holes
    if(bot&&bot.reachP&&!_gateOn&&round>=3&&round<=MD.rounds-2&&Math.random()<bot.reachP){
      var _ov=MD.pickIdx+1;
      var _ros2=MD.aiRosters[slot]||{};
      var sleepers=MD.pool.filter(function(x){
        if(!x.adp||x.adp<=_ov+4||x.adp>_ov+12||x.pos==='K'||x.pos==='DEF')return false;
        // a reach is a crush on an upside player, never a BACKUP at an onesie
        // position - unchecked, this random grab was how bots drafted QB2s in
        // round 5 straight past the -700 penalty (harness invariant f)
        if(x.pos==='QB'&&(_ros2.QB||0)>=(MD.sf?2:1))return false;
        if(x.pos==='TE'&&(_ros2.TE||0)>=1)return false;
        // never let a random reach break a named round rule
        var fx=MD.ctxForce&&MD.ctxForce[_mdNormName(x.name)];
        if(fx&&fx.mode==='at'&&round<fx.r)return false;
        return true;
      }).slice(0,12);
      // the hype drafter reaches for YOUTH specifically: rookies and
      // second-year risers, the guys every group chat talks itself into
      if(bot.young){
        var yg=sleepers.filter(function(x){var ap2=allPlayers[x.id]||{};return (ap2.exp||0)<=2;});
        if(yg.length>=3)sleepers=yg;
      }
      var grab=sleepers[Math.floor(Math.random()*sleepers.length)];
      if(grab)best=grab;
    }
    // real rooms use the last two rounds on K and D/ST - and the value
    // window above never reaches that deep in the pool, so fill them here
    var forced=null;
    if(round>=Math.max(MD.rounds,15)-1){
      // half the room grabs its kicker first, half its defense - a wall of
      // seven straight D/STs is a robot tell no real draft produces
      var _kFirst=((slot+(MD.seed||0))%2)===0;
      var _seq=_kFirst?['K','DEF']:['DEF','K'];
      var wantPos='';
      for(var qi2=0;qi2<2;qi2++){
        var ps3=_seq[qi2];
        if(ps3==='K'?(!ros.K&&!MD.noK):(!ros.DEF&&!MD.noD)){wantPos=ps3;break;}
      }
      if(wantPos)for(var fi=0;fi<MD.pool.length;fi++){if(MD.pool[fi].pos===wantPos){forced=MD.pool[fi];break;}}
    }
    var pick=forced||best||MD.pool[0];
    if(!pick){mdFinish();return;} // pool dry: end the draft cleanly, never stall
    MD.pool.splice(MD.pool.indexOf(pick),1);
    ros[pick.pos]=(ros[pick.pos]||0)+1;ros.list.push(pick);
    MD.picks.push({slot:slot,round:round,pickNo:pickNo,p:pick,mine:false});
    MD.log.unshift('<span style="color:var(--muted)">R'+round+'.'+pickNo+'</span> '+botName+' - <strong style="color:var(--text);cursor:pointer" onclick="openPlayerCard(\''+pick.id+'\',\''+pick.name.replace(/'/g,"\\'")+'\')">'+pick.name+'</strong> '+mdPosTag(pick.pos));
    // Advance BEFORE rendering: the board's ON THE CLOCK box reads
    // MD.order[MD.pickIdx], so rendering first left it one pick behind -
    // showing the bot who JUST picked as "on the clock" (the audit case:
    // header says "You are on the clock", rail says "ON THE CLOCK Rob").
    MD.pickIdx++;
    mdRenderLog();mdRenderBoard();
    setTimeout(mdAdvance,45);
  }
}
function mdPosTag(pos){
  var c={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'}[pos]||'#94a3b8';
  return '<span style="font-size:9px;font-weight:700;color:'+c+'">'+pos+'</span>';
}
// Mac's recommendation honours the chosen strategy
function mdRecommend(top,round){
  var myPos={QB:0,RB:0,WR:0,TE:0};MD.mine.forEach(function(p){myPos[p.pos]=(myPos[p.pos]||0)+1;});
  var _tk={};(MD.picks||[]).forEach(function(pk){if(pk&&pk.p&&pk.p.id)_tk[pk.p.id]=1;});
  // Endgame: if you still need a kicker or defense, that IS the pick
  if(round>=Math.max(MD.rounds,15)-1&&(!myPos.K||!myPos.DEF)){
    var special=MD.pool.find(function(p){return !_tk[p.id]&&((!myPos.DEF&&p.pos==='DEF')||(!myPos.K&&p.pos==='K'));});
    if(special)return {rec:special,why:special.pos==='DEF'
      ?'Best defense left on the board - lock it in and stop thinking about it.'
      :'Top kicker left on the board. Take the reliable points and finish strong.'};
  }
  // Otherwise K/DST never get recommended over skill players
  var skill=top.filter(function(p){return p.pos!=='K'&&p.pos!=='DEF';});
  if(skill.length)top=skill;
  // A second QB in 1QB (or third in superflex) and a second TE are wasted picks
  // in the early-middle rounds - but in the LAST rounds before K/DEF the cap
  // relaxes: an autopilot roster must not finish a 15-rounder with one QB and
  // one TE and no warning.
  var isSF=((document.getElementById('md-format')||{}).value)==='sf';
  var relax=round>=MD.rounds-3;
  var qbCap=(isSF?2:1)+(relax?1:0), teCap=1+(relax?1:0);
  var usable=top.filter(function(p){
    if(p.pos==='QB'&&myPos.QB>=qbCap)return false;
    if(p.pos==='TE'&&myPos.TE>=teCap)return false;
    return true;
  });
  if(usable.length)top=usable;
  var best=top[0];var why='';
  // backup-time framing when the relaxed cap is exactly why he is the pick
  if(relax&&best){
    if(best.pos==='QB'&&myPos.QB>=(isSF?2:1))why='Backup quarterback time. One injury from a lost season otherwise, and the streaming pool dries up from here.';
    else if(best.pos==='TE'&&myPos.TE>=1)why='A second tight end late beats another dart at WR6 - one bye or one injury and you are starting a zero there.';
  }
  function firstAt(pred){for(var i=0;i<top.length;i++)if(pred(top[i]))return top[i];return null;}
  if(MD.strat==='zerorb'&&round<=4){
    var nonrb=firstAt(function(p){return p.pos!=='RB';});
    if(nonrb){best=nonrb;why='Zero RB says let the room panic over running backs while you stack pass-catchers. '+best.name+' is the pick.';}
  } else if(MD.strat==='herorb'){
    if(myPos.RB===0&&round<=2){var rb=firstAt(function(p){return p.pos==='RB';});if(rb){best=rb;why='Your one big RB swing. Get '+rb.name+' now, then it is wide receivers the rest of the way.';}}
    else if(myPos.RB>=1&&round<=6){var wr=firstAt(function(p){return p.pos==='WR';});if(wr){best=wr;why='You have your hero back. Now flood the WR room - '+wr.name+' keeps the plan on rails.';}}
  } else if(MD.strat==='robustrb'&&round<=3&&myPos.RB<2){
    var rb2=firstAt(function(p){return p.pos==='RB';});
    if(rb2){best=rb2;why='Robust RB means building a wall early. '+rb2.name+' is RB number '+(myPos.RB+1)+' and you do not blink.';}
  } else if(MD.strat==='elitete'&&myPos.TE===0&&round<=4){
    var te=firstAt(function(p){return p.pos==='TE';});
    if(te&&top.indexOf(te)<=4){best=te;why='The weekly TE edge is real and it is thin at the top. '+te.name+' before the cliff.';}
  }
  if(!why)why=mdWhyLine(best,myPos,round);
  return {rec:best,why:why};
}
// A recommendation reason built from THIS player's numbers and THIS roster -
// never a generic "cleanest pick on the board" line.
function mdWhyLine(best,myPos,round){
  var bits=[];
  var note=null;try{note=getPlayerContextNote(best.name);}catch(_){}
  if(note&&note.note)bits.push(note.note.split(';')[0].trim());
  var a=advByName(best.name);if(a&&a.pos!==best.pos)a=null;
  var ap=allPlayers[best.id]||{};
  // vacated volume beats every other hook when it is big
  try{
    var vac2=_vacatedFor((allPlayers[best.id]||{}).team||best.team);
    if(vac2&&vac2.share>=18&&['WR','TE','RB'].indexOf(best.pos)>=0)
      bits.push(vac2.names[0].n+' left '+vac2.share+'% of the targets behind, and '+best.name.split(' ').slice(-1)[0]+' is first in line for them');
  }catch(_){}
  // one production hook, the strongest available
  if(a){
    if(a.tgtShare>=24)bits.push('That '+a.tgtShare+'% target share is alpha volume you can build weeks around');
    else if(a.ruY>=1200)bits.push(Math.round(a.ruY).toLocaleString()+' rushing yards last season is a bell-cow floor');
    else if(best.pos==='QB'&&a.ruY>=450)bits.push('The '+Math.round(a.ruY)+' rushing yards give him a floor pocket passers cannot match');
    else if(a.yacRec>=5.8&&a.rec>=50)bits.push(a.yacRec+' yards after catch per grab means he manufactures points on his own');
    else if(a.tgtShare>=18&&(best.pos==='TE'||best.pos==='RB'))bits.push(a.tgtShare+'% of his team\'s targets is elite involvement for a '+best.pos);
    else if(a.g<=10&&a.g>0)bits.push('The '+a.g+'-game season is exactly why he is still on the board - you are buying the discount, not the injury');
    else if(a.catchPct>=72&&a.tgt>=90)bits.push('He caught '+a.catchPct+'% of '+a.tgt+' targets, reliability that shows up every single week');
  }else if(ap.age&&ap.age<=23&&(ap.exp===0||ap.exp===1)){
    bits.push('No NFL tape yet, but this is the range where you swing on talent and landing spot');
  }
  // one roster hook
  var have=myPos[best.pos]||0;
  if(have===0&&round>=3)bits.push('and your '+best.pos+' room is still empty - this is the pick that fixes it');
  else if(have===0&&round<=2)bits.push('He anchors your '+best.pos+' room from day one');
  else if(have>=2)bits.push('You are already strong at '+best.pos+', so this is a stack-the-deck pick that doubles as trade bait');
  // positional cliff hook: how far down is the next player at his spot?
  try{
    var nextSame=MD.pool.filter(function(p){return p.pos===best.pos&&p!==best;})[0];
    if(nextSame&&best.dv>0&&(best.dv-nextSame.dv)/best.dv>0.22)bits.push('The drop to the next '+best.pos+' is a cliff, so the position will not wait for you');
  }catch(_){}
  if(!bits.length)bits.push('Best '+best.pos+' on the board and the next tier at the position is a real step down');
  var s=bits.slice(0,3).join('. ')+'.';
  return s.charAt(0).toUpperCase()+s.slice(1);
}
// ── League draft-tendency context: free text -> AI drafting biases ─────────
// "RBs fly early, QBs go round 2, everyone waits on TE" becomes multipliers
// the AI drafters apply, so the room behaves like HIS room.
function mdParseContext(txt){
  var bias={QB:1,RB:1,WR:1,TE:1};
  var notes=[];
  if(!txt)return {bias:bias,summary:''};
  var t=txt.toLowerCase();
  var POS={QB:/\bqbs?\b|quarterback/,RB:/\brbs?\b|running back|runningback/,WR:/\bwrs?\b|wide ?receiver|receivers?\b/,TE:/\btes?\b|tight ?end/};
  var EARLY=/(early|heavy|first|fly|flies|love|premium|run on|go fast|goes? early|round (1|2|one|two)|reach)/;
  var LATE=/(late|waits?|fade|nobody|never|cheap|last|punt)/;
  // Evaluate clause by clause so "RBs early, QBs round 2, everyone waits on TE"
  // reads each position from ITS OWN clause - no leakage between neighbors.
  var clauses=t.split(/[,;.!\n]| and | but /);
  Object.keys(POS).forEach(function(pos){
    for(var ci=0;ci<clauses.length;ci++){
      var c=clauses[ci];
      if(!POS[pos].test(c))continue;
      // LATE first so "never taken early" reads as late
      if(LATE.test(c)){bias[pos]=Math.min(bias[pos],0.6);notes.push(pos+'s go late');break;}
      if(EARLY.test(c)){bias[pos]=Math.max(bias[pos],pos==='QB'?1.45:1.3);notes.push(pos+'s go early');break;}
    }
  });
  if(/zero ?rb/.test(t)){bias.RB=Math.min(bias.RB,0.7);bias.WR=Math.max(bias.WR,1.2);notes.push('zero-RB room');}
  // scoring rules re-price positions: say them and the room drafts that way
  if(/6\s*(pt|pts|point|points)?\s*(per\s*)?pass(ing)?\s*tds?|pass(ing)?\s*tds?\s*(are|is|=|worth)\s*6/.test(t)){notes.push('6pt passing TDs: high-passTD QBs rise most');}
  if(/te\s*premium|\btep\b/.test(t)){bias.TE=Math.max(bias.TE,1.25);notes.push('TE premium, TEs go earlier');}
  if(/first\s*downs?|\bppfd\b/.test(t)){bias.RB=Math.max(bias.RB,1.05);bias.WR=Math.max(bias.WR,1.05);bias.TE=Math.max(bias.TE,1.05);notes.push('first-down scoring noted');}
  // ── Round-specific rules the positional bias can't express ──────────────
  // "brock bowers goes in the 4th round" (a named player) and "everybody drafts
  // rbs in the first round" (a whole position pinned to a round). These beat the
  // elite-value gate so the room actually behaves the way HE described.
  var force={};      // normalized name -> {r:round, mode:'at'|'by'}
  var posRound={};   // RB -> 1
  var WORDR={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
             first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10};
  // Spanish ordinals too - league chats here are bilingual
  var WORDR_ES={primera:1,segunda:2,tercera:3,cuarta:4,quinta:5,sexta:6,septima:7,octava:8,novena:9,decima:10};
  var clauseRound=function(c){
    var m=c.match(/round\s*(\d{1,2})\b/)
        ||c.match(/(\d{1,2})(?:st|nd|rd|th)\s*round/)
        ||c.match(/ronda\s*(\d{1,2})\b/)
        // "before the 4th", "in the 2nd", "by 3" - suffix optional so a bare
        // digit after the preposition still reads as a round
        ||c.match(/(?:in|by|at|before|during|en|antes de|para)\s+(?:the\s+|la\s+|el\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
    if(m)return +m[1];
    var w=c.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*round\b/)
         ||c.match(/\bround\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/)
         // "in the second", "before the fourth" - the word ordinal with no
         // "round" after it, the phrasing real people actually type
         ||c.match(/(?:in|by|at|before|during)\s+(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/)
         ||c.match(/(?:en|antes de|para)\s+la\s+(primera|segunda|tercera|cuarta|quinta|sexta|septima|séptima|octava|novena|decima|décima)\b/);
    if(w){var wk=w[1].replace(/é/g,'e');return WORDR[wk]||WORDR_ES[wk]||0;}
    return 0;
  };
  // "before round N" is a DEADLINE (gone by N-1), "by round N" a deadline at N,
  // anything else pins the exact round
  var clauseMode=function(c){
    if(/\bbefore\b|\bantes\b/.test(c))return 'before';
    if(/\bby\b|\bpara\b/.test(c))return 'by';
    return 'at';
  };
  var _names=[];
  try{Object.keys(allPlayers).forEach(function(id){var nm=allPlayers[id]&&allPlayers[id].name;if(nm&&nm.indexOf(' ')>0)_names.push(_mdNormName(nm));});
      _names.sort(function(a,b){return b.length-a.length;});}catch(_){}
  var titleCase=function(s){return s.replace(/\b\w/g,function(ch){return ch.toUpperCase();});};
  clauses.forEach(function(c){
    var rn=clauseRound(c);
    if(!rn)return;
    var md0=clauseMode(c);
    var dl=md0==='before'?Math.max(1,rn-1):rn;
    // normalized text so "Ja'Marr", "D.K." and plain typing all line up, with
    // word boundaries so a name can never match inside a longer word
    var cn=' '+_mdNormName(c)+' ';
    var hit=null;
    for(var ni=0;ni<_names.length;ni++){
      if(cn.indexOf(' '+_names[ni]+' ')>=0){hit=_names[ni];break;}
    }
    if(hit){
      force[hit]={r:dl,mode:md0==='at'?'at':'by'};
      notes.push(md0==='at'?(titleCase(hit)+' in round '+dl):(titleCase(hit)+' gone by round '+dl));
      return;
    }
    Object.keys(POS).forEach(function(pos){if(POS[pos].test(c)){posRound[pos]=rn;notes.push(pos+'s in round '+rn);}});
  });
  var summary=notes.length?('Got it: '+notes.join(', ')+'. The room will draft that way.'):'';
  return {bias:bias,summary:''+summary,force:force,posRound:posRound};
}
// Plain-English overrides from the context box: "14 teams, 15 rounds,
// superflex, half ppr, no kickers, I pick 3rd, 30 second clock"
function mdParseOverrides(t){
  var o={notes:[]};
  if(!t)return o;
  t=t.toLowerCase();
  var m;
  if((m=t.match(/(\d+)\s*teams?/))&&+m[1]>=4&&+m[1]<=14){o.teams=+m[1];o.notes.push(m[1]+' teams');}
  if((m=t.match(/(\d+)\s*rounds?/))&&+m[1]>=3&&+m[1]<=16){o.rounds=+m[1];o.notes.push(m[1]+' rounds');}
  if(/superflex|2\s*qb|two\s*qb/.test(t)){o.sf=true;o.notes.push('superflex');}
  else if(/\b(1|one|single)\s*qb\b/.test(t)){o.sf=false;o.notes.push('1QB');}
  if(/half\s*ppr/.test(t)){o.scoring=0.5;o.notes.push('half PPR');}
  else if(/standard scoring|non\s*ppr|no\s*ppr/.test(t)){o.scoring=0;o.notes.push('standard scoring');}
  else if(/full\s*ppr/.test(t)){o.scoring=1;o.notes.push('full PPR');}
  // negation scope: "no kickers or defenses" removes BOTH - the "no"
  // distributes across or/and/slash/comma lists
  (t.match(/(?:\bno\b|\bwithout\b|\bskip\b|\bremove\b|\bdont want\b|\bdon't want\b)[^.;!\n]*/g)||[]).forEach(function(ph){
    var chunks=ph.split(',');
    chunks.forEach(function(ch,ci){
      if(ci>0&&ch.trim().split(/\s+/).length>3)return; // later chunks only if a bare list item
      if(/kickers?\b|\bk\b|\bpk\b/.test(ch)){o.noK=true;}
      if(/defen[cs]es?\b|\bdst\b|d\/st|\bdefs?\b/.test(ch)){o.noD=true;}
    });
  });
  if(o.noK)o.notes.push('no kickers');
  if(o.noD)o.notes.push('no defenses');
  if((m=t.match(/(?:i pick|pick|slot|drafting)\s*(\d+)(?:st|nd|rd|th)?\b/))&&+m[1]>=1&&+m[1]<=14){o.slot=+m[1];o.notes.push('you pick '+m[1]);}
  else if(/pick(ing)? (first|1st)\b/.test(t)){o.slot=1;o.notes.push('you pick 1st');}
  else if(/pick(ing)? last\b/.test(t)){o.slot=99;o.notes.push('you pick last');}
  if((m=t.match(/(\d+)\s*(?:second|sec|s)\s*(?:clock|timer|pick)/))&&+m[1]>=10&&+m[1]<=300){o.clock=+m[1];o.notes.push(m[1]+'s clock');}
  else if(/no (timer|clock)/.test(t)){o.clock=0;o.notes.push('timer off');}
  return o;
}
function mdContextPreview(){
  var box=document.getElementById('md-context');
  var read=document.getElementById('md-context-read');
  if(!box||!read)return;
  try{localStorage.setItem('tm_md_context',box.value);}catch(_){}
  var r=mdParseContext(box.value.trim());
  var ov=mdParseOverrides(box.value.trim());
  var parts=[];
  if(ov.notes.length)parts.push('Settings: '+ov.notes.join(', '));
  if(r.summary)parts.push(r.summary);
  read.textContent=parts.join(' · ')||(box.value.trim()?'Reading it as a normal room so far - mention positions with early or late, or settings like "14 teams, superflex, no kickers".':'');
}
// Data-driven pros and cons for a draft pick. Every line is built from real
// numbers (nflverse 2025 season, live market trend, actual age) run through
// established analytics rules: the RB age cliff at 27-28, the heavy-workload
// (370-touch) regression pattern, target share as the floor predictor, and
// efficiency-vs-volume splits. No canned takes, no vague "volume aligns" filler.
// ── Vacated targets: who took their target share OUT THE DOOR this offseason ─
// A player whose 2025 team differs from his CURRENT Sleeper team departed;
// his target share is vacated from the old team. Pure data, zero hand entry.
function _vacatedFor(team){
  if(!team||!window._advStats||!Object.keys(allPlayers).length)return null;
  if(!window._vacatedMap){
    var curTeam={};
    Object.values(allPlayers).forEach(function(p){
      if(!p.name)return;
      var k=p.name.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
      curTeam[k]=p.team||'FA';
      curTeam[k.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'')]=p.team||'FA';
    });
    var m={};
    Object.keys(window._advStats).forEach(function(k){
      var a=window._advStats[k];
      if(!a||!a.tgtShare||a.tgtShare<8||!a.team||a.pos==='K')return;
      var now=curTeam[k]||curTeam[k.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'')];
      if(!now||now===a.team)return;
      var slot=(m[a.team]=m[a.team]||{share:0,names:[]});
      slot.share+=a.tgtShare;
      slot.names.push({n:k.replace(/\b\w/g,function(c){return c.toUpperCase();}),s:a.tgtShare});
    });
    Object.values(m).forEach(function(v){
      v.share=Math.round(v.share*10)/10;
      v.names.sort(function(x,y){return y.s-x.s;});
    });
    window._vacatedMap=m;
  }
  return window._vacatedMap[team]||null;
}
// deterministic per-player phrasing pick - kills the copy-paste feel
function _pcVary(p,arr){
  var h=0,s=String(p.id||p.name||'');
  for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  return arr[h%arr.length];
}
function mdProsCons(p){
  var pros=[],cons=[];
  var a=advByName(p.name);if(a&&a.pos!==p.pos)a=null;
  var ap=allPlayers[p.id]||{};var age=ap.age;
  var touches=a?((a.ruAtt||0)+(a.rec||0)):0;
  // ── Kickers and defenses get their own honest 3/3 ─────────────────────────
  if(p.pos==='K'){
    var ka=a&&a.pos==='K'?a:null;
    if(ka&&ka.fgPct>=88)pros.push('Hit '+ka.fgPct+'% of his field goals last season, as automatic as the position gets');
    if(ka&&ka.fpts>=150)pros.push(ka.fpts+' kicking points last season, a top-of-position scoring floor');
    if(ka&&ka.g>=16)pros.push('Kicked all '+ka.g+' games, the job is safely his');
    pros.push('Costs a final-round pick, so there is zero downside to being wrong');
    pros.push('Kicking jobs are stable week to week, no committee, no snap counts to sweat');
    pros.push('Every offense produces field goal tries, the points show up regardless of game script');
    cons.push('Kicker scoring is weekly noise, last season\'s finish barely predicts this season\'s');
    if(ka&&ka.fgPct&&ka.fgPct<82)cons.push('Only '+ka.fgPct+'% on field goals last season, misses get kickers benched fast');
    cons.push('His volume depends on his offense stalling in the right spots, which nobody can predict');
    cons.push('If he loses the job in camp, the pick evaporates entirely');
    return {pros:pros.slice(0,3),cons:cons.slice(0,3),note:''};
  }
  if(p.pos==='DEF'){
    var avg=(window._advDst||{})[p.id]!=null?window._advDst[p.id]:(window._advDst||{})[p.team];
    if(avg!=null&&avg<75)pros.push('Gave up just '+avg+' fantasy points per game to opposing skill players last season, a top-shelf unit');
    else if(avg!=null)pros.push('Allowed '+avg+' fantasy points per game last season, a serviceable baseline');
    pros.push('You can stream defenses off waivers all year, so a late pick here loses you nothing');
    pros.push('A good defense wins you the weeks your offense goes quiet');
    pros.push('Sacks and takeaways stack points in bunches, one big quarter wins the position for the week');
    cons.push('Defense scoring swings wildly year to year, last season\'s ranking is a weak predictor');
    cons.push('Matchups matter more than the unit, be ready to stream against bad offenses');
    cons.push('Turnovers drive defense scoring and turnovers do not repeat reliably');
    return {pros:pros.slice(0,3),cons:cons.slice(0,3),note:''};
  }
  // ── No 2025 sample: rookies and lost seasons still get a real 3/3 ─────────
  if(!a){
    var isRk=(ap.exp===0||ap.exp===1)&&(age&&age<=23);
    if(isRk){
      if(age)pros.push('Age '+age+' with his whole career ahead, you are buying the ascent');
      pros.push('Zero NFL mileage'+(p.pos==='RB'?' on his legs, which matters most at running back':'')+', no bad habits and no injury history to discount');
      pros.push('If the role hits early, rookie production comes at a fraction of what the vets cost');
      cons.push('No NFL sample, every projection is scouting and hope');
      if(p.pos==='WR')cons.push('Rookie receivers are volatile, even the great ones tend to break out in stretches, not from week 1');
      else if(p.pos==='TE')cons.push('Rookie tight ends almost never produce, year one at the position is a redshirt');
      else if(p.pos==='RB')cons.push('Rookie backs live and die by the depth chart, one veteran signing changes everything');
      else cons.push('Rookie quarterbacks lose fantasy weeks to growing pains, the floor is rough');
      cons.push('If the opportunity does not come early, he is a bench stash while your league mates score');
    }else{
      if(age&&age<=26)pros.push('Age '+age+', young enough that last season\'s lost year does not define him');
      pros.push('The missing season is exactly why he comes cheap, healthy versions of him cost real draft capital');
      pros.push('A defined role in camp turns him into one of the draft\'s best discounts');
      pros.push('His healthy-season tape is the argument, and it is a real argument');
      cons.push('No meaningful 2025 sample, you are buying a projection, not a track record');
      cons.push('Whatever took his season, injury or role, tends to linger into the next one');
      cons.push('You cannot bank on him for your starting lineup until he shows it on the field');
    }
    return {pros:pros.slice(0,3),cons:cons.slice(0,3),note:''};
  }
  // ── Sampled players: strengths, in order of how much they matter ──────────
  var vac=_vacatedFor(ap.team||p.team);
  if(vac&&vac.share>=12&&['WR','TE','RB'].indexOf(p.pos)>=0){
    var vn=vac.names.slice(0,2).map(function(x){return x.n;}).join(' and ');
    pros.push(vn+' took '+vac.share+'% of the team\'s targets out the door this offseason, and somebody has to inherit that volume');
  }
  if(a.tgtShare>=26)pros.push('Commanded '+a.tgtShare+'% of his team\'s targets last season, true alpha usage');
  else if(a.tgtShare>=21)pros.push(a.tgtShare+'% target share last season, a locked-in featured role');
  else if(a.tgtShare>=17&&(p.pos==='TE'||p.pos==='RB'))pros.push(a.tgtShare+'% target share is elite usage for his position');
  if(a.ypc>=4.9&&a.ruAtt>=150)pros.push(a.ypc+' yards per carry on '+a.ruAtt+' carries, elite efficiency at real volume');
  else if(a.ruY>=1200)pros.push(Math.round(a.ruY)+' rushing yards last season, a proven workhorse floor');
  else if(a.ruAtt>=220)pros.push(a.ruAtt+' carries last season, volume that survives bad games');
  if(a.yacRec>=5.8&&a.rec>=50)pros.push(a.yacRec+' yards after catch per reception, he creates offense on his own');
  if(a.catchPct>=72&&a.tgt>=90)pros.push('Caught '+a.catchPct+'% of '+a.tgt+' targets, the reliability quarterbacks feed');
  else if(a.catchPct>=68&&a.tgt>=60)pros.push(a.catchPct+'% catch rate on '+a.tgt+' targets, dependable hands at volume');
  if(p.pos==='QB'&&a.ruY>=450)pros.push(Math.round(a.ruY)+' rushing yards, the rushing floor that wins fantasy weeks');
  if(a.ayShare>=27)pros.push(a.ayShare+'% of his team\'s air yards, the downfield role that produces spike weeks');
  if(a.recTD>=9)pros.push(a.recTD+' receiving touchdowns, his team looks for him when it matters most');
  if(a.rec>=85)pros.push(a.rec+' receptions, a PPR floor most players cannot touch');
  if(a.ypt>=9&&a.tgt>=60)pros.push(a.ypt+' yards per target, elite efficiency on every look');
  var availSaid=false;
  if(a.g>=16){pros.push(_pcVary(p,['Answered the bell all '+a.g+' games, availability is a skill','All '+a.g+' games played last season, the most underrated stat in fantasy','Never missed a game in 2025, and you cannot score from the trainers table']));availSaid=true;}
  if(age&&age<=23&&['WR','RB','TE'].indexOf(p.pos)>=0)pros.push(_pcVary(p,['Age '+age+', the breakout years are still ahead of him','Only '+age+' years old, you are buying the ascent, not the peak','At '+age+' his best football has not happened yet']));
  else if(age&&age>=24&&age<=25)pros.push(_pcVary(p,['Age '+age+', squarely in the entering-prime window','At '+age+' the physical prime and the opportunity finally line up']));
  // ── Red flags, in order of how much they hurt ─────────────────────────────
  if(touches>=370)cons.push(touches+' touches last season. Backs coming off that workload historically decline or miss time the following year');
  else if(touches>=330&&p.pos==='RB')cons.push(touches+' touches last season is a heavy load, regression risk is real');
  if(a.g<=10&&a.g>0)cons.push('Only '+a.g+' games last season, his health is the bet you are making');
  else if(a.g>=11&&a.g<=13)cons.push('Missed '+(17-a.g)+' games last season, the durability question is open');
  else if(a.g===14||a.g===15)cons.push('Missed '+(17-a.g)+' games last season, worth a look at why before you commit');
  if(a.ypc&&a.ypc<3.9&&a.ruAtt>=120)cons.push(a.ypc+' yards per carry on '+a.ruAtt+' attempts, volume without efficiency rarely holds');
  if(p.pos==='WR'&&a.tgtShare&&a.tgtShare<15&&a.tgt>=40)cons.push('Under 15% target share, his weeks depend on big plays instead of steady volume');
  else if(p.pos==='WR'&&a.tgtShare&&a.tgtShare<20&&a.tgt>=60)cons.push(a.tgtShare+'% target share is solid but not alpha volume, he needs efficiency to hit his ceiling');
  if(p.pos==='TE'&&a.tgtShare&&a.tgtShare<13&&a.tgt>=30)cons.push(a.tgtShare+'% target share, streamer usage rather than every-week TE1 volume');
  if(a.catchPct&&a.catchPct<58&&a.tgt>=60)cons.push('Caught just '+a.catchPct+'% of his targets, a contested-catch profile with rough floor weeks');
  else if(a.catchPct&&a.catchPct<65&&a.tgt>=80)cons.push(a.catchPct+'% catch rate at his volume means drops and dead targets show up weekly');
  if(a.recTD>=10&&a.recY<1000)cons.push(a.recTD+' touchdowns on under 1,000 yards, TD-heavy seasons regress hard');
  else if(a.recTD<=3&&a.recY>=750)cons.push('Only '+a.recTD+' touchdowns on '+Math.round(a.recY)+' yards, though scoring luck that bad usually corrects upward');
  if(p.pos==='RB'&&a.rec<25&&a.ruAtt>=150)cons.push('Just '+a.rec+' catches, no passing-down role caps his ceiling in PPR formats');
  if(p.pos==='WR'&&a.ayShare&&a.ayShare<14&&a.tgt>=60)cons.push(a.ayShare+'% air yards share, a short-area role that needs volume to matter');
  if(a.ypt&&a.ypt<7&&a.tgt>=80)cons.push(a.ypt+' yards per target, his volume worked harder than it produced');
  if(age){
    if(p.pos==='RB'&&age>=28)cons.push('Age '+age+' running back. The position\'s cliff usually arrives at 27-28'+(touches>=300?', and heavy-touch seasons pull it closer':''));
    else if(p.pos==='RB'&&age>=27)cons.push('Age '+age+', entering the RB decline window');
    else if(p.pos==='RB'&&age===26&&touches>=280)cons.push('Age 26 with '+touches+' touches already banked, the heavy-usage clock is ticking');
    if(p.pos==='WR'&&age>=30)cons.push('Age '+age+' receiver. Route-winners age gracefully but the drop past 30 can be sudden');
    else if(p.pos==='WR'&&age>=28)cons.push('Age '+age+', the years where receivers quietly lose a step start now');
    if(p.pos==='TE'&&age>=31)cons.push('Age '+age+' tight end, late-career territory');
    if(p.pos==='QB'&&age>=37)cons.push('Age '+age+' quarterback, every season could be the last good one');
    else if(p.pos==='QB'&&age>=33)cons.push('Age '+age+', still productive but the rushing juice fades first at quarterback');
  }
  // ── Fill stage: every player reaches 3 and 3, each line still his own ─────
  var fillPros=[
    a.recY>=700?Math.round(a.recY)+' receiving yards on '+a.rec+' catches, steady weekly involvement':null,
    a.ruY>=600?Math.round(a.ruY)+' rushing yards last season, a real share of his backfield':null,
    a.tgtShare>=12?a.tgtShare+'% target share, a stable role you can project forward':null,
    (!availSaid&&a.g>=15)?'On the field for '+a.g+' of 17 games, the opportunity kept coming':null,
    a.yacRec>=4.5&&a.rec>=40?a.yacRec+' yards after catch per grab, he adds value beyond the throw':null,
    (age&&age<=27)?_pcVary(p,['Age '+age+', his physical prime and his current role line up','At '+age+' there is no age tax on this pick yet']):null,
    a.tgt>=50?a.tgt+' targets last season, a real role in a real offense':null,
    a.ruAtt>=80?a.ruAtt+' carries last season, trusted with the ball':null
  ].filter(Boolean);
  var fillCons=[
    (a.tgt&&a.tgt<60&&['WR','TE'].indexOf(p.pos)>=0)?'Only '+a.tgt+' targets last season, the role has to grow for the pick to pay':null,
    (p.pos==='RB'&&a.ruAtt<140)?'Just '+a.ruAtt+' carries last season, he has not owned a backfield yet':null,
    (MD.initialRanks&&MD.initialRanks[p.id]&&MD.initialRanks[p.id]<=30)?_pcVary(p,['Priced at his ceiling. Everything went right last season, and he has to repeat it just to return value','The whole league saw his season, so the discount is gone - you are paying retail for the best case','Zero surprise left in the price: he must repeat a career year for this pick to break even']):null,
    a.tgtShare?_pcVary(p,['His role is priced as stable, and roles are decided by coaches in August, not by last season','The projection assumes his exact role carries over, and camp battles rewrite roles every year']):null,
    _pcVary(p,['Nothing in the data screams risk, so the risk is the price: he has to repeat his best season just to break even','The data is clean, which means the danger is paying full price for a season that already happened','No statistical red flag here - the bet is purely that last season was signal, not peak'])
  ].filter(Boolean);
  fillPros.forEach(function(l){if(l&&pros.length<3&&pros.indexOf(l)<0)pros.push(l);});
  fillCons.forEach(function(l){if(l&&cons.length<3&&cons.indexOf(l)<0)cons.push(l);});
  return {pros:pros.slice(0,3),cons:cons.slice(0,3),note:''};
}
// Shared renderer for the +/- columns
function _pcCols(pros,cons){
  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;font-size:11.5px;line-height:1.55">'
    +'<div>'+pros.map(function(x){return '<div style="color:var(--muted2);margin-bottom:3px"><span style="color:var(--green);font-weight:800">+</span> '+x+'</div>';}).join('')+'</div>'
    +'<div>'+cons.map(function(x){return '<div style="color:var(--muted2);margin-bottom:3px"><span style="color:var(--red);font-weight:800">&minus;</span> '+x+'</div>';}).join('')+'</div></div>';
}
function mdProsConsHtml(p,lim){
  var pc=mdProsCons(p);
  if(!pc.pros.length&&!pc.cons.length)return '';
  mdScoutQueue(p); // web scouting arrives async and upgrades the columns in place
  var pros=lim?pc.pros.slice(0,lim):pc.pros;
  var cons=lim?pc.cons.slice(0,lim):pc.cons;
  return '<div class="pcwrap" data-pcid="'+p.id+'"'+(lim?' data-pclim="'+lim+'"':'')+'>'+_pcCols(pros,cons)+'</div>';
}
// Live web scouting: the server researches each player across the internet
// (7-day shared cache) and the fresh takes merge into the columns on arrival.
function mdScoutQueue(p){
  if(!p||p.pos==='K'||p.pos==='DEF')return;
  window._scoutCache=window._scoutCache||{};
  var c=window._scoutCache;
  if(!c[p.name])c[p.name]=fetch('/api/scout?name='+encodeURIComponent(p.name)+'&team='+encodeURIComponent(p.team||'')+'&pos='+encodeURIComponent(p.pos||''))
    .then(function(r){return r.ok?r.json():null;}).catch(function(){return null;});
  c[p.name].then(function(doc){
    if(!doc||!doc.pros||!doc.pros.length)return;
    var els=document.querySelectorAll('[data-pcid="'+p.id+'"]');
    if(!els.length)return;
    var local=mdProsCons(p);
    var seen={};
    var mix=function(scout,data){
      var out=[];
      scout.concat(data).forEach(function(x){var k=x.slice(0,40);if(!seen[k]&&out.length<4){seen[k]=1;out.push(x);}});
      return out;
    };
    var pros=mix(doc.pros,local.pros);seen={};
    var cons=mix(doc.cons||[],local.cons);
    els.forEach(function(w){
      // a limited wrap (the pick bar) keeps its cap and skips the extras -
      // the full columns still land on unlimited wraps and the player card
      var lim=parseInt(w.dataset.pclim||'0',10)||0;
      w.innerHTML=_pcCols(lim?pros.slice(0,lim):pros,lim?cons.slice(0,lim):cons)
        +(lim?'':(doc.college?'<div style="font-size:11px;color:var(--muted2);margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><strong style="color:var(--accent-bright)">College:</strong> '+doc.college+'</div>':'')
        +'<div style="font-size:9.5px;color:var(--muted);margin-top:4px">Includes this week\'s scouting from around the web.</div>');
      // Fade the fresh scouting in so it never hard-jumps the columns
      w.style.animation='none';void w.offsetWidth;w.style.animation='tmPcFade .35s ease';
    });
  });
}
// ── Stacked-parity data: real projections, byes, stat columns ────────────────
// Season-long projections from Sleeper's public projections API - the same
// numbers Stacked shows. One fetch per season, cached on window; every row
// reads its total (by the room's scoring) plus per-position splits from it.
async function mdLoadProjections(){
  if(window._mdProj&&window._mdProj.season===ACTIVE_SEASON)return;
  try{
    var u='https://api.sleeper.com/projections/nfl/'+ACTIVE_SEASON
      +'?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF&order_by=pts_ppr';
    var r=await fetch(u);
    if(!r.ok)return;
    var rows=await r.json();
    var byId={};
    (rows||[]).forEach(function(e){if(e&&e.player_id&&e.stats)byId[e.player_id]=e.stats;});
    if(!Object.keys(byId).length)return;
    window._mdProj={season:ACTIVE_SEASON,byId:byId};
    try{mdRetierFromProj();}catch(_){}
    if(MD.onClock||AU.active)mdShowChoices(MD.curRound||1);  // the columns appear in place
  }catch(_){}
}
// Re-tier on PROJECTED POINTS the moment they exist: the dv board is ordinal
// (40dv = 1 ADP pick by construction), so a fixed dv gap means a ~15-point
// cliff in round 2 and background noise in round 10. A tier break here is a
// consecutive same-position drop beyond the p80 of typical top-24 drops in
// the 2026 projections (QB 30 / RB 26 / WR 21 / TE 30 season pts, derived
// 7/2026 - the median drop is 10-17, so p80 marks a real shelf, not noise).
// The dv-gap tiers built at pool time remain the fallback until this runs.
// Tiers the way a drafter actually means them: a tier ends where the MARKET
// steps down, not where a projection sheet does. Absolute point gaps put every
// TE in one bucket (they project within a few points of each other while the
// room prices them 4x apart - Bowers $35 next to Fannin $8), so the break test
// is PROPORTIONAL to the value at that spot, with a floor so the tail does not
// shatter into singletons and a size cap so a tier never becomes a phone book.
var MD_TIER_DROP=0.14;   // >=14% step down from the running tier's top = new tier
var MD_TIER_MAX=6;       // no tier longer than this - readability beats purity
function mdBuildTiers(){
  if(!MD.pool||!MD.pool.length)return;
  MD.tierOf=MD.tierOf||{};
  // TIER = a step down in the SAME ranking the list is sorted by. Tiering on
  // projections while the list sorts on price produced tiers that jumped
  // around on screen (Tier 5 above Tier 4). Auction sorts on money, snake on
  // draft value - so tier on exactly that.
  var useAav=!!(AU&&AU.active&&AU.val);
  var valOf=function(p){
    if(useAav){var v=(AU.val&&AU.val[p.id])||0;if(v>0)return v;}
    return p.dv||0;
  };
  ['QB','RB','WR','TE','K','DEF'].forEach(function(ps){
    var list=MD.pool.filter(function(p){return p.pos===ps;});
    if(!list.length)return;
    list.sort(function(a,b){return valOf(b)-valOf(a);});
    var t=1,top=valOf(list[0]),count=0;
    // the floor scales with the position's own top so a $60 board and a
    // 300-point board both break sensibly
    var floor=Math.max(0.5,top*0.035);
    list.forEach(function(p,i){
      var v=valOf(p);
      if(i>0){
        var stepped=(top-v)>=Math.max(floor,top*MD_TIER_DROP);
        if((stepped||count>=MD_TIER_MAX)&&t<8){t++;top=v;count=0;}
      }
      MD.tierOf[p.id]=t;count++;
    });
  });
}
// kept as the old name so every caller (and the projection arrival) still works
function mdRetierFromProj(){mdBuildTiers();}
// Bye weeks derived from the real schedule: a bye is simply a week where a
// team has no game - no hand-kept table to go stale. Partial or missing
// schedule means NO byes shown, never guessed ones.
async function mdLoadByes(){
  if(window._mdByes&&window._mdByes._season===ACTIVE_SEASON)return;
  try{
    var r=await fetch('https://api.sleeper.app/schedule/nfl/regular/'+ACTIVE_SEASON);
    if(!r.ok)return;
    var games=await r.json();
    if(!games||!games.length)return;
    var teams={},weeks={};
    games.forEach(function(g){
      if(!g||!g.week||!g.home||!g.away)return;
      teams[g.home]=1;teams[g.away]=1;
      (weeks[g.week]=weeks[g.week]||{})[g.home]=1;weeks[g.week][g.away]=1;
    });
    var all=Object.keys(teams);
    if(all.length<28)return; // partial schedule: better no byes than wrong ones
    var byes={_season:ACTIVE_SEASON};
    Object.keys(weeks).forEach(function(w){
      var off=all.filter(function(t){return !weeks[w][t];});
      if(off.length&&off.length<=8)off.forEach(function(t){byes[t]=parseInt(w,10);});
    });
    window._mdByes=byes;
    // the same download also gives us every team's opponent by week - cached
    // for the playoff-run read (weeks 15-17), one build per season
    var sched={_season:ACTIVE_SEASON};
    games.forEach(function(g){
      if(!g||!g.week||!g.home||!g.away)return;
      (sched[g.home]=sched[g.home]||{})[g.week]=g.away;
      (sched[g.away]=sched[g.away]||{})[g.week]=g.home;
    });
    window._mdSched=sched;
    if(MD.onClock||AU.active)mdShowChoices(MD.curRound||1);
    try{mdRenderMine();}catch(_){}
  }catch(_){}
}
// Playoff-run read (fantasy playoffs, weeks 15-17): average what each of the
// three opponents' defenses allowed per game last season (_advDst - lower =
// tougher defense). Only the extremes speak: the ~6 softest slates get SOFT
// PLAYOFFS, the ~6 hardest get TOUGH PLAYOFFS, the middle stays quiet.
function _mdPlayoffRuns(){
  if(window._mdPlayoff&&window._mdPlayoff._season===ACTIVE_SEASON)return window._mdPlayoff;
  var sched=window._mdSched,dst=window._advDst;
  if(!sched||sched._season!==ACTIVE_SEASON||!dst)return null;
  var scores={};
  Object.keys(sched).forEach(function(t){
    if(t==='_season')return;
    var s=0,n=0;
    [15,16,17].forEach(function(w){
      var opp=sched[t][w];
      if(opp&&dst[opp]!=null){s+=dst[opp];n++;}
    });
    if(n===3)scores[t]=s/n;
  });
  var ranked=Object.keys(scores).sort(function(a,b){return scores[b]-scores[a];}); // softest first
  if(ranked.length<20)return null; // thin data: no read beats a wrong read
  // One full standard deviation marks the extremes, not a fixed top/bottom 6:
  // in the 2026 distribution (mean 82.5, σ 5.0) the gap between #6 and #7 was
  // 0.1 points - a fixed count cuts straight through noise. ±1σ tags only
  // slates genuinely apart from the pack (7/2026: 3 soft, 7 tough).
  var _mean=0;ranked.forEach(function(t){_mean+=scores[t];});_mean/=ranked.length;
  var _sd=0;ranked.forEach(function(t){_sd+=(scores[t]-_mean)*(scores[t]-_mean);});_sd=Math.sqrt(_sd/ranked.length);
  var out={_season:ACTIVE_SEASON};
  ranked.forEach(function(t){
    if(scores[t]>_mean+_sd)out[t]='soft';
    else if(scores[t]<_mean-_sd)out[t]='tough';
  });
  window._mdPlayoff=out;
  return out;
}
// ADP riser data: base rates from our offline study (riser-rates.json - built
// from Sleeper's own final preseason ADP 2020-2025 plus real PPR outcomes)
// and every player's final ADP from last season, keyed by Sleeper id.
async function mdLoadRiserRates(){
  if(window._mdRisers)return;
  try{
    var r=await fetch('/riser-rates.json');
    if(!r.ok)return;
    var d=await r.json();
    if(!d||!d.prev||!d.buckets)return;
    window._mdRisers=d;
    if(MD.onClock||AU.active)mdShowChoices(MD.curRound||1);
  }catch(_){}
}
// Mined market signals (public/signals.json, written by the pattern miner).
// Shared by the Research card and the board tags. Freshness gate: signals
// older than seven days are treated as absent - silence beats stale.
async function mdLoadSignals(){
  if(window._mdSignals!==undefined)return;
  window._mdSignals=null; // fetch once; stays null on any failure
  try{
    var r=await fetch('/signals.json?d='+new Date().toISOString().slice(0,10));
    if(!r.ok)return;
    var d=await r.json();
    if(!d||!d.signals||!d.computed_at)return;
    if((Date.now()-Date.parse(d.computed_at))>7*86400000)return;
    var byId={};
    d.signals.forEach(function(s){(s.candidates||[]).forEach(function(c){if(c&&c.id&&!byId[c.id])byId[c.id]=s.claim;});});
    window._mdSignals={data:d,byId:byId};
    if(MD.onClock||AU.active)mdShowChoices(MD.curRound||1);
  }catch(_){}
}
// A riser is a player whose current board ADP sits 3+ rounds ahead of his
// final ADP last season - the same line the study drew. Note the study fixed
// "3 rounds" at 36 picks (12-team convention); here it scales with the room
// (24 picks in an 8-teamer, 42 in a 14-teamer) so the tag always means the
// same THREE ROUNDS of this draft - the base rates still come from the
// 12-team study and read as tendencies, not exact odds, in other sizes.
function mdRiserInfo(p){
  var d=window._mdRisers;
  if(!d||!p.adp)return null;
  // 2QB boards price every QB rounds ahead of the PPR history the study was
  // built on - comparing the two would tag the whole position as risers
  if(MD.sf&&p.pos==='QB')return null;
  var prev=d.prev[p.id];
  if(prev==null)return null;
  var rise=prev-p.adp;
  return rise>=MD.teams*3?{rise:Math.round(rise),prev:prev}:null;
}
// The most specific study bucket this riser belongs to. Buckets under n=15
// never made it into the JSON, so whatever we find here is safe to show.
function mdRiserBucket(p){
  var d=window._mdRisers;
  if(!d||!p.adp||p.adp>192)return null;
  var dest=p.adp<=72?'early':p.adp<=120?'mid':'late';
  var expc=p.exp===1?'soph':p.exp===2?'third':p.exp>=3?'vet':null;
  var ap=allPlayers[p.id]||{};
  var agec=ap.age?(ap.age<=25?'le25':'ge26'):null;
  var keys=[];
  if(expc)keys.push(p.pos+'|'+expc+'|'+dest,expc+'|'+dest);
  keys.push(p.pos+'|'+dest);
  if(agec)keys.push(p.pos+'|'+agec);
  if(expc)keys.push('exp:'+expc);
  if(agec)keys.push('age:'+agec);
  keys.push('pos:'+p.pos,'dest:'+dest,'all');
  for(var i=0;i<keys.length;i++){if(d.buckets[keys[i]])return d.buckets[keys[i]];}
  return null;
}
// Per-player overlay tags, Stacked style: quiet coloured words on the meta
// line, max two. Roster reads outrank the market and calendar reads:
// HANDCUFF > STACK > RISER > PLAYOFFS. Compact mode (the narrow "All" cards)
// keeps only the strongest tag and skips the playoff read - the row must
// not grow.
function mdRowTags(p,compact){
  var tags=[],mine=MD.mine||[];
  if(p.pos==='RB'){
    var rb=mine.find(function(x){return x.pos==='RB'&&x.team&&x.team===p.team&&x.id!==p.id;});
    if(rb)tags.push({t:'HANDCUFF',c:'var(--pos-rb)',tip:'Backs up / pairs with '+rb.name});
  }
  // QB-to-pass-catcher stack with YOUR roster, both directions
  var st=null;
  if(p.pos==='QB')st=mine.find(function(x){return (x.pos==='WR'||x.pos==='TE')&&x.team&&x.team===p.team;});
  else if(p.pos==='WR'||p.pos==='TE')st=mine.find(function(x){return x.pos==='QB'&&x.team&&x.team===p.team;});
  if(st)tags.push({t:'STACK',c:'var(--accent-bright)',tip:'Stacks with '+st.name});
  var ri=tags.length<2&&p.pos!=='K'&&p.pos!=='DEF'?mdRiserInfo(p):null;
  // a player named by an active mined signal: the claim rides the RISER
  // tooltip when he has one, or earns its own SIGNAL tag (last priority)
  var sig=window._mdSignals&&window._mdSignals.byId?window._mdSignals.byId[p.id]:null;
  if(ri)tags.push({t:'RISER +'+ri.rise,c:'var(--yellow)',tip:'Drafted '+ri.rise+' picks earlier than his final ADP last season'+(sig?' — '+sig:'')});
  if(!compact&&tags.length<2&&p.pos!=='K'&&p.pos!=='DEF'){
    var pr=_mdPlayoffRuns();
    var pt=pr&&p.team?pr[p.team]:null;
    if(pt==='soft')tags.push({t:'SOFT PLAYOFFS',c:'var(--green)',tip:'Easy defensive slate in weeks 15-17'});
    else if(pt==='tough')tags.push({t:'TOUGH PLAYOFFS',c:'var(--red)',tip:'Hard defensive slate in weeks 15-17'});
  }
  if(!ri&&sig&&tags.length<2)tags.push({t:'SIGNAL',c:'var(--yellow)',tip:sig});
  return tags.slice(0,compact?1:2);
}
function mdRowTagsHtml(p,compact){
  return mdRowTags(p,compact).map(function(tg){
    return ' <span title="'+tg.tip.replace(/"/g,'&quot;')+'" style="font-size:9px;font-weight:800;letter-spacing:.05em;color:'+tg.c+';white-space:nowrap">'+tg.t+'</span>';
  }).join('');
}
// Click a roster counter to shop that position: drives the same filter the
// position chips use, so their active state stays in sync.
function mdNeedsFilter(pos){
  var btn=document.querySelector('#md-pos-filter .md-pos-chip[data-pos="'+pos+'"]');
  if(btn)mdSetPosFilter(btn);
}
// Points column keyed to the room's scoring
function mdProjPts(pid){
  var pr=window._mdProj&&window._mdProj.byId[pid];
  if(!pr)return null;
  var v=MD.scoring>=1?pr.pts_ppr:MD.scoring===0.5?pr.pts_half_ppr:pr.pts_std;
  return v!=null?v:(pr.pts_ppr!=null?pr.pts_ppr:null);
}
// The splits that matter per position - what Stacked shows, nothing more.
// (Sleeper's season feed carries no target projections, so WR/TE lead with
// receptions.)
function mdSplitCols(pos){
  if(pos==='QB')return[{k:'pass_yd',l:'PaYd'},{k:'pass_td',l:'PaTD'},{k:'rush_yd',l:'RuYd'},{k:'rush_td',l:'RuTD'}];
  if(pos==='RB')return[{k:'rush_att',l:'Att'},{k:'rush_yd',l:'RuYd'},{k:'rush_td',l:'TD'},{k:'rec',l:'Rec'}];
  if(pos==='WR'||pos==='TE')return[{k:'rec',l:'Rec'},{k:'rec_yd',l:'Yds'},{k:'rec_td',l:'TD'}];
  return[];
}
function _mdStat(p,k){
  if(k==='proj')return mdProjPts(p.id);
  if(k==='aav')return AU.active?auValue(p):null;
  var pr=window._mdProj&&window._mdProj.byId[p.id];
  return pr&&pr[k]!=null?pr[k]:null;
}
// big numbers whole, small ones keep a decimal - 7.4 projected TDs is a real read
function _mdFmtStat(v){
  if(v==null)return '&ndash;';
  return v>=100?String(Math.round(v)):String(Math.round(v*10)/10);
}
// Column-header sort: first click best-first, second flips it. Players the
// feed has no line for always sink to the bottom.
function mdSortCols(k){
  if(MD.availSort&&MD.availSort.k===k)MD.availSort.d*=-1;
  else MD.availSort={k:k,d:-1};
  mdFilterChoices();
}
function mdToggleRookies(btn){
  MD.rookiesOnly=!MD.rookiesOnly;
  btn.classList.toggle('active',MD.rookiesOnly);
  mdFilterChoices();
}
function mdToggleTaken(btn){
  MD.showTaken=!MD.showTaken;
  btn.classList.toggle('active',MD.showTaken);
  mdFilterChoices();
}
function mdSetPosFilter(btn){
  MD.posFilter=btn.dataset.pos||'';
  MD.availSort=null; // a column sort belongs to the view it was clicked in
  document.querySelectorAll('.md-pos-chip').forEach(function(c){c.classList.toggle('active',c===btn);});
  mdFilterChoices();
}
// Filters repaint the list ANY time the board is live - the old on-clock-only
// gate made every chip feel dead during bot turns and (worse) through whole
// auction bidding wars. Off-clock renders are safe because the Mac/rec block
// inside mdShowChoices only runs on the clock (so a filter click can never
// overwrite his pick reaction or the end-of-draft grade).
function mdFilterChoices(){
  var bd=document.getElementById('md-board');
  if(bd&&bd.dataset.live==='1')mdShowChoices(MD.curRound||1);
}
// Coalesced repaint: a burst (Sim resolving ten lots in under a second, a
// fast bot run) would otherwise rebuild 200 rows ten times over. Collapse the
// burst into one paint on the next frame - the user sees the same final list,
// the phone does a tenth of the work.
var _mdPaintT=null;
function mdShowChoicesSoon(round){
  if(_mdPaintT)clearTimeout(_mdPaintT);
  _mdPaintT=setTimeout(function(){_mdPaintT=null;try{mdShowChoices(round);}catch(_){}},90);
}
function mdShowChoices(round){
  var q=((document.getElementById('md-avail-search')||{}).value||'').toLowerCase().trim();
  var pf=MD.posFilter||'';
  // A player already on the board can NEVER be available or recommended - guard by
  // the picks list, not just the pool, so a laggy server pool can't resurrect a
  // drafted player in the list or in Mac's rec.
  var taken={};(MD.picks||[]).forEach(function(pk){if(pk&&pk.p&&pk.p.id)taken[pk.p.id]=1;});
  var pool=MD.pool.filter(function(p){return !taken[p.id]&&(!pf||p.pos===pf)&&(!MD.rookiesOnly||p.exp===0)&&(!q||p.name.toLowerCase().indexOf(q)>=0);});
  var _proj=window._mdProj&&window._mdProj.byId;
  // sort mode: pure best-available (board rank) or roster fit (filled positions sink)
  var srt=((document.getElementById('md-sort')||{}).value)||'bpa';
  if(srt==='fit'){
    var have={QB:0,RB:0,WR:0,TE:0};MD.mine.forEach(function(p){have[p.pos]++;});
    var isSF2=((document.getElementById('md-format')||{}).value)==='sf';
    pool=pool.slice().sort(function(a,b){
      var pa=(a.pos==='QB'&&have.QB>=(isSF2?2:1))||(a.pos==='TE'&&have.TE>=1)?1:0;
      var pb=(b.pos==='QB'&&have.QB>=(isSF2?2:1))||(b.pos==='TE'&&have.TE>=1)?1:0;
      return pa-pb||(b.dv||0)-(a.dv||0);
    });
  }
  // column-header sort (projection columns) outranks the dropdown modes
  var _sortCmp=null;
  if(MD.availSort&&_proj){
    var _sk=MD.availSort.k,_sd=MD.availSort.d;
    _sortCmp=function(a,b){
      var va=_mdStat(a,_sk),vb=_mdStat(b,_sk);
      if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return -1;
      return _sd*(va-vb);
    };
    pool=pool.slice().sort(_sortCmp);
  }
  // the whole draftable board, not a shop window of 18
  var entries=pool.slice(0,200).map(function(p){return {p:p};});
  // Show drafted: taken players rejoin the list in place, attenuated and
  // tagged with who took them - so the run that just happened stays visible.
  if(MD.showTaken&&(MD.picks||[]).length){
    (MD.picks||[]).forEach(function(pk){
      if(!pk||!pk.p)return;var tp=pk.p;
      if(pf&&tp.pos!==pf)return;
      if(MD.rookiesOnly&&tp.exp!==0)return;
      if(q&&tp.name.toLowerCase().indexOf(q)<0)return;
      var by=pk.mine?'You':((MD.bots&&MD.bots[pk.slot]&&MD.bots[pk.slot].name)||('Team '+pk.slot));
      entries.push({p:tp,by:by,round:pk.round,pickNo:pk.pickNo});
    });
    entries.sort(_sortCmp
      ?function(a,b){return _sortCmp(a.p,b.p);}
      :function(a,b){return (b.p.dv||0)-(a.p.dv||0);});
    entries=entries.slice(0,200);
  }
  if(!entries.length){document.getElementById('md-choices').innerHTML='<div class="empty-state" style="grid-column:1/-1">No available player matches that search.</div>';mdRenderDraftBar();return;}
  // Mac only speaks when it is actually YOUR pick - in a live room he stays
  // quiet while someone else is on the clock (his last take stays visible).
  var rec=null;
  // in an auction the advisor lives on the lot card ("worth up to $X"), not
  // here - a "my pick is X" call makes no sense while money decides. And only
  // ON THE CLOCK: an off-clock repaint (filters during a bot's turn, or after
  // the draft) must leave Mac's last take - or his final grade - alone.
  if(!AU.active&&MD.onClock){
    MD.lastRec=null; // cleared first: a throw below must not leave a stale rec
    // Recommend only from players who are genuinely still available.
    var recPool=MD.pool.filter(function(p){return !taken[p.id];}).slice(0,10);
    var r=mdRecommend(recPool,round);
    // tier cliff: when the recommended player's tier is about to die, say so -
    // that urgency is the whole reason tiers exist
    try{
      if(r.rec&&MD.tierOf&&MD.tierOf[r.rec.id]&&r.rec.pos!=='K'&&r.rec.pos!=='DEF'){
        var _tn=MD.tierOf[r.rec.id];
        var _left=MD.pool.filter(function(x){return !taken[x.id]&&x.pos===r.rec.pos&&MD.tierOf[x.id]===_tn;}).length;
        if(_left===1)r.why+=' And he is the last man in this '+r.rec.pos+' tier - the cliff is right behind him.';
        else if(_left===2)r.why+=' Only one more '+r.rec.pos+' left in this tier after him.';
      }
    }catch(_){}
    // room + self reads (advice layer, engine untouched): the live positional
    // run, and your roster shape once it has become a strategy - each shape
    // gets named exactly once per draft, then the advisor stays quiet
    try{
      var _run2=mdRunRead();
      if(_run2&&r.rec&&_run2.pos===r.rec.pos)r.why+=' And '+_run2.count+' of the last five picks were '+_run2.pos+'s - the run is live, which is exactly why the position thins right now.';
      var _mp2={QB:0,RB:0,WR:0,TE:0};MD.mine.forEach(function(x){if(_mp2[x.pos]!=null)_mp2[x.pos]++;});
      MD._shapeSaid=MD._shapeSaid||{};
      if(round>=4&&_mp2.WR>=3&&_mp2.RB===0&&!MD._shapeSaid.zerorb){
        MD._shapeSaid.zerorb=1;
        r.why+=' Bigger picture: you are all-in on a Zero RB build - from round 6 the RBs left are dregs, so pivot now or commit to it.';
      }else if(round>=4&&_mp2.RB>=3&&_mp2.WR===0&&!MD._shapeSaid.allrb){
        MD._shapeSaid.allrb=1;
        r.why+=' Bigger picture: three RBs and not one WR yet - the receiver tiers are draining while you wall up.';
      }
    }catch(_){}
    rec=r.rec;MD.lastRec=rec;MD.lastRecWhy=r.why;
    var openers=['I am taking','My pick is','Lock in','Give me','No hesitation:'];
    // The FULL read (face, call, why, the on-demand live ask) is always
    // computed; Mac's face decides how much of it shows. The sageLive cache
    // re-display runs on expand, since #md-sage-live only exists then.
    var _macFull='<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px">Mac · '+((MD_STRATS[MD.strat]||MD_STRATS.bpa).name)+'</div>'
      +'<div style="display:flex;gap:10px;align-items:flex-start;margin-top:2px">'
      +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+rec.id+'.jpg" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid var(--accent-bright);flex:none" onerror="this.style.display=\'none\'">'
      +'<div style="min-width:0;flex:1">'
      +'<div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--text)">'+openers[(MD.pickIdx*7)%openers.length]+' '+rec.name+'</div>'
      +'<div style="font-size:12px;color:var(--muted2);line-height:1.6;margin-top:4px">'+r.why+'</div>'
      // The full Mac call is user-initiated only: one API request per click,
      // never one per hover or per render. His answer survives re-renders of
      // this box for the same pick via the MD.sageLive cache.
      +'<div id="md-sage-live" style="display:none"></div>'
      +'</div></div>';
    var _macShowLive=function(){
      if(!MP.active&&MD.sageLive&&MD.sageLive.pick===MD.pickIdx){
        var _slh=document.getElementById('md-sage-live');
        if(_slh){_slh.style.display='block';_slh.innerHTML=_mdSageLiveHtml(MD.sageLive.text);}
      }
    };
    // EDITORIAL BAR (owner: "que se meta cuando sea necesario"): the first
    // two of your picks and the obvious ones (the top of the board going
    // about where the market says) get a silent face - the read is a tap
    // away, not in your face. A genuine kill-call (your queued target about
    // to vanish behind the archetype read) overrides everything with the one
    // line that matters, plus the collapsed-face pulse + dot.
    var _essence='Take '+rec.name+'.';
    var _face='thinking';var _urgent=false;
    try{
      var _early=MD.mine.length<2;
      var _obvious=rec===recPool[0]&&rec.adp&&Math.abs((MD.pickIdx+1)-rec.adp)<=3;
      if(_early||_obvious)_essence='';
      if(/last man in this|cliff is right behind/.test(r.why)){_essence='Take '+rec.name+' - last man in his tier.';_face='scrutiny';}
      var _q0=(MD.queue||[])[0];
      if(_q0){
        var _qp=MD.pool.find(function(x){return x.id===_q0;});
        if(_qp&&MD.pool.filter(function(x){return x.pos===_qp.pos;}).slice(0,2).indexOf(_qp)>=0){
          var _qt=mdThreatRead(_qp.pos);
          if(_qt.gone>=0.65){_essence=_qp.name+' won\'t survive the turn - your move.';_face='shocked';_urgent=true;}
        }
      }
    }catch(_){}
    mdMacSay(_essence,_macFull,{face:_face,urgent:_urgent,onExpand:_macShowLive});
    _macShowLive(); // no-op while collapsed (the host div is absent)
  }
  var box=document.getElementById('md-choices');
  box.innerHTML='';
  // Table mode: a position filter + loaded projections turns the card grid
  // into single-column rows so PROJ and the splits line up like Stacked's
  // table. The "All" grid keeps its cards and shows PROJ inline.
  var tbl=!!(_proj&&pf);
  box.style.gridTemplateColumns=tbl?'1fr':'repeat(auto-fill,minmax(170px,1fr))';
  // auction list stays LIGHT (owner: face, name, pos, AAV - period): the
  // full projection table belongs to snake's shopping flow, not a bid war
  var _cols=tbl?(AU.active?[{k:'aav',l:'AAV'}]:[{k:'proj',l:'Proj'}].concat(mdSplitCols(pf))):[];
  if(tbl){
    var hd=document.createElement('div');
    hd.className='md-tbl-head';
    hd.innerHTML='<span style="flex:1">Player</span>'
      +'<span class="md-ch-stats">'+_cols.map(function(c){
        var on=MD.availSort&&MD.availSort.k===c.k;
        return '<span class="md-ch-stat'+(on?' on':'')+'" onclick="mdSortCols(\''+c.k+'\')" title="Sort by projected '+c.l+'">'+c.l+(on?(MD.availSort.d<0?' &#9662;':' &#9652;'):'')+'</span>';
      }).join('')+'</span>'
      +'<span style="width:20px;flex:none"></span><span style="width:26px;flex:none"></span>';
    box.appendChild(hd);
  }
  var _lastTier=null;
  entries.forEach(function(en){
    var p=en.p,isTaken=!!en.by;
    // Tier separators, position view only: "— Tier 3 WR —" between blocks so
    // the cliffs are visible while you shop a position. When the tier is down
    // to its last man (or two), the separator says so in red - and the
    // hairlines shimmer once with the brand gradient (theme.css .md-tier-sep).
    // A column sort breaks tier order, so the separators sit that view out.
    if(pf&&!MD.availSort&&MD.tierOf&&MD.tierOf[p.id]&&MD.tierOf[p.id]!==_lastTier){
      var _tn2=MD.tierOf[p.id];
      var sep=document.createElement('div');
      sep.className='md-tier-sep';
      sep.innerHTML='<span class="sep-line"></span>Tier '+_tn2+' '+pf
        +'<span class="sep-line"></span>';
      box.appendChild(sep);
      _lastTier=_tn2;
    }
    // TAP MODEL: the card body (face, name, anywhere) opens the player card.
    // Drafting happens ONLY through the select circle on the right (and the
    // Draft button), so a stray tap can never draft anyone by accident.
    var isSel=!isTaken&&MD.selChoice===p;
    var inQ=!isTaken&&(MD.queue||[]).indexOf(p.id)>=0;
    var _pv=mdProjPts(p.id);
    var _bw=window._mdByes&&p.team?window._mdByes[p.team]:null;
    // bye conflict: 2+ of YOUR picks already sit on this week - the BYE turns
    // red before you make it three
    var _bwN=0;
    if(_bw&&!isTaken)(MD.mine||[]).forEach(function(x){if(x.team&&window._mdByes[x.team]===_bw)_bwN++;});
    var _bwHot=!isTaken&&_bw&&_bwN>=2;
    // overlay tags + market mover arrow (30-day trend, redraft dataset only,
    // extremes only - same |250| line trendLabel calls "fast")
    var _tagsHtml=isTaken?'':mdRowTagsHtml(p,!tbl);
    var _mvHtml='';
    if(tbl&&!isTaken&&window._ktcIsDyn===false){
      var _t30=(ktcFull[p.id]||{}).trend30Day||0;
      if(_t30>250)_mvHtml=' <span title="Rising fast in market" style="color:var(--green);font-weight:800">&#8593;</span>';
      else if(_t30<-250)_mvHtml=' <span title="Falling fast in market" style="color:var(--red);font-weight:800">&#8595;</span>';
    }
    var d=document.createElement('div');
    // styling lives in theme.css: the pos-XX class carries the edge colour,
    // md-ch-rec marks Mac's pick, md-ch-on the selected row, md-ch-taken a
    // drafted player shown in place
    d.className='md-ch-row pos-'+p.pos+(!isTaken&&p===rec?' md-ch-rec':'')+(isSel?' md-ch-on':'')+(isTaken?' md-ch-taken':'');
    // in table mode every row carries the stat columns; the "All" grid keeps
    // its cards and rides PROJ on the meta line instead
    var statsHtml=tbl
      ?'<span class="md-ch-stats">'+_cols.map(function(c){
          return '<span class="md-ch-stat'+(c.k==='proj'?' md-ch-proj':'')+'">'+_mdFmtStat(_mdStat(p,c.k))+'</span>';
        }).join('')+'</span>'
      :'';
    var ctrlHtml=isTaken
      ?'<span style="flex-shrink:0;width:20px"></span><span style="flex-shrink:0;width:26px"></span>'
      :'<span class="md-ch-q" title="'+(inQ?'Remove from queue':'Add to queue')+'" onclick="event.stopPropagation();mdQueueToggle(\''+p.id+'\')" style="flex-shrink:0;width:20px;height:20px;border-radius:50%;border:1px solid '+(inQ?'var(--accent-bright);color:var(--accent-bright)':'var(--border);color:var(--muted)')+';display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;cursor:pointer">'+(inQ?'&minus;':'+')+'</span>'
      // the nominate arrow only exists on YOUR nomination turn - during someone
      // else's lot there is nothing to nominate and the purple invites a
      // click that does nothing
      +((AU.active&&AU.nominator!==MD.mySlot)?''
        :('<span class="md-ch-sel" title="'+(AU.active?'Nominate ':'Draft ')+p.name.replace(/"/g,"&quot;")+'" onclick="event.stopPropagation();mdDraftNow(_mdById(\''+p.id+'\'))" style="flex-shrink:0;width:26px;height:26px;border-radius:50%;border:2px solid var(--accent-bright);background:transparent;display:inline-flex;align-items:center;justify-content:center;cursor:pointer" onmouseover="this.style.background=\'var(--accent-dim)\'" onmouseout="this.style.background=\'transparent\'">'
          +'<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--accent-bright)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>'));
    // auction rows read like a price list, not a scouting table: face, name,
    // pos, AAV - the ADP/bye/proj/tag layers are snake's shopping detail
    var _lite=AU.active&&!isTaken;
    d.innerHTML='<img src="'+mdFaceUrl(p)+'" loading="lazy" decoding="async" style="width:34px;height:34px;border-radius:50%;object-fit:cover'+(p.pos==='DEF'?';object-fit:contain;background:var(--surface3);padding:3px':'')+'" onerror="this.style.visibility=\'hidden\'">'
      +'<div style="min-width:0;flex:1"><div style="font-size:'+(AU.active?'13px':'12px')+';font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+_mvHtml+(!isTaken&&p===rec?' <span style="font-size:9px;color:var(--accent-bright)">◄ MAC</span>':'')+'</div>'
      +'<div style="font-size:'+(AU.active?'12px':'10px')+';color:var(--muted)">'+mdPosTag(p.pos)+' · '+teamLogo(p.team,12)+(p.team||'FA')
      +(isTaken?' · <span style="white-space:nowrap">R'+en.round+'.'+(en.pickNo<10?'0':'')+en.pickNo+' · '+en.by+'</span>'
        :_lite?''
        :(p.adp?' · <span title="Average draft position in real mock drafts" style="color:var(--muted2);font-weight:700;white-space:nowrap">ADP&nbsp;'+(+p.adp).toFixed(1)+'</span>':(MD.initialRanks&&MD.initialRanks[p.id]?' · <span title="Overall rank by market value" style="white-space:nowrap">#'+MD.initialRanks[p.id]+'</span>':'')))
      +(_bw&&!_lite?' · <span title="'+(_bwHot?'You already have '+_bwN+' players on this bye':'Bye week')+'" style="white-space:nowrap'+(_bwHot?';color:var(--red);font-weight:700':'')+'">BYE&nbsp;'+_bw+'</span>':'')
      +(!tbl&&_lite?' · <span title="Auction value for this room" style="color:var(--text);font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums">$'+auValue(p)+'</span>':'')
      +(!tbl&&!_lite&&_pv!=null?' · <span title="Projected season points" style="color:var(--muted2);font-weight:700;white-space:nowrap">PROJ&nbsp;'+_mdFmtStat(_pv)+'</span>':'')
      +(_lite?'':_tagsHtml)
      +'</div></div>'
      +statsHtml
      +ctrlHtml;
    d.addEventListener('click',function(){
      if(p.pos==='DEF')return; // no player card for team units
      openPlayerCard(p.id,p.name);
    });
    box.appendChild(d);
  });
  mdRenderDraftBar();
}
// The Draft screen shows ONE thing at a time: solo setup, friends rooms,
// live assist, or history. The nav dropdown and the chips both land here.
function mdShowSection(sec){
  var boardEl=document.getElementById('md-board');
  var boardOn=boardEl&&boardEl.dataset.live==='1';
  // leaving a room restores the section chips (hidden while a draft is live)
  var _secs=document.getElementById('md-sections');
  if(_secs)_secs.style.display=boardOn?'none':'flex';
  var map={
    'ld-card':sec==='live',
    'mp-card':sec==='friends',
    'md-setup':sec==='solo'&&!boardOn,
    'md-history-wrap':sec==='history',
    // the board belongs to ITS OWN draft: the solo board only on the solo tab,
    // the live room board only on the friends tab - never bleeding across
    'md-board':(sec==='solo'&&boardOn&&!MP.active)||(sec==='friends'&&MP.active)
  };
  Object.keys(map).forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.style.display=map[id]?'block':'none';
  });
  document.querySelectorAll('.md-sec-btn').forEach(function(b){
    // selected state is the .on class (theme.css); inline colours are cleared
    // in case the initial markup or an old render left any behind
    b.classList.toggle('on',b.dataset.sec===sec);
    b.style.borderColor='';b.style.color='';
  });
  if(sec==='history'){try{mdRenderHistory();}catch(_){}}
  if(sec==='friends'){var mn=document.getElementById('mp-name');if(mn&&!mn.value)mn.value=localStorage.getItem('tm_username')||'';}
  window._mdSection=sec;
  _tabPush(sec,'mock');
}
// Clock sounds: a soft low tap at every 10-second mark, an insistent brighter
// tick each second inside the final 10. Different voices so your ears know
// which phase you are in without looking.
function sndClockTick(){
  // one single tick, same voice as the final-10 sound but softer - fires once
  // at each 10-second mark
  if(!_sndOn)return;var c=_ac();if(!c)return;var t=c.currentTime;
  var o=c.createOscillator();o.type='square';o.frequency.setValueAtTime(880,t);
  var f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=1600;
  var g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.02,t+.003);g.gain.exponentialRampToValueAtTime(.0001,t+.06);
  o.connect(f);f.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.09);
}
function sndClockUrgent(){
  if(!_sndOn)return;var c=_ac();if(!c)return;var t=c.currentTime;
  var o=c.createOscillator();o.type='square';o.frequency.setValueAtTime(880,t);
  var f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=1800;
  var g=c.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.028,t+.003);g.gain.exponentialRampToValueAtTime(.0001,t+.06);
  o.connect(f);f.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.09);
}
function _clockPillHtml(left){
  var hot=left<=10;
  return ' <span style="display:inline-block;font-family:var(--font-head);font-size:17px;font-weight:800;line-height:1;padding:4px 13px;border-radius:100px;border:1.5px solid '+(hot?'#f87171':'var(--border2)')+';color:'+(hot?'#f87171':'var(--text)')+';vertical-align:-3px;margin-left:8px'+(hot?';background:rgba(248,113,113,.08)':'')+'">'+left+'s</span>';
}
// Pick clock (solo mocks): counts down in the status line; at zero Mac
// drafts his own recommendation for you, exactly like a real draft room.
function mdStartClock(){
  mdStopClock();
  // AU guard: the snake clock's timeout drafts via mdUserPick, which would
  // corrupt an auction (found via mdSetClockLive during your own nomination -
  // the auction has no pick clock, money is the clock)
  if(!MD.clockSecs||MP.active||AU.active)return;
  MD.clkLeft=MD.clockSecs;
  var paint=function(){var el=document.getElementById('md-clk');
    if(el)el.innerHTML=_clockPillHtml(MD.clkLeft);};
  paint();
  MD.clkTimer=setInterval(function(){
    MD.clkLeft--;
    try{
      if(MD.clkLeft>0&&MD.clkLeft<=10)sndClockUrgent();
      else if(MD.clkLeft>0&&MD.clkLeft<=30&&MD.clkLeft%10===0)sndClockTick();
    }catch(_){}
    if(MD.clkLeft<=0){mdStopClock();
      // Sleeper rules: your queue drafts first, then Mac's rec, then BPA.
      // Every candidate is validated against the live pool - a stale reference
      // to an already-drafted player must never be drafted again.
      var p=null;
      (MD.queue||[]).some(function(pid){var f=MD.pool.find(function(x){return x.id===pid;});if(f){p=f;return true;}return false;});
      if(!p&&MD.lastRec&&MD.pool.indexOf(MD.lastRec)>=0)p=MD.lastRec;
      if(!p)p=MD.pool.filter(function(x){return x.pos!=='K'&&x.pos!=='DEF';})[0]||MD.pool[0];
      if(p&&MD.onClock)mdUserPick(p);
      return;}
    paint();
  },1000);
}
function mdStopClock(){if(MD.clkTimer){clearInterval(MD.clkTimer);MD.clkTimer=null;}}
// Mid-draft timer change: applies immediately to the current pick too
function mdSetClockLive(v){
  MD.clockSecs=parseInt(v)||0;
  var setup=document.getElementById('md-clock');if(setup)setup.value=String(MD.clockSecs);
  if(MD.onClock&&!MP.active){if(MD.clockSecs)mdStartClock();else{mdStopClock();var el=document.getElementById('md-clk');if(el)el.innerHTML='';}}
}
// ── Player queue (Sleeper-style): plan picks ahead, autodraft from it ───────
function mdQueueToggle(pid){
  MD.queue=MD.queue||[];
  var i=MD.queue.indexOf(pid);
  if(i>=0)MD.queue.splice(i,1);else{MD.queue.push(pid);try{sndPickSoft();}catch(_){}}
  mdRenderQueue();
  mdFilterChoices();  // the +/- queue circles repaint off-clock too
}
function mdQueuePickFrom(pid){
  if(!MD.onClock)return;
  var p=MD.pool.find(function(x){return x.id===pid;});
  if(p)mdSelectChoice(p,null);
}
function mdQueueDraft(pid){
  if(!MD.onClock)return;
  var p=MD.pool.find(function(x){return x.id===pid;});
  if(!p)return;
  MD.selChoice=p;
  mdConfirmDraft(); // full pipeline: MP routing, scroll pin, sounds
}
function mdQueueMove(pid,dir){
  var i=MD.queue.indexOf(pid);
  if(i<0)return;
  var j=i+dir;
  if(j<0||j>=MD.queue.length)return;
  MD.queue[i]=MD.queue[j];MD.queue[j]=pid;
  try{sndPickSoft();}catch(_){}
  mdRenderQueue();
}
var _mdqDrag=null;
function mdQueueDragStart(ev,pid){_mdqDrag=pid;try{ev.dataTransfer.effectAllowed='move';}catch(_){}}
function mdQueueDragOver(ev,pid){
  ev.preventDefault();
  if(!_mdqDrag||_mdqDrag===pid)return;
  var from=MD.queue.indexOf(_mdqDrag),to=MD.queue.indexOf(pid);
  if(from<0||to<0)return;
  MD.queue.splice(from,1);
  MD.queue.splice(to,0,_mdqDrag);
  mdRenderQueue();
}
function mdRenderQueue(){
  var wrap=document.getElementById('md-queue-wrap'),box=document.getElementById('md-queue');
  if(!wrap||!box)return;
  // snipe detection: a queued player who vanished from the pool got TAKEN
  var before=MD.queue?MD.queue.slice():[];
  MD.queue=(MD.queue||[]).filter(function(pid){return MD.pool.some(function(x){return x.id===pid;});});
  var sniped=before.filter(function(pid){return MD.queue.indexOf(pid)<0;});
  if(sniped.length&&MD.picks&&MD.picks.length){
    var lastPk=MD.picks[MD.picks.length-1];
    var vic=sniped[sniped.length-1];
    // If YOU made the last pick, you drafted your own queued guy - that's not a snipe.
    if(!(lastPk&&lastPk.mine&&lastPk.p&&lastPk.p.id===vic)){
      var who=lastPk&&lastPk.p&&lastPk.p.id===vic&&!lastPk.mine
        ?((MD.bots&&MD.bots[lastPk.slot]&&MD.bots[lastPk.slot].name)||'Team '+lastPk.slot)
        :null;
      var vname=(MD.picks.slice().reverse().find(function(pk){return pk.p.id===vic;})||{p:{}}).p.name||'your guy';
      MD.lastSnipe=(who?who:'Someone')+' sniped '+vname+' right off your queue.';
    }
  }
  var bd=document.getElementById('md-board');
  var boardOn=bd&&bd.style.display!=='none';
  if(!MD.queue.length){
    // an empty queue earns no screen space: the + on every row is the
    // affordance, and the snipe callout is the only reason to show the bar
    if(boardOn&&MD.lastSnipe){
      wrap.style.display='flex';
      box.innerHTML='<div style="font-size:11.5px;color:var(--red);font-weight:600">'+MD.lastSnipe+'</div>';
    }else wrap.style.display='none';
    return;
  }
  wrap.style.display='flex';
  // risk read: will he still be there at YOUR next pick?
  var overallNow=MD.pickIdx+1;
  var untilMe=0;
  for(var qi=MD.pickIdx;qi<MD.order.length;qi++){if(MD.order[qi]===MD.mySlot){untilMe=qi-MD.pickIdx;break;}}
  var myNextOverall=overallNow+untilMe;
  var pcQ={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'};
  box.innerHTML=(MD.lastSnipe?'<div style="flex-basis:100%;font-size:11px;color:var(--red);font-weight:600">'+MD.lastSnipe+'</div>':'')
    +MD.queue.map(function(pid,i){
    var p=MD.pool.find(function(x){return x.id===pid;});
    var risk=p.adp&&p.adp<=myNextOverall-1;
    var ready=MD.onClock&&i===0;
    return '<div draggable="true" ondragstart="mdQueueDragStart(event,\''+pid+'\')" ondragover="mdQueueDragOver(event,\''+pid+'\')" '
      +'style="display:flex;align-items:center;gap:8px;padding:6px 9px;background:var(--surface3);border:1.5px solid '
      +(ready?'var(--green)':risk?'rgba(248,113,113,.55)':'var(--border)')+';border-radius:10px;cursor:grab'
      +(ready?';box-shadow:0 0 12px rgba(74,222,128,.25)':'')+'">'
      +'<span style="width:17px;height:17px;border-radius:50%;background:var(--accent-dim);color:var(--accent-bright);font-size:9px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex:none">'+(i+1)+'</span>'
      +'<img src="'+mdFaceUrl(p)+'" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex:none" onerror="this.style.visibility=\'hidden\'">'
      +'<span style="min-width:0"><span style="display:block;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap" onclick="mdQueuePickFrom(\''+pid+'\')">'+p.name+'</span>'
      +'<span style="font-size:9.5px;color:'+(pcQ[p.pos]||'var(--muted)')+';font-weight:700">'+p.pos+'</span>'
      +(p.adp?' <span style="font-size:9.5px;color:var(--muted);white-space:nowrap">ADP&nbsp;'+(+p.adp).toFixed(1)+'</span>':'')
      +(risk&&!ready?' <span style="font-size:9px;font-weight:800;color:#f87171">MAY NOT LAST</span>':'')
      +'</span>'
      +(MD.onClock?'<button onclick="mdQueueDraft(\''+pid+'\')" style="flex:none;background:'+(ready?'var(--green)':'var(--accent-bright)')+';border:none;color:#0d0817;font-size:10px;font-weight:800;padding:5px 12px;border-radius:100px;cursor:pointer">'+(AU.active?'Nominate':'Draft')+'</button>':'')
      +'<span style="display:flex;flex-direction:column;margin-left:2px">'
      +'<span onclick="mdQueueMove(\''+pid+'\',-1)" style="cursor:pointer;color:var(--muted);font-size:9px;line-height:1.1;padding:1px 3px">&#9650;</span>'
      +'<span onclick="mdQueueMove(\''+pid+'\',1)" style="cursor:pointer;color:var(--muted);font-size:9px;line-height:1.1;padding:1px 3px">&#9660;</span></span>'
      +'<span style="cursor:pointer;color:var(--muted);font-size:14px;line-height:1;padding:0 2px" onclick="mdQueueToggle(\''+pid+'\')">&times;</span></div>';
  }).join('');
}
function mdUserPick(p){
  // turn guard: a second fast click (two draft circles, or the same one
  // twice) lands after the turn advanced - without this it booked an extra
  // pick under YOUR slot at the BOT's pick index
  if(!MD.onClock)return;
  mdStopClock();
  // hard guard: if this exact player object is no longer in the pool (already
  // drafted, stale reference), swap to best available instead of duplicating
  if(MD.pool.indexOf(p)<0||MD.mine.some(function(x){return x.id===p.id;})){
    p=MD.pool.filter(function(x){return x.pos!=='K'&&x.pos!=='DEF';})[0]||MD.pool[0];
    if(!p)return;
  }
  var i=MD.pool.indexOf(p);
  if(i>=0)MD.pool.splice(i,1);
  // You drafted him yourself - pull him from your queue quietly so the snipe
  // detector never flags your own pick as "sniped".
  var _qi=MD.queue?MD.queue.indexOf(p.id):-1;if(_qi>=0)MD.queue.splice(_qi,1);
  MD.mine.push(p);
  MD.onClock=false;
  var round=Math.floor(MD.pickIdx/MD.teams)+1;
  var pickNo=(MD.pickIdx%MD.teams)+1;
  // if this player sat in one of Mac's risk lanes for THIS pick, record which
  // lane the drafter chose - the tendency analysis reads it from history later
  var _lane=null;
  try{
    if(MD.sageLanes&&MD.sageLanes.pick===MD.pickIdx){
      _lane=MD.sageLanes.map[(p.name||'').toLowerCase().replace(/[^a-z ]/g,'').trim()]||null;
    }
  }catch(_){}
  MD.picks.push({slot:MD.mySlot,round:round,pickNo:pickNo,p:p,mine:true,lane:_lane});
  MD.myOveralls.push({p:p,overall:MD.pickIdx+1});
  try{sndImpact();}catch(_){}
  // Mac's take on EVERY pick. Rule one: never call his own recommendation a
  // reach - if he told you to take him, agreeing with Mac is always a good pick.
  try{
    var rk=MD.initialRanks&&MD.initialRanks[p.id];
    var overall=MD.pickIdx+1;
    var diff=rk?overall-rk:0;
    var have={QB:0,RB:0,WR:0,TE:0};MD.mine.forEach(function(x){have[x.pos]++;});
    have[p.pos]--; // count BEFORE this pick
    var note=getPlayerContextNote(p.name);
    var noteBit=note?' '+note.note.split(';')[0].trim()+'.':'';
    // steal/reach needs at least HALF A ROUND of daylight to mean anything -
    // a 3-spot delta is noise. And K/DEF never get value-judged: their board
    // ranks are synthetic, so every kicker read as a giant reach.
    var thr=Math.max(4,Math.round(MD.teams/2));
    var take;
    if(p.pos==='K'||p.pos==='DEF'){
      take='Locked in your '+(p.pos==='DEF'?'defense':'kicker')+'. One less thing to think about on Sunday.';
    }else if(MD.lastRec&&MD.lastRec.id===p.id){
      take='Exactly what I wanted. '+(MD.lastRecWhy||'')+(diff>=thr?' And the board even says you got him at a discount.':'');
    }else if(rk&&diff>=thr*2){
      take='Steal. The board had '+p.name+' at #'+rk+' and you got him at pick '+overall+'.'
        +(have[p.pos]===0?' First '+p.pos+' on your roster, so he walks into your lineup.':'')
        +(MD.lastRec?' I liked '+MD.lastRec.name+' here, but value this good overrides my plan.':'');
    }else if(rk&&diff<=-thr){
      take=MD.lastRec?('A reach - #'+rk+' taken at pick '+overall+'. I wanted '+MD.lastRec.name+' here: '+(MD.lastRecWhy||'better value for the same spot.')+' '+p.name+' likely comes back a round later.')
        :('A reach - #'+rk+' on the board at pick '+overall+'. He probably comes back to you next round.');
    }else{
      take='Fair value at pick '+overall+'.'
        +(have[p.pos]===0?' Fills your first '+p.pos+' spot - roster shape matters as much as the number.':have[p.pos]>=2?' That is '+p.pos+' number '+(have[p.pos]+1)+' though - depth there was not your problem.':'')
        +(MD.lastRec&&MD.lastRec.id!==p.id?' I leaned '+MD.lastRec.name+', but this is defensible.':'');
    }
    take+=noteBit;
    var sg=document.getElementById('md-sage');
    if(sg){
      // Mac's reaction rides his discreet face: one-sentence essence when
      // collapsed (steals cheer, reaches wince), the full take on tap
      var _rFace=/^Steal|^Exactly what I wanted/.test(take)?'excited':/^A reach/.test(take)?'skeptical':'thinking';
      var _rEss=(take.split('. ')[0]||'').slice(0,120);if(_rEss&&!/[.!]$/.test(_rEss))_rEss+='.';
      mdMacSay(_rEss,'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Mac on your pick</div><div style="font-size:12.5px;color:var(--muted2);line-height:1.55">'+take+'</div>',{face:_rFace});
    }
  }catch(_){}
  // Advance first, then render - same rule as the bot path: the board's
  // ON THE CLOCK box reads MD.order[MD.pickIdx] and must see the NEXT picker.
  MD.pickIdx++;
  mdRenderBoard();
  MD.log.unshift('<span style="color:var(--muted)">R'+round+'</span> <strong style="color:var(--accent-bright);cursor:pointer" onclick="openPlayerCard(\''+p.id+'\',\''+p.name.replace(/'/g,"\\'")+'\')">YOU - '+p.name+'</strong> '+mdPosTag(p.pos));
  // sage box stays put and the grid stays filled - the page must not jump
  // around between picks
  mdRenderMine();mdRenderLog();
  mdAdvance();
}
function _mdById(pid){return MD.pool.find(function(x){return x.id===pid;})||null;}
// One canonical spelling for player-name matching: lowercase, punctuation
// stripped, spaces collapsed - "Ja'Marr Chase" and "jamarr chase" both land on
// "jamarr chase". Used by the context rules and their engine lookups.
function _mdNormName(s){return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();}
function mdSelectChoice(p,el){
  if(!p)return;
  if(MP.active&&!MD.onClock)return; // live room, not your turn: look, don't touch
  // first click selects, the Draft button (or clicking the same card again) confirms
  if(MD.selChoice===p){mdConfirmDraft();return;}
  try{sndPickSoft();}catch(_){}
  MD.selChoice=p;
  mdShowChoices(MD.curRound||1);
}
// One-tap draft straight from the pick circle - no select-then-confirm dance.
// The circle is a deliberate target (the row body opens the player card), so a
// single tap drafting is fast without being accidental.
function mdDraftNow(p){
  if(!p)return;
  if(MP.active&&!MD.onClock)return;
  MD.selChoice=p;
  mdConfirmDraft();
}

// Restart the same draft or go back to settings - visible from the header
function mdRestartDraft(){
  if(!confirm('Restart this draft from pick 1?'))return;
  mdStopClock();
  var b=document.getElementById('md-board');
  if(b){b.style.display='none';b.dataset.live='0';}
  var s=document.getElementById('md-setup');if(s)s.style.display='block';
  startMockDraft();
}
function mdBackToSetup(){
  mdStopClock();
  // an auction keeps its own timer chain alive - kill it or the room keeps
  // selling players on the hidden board; the 3-zone layout returns its
  // borrowed nodes to the snake board on the way out
  if(AU.stepT)clearTimeout(AU.stepT);
  if(AU.pillT){clearInterval(AU.pillT);AU.pillT=null;}
  AU.active=false;AU.lot=null;
  try{_auLayoutOff();var _avB=document.getElementById('md-available');if(_avB)_avB.style.display='';}catch(_){}
  var b=document.getElementById('md-board');
  if(b){b.style.display='none';b.dataset.live='0';}
  var s=document.getElementById('md-setup');if(s)s.style.display='block';
  var pk=document.getElementById('md-player-peek');if(pk)pk.style.display='none';
  var sg=document.getElementById('md-sage');if(sg)sg.style.display='none';
  try{mdShowSection('solo');}catch(_){}
}
// ── Mac, discreet: his face IS the toggle ───────────────────────────────────
// Collapsed by default: a small face + at most ONE short line when he has
// something to say. Tapping the face expands the full read; tapping again
// collapses. No extra buttons, no setting - the gesture persists on the
// device (tm_mac_collapsed). He never auto-expands; the single exception is
// a subtle one-time pulse + dot when a genuine kill-call lands while he is
// collapsed (your queued target about to disappear). Reads are COMPUTED the
// same either way - expanding just reveals them.
function _macCollapsed(){try{return localStorage.getItem('tm_mac_collapsed')!=='0';}catch(_){return true;}}
function mdMacToggle(){
  try{localStorage.setItem('tm_mac_collapsed',_macCollapsed()?'0':'1');}catch(_){}
  _macPaint(false);
}
function _macPaint(pulse){
  var sg=document.getElementById('md-sage');if(!sg)return;
  var st=MD._mac;
  if(!st){sg.style.display='none';return;}
  sg.style.display='block';
  var face='/sage/sage-'+(st.face||'thinking')+'-64.png';
  if(_macCollapsed()){
    sg.innerHTML='<div class="mac-mini"><span class="mac-wrap"><img class="mac-face'+(pulse?' pulse':'')+'" src="'+face+'" alt="Mac" title="Mac\'s read - tap to expand" onclick="mdMacToggle()" onerror="this.style.visibility=\'hidden\'">'
      +(st.urgent?'<span class="mac-dot"></span>':'')+'</span>'
      +(st.essence?'<span class="mac-line">'+st.essence+'</span>':'')
      +'</div>';
  }else{
    sg.innerHTML='<div style="display:flex;gap:10px;align-items:flex-start">'
      +'<span class="mac-wrap" style="flex:none"><img class="mac-face" src="'+face+'" alt="Mac" title="Mac\'s read - tap to collapse" onclick="mdMacToggle()" onerror="this.style.visibility=\'hidden\'"></span>'
      +'<div style="min-width:0;flex:1">'+(st.full||'')+'</div></div>';
    if(st.onExpand)try{st.onExpand();}catch(_){}
  }
}
function mdMacSay(essence,full,opts){
  // OWNER'S RULE: Mac does not speak inside a live room. He is one tap away in
  // any player card (mdDraftRead) - never a voice over your shoulder mid-pick.
  try{
    var _b=document.getElementById('md-sage');
    if(_b){_b.style.display='none';_b.innerHTML='';}
  }catch(_){}
  if(true)return;
  /* legacy body kept for the trade screens that call the same helper */
  opts=opts||{};
  MD._mac={essence:essence||'',full:full||'',urgent:!!opts.urgent,face:opts.face||'thinking',onExpand:opts.onExpand||null};
  _macPaint(!!opts.urgent&&_macCollapsed());
}
// ── Adaptive room + self reads (display layer ONLY - the bots' real picking
// lives in mdAdvance and none of this feeds back into it) ───────────────────
// A run is live when 3+ of one position went inside the last five picks.
function mdRunRead(){
  var c={};
  (MD.picks||[]).slice(-5).forEach(function(pk){
    var ps=pk&&pk.p&&pk.p.pos;if(!ps||ps==='K'||ps==='DEF')return;
    c[ps]=(c[ps]||0)+1;
  });
  var best=null;
  Object.keys(c).forEach(function(ps){if(c[ps]>=3&&(!best||c[ps]>c[best]))best=ps;});
  return best?{pos:best,count:c[best]}:null;
}
// Archetype-aware survival read for a position across the seats that pick
// between now and your next turn. Heuristic (declared, advice-only): a seat
// that NEEDS the position (open starter shape) and whose archetype LEANS
// toward it takes the top of that position ~70% of the time - the lean's
// +340..380dv mid-round nudge is ~9 picks, enough to clear any within-turn
// value gap, minus ~30% for jitter and rescues; need without lean ~35% (the
// seat splits across the 2-3 positions it still needs); a seat leaning AWAY
// (negative posAdj) halves its need chance; no need at all ~5%. P(the top
// player at the position survives) = product of (1 - p_seat).
function mdThreatRead(pos){
  var out={gone:0,threats:[]};
  if(!MD.order||MD.pickIdx>=MD.order.length)return out;
  var survive=1,found=false;
  // on your clock order[pickIdx] IS you - the read covers the seats after
  var qi0=MD.pickIdx+(MD.order[MD.pickIdx]===MD.mySlot?1:0);
  for(var qi=qi0;qi<MD.order.length;qi++){
    var slot=MD.order[qi];
    if(slot===MD.mySlot){found=true;break;}
    var bot=MD.bots&&MD.bots[slot];if(!bot)continue;
    var ros=MD.aiRosters[slot]||{};
    var need=pos==='QB'?(ros.QB||0)<(MD.sf?2:1)
      :pos==='TE'?(ros.TE||0)<1
      :(ros[pos]||0)<2;
    var lean=((bot.posAdj&&bot.posAdj[pos])||0)>0||((bot.eliteAdj&&bot.eliteAdj[pos])||0)>0
      ||(bot.hero&&pos==='RB'&&!(ros.RB>0));
    var fade=((bot.posAdj&&bot.posAdj[pos])||0)<0;
    var p=need&&lean?0.7:need?(fade?0.17:0.35):(lean?0.2:0.05);
    survive*=(1-p);
    if(p>=0.35)out.threats.push({name:bot.name,profiled:!!bot.profiled});
  }
  if(!found)return {gone:0,threats:[]}; // no next pick (draft ending): no read
  out.gone=1-survive;
  return out;
}
// Your drafting DNA from the saved mocks. Guards: 3+ finished drafts AND 3+
// picks at a position before any coaching - short history stays silent.
function mdMyTendencies(){
  try{
    var hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');
    if(hist.length<3)return null;
    var agg={};
    hist.forEach(function(h){
      (h.picksAll||[]).forEach(function(pk){
        if(!pk.me||pk.adp==null||pk.delta==null)return;
        (agg[pk.pos]=agg[pk.pos]||[]).push(pk.delta); // delta = pick# - ADP; negative = early
      });
    });
    var out={drafts:hist.length,pos:{}};
    Object.keys(agg).forEach(function(ps){
      if(agg[ps].length<3)return;
      var m=agg[ps].reduce(function(a,b){return a+b;},0)/agg[ps].length;
      out.pos[ps]={mean:m,n:agg[ps].length};
    });
    return out;
  }catch(_){return null;}
}
function mdRenderDraftBar(){
  var bar=document.getElementById('md-draftbar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='md-draftbar';
    // BELOW the grid and sticky, so selecting a player never shifts the rows
    // above it - the card you tapped stays under your finger for the double tap.
    // bottom reads a variable so the phone pass (home.css PART 6) can lift the
    // bar clear of the fixed tab bar without fighting this inline style
    bar.style.cssText='display:none;align-items:center;gap:10px;padding:10px 14px;background:var(--surface3);border:1px solid var(--accent-bright);border-radius:12px;margin:10px 0;position:sticky;bottom:var(--md-bar-b,10px);z-index:5;box-shadow:0 6px 24px rgba(5,4,12,.45)';
    var ch=document.getElementById('md-choices');
    if(ch&&ch.parentElement)ch.parentElement.insertBefore(bar,ch.nextSibling);
  }
  if(!MD.selChoice||!MD.onClock){bar.style.display='none';return;}
  var p=MD.selChoice;
  var _nmE=p.name.replace(/'/g,"\\'");
  // AUCTION: the bar is a nomination CONFIRM, nothing more - face, name, the
  // price facts, one giant "Nominate for $1". The snake bar's ADP-availability
  // and narrative layers talk about pick order, which means nothing here.
  if(AU.active){
    var _w2=null;try{_w2=auMyWorth(p).worth;}catch(_){}
    bar.style.display='block';
    bar.innerHTML='<div style="display:flex;align-items:center;gap:12px">'
      +'<img src="'+mdFaceUrl(p)+'" style="width:44px;height:44px;border-radius:50%;object-fit:cover'+(p.pos==='DEF'?';object-fit:contain':'')+'" onerror="this.style.visibility=\'hidden\'">'
      +'<div style="flex:1;min-width:0"><div style="font-size:16px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+'</div>'
      +'<div style="font-size:13.5px;color:var(--muted2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.pos+' · '+(p.team||'FA')+' · AAV $'+auValue(p)+(_w2!=null?' · worth up to $'+_w2+' for you':'')+'</div></div>'
      +'<button class="btn-sm" onclick="MD.selChoice=null;mdShowChoices(MD.curRound||1)">Cancel</button>'
      +'<button class="btn-load" style="width:auto;padding:14px 24px;font-size:15px;font-weight:800" onclick="mdConfirmDraft()">Nominate for $1</button>'
      +'</div>';
    return;
  }
  // ONE quiet meta line under the name: ADP, tier word, direction, VORP word.
  // Everything deeper (full stats, news, trades) lives one click away on the
  // player card - the bar must read at a glance, not compete with the board.
  // The mock board is ADP - a seasonal object - so its tier ALWAYS comes from
  // the redraft value, and a dynasty-dataset trend never leaks onto it (the
  // audit case: dynasty league loaded, mock showing dynasty tiers over a
  // redraft board).
  var _fc=ktcFull[p.id]||{};
  var _tierVal=_fc.redraftValue>0?_fc.redraftValue:(window._ktcIsDyn===false?(ktcById[p.id]||0):0);
  var _tier=_tierVal?playerTierLabel(_tierVal,p.id).short:'';
  var _trendOk=(window._ktcIsDyn===false);
  var _tl2=trendLabel(_fc.trend30Day||0);
  var _twc=_tl2.dir>0?'var(--green)':_tl2.dir<0?'var(--red)':'var(--muted)';
  var _meta=[p.pos+' · '+(p.team||'FA')];
  if(p.adp)_meta.push('ADP '+(+p.adp).toFixed(1));
  var _bw=window._mdByes&&p.team?window._mdByes[p.team]:null;
  // bye conflict carries into the bar: red once 2+ of your picks share the week
  var _bwN=0;
  if(_bw)(MD.mine||[]).forEach(function(x){if(x.team&&window._mdByes[x.team]===_bw)_bwN++;});
  if(_bw)_meta.push(_bwN>=2
    ?'<span title="You already have '+_bwN+' players on this bye" style="color:var(--red);font-weight:700">BYE '+_bw+'</span>'
    :'BYE '+_bw);
  var _pj=mdProjPts(p.id);
  if(_pj!=null)_meta.push(_mdFmtStat(_pj)+' proj pts');
  if(_tier)_meta.push(_tier);
  if(_trendOk&&(_tier||p.adp))_meta.push('<span style="color:'+_twc+'">'+_tl2.word.toLowerCase()+'</span>');
  // VORP in words, from PROJECTED POINTS vs the replacement starter when the
  // projection feed is up. Thresholds are the p10/p25/p50 of the positive
  // gaps across the whole 2026 drafted pool (86/62/33 pts, derived 7/2026,
  // rounded): "massive" is a top-decile edge, "big" top-quartile, "moderate"
  // above the median. The old dv thresholds stay only as a fallback - a dv
  // gap buys ~9 points of value in round 1 but ~3 in round 10, so it could
  // never mean one thing.
  var _rgap=null;
  if(MD.replId&&MD.replId[p.pos]){
    var _rpj=mdProjPts(MD.replId[p.pos]),_ppj2=mdProjPts(p.id);
    if(_rpj!=null&&_ppj2!=null)_rgap=_ppj2-_rpj;
  }
  if(_rgap!=null){
    _meta.push(_rgap>=85?'massive edge vs replacement'
      :_rgap>=60?'big edge vs replacement'
      :_rgap>=30?'moderate edge vs replacement'
      :_rgap>=0?'thin edge vs replacement'
      :'below replacement level');
  }else{
    var _rpl=MD.replDv&&MD.replDv[p.pos];
    if(_rpl!=null&&p.dv){
      var _gap=p.dv-_rpl;
      _meta.push(_gap>=2400?'massive edge vs replacement'
        :_gap>=1200?'big edge vs replacement'
        :_gap>=400?'moderate edge vs replacement'
        :_gap>=0?'thin edge vs replacement'
        :'below replacement level');
    }
  }
  // Stacked's availability read, in words: where the market drafts him vs
  // where your next turn comes up. The coin-flip zone is the player's REAL
  // ADP spread, not a flat 6: live drafts run ±1.4 picks in round 1 and ±16+
  // by round 11 (FFC, 3,899 drafts, 7/2026 fit: stdev ≈ 2.3 + 0.095*adp).
  var _av='';
  if(p.adp){
    var _po=Math.round(+p.adp),_pr2=Math.max(1,Math.ceil(_po/MD.teams));
    _av='Projected pick: Round '+_pr2+', overall #'+_po;
    var _nx=0;
    for(var _qi=MD.pickIdx+1;_qi<MD.order.length;_qi++){if(MD.order[_qi]===MD.mySlot){_nx=_qi+1;break;}}
    if(_nx){
      var _dev=Math.round(2.3+0.095*_po);
      if(_po>=_nx)_av+=' · likely still there at your next pick (#'+_nx+')';
      else if(_po+_dev>=_nx)_av+=' · could make it back to your next pick (#'+_nx+') - coin flip';
      else _av+=' · won\'t make it back to you';
    }
  }
  // ROOM READ (advice layer): ADP says who the MARKET takes; the seats
  // between you and your next pick say who THIS ROOM takes. Speaks only when
  // it changes the decision - a live run at his position, an archetype read
  // that flips an optimistic ADP call (top-2 at the position only: the
  // threats eat the top first), or your own repeated habit. Names are cited
  // only for seats whose name the user (or their league) actually set.
  var _room=[];
  try{
    var _run=mdRunRead();
    if(_run&&_run.pos===p.pos)_room.push('<span style="color:var(--yellow);font-weight:700">'+_run.count+' of the last 5 picks were '+_run.pos+'s - the run is on.</span>');
    var _top2=MD.pool.filter(function(x){return x.pos===p.pos;}).slice(0,2).indexOf(p)>=0;
    if(_top2&&p.adp&&_av.indexOf('won\'t make it back')<0){
      var _t=mdThreatRead(p.pos);
      if(_t.gone>=0.65){
        var _nm2=_t.threats.filter(function(x){return x.profiled;}).slice(0,2).map(function(x){return x.name;});
        _room.push(_nm2.length>=2
          ?_nm2.join(' and ')+' both still need a '+p.pos+' and lean that way - he won\'t survive the turn.'
          :_nm2.length===1
          ?_nm2[0]+' still needs a '+p.pos+' and leans that way - do not count on him coming back.'
          :_t.threats.length+' seats before your next pick still need a '+p.pos+' - the ADP read is optimistic here.');
      }
    }
    // your own history, once per draft, only when the habit is repeating NOW:
    // you average 6+ picks early at this position and this pick would again
    // be 4+ picks ahead of his market slot
    if(!MD._histSaid&&p.adp){
      var _td=mdMyTendencies();
      var _tp=_td&&_td.pos[p.pos];
      if(_tp&&_tp.mean<=-6&&(+p.adp-(MD.pickIdx+1))>=4){
        _room.push('In your last '+_td.drafts+' mocks you took '+p.pos+'s '+Math.round(-_tp.mean)+' picks early on average - the board says he lasts this time.');
        MD._histSaid=1;
      }
    }
  }catch(_){}
  // Riser history: when the selected player is a riser, say what players who
  // made the same jump actually returned - his real bucket, real numbers,
  // seasons and sample size on the record. No bucket cleared n=15, no line.
  var _rh='';
  var _ri=mdRiserInfo(p);
  if(_ri){
    var _rb2=mdRiserBucket(p);
    if(_rb2){
      var _rd=window._mdRisers;
      _rh='<span style="color:var(--yellow);font-weight:700">RISER +'+_ri.rise+'</span> · History for '+_rb2.label
        +': <span style="color:var(--green)">'+_rb2.boom+'% boom</span> · '+_rb2.hit+'% hit · <span style="color:var(--red)">'+_rb2.bust+'% bust</span>'
        +' ('+_rd.seasons+', n='+_rb2.n+')';
    }
  }
  // curated draft narratives: max two, quiet frame - the label is the only
  // accent so the block informs without shouting
  var _nar=mdNarratives(p).slice(0,2);
  var _narHtml=_nar.length
    ?'<div style="margin-top:9px;padding:8px 11px;background:var(--surface2);border-left:2px solid var(--border2);border-radius:8px">'
      +'<div style="font-size:9.5px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Keep in mind</div>'
      +_nar.map(function(n){return '<div style="font-size:11.5px;color:var(--muted2);line-height:1.55;margin-top:3px">'+n+'</div>';}).join('')
      +'</div>'
    :'';
  bar.style.display='block';
  bar.innerHTML='<div style="display:flex;align-items:center;gap:10px">'
    +'<img src="'+mdFaceUrl(p)+'" style="width:34px;height:34px;border-radius:50%;object-fit:cover;cursor:pointer;flex:none'+(p.pos==='DEF'?';object-fit:contain':'')+'" title="View player card" onclick="openPlayerCard(\''+p.id+'\',\''+_nmE+'\')" onerror="this.style.display=\'none\'">'
    +'<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="cursor:pointer" onclick="openPlayerCard(\''+p.id+'\',\''+_nmE+'\')">'+p.name+'</span>'+mdRowTagsHtml(p)+'</div>'
    +'<div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+_meta.join(' · ')+'</div></div>'
    +'<button class="btn-sm md-sage-ask" onclick="mdAskSageLive(\''+p.id+'\')" title="Mac weighs this exact pick against your roster">Ask Mac</button>'
    +'<button class="btn-sm" onclick="MD.selChoice=null;mdShowChoices(MD.curRound||1)">Cancel</button>'
    +'<button class="btn-load" style="width:auto;padding:9px 22px" onclick="mdConfirmDraft()">'+(AU.active?'Nominate ':'Draft ')+p.name.split(' ').slice(-1)[0]+'</button></div>'
    +(_av?'<div style="margin-top:7px;font-size:11px;color:var(--muted2)">'+_av+'</div>':'')
    +(_room.length?'<div style="margin-top:7px;font-size:11px;color:var(--muted2)"><span style="font-size:9.5px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-right:6px">Room read</span>'+_room.join(' ')+'</div>':'')
    +(_rh?'<div style="margin-top:7px;font-size:11px;color:var(--muted2)">'+_rh+'</div>':'')
    +_narHtml
    +mdProsConsHtml(p,2) // the two strongest each way; the card has the rest
    +'<div style="margin-top:7px;font-size:11px"><span style="color:var(--accent-bright);cursor:pointer;font-weight:600" onclick="openPlayerCard(\''+p.id+'\',\''+_nmE+'\')">Full player card &rarr;</span></div>';
}

// ── AUCTION DRAFT ────────────────────────────────────────────────────────────
// Solo auction room on the same dark board. Values come from ESPN's real
// auction drafts (/api/stats/aav: auctionValueAverage, PPR $200); other
// scorings evaluate the server's refit curve ln(aav)=a+b*adp at the FORMAT's
// own ADP (8/2026 fit R^2 0.984, refit every cache rebuild). Every room then
// NORMALIZES values to its own money: 12x$200 ESPN raw values sum to ~$1,892
// of $2,400, and an 8-team $300 room prices nothing like that - so the
// discretionary dollars (value above the $1 floor) are rescaled so the pool's
// top (teams x rounds) players absorb exactly the room's spendable money.
// That normalization plus live inflation is the whole economics of the room.
var AU={active:false};
// ── auction pacing (render/timer layer ONLY - the decision beat _auBidOnce
// never reads these, so the harness and the Sim paths are untouched by them).
// Market heuristic: HUMAN LEGIBILITY - the owner lost count at ~0.7s beats;
// a raise landing every 1.4-2.2s reads like a real room calling numbers, and
// the entry window (silence -> GOING ONCE -> GOING TWICE -> SOLD) tells you
// exactly how long you have. The fast path for the impatient is Sim.
var AU_PACE={
  BID_MIN:1400,BID_MAX:2200, // bot-vs-bot: a raise lands every 1.4-2.2s (randomized: human cadence)
  GOING_2:2000,              // GOING ONCE -> GOING TWICE
  HAMMER:1500,               // GOING TWICE -> SOLD
  NEXT_LOT:1600              // SOLD -> next nomination (the splash gets its moment)
};
function _auBeatMs(){return AU_PACE.BID_MIN+Math.random()*(AU_PACE.BID_MAX-AU_PACE.BID_MIN);}
// harness/QA hook: the calibration runs preset window._AU_FAST and every wait
// collapses to a tick - pacing must never slow (or alter) a simulation
function _auDelay(ms){return window._AU_FAST?1:ms;}
async function mdLoadAav(){
  if(window._mdAav!==undefined)return;
  window._mdAav=null;
  try{
    var r=await fetch('/api/stats/aav');
    if(!r.ok)return;
    var d=await r.json();
    if(d&&d.players&&Object.keys(d.players).length>=80)window._mdAav=d;
  }catch(_){}
}
// Static fallback fit (the 8/2026 derivation) so the room still prices when
// the feed is down - the UI then says the values are derived, not live.
var AU_FIT_FALLBACK={a:4.133,b:-0.0294};
// Name lookups that survive "III" / "Jr.": the feeds disagree about suffixes
// (ESPN writes "James Cook III", Sleeper writes "James Cook"), and stripping
// only OUR side silently missed real players. Build the suffix-free index of
// a map once, then look up both spellings. Used by every name-keyed feed.
function _mdSuffixIndex(map){
  if(!map)return null;
  if(map.__sfx)return map.__sfx;
  var idx={},ks=Object.keys(map);
  for(var i=0;i<ks.length;i++){
    var b=ks[i].replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
    if(b!==ks[i]&&!map[b]&&!idx[b])idx[b]=map[ks[i]];
  }
  try{Object.defineProperty(map,'__sfx',{value:idx,enumerable:false});}catch(_){map.__sfx=idx;}
  return idx;
}
function _mdByName(map,name){
  if(!map)return null;
  var k=_mdNormName(name), b=k.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
  var sfx=_mdSuffixIndex(map);
  return map[k]||map[b]||(sfx&&(sfx[k]||sfx[b]))||null;
}
function _auRawValue(p){
  var d=window._mdAav;
  var fit=(d&&d.fit)||AU_FIT_FALLBACK;
  if(d){
    var k=_mdNormName(p.name);
    // Suffix insurance, BOTH directions. Stripping only our side missed the
    // common case: ESPN writes "James Cook III" while Sleeper writes "James
    // Cook", so four top-60 players were silently falling back to the curve
    // instead of using their real market price. Build a suffix-free index of
    // the price map once and look the player up there too.
    if(!d._sfx){
      d._sfx={};
      var _sk=Object.keys(d.players);
      for(var _i=0;_i<_sk.length;_i++){
        var _b=_sk[_i].replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
        if(_b!==_sk[_i]&&!d.players[_b]&&!d._sfx[_b])d._sfx[_b]=d.players[_sk[_i]];
      }
    }
    var _kb=k.replace(/\s+(jr|sr|ii|iii|iv|v)$/,'');
    var e=d.players[k]||d.players[_kb]||d._sfx[k]||d._sfx[_kb];
    // live ESPN price when we have it and the room is PPR (ESPN's scoring);
    // other scorings re-derive from the format's own ADP via the curve
    if(e&&e.pos===p.pos&&MD.scoring>=1)return e.aav;
  }
  if(p.adp)return Math.exp(fit.a+fit.b*p.adp);
  if(p.pos==='K'||p.pos==='DEF')return 1; // priced by the room's $1 floor
  return 0.5;
}
// Normalize the pool to THIS room's money and remember each player's price.
function auPoolInit(){
  var total=MD.teams*MD.budget;
  var slots=MD.teams*MD.rounds;
  var vals=MD.pool.map(function(p){return {p:p,raw:_auRawValue(p)};})
    .sort(function(a,b){return b.raw-a.raw;});
  var draftable=vals.slice(0,slots);
  // TEXTBOOK AUCTION VALUE: money buys value ABOVE REPLACEMENT, not raw value.
  // Spreading it over raw-minus-$1 made a bigger room inflate the elites (a
  // 12-team $200 room priced Puka 19% over a 10-team $200 room, even though
  // money-per-roster is identical) - because the 30 extra draftable players
  // it added were cheap and barely moved the denominator. Anchoring on the
  // LAST draftable player (the marginal guy anyone could have instead) makes
  // the denominator grow with the room, which is what keeps prices honest.
  var repl=draftable.length?draftable[draftable.length-1].raw:0;
  // CONCAVITY: a straight pro-rata split hands the surplus to the very top,
  // because two thirds of the draftable pool sits pinned at the $1 floor and
  // cannot absorb a cent. That priced the #1 player at 36% of a manager's
  // whole budget (real auctions land at 30-32%) and made $80 sales normal.
  // Spreading on a compressed curve (exponent < 1) keeps every dollar in the
  // room - money is still conserved - but moves it off the elites and into
  // the middle rounds, which is where a real room's money actually goes.
  var VAL_CURVE=0.86;
  var discSum=0;
  draftable.forEach(function(v){discSum+=Math.pow(Math.max(0,v.raw-repl),VAL_CURVE);});
  var k=discSum>0?(total-slots)/discSum:0;
  // Money is conserved: every dollar in the room gets spent, so a deeper room
  // genuinely prices its elites higher (same $200 chasing thinner talent).
  // Normalising that away left $400 with nowhere to go and the endgame dumped
  // it in $167 blowouts - conservation stays.
  AU.val={};
  vals.forEach(function(v,i){
    AU.val[v.p.id]=i<slots?Math.max(1,Math.round(1+Math.pow(Math.max(0,v.raw-repl),VAL_CURVE)*k)):1;
  });
}
function auValue(p){return (AU.val&&AU.val[p.id])||1;}
// Live inflation: money still in the room vs value still on the board - the
// central dynamic of every real auction (early overpays deflate the rest).
function auInflation(){
  var slotsLeft=0,money=0;
  for(var s=1;s<=MD.teams;s++){
    slotsLeft+=AU.slotsLeft[s];
    money+=Math.max(0,AU.budgets[s]-AU.slotsLeft[s]); // spendable above $1 floors
  }
  var vals=MD.pool.map(function(p){return auValue(p);}).sort(function(a,b){return b-a;}).slice(0,slotsLeft);
  var value=0;vals.forEach(function(v){value+=Math.max(0,v-1);});
  if(value<=0)return 1;
  // wide clamp on purpose: pool values are normalized to sum to the room's
  // exact money, so full spend only happens if under-payments (second-price
  // sales below sticker) feed back into HIGHER later prices. A tight 1.4 cap
  // strangled that feedback and rooms banked hundreds (harness invariant b).
  return Math.max(0.7,Math.min(2.2,money/value));
}
// roster progress vs the room's: >0 means this seat is buying ahead of pace.
// Debug of invariant (b) showed the failure mode exactly: an eager proxy
// seat owned 16 players by lot 20 and banked $168 - real managers ride the
// room's rhythm, so buyers running ahead of proportional share cool off.
function auPace(slot){
  var total=MD.teams*MD.rounds,done=total;
  for(var s=1;s<=MD.teams;s++)done-=AU.slotsLeft[s];
  return (MD.rounds-AU.slotsLeft[slot])/MD.rounds-done/total;
}
// how much a bot wants this position right now (0..1 scale on value)
function auNeed(ros,pos,slotsLeft){
  var caps={QB:MD.sf?3:2,TE:2,K:1,DEF:1,RB:8,WR:8};
  if((ros[pos]||0)>=(caps[pos]||8))return 0;
  if(pos==='K'||pos==='DEF')return slotsLeft<=3?1:0.05; // real rooms: $1 at the end
  var starters={QB:MD.sf?2:1,RB:2,WR:MD.scoring>=1?3:2,TE:1};
  if((ros[pos]||0)<(starters[pos]||1))return 1;
  // a fillable bench slot pays FULL sticker: the AAV feed already prices
  // bench-tier players at what real managers pay for them, so a blanket
  // haircut here made every mid-lot clear at ~80% of sticker and the room
  // banked the difference (harness invariant b traced the leak to exactly
  // this phase). Only true backups at onesie positions get discounted.
  return (pos==='RB'||pos==='WR')?1:(MD.sf&&pos==='QB'?0.9:0.3);
}
// a bot's true ceiling for the player on the block
function auBotMax(slot,p){
  var ros=MD.aiRosters[slot]||{};
  var sl=AU.slotsLeft[slot];
  if(sl<=0)return 0;
  var need=auNeed(ros,p.pos,sl);
  if(need<=0)return 0;
  var v;
  // FZ26 RB MARKET PREMIUM (owner-observed: "en la liga de Fantazy la gente
  // paga más por RBs - un Bijan se va 15% arriba"; calibrated on his real
  // number: Bijan $63 AAV sells $74-75 in his room = ~1.18x; the 2025 draft
  // evidence agrees, 3 of 9 managers robust-RB). Bots' WILLINGNESS only -
  // the AAV shown to the user stays the data, the user's own max/grades
  // never wear the premium, and live inflation redistributes the rest of
  // the money by itself (RBs sucking dollars makes WRs cheaper, no manual
  // compensation). The premium never COMPOUNDS with UPWARD inflation: take
  // the larger force, not the product; a deflated room still discounts RBs
  // (a late Bijan in a broke room going under AAV is real).
  var _fzRB=_mdFz26On()&&p.pos==='RB';
  if(_fzRB){
    var _prem=auValue(p)>=FZ26_RB_ELITE_AAV?FZ26_RB_PREM_ELITE:FZ26_RB_PREM;
    var _f=AU.inflation>=1?Math.max(_prem,AU.inflation):_prem*AU.inflation;
    v=auValue(p)*_f*need;
  }else{
    v=auValue(p)*AU.inflation*need;
  }
  var b=AU.bots[slot]||{};
  var elite=auValue(p)>=AU.eliteLine;
  if(b.k==='stars')v*=elite?1.25:0.8;      // stars-and-scraps: pay up top, $1 out
  else if(b.k==='value'){
    // value hunter: shops the margins in the first half, then gives up on
    // discounts once the sale rack thins - a flat discount all draft made him
    // the room's biggest hoarder ($32 avg banked; a real value hunter ends up
    // buying VOLUME, not banking)
    var _hl=0;for(var s4=1;s4<=MD.teams;s4++)_hl+=AU.slotsLeft[s4];
    if(_hl>MD.teams*MD.rounds/2)v*=0.92;
  }
  // FZ26 RB doctrine, extended to the ARCHETYPE step: the premium IS the
  // room's appetite for the position - a stars build's elite multiplier
  // never stacks on top of it (max of the forces, not the product; first
  // calibration run measured every elite pinned at the ceiling, mean 1.21)
  if(_fzRB)v=Math.min(v,auValue(p)*(auValue(p)>=FZ26_RB_ELITE_AAV?FZ26_RB_PREM_ELITE:FZ26_RB_PREM)*Math.max(need,0.001));
  // price enforcer bids other people's players up in auBidStep, not here
  // spend-it-or-lose-it: an unspent dollar is worth NOTHING when the last lot
  // closes. A bot sitting on more spare money per open slot than the sticker
  // pays up to ~2x sticker in the body of the draft, and up to his FULL spare
  // once the room is inside its last ~4 rounds' worth of slots - the "$9
  // kicker because someone had $40 left" endgame every live auction produces.
  // Without both stages, harness invariant (b) showed rooms banking ~$200 of
  // $2,400 the way no real auction ever ends.
  var spare=(AU.budgets[slot]-sl)/Math.max(1,sl);
  if(spare>v){
    var allLeft=0;for(var s3=1;s3<=MD.teams;s3++)allLeft+=AU.slotsLeft[s3];
    // full spare unlocks by ROOM lateness or PERSONAL desperation: a seat
    // down to its last 4 slots with money left must dump NOW - waiting for
    // the room gate left hoarder seats banking $50-120 (invariant b trace)
    v=Math.min(spare,(allLeft<=MD.teams*4||sl<=4)?spare:v*2+2);
  }
  // pace brake: ~2 roster spots ahead of the room's proportional share turns
  // a buyer reluctant, ~1 ahead lukewarm - the partner force to spend-it-or-
  // lose-it (that one drains rich LATE budgets; this stops the roster from
  // filling EARLY with money still in pocket)
  // pace brake, two stages: the terminal leak is a MATCHING failure - seats
  // whose rosters fill early exit the market still holding money while the
  // seats with open slots are broke. Braking a seat that runs ahead of the
  // room's proportional share keeps money and slots depleting together.
  // (An early stronger-brake experiment that seemed to backfire was polluted
  // by the autopilot seat's own haircut bug, since fixed.)
  var ahead=auPace(slot);
  if(ahead>0.10)v*=0.6;else if(ahead>0.05)v*=0.85;
  // ...and its symmetric twin, the nervous-money accelerator: a seat whose
  // SPENDING lags the room's money flow bids hotter - the manager who looks
  // up mid-draft, sees $160 in hand with the board thinning, and starts
  // paying up. Brake + accelerator together are what keep every seat's money
  // and roster emptying on the same clock (the matching failure behind
  // invariant b).
  var roomSpent=0;for(var s5=1;s5<=MD.teams;s5++)roomSpent+=MD.budget-AU.budgets[s5];
  var roomMoneyFrac=roomSpent/(MD.teams*MD.budget);
  var mySpentFrac=1-AU.budgets[slot]/MD.budget;
  // FZ26 RB lots sit the accelerator out (same max-not-product doctrine):
  // the premium already IS the seat's eagerness at the position - stacking
  // nervous-money x1.5 on top pinned every elite at the ceiling (measured)
  if(!_fzRB){
    if(mySpentFrac<roomMoneyFrac-0.30)v*=1.5;
    else if(mySpentFrac<roomMoneyFrac-0.15)v*=1.25;
  }
  // hard budget law: every remaining slot still needs its $1
  var cap=AU.budgets[slot]-(sl-1);
  // the end-of-auction blowout: once the money left clearly exceeds the value
  // left to buy with it (inflation >= 1.25), dollars are melting - any player
  // a bot can use is worth near his whole cap ("$38 for a handcuff because I
  // had it", the close of every live auction). Without this, seats that
  // filled cheap exited the market holding $50-110 (harness invariant b).
  if(AU.inflation>=1.1&&need>=0.5)v=Math.max(v,cap*0.9);
  // FZ26 HARD CEILING, applied LAST so nothing stacks past it (owner: "RBs
  // go ~15% over, not 30" -> 1.25x cap, calibrated on Bijan $63 -> $74-75).
  // The first draft capped the value phase only and the money-pressure
  // stages (accelerator x1.5, endgame blowout) sailed straight through it -
  // harness (j2) measured p95 1.44. Placed here every bot's max on every
  // PRICED lot is bounded. The $1-4 closers stay exempt (FZ26_CAP_FLOOR):
  // those prices are money-dumps, not market prices - capping them at
  // 1.25 x $2 strands the room's leftover cash the way no live auction ends.
  // THE CEILING, applied LAST so no stage (premium, inflation, accelerator,
  // endgame blowout) can stack past it - and now it governs EVERY room, not
  // just fz26 (owner: elites were closing at 1.25-1.34x; ceiling is 1.20x).
  // Sub-$5 closers stay exempt: those are money-dumps, not market prices.
  if(auValue(p)>=FZ26_CAP_FLOOR){
    // A ceiling should be a BOUNDARY, not the price-setter. With one hard
    // number, ~half of elite sales landed on exactly that ratio - identical
    // prices every room, which reads as artificial. So each LOT draws its own
    // ceiling from a band under the max (deterministic per lot+seed, so it
    // never wobbles mid-bidding): most lots close below the cap, a genuinely
    // contested one can still ride it to the top.
    var _lid=(p.id||'')+'|'+(MD.seed||0);
    var _h=0;for(var _i=0;_i<_lid.length;_i++)_h=(_h*31+_lid.charCodeAt(_i))|0;
    var _band=AU_BID_CAP-AU_CAP_SPREAD;                     // low end of the band
    var _lotCap=_band+(Math.abs(_h)%1000)/1000*AU_CAP_SPREAD;
    v=Math.min(v,Math.floor(auValue(p)*_lotCap));
  }
  return Math.max(need>0?1:0,Math.min(Math.round(v),cap));
}
// nomination strategy: mostly nominate the best player you DON'T want so the
// room drains its budgets on him; sometimes float a mid-round target early
function auBotNominate(slot){
  var ros=MD.aiRosters[slot]||{};
  var sl=AU.slotsLeft[slot];
  var byV=MD.pool.slice().sort(function(a,b){return auValue(b)-auValue(a);});
  // endgame: lock in your K and D/ST while a dollar still buys one - real
  // rooms nominate their own onesies at the end, not more bench flyers
  if(sl<=3){
    if(!(ros.K>=1)&&!MD.noK){var _k=byV.filter(function(p){return p.pos==='K';})[0];if(_k)return _k;}
    if(!(ros.DEF>=1)&&!MD.noD){var _d=byV.filter(function(p){return p.pos==='DEF';})[0];if(_d)return _d;}
  }
  // a drain nomination only works if SOMEONE will actually chase it - late
  // in rooms, unwanted drains bounced back to the nominator at $1, burning
  // ~60 roster slots a draft on players nobody chose (and stranding the
  // money those slots were supposed to spend)
  var wanted=function(p){
    for(var s2=1;s2<=MD.teams;s2++){
      if(s2===slot||AU.slotsLeft[s2]<=0)continue;
      var r2=MD.aiRosters[s2]||{};
      if(auNeed(r2,p.pos,AU.slotsLeft[s2])>=0.8)return true;
    }
    return false;
  };
  var drain=byV.filter(function(p){return auNeed(ros,p.pos,sl)<0.5&&wanted(p);})[0];
  var want=byV.filter(function(p){return auNeed(ros,p.pos,sl)>=0.8&&auValue(p)<=Math.max(3,AU.budgets[slot]-(sl-1));});
  var pick=(Math.random()<0.6&&drain)?drain:(want[Math.floor(Math.random()*Math.min(6,want.length))]||drain||byV[0]);
  return pick||MD.pool[0];
}
// ── The 3-zone auction skeleton (owner-approved Yahoo architecture, our
// skin): LEFT = last sale + the lot card + compact budgets, always visible;
// CENTER = research tabs (Players / Board / History) hosting the existing
// available-players block; RIGHT = Queue / My team tabs + the autodraft
// toggle. Built by MOVING the live nodes (never cloning - ids, handlers and
// state ride along); everything borrowed from the snake board is remembered
// in window._auMoved and returned by _auLayoutOff. On a stubbed DOM (the
// harness) insertAdjacentHTML is absent and the whole layout no-ops.
function _auLayoutOn(){
  var wrap=document.getElementById('au-wrap');
  if(!wrap||!wrap.insertAdjacentHTML)return;
  if(!document.getElementById('au-zones')){
    wrap.insertAdjacentHTML('afterbegin',
      // phone chrome (hidden on desktop by CSS): the room header - X to
      // leave, the pacing pill in the middle ("$48 · going once…")
      '<div id="au-mhead"><button class="au-x" onclick="if(confirm(\'Leave the auction room?\'))mdBackToSetup()" title="Leave the room">&times;</button>'
      +'<button class="au-x au-restart" onclick="mdRestartDraft()" title="Restart this draft">&#8635;</button>'
      +'<span class="au-mcol"><span id="au-mnum" class="au-mnum"></span><span id="au-mpill" class="au-mpill"></span></span><span style="width:34px;flex:none"></span></div>'
      +'<div id="au-zones">'
      +'<div id="au-z-left"><div id="au-last" style="display:none"></div></div>'
      +'<div id="au-z-center"><div class="au-tabs" id="au-tabs">'
      +'<button class="au-tab on" data-t="players" onclick="auSetTab(\'players\')">Players</button>'
      +'<button class="au-tab" data-t="board" onclick="auSetTab(\'board\')">Board</button>'
      +'<button class="au-tab" data-t="history" onclick="auSetTab(\'history\')">Results</button>'
      +'</div><div id="au-board" style="display:none"></div><div id="au-results" style="display:none"></div></div>'
      +'<div id="au-z-right"><div class="au-tabs" id="au-rtabs">'
      +'<button class="au-tab on" data-t="queue" onclick="auSetRTab(\'queue\')">Queue</button>'
      +'<button class="au-tab" data-t="team" onclick="auSetRTab(\'team\')">Team</button>'
      +'<button class="au-tab" data-t="feed" onclick="auSetRTab(\'feed\')">Picks</button>'
      +'</div><div id="au-rq"><div id="au-rq-hint" style="font-size:13px;color:var(--muted);padding:8px 2px">Star players with the + circle - your queue lands here, and Sim stops when one hits the block.</div></div>'
      +'<div id="au-myteam" style="display:none"></div><div id="au-rfeed" style="display:none"></div><div id="au-rauto"></div></div>'
      +'</div>'
      // phone room tabs (fixed bottom, CSS-gated): Players / Queue / Board /
      // Results - they drive the same zone tabs and scroll the zone into view
      +'<div id="au-mtabs">'
      +'<button onclick="auSetTab(\'players\');_auMScroll(\'au-z-center\')">Players</button>'
      +'<button onclick="auSetRTab(\'queue\');_auMScroll(\'au-z-right\')">Queue</button>'
      +'<button onclick="auSetTab(\'board\');_auMScroll(\'au-z-center\')">Board</button>'
      +'<button onclick="auSetTab(\'history\');_auMScroll(\'au-z-center\')">Results</button>'
      +'</div>');
  }
  var L=document.getElementById('au-z-left'),C=document.getElementById('au-z-center'),R=document.getElementById('au-rq');
  // native au-wrap children take their zones
  var lot=document.getElementById('au-lot');if(lot&&L)L.appendChild(lot);
  var bud=document.getElementById('au-budgets');if(bud&&L)L.appendChild(bud);
  var sw=document.getElementById('au-sold-wrap');if(sw&&C)C.appendChild(sw);
  // borrowed from the snake board, returned on exit
  window._auMoved=window._auMoved||[];
  var borrow=function(el,host){
    if(!el||!host||!el.parentElement)return;
    if(window._auMoved.some(function(m){return m.el===el;})){host.appendChild(el);return;}
    window._auMoved.push({el:el,parent:el.parentElement,next:el.nextSibling});
    host.appendChild(el);
  };
  borrow(document.getElementById('md-available'),C);
  borrow(document.getElementById('md-queue-wrap'),R);
  var _auto=document.getElementById('md-auto');
  var _lb=_auto&&_auto.closest?_auto.closest('label.md-solo-ctl'):null;
  borrow(_lb,document.getElementById('au-rauto'));
  AU.tab='players';AU.rtab='queue';
  auSetTab('players');auSetRTab('queue');
}
function _auLayoutOff(){
  (window._auMoved||[]).forEach(function(m){
    try{
      if(!m.parent)return;
      if(m.next&&m.next.parentElement===m.parent)m.parent.insertBefore(m.el,m.next);
      else m.parent.appendChild(m.el);
    }catch(_){}
  });
  window._auMoved=[];
}
// center tabs: Players (the research table) / Board (who bought what) /
// History (the chronological sold ticker)
function auSetTab(t){
  AU.tab=t;
  var av=document.getElementById('md-available'),bd=document.getElementById('au-board'),rs=document.getElementById('au-results');
  var sw=document.getElementById('au-sold-wrap');if(sw)sw.style.display='none'; // superseded by the Results tab
  if(av)av.style.display=t==='players'?'':'none';
  if(bd){bd.style.display=t==='board'?'block':'none';if(t==='board')_auRenderBoardTab();}
  if(rs){rs.style.display=t==='history'?'block':'none';if(t==='history')_auRenderResults();}
  document.querySelectorAll('#au-tabs .au-tab').forEach(function(b){b.classList.toggle('on',b.dataset.t===t);});
}
function auSetRTab(t){
  AU.rtab=t;
  var q=document.getElementById('au-rq'),m=document.getElementById('au-myteam'),f=document.getElementById('au-rfeed');
  if(q)q.style.display=t==='queue'?'block':'none';
  if(m){m.style.display=t==='team'?'block':'none';if(t==='team')_auRenderMyTeam();}
  if(f){f.style.display=t==='feed'?'block':'none';if(t==='feed')_auRenderFeed();}
  document.querySelectorAll('#au-rtabs .au-tab').forEach(function(b){b.classList.toggle('on',b.dataset.t===t);});
}
// the lineup shape as an ordered slot list (QB, RB, RB, WR, WR, TE, FLEX, K,
// DEF, BN...) - the connected league's shape when it drives the room. Shared
// by the roster strip, the Rosters table and the Board placeholders.
function _mdLineupOrder(){
  var lf=(localStorage.getItem('tm_mock_uselg')!=='0'&&window.leagueFormat)?window.leagueFormat:null;
  var slots={
    QB:lf?((lf.numQBs||1)+(lf.hasSuperFlex?1:0)):(MD.sf?2:1),
    RB:lf?(lf.numRBs||2):2,WR:lf?(lf.numWRs||2):2,TE:lf?(lf.numTEs||1):1,
    FLEX:lf?((lf.flexCount||0)+(lf.recFlexCount||0)):1,
    K:MD.noK?0:1,DEF:MD.noD?0:1
  };
  var ord=[];
  ['QB','RB','WR','TE'].forEach(function(ps){for(var i=0;i<(slots[ps]||0);i++)ord.push(ps);});
  for(var f=0;f<(slots.FLEX||0);f++)ord.push('FLEX');
  if(slots.K)ord.push('K');
  if(slots.DEF)ord.push('DEF');
  var bn=Math.max(0,(MD.rounds||15)-ord.length);
  for(var b=0;b<bn;b++)ord.push('BN');
  return ord;
}
// assign a team's buys to lineup slots in buy order: base slot first, then
// FLEX for RB/WR/TE overflow, then bench
function _auSlotAssign(picks){
  var open=_mdLineupOrder().map(function(l){return {l:l,pk:null};});
  picks.forEach(function(pk){
    var i,s=null;
    for(i=0;i<open.length;i++)if(!open[i].pk&&open[i].l===pk.p.pos){s=open[i];break;}
    if(!s&&['RB','WR','TE'].indexOf(pk.p.pos)>=0)for(i=0;i<open.length;i++)if(!open[i].pk&&open[i].l==='FLEX'){s=open[i];break;}
    if(!s)for(i=0;i<open.length;i++)if(!open[i].pk&&open[i].l==='BN'){s=open[i];break;}
    if(s)s.pk=pk;
  });
  return open;
}
// BOARD tab, Yahoo mobile pattern: horizontally scrolling columns PER
// MANAGER - avatar row with "Max $X · $Y left", position-tinted cards for
// every buy, dashed placeholders for the open slots.
function _auRenderBoardTab(){
  var b=document.getElementById('au-board');if(!b)return;
  var html='<div class="au-boardrow">';
  for(var s=1;s<=MD.teams;s++){
    var nm=s===MD.mySlot?'You':((AU.bots[s]&&AU.bots[s].name)||('Team '+s));
    var buys=(MD.picks||[]).filter(function(pk){return pk.slot===s;});
    var sl=AU.slotsLeft[s]||0;
    var cap=sl>0?(AU.budgets[s]||0)-(sl-1):0;
    html+='<div class="au-bcol'+(s===MD.mySlot?' me':'')+'">'
      +'<div class="au-bcolhd"><span class="au-bava">'+nm.charAt(0).toUpperCase()+'</span>'
      +'<span class="au-bcoln">'+nm+'</span></div>'
      +'<div class="au-bcolm">Max $'+Math.max(0,cap)+' · $'+(AU.budgets[s]||0)+'</div>'
      +buys.map(function(pk){
        return '<div class="au-bcard pos-'+pk.p.pos+'"><div class="au-bcardn">'+pk.p.name+'</div>'
          +'<div class="au-bcardm">'+(pk.p.team||'FA')+' · '+pk.p.pos+(pk.grade?' · <b>'+pk.grade+'</b>':'')+'</div>'
          +'<div class="au-bcardp">$'+(pk.price||0)+'</div></div>';
      }).join('')
      +(sl>0?new Array(Math.min(sl,3)+1).join('<div class="au-bcard empty"></div>'):'')
      +'</div>';
  }
  b.innerHTML=html+'</div>';
}
// RESULTS tab: segmented Rosters | Picks. Picks = reverse-chrono sales with
// ROUND badges (one nomination cycle = a round) and the buy grade; Rosters =
// any team's slot table (empty slots stay visible - the "what do I still
// need" view) behind a team selector with the aggregate grade.
function _auRenderResults(){
  var host=document.getElementById('au-results');if(!host)return;
  AU.rview=AU.rview||'picks';
  if(AU.rteam==null||!AU.budgets[AU.rteam])AU.rteam=MD.mySlot;
  var pc={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'};
  var seg='<div class="au-tabs" style="max-width:420px;margin:0 0 10px">'
    +'<button class="au-tab'+(AU.rview==='rosters'?' on':'')+'" onclick="AU.rview=\'rosters\';_auRenderResults()">Teams</button>'
    +'<button class="au-tab'+(AU.rview==='picks'?' on':'')+'" onclick="AU.rview=\'picks\';_auRenderResults()">Round by round</button>'
    +'<button class="au-tab'+(AU.rview==='pos'?' on':'')+'" onclick="AU.rview=\'pos\';_auRenderResults()">Positions</button>'
    +'</div>';
  var body='';
  if(AU.rview==='picks'){
    var rows='',lastRound=null;
    var all=(MD.picks||[]).slice().reverse(); // newest first
    all.forEach(function(pk,i){
      var overall=all.length-i;
      if(pk.round!==lastRound){lastRound=pk.round;rows+='<div class="au-rndbadge">ROUND '+pk.round+'</div>';}
      var who=pk.mine?'<b style="color:var(--accent-bright)">You</b>':((AU.bots[pk.slot]&&AU.bots[pk.slot].name)||('Team '+pk.slot));
      rows+='<div class="au-pkrow">'
        +'<span class="au-pkno">'+overall+'</span>'
        +'<img src="'+mdFaceUrl(pk.p)+'" onerror="this.style.visibility=\'hidden\'">'
        +'<span class="au-pkmain"><span class="au-pknm">'+pk.p.name+'</span>'
        +'<span class="au-pkmeta" style="color:'+(pc[pk.p.pos]||'var(--muted)')+'">'+pk.p.pos+' · '+(pk.p.team||'FA')+' · $'+(pk.price||0)+'</span></span>'
        +(pk.grade?'<span class="au-grade g-'+pk.grade.replace('+','p')+'">'+pk.grade+'</span>':'')
        +'<span class="au-pkwho">'+who+'</span>'
        +'</div>';
    });
    body=rows||'<div style="font-size:13.5px;color:var(--muted);padding:8px 2px">No sales yet.</div>';
  }else if(AU.rview==='pos'){
    // POSITIONS DRAFTED grid: teams x positions counts - who has filled what
    // and who is still hunting (the strategic read: whose TE panic is coming)
    var POSL=['QB','RB','WR','TE','K','DEF'];
    var head='<div class="au-posrow au-poshead"><span class="au-posname"></span>'
      +POSL.map(function(ps){return '<span class="au-poscell" style="color:'+(pc[ps]||'var(--muted)')+'">'+ps+'</span>';}).join('')+'</div>';
    var prow='';
    for(var s3=1;s3<=MD.teams;s3++){
      var nm3=s3===MD.mySlot?'You':((AU.bots[s3]&&AU.bots[s3].name)||('Team '+s3));
      var ros3=MD.aiRosters[s3]||{};
      prow+='<div class="au-posrow'+(s3===MD.mySlot?' me':'')+'"><span class="au-posname">'+nm3+'</span>'
        +POSL.map(function(ps){var n3=ros3[ps]||0;return '<span class="au-poscell'+(n3?'':' zero')+'">'+n3+'</span>';}).join('')+'</div>';
    }
    body=head+prow;
  }else{
    var opts='';
    for(var s2=1;s2<=MD.teams;s2++){
      var nm2=s2===MD.mySlot?'You':((AU.bots[s2]&&AU.bots[s2].name)||('Team '+s2));
      opts+='<option value="'+s2+'"'+(s2===AU.rteam?' selected':'')+'>'+nm2+'</option>';
    }
    var tBuys=(MD.picks||[]).filter(function(pk){return pk.slot===AU.rteam;});
    var tg=_auTeamGrade(AU.rteam);
    body='<div class="au-rsel"><select class="opp-select" onchange="AU.rteam=parseInt(this.value,10);_auRenderResults()">'+opts+'</select>'
      +'<span class="au-rselm">'+tBuys.length+'/'+MD.rounds+(tg?' · <span class="au-grade g-'+tg.replace('+','p')+'">'+tg+'</span>':'')+'</span></div>'
      +_auSlotAssign(tBuys).map(function(o){return _auRosterRow(o,pc);}).join('');
  }
  host.innerHTML=seg+body;
}
// one roster row, shared by the rail Team tab and the Results Teams view:
// slot chip | face + name + meta | grade | bye | $cost - and EMPTY slots stay
// visible in lineup order, so the hole at QB is seen, not deduced
function _auRosterRow(o,pc){
  var chip='<span class="au-slotchip" style="color:'+(pc[o.l]||'var(--accent-bright)')+'">'+o.l+'</span>';
  if(!o.pk)return '<div class="au-rrow empty">'+chip+'<span class="au-rempty">Empty</span></div>';
  var pk=o.pk,bye=window._mdByes&&pk.p.team?window._mdByes[pk.p.team]:null;
  return '<div class="au-rrow">'+chip
    +'<img src="'+mdFaceUrl(pk.p)+'" onerror="this.style.visibility=\'hidden\'">'
    +'<span class="au-pkmain"><span class="au-pknm">'+pk.p.name+'</span>'
    +'<span class="au-pkmeta" style="color:'+(pc[pk.p.pos]||'var(--muted)')+'">'+pk.p.pos+' · '+(pk.p.team||'FA')+'</span></span>'
    +(pk.grade?'<span class="au-grade g-'+pk.grade.replace('+','p')+'">'+pk.grade+'</span>':'')
    +'<span class="au-rbye">'+(bye||'&ndash;')+'</span>'
    +'<span class="au-rprice">$'+(pk.price||0)+'</span>'
    +'</div>';
}
function _auRenderMyTeam(){
  var m=document.getElementById('au-myteam');if(!m)return;
  var pc={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'};
  m.innerHTML=_auSlotAssign((MD.picks||[]).filter(function(pk){return pk.mine;}))
    .map(function(o){return _auRosterRow(o,pc);}).join('');
}
// the rail mini-feed ("Picks" tab): sales AND room events, newest first
function _posColor(ps){return {QB:'var(--pos-qb)',RB:'var(--pos-rb)',WR:'var(--pos-wr)',TE:'var(--pos-te)',K:'var(--pos-k)',DEF:'var(--pos-def)'}[ps]||'';}
function _auFeed(txt){
  AU.feed=AU.feed||[];
  AU.feed.unshift(txt);
  if(AU.feed.length>60)AU.feed.length=60;
  if(AU.rtab==='feed')_auRenderFeed();
}
function _auRenderFeed(){
  var f=document.getElementById('au-rfeed');if(!f)return;
  f.innerHTML=(AU.feed&&AU.feed.length)
    ?AU.feed.map(function(t){return '<div class="au-feedrow">'+t+'</div>';}).join('')
    :'<div style="font-size:13px;color:var(--muted);padding:8px 2px">The room\'s story lands here - sales, nominations, sims.</div>';
}
// the "Last:" strip - the sold splash's quiet permanent record, Yahoo order:
// price first, player (pos·team in its color), then the buyer
function _auRenderLast(){
  var el=document.getElementById('au-last');if(!el)return;
  var s0=AU.sold&&AU.sold[0];
  if(!s0){el.style.display='none';return;}
  var who=s0.slot===MD.mySlot?'YOU':((AU.bots[s0.slot]&&AU.bots[s0.slot].name)||('Team '+s0.slot));
  var pc={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'}[s0.p.pos]||'var(--muted)';
  el.style.display='block';
  // Yahoo detail the owner flagged: the PRICE wears the player's position color
  el.innerHTML='<span style="color:var(--muted)">Last:</span> <b style="font-variant-numeric:tabular-nums;color:'+pc+'">$'+s0.price+'</b> · '+s0.p.name
    +' <span style="color:'+pc+';font-weight:700">('+s0.p.pos+'·'+(s0.p.team||'FA')+')</span>'
    +' <span style="color:var(--muted)">&rarr;</span> '+who;
}
// phone header pill: the pacing state at a glance
function _auRenderMHead(){
  var pill=document.getElementById('au-mpill');if(!pill)return;
  var lot=AU.lot;
  if(lot){
    var hn=lot.holder===MD.mySlot?'you lead':(((AU.bots[lot.holder]||{}).name)||('Team '+lot.holder))+' leads';
    pill.className='au-mpill'+(lot.going>=2?' g2':lot.going>=1?' g1':'');
    pill.innerHTML='<b>$'+lot.bid+'</b> · '+(lot.going>=2?'going twice…':lot.going>=1?'going once…':hn);
  }else{
    pill.className='au-mpill';
    pill.innerHTML=AU.nominator===MD.mySlot?'Your nomination':'Nominating…';
  }
}
function _auMScroll(id){try{var e=document.getElementById(id);if(e&&e.scrollIntoView)e.scrollIntoView({behavior:'smooth',block:'start'});}catch(_){}}
// the countdown number above the pill: whole seconds left in the CURRENT
// pacing phase (bid window / going once / going twice / next lot). Pure
// render - AU.phaseEnd is stamped wherever a beat gets scheduled.
function _auTickPill(){
  var n=document.getElementById('au-mnum');if(!n)return;
  if(!AU.active||!AU.phaseEnd){n.textContent='';return;}
  var left=Math.max(0,Math.ceil((AU.phaseEnd-Date.now())/1000));
  n.textContent=String(left);
}
// the gap between lots gets narrated, never a dead screen: peek the wheel
// for the next nominator (same rotation + full-roster skip auAdvance uses)
function _auRenderInterlude(){
  if(AU.lot||!AU.active)return;
  var box=document.getElementById('au-lot');if(!box)return;
  var t=AU.nomTurn,slot=null;
  for(var i=0;i<MD.teams;i++){
    var c=((t+i)%MD.teams)+1;
    if(AU.slotsLeft[c]>0){slot=c;break;}
  }
  if(!slot)return;
  var nm=slot===MD.mySlot?'You':((AU.bots[slot]&&AU.bots[slot].name)||('Team '+slot));
  // the waiting state stays UNAMBIGUOUS: the card keeps its shape but every
  // control reads dead ($-, dimmed stepper, disabled OFFER) - nothing to do
  // yet, and the screen says exactly that
  box.innerHTML='<div class="au-card au-waitcard">'
    +'<div class="au-interlude" style="border:none;padding:0">'
    +(slot===MD.mySlot?'Your nomination is next&hellip;':nm+' is nominating a player&hellip;')
    +'</div>'
    +'<div class="au-offerrow" style="opacity:.35;pointer-events:none" aria-hidden="true">'
    +'<span class="au-step"><button class="au-stepbtn" disabled>&minus;</button><span class="au-stepval">$&ndash;</span><button class="au-stepbtn" disabled>+</button></span>'
    +'<button class="au-bid-btn" disabled>OFFER $&ndash;</button>'
    +'</div></div>';
  var pill=document.getElementById('au-mpill');
  if(pill){pill.className='au-mpill';pill.innerHTML=slot===MD.mySlot?'You nominate next&hellip;':'Nominating&hellip;';}
}
// custom-offer stepper: defaults to the next increment, bounded by the
// budget law; resets whenever the live bid moves past it or the lot changes
function auBumpCustom(d){
  var lot=AU.lot;if(!lot)return;
  var myCap=AU.slotsLeft[MD.mySlot]>0?AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1):0;
  var eff=Math.max(lot.bid+1,AU.custom||0);
  AU.custom=Math.max(lot.bid+1,Math.min(myCap,eff+d));
  auRenderLot();
}
// the ONE primary action: offer the stepper's amount (next increment unless raised)
function auOffer(){
  var lot=AU.lot;if(!lot||AU.slotsLeft[MD.mySlot]<=0||lot.holder===MD.mySlot)return;
  var amt=Math.max(lot.bid+1,AU.custom||0);
  var cap=AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1);
  if(amt>cap)amt=cap;
  if(amt<=lot.bid)return;
  lot.bid=amt;lot.holder=MD.mySlot;lot.going=0;AU.custom=null;
  auRenderLot();auRenderBudgets();
  if(AU.stepT)clearTimeout(AU.stepT);
  AU.phaseEnd=Date.now()+AU_PACE.BID_MAX;AU.stepT=setTimeout(auBidStep,_auDelay(_auBeatMs()));
}
function auStart(){
  AU.active=true;
  AU.budgets={};AU.slotsLeft={};AU.bots={};AU.sold=[];AU.lot=null;AU.nomTurn=0;
  var AU_ARCHS=['balanced','stars','enforcer','value','balanced','balanced'];
  // Snake personality -> auction bidding style. The auction room speaks four
  // money dialects (balanced/stars/enforcer/value); each drafting personality
  // maps to the one its money would follow live (market heuristic, declared -
  // there is no auction-archetype dataset to fit):
  //   zerorb/lateqb/valuestrict -> value   (fade the expensive tier, shop discounts)
  //   herorb/earlyqb/tehunter   -> stars   (pay up for the one elite anchor, scraps after)
  //   hype                      -> enforcer (runs prices up, chases the shiny lots)
  //   robustrb/bpa/homer        -> balanced (spends with the room's rhythm)
  var AU_ARCH_OF={zerorb:'value',lateqb:'value',valuestrict:'value',
    herorb:'stars',earlyqb:'stars',tehunter:'stars',hype:'enforcer',
    robustrb:'balanced',bpa:'balanced',homer:'balanced'};
  var _profsAU={};try{_profsAU=mdEffectiveProfiles(MD.teams,MD.mySlot);}catch(_){}
  for(var s=1;s<=MD.teams;s++){
    AU.budgets[s]=MD.budget;
    AU.slotsLeft[s]=MD.rounds;
    MD.aiRosters[s]=MD.aiRosters[s]||{QB:0,RB:0,WR:0,TE:0,K:0,DEF:0,list:[]};
    if(s!==MD.mySlot){
      // a PROFILED seat bids its mapped style (MD.bots already carries the
      // profile's archetype + name from _startMockDraftRun); random seats
      // draw from the room's normal style mix
      var _pk2=_profsAU[s]&&_profsAU[s].arch?AU_ARCH_OF[_profsAU[s].arch]:null;
      AU.bots[s]={k:_pk2||AU_ARCHS[Math.floor(Math.random()*AU_ARCHS.length)],name:(MD.bots[s]&&MD.bots[s].name)||('Team '+s)};
    }
  }
  auPoolInit();
  // the elite line for the stars archetype: top-12 by room value
  var top=Object.values(AU.val).sort(function(a,b){return b-a;});
  AU.eliteLine=top[11]||20;
  AU.inflation=1;
  var g=document.getElementById('md-draftboard');if(g)g.style.display='none';
  var w=document.getElementById('au-wrap');if(w)w.style.display='block';
  try{_auLayoutOn();}catch(_){}  // the 3-zone room (queue lives in the right rail now)
  AU.custom=null;
  AU.tab='players';AU.rtab='queue';AU.rview='picks';AU.rteam=null;
  AU.feed=[];_auFeed('<span style="color:var(--muted)">Auction started &middot; $'+MD.budget+' each</span>');
  if(AU.pillT)clearInterval(AU.pillT);
  AU.pillT=setInterval(_auTickPill,500); // phone countdown above the pill
  // a sale is a sale - mdUndo refuses in auctions, so don't show a dead button
  var _ub=document.getElementById('md-undo-btn');if(_ub)_ub.style.display='none';
  // the board bar sheds everything that means nothing in an auction: the
  // Board/List toggle drives the hidden snake grid, the pick timer has no
  // role (money is the clock), and the cryptic "QB 0/1" counters move into
  // the lot card's own money line ("$142 left · max bid $96 · 12 spots")
  try{
    var _vt=document.querySelector('.md-view-btn');if(_vt&&_vt.parentElement)_vt.parentElement.style.display='none';
    var _cl3=document.getElementById('md-clock-live');if(_cl3)_cl3.style.display='none';
    var _nd=document.getElementById('md-needs');if(_nd)_nd.style.display='none';
    // the snake's "My team" peek is dead weight here - the rail has a Team tab
    // and the phone strip shows the same roster, always on
    var _pk=document.getElementById('md-player-peek');
    if(_pk){_pk.style.display='none';_pk.dataset.roster='';}
    document.querySelectorAll('[onclick*="mdShowMyRoster"]').forEach(function(b){b.style.display='none';});
  }catch(_){}
  AU.bOpen=false;   // budgets start collapsed: mini-bars only
  AU.noSplash=0;
  // in the auction Mac lives ON the lot card (auSageLine); the snake box
  // would only show a stale read from the last snake room
  MD._mac=null;
  var _sgA=document.getElementById('md-sage');if(_sgA)_sgA.style.display='none';
  auRenderBudgets();
  try{mdRenderMine();}catch(_){}  // seed the phone roster strip before lot one
  try{mdShowChoices(1);}catch(_){}  // the research table exists from second one
  auAdvance();
}
function auAdvance(){
  if(!AU.active)return; // the room was left mid-auction: stop cold
  var anyLeft=false,poolLeft=MD.pool.length>0;
  for(var s=1;s<=MD.teams;s++)if(AU.slotsLeft[s]>0)anyLeft=true;
  if(!anyLeft||!poolLeft){auFinish();return;}
  AU.inflation=auInflation();
  // next nominator: rotate, skipping full rosters
  var tries=0,slot;
  do{slot=(AU.nomTurn%MD.teams)+1;AU.nomTurn++;tries++;}while(AU.slotsLeft[slot]<=0&&tries<=MD.teams);
  if(AU.slotsLeft[slot]<=0){auFinish();return;}
  AU.nominator=slot;
  var st=document.getElementById('md-status');
  if(slot===MD.mySlot){
    MD.onClock=true;MD.curRound=1;
    // short: the lot card itself carries the big "Your turn to nominate"
    if(st)st.innerHTML='<span style="color:var(--accent-bright);font-weight:700">Your nomination</span>';
    try{sndYourTurn();}catch(_){}   // your turn to put someone on the block
    mdShowChoices(1);
    if(MD.autoPilot){var ap=auBotNominateUser();if(ap){auOpenLot(MD.mySlot,ap);return;}}
    auRenderLot();
    try{_auRenderMHead();}catch(_){}
  }else{
    MD.onClock=false;
    var nm=(AU.bots[slot]&&AU.bots[slot].name)||('Team '+slot);
    // orientation #1: how many lots until YOUR nomination (rotation math off
    // the nominator wheel; roster-full skips make it an upper bound, which
    // only ever errs in the calm direction)
    var _untilNom=(((MD.mySlot-slot-1)+2*MD.teams)%MD.teams)+1;
    if(st)st.innerHTML='Nominating: <b style="color:var(--text)">'+nm+'</b>'
      +'<span style="color:var(--accent-bright);font-weight:700;margin-left:10px">'
      +(_untilNom<=1?'you nominate next':'your nomination in '+_untilNom)+'</span>';
    // (no feed line: "who is nominating" is transient state, and the lot card
    // already says it - in the feed it buried the actual sales)
    var p=auBotNominate(slot);
    auOpenLot(slot,p);
  }
}
// the user's autopilot nominates like a balanced bot would
function auBotNominateUser(){
  var ros={};MD.mine.forEach(function(x){ros[x.pos]=(ros[x.pos]||0)+1;});
  var sl=AU.slotsLeft[MD.mySlot];
  var byV=MD.pool.slice().sort(function(a,b){return auValue(b)-auValue(a);});
  if(sl<=3){
    if(!(ros.K>=1)&&!MD.noK){var _k=byV.filter(function(p){return p.pos==='K';})[0];if(_k)return _k;}
    if(!(ros.DEF>=1)&&!MD.noD){var _d=byV.filter(function(p){return p.pos==='DEF';})[0];if(_d)return _d;}
  }
  // same someone-must-want-it rule the bots follow
  var wanted=function(p){
    for(var s2=1;s2<=MD.teams;s2++){
      if(s2===MD.mySlot||AU.slotsLeft[s2]<=0)continue;
      var r2=MD.aiRosters[s2]||{};
      if(auNeed(r2,p.pos,AU.slotsLeft[s2])>=0.8)return true;
    }
    return false;
  };
  return byV.filter(function(p){return auNeed(ros,p.pos,sl)<0.5&&wanted(p);})[0]
    ||byV.filter(function(p){return auNeed(ros,p.pos,sl)>=0.8;})[0]
    ||byV[0];
}
function auUserNominate(p){
  if(!AU.active||AU.lot||AU.nominator!==MD.mySlot)return;
  MD.onClock=false;
  auOpenLot(MD.mySlot,p);
}
function auOpenLot(slot,p){
  var i=MD.pool.indexOf(p);if(i<0){auAdvance();return;}
  AU.custom=null; // fresh lot, fresh stepper
  // every lot opens at $1 - tested "statement" openings (~40% of value on own
  // targets) DETERRED the competition that makes prices, and the room banked
  // more, not less. $1 opens with jump-bid escalation is what the sim
  // supports and what most live rooms actually do.
  AU.lot={p:p,bid:1,holder:slot,going:0,myMax:0};
  // autopilot plays the user like a balanced manager: a standing limit bid at
  // Mac's personal ceiling, cooled by the same pace brake the bots use (this
  // is also how the calibration harness drives the user's seat)
  if(MD.autoPilot&&AU.slotsLeft[MD.mySlot]>0){
    var _w=auMyWorth(p).worth;
    var _ah=auPace(MD.mySlot);
    // same two-stage brake the bots use (the original harsher 0.45 version
    // benched this seat for the whole value phase and it finished as the
    // room's biggest hoarder - the brake must slow a seat, never bench it)
    if(_ah>0.10)_w=Math.round(_w*0.6);else if(_ah>0.05)_w=Math.round(_w*0.85);
    // own nomination: defend it only if the roster actually uses the player
    if(slot===MD.mySlot){
      var _ros3={};MD.mine.forEach(function(x){_ros3[x.pos]=(_ros3[x.pos]||0)+1;});
      if(auNeed(_ros3,p.pos,AU.slotsLeft[MD.mySlot])<0.5)_w=0;
    }
    AU.lot.myMax=_w;
  }
  auRenderLot();auRenderBudgets();
  AU.phaseEnd=Date.now()+AU_PACE.BID_MAX;AU.stepT=setTimeout(auBidStep,_auDelay(_auBeatMs()));
}
// One decision beat of room bidding. Bots outbid +$1 while the price is
// under their max; the enforcer pushes OTHER people's lots to ~90% of value
// even without need, betting on not winning. Two quiet beats end the lot.
// Shared VERBATIM by the clocked path (auBidStep: render + setTimeout
// pacing) and the instant path (auSimLot): the decision logic lives only
// here, so a simmed lot is statistically identical to a clocked one - same
// bot maxes, same inflation, same jump bids, same user proxy - only the
// waiting removed. Returns 'bid', 'quiet', or 'sold'.
function _auBidOnce(){
  var lot=AU.lot;if(!lot)return 'sold';
  var next=lot.bid+1;
  var cands=[];
  for(var s=1;s<=MD.teams;s++){
    if(s===lot.holder||s===MD.mySlot||AU.slotsLeft[s]<=0)continue;
    var mx=auBotMax(s,lot.p);
    var b=AU.bots[s]||{};
    // enforcer: happily pushes a lot he does not even want toward value
    if(b.k==='enforcer'&&mx<1){
      var enf=Math.round(auValue(lot.p)*AU.inflation*0.9);
      var cap=AU.budgets[s]-(AU.slotsLeft[s]-1);
      mx=Math.min(enf,cap)* (AU.slotsLeft[s]>2?1:0);
    }
    if(mx>=next)cands.push({s:s,mx:mx});
  }
  // the user's limit bid works like a proxy: auto +$1 while under the cap
  if(lot.holder!==MD.mySlot&&lot.myMax>=next&&AU.slotsLeft[MD.mySlot]>0){
    var myCap=AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1);
    if(next<=myCap){lot.bid=next;lot.holder=MD.mySlot;lot.going=0;return 'bid';}
  }
  if(cands.length){
    cands.sort(function(a,b){return b.mx-a.mx;});
    var w=cands[0];
    // jump bids: a third of raises go "$15!" straight past +$1, the way real
    // rooms bid - and a bidder flush with spare cash jumps bigger. Strict +$1
    // closed every lot at the RUNNER-UP's ceiling (textbook second-price),
    // which priced the whole draft ~10% under what winners would pay - the
    // biggest single piece of invariant (b)'s leak.
    var wSpare=(AU.budgets[w.s]-AU.slotsLeft[w.s])/Math.max(1,AU.slotsLeft[w.s]);
    // REAL rooms don't crawl $1 at a time toward an obvious price. When the
    // bid is still far under what the lot is plainly worth, the room jumps -
    // hard early ("$40!"), then settles into small raises as it closes on
    // value. Two regimes, owner-driven ("no tiene por que escalar tan lento"):
    //   FAR  (bid < 60% of the field's ceiling): leap most of the remaining
    //        gap, 45-75% of it, so a $60 player reaches the $40s in one beat.
    //   NEAR (the last stretch): the old small raise, where the drama lives.
    var ceil=w.mx, gap=ceil-next, jump=0;
    if(gap>3&&next<ceil*0.6){
      jump=Math.round(gap*(0.45+Math.random()*0.30));
      // never overshoot into the ceiling itself - leave room to be outbid
      jump=Math.min(jump,Math.max(1,ceil-next-1));
    }else if(Math.random()<0.4){
      jump=Math.ceil(Math.random()*Math.min(5,1+wSpare/8));
    }
    lot.bid=Math.min(ceil,next+jump);lot.holder=w.s;lot.going=0;
    return 'bid';
  }
  lot.going++;
  if(lot.going>=3){auSell();return 'sold';}
  return 'quiet';
}
function auBidStep(){
  if(!AU.lot)return;
  var wasMine=AU.lot.holder===MD.mySlot;
  var r=_auBidOnce();
  if(r==='sold')return;
  // the room has a voice: a soft tick on every raise, a sharper note the beat
  // you get outbid, and the clock's urgent tick as the hammer comes down
  try{
    if(r==='bid'){
      if(wasMine&&AU.lot&&AU.lot.holder!==MD.mySlot)sndClockUrgent();
      else sndPickSoft();
    }else if(r==='quiet'&&AU.lot){
      if(AU.lot.going>=2)sndClockUrgent();else if(AU.lot.going>=1)sndClockTick();
    }
  }catch(_){}
  auRenderLot();
  auRenderBudgets(); // the live-bid badge rides the high bidder's row
  // the ENTRY WINDOW, visible and steady: after a raise the room gets a
  // human beat to respond; one silent beat shows GOING ONCE and holds 2s,
  // the second shows GOING TWICE and holds 1.5s before the hammer. Any bid
  // (bot or user) resets going to 0 and the window starts over.
  var d=r==='quiet'?(AU.lot.going>=2?AU_PACE.HAMMER:AU_PACE.GOING_2):_auBeatMs();
  AU.phaseEnd=Date.now()+d;
  AU.stepT=setTimeout(auBidStep,_auDelay(d));
}
// "Sim this lot": the user sits this one out and the room finishes it NOW -
// the exact same decision beat as the clock path, minus the waits. A
// standing max bid stays live as the proxy (the button label says so), and
// the sale is final like any other - the house has no auction undo. The
// guard is unreachable headroom (bids only climb toward hard budget caps,
// ~600 beats worst case at $300 budgets); if it ever trips, the lot falls
// back to the clocked path instead of stalling.
function auSimLot(){
  if(!AU.active||!AU.lot)return;
  if(AU.stepT)clearTimeout(AU.stepT);
  var guard=0;
  while(AU.lot&&guard++<2000){if(_auBidOnce()==='sold')break;}
  if(AU.lot){AU.phaseEnd=Date.now()+AU_PACE.BID_MAX;AU.stepT=setTimeout(auBidStep,_auDelay(_auBeatMs()));return;}
  auRenderLot(); // clean card while the room takes its normal beat to the next lot
}
// "Sim to my turn": consecutive instant lots until it is YOUR nomination or
// a player from your queue hits the block - whichever comes first.
function auSimToMyTurn(){
  if(!AU.active||!AU.lot)return;
  AU.noSplash=1; // ten SOLD splashes in a row is a strobe, not a moment
  var _n0=(AU.sold||[]).length;
  try{_auSimToMyTurnRun();}finally{
    AU.noSplash=0;
    var _nd=(AU.sold||[]).length-_n0;
    if(_nd>0)try{_auFeed('<span style="color:var(--accent-bright)">Sim: '+_nd+' lot'+(_nd>1?'s':'')+' resolved</span>');}catch(_){}
  }
}
function _auSimToMyTurnRun(){
  var guard=0;
  while(AU.active&&guard++<400){
    if(!AU.lot)break;
    if((MD.queue||[]).indexOf(AU.lot.p.id)>=0)break; // a lot you queued: yours to fight
    if(AU.stepT)clearTimeout(AU.stepT);
    var g2=0;
    while(AU.lot&&g2++<2000){if(_auBidOnce()==='sold')break;}
    if(AU.lot){AU.phaseEnd=Date.now()+AU_PACE.BID_MAX;AU.stepT=setTimeout(auBidStep,_auDelay(_auBeatMs()));return;} // guard tripped: back to the clock
    if(!AU.active)break;                 // that was the last lot
    if(AU.stepT)clearTimeout(AU.stepT);  // the pending between-lots beat
    auAdvance();                         // open the next nomination now
    if(AU.nominator===MD.mySlot)break;   // your nomination: the room is yours
  }
}
function auUserBid(inc){
  var lot=AU.lot;if(!lot||AU.slotsLeft[MD.mySlot]<=0)return;
  var amt=inc==null?parseInt((document.getElementById('au-custom')||{}).value,10):lot.bid+inc;
  if(!amt||amt<=lot.bid)return;
  var cap=AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1);
  if(amt>cap)amt=cap;
  if(amt<=lot.bid)return;
  lot.bid=amt;lot.holder=MD.mySlot;lot.going=0;
  auRenderLot();
  if(AU.stepT)clearTimeout(AU.stepT);
  AU.phaseEnd=Date.now()+AU_PACE.BID_MAX;AU.stepT=setTimeout(auBidStep,_auDelay(_auBeatMs()));
}
function auSetMax(){
  var lot=AU.lot;if(!lot)return;
  var v=parseInt((document.getElementById('au-max')||{}).value,10)||0;
  lot.myMax=v;
  auRenderLot();
}
// Grade a single auction buy: PAID vs the room's own sticker (auValue - the
// normalized market price for THIS room's money). House derivation:
//  - deadband first: within ±$2 every lot is a FAIR buy (B) - $1 endgame
//    closers and small-money noise must never grade like a 2x overpay;
//  - then the ratio cuts: paid <=75% of value = A (a genuine steal),
//    75-90% = B+ (good value), 90-110% = B (market price), 110-130% = C+
//    (paid up), >130% = D (bought the bidding war). Cut positions follow the
//    spec sketch and were sanity-tuned against the harness distribution
//    (invariant (i): the 600-room curve must center on B with thin tails).
function auGradeBuy(price,value){
  if(Math.abs(price-(value||0))<=2)return 'B';
  var r=price/Math.max(1,value||0);
  return r<=0.75?'A':r<=0.9?'B+':r<=1.1?'B':r<=1.3?'C+':'D';
}
// price-weighted team grade: letters to GPA (A 4 / B+ 3.3 / B 3 / C+ 2.3 /
// D 1.3), weighted by dollars spent (a $60 overpay should drag more than a
// $2 one), then back to the letter bands
var AU_GPA={'A':4,'B+':3.3,'B':3,'C+':2.3,'D':1.3};
function _auTeamGrade(slot){
  var buys=(MD.picks||[]).filter(function(pk){return pk.slot===slot&&pk.price!=null;});
  if(!buys.length)return '';
  var wsum=0,gsum=0;
  buys.forEach(function(pk){
    var w=Math.max(1,pk.price);
    gsum+=(AU_GPA[pk.grade||'B']||3)*w;wsum+=w;
  });
  var g=gsum/wsum;
  return g>=3.65?'A':g>=3.15?'B+':g>=2.65?'B':g>=1.8?'C+':'D';
}
function auSell(){
  var lot=AU.lot;if(!lot)return;
  AU.lot=null;
  var slot=lot.holder,p=lot.p,price=lot.bid;
  var i=MD.pool.indexOf(p);if(i>=0)MD.pool.splice(i,1);
  AU.budgets[slot]-=price;
  AU.slotsLeft[slot]--;
  var ros=MD.aiRosters[slot];ros[p.pos]=(ros[p.pos]||0)+1;ros.list.push(p);
  var n=AU.sold.length+1;
  var mine=slot===MD.mySlot;
  if(mine)MD.mine.push(p);
  var _g=auGradeBuy(price,auValue(p));
  MD.picks.push({slot:slot,round:Math.ceil(n/MD.teams),pickNo:((n-1)%MD.teams)+1,p:p,mine:mine,price:price,grade:_g});
  AU.sold.unshift({p:p,slot:slot,price:price,value:auValue(p),grade:_g});
  var who=mine?'YOU':((AU.bots[slot]&&AU.bots[slot].name)||('Team '+slot));
  MD.log.unshift('<span style="color:var(--muted)">$'+price+'</span> '+who+' - <strong style="color:var(--text)">'+p.name+'</strong> '+mdPosTag(p.pos));
  try{if(slot===MD.mySlot)sndWin();else sndImpact();}catch(_){}
  if(!AU.noSplash)auSoldSplash(p,price,who);
  AU.custom=null; // the stepper belongs to the lot that just closed
  auRenderSold();auRenderBudgets();mdRenderMine();mdRenderLog();
  try{
    _auFeed('<span class="au-fprice">$'+price+'</span><span class="au-fname">'+p.name
      +'<span class="au-fpos" style="color:'+(_posColor(p.pos)||'var(--muted)')+'">'+p.pos+'</span></span>'
      +'<span class="au-fwho">'+who+'</span>');
    _auRenderLast();                       // the splash's permanent record
    if(AU.tab==='board')_auRenderBoardTab();
    if(AU.tab==='history')_auRenderResults();
    if(AU.rtab==='team')_auRenderMyTeam();
    _auRenderInterlude();                  // the gap between lots is narrated, never dead
  }catch(_){}
  // the research table is the auction's whole left brain - it must stay
  // painted at all times (MD.onClock is a snake concept and is never true here)
  mdShowChoicesSoon(1);
  AU.phaseEnd=Date.now()+AU_PACE.NEXT_LOT;AU.stepT=setTimeout(auAdvance,_auDelay(AU_PACE.NEXT_LOT));
}
// Mac's read on the block: personal ceiling = room value x live inflation,
// bumped when it fills an open starter slot, capped by the budget law.
function auMyWorth(p){
  var ros={};MD.mine.forEach(function(x){ros[x.pos]=(ros[x.pos]||0)+1;});
  var starters={QB:MD.sf?2:1,RB:2,WR:MD.scoring>=1?3:2,TE:1};
  var needsIt=(ros[p.pos]||0)<(starters[p.pos]||1);
  if(p.pos==='K'||p.pos==='DEF')needsIt=AU.slotsLeft[MD.mySlot]<=3&&!(ros[p.pos]>=1);
  // the bench multiplier is 1.0 like the bots': sticker already IS the market
  // price of a bench-tier player, and a 0.9 haircut here made the advisor
  // (and the autopilot seat) lose every contested lot and bank $168
  var v=auValue(p)*AU.inflation*(needsIt?1.1:1);
  // spend-it-or-lose-it is real advice too: with more spare per open slot
  // than the sticker, banking the money just donates it to the room
  var _sl=AU.slotsLeft[MD.mySlot];
  var spare=(AU.budgets[MD.mySlot]-_sl)/Math.max(1,_sl);
  if(spare>v)v=Math.min(spare,_sl<=4?spare:v*2+2);
  var cap=AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1);
  // same end-of-auction read the bots get: when money outweighs the value
  // left on the board, banking it just donates it to the room
  if(AU.inflation>=1.15)v=Math.max(v,cap*0.75);
  return {worth:Math.max(1,Math.min(Math.round(v),cap)),needsIt:needsIt};
}
// Mac's line on the block: ONE short sentence - the number and one qualifier
// - and only at HIS moments. Editorial bar (owner: "que se meta cuando sea
// necesario"): mute during bot-vs-bot bidding; he speaks when the entry
// window opens (going once/twice) on a lot that is RELEVANT to you (fills a
// need, or its sticker sits inside your max bid), or the instant the live
// bid grazes his suggested ceiling - the two moments the number changes your
// decision. Irrelevant lots get silence; Sim already covers disinterest.
// Inflation still shapes the NUMBER itself via auMyWorth.
function auSageLine(p,lot){
  var w=auMyWorth(p);
  var myCap=AU.slotsLeft[MD.mySlot]>0?AU.budgets[MD.mySlot]-(AU.slotsLeft[MD.mySlot]-1):0;
  var relevant=w.needsIt||auValue(p)<=myCap;
  if(!relevant)return '';
  var moment=!lot||lot.going>=1||lot.bid+1>=w.worth||lot.holder===MD.mySlot&&lot.bid>=w.worth;
  if(!moment)return '';
  var line='Worth up to <b style="color:var(--accent-bright)">$'+w.worth+'</b> for you'+(w.needsIt?' · fills a starter spot':' · depth price');
  // FZ26: Mac anticipates the room's RB market with the SAME multiplier the
  // bots bid with (never a separate invented number) - one sober clause,
  // only when the gap actually moves the decision
  if(_mdFz26On()&&p.pos==='RB'){
    var _exp=Math.round(auValue(p)*(auValue(p)>=FZ26_RB_ELITE_AAV?FZ26_RB_PREM_ELITE:FZ26_RB_PREM));
    if(_exp>=w.worth+3)line+=' · this room pays up for RBs - expect $'+_exp+'ish';
  }
  if(lot&&lot.bid>=w.worth)line+=' · <span style="color:var(--yellow)">past your number</span>';
  return '<img src="/sage/sage-thinking-64.png" alt="" title="Mac\'s read" style="width:22px;height:22px;object-fit:contain;vertical-align:-6px;margin-right:5px" onerror="this.style.display=\'none\'">'+line;
}
// The lot card, Sleeper-clarity rules: the player and the PRICE own the
// screen, ONE unmissable primary action (BID $next), your money in a single
// legible line, everything else quiet. Classes live in theme.css (au-*).
function auRenderLot(){
  var box=document.getElementById('au-lot');if(!box)return;
  var lot=AU.lot;
  if(!lot){
    box.innerHTML=AU.nominator===MD.mySlot
      ?'<div class="au-card" style="border-color:var(--accent-bright);text-align:center">'
        +'<div style="font-family:var(--font-head);font-size:24px;font-weight:800;color:var(--text)">Your turn to nominate</div>'
        +'<div style="font-size:14px;color:var(--muted2);margin-top:6px">Tap the arrow on any player below - he opens on the block at $1.</div>'
        +'</div>'
      :'';
    return;
  }
  var p=lot.p;
  var mine=lot.holder===MD.mySlot;
  var holderName=mine?'YOU':((AU.bots[lot.holder]&&AU.bots[lot.holder].name)||('Team '+lot.holder));
  var canBid=AU.slotsLeft[MD.mySlot]>0&&!mine;
  var next=lot.bid+1;
  var myBudget=AU.budgets[MD.mySlot]||0,mySlots=AU.slotsLeft[MD.mySlot]||0;
  var myCap=mySlots>0?myBudget-(mySlots-1):0; // the budget law, pre-chewed: the #1 auction confusion, answered on screen
  var posC={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'}[p.pos]||'var(--muted2)';
  var srcNote=window._mdAav?'':' <span title="Live auction values are down; these are derived from ADP" style="color:var(--muted)">(derived)</span>';
  var goingTxt=lot.going===1?'going once':lot.going===2?'going twice':'';
  box.innerHTML='<div class="au-card" style="border-color:var(--accent-bright)">'
    +'<div class="au-lot-head">'
    +'<img class="au-face" src="'+mdFaceUrl(p)+'"'+(p.pos==='DEF'?' style="object-fit:contain;padding:8px"':'')+' onerror="this.style.visibility=\'hidden\'">'
    +'<div style="min-width:0;flex:1">'
    +'<div class="au-name">'+p.name+'</div>'
    +'<div class="au-sub"><b style="color:'+posC+'">'+p.pos+'</b> · '+(p.team||'FA')
    +((window._mdByes&&p.team&&window._mdByes[p.team])?' · BYE '+window._mdByes[p.team]:'')
    +' · AAV $'+auValue(p)+srcNote+'</div>'
    +'</div>'
    +'<div class="au-bidwrap">'
    +'<div class="au-bid-num'+(mine?' mine':'')+'">$'+lot.bid+'</div>'
    +'<div class="au-holder"'+(mine?' style="color:var(--green)"':'')+'>'+holderName+'</div>'
    +'</div></div>'
    // the bid clock as a bar + the BIG call: the entry window made visible.
    // Any bid resets it - so this IS "how long do I have to jump in"
    +'<div class="au-going"><span class="'+(lot.going>=1?'on1':'')+'"></span><span class="'+(lot.going>=2?'on2':'')+'"></span><span></span></div>'
    +(lot.going>=1?'<div class="au-goingtxt '+(lot.going>=2?'g2':'g1')+'">'+(lot.going>=2?'GOING TWICE':'GOING ONCE')+'</div>':'')
    // your money, pre-chewed - the #1 auction confusion answered on screen
    +'<div class="au-me">Max offer <b>$'+Math.max(0,myCap)+'</b> · Budget $'+myBudget+' · '+mySlots+' spots</div>'
    +(canBid
      ?(function(){
        // Yahoo-pattern offer controls: a stepper sets YOUR number (defaults
        // to the next increment), the ONE primary button offers it
        var eff=Math.min(Math.max(lot.bid+1,AU.custom||0),Math.max(1,myCap));
        return '<div class="au-offerrow">'
          +'<span class="au-step"><button class="au-stepbtn" onclick="auBumpCustom(-1)" title="Offer less">&minus;</button>'
          +'<span class="au-stepval">$'+eff+'</span>'
          +'<button class="au-stepbtn" onclick="auBumpCustom(1)" title="Offer more">+</button></span>'
          +(eff<=myCap&&eff>lot.bid
            ?'<button class="au-bid-btn" onclick="auOffer()">OFFER $'+eff+'</button>'
            :'<button class="au-bid-btn" disabled title="The budget law: every open roster spot keeps its $1">OFFER $'+eff+'</button>')
          +'</div>';
      })()
      +'<div class="au-quiet">'
      +'<input type="number" id="au-max" class="tm-input" placeholder="Max $" value="'+(lot.myMax||'')+'">'
      +'<button class="btn-sm" title="Limit bid: Mac bids +$1 for you up to this number, like a real auction proxy" onclick="auSetMax()">Max</button>'
      +'<span style="flex:1"></span>'
      // not your guy? skip the theater: the bots resolve the lot instantly
      // with the same logic, and a standing max keeps proxy-bidding for you
      +'<button class="btn-sm" title="'+(lot.myMax>0?'Skip the theater - resolve this lot instantly; your $'+lot.myMax+' max keeps bidding for you':'Skip the theater - resolve this lot instantly; you sit it out')+'" onclick="auSimLot()">'+(lot.myMax>0?'Sim (keeps your $'+lot.myMax+' max)':'Sim')+'</button>'
      +'<button class="btn-sm" title="Simulate every lot until your nomination - or until someone nominates a player from your queue" onclick="auSimToMyTurn()">Sim to my turn</button>'
      +'</div>'
      :(mine
        ?'<div class="au-quiet" style="margin-top:14px"><span style="font-size:14px;font-weight:700;color:var(--green)">The bid is yours - hold or wait it out.</span>'
        +'<span style="flex:1"></span>'
        +'<button class="btn-sm" title="Skip the going-once theater: resolve this lot instantly with the same logic" onclick="auSimLot()">Sim</button></div>'
        :(mySlots<=0?'<div class="au-quiet" style="margin-top:14px"><span style="font-size:14px;color:var(--muted2)">Your roster is full - watching the room play out.</span></div>':'')))
    +'</div>';
  try{_auRenderMHead();}catch(_){}  // the phone pill mirrors every lot state
}
// The budgets column, Yahoo-pattern: one compact row per team, the live bid
// riding as a badge on the CURRENT HIGH BIDDER (the $1 open naturally sits
// on the nominator). Numbers people actually use - budget left, and the max
// bid on hover/tap - nothing else.
function auRenderBudgets(){
  var box=document.getElementById('au-budgets');if(!box)return;
  // the static shell laid this container out as a pill row; the column owns
  // its own layout now
  box.style.display='block';box.style.gap='';
  var rows='';
  // You FIRST and highlighted, then the room in seat order; every row shows
  // dollars left AND picks made (N/rounds)
  var _ord2=[MD.mySlot];
  for(var s0=1;s0<=MD.teams;s0++)if(s0!==MD.mySlot)_ord2.push(s0);
  _ord2.forEach(function(s){
    var b=AU.budgets[s],sl=AU.slotsLeft[s];
    var mine=s===MD.mySlot;
    var nm=mine?'You':((AU.bots[s]&&AU.bots[s].name)||('Team '+s));
    var perSlot=sl>0?(b-(sl-1)):0;
    var hb=AU.lot&&AU.lot.holder===s;
    rows+='<div class="au-brow'+(mine?' me':'')+(sl<=0?' out':'')+'" title="'+nm+': $'+b+' left · '+sl+' spots · max bid $'+Math.max(0,perSlot)+'">'
      +'<span class="au-bname">'+nm+'</span>'
      +(hb?'<span class="au-bbadge">$'+AU.lot.bid+'</span>':'')
      +'<span class="au-bcount">'+(MD.rounds-sl)+'/'+MD.rounds+'</span>'
      +'<span class="au-bmoney">$'+b+'</span>'
      +'</div>';
  });
  box.innerHTML='<div class="au-bwrap"><div class="au-bhd">Budgets</div>'+rows+'</div>';
}
function auRenderSold(){
  var wrap=document.getElementById('au-sold-wrap'),box=document.getElementById('au-sold');
  if(!wrap||!box)return;
  // the sold ticker is the History TAB's content now - visible only there
  if(!AU.sold.length||(AU.tab&&AU.tab!=='history')){wrap.style.display='none';return;}
  wrap.style.display='block';
  box.style.fontSize='14px'; // the shell says 12px; the room's floor is 14
  box.innerHTML=AU.sold.slice(0,40).map(function(x){
    var d=x.price-x.value;
    var tag=d>=3?'<span style="color:var(--red)">+$'+d+' over</span>':d<=-3?'<span style="color:var(--green)">$'+(-d)+' under</span>':'<span style="color:var(--muted)">fair</span>';
    var who=x.slot===MD.mySlot?'YOU':((AU.bots[x.slot]&&AU.bots[x.slot].name)||('T'+x.slot));
    return '<div style="display:flex;gap:8px;align-items:baseline">'+mdPosTag(x.p.pos)+' <b style="color:var(--text)">'+x.p.name+'</b>'
      +'<span style="flex:1"></span>'
      +'<span style="font-variant-numeric:tabular-nums;font-weight:700;color:var(--text)">$'+x.price+'</span>'
      +'<span style="color:var(--muted)">'+who+'</span> '+tag+'</div>';
  }).join('');
}
// The SOLD moment: a brief centered splash - big word, face, price, buyer -
// then gone (1.5s; CSS animation, cut dead under prefers-reduced-motion).
// Suppressed during multi-lot sims so ten sales don't strobe the screen.
function auSoldSplash(p,price,who){
  try{
    var old=document.getElementById('au-splash');if(old)old.remove();
    var d=document.createElement('div');
    d.id='au-splash';d.className='au-splash';
    d.innerHTML='<div class="card"><div class="s1">SOLD</div>'
      +'<img src="'+mdFaceUrl(p)+'" onerror="this.style.visibility=\'hidden\'">'
      +'<div class="s2">'+p.name+'</div>'
      +'<div class="s3">$'+price+' · '+who+'</div></div>';
    document.body.appendChild(d);
    setTimeout(function(){try{d.remove();}catch(_){}},1500);
  }catch(_){}
}
function auFinish(){
  AU.active=false;AU.lot=null;
  if(AU.stepT)clearTimeout(AU.stepT);
  if(AU.pillT){clearInterval(AU.pillT);AU.pillT=null;}
  MD.onClock=false;
  // clear the frozen last-lot card - the sold list below is the record
  var _lb=document.getElementById('au-lot');if(_lb)_lb.innerHTML='';
  MD.pickIdx=MD.order.length; // mdFinish treats the draft as complete
  mdFinish();
}
function mdConfirmDraft(){
  var p=MD.selChoice;
  if(!p)return;
  MD.selChoice=null;
  var bar=document.getElementById('md-draftbar');if(bar)bar.style.display='none';
  if(AU.active){auUserNominate(p);return;} // auction: confirming NOMINATES
  if(MP.active){mpBoardPick(p);return;}
  // pin the viewport: the pick re-renders half the page and the browser's
  // scroll anchoring was yo-yoing the screen down and back up. The peek panel
  // also stays put (stable height) instead of collapsing.
  var _sy=window.scrollY;
  mdUserPick(p);
  requestAnimationFrame(function(){window.scrollTo(0,_sy);});
  setTimeout(function(){window.scrollTo(0,_sy);},120);
}
// Undo back through your last pick: AI picks after it come back too
function mdUndo(){
  if(MP.active)return; // live rooms: picks are final, like a real draft
  if(AU.active)return; // auction: a sale is a sale - money moved, no undo
  if(MD.pickIdx>=MD.order.length)return; // draft graded and saved: no rewind
  if(!MD.picks||!MD.picks.some(function(pk){return pk.mine;}))return;
  mdStopClock();
  var undone=0;
  while(MD.picks.length){
    var pk=MD.picks.pop();
    MD.pool.push(pk.p);undone++;
    // bot bookkeeping must rewind too: leaving the popped player counted in
    // aiRosters made bots skip positions they no longer owned (a phantom QB1
    // meant that seat never drafted a real one)
    if(!pk.mine&&MD.aiRosters[pk.slot]){
      var _ur=MD.aiRosters[pk.slot];
      _ur[pk.p.pos]=Math.max(0,(_ur[pk.p.pos]||0)-1);
      var _ui=_ur.list.indexOf(pk.p);if(_ui>=0)_ur.list.splice(_ui,1);
    }
    if(pk.mine){
      MD.mine.pop();MD.myOveralls.pop();
      break;
    }
  }
  MD.pool.sort(function(a,b){return (b.dv||0)-(a.dv||0);});
  MD.pickIdx-=undone;
  MD.onClock=true;
  MD.curRound=Math.floor(MD.pickIdx/MD.teams)+1;
  MD.selChoice=null;
  mdRenderBoard();
  mdShowChoices(MD.curRound);
  mdStartClock();
  try{sndPickSoft();}catch(_){}
}
// Click any filled board cell to change who went there (mock your real league)
function mdEditPick(round,slot){
  if(MP.active)return; // live rooms: the server owns the board
  var pk=(MD.picks||[]).find(function(x){return x.round===round&&x.slot===slot;});
  if(!pk)return;
  var m=document.getElementById('md-edit-modal');
  if(m)m.remove();
  m=document.createElement('div');
  m.id='md-edit-modal';
  m.style.cssText='position:fixed;inset:0;z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px;background:rgba(5,4,12,.6);backdrop-filter:blur(6px)';
  m.innerHTML='<div class="cm-card" style="max-width:380px">'
    +'<button class="cm-x" onclick="document.getElementById(\'md-edit-modal\').remove()">&times;</button>'
    +'<div class="cm-title" style="font-size:16px">Change pick '+round+'.'+(pk.pickNo<10?'0':'')+pk.pickNo+'</div>'
    +'<div class="cm-sub">'+pk.p.name+' goes back in the pool. Who was really taken?</div>'
    +'<input type="text" id="md-edit-q" class="tm-input" style="width:100%;margin-top:12px" placeholder="Search available players..." autocomplete="off">'
    +'<div id="md-edit-list" style="margin-top:8px;max-height:260px;overflow-y:auto"></div></div>';
  m.addEventListener('click',function(e){if(e.target===m)m.remove();});
  document.body.appendChild(m);
  var inp=document.getElementById('md-edit-q');
  function renderList(){
    var q=inp.value.toLowerCase().trim();
    var hits=MD.pool.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;}).slice(0,10);
    document.getElementById('md-edit-list').innerHTML=hits.map(function(p,i){
      return '<div class="cm-league" data-ei="'+i+'"><div style="display:flex;align-items:center;gap:8px">'
        +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'">'
        +'<div><div class="cm-lname">'+p.name+'</div><div class="cm-lmeta">'+p.pos+' · '+(p.team||'FA')+'</div></div></div>'
        +'<span style="color:var(--muted)">&rsaquo;</span></div>';
    }).join('')||'<div style="padding:10px 2px;font-size:11.5px;color:var(--muted)">No available player matches.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('#md-edit-list [data-ei]'),function(el){
      el.onclick=function(){mdApplyEdit(pk,hits[parseInt(el.dataset.ei)]);};
    });
  }
  inp.oninput=renderList;
  renderList();
  setTimeout(function(){inp.focus();},60);
}
function mdApplyEdit(pk,cand){
  if(!cand)return;
  var em=document.getElementById('md-edit-modal');if(em)em.remove();
  MD.pool.splice(MD.pool.indexOf(cand),1);
  MD.pool.push(pk.p);
  MD.pool.sort(function(a,b){return (b.dv||0)-(a.dv||0);});
  if(pk.mine){
    var mi=MD.mine.indexOf(pk.p); if(mi>=0)MD.mine[mi]=cand;
    var mo=MD.myOveralls.find(function(x){return x.p===pk.p;}); if(mo)mo.p=cand;
  }else if(MD.aiRosters[pk.slot]){
    // keep the bot's own books straight: swap the position counts and the
    // roster list, or the seat drafts the rest of the room around a player
    // it no longer owns
    var _er=MD.aiRosters[pk.slot];
    _er[pk.p.pos]=Math.max(0,(_er[pk.p.pos]||0)-1);
    _er[cand.pos]=(_er[cand.pos]||0)+1;
    var _ei=_er.list.indexOf(pk.p);if(_ei>=0)_er.list[_ei]=cand;
  }
  pk.p=cand;
  mdRenderBoard();
  if(MD.onClock||AU.active)mdShowChoices(MD.curRound||1);
}
function mdRenderMine(){
  var byPos={QB:[],RB:[],WR:[],TE:[]};
  MD.mine.forEach(function(p){(byPos[p.pos]||(byPos[p.pos]=[])).push(p);});
  // Stacked-style slot counters: the connected league's lineup shape when it
  // drives the room, the standard lineup otherwise. RB/WR/TE overflow spills
  // into FLEX before it counts as bench.
  try{
    var needsEl=document.getElementById('md-needs');
    if(needsEl){
      var lf=(localStorage.getItem('tm_mock_uselg')!=='0'&&window.leagueFormat)?window.leagueFormat:null;
      var slots={
        QB:lf?((lf.numQBs||1)+(lf.hasSuperFlex?1:0)):(MD.sf?2:1),
        RB:lf?(lf.numRBs||2):2,WR:lf?(lf.numWRs||2):2,TE:lf?(lf.numTEs||1):1,
        FLEX:lf?((lf.flexCount||0)+(lf.recFlexCount||0)):1,
        K:MD.noK?0:1,DEF:MD.noD?0:1
      };
      var have={QB:0,RB:0,WR:0,TE:0,K:0,DEF:0};
      MD.mine.forEach(function(p){if(have[p.pos]!=null)have[p.pos]++;});
      var flexFill=0;
      ['RB','WR','TE'].forEach(function(ps){
        var ov=have[ps]-slots[ps];
        if(ov>0)flexFill=Math.min(slots.FLEX,flexFill+ov);
      });
      var posC={QB:'var(--pos-qb)',RB:'var(--pos-rb)',WR:'var(--pos-wr)',TE:'var(--pos-te)',K:'var(--pos-k)',DEF:'var(--pos-def)',FLEX:'var(--accent-bright)'};
      var chips=['QB','RB','WR','TE','FLEX','K','DEF'].filter(function(ps){return slots[ps]>0;}).map(function(ps){
        var h=ps==='FLEX'?flexFill:Math.min(have[ps],slots[ps]);
        var full=h>=slots[ps];
        // every real position counter is a shortcut into the list's filter;
        // FLEX spans three positions, so it stays display-only
        var click=ps==='FLEX'?'':' title="Show available '+ps+'s" onclick="mdNeedsFilter(\''+ps+'\')"';
        return '<span'+click+' style="padding:2px 7px;border-radius:100px;border:1px solid '+(full?posC[ps]:'var(--border)')+';color:'+(full?posC[ps]:'var(--muted)')+(click?';cursor:pointer':'')+'">'+ps+' '+h+'/'+slots[ps]+'</span>';
      });
      // three or more of your picks sharing one bye week is a real Sunday
      // problem - say it while there is still time to draft around it
      var bys=window._mdByes;
      if(bys){
        var bc={};MD.mine.forEach(function(p){var w=p.team?bys[p.team]:null;if(w)bc[w]=(bc[w]||0)+1;});
        Object.keys(bc).forEach(function(w){
          if(bc[w]>=3)chips.push('<span title="'+bc[w]+' of your picks share the week '+w+' bye" style="padding:2px 7px;border-radius:100px;border:1px solid #f87171;color:#f87171">BYE '+w+' &times;'+bc[w]+'</span>');
        });
      }
      needsEl.innerHTML=chips.join('');
      // ── Yahoo-pattern ROSTER STRIP (phone; CSS hides it on desktop where
      // the rails carry this): every lineup slot as a chip - empty = the
      // position initials in its color, filled = the player's FACE with a
      // position tick. One glance answers "what do I still need". Tap opens
      // My team. Shared by snake and auction (the shape math above is the
      // same); bench slots fill the remaining rounds.
      try{
        var _hostS=document.getElementById('md-board');
        if(_hostS&&_hostS.insertAdjacentHTML&&!document.getElementById('md-rstrip')){
          _hostS.insertAdjacentHTML('beforeend','<div id="md-rstrip" title="My team" onclick="AU.active?auSetRTab(\'team\'):mdShowMyRoster()"></div>');
        }
        var _strip=document.getElementById('md-rstrip');
        if(_strip){
          // shared shape/assignment with the Rosters table (_auSlotAssign);
          // your picks carry .p in snake AND auction, and the auction ones
          // carry the buy GRADE, which rides the face as a mini badge
          var _open=_auSlotAssign((MD.picks||[]).filter(function(pk){return pk.mine;}));
          var _pcS={QB:'var(--pos-qb)',RB:'var(--pos-rb)',WR:'var(--pos-wr)',TE:'var(--pos-te)',K:'var(--pos-k)',DEF:'var(--pos-def)',FLEX:'var(--accent-bright)',BN:'var(--muted)'};
          _strip.innerHTML=_open.map(function(o){
            if(!o.pk)return '<span class="rs-slot" style="color:'+(_pcS[o.l]||'var(--muted)')+'">'+o.l+'</span>';
            var pl=o.pk.p;
            return '<span class="rs-slot filled" title="'+o.l+': '+pl.name.replace(/"/g,'&quot;')+(o.pk.grade?' ('+o.pk.grade+')':'')+'">'
              +'<img src="'+mdFaceUrl(pl)+'" onerror="this.style.visibility=\'hidden\'">'
              +'<i style="background:'+(_pcS[pl.pos]||'var(--muted)')+'"></i>'
              +(o.pk.grade?'<b class="rs-g">'+o.pk.grade+'</b>':'')
              +'</span>';
          }).join('');
          _strip.classList.toggle('in-au',!!AU.active);
        }
      }catch(_){}
    }
  }catch(_){}
  var _mdMine=document.getElementById('md-mine');if(_mdMine)_mdMine.innerHTML=['QB','RB','WR','TE','K','DEF'].filter(function(pos){return byPos[pos]&&byPos[pos].length;}).map(function(pos){
    return '<div style="margin-bottom:6px"><span style="font-size:10px;font-weight:700;color:var(--muted);margin-right:6px">'+pos+'</span>'
      +byPos[pos].map(function(p){var _e=p.name.replace(/'/g,"\\'");return '<span onclick="openPlayerCard(\''+p.id+'\',\''+_e+'\')" title="View player card" style="display:inline-flex;align-items:center;gap:6px;background:var(--surface3);border-radius:100px;padding:3px 12px 3px 3px;font-size:12px;font-weight:600;color:var(--text);margin:2px;cursor:pointer"><img src="'+mdFaceUrl(p)+'" style="width:24px;height:24px;border-radius:50%;object-fit:'+(p.pos==='DEF'?'contain':'cover')+'" onerror="this.style.visibility=\'hidden\'">'+p.name+'</span>';}).join('')+'</div>';
  }).join('');
}
function mdRenderLog(){
  var _mdLog=document.getElementById('md-log');if(_mdLog)_mdLog.innerHTML=MD.log.slice(0,50).map(function(l){return '<div style="padding:2px 0">'+l+'</div>';}).join('');
}
// Sleeper-style draft board: teams across the top, rounds down the side
function _mdPaintViewBtns(v){
  document.querySelectorAll('.md-view-btn').forEach(function(b){
    var on=b.dataset.view===v;
    b.style.background=on?'var(--accent-bright)':'none';
    b.style.color=on?'#0d0817':'var(--muted2)';
  });
}
function mdSetView(v){
  MD.viewMode=v;
  try{localStorage.setItem('tm_md_view',v);}catch(_){}
  _mdPaintViewBtns(v);
  mdRenderBoard();
}
function mdRenderBoard(){
  var el=document.getElementById('md-draftboard');
  if(!el)return;
  if(!MD.teams){el.innerHTML='';return;}
  // Desktop opens on the snake BOARD - the war-room view - while phones keep
  // the list, where a 12-column grid is unreadable. A saved choice always wins.
  if(!MD.viewMode){MD.viewMode=localStorage.getItem('tm_md_view')||(window.innerWidth>=900?'board':'list');}
  _mdPaintViewBtns(MD.viewMode);
  var bdEl=document.getElementById('md-board');
  if(bdEl)bdEl.classList.toggle('listmode',MD.viewMode==='list');
  // Yahoo-style list: YOUR TEAM + the pick feed pinned in a left rail while
  // the available players stay on the right - both visible at once
  if(MD.viewMode==='list'){
    var pcL={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'};
    // MY TEAM block on top of the rail: roster so far, grouped by position
    var myByPos={};
    MD.mine.forEach(function(p){(myByPos[p.pos]=myByPos[p.pos]||[]).push(p);});
    var myRows=['QB','RB','WR','TE','K','DEF'].filter(function(ps){return myByPos[ps];}).map(function(ps){
      return '<div style="display:flex;gap:8px;padding:3px 12px;font-size:12px;align-items:baseline">'
        +'<span style="width:30px;font-size:9.5px;font-weight:800;color:'+(pcL[ps]||'var(--muted)')+'">'+ps+'</span>'
        +'<span style="color:var(--text)">'+myByPos[ps].map(function(p){return p.name;}).join(', ')+'</span></div>';
    }).join('');
    var out='<div style="padding:8px 0 4px;border-bottom:1px solid var(--border);margin-bottom:2px">'
      +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;padding:0 12px 4px">My team ('+MD.mine.length+')</div>'
      +(myRows||'<div style="padding:0 12px;font-size:11.5px;color:var(--muted)">No picks yet - your players land here.</div>')
      +'</div>'
      +'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:8px 12px 0">Draft feed</div>';
    var lastRound=0;
    MD.picks.forEach(function(pk){
      if(pk.round!==lastRound){lastRound=pk.round;out+='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:10px 12px 4px">Round '+pk.round+'</div>';}
      var nmE=pk.p.name.replace(/'/g,"\\'");
      out+='<div style="display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px solid var(--border)'+(pk.mine?';background:var(--accent-dim)':'')+'">'
        +'<span style="width:38px;font-size:10.5px;color:var(--muted)">'+pk.round+'.'+(pk.pickNo<10?'0':'')+pk.pickNo+'</span>'
        +'<img src="'+mdFaceUrl(pk.p)+'" style="width:26px;height:26px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="openPlayerCard(\''+pk.p.id+'\',\''+nmE+'\')" onerror="this.style.visibility=\'hidden\'">'
        +'<span style="flex:1;font-size:12.5px;font-weight:'+(pk.mine?'800':'600')+';cursor:pointer" onclick="openPlayerCard(\''+pk.p.id+'\',\''+nmE+'\')">'+pk.p.name+(pk.mine?' <span style="font-size:9px;color:var(--accent-bright)">YOU</span>':'')+'</span>'
        +'<span style="font-size:9.5px;font-weight:800;color:'+(pcL[pk.p.pos]||'var(--muted)')+'">'+pk.p.pos+'</span>'
        +'<span style="font-size:10px;color:var(--muted)">'+(pk.mine?'':((MD.bots&&MD.bots[pk.slot]&&MD.bots[pk.slot].name)||pk.p.team||''))+'</span></div>';
    });
    if(MD.pickIdx<MD.order.length){
      var upSlot=MD.order[MD.pickIdx];
      out+='<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px dashed var(--accent-bright);border-radius:8px;margin:6px 8px">'
        +'<span style="font-size:11px;font-weight:700;color:var(--accent-bright)">ON THE CLOCK</span>'
        +'<span style="font-size:11.5px;color:var(--muted2)">'+(upSlot===MD.mySlot?'YOU':((MD.bots&&MD.bots[upSlot]&&MD.bots[upSlot].name)||'Team '+upSlot))+'</span></div>';
    }
    el.innerHTML='<div class="md-rail-scroll">'+out+'</div>';
    // newest pick stays in view inside the rail
    try{var rs=el.querySelector('.md-rail-scroll');if(rs)rs.scrollTop=rs.scrollHeight;}catch(_){}
    mdRenderQueue();
    return;
  }
  // Position colour lives in CSS now (theme.css .pos-XX custom properties):
  // the cell declares its position once and the edge, tint and sub-line all
  // read from it. One accent on the whole board: the ON THE CLOCK cell.
  var byCell={};
  MD.picks.forEach(function(pk){byCell[pk.round+'-'+pk.slot]=pk;});
  var lastPk=MD.picks[MD.picks.length-1];
  // Columns get a real minimum width (Stacked proportions): on narrow screens
  // the wrap scrolls sideways instead of crushing every cell
  var html='<div class="mdb-grid" style="grid-template-columns:34px repeat('+MD.teams+',minmax(96px,1fr))">';
  html+='<div class="mdb-corner"></div>';
  for(var t=1;t<=MD.teams;t++){
    var me=t===MD.mySlot;
    var hb=(MD.bots&&MD.bots[t]&&MD.bots[t].name)||('Team '+t);
    var ini=me?'Y':hb.charAt(0).toUpperCase();
    html+='<div class="mdb-head'+(me?' mdb-me':'')+'" title="'+hb+'"><span class="mdb-avatar">'+ini+'</span><span class="mdb-teamname">'+(me?'You':hb)+'</span></div>';
  }
  var roundsDone=Math.max(1,Math.ceil(Math.max(1,MD.picks.length+1)/MD.teams));
  var showRounds=Math.min(MD.rounds,roundsDone);
  for(var r=1;r<=showRounds;r++){
    html+='<div class="mdb-round">R'+r+'</div>';
    for(var s2=1;s2<=MD.teams;s2++){
      var pk=byCell[r+'-'+s2];
      var me2=s2===MD.mySlot;
      if(!pk){
        var isNext=MD.pickIdx<MD.order.length&&MD.order[MD.pickIdx]===s2&&(Math.floor(MD.pickIdx/MD.teams)+1)===r;
        html+='<div class="mdb-cell mdb-empty'+(me2?' mdb-mecol':'')+(isNext?' mdb-onclock':'')+'">'+(isNext?'<span>ON THE CLOCK</span>':'')+'</div>';
      } else {
        var pos=pk.p.pos;
        var isLast=lastPk&&pk===lastPk;
        // Landscape cells, Stacked density: face left (owner's call - the
        // board must SHOW the players), pick number top-right, name up to two
        // lines, pos + team below. The newest pick locks in with the brand's
        // gradient sweep (mdb-latest).
        html+='<div class="mdb-cell mdb-pk pos-'+pos+(pk.mine?' mdb-minepick':'')+(isLast?' mdb-latest':'')+'" title="Click to change this pick" onclick="mdEditPick('+r+','+s2+')">'
          +'<div class="mdb-pickno">'+pk.round+'.'+(pk.pickNo<10?'0':'')+pk.pickNo+'</div>'
          +'<img class="mdb-face" src="'+mdFaceUrl(pk.p)+'" loading="lazy" onerror="this.style.visibility=\'hidden\'"'+(pk.p.pos==='DEF'?' style="object-fit:contain;padding:2px"':'')+'>'
          +'<div class="mdb-namewrap"><div class="mdb-name">'+pk.p.name+'</div>'
          +'<div class="mdb-sub">'+pos+' <span style="color:var(--muted)">'+(pk.p.team||'FA')+'</span></div></div>'
          +'</div>';
      }
    }
  }
  html+='</div>';
  el.innerHTML=html;
  // keep the newest round in view
  el.scrollTop=el.scrollHeight;
  mdRenderQueue();
}

// ── PUBLIC MULTIPLAYER DRAFT ROOMS (beta) ───────────────────────────────────────
// The room state lives on the server; the DRAFT UI is the exact same board,
// Mac box, available-players grid and draft bar as the solo mock. MP.active
// flips the shared MD engine into "server owns the truth" mode.
var MP={code:null,seat:null,isHost:false,myName:'',lobbySig:'',timer:null,tick:null,active:false,deadline:0,wasMy:false,lastSig:'',myPickCount:0};
function _mpCid(){
  var c=localStorage.getItem('tm_client_id');
  if(!c){c='c'+Math.random().toString(36).slice(2,12)+Date.now().toString(36);localStorage.setItem('tm_client_id',c);}
  return c;
}
function _mpStep(step){
  ['mp-choose','mp-lobby','mp-bar'].forEach(function(id){
    var el=document.getElementById(id);if(!el)return;
    el.style.display=(id==='mp-'+step)?(id==='mp-bar'?'flex':'block'):'none';
  });
}
function mpShowJoin(){
  var r=document.getElementById('mp-join-row');
  if(r){r.style.display='flex';var i=document.getElementById('mp-join-code');if(i)i.focus();}
}
// The name a person shows up as in the room. No account required - it reads the
// in-page field first, falls back to a saved username, and if BOTH are empty it
// focuses the field with a hint instead of firing a fragile browser prompt().
function _mpName(){
  var el=document.getElementById('mp-name');
  var v=((el&&el.value)||localStorage.getItem('tm_username')||'').trim().slice(0,24);
  if(!v){
    if(el){el.focus();el.style.borderColor='var(--accent-bright)';}
    var h=document.getElementById('mp-name-hint');if(h)h.style.display='block';
    return null;
  }
  var h2=document.getElementById('mp-name-hint');if(h2)h2.style.display='none';
  return v;
}
function _mpPool(){
  return Object.values(allPlayers)
    .filter(function(p){return (ktcById[p.id]||0)>800&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;})
    .sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);})
    .slice(0,240).map(function(p){return {id:p.id,name:p.name,pos:p.pos,team:p.team,v:ktcById[p.id]||0};});
}
async function mpCreate(){
  if(MP.code)return;
  await ensurePlayersLoaded();
  if(!Object.keys(ktcById).length){try{await fetchKtcValues(1,1,leagueMode!=='redraft');}catch(_){}}
  var pool=_mpPool();
  if(pool.length<80){alert('Values are still loading - try again in a few seconds.');return;}
  var nm=_mpName();if(nm===null)return;
  var r=await fetch('/api/room/create',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({teams:parseInt((document.getElementById('md-teams')||{}).value)||10,
      rounds:parseInt((document.getElementById('md-rounds')||{}).value)||8,
      clock:parseInt((document.getElementById('md-clock')||{}).value)||60,
      name:nm,cid:_mpCid(),pool:pool})});
  var d=await r.json();
  if(!r.ok){alert(d.error||'Could not create room');return;}
  MP.code=d.code;MP.seat=d.seat;MP.isHost=!!d.host;MP.myName=nm;
  mpPoll();_mpSchedule(2000);
}
async function mpJoin(){
  if(MP.code)return;
  var code=((document.getElementById('mp-join-code')||{}).value||'').toUpperCase().trim();
  if(code.length!==4){alert('Enter the 4-letter room code.');return;}
  var nm=_mpName();if(nm===null)return;
  var r=await fetch('/api/room/'+code+'/join',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:nm,cid:_mpCid()})});
  var d=await r.json();
  if(!r.ok){alert(d.error||'Could not join');return;}
  MP.code=code;MP.seat=d.seat;MP.isHost=!!d.host;MP.myName=nm;
  mpPoll();_mpSchedule(2000);
}
// Host-only: remove someone from a seat so it opens back up.
async function mpKick(i){
  if(!MP.isHost||!MP.code)return;
  var r=await fetch('/api/room/'+MP.code+'/kick',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cid:_mpCid(),seat:i})});
  var d=null;try{d=await r.json();}catch(_){}
  if(!r.ok){alert((d&&d.error)||'Could not remove that seat.');}
  MP.lobbySig='';mpPoll();
}
// Set (or change) your display name from the lobby without moving seats.
async function mpRename(name){
  name=(name||'').trim().slice(0,24);
  if(!name||!MP.code||MP.seat==null)return;
  MP.myName=name;
  try{await fetch('/api/room/'+MP.code+'/seat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({cid:_mpCid(),seat:MP.seat,name:name})});}catch(_){}
  MP.lobbySig='';mpPoll();
}
// Sleeper-style: click an open draft slot in the lobby to take (or move to) it.
async function mpClaimSeat(i){
  if(!MP.code||i===MP.seat)return;
  var nm=localStorage.getItem('tm_username')||'';
  var body={cid:_mpCid(),seat:i};if(nm)body.name=nm;
  var r=await fetch('/api/room/'+MP.code+'/seat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d=null;try{d=await r.json();}catch(_){}
  if(!r.ok){alert((d&&d.error)||'That seat was just taken.');mpPoll();return;}
  MP.seat=d.seat;if(d.host!=null)MP.isHost=!!d.host;
  try{sndPickSoft();}catch(_){}
  mpPoll();
}
function mpCopyCode(){
  try{navigator.clipboard.writeText(MP.code);}catch(_){}
  var b=document.getElementById('mp-copy-btn');if(b){b.textContent='Copied';setTimeout(function(){b.textContent='Copy code';},1500);}
}
// A one-click join link for friends: opening it drops them straight into the
// friends section and joins this room (see the _mpAutoJoin reader on load).
function mpInviteLink(){return location.origin+'/mock?room='+(MP.code||'');}
function mpCopyLink(){
  var link=mpInviteLink();
  try{navigator.clipboard.writeText(link);}catch(_){}
  var b=document.getElementById('mp-link-btn');
  if(b){var o=b.textContent;b.textContent='Link copied - paste it to your friends';setTimeout(function(){b.textContent=o;},1800);}
}
function mpLeave(){
  if(MP.timer)clearInterval(MP.timer);
  if(MP.tick)clearInterval(MP.tick);
  var wasActive=MP.active;
  MP={code:null,seat:null,isHost:false,myName:'',lobbySig:'',timer:null,tick:null,active:false,deadline:0,wasMy:false,lastSig:'',myPickCount:0};
  _mpStep('choose');
  var _mph2=document.getElementById('mp-card-header');if(_mph2)_mph2.style.display='';
  var jr=document.getElementById('mp-join-row');if(jr)jr.style.display='none';
  if(wasActive){
    var bd=document.getElementById('md-board');if(bd){bd.style.display='none';bd.dataset.live='0';}
    var ub=document.getElementById('md-undo-btn');if(ub)ub.style.display='';
    var ft=document.getElementById('md-foot');if(ft)ft.style.display='flex';
    document.querySelectorAll('.md-solo-ctl').forEach(function(b){b.style.display='';});
    var sg=document.getElementById('md-sage');if(sg)sg.style.display='none';
  }
  try{mdShowSection('friends');}catch(_){}
}
async function mpStart(){
  await fetch('/api/room/'+MP.code+'/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cid:_mpCid(),seat:MP.seat})});
  mpPoll();
}
async function mpPause(){
  await fetch('/api/room/'+MP.code+'/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cid:_mpCid(),seat:MP.seat})});
  mpPoll();
}
async function mpResume(){
  await fetch('/api/room/'+MP.code+'/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cid:_mpCid(),seat:MP.seat})});
  mpPoll();
}
// Your pick, sent to the server. The next poll paints it onto the board.
async function mpBoardPick(p){
  var r=await fetch('/api/room/'+MP.code+'/pick',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({seat:MP.seat,playerId:p.id})});
  var d=null;try{d=await r.json();}catch(_){}
  if(!r.ok){alert((d&&d.error)||'Pick did not go through - it may not be your turn anymore.');mpPoll();return;}
  try{sndImpact();}catch(_){}
  // Mac's take, same rule as solo: agreeing with his rec is never a reach
  try{
    var sg=document.getElementById('md-sage');
    var take=(MD.lastRec&&MD.lastRec.id===p.id)
      ?('Exactly what I wanted. '+(MD.lastRecWhy||''))
      :('Noted. I leaned '+(MD.lastRec?MD.lastRec.name:'elsewhere')+', but '+p.name+' is your call to make - live drafts are won on conviction.');
    if(sg){
      // Mac's reaction rides his discreet face: one-sentence essence when
      // collapsed (steals cheer, reaches wince), the full take on tap
      var _rFace=/^Steal|^Exactly what I wanted/.test(take)?'excited':/^A reach/.test(take)?'skeptical':'thinking';
      var _rEss=(take.split('. ')[0]||'').slice(0,120);if(_rEss&&!/[.!]$/.test(_rEss))_rEss+='.';
      mdMacSay(_rEss,'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">Mac on your pick</div><div style="font-size:12.5px;color:var(--muted2);line-height:1.55">'+take+'</div>',{face:_rFace});
    }
  }catch(_){}
  MD.onClock=false;
  var ch=document.getElementById('md-choices');if(ch)ch.innerHTML='';
  mpPoll();
}
// Poll cadence: quick while the draft is live so picks land on other devices
// almost instantly, relaxed in the lobby to save requests.
function _mpSchedule(ms){
  if(MP.timer)clearInterval(MP.timer);
  MP.pollMs=ms;
  MP.timer=setInterval(mpPoll,ms);
}
function _mpPaintClock(){
  var left=MP.deadline?Math.max(0,Math.ceil((MP.deadline-Date.now())/1000)):0;
  var el=document.getElementById('mp-clock');
  if(el)el.innerHTML=MP.deadline?_clockPillHtml(left):'';
  var mc=document.getElementById('md-clk');
  if(mc&&MP.active)mc.innerHTML=MP.deadline?_clockPillHtml(left):'';
  // clock sounds only when it is YOUR pick - watching others stays silent
  if(MD.onClock&&MP.deadline&&left>0&&left!==MP._lastTickSec){
    MP._lastTickSec=left;
    try{
      if(left<=10)sndClockUrgent();
      else if(left<=30&&left%10===0)sndClockTick();
    }catch(_){}
  }
}
// Rebuild the shared MD state from the server doc and let the normal solo
// renderers draw it - identical board, identical feel.
function mpSync(d){
  if(!MP.active){
    MP.active=true;
    if(MP.pollMs!==1000)_mpSchedule(1000); // live draft: near-instant cross-device
    try{mdShowSection('friends');}catch(_){}
    // Drafting now: the big "Draft with friends" title is redundant, drop it so
    // the board gets the room back (especially tight on phones).
    var _mph=document.getElementById('mp-card-header');if(_mph)_mph.style.display='none';
    _mpStep('bar');
    var st=document.getElementById('md-setup');if(st)st.style.display='none';
    var bd=document.getElementById('md-board');if(bd){bd.style.display='block';bd.dataset.live='1';}
    var ub=document.getElementById('md-undo-btn');if(ub)ub.style.display='none';
    var ft=document.getElementById('md-foot');if(ft)ft.style.display='none';
    document.querySelectorAll('.md-solo-ctl').forEach(function(b){b.style.display='none';});
    mdStopClock();
    if(!MP.tick)MP.tick=setInterval(_mpPaintClock,1000);
  }
  MD.teams=d.teams;MD.rounds=d.rounds;MD.mySlot=MP.seat+1;
  MD.bots={}; // live rooms have real people, never leftover solo bot names
  MD.scoring=1;MD.sf=false;MD.posFilter=MD.posFilter||'';
  MD.order=[];
  for(var r0=0;r0<d.rounds;r0++){for(var s=1;s<=d.teams;s++)MD.order.push(r0%2===0?s:d.teams+1-s);}
  MD.pool=(d.pool||[]).map(function(p){return {id:p.id,name:p.name,pos:p.pos,team:p.team,dv:p.v||0};});
  MD.picks=(d.picks||[]).map(function(pk,i){
    return {slot:pk.seat+1,round:Math.floor(i/d.teams)+1,pickNo:(i%d.teams)+1,
      p:{id:pk.id,name:pk.name,pos:pk.pos,team:pk.team,dv:0},mine:pk.seat===MP.seat};
  });
  MD.mine=MD.picks.filter(function(pk){return pk.mine;}).map(function(pk){return pk.p;});
  MD.pickIdx=d.pickIdx;
  MD.initialRanks=MD.initialRanks||{};
  MD.log=MD.picks.slice().reverse().slice(0,50).map(function(pk){
    var who=pk.mine?'<strong style="color:var(--accent-bright)">YOU</strong>':((d.seats[pk.slot-1]||{}).name||'Team '+pk.slot).replace(/</g,'&lt;');
    return '<span style="color:var(--muted)">R'+pk.round+'.'+pk.pickNo+'</span> '+who+' - <strong style="color:var(--text);cursor:pointer" onclick="openPlayerCard(\''+pk.p.id+'\',\''+pk.p.name.replace(/'/g,"\\'")+'\')">'+pk.p.name+'</strong> '+mdPosTag(pk.p.pos);
  });
  MP.deadline=d.status==='drafting'?(d.deadline||0):0;
  var myTurn=d.status==='drafting'&&d.order[d.pickIdx]===MP.seat;
  MD.onClock=myTurn;
  var round=Math.floor(d.pickIdx/d.teams)+1;
  MD.curRound=round;
  var onName=(d.seats[d.order[d.pickIdx]]||{}).name||'Autodraft';
  var bar=document.getElementById('mp-bar');
  if(bar)bar.innerHTML='<div style="font-size:12px;color:var(--muted)">Room <strong style="color:var(--text);letter-spacing:.15em">'+d.code+'</strong></div>'
    +'<div id="mp-clock" style="font-size:12px"></div>'
    +'<div style="flex:1"></div>'
    +(MP.isHost&&d.status==='drafting'?'<button class="btn-sm" onclick="mpPause()">Pause draft</button>':'')
    +(MP.isHost&&d.status==='paused'?'<button class="btn-load" style="width:auto;padding:8px 18px" onclick="mpResume()">Resume draft</button>':'')
    +'<button class="btn-sm" onclick="mpLeave()">Leave room</button>';
  var stat=document.getElementById('md-status');
  if(stat){
    if(d.status==='done')stat.innerHTML='Draft complete. Life is good.';
    else if(d.status==='paused')stat.innerHTML='<span style="color:var(--yellow,#fbbf24)">Draft paused</span>'+(MP.isHost?' - hit Resume when everyone is back':' - the host will resume shortly');
    else if(myTurn)stat.innerHTML='<span style="color:var(--accent-bright)">Round '+round+'</span> - you are on the clock<span id="md-clk"></span>';
    else{
      var untilMe=-1;
      for(var ui=d.pickIdx;ui<d.order.length;ui++){if(d.order[ui]===MP.seat){untilMe=ui-d.pickIdx;break;}}
      stat.innerHTML='Round '+round+' - <strong style="color:var(--text)">'+String(onName).replace(/</g,'&lt;')+'</strong> is on the clock'
        +(untilMe>0?' · <span style="color:var(--accent-bright)">your turn in '+untilMe+' pick'+(untilMe>1?'s':'')+'</span>':'')
        +'<span id="md-clk"></span>';
    }
  }
  var sig=d.status+':'+d.pickIdx+':'+(d.picks||[]).length;
  if(sig!==MP.lastSig){
    MP.lastSig=sig;
    mdRenderBoard();mdRenderMine();mdRenderLog();
    var myPicks=MD.mine.length;
    if(d.status==='done'){
      if(MP.tick){clearInterval(MP.tick);MP.tick=null;}
      if(MP.timer){clearInterval(MP.timer);MP.timer=null;}
      try{sndWin();}catch(_){}
      // Save the finished friends draft to History, exactly like a solo mock (once).
      if(!MP._saved){MP._saved=true;try{mdSaveHistory('friends');}catch(_){}}
      var ch2=document.getElementById('md-choices');if(ch2)ch2.innerHTML='';
      var sg2=document.getElementById('md-sage');if(sg2)sg2.style.display='none';
    }else if(myTurn){
      if(!MP.wasMy){try{sndYourTurn();}catch(_){}}
      mdShowChoices(round);
    }else{
      mdShowChoices(round); // keep the available grid fresh while you watch
      var sg3=document.getElementById('md-sage');if(sg3&&myPicks===MP.myPickCount)sg3.style.display='none';
      var db=document.getElementById('md-draftbar');if(db)db.style.display='none';
    }
    MP.myPickCount=myPicks;
  }
  MP.wasMy=myTurn;
  _mpPaintClock();
}
async function mpPoll(){
  if(!MP.code)return;
  try{
    var r=await fetch('/api/room/'+MP.code);
    if(!r.ok)return;
    var d=await r.json();
    if(d.status==='lobby'){
      _mpStep('lobby');
      var lobby=document.getElementById('mp-lobby');
      var claimed=d.seats.filter(function(x){return x.claimed;}).length;
      // Only rebuild the lobby when something actually changed - otherwise the 3s
      // poll would wipe out the name field while someone is typing in it.
      var lsig=d.code+'|'+d.teams+'|'+MP.seat+'|'+(MP.isHost?1:0)+'|'+d.seats.map(function(s){return (s.claimed?1:0)+':'+(s.name||'');}).join(',');
      if(!lobby||lsig===MP.lobbySig)return;
      MP.lobbySig=lsig;
      // Sleeper-style seat board: every draft slot is a card. Yours is highlighted,
      // taken slots show the manager, open slots say "Tap to take" and are clickable.
      var seatCards=d.seats.map(function(sx,i){
        var mine=i===MP.seat;
        var pickLbl='1.'+String(i+1).padStart(2,'0');
        if(mine){
          return '<div style="border:1.5px solid var(--accent-bright);background:var(--accent-dim);border-radius:12px;padding:9px 8px;text-align:center">'
            +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);letter-spacing:.05em">PICK '+pickLbl+'</div>'
            +'<div style="font-size:13px;font-weight:800;color:var(--text);margin-top:2px">You</div>'
            +'<div style="font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:1px">your slot</div></div>';
        }
        if(sx.claimed){
          var kick=(MP.isHost&&i!==MP.seat)?'<span onclick="mpKick('+i+')" title="Remove this manager" style="position:absolute;top:4px;right:6px;width:18px;height:18px;border-radius:50%;background:var(--surface3);color:var(--muted);display:inline-flex;align-items:center;justify-content:center;font-size:12px;line-height:1;cursor:pointer">&times;</span>':'';
          return '<div style="position:relative;border:1px solid var(--border2);background:var(--surface2);border-radius:12px;padding:9px 8px;text-align:center">'+kick
            +'<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.05em">PICK '+pickLbl+'</div>'
            +'<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+String(sx.name||'Manager').replace(/</g,'&lt;')+'</div>'
            +'<div style="font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:1px">taken</div></div>';
        }
        return '<div role="button" tabindex="0" onclick="mpClaimSeat('+i+')" style="cursor:pointer;border:1px dashed var(--border2);border-radius:12px;padding:9px 8px;text-align:center;transition:border-color .15s,background .15s" onmouseover="this.style.borderColor=\'var(--accent-bright)\';this.style.background=\'var(--surface2)\'" onmouseout="this.style.borderColor=\'var(--border2)\';this.style.background=\'transparent\'">'
          +'<div style="font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.05em">PICK '+pickLbl+'</div>'
          +'<div style="font-size:13px;font-weight:800;color:var(--accent-bright);margin-top:2px">Take</div>'
          +'<div style="font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-top:1px">open</div></div>';
      }).join('');
      lobby.innerHTML='<div style="text-align:center;padding:14px 0 6px">'
        +'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.14em">Room code - send this to your friends</div>'
        +'<div style="font-family:var(--font-head);font-size:42px;font-weight:800;letter-spacing:.35em;margin:6px 0 2px;padding-left:.35em;background:var(--accent-bright);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">'+d.code+'</div>'
        +'<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn-sm" id="mp-copy-btn" onclick="mpCopyCode()">Copy code</button><button class="btn-load" style="width:auto;padding:8px 18px" id="mp-link-btn" onclick="mpCopyLink()">Copy invite link</button></div></div>'
        +'<div style="max-width:300px;margin:2px auto 12px">'
        +'<input id="mp-lobby-name" class="tm-input" maxlength="24" value="'+String(MP.myName||'').replace(/"/g,"&quot;")+'" placeholder="Your name" onfocus="this.select()" oninput="MP.myName=this.value" onchange="mpRename(this.value)" onkeydown="if(event.key===\'Enter\')this.blur()" style="width:100%;text-align:center">'
        +'<div style="font-size:10.5px;color:var(--muted);text-align:center;margin-top:4px">How your friends see you - change it anytime</div></div>'
        +'<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;text-align:center;margin:12px 0 8px">Pick your draft slot - tap an open one to claim or switch</div>'
        +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin:0 0 14px">'
        +seatCards
        +'</div>'
        +'<div style="text-align:center;margin-bottom:6px">'
        +(MP.isHost
          ?'<button class="btn-load" style="width:auto;padding:11px 28px" onclick="mpStart()">Start the draft</button><div style="font-size:11px;color:var(--muted);margin-top:6px">'+claimed+' of '+d.teams+' seats filled. Open seats autodraft.</div>'
          :'<div style="font-size:12.5px;color:var(--muted2)">You are in at pick 1.'+String(MP.seat+1).padStart(2,'0')+'. Waiting for the host to start…</div>')
        +'<div style="margin-top:8px"><button class="btn-sm" onclick="mpLeave()">Leave</button></div></div>';
      // Guest arriving via an invite link: clear the "Guest" placeholder and put
      // the cursor in the name box so the first thing they do is name themselves.
      if(MP.needName){var _nf=document.getElementById('mp-lobby-name');if(_nf){_nf.value='';MP.myName='';_nf.focus();}MP.needName=false;}
    } else {
      mpSync(d);
    }
  }catch(_){}
}
// ── LIVE DRAFT ASSIST: follow your real Sleeper draft, recommend every pick ──
var LD={draftId:null,timer:null,picked:{},myUserId:null,lastCount:-1};
function ldSwitchLeague(lid){
  if(!lid)return;
  window._returnScreen='screen-mock';   // stay on the mock screen after the league loads
  switchToLeague(lid);
  ldStop();
  setTimeout(function(){var st=document.getElementById('ld-status');if(st)st.textContent='League switched. Hit Connect to follow this league\'s draft.';},800);
}
function ldRenderLeaguePick(){
  var sel=document.getElementById('ld-league-sel');
  if(!sel)return;
  var ls=window._myLeagues||[];
  sel.innerHTML='<option value="">'+(leagueName?('Current: '+leagueName):'Pick a league')+'</option>'
    +ls.filter(function(l){return l.league_id!==leagueId;}).map(function(l){
      return '<option value="'+l.league_id+'">'+(l.name||'League').replace(/</g,'&lt;')+'</option>';}).join('');
}
async function ldConnect(){
  var st=document.getElementById('ld-status'), body=document.getElementById('ld-body');
  if(!leagueId){alert('Connect your league first, then come back.');return;}
  body.style.display='block';
  st.textContent='Looking for your draft...';
  try{
    var drafts=await fetch('/api/sleeper/league/'+leagueId+'/drafts').then(function(r){return r.json();});
    var d=(drafts||[]).find(function(x){return x.status==='drafting';})||(drafts||[]).find(function(x){return x.status==='pre_draft';})||(drafts||[])[0];
    if(!d){st.textContent='No draft found on this league.';return;}
    LD.draftId=d.draft_id; LD.myUserId=userId; LD.lastCount=-1;
    st.textContent='Following draft '+(d.status==='drafting'?'(live now)':'('+(d.status||'scheduled')+')')+'. Checking for picks every 6 seconds.';
    if(LD.timer)clearInterval(LD.timer);
    ldPoll();
    LD.timer=setInterval(ldPoll,6000);
  }catch(e){st.textContent='Could not reach the draft: '+e.message;}
}
function ldStop(){
  if(LD.timer)clearInterval(LD.timer);
  LD.timer=null;LD.draftId=null;
  var body=document.getElementById('ld-body'); if(body)body.style.display='none';
}
async function ldPoll(){
  if(!LD.draftId)return;
  try{
    var picks=await fetch('/api/sleeper/draft/'+LD.draftId+'/picks').then(function(r){return r.json();});
    if(!Array.isArray(picks))return;
    if(picks.length===LD.lastCount)return;   // nothing new
    LD.lastCount=picks.length;
    LD.picked={};
    var mine=[];
    picks.forEach(function(pk){
      if(pk.player_id)LD.picked[pk.player_id]=true;
      if(pk.picked_by&&pk.picked_by===LD.myUserId&&pk.player_id&&allPlayers[pk.player_id])mine.push(allPlayers[pk.player_id]);
    });
    if(mine.length>(LD.myCount||0)){try{sndWin();}catch(_){}}
    LD.myCount=mine.length;
    var st=document.getElementById('ld-status');
    if(st)st.textContent=picks.length+' picks in. '+(mine.length?('You have: '+mine.map(function(p){return p.name;}).join(', ')+'.'):'You have not picked yet.');
    // best available by live value, drafted players excluded
    var avail=Object.values(allPlayers)
      .filter(function(p){return !LD.picked[p.id]&&(ktcById[p.id]||0)>800&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;})
      .sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);});
    // roster-aware pool: don't recommend a 2nd QB (1QB) or 2nd TE
    var myPos={QB:0,RB:0,WR:0,TE:0}; mine.forEach(function(p){myPos[p.pos]++;});
    var isSF=leagueFormat.hasSuperFlex||leagueFormat.has2QB;
    var recPool=avail.filter(function(p){
      if(p.pos==='QB'&&myPos.QB>=(isSF?2:1))return false;
      if(p.pos==='TE'&&myPos.TE>=1)return false;
      return true;
    });
    var rec=recPool[0]||avail[0];
    var recEl=document.getElementById('ld-rec');
    if(rec&&recEl){
      var note=getPlayerContextNote(rec.name);
      var needTxt=myPos[rec.pos]===0?('You have no '+rec.pos+' yet'):('Best value on the board');
      recEl.style.display='block';
      recEl.innerHTML='<div style="display:flex;gap:10px;align-items:flex-start">'
        +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+rec.id+'.jpg" style="width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid var(--accent-bright)" onerror="this.style.display=\'none\'">'
        +'<div><div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em">Mac says take</div>'
        +'<div style="font-family:var(--font-head);font-size:15px;font-weight:700">'+rec.name+' <span style="font-size:11px;color:var(--muted);font-weight:400">'+rec.pos+' · '+(rec.team||'FA')+'</span></div>'
        +'<div style="font-size:12px;color:var(--muted2);line-height:1.55;margin-top:3px">'+needTxt+'. '+(note?note.note.split(';')[0].trim()+'.':'')+'</div></div></div>';
    }
    var bestEl=document.getElementById('ld-best');
    if(bestEl)bestEl.innerHTML=avail.slice(0,8).map(function(p){
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">'
        +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'">'
        +'<span style="flex:1;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+p.name+'</span>'
        +'<span style="font-size:10px;color:var(--muted)">'+p.pos+'</span>'
        +'<span style="font-size:10.5px;color:var(--accent-bright)">'+(ktcById[p.id]?playerTierLabel(ktcById[p.id],p.id).short:'')+'</span></div>';
    }).join('');
    var feedEl=document.getElementById('ld-feed');
    if(feedEl)feedEl.innerHTML=picks.slice(-5).reverse().map(function(pk){
      var p=pk.player_id&&allPlayers[pk.player_id];
      return '<div>'+(pk.round||'?')+'.'+(pk.pick_no||'?')+' <strong style="color:var(--text)">'+(p?p.name:(pk.metadata&&pk.metadata.first_name?pk.metadata.first_name+' '+pk.metadata.last_name:'Unknown'))+'</strong></div>';
    }).join('')||'<div>No picks yet.</div>';
  }catch(_){}
}
// Per-DEVICE memory of the mock setup, no account needed. Whatever you last
// picked (teams, seat, scoring, format, rounds, clock, mode, the fine-tune
// toggles) comes back on this device next visit. A connected league still wins
// for the settings it actually decides (its size, scoring, format, mode).
var MD_SETTING_KEYS=['md-mode','md-teams','md-slot','md-scoring','md-format','md-rounds','md-clock','md-dtype','md-budget'];
// Draft type drives one visible thing on the sheet: the budget cell
function mdDtypeSync(){
  var t=(document.getElementById('md-dtype')||{}).value;
  var c=document.getElementById('md-budget-cell');
  if(c)c.style.display=t==='auction'?'block':'none';
}
var MD_TOGGLE_KEYS=['md-6pt','md-tep'];
function mdSaveSettings(){
  try{
    var o={};
    MD_SETTING_KEYS.forEach(function(id){var e=document.getElementById(id);if(e&&e.value!=null)o[id]=e.value;});
    MD_TOGGLE_KEYS.forEach(function(id){var e=document.getElementById(id);if(e)o[id]=!!e.checked;});
    localStorage.setItem('tm_mock_settings',JSON.stringify(o));
  }catch(_){}
}
function mdRestoreSettings(){
  try{
    var o=JSON.parse(localStorage.getItem('tm_mock_settings')||'null');
    if(!o)return;
    // teams first so the seat dropdown is rebuilt to the right size before we
    // restore which slot you were in
    var t=document.getElementById('md-teams');
    if(t&&o['md-teams']!=null){t.value=o['md-teams'];try{mdSyncSlots();}catch(_){}}
    MD_SETTING_KEYS.forEach(function(id){
      if(id==='md-teams')return;
      // a connected league owns the mode default - don't let device memory fight it
      if(id==='md-mode'&&leagueId&&window._detectedMode)return;
      var e=document.getElementById(id);
      if(e&&o[id]!=null)e.value=o[id];
    });
    MD_TOGGLE_KEYS.forEach(function(id){var e=document.getElementById(id);if(e&&o[id]!=null)e.checked=!!o[id];});
    try{mdDtypeSync();}catch(_){}  // restored draft type shows/hides the budget cell
    // NEVER restore state invisibly: a remembered 6pt/TEP toggle lives inside
    // the COLLAPSED fine-tune panel, so a restored knob silently reshapes the
    // whole room ("I had normal settings" - the audit case: 6pt standard put
    // Josh Allen at 1.04). If anything non-default came back, open the panel.
    var _cust=MD_TOGGLE_KEYS.some(function(id){var e=document.getElementById(id);return e&&e.checked;});
    if(_cust){var ft=document.getElementById('md-finetune');if(ft)ft.open=true;}
    // same rule for saved drafter personalities: they reshape the whole room,
    // so the profiles panel opens whenever any seat carries one
    try{
      var _pfR=mdGetProfiles();
      if(_mdFz26On()||Object.keys(_pfR).some(function(k){return _pfR[k]&&_pfR[k].arch;})){
        var pd=document.getElementById('md-profiles');if(pd)pd.open=true;
      }
    }catch(_){}
    // Mode select mirrors the real app mode - but a programmatic .value never
    // fires the inline onchange, so without a league the restored value and
    // leagueMode can drift apart. Fire the real sync so badge/boards/KTC agree.
    var md=document.getElementById('md-mode');
    if(!leagueId&&md&&md.value&&md.value!==leagueMode){try{setLeagueModeManual(md.value);}catch(_){}}
  }catch(_){}
}
function mdPrefillFromLeague(){
  // one-time: persist every setup change to this device automatically
  if(!window._mdSettingsWired){
    window._mdSettingsWired=1;
    MD_SETTING_KEYS.concat(MD_TOGGLE_KEYS).forEach(function(id){
      var e=document.getElementById(id);if(e)e.addEventListener('change',mdSaveSettings);
    });
    // the profiles panel marks YOUR seat, so it follows the seat select
    // (teams changes reach it through mdSyncSlots)
    var _slp=document.getElementById('md-slot');
    if(_slp)_slp.addEventListener('change',function(){
      try{_mdFz26SeatMoved(parseInt(_slp.value,10));}catch(_){}
      try{mdRenderProfiles();}catch(_){}
    });
  }
  // saved league-tendency context comes back every visit
  try{
    var cbox=document.getElementById('md-context');
    if(cbox&&!cbox.value){
      // per-league memory first: the room described for THIS league returns
      // whenever this league drafts again; the global save is the fallback
      var saved=(typeof leagueId!=='undefined'&&leagueId&&localStorage.getItem('tm_md_ctx_'+leagueId))||localStorage.getItem('tm_md_context');
      if(saved){cbox.value=saved;mdContextPreview();}
    }
  }catch(_){}
  try{mdSyncSlots();}catch(_){}
  // Sleeper connect is the optional shortcut: nudge only while no league is loaded
  var _hint=document.getElementById('md-connect-hint');
  if(_hint)_hint.style.display=leagueId?'none':'block';
  // Mode select mirrors the real app mode. A connected league picks the smart
  // DEFAULT (auto-detected), but you can always override it - detection is a
  // guess (keeper leagues, odd names, missing settings) and the user knows
  // their own league. No hard lock.
  var _mdSel=document.getElementById('md-mode');
  if(_mdSel){
    _mdSel.value=(typeof leagueMode!=='undefined'&&leagueMode==='dynasty')?'dynasty':'redraft';
    _mdSel.disabled=false;
    _mdSel.title=(leagueId&&window._detectedMode)?('Auto-detected '+(window._detectedMode==='dynasty'?'Dynasty':'Redraft')+' - change it if that is wrong'):'';
    _mdSel.style.opacity='';
  }
  // device memory fills the setup (works with no account); a connected league
  // then overrides the settings it owns just below
  try{mdRestoreSettings();}catch(_){}
  if(!leagueId)return;
  try{
    var t=document.getElementById('md-teams'); if(t&&leagueFormat.totalTeams>=8&&leagueFormat.totalTeams<=16)t.value=String(leagueFormat.totalTeams);
    var sc=document.getElementById('md-scoring'); if(sc)sc.value=String(leagueFormat.ppr);
    var f=document.getElementById('md-format'); if(f)f.value=(leagueFormat.hasSuperFlex||leagueFormat.has2QB)?'sf':'1qb';
    mdSyncSlots();
  }catch(_){}
}
function mdSaveHistory(mode){
  try{
    var hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');
    // 'Best available' is the label whenever no strategy was chosen - the
    // user-facing strategy picker is gone; MD.strat simply defaults to 'bpa'
    var stratLabel=mode==='friends'?'Live draft with friends':((MD_STRATS[MD.strat]||{}).name||'Best available');
    // Every pick keeps its decision context - ADP and tier AT THE TIME, the
    // overall number, the reach/value delta, and Mac's lane if one was
    // chosen. This detail is what the tendency-coaching layer (how do YOU
    // draft: where you reach, where you find value) will read later.
    // seat names ride along so the history modal can say WHO made each pick -
    // with league profiles these are the real managers' names
    var _botNames={};Object.keys(MD.bots||{}).forEach(function(bs2){_botNames[bs2]=MD.bots[bs2].name;});
    hist.unshift({ts:Date.now(),mode:mode||'solo',teams:MD.teams,slot:MD.mySlot,strat:stratLabel,
      bots:_botNames,
      set:{rounds:MD.rounds,scoring:MD.scoring,sf:!!MD.sf,sixPt:MD.sixPt||0,tep:!!MD.tep,
        ctx:((document.getElementById('md-context')||{}).value||'').slice(0,300)},
      roster:MD.mine.map(function(p){return p.pos+' '+p.name;}),
      rosterX:(MD.picks||[]).filter(function(pk){return pk.mine;}).map(function(pk){
        return {id:pk.p.id,name:pk.p.name,pos:pk.p.pos,team:pk.p.team,round:pk.round,pickNo:pk.pickNo};}),
      picksAll:(MD.picks||[]).map(function(pk){
        var ov=(pk.round-1)*MD.teams+pk.pickNo;
        return {r:pk.round,n:pk.pickNo,s:pk.slot,pos:pk.p.pos,nm:pk.p.name,me:!!pk.mine,
          ov:ov,
          pr:pk.price!=null?pk.price:undefined, // auction: the dollars paid
          adp:pk.p.adp!=null?+(+pk.p.adp).toFixed(1):null,
          delta:pk.p.adp!=null?Math.round(ov-pk.p.adp):null,
          tier:(ktcById[pk.p.id]?playerTierLabel(ktcById[pk.p.id],pk.p.id).short:null),
          lane:pk.lane||null};}),
      rating:0});
    localStorage.setItem('tm_mock_history',JSON.stringify(hist.slice(0,15)));
    mdRenderHistory();
  }catch(_){}
}
function mdRateHistory(i,v){
  try{
    var hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');
    if(hist[i]){hist[i].rating=hist[i].rating===v?0:v;localStorage.setItem('tm_mock_history',JSON.stringify(hist));mdRenderHistory();}
  }catch(_){}
}
// Roster card export, Yahoo-app clean: faces, team logos, position bubbles,
// round tags. Images ride the same-origin /img proxy so the canvas stays
// exportable. Falls back to the plain text card for pre-update history entries.
async function mdDownloadRoster(i){
  try{
    // the wordmark must render in the real brand face, not a fallback -
    // wait for Unbounded before any text hits the canvas
    try{await document.fonts.load('700 20px Unbounded');await document.fonts.load('800 20px Unbounded');}catch(_){}
    var hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');
    var h=hist[i]; if(!h)return;
    var rows=h.rosterX&&h.rosterX.length?h.rosterX:h.roster.map(function(r){
      var sp=r.split(' ');return {id:null,pos:sp[0],name:sp.slice(1).join(' '),team:'',round:null};});
    var S=2, W=720, HEAD=118, ROW=64, FOOT=52;
    var H=HEAD+rows.length*ROW+FOOT;
    var cv=document.createElement('canvas');cv.width=W*S;cv.height=H*S;
    var x=cv.getContext('2d');x.scale(S,S);
    var posC={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171',K:'#38bdf8',DEF:'#94a3b8'};
    function rr(x0,y0,w,hh,r){x.beginPath();x.moveTo(x0+r,y0);x.arcTo(x0+w,y0,x0+w,y0+hh,r);x.arcTo(x0+w,y0+hh,x0,y0+hh,r);x.arcTo(x0,y0+hh,x0,y0,r);x.arcTo(x0,y0,x0+w,y0,r);x.closePath();}
    // background: flat dark, no gradient
    x.fillStyle='#0d0817';x.fillRect(0,0,W,H);
    // header: plain wordmark, matched to the site nav. No star glyph and no
    // gradient fill - flat light text at the left margin, like the live logo.
    x.font='700 19px Unbounded, Outfit, Arial';
    try{x.letterSpacing='0.5px';}catch(_){}
    x.fillStyle='#f5eff0';x.fillText('MAC DRAFT',28,51);
    try{x.letterSpacing='0px';}catch(_){}
    x.fillStyle='#8f88b4';x.font='500 12.5px -apple-system, Arial';
    x.fillText('Mock draft · '+h.teams+' teams · pick '+h.slot+' · '+h.strat+' · '+new Date(h.ts).toLocaleDateString(),28,72);
    x.fillStyle='#5e5786';x.font='700 10px Arial';x.fillText('MY ROSTER',28,HEAD-10);
    var done=0;
    var imgs=rows.map(function(r){
      if(!r.id)return null;
      var im=new Image();
      var raw=r.pos==='DEF'
        ?'https://sleepercdn.com/images/team_logos/nfl/'+String(r.team||r.id).toLowerCase()+'.png'
        :'https://sleepercdn.com/content/nfl/players/thumb/'+r.id+'.jpg';
      im.src='/api/sleeper/img?u='+encodeURIComponent(raw);
      return im;
    });
    var logos=rows.map(function(r){
      if(!r.team||r.pos==='DEF')return null;
      var im=new Image();
      im.src='/api/sleeper/img?u='+encodeURIComponent('https://sleepercdn.com/images/team_logos/nfl/'+String(r.team).toLowerCase()+'.png');
      return im;
    });
    function draw(){
      rows.forEach(function(r,j){
        var y=HEAD+j*ROW;
        // row card
        x.fillStyle='rgba(255,255,255,.035)';rr(24,y,W-48,ROW-10,13);x.fill();
        x.strokeStyle='rgba(155,114,232,.14)';x.lineWidth=1;rr(24,y,W-48,ROW-10,13);x.stroke();
        // face circle
        var fx=44,fy=y+(ROW-10)/2;
        x.save();x.beginPath();x.arc(fx+16,fy,19,0,7);x.closePath();x.fillStyle='#1c1535';x.fill();x.clip();
        var im=imgs[j];
        if(im&&im.complete&&im.naturalWidth){
          if(r.pos==='DEF')x.drawImage(im,fx+2,fy-13,28,26);
          else x.drawImage(im,fx-4,fy-19,40,40);
        }
        x.restore();
        x.strokeStyle=posC[r.pos]||'#8f88b4';x.lineWidth=2;x.beginPath();x.arc(fx+16,fy,19,0,7);x.stroke();
        // name
        x.fillStyle='#f4f2fb';x.font='700 15.5px -apple-system, Arial';x.fillText(r.name,96,fy-2);
        // position bubble
        var pc=posC[r.pos]||'#8f88b4';
        x.font='800 9.5px Arial';var pw=x.measureText(r.pos).width+16;
        x.fillStyle='rgba(255,255,255,.06)';rr(96,fy+6,pw,17,9);x.fill();
        x.strokeStyle=pc;x.lineWidth=1.2;rr(96,fy+6,pw,17,9);x.stroke();
        x.fillStyle=pc;x.fillText(r.pos,104,fy+18);
        // team code next to bubble
        if(r.team&&r.pos!=='DEF'){x.fillStyle='#8f88b4';x.font='600 10.5px Arial';x.fillText(r.team,96+pw+8,fy+18);}
        // team logo, right side
        var lg=logos[j];
        if(lg&&lg.complete&&lg.naturalWidth)x.drawImage(lg,W-118,fy-13,26,26);
        // round.pick tag far right
        if(r.round){x.fillStyle='#5e5786';x.font='700 11px Arial';x.textAlign='right';
          x.fillText(r.round+'.'+(r.pickNo<10?'0':'')+r.pickNo,W-44,fy+4);x.textAlign='left';}
      });
      x.fillStyle='#5e5786';x.font='500 11px Arial';
      x.fillText('Mac Draft · Life is good.',28,H-22);
      var a=document.createElement('a');a.download='macdraft-roster.png';a.href=cv.toDataURL('image/png');a.click();
    }
    // wait for images (max 2.5s), then draw whatever arrived
    var pending=imgs.concat(logos).filter(Boolean);
    if(!pending.length){draw();return;}
    var fired=false;
    var fire=function(){if(fired)return;fired=true;draw();};
    var left=pending.length;
    pending.forEach(function(im){im.onload=im.onerror=function(){if(--left<=0)fire();};});
    setTimeout(fire,2500);
  }catch(_){}
}
// Full replay of a saved mock: every pick, round by round, yours highlighted
function mdViewHistory(i){
  var hist=[];try{hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');}catch(_){}
  var h=hist[i];if(!h||!h.picksAll)return;
  var m=document.getElementById('md-hist-modal');if(m)m.remove();
  m=document.createElement('div');
  m.id='md-hist-modal';
  m.style.cssText='position:fixed;inset:0;z-index:300;display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px;background:rgba(5,4,12,.65);backdrop-filter:blur(6px)';
  // One color per position, owned by CSS - the modal follows the app theme
  var pc={QB:'var(--pos-qb)',RB:'var(--pos-rb)',WR:'var(--pos-wr)',TE:'var(--pos-te)',K:'var(--pos-k)',DEF:'var(--pos-def)'};
  var rows='';var lastR=0;
  h.picksAll.forEach(function(pk){
    if(pk.r!==lastR){lastR=pk.r;rows+='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:10px 0 4px">Round '+pk.r+'</div>';}
    rows+='<div style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:12px'+(pk.me?';color:var(--accent-bright);font-weight:700':'')+'">'
      +'<span style="width:34px;color:var(--muted);font-size:10.5px">'+pk.r+'.'+(pk.n<10?'0':'')+pk.n+'</span>'
      +'<span style="width:30px;font-size:9.5px;font-weight:800;color:'+(pc[pk.pos]||'var(--muted)')+'">'+pk.pos+'</span>'
      +'<span>'+pk.nm+(pk.pr!=null?' <span style="color:var(--muted)">$'+pk.pr+'</span>':'')
      +(pk.me?' - YOU':(h.bots&&h.bots[pk.s]?' <span style="color:var(--muted)">- '+h.bots[pk.s]+'</span>':''))+'</span></div>';
  });
  m.innerHTML='<div class="cm-card" style="max-width:420px;max-height:80vh;overflow-y:auto">'
    +'<button class="cm-x" onclick="document.getElementById(\'md-hist-modal\').remove()">&times;</button>'
    +'<div class="cm-title" style="font-size:16px">'+h.teams+'-team mock · slot '+h.slot+'</div>'
    +'<div class="cm-sub">'+new Date(h.ts).toLocaleString()+' · '+h.strat+'</div>'
    +rows+'</div>';
  m.addEventListener('click',function(e){if(e.target===m)m.remove();});
  document.body.appendChild(m);
}
function mdRenderHistory(){
  var box=document.getElementById('md-history'); if(!box)return;
  var hist=[]; try{hist=JSON.parse(localStorage.getItem('tm_mock_history')||'[]');}catch(_){}
  if(!hist.length){box.innerHTML='<div style="font-size:12.5px;color:var(--muted)">No mock drafts yet - finish a mock and it lands here.</div>';return;}
  var idx=hist.map(function(h,i){return {h:h,i:i};});
  idx.sort(function(a,b){return (b.h.rating||0)-(a.h.rating||0)||b.h.ts-a.h.ts;});
  box.innerHTML='<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:18px 0 8px">Past mock drafts</div>'
    +idx.map(function(e){
      var h=e.h;
      // Face bubble of the manager's first-round pick - the identity of the board.
      var r1=(h.rosterX||[]).filter(function(x){return x.round===1;})[0]||(h.rosterX||[])[0]||null;
      var face=r1
        ?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+r1.id+'.jpg" title="Round 1: '+escHtml(r1.name)+'" style="width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--surface3);flex:none" onerror="this.style.background=\'var(--surface3)\';this.removeAttribute(\'src\')">'
        :'<div style="width:38px;height:38px;border-radius:50%;background:var(--surface3);flex:none" title="No first-round pick saved"></div>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:6px">'
        +face
        +'<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600">'+h.teams+'-team · slot '+h.slot+' · '+h.strat+' <span style="font-size:10px;color:var(--muted);font-weight:500">'+new Date(h.ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})+'</span></div>'
        +'<div style="font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+h.roster.slice(0,4).join(' · ')+(h.roster.length>4?' · +'+(h.roster.length-4):'')+'</div></div>'
        +'<button class="btn-sm" style="'+(h.rating===1?'color:var(--green);border-color:var(--green)':'')+'" onclick="mdRateHistory('+e.i+',1)" title="Liked it">Good</button>'
        +'<button class="btn-sm" style="'+(h.rating===-1?'color:var(--red);border-color:var(--red)':'')+'" onclick="mdRateHistory('+e.i+',-1)" title="Not it">Bad</button>'
        +(h.picksAll&&h.picksAll.length?'<button class="btn-sm" onclick="mdViewHistory('+e.i+')" title="See the whole draft">View</button>':'')
        +'<button class="btn-sm" onclick="mdDownloadRoster('+e.i+')" title="Download as image">PNG</button>'
        +'</div>';
    }).join('');
}
function mdFinish(){
  mdSaveHistory(MD.mode==='auction'?'auction':undefined);
  document.getElementById('md-status').textContent='Draft complete. Mac grades your board:';
  var pos={QB:0,RB:0,WR:0,TE:0};MD.mine.forEach(function(p){pos[p.pos]++;});
  var sage=document.getElementById('md-sage');
  sage.style.display='block';
  try{sndWin();}catch(_){}
  // ALL the holes get computed FIRST: "balanced board" is only earned when
  // there is genuinely nothing to name - it used to coexist with a 1-QB,
  // 1-TE fifteen-rounder.
  var gaps=[];
  if(MD.rounds>=8){
    if(pos.RB===0)gaps.push('zero running backs - either a masterclass or a disaster, no in between');
    else if(pos.RB===1)gaps.push('just one running back, so your flex is a weekly coin flip');
    if(pos.TE===0)gaps.push('no tight end - a weekly zero until you hit the wire');
    if(!MD.sf&&pos.QB===0)gaps.push('no quarterback at all; you have to start one every week');
  }
  if(MD.sf&&pos.QB<2)gaps.push('only '+pos.QB+' QB in superflex - you needed two');
  if(MD.rounds>=12){
    if(!MD.sf&&pos.QB===1)gaps.push('a single QB across '+MD.rounds+' rounds; one bye or one injury and you are streaming');
    if(pos.TE===1)gaps.push('a single TE with no insurance behind him');
  }
  var takes='';
  if(pos.WR>=MD.rounds*0.6)takes+='WR-heavy build; you will win the ones you win by a lot. ';
  if(!MD.sf&&pos.QB>=2&&MD.rounds<12)takes+='Two QBs in 1QB is a luxury you can flip for a starter. ';
  // a late first QB is a plan, not a hole - but it gets named
  try{
    var _qb1=(MD.myOveralls||[]).find(function(m){return m.p.pos==='QB';});
    if(!MD.sf&&_qb1){
      var _qbRd=Math.max(1,Math.ceil(_qb1.overall/MD.teams));
      if(_qbRd>8)takes+='You waited on QB until Round '+_qbRd+' ('+_qb1.p.name+') - a fine plan only if he hits. ';
    }
  }catch(_){}
  if(gaps.length)takes+='Holes to fix: '+gaps.join('; ')+'. ';
  else if(!takes)takes='Balanced board with no glaring hole. ';
  // name the foundation of THIS roster: your first two picks
  if(MD.mine.length>=2)takes+='Built around '+MD.mine[0].name+' and '+MD.mine[1].name+'. ';
  else if(MD.mine.length===1)takes+='Anchored by '+MD.mine[0].name+'. ';
  // Value analysis vs market rank. K and D/ST sit OUT: their board ranks are
  // synthetic late-round codes, and counting them turned every finished draft
  // into a C for "reaching" on a kicker.
  var thrF=Math.max(4,Math.round(MD.teams/2));
  var edges=(MD.myOveralls||[]).filter(function(m){return m.p.pos!=='K'&&m.p.pos!=='DEF';}).map(function(m){
    var rank=MD.initialRanks[m.p.id]||m.overall;
    return {p:m.p,overall:m.overall,rank:rank,edge:m.overall-rank}; // positive = value fell to you
  });
  var avgEdge=edges.length?edges.reduce(function(s2,e){return s2+e.edge;},0)/edges.length:0;
  var letter=avgEdge>=6?'A':avgEdge>=2?'B+':avgEdge>=-1?'B':avgEdge>=-4?'C':'D';
  var steal=edges.slice().sort(function(a,b){return b.edge-a.edge;})[0];
  var reach=edges.slice().sort(function(a,b){return a.edge-b.edge;})[0];
  var valHtml='';
  if(edges.length){
    valHtml='<div style="display:flex;gap:14px;align-items:center;margin-top:10px;flex-wrap:wrap">'
      +'<div style="text-align:center"><div style="font-family:var(--font-head);font-size:34px;font-weight:800;color:'+(letter[0]==='A'?'var(--green)':letter[0]==='B'?'var(--accent-bright)':letter[0]==='C'?'var(--yellow)':'var(--red)')+'">'+letter+'</div><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em">Value grade</div></div>'
      +'<div style="flex:1;min-width:200px;font-size:12px;color:var(--muted2);line-height:1.7">'
      +(steal&&steal.edge>=thrF?'<div><strong style="color:var(--green)">Steal:</strong> '+steal.p.name+' at pick '+steal.overall+' - the market has him '+steal.edge+' spots earlier.</div>':'')
      +(reach&&reach.edge<=-thrF?'<div><strong style="color:var(--red)">Reach:</strong> '+reach.p.name+' at pick '+reach.overall+' - '+Math.abs(reach.edge)+' spots ahead of his market rank.</div>':'')
      +((!steal||steal.edge<thrF)&&(!reach||reach.edge>-thrF)?'<div>You drafted close to market value all the way through - disciplined board.</div>':'')
      +'</div></div>';
  }
  // Where you stand in the ROOM, and who beat you to value. Team strength is
  // the sum of each roster's market value; the snipe is the best player a bot
  // took in the pick right before one of yours - the guy who got away.
  var rivalHtml='';
  try{
    var teamVal={};
    (MD.picks||[]).forEach(function(pk){teamVal[pk.slot]=(teamVal[pk.slot]||0)+(pk.p.dv||0);});
    var ranked=Object.keys(teamVal).map(function(s){return {slot:+s,val:teamVal[s]};}).sort(function(a,b){return b.val-a.val;});
    var T=ranked.length;
    var myRank=ranked.findIndex(function(t){return t.slot===MD.mySlot;})+1;
    var rival=ranked.filter(function(t){return t.slot!==MD.mySlot;})[0];
    var ordEnd=function(k){var s=['th','st','nd','rd'],v=k%100;return k+(s[(v-20)%10]||s[v]||s[0]);};
    var standLine='';
    if(myRank&&T>1){
      var rn=(MD.bots&&MD.bots[rival.slot]&&MD.bots[rival.slot].name)||('Team '+rival.slot);
      var rTop=(MD.picks||[]).filter(function(pk){return pk.slot===rival.slot;}).sort(function(a,b){return (b.p.dv||0)-(a.p.dv||0);}).slice(0,2).map(function(pk){return pk.p.name;});
      // The human drafts with Mac's help, so "you rank 1st" is nearly always
      // true and reads as flattery. Top-2 gets a modest line; only a real
      // spread gets the ordinal.
      if(myRank<=2)standLine='On paper your board holds up with the best in the room. The team to watch is '+rn+(rTop.length?', built around '+rTop.join(' and '):'')+'.';
      else{
        var place=myRank<=Math.ceil(T/3)?'top-tier value, right in the mix':myRank>Math.ceil(2*T/3)?'near the bottom on paper - you will need your swings to hit':'squarely mid-pack';
        standLine='Your board ranks '+ordEnd(myRank)+' of '+T+' by market value - '+place+'. The team to beat is '+rn+(rTop.length?', built around '+rTop.join(' and '):'')+'.';
      }
    }
    // the sting: best value a bot grabbed the pick right before you were up
    var snipe=null;
    (MD.myOveralls||[]).forEach(function(m){
      (MD.picks||[]).forEach(function(pk){
        if(pk.mine)return;
        var ov=(pk.round-1)*MD.teams+pk.pickNo;
        if(ov===m.overall-1&&(!snipe||(pk.p.dv||0)>(snipe.p.dv||0)))snipe={p:pk.p,slot:pk.slot,overall:ov,yours:m.overall};
      });
    });
    var snipeLine='';
    if(snipe){
      var sn=(MD.bots&&MD.bots[snipe.slot]&&MD.bots[snipe.slot].name)||('Team '+snipe.slot);
      snipeLine=sn+' grabbed '+snipe.p.name+' ('+snipe.p.pos+') at pick '+snipe.overall+', one spot before you were on the clock.';
    }
    if(standLine||snipeLine){
      rivalHtml='<div style="margin-top:12px;padding:10px 12px;background:var(--surface3);border-radius:10px;font-size:12px;color:var(--muted2);line-height:1.6">'
        +(standLine?'<div>'+standLine+'</div>':'')
        +(snipeLine?'<div style="margin-top:'+(standLine?'5px':'0')+'"><strong style="color:var(--red)">Got away:</strong> '+snipeLine+'</div>':'')
        +'</div>';
    }
  }catch(_){}
  // Mac's one-liner on EVERY player you walked away with - each tied to the
  // roster you actually built: his role on YOUR team, how the pick fit the
  // build, and the market value, not a generic career recap.
  var perPick='';
  if(edges.length){
    var _seen={QB:0,RB:0,WR:0,TE:0};
    var _ord=['','1st','2nd','3rd','4th','5th','6th','7th','8th','9th'];
    var _ordN=function(n){return _ord[n]||(n+'th');};
    var picksHtml=edges.map(function(e){
        var note=null;try{note=getPlayerContextNote(e.p.name);}catch(_){}
        _seen[e.p.pos]=(_seen[e.p.pos]||0)+1;
        var n=_seen[e.p.pos];
        var rd=Math.max(1,Math.ceil(e.overall/MD.teams));
        var posN=e.p.pos;
        // role on YOUR roster
        var role;
        if(posN==='QB')role=MD.sf?(n===1?'Your first superflex QB':'QB'+n+' - the pair superflex demands'):(n===1?'Your QB1':'QB'+n+', a bye-week hedge or trade chip');
        else role='Your '+_ordN(n)+' '+posN;
        // value in draft terms
        var val;
        if(e.edge>=thrF*2)val='he slid '+e.edge+' spots past his rank and you pounced at '+e.overall;
        else if(e.edge>=thrF)val='good value, '+e.edge+' past market at '+e.overall;
        else if(e.edge<=-thrF*2)val='you paid up '+Math.abs(e.edge)+' spots early - a conviction call';
        else if(e.edge<=-thrF)val='a touch early at '+e.overall+', nothing painful';
        else val='right around his market slot ('+e.overall+')';
        // what the pick did for the build
        var ctx='';
        if(posN==='RB'&&n===1)ctx=' Your backfield anchor.';
        else if(posN==='WR'&&n===1)ctx=' The top of your receiving corps.';
        else if(posN==='TE'&&n===1)ctx=rd>=6?' Waited on TE and grabbed one in Round '+rd+'.':' Locked your TE early.';
        else if((posN==='WR'||posN==='RB')&&n>=3)ctx=' You are all-in at '+posN+' now.';
        else if((posN==='WR'||posN==='RB')&&n===2)ctx=' Doubling down at '+posN+'.';
        var line=role+' - '+val+'.'+ctx;
        // one relevant fact, framed as what it means for your lineup
        if(note&&note.note)line+=' '+note.note.split(';')[0].trim()+'.';
        var pc={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'}[e.p.pos]||'#94a3b8';
        var _eN=e.p.name.replace(/'/g,"\\'");
        return '<div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:7px">'
          +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+e.p.id+'.jpg" style="width:26px;height:26px;border-radius:50%;object-fit:cover;flex:none;cursor:pointer" title="View player card" onclick="openPlayerCard(\''+e.p.id+'\',\''+_eN+'\')" onerror="this.style.visibility=\'hidden\'">'
          +'<div style="font-size:12px;line-height:1.5;color:var(--muted2)"><strong style="color:var(--text);cursor:pointer" onclick="openPlayerCard(\''+e.p.id+'\',\''+_eN+'\')">'+e.p.name+'</strong> <span style="font-size:9.5px;font-weight:700;color:'+pc+'">'+e.p.pos+'</span><br>'+line+'</div></div>';
      }).join('');
    perPick='<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">'
      +'<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Mac on every pick</div>'
      +picksHtml
      +'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">'
      +'<button class="btn-load" style="width:auto;padding:9px 20px" onclick="mdDownloadRoster(0)">Download my roster</button>'
      +'<button class="btn-sm" onclick="switchScreen(\'sage\');setTimeout(function(){var i=document.getElementById(\'sage-chat-input\');if(i){i.value=\'How did I do in my last mock draft?\';i.focus();}},300)">Ask Mac about this draft</button>'
      +'</div>';
  }
  // the verdict rides Mac's discreet face too: the grade letter IS the
  // essence, the full breakdown one tap away (respects the collapse gesture)
  mdMacSay('Draft complete - grade '+letter+'. Tap for the full verdict.',
    '<div style="font-size:10px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">Mac\'s verdict · '+((MD_STRATS[MD.strat]||MD_STRATS.bpa).name)+'</div>'
    +'<div style="font-size:13px;color:var(--muted2);line-height:1.7">'+pos.QB+' QB / '+pos.RB+' RB / '+pos.WR+' WR / '+pos.TE+' TE across '+MD.mine.length+' picks. '+takes+'Run it back from another slot and watch the board shift.</div>'
    +valHtml+rivalHtml+perPick,
    {face:letter.charAt(0)==='A'?'excited':letter.charAt(0)==='D'?'deadpan':'thinking'});
  document.getElementById('md-choices').innerHTML='';
  // Hand the draft to Ask Mac: a compact summary he can grade in chat
  try{
    localStorage.setItem('tm_last_mock',JSON.stringify({
      ts:Date.now(),teams:MD.teams,slot:MD.mySlot,rounds:MD.rounds,grade:letter,
      strat:(MD_STRATS[MD.strat]||{}).name||MD.strat,sf:MD.sf,
      picks:edges.map(function(e){return {name:e.p.name,pos:e.p.pos,overall:e.overall,marketRank:e.rank};})
    }));
  }catch(_){}
}

// ── ASK MAC: START/SIT ──────────────────────────────────────────────────────
function addAskSageInput(){
  var box=document.getElementById('asksage-inputs');
  if(!box||box.children.length>=6)return;
  var div=document.createElement('div');
  div.className='ac-wrap';
  div.style.cssText='display:block;margin-bottom:8px;position:relative';
  div.innerHTML='<input type="text" class="tm-input asksage-input" style="width:100%" placeholder="Player '+(box.children.length+1)+'..." autocomplete="off"><div class="ac-dropdown asksage-dd"></div>';
  box.appendChild(div);
}

// Autocomplete for Ask Mac inputs: your roster first, then the full player pool
document.addEventListener('input',function(e){
  if(!e.target.classList||!e.target.classList.contains('asksage-input'))return;
  sageAc(e.target);
});
document.addEventListener('focusin',function(e){
  if(!e.target.classList||!e.target.classList.contains('asksage-input'))return;
  sageAc(e.target);
});
document.addEventListener('click',function(e){
  if(!e.target.closest('.asksage-input')&&!e.target.closest('.asksage-dd')){
    document.querySelectorAll('.asksage-dd').forEach(function(d){d.classList.remove('open');});
  }
});
function sageAc(input){
  var dd=input.parentNode.querySelector('.asksage-dd');
  if(!dd)return;
  var q=input.value.trim().toLowerCase();
  var mine=myRoster.filter(function(p){return !q||p.name.toLowerCase().indexOf(q)>=0;})
    .sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);});
  var others=[];
  if(q.length>=2){
    var mineIds=new Set(mine.map(function(p){return p.id;}));
    others=Object.values(allPlayers).filter(function(p){
      return p.name&&p.name.toLowerCase().indexOf(q)>=0&&!mineIds.has(p.id)&&(ktcById[p.id]||0)>200;
    }).sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,4);
  }
  if(!mine.length&&!others.length){dd.classList.remove('open');return;}
  dd.innerHTML='';
  function addHeader(txt,color){
    var h=document.createElement('div');
    h.style.cssText='font-size:9px;font-weight:700;color:'+color+';text-transform:uppercase;letter-spacing:.08em;padding:4px 8px 2px';
    h.textContent=txt;dd.appendChild(h);
  }
  function addRow(p,tag){
    var d=document.createElement('div');
    d.className='ac-item';
    d.style.cssText='display:flex;align-items:center;gap:8px';
    d.innerHTML='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'"><span style="flex:1"></span><span style="font-size:10px;color:var(--muted)">'+p.pos+(tag?' · '+tag:'')+'</span>';
    d.children[1].textContent=p.name;
    d.addEventListener('mousedown',function(ev){
      ev.preventDefault();
      input.value=p.name;
      dd.classList.remove('open');
    });
    dd.appendChild(d);
  }
  if(mine.length){addHeader('Your roster','var(--accent-bright)');mine.forEach(function(p){addRow(p,'yours');});}
  if(others.length){if(mine.length)addHeader('All players','var(--muted)');others.forEach(function(p){addRow(p,'');});}
  dd.classList.add('open');
}

async function askSageStartSit(){
  var out=document.getElementById('asksage-result');
  if(!out)return;
  var names=Array.from(document.querySelectorAll('.asksage-input')).map(function(i){return i.value.trim();}).filter(Boolean);
  if(names.length<2){out.innerHTML='<div class="empty-state">Add at least two players to compare.</div>';return;}
  var week=parseInt((document.getElementById('asksage-week')||{}).value)||1;
  out.innerHTML='<div class="empty-state">Checking week '+week+' matchups and last season\'s data...</div>';
  if(!Object.keys(ktcById).length){try{await fetchKtcValues(1,1,leagueMode!=='redraft');}catch(_){}}

  var RISK_RE=/\bacl\b|achilles|surgery|injur|shut down|\bon ir\b|finished on ir|released|unsigned|suspend|arrest|\bpup\b|camp battle|competition/;
  var players=await Promise.all(names.map(async function(n){
    var pid=getPlayerIdByName(n);
    var p=pid?allPlayers[pid]:null;
    if(!p)return {name:n,missing:true};
    var mu=null;
    try{
      var r=await fetch('/api/stats/matchup?name='+encodeURIComponent(p.name)+'&week='+week);
      if(r.ok){var d=await r.json();if(d.found)mu=d;}
    }catch(_){}
    var fc=ktcFull[pid]||{};
    var note=getPlayerContextNote(p.name);
    var hasRisk=note?RISK_RE.test(note.note.toLowerCase()):false;
    // Score: last season\'s weekly production is the base, matchup swings it,
    // situation risk caps it. Market value only breaks ties.
    var base=mu?mu.avgPts*10:((fc.redraftValue||fc.value||0)/100);
    var matchupSwing=0;
    if(mu&&mu.defRank){
      if(mu.defRank<=8)matchupSwing=25;        // defense allows a lot to his position
      else if(mu.defRank<=14)matchupSwing=10;
      else if(mu.defRank>=25)matchupSwing=-25; // stingy defense
      else if(mu.defRank>=20)matchupSwing=-10;
    }
    var vsOppBonus=0;
    if(mu&&mu.vsOpp.length){
      var vAvg=mu.vsOpp.reduce(function(s,g){return s+g.pts;},0)/mu.vsOpp.length;
      if(vAvg>=(mu.avgPts+4))vsOppBonus=15;
      else if(vAvg<=(mu.avgPts-4))vsOppBonus=-10;
    }
    var score=base+matchupSwing+vsOppBonus-(hasRisk?60:0);
    return {name:p.name,pid:pid,pos:p.pos,team:p.team,mu:mu,fc:fc,note:note,risk:hasRisk,score:score,matchupSwing:matchupSwing,vsOppBonus:vsOppBonus};
  }));
  var missing=players.filter(function(p){return p.missing;});
  var ranked=players.filter(function(p){return !p.missing;}).sort(function(a,b){return b.score-a.score;});
  if(ranked.length<2){out.innerHTML='<div class="empty-state">Couldn\'t find '+missing.map(function(m){return '"'+m.name+'"';}).join(', ')+' - check the spelling.</div>';return;}

  var top=ranked[0],second=ranked[1];
  var gap=top.score-second.score;
  var confidence=gap>=40?'Clear call':gap>=15?'Lean':'Coin flip - matchups are close, trust your gut';

  function startReason(p){
    var bits=[];
    if(p.mu){
      bits.push('averaged '+p.mu.avgPts+' PPR points per game last season');
      if(p.mu.opp){
        var rankTxt=p.mu.defRank<=8?'a bottom-'+p.mu.defRank+' defense against '+p.pos+'s (allows '+p.mu.defAvgAllowed+' PPG to the position)':p.mu.defRank>=25?'one of the toughest defenses against '+p.pos+'s (#'+p.mu.defRank+' of '+p.mu.teamsRanked+' in points allowed)':'a middle-of-the-pack defense against '+p.pos+'s';
        bits.push('faces '+p.mu.opp+(p.mu.home===false?' on the road':' at home')+' in week '+p.mu.week+' - '+rankTxt);
      }
      if(p.mu.vsOpp.length){
        var v=p.mu.vsOpp[p.mu.vsOpp.length-1];
        bits.push('last time he saw '+v.opp+' he put up <strong style="color:var(--text)">'+v.pts+' points</strong> (week '+v.week+' last season)'+(p.vsOppBonus>0?' - this matchup has treated him well':''));
      }
    } else {
      bits.push('no 2025 game log found (rookie or low usage) - market value is doing the work here');
    }
    if(p.risk&&p.note)bits.push('<span style="color:var(--red)">situation flag: '+p.note.note.split(';')[0]+'</span>');
    else if(p.note)bits.push(p.note.note.split(';')[0]);
    return bits;
  }

  var html='<div style="padding:1rem;background:var(--accent-dim);border:1px solid rgba(155,114,232,.3);border-radius:var(--radius);margin-bottom:12px">'
    +'<div style="font-size:11px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">'+confidence+' · Week '+week+'</div>'
    +'<div style="font-size:18px;font-weight:800;color:var(--text)">Start '+top.name+'</div></div>';

  html+=ranked.map(function(p,i){
    var verdict=i===0?'START':'SIT';
    var vColor=i===0?'var(--green)':'var(--muted)';
    var reasons=startReason(p);
    return '<div style="display:flex;gap:10px;align-items:flex-start;padding:12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:8px;border:1px solid '+(i===0?'rgba(74,222,128,.35)':'var(--border)')+'">'
      +'<div style="font-size:11px;font-weight:800;color:'+vColor+';min-width:44px;padding-top:8px">'+verdict+'</div>'
      +'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.pid+'.jpg" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer" onclick="openPlayerCard(\''+p.pid+'\',\''+p.name.replace(/'/g,"\\'")+'\')" onerror="this.style.display=\'none\'">'
      +'<div style="flex:1"><div style="font-size:14px;font-weight:700;color:var(--text)">'+p.name+' <span style="font-size:10px;color:var(--muted)">'+p.pos+' · '+teamLogo(p.team)+(p.team||'FA')+'</span></div>'
      +'<ul style="margin:6px 0 0;padding-left:16px;font-size:11px;color:var(--muted2);line-height:1.7">'+reasons.map(function(r){return '<li>'+r+'</li>';}).join('')+'</ul></div></div>';
  }).join('');
  if(missing.length)html+='<div style="font-size:11px;color:var(--muted);margin-top:6px">Couldn\'t find: '+missing.map(function(m){return m.name;}).join(', ')+'</div>';
  html+='<div style="font-size:10px;color:var(--muted);margin-top:10px">Always check the final injury report before kickoff.</div>';
  out.innerHTML=html;
}

function renderWaiverTargets(){
  var el=document.getElementById('waiver-content');
  if(!el)return;
  if(!leagueRosters.length||!Object.keys(ktcFull).length){
    el.innerHTML="<div class='empty-state'>Connect a league to see stash targets.<br><button class='btn-load' style='width:auto;padding:10px 22px;margin-top:10px' onclick='goConnectLeague()'>Connect your league</button>"+_sageEscHtml()+"</div>";
    return;
  }
  var rostered=new Set(),rosteredNames=new Set();
  // Count IR (reserve) and taxi-squad players as rostered too. This is the #1
  // reason a star shows as "available" - a hurt/suspended stud (e.g. Rashee Rice)
  // is parked on IR, which lives outside r.players, so he looked unrostered.
  leagueRosters.forEach(function(r){[].concat(r.players||[],r.reserve||[],r.taxi||[]).forEach(function(pid){
    rostered.add(String(pid));
    var rp=allPlayers[pid];
    if(rp&&rp.name)rosteredNames.add(rp.name.toLowerCase());
  });});
  // A genuine waiver stash is a depth/upside guy. A clearly startable player at his
  // position is never a real free agent in a competitive league - if one shows up
  // it's a data gap (incomplete sync, missed IR), so cap by positional rank. Scales
  // with league size so a 10-team wire is deeper than a 14-team one.
  // Only truly startable studs are impossible waiver targets - cut just those, so
  // the deeper depth/upside guys (a genuine wire) still come through. Too tight a
  // ceiling left the list nearly empty in a competitive league.
  var _starterCeil={QB:14,RB:26,WR:34,TE:9};

  var _stashRisk=/\bacl\b|achilles|tore |torn |season(-| )ending|shut down|finished on ir|\bon ir\b|released|unsigned|suspend|arrest|retire/;
  var isRStash=leagueMode==='redraft';
  window._stashFloor=600;
  var _mkStash=function(){return Object.entries(ktcFull).filter(function(e){
    var pid=e[0],fc=e[1];
    if(rostered.has(String(pid)))return false;
    // Belt-and-suspenders: also exclude by name in case of ID mismatches
    if(fc.name&&rosteredNames.has(fc.name.toLowerCase()))return false;
    // Exclude rookies in EVERY mode - they're unrostered because the draft hasn't
    // happened, not because they're under the radar. That's a draft board, not a stash.
    var sp=allPlayers[pid];
    if(sp&&sp.exp===0)return false;
    if(!sp)return false; // not in Sleeper's player DB = not addable in your league
    // Skip players who are unrostered because they're hurt or out of the league -
    // nobody wants those, they aren't real waiver targets
    if(sp.inj&&/IR|Out|PUP|Sus|NA|DNR/i.test(sp.inj))return false;
    if(sp.status&&/Inactive|Retired|Reserve/i.test(sp.status))return false;
    var nt=getPlayerContextNote(fc.name||sp.name);
    if(nt&&_stashRisk.test(nt.note.toLowerCase()))return false;
    // Never suggest a startable stud as a "stash" - that's a data artifact.
    var _pr=fc.positionRank||0;
    if(_pr&&_pr<=(_starterCeil[fc.position]||999))return false;
    var v=isRStash&&fc.redraftValue>0?fc.redraftValue:fc.value;
    return v>window._stashFloor&&['QB','RB','WR','TE'].indexOf(fc.position)>=0;
  }).map(function(e){
    var pid=e[0],fc=e[1],p=allPlayers[pid];
    return{id:pid,name:fc.name||(p&&p.name)||pid,pos:fc.position,team:(p&&p.team)||'FA',value:fc.value,posRank:fc.positionRank||null,trend:fc.trend30Day||0,age:(p&&p.age)||null};
  }).sort(function(a,b){return b.value-a.value;}).slice(0,25);};
  // deep leagues strip the wire bare - lower the bar before giving up
  var targets=_mkStash();
  if(!targets.length){window._stashFloor=250;targets=_mkStash();}
  if(!targets.length){window._stashFloor=0;targets=_mkStash();}
  if(!targets.length){el.innerHTML="<div class='empty-state'>Every fantasy-relevant player is rostered in this league. The wire is truly bare - your upgrades have to come through trades.</div>";return;}

  var posColors={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  var html='<div style="font-size:12px;color:var(--muted2);padding:8px 12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:14px">'+(leagueMode==='redraft'?'Players who can score for you THIS season and aren\'t on any roster in your league. Priority waiver adds.':'Players with real dynasty value who aren\'t on any roster in your league. Go get them.')+'</div>';
  html+='<div style="display:grid;gap:6px">';
  targets.forEach(function(p,i){
    var col=posColors[p.pos]||'var(--muted)';
    var trendCol=p.trend>100?'var(--green)':p.trend<-100?'var(--red)':'var(--muted)';
    var trendStr=trendWord(p.trend).txt;
    var note=getPlayerContextNote(p.name);
    var why=(note?'<strong style="color:var(--text)">The situation:</strong> '+note.note.split(';').slice(0,2).join(';')+'. ':'')
      +'<strong style="color:var(--text)">Why now:</strong> nobody in your league rosters him'
      +(p.trend>100?' and his price is climbing ('+pctMove(p)+' in 30 days). Beat your leaguemates to it':p.trend<-100?' and his price just dipped, which is exactly when stashes are cheapest':' and the market still sees real value here')+'.';
    html+='<div style="background:var(--surface2);border-radius:var(--radius);border:1px solid var(--border)">';
    html+='<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer" onclick="var w=this.parentNode.querySelector(\'.stash-why\');w.style.display=w.style.display===\'none\'?\'block\':\'none\'">';
    html+='<div style="font-size:14px;font-weight:700;color:var(--muted);min-width:22px;text-align:center">'+(i+1)+'</div>';
    html+='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:34px;height:34px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid var(--border)" onclick="event.stopPropagation();openPlayerCard(\''+p.id+'\',\''+p.name.replace(/'/g,"\\'")+'\')" onerror="this.style.display=\'none\'">';
    html+='<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+p.name+' <span style="font-size:10px;font-weight:700;color:'+col+'">'+p.pos+'</span></div>';
    html+='<div style="font-size:11px;color:var(--muted)">'+(p.posRank?p.pos+' #'+p.posRank:playerTierLabel(p.value).short)+' · '+teamLogo(p.team)+(p.team||'FA')+(p.age?' · age '+p.age:'')+'</div></div>';
    html+='<div style="text-align:right"><div style="font-size:12px;font-weight:700;color:'+trendCol+'">'+trendStr+'</div><div style="font-size:10px;color:var(--muted)">30d</div></div>';
    html+='<span style="font-size:10px;color:var(--accent-bright);font-weight:600">Why?</span></div>';
    html+='<div class="stash-why" style="display:none;padding:0 12px 10px 44px;font-size:11px;color:var(--muted2);line-height:1.6">'+why+'</div>';
    html+='</div>';
  });
  html+='</div>';
  el.innerHTML=html;
}
// ─── END STASH TARGETS ────────────────────────────────────────────────────────


// Scroll-reveal: cards float in as you scroll
(function(){
  if(!('IntersectionObserver' in window))return;
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
  },{threshold:.08});
  document.querySelectorAll('.card,.how-card,.pitch-card,.mkt-panel').forEach(function(el){
    el.classList.add('reveal');io.observe(el);
  });
})();


// Homepage news rail: three fresh stories under the hero, fantasy-relevant first
function fetchArticlesOnce(force){
  var now=Date.now();
  // Re-fetch when stale (>90s) or forced, so the wire reflects new drops quickly
  // instead of being cached for the whole session.
  if(force||!window._articlesPromise||!window._articlesAt||(now-window._articlesAt>90000)){
    window._articlesAt=now;
    window._articlesPromise=fetch('/api/news/articles?t='+now).then(function(r){return r.json();});
  }
  return window._articlesPromise;
}
function loadHomeNews(){
  fetchArticlesOnce().then(function(d){
    var FANTASY_RE=/fantasy|waiver|start.?sit|sleeper|dynasty|rankings|injur|trade|depth chart|breakout|rookie|r\//i;
    var arts=(d.articles||[]).filter(function(a){return a.image;}).sort(function(a,b){
      var af=FANTASY_RE.test(a.headline+(a.source||''))?0:1;
      var bf=FANTASY_RE.test(b.headline+(b.source||''))?0:1;
      return af-bf;
    }).slice(0,3);
    var wrap=document.getElementById('home-news-wrap');
    var grid=document.getElementById('home-news-grid');
    if(!arts.length||!wrap||!grid)return;
    grid.innerHTML=arts.map(function(a){
      var srcName=a.source||'ESPN';
      var srcColor=srcName.indexOf('RotoWire')>=0?'#2f6fd6':srcName.indexOf('Yahoo')>=0?'#6001d2':srcName.indexOf('r/')===0?'#ff6314':'#d50a0a';
      return '<a class="news-card" href="'+a.link+'" target="_blank" rel="noopener" style="flex-direction:column">'
        +'<img src="'+a.image+'" alt="" loading="lazy" style="width:100%;height:130px">'
        +'<div class="nc-body" style="padding:10px 12px"><div class="nc-h">'+a.headline.replace(/</g,'&lt;')+'</div>'
        +'<div style="font-size:10px;font-weight:700;margin-top:4px;color:'+srcColor+'">'+srcName+' ↗</div></div></a>';
    }).join('');
    wrap.dataset.loaded='1';
    var active=document.querySelector('.screen.active');
    wrap.style.display=(active&&active.id==='screen-analyze')?'block':'none';
    loadHomeAnalysts();
  }).catch(function(){});
}

// Two curated analyst posts on the home page - quiet, below the stories
var _homeAnalystLoaded=false;
function loadHomeAnalysts(){
  if(_homeAnalystLoaded)return;
  _homeAnalystLoaded=true;
  var wrap=document.getElementById('home-analyst-wrap');
  var row=document.getElementById('home-analyst-row');
  if(!wrap||!row)return;
  row.className='auto-rail';
  row.innerHTML=_analystSkel(3);
  wrap.style.display='block';
  fetchArticlesOnce().then(function(d){
    var picks=_analystPick((d||{}).articles).slice(0,6);
    if(!picks.length){wrap.style.display='none';return;}
    row.innerHTML=picks.map(_analystCardHtml).join('');
    initAutoRail(row,30);
  }).catch(function(){wrap.style.display='none';});
}

loadHomeNews();
try{mdRenderStrats();}catch(_){}
// Returning visitors find the hero box already holding their league description
try{
  var _hmc=document.getElementById('hero-mock-ctx');
  if(_hmc&&!_hmc.value){var _hs=localStorage.getItem('tm_md_context');if(_hs)_hmc.value=_hs;}
}catch(_){}
renderHistory();
renderArchetypeGuide();
checkShareParam();
// Back from a successful Stripe checkout: confirm Pro and clean the URL.
(function(){
  try{
    if(new URLSearchParams(window.location.search).get('upgraded')!=='1')return;
    var u=new URL(window.location.href);u.searchParams.delete('upgraded');
    history.replaceState({},'',u.pathname+u.search);
    // Stripe sends the buyer back the instant the card clears, but Pro is
    // granted by the webhook, which lands a beat later. Repainting once here
    // would show a stale "Go Pro" and force a reload to see the thing they
    // just paid for, so poll until the entitlement actually appears.
    var tries=0;
    (function poll(){
      tries++;
      _refreshProStatus().then(function(){
        try{sageUpdateQuota();}catch(_){}
        if(window._isPro||tries>=10){
          setTimeout(function(){
            alert(window._isPro
              ? "You're Pro. Unlimited Mac is unlocked - thank you for backing Mac Draft."
              : "Payment received. Pro unlocks in a few seconds - no need to do anything.");
          },250);
          return;
        }
        setTimeout(poll,1200);
      }).catch(function(){ if(tries<10)setTimeout(poll,1200); });
    })();
  }catch(_){}
})();
// Seed history state and activate the correct screen from the URL path
(function(){
  // A shared-trade link (?trade=...) always shows the analysis - don't switch screens
  if(new URLSearchParams(window.location.search).get('trade'))return;
  var p=window.location.pathname.replace('/','');
  var name=(_VALID_SCREENS.indexOf(p)!==-1)?p:'home';
  history.replaceState({screen:name},'',window.location.href);
  switchScreen(name,true); // always run: home must deactivate the default tool screen
  try{_applyTabHash();}catch(_){} // deep links like /research#tab-market open on the right tab
})();

// A friend opened a /mock?room=CODE invite link: jump to the friends section and
// join that room automatically, then clean the code out of the URL.
(function _mpAutoJoin(){
  try{
    var code=(new URLSearchParams(location.search).get('room')||'').toUpperCase().trim();
    if(!/^[A-Z0-9]{4}$/.test(code))return;
    var u=new URL(location.href);u.searchParams.delete('room');
    history.replaceState({},'',u.pathname+u.search);
    switchScreen('mock');
    try{mdShowSection('friends');}catch(_){}
    setTimeout(function(){
      if(MP.code)return;
      var inp=document.getElementById('mp-join-code');if(inp)inp.value=code;
      var mn=document.getElementById('mp-name');
      var saved=localStorage.getItem('tm_username')||'';
      if(mn&&!mn.value)mn.value=saved;
      // Drop them straight into the room. If we have no name yet, join as a guest
      // and let them set their name right in the lobby - the link never dead-ends.
      if(!saved&&mn&&!mn.value.trim()){mn.value='Guest';MP.needName=true;}
      try{mpJoin();}catch(_){}
    },400);
  }catch(_){}
})();

// ── Nav dropdowns ────────────────────────────────────────────────────────────
function closeAllDropdowns(){
  document.querySelectorAll('.nav-item').forEach(function(el){el.classList.remove('open');});
  var ud=document.getElementById('user-dropdown');
  if(ud)ud.closest('.user-pill')&&ud.closest('.user-pill').classList.remove('open');
}
document.addEventListener('click',function(e){
  if(!e.target.closest('.nav-item')&&!e.target.closest('.user-pill'))closeAllDropdowns();
  if(!e.target.closest('#alerts-wrap')){var aw=document.getElementById('alerts-wrap');if(aw)aw.classList.remove('open');}
  if(!e.target.closest('#mkt-search')&&!e.target.closest('#mkt-search-results')){
    var r=document.getElementById('mkt-search-results');if(r)r.style.display='none';
  }
});

function toggleUserDropdown(){
  var pill=document.getElementById('user-pill');
  if(!pill)return;
  var wasOpen=pill.classList.contains('open');
  closeAllDropdowns();
  if(!wasOpen)pill.classList.toggle('open');
}

function showAnalyzeTab(tab){
  // tab = 'analyzer' | 'ideas'
  document.getElementById('tab-analyzer').style.display=tab==='analyzer'?'block':'none';
  document.getElementById('tab-ideas').style.display=tab==='ideas'?'block':'none';
  document.getElementById('atab-analyzer').classList.toggle('active',tab==='analyzer');
  document.getElementById('atab-ideas').classList.toggle('active',tab==='ideas');
  // First-time visitors have no league, so the player DB + values were never
  // loaded. Warm them the moment the analyzer opens so search and the verdict
  // work with zero setup - this is the core "drop a trade, get an answer" flow.
  if(tab==='analyzer')_warmAnalyzerData();
  if(tab==='ideas')renderIdeasTab();
  _tabPush(tab==='ideas'?'ideas':'analyzer','analyze');
}
function _warmAnalyzerData(){
  if(Object.keys(allPlayers).length<100&&!window._acLoading){
    window._acLoading=true;
    ensurePlayersLoaded().then(function(){window._acLoading=false;}).catch(function(){window._acLoading=false;});
  }
  if(!Object.keys(ktcFull||{}).length&&!window._ktcWarming){
    window._ktcWarming=true;
    try{fetchKtcValues(1,1,true);}catch(_){window._ktcWarming=false;}
  }
}

function renderIdeasTab(){
  var subEl=document.getElementById('ideas-tab-sub');
  if(!leagueRosters.length||!userId){
    var listEl=document.getElementById('ideas-list-tab');
    if(listEl)listEl.innerHTML='<div class="ideas-empty">Connect your league to get trade ideas built for your roster.'
      +'<br><button class="btn-load" style="width:auto;padding:11px 24px;margin-top:12px" onclick="goConnectLeague()">Connect your league</button></div>';
    return;
  }
  if(subEl)subEl.textContent='Based on your roster needs vs the rest of the league';
  generateTradeIdeas();
}

function openSwitchLeague(){
  // Quick in-place switcher: show your leagues right in the dropdown
  var box=document.getElementById('league-quick-list');
  if(box){box.remove();return;}
  var dd=document.getElementById('user-dropdown');
  if(!dd)return;
  var leagues=window._myLeagues||[];
  if(!leagues.length){goConnectLeague();return;}
  box=document.createElement('div');
  box.id='league-quick-list';
  box.innerHTML=leagues.slice(0,8).map(function(l,i){
    var active=l.league_id===leagueId;
    return '<div class="user-dd-item" style="padding-left:26px;font-size:12px'+(active?';color:var(--accent-bright)':'')+'" data-lqi="'+i+'">'+(active?'● ':'')+(l.name||'League')+' <span style="font-size:10px;color:var(--muted)">'+(l.season||'')+'</span></div>';
  }).join('');
  box.addEventListener('click',function(e){
    var it=e.target.closest('[data-lqi]');
    if(!it)return;
    e.stopPropagation();
    var l=leagues[parseInt(it.dataset.lqi)];
    if(l&&l.league_id!==leagueId){
      window._returnScreen=(document.querySelector('.screen.active')||{}).id;
      loadLeague(l.league_id,l.name,null,l.season);
    }
    closeAllDropdowns();
    box.remove();
  });
  var switchItem=dd.querySelector('[onclick*="openSwitchLeague"]');
  if(switchItem)switchItem.after(box);else dd.appendChild(box);
}

function updateUserPill(){
  var pill=document.getElementById('user-pill');
  var nameEl=document.getElementById('user-pill-name');
  var ddName=document.getElementById('user-dd-name');
  var ddLeague=document.getElementById('user-dd-league');
  var uname=localStorage.getItem('tm_username')||'';
  var si=document.getElementById('nav-signin');if(si)si.style.display=uname?'none':'inline-flex';
  var lname=localStorage.getItem('tm_league_name')||'';
  if(uname&&pill){
    pill.style.display='flex';
    if(nameEl)nameEl.textContent=uname;
    if(ddName)ddName.textContent=uname;
    if(ddLeague)ddLeague.textContent=lname?'League: '+lname:'No league loaded';
    var navCta=document.getElementById('nav-cta');if(navCta)navCta.style.display='none';
    try{_refreshProStatus();}catch(_){}
  }
}
// Account dropdown "Go Pro" / "Manage Subscription": label + action follow real status
window._isPro=window._isPro||false;
function _applyProLabel(){
  var l=document.getElementById('user-dd-pro-label');
  if(l)l.textContent=window._isPro?'Manage Subscription':'Go Pro';
}
async function _refreshProStatus(){
  var user=localStorage.getItem('tm_username')||'';
  if(!user){window._isPro=false;_applyProLabel();return;}
  try{
    var d=await (await fetch('/api/sage/quota?user='+encodeURIComponent(user)+'&device='+encodeURIComponent(_deviceId()))).json();
    window._isPro=!!d.pro;
  }catch(_){}
  _applyProLabel();
}
function sagePillPro(){ if(window._isPro){sageManageBilling();}else{sageUpgrade();} }

// Catch-all for entitlement changes that happen off-screen: a webhook that
// lands slower than the post-checkout poll, or a plan cancelled from another
// tab. Re-checks when the tab comes back to the foreground, so the UI can
// never sit on a stale Pro state waiting for a manual reload.
document.addEventListener('visibilitychange',function(){
  if(document.hidden)return;
  if(!localStorage.getItem('tm_username'))return;
  try{_refreshProStatus();}catch(_){}
  try{sageUpdateQuota();}catch(_){}
});

// Patch switchScreen to update nav-item-btn active states
var _origSwitchScreen=switchScreen;
// _noPush must pass through: popstate restores call switchScreen(name,true),
// and dropping the flag here made every back press push a new history entry.
switchScreen=function(name,_noPush){
  _origSwitchScreen(name,_noPush);
  _revealSafety(document.getElementById('screen-'+name));
  document.querySelectorAll('.nav-item-btn').forEach(function(b){
    b.classList.toggle('active',b.dataset.screen===name);
  });
  closeAllDropdowns();
  tabbarSync(name);
  // the draft sections render lazily, so folding has to happen on arrival
  if(name==='mock'){try{ctxFoldBlurbs();}catch(_){}}
};

// ── Phone tab bar ────────────────────────────────────────────────────────────
// The four direct tabs cannot cover every screen, so anything they don't own
// (League, Research, News, Community) lights up "More" instead of leaving the
// bar with nothing selected, which reads as broken.
var _TABBAR_DIRECT=['home','analyze','sage','mock'];
function tabbarSync(name){
  var bar=document.getElementById('tabbar');
  if(!bar)return;
  var target=_TABBAR_DIRECT.indexOf(name)===-1?'more':name;
  bar.querySelectorAll('.tabbar-item').forEach(function(b){
    b.classList.toggle('active',b.dataset.tab===target);
  });
}
// ── Phone: fold the tool blurbs ──────────────────────────────────────────────
// Each of these sections opens with a sentence or two explaining what it does.
// Useful the first time, dead weight on every visit after, and on a 390px
// screen it is what pushes the actual tool below the fold. Folded closed on a
// phone, left untouched on a desktop where the height is free.
var _CTX_SECTIONS=[
  ['md-setup','About the solo mock'],
  ['mp-card','About drafting with friends'],
  ['ld-card','About live draft assist']
];
function ctxFoldBlurbs(){
  if(!window.matchMedia||!window.matchMedia('(max-width:700px)').matches)return;
  _CTX_SECTIONS.forEach(function(pair){
    var host=document.getElementById(pair[0]);
    if(!host||host.dataset.ctxFolded==='1')return;
    // the blurb is the first prose leaf the section renders: no child elements,
    // small type, and long enough to be a sentence rather than a label
    var nodes=host.querySelectorAll('div,p'), blurb=null;
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(n.children.length)continue;
      if((n.textContent||'').trim().length<55)continue;
      if(parseFloat(getComputedStyle(n).fontSize)>13.5)continue;
      blurb=n;break;
    }
    if(!blurb||!blurb.parentNode)return;
    var det=document.createElement('details');
    det.className='ctx-fold';
    var sum=document.createElement('summary');
    sum.textContent=pair[1];
    det.appendChild(sum);
    blurb.parentNode.insertBefore(det,blurb);
    det.appendChild(blurb);
    host.dataset.ctxFolded='1';
  });
}
function tabGo(name){
  var drawerOpen=(document.getElementById('mob-menu')||{classList:{contains:function(){return false;}}}).classList.contains('open');
  if(name==='more'){mobMenuToggle();return;}
  if(drawerOpen)mobMenuToggle(); // never leave the drawer covering the screen we just opened
  if(name==='home'){goHome();return;}
  switchScreen(name);
  if(name==='mock'){try{mdRenderStrats();mdPrefillFromLeague();}catch(_){}}
}
// Paint the initial state from the DOM: the route restore below may or may not
// have run yet, so trusting a call order here would leave the bar blank.
try{
  var _initScr=(document.querySelector('.screen.active')||{}).id;
  tabbarSync(_initScr?_initScr.replace('screen-',''):'home');
}catch(_){}

// A tab left open across a deploy runs OLD code against NEW data - which is
// exactly what "the site is glitchy sometimes" turns out to be (a friend saw
// $82 auction prices the ceiling had already killed). Every time the tab comes
// back to the front, ask the server what the current build is; if it moved,
// say so and offer a reload. Never reloads on its own - a draft is in flight.
(function versionWatch(){
  var mine=null;
  try{
    var sc=document.querySelector('script[src*="app.js?v="]');
    mine=sc?(sc.getAttribute('src').split('v=')[1]||'').replace(/[^0-9]/g,''):null;
  }catch(_){}
  if(!mine)return;
  var shown=false;
  var lastCheck=0;
  function check(){
    if(shown||document.hidden)return;
    // never hammer: at most one check every 5 minutes no matter how often the
    // tab is switched, and never mid-pick (a re-render during your turn is
    // exactly the kind of "glitch" this was meant to prevent)
    var now=Date.now();
    if(now-lastCheck<300000)return;
    if(typeof MD!=='undefined'&&MD&&MD.onClock)return;
    if(typeof AU!=='undefined'&&AU&&AU.lot)return;
    lastCheck=now;
    fetch('/?vcheck='+now,{cache:'no-store'}).then(function(r){return r.text();}).then(function(t){
      var m=t.match(/app\.js\?v=(\d+)/);
      if(!m||m[1]===mine)return;
      shown=true;
      var bar=document.createElement('div');
      bar.id='tm-newver';
      bar.innerHTML='<span>A newer version of Mac Draft is live.</span>'
        +'<button onclick="location.reload(true)">Reload</button>'
        +'<button class="x" onclick="this.parentElement.remove()" aria-label="Dismiss">&times;</button>';
      document.body.appendChild(bar);
    }).catch(function(){});
  }
  document.addEventListener('visibilitychange',function(){if(!document.hidden)setTimeout(check,400);});
  setTimeout(check,60000);          // and once a minute into a long session
  setInterval(check,15*60*1000);    // then every 15 minutes
})();
// ── Auto-restore session from localStorage ───────────────────────────────────
(function restoreSession(){
  // signed-out visitors need the pill state painted too (shows Sign in button)
  try{updateUserPill();}catch(_){}
  var savedUser=localStorage.getItem('tm_username');
  var savedLeagueId=localStorage.getItem('tm_league_id');
  if(!savedUser)return;
  initBK(savedUser); // restore community identity so votes/posts work in every tab
  var input=document.getElementById('sleeper-username');
  if(input)input.value=savedUser;
  // Show a persistent "logged in" indicator with sign-out option
  var loginPanel=document.getElementById('login-panel');
  if(loginPanel){
    var banner=document.createElement('div');
    banner.id='session-banner';
    banner.style.cssText='display:flex;align-items:center;justify-content:space-between;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;margin-bottom:10px;font-size:12px;color:var(--muted2)';
    banner.innerHTML='<span>Signed in as <strong style="color:var(--text)">'+savedUser+'</strong>'+(savedLeagueId?(' · last league saved'):'')+'</span><button onclick="signOut()" style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;padding:2px 6px">Sign out</button>';
    loginPanel.insertBefore(banner,loginPanel.firstChild);
  }
  updateUserPill();
  // Show hero first - update CTA for returning user
  var badgeEl=document.getElementById('hero-badge-text');
  if(badgeEl)badgeEl.textContent='Welcome back, '+savedUser+'';
  // The hero CTA ships visible for everyone now, so there is nothing to reveal
  // here. Kept as a no-op guard in case an older cached index.html still has
  // the inline display:none.
  var heroCta=document.getElementById('hero-cta');
  if(heroCta)heroCta.style.display='';
  // No signing in every visit: the saved account and league connect themselves
  // in the background while the hero stays put. The connect card is NOISE for
  // a signed-in user - hide it entirely; loadLeague keeps it hidden on success
  // and signOut brings it back.
  if(savedLeagueId){
    if(loginPanel)loginPanel.style.display='none';
    setTimeout(function(){
      window._autoRestoring=true;
      try{loadUser(savedLeagueId);}catch(_){window._autoRestoring=false;}
    },600);
  }
})();

function signOut(){
  localStorage.removeItem('tm_username');
  localStorage.removeItem('tm_league_id');
  localStorage.removeItem('tm_league_name');
  bkUsername=null; bkBalance=0;
  var bkPill=document.getElementById('bk-pill'); if(bkPill)bkPill.style.display='none';
  var uPill=document.getElementById('user-pill'); if(uPill)uPill.style.display='none';
  var si=document.getElementById('nav-signin'); if(si)si.style.display='inline-flex'; // show Sign in again
  window._isPro=false;
  var navCta=document.getElementById('nav-cta');if(navCta)navCta.style.display='';
  var banner=document.getElementById('session-banner');
  if(banner)banner.remove();
  document.getElementById('sleeper-username').value='';
  var heroEl=document.querySelector('.hero');if(heroEl)heroEl.style.display='';_heroDismissed=false;
  var howEl=document.getElementById('how');if(howEl)howEl.style.display='';
  var howMini=document.getElementById('how-mini');if(howMini)howMini.style.display='none';
  resetAll();
}

// ── Ball Knowledge (BK) system ───────────────────────────────────────────────
var bkUsername=null, bkBalance=0;

async function initBK(username){
  if(!username)return;
  bkUsername=username;
  try{
    var res=await fetch('/api/community/user/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username})});
    if(res.ok){
      var data=await res.json();
      bkBalance=data.bk_balance!=null?data.bk_balance:250;
    } else {
      bkBalance=parseInt(localStorage.getItem('tm_bk_'+username)||'250');
    }
  }catch(e){
    bkBalance=parseInt(localStorage.getItem('tm_bk_'+username)||'250');
  }
  updateBKDisplay();
}

function updateBKDisplay(){
  var el=document.getElementById('bk-amount'); if(el)el.textContent=bkBalance;
  var pill=document.getElementById('bk-pill'); if(pill)pill.style.display='flex';
  if(bkUsername)localStorage.setItem('tm_bk_'+bkUsername,String(bkBalance));
}

async function chargeBK(){
  // Analysis is always free. BK remains as community karma (earned via likes) only.
  return true;
}

// ── Community feed ───────────────────────────────────────────────────────────
var communityOffset=0, communityLoading=false;
var forumOffset=0, forumLoading=false, forumLoaded=false;
var activeCommunityTab='trades';

function switchCommunityTab(tab){
  activeCommunityTab=tab;
  if(tab==='learn')_fillLearnPanel();
  if(tab==='news')_fillNewsPanel();
  ['trades','mine','forum','news','learn','feedback'].forEach(function(t){
    var pane=document.getElementById('community-tab-'+t);
    if(pane)pane.style.display=t===tab?'block':'none';
    var tb=document.getElementById('ctab-'+t);
    if(tb)tb.classList.toggle('active',t===tab);
  });
  if(tab==='mine')loadMyTrades(true);
  if(tab==='forum'){try{renderForumCompose();}catch(_){}if(!forumLoaded)loadForumFeed();}
  if(tab==='feedback')loadFeedbackTab();
  // The News wire polls for fresh drops while it is open and stops when you
  // leave the tab, so a backgrounded Community tab never keeps fetching.
  _newsPollControl(tab==='news');
  _tabPush(tab,'community');
}
// News used to be its own top-level screen reached from the "More" menu. With
// "More" gone, it lives as a tab inside Community. Its markup still ships in the
// hidden #screen-news container; the first time the News tab opens we move that
// content into the Community panel (same relocation pattern as Learn).
function _fillNewsPanel(){
  var dst=document.getElementById('community-tab-news');
  var src=document.getElementById('screen-news');
  if(dst&&!dst._filled){
    dst.innerHTML='';
    if(src){while(src.firstChild)dst.appendChild(src.firstChild);}
    dst._filled=true;
  }
  try{loadNewsGrid();loadAnalystCorner();}catch(_){}
}
function _newsPollControl(on){
  try{
    if(on){
      if(!window._newsPoll)window._newsPoll=setInterval(function(){
        if(document.hidden)return;
        try{loadNewsGrid(true);loadAnalystCorner(true);}catch(_){}
      },90000);
    }else if(window._newsPoll){clearInterval(window._newsPoll);window._newsPoll=null;}
  }catch(_){}
}
// Open the News content wherever it lives now (Community > News tab).
function goNews(){switchScreen('community');switchCommunityTab('news');}

// Learn (Dynasty 101 / Nerd Stats / Archetypes / About) now lives as a tab inside
// Community. Its markup still ships inside the hidden #screen-learn container; the
// first time the Learn tab opens we move that content into the Community panel.
function _fillLearnPanel(){
  var dst=document.getElementById('community-tab-learn');
  var src=document.getElementById('screen-learn');
  if(!dst||dst._filled)return;
  dst.innerHTML='';
  if(src){while(src.firstChild)dst.appendChild(src.firstChild);}
  dst._filled=true;
  try{renderArchetypeGuide();}catch(_){}
}
// Self-scoped tab switch for the relocated Learn content (does not touch the
// outer Community tab bar, which switchCommunityTab owns).
function switchLearnTab(el,id){
  var scope=document.getElementById('community-tab-learn');
  if(!scope)return;
  scope.querySelectorAll('.inner-tab').forEach(function(t){t.classList.remove('active');});
  scope.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active');});
  if(el)el.classList.add('active');
  var c=document.getElementById(id);if(c)c.classList.add('active');
  try{_revealSafety(c);}catch(_){}
}
// Open the Learn content wherever it lives now (Community > Learn tab).
function goLearn(){switchScreen('community');switchCommunityTab('learn');}

function refreshActiveCommunityTab(){
  if(activeCommunityTab==='forum')loadForumFeed(true);
  else if(activeCommunityTab==='mine')loadMyTrades(true);
  else if(activeCommunityTab==='feedback')loadFeedbackTab();
  else loadCommunityFeed(true);
}

// ── Feedback: users submit privately; only the founder sees the inbox ─────────
function _tmUser(){var u=bkUsername;if(!u){try{u=localStorage.getItem('tm_username');}catch(_){}}return u||'';}
async function submitFeedback(){
  var inp=document.getElementById('feedback-input');
  var st=document.getElementById('feedback-status');
  var text=inp?inp.value.trim():'';
  if(!text){if(st){st.textContent='Write something first.';st.style.color='var(--muted)';}return;}
  if(st){st.textContent='Sending...';st.style.color='var(--muted)';}
  try{
    var res=await fetch('/api/community/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:_tmUser()||'anonymous',text:text})});
    if(!res.ok)throw new Error('failed');
    if(inp)inp.value='';
    if(st){st.textContent='Thank you - the founder gets this directly.';st.style.color='var(--green)';}
    loadFeedbackTab();
  }catch(e){if(st){st.textContent='Could not send. Try again.';st.style.color='var(--red)';}}
}
async function loadFeedbackTab(){
  // The inbox only renders for the founder; everyone else just sees the form.
  var box=document.getElementById('feedback-admin');
  if(!box)return;
  if(_tmUser().toLowerCase()!=='wolco'){box.style.display='none';return;}
  box.style.display='block';
  box.innerHTML='<div style="font-size:12px;color:var(--muted)">Loading feedback inbox...</div>';
  try{
    var res=await fetch('/api/community/feedback?username='+encodeURIComponent(_tmUser()));
    if(!res.ok){box.innerHTML='';return;}
    var items=await res.json();
    if(!items.length){box.innerHTML='<div style="font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:14px">No feedback yet.</div>';return;}
    box.innerHTML='<div style="font-size:13px;font-weight:800;color:var(--text);border-top:1px solid var(--border);padding-top:14px;margin-bottom:10px">Feedback inbox <span style="font-size:11px;font-weight:600;color:var(--muted)">(only you see this)</span></div>'
      +items.map(function(f){
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:8px">'
          +'<div style="font-size:13px;color:var(--text);line-height:1.55;white-space:pre-wrap">'+escHtml(f.text)+'</div>'
          +'<div style="font-size:10.5px;color:var(--muted);margin-top:6px">@'+escHtml(f.from)+' · '+timeAgo(f.created_at)+'</div></div>';
      }).join('');
  }catch(e){box.innerHTML='';}
}

function renderForumCompose(){
  var el=document.getElementById('forum-compose-inner');
  if(!el)return;
  // If signed in via the main flow, use that identity for the community too.
  if(!bkUsername){var _tu=localStorage.getItem('tm_username');if(_tu){bkUsername=_tu;try{updateBKDisplay();}catch(_){}}}
  if(!bkUsername){
    el.innerHTML='<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px 0">Sign in with your Sleeper username to drop a hot take.</div>';
    return;
  }
  el.innerHTML='<div class="comm-opinion-input" style="margin-bottom:0">'
    +'<input id="forum-title-input" placeholder="Your take in one line..." maxlength="160" style="width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:13px;color:var(--text);margin-bottom:6px;outline:none">'
    +'<textarea id="forum-body-input" placeholder="Expand on it... (optional)" maxlength="400" rows="2" style="width:100%;box-sizing:border-box;resize:vertical"></textarea>'
    +'<div class="post-row">'
    +'<span style="font-size:11px;color:var(--muted)">@'+escHtml(bkUsername)+'</span>'
    +'<button onclick="postForumTake()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer">Post Take</button>'
    +'</div></div>';
}

async function postForumTake(){
  if(!bkUsername){var _tu=localStorage.getItem('tm_username');if(_tu)bkUsername=_tu;}
  if(!bkUsername){alert('Sign in first.');return;}
  var titleEl=document.getElementById('forum-title-input');
  var bodyEl=document.getElementById('forum-body-input');
  var title=(titleEl?titleEl.value.trim():'');
  var body=(bodyEl?bodyEl.value.trim():'');
  if(!title){alert('Add a title for your take.');return;}
  try{
    var res=await fetch('/api/community/forum/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,title:title,body:body,source:'community',team_name:leagueName||''})});
    if(!res.ok){var e=await res.json();alert(e.error||'Failed to post.');return;}
    if(titleEl)titleEl.value='';
    if(bodyEl)bodyEl.value='';
    loadForumFeed(true);
  }catch(e){alert('Failed to post. Try again.');}
}

async function loadForumFeed(reset){
  if(forumLoading)return;
  forumLoading=true;
  if(reset!==false){forumOffset=0;}
  var feed=document.getElementById('forum-feed');
  if(forumOffset===0&&feed)feed.innerHTML='<div class="tm-skel-feed"><div class="tm-skel"></div><div class="tm-skel"></div><div class="tm-skel"></div></div>';
  try{
    var res=await fetch('/api/community/forum?offset='+forumOffset);
    var posts=res.ok?await res.json():[];
    if(forumOffset===0&&feed)feed.innerHTML='';
    if(!posts||!posts.length){
      if(forumOffset===0&&feed)feed.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No hot takes yet. Drop the first one above!</div>';
      var btn=document.getElementById('forum-load-more-btn');if(btn)btn.style.display='none';
    }else{
      posts.forEach(function(p){if(feed)feed.insertAdjacentHTML('beforeend',renderForumPost(p));});
      forumOffset+=posts.length;
      var btn=document.getElementById('forum-load-more-btn');if(btn)btn.style.display=posts.length===20?'inline-block':'none';
    }
  }catch(e){
    if(feed)feed.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted)">Couldn\'t load takes.</div>';
  }
  forumLoading=false;
}

function loadMoreForumFeed(){loadForumFeed(false);}

function renderForumPost(p){
  var srcIcon=p.source==='twitter'?'𝕏':p.source==='reddit'?'r/':'';
  var srcColor=p.source==='twitter'?'#1DA1F2':p.source==='reddit'?'#FF6314':'var(--accent-bright)';
  var srcLabel=p.source==='twitter'?'Twitter':p.source==='reddit'?'Reddit':'Community';
  var srcPill='<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+srcColor+'22;color:'+srcColor+';text-transform:uppercase;letter-spacing:.06em">'+escHtml(srcIcon+' '+srcLabel)+'</span>';
  var ts=p.created_at?timeAgo(p.created_at):'';
  var totalVotes=(p.upvotes||0)+(p.downvotes||0);
  var upPct=totalVotes>0?Math.round((p.upvotes||0)/totalVotes*100):0;
  var replyCount=p.reply_count||0;
  return '<div class="comm-card" id="fpost-'+p.id+'" style="border-left:3px solid '+srcColor+'">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    +'<div style="display:flex;align-items:center;gap:8px">'
    +'<div style="width:30px;height:30px;border-radius:50%;background:'+srcColor+'22;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:'+srcColor+'">'+escHtml((p.username||'?')[0].toUpperCase())+'</div>'
    +'<div><div style="font-size:13px;font-weight:700;color:var(--text)">@'+escHtml(p.username)+'</div>'
    +(p.team_name?'<div style="font-size:10px;color:var(--muted)">'+escHtml(p.team_name)+' · '+ts+'</div>':'<div style="font-size:10px;color:var(--muted)">'+ts+'</div>')
    +'</div></div>'
    +srcPill+'</div>'
    +'<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;line-height:1.35">'+escHtml(p.title||'')+'</div>'
    +(p.body?'<div style="font-size:13px;color:var(--muted2);margin-bottom:10px;line-height:1.5">'+escHtml(p.body)+'</div>':'')
    +(totalVotes>0?'<div style="height:3px;border-radius:2px;background:var(--surface3);margin-bottom:10px;overflow:hidden"><div style="height:100%;width:'+upPct+'%;background:var(--green);transition:width .3s"></div></div>':'')
    +'<div class="comm-vote-row">'
    +'<button class="comm-vote-btn" onclick="voteForumPost(\''+p.id+'\',1,this)">▲ '+(p.upvotes||0)+'</button>'
    +'<button class="comm-vote-btn" onclick="voteForumPost(\''+p.id+'\',-1,this)">▼ '+(p.downvotes||0)+'</button>'
    +'<button class="comm-opinion-btn" onclick="toggleForumReplies(\''+p.id+'\')"> '+replyCount+' '+(replyCount===1?'reply':'replies')+'</button>'
    +'</div>'
    +'<div class="comm-opinions" id="freplies-'+p.id+'" style="display:none"></div>'
    +'</div>';
}

async function voteForumPost(postId,vote,btn){
  if(!bkUsername){var _tu=localStorage.getItem('tm_username');if(_tu)bkUsername=_tu;}
  if(!bkUsername){alert('Sign in to vote.');return;}
  var vkey='tm_fvoted_'+postId;
  try{if(localStorage.getItem(vkey)===String(vote))return;}catch(_){}
  try{
    var res=await fetch('/api/community/forum/vote/'+postId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,vote:vote})});
    if(!res.ok)return;
    var d=await res.json();
    try{localStorage.setItem(vkey,String(vote));}catch(_){}
    var row=btn.parentNode;
    if(row){
      var btns=row.querySelectorAll('.comm-vote-btn');
      if(btns.length>=2){
        btns[0].classList.toggle('voted-up',vote===1);
        btns[1].classList.toggle('voted-down',vote===-1);
        if(d.upvotes!=null)btns[0].textContent='▲ '+d.upvotes;
        if(d.downvotes!=null)btns[1].textContent='▼ '+d.downvotes;
      }
    }
  }catch(e){}
}

function toggleOppExplain(){
  var box=document.getElementById('opp-explain-box');
  var tog=document.getElementById('opp-explain-toggle');
  if(!box)return;
  var open=box.style.display==='block';
  box.style.display=open?'none':'block';
  if(tog)tog.textContent=open?'How we calculate this ▾':'Hide explanation ▴';
}

async function toggleForumReplies(postId){
  var el=document.getElementById('freplies-'+postId);
  if(!el)return;
  if(el.style.display==='block'){el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">Loading replies...</div>';
  try{
    var res=await fetch('/api/community/forum/replies/'+postId);
    var replies=res.ok?await res.json():[];
    var replyInput=bkUsername
      ?'<div class="comm-opinion-input" style="margin-top:8px"><textarea id="fr-input-'+postId+'" placeholder="Reply..." maxlength="280" rows="2"></textarea>'
        +'<div class="post-row"><button onclick="postForumReply(\''+postId+'\')" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer">Reply</button></div></div>'
      :'<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Sign in to reply.</div>';
    if(!replies.length){
      el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:6px 0">No replies yet.</div>'+replyInput;
    }else{
      var html=replies.map(function(r){
        return '<div class="comm-op-row">'
          +'<span class="comm-op-user">@'+escHtml(r.username)+'</span>'
          +'<span class="comm-op-text">'+escHtml(r.body)+'</span>'
          +'</div>';
      }).join('');
      el.innerHTML=html+replyInput;
    }
  }catch(e){el.innerHTML='<div style="color:var(--muted);font-size:12px">Couldn\'t load replies.</div>';}
}

async function postForumReply(postId){
  if(!bkUsername){alert('Sign in to reply.');return;}
  var input=document.getElementById('fr-input-'+postId);
  var text=input?(input.value||'').trim():'';
  if(!text)return;
  try{
    var res=await fetch('/api/community/forum/reply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,post_id:postId,body:text})});
    if(!res.ok){var e=await res.json();alert(e.error||'Failed.');return;}
    if(input)input.value='';
    var el=document.getElementById('freplies-'+postId);
    if(el){el.style.display='none';toggleForumReplies(postId);}
    // Bump reply count in card
    var replyBtn=document.querySelector('#fpost-'+postId+' .comm-opinion-btn');
    if(replyBtn){var c=parseInt(replyBtn.textContent.match(/\d+/)||0)+1;replyBtn.textContent=' '+c+' '+(c===1?'reply':'replies');}
  }catch(e){alert('Failed. Try again.');}
}

var QOTD=[
  'Who is the one player you refuse to draft this season, and why?',
  'What is the worst trade you have ever accepted?',
  'Which rookie will outscore his draft cost by the most?',
  'Name a player everyone loves that you think busts this year.',
  'What is the best trade you ever pulled off?',
  'Which team in your league is the easiest to fleece, and how?',
  'Zero RB in 2026: genius or suicide?',
  'Who wins the most leagues this season: a QB, RB, WR or TE - and who is it?',
  'What is your unbreakable draft rule?',
  'Which veteran falls off a cliff this season?',
  'The player you are highest on versus consensus - defend him.',
  'Trade your first rounder for a proven starter: when is it right?',
  'Who is the best value pick sitting after pick 100 right now?',
  'What position do you never draft early, and why?'
];
function qotdHtml(){
  var day=Math.floor(Date.now()/86400000);
  var q=QOTD[day%QOTD.length];
  return '<div class="qotd"><div class="qotd-label">Question of the day</div>'
    +'<div class="qotd-q">'+q+'</div>'
    +'<button class="comm-opinion-btn" style="margin:10px 0 0" onclick="switchCommunityTab(\'forum\');setTimeout(function(){var t=document.querySelector(\'#forum-compose-inner textarea,#forum-compose-inner input[type=text]\');if(t){t.focus();t.placeholder=QOTD[Math.floor(Date.now()/86400000)%QOTD.length];}},250)">Drop your take</button></div>';
}
async function loadCommunityFeed(reset){
  if(communityLoading)return;
  communityLoading=true;
  if(reset!==false){communityOffset=0;}
  var feed=document.getElementById('community-feed');
  if(communityOffset===0&&feed)feed.innerHTML='<div class="tm-skel-feed"><div class="tm-skel"></div><div class="tm-skel"></div><div class="tm-skel"></div></div>';
  try{
    var res=await fetch('/api/community/feed?offset='+communityOffset+'&t='+Date.now());
    var posts=res.ok?await res.json():[];
    if(communityOffset===0&&feed)feed.innerHTML=qotdHtml();
    if(!posts||!posts.length){
      if(communityOffset===0&&feed){
        feed.innerHTML=qotdHtml()+renderSageDebates()+'<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">No community trades yet - run an analysis and be the first to share!</div>';
        for(var si=0;si<4;si++)renderSageComments(si);
      }
      var btn=document.getElementById('load-more-btn');if(btn)btn.style.display='none';
    }else{
      posts.forEach(function(p){if(feed)feed.insertAdjacentHTML('beforeend',renderTradePost(p));});
      communityOffset+=posts.length;
      var btn=document.getElementById('load-more-btn');if(btn)btn.style.display=posts.length===20?'inline-block':'none';
    }
  }catch(e){
    if(feed)feed.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted)">Couldn\'t load feed. Check your connection.</div>';
  }
  communityLoading=false;
}

function loadMoreFeed(){loadCommunityFeed(false);}

// ── My Trades: the signed-in manager's own published trades ──────────────────
var myTradesLoaded=false;
async function loadMyTrades(reset){
  var feed=document.getElementById('mytrades-feed');
  if(!feed)return;
  if(!bkUsername){var _tu=localStorage.getItem('tm_username');if(_tu)bkUsername=_tu;}
  if(!bkUsername){feed.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">Sign in with your Sleeper username to see the trades you\'ve published.</div>';return;}
  feed.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted)">Loading your trades...</div>';
  try{
    // Ownership travels in the account key header, not in a guessable username.
    var res=await fetch('/api/community/feed/mine');
    var posts=res.ok?await res.json():[];
    if(!posts.length){feed.innerHTML='<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">You haven\'t published any trades yet. Analyze a trade, then hit "Post to Community" to get opinions.</div>';return;}
    feed.innerHTML=posts.map(renderTradePost).join('');
    myTradesLoaded=true;
  }catch(e){feed.innerHTML='<div style="padding:32px;text-align:center;color:var(--muted)">Couldn\'t load your trades.</div>';}
}

// ── Trade search: every community deal a given player appeared in ─────────────
var _tsTimer=null;
function tradeSearchInput(){
  var inp=document.getElementById('trade-search-input');
  var dd=document.getElementById('trade-search-dd');
  if(!inp||!dd)return;
  var q=inp.value.toLowerCase().trim();
  if(q.length<2){dd.classList.remove('open');if(!q)hideTradeSearchResults();return;}
  clearTimeout(_tsTimer);
  _tsTimer=setTimeout(async function(){
    await ensurePlayersLoaded();
    var results=Object.values(allPlayers).filter(function(p){
      return p.name&&p.name.toLowerCase().indexOf(q)>=0&&['QB','RB','WR','TE'].indexOf(p.pos)>=0;
    }).sort(function(a,b){return (ktcById[b.id]||0)-(ktcById[a.id]||0);}).slice(0,6);
    dd.innerHTML='';
    results.forEach(function(p){
      var d=document.createElement('div');
      d.className='ac-item';d.style.cssText='display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer';
      d.innerHTML='<img src="https://sleepercdn.com/content/nfl/players/thumb/'+p.id+'.jpg" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.visibility=\'hidden\'"><span style="flex:1"></span><span style="font-size:10px;color:var(--muted)">'+p.pos+' · '+(p.team||'FA')+'</span>';
      d.children[1].textContent=p.name;
      d.addEventListener('mousedown',function(ev){ev.preventDefault();inp.value=p.name;dd.classList.remove('open');runTradeSearch(p.name);});
      dd.appendChild(d);
    });
    dd.classList.toggle('open',results.length>0);
  },160);
}
function hideTradeSearchResults(){var r=document.getElementById('trade-search-results');if(r){r.style.display='none';r.innerHTML='';}}
async function runTradeSearch(name){
  var box=document.getElementById('trade-search-results');
  if(!box)return;
  box.style.display='block';
  box.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">Searching community trades for '+escHtml(name)+'...</div>';
  try{
    var res=await fetch('/api/community/player-trades?name='+encodeURIComponent(name));
    var d=res.ok?await res.json():{deals:[]};
    var deals=(d&&d.deals)||[];
    if(!deals.length){
      box.innerHTML='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;color:var(--muted);font-size:13px">No community trades with '+escHtml(name)+' yet. As people publish deals, they\'ll show up here.</div>';
      return;
    }
    var head='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><div style="font-size:13px;font-weight:700;color:var(--text)">'+deals.length+' community trade'+(deals.length===1?'':'s')+' with '+escHtml(name)+'</div><button class="btn-sm" onclick="clearTradeSearch()">Clear</button></div>';
    box.innerHTML=head+deals.map(renderTradePost).join('');
  }catch(e){box.innerHTML='<div style="padding:16px;text-align:center;color:var(--muted)">Search failed. Try again.</div>';}
}
function clearTradeSearch(){var i=document.getElementById('trade-search-input');if(i)i.value='';hideTradeSearchResults();}


// Analyst Corner: curated posts rendered with X's official embed system
var ANALYST_TWEETS=[
  'https://twitter.com/17gamepace/status/2077015118781559093',
  'https://twitter.com/joeorrico/status/2075202628963758551',
  'https://twitter.com/dynastydadff/status/2074239582414024767',
  'https://twitter.com/salvetridfs/status/2076683839489949914'
];
var _analystLoaded=false;

// Resolve a curated post through our server: if it carries native X video (or a
// YouTube link), we render OUR OWN card with an on-site player - no bouncing to x.com.
// Only plain text posts fall back to X's embed widget.
function _tweetIdFromUrl(u){var m=u.match(/status\/(\d+)/);return m?m[1]:null;}
function _nativeTweetCard(d,url){
  var text=(d.text||'').replace(/</g,'&lt;').replace(/https:\/\/t\.co\/\w+/g,'').trim();
  var media='';
  if(d.video&&d.video.mp4){
    media='<video controls playsinline preload="metadata" '+(d.video.poster?'poster="'+d.video.poster+'" ':'')+'src="'+d.video.mp4+'" style="width:100%;border-radius:10px;margin-top:8px;background:#000;display:block"></video>';
  }else if(d.youtube){
    media='<div style="position:relative;padding-top:56.25%;margin-top:8px;border-radius:10px;overflow:hidden"><iframe src="https://www.youtube-nocookie.com/embed/'+d.youtube+'" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="encrypted-media;picture-in-picture" allowfullscreen loading="lazy"></iframe></div>';
  }else if(d.photo){
    media='<img src="'+d.photo+'" style="width:100%;border-radius:10px;margin-top:8px;display:block" loading="lazy">';
  }
  return '<div class="tm-tweet-card">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
    +(d.avatar?'<img src="'+d.avatar+'" style="width:32px;height:32px;border-radius:50%" onerror="this.style.display=\'none\'">':'')
    +'<div style="min-width:0;flex:1"><div style="font-size:12.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(d.name||'')+'</div>'
    +'<div style="font-size:11px;color:var(--muted)">@'+(d.screen_name||'')+'</div></div>'
    +'<a href="'+url+'" target="_blank" rel="noopener" title="Open the original post" style="font-size:11px;font-weight:800;color:var(--muted);text-decoration:none;flex-shrink:0">X ↗</a>'
    +'</div>'
    +'<div style="font-size:12.5px;color:var(--muted2);line-height:1.55">'+text+'</div>'
    +media
    +'</div>';
}
function renderAnalystSlots(box,urls){
  var theme=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';
  box.innerHTML=urls.map(function(u,i){
    return '<div class="analyst-slot" id="'+box.id+'-slot-'+i+'" style="break-inside:avoid;margin-bottom:10px">'
      +'<div class="analyst-skel" style="height:120px;border-radius:12px;background:var(--surface2);animation:pulse 1.4s ease-in-out infinite"></div>'
      +'</div>';
  }).join('');
  var pending=urls.length;
  var needEmbed=[];
  urls.forEach(function(u,i){
    var slot=document.getElementById(box.id+'-slot-'+i);
    var id=_tweetIdFromUrl(u);
    var done=function(html,embed){
      if(!slot)return;
      if(html){slot.innerHTML=html;}
      else if(embed){slot.innerHTML='<blockquote class="twitter-tweet" data-theme="'+theme+'" data-dnt="true" data-conversation="none"><a href="'+u+'"></a></blockquote>';needEmbed.push(slot);}
      else{slot.remove();}
      if(--pending===0)_finishAnalystEmbeds(box,needEmbed,urls);
    };
    if(!id){done(null,true);return;}
    fetch('/api/news/tweet/'+id).then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(d&&(d.video||d.youtube))done(_nativeTweetCard(d,u),false);
      else done(null,true); // text/photo posts: X embed still looks best
    }).catch(function(){done(null,true);});
  });
}
function _finishAnalystEmbeds(box,slots,urls){
  if(!slots.length)return;
  var s=document.createElement('script');
  s.src='https://platform.twitter.com/widgets.js';
  s.async=true;
  s.onload=function(){
    if(window.twttr&&twttr.widgets&&twttr.widgets.load)twttr.widgets.load(box);
    if(window.twttr&&twttr.events)twttr.events.bind('rendered',function(ev){
      var slot=ev.target&&ev.target.closest?ev.target.closest('.analyst-slot'):null;
      if(slot){var sk=slot.querySelector('.analyst-skel');if(sk)sk.remove();}
    });
  };
  document.body.appendChild(s);
  // Cleanup: drop any embed that never converted so it can't leave a blank hole
  setTimeout(function(){
    slots.forEach(function(slot){
      if(!slot.isConnected)return;
      var sk=slot.querySelector('.analyst-skel');if(sk)sk.remove();
      if(!slot.querySelector('iframe')&&!slot.querySelector('.tm-tweet-card'))slot.remove();
    });
  },8000);
}
// ── Analyst Corner: auto-pulled fantasy takes ───────────────────────────────
// Draws from the free, self-refreshing news feed (RotoWire analyst player notes,
// Reddit community posts once REDDIT_CLIENT_ID/SECRET are set, and fantasy-tagged
// headlines). No hand-curated tweets, no paid API - it stays fresh on its own.
var _ANALYST_RE=/fantasy|waiver|start.?sit|sit\/start|sleeper|dynasty|ranking|breakout|bust|target|snap|usage|depth chart|draft|adp|rookie|handcuff|stash|buy low|sell high|injur|questionable|doubtful|\bout\b|return|camp|role|workload|touches|carries/i;
function _analystPick(articles){
  // Rank: RotoWire notes first, then Reddit community, then fantasy-tagged news.
  // Anything that isn't fantasy-relevant is dropped so the rail stays on-topic.
  return (articles||[]).map(function(a,i){
    var s=a.source||'',k=3;
    if(s.indexOf('RotoWire')>=0)k=0;
    else if(s.indexOf('r/')===0)k=1;
    else if(_ANALYST_RE.test(a.headline||''))k=2;
    return {a:a,k:k,i:i};
  }).filter(function(o){return o.k<3;})
    .sort(function(x,y){return x.k-y.k||x.i-y.i;})
    .map(function(o){return o.a;});
}
function _srcMeta(src){
  var s=src||'';
  if(s.indexOf('RotoWire')>=0)return {c:'#2f6fd6',label:'RotoWire'};
  if(s.indexOf('r/')===0)return {c:'#ff6314',label:s};
  if(s.indexOf('Yahoo')>=0)return {c:'#6001d2',label:'Yahoo Sports'};
  if(s.indexOf('ESPN')>=0)return {c:'#d50a0a',label:'ESPN'};
  return {c:'var(--accent-bright)',label:s||'News'};
}
function _analystCardHtml(a){
  var m=_srcMeta(a.source);
  var h=(a.headline||'').replace(/</g,'&lt;');
  var d=String(a.description||'').replace(/</g,'&lt;');
  return '<a class="analyst-card" href="'+a.link+'" target="_blank" rel="noopener">'
    +'<div class="ac-src" style="color:'+m.c+'"><span class="ac-dot" style="background:'+m.c+'"></span>'+m.label+'</div>'
    +'<div class="ac-h">'+h+'</div>'
    +'<div class="ac-d">'+d+'</div>'
    +'<div class="ac-f">Read the take ↗</div>'
    +'</a>';
}
function _analystSkel(n){
  var one='<div class="analyst-skel" style="width:300px;height:152px;border-radius:12px;flex:0 0 auto;background:var(--surface2);animation:pulse 1.4s ease-in-out infinite"></div>';
  return new Array(n||3).fill(one).join('');
}
function loadAnalystCorner(force){
  if(_analystLoaded&&!force)return;
  _analystLoaded=true;
  if(force){try{fetchArticlesOnce(true);}catch(_){}}
  var box=document.getElementById('analyst-corner');
  if(!box)return;
  box.innerHTML=_analystSkel(4);
  fetchArticlesOnce().then(function(d){
    var picks=_analystPick((d||{}).articles).slice(0,10);
    if(!picks.length){box.innerHTML='<div class="empty-state">No analyst takes right now. Check back soon.</div>';_analystLoaded=false;return;}
    box.innerHTML=picks.map(_analystCardHtml).join('');
    initAutoRail(box,34);
  }).catch(function(){_analystLoaded=false;box.innerHTML='';});
}

// Auto-scrolling rail: drifts sideways like the live ticker, but you can grab it,
// flick it on touch, or mouse-wheel it - it politely waits, then resumes drifting.
function initAutoRail(el,pxPerSec){
  if(!el||el._railOn)return;
  el._railOn=true;
  var speed=(pxPerSec||40)/60,idleT=null,paused=false,dragging=false,sx=0,sl=0,dir=1;
  function pause(ms){paused=true;clearTimeout(idleT);idleT=setTimeout(function(){paused=false;},ms||3500);}
  el.addEventListener('mouseenter',function(){paused=true;clearTimeout(idleT);});
  el.addEventListener('mouseleave',function(){pause(900);});
  el.addEventListener('wheel',function(){pause();},{passive:true});
  el.addEventListener('touchstart',function(){pause(4500);},{passive:true});
  el.addEventListener('mousedown',function(e){if(e.target.closest('video,iframe,a,button'))return;dragging=true;el.classList.add('dragging');sx=e.pageX;sl=el.scrollLeft;paused=true;e.preventDefault();});
  window.addEventListener('mousemove',function(e){if(!dragging)return;el.scrollLeft=sl-(e.pageX-sx);});
  window.addEventListener('mouseup',function(){if(dragging){dragging=false;el.classList.remove('dragging');pause();}});
  function step(){
    if(!paused&&!dragging&&el.offsetParent&&el.scrollWidth>el.clientWidth+20){
      el.scrollLeft+=speed*dir;
      var max=el.scrollWidth-el.clientWidth-1;
      if(el.scrollLeft>=max)dir=-1;      // bounce at the ends instead of snapping
      else if(el.scrollLeft<=0)dir=1;
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

var _newsLoaded=false;
function loadNewsGrid(force){
  if(_newsLoaded&&!force)return;
  _newsLoaded=true;
  if(force){try{fetchArticlesOnce(true);}catch(_){}}
  fetchArticlesOnce().then(function(d){
    var grid=document.getElementById('news-grid');
    if(!grid)return;
    initAutoRail(grid);
    var FANTASY_RE=/fantasy|waiver|start.?sit|sleeper|dynasty|rankings|injur|trade|depth chart|rotowire|r\//i;
    var arts=(d.articles||[]).slice().sort(function(a,b){
      var af=FANTASY_RE.test(a.headline+(a.source||''))?0:1;
      var bf=FANTASY_RE.test(b.headline+(b.source||''))?0:1;
      return af-bf;
    }).slice(0,12);
    if(!arts.length){grid.innerHTML='<div class="empty-state">No headlines right now. Check back soon.</div>';_newsLoaded=false;return;}
    grid.innerHTML=arts.map(function(a){
      var m=_srcMeta(a.source);
      return '<a class="news-card" href="'+a.link+'" target="_blank" rel="noopener">'
        +(a.image?'<img src="'+a.image+'" alt="" loading="lazy" onload="try{this.animate([{opacity:0},{opacity:1}],{duration:350,easing:\'ease\'})}catch(e){}">':'<div class="nc-noimg">'+m.label+'</div>')
        +'<div class="nc-body"><div class="nc-h">'+a.headline.replace(/</g,'&lt;')+'</div>'
        +'<div class="nc-d">'+String(a.description||'').replace(/</g,'&lt;')+'</div>'
        +'<div style="font-size:10px;font-weight:700;margin-top:4px;color:'+m.c+'">'+m.label+' ↗</div></div></a>';
    }).join('');
  }).catch(function(){_newsLoaded=false;});
}


// Real NFL headlines from ESPN for the community screen
var _atlLoaded=false;
function loadAroundTheLeague(){
  if(_atlLoaded)return;
  _atlLoaded=true;
  fetch('/api/news/nfl').then(function(r){return r.json();}).then(function(d){
    var hs=(d.headlines||[]).filter(function(h){return h&&h.length>25;}).slice(0,6);
    if(!hs.length)return;
    var card=document.getElementById('atl-card');
    var box=document.getElementById('atl-headlines');
    if(!card||!box)return;
    box.innerHTML=hs.map(function(h){
      return '<div style="font-size:12px;color:var(--muted2);line-height:1.5;display:flex;gap:8px"><span style="color:var(--accent-bright)">›</span><span>'+h.replace(/</g,'&lt;')+'</span></div>';
    }).join('');
    card.style.display='block';
  }).catch(function(){});
}

// Comments on Mac debate posts. Stored locally until the community database is restored;
// once Supabase is back these migrate to shared storage.
function getSageComments(i){try{return JSON.parse(localStorage.getItem('tm_sagec_'+i)||'[]');}catch(e){return[];}}
function renderSageComments(i){
  var list=document.getElementById('sage-clist-'+i);
  var cc=document.getElementById('sage-cc-'+i);
  if(!list)return;
  var comments=getSageComments(i);
  if(cc)cc.textContent=comments.length;
  list.innerHTML=comments.length?comments.map(function(c){
    return '<div class="comm-op-row"><div class="comm-op-text"><span class="comm-op-user">'+(c.user||'you')+'</span> '+c.text.replace(/</g,'&lt;')+'</div></div>';
  }).join(''):'<div style="font-size:11px;color:var(--muted);padding:4px 0">No takes yet. Be the first.</div>';
}
function toggleSageComments(i){
  var box=document.getElementById('sage-comments-'+i);
  if(!box)return;
  var open=box.style.display!=='none';
  box.style.display=open?'none':'block';
  if(!open)renderSageComments(i);
}
function postSageComment(i){
  var inp=document.getElementById('sage-cin-'+i);
  if(!inp||!inp.value.trim())return;
  var comments=getSageComments(i);
  comments.push({user:bkUsername||localStorage.getItem('tm_username')||'you',text:inp.value.trim(),ts:Date.now()});
  try{localStorage.setItem('tm_sagec_'+i,JSON.stringify(comments));}catch(e){}
  inp.value='';
  renderSageComments(i);
}

// Debate starters posted by Mac (clearly labeled as the site's AI - not fake users).
// Real 2026 trade debates with no consensus answer, designed to pull opinions.
function renderSageDebates(){
  var debates=[
    {give:'Justin Jefferson',get:'Brian Thomas Jr + 2027 1st',q:'Jefferson is coming off a career-worst year that was 100% his QB\'s fault. BTJ is 3 years younger coming off a slump of his own. Who wins this?'},
    {give:'Brock Bowers',get:'Trey McBride',q:'McBride just broke the all-time TE reception record. Bowers finally gets a real QB in Mendoza. Straight swap - which side are you on?'},
    {give:'Christian McCaffrey',get:'Jahmyr Gibbs',q:'CMC is coming off 2,126 scrimmage yards, but he turns 31 this season and just carried a 413 touch workload. Gibbs is 24 and scored 18 times. Straight swap: do you take the proven monster or the younger engine?'},
    {give:'Patrick Mahomes',get:'Caleb Williams',q:'Mahomes is coming off a torn ACL at 31. Caleb just won the NFC North at 24. Is this even a debate anymore?'}
  ];
  var html='<div style="font-size:11px;font-weight:700;color:var(--accent-bright);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Mac\'s debate starters - vote and argue below</div>';
  debates.forEach(function(d,i){
    html+='<div class="comm-card">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +'<div style="width:26px;height:26px;border-radius:8px;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--accent-bright)">S</div>'
      +'<div><div style="font-size:12px;font-weight:700;color:var(--text)">Mac <span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:100px;background:var(--accent-dim);color:var(--accent-bright);margin-left:4px">SITE AI</span></div>'
      +'<div style="font-size:10px;color:var(--muted)">Debate starter</div></div></div>'
      +'<div class="comm-give-get"><div class="comm-chips"><span class="comm-chip">'+d.give+'</span></div><div class="comm-arrow">⇄</div><div class="comm-chips"><span class="comm-chip">'+d.get+'</span></div></div>'
      +'<div style="font-size:12px;color:var(--muted2);line-height:1.6">'+d.q+'</div>'
      +'<div style="margin-top:10px;display:flex;gap:8px;align-items:center">'
      +'<button class="btn-sm" onclick="switchScreen(\'analyze\');showAnalyzeTab(\'analyzer\');">Analyze this trade</button>'
      +'<button class="comm-opinion-btn" onclick="toggleSageComments('+i+')">Join the debate (<span id="sage-cc-'+i+'">0</span>)</button></div>'
      +'<div id="sage-comments-'+i+'" style="display:none;margin-top:10px;border-top:1px solid var(--border);padding-top:10px">'
      +'<div id="sage-clist-'+i+'"></div>'
      +'<div style="display:flex;gap:8px;margin-top:8px">'
      +'<input type="text" id="sage-cin-'+i+'" class="tm-input" style="flex:1;font-size:12px;padding:8px 12px" placeholder="Drop your take..." maxlength="280" onkeydown="if(event.key===\'Enter\')postSageComment('+i+')">'
      +'<button class="btn-sm" onclick="postSageComment('+i+')">Post</button></div>'
      +'</div>'
      +'</div>';
  });
  return html;
}

function getPlayerIdByName(name){
  if(!name||!allPlayers)return null;
  var nl=name.toLowerCase().trim();
  // Direct match
  var found=Object.values(allPlayers).find(function(p){return p&&p.name&&p.name.toLowerCase()===nl;});
  if(found)return found.id;
  // Partial match (first+last)
  var parts=nl.split(' ');
  if(parts.length>=2&&!/\d/.test(nl)){   // never fuzzy-match picks or anything with digits
    var f=parts[0],l=parts[parts.length-1];
    if(f.length>=3&&l.length>=3){
      found=Object.values(allPlayers).find(function(p){
        if(!p||!p.name)return false;
        var pn=p.name.toLowerCase();
        // both tokens must start a word in the name - "jos alle" can match
        // "Josh Allen" but random substrings can't grab the wrong player
        return (' '+pn).indexOf(' '+f)>=0&&(' '+pn).indexOf(' '+l)>=0;
      });
      if(found)return found.id;
    }
  }
  return null;
}

function playerChipHtml(asset){
  var name=asset.name||asset||'';
  var isPick=/\d{4}\s+round/i.test(name)||/pick/i.test(name);
  if(isPick){
    // If the poster's projected slot was captured, show it (e.g. "2027 1.05") with
    // a clear "projected" tag; otherwise fall back to the round.
    if(asset&&asset.slot){
      var _yr=(name.match(/\d{4}/)||[''])[0];
      return '<span class="comm-pick-chip">'+escHtml((_yr?_yr+' ':'')+asset.slot)+' <span style="opacity:.65;font-weight:500;text-transform:none;letter-spacing:0">projected</span></span>';
    }
    return '<span class="comm-pick-chip">'+escHtml(name)+'</span>';
  }
  var pid=asset.sleeper_id||getPlayerIdByName(name)||null;
  var pos='',team='';
  if(pid&&allPlayers[pid]){pos=allPlayers[pid].pos||'';team=allPlayers[pid].team||'';}
  var posColors={QB:'#a78bfa',RB:'#4ade80',WR:'#fbbf24',TE:'#f87171'};
  var posColor=posColors[pos]||'var(--muted)';
  var imgHtml=pid
    ?'<img src="https://sleepercdn.com/content/nfl/players/thumb/'+pid+'.jpg" onerror="this.style.display=\'none\'" style="width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--surface2);border:2px solid '+posColor+'">'
    :'<div style="width:38px;height:38px;border-radius:50%;background:var(--surface3);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:'+posColor+'">'+escHtml(pos||'?')+'</div>';
  var click=pid?' onclick="openPlayerCard(\''+pid+'\',\''+escHtml(name).replace(/'/g,"&#39;")+'\')" style="cursor:pointer" title="Tap to open the full player card"':'';
  return '<span class="comm-player-chip comm-chip-lg"'+click+'>'+imgHtml
    +'<span style="display:inline-flex;flex-direction:column;align-items:flex-start;line-height:1.25"><span>'+escHtml(name)+'</span>'
    +(pos?'<span style="font-size:9px;font-weight:700;color:'+posColor+'">'+pos+(team&&team!=='FA'?' <span style="color:var(--muted);font-weight:600">'+teamLogo(team,11)+team+'</span>':'')+'</span>':'')
    +'</span></span>';
}

// Full rosters of both teams in a trade (opt-in), grouped by position, collapsible.
function _commRostersPanel(p){
  var r=p.rosters;if(!r)return '';
  var mine=r.mine||[],theirs=r.theirs||[];
  if(!mine.length&&!theirs.length)return '';
  var grp=function(arr){
    var by={QB:[],RB:[],WR:[],TE:[]};
    (arr||[]).forEach(function(pl){if(by[pl.pos])by[pl.pos].push(pl.name);});
    return ['QB','RB','WR','TE'].filter(function(k){return by[k].length;}).map(function(k){
      return '<div style="margin-bottom:5px;line-height:1.5"><span style="font-size:9px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">'+k+'</span> <span style="font-size:12px;color:var(--muted2)">'+by[k].map(escHtml).join(', ')+'</span></div>';
    }).join('')||'<div style="font-size:11px;color:var(--muted)">Not shared</div>';
  };
  var col=function(title,arr){return '<div style="flex:1;min-width:150px"><div style="font-size:11px;font-weight:800;color:var(--text);margin-bottom:8px">'+title+'</div>'+grp(arr)+'</div>';};
  return '<div id="rosters-'+p.id+'" style="display:none;gap:18px;flex-wrap:wrap;margin-top:10px;padding:12px;background:var(--surface3);border-radius:10px">'
    +col('Giving side roster',mine)+col('Getting side roster',theirs)+'</div>';
}
// Compact league-settings chips shown on a community trade so the read has context.
function _commLeagueLine(p){
  var ls=p.league_settings;if(!ls)return '';
  var parts=[];
  if(ls.teams)parts.push(ls.teams+'-team');
  if(ls.scoring)parts.push(ls.scoring);
  if(ls.superflex)parts.push('Superflex');
  if(!parts.length)return '';
  return '<div style="font-size:10.5px;color:var(--muted);margin-bottom:10px;display:flex;flex-wrap:wrap;gap:6px">'
    +parts.map(function(t){return '<span style="padding:2px 8px;border-radius:100px;background:var(--surface3);border:1px solid var(--border)">'+escHtml(t)+'</span>';}).join('')
    +'</div>';
}
function renderTradePost(p){
  var verdictColor=p.verdict==='winning'||p.verdict==='crushing'?'var(--green)':p.verdict==='losing'||p.verdict==='getting_fleeced'?'var(--red)':'var(--yellow)';
  var verdictBg=p.verdict==='winning'||p.verdict==='crushing'?'rgba(34,197,94,.08)':p.verdict==='losing'||p.verdict==='getting_fleeced'?'rgba(239,68,68,.08)':'rgba(245,158,11,.08)';
  var verdictLabel={'getting_fleeced':'Getting Robbed','losing':'Losing Value','even':'Even Trade','winning':'Winning','crushing':'Big Win'}[p.verdict]||p.verdict;
  function chips(arr){return (arr||[]).map(function(a){return playerChipHtml(a);}).join('');}
  var ts=p.created_at?timeAgo(p.created_at):'';
  var leagueTag=p.league_type==='redraft'
    ?'<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(245,158,11,.15);color:#f59e0b;text-transform:uppercase;letter-spacing:.06em">Redraft</span>'
    :'<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:rgba(167,139,250,.15);color:var(--accent-bright);text-transform:uppercase;letter-spacing:.06em">Dynasty</span>';
  var totalVotes=(p.upvotes||0)+(p.downvotes||0);
  var upPct=totalVotes>0?Math.round((p.upvotes||0)/totalVotes*100):0;
  // How the trade came about - tells readers what opinion the poster wants.
  var ctxMap={
    incoming:{label:'Offered to me',color:'#38bdf8'},
    outgoing:{label:'My proposed offer',color:'var(--accent-bright)'},
    processed:{label:'Already accepted',color:'var(--green)'}
  };
  var ctx=ctxMap[p.context]||ctxMap.outgoing;
  var ctxPill='<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;background:'+ctx.color+'22;color:'+ctx.color+';text-transform:uppercase;letter-spacing:.06em">'+ctx.label+'</span>';
  var author=p.mine?'Your published trade':'A league manager';
  return '<div class="comm-card" id="post-'+p.id+'" style="border-left:3px solid '+verdictColor+'">'
    // Header: anonymous author + how the trade came about (published anonymously)
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px">'
    +'<div style="display:flex;align-items:center;gap:8px;min-width:0">'
    +'<div style="width:30px;height:30px;border-radius:50%;background:var(--surface3);flex:none"></div>'
    +'<div style="min-width:0"><div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+author+'</div>'
    +'<div style="font-size:10px;color:var(--muted)">'+ts+'</div></div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end">'+ctxPill+leagueTag+'</div>'
    +'</div>'
    // Trade
    +'<div class="comm-give-get" style="background:var(--surface3);border-radius:10px;padding:10px;margin-bottom:10px">'
    +'<div><div style="font-size:9px;color:var(--muted);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Giving</div><div style="display:flex;flex-wrap:wrap;gap:2px">'+chips(p.give_side)+'</div></div>'
    +'<div class="comm-arrow" style="font-size:18px;color:var(--muted);font-weight:300">⇄</div>'
    +'<div><div style="font-size:9px;color:var(--muted);margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Getting</div><div style="display:flex;flex-wrap:wrap;gap:2px">'+chips(p.get_side)+'</div></div>'
    +'</div>'
    // Poster's own context (optional description)
    +(p.description?'<div style="font-size:12.5px;color:var(--muted2);line-height:1.55;margin-bottom:10px;padding-left:10px;border-left:2px solid '+verdictColor+'">'+escHtml(p.description)+'</div>':'')
    // League settings so the read has context (format is always shown)
    +_commLeagueLine(p)
    // Verdict badge
    +(p.headline?'<div style="font-size:13px;font-weight:800;color:'+verdictColor+';margin-bottom:10px;letter-spacing:-.01em">'+escHtml(p.headline)+'</div>':'')
    // Vote bar
    +(totalVotes>0?'<div style="height:3px;border-radius:2px;background:var(--surface3);margin-bottom:10px;overflow:hidden"><div style="height:100%;width:'+upPct+'%;background:'+verdictColor+';transition:width .3s"></div></div>':'')
    // Actions
    +'<div class="comm-vote-row">'
    +'<button class="comm-vote-btn" onclick="votePost(\''+p.id+'\',1,this)">▲ '+(p.upvotes||0)+'</button>'
    +'<button class="comm-vote-btn" onclick="votePost(\''+p.id+'\',-1,this)">▼ '+(p.downvotes||0)+'</button>'
    +'<button class="comm-opinion-btn" onclick="toggleOpinions(\''+p.id+'\')" title="Read and add comments on this trade">Drop your take</button>'
    +(p.rosters?'<button class="comm-opinion-btn" style="margin-left:auto" onclick="var e=document.getElementById(\'rosters-'+p.id+'\');e.style.display=e.style.display===\'none\'?\'flex\':\'none\'" title="See both teams\' full rosters">View rosters</button>':'')
    +'</div>'
    +_commRostersPanel(p)
    +'<div class="comm-opinions" id="ops-'+p.id+'" style="display:none"></div>'
    +'</div>';
}

// Animate an opponent-read gauge: fill the radial ring + count the number up from 0.
function animateOppRead(id,val){
  val=Math.max(0,Math.min(100,Math.round(val||0)));
  var ring=document.getElementById(id+"-ring");
  var lbl=document.getElementById(id+"-val");
  var CIRC=238.76; // 2*pi*38
  var reduce=false;try{reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;}catch(_){}
  if(ring){
    ring.style.transition='none';ring.style.strokeDashoffset=CIRC;
    // double-rAF so the reset paints before the fill transition runs each analysis
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      ring.style.transition='';ring.style.strokeDashoffset=CIRC*(1-val/100);
    });});
  }
  if(lbl){
    if(reduce){lbl.textContent=val+"%";return;}
    var start=null,dur=1000;
    (function tick(ts){
      if(ts==null){return requestAnimationFrame(tick);}
      if(!start)start=ts;
      var t=Math.min(1,(ts-start)/dur),eased=1-Math.pow(1-t,3);
      lbl.textContent=Math.round(val*eased)+"%";
      if(t<1)requestAnimationFrame(tick);
    })();
  }
}
// Reset the opponent read to a locked state (dimmed rings, "?" values) + show the
// Calculate button. Called on every analysis so the reveal is a deliberate moment.
function _resetOppRead(){
  var CIRC=238.76;
  ['sig1','sig2','sig3'].forEach(function(id){
    var v=document.getElementById(id+'-val');if(v)v.textContent='?';
    var r=document.getElementById(id+'-ring');if(r){r.style.transition='none';r.style.strokeDashoffset=CIRC;}
  });
  var g=document.getElementById('oppread-grid');if(g){g.style.opacity='.3';}
  var b=document.getElementById('oppread-calc-btn');if(b){b.style.display='';b.disabled=false;}
}
// Reveal the read: fade in, count up the rings (staggered so it reads as a sweep,
// not three things hammering at once), and play a whoosh + ding. No blur - that
// was the source of the jank.
// A "calculating" sound: a soft tone that GLIDES UP while the numbers count, then
// resolves with a warm chord - like a meter filling and locking in.
function sndCalcReveal(){
  // "Results are in" - a soft ascending three-note bell chime (C-E-G) over a warm
  // low root, instead of the old sci-fi sweep. Clean, premium, satisfying.
  if(!_sndOn)return;var ctx=_ac();if(!ctx)return;var t=ctx.currentTime;
  [523.25,659.25,783.99].forEach(function(f,i){
    var st=t+i*0.10;
    [[f,'triangle',0.05,0.9],[f*2,'sine',0.015,0.7]].forEach(function(v){
      var o=ctx.createOscillator();o.type=v[1];o.frequency.setValueAtTime(v[0],st);
      var g=ctx.createGain();
      g.gain.setValueAtTime(.0001,st);g.gain.linearRampToValueAtTime(v[2],st+.01);
      g.gain.exponentialRampToValueAtTime(.0001,st+v[3]);
      o.connect(g);g.connect(ctx.destination);o.start(st);o.stop(st+v[3]+.05);
    });
  });
  var lo=ctx.createOscillator();lo.type='sine';lo.frequency.setValueAtTime(261.63,t);
  var lg=ctx.createGain();lg.gain.setValueAtTime(.0001,t);lg.gain.linearRampToValueAtTime(.03,t+.03);lg.gain.exponentialRampToValueAtTime(.0001,t+.72);
  lo.connect(lg);lg.connect(ctx.destination);lo.start(t);lo.stop(t+.8);
}
function calculateOppRead(){
  var vals=window._oppReadVals;if(!vals)return;
  var g=document.getElementById('oppread-grid');if(g){g.style.opacity='1';}
  var b=document.getElementById('oppread-calc-btn');if(b)b.style.display='none';
  try{sndCalcReveal();}catch(_){}
  animateOppRead('sig1',vals.sig1);
  setTimeout(function(){animateOppRead('sig2',vals.sig2);},120);
  setTimeout(function(){animateOppRead('sig3',vals.sig3);},240);
  try{setTimeout(function(){sndWin();},1150);}catch(_){}  // resolve chime when it locks in
}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function timeAgo(ts){
  var d=new Date(ts), now=new Date(), diff=Math.floor((now-d)/1000);
  if(diff<60)return 'just now';
  if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return Math.floor(diff/86400)+'d ago';
}

async function votePost(postId, vote, btn){
  if(!bkUsername){alert('Sign in with your Sleeper username to vote.');return;}
  var vkey='tm_voted_'+postId;
  // Same vote twice is a no-op; the other direction SWITCHES your vote
  try{if(localStorage.getItem(vkey)===String(vote))return;}catch(_){}
  try{
    var res=await fetch('/api/community/vote/'+postId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,vote:vote})});
    if(!res.ok)return;
    var d=await res.json();
    try{localStorage.setItem(vkey,String(vote));}catch(_){}
    var row=btn.parentNode;
    if(row){
      var btns=row.querySelectorAll('.comm-vote-btn');
      if(btns.length>=2){
        btns[0].classList.toggle('voted-up',vote===1);btns[0].style.opacity=vote===1?'1':'.55';
        btns[1].classList.toggle('voted-down',vote===-1);btns[1].style.opacity=vote===-1?'1':'.55';
        if(d.upvotes!=null)btns[0].textContent='▲ '+d.upvotes;
        if(d.downvotes!=null)btns[1].textContent='▼ '+d.downvotes;
      }
    }
  }catch(e){}
}

async function toggleOpinions(postId){
  var el=document.getElementById('ops-'+postId);
  if(!el)return;
  if(el.style.display==='block'){el.style.display='none';return;}
  el.style.display='block';
  el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:8px 0">Loading takes...</div>';
  try{
    var res=await fetch('/api/community/opinions/'+postId);
    var ops=res.ok?await res.json():[];
    var inputBlock=bkUsername
      ?'<div class="comm-opinion-input"><textarea id="op-input-'+postId+'" placeholder="Drop your hot take on this trade..." maxlength="280" oninput="var c=document.getElementById(\'op-char-'+postId+'\');if(c)c.textContent=(280-this.value.length)+\' left\'"></textarea>'
       +'<div class="post-row"><span class="char-count" id="op-char-'+postId+'">280 left</span>'
       +'<button onclick="postOpinion(\''+postId+'\')" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:-.01em">Post Take</button>'
       +'</div></div>'
      :'<div style="font-size:12px;color:var(--muted);padding:8px 0;text-align:center">Sign in with your Sleeper username to drop a take.</div>';
    if(!ops.length){
      el.innerHTML='<div style="color:var(--muted);font-size:12px;padding:6px 0">No takes yet - be first.</div>'+inputBlock;
    }else{
      var html=ops.map(function(o){
        var liked=(localStorage.getItem('op_liked_'+o.id)==='1');
        return '<div class="comm-op-row">'
          +'<span class="comm-op-user">@'+escHtml(o.username)+'</span>'
          +'<span class="comm-op-text">'+escHtml(o.text)+'</span>'
          +'<button class="comm-op-like'+(liked?' liked':'')+'" id="oplike-'+o.id+'" onclick="likeOpinion(\''+o.id+'\',\''+escHtml(o.username)+'\')">'
          +(liked?'Liked':'Like')+' '+(o.like_count||0)+'</button>'
          +'</div>';
      }).join('');
      el.innerHTML=html+inputBlock;
    }
  }catch(e){
    el.innerHTML='<div style="color:var(--muted);font-size:12px">Couldn\'t load takes.</div>';
  }
}

async function postOpinion(postId){
  if(!bkUsername){alert('Sign in to post.');return;}
  var input=document.getElementById('op-input-'+postId);
  var text=input?(input.value||input.textContent||'').trim():'';
  if(!text)return;
  try{
    var res=await fetch('/api/community/opinions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,post_id:postId,text:text})});
    if(!res.ok){var e=await res.json();alert(e.error||'Failed to post.');return;}
    input.value='';
    // Reload opinions
    var el=document.getElementById('ops-'+postId);
    if(el){el.style.display='none';toggleOpinions(postId);}
  }catch(e){alert('Failed to post. Try again.');}
}

async function likeOpinion(opId, authorUsername){
  if(!bkUsername){alert('Sign in to like.');return;}
  if(bkUsername===authorUsername){alert("Can't like your own take.");return;}
  var btn=document.getElementById('oplike-'+opId);
  if(btn&&btn.classList.contains('liked')){alert('Already liked.');return;}
  try{
    var res=await fetch('/api/community/opinion-like/'+opId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername})});
    if(res.status===409){alert('Already liked.');return;}
    if(!res.ok)return;
    var data=await res.json();
    if(btn){
      btn.classList.add('liked');
      btn.textContent='Liked · '+data.new_like_count;
      localStorage.setItem('op_liked_'+opId,'1');
    }
  }catch(e){}
}

// ── Share trade to community ─────────────────────────────────────────────────
async function shareTradeToForum(){
  if(!bkUsername){alert('Sign in with your Sleeper username first.');return;}
  // Collect current trade inputs
  var giveEls=Array.from(document.querySelectorAll('#give-players input.tm-input'));
  var getEls=Array.from(document.querySelectorAll('#get-players input.tm-input'));
  var giveSide=giveEls.map(function(i){return {name:i.value.trim()};}).filter(function(x){return x.name;});
  var getSide=getEls.map(function(i){return {name:i.value.trim()};}).filter(function(x){return x.name;});
  // Capture the projected slot for any picks so the community card can show
  // "2027 1.05 · projected" (give-side = your picks, get-side = their picks).
  function _commPickSlot(o,pool){
    if(!o.name||!/round|pick/i.test(o.name))return o;
    var rm=o.name.match(/round\s*(\d)/i);var rnd=rm?+rm[1]:null;if(!rnd)return o;
    var pk=(pool||[]).find(function(p){return p.name===o.name;});
    var oid=(pk&&pk.ownerRosterId!=null)?pk.ownerRosterId:_myRosterId();
    var sl=null;try{sl=estimatePickSlot(oid);}catch(_){}
    if(sl){o.slot=rnd+'.'+String(sl.slot).padStart(2,'0');o.projected=true;}
    return o;
  }
  try{giveSide=giveSide.map(function(o){return _commPickSlot(o,typeof myPicks!=='undefined'?myPicks:[]);});
      getSide=getSide.map(function(o){return _commPickSlot(o,typeof oppPicks!=='undefined'?oppPicks:[]);});}catch(_){}
  if(!giveSide.length||!getSide.length){alert('Add players to both sides before sharing.');return;}
  // Pull current verdict info from DOM
  var headlineEl=document.getElementById('verdict-headline');
  var headline=headlineEl?headlineEl.textContent.trim():'';
  var verdictEl=document.getElementById('balance-label');
  var verdict='even';
  if(verdictEl){
    var vt=verdictEl.textContent.toLowerCase();
    if(vt.includes('robbed'))verdict='getting_fleeced';
    else if(vt.includes('losing'))verdict='losing';
    else if(vt.includes('crushing'))verdict='crushing';
    else if(vt.includes('winning'))verdict='winning';
    else verdict='even';
  }
  try{
    var _descEl=document.getElementById('share-desc-input');
    var _desc=_descEl?_descEl.value.trim().slice(0,280):'';
    // Involved rosters (opt-in, on by default). Snapshotted so readers can judge in
    // context; the poster can uncheck it to stay fully anonymous in a small league.
    var _rostersOptEl=document.getElementById('share-rosters-optin');
    var _rosters=null;
    if(!_rostersOptEl||_rostersOptEl.checked){
      var _snap=function(arr){return (arr||[]).map(function(pl){return {name:pl.name,pos:pl.pos};}).filter(function(x){return x.name;}).slice(0,30);};
      var _mine=_snap(myRoster), _theirs=_snap(oppRoster);
      if(_mine.length||_theirs.length)_rosters={mine:_mine,theirs:_theirs};
    }
    var res=await fetch('/api/community/post',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:bkUsername,give_side:giveSide,get_side:getSide,verdict:verdict,headline:headline,league_type:leagueMode||'dynasty',team_name:leagueName||'',context:_shareContext,description:_desc,league_settings:_communityLeagueSettings(),rosters:_rosters})});
    var data=await res.json();
    if(!res.ok){alert('The community feed is temporarily down for maintenance. Your analysis is unaffected - try sharing again later.');return;}
    if(data.new_balance!=null){bkBalance=data.new_balance;updateBKDisplay();}
    var btn=document.getElementById('share-community-btn');
    if(btn)btn.textContent='Posted to Community';
    if(_descEl)_descEl.value='';
    // Show it immediately: reset the feed so the new post is on top next time
    // Community opens, and refresh now if the user is already viewing it.
    try{window.communityOffset=0;if(activeCommunityTab==='trades'||typeof activeCommunityTab==='undefined')loadCommunityFeed(true);}catch(_){}
  }catch(e){alert('Failed to post. Try again.');}
}

// paint the mode togglers on boot so the purple active state shows everywhere
setTimeout(function(){try{styleModeButtons(leagueMode);}catch(_){}} ,400);
