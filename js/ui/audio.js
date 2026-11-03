// 효과음은 파일 없이 Web Audio로 합성한다
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
    this.muted = false;
    this.lastDing = 0;
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
  }
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
