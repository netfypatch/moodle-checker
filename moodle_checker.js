(function(){

// Moodle сам содержит PDF.js — используем его, не грузим внешний
// Если нет — пробуем найти worker на странице
var WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

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

// ── PDF.JS — несколько стратегий загрузки ────────────────────────────────────

function getPdfJsFromMoodle(){
  // Moodle часто загружает PDF.js для своего плагина pdfjs
  var scripts=document.querySelectorAll('script[src]');
  for(var i=0;i<scripts.length;i++){
    if(/pdf\.js|pdfjs/i.test(scripts[i].src)&&!/worker/i.test(scripts[i].src)){
      return scripts[i].src;
    }
  }
  return null;
}

function getPdfJsWorkerFromMoodle(){
  var scripts=document.querySelectorAll('script[src]');
  for(var i=0;i<scripts.length;i++){
    if(/pdf.*worker|worker.*pdf/i.test(scripts[i].src)){
      return scripts[i].src;
    }
  }
  // Попробуем угадать путь worker'а рядом с основным файлом
  var main=getPdfJsFromMoodle();
  if(main) return main.replace(/pdf\.min\.js|pdf\.js/,'pdf.worker.min.js');
  return null;
}

function loadPdfJs(callback){
  // Стратегия 1: уже есть в window
  if(window.pdfjsLib&&window.pdfjsLib.GlobalWorkerOptions){
    var w=getPdfJsWorkerFromMoodle()||WORKER_URL;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=w;
    callback(null);
    return;
  }

  // Стратегия 2: PDF.js уже на странице (Moodle загрузил), ждём
  var moodleSrc=getPdfJsFromMoodle();
  if(moodleSrc){
    setStatus('Ожидаю PDF.js Moodle…','i');
    var tries=0;
    var t=setInterval(function(){
      if(window.pdfjsLib&&window.pdfjsLib.GlobalWorkerOptions){
        clearInterval(t);
        var w=getPdfJsWorkerFromMoodle()||WORKER_URL;
        window.pdfjsLib.GlobalWorkerOptions.workerSrc=w;
        callback(null);
      } else if(++tries>50){
        clearInterval(t);
        // Продолжаем к стратегии 3
        loadExternal(callback);
      }
    },100);
    return;
  }

  // Стратегия 3: грузим внешний
  loadExternal(callback);
}

function loadExternal(callback){
  setStatus('Загружаю PDF.js…','i');
  if(document.getElementById('__mcpdfjs__')){
    // уже добавлен, ждём
    waitForPdfJs(callback);
    return;
  }
  var s=document.createElement('script');
  s.id='__mcpdfjs__';
  s.src=PDFJS_URL;
  s.crossOrigin='anonymous';
  s.onload=function(){
    waitForPdfJs(callback);
  };
  s.onerror=function(){
    callback(new Error('PDF.js недоступен (CSP). Загрузите PDF вручную через кнопку.'));
  };
  document.head.appendChild(s);
}

function waitForPdfJs(callback){
  var tries=0;
  var t=setInterval(function(){
    if(window.pdfjsLib&&window.pdfjsLib.GlobalWorkerOptions){
      clearInterval(t);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_URL;
      callback(null);
    } else if(++tries>100){
      clearInterval(t);
      callback(new Error('PDF.js не инициализировался'));
    }
  },100);
}

function readPdf(buf,onDone,onErr){
  try{
    pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){
      var limit=Math.min(pdf.numPages,15);
      var results=new Array(limit);
      var done=0;
      for(var i=1;i<=limit;i++){
        (function(n){
          pdf.getPage(n).then(function(pg){
            pg.getTextContent({normalizeWhitespace:true}).then(function(c){
              results[n-1]=c.items.map(function(x){return x.str;}).join(' ');
              if(++done===limit)onDone(results.join('\n'));
            }).catch(function(){results[n-1]='';if(++done===limit)onDone(results.join('\n'));});
          }).catch(function(){results[n-1]='';if(++done===limit)onDone(results.join('\n'));});
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
      setStatus('Загружаю PDF.js…','i');
      loadPdfJs(function(err){
        if(err){setStatus(err.message,'e');setBody('');return;}
        setStatus('Читаю текст…','i');
        readPdf(buf,function(txt){
          var r=compare(txt,moodle);
          renderResults(r);
          setStatus('Готово · разделов в PDF: '+r.total,'ok');
        },function(e){setStatus('Ошибка разбора: '+e.message,'e');setBody('');});
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
  statusEl.className='st st-'+( cls||'');
  var dot=cls==='ok'?'●':cls==='e'?'●':cls==='i'?'○':'·';
  statusEl.innerHTML='<span class="st-dot">'+dot+'</span><span>'+esc(msg)+'</span>';
}

function setBody(state){
  if(!bodyEl)return;
  if(state==='loading'){
    bodyEl.innerHTML='<div class="loading"><div class="spinner"></div><span>Анализирую…</span></div>';
  } else if(!state){
    bodyEl.innerHTML='<div class="placeholder">Результаты появятся здесь</div>';
  }
}

function renderResults(r){
  if(!bodyEl)return;
  if(!r.total){
    bodyEl.innerHTML='<div class="empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Разделы не найдены</p><small>Ожидается: Раздел 1. Название</small></div>';
    return;
  }

  var h='<div class="summary">'
    +'<div class="chip chip-ok"><span>'+r.matched.length+'</span> совпали</div>'
    +(r.onlyPdf.length?'<div class="chip chip-err"><span>'+r.onlyPdf.length+'</span> нет в Moodle</div>':'')
    +(r.onlyMoodle.length?'<div class="chip chip-warn"><span>'+r.onlyMoodle.length+'</span> лишних</div>':'')
    +'</div>';

  if(r.matched.length){
    h+='<div class="section-label label-ok">Совпадают</div>';
    r.matched.forEach(function(m){
      var p=Math.round(m.sc*100);
      var q=p>=90?'ok':p>=70?'warn':'err';
      h+='<div class="rcard rcard-'+q+'" style="--anim-delay:'+(r.matched.indexOf(m)*40)+'ms">'
        +'<div class="rcard-top"><div class="pct pct-'+q+'">'+p+'%</div><div class="rcard-title">'+esc(m.p)+'</div></div>'
        +'<div class="rcard-sub">↳ '+esc(m.m)+'</div>'
        +'</div>';
    });
  }
  if(r.onlyPdf.length){
    h+='<div class="section-label label-err">Нет в Moodle</div>';
    r.onlyPdf.forEach(function(s,i){
      h+='<div class="rcard rcard-err" style="--anim-delay:'+(i*40)+'ms">'
        +'<div class="rcard-top"><div class="pct pct-err">✗</div><div class="rcard-title">'+esc(s)+'</div></div>'
        +'</div>';
    });
  }
  if(r.onlyMoodle.length){
    h+='<div class="section-label label-warn">Лишних в Moodle</div>';
    r.onlyMoodle.forEach(function(s,i){
      h+='<div class="rcard rcard-warn" style="--anim-delay:'+(i*40)+'ms">'
        +'<div class="rcard-top"><div class="pct pct-warn">?</div><div class="rcard-title">'+esc(s)+'</div></div>'
        +'</div>';
    });
  }

  bodyEl.innerHTML=h;
  // Анимация появления карточек
  setTimeout(function(){
    bodyEl.querySelectorAll('.rcard').forEach(function(el){
      var d=parseInt(el.style.getPropertyValue('--anim-delay'))||0;
      setTimeout(function(){el.classList.add('rcard-in');},d);
    });
  },10);
}

function showList(pdfs,moodle){
  var el=document.getElementById('__mclist__');
  if(!pdfs.length){
    el.innerHTML='<p class="hint">Программы не найдены. Загрузите PDF вручную.</p>';
    return;
  }
  window.__mcP__=pdfs; window.__mcM__=moodle;
  if(pdfs.length===1){
    el.innerHTML=fileRow(pdfs[0],0,true);
    analyze(pdfs[0],moodle);
    return;
  }
  var h='<p class="hint">'+pdfs.length+' программ — выберите нужную</p>';
  pdfs.forEach(function(pdf,i){h+=fileRow(pdf,i,false);});
  el.innerHTML=h;
  window.__mcRun__=function(i){
    document.querySelectorAll('.frow').forEach(function(el,j){
      el.className='frow'+(j===i?' frow-active':'');
    });
    analyze(window.__mcP__[i],window.__mcM__);
  };
}

function fileRow(pdf,i,active){
  return '<div class="frow'+(active?' frow-active':'')+'">'
    +'<div class="frow-icon">'+docIcon()+'</div>'
    +'<div class="frow-name" title="'+esc(pdf.name)+'">'+esc(pdf.name)+'</div>'
    +'<a href="'+pdf.url+'" download class="fbtn fbtn-ghost" title="Скачать">'+dlIcon()+'</a>'
    +(active?'':'<button class="fbtn fbtn-dark" onclick="window.__mcRun__('+i+')" title="Анализировать">'+runIcon()+'</button>')
    +'</div>';
}

function docIcon(){return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>';}
function dlIcon(){return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';}
function runIcon(){return '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';}

function injectStyles(){
  if(document.getElementById('__mcstyle__'))return;
  var s=document.createElement('style');
  s.id='__mcstyle__';
  s.textContent=[
    // Reset + panel
    '#__mc__{all:initial;position:fixed;top:0;right:0;width:420px;height:100vh;display:flex;flex-direction:column;',
    'background:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;',
    'z-index:2147483647;box-shadow:-1px 0 0 #E8E8E8,-8px 0 32px rgba(0,0,0,.08);',
    'color:#1A1A1A;line-height:1.5}',
    '#__mc__ *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}',

    // Header — frosted look
    '.mc-hdr{display:flex;justify-content:space-between;align-items:center;',
    'padding:16px 20px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '.mc-hdr-left{display:flex;align-items:center;gap:8px}',
    '.mc-hdr-icon{width:28px;height:28px;background:#1A1A1A;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;flex-shrink:0}',
    '.mc-hdr-title{font-size:14px;font-weight:600;letter-spacing:-.2px;color:#1A1A1A}',
    '.mc-hdr-sub{font-size:11px;color:#999;margin-top:1px}',
    '.mc-close{width:28px;height:28px;border-radius:8px;border:1px solid #EFEFEF;background:#fff;',
    'color:#999;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;',
    'transition:all .15s;flex-shrink:0}',
    '.mc-close:hover{background:#F5F5F5;color:#1A1A1A;border-color:#DDD}',

    // Moodle count pill
    '.mc-mbar{padding:10px 20px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0;display:flex;align-items:center;gap:8px}',
    '.mc-mbar-label{font-size:11px;color:#999;flex-shrink:0}',
    '.mc-mpill{display:flex;align-items:center;gap:5px;font-size:11px;color:#555;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.mc-mcount{display:inline-flex;align-items:center;justify-content:center;',
    'min-width:20px;height:20px;padding:0 6px;background:#1A1A1A;color:#fff;',
    'border-radius:10px;font-size:11px;font-weight:700;flex-shrink:0}',

    // PDF section
    '.mc-files{padding:14px 20px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '.hint{font-size:11px;color:#BBB;margin-bottom:8px}',

    // File rows
    '.frow{display:flex;align-items:center;gap:7px;padding:9px 11px;',
    'border:1px solid #EFEFEF;border-radius:10px;margin-bottom:5px;',
    'background:#FAFAFA;transition:all .15s;cursor:default}',
    '.frow:hover{border-color:#DDD;background:#F5F5F5}',
    '.frow-active{border-color:#1A1A1A!important;background:#F5F5F5!important}',
    '.frow-icon{color:#BBB;flex-shrink:0}',
    '.frow-name{flex:1;font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

    // Buttons
    '.fbtn{display:inline-flex;align-items:center;justify-content:center;',
    'width:28px;height:28px;border-radius:8px;cursor:pointer;transition:all .15s;',
    'border:none;flex-shrink:0;text-decoration:none}',
    '.fbtn-ghost{background:#fff;color:#BBB;border:1px solid #EFEFEF}',
    '.fbtn-ghost:hover{background:#F5F5F5;color:#555;border-color:#DDD}',
    '.fbtn-dark{background:#1A1A1A;color:#fff;border:1px solid #1A1A1A}',
    '.fbtn-dark:hover{background:#333}',

    // Manual upload
    '.mc-manual{margin-top:10px;padding-top:10px;border-top:1px solid #F5F5F5}',
    '.mc-manual-label{font-size:11px;color:#CCC;display:block;margin-bottom:4px}',
    '.mc-manual input[type=file]{width:100%;font-size:11px;color:#888;cursor:pointer}',

    // Status bar
    '.st{display:flex;align-items:center;gap:5px;font-size:11px;margin-top:8px;min-height:16px;color:#CCC;transition:color .2s}',
    '.st-ok{color:#16A34A}.st-e{color:#DC2626}.st-i{color:#3B82F6}',
    '.st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}',

    // Body / results
    '#__mcbody__{flex:1;overflow-y:auto;padding:16px 20px}',
    '#__mcbody__::-webkit-scrollbar{width:3px}',
    '#__mcbody__::-webkit-scrollbar-thumb{background:#E8E8E8;border-radius:2px}',

    // Loading
    '.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;',
    'padding:40px 20px;color:#CCC;font-size:12px}',
    '.spinner{width:24px;height:24px;border:2px solid #EEE;border-top-color:#1A1A1A;',
    'border-radius:50%;animation:spin .6s linear infinite}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.placeholder{padding:40px 20px;text-align:center;color:#DDD;font-size:12px}',
    '.empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 20px;',
    'text-align:center;color:#CCC}',
    '.empty svg{opacity:.4}.empty p{font-size:13px;color:#AAA}.empty small{font-size:11px}',

    // Summary chips
    '.summary{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}',
    '.chip{display:flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;',
    'font-size:12px;font-weight:500}',
    '.chip span{font-weight:700}',
    '.chip-ok{background:#F0FDF4;color:#16A34A;border:1px solid #BBF7D0}',
    '.chip-err{background:#FEF2F2;color:#DC2626;border:1px solid #FECACA}',
    '.chip-warn{background:#FFFBEB;color:#D97706;border:1px solid #FED7AA}',

    // Section labels
    '.section-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;',
    'margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid #F0F0F0}',
    '.label-ok{color:#16A34A}.label-err{color:#DC2626}.label-warn{color:#D97706}',

    // Result cards — with enter animation
    '.rcard{padding:10px 12px;border:1px solid #F0F0F0;border-radius:10px;margin-bottom:5px;',
    'background:#fff;opacity:0;transform:translateY(6px);transition:opacity .25s ease,transform .25s ease}',
    '.rcard-in{opacity:1;transform:translateY(0)}',
    '.rcard-ok{border-left:3px solid #86EFAC}',
    '.rcard-warn{border-left:3px solid #FCD34D}',
    '.rcard-err{border-left:3px solid #FCA5A5;background:#FFFAFA}',
    '.rcard-top{display:flex;align-items:baseline;gap:8px}',
    '.rcard-title{font-size:12px;color:#333;line-height:1.4;flex:1}',
    '.rcard-sub{font-size:11px;color:#BBB;margin-top:4px;line-height:1.4;padding-left:38px}',

    // Percent badges
    '.pct{flex-shrink:0;min-width:32px;padding:2px 6px;border-radius:6px;',
    'font-size:11px;font-weight:700;text-align:center}',
    '.pct-ok{background:#F0FDF4;color:#16A34A}',
    '.pct-warn{background:#FFFBEB;color:#D97706}',
    '.pct-err{background:#FEF2F2;color:#DC2626}',

    // Reduced motion
    '@media (prefers-reduced-motion:reduce){',
    '.rcard{transition:none;opacity:1;transform:none}',
    '.spinner{animation:none;border:2px solid #1A1A1A}',
    '}'
  ].join('');
  document.head.appendChild(s);
}

function buildUI(){
  var old=document.getElementById('__mc__');if(old)old.remove();
  injectStyles();
  var moodle=getMoodle();

  var d=document.createElement('div');
  d.id='__mc__';
  d.innerHTML=
    // Header
    '<div class="mc-hdr">'
      +'<div class="mc-hdr-left">'
        +'<div class="mc-hdr-icon">📋</div>'
        +'<div><div class="mc-hdr-title">Проверка разделов</div>'
        +'<div class="mc-hdr-sub">Рабочая программа vs Moodle</div></div>'
      +'</div>'
      +'<button class="mc-close" onclick="document.getElementById(\'__mc__\').remove()">✕</button>'
    +'</div>'
    // Moodle bar
    +'<div class="mc-mbar">'
      +'<span class="mc-mbar-label">Moodle</span>'
      +'<div class="mc-mpill">'
        +'<span class="mc-mcount">'+(moodle.length||0)+'</span>'
        +(moodle.length
          ? moodle.map(function(s){return esc(s.replace(/\s*\(.*$/,'').substring(0,22));}).join(' · ')
          : '<span style="color:#DC2626">разделы не найдены</span>')
      +'</div>'
    +'</div>'
    // Files
    +'<div class="mc-files">'
      +'<div id="__mclist__"><p class="hint">🔍 Ищу рабочие программы…</p></div>'
      +'<div class="mc-manual">'
        +'<label class="mc-manual-label">Или загрузите PDF вручную:</label>'
        +'<input type="file" id="__mcfile__" accept=".pdf">'
      +'</div>'
      +'<div class="st" id="__mcst__"></div>'
    +'</div>'
    // Body
    +'<div id="__mcbody__"><div class="placeholder">Результаты появятся здесь</div></div>';

  document.body.appendChild(d);
  statusEl=document.getElementById('__mcst__');
  bodyEl=document.getElementById('__mcbody__');

  // Анимация появления панели
  d.style.transform='translateX(100%)';
  d.style.transition='transform .3s cubic-bezier(.22,1,.36,1)';
  setTimeout(function(){d.style.transform='translateX(0)';},10);

  document.getElementById('__mcfile__').onchange=function(e){
    var f=e.target.files[0];if(!f)return;
    setStatus('Читаю PDF…','i');
    setBody('loading');
    var fr=new FileReader();
    fr.onload=function(ev){
      loadPdfJs(function(err){
        if(err){setStatus(err.message,'e');setBody('');return;}
        readPdf(ev.target.result,function(txt){
          renderResults(compare(txt,getMoodle()));
          setStatus('Готово','ok');
        },function(e){setStatus('Ошибка: '+e.message,'e');setBody('');});
      });
    };
    fr.readAsArrayBuffer(f);
  };

  var folders=findFolders();
  if(!folders.length){
    document.getElementById('__mclist__').innerHTML='<p class="hint">Папки не найдены — загрузите PDF вручную.</p>';
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
