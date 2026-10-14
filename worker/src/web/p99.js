(()=>{
let d=document,L=location,K="p99:code",A=addEventListener,h=__P99_HOST__,c,E,S,B,Q,N,M,P,R=[],
O=()=>d.querySelector('meta[name="p99"][content="off"]'),
H=p=>{try{return RegExp("^"+p.replace(/[.?+]/g,"\\$&").replace(/\*\*?/g,m=>m[1]?".*":"[^/]*")+"/?$").test(L.pathname)}catch{}},
J=()=>/^#p99=([\w-]+)$/.exec(L.hash)?.[1],V=x=>/^\w{12}$/.test(x),
T=x=>{try{x?localStorage.setItem(K,x):x=localStorage.getItem(K)}catch{}return x};
if(O()||h.off.some(H))return;
let x=J(),Z=()=>{let x=J();x&&(V(x)?L.reload():G("item",x))},
G=(v,k)=>c&&E&&D().then(m=>m.open({root:S,host:E,bar:B,code:c,me:M,view:v,key:k,ring:R,place:h,forget:F,refresh:Y}),()=>{});
c=T(V(x)&&(history.replaceState(history.state,"",L.pathname+L.search),x));
A("hashchange",Z);
self.P99={open:k=>G(k?"item":"new",k)};
if(!c)return;
let n=e=>{R.push(`${e.message||e.reason?.message||e.reason||""}`.replace(/[?#]\S*/g,"").slice(0,300))>20&&R.shift()},
F=()=>{try{localStorage.removeItem(K)}catch{}E?.remove();E=c=null},
D=()=>P||(P=import("/_p99/panel.js?v=__P99_VERSION__").catch(e=>{P=null;throw e})),
I=j=>{M=j;let n=j.counts,x=n.mine_unread,y=x||n.page_open;N.hidden=!y;N.textContent=y>99?"99+":y;N.className=x?"n u":"n";Q.hidden=!(j.manager||n.mine_open||y)},
Y=f=>{let k=c+L.pathname+(Date.now()/6e4|0),j;try{j=JSON.parse(sessionStorage[K]);j=f&&j[0]==k&&j[1]}catch{}j?I(j):fetch("/_p99/api/me?path="+encodeURIComponent(L.pathname),{headers:{"X-P99-Code":c}}).then(r=>r.status==401?F():r.ok&&r.json()).then(j=>{if(j){I(j);sessionStorage[K]=JSON.stringify([k,j])}}).catch(()=>{})},
U=()=>{let a=d.querySelector(h.above),y=0,t=h.corner[0]=="t",r=a?.getBoundingClientRect();if(r?.bottom>0&&r.top<innerHeight)y=t?r.bottom:innerHeight-r.top;B.style.translate=`0 ${t?y:-y}px`},
C=(t,k,x)=>{let e=d.createElement(t);k&&(e.className=k);x&&(e.textContent=x);return e},
X=(k,x,l,g)=>{let b=C("button",k,x);b.title=b.ariaLabel=l;b.onclick=g;b.onpointerenter=b.onfocus=D;return b},
W=()=>{
if(O()||!c||E)return;
let o=h.offset,p=h.corner.split("-"),l=p[1]<"r",a=/^[#\w(),.% -]{1,40}$/.test(h.accent)?h.accent:"#3b7dd8",s=new CSSStyleSheet;
E=C("p99-root");E.dataset.p99Ignore="";S=E.attachShadow({mode:"closed"});
s.replaceSync(`:host{all:initial;color-scheme:light dark;--p99-accent:${a}}.w{position:fixed;${p[0]}:${o.y}px;${p[1]}:${o.x}px;z-index:2147483000;display:flex;gap:8px;flex-direction:row${l?"":"-reverse"}}.b{position:relative;width:44px;height:44px;border:1px solid light-dark(#4f6b8c,#0f1825);border-radius:50%;background:var(--p99-raised,light-dark(#eef3f8,#2a3b50));color:var(--p99-ink,light-dark(#0c1a2b,#e9f0f7));font:700 20px system-ui;cursor:pointer;box-shadow:0 4px 14px #0005}.f{color:var(--p99-accent)}.n{position:absolute;top:-5px;right:-5px;min-width:10px;padding:0 5px;border-radius:10px;background:#0c1a2b;color:#fff;font:700 11px/20px system-ui}.u{background:var(--p99-accent)}`);
B=C("div","w");Q=X("b","⋯","Your items",()=>G("list"));N=C("span","n");Q.hidden=N.hidden=!0;Q.append(N);
B.append(X("b f","?","Report a bug or an idea",()=>G("new")),Q);S.adoptedStyleSheets=[s];S.append(B);d.body.append(E);
if(h.above)try{d.querySelector(h.above);["scroll","resize"].map(t=>A(t,U,{passive:!0}));U()}catch{}
(self.requestIdleCallback||setTimeout)(()=>Y(1));
Z()};
A("error",n);A("unhandledrejection",n);
d.body?W():A("DOMContentLoaded",W)})();
