(function(){

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

function norm(s){
  return s.toUpperCase()
    .replace(/РАЗДЕЛ\s+([IVXIVX\d]+)\./gi,'РАЗДЕЛ $1')
    .replace(/ТЕМА\s+([IVXIVX\d]+)\./gi,'ТЕМА $1')
    .replace(/\s*\([\d\s]+ЧАС[А-Я]*\)/g,'')
    .replace(/\s*[-–]\s*\d+\s*СЕМ[А-Я]*/g,'')
    .replace(/[«»"""']/g,'').replace(/\s+/g,' ').trim();
}
function sim(a,b){
  var A=new Set(a.split(/\s+/).filter(function(w){return w.length>2;}));
  var B=new Set(b.split(/\s+/).filter(function(w){return w.length>2;}));
  if(!A.size||!B.size)return 0;
  var n=0;A.forEach(function(w){if(B.has(w))n++;});
  return n/(A.size+B.size-n);
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ── MOODLE ДАННЫЕ ─────────────────────────────────────────────────────────────

function getMoodle(){
  var r=[],seen=new Set();
  document.querySelectorAll('.panel-title a,.accordion-toggle,.sectionname,.section-title').forEach(function(el){
    // Пропускаем названия активностей (элементов курса), берём только заголовки секций
    if(el.closest('li.activity')) return;
    var t=el.textContent.trim().replace(/^["«»""']+|["«»""']+$/g,'').trim();
    if(t&&!/^общее$/i.test(t)&&!seen.has(t)){seen.add(t);r.push(t);}
  });
  return r;
}

function getMoodleQuizzes(){
  var r=[],seen=new Set();
  document.querySelectorAll('a[href*="/mod/quiz/view.php"]').forEach(function(a){
    var href=a.href;
    if(seen.has(href))return;
    seen.add(href);
    var nameEl=a.querySelector('.instancename');
    var label=nameEl?nameEl.childNodes[0].textContent.trim():a.textContent.trim();
    r.push({name:label,url:href});
  });
  return r;
}

function getSections(txt){
  var start=txt.search(/4\.\s*(СТРУКТУРА|СОДЕРЖАНИЕ)/i);
  if(start<0) start=txt.search(/СТРУКТУРА\s+И\s+СОДЕРЖАНИЕ/i);
  var chunk=start>=0?txt.slice(start,start+30000):txt.slice(0,30000);

  // Собираем по номеру; "Тема N." имеет приоритет над "Раздел N."
  var byNum={};

  function clean(s){
    return s.replace(/\s+/g,' ')
      .replace(/\s+\d+\s+\d+\s+\d+.*$/,'')
      .split(/ Краткое содержание:| Результаты освоения| Предполагаемые результаты| \/Лек\/| \/Пр\/| \/Ср\//i)[0]
      .trim();
  }

  // Паттерн 1: Раздел N.
  var re=/Раздел\s+(\d+)\s*\.?\s*(?:Раздел\s+[IVXLCDM\d]+\s*\.?\s*)?([А-ЯЁA-Z][^]*?)(?=(?:\s+\d+\.\d+\s)|(?:\s+Раздел\s+\d+\s*\.?\s*(?:Раздел\s+[IVXLCDM\d]+\s*\.?\s*)?)|(?:\s+5\.\s)|$)/gi;
  var m;
  while((m=re.exec(chunk))!==null){
    var name=clean(m[2]);
    if(name.length>=5&&!byNum[m[1]])
      byNum[m[1]]={label:'Раздел '+m[1]+'. '+name,prio:0};
  }

  // Паттерн 2: Тема N. — только первое вхождение каждого номера
  // Не используем \b — оно не работает с кириллицей в JS
  var tSeen=new Set();
  var tRe=/Тема\s+(\d+)\s*\.\s*/gi;
  while((m=tRe.exec(chunk))!==null){
    var tNum=m[1];
    if(tSeen.has(tNum))continue;
    tSeen.add(tNum);
    var rest=chunk.slice(m.index+m[0].length);
    // Обрезаем по часам (числа подряд) или по /Лек/ /Пр/ и т.п.
    var stopIdx=rest.search(/\s+\d+\s+\d+\s+\d+|\s*\/[А-ЯЁ]/);
    var tName=stopIdx>0?rest.slice(0,stopIdx):rest.slice(0,250);
    tName=clean(tName).replace(/\.+\s*$/,'').trim();
    if(tName.length<5||tName.length>250)continue;
    if(!/^[А-ЯЁA-Z]/i.test(tName))continue;
    // Тема (prio:1) вытесняет Раздел (prio:0) с тем же номером
    if(!byNum[tNum]||byNum[tNum].prio<1)
      byNum[tNum]={label:'Тема '+tNum+'. '+tName,prio:1};
  }

  var r=[],seen=new Set();
  Object.keys(byNum).sort(function(a,b){return+a-+b;}).forEach(function(k){
    var n=norm(byNum[k].label);
    if(!seen.has(n)){seen.add(n);r.push(byNum[k].label);}
  });
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

// ── ПОИСК PDF ─────────────────────────────────────────────────────────────────

function findGeneralSection(){
  var general=null;
  var NAME_RE=/^(общее|общая\s+информация.*|рабочи[еая]\s+программ[аы]?|рпд)$/i;
  document.querySelectorAll(
    '.panel-heading,.section-header,h3.sectionname,.sectionname,'+
    '.accordion-heading,.panel-title'
  ).forEach(function(el){
    if(!general&&NAME_RE.test(el.textContent.trim())){
      var section=el.closest('li.section')||el.closest('[id^="section-"]');
      if(section){
        general=section;
      } else {
        var p=el;
        for(var i=0;i<4;i++){if(p.parentElement)p=p.parentElement;}
        general=p;
      }
    }
  });
  // Если по имени не нашли — берём первый раздел страницы
  if(!general){
    general=document.getElementById('section-0')||
            document.querySelector('li.section[id^="section-"]');
  }
  return general;
}

function isRpd(href,label){
  var dec=decodeURIComponent(href||'');
  var lbl=(label||'').toLowerCase();
  if(/\/\d{4}-\d{4}[_\-]/i.test(dec)) return true;
  if(/рпд|рабочая\s+программ|рабочей\s+программ/i.test(lbl)) return true;
  return false;
}

function findDirectPdfs(){
  var results=[],seen=new Set();
  var root=findGeneralSection()||document;
  root.querySelectorAll('a[href*="/mod/resource/view.php"]').forEach(function(a){
    var href=a.href;
    if(seen.has(href))return;
    var label=a.textContent.trim();
    var hasPdfIcon=!!(a.querySelector('img[src*="pdf"]')||
                      a.closest('.activityinstance')&&
                      a.closest('.activityinstance').querySelector('img[src*="pdf"]'));
    if(hasPdfIcon||isRpd(href,label)){
      seen.add(href);
      results.push({name:label||'РПД',url:href,type:'resource'});
    }
  });
  return results;
}

function findFolderUrls(){
  var r=[],seen=new Set();
  var root=findGeneralSection()||document;
  root.querySelectorAll('a[href*="/mod/folder/view.php"]').forEach(function(a){
    if(!seen.has(a.href)){seen.add(a.href);r.push(a.href);}
  });
  if(!r.length){
    document.querySelectorAll('a[href*="/mod/folder/view.php"]').forEach(function(a){
      if(!seen.has(a.href)){seen.add(a.href);r.push(a.href);}
    });
  }
  return r;
}

function fetchFolderPdfs(url,cb){
  fetch(url,{credentials:'include'})
    .then(function(r){return r.text();})
    .then(function(h){
      var doc=new DOMParser().parseFromString(h,'text/html');
      var r=[],seen=new Set();
      doc.querySelectorAll('a[href]').forEach(function(a){
        var href=a.href,dec=decodeURIComponent(href);
        if(/\.pdf/i.test(href)&&/\/\d{4}-\d{4}[_\-]/i.test(dec)&&!seen.has(href)){
          seen.add(href);
          r.push({name:decodeURIComponent(href.split('/').pop().split('?')[0]),url:href,type:'file'});
        }
      });
      cb(null,r);
    }).catch(function(e){cb(e,null);});
}

function resolveResourceUrl(resourceUrl,cb){
  fetch(resourceUrl,{credentials:'include',redirect:'follow'})
    .then(function(r){
      var final=r.url;
      if(/\.pdf(\?|$)/i.test(final)){
        cb(null,final);
      } else {
        return r.text().then(function(html){
          var doc=new DOMParser().parseFromString(html,'text/html');
          var link=null;
          doc.querySelectorAll('a[href]').forEach(function(a){
            if(!link&&/pluginfile|\.pdf/i.test(a.href))link=a.href;
          });
          cb(null,link||resourceUrl);
        });
      }
    }).catch(function(e){cb(e,null);});
}

function findAllPdfs(callback){
  var all=[],seen=new Set();
  function addPdf(item){if(!seen.has(item.url)){seen.add(item.url);all.push(item);}}
  var direct=findDirectPdfs();
  var folders=findFolderUrls();
  if(!direct.length&&!folders.length){callback([]);return;}
  var pending=direct.length+folders.length;
  function done(){if(--pending<=0)callback(all);}
  direct.forEach(function(item){
    resolveResourceUrl(item.url,function(err,finalUrl){
      if(!err&&finalUrl)addPdf({name:item.name,url:finalUrl,type:'resource'});
      done();
    });
  });
  folders.forEach(function(url){
    fetchFolderPdfs(url,function(err,pdfs){
      if(!err&&pdfs)pdfs.forEach(addPdf);
      done();
    });
  });
}

// ── ПАРСИНГ ЧАСОВ ─────────────────────────────────────────────────────────────

function parseHours(txt){
  var start=txt.search(/распределение\s+часов\s+дисциплин/i);
  if(start<0)return null;
  var chunk=txt.slice(start,start+5000);

  // Семестры вида "1 (1.1)"
  var semRe=/(\d+)\s*\(\s*(\d+)\.(\d+)\s*\)/g,sems=[],seenL=new Set(),m;
  while((m=semRe.exec(chunk))!==null){
    var lbl=m[1]+'('+m[2]+'.'+m[3]+')';
    if(!seenL.has(lbl)){
      seenL.add(lbl);
      sems.push({label:m[1]+' ('+m[2]+'.'+m[3]+')',sem:+m[1],course:+m[2],semOnCourse:+m[3]});
    }
  }
  if(!sems.length)return null;

  var want=(sems.length+1)*2;

  function extractNums(pattern,stopPattern){
    var re=new RegExp(pattern,'i');
    var m2=re.exec(chunk);
    if(!m2)return[];
    var rest=chunk.slice(m2.index+m2[0].length);
    if(stopPattern){
      var stopM=new RegExp(stopPattern,'i').exec(rest);
      if(stopM)rest=rest.slice(0,stopM.index);
    }
    var nums=[],re3=/\b(\d+)\b/g,m3;
    while((m3=re3.exec(rest))!==null&&nums.length<want){
      nums.push(+m3[1]);
    }
    return nums;
  }

  return{
    sems:sems,
    lekNums:extractNums('Лекции','Практическ|Лаборатор'),
    pracNums:extractNums('Практическ[а-яё]*','Лаборатор|Итого\\s+ауд|Контактная'),
    labNums:extractNums('Лаборатор[а-яё]*','Итого\\s+ауд|Контактная')
  };
}

// ── PDF.JS ────────────────────────────────────────────────────────────────────

function getPdfLib(){return window.pdfjsLib||window.pdfjsDistBuildPdf;}

function loadPdfJs(callback){
  var existingLib=getPdfLib();
  if(existingLib&&typeof existingLib.getDocument==='function'){
    window.pdfjsLib=existingLib;
    try{if(window.pdfjsLib.GlobalWorkerOptions)window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_SOURCES[0];}catch(e){}
    callback(null);return;
  }
  var idx=0;
  function tryNext(){
    if(idx>=PDFJS_SOURCES.length){callback(new Error('Все CDN заблокированы CSP Moodle'));return;}
    setStatus('Загружаю PDF.js ('+(idx+1)+'/'+PDFJS_SOURCES.length+')…','i');
    var oldDefine=window.define;
    try{window.define=undefined;}catch(e){}
    var s=document.createElement('script');
    s.src=PDFJS_SOURCES[idx];
    s.onload=function(){
      try{window.define=oldDefine;}catch(e){}
      var tries=0;
      var t=setInterval(function(){
        var lib=getPdfLib();
        if(lib&&typeof lib.getDocument==='function'){
          clearInterval(t);
          window.pdfjsLib=lib;
          try{if(window.pdfjsLib.GlobalWorkerOptions)window.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_SOURCES[idx];}catch(e){}
          callback(null);
        } else if(++tries>50){clearInterval(t);s.remove();idx++;tryNext();}
      },100);
    };
    s.onerror=function(){try{window.define=oldDefine;}catch(e){}s.remove();idx++;tryNext();};
    document.head.appendChild(s);
  }
  tryNext();
}

function readPdf(buf,onDone,onErr){
  try{
    if(!window.pdfjsLib&&getPdfLib())window.pdfjsLib=getPdfLib();
    if(!window.pdfjsLib||typeof window.pdfjsLib.getDocument!=='function'){onErr(new Error('pdfjsLib не найден'));return;}
    window.pdfjsLib.getDocument({data:buf}).promise.then(function(pdf){
      var limit=Math.min(pdf.numPages,15);
      var results=new Array(limit);
      var done=0;
      function check(){if(++done===limit)onDone(results.join('\n'));}
      for(var i=1;i<=limit;i++){
        (function(n){
          pdf.getPage(n).then(function(pg){
            pg.getTextContent({normalizeWhitespace:true}).then(function(c){
              results[n-1]=c.items.map(function(x){return x.str||'';}).join(' ');
              check();
            }).catch(function(){results[n-1]='';check();});
          }).catch(function(){results[n-1]='';check();});
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
          renderHours(parseHours(txt));
          setStatus('Готово · разделов: '+r.total,'ok');
        },function(e){setStatus('Ошибка: '+(e&&e.message||e),'e');setBody('');});
      });
    })
    .catch(function(e){setStatus('Ошибка загрузки: '+e.message,'e');setBody('');});
}

// ── UI ────────────────────────────────────────────────────────────────────────

var statusEl,bodyEl,hoursEl;

function setStatus(msg,cls){
  if(!statusEl)return;
  statusEl.className='__mc-st __mc-st-'+(cls||'');
  statusEl.innerHTML='<span class="__mc-st-dot"></span><span>'+esc(msg)+'</span>';
}
function setBody(state){
  if(!bodyEl)return;
  if(state==='loading'){
    bodyEl.innerHTML='<div class="__mc-loading"><div class="__mc-spinner"></div><span>Анализирую…</span></div>';
  }else if(!state){
    bodyEl.innerHTML='<div class="__mc-placeholder">Результаты появятся здесь</div>';
  }
}

function renderResults(r){
  if(!bodyEl)return;
  if(!r.total){
    bodyEl.innerHTML='<div class="__mc-empty"><p>Разделы не найдены</p><small>Ожидается: Раздел 1. Название</small></div>';
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
      var p=Math.round(m.sc*100),q=p>=90?'ok':p>=70?'warn':'err';
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

function renderHours(hours){
  if(!hoursEl)return;
  if(!hours||!hours.sems||!hours.sems.length){
    hoursEl.innerHTML='<div class="__mc-placeholder">Таблица часов не найдена в PDF</div>';
    return;
  }
  var N=hours.sems.length;
  function rpAt(nums,i){return nums[i*2+1]!=null?nums[i*2+1]:'—';}
  function rpTotal(nums){
    var idx=N*2+1;
    return nums[idx]!=null?nums[idx]:(nums.length?nums[nums.length-1]:'—');
  }
  var h='<div class="__mc-htbl">';
  // Заголовок
  h+='<div class="__mc-htr __mc-htr-h">';
  h+='<div class="__mc-htd __mc-htd-l">Вид занятий</div>';
  hours.sems.forEach(function(s){
    h+='<div class="__mc-htd __mc-htd-c">'
      +'<b>'+esc(s.label)+'</b>'
      +'<div class="__mc-htd-sub">'+s.course+' курс, '+s.semOnCourse+' сем.</div>'
      +'</div>';
  });
  h+='<div class="__mc-htd __mc-htd-c __mc-htd-tot">Итого</div>';
  h+='</div>';
  // Лекции
  h+='<div class="__mc-htr">';
  h+='<div class="__mc-htd __mc-htd-l">Лекции</div>';
  for(var i=0;i<N;i++)h+='<div class="__mc-htd __mc-htd-c">'+rpAt(hours.lekNums,i)+' ч.</div>';
  h+='<div class="__mc-htd __mc-htd-c __mc-htd-tot">'+rpTotal(hours.lekNums)+' ч.</div>';
  h+='</div>';
  // Практические
  h+='<div class="__mc-htr">';
  h+='<div class="__mc-htd __mc-htd-l">Практические</div>';
  for(var i=0;i<N;i++)h+='<div class="__mc-htd __mc-htd-c">'+rpAt(hours.pracNums,i)+' ч.</div>';
  h+='<div class="__mc-htd __mc-htd-c __mc-htd-tot">'+rpTotal(hours.pracNums)+' ч.</div>';
  h+='</div>';
  // Лабораторные (только если есть хоть одно ненулевое значение)
  if(hours.labNums&&hours.labNums.some(function(n){return n>0;})){
    h+='<div class="__mc-htr">';
    h+='<div class="__mc-htd __mc-htd-l">Лабораторные</div>';
    for(var i=0;i<N;i++)h+='<div class="__mc-htd __mc-htd-c">'+rpAt(hours.labNums,i)+' ч.</div>';
    h+='<div class="__mc-htd __mc-htd-c __mc-htd-tot">'+rpTotal(hours.labNums)+' ч.</div>';
    h+='</div>';
  }
  h+='</div>';
  h+='<p class="__mc-hrs-note">* РП — рабочая программа</p>';
  hoursEl.innerHTML=h;
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
  var typeLabel=pdf.type==='resource'?'📎':'📄';
  return '<div class="__mc-frow'+(active?' __mc-frow-active':'')+'">'
    +'<span class="__mc-frow-icon" style="font-size:14px">'+typeLabel+'</span>'
    +'<div class="__mc-frow-name" title="'+esc(pdf.name)+'">'+esc(pdf.name)+'</div>'
    +'<a href="'+pdf.url+'" download class="__mc-fbtn __mc-fbtn-ghost" title="Скачать">'
    +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
    +'</a>'
    +(active?'':'<button class="__mc-fbtn __mc-fbtn-dark" onclick="window.__mcRun__('+i+')" title="Анализировать">'
    +'<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg></button>')
    +'</div>';
}

function injectStyles(){
  if(document.getElementById('__mcstyle__'))return;
  var s=document.createElement('style');s.id='__mcstyle__';
  s.textContent=[
    '#__mc__{position:fixed!important;top:0!important;right:0!important;width:440px!important;height:100vh!important;display:flex!important;flex-direction:column!important;background:#FAFAFA!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;font-size:13px!important;z-index:2147483647!important;box-shadow:-1px 0 0 #E8E8E8,-8px 0 32px rgba(0,0,0,.08)!important;color:#1A1A1A!important;line-height:1.5!important;margin:0!important;padding:0!important}',
    '#__mc__,#__mc__ *{box-sizing:border-box}',
    '#__mc__ button{font-family:inherit;cursor:pointer}',
    '#__mc__ p,#__mc__ div,#__mc__ span,#__mc__ button{margin:0;padding:0;text-align:left}',
    '#__mc__ a{text-decoration:none;color:inherit}',
    // Header
    '#__mc__ .__mc-hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-hdr-left{display:flex;align-items:center;gap:10px}',
    '#__mc__ .__mc-hdr-icon{width:30px;height:30px;background:#1A1A1A;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}',
    '#__mc__ .__mc-hdr-text{display:flex;flex-direction:column;gap:1px}',
    '#__mc__ .__mc-hdr-title{font-size:14px;font-weight:600;color:#1A1A1A;line-height:1.2}',
    '#__mc__ .__mc-hdr-sub{font-size:11px;color:#999;line-height:1.2}',
    '#__mc__ .__mc-close{width:28px;height:28px;border-radius:8px;border:1px solid #EFEFEF;background:#fff;color:#999;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;padding:0}',
    '#__mc__ .__mc-close:hover{background:#F5F5F5;color:#1A1A1A;border-color:#DDD}',
    // Moodle sections box
    '#__mc__ .__mc-mbox{padding:12px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0;max-height:160px;overflow-y:auto}',
    '#__mc__ .__mc-mbox::-webkit-scrollbar{width:3px}',
    '#__mc__ .__mc-mbox::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:2px}',
    '#__mc__ .__mc-mbox-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
    '#__mc__ .__mc-mbox-label{font-size:10px;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.5px;flex:1}',
    '#__mc__ .__mc-mcount{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;background:#1A1A1A;color:#fff;border-radius:11px;font-size:11px;font-weight:700;flex-shrink:0}',
    '#__mc__ .__mc-msec{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-top:1px solid #F5F5F5;font-size:11.5px;color:#444;line-height:1.4}',
    '#__mc__ .__mc-msec:first-of-type{border-top:none;padding-top:2px}',
    '#__mc__ .__mc-msec-num{flex-shrink:0;width:18px;height:18px;border-radius:50%;background:#F5F5F5;color:#666;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}',
    '#__mc__ .__mc-msec-text{flex:1;font-weight:500}',
    // Quizzes box (collapsible)
    '#__mc__ .__mc-qbox{padding:10px 18px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-qbox-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}',
    '#__mc__ .__mc-qbox-head:hover .__mc-mbox-label{color:#555}',
    '#__mc__ .__mc-qarrow{font-size:10px;color:#CCC;margin-left:2px;transition:transform .15s;display:inline-block}',
    '#__mc__ .__mc-qlist{margin-top:8px;max-height:130px;overflow-y:auto}',
    '#__mc__ .__mc-qlist::-webkit-scrollbar{width:3px}',
    '#__mc__ .__mc-qlist::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:2px}',
    // Files
    '#__mc__ .__mc-files{padding:10px 18px 14px;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-files-head{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-bottom:10px}',
    '#__mc__ .__mc-files-head:hover .__mc-mbox-label{color:#555}',
    '#__mc__ .__mc-hint{font-size:11px;color:#AAA;margin:0 0 8px 0!important;font-weight:500}',
    '#__mc__ .__mc-frow{display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid #EFEFEF;border-radius:10px;margin-bottom:5px;background:#FAFAFA;transition:all .15s}',
    '#__mc__ .__mc-frow:hover{border-color:#DDD;background:#F5F5F5}',
    '#__mc__ .__mc-frow-active{border-color:#1A1A1A!important;background:#F5F5F5!important;border-width:2px}',
    '#__mc__ .__mc-frow-icon{color:#BBB;flex-shrink:0}',
    '#__mc__ .__mc-frow-name{flex:1;font-size:12px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}',
    '#__mc__ .__mc-fbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;cursor:pointer;transition:all .15s;border:none;flex-shrink:0;padding:0}',
    '#__mc__ .__mc-fbtn-ghost{background:#fff;color:#BBB;border:1px solid #EFEFEF}',
    '#__mc__ .__mc-fbtn-ghost:hover{background:#F5F5F5;color:#555;border-color:#DDD}',
    '#__mc__ .__mc-fbtn-dark{background:#1A1A1A;color:#fff;border:1px solid #1A1A1A}',
    '#__mc__ .__mc-fbtn-dark:hover{background:#333}',
    '#__mc__ .__mc-manual{margin-top:10px;padding-top:10px;border-top:1px solid #F5F5F5}',
    '#__mc__ .__mc-manual-label{font-size:11px;color:#BBB;display:block;margin-bottom:5px;font-weight:500}',
    '#__mc__ .__mc-manual input[type=file]{width:100%;font-size:11px;color:#888;cursor:pointer;padding:0}',
    '#__mc__ .__mc-st{display:flex;align-items:center;gap:6px;font-size:11px;margin-top:10px;min-height:16px;color:#CCC;font-weight:500}',
    '#__mc__ .__mc-st-ok{color:#16A34A}#__mc__ .__mc-st-e{color:#DC2626}#__mc__ .__mc-st-i{color:#3B82F6}',
    '#__mc__ .__mc-st-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0;display:inline-block}',
    // Tabs
    '#__mc__ .__mc-tabbar{display:flex;background:#fff;border-bottom:1px solid #EFEFEF;flex-shrink:0}',
    '#__mc__ .__mc-tab{flex:1;padding:9px 0;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:#AAA;cursor:pointer;border-bottom:2px solid transparent;transition:all .15s}',
    '#__mc__ .__mc-tab-a{color:#1A1A1A;border-bottom-color:#1A1A1A}',
    '#__mc__ .__mc-tab:hover:not(.__mc-tab-a){color:#666}',
    // Body scrollable area
    '#__mc__ #__mcbody__{flex:1;overflow-y:auto}',
    '#__mc__ #__mcbody__::-webkit-scrollbar{width:4px}',
    '#__mc__ #__mcbody__::-webkit-scrollbar-thumb{background:#E0E0E0;border-radius:2px}',
    '#__mc__ .__mc-view{padding:18px}',
    // Loader / placeholder
    '#__mc__ .__mc-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:48px 20px;color:#AAA;font-size:12px}',
    '#__mc__ .__mc-spinner{width:28px;height:28px;border:2.5px solid #EEE;border-top-color:#1A1A1A;border-radius:50%;animation:__mcspin .6s linear infinite}',
    '@keyframes __mcspin{to{transform:rotate(360deg)}}',
    '#__mc__ .__mc-placeholder{padding:48px 20px;text-align:center;color:#CCC;font-size:12px}',
    '#__mc__ .__mc-empty{padding:40px 20px;text-align:center}',
    '#__mc__ .__mc-empty p{color:#AAA;font-size:13px;margin:0 0 4px 0!important;font-weight:500}',
    '#__mc__ .__mc-empty small{font-size:11px;color:#CCC}',
    // Sections results
    '#__mc__ .__mc-summary{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}',
    '#__mc__ .__mc-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;font-size:12px;font-weight:500;line-height:1}',
    '#__mc__ .__mc-chip b{font-weight:700}',
    '#__mc__ .__mc-chip-ok{background:#F0FDF4;color:#16A34A;border:1px solid #BBF7D0}',
    '#__mc__ .__mc-chip-err{background:#FEF2F2;color:#DC2626;border:1px solid #FECACA}',
    '#__mc__ .__mc-chip-warn{background:#FFFBEB;color:#D97706;border:1px solid #FED7AA}',
    '#__mc__ .__mc-section-label{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin:18px 0 8px;padding-bottom:6px;border-bottom:1px solid #F0F0F0}',
    '#__mc__ .__mc-label-ok{color:#16A34A}#__mc__ .__mc-label-err{color:#DC2626}#__mc__ .__mc-label-warn{color:#D97706}',
    '#__mc__ .__mc-rcard{padding:11px 12px;border:1px solid #F0F0F0;border-radius:10px;margin-bottom:6px;background:#fff;opacity:0;transform:translateY(8px);animation:__mcin .3s ease forwards}',
    '@keyframes __mcin{to{opacity:1;transform:translateY(0)}}',
    '#__mc__ .__mc-rcard-ok{border-left:3px solid #86EFAC}',
    '#__mc__ .__mc-rcard-warn{border-left:3px solid #FCD34D;background:#FFFBF0}',
    '#__mc__ .__mc-rcard-err{border-left:3px solid #FCA5A5;background:#FFF5F5}',
    '#__mc__ .__mc-rcard-top{display:flex;align-items:flex-start;gap:8px}',
    '#__mc__ .__mc-rcard-title{font-size:12px;color:#1A1A1A;line-height:1.4;flex:1;font-weight:500}',
    '#__mc__ .__mc-rcard-sub{font-size:11px;color:#999;margin-top:5px;line-height:1.4;padding-left:42px}',
    '#__mc__ .__mc-pct{flex-shrink:0;min-width:34px;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:700;text-align:center;line-height:1.4}',
    '#__mc__ .__mc-pct-ok{background:#F0FDF4;color:#16A34A}',
    '#__mc__ .__mc-pct-warn{background:#FFFBEB;color:#D97706}',
    '#__mc__ .__mc-pct-err{background:#FEF2F2;color:#DC2626}',
    // Hours table
    '#__mc__ .__mc-htbl{border:1px solid #EFEFEF;border-radius:10px;overflow:hidden;font-size:12px}',
    '#__mc__ .__mc-htr{display:flex;border-bottom:1px solid #F0F0F0}',
    '#__mc__ .__mc-htr:last-child{border-bottom:none}',
    '#__mc__ .__mc-htr-h{background:#F8F8F8}',
    '#__mc__ .__mc-htd{padding:9px 10px;line-height:1.3}',
    '#__mc__ .__mc-htd-l{flex:2;font-weight:500;color:#1A1A1A}',
    '#__mc__ .__mc-htd-c{flex:1;text-align:center;color:#444;border-left:1px solid #F0F0F0}',
    '#__mc__ .__mc-htd-tot{font-weight:700;background:#F5F5F5;color:#1A1A1A}',
    '#__mc__ .__mc-htd-sub{font-size:10px;color:#AAA;font-weight:400;margin-top:2px}',
    '#__mc__ .__mc-hrs-note{font-size:10px;color:#CCC;margin-top:8px!important;text-align:right}',
    '@media (prefers-reduced-motion:reduce){#__mc__ .__mc-rcard{animation:none;opacity:1;transform:none}#__mc__ .__mc-spinner{animation:none}}'
  ].join('');
  document.head.appendChild(s);
}

function buildUI(){
  var old=document.getElementById('__mc__');if(old)old.remove();
  injectStyles();
  var moodle=getMoodle();
  var quizzes=getMoodleQuizzes();

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

  var quizHtml='';
  if(quizzes.length){
    quizzes.forEach(function(q,i){
      quizHtml+='<div class="__mc-msec"><div class="__mc-msec-num">'+(i+1)+'</div>'
        +'<div class="__mc-msec-text">'+esc(q.name)+'</div></div>';
    });
  } else {
    quizHtml='<div style="color:#CCC;font-size:11px;padding:4px 0">Тестов не найдено</div>';
  }

  var d=document.createElement('div');d.id='__mc__';
  d.innerHTML=
    '<div class="__mc-hdr">'
      +'<div class="__mc-hdr-left">'
        +'<div class="__mc-hdr-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>'
        +'<div class="__mc-hdr-text"><div class="__mc-hdr-title">Проверка разделов</div><div class="__mc-hdr-sub">Программа vs Moodle</div></div>'
      +'</div>'
      +'<button class="__mc-close" onclick="document.getElementById(\'__mc__\').remove()">✕</button>'
    +'</div>'
    // Разделы Moodle
    +'<div class="__mc-mbox">'
      +'<div class="__mc-mbox-head"><span class="__mc-mbox-label">Разделы в Moodle</span><span class="__mc-mcount">'+(moodle.length||0)+'</span></div>'
      +moodleHtml
    +'</div>'
    // Тесты (сворачивается)
    +'<div class="__mc-qbox">'
      +'<div class="__mc-qbox-head" onclick="window.__mcQToggle__()">'
        +'<span class="__mc-mbox-label">Тесты в курсе</span>'
        +'<span class="__mc-mcount">'+(quizzes.length||0)+'</span>'
        +'<span class="__mc-qarrow" id="__mcqarr__">▸</span>'
      +'</div>'
      +'<div class="__mc-qlist" id="__mcqlist__" style="display:none">'+quizHtml+'</div>'
    +'</div>'
    // Файлы (сворачивается)
    +'<div class="__mc-files">'
      +'<div class="__mc-files-head" onclick="window.__mcFilesToggle__()">'
        +'<span class="__mc-mbox-label">Рабочие программы</span>'
        +'<span class="__mc-qarrow" id="__mcfarr__">▾</span>'
      +'</div>'
      +'<div id="__mc-files-body__">'
        +'<div id="__mclist__"><p class="__mc-hint">🔍 Ищу рабочие программы…</p></div>'
        +'<div class="__mc-manual"><label class="__mc-manual-label">Или загрузите PDF вручную:</label>'
        +'<input type="file" id="__mcfile__" accept=".pdf"></div>'
      +'</div>'
      +'<div class="__mc-st" id="__mcst__"></div>'
    +'</div>'
    // Табы + тело
    +'<div class="__mc-tabbar">'
      +'<button class="__mc-tab __mc-tab-a" data-view="sections" onclick="window.__mcTab__(\'sections\')">Разделы</button>'
      +'<button class="__mc-tab" data-view="hours" onclick="window.__mcTab__(\'hours\')">Часы</button>'
    +'</div>'
    +'<div id="__mcbody__">'
      +'<div id="__mc-vsec__" class="__mc-view"><div class="__mc-placeholder">Результаты появятся здесь</div></div>'
      +'<div id="__mc-vhrs__" class="__mc-view" style="display:none"><div class="__mc-placeholder">Выберите PDF для анализа</div></div>'
    +'</div>';

  document.body.appendChild(d);
  statusEl=document.getElementById('__mcst__');
  bodyEl=document.getElementById('__mc-vsec__');
  hoursEl=document.getElementById('__mc-vhrs__');

  window.__mcTab__=function(view){
    document.querySelectorAll('#__mc__ .__mc-tab').forEach(function(t){
      t.classList.toggle('__mc-tab-a',t.dataset.view===view);
    });
    document.getElementById('__mc-vsec__').style.display=view==='sections'?'':'none';
    document.getElementById('__mc-vhrs__').style.display=view==='hours'?'':'none';
  };

  window.__mcQToggle__=function(){
    var list=document.getElementById('__mcqlist__');
    var arr=document.getElementById('__mcqarr__');
    var open=list.style.display==='none';
    list.style.display=open?'':'none';
    arr.textContent=open?'▾':'▸';
    arr.style.transform=open?'rotate(0deg)':'';
  };

  window.__mcFilesToggle__=function(){
    var body=document.getElementById('__mc-files-body__');
    var arr=document.getElementById('__mcfarr__');
    var open=body.style.display!=='none';
    body.style.display=open?'none':'';
    arr.textContent=open?'▸':'▾';
  };

  document.getElementById('__mcfile__').onchange=function(e){
    var f=e.target.files[0];if(!f)return;
    setStatus('Загружаю PDF.js…','i');setBody('loading');
    var fr=new FileReader();
    fr.onload=function(ev){
      loadPdfJs(function(err){
        if(err){setStatus(err.message,'e');setBody('');return;}
        setStatus('Читаю текст…','i');
        readPdf(ev.target.result,function(txt){
          renderResults(compare(txt,getMoodle()));
          renderHours(parseHours(txt));
          setStatus('Готово','ok');
        },function(e){setStatus('Ошибка: '+(e&&e.message||e),'e');setBody('');});
      });
    };
    fr.readAsArrayBuffer(f);
  };

  setStatus('Ищу программы…','i');
  findAllPdfs(function(pdfs){
    showList(pdfs,moodle);
    if(pdfs.length) setStatus('Найдено: '+pdfs.length,'ok');
    else setStatus('Программы не найдены автоматически','');
  });
}

buildUI();

})();
