/* MangaVerse Step 4 data layer
   Connects profiles, bookmarks, comments and submissions to Supabase.
   Reading progress is saved when the reader is opened from a database chapter id.
*/
(function(){
  let sb;
  const getSB=()=>sb||(sb=window.supabaseClient||supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY));
  window.supabaseClient=getSB();

  async function syncUser(session){
    if(!session){ window.user=null; return; }
    const {data,error}=await getSB().from('users').select('id,display_name,email,email_verified,avatar_url,bio').eq('id',session.user.id).maybeSingle();
    if(error) console.warn('Profile load:',error.message);
    window.user={id:session.user.id,name:data?.display_name||session.user.user_metadata?.display_name||session.user.email.split('@')[0],email:session.user.email};
  }

  async function loadCloud(){
    if(!window.accountSession){ window.bookmarks=[]; window.cloudSubmissions=[]; updateUser(); return; }
    const uid=window.accountSession.user.id;
    const [b,s]=await Promise.all([
      getSB().from('bookmarks').select('title_id').eq('user_id',uid),
      getSB().from('submissions').select('*').eq('submitted_by',uid).order('created_at',{ascending:false})
    ]);
    if(b.error) console.warn('Bookmarks load:',b.error.message);
    if(s.error) console.warn('Submissions load:',s.error.message);
    window.bookmarks=(b.data||[]).map(x=>x.title_id);
    try {
      const {data:pdata}=await getSB().from('reading_progress')
        .select('chapter_id,page_number,updated_at,chapters(chapter_number,titles(title))')
        .eq('user_id',uid).order('updated_at',{ascending:false}).limit(5);
      window.cloudProgress=pdata||[];
    } catch(e) { window.cloudProgress=[]; console.warn('Progress load:',e.message); }
    window.cloudSubmissions=s.data||[];
    localStorage.setItem('mv_bookmarks',JSON.stringify(window.bookmarks));
    updateUser();
  }

  // Auth: replace the prototype fake auth with Supabase Auth.
  window.authMode=function(mode){
    const signup=mode==='signup';
    const name=document.getElementById('name');
    const submit=document.getElementById('authSubmit');
    if(name) name.style.display=signup?'block':'none';
    if(submit) submit.textContent=signup?'Create account':'Login';
    document.getElementById('loginTab')?.classList.toggle('active',!signup);
    document.getElementById('signupTab')?.classList.toggle('active',signup);
  };
  window.openAuth=function(){document.getElementById('auth').classList.add('show');authMode('login')};
  window.closeAuth=function(){document.getElementById('auth').classList.remove('show')};
  window.fakeAuth=async function(e){
    e.preventDefault();
    const form=e.target;
    const email=form.querySelector('input[type=email]')?.value.trim().toLowerCase();
    const password=form.querySelector('input[type=password]')?.value||'';
    const name=document.getElementById('name')?.value.trim();
    if(!email||!password) return;
    try{
      if(document.getElementById('signupTab')?.classList.contains('active')){
        if(password.length<8) return alert('Password must be at least 8 characters.');
        if(!name) return alert('Please enter your name.');
        const {data,error}=await getSB().auth.signUp({email,password,options:{data:{display_name:name}}});
        if(error) throw error;
        closeAuth();
        alert(data.session?'Account created and signed in.':'Account created. Check your email to verify your account.');
      }else{
        const {data,error}=await getSB().auth.signInWithPassword({email,password});
        if(error) throw error;
        window.accountSession=data.session; await syncUser(data.session); await loadCloud(); closeAuth(); updateUser();
      }
    }catch(err){alert(err.message||'Authentication failed.')}
  };
  window.logout=async function(){
    const {error}=await getSB().auth.signOut();
    if(error) return alert(error.message);
    window.accountSession=null;window.user=null;window.bookmarks=[];closeProfile();updateUser();
  };

  window.openProfile=async function(){
    if(!window.accountSession) return openAuth();
    await loadCloud();
    document.getElementById('profile').classList.add('show');
    document.getElementById('userText').textContent=(user?.name||'Reader')+' · '+(user?.email||'');
    const list=window.bookmarks||[];
    document.getElementById('bookmarks').innerHTML=list.length
      ? list.map(id=>`<span class="chip">Saved title ${escapeHtml(id)}</span>`).join(' ')
      : '<p class="muted">No bookmarks yet.</p>';
    const rp=document.getElementById('readingProgress');
    const cp=window.cloudProgress||[];
    if(rp) rp.innerHTML=cp.length
      ? cp.map(p=>`<div class="chip" style="display:block;margin-bottom:8px">Chapter ${escapeHtml(String(p.chapters?.chapter_number||'?'))} · page ${escapeHtml(String(p.page_number||1))}<br><small>${escapeHtml(p.chapters?.titles?.title||'Manga')}</small></div>`).join('')
      : '<p class="muted">No reading progress yet. Open a chapter to start tracking.</p>';
  };

  window.toggleTitleBookmark=async function(title){
    if(!window.accountSession) return openAuth();
    // The demo catalog has string titles rather than database UUIDs. Use a deterministic UUID-like
    // lookup if a title exists in public.titles; otherwise tell the user to use the DB catalog.
    const {data,error}=await getSB().from('titles').select('id,title').eq('title',title).maybeSingle();
    if(error) return alert(error.message);
    if(!data) return alert('This demo title is not in the Supabase catalog yet. Add the title through the admin publishing system first.');
    const exists=(window.bookmarks||[]).includes(data.id);
    const q=exists
      ? getSB().from('bookmarks').delete().eq('user_id',accountSession.user.id).eq('title_id',data.id)
      : getSB().from('bookmarks').insert({user_id:accountSession.user.id,title_id:data.id});
    const {error:e}=await q;if(e)return alert(e.message);
    await loadCloud(); alert(exists?'Removed from bookmarks.':'Bookmarked!');
  };

  window.toggleBookmark=async function(){return toggleTitleBookmark(current.title)};

  window.openComments=async function(title){
    window.activeCommentsTitle=title;
    document.getElementById('commentsTitle').textContent=title+' — Comments';
    document.getElementById('comments').classList.add('show');
    await renderComments();
  };
  window.renderComments=async function(){
    const list=document.getElementById('commentsList');
    const {data,error}=await getSB().from('comments').select('id,body,created_at,user_id').eq('title_id',window.activeCommentsTitle).order('created_at',{ascending:false});
    if(error){list.innerHTML='<p class="muted">This demo title is not yet linked to the Supabase catalog.</p>';return}
    list.innerHTML=(data||[]).length?(data||[]).map(c=>`<div class="comment"><div class="comment-head"><span class="comment-user">Reader</span><span class="comment-time">${new Date(c.created_at).toLocaleString()}</span></div><div>${escapeHtml(c.body)}</div></div>`).join(''):'<p class="muted">No comments yet. Start the conversation.</p>';
  };
  window.addComment=async function(e){
    e.preventDefault();
    if(!window.accountSession) return openAuth();
    const input=document.getElementById('commentInput'),text=input.value.trim();if(!text)return;
    const {data:title,error:tErr}=await getSB().from('titles').select('id').eq('title',window.activeCommentsTitle).maybeSingle();
    if(tErr||!title)return alert('This demo title is not in the Supabase catalog yet.');
    const {error}=await getSB().from('comments').insert({user_id:accountSession.user.id,title_id:title.id,body:text});
    if(error)return alert(error.message);input.value='';await renderComments();
  };

  window.startSubmissionPayment=async function(e){
    e.preventDefault();
    if(!window.accountSession)return openAuth();
    if(!document.getElementById('rightsConfirm')?.checked)return alert('Please confirm that you have the rights/permission to submit this content.');
    const payload={
      submitted_by:accountSession.user.id,
      proposed_title:document.getElementById('submitTitle').value.trim(),
      author_name:document.getElementById('submitAuthor').value.trim(),
      source_url:document.getElementById('submitSource').value.trim(),
      genre:document.getElementById('submitGenre').value,
      description:document.getElementById('submitDescription').value.trim(),
      payment_status:'pending',review_status:'pending'
    };
    const {data,error}=await getSB().from('submissions').insert(payload).select().single();
    if(error)return alert(error.message);
    // Payment is deliberately not marked paid here. A server/webhook must verify Paystack/Flutterwave.
    closeSubmission();
    alert('Submission saved. The next production step is connecting Paystack/Flutterwave checkout and its server-side webhook verification.');
    await loadCloud();
  };

  const originalOpenReader = window.openReader;
  window.openReader = async function(title,ch){
    if(typeof originalOpenReader==='function') originalOpenReader(title,ch);
    window.currentDbChapterId=null;
    window.currentReaderPage=1;
    const note=document.getElementById('readerProgressNote');
    if(!window.accountSession){
      if(note) note.textContent='Sign in to save your reading progress across devices.';
      return;
    }
    const {data,error}=await getSB().from('chapters')
      .select('id,chapter_number,title_id,titles!inner(title)')
      .eq('chapter_number',ch)
      .eq('titles.title',title)
      .maybeSingle();
    if(!error && data){
      window.currentDbChapterId=data.id;
      const {data:p}=await getSB().from('reading_progress')
        .select('page_number').eq('user_id',window.accountSession.user.id)
        .eq('chapter_id',data.id).maybeSingle();
      window.currentReaderPage=p?.page_number||1;
      await saveReadingProgress(data.id,window.currentReaderPage);
      if(note) note.textContent=`Progress saved — page ${window.currentReaderPage}.`;
    } else if(note) {
      note.textContent='This chapter is not linked to the MangaVerse catalog yet.';
    }
  };

  window.markReaderPage=async function(pageNumber){
    const p=Math.max(1,Number(pageNumber)||1);
    window.currentReaderPage=p;
    if(window.currentDbChapterId && window.accountSession){
      await saveReadingProgress(window.currentDbChapterId,p);
      const note=document.getElementById('readerProgressNote');
      if(note) note.textContent=`Progress saved — page ${p}.`;
    }
  };

  // Save reading progress when a real DB chapter id is supplied by the reader.
  window.saveReadingProgress=async function(chapterId,pageNumber){
    if(!window.accountSession||!chapterId)return;
    const {error}=await getSB().from('reading_progress').upsert({user_id:accountSession.user.id,chapter_id:chapterId,page_number:pageNumber,updated_at:new Date().toISOString()},{onConflict:'user_id,chapter_id'});
    if(error)console.warn('Progress save:',error.message);
  };

  async function boot(){
    const {data}=await getSB().auth.getSession();
    window.accountSession=data.session;
    await syncUser(data.session);
    await loadCloud();
    updateUser();
    getSB().auth.onAuthStateChange(async(_event,session)=>{
      window.accountSession=session;
      await syncUser(session);
      await loadCloud();
      updateUser();
    });
  }
  boot();
})();
