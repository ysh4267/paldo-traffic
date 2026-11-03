// 효과음은 파일 없이 Web Audio로 합성하고, 배경음만 음원 파일을 튼다
const MUSIC_SRC = 'audio/we-drove-all-night.mp3';
// 슬라이더를 끝까지 올렸을 때의 크기. 원곡이 꽤 크게 녹음되어 있어 낮춰서 튼다
const MUSIC_LEVEL = 0.5;

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.muted = false;
    this.lastDing = 0;
    this.music = null;
    this.musicGain = null;
    this.musicVolume = 0.45;
    this.musicOn = true;
    this.musicHidden = false;
    this.musicTarget = -1;
    this.musicPauseT = 0;
  }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.syncMusic();
  }
  // 배경음은 첫 입력 뒤에 틀고, 끄거나 탭이 숨으면 소리를 줄인 뒤 멈춘다
  syncMusic() {
    if (!this.ctx) return;
    const want = this.musicOn && !this.musicHidden && this.musicVolume > 0;
    if (!this.music) {
      if (!want) return;
      this.music = new Audio(MUSIC_SRC);
      this.music.loop = true;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.ctx.createMediaElementSource(this.music).connect(this.musicGain);
      this.musicGain.connect(this.ctx.destination);
    }
    const target = want ? this.musicVolume * MUSIC_LEVEL : 0;
    if (target !== this.musicTarget) {
      this.musicTarget = target;
      this.musicGain.gain.setTargetAtTime(target, this.ctx.currentTime, want ? 0.4 : 0.15);
    }
    clearTimeout(this.musicPauseT);
    if (want) {
      if (this.music.paused) this.music.play().catch(() => {});
    } else if (!this.music.paused) {
      this.musicPauseT = setTimeout(() => this.music.pause(), 800);
    }
  }
  setMusicVolume(v) { this.musicVolume = v; this.syncMusic(); }
  setMusicOn(on) { this.musicOn = on; this.syncMusic(); }
  setHidden(hidden) { this.musicHidden = hidden; this.syncMusic(); }
  applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.5;
  }
  setVolume(v) { this.volume = v; this.applyVolume(); }
  setMuted(m) { this.muted = m; this.applyVolume(); }
  tone(freq, start, dur, type = 'sine', gain = 0.25, slide = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  click() { this.tone(520, 0, 0.06, 'triangle', 0.16); }
  buy() { this.tone(660, 0, 0.08, 'triangle', 0.2); this.tone(880, 0.06, 0.1, 'triangle', 0.18); }
  deny() { this.tone(170, 0, 0.14, 'square', 0.1); }
  ding(ontime) {
    const now = performance.now();
    if (now - this.lastDing < 180) return;
    this.lastDing = now;
    this.tone(ontime ? 1320 : 990, 0, 0.09, 'sine', 0.06);
  }
  place() { this.tone(240, 0, 0.09, 'square', 0.1); this.tone(360, 0.05, 0.08, 'square', 0.08); }
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.13, 0.32, 'triangle', 0.24)); }
  horn() { this.tone(330, 0, 0.32, 'sawtooth', 0.05); this.tone(415, 0, 0.32, 'sawtooth', 0.04); }
}
