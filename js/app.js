(() => {
  'use strict';

  const PACKS = window.QUIZ_PACKS || [];
  const SAVE_KEY = 'divan-quiz:game:v1';
  const PREFS_KEY = 'divan-quiz:prefs:v1';
  const COLORS = ['#ffd23f', '#ff4f81', '#2ee6b6', '#6cb2ff'];
  const MAX_TEAMS = 4;
  const TEAM_NAMES = ['Котики', 'Ёжики', 'Совы', 'Еноты'];
  const LETTERS = 'АБВГДЕЖЗ';
  const app = document.getElementById('app');

  // ---------- utils ----------

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtText = s => esc(s).replace(/\n/g, '<br>');
  const fmtTime = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtPts = n => { const v = Math.round(n * 10) / 10; return String(v).replace('.', ',').replace('-', '−'); };
  const joinAnd = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}` : items.join(''));
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtPts(Math.abs(n));
  const plural = (n, one, few, many) => {
    if (!Number.isInteger(n)) return few;
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b > 1 && b < 5) return few;
    return many;
  };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- sound ----------

  const Sound = {
    ctx: null,
    enabled: true,
    ensure() {
      if (!this.ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (C) this.ctx = new C();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, { type = 'sine', vol = 0.12, delay = 0 } = {}) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    },
    tick() { this.tone(1250, 0.05, { type: 'square', vol: 0.035 }); },
    timeUp() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.15, delay: i * 0.17 })); },
    good() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', vol: 0.1, delay: i * 0.07 })); },
    bad() { this.tone(170, 0.22, { type: 'sawtooth', vol: 0.045 }); },
    whoosh() { this.tone(620, 0.12, { vol: 0.05 }); this.tone(930, 0.14, { vol: 0.035, delay: 0.05 }); },
    fanfare() {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
        this.tone(f, i === 5 ? 0.7 : 0.17, { type: 'triangle', vol: 0.12, delay: i * 0.14 }));
    },
  };

  // ---------- timer ----------

  const AUTO_NEXT_DELAY = 1600;

  const Timer = {
    total: 0, left: 0, running: false, done: false, handle: null, last: 0, onDone: null, doneHandle: null,
    setup(seconds, onDone) {
      this.stop();
      this.total = seconds;
      this.left = seconds;
      this.done = false;
      this.onDone = onDone || null;
      this.render();
    },
    start() {
      if (!this.total || this.running || this.left <= 0) return;
      this.running = true;
      this.last = performance.now();
      this.handle = setInterval(() => this.step(), 100);
      this.render();
    },
    pause() {
      this.running = false;
      clearInterval(this.handle);
      this.handle = null;
      this.render();
    },
    // сбрасывает и время: иначе T/пробел на экране без таймера запускали бы невидимый таймер со звуками
    stop() {
      this.running = false;
      clearInterval(this.handle);
      clearTimeout(this.doneHandle);
      this.handle = null;
      this.doneHandle = null;
      this.onDone = null;
      this.total = 0;
      this.left = 0;
      this.done = false;
    },
    // время вышло — ждём автоперехода, второй круг таймера не запускаем
    toggle() {
      if (!this.total || this.done) return;
      this.running ? this.pause() : this.start();
    },
    step() {
      const now = performance.now();
      const prev = Math.ceil(this.left);
      this.left = Math.max(0, this.left - (now - this.last) / 1000);
      this.last = now;
      const cur = Math.ceil(this.left);
      if (cur !== prev && cur <= 5 && cur > 0) Sound.tick();
      if (this.left <= 0) {
        this.pause();
        this.done = true;
        Sound.timeUp();
        if (this.onDone) {
          const fn = this.onDone;
          this.doneHandle = setTimeout(fn, AUTO_NEXT_DELAY);
        }
      }
      this.render();
    },
    render() {
      const el = app.querySelector('[data-timer]');
      if (!el) return;
      el.querySelector('i').style.transform = `scaleX(${this.total ? this.left / this.total : 0})`;
      el.querySelector('.timer-num').textContent = this.done ? (this.onDone ? 'Время! Дальше…' : 'Время!') : Math.ceil(this.left);
      el.classList.toggle('is-running', this.running);
      el.classList.toggle('is-low', this.left <= 5 && this.left > 0);
      el.classList.toggle('is-done', this.done);
      el.title = this.running ? 'Пауза таймера (T)' : 'Запустить таймер (T)';
    },
  };

  // ---------- media ----------

  let ytApi = null;
  function loadYouTubeApi() {
    if (ytApi) return ytApi;
    ytApi = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => reject(new Error('api'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('timeout')), 20000);
    }).catch(err => { ytApi = null; throw err; });
    return ytApi;
  }

  const CLIP_ERRORS = {
    2: 'неверный ID видео',
    5: 'ошибка плеера',
    100: 'видео удалено или приватное',
    101: 'владелец запретил показ на других сайтах',
    150: 'владелец запретил показ на других сайтах',
    153: 'страница открыта не через сервер — запустите start.command',
    api: 'не загрузился YouTube (нет интернета или нужен VPN?)',
    file: 'файл не найден',
  };

  class Clip {
    constructor(host, media, { mode = 'audio', onEnded, onPlay } = {}) {
      this.media = media;
      this.mode = mode;
      this.onEnded = onEnded;
      this.onPlay = onPlay;
      this.start = media.start || 0;
      this.end = media.end || this.start + 15;
      this.state = 'loading';
      this.ready = false;
      this.pendingPlay = false;
      this.destroyed = false;
      host.innerHTML = `
        <div class="clip clip--${mode}" data-state="loading">
          <div class="clip-screen">
            <div class="clip-frame" data-frame></div>
            <div class="clip-shield" data-act="clip-toggle"></div>
            <div class="clip-mask-top"></div>
            <div class="clip-curtain">
              <div class="clip-eq" aria-hidden="true">${'<i></i>'.repeat(11)}</div>
              <div class="clip-msg" data-msg></div>
            </div>
          </div>
          <div class="clip-bar">
            <button class="btn btn--play" data-act="clip-toggle"></button>
            <button class="btn btn--icon" data-act="clip-replay" title="С начала (R)">↺</button>
            <div class="clip-progress"><i data-progress></i></div>
            <span class="clip-time" data-time>0:00 / ${fmtTime(this.end - this.start)}</span>
          </div>
        </div>`;
      this.root = host.firstElementChild;
      this.frame = this.root.querySelector('[data-frame]');
      this.msg = this.root.querySelector('[data-msg]');
      this.playBtn = this.root.querySelector('.btn--play');
      this.progress = this.root.querySelector('[data-progress]');
      this.timeEl = this.root.querySelector('[data-time]');
      this.renderUI();
      this.init();
    }
    setState(s) {
      this.state = s;
      this.root.dataset.state = s;
      this.renderUI();
      if (s === 'playing' && this.onPlay) this.onPlay();
    }
    renderUI() {
      const labels = {
        loading: this.mode === 'audio' ? '▶ Слушать' : '▶ Смотреть',
        ready: this.mode === 'audio' ? '▶ Слушать' : '▶ Смотреть',
        playing: '❚❚ Пауза',
        paused: '▶ Дальше',
        ended: '↺ Ещё раз',
        error: 'Недоступно',
      };
      this.playBtn.textContent = labels[this.state];
      this.playBtn.disabled = this.state === 'error';
      const msgs = {
        loading: this.pendingPlay ? 'Загружаю…' : 'Готовлю фрагмент…',
        ready: this.mode === 'audio' ? 'Нажмите «Слушать» или пробел' : 'Нажмите «Смотреть» или пробел',
        playing: this.mode === 'audio' ? 'Слушаем' : '',
        paused: 'Пауза',
        ended: 'Фрагмент закончился',
      };
      if (this.state !== 'error') this.msg.textContent = msgs[this.state];
    }
    toggle() { this.state === 'playing' ? this.pause() : this.play(); }
    loop() {
      cancelAnimationFrame(this.raf);
      const step = () => {
        if (this.destroyed || this.state !== 'playing') return;
        const t = this.time();
        this.paint(t);
        if (t >= this.end - 0.05) return this.finish();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
    paint(t) {
      const span = this.end - this.start;
      const pos = Math.min(span, Math.max(0, t - this.start));
      this.progress.style.transform = `scaleX(${pos / span})`;
      this.timeEl.textContent = `${fmtTime(pos)} / ${fmtTime(span)}`;
    }
    finish() {
      cancelAnimationFrame(this.raf);
      this.pause();
      this.paint(this.end);
      this.setState('ended');
      if (this.onEnded) this.onEnded();
    }
    fail(code) {
      if (this.destroyed) return;
      cancelAnimationFrame(this.raf);
      this.setState('error');
      const link = this.media.kind === 'yt'
        ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(this.media.id)}&t=${Math.floor(this.start)}s" target="_blank" rel="noopener">Открыть на YouTube ↗</a><small>(с ${fmtTime(this.start)} до ${fmtTime(this.end)}; название во вкладке спойлерит)</small>`
        : '';
      this.msg.innerHTML = `<b>Не играет: ${esc(CLIP_ERRORS[code] || code)}</b>${link}<small>Можно пропустить вопрос стрелкой →</small>`;
    }
  }

  class YTClip extends Clip {
    init() {
      const id = 'yt-' + Math.random().toString(36).slice(2);
      this.frame.innerHTML = `<div id="${id}"></div>`;
      loadYouTubeApi().then(YT => {
        if (this.destroyed) return;
        this.player = new YT.Player(id, {
          videoId: this.media.id,
          width: '100%',
          height: '100%',
          playerVars: {
            start: Math.floor(this.start),
            controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3,
            playsinline: 1, modestbranding: 1, cc_load_policy: 0,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              if (this.destroyed) return;
              this.ready = true;
              this.setState('ready');
              if (this.pendingPlay) this.play();
            },
            onStateChange: e => this.onYTState(e.data),
            onError: e => this.fail(e.data),
          },
        });
      }).catch(() => this.fail('api'));
    }
    onYTState(s) {
      if (this.destroyed || this.state === 'error') return;
      if (s === 1 && this.state !== 'playing') {
        // титры не нужны: могут проспойлерить
        try { this.player.unloadModule('captions'); } catch { /* ignore */ }
        this.setState('playing');
        this.loop();
      } else if (s === 2 && this.state === 'playing') {
        this.setState('paused');
      } else if (s === 0 && this.state === 'playing') {
        this.finish();
      }
    }
    play() {
      Sound.ensure();
      if (!this.ready) { this.pendingPlay = true; this.renderUI(); return; }
      if (this.state === 'ended') return this.replay();
      this.player.playVideo();
    }
    pause() { if (this.ready) this.player.pauseVideo(); }
    replay() {
      if (!this.ready) return this.play();
      this.player.seekTo(this.start, true);
      this.player.playVideo();
    }
    time() { return (this.player && this.player.getCurrentTime && this.player.getCurrentTime()) || 0; }
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      try { if (this.player) this.player.destroy(); } catch { /* ignore */ }
    }
  }

  class FileClip extends Clip {
    init() {
      const tag = this.mode === 'audio' ? 'audio' : 'video';
      this.frame.innerHTML = `<${tag} preload="auto" playsinline src="${esc(this.media.src)}"></${tag}>`;
      this.el = this.frame.firstElementChild;
      this.el.addEventListener('loadedmetadata', () => {
        this.el.currentTime = this.start;
        this.ready = true;
        this.setState('ready');
        if (this.pendingPlay) this.play();
      }, { once: true });
      this.el.addEventListener('playing', () => { this.setState('playing'); this.loop(); });
      this.el.addEventListener('pause', () => { if (this.state === 'playing') this.setState('paused'); });
      this.el.addEventListener('ended', () => { if (this.state === 'playing') this.finish(); });
      this.el.addEventListener('error', () => this.fail('file'));
    }
    play() {
      Sound.ensure();
      if (!this.ready) { this.pendingPlay = true; this.renderUI(); return; }
      if (this.state === 'ended') return this.replay();
      this.el.play().catch(() => {});
    }
    pause() { this.el.pause(); }
    replay() {
      if (!this.ready) return this.play();
      this.el.currentTime = this.start;
      this.el.play().catch(() => {});
    }
    time() { return this.el.currentTime; }
    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    }
  }

  const Media = {
    ctrl: null,
    mount(host, media, opts) {
      this.destroy();
      this.ctrl = media.kind === 'yt' ? new YTClip(host, media, opts) : new FileClip(host, media, opts);
      return this.ctrl;
    },
    destroy() {
      if (this.ctrl) this.ctrl.destroy();
      this.ctrl = null;
    },
  };

  function mediaOf(question) {
    if (question.file) return { kind: 'file', src: question.file.src, start: question.file.start || 0, end: question.file.end };
    if (question.yt) return { kind: 'yt', id: question.yt.id, start: question.yt.start || 0, end: question.yt.end };
    return null;
  }

  // Клип ужимается под высоту окна, чтобы варианты, таймер и «Дальше» были видны без прокрутки.
  // Видео не меньше 480×270: в маленьком плеере YouTube показывает свои плашки, а они спойлерят.
  function fitClip() {
    const scr = app.querySelector('.clip-screen');
    if (!scr) return;
    scr.style.maxHeight = '';
    scr.style.maxWidth = '';
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over <= 0) return;
    const audio = !!scr.closest('.clip--audio');
    // на сверке ответ уже открыт — там клип может быть меньше
    const min = audio ? 110 : scr.closest('.clip--reveal') ? 200 : 270;
    const h = Math.max(min, Math.floor(scr.getBoundingClientRect().height - over));
    scr.style.maxHeight = `${h}px`;
    if (!audio) scr.style.maxWidth = `${Math.round(h * 16 / 9)}px`;
  }
  window.addEventListener('resize', fitClip);

  // ---------- game state ----------

  const prefs = Object.assign(
    { teams: [{ name: '', members: [] }, { name: '', members: [] }], packId: PACKS[0] && PACKS[0].id, timer: true, sound: true },
    store.get(PREFS_KEY) || {},
  );
  // старый формат: список игроков → каждый игрок = команда из одного человека
  if (Array.isArray(prefs.players)) {
    prefs.teams = prefs.players.map(n => String(n ?? ''))
      .map(n => ({ name: '', members: /^Игрок \d+$/.test(n) || !n.trim() ? [] : [n.trim()] }));
  }
  delete prefs.players;
  // битые или слишком старые настройки не должны ронять экран выбора
  prefs.teams = (Array.isArray(prefs.teams) ? prefs.teams : []).slice(0, MAX_TEAMS).map(t => ({
    name: t && typeof t.name === 'string' ? t.name : '',
    members: t && Array.isArray(t.members) ? t.members.filter(m => typeof m === 'string' && m.trim()) : [],
  }));
  if (!prefs.teams.length) prefs.teams = [{ name: '', members: [] }];
  prefs.timer = prefs.timer !== false;
  prefs.sound = prefs.sound !== false;
  Sound.enabled = prefs.sound;
  if (!PACKS.some(p => p.id === prefs.packId) && PACKS[0]) prefs.packId = PACKS[0].id;

  function teamLabel(team, i, count) {
    if (team.name.trim()) return team.name.trim();
    if (team.members.length === 1) return team.members[0];
    return count === 1 ? 'Мы' : TEAM_NAMES[i];
  }

  // «Паша, Жена» под названием команды — если это не команда из одного человека с его же именем
  function membersLine(team) {
    if (!team.members || !team.members.length) return '';
    if (team.members.length === 1 && team.members[0] === team.name) return '';
    return team.members.join(', ');
  }

  // сохранения до появления команд хранили players
  function migrateSave(saved) {
    if (saved && !saved.teams && saved.players) {
      saved.teams = saved.players.map(p => ({ name: p.name, members: [] }));
      delete saved.players;
    }
    return saved;
  }

  let game = null; // сохраняется в localStorage
  let pack = null;
  let steps = [];
  let confettiEl = null;

  function buildSteps(p) {
    const out = [];
    p.rounds.forEach((round, r) => {
      out.push({ kind: 'intro', r });
      round.questions.forEach((_, q) => {
        if (round.type === 'bets') out.push({ kind: 'bet', r, q });
        out.push({ kind: 'question', r, q });
      });
      // как в баре: ответы открываем только после всех вопросов раунда
      out.push({ kind: 'check', r });
      round.questions.forEach((_, q) => out.push({ kind: 'answer', r, q }));
      out.push({ kind: 'roundEnd', r });
    });
    out.push({ kind: 'final' });
    return out;
  }

  const key = (r, q) => `${r}.${q}`;
  const roundOf = r => pack.rounds[r];
  const questionOf = (r, q) => pack.rounds[r].questions[q];
  const pointsOf = (round, question) => question.points ?? round.points ?? 1;
  const halfOf = (round, question) => question.allowHalf ?? round.allowHalf ?? false;
  const timeOf = (round, question) => question.time ?? round.time;
  const span = (vals, unit) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return lo === hi ? `${fmtPts(lo)} ${unit(lo)}` : `${fmtPts(lo)}–${fmtPts(hi)} ${unit(hi)}`;
  };
  const betValues = round => round.bets || [1, 2, 3];

  function qScore(r, q, p) {
    const marks = game.marks[key(r, q)];
    if (!marks) return 0;
    const round = roundOf(r);
    if (round.type === 'bets') {
      const bet = (game.bets[key(r, q)] || [])[p] || 0;
      return marks[p] >= 1 ? bet : -bet;
    }
    return (marks[p] || 0) * pointsOf(round, questionOf(r, q));
  }
  const roundScore = (r, p) => roundOf(r).questions.reduce((s, _, q) => s + qScore(r, q, p), 0);
  const totalScore = p => pack.rounds.reduce((s, _, r) => s + roundScore(r, p), 0);
  const maxScore = () => pack.rounds.reduce((s, round) => {
    if (round.type === 'bets') {
      return s + [...betValues(round)].sort((a, b) => b - a).slice(0, round.questions.length).reduce((a, b) => a + b, 0);
    }
    return s + round.questions.reduce((a, q) => a + pointsOf(round, q), 0);
  }, 0);

  function availableBets(r, p, q) {
    const left = [...betValues(roundOf(r))];
    roundOf(r).questions.forEach((_, qq) => {
      if (qq === q) return;
      const used = (game.bets[key(r, qq)] || [])[p];
      const i = used == null ? -1 : left.indexOf(used);
      if (i >= 0) left.splice(i, 1);
    });
    return left;
  }
  const allBetsSet = k => game.teams.every((_, p) => (game.bets[k] || [])[p] != null);

  function save() { if (game) store.set(SAVE_KEY, game); }

  // отпечаток структуры пака и порядка шагов: если пак поменяли — старое сохранение не продолжаем
  const FLOW = 2;
  const packSig = p => `${FLOW}:` + p.rounds.map(r => `${r.type || ''}${r.questions.length}`).join(',');
  function savedPack(saved) {
    if (!saved || !Array.isArray(saved.teams) || !saved.teams.length || !Number.isInteger(saved.step)) return null;
    if (saved.teams.length > MAX_TEAMS || !saved.teams.every(t => t && typeof t.name === 'string')) return null;
    if (!saved.marks || typeof saved.marks !== 'object' || !saved.bets || typeof saved.bets !== 'object') return null;
    const p = PACKS.find(x => x.id === saved.packId);
    return p && saved.sig === packSig(p) ? p : null;
  }

  // ---------- views ----------

  function render() {
    try {
      renderScreen();
    } catch (err) {
      // ошибка в паке или в сохранении не должна оставлять пустой экран посреди вечера
      console.error(err);
      Media.destroy();
      Timer.stop();
      app.innerHTML = `
        <div class="modal">
          <div class="modal-card">
            <div class="kicker">Ой</div>
            <h2 class="modal-title">Что-то сломалось</h2>
            <p class="modal-note">${esc(err && err.message)}</p>
            ${game
              ? '<button class="btn btn--primary btn--big" data-act="crash-menu">В главное меню</button>'
              : '<button class="btn btn--primary btn--big" data-act="crash-reset">Сбросить сохранения и начать заново</button>'}
          </div>
        </div>`;
    }
  }

  function renderScreen() {
    Media.destroy();
    Timer.stop();
    if (confettiEl) { confettiEl.remove(); confettiEl = null; }
    if (!game) return renderSetup();

    const st = steps[game.step];
    const views = { intro: viewIntro, bet: viewBet, question: viewQuestion, check: viewCheck, answer: viewAnswer, roundEnd: viewRoundEnd, final: viewFinal };
    const v = views[st.kind](st);
    app.innerHTML = `
      <div class="screen screen--${st.kind}">
        ${viewTop(st)}
        <main class="stage"><div class="stage-inner">${v.html}</div></main>
        ${viewBottom(st, v)}
      </div>`;
    if (v.mount) v.mount();
    save();
  }

  function viewTop(st) {
    const crumb = st.kind === 'final'
      ? 'Итоги игры'
      : `Раунд ${st.r + 1} из ${pack.rounds.length} · ${esc(roundOf(st.r).title)}`;
    const chips = game.teams.map((pl, p) => `
      <div class="chip" style="--c:${COLORS[p]}" title="${esc(membersLine(pl))}">
        <span class="chip-dot"></span>
        <span class="chip-name">${esc(pl.name)}</span>
        <span class="chip-num" data-score="${p}">${fmtPts(totalScore(p))}</span>
      </div>`).join('');
    return `
      <header class="top">
        <div class="top-left">
          <button class="btn btn--ghost btn--menu" data-act="menu" title="Пауза и выход в главное меню (Esc)">☰ Меню</button>
          <span class="crumb">${crumb}</span>
        </div>
        <div class="top-right">
          <div class="scores">${chips}</div>
          <button class="btn btn--icon" data-act="sound" title="Звуки (M)">${Sound.enabled ? '🔊' : '🔇'}</button>
          <button class="btn btn--icon" data-act="fullscreen" title="Полный экран (F)">⛶</button>
        </div>
      </header>`;
  }

  function viewBottom(st, v) {
    let dots = '';
    const review = ['check', 'answer', 'roundEnd'].includes(st.kind);
    if (st.kind !== 'final') {
      const n = roundOf(st.r).questions.length;
      const doneUntil = st.kind === 'roundEnd' ? n : st.kind === 'check' || st.kind === 'intro' ? 0 : st.q;
      dots = roundOf(st.r).questions.map((_, q) =>
        `<i class="${q < doneUntil ? 'done' : ''} ${q === st.q ? 'cur' : ''}"></i>`).join('');
    }
    return `
      <footer class="bottom">
        <div class="dots ${review ? 'dots--review' : ''}" title="${review ? 'Сверка ответов' : 'Вопросы раунда'}">${dots}</div>
        <div class="hints">${v.hints || ''}</div>
        <div class="nav">
          ${canGoBack() ? '<button class="btn btn--ghost" data-act="back" title="Предыдущий ответ (←)">← Назад</button>' : ''}
          <button class="btn btn--primary" data-act="next" ${v.nextDisabled ? 'disabled' : ''}>${v.next}</button>
        </div>
      </footer>`;
  }

  function qHead(r, q, tag) {
    const round = roundOf(r);
    return `<div class="q-head"><span class="q-num">Вопрос ${q + 1} из ${round.questions.length}</span>${tag || ''}</div>`;
  }

  function visualHtml(question) {
    let out = '';
    if (question.emoji) out += `<div class="q-emoji">${esc(question.emoji)}</div>`;
    if (question.image) out += `<img class="q-image" src="${esc(question.image)}" alt="">`;
    if (question.list) out += `<ul class="q-list">${question.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return out;
  }

  function optionsHtml(question, reveal) {
    return `<ol class="q-options">${question.options.map((o, i) => {
      const cls = reveal ? (i === question.correct ? 'is-correct' : 'is-wrong') : '';
      return `<li class="${cls}"><b>${LETTERS[i]}</b><span>${esc(o)}</span></li>`;
    }).join('')}</ol>`;
  }

  function viewIntro({ r }) {
    const round = roundOf(r);
    const n = round.questions.length;
    const rules = [`${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`];
    // в смешанном раунде время и очки у вопросов разные — показываем диапазон
    const times = round.questions.map(q => timeOf(round, q)).filter(Boolean);
    if (game.timer && times.length) rules.push(`${span(times, () => 'сек')} на ответ, потом сразу дальше`);
    if (round.type === 'bets') {
      rules.push(`ставки ${betValues(round).join(' · ')}`);
    } else {
      const pts = round.questions.map(q => pointsOf(round, q));
      const half = round.questions.some(q => halfOf(round, q));
      rules.push(`${span(pts, n => plural(n, 'балл', 'балла', 'баллов'))} за ответ${half ? ', бывает ½' : ''}`);
    }
    return {
      html: `
        <div class="intro">
          <div class="kicker">Раунд ${r + 1} из ${pack.rounds.length}</div>
          ${round.icon ? `<div class="intro-icon">${round.icon}</div>` : ''}
          <h1 class="intro-title">${esc(round.title)}</h1>
          ${round.description ? `<p class="intro-desc">${fmtText(round.description)}</p>` : ''}
          <div class="pills">${rules.map(x => `<span class="pill">${x}</span>`).join('')}</div>
          <p class="intro-note">Правильные ответы — в конце раунда</p>
        </div>`,
      next: 'Поехали →',
      hints: 'Enter или → — дальше',
      mount: () => Sound.whoosh(),
    };
  }

  function viewBet({ r, q }) {
    const round = roundOf(r);
    const question = questionOf(r, q);
    const k = key(r, q);
    if (!game.bets[k]) game.bets[k] = game.teams.map(() => null);
    game.teams.forEach((_, p) => {
      if (game.bets[k][p] != null) return;
      const left = availableBets(r, p, q);
      if (left.length === 1) game.bets[k][p] = left[0];
    });
    const values = [...new Set(betValues(round))];
    const rows = game.teams.map((pl, p) => {
      const left = availableBets(r, p, q);
      const chips = values.map(v => `
        <button class="bet-chip ${game.bets[k][p] === v ? 'is-on' : ''}" data-act="bet" data-p="${p}" data-v="${v}" ${left.includes(v) ? '' : 'disabled'}>${v}</button>`).join('');
      const who = membersLine(pl);
      return `<div class="bet-row" style="--c:${COLORS[p]}"><span class="bet-name">${esc(pl.name)}${who ? `<small>${esc(who)}</small>` : ''}</span><div class="bet-chips">${chips}</div></div>`;
    }).join('');
    return {
      html: `
        <div class="bet">
          ${qHead(r, q, '<span class="tag">Ставка</span>')}
          <div class="bet-topic"><span>Тема</span>${esc(question.topic || 'сюрприз')}</div>
          <p class="bet-hint">${esc(round.betHint || 'Сначала ставки, потом вопрос. Каждое число — один раз за раунд. Верно — плюс ставка, неверно — минус.')}</p>
          <div class="bet-rows">${rows}</div>
        </div>`,
      next: 'К вопросу →',
      nextDisabled: !allBetsSet(k),
      hints: 'Ставьте честно, не подглядывая',
    };
  }

  function viewQuestion({ r, q }) {
    const round = roundOf(r);
    const question = questionOf(r, q);
    const media = mediaOf(question);
    const mode = question.mode || round.mode || 'audio';
    const time = timeOf(round, question);
    const useTimer = game.timer && time;
    const k = key(r, q);
    let tag = question.topic ? `<span class="tag">${esc(question.topic)}</span>` : '';
    if (round.type === 'bets') {
      tag += game.teams.map((pl, p) =>
        `<span class="tag tag--player" style="--c:${COLORS[p]}">${esc(pl.name)}: ${(game.bets[k] || [])[p] ?? '—'}</span>`).join('');
    }
    const text = question.q || round.prompt || '';
    const last = q === round.questions.length - 1;
    const hints = media ? ['Пробел — играть/пауза', 'R — заново'] : [];
    if (useTimer) hints.push(media ? 'T — таймер' : 'Пробел или T — пауза таймера');
    if (!hints.length) hints.push('Enter или → — дальше');
    return {
      html: `
        <div class="q ${media ? 'q--media' : ''}">
          ${qHead(r, q, tag)}
          ${text ? `<h2 class="q-text ${text.length > 140 ? 'is-long' : ''}">${fmtText(text)}</h2>` : ''}
          ${visualHtml(question)}
          ${media ? '<div class="q-media" data-media></div>' : ''}
          ${question.options ? optionsHtml(question, false) : ''}
          ${useTimer ? `<button class="timer" data-timer data-act="timer"><span class="timer-track"><i></i></span><span class="timer-num">${time}</span></button>` : ''}
        </div>`,
      next: last ? 'К ответам →' : 'Следующий вопрос →',
      hints: hints.join(' · '),
      mount: () => {
        if (useTimer) Timer.setup(time, next);
        if (media) {
          Media.mount(app.querySelector('[data-media]'), media, {
            mode,
            // таймер идёт после фрагмента; при повторе клипа — на паузе
            onPlay: () => { if (Timer.running) Timer.pause(); },
            onEnded: () => { if (useTimer) Timer.start(); },
          });
          fitClip();
          if (document.fonts) document.fonts.ready.then(fitClip);
        } else if (useTimer) {
          Timer.start();
        }
      },
    };
  }

  function viewCheck({ r }) {
    const round = roundOf(r);
    const many = game.teams.length > 1;
    return {
      html: `
        <div class="intro">
          <div class="kicker">Раунд ${r + 1} · ${esc(round.title)}</div>
          <div class="intro-icon">📝</div>
          <h1 class="intro-title">Сверяем ответы</h1>
          <p class="intro-desc">Ручки вниз! Открываем правильные ответы по очереди — ${many ? 'отмечайте, какая команда угадала' : 'отмечайте, что угадали'}${round.type === 'bets' ? '. Верно — плюс ставка, неверно — минус' : ''}.</p>
        </div>`,
      next: 'Первый ответ →',
      mount: () => Sound.whoosh(),
    };
  }

  function marksHtml(r, q) {
    const round = roundOf(r);
    const k = key(r, q);
    const marks = game.marks[k];
    const isBets = round.type === 'bets';
    const opts = isBets
      ? [[0, '✗ Мимо'], [1, '✓ Верно']]
      : halfOf(round, questionOf(r, q)) ? [[0, '✗'], [0.5, '½'], [1, '✓']] : [[0, '✗'], [1, '✓']];
    return game.teams.map((pl, p) => {
      const delta = qScore(r, q, p);
      const who = membersLine(pl);
      const buttons = opts.map(([v, label]) => `
        <button class="seg-btn seg-btn--${v === 0 ? 'no' : v === 1 ? 'yes' : 'half'} ${marks[p] === v ? 'is-on' : ''}" data-act="mark" data-p="${p}" data-v="${v}">${label}</button>`).join('');
      return `
        <div class="mark" style="--c:${COLORS[p]}">
          <span class="mark-name"><kbd>${p + 1}</kbd><span>${esc(pl.name)}${who ? `<small>${esc(who)}</small>` : ''}</span>${isBets ? `<em>ставка ${(game.bets[k] || [])[p] ?? 0}</em>` : ''}</span>
          <div class="seg">${buttons}</div>
          <span class="mark-delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${delta === 0 ? '0' : signed(delta)}</span>
        </div>`;
    }).join('');
  }

  function viewAnswer({ r, q }) {
    const round = roundOf(r);
    const question = questionOf(r, q);
    const k = key(r, q);
    if (!game.marks[k]) game.marks[k] = game.teams.map(() => 0);
    const media = mediaOf(question);
    const mode = question.mode || round.mode || 'audio';
    const canReveal = media && (media.kind === 'yt' || mode === 'video');
    const last = q === round.questions.length - 1;
    return {
      html: `
        <div class="a">
          ${qHead(r, q, `${question.topic && round.type !== 'bets' ? `<span class="tag">${esc(question.topic)}</span>` : ''}<span class="tag tag--good">Сверка</span>`)}
          ${question.q || round.prompt ? `<p class="a-question">${fmtText(question.q || round.prompt)}</p>` : ''}
          ${question.emoji || question.list || question.image ? `<div class="a-visual">${visualHtml(question)}</div>` : ''}
          ${question.options ? optionsHtml(question, true) : ''}
          <div class="a-answer">${fmtText(question.a)}</div>
          ${question.note ? `<p class="a-note">${fmtText(question.note)}</p>` : ''}
          ${canReveal ? `<div class="a-media" data-media><button class="btn btn--ghost" data-act="reveal-clip">▶ ${mode === 'audio' ? 'Показать клип' : 'Пересмотреть без шторки'}</button></div>` : ''}
          <div class="marks" data-marks>${marksHtml(r, q)}</div>
        </div>`,
      next: last ? 'Итоги раунда →' : 'Следующий ответ →',
      hints: `${game.teams.length > 1 ? `1–${game.teams.length}` : '1'} — отметить${q > 0 ? ' · ← — предыдущий ответ' : ''}`,
      mount: () => Sound.whoosh(),
    };
  }

  function standings() {
    const rows = game.teams.map((pl, p) => ({ p, name: pl.name, who: membersLine(pl), members: pl.members || [], total: totalScore(p) }));
    rows.forEach(x => { x.place = 1 + rows.filter(y => y.total > x.total).length; });
    return rows.sort((a, b) => b.total - a.total || a.p - b.p);
  }

  function viewRoundEnd({ r }) {
    const round = roundOf(r);
    const rows = standings();
    const top = Math.max(1, ...rows.map(x => x.total));
    const nextRound = pack.rounds[r + 1];
    const board = rows.map(x => {
      const d = roundScore(r, x.p);
      return `
        <div class="board-row" style="--c:${COLORS[x.p]}">
          <span class="board-place">${x.place}</span>
          <span class="board-name">${esc(x.name)}${x.who ? `<small>${esc(x.who)}</small>` : ''}</span>
          <span class="board-bar"><i style="transform:scaleX(${Math.max(0, x.total) / top})"></i></span>
          <span class="board-round ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d === 0 ? '0' : signed(d)} за раунд</span>
          <span class="board-total">${fmtPts(x.total)}</span>
        </div>`;
    }).join('');
    return {
      html: `
        <div class="roundend">
          <div class="kicker">Итоги раунда ${r + 1} из ${pack.rounds.length}</div>
          <h1 class="intro-title">${esc(round.title)}</h1>
          <div class="board">${board}</div>
        </div>`,
      next: nextRound ? `Раунд ${r + 2}: ${esc(nextRound.title)} →` : 'Кто победил? →',
      hints: '← — вернуться к ответам и поправить отметки',
    };
  }

  function viewFinal() {
    const rows = standings();
    const best = rows[0].total;
    const winners = rows.filter(x => x.total === best);
    const max = maxScore();
    let title, sub = '';
    if (game.teams.length === 1) {
      title = `${fmtPts(best)} из ${max}`;
      const ratio = best / max;
      sub = `${esc(rows[0].name)}: ` + (ratio >= 0.8 ? 'гениально. Можно идти на настоящий квиз.'
        : ratio >= 0.6 ? 'очень достойно!'
          : ratio >= 0.4 ? 'неплохо, есть куда расти.'
            : 'главное — весело провели вечер.');
    } else if (winners.length > 1) {
      title = 'Ничья!';
      sub = `${joinAnd(winners.map(x => esc(x.name)))} — по ${fmtPts(best)} из ${max}. Требуется реванш.`;
    } else {
      const w = winners[0];
      title = w.members.length > 1 ? `Побеждает команда «${esc(w.name)}»!` : `Побеждает ${esc(w.name)}!`;
      sub = `${w.who ? `${esc(w.who)} — ` : ''}${fmtPts(best)} ${plural(best, 'балл', 'балла', 'баллов')} из ${max}.`;
    }
    const head = game.teams.map((pl, p) => `<th style="--c:${COLORS[p]}">${esc(pl.name)}</th>`).join('');
    const body = pack.rounds.map((round, r) => `
      <tr><td>${round.icon || ''} ${esc(round.title)}</td>${game.teams.map((_, p) => `<td>${fmtPts(roundScore(r, p))}</td>`).join('')}</tr>`).join('');
    const foot = `<tr><td>Итого</td>${game.teams.map((_, p) => `<td>${fmtPts(totalScore(p))}</td>`).join('')}</tr>`;
    return {
      html: `
        <div class="final">
          <div class="kicker">Игра окончена</div>
          <h1 class="final-title">${title}</h1>
          ${sub ? `<p class="intro-desc">${sub}</p>` : ''}
          <div class="final-wrap"><table class="final-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
        </div>`,
      next: 'Новая игра',
      mount: () => { Sound.fanfare(); confetti(); },
    };
  }

  // ---------- setup ----------

  function describeSaved(saved) {
    const p = savedPack(saved);
    if (!p) return null;
    const st = buildSteps(p)[saved.step];
    if (!st) return null;
    const phase = st.kind === 'answer' ? `, сверка ответа ${st.q + 1}` : st.kind === 'check' ? ', сверка ответов' : st.q != null ? `, вопрос ${st.q + 1}` : '';
    const where = st.kind === 'final' ? 'финал' : `раунд ${st.r + 1} «${p.rounds[st.r].title}»${phase}`;
    return `${esc(p.title)}: ${esc(where)} · ${saved.teams.map(x => esc(x.name)).join(', ')}`;
  }

  function renderSetup() {
    const saved = migrateSave(store.get(SAVE_KEY));
    const savedInfo = saved && describeSaved(saved);
    const count = prefs.teams.length;
    const people = prefs.teams.reduce((n, t) => n + t.members.length, 0);
    const modes = [[1, 'Одна команда'], [2, '2 команды'], [3, '3'], [4, '4']].map(([n, label]) => `
      <button class="seg-btn ${count === n ? 'is-on' : ''}" data-act="team-count" data-n="${n}">${label}</button>`).join('');
    const teams = prefs.teams.map((t, i) => {
      const members = t.members.map((m, j) => `
        <span class="member">
          <button class="member-name" data-act="move-member" data-t="${i}" data-m="${j}" ${count > 1 ? 'title="Перевести в другую команду"' : 'tabindex="-1"'}>${esc(m)}</button>
          <button class="member-x" data-act="remove-member" data-t="${i}" data-m="${j}" title="Убрать">×</button>
        </span>`).join('');
      return `
        <div class="team" style="--c:${COLORS[i]}">
          <div class="team-head">
            <span class="chip-dot"></span>
            <input class="input" data-team-name="${i}" value="${esc(t.name)}" maxlength="24" placeholder="${esc(teamLabel({ name: '', members: t.members }, i, count))}" aria-label="Название команды">
          </div>
          <div class="team-members">
            ${members}
            <input class="member-input" data-member-input="${i}" maxlength="20" placeholder="+ ${t.members.length ? 'ещё' : 'имя'}, Enter" aria-label="Добавить участника">
          </div>
        </div>`;
    }).join('');
    const packs = PACKS.map(p => {
      const nq = p.rounds.reduce((s, r) => s + r.questions.length, 0);
      return `
        <button class="pack ${p.id === prefs.packId ? 'is-on' : ''}" data-act="pick-pack" data-id="${esc(p.id)}">
          <b>${esc(p.title)}</b>
          <span>${esc(p.description || '')}</span>
          <small>${p.rounds.length} ${plural(p.rounds.length, 'раунд', 'раунда', 'раундов')} · ${nq} ${plural(nq, 'вопрос', 'вопроса', 'вопросов')}${p.duration ? ` · ${esc(p.duration)}` : ''}</small>
        </button>`;
    }).join('');
    const fileWarn = location.protocol === 'file:'
      ? '<div class="warn">Страница открыта как файл — YouTube-фрагменты не заиграют. Запустите <code>start.command</code> двойным кликом.</div>'
      : '';

    app.innerHTML = `
      <div class="setup">
        <section class="setup-hero">
          <div class="logo">Квиз<br><span>на&nbsp;диване</span></div>
          <p class="setup-lead">Домашний паб-квиз: разминка, эмодзи, музыка, кино, ставки. Компьютер — ведущий. Играйте одной командой или делитесь на команды.</p>
          <ul class="howto">
            <li><b>1.</b> Каждая команда пишет ответ на бумажке или в заметках, не показывая другим.</li>
            <li><b>2.</b> Вопросы идут по таймеру. В конце раунда сверяете ответы и честно отмечаете, кто угадал.</li>
            <li><b>3.</b> Одной командой — соревнуетесь с квизом: сколько наберёте из максимума.</li>
          </ul>
          <p class="keys"><kbd>→</kbd> дальше <kbd>Пробел</kbd> плей/пауза <kbd>T</kbd> таймер <kbd>F</kbd> полный экран <kbd>Esc</kbd> меню</p>
        </section>
        <section class="setup-card">
          ${fileWarn}
          ${savedInfo ? `
            <div class="resume">
              <div><small>Незаконченная игра</small><b>${savedInfo}</b></div>
              <div class="resume-actions">
                <button class="btn btn--primary" data-act="resume">Продолжить</button>
                <button class="btn btn--ghost" data-act="discard-save">Сбросить</button>
              </div>
            </div>` : ''}
          <h3>Кто играет</h3>
          <div class="seg seg--mode">${modes}</div>
          <div class="teams ${count === 1 ? 'teams--solo' : ''}">${teams}</div>
          <div class="teams-foot">
            ${count > 1 && people >= 2 ? '<button class="btn btn--ghost btn--small" data-act="shuffle">🎲 Разделить случайно</button>' : ''}
            <span class="setup-hint">${count > 1 ? 'Имена необязательны. Нажмите на имя, чтобы перевести человека в другую команду.' : 'Играете вместе против квиза. Имена необязательны.'}</span>
          </div>
          <h3>Игра</h3>
          <div class="packs">${packs || '<p class="warn">Нет паков в packs/</p>'}</div>
          <h3>Настройки</h3>
          <label class="toggle"><input type="checkbox" data-pref="timer" ${prefs.timer ? 'checked' : ''}><span></span>Таймер на ответ</label>
          <label class="toggle"><input type="checkbox" data-pref="sound" ${prefs.sound ? 'checked' : ''}><span></span>Звуки</label>
          <button class="btn btn--primary btn--big" data-act="start" ${PACKS.length ? '' : 'disabled'}>${savedInfo ? 'Новая игра →' : 'Начать игру →'}</button>
        </section>
      </div>`;
  }

  function savePrefs() { store.set(PREFS_KEY, prefs); }

  // забирает введённое в поля: названия команд и недописанные имена участников
  function syncSetupInputs() {
    app.querySelectorAll('[data-team-name]').forEach(inp => {
      const t = prefs.teams[+inp.dataset.teamName];
      if (t) t.name = inp.value;
    });
    app.querySelectorAll('[data-member-input]').forEach(inp => {
      const name = inp.value.trim();
      const t = prefs.teams[+inp.dataset.memberInput];
      if (name && t) { t.members.push(name); inp.value = ''; }
    });
    savePrefs();
  }

  function renderSetupKeepFocus(selector) {
    render();
    const el = selector && app.querySelector(selector);
    if (el) el.focus();
  }

  function setTeamCount(n) {
    syncSetupInputs();
    const old = prefs.teams;
    const everyone = old.flatMap(t => t.members);
    const teams = Array.from({ length: n }, (_, i) => ({ name: old[i] ? old[i].name : '', members: [] }));
    if (old.length === 1 && n > 1) {
      // из одной команды в несколько — раскладываем по очереди
      everyone.forEach((m, i) => teams[i % n].members.push(m));
    } else {
      old.forEach((t, i) => {
        if (i < n) teams[i].members.push(...t.members);
        else t.members.forEach(m => teams.reduce((a, b) => (b.members.length < a.members.length ? b : a)).members.push(m));
      });
    }
    prefs.teams = teams;
    savePrefs();
    render();
  }

  function shuffleTeams() {
    syncSetupInputs();
    const everyone = prefs.teams.flatMap(t => t.members);
    for (let i = everyone.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [everyone[i], everyone[j]] = [everyone[j], everyone[i]];
    }
    const offset = Math.floor(Math.random() * prefs.teams.length);
    prefs.teams.forEach(t => { t.members = []; });
    everyone.forEach((m, i) => prefs.teams[(i + offset) % prefs.teams.length].members.push(m));
    savePrefs();
    Sound.whoosh();
    render();
    app.querySelector('.teams').classList.add('is-shuffled');
  }

  function startGame() {
    syncSetupInputs();
    pack = PACKS.find(p => p.id === prefs.packId) || PACKS[0];
    if (!pack) return;
    steps = buildSteps(pack);
    game = {
      packId: pack.id,
      sig: packSig(pack),
      teams: prefs.teams.map((t, i, all) => ({ name: teamLabel(t, i, all.length), members: t.members.slice() })),
      step: 0,
      marks: {},
      bets: {},
      timer: prefs.timer,
      startedAt: Date.now(),
    };
    Sound.ensure();
    goTo(0);
  }

  function resumeGame() {
    const saved = migrateSave(store.get(SAVE_KEY));
    pack = savedPack(saved);
    if (!pack) return render();
    steps = buildSteps(pack);
    game = saved;
    Sound.ensure();
    goTo(Math.max(0, Math.min(game.step, steps.length - 1)));
  }

  // ---------- actions ----------

  // двойной клик или нажатие ровно в момент автоперехода не должны проскакивать вопрос
  const NAV_COOLDOWN = 350;
  let stepChangedAt = 0;

  function goTo(step) {
    game.step = step;
    stepChangedAt = performance.now();
    render();
    window.scrollTo(0, 0);
  }

  function next() {
    if (!game || performance.now() - stepChangedAt < NAV_COOLDOWN) return;
    const st = steps[game.step];
    if (st.kind === 'bet' && !allBetsSet(key(st.r, st.q))) return;
    if (st.kind === 'final') {
      store.del(SAVE_KEY);
      game = null;
      render();
      return;
    }
    goTo(Math.min(steps.length - 1, game.step + 1));
  }

  // назад можно только внутри сверки — поправить отметку
  function canGoBack() {
    const st = steps[game.step];
    const prev = steps[game.step - 1];
    return !!prev && prev.kind === 'answer' && (st.kind === 'answer' || st.kind === 'roundEnd');
  }

  function back() {
    if (!game || !canGoBack() || performance.now() - stepChangedAt < NAV_COOLDOWN) return;
    goTo(game.step - 1);
  }

  let menu = null;

  function openMenu() {
    if (menu) return closeMenu(true);
    // «Время!» уже прозвучало и ждём автоперехода — переходим после закрытия меню
    menu = { wasRunning: Timer.running, pendingNext: !!Timer.doneHandle, el: document.createElement('div') };
    clearTimeout(Timer.doneHandle);
    Timer.doneHandle = null;
    Timer.pause();
    const clip = Media.ctrl;
    if (clip) {
      // фрагмент, который ещё грузится после «Слушать», не должен заиграть за меню
      if (clip.pendingPlay) { clip.pendingPlay = false; clip.renderUI(); }
      if (clip.state === 'playing') clip.pause();
    }
    // всё под меню недоступно: Tab + Enter не нажмёт кнопки игры за затемнением
    app.inert = true;
    menu.el.className = 'modal';
    menu.el.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Пауза">
        <div class="kicker">Пауза</div>
        <h2 class="modal-title">Меню</h2>
        <button class="btn btn--primary btn--big" data-menu="continue">Продолжить игру</button>
        <button class="btn btn--ghost btn--big" data-menu="exit">Выйти в главное меню</button>
        <p class="modal-note">Игра сохранится — потом продолжите с этого же места.</p>
      </div>`;
    menu.el.addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (e.target === menu.el || (b && b.dataset.menu === 'continue')) closeMenu(true);
      else if (b && b.dataset.menu === 'exit') {
        closeMenu(false);
        save();
        game = null;
        render();
      }
    });
    document.body.appendChild(menu.el);
    menu.el.querySelector('[data-menu="continue"]').focus();
  }

  function closeMenu(resume) {
    if (!menu) return;
    const { el, wasRunning, pendingNext } = menu;
    menu = null;
    el.remove();
    app.inert = false;
    if (!resume) return;
    if (pendingNext) next();
    else if (wasRunning) Timer.start();
  }

  function refreshScores() {
    app.querySelectorAll('[data-score]').forEach(el => {
      const v = fmtPts(totalScore(+el.dataset.score));
      if (el.textContent !== v) {
        el.textContent = v;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    });
  }

  function setMark(p, v) {
    const st = steps[game.step];
    if (st.kind !== 'answer' || p >= game.teams.length) return;
    const k = key(st.r, st.q);
    game.marks[k][p] = v;
    v > 0 ? Sound.good() : Sound.bad();
    app.querySelector('[data-marks]').innerHTML = marksHtml(st.r, st.q);
    refreshScores();
    save();
  }

  function cycleMark(p) {
    const st = steps[game.step];
    if (st.kind !== 'answer' || p >= game.teams.length) return;
    const round = roundOf(st.r);
    const order = round.type !== 'bets' && halfOf(round, questionOf(st.r, st.q)) ? [0, 1, 0.5] : [0, 1];
    const cur = game.marks[key(st.r, st.q)][p];
    setMark(p, order[(order.indexOf(cur) + 1) % order.length]);
  }

  function setBet(p, v) {
    const st = steps[game.step];
    if (st.kind !== 'bet') return;
    game.bets[key(st.r, st.q)][p] = v;
    Sound.tick();
    render();
  }

  function revealClip() {
    const st = steps[game.step];
    const host = app.querySelector('[data-media]');
    const ctrl = Media.mount(host, mediaOf(questionOf(st.r, st.q)), { mode: 'reveal' });
    host.classList.add('is-open');
    // освобождаем место под клип, чтобы отметки команд остались на экране
    host.closest('.a').classList.add('is-revealed');
    fitClip();
    ctrl.play();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function toggleSound() {
    Sound.enabled = !Sound.enabled;
    prefs.sound = Sound.enabled;
    store.set(PREFS_KEY, prefs);
    const btn = app.querySelector('[data-act="sound"]');
    if (btn) btn.textContent = Sound.enabled ? '🔊' : '🔇';
  }

  const actions = {
    next,
    back,
    menu: openMenu,
    timer: () => Timer.toggle(),
    'clip-toggle': () => Media.ctrl && Media.ctrl.toggle(),
    'clip-replay': () => Media.ctrl && Media.ctrl.replay(),
    'reveal-clip': revealClip,
    mark: b => setMark(+b.dataset.p, +b.dataset.v),
    bet: b => setBet(+b.dataset.p, +b.dataset.v),
    sound: toggleSound,
    fullscreen: toggleFullscreen,
    start: startGame,
    resume: resumeGame,
    'discard-save': () => {
      if (!confirm('Сбросить незаконченную игру?')) return;
      store.del(SAVE_KEY);
      syncSetupInputs();
      render();
    },
    'team-count': b => setTeamCount(+b.dataset.n),
    shuffle: shuffleTeams,
    'move-member': b => {
      if (prefs.teams.length < 2) return;
      syncSetupInputs();
      const t = +b.dataset.t;
      const [m] = prefs.teams[t].members.splice(+b.dataset.m, 1);
      prefs.teams[(t + 1) % prefs.teams.length].members.push(m);
      savePrefs();
      Sound.tick();
      render();
    },
    'remove-member': b => {
      syncSetupInputs();
      prefs.teams[+b.dataset.t].members.splice(+b.dataset.m, 1);
      savePrefs();
      render();
    },
    'pick-pack': b => {
      syncSetupInputs();
      prefs.packId = b.dataset.id;
      store.set(PREFS_KEY, prefs);
      render();
    },
    // аварийный экран: сохранение не трогаем — вдруг ошибку поправят и игру можно будет продолжить
    'crash-menu': () => {
      game = null;
      render();
    },
    'crash-reset': () => {
      store.del(SAVE_KEY);
      store.del(PREFS_KEY);
      location.reload();
    },
  };

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
    if (el.tagName === 'BUTTON') el.blur();
  });

  app.addEventListener('change', e => {
    const pref = e.target.dataset && e.target.dataset.pref;
    if (!pref) return;
    prefs[pref] = e.target.checked;
    if (pref === 'sound') Sound.enabled = prefs.sound;
    syncSetupInputs();
  });

  app.addEventListener('input', e => {
    const t = e.target.dataset && e.target.dataset.teamName;
    if (t != null && prefs.teams[+t]) { prefs.teams[+t].name = e.target.value; savePrefs(); }
  });

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const typing = e.target.matches && e.target.matches('input, textarea');
    if (!game) {
      if (e.key !== 'Enter' || e.target.closest('button')) return;
      e.preventDefault();
      const memberInput = e.target.dataset && e.target.dataset.memberInput;
      if (memberInput != null) {
        if (!e.target.value.trim()) return;
        syncSetupInputs();
        renderSetupKeepFocus(`[data-member-input="${memberInput}"]`);
        return;
      }
      // Enter после названия команды — к вводу участников, а не старт игры
      const teamName = e.target.dataset && e.target.dataset.teamName;
      if (teamName != null) {
        const input = app.querySelector(`[data-member-input="${teamName}"]`);
        if (input) input.focus();
        return;
      }
      if (e.repeat) return;
      startGame();
      return;
    }
    if (menu) {
      if (e.code === 'Escape') { e.preventDefault(); closeMenu(true); }
      return;
    }
    if (typing) return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button')) return;
    // зажатая клавиша не должна пролистывать вопросы пачкой
    if (e.repeat) { if (['ArrowRight', 'ArrowLeft', 'Enter', 'NumpadEnter', 'PageDown', 'PageUp', 'Space'].includes(e.code)) e.preventDefault(); return; }

    switch (e.code) {
      case 'ArrowRight': case 'Enter': case 'NumpadEnter': case 'PageDown':
        e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'PageUp':
        e.preventDefault(); back(); break;
      case 'Space':
        e.preventDefault();
        if (Media.ctrl) Media.ctrl.toggle(); else Timer.toggle();
        break;
      case 'KeyT': Timer.toggle(); break;
      case 'KeyR': if (Media.ctrl) Media.ctrl.replay(); break;
      case 'KeyF': toggleFullscreen(); break;
      case 'KeyM': toggleSound(); break;
      case 'Escape': openMenu(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      case 'Numpad1': case 'Numpad2': case 'Numpad3': case 'Numpad4':
        cycleMark(+e.code.slice(-1) - 1); break;
      default:
    }
  });

  // ---------- confetti ----------

  function confetti() {
    if (reducedMotion()) return;
    const c = document.createElement('canvas');
    c.className = 'confetti';
    document.body.appendChild(c);
    confettiEl = c;
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const palette = [...COLORS, '#ffffff', '#9b7bff'];
    const parts = Array.from({ length: 200 }, () => ({
      x: Math.random() * c.width,
      y: -Math.random() * c.height * 0.7,
      vx: (Math.random() - 0.5) * 4 * dpr,
      vy: (2 + Math.random() * 4) * dpr,
      r: (5 + Math.random() * 7) * dpr,
      a: Math.random() * Math.PI,
      va: (Math.random() - 0.5) * 0.3,
      color: palette[Math.floor(Math.random() * palette.length)],
    }));
    const t0 = performance.now();
    const frame = t => {
      if (confettiEl !== c) return;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const pt of parts) {
        pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.04 * dpr; pt.a += pt.va;
        ctx.save();
        ctx.translate(pt.x, pt.y);
        ctx.rotate(pt.a);
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.r / 2, -pt.r / 4, pt.r, pt.r / 2);
        ctx.restore();
      }
      if (t - t0 < 6000) requestAnimationFrame(frame);
      else { c.remove(); if (confettiEl === c) confettiEl = null; }
    };
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------

  if (location.protocol !== 'file:') loadYouTubeApi().catch(() => {});
  render();
})();
