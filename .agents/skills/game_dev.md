---
name: arena-game-dev
description: >
  Active every turn while working on The Arena. Defines exactly HOW to add,
  edit, or extend any part of the game — enforcing the conventions from
  game_architecture.md on every change. Read this before writing any code.
---

# Arena Game Dev — Coding Skill

> Before writing any game code, read this file top-to-bottom.
> Breaking any rule here risks regressions, invisible bugs, or silent failures.

---

## 0. Golden Rules (Never Break These)

1. **Single class, no modules.** All logic lives inside `class RealWorldSim`
   in `realWorldSim.js`. Never add a second class or a global function (except
   the two that already exist in the HTML: `selectChar` / `startGame`).

2. **`dt` comes from one place.** `const dt = Math.min(this.clock.getDelta(), 0.05)`
   is called **once** per frame inside `update()` at line ~1153. Pass `dt`
   as a parameter to sub-methods. Never call `clock.getDelta()` anywhere else.

3. **`player.position.y` is eye level, not feet.**
   Always derive feet: `const feet = player.position.y - currentHeight;`
   — where `currentHeight` is `player.height` (1.7) or `player.crouchHeight` (1.0).

4. **Projectile tip is at local `-Z`.** If you create any projectile mesh, put
   the tip geometry at `z < 0`. The `lookAt(pos - velocity)` convention makes
   `-Z` lead the flight. Never break this convention.

5. **River formula must stay in sync in 3 places.**
   `const riverZ = Math.sin(x / 150) * 120 + 350;`
   appears in `createRiver()`, `createForest()`, and `update()`. If you change
   the river path, update all three simultaneously.

6. **Camera is in the scene.** `this.scene.add(this.camera)` at line 102 is
   required so child weapon meshes render in first-person. Never remove the
   camera from the scene.

7. **`InstancedMesh` trees/rocks cannot be individually removed.** Don't try to
   destroy individual trees. If you need destructible terrain, switch that group
   to individual meshes before removing.

8. **Check element existence before touching DOM.**
   ```js
   const el = document.getElementById('my-id');
   if (el) el.style.width = val + '%';
   ```

9. **`this.keys` uses `e.key.toLowerCase()`.** Space is `this.keys[' ']`.
   Never check raw `e.key` inside `update()` — always use the `this.keys` map.

10. **Use section separators** when adding a new method block:
    ```js
    // ─────────────────────────────────────────────
    // MY NEW SYSTEM
    // ─────────────────────────────────────────────
    ```

---

## 1. Adding a New Method to the Class

1. Place it in the logical section of `realWorldSim.js` (near related methods).
2. Add the separator header above it.
3. Call it from `update()`, `init()`, or the relevant lifecycle hook — never
   from inside a constructor directly (use `init()` for that).
4. If it runs every frame, add the call inside `update()` and pass `dt`.
5. If it is a one-time setup, call it from `init()` or `createWorld()`.

```js
// ─────────────────────────────────────────────
// MY SYSTEM
// ─────────────────────────────────────────────
mySystem(dt) {
    // implementation
}
```

---

## 2. Adding a World Object (Environment)

Follow this checklist exactly — missing any step silently breaks collision or minimap.

### Step-by-step

```
1. Create the Three.js mesh(es) / group
2. Set castShadow / receiveShadow as appropriate
3. Add to this.scene
4. IF COLLIDABLE → store a plain data object AND add to spatial hash:
     const obj = { type: 'myType', x, z, r: collisionRadius };
     this.forestData.push(obj);           // or rockData / pedestals
     this.addToSpatialHash(x, z, obj);
5. IF AABB WALL → push to this.solidBoxes:
     this.solidBoxes.push({ x1, x2, z1, z2, h });
6. IF MINIMAP-VISIBLE → render it inside renderMinimap()
```

### Collision data schema

```js
// Circular collider (trees, rocks, custom)
{ type: 'myType', x: number, z: number, r: number }

// AABB wall (Cornucopia-style)
{ x1, x2, z1, z2, h }   // h = height cap — player only blocked below this Y
```

### Collision query in `update()`

To add collision for your new type, add an `else if` branch in the nearby
objects loop inside `update()`:

```js
} else if (obj.type === 'myType') {
    if (/* feet/height condition */) { col = true; break; }
}
```

---

## 3. Adding a New Weapon Type

Follow all four steps — missing one silently breaks pickup, equip, or firing.

### Step 1 — Weapon mesh (`createWeaponMesh`)

Add a new `else if` branch. Tip MUST be at **local -Z** for ranged weapons.

```js
} else if (type === 'Trident') {
    // build geometry groups
    // tip geometry placed at z < 0
    g.add(...);
}
```

### Step 2 — Equip positioning (`equipWeapon`)

Add **both** first-person and third-person positioning branches:

```js
// First person
if (item.type === 'Trident') {
    wm.position.set(x, y, z);
    wm.rotation.set(rx, ry, rz);
    wm.scale.setScalar(s);
}

// Third person (inside the else block)
if (item.type === 'Trident') {
    wm.position.set(x, y, z);
    wm.rotation.set(rx, ry, rz);
    wm.scale.setScalar(s);
}
```

### Step 3 — Projectile construction (`fireWeapon`)

Add the projectile mesh build. Use the same shaft/tip pattern as Bow/Spear.
Tip goes at `z = -(halfLength + tipLength/2)`.

```js
} else if (item.type === 'Trident') {
    // shaft, head — tip at negative Z
    projGroup.add(...);
}
```

### Step 4 — Crate placement (`createCornucopia`)

```js
makeCrate(x, z, 'Trident', '🔱');
```

### Reference speeds

| Weapon | Base speed |
|--------|-----------|
| Bow    | 52 u/s    |
| Spear  | 38 u/s    |
| Custom | pick between 30–60 based on feel |

---

## 4. Adding a HUD Element

### HTML side (`realWorldSim.html`)

1. Add the DOM element inside `<body>` BEFORE the `<script>` tags.
2. Give it a unique `id` following the existing naming pattern (`kebab-case`).
3. Add CSS in the `<style>` block — use `display: none` by default.
4. In `startGame()`, add `document.getElementById('my-id').style.display = 'block'`
   (or `'flex'`) to show it on game start.
5. Set `pointer-events: none` unless it genuinely needs click events.

### JS side (`realWorldSim.js`)

1. Always use `document.getElementById('my-id')` — never cache it in constructor
   (elements may not exist at construction time).
2. Guard every DOM access:
   ```js
   const el = document.getElementById('my-id');
   if (el) el.textContent = value;
   ```
3. Update the HUD ID reference table in `game_architecture.md` (§19) after adding.

---

## 5. Adding a New Survival / Game State System

Examples: enemies, death screen, consumables, score, timer, kill feed.

### Pattern

1. Add state fields in the **constructor** with inline comments.
   ```js
   // ── My new system ─────────────────────────
   this.myState = initialValue;
   ```
2. Add an update method: `updateMySystem(dt)`.
3. Call it from `update()`: `this.updateMySystem(dt);`
4. If it needs setup: call from `init()` after existing init calls.
5. If it reads `player.position.y` for feet-level logic, always use:
   ```js
   const feet = this.player.position.y - currentHeight;
   ```

---

## 6. Physics & Movement Patches

When changing movement, collision, or vertical physics:

- The movement block runs **before** `getDelta()` is called (lines ~1083–1150).
  Movement uses `player.speed` (frame-rate dependent). Keep it that way.
- Vertical physics run after `getDelta()` (lines ~1162–1237). These use `dt`
  and are frame-rate independent. New vertical forces must use `dt`.
- Sprint: `this.isSprinting` flag (double-tap W). Never set it directly outside
  the keydown handler.
- Crouch: `this.player.isCrouching = !!this.keys['shift']` — set every frame
  in `update()`. Don't cache it anywhere else.
- Adding a new speed modifier: multiply `spd` in the same block as the others
  (lines ~1091–1094). Document the multiplier in §20 of `game_architecture.md`.

---

## 7. Procedural Textures

Always use the `createTex` helper inside `generateTextures()`:

```js
const myTex = createTex(ctx => {
    ctx.fillStyle = '#rrggbb';
    ctx.fillRect(0, 0, 512, 512);
    // ... custom drawing
});
myTex.repeat.set(rx, rz);
```

Return it in the object: `return { grass, water, bark, myTex };`
Then pass it as a parameter to the world creation method that needs it.
Never load external image files — textures must be procedural canvas.

---

## 8. Camera & Weapon Parent Rules

| Camera mode | Weapon parent | Player mesh visible |
|---|---|---|
| `'first'` | `this.camera` | `false` |
| `'third'` | `this.meshParts.armR` | `true` |

- Always call `this.equipWeapon(this.activeSlot)` after toggling camera mode.
- In third-person, `playerMesh.position.y` must be set to **feet** level:
  `feetY = this.player.position.y - currentHeight`.
- `playerMesh.rotation.y = this.player.rotationY + Math.PI` (faces away from camera).

---

## 9. Spatial Hash — Correct Usage

```js
// ADD object (at world-creation time only, not every frame)
this.addToSpatialHash(x, z, obj);   // obj must have { type, x, z, r }

// QUERY (every frame, near player or projectile)
const nearby = this.getNearbyObjects(x, z);  // returns 3x3 grid of objects
for (const obj of nearby) {
    if (obj.type !== 'myType') continue;
    // distance check against obj.x, obj.z, obj.r
}
```

- **Cell size is 20u.** Objects larger than 40u diameter may span 3+ cells
  and need to be added to multiple cells manually.
- `getNearbyObjects` returns ALL types (trees + rocks). Always filter by `obj.type`.

---

## 10. Minimap Integration

To show a new object type on the minimap, add a draw block inside
`renderMinimap()`, following the existing draw order:

```
1. Background  2. Arena border  3. River  4. Trees  5. Pedestals
6. [YOUR NEW ELEMENT HERE]
7. Player dot / cone / arrow  8. Vignette
```

```js
// ── My structure ────────────────────────────
ctx.fillStyle = 'rgba(200,200,50,0.8)';
for (const item of this.myItems) {
    const dx = item.x - this.player.position.x;
    const dz = item.z - this.player.position.z;
    if (dx * dx + dz * dz > range * range) continue; // cull outside view
    const s = toScreen(item.x, item.z);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
}
```

Always cull objects outside `range * range` before calling `toScreen` — it
runs every frame and the forest has 2000 items.

---

## 11. Code Style Conventions

```js
// ✅ Correct
const dx = nextX - obj.x, dz = nextZ - obj.z;
if (dx * dx + dz * dz < (obj.r + pR) ** 2) { ... }

// ❌ Avoid — expensive Math.sqrt every frame
if (Math.sqrt(dx**2 + dz**2) < obj.r + pR) { ... }
```

- **Distance checks** always use squared distance: `dx*dx + dz*dz < r*r`
- **Lerp pattern**: `val += (target - val) * Math.min(1, dt * rate)`
- **Clamp pattern**: `Math.max(min, Math.min(max, val))`
- **Arrow functions** for local helpers (inside methods): `const fn = (x) => ...`
- **No `var`** — use `const` by default, `let` only when reassignment is needed
- **Three.js objects**: create temp vectors with `new THREE.Vector3()` — avoid
  polluting the class with throwaway state
- **Group naming**: use `g` for local `THREE.Group()` within creation methods,
  `wg` for weapon groups — consistent with existing code

---

## 12. Pre-Implementation Checklist

Before writing any new code, answer these questions:

- [ ] Does this need a new constructor field? → Add to constructor with comment
- [ ] Does this run every frame? → Add `updateX(dt)` call in `update()`
- [ ] Does this need setup? → Add call to `init()` or `createWorld()`
- [ ] Does this add a collidable object? → Add to data array + spatial hash
- [ ] Does this add a HUD element? → Add HTML + CSS + `startGame()` show
- [ ] Does this change a constant? → Update §20 in `game_architecture.md`
- [ ] Does this involve the river shape? → Check all 3 formula locations
- [ ] Does this add a ranged projectile? → Tip at local `-Z`, test alignment
- [ ] Does this add a key binding? → Update §9 table in `game_architecture.md`

---

## 13. Quick Reference — Key Locations in `realWorldSim.js`

| What you want to change | Line range |
|---|---|
| Constructor fields / initial state | 6–81 |
| `init()` call order | 83–91 |
| Keyboard / mouse binding | 138–220 |
| Survival stat drain | 222–253 |
| Pickup logic | 255–288 |
| Weapon mesh geometry | 304–396 |
| Weapon equip / camera parenting | 398–449 |
| Player humanoid mesh | 451–523 |
| Walk / run / crouch animation | 525–570 |
| Spatial hash | 571–593 |
| World creation order | 595–616 |
| Cornucopia + weapon crates | 618–762 |
| Border wall | 764–803 |
| River ribbon geometry | 805–887 |
| River rocks + bank collision | 889–939 |
| Pedestals | 941–957 |
| Forest instanced mesh | 959–1012 |
| Texture generation | 1014–1054 |
| **Main update loop** | 1056–1245 |
| Camera update (1P / 3P) | 1247–1288 |
| Minimap setup + render | 1290–1435 |
| Aim / FOV zoom | 1449–1465 |
| Charge bar update | 1467–1503 |
| Fire weapon + projectile build | 1505–1589 |
| Projectile physics + sticking | 1591–1685 |
