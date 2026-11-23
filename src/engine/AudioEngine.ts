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
    const pitchMod = (upgraded ? 1.24 : 1.0) * (0.96 + Math.random() * 0.08);

    // Layer 1: Low-end punch body
    const punch = this.ctx.createOscillator();
    const punchGain = this.ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(p.pitch * pitchMod, now);
    punch.frequency.exponentialRampToValueAtTime(34, now + 0.09);
    punchGain.gain.setValueAtTime(p.gain, now);
    punchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    punch.connect(punchGain);
    punchGain.connect(this.sfxGain);
    punch.start(now);
    punch.stop(now + 0.12);

    // Layer 2: Noise blast crack
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(p.crackFreq * pitchMod, now);
    bp.Q.value = 0.85;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(p.gain * 0.9, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + p.bodyDur);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.sfxGain);
    nGain.connect(this.reverbNode);
    noise.start(now);
    noise.stop(now + p.bodyDur + 0.02);

    // Layer 3: Overclock harmonic sheen when upgraded
    if (upgraded) {
      const shimmer = this.ctx.createOscillator();
      const sGain = this.ctx.createGain();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(1420, now);
      shimmer.frequency.exponentialRampToValueAtTime(420, now + 0.14);
      sGain.gain.setValueAtTime(0.11, now);
      sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      shimmer.connect(sGain);
      sGain.connect(this.sfxGain);
      shimmer.start(now);
      shimmer.stop(now + 0.16);
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
    osc.type = 'sine';
    osc.frequency.setValueAtTime(headshot ? 1680 : 980, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 2350 : 620, now + 0.055);
    g.gain.setValueAtTime(headshot ? 0.22 : 0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.07);
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

  public playZombieSound(
    kind: 'groan' | 'attack' | 'hound' | 'brute',
    x: number,
    y: number,
    z: number,
  ): void {
    if (!this.ctx) return;
    const panner = this.createPanner(x, y, z);
    if (!panner) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();

    if (kind === 'hound') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240 + Math.random() * 60, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);
      filter.type = 'bandpass';
      filter.frequency.value = 650;
      g.gain.setValueAtTime(0.24, now);
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

    const baseFreq = kind === 'attack' ? 165 : 95 + Math.random() * 45;
    const dur = kind === 'attack' ? 0.28 : 0.45;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.68, now + dur);
    filter.type = 'bandpass';
    filter.frequency.value = kind === 'attack' ? 580 : 380;
    filter.Q.value = 2.0;
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(kind === 'attack' ? 0.24 : 0.16, now + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(filter);
    filter.connect(g);
    g.connect(panner);
    osc.start(now);
    osc.stop(now + dur + 0.02);
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
    const melodies: Record<PerkId, number[]> = {
      ironhide: [261.6, 329.6, 392.0, 523.25],
      second_wind: [392.0, 493.88, 587.33, 783.99],
      quickhands: [329.6, 440.0, 554.37, 659.25],
      twin_barrel: [293.66, 369.99, 440.0, 587.33],
      marathon: [349.23, 440.0, 523.25, 698.46],
    };
    const notes = melodies[perk];
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = now + idx * 0.11;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 0.25);
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
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = id === 'nuke' ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(id === 'nuke' ? 120 : 440, now);
    osc.frequency.exponentialRampToValueAtTime(id === 'nuke' ? 35 : 880, now + 0.35);
    g.gain.setValueAtTime(0.26, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.42);
  }

  public playRoundStinger(kind: 'start' | 'end' | 'special' | 'brute'): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const chord =
      kind === 'start'
        ? [110, 130.8, 164.8]
        : kind === 'end'
          ? [146.8, 174.6, 220]
          : kind === 'special'
            ? [98, 138.6, 185]
            : [65.4, 82.4, 98];

    chord.forEach((freq, i) => {
      if (!this.ctx) return;
      const t = now + i * 0.08;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = kind === 'brute' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      osc.connect(g);
      g.connect(this.musicGain);
      osc.start(t);
      osc.stop(t + 1.15);
    });
  }

  public playSurfaceImpact(surface: SurfaceType, x: number, y: number, z: number): void {
    if (!this.ctx || !this.noiseBuffer) return;
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
