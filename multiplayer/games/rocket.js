/* Rocket Duel client — wrapping arena, star in the middle. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.rocket = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h;
  const meta = new Map(init.players.map((p) => [p.id, p]));
  let st = null, over = null, raf = 0, running = true, t = 0, lastSent = 0;
  const keys = Object.create(null);

  function resize(){ canvas.width=Math.round(innerWidth*DPR); canvas.height=Math.round(innerHeight*DPR);
    canvas.style.width=innerWidth+"px"; canvas.style.height=innerHeight+"px"; }
  resize(); addEventListener("resize", resize);
  const kd=(e)=>{ keys[e.key.toLowerCase()]=true;
    if([" ","arrowup","arrowleft","arrowright","arrowdown"].includes(e.key.toLowerCase())) e.preventDefault(); };
  const ku=(e)=>{ keys[e.key.toLowerCase()]=false; };
  addEventListener("keydown",kd); addEventListener("keyup",ku);
  let touchFire=false, touchTurn=0, touchThrust=false;
  canvas.addEventListener("touchstart",(e)=>{ const p=e.touches[0]; if(!p) return;
    if(p.clientX<innerWidth/3) touchTurn=-1;
    else if(p.clientX>innerWidth*2/3) touchTurn=1;
    else if(p.clientY<innerHeight/2) touchThrust=true; else touchFire=true;
    e.preventDefault(); },{passive:false});
  canvas.addEventListener("touchend",()=>{ touchTurn=0; touchThrust=false; touchFire=false; });

  function view(){ const s=Math.min((innerWidth-20)/W,(innerHeight-90)/H);
    return { s, x0:(innerWidth-W*s)/2, y0:(innerHeight-H*s)/2+16 }; }

  function draw(){
    t+=0.03;
    const now=performance.now();
    if(now-lastSent>50){ lastSent=now;
      let turn=0; if(keys.a||keys.arrowleft) turn-=1; if(keys.d||keys.arrowright) turn+=1;
      net.input({ turn: turn||touchTurn,
                  thrust: !!(keys.w||keys.arrowup||touchThrust),
                  fire: !!(keys[" "]||touchFire) });
      touchFire=false;
    }
    const v=view();
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.fillStyle="#05070e"; ctx.fillRect(0,0,innerWidth,innerHeight);
    ctx.fillStyle="#080c17"; ctx.fillRect(v.x0,v.y0,W*v.s,H*v.s);
    ctx.strokeStyle="rgba(92,225,255,.25)"; ctx.lineWidth=2;
    ctx.strokeRect(v.x0,v.y0,W*v.s,H*v.s);
    const X=(x)=>v.x0+x*v.s, Y=(y)=>v.y0+y*v.s;
    // star
    const sg=ctx.createRadialGradient(X(W/2),Y(H/2),init.starR*v.s*0.2,X(W/2),Y(H/2),init.starR*v.s*2.2);
    sg.addColorStop(0,"#fff1b0"); sg.addColorStop(0.4,"rgba(255,180,60,.75)"); sg.addColorStop(1,"rgba(255,120,30,0)");
    ctx.fillStyle=sg; ctx.beginPath(); ctx.arc(X(W/2),Y(H/2),init.starR*v.s*2.2,0,7); ctx.fill();
    if(st){
      ctx.fillStyle="#ffe9a8";
      st.s.forEach(([x,y])=>{ ctx.beginPath(); ctx.arc(X(x),Y(y),3*v.s,0,7); ctx.fill(); });
      st.p.forEach(([id,x,y,a,alive,kills,thr])=>{
        const m=meta.get(id)||{hue:200};
        if(!alive){ ctx.globalAlpha=0.25; }
        ctx.save(); ctx.translate(X(x),Y(y)); ctx.rotate(a);
        if(thr && alive){ ctx.fillStyle="#ff9f45"; ctx.beginPath();
          ctx.moveTo(-init.shipR*v.s,0); ctx.lineTo(-(init.shipR+9)*v.s,-4*v.s);
          ctx.lineTo(-(init.shipR+9)*v.s,4*v.s); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle=`hsl(${m.hue} 80% 60%)`;
        ctx.beginPath();
        ctx.moveTo(init.shipR*v.s,0);
        ctx.lineTo(-init.shipR*0.7*v.s,-init.shipR*0.75*v.s);
        ctx.lineTo(-init.shipR*0.4*v.s,0);
        ctx.lineTo(-init.shipR*0.7*v.s,init.shipR*0.75*v.s);
        ctx.closePath(); ctx.fill();
        if(id===net.id){ ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.stroke(); }
        ctx.restore(); ctx.globalAlpha=1;
      });
      ctx.font="700 13px 'Courier New',monospace"; ctx.textAlign="left";
      let yy=22;
      st.p.slice().sort((a,b)=>b[5]-a[5]).forEach(([id,,,,alive,kills])=>{
        const m=meta.get(id)||{hue:200,name:"?"};
        ctx.fillStyle=`hsl(${m.hue} 70% ${alive?60:35}%)`;
        ctx.fillText(`${m.name}${id===net.id?" (you)":""}  ${kills}/${init.winKills}`,16,yy); yy+=18;
      });
    }
    ctx.textAlign="center"; ctx.font="600 12px system-ui,sans-serif"; ctx.fillStyle="#55607a";
    ctx.fillText("A/D turn · W thrust · SPACE fire",innerWidth/2,innerHeight-46);
    if(over){
      ctx.fillStyle="rgba(5,7,14,.85)"; ctx.fillRect(0,0,innerWidth,innerHeight);
      ctx.fillStyle="#5ce1ff"; ctx.font="800 28px system-ui,sans-serif";
      const w=over.standings&&over.standings[0];
      ctx.fillText(w?`${w.name} wins`:"Round over",innerWidth/2,innerHeight/2-20);
      ctx.font="600 14px system-ui,sans-serif"; ctx.fillStyle="#cfd8ea";
      (over.standings||[]).forEach((s,i)=>ctx.fillText(`${s.place}. ${s.name} — ${s.kills}/${s.deaths}`,
        innerWidth/2,innerHeight/2+12+i*20));
    }
  }
  function frame(){ if(!running) return; draw(); raf=requestAnimationFrame(frame); }
  raf=requestAnimationFrame(frame);
  return { onState(s){st=s;}, onOver(m){over=m.result;},
    teardown(){ running=false; cancelAnimationFrame(raf);
      removeEventListener("keydown",kd); removeEventListener("keyup",ku);
      removeEventListener("resize",resize); } };
};
