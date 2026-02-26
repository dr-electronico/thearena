# Hunger Games: The Arena — Game Architecture

> **Last updated:** 2026-02-26  
> **Source files:** `realWorldSim.html` (742 lines) · `realWorldSim.js` (1 687 lines)  
> This document is the single source of truth for every agent or developer continuing work on this project. Read it fully before making changes.

---

## Table of Contents

1. [Project Overview](#1-project-overview)  
2. [File Structure](#2-file-structure)  
3. [Technology Stack](#3-technology-stack)  
4. [HTML Layer — `realWorldSim.html`](#4-html-layer)  
5. [Game Class — `RealWorldSim`](#5-game-class)  
6. [Initialization Flow](#6-initialization-flow)  
7. [World & Environment](#7-world--environment)  
8. [Player System](#8-player-system)  
9. [Controls & Input](#9-controls--input)  
10. [Physics & Collision](#10-physics--collision)  
11. [Camera System](#11-camera-system)  
12. [Combat System](#12-combat-system)  
13. [Projectile Physics](#13-projectile-physics)  
14. [Survival System](#14-survival-system)  
15. [Inventory System](#15-inventory-system)  
16. [Minimap System](#16-minimap-system)  
17. [Animation System](#17-animation-system)  
18. [Spatial Hash — Performance Pattern](#18-spatial-hash)  
19. [HUD & UI IDs Reference](#19-hud--ui-ids-reference)  
20. [Key Constants & Tuning Values](#20-key-constants--tuning-values)  
21. [Coding Conventions & Patterns](#21-coding-conventions--patterns)  
22. [Known Architecture Decisions & Gotchas](#22-known-architecture-decisions--gotchas)  

---

## 1. Project Overview

A single-page, browser-based Hunger Games arena survival simulator. The player spawns in a circular forest arena, picks up weapons from crates near the Cornucopia, and can fire arrows/spears with realistic projectile physics.

**Genre:** First/Third-person open-world survival shooter  
**Rendering:** Three.js (r160) — WebGL  
**No build step.** Open `realWorldSim.html` in a browser to run.

---

## 2. File Structure

```
spike-game/
├── realWorldSim.html   # Entry point — CSS, HUD markup, start overlay, script loader
├── realWorldSim.js     # Entire game logic — single class RealWorldSim
└── game_architecture.md  # This document
```

There are **no external JavaScript dependencies** except Three.js loaded from a CDN:

```html
<script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
```

---

## 3. Technology Stack

| Concern | Technology |
|---|---|
| 3-D rendering | Three.js r160 (`THREE.*`) |
| Physics | Custom hand-written (no cannon.js etc.) |
| Fonts | Google Fonts — `Cinzel` (display), `Inter` (UI) |
| CSS | Vanilla CSS (in `<style>` block inside HTML) |
| JS pattern | Single ES6 `class RealWorldSim` — no modules, no bundler |
| Asset textures | Procedural `<canvas>` (no image files) |
| Background image | Unsplash URL (used only in the start overlay) |

---

## 4. HTML Layer

### 4.1 Structure

```
body
├── #overlay              ← Full-screen start / character-select screen
│   ├── .overlay-bg       ← Forest background image (opacity 0.12)
│   ├── .overlay-vignette ← Radial black vignette
│   └── .overlay-content
│       ├── h1 "THE ARENA"
│       ├── #step1        ← Character selection step
│       │   ├── #card-male   onclick="selectChar('male')"
│       │   ├── #card-female onclick="selectChar('female')"
│       │   └── #nextBtn     onclick="startGame()"
├── #hud                  ← Top-center control hints bar
├── #camBadge             ← Bottom-right camera mode indicator
├── #gameContainer        ← Three.js canvas is appended here
├── #crosshair            ← CSS-only crosshair (::before / ::after)
├── #minimap-wrap         ← Circular minimap container
│   └── #minimap          ← <canvas> 180×180
├── #minimap-label        ← "MAP" text label
├── #minimap-north        ← "N" north indicator
├── #survival-hud         ← HP/Hydration/Hunger bars (bottom-left)
├── #inventory-hud        ← 5 weapon slots (bottom-center)
├── #pickup-hint          ← "[E] Open crate" tooltip
├── #aim-overlay          ← Full-screen vignette + aim crosshair (RMB)
└── #charge-wrap          ← Charge power bar (LMB hold)
    ├── #charge-label
    └── #charge-bar-bg → #charge-bar-fill
```

### 4.2 Inline Scripts

Only two global functions exist in the HTML `<script>` block:

```js
selectChar(type)  // Sets selectedChar, toggles .selected on char cards, enables nextBtn
startGame()       // Hides overlay, shows all HUD elements, creates window.game = new RealWorldSim(selectedChar)
```

`window.game` is the single global game instance.

### 4.3 CSS Design Tokens

| Token / Variable | Value |
|---|---|
| Primary accent | `#e74c3c` (Hunger Games red) |
| Background dark | `#0a0a0a` |
| Font — display | `'Cinzel', serif` |
| Font — UI | `'Inter', system-ui, sans-serif` |
| Overlay gradient | `linear-gradient(160deg, #0a0a0a 0%, #1a0a0a 50%, #0a0a0a 100%)` |

All HUD elements are `pointer-events: none` during gameplay. They are shown/hidden by toggling `display` style in `startGame()`.

---

## 5. Game Class

**File:** `realWorldSim.js`  
**Class:** `RealWorldSim`  
**Instantiation:** `new RealWorldSim(gender)` where `gender` is `'male'` or `'female'`.

### 5.1 Constructor Fields (state summary)

```js
// Three.js core
this.scene, this.camera, this.renderer, this.ground, this.sun

// Player object (not a Three.js object — plain data)
this.player = {
    position: THREE.Vector3,  // x,z = world pos; y = EYE height (= feet + height)
    speed: 0.16,              // base movement per frame
    rotationX: 0,             // pitch (clamped ±90°)
    rotationY: 0,             // yaw
    height: 1.7,              // standing eye-height
    crouchHeight: 1.0,        // crouching eye-height
    verticalVelocity: 0,
    isOnGround: true,
    isCrouching: false
}

// Gender
this.gender                   // 'male' | 'female'

// Input
this.keys = {}                // keyed by e.key.toLowerCase()
this.mouse = { x, y }        // consumed each frame (reset to 0 after applying)

// Camera
this.cameraMode               // 'first' | 'third'
this.thirdPersonOffset        // THREE.Vector3(0, 3, 6) — not actively used, manual calc in updateCamera

// World data
this.forestData[]             // { type:'tree', x, z, r } — for collision + minimap
this.rockData[]               // { type:'rock', x, z, r, topY }
this.spatialHash{}            // grid-based lookup (cell size 20 units)
this.cellSize = 20
this.pedestals[]              // { x, z, r:1.2, h:0.6 }
this.arenaRadius = 600
this.riverCurve               // THREE.CatmullRomCurve3 — stored for minimap + water detection
this.solidBoxes[]             // AABB for Cornucopia walls: { x1,x2,z1,z2,h }

// Animation
this.animTime = 0
this.isSprinting = false
this.lastWTap = 0             // timestamp of last W keydown (double-tap sprint)
this.doubleTapWindow = 300    // ms

// Survival stats (0–100)
this.health, this.hydration, this.hunger
this.survivalTimer = 0        // accumulator, ticks every 1s

// Inventory
this.inventory[5]             // null | { type: string, icon: emoji }
this.activeSlot = 0
this.heldWeaponMesh           // THREE.Group attached to camera or armR
this.weaponItems[]            // pickupable crates: { mesh, x, z, type, icon }

// Combat
this.isCharging = false
this.chargeStart = 0          // performance.now() timestamp
this.chargeAmount = 0         // 0–1
this.maxChargeTime = 1.8      // seconds to reach 100%
this.projectiles[]            // flying/stuck objects (see §13)
this.weaponRecoil = 0         // 0–1, decays per frame

// Aim / Zoom
this.isAiming = false
this.normalFOV = 75
this.aimFOV = 32
this.currentFOV = 75          // smoothly interpolated

// Mesh references
this.playerMesh               // THREE.Group (humanoid)
this.meshParts = { torso, head, hair, legL, legR, armL, armR, shoeL, shoeR }

// Clock
this.clock                    // THREE.Clock — used for dt
```

---

## 6. Initialization Flow

```
new RealWorldSim(gender)
  └── init()
        ├── setupScene()       → scene, camera, renderer, lights → DOM
        ├── setupControls()    → keyboard, mouse, scroll, mousedown/up listeners
        ├── createWorld()
        │     ├── generateTextures()   → grass, water, bark CanvasTextures
        │     ├── createRiver()
        │     ├── createRiverRocks()
        │     ├── createPedestals()
        │     ├── createCornucopia()
        │     ├── createForest()
        │     └── createBorderWall()
        ├── createPlayerMesh() → humanoid THREE.Group, stored in this.playerMesh
        ├── setupMinimap()     → grabs canvas element, sets minimapViewRange
        └── loop()             → requestAnimationFrame loop
                └── update() → render()
```

---

## 7. World & Environment

### 7.1 Coordinate System

- **Y is up.** Ground is at `y = 0`.  
- **Origin (0,0,0):** Center of the pedestal ring.  
- Camera/player `position.y` equals **eye height** (feet + height), not feet level.

### 7.2 Arena

- Circular ground: `CircleGeometry(600, 64)`, rotated `−π/2` on X.  
- Border wall: `CylinderGeometry(606, 606, 80, 128, 1, true)` with `BackSide` material — renders as inner stone wall.  
- Wall cap: `RingGeometry` at top of wall.

### 7.3 River

- Defined by `CatmullRomCurve3` along points: for `i` in `[-600, 600]` step 20, `z = sin(i/150)*120 + 350`.
- Width: **70 units**, Depth trench: **15 units** below ground.
- Water surface at `y = 0.05`.
- River detection formula (used every frame):  
  ```js
  const riverZCenter = Math.sin(player.x / 150) * 120 + 350;
  const overRiver = Math.abs(player.z - riverZCenter) < 35;
  ```
- Stored in `this.riverCurve` for minimap rendering.

### 7.4 Forest

- **2000 trees** placed randomly at distance 40–520 from center, avoiding the river zone (`|z - riverZ| < 60`).
- 50/50 split between **regular trees** (cone leaves) and **pine trees** (sphere leaves).
- Rendered with `InstancedMesh` (4 instances total — trunkInst, leavesInst, pineTrunkInst, pineLeavesInst).
- Each tree stored in `forestData[]` and `spatialHash` as `{ type:'tree', x, z, r:0.8 }`.

### 7.5 Cornucopia

- Offset: `OX=0, OZ=-45` (directly ahead of pedestal ring toward -Z).
- Built from `BoxGeometry` + `ConeGeometry` primitives — no external models.
- Has 5 AABB solid wall colliders stored in `solidBoxes[]`.
- **11 weapon crates** placed around it (positions relative to `OX, OZ`).

### 7.6 Pedestals

- **24 pedestals** in a circle of radius **15** around origin.
- Each: `CylinderGeometry(1.2, 1.2, 0.6, 16)`, at `y=0.3`.
- Stored as `{ x, z, r:1.2, h:0.6 }` in `this.pedestals[]`.

### 7.7 Procedural Textures

All textures are generated via `generateTextures()` using `<canvas>` + `THREE.CanvasTexture`:

| Texture | Description | Repeat |
|---|---|---|
| `grass` | Dark green base + random dark dots | `(150, 150)` |
| `water` | Teal base + white wavy stroke lines | `(1, 15)` |
| `bark` | Brown base + dark vertical streaks | default |

### 7.8 Lighting

- `AmbientLight(0xffffff, 0.6)`
- `HemisphereLight(0x87ceeb sky, 0x3d4d1f ground, 0.6)`
- `DirectionalLight(0xffffff, 1.5)` at `(100, 200, 100)` — casts shadows, follows player target.
- Shadow map: `BasicShadowMap`, `1024×1024`, covers `±200` units.
- Fog: `FogExp2(0x87ceeb, 0.004)`.
- Sky color: `scene.background = 0x87ceeb`.

---

## 8. Player System

### 8.1 Player Object

`this.player` is a **plain data object**, not a Three.js object.  
`player.position.y` = **eye level** = feet Y + current height.

### 8.2 Player Mesh (Humanoid)

Created in `createPlayerMesh()` — a simple procedural Three.js `Group`:

```
Group (playerMesh) — scale (1.5, 1.7, 1.5)
├── shoeL / shoeR   BoxGeometry(0.22, 0.07, 0.28)   y=0.035 (feet)
├── legL / legR     BoxGeometry(0.17, 0.36, 0.17)    y=0.25
├── torso           BoxGeometry(0.50, 0.34, 0.24)    y=0.60
├── armL / armR     BoxGeometry(0.14, 0.30, 0.14)    y=0.60, x=±0.34
├── head            BoxGeometry(0.32, 0.20, 0.28)    y=0.87
└── hair            BoxGeometry(0.34, hairH, 0.30)   y=0.97+
    (female only → ponytail cylinder at z=-0.17)
```

**Local space:** feet at `y=0`, head-top at `y≈1.0`. Group scale makes world height = 1.7.

Color differences by gender:
- **Male:** skin `0xe8b882`, cloth `0x3d5a28`, hair `0x1a1008`
- **Female:** skin `0xf0c8a0`, cloth `0x2d4a1e`, hair `0x2a1a0a`

`playerMesh.visible = false` in first-person. Toggled when camera mode changes.

### 8.3 Player Spawn Position

`position: THREE.Vector3(15, 2.3, 0)` — slightly outside the pedestal ring, at standing height.

---

## 9. Controls & Input

### 9.1 Keyboard

| Key | Action |
|---|---|
| `W/A/S/D` | Move forward/left/back/right |
| `Shift` | Crouch (hold) |
| `Space` | Jump / swim up |
| `E` | Pick up nearest weapon crate |
| `P` | Toggle 1st/3rd person camera |
| `1`–`5` | Select inventory slot |
| `Escape` | Pause/resume simulation |
| `W` double-tap | Sprint (within 300 ms window) |

### 9.2 Mouse

| Action | Behavior |
|---|---|
| Move | Look (pointer lock) — `movementX/Y * 0.002` |
| Scroll wheel | Cycle inventory slots |
| LMB hold | Charge weapon |
| LMB release | Fire weapon |
| RMB hold | Aim / zoom in |
| RMB release | Stop aiming |
| Click canvas | Request pointer lock |

### 9.3 Sprint Logic

Sprint is activated by **double-tapping W** within `doubleTapWindow = 300ms`. It is cancelled on `W` keyup.

```js
if (key === 'w') {
    const now = performance.now();
    if (now - this.lastWTap < this.doubleTapWindow) this.isSprinting = true;
    this.lastWTap = now;
}
// keyup:
if (key === 'w') this.isSprinting = false;
```

### 9.4 Speed Modifiers

| State | Multiplier |
|---|---|
| Base | `0.16` units/frame |
| Crouching | `× 0.5` |
| Sprinting | `× 1.9` |
| Underwater (below surface) | `× 0.55` |

---

## 10. Physics & Collision

All physics run inside `update()` every frame.

### 10.1 Movement & Horizontal Collision

1. Compute `moveDir` from WASD keys.
2. Normalize and apply speed multipliers.
3. Rotate `moveDir` by `player.rotationY` (so movement is camera-relative).
4. Compute `nextX, nextZ`.
5. Arena boundary check: `nextX² + nextZ² < arenaRadius²`.
6. Collision tests (in order):
   - **Trees** (from spatial hash): circle vs circle, only block when `pFeet > -1` (not underwater).
   - **Rocks** (from spatial hash): circle vs circle + height check.
   - **Pedestals**: circle vs circle + height check.
   - **Cornucopia AABB walls** (`solidBoxes`): AABB test.
7. If no collision, apply position.

Player collision radius: `pR = 0.4`.

### 10.2 Vertical Physics (Gravity / Jump / Water)

```
Every frame:
  1. Detect inWater (overRiver && player.y <= waterSurface + height + 0.3)
  2. If inWater and NOT crouching → buoyancy float up
  3. If inWater and crouching → sink fast (velocity -= 0.05, capped at -0.4)
     Space while sinking → swim up (velocity = +0.15)
  4. Land physics: Space to jump (verticalVelocity = 0.26)
     Gravity: verticalVelocity -= 0.012 each frame
  5. Floor = max(0, pedestal.h if standing on pedestal, rock.topY if on rock)
  6. Clamp player.y >= floor + currentHeight
```

**Important:** `player.position.y` is always the **eye level**, not feet level.  
`feet = player.position.y - currentHeight`.

### 10.3 Rock Collision

Bank rocks use `{ type:'rock', x, z, r, topY }`. Collision blocks when:
```js
pFeet < obj.topY + 0.05 && player.y < obj.topY + currentHeight + 0.4
```
Submerged rocks (center river) are decorative only — no collision data stored.

---

## 11. Camera System

### 11.1 First Person

- `camera.position.copy(player.position)` (eye level).
- `camera.rotation.order = 'YXZ'`.
- `camera.rotation.y = player.rotationY`.
- `camera.rotation.x = player.rotationX`.
- `playerMesh.visible = false`.
- Held weapon mesh is a child of `this.camera`.

### 11.2 Third Person

- `playerMesh.visible = true`.
- Mesh placed at feet: `playerMesh.position.set(x, player.y - currentHeight, z)`.
- Mesh `rotation.y = player.rotationY + Math.PI` (faces away from camera).
- Camera offset: `(0, 2.2, 5)` rotated by `rotationY`, placed behind player.
- `camera.lookAt(player.x, player.y - currentHeight + 1.2, player.z)`.
- Held weapon mesh is attached to `meshParts.armR`.

### 11.3 Toggle

Press `P` toggles `cameraMode` between `'first'` and `'third'`, updates `#camBadge`, and calls `equipWeapon(activeSlot)` to reattach the weapon to the correct parent.

### 11.4 FOV / Zoom

- Normal FOV: **75°**
- Aim FOV: **32°**
- FOV interpolation: `currentFOV += (target - currentFOV) * min(1, dt * 14)` (smooth lerp at ~14×/s).
- RMB activates aim mode → adds `.active` class to `#aim-overlay` for CSS vignette + crosshair.

---

## 12. Combat System

### 12.1 Weapon Types

| Type | Icon | Behavior |
|---|---|---|
| `Sword` | ⚔️ | Melee — fire triggers recoil animation only, no projectile |
| `Bow` | 🏹 | Ranged — fires arrow projectile |
| `Spear` | 🗡️ | Ranged — fires spear projectile |

### 12.2 Charge System

1. **LMB down** → `isCharging = true`, `chargeStart = performance.now()`.
2. Each frame: `chargeAmount = min(1, elapsed / maxChargeTime)`. Max charge time = **1.8s**.
3. `#charge-bar-fill` width tracks `chargeAmount * 100%`. Color: green → yellow → red.
4. Held weapon nudges backward (`+kick * 0.04` on Z) for bow-draw feel.
5. **LMB up** → `isCharging = false`, calls `fireWeapon()`.

### 12.3 Weapon Meshes in Hand

Built procedurally by `createWeaponMesh(type)`. All use `THREE.Group`.

**First-person offsets** (relative to camera):

| Weapon | position | rotation | scale |
|---|---|---|---|
| Sword | `(0.28, -0.20, -0.38)` | `(0.20, -0.30, 0.06)` | `0.38` |
| Spear | `(0.18, -0.22, -0.28)` | `(-π/2+0.22, 0.18, -0.22)` | `0.32` |
| Bow | `(-0.20, -0.05, -0.50)` | `(0.18, π*0.5, -0.10)` | `0.40` |

**Third-person offsets** (relative to `meshParts.armR`):

| Weapon | position | rotation | scale |
|---|---|---|---|
| Sword | `(0, -0.20, 0.06)` | `(-0.4, 0, 0.1)` | `0.7` |
| Spear | `(0, -0.30, 0.08)` | `(-0.3, 0, 0.1)` | `0.75` |
| Bow | `(0, -0.15, 0.10)` | `(0, 0, -0.2)` | `0.75` |

**Critical tip convention:** In weapon meshes, the tip of arrows/spears sits at **local -Z**. The `lookAt` system compensates for this (see §13).

### 12.4 Weapon Pickup

- Reach distance: **4.0 units** (squared comparison).
- `tryPickup()` finds nearest crate, adds to first empty inventory slot (or overwrites active slot if full), removes crate mesh from scene and `weaponItems[]`.
- `checkNearWeapon()` runs every frame to show/hide `#pickup-hint`.

---

## 13. Projectile Physics

### 13.1 Projectile Object Schema

```js
{
    mesh: THREE.Group,   // the flying projectile group
    velocity: THREE.Vector3,  // world units/second
    life: 0,             // seconds alive (resets to 0 on stick)
    maxLife: 8,          // NOT actively used for flying — see STICK_LIFE
    stuck: false         // true once embedded in surface
}
```

### 13.2 Fire Mechanics (`fireWeapon`)

1. `power = max(0.15, chargeAmount)` — minimum 15% power even on tap.
2. Spawn position: `player.position` at eye height, pushed `+1.0` units forward along camera direction.
3. Orient: `projGroup.lookAt(start - dir)` → tip (-Z) faces forward.
4. Base speeds: Bow = **52 u/s**, Spear = **38 u/s**. Final: `dir * baseSpeed * power`.

### 13.3 In-Flight Update (`updateProjectiles`)

Each frame (per projectile):
1. Add gravity: `velocity.y += GRAVITY * dt` where `GRAVITY = -9`.
2. Move: `position += velocity * dt`.
3. Orient: `lookAt(position - velocity)` → tip always aligns with velocity direction.

### 13.4 Collision & Sticking

Checked in order:

1. **Ground / Pedestal:** `position.y <= groundHere` → `stickIt(0.18)` (18 cm embed).
2. **Tree trunks:** circle check against spatial hash trees, `trunkR = min(r * 0.45, 0.55)`, only below `y=7` → `stickIt(0.12)`.
3. **Abyss:** `position.y < -20` → remove.

**`stickIt(embedLen)`:**
```js
const tipDir = new THREE.Vector3(0, 0, -1).applyQuaternion(mesh.quaternion);
mesh.position.addScaledVector(tipDir, embedLen);  // embed tip into surface
velocity.set(0, 0, 0);
stuck = true;
life = 0;  // restart counter from landing moment
```

### 13.5 Stuck Lifetime & Fade

- `STICK_LIFE = 60s` — total duration before removal.
- `FADE_START = 55s` — projectile begins fading 5 s before removal.
- Fade: sets `material.transparent = true` and `opacity = 1 - frac` on all child meshes.

---

## 14. Survival System

Updated once per second (accumulates `dt` in `survivalTimer`).

| Stat | Drain per second | Decay condition |
|---|---|---|
| `hydration` | `-0.4` | always |
| `hunger` | `-0.25` | always |
| `health` | `-0.5` | when `hydration < 20` OR `hunger < 20` |
| `health` | `+0.1` | when `hydration > 60` AND `hunger > 60` |

Stats are clamped `[0, 100]`. DOM updates: `#bar-health`, `#bar-hydration`, `#bar-hunger` (width %) and `#val-health`, `#val-hydration`, `#val-hunger` (text).

> **TODO / Not Yet Implemented:** There is no way to currently restore hydration or hunger (no consumables or water-drinking mechanic).

---

## 15. Inventory System

- **5 slots**, zero-indexed.
- Each slot: `null` or `{ type: string, icon: string (emoji) }`.
- DOM IDs: `#inv-0` through `#inv-4`, each containing `.inv-slot-icon` and `.inv-slot-name`.
- Active slot highlighted with `.active` CSS class (red border + glow).
- Slot selection: keys `1`–`5` or scroll wheel.
- On slot change: calls `equipWeapon(slotIdx)`.

### Equip Logic (`equipWeapon`)

1. Detach old `heldWeaponMesh` from its parent.
2. If slot is empty, return.
3. Build new weapon mesh via `createWeaponMesh(type)`.
4. In 1st person → add to `this.camera`.
5. In 3rd person → add to `this.meshParts.armR`.
6. Store in `this.heldWeaponMesh`.

---

## 16. Minimap System

- **Canvas:** `#minimap`, 180×180 px, circular clip (`arc` + `clip()`).
- **View range:** `arenaRadius / 3 = 200` world units.
- The map **rotates with the player** — always faces up = player's forward direction.

### `renderMinimap()` draw order:

1. Dark forest background `#1a2d12`
2. Arena border circle (red stroke)
3. River path (teal, from `riverCurve`, 80 sample points)
4. Trees (every 4th, dark green dots, radius 1.5 px)
5. Pedestals (gold dots, radius 3 px)
6. Player FOV cone (60°, white semi-transparent)
7. Player dot (red circle + white stroke, radius 5 px)
8. Player arrow (white triangle pointing up)
9. Vignette overlay

### `toScreen(wx, wz)` conversion:

```js
const dx = wx - player.x, dz = wz - player.z;
const rot = player.rotationY;
const rx = dx * cos(rot) - dz * sin(rot);
const rz = dx * sin(rot) + dz * cos(rot);
return { x: cx + (rx / range) * R, y: cy + (rz / range) * R };
```

---

## 17. Animation System

`animatePlayerMesh(isMoving, isCrouching, isSprinting, dt)` — only active in 3rd-person (returns early if `playerMesh.visible === false`).

| State | `animTime` frequency | leg swing | arm swing |
|---|---|---|---|
| Walking | `6 * dt` | `± 0.42` rad | `± 0.35` rad |
| Crouching | `4 * dt` | `± 0.30` rad | `± 0.18` rad |
| Sprinting | `9 * dt` | `± 0.55` rad | `± 0.50` rad |
| Idle | `animTime *= 0.75` | coasts to 0 | coasts to 0 |

- Legs: `legL.rotation.x = sin(animTime) * legSwing` (opposite for R).
- Arms: `armL.rotation.x = -swing * armSwing` (opposite for R).
- Crouch: `legL/R.position.y` lerps from `0.25` → `0.14` at rate `0.2`.
- Bob: `torso/head.position.y` bobs slightly while moving/sprinting.
- The mesh **never distorts in Y scale** during crouch — only leg position changes.

---

## 18. Spatial Hash

Performance optimization for tree/rock collision queries.

```js
this.spatialHash = {};   // key: "${cx},${cz}"
this.cellSize = 20;      // world units per cell

addToSpatialHash(x, z, obj)   // puts obj into its cell
getNearbyObjects(x, z)         // returns all objects in 3x3 neighbourhood
```

All trees and rocks are indexed on world creation. Query covers 9 cells (3×3) around the player's current cell.

---

## 19. HUD & UI IDs Reference

| Element ID | Purpose | Visible during |
|---|---|---|
| `#overlay` | Start / character select screen | Before game start |
| `#hud` | Top control hints | Gameplay |
| `#camBadge` | Camera mode indicator (bottom-right) | Gameplay |
| `#crosshair` | CSS crosshair (center screen) | Gameplay |
| `#minimap-wrap` | Circular minimap container | Gameplay |
| `#minimap` | Minimap `<canvas>` | Gameplay |
| `#minimap-label` | "MAP" text | Gameplay |
| `#minimap-north` | "N" north indicator | Gameplay |
| `#survival-hud` | HP/Hydration/Hunger bars | Gameplay |
| `#bar-health` / `#val-health` | Health bar fill / value | Gameplay |
| `#bar-hydration` / `#val-hydration` | Hydration bar fill / value | Gameplay |
| `#bar-hunger` / `#val-hunger` | Hunger bar fill / value | Gameplay |
| `#inventory-hud` | 5-slot inventory bar (bottom-center) | Gameplay |
| `#inv-0` … `#inv-4` | Individual inventory slot divs | Gameplay |
| `#pickup-hint` | "[E] Open crate" tooltip | Near crate |
| `#aim-overlay` | Aim vignette + crosshair (RMB) | While aiming |
| `#charge-wrap` | Charge power bar wrapper | While charging |
| `#charge-bar-fill` | Animated charge fill | While charging |

**Classes on inventory slots:**
- `.inv-slot-icon` — emoji icon
- `.inv-slot-name` — type name (uppercase)
- `.inv-slot-num` — slot number (1–5)
- `.active` — added to currently selected slot

---

## 20. Key Constants & Tuning Values

| Constant | Value | Location |
|---|---|---|
| `arenaRadius` | `600` | constructor |
| `player.speed` | `0.16` u/frame | constructor |
| `player.height` | `1.7` u | constructor |
| `player.crouchHeight` | `1.0` u | constructor |
| `jumpVelocity` | `0.26` | update() |
| `gravity` | `0.012` /frame | update() |
| `GRAVITY` (projectiles) | `-9` u/s² | updateProjectiles() |
| `riverWidth` | `70` u | createRiver() |
| `riverDepth` | `15` u | createRiver() |
| `waterSurface` | `0.05` | update() |
| `inWater distance` | `< 35` from river Z center | update() |
| `sinkTargetY` | `-14.5 + crouchHeight` | update() |
| `buoyancyAccel` | `0.022` /frame | update() |
| `sinkAccel` | `-0.05` /frame (max -0.4) | update() |
| `swimUpVelocity` | `0.15` | update() |
| `maxChargeTime` | `1.8` s | constructor |
| `doubleTapWindow` | `300` ms | constructor |
| `sprintMultiplier` | `1.9` | update() |
| `normalFOV` | `75°` | constructor |
| `aimFOV` | `32°` | constructor |
| `fovLerpRate` | `14` /s | updateFOV() |
| `cellSize` (spatial hash) | `20` u | constructor |
| `pickupReach` | `4.0` u | tryPickup/checkNearWeapon |
| `treeCount` | `2000` | createForest() |
| `pedestalCount` | `24` | createPedestals() |
| `pedestalRadius` | `15` u | createPedestals() |
| `riverRockCount` | `1000` | createRiverRocks() |
| `STICK_LIFE` | `60` s | updateProjectiles() |
| `FADE_START` | `55` s | updateProjectiles() |
| `bowSpeed` | `52` u/s | fireWeapon() |
| `spearSpeed` | `38` u/s | fireWeapon() |
| `Cornucopia OX, OZ` | `0, -45` | createCornucopia() |
| `wallHeight` | `80` u | createBorderWall() |
| `wallThickness` | `6` u | createBorderWall() |
| `minimapViewRange` | `200` u (arenaRadius/3) | setupMinimap() |
| `hydration drain` | `0.4` /s | updateSurvival() |
| `hunger drain` | `0.25` /s | updateSurvival() |
| `health decay` | `0.5` /s | updateSurvival() |
| `health regen` | `0.1` /s | updateSurvival() |

---

## 21. Coding Conventions & Patterns

### 21.1 General

- **Single class, no modules.** Everything lives in `RealWorldSim`. Avoid adding global functions; extend the class instead.
- **Section headers.** Use the established `// ─────────────────────────────────────────────` separator blocks when adding new methods.
- **`dt`** is obtained via `Math.min(this.clock.getDelta(), 0.05)` once per frame inside `update()`. Do NOT call `clock.getDelta()` elsewhere (it advances the internal timer).
- **`this.keys[key]`** checks use `e.key.toLowerCase()`. The space key is `this.keys[' ']`.

### 21.2 Adding World Objects

1. Create the Three.js mesh(es).
2. Add to `this.scene`.
3. If collidable: store in `this.forestData[]`, `this.rockData[]`, `this.pedestals[]`, or `this.solidBoxes[]` **and** call `this.addToSpatialHash(x, z, obj)`.
4. Objects in spatial hash must have `{ type, x, z, r }` at minimum.

### 21.3 Adding a New Weapon Type

1. Add a new `else if (type === 'MyWeapon')` branch in `createWeaponMesh(type)`.
2. Add first-person and third-person positioning in `equipWeapon(slotIdx)`.
3. Add projectile mesh construction in `fireWeapon()` (if ranged). Tip must be at local `-Z`.
4. Add a crate call in `createCornucopia()`: `makeCrate(x, z, 'MyWeapon', '🔱')`.

### 21.4 Procedural Textures

Use the `createTex(drawFn, w, h)` helper inside `generateTextures()`:
```js
const myTex = createTex(ctx => {
    ctx.fillStyle = '#...';
    ctx.fillRect(0, 0, w, h);
    // ... draw
});
myTex.repeat.set(rx, rz);
return { ..., myTex };
```

### 21.5 HUD Updates

Always check for element existence before mutating:
```js
const el = document.getElementById('my-element');
if (el) el.style.width = val + '%';
```

### 21.6 Player `position.y` Convention

This is a **persistent gotcha**: `player.position.y` is **eye height**, not feet.

```js
const feet = player.position.y - currentHeight;  // where currentHeight = height or crouchHeight
```

Always derive feet from this formula when doing ground-level checks.

---

## 22. Known Architecture Decisions & Gotchas

| # | Issue | Details |
|---|---|---|
| 1 | **`clock.getDelta()` placement** | `getDelta()` is called inside `update()` after movement code. The returned `dt` is passed to sub-systems. Do not call it a second time in the same frame. |
| 2 | **Camera as weapon parent** | In first-person the held weapon mesh is a child of `this.camera`, which is also added to `this.scene` (line 102). Removing the camera from scene would break weapon rendering. |
| 3 | **Bow tip direction** | All projectile meshes have their tip at local `-Z`. The `lookAt(pos - velocity)` trick makes `-Z` lead the flight. `stickIt` uses `applyQuaternion` on `(0,0,-1)` to find the tip direction. Never change this convention without updating all three places. |
| 4 | **River Z formula must stay in sync** | The river is detected per-frame with `sin(x/150)*120+350`. This same formula appears in: `createRiver()` (point generation), `createForest()` (tree exclusion zone), and `update()` (water detection). If the river path changes, update all three. |
| 5 | **InstancedMesh — no individual removal** | Trees and rocks use `InstancedMesh`. You cannot easily remove individual instances. If you need dynamic trees (e.g. destructible), switch that group to individual meshes. |
| 6 | **Projectile `maxLife`** | The field `maxLife: 8` on projectile objects is unused. The actual lifetime after sticking is controlled by `STICK_LIFE = 60s`. Do not rely on `maxLife`. |
| 7 | **No consumable system** | Survival stats only drain — there is no food/water mechanic to restore them yet. |
| 8 | **Pointer lock** | The game requires pointer lock for mouselook. If pointer lock is not active, `movementX/Y` will be 0 and looking won't work. The canvas `click` handler requests it. |
| 9 | **`arenaRadius` collision** | The horizontal boundary check uses `nextX² + nextZ² < arenaRadius²`. The border wall geometry is at `arenaRadius + wallThickness (6)`, so there's a 6-unit gap between the logical boundary and the visual wall. |
| 10 | **Third-person weapon attachment** | Weapon is attached to `meshParts.armR`. If `armR` is null (mesh not created), `equipWeapon` returns silently. Always call `createPlayerMesh()` before any weapon equip. |
