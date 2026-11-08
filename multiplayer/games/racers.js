/* Micro Racers client — oval circuit, three laps. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.racers = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h;
  const meta = new Map(init.players.map((p) => [p.id, p]));
  let st=null, over=null, raf=0, running=true, lastSent=0;
  const keys=Object.create(null);
  let tTurn=0, tAcc=0;

  function resize(){ canvas.width=Math.round(innerWidth*DPR); canvas.height=Math.round(innerHeight*DPR);
    canvas.style.width=innerWidth+"px"; canvas.style.height=innerHeight+"px"; }
  resize(); addEventListener("resize",resize);
  const kd=(e)=>{ keys[e.key.toLowerCase()]=true;
    if(["arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase())) e.preventDefault(); };
  const ku=(e)=>{ keys[e.key.toLowerCase()]=false; };
  addEventListener("keydown",kd); addEventListener("keyup",ku);
  canvas.addEventListener("touchstart",(e)=>{ const p=e.touches[0]; if(!p) return;
    tAcc=1; tTurn = p.clientX < innerWidth/2 ? -1 : 1; e.preventDefault(); },{passive:false});
  canvas.addEventListener("touchend",()=>{ tAcc=0; tTurn=0; });

  function view(){ const s=Math.min((innerWidth-20)/W,(innerHeight-90)/H);
    return { s, x0:(innerWidth-W*s)/2, y0:(innerHeight-H*s)/2+16 }; }

  function draw(){
    const now=performance.now();
    if(now-lastSent>50){ lastSent=now;
      let turn=0; if(keys.a||keys.arrowleft) turn-=1; if(keys.d||keys.arrowright) turn+=1;
      let acc=0; if(keys.w||keys.arrowup) acc=1; if(keys.s||keys.arrowdown) acc=-1;
      net.input({ turn: turn||tTurn, acc: acc||tAcc });
    }
    const v=view(), X=(x)=>v.x0+x*v.s, Y=(y)=>v.y0+y*v.s;
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ctx.fillStyle="#0a1410"; ctx.fillRect(0,0,innerWidth,innerHeight);
    ctx.fillStyle="#13251b"; ctx.fillRect(v.x0,v.y0,W*v.s,H*v.s);
    // road: a thick ellipse stroke
    ctx.save();
    ctx.translate(X(init.cx),Y(init.cy));
    ctx.scale(1, init.ry/init.rx);
    ctx.beginPath(); ctx.arc(0,0,init.rx*v.s,0,7);
    ctx.strokeStyle="#3b4152"; ctx.lineWidth=init.road*v.s; ctx.stroke();
    ctx.strokeStyle="rgba(255,255,255,.25)"; ctx.lineWidth=2; ctx.setLineDash([12,14]);
    ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    // start line
    ctx.strokeStyle="#fff"; ctx.lineWidth=3;
    ctx.beginPath();
    ctx.moveTo(X(init.cx+init.rx), Y(init.cy)-init.road*v.s/2);
    ctx.lineTo(X(init.cx+init.rx), Y(init.cy)+init.road*v.s/2);
    ctx.stroke();

    if(st){
      st.p.forEach(([id,x,y,a,spd,lap,done])=>{
        const m=meta.get(id)||{hue:200};
        ctx.save(); ctx.translate(X(x),Y(y)); ctx.rotate(a);
        ctx.fillStyle=done?"#8b94b0":`hsl(${m.hue} 80% 58%)`;
        ctx.fillRect(-11*v.s,-7*v.s,22*v.s,14*v.s);
        ctx.fillStyle="rgba(255,255,255,.65)";
        ctx.fillRect(2*v.s,-5*v.s,6*v.s,10*v.s);
        if(id===net.id){ ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.strokeRect(-11*v.s,-7*v.s,22*v.s,14*v.s); }
        ctx.restore();
      });
      ctx.font="700 13px 'Courier New',monospace"; ctx.textAlign="left";
      let yy=22;
      st.p.slice().sort((a,b)=>b[5]-a[5]).forEach(([id,,,,,lap,done])=>{
        const m=meta.get(id)||{name:"?",hue:200};
        ctx.fillStyle=`hsl(${m.hue} 70% 60%)`;
        ctx.fillText(`${m.name}${id===net.id?" (you)":""}  lap ${Math.min(lap+1,init.laps)}/${init.laps}${done?" ✓":""}`,16,yy);
        yy+=18;
      });
    }
    ctx.textAlign="center"; ctx.font="600 12px system-ui,sans-serif"; ctx.fillStyle="#7a8a74";
    ctx.fillText("W accelerate · S brake · A/D steer · grass is slow",innerWidth/2,innerHeight-46);
    if(over){
      ctx.fillStyle="rgba(5,12,8,.85)"; ctx.fillRect(0,0,innerWidth,innerHeight);
      ctx.fillStyle="#7df29b"; ctx.font="800 28px system-ui,sans-serif";
      const w=over.standings&&over.standings[0];
      ctx.fillText(w?`${w.name} takes it`:"Race over",innerWidth/2,innerHeight/2-20);
      ctx.font="600 14px system-ui,sans-serif"; ctx.fillStyle="#cfd8ea";
      (over.standings||[]).forEach((s,i)=>ctx.fillText(`${s.place}. ${s.name}`,innerWidth/2,innerHeight/2+12+i*20));
    }
  }
  function frame(){ if(!running) return; draw(); raf=requestAnimationFrame(frame); }
  raf=requestAnimationFrame(frame);
  return { onState(s){st=s;}, onOver(m){over=m.result;},
    teardown(){ running=false; cancelAnimationFrame(raf);
      removeEventListener("keydown",kd); removeEventListener("keyup",ku);
      removeEventListener("resize",resize); } };
};
