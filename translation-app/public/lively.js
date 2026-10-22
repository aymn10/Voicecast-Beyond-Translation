/* Decorative, explicitly labeled sample conversations; no microphone or API requests. */
(function () {
  'use strict';
  const scenes = [
    {from:'English',to:'Hindi',s:'en',t:'hi',text:'Hello! It is lovely to meet you.',translation:'नमस्ते! आपसे मिलकर अच्छा लगा।'},
    {from:'Spanish',to:'English',s:'es',t:'en',text:'¿Tomamos un café y hablamos?',translation:'Shall we have a coffee and talk?'},
    {from:'Japanese',to:'English',s:'ja',t:'en',text:'一緒に新しいことを始めましょう。',translation:'Let’s start something new together.'},
    {from:'French',to:'English',s:'fr',t:'en',text:'Le monde est plus beau ensemble.',translation:'The world is more beautiful together.'}
  ];
  document.querySelectorAll('[data-live-preview]').forEach(host => {
    host.innerHTML = '<section class="lp" aria-label="Animated sample translations"><div class="lp-header"><div><span class="lp-dot"></span><b>Words in motion</b><small>Sample conversation</small></div><button type="button" class="lp-toggle" aria-label="Pause sample animation">Ⅱ</button></div><div class="lp-pair"></div><div class="lp-feed" aria-live="off"></div><div class="lp-dock"><div class="lp-wave" aria-hidden="true"></div><div class="lp-mic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg></div></div><div class="lp-bottom"><span>Voice → understanding</span><span>No microphone in use</span></div></section>';
    const panel=host.querySelector('.lp'), feed=host.querySelector('.lp-feed'), pair=host.querySelector('.lp-pair'), toggle=host.querySelector('.lp-toggle');
    for(let i=0;i<43;i++){const bar=document.createElement('i');bar.style.setProperty('--height',(10+Math.sin(i*.78)**2*28)+'px');bar.style.setProperty('--delay',(-i*.09)+'s');host.querySelector('.lp-wave').appendChild(bar);}
    let index=1, timer=null, paused=false, typing=null, characters=0, phase='hold';
    const preference=matchMedia('(prefers-reduced-motion: reduce)');
    const reduced=()=>preference.matches || document.documentElement.dataset.motion==='reduced';
    const visible=()=>!document.hidden && (!host.closest('.view') || host.closest('.view').classList.contains('active'));
    const running=()=>!paused && !reduced() && visible();
    function row(scene, instant){
      const el=document.createElement('div');el.className='lp-message';
      const source=document.createElement('div');source.className='lp-source';
      const badge=document.createElement('span');badge.className='lp-language';badge.textContent=scene.s.toUpperCase();
      const text=document.createElement('span');text.lang=scene.s;text.textContent=instant?scene.text:'';
      source.append(badge,text);el.appendChild(source);
      const target=document.createElement('div');target.className='lp-target';
      const label=document.createElement('span');label.className='lp-language';label.textContent=scene.t.toUpperCase();
      const translated=document.createElement('span');translated.lang=scene.t;translated.textContent=scene.translation;
      target.append(label,translated);target.hidden=!instant;el.appendChild(target);feed.appendChild(el);
      while(feed.children.length>2)feed.firstElementChild.remove();
      pair.textContent=scene.from+' → '+scene.to;
      return {text,target,scene};
    }
    row(scenes[0],true);row(scenes[1],true);
    function sync(){
      clearTimeout(timer);panel.classList.toggle('lp-paused',!running());
      toggle.disabled=reduced();toggle.textContent=paused?'▷':'Ⅱ';
      toggle.setAttribute('aria-label',reduced()?'Animation disabled for reduced motion':paused?'Play sample animation':'Pause sample animation');
      toggle.setAttribute('aria-pressed',String(paused));
      if(running())timer=setTimeout(step,phase==='typing'?35:phase==='translate'?550:2800);
    }
    function step(){
      if(!running()){sync();return;}
      if(phase==='hold'){index=(index+1)%scenes.length;typing=row(scenes[index],false);characters=0;phase='typing';panel.classList.add('lp-speaking');}
      else if(phase==='typing'){characters++;typing.text.textContent=typing.scene.text.slice(0,characters);if(characters>=typing.scene.text.length)phase='translate';}
      else {typing.target.hidden=false;panel.classList.remove('lp-speaking');phase='hold';}
      sync();
    }
    toggle.addEventListener('click',()=>{paused=!paused;sync();});
    document.addEventListener('visibilitychange',sync);preference.addEventListener('change',sync);
    new MutationObserver(sync).observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
    const view=host.closest('.view');if(view)new MutationObserver(sync).observe(view,{attributes:true,attributeFilter:['class']});
    sync();
  });
})();
