import * as THREE from 'three';
import { BALANCE, DIFFICULTY_PRESETS, type DifficultyId, type PerkId } from '../config/balance';
import type { GameSettings } from '../config/settings';
import type { AudioEngine } from '../engine/AudioEngine';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import {
  accelerateWishDir,
  applyGroundFriction,
  formatDamageCallout,
  stepAdsBlend,
  stepSlidePhysics,
} from './combatPhysics';
import type { DamageCallout, DamageSource } from './types';

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
  public readonly position = new THREE.Vector3(-7, 0.9, 22);
  public readonly velocity = new THREE.Vector3();
  public yaw = 0; // looking toward -Z
  public pitch = 0;
  public grounded = true;
  public isCrouching = false;
  public isSprinting = false;
  public isSliding = false;
  public isAds = false;
  public adsBlend = 0;
  public isHoldingBreath = false;

  public health: number = BALANCE.player.maxHealth;
  public maxHealth: number = BALANCE.player.maxHealth;
  public timeSinceDamage = 999;
  public isReviving = false;
  public reviveTimer = 0;
  public damageFlash = 0;
  public damageIndicatorAngle: number | null = null;
  public damageIndicatorAlpha = 0;
  public damageIndicators: { id: number; angle: number; alpha: number; source?: DamageSource }[] = [];
  public damageCallout: DamageCallout | null = null;
  private damageCalloutTimer = 0;
  public weaponLandDip = 0;
  public strafeTilt = 0;

  private recoilPitch = 0;
  private recoilYaw = 0;
  private cameraShake = 0;
  private damageRoll = 0;
  private strafeRoll = 0;
  private slideRoll = 0;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideDirX = 0;
  private slideDirZ = -1;
  private prevCrouchHeld = false;
  private landDip = 0;
  private landDipVel = 0;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private prevJumpHeld = false;
  private wasGrounded = true;
  private prevVelY = 0;
  private nextDamageId = 1;
  private eyeOffset: number = BALANCE.player.eyeHeight;
  private bobTimer = 0;
  private stepAccum = 0;
  private hitGraceTimer = 0;
  private sprintFireCancelTimer = 0;

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
    this.wasGrounded = true;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isSliding = false;
    this.isAds = false;
    this.adsBlend = 0;
    this.isHoldingBreath = false;
    this.health = BALANCE.player.maxHealth;
    this.maxHealth = BALANCE.player.maxHealth;
    this.timeSinceDamage = 999;
    this.isReviving = false;
    this.reviveTimer = 0;
    this.damageFlash = 0;
    this.damageIndicatorAlpha = 0;
    this.damageIndicatorAngle = null;
    this.damageIndicators = [];
    this.damageCallout = null;
    this.damageCalloutTimer = 0;
    this.weaponLandDip = 0;
    this.strafeTilt = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.cameraShake = 0;
    this.damageRoll = 0;
    this.strafeRoll = 0;
    this.slideRoll = 0;
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.slideDirX = 0;
    this.slideDirZ = -1;
    this.prevCrouchHeld = false;
    this.landDip = 0;
    this.landDipVel = 0;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.prevJumpHeld = false;
    this.prevVelY = 0;
    this.meleeCooldown = 0;
    this.knifeAnimTimer = 0;
    this.drinkAnimTimer = 0;
    this.eyeOffset = BALANCE.player.eyeHeight;
    this.bobTimer = 0;
    this.stepAccum = 0;
    this.hitGraceTimer = 0;
    this.sprintFireCancelTimer = 0;
    this.grenades = BALANCE.player.grenadesStart;
  }

  public triggerSprintFireCancel(): void {
    this.sprintFireCancelTimer = 0.22;
    this.isSprinting = false;
  }

  public applyLookDelta(dx: number, dy: number, settings: GameSettings, adsSensScale: number): void {
    const adsScale = THREE.MathUtils.lerp(1, adsSensScale, this.adsBlend);
    const breathScale = this.isHoldingBreath ? 0.85 : 1.0;
    const sens = BALANCE.player.defaultSensitivity * settings.sensitivity * adsScale * breathScale;
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

  public applyExternalPush(vx: number, vz: number): void {
    this.velocity.x = THREE.MathUtils.clamp(this.velocity.x + vx, -9, 9);
    this.velocity.z = THREE.MathUtils.clamp(this.velocity.z + vz, -9, 9);
  }

  public applyKnifeLunge(yaw: number): void {
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    this.velocity.x += fwdX * BALANCE.player.knifeLungeSpeed;
    this.velocity.z += fwdZ * BALANCE.player.knifeLungeSpeed;
  }

  public takeDamage(
    amount: number,
    attackerX: number,
    attackerZ: number,
    perks: Set<PerkId>,
    onConsumeSecondWind: () => void,
    onDeath: () => void,
    source: DamageSource = 'shambler',
    difficulty: DifficultyId = 'survivor',
  ): void {
    if (this.isReviving || this.hitGraceTimer > 0) return;
    const scaledAmount = Math.max(
      1,
      Math.round(amount * (DIFFICULTY_PRESETS[difficulty]?.damageMult ?? 1.0)),
    );
    this.hitGraceTimer = BALANCE.player.hitGraceSeconds;
    this.health = Math.max(0, this.health - scaledAmount);
    this.timeSinceDamage = 0;
    this.damageFlash = 1.0;
    this.cameraShake = Math.min(0.09, this.cameraShake + 0.036);
    this.audio.playPlayerHit();

    const dx = attackerX - this.position.x;
    const dz = attackerZ - this.position.z;
    const dist = Math.hypot(dx, dz);
    const worldAngle = Math.atan2(dx, -dz);
    // Relative angle to player facing
    let relAngle = worldAngle + this.yaw;
    while (relAngle > Math.PI) relAngle -= Math.PI * 2;
    while (relAngle < -Math.PI) relAngle += Math.PI * 2;

    this.damageIndicatorAngle = relAngle;
    this.damageIndicatorAlpha = 1.0;
    this.damageIndicators.push({
      id: this.nextDamageId++,
      angle: relAngle,
      alpha: 1.0,
      source,
    });
    if (this.damageIndicators.length > 4) {
      this.damageIndicators.shift();
    }
    this.damageCallout = {
      text: formatDamageCallout(source, relAngle, scaledAmount),
      amount: scaledAmount,
      alpha: 1.0,
    };
    this.damageCalloutTimer = 2.1;

    // Visceral flinch camera roll & physical knockback shove away from attacker
    const sideSign = Math.sin(relAngle) >= 0 ? 1 : -1;
    this.damageRoll = THREE.MathUtils.clamp(this.damageRoll - sideSign * 0.075, -0.14, 0.14);
    this.recoilPitch += 0.025;
    if (dist > 0.01) {
      this.applyExternalPush((-dx / dist) * 3.4, (-dz / dist) * 3.4);
    }

    if (this.health <= 0) {
      if (perks.has('second_wind')) {
        this.isReviving = true;
        this.isSliding = false;
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
    adsSpeed = 14,
  ): void {
    this.maxHealth = perks.has('ironhide')
      ? BALANCE.player.ironhideMaxHealth
      : BALANCE.player.maxHealth;
    if (this.health > this.maxHealth) this.health = this.maxHealth;

    this.timeSinceDamage += dt;
    const regenDelay =
      BALANCE.player.regenDelay * (DIFFICULTY_PRESETS[settings.difficulty]?.regenDelayMult ?? 1.0);
    if (
      !this.isReviving &&
      this.health > 0 &&
      this.health < this.maxHealth &&
      this.timeSinceDamage >= regenDelay
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

    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.damageIndicatorAlpha = Math.max(0, this.damageIndicatorAlpha - dt * 0.95);
    for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
      const ind = this.damageIndicators[i]!;
      ind.alpha -= dt * 0.9;
      if (ind.alpha <= 0) {
        this.damageIndicators.splice(i, 1);
      }
    }
    if (this.damageCallout && this.damageCalloutTimer > 0) {
      this.damageCalloutTimer -= dt;
      this.damageCallout.alpha = Math.min(1, Math.max(0, this.damageCalloutTimer / 0.85));
      if (this.damageCalloutTimer <= 0) {
        this.damageCallout = null;
      }
    }

    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.knifeAnimTimer = Math.max(0, this.knifeAnimTimer - dt);
    this.drinkAnimTimer = Math.max(0, this.drinkAnimTimer - dt);
    this.hitGraceTimer = Math.max(0, this.hitGraceTimer - dt);
    this.sprintFireCancelTimer = Math.max(0, this.sprintFireCancelTimer - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);

    // Recoil & flinch recovery
    const recDecay = 1 - Math.exp(-14 * dt);
    this.recoilPitch *= 1 - recDecay;
    this.recoilYaw *= 1 - recDecay;
    this.damageRoll = THREE.MathUtils.damp(this.damageRoll, 0, 11, dt);
    this.cameraShake = Math.max(0, this.cameraShake - dt * 0.24);

    // Coyote time & jump buffer
    if (this.grounded) {
      this.coyoteTimer = 0.11;
    } else {
      this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    }
    const jumpJustPressed = input.jump && !this.prevJumpHeld;
    this.prevJumpHeld = input.jump;
    if (jumpJustPressed) {
      this.jumpBufferTimer = 0.12;
    } else {
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    }

    const crouchJustPressed = input.crouch && !this.prevCrouchHeld;
    this.prevCrouchHeld = input.crouch;

    // Horizontal wish direction
    this.forwardVec.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.wishDir.set(0, 0, 0);
    if (input.forward) this.wishDir.add(this.forwardVec);
    if (input.backward) this.wishDir.sub(this.forwardVec);
    if (input.right) this.wishDir.add(this.rightVec);
    if (input.left) this.wishDir.sub(this.rightVec);
    if (this.wishDir.lengthSq() > 0) this.wishDir.normalize();

    const hasMarathon = perks.has('marathon');
    const preHorizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = input.forward || input.backward || input.left || input.right;

    this.isAds = input.ads && !this.isReviving;
    const effectiveAdsSpeed = adsSpeed * (perks.has('quickhands') ? 1.35 : 1.0);
    this.adsBlend = stepAdsBlend(this.adsBlend, this.isAds, effectiveAdsSpeed, dt);
    this.isHoldingBreath = this.isAds && this.adsBlend > 0.65 && input.sprint && !this.isReviving;

    // Tactical Sprint-Slide trigger
    if (
      this.grounded &&
      !this.isReviving &&
      !this.isSliding &&
      this.slideCooldown <= 0 &&
      !this.isAds &&
      crouchJustPressed &&
      (this.isSprinting || preHorizSpeed >= BALANCE.player.slideMinTriggerSpeed)
    ) {
      let sx = this.wishDir.lengthSq() > 0.01 && !input.backward ? this.wishDir.x : this.forwardVec.x;
      let sz = this.wishDir.lengthSq() > 0.01 && !input.backward ? this.wishDir.z : this.forwardVec.z;
      const slen = Math.hypot(sx, sz) || 1;
      sx /= slen;
      sz /= slen;
      const slideSpeed = BALANCE.player.slideInitialSpeed * (hasMarathon ? 1.12 : 1.0);
      this.isSliding = true;
      this.slideTimer = BALANCE.player.slideDuration;
      this.slideDirX = sx;
      this.slideDirZ = sz;
      this.velocity.x = sx * slideSpeed;
      this.velocity.z = sz * slideSpeed;
      this.audio.playSlide();
      this.cameraShake = Math.min(0.05, this.cameraShake + 0.012);
    }

    this.isCrouching = input.crouch && !this.isSliding;
    this.isSprinting =
      input.sprint &&
      moving &&
      !input.backward &&
      !input.crouch &&
      !this.isSliding &&
      !this.isAds &&
      !this.isReviving &&
      this.sprintFireCancelTimer <= 0;

    let maxSpeed = BALANCE.player.walkSpeed;
    if (this.isCrouching) {
      maxSpeed = BALANCE.player.crouchSpeed * (hasMarathon ? 1.35 : 1.0);
    } else if (this.isSprinting) {
      maxSpeed = BALANCE.player.sprintSpeed * (hasMarathon ? 1.15 : 1.0);
    } else if (this.isAds) {
      maxSpeed = BALANCE.player.walkSpeed * THREE.MathUtils.lerp(1.0, 0.72, this.adsBlend);
    }

    if (!this.isReviving) {
      // Slide-jump cancel & ADS slide-cancel
      if (this.isSliding) {
        if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0) {
          this.isSliding = false;
          this.slideTimer = 0;
          this.slideCooldown = BALANCE.player.slideCooldown * 0.65;
          this.velocity.y = BALANCE.player.jumpSpeed;
          this.grounded = false;
          this.coyoteTimer = 0;
          this.jumpBufferTimer = 0;
          this.audio.playFootstep(true);
        } else if (this.isAds || !this.grounded) {
          this.isSliding = false;
          this.slideTimer = 0;
          this.slideCooldown = BALANCE.player.slideCooldown * 0.65;
        }
      }

      if (this.isSliding) {
        const slideRes = stepSlidePhysics({
          vx: this.velocity.x,
          vz: this.velocity.z,
          dirX: this.slideDirX,
          dirZ: this.slideDirZ,
          wishX: this.wishDir.x,
          wishZ: this.wishDir.z,
          slideTimer: this.slideTimer,
          minSpeed: BALANCE.player.crouchSpeed * 1.35,
          dt,
        });
        this.velocity.x = slideRes.vx;
        this.velocity.z = slideRes.vz;
        this.slideTimer = slideRes.nextTimer;
        if (slideRes.ended) {
          this.isSliding = false;
          this.slideCooldown = BALANCE.player.slideCooldown;
        }
      } else {
        if (this.grounded) {
          const fric = applyGroundFriction(
            this.velocity.x,
            this.velocity.z,
            BALANCE.player.friction,
            BALANCE.player.stopSpeed,
            dt,
          );
          this.velocity.x = fric.vx;
          this.velocity.z = fric.vz;
        }
        const accel = this.grounded ? BALANCE.player.groundAccel : BALANCE.player.airAccel;
        const wishSpeed = this.grounded ? maxSpeed : Math.min(maxSpeed, BALANCE.player.walkSpeed);
        const accelRes = accelerateWishDir(
          this.velocity.x,
          this.velocity.z,
          this.wishDir.x,
          this.wishDir.z,
          wishSpeed,
          accel,
          dt,
        );
        this.velocity.x = accelRes.vx;
        this.velocity.z = accelRes.vz;

        if (this.coyoteTimer > 0 && this.jumpBufferTimer > 0 && !this.isCrouching) {
          this.velocity.y = BALANCE.player.jumpSpeed;
          this.grounded = false;
          this.coyoteTimer = 0;
          this.jumpBufferTimer = 0;
        }
      }
    } else {
      this.isSliding = false;
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    this.prevVelY = this.velocity.y;
    this.velocity.y -= BALANCE.player.gravity * dt;

    // Step Rapier capsule controller
    const res = this.physics.movePlayer(
      this.velocity.x * dt,
      this.velocity.y * dt,
      this.velocity.z * dt,
    );
    this.position.set(res.x, res.y, res.z);
    this.grounded = res.grounded;

    // Landing camera/weapon squash dip
    if (!this.wasGrounded && this.grounded && this.prevVelY < -2.2) {
      const impact = Math.min(1.0, Math.abs(this.prevVelY) / 9.5);
      this.landDipVel -= impact * 1.35;
      this.audio.playFootstep(false);
    }
    this.wasGrounded = this.grounded;

    if (this.grounded && this.velocity.y < 0) {
      this.velocity.y = -1.2;
    }

    // Spring-damper for landing dip
    const springForce = -this.landDip * 140 - this.landDipVel * 18;
    this.landDipVel += springForce * dt;
    this.landDip = THREE.MathUtils.clamp(this.landDip + this.landDipVel * dt, -0.14, 0.04);
    this.weaponLandDip = this.landDip * 0.45;

    // Subtle strafe + slide camera roll
    const strafeInput = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const targetRoll = -strafeInput * THREE.MathUtils.lerp(0.022, 0.007, this.adsBlend);
    this.strafeRoll = THREE.MathUtils.damp(this.strafeRoll, targetRoll, 12, dt);
    this.slideRoll = THREE.MathUtils.damp(this.slideRoll, this.isSliding ? -0.048 : 0, 14, dt);
    this.strafeTilt = this.strafeRoll + this.slideRoll;

    // Smooth eye height & head bob
    const targetEye = this.isSliding
      ? BALANCE.player.slideEyeHeight
      : this.isCrouching
        ? BALANCE.player.crouchEyeHeight
        : BALANCE.player.eyeHeight;
    this.eyeOffset = THREE.MathUtils.damp(this.eyeOffset, targetEye, this.isSliding ? 18 : 14, dt);

    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let bobY = 0;
    let bobX = 0;
    if (this.grounded && !this.isSliding && horizSpeed > 0.5) {
      const cadence = this.isSprinting ? 13.5 : 9.0;
      this.bobTimer += dt * cadence;
      this.stepAccum += dt * horizSpeed;
      if (this.stepAccum >= (this.isSprinting ? 1.85 : 1.55)) {
        this.stepAccum = 0;
        this.audio.playFootstep(this.isSprinting);
      }
      if (settings.headBob) {
        const baseAmp = this.isSprinting ? 0.05 : 0.03;
        const amp = THREE.MathUtils.lerp(baseAmp, 0.007, this.adsBlend) * (this.isHoldingBreath ? 0.4 : 1);
        bobY = Math.sin(this.bobTimer * 2) * amp;
        bobX = Math.cos(this.bobTimer) * amp * 0.65;
      }
    }

    // Apply camera transform (capsule center is at height/2 = 0.9 above feet)
    const feetY = this.position.y - BALANCE.player.capsuleHeight * 0.5;
    const shakeScale = this.isHoldingBreath ? 0.5 : 1;
    const shakeX = (Math.random() - 0.5) * this.cameraShake * shakeScale;
    const shakeY = (Math.random() - 0.5) * this.cameraShake * shakeScale;

    camera.position.set(
      this.position.x + this.rightVec.x * bobX,
      feetY + this.eyeOffset + bobY + this.landDip,
      this.position.z + this.rightVec.z * bobX,
    );

    this.euler.set(
      this.pitch + this.recoilPitch + shakeY,
      this.yaw + this.recoilYaw + shakeX,
      this.strafeRoll + this.slideRoll + this.damageRoll,
      'YXZ',
    );
    camera.quaternion.setFromEuler(this.euler);

    // Smooth FOV transition driven by adsBlend, Sprint, Slide & Longbow Breath-Hold
    const baseRunFov = this.isSliding
      ? settings.fov + 9
      : this.isSprinting
        ? settings.fov + 6
        : settings.fov;
    const breathFovTrim = this.isHoldingBreath ? 6 : 0;
    const adsTargetFov = Math.min(settings.fov, Math.max(34, targetAdsFov - breathFovTrim));
    const desiredFov = THREE.MathUtils.lerp(baseRunFov, adsTargetFov, this.adsBlend);
    if (Math.abs(camera.fov - desiredFov) > 0.04) {
      camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 15, dt);
      camera.updateProjectionMatrix();
    }
  }

  public getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    const feetY = this.position.y - BALANCE.player.capsuleHeight * 0.5;
    return out.set(this.position.x, feetY + this.eyeOffset, this.position.z);
  }
}
