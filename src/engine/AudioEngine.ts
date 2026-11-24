import type { PerkId, PowerUpId, WeaponId, ZoneId } from '../config/balance';
import type { GameSettings } from '../config/settings';
import type { SurfaceType } from './BvhWorld';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private voiceGain!: GainNode;
  private lowHealthFilter!: BiquadFilterNode;
  private compressor!: DynamicsCompressorNode;
  private reverbNode!: ConvolverNode;
  private reverbGain!: GainNode;
  private noiseBuffer: AudioBuffer | null = null;

  private droneOscA: OscillatorNode | null = null;
  private droneOscB: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;

  private heartbeatCooldown = 0;
  private lowHealthAmount = 0;
  private currentZone: ZoneId = 'farmhouse';
  private listenerX = -7;
  private listenerY = 1.65;
  private listenerZ = 22;
  private volumes = {
    master: 0.85,
    music: 0.65,
    sfx: 0.9,
    voice: 0.85,
  };

  public init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
    } catch {
      return;
    }

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2;

    this.lowHealthFilter = this.ctx.createBiquadFilter();
    this.lowHealthFilter.type = 'lowpass';
    this.lowHealthFilter.frequency.value = 18000;
    this.lowHealthFilter.Q.value = 0.7;

    this.masterGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.voiceGain = this.ctx.createGain();

    this.musicGain.connect(this.lowHealthFilter);
    this.sfxGain.connect(this.lowHealthFilter);
    this.voiceGain.connect(this.masterGain);

    this.lowHealthFilter.connect(this.masterGain);
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    // Procedural noise buffer (1.5s)
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 1.5);
    this.noiseBuffer = this.ctx.createBuffer(1, len, sr);
    const ch = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = Math.random() * 2 - 1;
    }

    // Procedural reverb impulse (indoor/bunker tail)
    const revLen = Math.floor(sr * 1.4);
    const revBuf = this.ctx.createBuffer(2, revLen, sr);
    for (let c = 0; c < 2; c++) {
      const d = revBuf.getChannelData(c);
      for (let i = 0; i < revLen; i++) {
        const decay = Math.exp((-i / revLen) * 4.5);
        d[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    this.reverbNode = this.ctx.createConvolver();
    this.reverbNode.buffer = revBuf;
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverbNode.connect(this.reverbGain);
    this.reverbGain.connect(this.sfxGain);

    this.applyVolumes();
    this.startAmbientDrone();
  }

  public resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  public updateSettings(settings: GameSettings): void {
    this.volumes.master = settings.masterVolume;
    this.volumes.music = settings.musicVolume;
    this.volumes.sfx = settings.sfxVolume;
    this.volumes.voice = settings.voiceVolume;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.volumes.master, now, 0.03);
    this.musicGain.gain.setTargetAtTime(this.volumes.music, now, 0.05);
    this.sfxGain.gain.setTargetAtTime(this.volumes.sfx, now, 0.03);
    this.voiceGain.gain.setTargetAtTime(this.volumes.voice, now, 0.03);
  }

  private startAmbientDrone(): void {
    if (!this.ctx || this.droneOscA) return;
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.09;

    this.droneOscA = this.ctx.createOscillator();
    this.droneOscA.type = 'sawtooth';
    this.droneOscA.frequency.value = 41.2; // E1 dark drone

    this.droneOscB = this.ctx.createOscillator();
    this.droneOscB.type = 'triangle';
    this.droneOscB.frequency.value = 61.7; // B1 fifth

    this.droneOscA.connect(this.droneFilter);
    this.droneOscB.connect(this.droneFilter);
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.musicGain);

    this.droneOscA.start();
    this.droneOscB.start();
  }

  public setRoundIntensity(round: number, zone: ZoneId): void {
    this.currentZone = zone;
    if (!this.ctx || !this.droneFilter || !this.droneGain || !this.reverbGain) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1, (round - 1) / 18);
    this.droneFilter.frequency.setTargetAtTime(140 + intensity * 260, now, 0.5);
    this.droneGain.gain.setTargetAtTime(0.06 + intensity * 0.08, now, 0.5);

    const revByZone: Record<ZoneId, number> = {
      farmhouse: 0.22,
      barn: 0.3,
      silo_yard: 0.14,
      lab_wing: 0.34,
      bunker: 0.45,
    };
    this.reverbGain.gain.setTargetAtTime(revByZone[zone], now, 0.4);
  }

  public updateListener(
    px: number,
    py: number,
    pz: number,
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number,
    healthRatio: number,
    dt: number,
  ): void {
    this.listenerX = px;
    this.listenerY = py;
    this.listenerZ = pz;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = px;
      l.positionY.value = py;
      l.positionZ.value = pz;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    }

    // Low-health muffle & heartbeat
    const targetLow = healthRatio < 0.45 ? 1 - healthRatio / 0.45 : 0;
    this.lowHealthAmount += (targetLow - this.lowHealthAmount) * Math.min(1, dt * 6);
    const cutoff = 18000 - this.lowHealthAmount * 16600;
    this.lowHealthFilter.frequency.setTargetAtTime(Math.max(900, cutoff), this.ctx.currentTime, 0.06);

    if (this.lowHealthAmount > 0.15) {
      this.heartbeatCooldown -= dt;
      if (this.heartbeatCooldown <= 0) {
        this.playHeartbeat(this.lowHealthAmount);
        this.heartbeatCooldown = 0.85 - this.lowHealthAmount * 0.32;
      }
    }
  }

  private createPanner(x: number, y: number, z: number): PannerNode | null {
    if (!this.ctx) return null;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 2.5;
    p.maxDistance = 42;
    p.rolloffFactor = 1.35;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.sfxGain);
    p.connect(this.reverbNode);
    return p;
  }

  private playHeartbeat(intensity: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let beat = 0; beat < 2; beat++) {
      const t = now + beat * 0.18;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(beat === 0 ? 64 : 52, t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.14);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.28 * intensity, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  public playGunshot(weaponId: WeaponId, upgraded: boolean): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    if (weaponId === 'phase_cannon') {
      // Sci-fi blue-violet phase zap + bass thump
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(upgraded ? 980 : 780, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.28);
      g.gain.setValueAtTime(0.32, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.connect(g);
      g.connect(this.sfxGain);
      g.connect(this.reverbNode);
      osc.start(now);
      osc.stop(now + 0.32);
      return;
    }

    const profiles: Record<WeaponId, { pitch: number; bodyDur: number; crackFreq: number; gain: number }> = {
      service_pistol: { pitch: 155, bodyDur: 0.12, crackFreq: 2100, gain: 0.36 },
      hedgerow: { pitch: 82, bodyDur: 0.28, crackFreq: 1300, gain: 0.56 },
      rattler: { pitch: 185, bodyDur: 0.09, crackFreq: 2500, gain: 0.32 },
      ironsight: { pitch: 128, bodyDur: 0.15, crackFreq: 1900, gain: 0.4 },
      longbow: { pitch: 76, bodyDur: 0.32, crackFreq: 2800, gain: 0.55 },
      hammerfall: { pitch: 108, bodyDur: 0.16, crackFreq: 1750, gain: 0.42 },
      phase_cannon: { pitch: 300, bodyDur: 0.2, crackFreq: 1800, gain: 0.35 },
    };
    const p = profiles[weaponId];
    const pitchMod = (upgraded ? 1.22 : 1.0) * (0.96 + Math.random() * 0.08);

    // Layer 1: Sub-bass chest thump (visceral recoil punch)
    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(88 * (upgraded ? 1.1 : 1), now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.095);
    subGain.gain.setValueAtTime(p.gain * 0.85, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.12);

    // Layer 2: Mid-low body punch
    const punch = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(p.pitch * pitchMod, now);
    punch.frequency.exponentialRampToValueAtTime(36, now + 0.085);
    punchGain.gain.setValueAtTime(p.gain * 0.72, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
    punch.connect(punchGain);
    punchGain.connect(this.sfxGain);
    punch.start(now);
    punch.stop(now + 0.115);

    // Layer 3: Supersonic high-pass transient crack + chamber noise tail
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(p.crackFreq * pitchMod, now);
    bp.frequency.exponentialRampToValueAtTime(Math.max(420, p.crackFreq * 0.42), now + p.bodyDur);
    bp.Q.value = 0.75;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(p.gain * 1.05, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + p.bodyDur);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.sfxGain);
    nGain.connect(this.reverbNode);
    noise.start(now);
    noise.stop(now + p.bodyDur + 0.02);

    // Layer 4: Mechanical bolt / slide snap (+pump clack on shotgun/sniper)
    const boltAt = now + (weaponId === 'hedgerow' || weaponId === 'longbow' ? 0.095 : 0.036);
    const bolt = this.ctx.createOscillator();
    const bGain = this.ctx.createGain();
    bolt.type = 'triangle';
    bolt.frequency.setValueAtTime(weaponId === 'hedgerow' ? 680 : 1220, boltAt);
    bolt.frequency.exponentialRampToValueAtTime(340, boltAt + 0.035);
    bGain.gain.setValueAtTime(0.09, boltAt);
    bGain.gain.exponentialRampToValueAtTime(0.001, boltAt + 0.042);
    bolt.connect(bGain);
    bGain.connect(this.sfxGain);
    bolt.start(boltAt);
    bolt.stop(boltAt + 0.045);

    // Layer 5: Overclock harmonic plasma sheen when upgraded
    if (upgraded) {
      const shimmer = this.ctx.createOscillator();
      const sGain = this.ctx.createGain();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(1520, now);
      shimmer.frequency.exponentialRampToValueAtTime(410, now + 0.15);
      sGain.gain.setValueAtTime(0.12, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      shimmer.connect(sGain);
      sGain.connect(this.sfxGain);
      shimmer.start(now);
      shimmer.stop(now + 0.17);
    }
  }

  public playDryFire(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.03);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  public playReloadCue(stage: 'out' | 'in' | 'rack'): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqMap = { out: 340, in: 520, rack: 760 };
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqMap[stage], now);
    osc.frequency.exponentialRampToValueAtTime(freqMap[stage] * 0.55, now + 0.07);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playMeleeSwing(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(320, now + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.16);
  }

  public playHitMarker(headshot: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = headshot ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(headshot ? 1760 : 980, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2520 : 620, now + 0.06);
    g.gain.setValueAtTime(headshot ? 0.25 : 0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.08);

    if (headshot && this.noiseBuffer) {
      // Wet skull crunch + crisp harmonic chime
      const crunch = this.ctx.createBufferSource();
      crunch.buffer = this.noiseBuffer;
      const lowBp = this.ctx.createBiquadFilter();
      lowBp.type = 'bandpass';
      lowBp.frequency.setValueAtTime(440, now);
      lowBp.Q.value = 1.4;
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.32, now);
      cg.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      crunch.connect(lowBp);
      lowBp.connect(cg);
      cg.connect(this.sfxGain);
      crunch.start(now);
      crunch.stop(now + 0.09);

      const snap = this.ctx.createBufferSource();
      snap.buffer = this.noiseBuffer;
      const highBp = this.ctx.createBiquadFilter();
      highBp.type = 'bandpass';
      highBp.frequency.setValueAtTime(2400, now);
      highBp.Q.value = 1.7;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.24, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
      snap.connect(highBp);
      highBp.connect(sg);
      sg.connect(this.sfxGain);
      snap.start(now);
      snap.stop(now + 0.06);
    }
  }

  public playFootstep(sprint: boolean): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this.currentZone === 'silo_yard' ? 480 : 340;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(sprint ? 0.11 : 0.065, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.09);
  }

  public playSlide(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(920, now);
    filter.frequency.exponentialRampToValueAtTime(290, now + 0.34);
    filter.Q.value = 0.85;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(now);
    src.stop(now + 0.38);
  }

  public playAdsCue(entering: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(entering ? 420 : 320, now);
    osc.frequency.exponentialRampToValueAtTime(entering ? 620 : 220, now + 0.045);
    g.gain.setValueAtTime(0.045, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playPlayerHit(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Low chest thump + sharp slash tear so player always feels and hears damage immediately
    const thud = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(92, now);
    thud.frequency.exponentialRampToValueAtTime(32, now + 0.16);
    tg.gain.setValueAtTime(0.45, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thud.connect(tg);
    tg.connect(this.masterGain);
    thud.start(now);
    thud.stop(now + 0.19);

    if (this.noiseBuffer) {
      const tear = this.ctx.createBufferSource();
      tear.buffer = this.noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1450, now);
      bp.frequency.exponentialRampToValueAtTime(480, now + 0.12);
      bp.Q.value = 1.1;
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(0.34, now);
      ng.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      tear.connect(bp);
      bp.connect(ng);
      ng.connect(this.masterGain);
      tear.start(now);
      tear.stop(now + 0.14);
    }
  }

  public playZombieSound(
    kind: 'groan' | 'attack' | 'hound' | 'brute' | 'footstep',
    x: number,
    y: number,
    z: number,
  ): void {
    if (!this.ctx) return;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const distSq = dx * dx + dz * dz;
    const vertGap = Math.abs(y - this.listenerY);
    if (kind === 'footstep' && (distSq > 9 * 9 || vertGap > 2.4)) return;
    if (kind === 'groan' && (distSq > 20 * 20 || vertGap > 2.6)) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    if (kind === 'attack' || kind === 'hound') {
      panner.refDistance = 3.6;
      panner.rolloffFactor = 1.1;
    }
    const now = this.ctx.currentTime;

    if (kind === 'footstep') {
      if (!this.noiseBuffer) return;
      const step = this.ctx.createBufferSource();
      step.buffer = this.noiseBuffer;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'bandpass';
      lp.frequency.setValueAtTime(420 + Math.random() * 140, now);
      lp.Q.value = 1.4;
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.16, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      step.connect(lp);
      lp.connect(sg);
      sg.connect(panner);
      step.start(now);
      step.stop(now + 0.095);
      return;
    }

    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    if (kind === 'hound') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240 + Math.random() * 60, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
      filter.type = 'bandpass';
      filter.frequency.value = 650;
      g.gain.setValueAtTime(0.28, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(filter);
      filter.connect(g);
      g.connect(panner);
      osc.start(now);
      osc.stop(now + 0.26);
      return;
    }

    if (kind === 'brute') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(75, now);
      osc.frequency.linearRampToValueAtTime(52, now + 0.65);
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      g.gain.setValueAtTime(0.38, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
      osc.connect(filter);
      filter.connect(g);
      g.connect(panner);
      osc.start(now);
      osc.stop(now + 0.7);
      return;
    }

    const isAttack = kind === 'attack';
    const baseFreq = isAttack ? 185 : 95 + Math.random() * 45;
    const dur = isAttack ? 0.42 : 0.45;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.68, now + dur);
    filter.type = 'bandpass';
    filter.frequency.value = isAttack ? 780 : 380;
    filter.Q.value = isAttack ? 1.5 : 2.0;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(isAttack ? 0.36 : 0.16, now + 0.035);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + dur + 0.02);

    // Extra sharp rasp layer on pre-strike attack windup so flanking strikes telegraph unmistakably
    if (isAttack && this.noiseBuffer) {
      const rasp = this.ctx.createBufferSource();
      rasp.buffer = this.noiseBuffer;
      const rbp = this.ctx.createBiquadFilter();
      rbp.type = 'bandpass';
      rbp.frequency.setValueAtTime(1150, now);
      rbp.Q.value = 1.6;
      const rg = this.ctx.createGain();
      rg.gain.setValueAtTime(0.001, now);
      rg.gain.linearRampToValueAtTime(0.22, now + 0.05);
      rg.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      rasp.connect(rbp);
      rbp.connect(rg);
      rg.connect(panner);
      rasp.start(now);
      rasp.stop(now + 0.38);
    }
  }

  public playExplosion(x: number, y: number, z: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    const now = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(620, now);
    f.frequency.exponentialRampToValueAtTime(75, now + 0.75);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    src.connect(f);
    f.connect(g);
    g.connect(panner);
    src.start(now);
    src.stop(now + 0.9);
  }

  public playBuy(success: boolean): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (success) {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.07);
      g.gain.setValueAtTime(0.22, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.24);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(145, now);
      osc.frequency.setValueAtTime(118, now + 0.08);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }

  public playPerkJingle(perk: PerkId): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Bottle-cap hiss + fizzy gulp before the jingle
    if (this.noiseBuffer) {
      const hiss = this.ctx.createBufferSource();
      hiss.buffer = this.noiseBuffer;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(3200, now);
      hp.frequency.exponentialRampToValueAtTime(1600, now + 0.09);
      const hg = this.ctx.createGain();
      hg.gain.setValueAtTime(0.18, now);
      hg.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
      hiss.connect(hp);
      hp.connect(hg);
      hg.connect(this.sfxGain);
      hiss.start(now);
      hiss.stop(now + 0.1);
    }
    for (let b = 0; b < 2; b++) {
      const bt = now + 0.09 + b * 0.09;
      const gulp = this.ctx.createOscillator();
      const gg = this.ctx.createGain();
      gulp.type = 'triangle';
      gulp.frequency.setValueAtTime(210 + b * 40, bt);
      gulp.frequency.exponentialRampToValueAtTime(380 + b * 55, bt + 0.065);
      gg.gain.setValueAtTime(0.15, bt);
      gg.gain.exponentialRampToValueAtTime(0.001, bt + 0.075);
      gulp.connect(gg);
      gg.connect(this.sfxGain);
      gulp.start(bt);
      gulp.stop(bt + 0.08);
    }

    const melodies: Record<PerkId, number[]> = {
      ironhide: [261.6, 329.6, 392.0, 523.25, 659.25],
      second_wind: [392.0, 493.88, 587.33, 783.99, 987.77],
      quickhands: [329.6, 440.0, 554.37, 659.25, 880.0],
      twin_barrel: [293.66, 369.99, 440.0, 587.33, 739.99],
      marathon: [349.23, 440.0, 523.25, 698.46, 880.0],
    };
    const notes = melodies[perk];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + 0.22 + idx * 0.1;
      for (const detune of [-4, 4]) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = detune < 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.value = detune;
        g.gain.setValueAtTime(0.11, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
        osc.connect(g);
        g.connect(this.musicGain);
        g.connect(this.reverbNode);
        osc.start(t);
        osc.stop(t + 0.36);
      }
    });
  }

  public playCrateJingle(): void {
    if (!this.ctx) return;
    const notes = [392, 466, 523, 587, 659, 784];
    const now = this.ctx.currentTime;
    notes.forEach((f, i) => {
      if (!this.ctx) return;
      const t = now + i * 0.14;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  public playPowerUp(id: PowerUpId): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (id === 'nuke') {
      const sub = this.ctx.createOscillator();
      const sg = this.ctx.createGain();
      sub.type = 'sawtooth';
      sub.frequency.setValueAtTime(115, now);
      sub.frequency.exponentialRampToValueAtTime(28, now + 0.55);
      sg.gain.setValueAtTime(0.32, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.58);
      sub.connect(sg);
      sg.connect(this.sfxGain);
      sub.start(now);
      sub.stop(now + 0.6);
      return;
    }

    const chordMap: Record<Exclude<PowerUpId, 'nuke'>, number[]> = {
      max_ammo: [440, 554.37, 659.25, 880],
      insta_kill: [329.63, 415.3, 493.88, 659.25],
      double_points: [523.25, 659.25, 783.99, 1046.5],
      carpenter: [392, 493.88, 587.33],
      fire_sale: [587.33, 739.99, 880, 1174.66],
    };

    const notes = chordMap[id];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(g);
      g.connect(this.sfxGain);
      g.connect(this.reverbNode);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  public playRoundStinger(kind: 'start' | 'end' | 'special' | 'brute'): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Deep sub-bass impact boom
    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(kind === 'special' ? 72 : 58, now);
    sub.frequency.exponentialRampToValueAtTime(26, now + 0.85);
    sg.gain.setValueAtTime(0.28, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    sub.connect(sg);
    sg.connect(this.musicGain);
    sub.start(now);
    sub.stop(now + 0.95);

    const chord =
      kind === 'start'
        ? [110, 130.81, 164.81, 207.65, 329.63] // Dark A minor / flat-sixth haunting motif
        : kind === 'end'
          ? [146.83, 174.61, 220, 261.63, 349.23]
          : kind === 'special'
            ? [98, 138.59, 185, 233.08, 369.99] // Tritone feral hound howl chord
            : [65.41, 82.41, 98, 123.47, 196];

    chord.forEach((freq, i) => {
      if (!this.ctx) return;
      const t = now + i * 0.085;
      const body = this.ctx.createOscillator();
      const bell = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const bg = this.ctx.createGain();

      body.type = kind === 'brute' ? 'sawtooth' : 'triangle';
      body.frequency.setValueAtTime(freq, t);
      body.detune.value = i % 2 === 0 ? -5 : 5;

      bell.type = 'sine';
      bell.frequency.setValueAtTime(freq * 2, t);
      bell.detune.value = 3;

      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.19 : 0.14, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.55);

      bg.gain.setValueAtTime(0.001, t);
      bg.gain.linearRampToValueAtTime(0.055, t + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.001, t + 1.15);

      body.connect(g);
      bell.connect(bg);
      g.connect(this.musicGain);
      g.connect(this.reverbNode);
      bg.connect(this.musicGain);
      bg.connect(this.reverbNode);

      body.start(t);
      body.stop(t + 1.6);
      bell.start(t);
      bell.stop(t + 1.2);
    });
  }

  public playSurfaceImpact(surface: SurfaceType, x: number, y: number, z: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    if (dx * dx + dy * dy + dz * dz > 34 * 34) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = surface === 'metal' ? 2800 : surface === 'wood' ? 950 : 1400;
    f.Q.value = surface === 'metal' ? 5.0 : 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    src.connect(f);
    f.connect(g);
    g.connect(panner);
    src.start(now);
    src.stop(now + 0.08);
  }

  public playTrapBuzz(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120 + Math.random() * 40, now);
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  public playRadioChirp(): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1850;
    bp.Q.value = 3.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.1, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.voiceGain);
    src.start(now);
    src.stop(now + 0.1);
  }

  public playBloaterFuseWarning(progress: number, x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    panner.refDistance = 4.5;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    const baseFreq = 320 + progress * 440;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.14);
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playSpawnEruption(x: number, y: number, z: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    if (dx * dx + dz * dz > 22 * 22) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    panner.refDistance = 4.0;
    const now = this.ctx.currentTime;

    const thud = this.ctx.createOscillator();
    const tg = this.ctx.createGain();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(84, now);
    thud.frequency.exponentialRampToValueAtTime(32, now + 0.35);
    tg.gain.setValueAtTime(0.28, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    thud.connect(tg);
    tg.connect(panner);
    thud.start(now);
    thud.stop(now + 0.4);

    const debris = this.ctx.createBufferSource();
    debris.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(620, now);
    bp.frequency.exponentialRampToValueAtTime(140, now + 0.42);
    const dg = this.ctx.createGain();
    dg.gain.setValueAtTime(0.22, now);
    dg.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    debris.connect(bp);
    bp.connect(dg);
    dg.connect(panner);
    debris.start(now);
    debris.stop(now + 0.48);
  }

  public playBruteChargeRoar(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    panner.refDistance = 5.5;
    const now = this.ctx.currentTime;

    for (const detune of [-12, 12]) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(108, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.85);
      osc.detune.value = detune;
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(580, now);
      filter.frequency.exponentialRampToValueAtTime(220, now + 0.85);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.32, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.88);
      osc.connect(filter);
      filter.connect(g);
      g.connect(panner);
      osc.start(now);
      osc.stop(now + 0.9);
    }
  }

  public playChapterAdvance(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [293.66, 369.99, 440, 587.33];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.09;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g);
      g.connect(this.musicGain);
      g.connect(this.reverbNode);
      osc.start(t);
      osc.stop(t + 0.58);
    });
  }

  public playVictoryAnthem(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.11;
      for (const det of [-5, 5]) {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = det < 0 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.detune.value = det;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.45);
        osc.connect(g);
        g.connect(this.musicGain);
        g.connect(this.reverbNode);
        osc.start(t);
        osc.stop(t + 1.5);
      }
    });
  }

  public dispose(): void {
    try {
      this.droneOscA?.stop();
      this.droneOscB?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
  }
}
