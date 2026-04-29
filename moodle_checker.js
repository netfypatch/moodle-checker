(function(){

// Несколько источников PDF.js — пробуем по очереди
var PDFJS_SOURCES=[
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
];
var WORKER_SOURCES=[
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

// ── УТИЛИТЫ ─────────────────────────────────────────────────────────────────

function norm(s){
  return s.toUpperCase()
    .replace(/РАЗДЕЛ\s+([IVXIVX\d]+)\./gi,'РАЗДЕЛ $1')
    .replace(/\s*\([\d\s]+ЧАС[А-Я]*\)/g,'')
    .replace(/\s*[-–]\s*\d+\s*СЕМ[А-Я]*/g,'')
    .replace(/[«»""]/g,'').replace(/\s+/g,' ').trim();
}
function sim(a,b){
  var A=new Set(a.split(/\s+/).filter(function(w){return w.length>2;}));
  var B=new Set(b.split(/\s+/).filter(function(w){return w.length>2;}));
  if(!A.size||!B.size)return 0;
  var n=0;A.forEach(function(w){if(B.has(w))n++;});
  return n/(A.size+B.size-n);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── ЛОГИКА ───────────────────────────────────────────────────────────────────

function getMoodle(){
  var r=[],seen=new Set();
  document.querySelectorAll('.panel-title a,.accordion-toggle,.sectionname,.section-title').forEach(function(el){
    var t=el.textContent.trim();
    if(t&&/раздел/i.test(t)&&!seen.has(t)){seen.add(t);r.push(t);}
  });
  return r;
}

function getSections(txt){
  var start=txt.search(/4\.\s*(СТРУКТУРА|СОДЕРЖАНИЕ)/i);
  if(start<0) start=txt.search(/СТРУКТУРА\s+И\s+СОДЕРЖАНИЕ/i);
  var chunk=start>=0?txt.slice(start,start+20000):txt.slice(0,20000);
  var r=[],seen=new Set(),re=/Раздел\s+([IVXivx\d]+)[.\s]+([^\n\r.]{5,120})/gi,m;
  while((m=re.exec(chunk))!==null){
    var t='Раздел '+m[1]+'. '+m[2].replace(/\s+/g,' ').trim();
    var k=norm(t);
    if(!seen.has(k)){seen.add(k);r.push(t);}
  }
  return r;
}

function compare(txt,moodle){
  var ps=getSections(txt);
  var mn=moodle.map(function(s){return{o:s,n:norm(s)};});
  var matched=[],onlyPdf=[],onlyMoodle=[],used=new Set();
  ps.map(function(s){return{o:s,n:norm(s)};}).forEach(function(p){
    var best=null,bsc=0;
    mn.forEach(function(m,i){var sc=sim(p.n,m.n);if(sc>bsc){bsc=sc;best={i:i,m:m};}});
    if(bsc>0.5){matched.push({p:p.o,m:best.m.o,sc:bsc});used.add(best.i);}
    else onlyPdf.push(p.o);
  });
  mn.forEach(function(m,i){if(!used.has(i))onlyMoodle.push(m.o);});
  return{matched:matched,onlyPdf:onlyPdf,onlyMoodle:onlyMoodle,total:ps.length};
}

// ── PDF.JS — пробуем все источники по очереди ───────────────────────────────

function getPdfLib(){
  return window.pdfjsLib || window.pdfjsDistBuildPdf;
}

function loadPdfJs(callback){
  var existingLib=getPdfLib();

  if(existingLib && typeof existingLib.getDocument === 'function'){
    window.pdfjsLib=existingLib;
    if(window.pdfjsLib.GlobalWorkerOptions){
      try{window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_SOURCES[0];}catch(e){}
    }
    callback(null);
    return;
  }

  var idx=0;

  function tryNext(){
    if(idx>=PDFJS_SOURCES.length){
      callback(new Error('PDF.js загрузился, но Moodle/RequireJS не дал создать window.pdfjsLib. Попробуйте вариант с временным отключением define или Tampermonkey.'));
      return;
    }

    setStatus('Пробую источник '+(idx+1)+'/'+PDFJS_SOURCES.length+'…','i');

    var oldDefine=window.define;
    var oldExports=window.exports;
    var oldModule=window.module;

    try{
      window.define=undefined;
      window.exports=undefined;
      window.module=undefined;
    }catch(e){}

    var s=document.createElement('script');
    s.src=PDFJS_SOURCES[idx];

    s.onload=function(){
      try{
        window.define=oldDefine;
        window.exports=oldExports;
        window.module=oldModule;
      }catch(e){}

      var tries=0;
      var t=setInterval(function(){
        var loadedLib=getPdfLib();

        if(loadedLib && typeof loadedLib.getDocument === 'function'){
          clearInterval(t);

          window.pdfjsLib=loadedLib;

          try{
            if(window.pdfjsLib.GlobalWorkerOptions){
              window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_SOURCES[idx];
            }
          }catch(e){}

          callback(null);
        } else if(++tries>50){
          clearInterval(t);
          s.parentNode && s.parentNode.removeChild(s);
          idx++;
          tryNext();
        }
      },100);
    };

    s.onerror=function(){
      try{
        window.define=oldDefine;
        window.exports=oldExports;
        window.module=oldModule;
      }catch(e){}

      s.parentNode && s.parentNode.removeChild(s);
      idx++;
      tryNext();
    };

    document.head.appendChild(s);
  }

  tryNext();
}

function readPdf(buf,onDone,onErr){
  try{
    if(!window.pdfjsLib && getPdfLib()){
      window.pdfjsLib=getPdfLib();
    }

    if(!window.pdfjsLib || typeof window.pdfjsLib.getDocument !== 'function'){
      onErr(new Error('pdfjsLib не найден'));
      return;
    }

    window.pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){
      var limit=Math.min(pdf.numPages,15);
      var results=new Array(limit);
      var done=0;
      function checkDone(){if(++done===limit)onDone(results.join('\n'));}
      for(var i=1;i<=limit;i++){
        (function(n){
          pdf.getPage(n).then(function(pg){
            pg.getTextContent({normalizeWhitespace:true}).then(function(c){
              results[n-1]=c.items.map(function(x){return x.str||'';}).join(' ');
              checkDone();
            }).catch(function(){results[n-1]='';checkDone();});
          }).catch(function(){results[n-1]='';checkDone();});
        })(i);
      }
    }).catch(onErr);
  }catch(e){onErr(e);}
}

function analyze(pdf,moodle){
  setStatus('Загружаю файл…','i');
  setBody('loading');
  fetch(pdf.url,{credentials:'include'})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})
    .then(function(buf){
      loadPdfJs(function(err){
        if(err){setStatus(err.message,'e');setBody('');return;}
        setStatus('Читаю текст PDF…','i');
        readPdf(buf,function(txt){
          var r=compare(txt,moodle);
          renderResults(r);
          setStatus('Готово · разделов в PDF: '+r.total,'ok');
        },function(e){setStatus('Ошибка: '+(e&&e.message||'разбор PDF'),'e');setBody('');});
      });
    })
    .catch(function(e){setStatus('Ошибка: '+e.message,'e');setBody('');});
}

// ── ПОИСК ПАПОК ──────────────────────────────────────────────────────────────

function findFolders(){
  var r=[],seen=new Set();
  document.querySelectorAll('a[href*="/mod/folder/view.php"]').forEach(function(a){
    if(!seen.has(a.href)){seen.add(a.href);r.push(a.href);}
  });
  return r;
}

function fetchPdfs(url,cb){
  fetch(url,{credentials:'include'})
    .then(function(r){return r.text();})
    .then(function(h){
      var doc=new DOMParser().parseFromString(h,'text/html');
      var r=[],seen=new Set();
      doc.querySelectorAll('a[href]').forEach(function(a){
        var href=a.href,dec=decodeURIComponent(href);
        if(/\.pdf/i.test(href)&&/\/\d{4}-\d{4}[_\-]/i.test(dec)&&!seen.has(href)){
          seen.add(href);
          r.push({name:decodeURIComponent(href.split('/').pop().split('?')[0]),url:href});
        }
      });
      cb(null,r);
    }).catch(function(e){cb(e,null);});
}

// ── UI ───────────────────────────────────────────────────────────────────────

var statusEl,bodyEl;

function setStatus(msg,cls){
  if(!statusEl)return;
  statusEl.className='__mc-st __mc-st-'+(cls||'');
  statusEl.innerHTML='<span class="__mc-st-dot"></span><span>'+esc(msg)+'</span>';
}

function setBody(state){
  if(!bodyEl)return;
  if(state==='loading'){
    bodyEl.innerHTML='<div class="__mc-loading"><div class="__mc-spinner"></div><span>Анализирую…</span></div>';
  } else if(!state){
    bodyEl.innerHTML='<div class="__mc-placeholder">Результаты появятся здесь</div>';
  }
}

function renderResults(r){
  if(!bodyEl)return;
  if(!r.total){
    bodyEl.innerHTML='<div class="__mc-empty"><p>Разделы не найдены</p><small>Ожидается формат: Раздел 1. Название</small></div>';
    return;
  }

  var h='<div class="__mc-summary">'
    +'<div class="__mc-chip __mc-chip-ok"><b>'+r.matched.length+'</b> совпали</div>'
    +(r.onlyPdf.length?'<div class="__mc-chip __mc-chip-err"><b>'+r.onlyPdf.length+'</b> нет в Moodle</div>':'')
    +(r.onlyMoodle.length?'<div class="__mc-chip __mc-chip-warn"><b>'+r.onlyMoodle.length+'</b> лишних</div>':'')
    +'</div>';

  if(r.matched.length){
    h+='<div class="__mc-section-label __mc-label-ok">Совпадают</div>';
    r.matched.forEach(function(m,i){
      var p=Math.round(m.sc*100);
      var q=p>=90?'ok':p>=70?'warn':'err';
      h+='<div class="__mc-rcard __mc-rcard-'+q+'" style="animation-delay:'+(i*40)+'ms">'
        +'<div class="__mc-rcard-top"><div class="__mc-pct __mc-pct-'+q+'">'+p+'%</div>'
        +'<div class="__mc-rcard-title">'+esc(m.p)+'</div></div>'
        +'<div class="__mc-rcard-sub">↳ '+esc(m.m)+'</div></div>';
    });
  }
  if(r.onlyPdf.length){
    h+='<div class="__mc-section-label __mc-label-err">Нет в Moodle</div>';
    r.onlyPdf.forEach(function(s,i){
      h+='<div class="__mc-rcard __mc-rcard-err" style="animation-delay:'+(i*40)+'ms">'
        +'<div class="__mc-rcard-top"><div class="__mc-pct __mc-pct-err">✗</div>'
        +'<div class="__mc-rcard-title">'+esc(s)+'</div></div></div>';
    });
  }
  if(r.onlyMoodle.length){
    h+='<div class="__mc-section-label __mc-label-warn">Лишних в Moodle</div>';
    r.onlyMoodle.forEach(function(s,i){
      h+='<div class="__mc-rcard __mc-rcard-warn" style="animation-delay:'+(i*40)+'ms">'
        +'<div class="__mc-rcard-top"><div class="__mc-pct __mc-pct-warn">?</div>'
        +'<div class="__mc-rcard-title">'+esc(s)+'</div></div></div>';
    });
  }
  bodyEl.innerHTML=h;
}

function showList(pdfs,moodle){
  var el=document.getElementById('__mclist__');
  if(!pdfs.length){
    el.innerHTML='<p class="__mc-hint">Программы не найдены. Загрузите PDF вручную.</p>';
    return;
  }
  window.__mcP__=pdfs; window.__mcM__=moodle;
  if(pdfs.length===1){
    el.innerHTML=fileRow(pdfs[0],0,true);
    analyze(pdfs[0],moodle);
    return;
  }
  var h='<p class="__mc-hint">'+pdfs.length+' программ — выберите нужную</p>';
  pdfs.forEach(function(pdf,i){h+=fileRow(pdf,i,false);});
  el.innerHTML=h;
  window.__mcRun__=function(i){
    document.querySelectorAll('.__mc-frow').forEach(function(el,j){
      el.className='__mc-frow'+(j===i?' __mc-frow-active':'');
    });
    analyze(window.__mcP__[i],window.__mcM__);
  };
}

function fileRow(pdf,i,active){
  return '<div class="__mc-frow'+(active?' __mc-frow-active':'')+'">'
    +'<svg class="__mc-frow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>'
    +'<div class="__mc-frow-name" title="'+esc(pdf.name)+'">'+esc(pdf.name)+'</div>'
    +'<a href="'+pdf.url+'" download class="__mc-fbtn __mc-fbtn-ghost" title="Скачать">'
    +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
    +'</a>'
    +(active?'':'<button class="__mc-fbtn __mc-fbtn-dark" onclick="window.__mcRun__('+i+')" title="Анализировать"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>')
    +'</div>';
}

function injectStyles(){
  if(document.getElementById('__mcstyle__'))return;
  var s=document.createElement('style');
  s.id='__mcstyle__';
  s.textContent=[
    '#__mc__{position:fixed!important;top:0!important;right:0!important;width:440px!important;height:100vh!important;',
    'display:flex!important;flex-direction:column!important;background:#FAFAFA!important;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;font-size:13px!important;',
    'z-index:2147483647!important;box-shadow:-1px 0 0 #E8E8E8,-8px 0 32px rgba(0,0,0,.08)!important;',
    'color:#1A1A1A!important;line-height:1.5!important;margin:0!important;padding:0!important}',

    '#__mc__,#__mc__ *{box-sizing:border-box}',
    '#__mc__ button{font-family:inherit;cursor:pointer}',
    '#__mc__ p,#__mc__ div,#__mc__ span,#__mc__ button{margin:0;padding:0;text-align:left}',
    '#__mc__ a{text-decoration:none;color:inherit}',

    '#__mc__ .__mc-hdr{display:flex;justify-content:space-between;align-items:center;',
    'padding:14px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-hdr-left{display:flex;align-items:center;gap:10px}',
    '#__mc__ .__mc-hdr-icon{width:30px;height:30px;background:#1A1A1A;border-radius:8px;',
    'display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}',
    '#__mc__ .__mc-hdr-text{display:flex;flex-direction:column;gap:1px}',
    '#__mc__ .__mc-hdr-title{font-size:14px;font-weight:600;color:#1A1A1A;line-height:1.2}',
    '#__mc__ .__mc-hdr-sub{font-size:11px;color:#999;line-height:1.2}',
    '#__mc__ .__mc-close{width:28px;height:28px;border-radius:8px;border:1px solid #EFEFEF;',
    'background:#fff;color:#999;font-size:14px;cursor:pointer;display:flex;',
    'align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;padding:0}',
    '#__mc__ .__mc-close:hover{background:#F5F5F5;color:#1A1A1A;border-color:#DDD}',

    '#__mc__ .__mc-mbox{padding:12px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0;max-height:200px;overflow-y:auto}',
    '#__mc__ .__mc-mbox::-webkit-scrollbar{width:3px}',
    '#__mc__ .__mc-mbox::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:2px}',
    '#__mc__ .__mc-mbox-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '#__mc__ .__mc-mbox-label{font-size:10px;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.5px}',
    '#__mc__ .__mc-mcount{display:inline-flex;align-items:center;justify-content:center;',
    'min-width:22px;height:22px;padding:0 7px;background:#1A1A1A;color:#fff;',
    'border-radius:11px;font-size:11px;font-weight:700;flex-shrink:0}',
    '#__mc__ .__mc-msec{display:flex;align-items:flex-start;gap:8px;padding:6px 0;',
    'border-top:1px solid #F5F5F5;font-size:11.5px;color:#444;line-height:1.4}',
    '#__mc__ .__mc-msec:first-of-type{border-top:none;padding-top:2px}',
    '#__mc__ .__mc-msec-num{flex-shrink:0;width:18px;height:18px;border-radius:50%;',
    'background:#F5F5F5;color:#666;font-size:10px;font-weight:700;display:flex;',
    'align-items:center;justify-content:center;margin-top:1px}',
    '#__mc__ .__mc-msec-text{flex:1;font-weight:500}',

    '#__mc__ .__mc-files{padding:14px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-hint{font-size:11px;color:#AAA;margin:0 0 8px 0!important;font-weight:500}',

    '#__mc__ .__mc-frow{display:flex;align-items:center;gap:8px;padding:9px 11px;',
    'border:1px solid #EFEFEF;border-radius:10px;margin-bottom:5px;background:#FAFAFA;',
    'transition:all .15s}',
    '#__mc__ .__mc-frow:hover{border-color:#DDD;background:#F5F5F5}',
    '#__mc__ .__mc-frow-active{border-color:#1A1A1A!important;background:#F5F5F5!important;border-width:2px}',
    '#__mc__ .__mc-frow-icon{color:#BBB;flex-shrink:0}',
    '#__mc__ .__mc-frow-name{flex:1;font-size:12px;color:#444;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;font-weight:500}',

    '#__mc__ .__mc-fbtn{display:inline-flex;align-items:center;justify-content:center;',
    'width:28px;height:28px;border-radius:8px;cursor:pointer;transition:all .15s;',
    'border:none;flex-shrink:0;padding:0}',
    '#__mc__ .__mc-fbtn-ghost{background:#fff;color:#BBB;border:1px solid #EFEFEF}',
    '#__mc__ .__mc-fbtn-ghost:hover{background:#F5F5F5;color:#555;border-color:#DDD}',
    '#__mc__ .__mc-fbtn-dark{background:#1A1A1A;color:#fff;border:1px solid #1A1A1A}',
    '#__mc__ .__mc-fbtn-dark:hover{background:#333}',

    '#__mc__ .__mc-manual{margin-top:10px;padding-top:10px;border-top:1px solid #F5F5F5}',
    '#__mc__ .__mc-manual-label{font-size:11px;color:#BBB;display:block;margin-bottom:5px;font-weight:500}',
    '#__mc__ .__mc-manual input[type=file]{width:100%;font-size:11px;color:#888;cursor:pointer;padding:0}',

    '#__mc__ .__mc-st{display:flex;align-items:center;gap:6px;font-size:11px;',
    'margin-top:10px;min-height:16px;color:#CCC;font-weight:500}',
    '#__mc__ .__mc-st-ok{color:#16A34A}#__mc__ .__mc-st-e{color:#DC2626}#__mc__ .__mc-st-i{color:#3B82F6}',
    '#__mc__ .__mc-st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;display:inline-block}',

    '#__mc__ #__mcbody__{flex:1;overflow-y:auto;padding:18px}',
    '#__mc__ #__mcbody__::-webkit-scrollbar{width:4px}',
    '#__mc__ #__mcbody__::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:2px}',

    '#__mc__ .__mc-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;',
    'gap:14px;padding:48px 20px;color:#AAA;font-size:12px}',
    '#__mc__ .__mc-spinner{width:28px;height:28px;border:2.5px solid #EEE;border-top-color:#1A1A1A;',
    'border-radius:50%;animation:__mcspin .6s linear infinite}',
    '@keyframes __mcspin{to{transform:rotate(360deg)}}',
    '#__mc__ .__mc-placeholder{padding:48px 20px;text-align:center;color:#CCC;font-size:12px}',
    '#__mc__ .__mc-empty{padding:40px 20px;text-align:center}',
    '#__mc__ .__mc-empty p{color:#AAA;font-size:13px;margin:0 0 4px 0!important;font-weight:500}',
    '#__mc__ .__mc-empty small{font-size:11px;color:#CCC}',

    '#__mc__ .__mc-summary{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}',
    '#__mc__ .__mc-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;',
    'border-radius:20px;font-size:12px;font-weight:500;line-height:1}',
    '#__mc__ .__mc-chip b{font-weight:700}',
    '#__mc__ .__mc-chip-ok{background:#F0FDF4;color:#16A34A;border:1px solid #BBF7D0}',
    '#__mc__ .__mc-chip-err{background:#FEF2F2;color:#DC2626;border:1px solid #FECACA}',
    '#__mc__ .__mc-chip-warn{background:#FFFBEB;color:#D97706;border:1px solid #FED7AA}',

    '#__mc__ .__mc-section-label{font-size:10px;font-weight:700;letter-spacing:.8px;',
    'text-transform:uppercase;margin:18px 0 8px;padding-bottom:6px;border-bottom:1px solid #F0F0F0}',
    '#__mc__ .__mc-label-ok{color:#16A34A}',
    '#__mc__ .__mc-label-err{color:#DC2626}',
    '#__mc__ .__mc-label-warn{color:#D97706}',

    '#__mc__ .__mc-rcard{padding:11px 12px;border:1px solid #F0F0F0;border-radius:10px;',
    'margin-bottom:6px;background:#fff;opacity:0;transform:translateY(8px);',
    'animation:__mcin .3s ease forwards}',
    '@keyframes __mcin{to{opacity:1;transform:translateY(0)}}',
    '#__mc__ .__mc-rcard-ok{border-left:3px solid #86EFAC}',
    '#__mc__ .__mc-rcard-warn{border-left:3px solid #FCD34D;background:#FFFBF0}',
    '#__mc__ .__mc-rcard-err{border-left:3px solid #FCA5A5;background:#FFF5F5}',
    '#__mc__ .__mc-rcard-top{display:flex;align-items:flex-start;gap:8px}',
    '#__mc__ .__mc-rcard-title{font-size:12px;color:#1A1A1A;line-height:1.4;flex:1;font-weight:500}',
    '#__mc__ .__mc-rcard-sub{font-size:11px;color:#999;margin-top:5px;line-height:1.4;padding-left:42px}',

    '#__mc__ .__mc-pct{flex-shrink:0;min-width:34px;padding:2px 7px;border-radius:6px;',
    'font-size:11px;font-weight:700;text-align:center;line-height:1.4}',
    '#__mc__ .__mc-pct-ok{background:#F0FDF4;color:#16A34A}',
    '#__mc__ .__mc-pct-warn{background:#FFFBEB;color:#D97706}',
    '#__mc__ .__mc-pct-err{background:#FEF2F2;color:#DC2626}',

    '@media (prefers-reduced-motion:reduce){',
    '#__mc__ .__mc-rcard{animation:none;opacity:1;transform:none}',
    '#__mc__ .__mc-spinner{animation:none}',
    '}'
  ].join('');
  document.head.appendChild(s);
}

function buildUI(){
  var old=document.getElementById('__mc__');if(old)old.remove();
  injectStyles();
  var moodle=getMoodle();

  var moodleHtml='';
  if(moodle.length){
    moodle.forEach(function(s,i){
      var clean=s.replace(/\s*\([^)]*\)\s*-?\s*\d*\s*сем\.?$/i,'').replace(/\s*\([^)]*\)$/,'').trim();
      moodleHtml+='<div class="__mc-msec"><div class="__mc-msec-num">'+(i+1)+'</div>'
        +'<div class="__mc-msec-text">'+esc(clean)+'</div></div>';
    });
  } else {
    moodleHtml='<div style="color:#DC2626;font-size:11.5px;padding:6px 0">Разделы не найдены на странице</div>';
  }

  var d=document.createElement('div');
  d.id='__mc__';
  d.innerHTML=
    '<div class="__mc-hdr">'
      +'<div class="__mc-hdr-left">'
        +'<div class="__mc-hdr-icon">'
          +'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
        +'</div>'
        +'<div class="__mc-hdr-text">'
          +'<div class="__mc-hdr-title">Проверка разделов</div>'
          +'<div class="__mc-hdr-sub">Программа vs Moodle</div>'
        +'</div>'
      +'</div>'
      +'<button class="__mc-close" onclick="document.getElementById(\'__mc__\').remove()">✕</button>'
    +'</div>'
    +'<div class="__mc-mbox">'
      +'<div class="__mc-mbox-head">'
        +'<span class="__mc-mbox-label">Разделы в Moodle</span>'
        +'<span class="__mc-mcount">'+(moodle.length||0)+'</span>'
      +'</div>'
      +moodleHtml
    +'</div>'
    +'<div class="__mc-files">'
      +'<div id="__mclist__"><p class="__mc-hint">🔍 Ищу рабочие программы…</p></div>'
      +'<div class="__mc-manual">'
        +'<label class="__mc-manual-label">Или загрузите PDF вручную:</label>'
        +'<input type="file" id="__mcfile__" accept=".pdf">'
      +'</div>'
      +'<div class="__mc-st" id="__mcst__"></div>'
    +'</div>'
    +'<div id="__mcbody__"><div class="__mc-placeholder">Результаты появятся здесь</div></div>';

  document.body.appendChild(d);
  statusEl=document.getElementById('__mcst__');
  bodyEl=document.getElementById('__mcbody__');

  document.getElementById('__mcfile__').onchange=function(e){
    var f=e.target.files[0];if(!f)return;
    setStatus('Загружаю PDF.js…','i');
    setBody('loading');
    var fr=new FileReader();
    fr.onload=function(ev){
      loadPdfJs(function(err){
        if(err){setStatus(err.message,'e');setBody('');return;}
        setStatus('Читаю текст…','i');
        readPdf(ev.target.result,function(txt){
          renderResults(compare(txt,getMoodle()));
          setStatus('Готово','ok');
        },function(e){setStatus('Ошибка: '+(e&&e.message||'разбор'),'e');setBody('');});
      });
    };
    fr.readAsArrayBuffer(f);
  };

  var folders=findFolders();
  if(!folders.length){
    document.getElementById('__mclist__').innerHTML='<p class="__mc-hint">Папки не найдены — загрузите PDF вручную.</p>';
    return;
  }
  var all=[],done=0;
  folders.forEach(function(url){
    fetchPdfs(url,function(err,pdfs){
      if(!err&&pdfs)all=all.concat(pdfs);
      if(++done===folders.length)showList(all,moodle);
    });
  });
}

buildUI();

})();
