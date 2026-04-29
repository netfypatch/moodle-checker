(function(){

var PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

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
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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

// ── PDF.JS — надёжная загрузка ────────────────────────────────────────────────
// Ждём пока pdfjsLib.GlobalWorkerOptions точно появится

function loadPdfJs(callback){
  function ready(){
    return window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions;
  }
  if(ready()){
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_URL;
    callback();
    return;
  }
  // Скрипт ещё не добавлен — добавляем
  var existing=document.getElementById('__mcpdfjs__');
  if(!existing){
    var s=document.createElement('script');
    s.id='__mcpdfjs__';
    s.src=PDFJS_URL;
    document.head.appendChild(s);
  }
  // Поллинг до появления GlobalWorkerOptions
  var tries=0;
  var t=setInterval(function(){
    tries++;
    if(ready()){
      clearInterval(t);
      window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_URL;
      callback();
    } else if(tries>150){
      clearInterval(t);
      setStatus('Не удалось загрузить PDF.js','e');
    }
  },100);
}

function readPdf(buf,onDone,onErr){
  pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){
    var limit=Math.min(pdf.numPages,15);
    var results=new Array(limit);
    var done=0;
    for(var i=1;i<=limit;i++){
      (function(n){
        pdf.getPage(n).then(function(pg){
          pg.getTextContent({normalizeWhitespace:true}).then(function(c){
            results[n-1]=c.items.map(function(x){return x.str;}).join(' ');
            if(++done===limit) onDone(results.join('\n'));
          }).catch(function(){results[n-1]='';if(++done===limit) onDone(results.join('\n'));});
        }).catch(function(){results[n-1]='';if(++done===limit) onDone(results.join('\n'));});
      })(i);
    }
  }).catch(onErr);
}

function analyze(pdf,moodle){
  setStatus('Загружаю '+pdf.name+'…','i');
  setResults('loading');
  fetch(pdf.url,{credentials:'include'})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer();})
    .then(function(buf){
      setStatus('Читаю PDF…','i');
      loadPdfJs(function(){
        readPdf(buf,function(txt){
          var r=compare(txt,moodle);
          renderResults(r);
          setStatus('Готово — разделов в PDF: '+r.total,'ok');
        },function(e){setStatus('Ошибка разбора: '+e.message,'e');});
      });
    })
    .catch(function(e){setStatus('Ошибка загрузки: '+e.message,'e');setResults('');});
}

// ── ПАПКИ ────────────────────────────────────────────────────────────────────

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

var statusEl,resultsEl;

function setStatus(msg,cls){
  if(!statusEl)return;
  var icons={i:'⏳',ok:'✓',e:'✗'};
  statusEl.className='mc-status mc-status--'+(cls||'');
  statusEl.textContent=(icons[cls]||'')+' '+msg;
}

function setResults(state){
  if(!resultsEl)return;
  if(state==='loading'){
    resultsEl.innerHTML='<div class="mc-loading"><div class="mc-spinner"></div><span>Анализирую…</span></div>';
  } else if(!state){
    resultsEl.innerHTML='';
  }
}

function renderResults(r){
  if(!resultsEl)return;
  if(!r.total){
    resultsEl.innerHTML='<div class="mc-empty">Разделы не найдены в PDF.<br><small>Ожидается формат: Раздел 1. Название</small></div>';
    return;
  }

  var h='<div class="mc-summary-bar">'
    +'<span class="mc-chip mc-chip--green">✓ '+r.matched.length+' совпадают</span>'
    +(r.onlyPdf.length?'<span class="mc-chip mc-chip--red">✗ '+r.onlyPdf.length+' нет в Moodle</span>':'')
    +(r.onlyMoodle.length?'<span class="mc-chip mc-chip--orange">? '+r.onlyMoodle.length+' лишних</span>':'')
    +'</div>';

  if(r.matched.length){
    h+='<p class="mc-group-label mc-group-label--green">Совпадают</p>';
    r.matched.forEach(function(m){
      var p=Math.round(m.sc*100);
      var cls=p>=90?'green':p>=70?'orange':'red';
      h+='<div class="mc-card">'
        +'<div class="mc-card-head">'
        +'<span class="mc-badge mc-badge--'+cls+'">'+p+'%</span>'
        +'<span class="mc-card-pdf">'+esc(m.p)+'</span>'
        +'</div>'
        +'<div class="mc-card-sub">↳ Moodle: '+esc(m.m)+'</div>'
        +'</div>';
    });
  }

  if(r.onlyPdf.length){
    h+='<p class="mc-group-label mc-group-label--red">Нет в Moodle</p>';
    r.onlyPdf.forEach(function(s){
      h+='<div class="mc-card mc-card--red">'
        +'<div class="mc-card-head">'
        +'<span class="mc-badge mc-badge--red">✗</span>'
        +'<span class="mc-card-pdf">'+esc(s)+'</span>'
        +'</div></div>';
    });
  }

  if(r.onlyMoodle.length){
    h+='<p class="mc-group-label mc-group-label--orange">Лишних в Moodle</p>';
    r.onlyMoodle.forEach(function(s){
      h+='<div class="mc-card mc-card--orange">'
        +'<div class="mc-card-head">'
        +'<span class="mc-badge mc-badge--orange">?</span>'
        +'<span class="mc-card-pdf">'+esc(s)+'</span>'
        +'</div></div>';
    });
  }

  resultsEl.innerHTML=h;
}

function showList(pdfs,moodle){
  var el=document.getElementById('__mclist__');
  if(!pdfs.length){
    el.innerHTML='<p class="mc-hint">Программы не найдены автоматически.</p>';
    return;
  }
  window.__mcP__=pdfs; window.__mcM__=moodle;
  if(pdfs.length===1){
    el.innerHTML='<div class="mc-file-row mc-file-row--active">'
      +'<span class="mc-file-icon">📄</span>'
      +'<span class="mc-file-name" title="'+esc(pdfs[0].name)+'">'+esc(pdfs[0].name)+'</span>'
      +'<a href="'+pdfs[0].url+'" download class="mc-btn mc-btn--ghost">↓</a>'
      +'</div>';
    analyze(pdfs[0],moodle);
    return;
  }
  var h='<p class="mc-hint">Найдено '+pdfs.length+' программ — выберите:</p>';
  pdfs.forEach(function(pdf,i){
    h+='<div class="mc-file-row" id="__mfr'+i+'">'
      +'<span class="mc-file-icon">📄</span>'
      +'<span class="mc-file-name" title="'+esc(pdf.name)+'">'+esc(pdf.name)+'</span>'
      +'<a href="'+pdf.url+'" download class="mc-btn mc-btn--ghost">↓</a>'
      +'<button class="mc-btn mc-btn--primary" onclick="window.__mcRun__('+i+')">▶</button>'
      +'</div>';
  });
  el.innerHTML=h;
  window.__mcRun__=function(i){
    document.querySelectorAll('.mc-file-row').forEach(function(el,j){
      el.className='mc-file-row'+(j===i?' mc-file-row--active':'');
    });
    analyze(window.__mcP__[i],window.__mcM__);
  };
}

function injectStyles(){
  if(document.getElementById('__mcstyle__'))return;
  var s=document.createElement('style');
  s.id='__mcstyle__';
  s.textContent=
    // Panel
    '#__mc__{position:fixed;top:0;right:0;width:420px;height:100vh;display:flex;flex-direction:column;'+
    'background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;'+
    'z-index:2147483647;box-shadow:-2px 0 24px rgba(0,0,0,.12);border-left:1px solid #eee}'+
    '#__mc__ *{box-sizing:border-box;margin:0;padding:0}'+

    // Header
    '.mc-header{padding:16px 20px;display:flex;justify-content:space-between;align-items:center;'+
    'border-bottom:1px solid #f0f0f0;flex-shrink:0}'+
    '.mc-header-title{font-size:15px;font-weight:600;color:#111;display:flex;align-items:center;gap:8px}'+
    '.mc-close{width:28px;height:28px;border-radius:8px;border:none;background:#f5f5f5;'+
    'color:#999;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}'+
    '.mc-close:hover{background:#eee;color:#333}'+

    // Moodle count bar
    '.mc-moodle-bar{padding:10px 20px;background:#fafafa;border-bottom:1px solid #f0f0f0;flex-shrink:0;'+
    'font-size:12px;color:#999;line-height:1.5}'+
    '.mc-moodle-bar b{color:#333;font-weight:600}'+

    // PDF section
    '.mc-pdf-section{padding:14px 20px;border-bottom:1px solid #f0f0f0;flex-shrink:0}'+

    // File rows
    '.mc-file-row{display:flex;align-items:center;gap:8px;padding:9px 12px;'+
    'border:1px solid #eee;border-radius:10px;margin-bottom:6px;background:#fafafa;transition:all .15s}'+
    '.mc-file-row:hover{border-color:#ddd;background:#f5f5f5}'+
    '.mc-file-row--active{border-color:#111!important;background:#f5f5f5!important}'+
    '.mc-file-icon{font-size:14px;flex-shrink:0}'+
    '.mc-file-name{flex:1;font-size:12px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+

    // Buttons
    '.mc-btn{padding:5px 10px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;'+
    'border:none;white-space:nowrap;transition:all .15s;text-decoration:none;display:inline-block}'+
    '.mc-btn--ghost{background:#fff;color:#666;border:1px solid #e0e0e0}'+
    '.mc-btn--ghost:hover{background:#f5f5f5;border-color:#ccc}'+
    '.mc-btn--primary{background:#111;color:#fff}'+
    '.mc-btn--primary:hover{background:#333}'+

    // Manual upload
    '.mc-manual{margin-top:10px;padding-top:10px;border-top:1px solid #f0f0f0}'+
    '.mc-manual label{font-size:11px;color:#bbb;display:block;margin-bottom:4px}'+
    '.mc-manual input[type=file]{width:100%;font-size:11px;color:#666}'+

    // Status
    '.mc-status{font-size:11px;margin-top:8px;min-height:16px;color:#bbb}'+
    '.mc-status--i{color:#5b8dee}.mc-status--ok{color:#22c55e}.mc-status--e{color:#ef4444}'+

    // Results area
    '#__mcr__{flex:1;overflow-y:auto;padding:16px 20px}'+
    '#__mcr__::-webkit-scrollbar{width:4px}'+
    '#__mcr__::-webkit-scrollbar-thumb{background:#eee;border-radius:2px}'+

    // Summary chips
    '.mc-summary-bar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}'+
    '.mc-chip{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600}'+
    '.mc-chip--green{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}'+
    '.mc-chip--red{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}'+
    '.mc-chip--orange{background:#fffbeb;color:#d97706;border:1px solid #fed7aa}'+

    // Group labels
    '.mc-group-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;'+
    'margin:16px 0 8px;color:#ccc}'+
    '.mc-group-label--green{color:#16a34a}'+
    '.mc-group-label--red{color:#dc2626}'+
    '.mc-group-label--orange{color:#d97706}'+

    // Result cards
    '.mc-card{padding:10px 12px;border:1px solid #f0f0f0;border-radius:10px;margin-bottom:6px;background:#fafafa}'+
    '.mc-card--red{background:#fff5f5;border-color:#fecaca}'+
    '.mc-card--orange{background:#fffcf0;border-color:#fed7aa}'+
    '.mc-card-head{display:flex;align-items:baseline;gap:8px}'+
    '.mc-card-pdf{font-size:12px;color:#222;line-height:1.4;flex:1}'+
    '.mc-card-sub{font-size:11px;color:#aaa;margin-top:4px;line-height:1.4}'+

    // Badges
    '.mc-badge{flex-shrink:0;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:700}'+
    '.mc-badge--green{background:#f0fdf4;color:#16a34a}'+
    '.mc-badge--orange{background:#fffbeb;color:#d97706}'+
    '.mc-badge--red{background:#fef2f2;color:#dc2626}'+

    // Loading / empty
    '.mc-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:32px;color:#aaa;font-size:13px}'+
    '.mc-spinner{width:18px;height:18px;border:2px solid #eee;border-top-color:#999;border-radius:50%;animation:mcspin .7s linear infinite;flex-shrink:0}'+
    '@keyframes mcspin{to{transform:rotate(360deg)}}'+
    '.mc-empty{text-align:center;padding:32px 20px;color:#aaa;font-size:13px;line-height:1.6}'+
    '.mc-hint{font-size:11px;color:#bbb;margin-bottom:8px}';

  document.head.appendChild(s);
}

function buildUI(){
  var old=document.getElementById('__mc__');if(old)old.remove();
  injectStyles();
  var moodle=getMoodle();

  var d=document.createElement('div');
  d.id='__mc__';
  d.innerHTML=
    '<div class="mc-header">'
      +'<span class="mc-header-title">📋 Проверка разделов</span>'
      +'<button class="mc-close" onclick="document.getElementById(\'__mc__\').remove()">✕</button>'
    +'</div>'
    +'<div class="mc-moodle-bar">'
      +'Разделов в Moodle: <b>'+(moodle.length||'0')+'</b>'
      +(moodle.length
        ? ' &nbsp;'+moodle.map(function(s){return s.replace(/\s*\(.*$/,'').substring(0,22);}).join(' · ')
        : ' <span style="color:#ef4444">— не найдено</span>')
    +'</div>'
    +'<div class="mc-pdf-section">'
      +'<div id="__mclist__"><p class="mc-hint">🔍 Ищу рабочие программы…</p></div>'
      +'<div class="mc-manual">'
        +'<label>Или загрузите PDF вручную:</label>'
        +'<input type="file" id="__mcfile__" accept=".pdf">'
      +'</div>'
      +'<div class="mc-status" id="__mcstatus__"></div>'
    +'</div>'
    +'<div id="__mcr__"></div>';

  document.body.appendChild(d);
  statusEl=document.getElementById('__mcstatus__');
  resultsEl=document.getElementById('__mcr__');

  document.getElementById('__mcfile__').onchange=function(e){
    var f=e.target.files[0];if(!f)return;
    setStatus('Читаю PDF…','i');
    var fr=new FileReader();
    fr.onload=function(ev){
      setResults('loading');
      loadPdfJs(function(){
        readPdf(ev.target.result,function(txt){
          renderResults(compare(txt,getMoodle()));
          setStatus('Готово','ok');
        },function(e){setStatus('Ошибка: '+e.message,'e');setResults('');});
      });
    };
    fr.readAsArrayBuffer(f);
  };

  var folders=findFolders();
  if(!folders.length){
    document.getElementById('__mclist__').innerHTML='<p class="mc-hint">Папки не найдены — загрузите PDF вручную.</p>';
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
