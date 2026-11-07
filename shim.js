/* WaterLab: Supabase backend, login and file download (replaces the Claude runtime) */
(function(){
  const CFG=window.WATERLAB_CONFIG||{};
  const sb=window.supabase.createClient(CFG.url,CFG.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});
  window.__sb=sb;
  let session=null, readyResolve; const ready=new Promise(r=>readyResolve=r);
  const store={}, subs={}, errs={}; let loaded=false, channel=null; const names={};

  /* ---------- login screen ---------- */
  const css=`.lg-wrap{position:fixed;inset:0;z-index:50;background:var(--hdr,#11233f);display:flex;align-items:center;justify-content:center;padding:20px}
  .lg{width:100%;max-width:340px;color:#fff;font-family:var(--f-body,Arial,sans-serif)}
  .lg .logo{height:46px;width:auto;color:#fff;margin-bottom:6px}.lg .logo .hole{fill:var(--hdr,#11233f)}
  .lg h1{font-size:13px;font-weight:400;color:#a9bad8;margin:0 0 22px;letter-spacing:.02em}
  .lg label{display:block;font-size:12px;color:#a9bad8;margin:10px 0 4px}
  .lg input{width:100%;padding:10px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-size:16px}
  .lg input:focus{outline:2px solid #c7e4f7;outline-offset:1px}
  .lg button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:6px;background:#c7e4f7;color:#11233f;font:inherit;font-weight:700;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
  .lg button:disabled{opacity:.6}
  .lg .lnk{background:none;color:#a9bad8;text-transform:none;font-weight:400;margin-top:10px;padding:6px;letter-spacing:0;text-decoration:underline}
  .lg .msg{min-height:18px;margin-top:10px;font-size:13px;color:#ffb4a6}.lg .msg.ok{color:#a8f0c6}`;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  function logoSvg(){const l=document.querySelector('header .logo');return l?l.outerHTML:''}
  function show(mode){
    let w=document.getElementById('lgw'); if(!w){w=document.createElement('div');w.id='lgw';w.className='lg-wrap';document.body.appendChild(w)}
    const forms={
      login:`<form class="lg" id="lgf" novalidate>${logoSvg()}<h1>Лабораторія води · фінанси</h1>
        <label for="lg_e">Email</label><input id="lg_e" type="email" autocomplete="username" required>
        <label for="lg_p">Пароль</label><input id="lg_p" type="password" autocomplete="current-password" required>
        <button type="submit" id="lg_b">Увійти</button><button type="button" class="lnk" id="lg_f">Забули пароль?</button><div class="msg" id="lg_m"></div></form>`,
      reset:`<form class="lg" id="lgf" novalidate>${logoSvg()}<h1>Відновлення пароля</h1>
        <label for="lg_e">Email</label><input id="lg_e" type="email" autocomplete="username" required>
        <button type="submit" id="lg_b">Надіслати посилання</button><button type="button" class="lnk" id="lg_back">Назад до входу</button><div class="msg" id="lg_m"></div></form>`,
      newpass:`<form class="lg" id="lgf" novalidate>${logoSvg()}<h1>Новий пароль</h1>
        <label for="lg_p">Новий пароль (не менше 10 символів)</label><input id="lg_p" type="password" autocomplete="new-password" required>
        <button type="submit" id="lg_b">Зберегти</button><div class="msg" id="lg_m"></div></form>`};
    w.innerHTML=forms[mode]; w.hidden=false;
    const f=document.getElementById('lgf'), m=document.getElementById('lg_m'), b=document.getElementById('lg_b');
    const msg=(t,ok)=>{m.textContent=t;m.className='msg'+(ok?' ok':'')};
    (document.getElementById('lg_e')||document.getElementById('lg_p')).focus();
    const fl=document.getElementById('lg_f'); if(fl) fl.onclick=()=>show('reset');
    const bk=document.getElementById('lg_back'); if(bk) bk.onclick=()=>show('login');
    f.onsubmit=async e=>{e.preventDefault();b.disabled=true;msg('');
      try{
        if(mode==='login'){const {error}=await sb.auth.signInWithPassword({email:lg_e.value.trim(),password:lg_p.value});if(error)throw error}
        if(mode==='reset'){const {error}=await sb.auth.resetPasswordForEmail(lg_e.value.trim(),{redirectTo:location.origin+location.pathname});if(error)throw error;msg('Якщо такий email є, лист із посиланням уже надіслано.',true)}
        if(mode==='newpass'){if(lg_p.value.length<10)throw {message:'Пароль має бути не менше 10 символів.'};const {error}=await sb.auth.updateUser({password:lg_p.value});if(error)throw error;w.hidden=true;start()}
      }catch(err){msg(/Invalid login/i.test(err.message||'')?'Невірний email або пароль.':(err.message||'Не вийшло, спробуйте ще раз.'))}
      b.disabled=false};
  }
  function hideLogin(){const w=document.getElementById('lgw');if(w)w.hidden=true}

  /* ---------- data ---------- */
  function emit(col){const docs=Object.entries(store[col]||{}).map(([id,d])=>({id,data:()=>d}));(subs[col]||[]).forEach(cb=>cb({docs,metadata:{fromCache:false,hasPendingWrites:false}}))}
  async function loadAll(){
    const page=1000;let from=0;
    for(;;){const {data,error}=await sb.from('docs').select('col,id,data').order('col').order('id').range(from,from+page-1);
      if(error)throw error;for(const r of data){(store[r.col]=store[r.col]||{})[r.id]=r.data}
      if(data.length<page)break;from+=page}
    if(role==='accountant'){const {data:a,error:ae}=await sb.rpc('acct_data');if(ae)throw ae;for(const r of a||[]){(store[r.col]=store[r.col]||{})[r.id]=r.data}}
    try{const {data:u}=await sb.from('allowed_users').select('email,name');(u||[]).forEach(x=>names[x.email.toLowerCase()]=x.name)}catch(_){}
    loaded=true;Object.keys(subs).forEach(emit);
    channel=sb.channel('docs-live').on('postgres_changes',{event:'*',schema:'public',table:'docs'},p=>{
      const r=p.new&&p.new.col?p.new:p.old; if(!r||!r.col)return;
      if(p.eventType==='DELETE'){if(store[r.col])delete store[r.col][r.id]} else {(store[r.col]=store[r.col]||{})[r.id]=p.new.data}
      emit(r.col)}).subscribe();
  }
  function ref(col,id){
    return {id,path:col+'/'+id,
      async set(data){if(role==='accountant'&&!ACCT_COLS.includes(col)){(store[col]=store[col]||{})[id]=data;emit(col);return}
        const {error}=await sb.from('docs').upsert({col,id,data});if(error)throw {code:error.code==='42501'?'invalid_argument':'unavailable',message:error.message};(store[col]=store[col]||{})[id]=data;emit(col)},
      async update(data){const cur=(store[col]||{})[id];if(!cur)throw {code:'invalid_argument',message:'not found'};return this.set({...cur,...data})},
      async delete(){if(role==='accountant'&&!ACCT_COLS.includes(col))throw {code:'invalid_argument',message:'Немає прав'};
        const {error}=await sb.from('docs').delete().eq('col',col).eq('id',id);if(error)throw {code:'unavailable',message:error.message};if(store[col])delete store[col][id];emit(col)}};
  }
  const rid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const db={collection:col=>({path:col,doc:id=>ref(col,id||rid()),onSnapshot(cb,err){(subs[col]=subs[col]||[]).push(cb);(errs[col]=errs[col]||[]).push(err);if(loaded)setTimeout(()=>emit(col),0);return()=>{subs[col]=(subs[col]||[]).filter(x=>x!==cb)}}}),
    doc:path=>{const [c,i]=path.split('/');return ref(c,i)}};

  /* ---------- user ---------- */
  const user={can:async()=>true,id:async()=>session&&session.user.email,
    profiles:async ids=>Object.fromEntries(ids.map(i=>[i,{name:names[String(i||'').toLowerCase()]||String(i||'').split('@')[0]}]))};

  /* ---------- downloads ---------- */
  const downloads={save:async({filename,data})=>{const blob=data instanceof Blob?data:new Blob([data]);const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);return {status:'saved'}}};

  window.claude={use:async n=>{await ready;return n==='db'?db:n==='user'?user:n==='downloads'?downloads:null}};

  /* ---------- logout button ---------- */
  function addLogout(){if(document.getElementById('logoutBtn'))return;const row=document.querySelector('header .hrow');if(!row)return;
    const b=document.createElement('button');b.id='logoutBtn';b.type='button';b.className='btn sm';b.textContent='Вийти';b.title=session?session.user.email:'';
    b.onclick=async()=>{await sb.auth.signOut();location.reload()};row.appendChild(b)}


  /* ---------- auto-update: GitHub Pages caches pages ~10 min ---------- */
  (function(){
    const meta=document.querySelector('meta[name=wl-build]'); if(!meta)return; const mine=meta.content; let shown=false;
    async function check(){ if(shown)return;
      try{const r=await fetch(location.pathname+'?_='+Date.now(),{cache:'reload'});const t=await r.text();
        const m=/name="wl-build" content="([^"]+)"/.exec(t);
        if(m&&m[1]!==mine){shown=true;
          const busy=document.querySelector('#modal .sheet');
          if(!busy){location.reload();return}
          const b=document.createElement('button');b.type='button';b.textContent='Є нова версія — оновити';
          b.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9998;background:#11233f;color:#fff;border:0;border-radius:20px;padding:10px 18px;font:inherit;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer';
          b.onclick=()=>location.reload();document.body.appendChild(b)}}catch(_){}
    }
    setTimeout(check,3000); setInterval(check,120000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
  })();
  let started=false, role='owner'; const ACCT_COLS=['points','util','pay','tariffs'];
  function denied(email){const d=document.createElement('div');
    d.style.cssText='position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:#f4f8fc;font-family:Arimo,Arial,sans-serif';
    d.innerHTML='<div style="max-width:380px;background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 20px rgba(17,35,63,.12);color:#11233f"><b style="font-size:18px">Немає доступу</b><p style="margin:12px 0 18px;line-height:1.45">Обліковий запис <b></b> ще не додано до списку доступу WaterLab. Попросіть Влада додати його й потім оновіть сторінку.</p><button type="button" style="background:#11233f;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer">Вийти</button></div>';
    d.querySelector('p b').textContent=email||'';d.querySelector('button').onclick=async()=>{await sb.auth.signOut();location.reload()};document.body.appendChild(d)}
  async function start(){if(started)return;started=true;hideLogin();addLogout();
    try{const {data:ok,error}=await sb.rpc('is_allowed');if(!error&&ok===false){denied(session&&session.user.email);return}}catch(_){}
    try{const {data:r}=await sb.rpc('my_role');role=r||'owner'}catch(_){}
    window.WL_ROLE=role;
    try{await loadAll()}catch(e){Object.values(errs).flat().forEach(f=>f&&f({code:'unavailable',message:e.message}))}
    window.WL_NAME=names[((session&&session.user.email)||'').toLowerCase()]||'';
    readyResolve()}
  sb.auth.onAuthStateChange((ev,s)=>{session=s;if(ev==='PASSWORD_RECOVERY'){show('newpass');return}if(s&&ev!=='SIGNED_OUT')start()});
  sb.auth.getSession().then(({data})=>{session=data.session;if(location.hash.includes('type=recovery'))return;if(session)start();else show('login')});
})();
