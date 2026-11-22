import * as THREE from 'three';
import { BALANCE, type PerkId } from '../config/balance';
import type { GameSettings } from '../config/settings';
import type { AudioEngine } from '../engine/AudioEngine';
import type { PhysicsWorld } from '../engine/PhysicsWorld';

export interface PlayerInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  interactHeld: boolean;
  meleePressed: boolean;
  grenadePressed: boolean;
  swapPressed: boolean;
}

export class PlayerController {
  public readonly position = new THREE.Vector3(-7, 0.9, 18);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0; // looking toward -Z
  public pitch = 0;
  public grounded = true;
  public isCrouching = false;
  public isSprinting = false;
  public isAds = false;

  public health: number = BALANCE.player.maxHealth;
  public maxHealth: number = BALANCE.player.maxHealth;
  public timeSinceDamage = 999;
  public isReviving = false;
  public reviveTimer = 0;
  public damageFlash = 0;
  public damageIndicatorAngle: number | null = null;
  public damageIndicatorAlpha = 0;

  private recoilPitch = 0;
  private recoilYaw = 0;
  private cameraShake = 0;
  private eyeOffset: number = BALANCE.player.eyeHeight;
  private bobTimer = 0;
  private stepAccum = 0;

  public meleeCooldown = 0;
  public knifeAnimTimer = 0;
  public drinkAnimTimer = 0;
  public drinkPerkColor = 0x22c55e;
  public grenades: number = BALANCE.player.grenadesStart;

  private readonly forwardVec = new THREE.Vector3();
  private readonly rightVec = new THREE.Vector3();
  private readonly wishDir = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');

  private readonly physics: PhysicsWorld;
  private readonly audio: AudioEngine;

  constructor(physics: PhysicsWorld, audio: AudioEngine) {
    this.physics = physics;
    this.audio = audio;
  }

  public reset(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.grounded = true;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isAds = false;
    this.health = BALANCE.player.maxHealth;
    this.maxHealth = BALANCE.player.maxHealth;
    this.timeSinceDamage = 999;
    this.isReviving = false;
    this.reviveTimer = 0;
    this.damageFlash = 0;
    this.damageIndicatorAlpha = 0;
    this.damageIndicatorAngle = null;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.cameraShake = 0;
    this.meleeCooldown = 0;
    this.knifeAnimTimer = 0;
    this.drinkAnimTimer = 0;
    this.grenades = BALANCE.player.grenadesStart;
  }

  public applyLookDelta(dx: number, dy: number, settings: GameSettings, adsSensScale: number): void {
    const sens = BALANCE.player.defaultSensitivity * settings.sensitivity * (this.isAds ? adsSensScale : 1);
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const maxPitch = (85 * Math.PI) / 180;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
  }

  public addRecoil(pitchKick: number, yawKick: number, shake: number): void {
    this.recoilPitch += pitchKick;
    this.recoilYaw += yawKick;
    this.cameraShake = Math.min(0.08, this.cameraShake + shake);
  }

  public addCameraShake(amount: number): void {
    this.cameraShake = Math.min(0.12, this.cameraShake + amount);
  }

  public takeDamage(
    amount: number,
    attackerX: number,
    attackerZ: number,
    perks: Set<PerkId>,
    onConsumeSecondWind: () => void,
    onDeath: () => void,
  ): void {
    if (this.isReviving) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;
    this.damageFlash = 1.0;
    this.cameraShake = Math.min(0.1, this.cameraShake + 0.045);

    const dx = attackerX - this.position.x;
    const dz = attackerZ - this.position.z;
    const worldAngle = Math.atan2(dx, -dz);
    // Relative angle to player facing
    this.damageIndicatorAngle = worldAngle + this.yaw;
    this.damageIndicatorAlpha = 1.0;

    if (this.health <= 0) {
      if (perks.has('second_wind')) {
        this.isReviving = true;
        this.reviveTimer = BALANCE.player.secondWindDuration;
        this.health = 25;
        perks.delete('second_wind');
        this.maxHealth = perks.has('ironhide')
          ? BALANCE.player.ironhideMaxHealth
          : BALANCE.player.maxHealth;
        onConsumeSecondWind();
      } else {
        onDeath();
      }
    }
  }

  public update(
    dt: number,
    input: PlayerInputState,
    perks: Set<PerkId>,
    settings: GameSettings,
    camera: THREE.PerspectiveCamera,
    targetAdsFov: number,
  ): void {
    this.maxHealth = perks.has('ironhide')
      ? BALANCE.player.ironhideMaxHealth
      : BALANCE.player.maxHealth;
    if (this.health > this.maxHealth) this.health = this.maxHealth;

    this.timeSinceDamage += dt;
    if (
      !this.isReviving &&
      this.health > 0 &&
      this.health < this.maxHealth &&
      this.timeSinceDamage >= BALANCE.player.regenDelay
    ) {
      const rate = this.maxHealth / BALANCE.player.regenDuration;
      this.health = Math.min(this.maxHealth, this.health + rate * dt);
    }

    if (this.isReviving) {
      this.reviveTimer -= dt;
      if (this.reviveTimer <= 0) {
        this.isReviving = false;
        this.health = this.maxHealth;
      }
    }

    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.6);
    this.damageIndicatorAlpha = Math.max(0, this.damageIndicatorAlpha - dt * 1.1);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.knifeAnimTimer = Math.max(0, this.knifeAnimTimer - dt);
    this.drinkAnimTimer = Math.max(0, this.drinkAnimTimer - dt);

    // Recoil recovery
    const recDecay = 1 - Math.exp(-14 * dt);
    this.recoilPitch *= 1 - recDecay;
    this.recoilYaw *= 1 - recDecay;
    this.cameraShake = Math.max(0, this.cameraShake - dt * 0.24);

    // Movement state
    this.isCrouching = input.crouch;
    const moving = input.forward || input.backward || input.left || input.right;
    this.isAds = input.ads && !this.isReviving;
    this.isSprinting =
      input.sprint &&
      input.forward &&
      !this.isCrouching &&
      !this.isAds &&
      !this.isReviving &&
      moving;

    const hasMarathon = perks.has('marathon');
    let maxSpeed = BALANCE.player.walkSpeed;
    if (this.isCrouching) {
      maxSpeed = BALANCE.player.crouchSpeed * (hasMarathon ? 1.35 : 1.0);
    } else if (this.isSprinting) {
      maxSpeed = BALANCE.player.sprintSpeed * (hasMarathon ? 1.15 : 1.0);
    } else if (this.isAds) {
      maxSpeed = BALANCE.player.walkSpeed * 0.68;
    }

    // Horizontal wish direction
    this.forwardVec.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.wishDir.set(0, 0, 0);
    if (input.forward) this.wishDir.add(this.forwardVec);
    if (input.backward) this.wishDir.sub(this.forwardVec);
    if (input.right) this.wishDir.add(this.rightVec);
    if (input.left) this.wishDir.sub(this.rightVec);
    if (this.wishDir.lengthSq() > 0) this.wishDir.normalize();

    const accel = this.grounded ? BALANCE.player.groundAccel : BALANCE.player.airAccel;
    if (this.grounded) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 0.001) {
        const drop = speed * BALANCE.player.friction * dt;
        const newSpeed = Math.max(0, speed - drop) / speed;
        this.velocity.x *= newSpeed;
        this.velocity.z *= newSpeed;
      }
    }

    if (!this.isReviving) {
      this.velocity.x += (this.wishDir.x * maxSpeed - this.velocity.x) * Math.min(1, accel * dt);
      this.velocity.z += (this.wishDir.z * maxSpeed - this.velocity.z) * Math.min(1, accel * dt);
      if (this.grounded && input.jump && !this.isCrouching) {
        this.velocity.y = BALANCE.player.jumpSpeed;
        this.grounded = false;
      }
    } else {
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    this.velocity.y -= BALANCE.player.gravity * dt;

    // Step Rapier capsule controller
    const res = this.physics.movePlayer(
      this.velocity.x * dt,
      this.velocity.y * dt,
      this.velocity.z * dt,
    );
    this.position.set(res.x, res.y, res.z);
    this.grounded = res.grounded;
    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -1.2;
    }

    // Smooth eye height & head bob
    const targetEye = this.isCrouching
      ? BALANCE.player.crouchEyeHeight
      : BALANCE.player.eyeHeight;
    this.eyeOffset = THREE.MathUtils.damp(this.eyeOffset, targetEye, 14, dt);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let bobY = 0;
    let bobX = 0;
    if (this.grounded && horizSpeed > 0.5) {
      const cadence = this.isSprinting ? 13.5 : 9.0;
      this.bobTimer += dt * cadence;
      this.stepAccum += dt * horizSpeed;
      if (this.stepAccum >= (this.isSprinting ? 1.85 : 1.55)) {
        this.stepAccum = 0;
        this.audio.playFootstep(this.isSprinting);
      }
      if (settings.headBob) {
        const amp = this.isSprinting ? 0.052 : this.isAds ? 0.012 : 0.032;
        bobY = Math.sin(this.bobTimer * 2) * amp;
        bobX = Math.cos(this.bobTimer) * amp * 0.65;
      }
    }

    // Apply camera transform (capsule center is at height/2 = 0.9 above feet)
    const feetY = this.position.y - BALANCE.player.capsuleHeight * 0.5;
    const shakeX = (Math.random() - 0.5) * this.cameraShake;
    const shakeY = (Math.random() - 0.5) * this.cameraShake;

    camera.position.set(
      this.position.x + this.rightVec.x * bobX,
      feetY + this.eyeOffset + bobY,
      this.position.z + this.rightVec.z * bobX,
    );

    this.euler.set(
      this.pitch + this.recoilPitch + shakeY,
      this.yaw + this.recoilYaw + shakeX,
      0,
      'YXZ',
    );
    camera.quaternion.setFromEuler(this.euler);

    // Smooth FOV transition for ADS & Sprint
    const desiredFov = this.isAds
      ? Math.min(settings.fov, targetAdsFov)
      : this.isSprinting
        ? settings.fov + 4
        : settings.fov;
    if (Math.abs(camera.fov - desiredFov) > 0.05) {
      camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 14, dt);
      camera.updateProjectionMatrix();
    }
  }

  public getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    const feetY = this.position.y - BALANCE.player.capsuleHeight * 0.5;
    return out.set(this.position.x, feetY + this.eyeOffset, this.position.z);
  }
}
