(()=>{
let w=window,d=document,L=location,K="p99:code",A=addEventListener,h,c=null,E,S,B,Q,N,M,P,R=[],
O=()=>d.querySelector('meta[name="p99"][content="off"]'),
H=p=>{try{return RegExp("^"+String(p).replace(/[.?+]/g,"\\$&").replace(/\*\*?/g,m=>m[1]?".*":"[^/]*")+"/?$").test(L.pathname)}catch(e){}};
try{h=__P99_HOST__}catch(e){}
h=h||{};
if(O()||(h.off||[]).some(H))return;
let q=new URLSearchParams(L.search),u=q.get("p99");
if(u!=null){q.delete("p99");q+="";history.replaceState(history.state,"",L.pathname+(q?"?"+q:"")+L.hash);c=u||null}
try{c?localStorage.setItem(K,c):c=localStorage.getItem(K)}catch(e){}
let G=(v,k)=>{c&&E&&D().then(m=>m.open({root:S,host:E,bar:B,code:c,me:M,view:v,key:k,ring:R,place:h,forget:F,refresh:Y}),()=>{})};
w.P99={open:k=>G(k?"item":"new",k)};
if(!c)return;
let n=m=>{R.push((m??"")+"".replace(/[?#]\S*/g,"").slice(0,300));R.length>20&&R.shift()},
F=()=>{c=null;try{localStorage.removeItem(K)}catch(e){}E?.remove();E=null},
D=()=>P||(P=import("/_p99/panel.js?v=__P99_VERSION__").catch(e=>{P=null;throw e})),
Y=()=>{c&&fetch("/_p99/api/me?path="+encodeURIComponent(L.pathname),{headers:{"X-P99-Code":c}}).then(r=>r.status==401?F():r.ok&&r.json()).then(j=>{if(!j||!E)return;M=j;let n=j.counts||{},x=n.mine_unread,y=x||n.page_open;N.hidden=!y;N.textContent=y>99?"99+":y;N.className=x?"n u":"n";Q.hidden=!(j.manager||n.mine_open||y)}).catch(()=>{})},
U=()=>{let a=E&&d.querySelector(h.above),y=0,t=/^top/.test(h.corner),r=a&&a.getBoundingClientRect();if(r&&r.bottom>0&&r.top<innerHeight)y=t?r.bottom:innerHeight-r.top;E&&(B.style.transform=`translateY(${t?y:-y}px)`)},
Z=()=>{let m=/^#p99=([\w-]+)$/.exec(L.hash);m&&G("item",m[1])},
C=(t,k,x)=>{let e=d.createElement(t);k&&(e.className=k);x&&(e.textContent=x);return e},
X=(k,x,l,g)=>{let b=C("button",k,x);b.title=l;b.setAttribute("aria-label",l);b.onclick=g;b.onpointerenter=b.onfocus=D;return b},
W=()=>{
if(O()||!c||E)return;
let o=h.offset||{},p=String(h.corner||"bottom-right").split("-"),l=p[1]=="left",a=/^[#\w(),.% -]{1,40}$/.test(h.accent)?h.accent:"#3b7dd8",s=new CSSStyleSheet;
E=C("p99-root");E.toggleAttribute("data-p99-ignore");S=E.attachShadow({mode:"closed"});
s.replaceSync(`:host{all:initial;color-scheme:light dark;--p99-accent:${a}}.w{position:fixed;${p[0]=="top"?"top":"bottom"}:${o.y??16}px;${l?"left":"right"}:${o.x??16}px;z-index:2147483000;display:flex;gap:8px;flex-direction:row${l?"":"-reverse"}}.b{position:relative;width:44px;height:44px;border:1px solid light-dark(#4f6b8c,#0f1825);border-radius:50%;background:var(--p99-raised,light-dark(#eef3f8,#2a3b50));color:var(--p99-ink,light-dark(#0c1a2b,#e9f0f7));font:700 20px system-ui;cursor:pointer;box-shadow:0 4px 14px #0005}.f{color:var(--p99-accent)}.n{position:absolute;top:-5px;right:-5px;min-width:10px;padding:0 5px;border-radius:10px;background:#0c1a2b;color:#fff;font:700 11px/20px system-ui}.u{background:var(--p99-accent)}`);
B=C("div","w");Q=X("b","⋯","Your items",()=>G("list"));Q.hidden=!0;N=C("span","n");N.hidden=!0;Q.append(N);
B.append(X("b f","?","Report a bug or an idea",()=>G("new")),Q);S.adoptedStyleSheets=[s];S.append(B);d.body.append(E);
if(h.above){A("scroll",U,{passive:!0});A("resize",U,{passive:!0});U()}
(w.requestIdleCallback||setTimeout)(Y);
A("hashchange",Z);Z()};
A("error",e=>n(e.message));
A("unhandledrejection",e=>n(e.reason?.message||e.reason));
d.body?W():d.addEventListener("DOMContentLoaded",W)})();
