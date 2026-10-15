(()=>{
let d=document,L=location,K="p99:code",A=addEventListener,h=__P99_HOST__,c,E,S,B,Q,N,M,P,z,p,f,u,R=[],
O=()=>d.querySelector("meta[name=p99][content=off]")||h.f?.some(H),
H=p=>RegExp("^"+p.replace(/[\\^$.?+(){}|[\]]/g,"\\$&").replace(/\*\*?/g,m=>m[1]?".*":"[^/]*")+"/?$").test(L.pathname),
J=()=>/^#p99=([\w-]+)$/.exec(L.hash)?.[1],V=x=>/^\w{12}$/.test(x),
T=x=>{try{x?localStorage[K]=x:x=localStorage[K]}catch{}return x};
let x=J(),Z=()=>{let x=J();x&&(V(x)?L.reload():G("item",x))},
G=(v,k)=>c&&E&&D().then(m=>m.open({root:S,code:c,me:M,view:v,key:k,ring:R,forget:F,refresh:Y}),n);
c=T(V(x)&&(history.replaceState(history.state,"",L.pathname+L.search),x));
A("hashchange",Z);
self.P99={open:k=>G(k?"item":"new",k)};
if(!c)return;
let n=e=>f||R.push(e.message||e.reason?.message||""+e.reason)>20&&R.shift(),
F=()=>{try{delete localStorage[K]}catch{}E?.remove();E=c=null},
D=()=>P||(P=import("/_p99/panel.js?v=__P99_VERSION__").catch(e=>{throw P=0,e})),
I=j=>{M=j;let n=j.counts,x=n.mine_unread,y=x||n.page_open;N.hidden=!y;N.textContent=y>99?"99+":y;N.className=x?"n u":"n";Q.hidden=!(j.manager||n.mine_open||y)},
Y=f=>{let k=c+L.pathname+(Date.now()/6e4|0),j;try{j=JSON.parse(sessionStorage[K]);j=f&&j[0]==k&&j[1]}catch{}j?I(j):fetch("/_p99/api/me?path="+encodeURIComponent(L.pathname),{headers:{"X-P99-Code":c}}).then(r=>r.status==401?F():r.ok&&r.json()).then(j=>j&&(I(j),sessionStorage[K]=JSON.stringify([k,j]))).catch(n)},
U=()=>u||(u=requestAnimationFrame(r=>{u=0;r=z?.checkVisibility?.({checkOpacity:1,checkVisibilityCSS:1})&&z.getBoundingClientRect();B.style.translate=`0 ${r?.height&&r.bottom>0&&r.top<innerHeight?h.c>"c"?r.bottom:r.top-innerHeight:0}px`})),
C=(t,k="",x,o)=>Object.assign(d.createElement(t),{className:k,textContent:x},o),
X=(k,x,l,g)=>C("button",k,x,{title:l,ariaLabel:l,onclick:g,onpointerenter:D,onfocus:D}),
W=()=>{
let o=h.o,p=(h.c||"bottom-right").split("-"),s=new CSSStyleSheet;
S=(E=C("p99-root")).attachShadow({mode:"closed"});
s.replaceSync(`:host{all:initial;color-scheme:light dark;--p99-accent:${h.t||"#3b7dd8"}}.w{position:fixed;${p[0]}:${o?.y??16}px;${p[1]}:${o?.x??16}px;z-index:2147483000;display:flex;gap:8px;flex-direction:row${p[1]<"r"?"":"-reverse"}}.b{position:relative;width:44px;height:44px;border:1px solid light-dark(#4f6b8c,#0f1825);border-radius:50%;background:var(--p99-raised,light-dark(#eef3f8,#2a3b50));color:var(--p99-ink,light-dark(#0c1a2b,#e9f0f7));font:700 20px system-ui;cursor:pointer;box-shadow:0 4px 14px #0005}.f{color:var(--p99-accent)}.n{position:absolute;top:-5px;right:-5px;min-width:10px;padding:0 5px;border-radius:10px;background:#0c1a2b;color:#fff;font:700 11px/20px system-ui}.u{background:var(--p99-accent)}`);
B=C("div","w");Q=X("b","⋯","Your items",()=>G("list"));N=C("span","n");Q.hidden=N.hidden=1;Q.append(N);
B.append(X("b f","?","Report a bug or an idea",()=>G("new")),Q);S.adoptedStyleSheets=[s];S.append(B);
h.a&&["scroll","resize","transitionend","animationend"].map(t=>A(t,U))},
w=()=>{if(c&&d.body&&p!=L.pathname){p=L.pathname;(f=O())?E?.remove():(E||W(),Y(1),Z())}
if(E&&!f){E.isConnected||d.body?.append(E);if(h.a&&!z?.isConnected)try{let b=d.querySelector(h.a);b!=z&&(z=b,U())}catch{h.a=0}}};
["error","unhandledrejection"].map(t=>A(t,n));
new MutationObserver(w).observe(d,{childList:1,subtree:1});w()})();
