(function () {
  function create(root, send) {
    let selection = [], touchMode = false, range = null, press = null, timer = null, dragging = null;
    const overlay = document.createElement('div');
    overlay.className = 'reader-selection-overlay';
    const handles = ['start', 'end'].map(edge => {
      const handle = document.createElement('button');
      handle.className = 'reader-selection-handle reader-selection-' + edge;
      handle.setAttribute('aria-label', edge === 'start' ? '拖动选择起点' : '拖动选择终点');
      handle.hidden = true;
      handle.addEventListener('pointerdown', event => {
        event.preventDefault(); event.stopPropagation();
        dragging = edge; tools.hidden = true;handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener('pointermove', event => {
        if (dragging !== edge || !range) return;
        event.preventDefault();
        const point = caret(event.clientX, event.clientY, edge);
        if (!point) return;
        const next = range.cloneRange();
        const boundary = range.cloneRange();
        if (edge === 'start') {
          boundary.collapse(false);
          if (point.compareBoundaryPoints(Range.START_TO_START, boundary) >= 0) return;
          next.setStart(point.startContainer, point.startOffset);
        } else {
          boundary.collapse(true);
          if (point.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0) return;
          next.setEnd(point.startContainer, point.startOffset);
        }
        if (!next.collapsed) { range = next; showRange(); }
      });
      handle.addEventListener('pointerup', () => { dragging = null;showRange(); });
      handle.addEventListener('pointercancel', clearSelection);
      handle.addEventListener('lostpointercapture', () => { if(dragging)clearSelection(); });
      root.appendChild(handle);
      return handle;
    });
    const tools = document.createElement('div');
    tools.className = 'reader-selection-tools';
    tools.setAttribute('role', 'toolbar');tools.setAttribute('aria-label', '选文操作');
    tools.hidden = true;
    for (const [action, label] of [['copy', '复制'], ['highlight', '划线'], ['note', '笔记'], ['comment', '评论']]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('pointerdown', e => e.preventDefault());
      button.addEventListener('click', () => {
        if (!selection.length) return;
        const captured = selection.map(item => ({...item}));
        clearSelection();
        send({action, selections: captured});
      });
      tools.appendChild(button);
    }
    root.append(overlay, tools);
    function cancelPress() { clearTimeout(timer); timer = null; press = null; }
    function clearSelection() {
      cancelPress(); range = null; selection = []; dragging = null;
      tools.hidden = true; overlay.replaceChildren();
      handles.forEach(handle => { handle.hidden = true; });
      const native = window.getSelection();
      // A hidden or detached reader must not clear another reader's selection.
      if (native?.rangeCount && (root.contains(native.anchorNode) || root.contains(native.focusNode))) native.removeAllRanges();
    }
    function offset(block, node, at) {
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(node, at);
      return prefix.toString().length;
    }
    function showRange() {
      const r = range;
      if (!r || !root.contains(r.startContainer) || !root.contains(r.endContainer)) { clearSelection(); return; }
      selection = [];
      for (const block of root.querySelectorAll('[data-reader-block]')) {
        if (!r.intersectsNode(block)) continue;
        const start = block.contains(r.startContainer) ? offset(block, r.startContainer, r.startOffset) : 0;
        const end = block.contains(r.endContainer) ? offset(block, r.endContainer, r.endOffset) : block.textContent.length;
        if (end > start) selection.push({blockId: block.dataset.readerBlock, rangeStart: start, rangeEnd: end, quote: block.textContent.slice(start, end)});
      }
      if (!selection.length) { clearSelection(); return; }
      tools.hidden = false;
      const rects = Array.from(r.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      const rect = rects[0], last = rects[rects.length - 1], base = root.getBoundingClientRect();
      if (!rect || !last) { clearSelection(); return; }
      const viewportTop=window.visualViewport?.offsetTop||0,viewportBottom=viewportTop+(window.visualViewport?.height||window.innerHeight);
      const top = rect.top-viewportTop >= 50 ? rect.top - base.top - 50 : Math.min(last.bottom + 28,viewportBottom-tools.offsetHeight-8)-base.top;
      tools.style.top = Math.max(0, Math.min(root.offsetHeight - tools.offsetHeight, top)) + 'px';
      tools.style.left = Math.max(0, Math.min(root.clientWidth - tools.offsetWidth, rect.left - base.left)) + 'px';
      if (touchMode) {
        overlay.replaceChildren();
        for (const rect of rects) {
          const highlight = document.createElement('span');
          Object.assign(highlight.style, {left: rect.left - base.left + 'px', top: rect.top - base.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
          overlay.appendChild(highlight);
        }
        for (const [index, handle] of handles.entries()) {
          const at = index === 0 ? rect : last;
          handle.hidden = false;
          handle.style.left = (index === 0 ? at.left : at.right) - base.left - 22 + 'px';
          handle.style.top = at.bottom - base.top - 4 + 'px';
        }
      }
      tools.hidden=!!dragging;
    }
    function selected() {
      if (touchMode) return;
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { clearSelection(); return; }
      range = s.getRangeAt(0).cloneRange(); showRange();
    }
    function caret(x, y, edge) {
      if(dragging)handles.forEach(handle=>{handle.style.visibility='hidden';});
      let point = document.caretRangeFromPoint?.(x, y);
      if (!point && document.caretPositionFromPoint) {
        const at = document.caretPositionFromPoint(x, y);
        if (at) { point = document.createRange(); point.setStart(at.offsetNode, at.offset); point.collapse(true); }
      }
      if(dragging)handles.forEach(handle=>{handle.style.visibility='';});
      const block = point?.startContainer.parentElement?.closest('[data-reader-block]');
      if(!block||!root.contains(block))return null;
      // WebView caret APIs can land between the two code units of an emoji.
      const at=offset(block,point.startContainer,point.startOffset);
      if(/[\uDC00-\uDFFF]/.test(block.textContent[at]||'')){
        const safe=textPoint(block,at+(edge==='end'?1:-1));
        if(!safe)return null;point.setStart(safe.node,safe.at);point.collapse(true);
      }
      return point;
    }
    function textPoint(block, at) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node, last;
      while ((node = walker.nextNode())) {
        last = node;
        if (at <= node.length) return {node, at};
        at -= node.length;
      }
      return last ? {node: last, at: last.length} : null;
    }
    function longPress(x, y) {
      const point = caret(x, y); if (!point) return;
      const block = point.startContainer.parentElement.closest('[data-reader-block]');
      const text = block.textContent, at = Math.min(offset(block, point.startContainer, point.startOffset), text.length - 1);
      // Select a short phrase first; the two handles can extend it across paragraphs.
      let start = at, end = at + 1;
      const latin = /[a-zA-Z0-9]/.test(text[at]);
      const boundary = latin ? /[^a-zA-Z0-9]/ : /[\s，。！？；、：,.!?;]/;
      while (start > 0 && at - start < 10 && !boundary.test(text[start - 1])) start--;
      while (end < text.length && end - at < 10 && !boundary.test(text[end])) end++;
      if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--;
      if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
      const from = textPoint(block, start), to = textPoint(block, end);
      if (!from || !to) return;
      range = document.createRange(); range.setStart(from.node, from.at); range.setEnd(to.node, to.at);
      showRange();
    }
    function pointerDown(event) {
      if(event.isPrimary===false){clearSelection();return;}
      if (!touchMode || event.button !== 0 || event.target.closest('.reader-selection-tools,.reader-selection-handle')) return;
      clearSelection();
      if (!event.target.closest('[data-reader-block]')) return;
      press = {x: event.clientX, y: event.clientY, id: event.pointerId};
      timer = setTimeout(() => { if (press) longPress(press.x, press.y); timer = null; }, 420);
    }
    function pointerMove(event) {
      if (press?.id === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelPress();
    }
    function contextMenu(event) { if ((touchMode || selection.length)&&event.target.closest('[data-reader-block],.reader-selection-tools,.reader-selection-handle')) event.preventDefault(); }
    function outside(event){if(!root.contains(event.target))clearSelection();}
    function viewportChanged(){if(dragging)showRange();else clearSelection();}
    function escape(event){if(event.key==='Escape')clearSelection();}
    function hidden(){if(document.hidden){clearSelection();pauseMedia();}}
    document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',clearSelection);
    document.addEventListener('selectionchange', selected);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    root.addEventListener('pointerdown', pointerDown);
    root.addEventListener('pointermove', pointerMove);
    root.addEventListener('pointerup', cancelPress);
    root.addEventListener('pointercancel', cancelPress);
    root.addEventListener('contextmenu', contextMenu);
    window.addEventListener('scroll', viewportChanged, {passive: true,capture:true});
    window.addEventListener('resize',viewportChanged);window.visualViewport?.addEventListener('resize',viewportChanged);
    const mediaEntries = new Map();
    let mediaRequest = 0;
    function pauseMedia() { for (const entry of mediaEntries.values()) { entry.player.pause(); clearTimeout(entry.timer); entry.requestId=++mediaRequest; entry.busy=false; entry.initial=false; entry.button.disabled=false; entry.button.textContent=entry.type==='video'?'播放视频':'播放音频'; } }
    function requestMedia(entry) {
      if (entry.busy) return;
      entry.busy = true; entry.requestId = ++mediaRequest;
      entry.button.disabled = true; entry.button.textContent = '正在获取播放权限…'; entry.status.hidden = true;
      send({action:'media', blockId:entry.id, requestId:entry.requestId});
    }
    function mediaResult(result) {
      const entry = mediaEntries.get(result.blockId);
      if (!entry || entry.requestId !== result.requestId) return;
      entry.busy = false; entry.button.disabled = false;
      if (result.error || !/^https?:\/\//.test(result.url || '')) {
        entry.player.pause(); entry.player.removeAttribute('src'); entry.player.load(); entry.player.hidden = true;
        entry.status.hidden = false; entry.status.textContent = result.error || '音视频暂时无法播放，可继续阅读原文。';
        entry.button.hidden = false; entry.button.textContent = '重试播放'; return;
      }
      const position = entry.player.currentTime || 0, rate = entry.player.playbackRate, playing = !entry.player.paused || entry.initial;
      entry.initial = false; entry.expiresAt = Date.parse(result.expiresAt);
      entry.player.onloadedmetadata = () => { entry.player.currentTime = Math.min(position, entry.player.duration || position); entry.player.playbackRate = rate; if (playing) entry.player.play().catch(()=>{}); };
      entry.player.src = result.url; entry.player.hidden = false; entry.button.hidden = true;
      scheduleRefresh(entry);
    }
    function scheduleRefresh(entry) {
      clearTimeout(entry.timer);
      if (!entry.player.paused && Number.isFinite(entry.expiresAt)) entry.timer = setTimeout(() => requestMedia(entry), Math.max(1000, entry.expiresAt - Date.now() - 30000));
    }
    function mediaFigure(block) {
      let entry = mediaEntries.get(block.id);
      if (entry && entry.mediaId === block.mediaId && entry.type === block.type) {
        let caption=entry.figure.querySelector('figcaption');
        if(block.caption){if(!caption){caption=document.createElement('figcaption');entry.figure.appendChild(caption);}caption.textContent=block.caption;}else caption?.remove();
        return entry.figure;
      }
      if (entry) { entry.player.pause(); clearTimeout(entry.timer); }
      const figure = document.createElement('figure'), player = document.createElement(block.type), button = document.createElement('button'), status = document.createElement('p');
      status.className = 'reader-media-status'; status.hidden = true; status.setAttribute('role','status');
      figure.className = 'reader-media'; player.controls = true; player.preload = 'metadata'; player.hidden = true;
      player.setAttribute('playsinline', ''); player.setAttribute('aria-label', block.caption || (block.type === 'video' ? '文章视频' : '文章音频'));
      button.className = 'reader-media-load'; button.textContent = block.type === 'video' ? '播放视频' : '播放音频';
      entry = { id:block.id, mediaId:block.mediaId, type:block.type, figure, player, button, status, initial:true };
      mediaEntries.set(block.id, entry);
      button.onclick = () => { entry.initial = true; requestMedia(entry); };
      player.onplay = () => {
        for (const other of mediaEntries.values()) if (other !== entry) other.player.pause();
        if (entry.expiresAt <= Date.now() + 30000) requestMedia(entry); else scheduleRefresh(entry);
      };
      player.onpause = () => clearTimeout(entry.timer);
      player.onerror = () => { clearTimeout(entry.timer); status.hidden = false; status.textContent = '音视频暂时无法播放，可继续阅读原文。'; button.hidden = false; button.textContent = '重试播放'; };
      figure.append(player, status, button);
      if (block.caption) { const caption = document.createElement('figcaption'); caption.textContent = block.caption; figure.appendChild(caption); }
      return figure;
    }
    function render(payload) {
      clearSelection(); touchMode = payload.selectionMode === 'touch';
      for (const code of ['PLAIN','CLASSIC','INK']) root.classList.toggle('reader-template-'+code.toLowerCase(), payload.templateCode === code);
      root.classList.toggle('reader-touch-selection', touchMode);
      const active = new Set(payload.blocks.filter(b=>['audio','video'].includes(b.type)).map(b=>b.id));
      for (const [id, entry] of mediaEntries) if (!active.has(id)) { entry.player.pause(); clearTimeout(entry.timer); mediaEntries.delete(id); }
      for (const child of Array.from(root.children)) if (child !== tools && child !== overlay && !handles.includes(child) && !child.classList.contains('reader-media')) child.remove();
      root.style.fontSize = payload.fontSize + 'px';
      for (const child of root.querySelectorAll('.reader-media')) {
        if (![...mediaEntries.values()].some(entry=>entry.figure===child)) child.remove();
      }
      let position = root.firstChild;
      function insert(node) { if (node !== position) root.insertBefore(node, position); position = node.nextSibling; }
      for (const block of payload.blocks) {
        if (block.type === 'audio' || block.type === 'video') { const figure=mediaFigure(block); insert(figure); continue; }
        if (block.type === 'image') {
          const figure = document.createElement('figure'), image = document.createElement('img');
          if (/^(https?:\/\/|\/static\/)/.test(block.url || '')) image.src = block.url;
          image.alt = block.caption || '文章配图';
          image.addEventListener('click', () => send({action:'image', url:block.url}));
          figure.appendChild(image);
          if (block.caption) { const caption = document.createElement('figcaption'); caption.textContent = block.caption; figure.appendChild(caption); }
          insert(figure);
          continue;
        }
        const paragraph = document.createElement('p');
        paragraph.className = block.type === 'quote' ? 'reader-quote' : 'reader-paragraph';
        paragraph.dataset.readerBlock = block.id;
        const ranges = (payload.annotations || []).flatMap(note => note.ranges?.length ? note.ranges : [note]).filter(r => r.blockId === block.id && r.rangeStart >= 0 && r.rangeEnd <= block.text.length).sort((a,b) => a.rangeStart-b.rangeStart);
        let at = 0;
        for (const range of ranges) {
          if (range.rangeEnd <= at) continue;
          if (range.rangeStart > at) paragraph.appendChild(document.createTextNode(block.text.slice(at, range.rangeStart)));
          const mark = document.createElement('mark');
          mark.textContent = block.text.slice(Math.max(at, range.rangeStart), range.rangeEnd);
          paragraph.appendChild(mark); at = range.rangeEnd;
        }
        paragraph.appendChild(document.createTextNode(block.text.slice(at)));
        insert(paragraph);
      }
      for (const child of root.querySelectorAll('.reader-media')) if (![...mediaEntries.values()].some(entry=>entry.figure===child)) child.remove();
    }
    return {render, mediaResult, pauseMedia, clearSelection, destroy(){
      pauseMedia(); mediaEntries.clear();
      clearSelection(); document.removeEventListener('selectionchange', selected);
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',clearSelection);
      document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);
      root.removeEventListener('pointerdown', pointerDown); root.removeEventListener('pointermove', pointerMove);
      root.removeEventListener('pointerup', cancelPress); root.removeEventListener('pointercancel', cancelPress);
      root.removeEventListener('contextmenu', contextMenu); window.removeEventListener('scroll', viewportChanged,true);
      window.removeEventListener('resize',viewportChanged);window.visualViewport?.removeEventListener('resize',viewportChanged);
      root.replaceChildren();
    }};
  }
  globalThis.AcademyReader = {create};
})();
