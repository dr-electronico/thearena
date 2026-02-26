// HungerGamesSim - Hunger Games style forest arena using Three.js
// Features: Dense forest, winding river, central pedestals, circular arena,
//           1st/3rd person camera, male/female character model.

class RealWorldSim {
    constructor(gender = 'male') {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.ground = null;

        this.gender = gender; // 'male' | 'female'
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.clock = new THREE.Clock();

        // Camera modes: 'first' | 'third'
        this.cameraMode = 'first';
        this.thirdPersonOffset = new THREE.Vector3(0, 3, 6);

        this.player = {
            position: new THREE.Vector3(15, 2.3, 0),
            speed: 0.16,
            rotationX: 0,
            rotationY: 0,
            height: 1.7,
            crouchHeight: 1.0,
            verticalVelocity: 0,
            isOnGround: true,
            isCrouching: false
        };

        this.playerMesh = null;
        this.meshParts = {};

        this.forestData = [];
        this.rockData = [];
        this.spatialHash = {};
        this.cellSize = 20;
        this.pedestals = [];
        this.arenaRadius = 600;
        this.simulationRunning = true;
        this.riverCurve = null;

        // Animation
        this.animTime = 0;
        this.isSprinting = false;
        this.lastWTap = 0;
        this.doubleTapWindow = 300;

        // Survival stats (0–100)
        this.health = 100;
        this.hydration = 100;
        this.hunger = 100;
        this.survivalTimer = 0;

        // Inventory (7 slots)
        this.inventory = [null, null, null, null, null, null, null];
        this.activeSlot = 0;
        this.heldWeaponMesh = null;
        this.weaponItems = [];
        this.bottleWater = 0;   // 0-100 — current water level in the canteen

        // ── Drink animation ──────────────────────────
        // phase: 'idle' | 'raising' | 'drinking' | 'lowering'
        this.drinkAnim = {
            phase: 'idle',
            t: 0,               // 0→1 progress within current phase
            // saved resting transform of the held weapon
            restPos: null,      // THREE.Vector3
            restRot: null,      // THREE.Euler
            restScale: null,    // number
        };

        // Cornucopia solid walls (AABB boxes)
        this.solidBoxes = [];

        // ── Combat system ───────────────────────────
        this.isCharging = false;    // LMB held
        this.chargeStart = 0;
        this.chargeAmount = 0;        // 0‥1
        this.maxChargeTime = 0.7;      // seconds to 100% (FASTER)
        this.projectiles = [];       // flying arrows / spears
        this.weaponRecoil = 0;        // transient kick value

        // ── Aim / zoom ───────────────────────────────
        this.isAiming = false;
        this.normalFOV = 75;
        this.aimFOV = 32;
        this.currentFOV = 75;

        // ── Animals & World Pop ─────────────────────
        this.animals = [];      // { mesh, type, state, t, targetVel, targetRot }
        this.environmentMeshData = {
            bushes: [],         // InstancedMesh data
            twigs: []           // Metadata for picking up
        };
        this.twigInst = null;   // Reference to the mesh for updates

        this.campfires = [];    // { mesh, sticks: 0, isLit: false }
        this.isClimbing = false;
        this.climbingTreePos = null;

        // Day/Night Cycle
        this.dayCycleTime = 0;
        this.totalCycleDuration = 600; // 10 minutes total (5 min day / 5 min night)
        this.ambientLight = null;
        this.hemiLight = null;

        this.init();
    }

    init() {
        if (typeof THREE === 'undefined') { console.error('Three.js not loaded'); return; }
        this.setupScene();
        this.setupControls();
        this.createWorld();
        this.createPlayerMesh();
        this.setupMinimap();
        this.setupStartingInventory();
        this.loop();
    }

    // ─────────────────────────────────────────────
    // SCENE
    // ─────────────────────────────────────────────
    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.004);

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.scene.add(this.camera); // required so camera children (held weapon) render

        this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;

        const container = document.getElementById('gameContainer') || document.body;
        container.appendChild(this.renderer.domElement);

        // Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d4d1f, 0.6);
        this.scene.add(this.hemiLight);

        this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sun.position.set(100, 200, 100);
        this.sun.castShadow = true;
        this.sun.shadow.camera.left = -300;
        this.sun.shadow.camera.right = 300;
        this.sun.shadow.camera.top = 300;
        this.sun.shadow.camera.bottom = -300;
        this.sun.shadow.camera.far = 1200;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.scene.add(this.sun);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    // ─────────────────────────────────────────────
    // CONTROLS
    // ─────────────────────────────────────────────
    setupControls() {
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();

            // Double-tap W → sprint
            if (key === 'w') {
                const now = performance.now();
                if (now - this.lastWTap < this.doubleTapWindow) {
                    this.isSprinting = true;
                }
                this.lastWTap = now;
            }

            this.keys[key] = true;
            if (e.key === 'Escape') this.simulationRunning = !this.simulationRunning;

            // Toggle camera with P
            if (key === 'p') {
                this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
                const badge = document.getElementById('camBadge');
                if (badge) badge.textContent = '📷 ' + (this.cameraMode === 'first' ? 'FIRST PERSON' : 'THIRD PERSON');
                if (this.playerMesh) this.playerMesh.visible = (this.cameraMode === 'third');
                this.equipWeapon(this.activeSlot); // reattach weapon to correct parent
            }
        });
        document.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            this.keys[key] = false;
            if (key === 'w') this.isSprinting = false;
        });
        document.addEventListener('keydown', (e) => {
            // Slot select 1-7
            if (['1', '2', '3', '4', '5', '6', '7'].includes(e.key)) {
                const idx = parseInt(e.key) - 1;
                this.activeSlot = idx;
                document.querySelectorAll('.inv-slot').forEach((s, i) => s.classList.toggle('active', i === idx));
                this.equipWeapon(idx);
            }
            // Pickup or Climb
            if (e.key.toLowerCase() === 'e') {
                if (this.tryClimb()) return;
                this.tryPickup();
                this.tryPickupTwig();
            }
            // Drop active weapon
            if (e.key.toLowerCase() === 'q') this.dropWeapon();
        }, { capture: false });
        document.addEventListener('mousemove', (e) => {
            if (!this.simulationRunning) return;
            this.mouse.x = e.movementX * 0.002;
            this.mouse.y = e.movementY * 0.002;
        });
        // Scroll wheel → cycle inventory slots
        document.addEventListener('wheel', (e) => {
            if (!this.simulationRunning) return;
            const slots = this.inventory.length;
            this.activeSlot = (this.activeSlot + (e.deltaY > 0 ? 1 : -1) + slots) % slots;
            document.querySelectorAll('.inv-slot').forEach((s, i) =>
                s.classList.toggle('active', i === this.activeSlot));
            this.equipWeapon(this.activeSlot);
        }, { passive: true });

        // ── Non-combat item types ──────────────────────────────────────
        const NON_COMBAT = ['Bottle', 'Lighter'];

        // ── Combat: LMB = charge, release = fire ─────
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            const activeItem = this.inventory[this.activeSlot];
            const activeType = activeItem ? activeItem.type : null;

            if (e.button === 0) { // left — start charging (weapons only)
                if (activeType === 'Bottle') {
                    this.startDrinking();       // canteen: drink animation
                } else if (activeType === 'Muslo' || activeType === 'Costilla') {
                    this.useFood();             // eat food
                } else if (activeItem && !NON_COMBAT.includes(activeType)) {
                    this.isCharging = true;
                    this.chargeStart = performance.now();
                }
            }
            if (e.button === 2) { // right
                if (activeType === 'Bottle') {
                    // Extinguish fire if bottle is full
                    const cf = this.findNearbyCampfire(this.player.position.x, this.player.position.z, 3.0);
                    if (cf && cf.isLit && this.bottleWater >= 100) {
                        this.bottleWater = 0;
                        this.updateBottleHUD();
                        cf.isLit = false;
                        if (cf.fireGroup) {
                            cf.mesh.remove(cf.fireGroup);
                            cf.fireGroup = null;
                        }

                        // Leave ASHES
                        if (!cf.ashMesh) {
                            const ashGeo = new THREE.CircleGeometry(0.5, 12);
                            const ashMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1.0 });
                            const ash = new THREE.Mesh(ashGeo, ashMat);
                            ash.rotation.x = -Math.PI / 2;
                            ash.position.y = 0.01;
                            cf.mesh.add(ash);
                            cf.ashMesh = ash;
                        }

                        this.showItemMsg('🔥 Fogata apagada');
                    } else {
                        this.useBottle();          // fill or drink
                    }
                } else if (activeType === 'Rama') {
                    this.useRama();            // place stick
                } else if (activeType === 'Lighter') {
                    this.useLighter();         // light fire
                } else if (activeType === 'Muslo' || activeType === 'Costilla') {
                    this.tryCookFood();        // cook meat near fire
                } else {
                    this.setAiming(true);      // weapons: zoom in
                }
            }
        });
        this.renderer.domElement.addEventListener('mouseup', (e) => {
            const activeItem = this.inventory[this.activeSlot];
            const activeType = activeItem ? activeItem.type : null;

            if (e.button === 0 && this.isCharging) {
                this.isCharging = false;
                this.fireWeapon();
            }
            if (e.button === 2 && !NON_COMBAT.includes(activeType)) {
                this.setAiming(false);
            }
        });
        // Block RMB context menu
        this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

        // Click to lock pointer (keep existing behavior)
        this.renderer.domElement.addEventListener('click', () => this.renderer.domElement.requestPointerLock());
    }

    // ─────────────────────────────────────────────
    // SURVIVAL SYSTEM
    // ─────────────────────────────────────────────
    updateSurvival(dt) {
        this.survivalTimer += dt;
        if (this.survivalTimer < 1) return; // update once per second
        this.survivalTimer = 0;

        // Drain rates per second
        this.hydration = Math.max(0, this.hydration - 0.4);
        this.hunger = Math.max(0, this.hunger - 0.25);

        // ── Damage: if Hydration OR Hunger ≤ 10 → Drain Health ────────
        let isDraining = false;
        if (this.hydration <= 10 || this.hunger <= 10) {
            this.health = Math.max(0, this.health - 5);
            this.triggerDamageFlash();
            isDraining = true;
        }

        // ── Health regen: if Hydration OR Hunger ≥ 50 (and not draining) ─
        if (!isDraining && (this.hydration >= 50 || this.hunger >= 50)) {
            this.health = Math.min(100, this.health + 2);
        }

        // Update DOM
        const setBar = (id, val, valId) => {
            const el = document.getElementById(id);
            const ve = document.getElementById(valId);
            if (el) el.style.width = val + '%';
            if (ve) ve.textContent = Math.ceil(val);
        };
        setBar('bar-health', this.health, 'val-health');
        setBar('bar-hydration', this.hydration, 'val-hydration');
        setBar('bar-hunger', this.hunger, 'val-hunger');

        if (this.health <= 0) {
            this.triggerDeath();
        }
    }

    triggerDeath() {
        if (this._isDead) return;
        this._isDead = true;
        this.simulationRunning = false;

        const screen = document.getElementById('death-screen');
        if (screen) {
            screen.style.display = 'flex';
            // Force reflow
            void screen.offsetWidth;
            screen.classList.add('active');
        }

        // Unlock cursor
        document.exitPointerLock();
    }

    // ─────────────────────────────────────────────
    // DAMAGE FLASH
    // ─────────────────────────────────────────────
    triggerDamageFlash() {
        const el = document.getElementById('damage-flash');
        if (!el) return;
        // Remove + re-add active class to retrigger if already flashing
        el.classList.remove('active');
        // Force reflow so the transition resets
        void el.offsetWidth;
        el.classList.add('active');
        // After a short delay, remove active → CSS transition fades it out
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => el.classList.remove('active'), 80);
    }

    // ─────────────────────────────────────────────
    // PICKUP
    // ─────────────────────────────────────────────
    tryPickup() {
        const REACH = 4.0;
        let best = null, bestDistSq = REACH * REACH;
        for (const item of this.weaponItems) {
            const dx = this.player.position.x - item.x;
            const dz = this.player.position.z - item.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDistSq) { bestDistSq = d2; best = item; }
        }
        if (!best) return;

        const pickedSlot = this.addToInventory(best.type, best.icon);
        // No separate slot for arrows — Bow includes arrows

        this.scene.remove(best.mesh);
        this.weaponItems.splice(this.weaponItems.indexOf(best), 1);

        if (pickedSlot === this.activeSlot) this.equipWeapon(this.activeSlot);
    }

    spawnLoot(type, icon, x, z, count = 1) {
        for (let i = 0; i < count; i++) {
            // Jitter position so they don't overlap perfectly
            const ox = (Math.random() - 0.5) * 1.5;
            const oz = (Math.random() - 0.5) * 1.5;
            const lx = x + ox, lz = z + oz;

            // Use the crate/box visual for now, or a simple colored box
            const mat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 1 });
            const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(lx, 0.2, lz);
            mesh.rotation.y = Math.random() * Math.PI;
            this.scene.add(mesh);

            this.weaponItems.push({ type, icon, x: lx, z: lz, mesh });
        }
    }

    addToInventory(type, icon, count = 1, extraData = {}) {
        const STACK_LIMIT = 10;
        const isStackable = ['Rama', 'Muslo', 'Costilla'].includes(type);

        // 1. Try to find existing stack if stackable
        if (isStackable) {
            for (let i = 0; i < this.inventory.length; i++) {
                let item = this.inventory[i];
                // Check type and extra data consistency (like isCooked)
                const sameType = item && item.type === type;
                let sameState = true;
                if (extraData.isCooked !== undefined && item && item.isCooked !== extraData.isCooked) sameState = false;

                if (sameType && sameState && item.count < STACK_LIMIT) {
                    const toAdd = Math.min(count, STACK_LIMIT - item.count);
                    item.count += toAdd;
                    count -= toAdd;
                    this.refreshInventorySlot(i);
                    if (count <= 0) return i;
                }
            }
        }

        // 2. Find empty slot for remainders or non-stackables
        while (count > 0) {
            let slot = this.inventory.indexOf(null);
            if (slot === -1) {
                // If inventory is full, overwrite the current active slot (existing behavior)
                slot = this.activeSlot;
            }

            const toAdd = isStackable ? Math.min(count, STACK_LIMIT) : 1;
            this.inventory[slot] = { type, icon, count: toAdd, ...extraData };
            count -= isStackable ? toAdd : 1;
            this.refreshInventorySlot(slot);

            if (!isStackable || count <= 0) return slot;
        }
        return this.activeSlot;
    }

    refreshInventorySlot(slotIdx) {
        const item = this.inventory[slotIdx];
        const slotEl = document.getElementById('inv-' + slotIdx);
        if (!slotEl) return;

        const iconEl = slotEl.querySelector('.inv-slot-icon');
        const nameEl = slotEl.querySelector('.inv-slot-name');

        if (!item) {
            iconEl.textContent = '⬜';
            nameEl.textContent = 'Empty';
        } else {
            iconEl.textContent = item.icon;

            if (item.type === 'Bottle') {
                const pct = Math.round(this.bottleWater);
                iconEl.textContent = this.bottleWater <= 0 ? '🫙' : '🧴';
                nameEl.textContent = `Cantimplora ${pct}%`;
            } else {
                const countStr = (item.count && item.count > 1) ? ` x${item.count}` : "";
                nameEl.textContent = item.type + countStr;
            }
        }
    }

    checkNearWeapon() {
        const REACH = 4.0;
        const hint = document.getElementById('pickup-hint');
        for (const item of this.weaponItems) {
            const dx = this.player.position.x - item.x;
            const dz = this.player.position.z - item.z;
            if (dx * dx + dz * dz < REACH * REACH) {
                if (hint) { hint.style.display = 'block'; hint.textContent = `[E] Open crate: ${item.type}`; }
                return;
            }
        }
        if (hint) hint.style.display = 'none';

        // Also check for twigs
        const twigHint = this.getNearestTwig();
        if (twigHint && twigHint.distSq < 4.0 * 4.0) {
            if (hint) {
                hint.style.display = 'block';
                hint.textContent = `[E] Recoger rama`;
            }
            return;
        }

        // ── Climbing Check ────────────────────────
        const nearby = this.getNearbyObjects(this.player.position.x, this.player.position.z);
        for (const obj of nearby) {
            if (obj.type === 'tree') {
                const dx = this.player.position.x - obj.x;
                const dz = this.player.position.z - obj.z;
                if (dx * dx + dz * dz < 1.6 * 1.6) {
                    if (hint) {
                        hint.style.display = 'block';
                        hint.textContent = this.isClimbing ? '[E] Bajar del árbol' : '[E] Escalar árbol';
                    }
                    return;
                }
            }
        }
    }

    tryPickupTwig() {
        const result = this.getNearestTwig();
        if (result && result.distSq < 4.0 * 4.0) {
            const { twig, index } = result;
            // "Remove" by scaling to zero
            const dummy = new THREE.Object3D();
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            this.twigInst.setMatrixAt(twig.originalIndex, dummy.matrix);
            this.twigInst.instanceMatrix.needsUpdate = true;

            // Mark as collected in metadata
            twig.collected = true;

            this.addToInventory('Rama', '🌳', 1);
            if (this.inventory[this.activeSlot] && this.inventory[this.activeSlot].type === 'Rama') {
                this.equipWeapon(this.activeSlot);
            }
        }
    }

    tryClimb() {
        if (this.isClimbing) {
            this.exitClimb();
            return true;
        }

        const nearby = this.getNearbyObjects(this.player.position.x, this.player.position.z);
        for (const obj of nearby) {
            if (obj.type === 'tree') {
                const dx = this.player.position.x - obj.x;
                const dz = this.player.position.z - obj.z;
                if (dx * dx + dz * dz < 2.0 * 2.0) {
                    this.isClimbing = true;
                    this.climbingTreePos = { x: obj.x, z: obj.z, r: obj.r, h: obj.h, isPine: obj.isPine };

                    // Static attachment: Snap player to tree trunk surface
                    const angle = Math.atan2(dz, dx);
                    const snapDist = 0.85;
                    this.player.position.x = obj.x + Math.cos(angle) * snapDist;
                    this.player.position.z = obj.z + Math.sin(angle) * snapDist;
                    this.player.position.y += 0.8;

                    this.player.isOnGround = false;
                    this.player.verticalVelocity = 0;
                    this.showItemMsg('🪜 Trepando árbol (W/S para subir/bajar)');
                    return true;
                }
            }
        }
        return false;
    }

    exitClimb() {
        if (!this.isClimbing) return;

        // Push the player away from the trunk so they don't get stuck in collision
        if (this.climbingTreePos) {
            const dx = this.player.position.x - this.climbingTreePos.x;
            const dz = this.player.position.z - this.climbingTreePos.z;
            const angle = Math.atan2(dz, dx);
            const pR = 0.4;
            const pushDist = (this.climbingTreePos.r || 0.8) + pR + 0.35; // increased push for safety
            this.player.position.x = this.climbingTreePos.x + Math.cos(angle) * pushDist;
            this.player.position.z = this.climbingTreePos.z + Math.sin(angle) * pushDist;
        }

        this.isClimbing = false;
        this.climbingTreePos = null;
        this.showItemMsg('🪜 Bajaste del árbol');
    }

    getNearestTwig() {
        if (!this.twigInst || this.environmentMeshData.twigs.length === 0) return null;
        let best = null, bestDistSq = Infinity;
        for (let i = 0; i < this.environmentMeshData.twigs.length; i++) {
            const t = this.environmentMeshData.twigs[i];
            if (t.collected) continue;
            const dx = this.player.position.x - t.x;
            const dz = this.player.position.z - t.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                best = { twig: t, index: i, distSq: d2 };
            }
        }
        return best;
    }

    // ─────────────────────────────────────────────
    // DROP WEAPON
    // ─────────────────────────────────────────────
    dropWeapon() {
        const item = this.inventory[this.activeSlot];
        if (!item) return; // nothing in hand

        // ── 1. Clear the inventory slot ──────────────
        this.inventory[this.activeSlot] = null;
        this.refreshInventorySlot(this.activeSlot);

        // ── 2. Detach held weapon mesh ───────────────
        if (this.heldWeaponMesh) {
            if (this.heldWeaponMesh.parent) this.heldWeaponMesh.parent.remove(this.heldWeaponMesh);
            this.heldWeaponMesh = null;
        }

        // ── 3. Compute drop position ─────────────────
        // Drop 1.5 units in front of the player (camera facing direction), at ground level
        const dropDist = 1.5;
        const px = this.player.position.x - Math.sin(this.player.rotationY) * dropDist;
        const pz = this.player.position.z - Math.cos(this.player.rotationY) * dropDist;

        // ── 4. Build a crate mesh (same style as Cornucopia crates) ──
        const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5c2e, roughness: 0.9 });
        const crateEdge = new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 0.95 });
        const crateIron = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 });

        const wg = new THREE.Group();

        // Main box
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.75), crateMat);
        box.position.y = 0.375; wg.add(box);

        // Horizontal plank lines front/back
        for (let i = 0; i < 2; i++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.02), crateEdge);
            plank.position.set(0, 0.22 + i * 0.3, 0.375); wg.add(plank);
            const pb = plank.clone(); pb.position.z = -0.375; wg.add(pb);
        }

        // Vertical corner strips
        for (const xs of [-0.48, 0.48]) {
            const vert = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.77, 0.77), crateEdge);
            vert.position.set(xs, 0.375, 0); wg.add(vert);
        }

        // Iron corner brackets
        for (const xs of [-0.45, 0.45]) for (const zs of [-0.33, 0.33]) {
            const brkt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), crateIron);
            brkt.position.set(xs, 0.72, zs); wg.add(brkt);
        }

        // Lid
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 0.79), crateEdge);
        lid.position.y = 0.79; wg.add(lid);

        // Place the crate at ground level, slightly rotated to feel natural
        wg.position.set(px, 0, pz);
        wg.rotation.y = this.player.rotationY + (Math.random() - 0.5) * 0.6;
        wg.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        this.scene.add(wg);

        // ── 5. Register as a pickupable item ─────────
        this.weaponItems.push({ mesh: wg, x: px, z: pz, type: item.type, icon: item.icon });
    }

    // ─────────────────────────────────────────────
    // DRINK ANIMATION
    // ─────────────────────────────────────────────
    startDrinking() {
        // Only if bottle is active, has water, and not already animating
        const item = this.inventory[this.activeSlot];
        if (!item || item.type !== 'Bottle') return;
        if (this.drinkAnim.phase !== 'idle') return;
        if (this.bottleWater <= 0) {
            this.showItemMsg('🧴 La cantimplora está vacía — buscá un río (clic derecho)');
            return;
        }
        if (!this.heldWeaponMesh) return;

        // Save resting transform so we can smoothly return
        this.drinkAnim.restPos = this.heldWeaponMesh.position.clone();
        this.drinkAnim.restRot = this.heldWeaponMesh.rotation.clone();
        this.drinkAnim.restScale = this.heldWeaponMesh.scale.x;
        this.drinkAnim.t = 0;
        this.drinkAnim.phase = 'raising';
    }

    updateDrinkAnim(dt) {
        const da = this.drinkAnim;
        if (da.phase === 'idle') return;
        const wm = this.heldWeaponMesh;
        if (!wm) { da.phase = 'idle'; return; }

        // Speed constants (seconds per phase)
        const RAISE_DUR = 0.55;  // time to bring bottle to mouth
        const HOLD_DUR = 0.30;  // time held at mouth (drinking)
        const LOWER_DUR = 0.45;  // time to return

        // Target transform (bottle raised to mouth)
        // In first-person: move up + toward center, tilt backward
        const isFirst = this.cameraMode === 'first';

        if (da.phase === 'raising') {
            da.t = Math.min(1, da.t + dt / RAISE_DUR);
            const ease = da.t * da.t * (3 - 2 * da.t); // smoothstep

            if (isFirst) {
                // Raise toward mouth: move up+left, tilt can toward face
                wm.position.set(
                    da.restPos.x + ease * (-0.04),
                    da.restPos.y + ease * 0.18,
                    da.restPos.z + ease * 0.10
                );
                wm.rotation.set(
                    da.restRot.x + ease * (-1.1),  // tilt can mouth toward face
                    da.restRot.y + ease * 0.15,
                    da.restRot.z + ease * 0.2
                );
            } else {
                // Third-person: arm raises up
                wm.position.set(
                    da.restPos.x,
                    da.restPos.y + ease * 0.25,
                    da.restPos.z
                );
                wm.rotation.set(
                    da.restRot.x + ease * (-1.0),
                    da.restRot.y,
                    da.restRot.z
                );
            }

            if (da.t >= 1) {
                da.t = 0;
                da.phase = 'drinking';
            }

        } else if (da.phase === 'drinking') {
            da.t = Math.min(1, da.t + dt / HOLD_DUR);

            // Subtle tip wobble (drinking glug)
            const wobble = Math.sin(da.t * Math.PI * 4) * 0.06;
            if (isFirst) {
                wm.rotation.x = da.restRot.x - 1.1 + wobble;
            } else {
                wm.rotation.x = da.restRot.x - 1.0 + wobble;
            }

            if (da.t >= 1) {
                // ── Apply effect ──────────────────────────
                const sip = Math.min(30, this.bottleWater);
                this.bottleWater = Math.max(0, this.bottleWater - 30);
                this.hydration = Math.min(100, this.hydration + sip);
                this.updateBottleHUD();

                // Immediately refresh HUD bars
                const barEl = document.getElementById('bar-hydration');
                const valEl = document.getElementById('val-hydration');
                if (barEl) barEl.style.width = this.hydration + '%';
                if (valEl) valEl.textContent = Math.ceil(this.hydration);

                this.showItemMsg(`🧴 +${Math.round(sip)} hidratación · ${Math.round(this.bottleWater)}% restante`);

                da.t = 0;
                da.phase = 'lowering';
            }

        } else if (da.phase === 'lowering') {
            da.t = Math.min(1, da.t + dt / LOWER_DUR);
            const ease = 1 - (1 - da.t) * (1 - da.t); // ease-out

            if (isFirst) {
                wm.position.set(
                    da.restPos.x + (1 - ease) * (-0.04),
                    da.restPos.y + (1 - ease) * 0.18,
                    da.restPos.z + (1 - ease) * 0.10
                );
                wm.rotation.set(
                    da.restRot.x + (1 - ease) * (-1.1),
                    da.restRot.y + (1 - ease) * 0.15,
                    da.restRot.z + (1 - ease) * 0.2
                );
            } else {
                wm.position.set(
                    da.restPos.x,
                    da.restPos.y + (1 - ease) * 0.25,
                    da.restPos.z
                );
                wm.rotation.set(
                    da.restRot.x + (1 - ease) * (-1.0),
                    da.restRot.y,
                    da.restRot.z
                );
            }

            if (da.t >= 1) {
                // Snap exactly to rest position
                wm.position.copy(da.restPos);
                wm.rotation.copy(da.restRot);
                da.phase = 'idle';
            }
        }
    }

    // ─────────────────────────────────────────────
    // BOTTLE MECHANIC
    // ─────────────────────────────────────────────
    useBottle() {
        // River detection (same formula used in update())
        const riverZCenter = Math.sin(this.player.position.x / 150) * 120 + 350;
        const distToRiver = Math.abs(this.player.position.z - riverZCenter);
        const nearRiver = distToRiver < 45; // slightly wider than swim-zone so you can fill from the bank

        if (nearRiver) {
            // FILL (right-click near river)
            if (this.bottleWater >= 100) {
                this.showItemMsg('🧴 La cantimplora ya est\u00e1 llena');
            } else {
                this.bottleWater = 100;
                this.updateBottleHUD();
                this.showItemMsg('🧴 Cantimplora llena al 100%');
            }
        } else {
            // Not near river — remind player how to fill
            this.showItemMsg('🧴 Ve al r\u00edo para llenar la cantimplora (clic derecho cerca del agua)');
        }
    }

    useRama() {
        // 1. Check inventory
        const item = this.inventory[this.activeSlot];
        if (!item || item.type !== 'Rama' || item.count <= 0) return;

        // 2. Determine placement position (1.2m in front of player)
        const dropDist = 1.2;
        const px = this.player.position.x - Math.sin(this.player.rotationY) * dropDist;
        const pz = this.player.position.z - Math.cos(this.player.rotationY) * dropDist;
        const py = 0; // on ground

        // Block building in river
        const riverZ = Math.sin(px / 150) * 120 + 350;
        if (Math.abs(pz - riverZ) < 38) {
            this.showItemMsg('🚫 No podés armar una fogata en el río');
            return;
        }

        // 3. Find nearby pile
        let cf = this.findNearbyCampfire(px, pz, 1.5);

        if (cf) {
            if (cf.sticks >= 5) {
                this.showItemMsg('🔥 La pila ya tiene 5 ramas — usá el encendedor');
                return;
            }
            cf.sticks++;
            this.addStickToVisual(cf);
            this.showItemMsg(`🪵 Rama añadida (${cf.sticks}/5)`);
        } else {
            // Create new pile
            const g = new THREE.Group();
            g.position.set(px, py, pz);
            this.scene.add(g);
            cf = { mesh: g, sticks: 1, isLit: false, x: px, z: pz };
            this.campfires.push(cf);
            this.addStickToVisual(cf);
            this.showItemMsg('🪵 Iniciando fogata (1/5 ramas)');
        }

        // 4. Consume 1 item
        item.count--;
        if (item.count <= 0) {
            this.inventory[this.activeSlot] = null;
        }
        this.refreshInventorySlot(this.activeSlot);
        if (item.count <= 0) this.equipWeapon(this.activeSlot);
    }

    useLighter() {
        const px = this.player.position.x;
        const pz = this.player.position.z;
        const cf = this.findNearbyCampfire(px, pz, 2.5);

        if (!cf) {
            this.showItemMsg('🔥 No hay ninguna fogata cerca');
            return;
        }
        if (cf.sticks < 5) {
            this.showItemMsg('🔥 Faltan ramas (${cf.sticks}/5) para prender el fuego');
            return;
        }
        if (cf.isLit) {
            this.showItemMsg('🔥 La fogata ya está encendida');
            return;
        }

        // Remove ash if re-lighting
        if (cf.ashMesh) {
            cf.mesh.remove(cf.ashMesh);
            cf.ashMesh = null;
        }

        cf.isLit = true;

        // Group fire visuals
        const fg = new THREE.Group();
        cf.fireGroup = fg;
        cf.mesh.add(fg);

        // Visual fire
        const fireGeo = new THREE.ConeGeometry(0.35, 0.7, 8);
        const fireMat = new THREE.MeshStandardMaterial({
            color: 0xff4400,
            emissive: 0xff1100,
            emissiveIntensity: 2,
            transparent: true,
            opacity: 0.8
        });
        const fire = new THREE.Mesh(fireGeo, fireMat);
        fire.position.set(0, 0.35, 0);
        fg.add(fire);
        cf.fireMesh = fire;

        // Add a point light for the fire
        const light = new THREE.PointLight(0xff6600, 15, 12);
        light.position.set(0, 0.5, 0);
        fg.add(light);

        // Smoke particles
        cf.smokeParticles = [];
        const smokeGeo = new THREE.SphereGeometry(0.18, 5, 5); // slightly larger
        const smokeMat = new THREE.MeshStandardMaterial({ color: 0x555555, transparent: true, opacity: 0.5 });
        for (let i = 0; i < 25; i++) { // More particles
            const s = new THREE.Mesh(smokeGeo, smokeMat.clone());
            s.position.set((Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 15, (Math.random() - 0.5) * 0.3);
            s.scale.setScalar(0.7 + Math.random() * 1.5);
            fg.add(s);
            cf.smokeParticles.push({ mesh: s, speed: 0.8 + Math.random() * 2.0, offset: Math.random() * Math.PI * 2 });
        }

        this.showItemMsg('🔥 ¡Fogata encendida!');
    }

    updateCampfires(dt) {
        const time = performance.now() * 0.001;
        for (const cf of this.campfires) {
            if (!cf.isLit || !cf.fireGroup) continue;

            // Flicker fire
            if (cf.fireMesh) {
                cf.fireMesh.scale.x = 1 + Math.sin(time * 20) * 0.1;
                cf.fireMesh.scale.z = 1 + Math.cos(time * 22) * 0.1;
                cf.fireMesh.scale.y = 1 + Math.sin(time * 15) * 0.15;
            }

            // Animate smoke
            if (cf.smokeParticles) {
                for (const p of cf.smokeParticles) {
                    p.mesh.position.y += p.speed * dt;
                    p.mesh.position.x += Math.sin(time * 1.5 + p.offset) * 0.05;
                    p.mesh.material.opacity -= 0.03 * dt; // slow fade

                    if (p.mesh.position.y > 28 || p.mesh.material.opacity <= 0) { // Height of tallest trees
                        p.mesh.position.y = 0.5;
                        p.mesh.position.x = (Math.random() - 0.5) * 0.4;
                        p.mesh.position.z = (Math.random() - 0.5) * 0.4;
                        p.mesh.material.opacity = 0.5;
                    }
                }
            }

            // ── PLAYER BURNING ──
            const dx = cf.x - this.player.position.x;
            const dz = cf.z - this.player.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq < 1.1 * 1.1) {
                // Take damage over time
                this.health -= 12 * dt; // approx 12 hp per second
                if (Math.random() < 0.15) this.triggerDamageFlash(); // flicker red
            }
        }
    }

    findNearbyCampfire(x, z, radius) {
        let best = null, bestDistSq = radius * radius;
        for (const cf of this.campfires) {
            const dx = cf.x - x, dz = cf.z - z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                best = cf;
            }
        }
        return best;
    }

    addStickToVisual(cf) {
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1.0 });
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), woodMat);

        // Arrange sticks in a "teepee" or pile shape based on count
        const i = cf.sticks - 1;
        const angle = (i / 5) * Math.PI * 2;
        stick.rotation.set(0.6, angle, 0); // Lean inward
        stick.position.set(Math.cos(angle) * 0.15, 0.2, Math.sin(angle) * 0.15);

        cf.mesh.add(stick);
    }

    // Update the Bottle HUD slot to show current fill %
    updateBottleHUD() {
        const slotIdx = this.inventory.findIndex(s => s && s.type === 'Bottle');
        if (slotIdx === -1) return;
        this.refreshInventorySlot(slotIdx);
    }

    useFood() {
        const item = this.inventory[this.activeSlot];
        if (!item || (item.type !== 'Muslo' && item.type !== 'Costilla')) return;

        let gain = item.isCooked ? 30 : 20;

        this.hunger = Math.min(100, this.hunger + gain);
        item.count--;

        if (item.count <= 0) {
            this.inventory[this.activeSlot] = null;
            this.equipWeapon(this.activeSlot);
        }
        this.refreshInventorySlot(this.activeSlot);

        this.showItemMsg(`😋 +${gain} hambre restaurada (${item.isCooked ? 'Cocinada' : 'Cruda'})`);
    }

    tryCookFood() {
        const activeItem = this.inventory[this.activeSlot];
        if (!activeItem || (activeItem.type !== 'Muslo' && activeItem.type !== 'Costilla')) return;
        if (activeItem.isCooked) {
            this.showItemMsg('👨‍🍳 La carne ya está cocinada');
            return;
        }

        const cf = this.findNearbyCampfire(this.player.position.x, this.player.position.z, 3.0);
        if (!cf || !cf.isLit) {
            this.showItemMsg('🔥 Necesitás una fogata encendida para cocinar');
            return;
        }

        activeItem.isCooked = true;
        this.refreshInventorySlot(this.activeSlot);
        this.equipWeapon(this.activeSlot); // update mesh if needed (color change)
        this.showItemMsg('👨‍🍳 ¡Carne cocinada! (Ahora nutre el doble)');
    }

    // Generic brief on-screen message that auto-fades after 2.5 s
    showItemMsg(text) {
        let el = document.getElementById('item-msg');
        if (!el) {
            el = document.createElement('div');
            el.id = 'item-msg';
            Object.assign(el.style, {
                position: 'fixed',
                top: '14%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.72)',
                color: '#fff',
                fontFamily: "'Inter', sans-serif",
                fontSize: '15px',
                padding: '8px 20px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.15)',
                pointerEvents: 'none',
                zIndex: '9999',
                transition: 'opacity 0.4s',
            });
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.style.opacity = '1';
        clearTimeout(this._itemMsgTimer);
        this._itemMsgTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
    }

    // ─────────────────────────────────────────────
    // WEAPON IN HAND
    // ─────────────────────────────────────────────
    createWeaponMesh(type) {
        const ironMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.2 });
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.95, roughness: 0.1 });
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.9 });
        const g = new THREE.Group();

        if (type === 'Sword') {
            const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), ironMat);
            pommel.position.y = -0.13; g.add(pommel);
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 7), woodMat);
            handle.position.y = -0.04; g.add(handle);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.02), ironMat);
            guard.position.y = 0.04; g.add(guard);
            const bl = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.55, 0.008), bladeMat);
            bl.position.y = 0.32; g.add(bl);
        } else if (type === 'Spear') {
            // Long spear shaft
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.9, 7), woodMat);
            shaft.position.y = 0.25; g.add(shaft);
            // Spear tip (long leaf-shaped blade)
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.28, 6), ironMat);
            tip.position.y = 1.24; g.add(tip);
            // Butt cap
            const butt = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 6), ironMat);
            butt.rotation.x = Math.PI;
            butt.position.y = -0.69; g.add(butt);
        } else if (type === 'Bow') {
            // ── Bow limbs: two QuadraticBezier arcs curving FORWARD (into +Z) ──
            // Top limb: center(0,0,0) → tip(0, 0.42, 0)
            const topCurve = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(0, 0.00, 0),   // nock point (center)
                new THREE.Vector3(0, 0.25, 0.18), // control — bows forward
                new THREE.Vector3(0, 0.42, 0.02)  // tip top
            );
            const botCurve = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(0, 0.00, 0),
                new THREE.Vector3(0, -0.25, 0.18),
                new THREE.Vector3(0, -0.42, 0.02)
            );
            const bowMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1a, roughness: 0.85 });
            g.add(new THREE.Mesh(new THREE.TubeGeometry(topCurve, 20, 0.022, 7), bowMat));
            g.add(new THREE.Mesh(new THREE.TubeGeometry(botCurve, 20, 0.022, 7), bowMat));

            // Small grip wrap at center
            const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.10, 8), new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 1 }));
            grip.rotation.x = Math.PI / 2; // align with Y-axis limbs; it IS already along Y since limbs go in Y
            g.add(grip);

            // ── Bowstring: from tip-top to tip-bottom, slightly in front ──
            const strMat = new THREE.MeshStandardMaterial({ color: 0xe8ddc0, roughness: 0.6 });
            // String top half (tip to center, pulled back slightly in -Z)
            const strTop = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(0, 0.42, 0.02), // top tip
                new THREE.Vector3(0, 0.05, -0.06), // pulled back at nock
                new THREE.Vector3(0, 0.00, -0.05)  // center (nock)
            );
            const strBot = new THREE.QuadraticBezierCurve3(
                new THREE.Vector3(0, -0.42, 0.02), // bottom tip
                new THREE.Vector3(0, -0.05, -0.06),
                new THREE.Vector3(0, 0.00, -0.05)
            );
            g.add(new THREE.Mesh(new THREE.TubeGeometry(strTop, 12, 0.007, 4), strMat));
            g.add(new THREE.Mesh(new THREE.TubeGeometry(strBot, 12, 0.007, 4), strMat));

            // ── Nocked arrow: long shaft along X axis (pointing right = forward in FPS hand) ──
            const arrowMat = new THREE.MeshStandardMaterial({ color: 0x8a6030, roughness: 0.9 });
            const arrowTipMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95, roughness: 0.1 });
            // Arrow shaft — long, horizontal
            const aShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1.05, 6), arrowMat);
            aShaft.rotation.z = Math.PI / 2; // horizontal along X
            aShaft.position.set(0.02, 0, -0.05); g.add(aShaft);
            // Arrowhead
            const aTip = new THREE.Mesh(new THREE.ConeGeometry(0.020, 0.12, 5), arrowTipMat);
            aTip.rotation.z = -Math.PI / 2; // point toward +X
            aTip.position.set(0.57, 0, -0.05); g.add(aTip);
            // Fletching (3 small fins at nock end)
            const fletchMat = new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 1, side: THREE.DoubleSide });
            for (let fi = 0; fi < 3; fi++) {
                const f = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.04), fletchMat);
                f.position.set(-0.50, 0, -0.05);
                f.rotation.x = (fi / 3) * Math.PI * 2;
                f.position.y += Math.sin((fi / 3) * Math.PI * 2) * 0.025;
                f.position.z += Math.cos((fi / 3) * Math.PI * 2) * 0.025 - 0.05;
                g.add(f);
            }
        } else if (type === 'Knife') {
            // ── Survival knife (tactical style) ────────────────────────
            const bladeMat2 = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.95, roughness: 0.15 });
            const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
            const guardMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });

            // Blade — tapered box, tip at +Y
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.30, 0.07), bladeMat2);
            blade.position.y = 0.20; g.add(blade);
            // Serrated spine bump (decorative ridge)
            const spine = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.22, 0.01), bladeMat2);
            spine.position.set(0, 0.22, -0.035); g.add(spine);
            // Crossguard
            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.06, 0.14), guardMat);
            guard.position.y = 0.04; g.add(guard);
            // Handle — textured cylinder
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.030, 0.16, 8), gripMat);
            handle.position.y = -0.06; g.add(handle);
            // Pommel
            const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.030, 0.04, 8), guardMat);
            pommel.position.y = -0.155; g.add(pommel);
            // Grip ridges (3 rings)
            for (let ri = 0; ri < 3; ri++) {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.005, 6, 12), guardMat);
                ring.rotation.x = Math.PI / 2;
                ring.position.y = -0.035 + ri * 0.048; g.add(ring);
            }

        } else if (type === 'Bottle') {
            // ── Military canteen flask ──────────────────────────────────
            const feltMat = new THREE.MeshStandardMaterial({ color: 0x4a5a38, roughness: 1.0 });
            const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, metalness: 0.7, roughness: 0.4 });
            const strapMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 1.0 });
            const capMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.3 });

            // Flask body — flattened sphere (canteen shape)
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), feltMat);
            body.scale.set(1.0, 1.25, 0.65);
            body.position.y = 0.0; g.add(body);
            // Neck
            const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.055, 8), metalMat);
            neck.position.y = 0.128; g.add(neck);
            // Cap
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.035, 8), capMat);
            cap.position.y = 0.165; g.add(cap);
            // Horizontal leather straps (2)
            for (const sy of [-0.03, 0.05]) {
                const strap = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.010, 4, 16), strapMat);
                strap.rotation.x = Math.PI / 2;
                strap.scale.set(1.0, 1.0, 0.65);
                strap.position.y = sy; g.add(strap);
            }
            // Metal rivet dots (4 corners)
            for (const sx of [-0.07, 0.07]) for (const sy of [-0.04, 0.06]) {
                const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 5), metalMat);
                rivet.position.set(sx, sy, 0.062); g.add(rivet);
            }
            // Rope loop at top
            const rope = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 5, 10), strapMat);
            rope.position.set(0, 0.18, 0); g.add(rope);

        } else if (type === 'Rama') {
            const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1.0 });
            const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), woodMat);
            stick.rotation.z = Math.PI / 2;
            g.add(stick);
        } else if (type === 'Muslo' || type === 'Costilla') {
            // Find if cooked from inventory state
            const invItem = this.inventory[this.activeSlot];
            const isCooked = invItem ? invItem.isCooked : false;

            if (type === 'Muslo') {
                const meatMat = new THREE.MeshStandardMaterial({ color: isCooked ? 0x5a2d0c : 0xc04040, roughness: 0.7 });
                const boneMat = new THREE.MeshStandardMaterial({ color: 0xeeecee, roughness: 0.5 });
                const meat = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.08, 4, 8), meatMat);
                meat.rotation.z = Math.PI / 3; g.add(meat);
                const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), boneMat);
                bone.rotation.z = Math.PI / 3; g.add(bone);
            } else {
                const meatMat = new THREE.MeshStandardMaterial({ color: isCooked ? 0x4a1a00 : 0x8b2222, roughness: 0.8 });
                const boneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
                const slab = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.05), meatMat);
                g.add(slab);
                for (let i = -1; i <= 1; i++) {
                    const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), boneMat);
                    bone.position.x = i * 0.05; g.add(bone);
                }
            }
        } else if (type === 'Lighter') {
            // ── Zippo-style flip lighter ────────────────────────────────
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a0a08, metalness: 0.85, roughness: 0.25 });
            const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95, roughness: 0.1 });
            const flameMat = new THREE.MeshStandardMaterial({
                color: 0xff8800, emissive: 0xff4400, emissiveIntensity: 1.8,
                transparent: true, opacity: 0.9, roughness: 1.0
            });
            const flameTip = new THREE.MeshStandardMaterial({
                color: 0xffee00, emissive: 0xffcc00, emissiveIntensity: 2.0,
                transparent: true, opacity: 0.85, roughness: 1.0
            });

            // Main body
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.085, 0.022), bodyMat);
            body.position.y = 0.0; g.add(body);
            // Chrome rim line (bottom)
            const rim = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.008, 0.025), chromeMat);
            rim.position.y = -0.040; g.add(rim);
            // Lid (open, tilted back)
            const lid = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.020), bodyMat);
            lid.position.set(0, 0.07, 0.005);
            lid.rotation.x = -0.55; g.add(lid);
            // Hinge
            const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.058, 7), chromeMat);
            hinge.rotation.z = Math.PI / 2;
            hinge.position.set(0, 0.043, 0.011); g.add(hinge);
            // Flint wheel
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.016, 8), chromeMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(0.02, 0.048, 0.000); g.add(wheel);
            // Flame — outer cone
            const flame = new THREE.Mesh(new THREE.ConeGeometry(0.010, 0.040, 6), flameMat);
            flame.position.set(0, 0.095, -0.002); g.add(flame);
            // Flame — inner bright tip
            const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.022, 5), flameTip);
            flameInner.position.set(0, 0.103, -0.002); g.add(flameInner);
        }

        g.traverse(c => { if (c.isMesh) c.castShadow = true; });
        return g;
    }

    equipWeapon(slotIdx) {
        // Detach old weapon from wherever it was
        if (this.heldWeaponMesh) {
            if (this.heldWeaponMesh.parent) this.heldWeaponMesh.parent.remove(this.heldWeaponMesh);
            this.heldWeaponMesh = null;
        }
        const item = this.inventory[slotIdx];
        if (!item) return;

        const wm = this.createWeaponMesh(item.type);

        if (this.cameraMode === 'first') {
            if (item.type === 'Bow') {
                // Bow: vertical limbs along Y, arrow along X.
                // Rotate 90° around Y → arrow now points along -Z (camera forward).
                // Tilt forward slightly so bow is at arms-length (like the reference image).
                wm.position.set(-0.20, -0.05, -0.50);
                wm.rotation.set(0.18, Math.PI * 0.5, -0.10);
                wm.scale.setScalar(0.40);
            } else if (item.type === 'Spear') {
                // Tip (+Y after rotating -PI/2 on X) points into -Z (forward / crosshair).
                // Move left and up so shaft goes bottom-right → tip near crosshair.
                wm.position.set(0.18, -0.22, -0.28);
                wm.rotation.set(-Math.PI / 2 + 0.22, 0.18, -0.22);
                wm.scale.setScalar(0.32);
            } else if (item.type === 'Knife') {
                // Low in hand, blade pointing forward-up
                wm.position.set(0.26, -0.22, -0.34);
                wm.rotation.set(0.15, -0.25, 0.05);
                wm.scale.setScalar(0.55);
            } else if (item.type === 'Bottle') {
                // Held at hip-right, canteen flat facing player
                wm.position.set(0.24, -0.22, -0.38);
                wm.rotation.set(0.10, -0.20, 0.30);
                wm.scale.setScalar(0.55);
            } else if (item.type === 'Rama') {
                wm.position.set(0.22, -0.18, -0.30);
                wm.rotation.set(0.4, -0.4, 0.2);
                wm.scale.setScalar(1.0);
            } else if (item.type === 'Muslo') {
                wm.position.set(0.24, -0.22, -0.32);
                wm.rotation.set(0.1, 0, 0);
                wm.scale.setScalar(1.2);
            } else if (item.type === 'Costilla') {
                wm.position.set(0.24, -0.20, -0.35);
                wm.rotation.set(-0.2, 0.4, 0.1);
                wm.scale.setScalar(1.2);
            } else if (item.type === 'Lighter') {
                // Small — cupped in palm, upright with flame visible
                wm.position.set(0.20, -0.18, -0.30);
                wm.rotation.set(-0.10, -0.20, 0.10);
                wm.scale.setScalar(0.65);
            } else {
                // Sword / default
                wm.position.set(0.28, -0.20, -0.38);
                wm.rotation.set(0.20, -0.30, 0.06);
                wm.scale.setScalar(0.38);
            }
            this.camera.add(wm);
        } else {
            // 3rd person: attach to right arm
            if (!this.meshParts.armR) return;
            if (item.type === 'Bow') {
                wm.position.set(0.0, -0.15, 0.10);
                wm.rotation.set(0.0, 0, -0.2);
                wm.scale.setScalar(0.75);
            } else if (item.type === 'Spear') {
                wm.position.set(0.0, -0.30, 0.08);
                wm.rotation.set(-0.3, 0, 0.1);
                wm.scale.setScalar(0.75);
            } else if (item.type === 'Knife') {
                wm.position.set(0.0, -0.20, 0.06);
                wm.rotation.set(-0.3, 0, 0.05);
                wm.scale.setScalar(1.0);
            } else if (item.type === 'Bottle') {
                wm.position.set(0.0, -0.18, 0.08);
                wm.rotation.set(-0.2, 0, 0.3);
                wm.scale.setScalar(1.0);
            } else if (item.type === 'Rama') {
                wm.position.set(0.05, -0.22, 0.10);
                wm.rotation.set(-0.2, 0, 0.4);
                wm.scale.setScalar(1.0);
            } else if (item.type === 'Lighter') {
                wm.position.set(0.0, -0.18, 0.06);
                wm.rotation.set(-0.1, 0, 0.1);
                wm.scale.setScalar(1.1);
            } else {
                wm.position.set(0.0, -0.20, 0.06);
                wm.rotation.set(-0.4, 0, 0.1);
                wm.scale.setScalar(0.7);
            }
            this.meshParts.armR.add(wm);
        }
        this.heldWeaponMesh = wm;
    }

    // ─────────────────────────────────────────────
    // PLAYER MESH (simple humanoid)
    // ─────────────────────────────────────────────
    createPlayerMesh() {
        const isFemale = this.gender === 'female';
        const g = new THREE.Group();

        const skinColor = isFemale ? 0xf0c8a0 : 0xe8b882;
        const clothColor = isFemale ? 0x2d4a1e : 0x3d5a28;
        const hairColor = isFemale ? 0x2a1a0a : 0x1a1008;
        const pantColor = 0x4a3c2a;

        const mat = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });

        // All parts in LOCAL space:
        //   y=0.00 → bottom of shoes (feet)
        //   y=1.00 → top of head
        // The group is then scaled so the final world height = player.height (1.7 units)

        // Shoes   (0.00 → 0.07)
        const shoeGeo = new THREE.BoxGeometry(0.22, 0.07, 0.28);
        const shoeL = new THREE.Mesh(shoeGeo, mat(0x1a1008));
        shoeL.position.set(0.14, 0.035, 0.02);
        const shoeR = new THREE.Mesh(shoeGeo, mat(0x1a1008));
        shoeR.position.set(-0.14, 0.035, 0.02);

        // Legs    (0.07 → 0.43)
        const legGeo = new THREE.BoxGeometry(0.17, 0.36, 0.17);
        const legL = new THREE.Mesh(legGeo, mat(pantColor));
        legL.position.set(0.14, 0.25, 0);
        const legR = new THREE.Mesh(legGeo, mat(pantColor));
        legR.position.set(-0.14, 0.25, 0);

        // Torso   (0.43 → 0.77)
        const torso = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.34, 0.24), mat(clothColor));
        torso.position.y = 0.60;

        // Arms    (beside torso, 0.45 → 0.75)
        const armGeo = new THREE.BoxGeometry(0.14, 0.30, 0.14);
        const armL = new THREE.Mesh(armGeo, mat(clothColor));
        armL.position.set(0.34, 0.60, 0);
        const armR = new THREE.Mesh(armGeo, mat(clothColor));
        armR.position.set(-0.34, 0.60, 0);

        // Head    (0.77 → 0.97)
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.20, 0.28), mat(skinColor));
        head.position.y = 0.87;

        // Hair    (top of head)
        const hairH = isFemale ? 0.10 : 0.05;
        const hair = new THREE.Mesh(new THREE.BoxGeometry(0.34, hairH, 0.30), mat(hairColor));
        hair.position.y = 0.97 + hairH / 2;
        if (isFemale) {
            const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.22, 6), mat(hairColor));
            tail.position.set(0, 0.85, -0.17);
            tail.rotation.x = 0.5;
            g.add(tail);
        }

        g.add(torso, head, hair, legL, legR, shoeL, shoeR, armL, armR);

        // Local height ≈ 1.0 unit (feet at y=0, head-top at y≈1.0)
        // Scale so world height = player.height = 1.7
        g.scale.set(1.5, 1.7, 1.5);

        // Store references for animation
        this.meshParts = { torso, head, hair, legL, legR, armL, armR, shoeL, shoeR };

        this.playerMesh = g;
        this.playerMesh.visible = false;
        g.traverse(c => { if (c.isMesh) c.castShadow = true; });
        this.scene.add(this.playerMesh);
    }

    // ─────────────────────────────────────────────
    // ANIMATION
    // ─────────────────────────────────────────────
    animatePlayerMesh(isMoving, isCrouching, isSprinting, dt) {
        if (!this.playerMesh || !this.playerMesh.visible) return;
        const p = this.meshParts;
        if (!p.legL) return;

        // Advance animation clock (only while moving)
        const freq = isSprinting ? 9 : (isCrouching ? 4 : 6);
        if (isMoving) this.animTime += dt * freq;
        else this.animTime *= 0.75; // coast to idle

        const swing = Math.sin(this.animTime);
        const legSwing = swing * (isSprinting ? 0.55 : (isCrouching ? 0.30 : 0.42));
        const armSwing = swing * (isSprinting ? 0.50 : (isCrouching ? 0.18 : 0.35));

        // ── Leg swing ───────────────────────────────
        p.legL.rotation.x = legSwing;
        p.legR.rotation.x = -legSwing;

        // Crouch: only legs lower (knees bend) — torso/upper body stays upright
        const legTargetY = isCrouching ? 0.14 : 0.25;  // bring hips closer to ground
        p.legL.position.y += (legTargetY - p.legL.position.y) * 0.2;
        p.legR.position.y += (legTargetY - p.legR.position.y) * 0.2;
        // Shoes follow legs
        const shoeTargetY = isCrouching ? 0.025 : 0.035;
        p.shoeL.position.y += (shoeTargetY - p.shoeL.position.y) * 0.2;
        p.shoeR.position.y += (shoeTargetY - p.shoeR.position.y) * 0.2;

        // ── Arm swing ───────────────────────────────
        p.armL.rotation.x = -armSwing;
        p.armR.rotation.x = armSwing;

        // ── Torso/head bob while running (subtle) ───
        const bob = Math.abs(swing) * (isSprinting ? 0.012 : (isMoving ? 0.005 : 0));
        p.torso.position.y = 0.60 + bob;
        p.head.position.y = 0.87 + bob;

        // Torso/head stay NEUTRAL always (no tilt, no scale)
        p.torso.rotation.x = 0;
        p.head.rotation.x = 0;

        // Mesh scale stays constant — no whole-body compression
        this.playerMesh.scale.set(1.5, 1.7, 1.5);
    }
    // ─────────────────────────────────────────────
    // SPATIAL HASH
    // ─────────────────────────────────────────────
    addToSpatialHash(x, z, obj) {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        const key = `${cx},${cz}`;
        if (!this.spatialHash[key]) this.spatialHash[key] = [];
        this.spatialHash[key].push(obj);
    }

    getNearbyObjects(x, z) {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        const results = [];
        for (let ix = -1; ix <= 1; ix++) {
            for (let iz = -1; iz <= 1; iz++) {
                const cell = this.spatialHash[`${cx + ix},${cz + iz}`];
                if (cell) for (let j = 0; j < cell.length; j++) results.push(cell[j]);
            }
        }
        return results;
    }

    // ─────────────────────────────────────────────
    // WORLD
    // ─────────────────────────────────────────────
    createWorld() {
        const textures = this.generateTextures();

        // Ground
        const groundGeo = new THREE.CircleGeometry(this.arenaRadius, 64);
        const groundMat = new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1, side: THREE.DoubleSide });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.ground = ground;

        this.createRiver(textures.water);
        this.createRiverRocks();
        this.createPedestals();
        this.createCornucopia();
        this.createForest(textures.bark);
        this.createEnvironmentDetails(textures.bark);
        this.createAnimals();
        this.createBorderWall();
    }

    // ─────────────────────────────────────────────
    // CORNUCOPIA & WEAPONS
    // ─────────────────────────────────────────────
    createCornucopia() {
        // Positioned ahead of the pedestal ring (~45 units away)
        const OX = 0, OZ = -45;

        const steel = new THREE.MeshStandardMaterial({ color: 0x3a4a55, metalness: 0.9, roughness: 0.2 });
        const dark = new THREE.MeshStandardMaterial({ color: 0x1e2830, metalness: 0.85, roughness: 0.3 });
        const accent = new THREE.MeshStandardMaterial({ color: 0x607080, metalness: 0.95, roughness: 0.1 });
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.95 });
        const ironMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.8, roughness: 0.3 });
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.95, roughness: 0.1 });
        const stringMat = new THREE.MeshStandardMaterial({ color: 0xd2b48c, roughness: 1 });

        const g = new THREE.Group();
        g.position.set(OX, 0, OZ);

        const p = (mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
            mesh.position.set(x, y, z);
            mesh.rotation.set(rx, ry, rz);
            mesh.castShadow = true; mesh.receiveShadow = true;
            g.add(mesh); return mesh;
        };

        // ── Ground base slab ─────────────────────
        p(new THREE.Mesh(new THREE.BoxGeometry(24, 0.4, 14), new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9 })), 0, 0.2, 0);

        // ── Main horn body: tapered angular hull ──
        // We build the horn as a series of cross-section boxes that get smaller toward the tip
        // Front (mouth) is large and open, rear tapers to a spike

        // Floor of the horn
        p(new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 10), dark), -0.5, 1.5, 0);

        // Left wall panel (outer)
        p(new THREE.Mesh(new THREE.BoxGeometry(18, 6, 0.5), steel), -0.5, 4, -5, 0, 0, 0.18);

        // Right wall panel (outer)
        p(new THREE.Mesh(new THREE.BoxGeometry(18, 6, 0.5), steel), -0.5, 4, 5, 0, 0, -0.18);

        // Roof panel (slopes down from front to back)
        p(new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 10), dark), -0.5, 7.5, 0, 0.28, 0, 0);

        // Back wall (closes the horn)
        p(new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 12), steel), 8.5, 5, 0);

        // ── Spine fin (top center) ─────────────────
        // Large triangular fin running along top-center, tapering to a point at back
        // Approximated with boxes at decreasing height
        for (let i = 0; i < 8; i++) {
            const t = i / 7;
            const bx = 1.8 - t * 1.4;
            const bh = 5 - t * 4.5;
            const bz = -3 + i * 1.0;
            p(new THREE.Mesh(new THREE.BoxGeometry(bx, bh, 0.9), accent), -1 + t * 9, 7.5 + bh / 2 - 0.3, bz);
        }

        // ── Inner ceiling ribs (structural panels) ─
        for (let r = 0; r < 4; r++) {
            const xPos = -5 + r * 3.5;
            p(new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 9), dark), xPos, 5, 0, 0, 0, 0.12);
        }

        // ── Mouth arch pillars (front opening) ───
        // Left pillar
        p(new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), steel), -9.5, 4.5, -5);
        // Right pillar
        p(new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), steel), -9.5, 4.5, 5);
        // Top lintel
        p(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 12), accent), -9.5, 9, 0);

        // ── Sharp spike tip at rear ───────────────
        p(new THREE.Mesh(new THREE.ConeGeometry(1.2, 5, 5), steel), 11, 5, 0, 0, 0.4, Math.PI / 2);

        // ── Side accent panel lines (grooves) ─────
        for (let l = 0; l < 3; l++) {
            p(new THREE.Mesh(new THREE.BoxGeometry(16, 0.15, 0.15), accent), -0.5, 3 + l * 2, -5.3);
            p(new THREE.Mesh(new THREE.BoxGeometry(16, 0.15, 0.15), accent), -0.5, 3 + l * 2, 5.3);
        }

        this.scene.add(g);

        // ── Register solid wall colliders ─────────
        // Left wall (z = OZ - 5 = -50)
        this.solidBoxes.push({ x1: OX - 10, x2: OX + 10, z1: OZ - 5.4, z2: OZ - 4.6, h: 10 });
        // Right wall (z = OZ + 5 = -40)
        this.solidBoxes.push({ x1: OX - 10, x2: OX + 10, z1: OZ + 4.6, z2: OZ + 5.4, h: 10 });
        // Back wall (x = OX + 8.5 = 8.5)
        this.solidBoxes.push({ x1: OX + 8.0, x2: OX + 10, z1: OZ - 6, z2: OZ + 6, h: 10 });
        // Front pillars (mouth entrance sides)
        this.solidBoxes.push({ x1: OX - 10.2, x2: OX - 9.0, z1: OZ - 5.6, z2: OZ - 4.4, h: 10 });
        this.solidBoxes.push({ x1: OX - 10.2, x2: OX - 9.0, z1: OZ + 4.4, z2: OZ + 5.6, h: 10 });

        // ── Weapon Crates scattered in front of Cornucopia ──
        const crateMat = new THREE.MeshStandardMaterial({ color: 0x7a5c2e, roughness: 0.9 });
        const crateEdge = new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 0.95 });
        const crateIron = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 });

        const makeCrate = (x, z, type, icon) => {
            const wg = new THREE.Group();
            const wx = OX + x, wz = OZ + z;

            // Main box
            const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.75), crateMat);
            box.position.y = 0.375; wg.add(box);
            // Horizontal plank lines front/back
            for (let i = 0; i < 2; i++) {
                const plank = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.05, 0.02), crateEdge);
                plank.position.set(0, 0.22 + i * 0.3, 0.375); wg.add(plank);
                const pb = plank.clone(); pb.position.z = -0.375; wg.add(pb);
            }
            // Vertical corner strips
            for (const xs of [-0.48, 0.48]) {
                const vert = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.77, 0.77), crateEdge);
                vert.position.set(xs, 0.375, 0); wg.add(vert);
            }
            // Iron corner brackets
            for (const xs of [-0.45, 0.45]) for (const zs of [-0.33, 0.33]) {
                const brkt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), crateIron);
                brkt.position.set(xs, 0.72, zs); wg.add(brkt);
            }
            // Lid
            const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.08, 0.79), crateEdge);
            lid.position.y = 0.79; wg.add(lid);

            wg.position.set(wx, 0, wz);
            wg.rotation.y = (x * 3.7 + z * 1.3) % (Math.PI * 2); // pseudo-random angle
            wg.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            this.scene.add(wg);
            this.weaponItems.push({ mesh: wg, x: wx, z: wz, type, icon });
        };

        makeCrate(-8, 8, 'Bow', '🏹');
        makeCrate(6, 9, 'Bow', '🏹');
        makeCrate(2, 12, 'Bow', '🏹');
        makeCrate(-5, 10, 'Sword', '⚔️');
        makeCrate(9, 6, 'Sword', '⚔️');
        makeCrate(-10, 5, 'Sword', '⚔️');
        makeCrate(0, 13, 'Sword', '⚔️');
        makeCrate(-3, 7, 'Spear', '🗡️');
        makeCrate(7, 11, 'Spear', '🗡️');
        makeCrate(-7, 13, 'Spear', '🗡️');
        makeCrate(4, 8, 'Spear', '🗡️');
    }

    // ─────────────────────────────────────────────
    // BORDER WALL
    // ─────────────────────────────────────────────
    createBorderWall() {
        const wallHeight = 80, wallThickness = 6, segments = 128;

        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#484848'; ctx.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 512; y += 32) { ctx.fillStyle = '#282828'; ctx.fillRect(0, y, 512, 3); }
        for (let y = 0; y < 512; y += 32) {
            const off = ((y / 32) % 2 === 0) ? 0 : 64;
            for (let x = off; x < 512; x += 128) { ctx.fillStyle = '#282828'; ctx.fillRect(x, y, 3, 32); }
        }
        for (let i = 0; i < 200; i++) {
            const s = Math.floor(Math.random() * 30 + 55);
            ctx.fillStyle = `rgba(${s},${s},${s},0.25)`;
            ctx.fillRect(Math.floor(Math.random() * 4) * 128 + 4, Math.floor(Math.random() * 16) * 32 + 4, 120, 26);
        }
        const stoneTex = new THREE.CanvasTexture(canvas);
        stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
        stoneTex.repeat.set(32, 4);

        const wallGeo = new THREE.CylinderGeometry(
            this.arenaRadius + wallThickness, this.arenaRadius + wallThickness,
            wallHeight, segments, 1, true
        );
        const wall = new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({
            map: stoneTex, color: 0x888888, roughness: 0.95, side: THREE.BackSide
        }));
        wall.position.y = wallHeight / 2 - 1;
        this.scene.add(wall);

        const capGeo = new THREE.RingGeometry(this.arenaRadius, this.arenaRadius + wallThickness, segments);
        const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ map: stoneTex, side: THREE.DoubleSide }));
        cap.rotation.x = -Math.PI / 2;
        cap.position.y = wallHeight - 1;
        this.scene.add(cap);
    }

    // ─────────────────────────────────────────────
    // RIVER
    // ─────────────────────────────────────────────
    createRiver(waterTex) {
        const points = [];
        for (let i = -this.arenaRadius; i <= this.arenaRadius; i += 20)
            points.push(new THREE.Vector3(i, 0.05, Math.sin(i / 150) * 120 + 350));

        const curve = new THREE.CatmullRomCurve3(points);
        this.riverCurve = curve;

        const riverWidth = 70, riverDepth = 15, segments = 250;

        const groundTex = this.generateTextures().grass.clone();
        groundTex.repeat.set(1, 10);

        // Build a ribbon following the curve
        const ribbon = (width, height) => {
            const verts = [], uvs = [], idx = [];
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const pos = curve.getPoint(t);
                const tan = curve.getTangent(t);
                const norm = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
                const p1 = pos.clone().addScaledVector(norm, width / 2);
                const p2 = pos.clone().addScaledVector(norm, -width / 2);
                verts.push(p1.x, height, p1.z, p2.x, height, p2.z);
                uvs.push(t * 20, 0, t * 20, 1);
                if (i < segments) {
                    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                    idx.push(a, b, c, b, d, c);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            g.setIndex(idx);
            g.computeVertexNormals();
            return g;
        };

        // Water surface
        const water = new THREE.Mesh(ribbon(riverWidth, 0.05), new THREE.MeshStandardMaterial({
            map: waterTex, color: 0x40e0d0, transparent: true, opacity: 0.65,
            roughness: 0.1, metalness: 0.3, side: THREE.DoubleSide
        }));
        this.scene.add(water);

        // Bottom
        const bottom = new THREE.Mesh(ribbon(riverWidth, -riverDepth), new THREE.MeshStandardMaterial({
            map: groundTex, color: 0x2e3b18, roughness: 1, side: THREE.DoubleSide
        }));
        bottom.receiveShadow = true;
        this.scene.add(bottom);

        // Side walls
        const wallRibbon = (side) => {
            const verts = [], uvs = [], idx = [];
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const pos = curve.getPoint(t);
                const tan = curve.getTangent(t);
                const norm = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
                const pTop = pos.clone().addScaledVector(norm, side * riverWidth / 2); pTop.y = 0.05;
                const pBot = pTop.clone(); pBot.y = -riverDepth;
                verts.push(pTop.x, pTop.y, pTop.z, pBot.x, pBot.y, pBot.z);
                uvs.push(t * 20, 0, t * 20, 1);
                if (i < segments) {
                    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                    idx.push(a, b, c, b, d, c);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            g.setIndex(idx);
            g.computeVertexNormals();
            return g;
        };
        const wallMat = new THREE.MeshStandardMaterial({ map: groundTex, color: 0x222211, roughness: 1, side: THREE.DoubleSide });
        this.scene.add(new THREE.Mesh(wallRibbon(1), wallMat));
        this.scene.add(new THREE.Mesh(wallRibbon(-1), wallMat));
    }

    // ─────────────────────────────────────────────
    // RIVER ROCKS
    // ─────────────────────────────────────────────
    createRiverRocks() {
        if (!this.riverCurve) return;
        const count = 1000;
        const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.9 });
        const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
        mesh.castShadow = false;

        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            const t = Math.random();
            const pos = this.riverCurve.getPoint(t);
            const side = (Math.random() - 0.5) * 110;

            // Submerged rocks in the trench bottom
            if (Math.abs(side) < 30) {
                const rx = pos.x + (Math.random() - 0.5) * 10;
                const rz = pos.z + side;
                const scale = 0.8 + Math.random() * 2.0;
                dummy.position.set(rx, -14.8, rz);
                dummy.scale.set(scale, scale * 0.5, scale);
                dummy.rotation.set(0, Math.random() * Math.PI, 0);
                dummy.updateMatrix();
                mesh.setMatrixAt(i, dummy.matrix);
                // These are decorative only — no collision needed
                continue;
            }

            // Bank rocks (jumpable)
            const scale = 0.5 + Math.random() * 1.4;
            const rx = pos.x + (Math.random() - 0.5) * 15;
            const rz = pos.z + side;
            const rockH = scale * 0.5; // top surface height

            dummy.position.set(rx, rockH * 0.5, rz);
            dummy.scale.set(scale, scale * 0.6, scale);
            dummy.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);

            // Store top-of-rock height for collision
            const rock = { type: 'rock', x: rx, z: rz, r: scale * 0.85, topY: rockH };
            this.rockData.push(rock);
            this.addToSpatialHash(rx, rz, rock);
        }
        mesh.receiveShadow = true;
        this.scene.add(mesh);
    }

    // ─────────────────────────────────────────────
    // PEDESTALS
    // ─────────────────────────────────────────────
    createPedestals() {
        const count = 24, radius = 15;
        const geo = new THREE.CylinderGeometry(1.2, 1.2, 0.6, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.6, roughness: 0.2 });
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const px = Math.cos(angle) * radius, pz = Math.sin(angle) * radius;
            const ped = new THREE.Mesh(geo, mat);
            ped.position.set(px, 0.3, pz);
            ped.castShadow = true; ped.receiveShadow = true;
            this.scene.add(ped);
            this.pedestals.push({ x: px, z: pz, r: 1.2, h: 0.6 });
        }
    }

    // ─────────────────────────────────────────────
    // FOREST
    // ─────────────────────────────────────────────
    createForest(barkTex) {
        const realCount = 3500; // Increased Tree Count
        const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 1, 8);
        const leavesGeo = new THREE.ConeGeometry(3, 10, 8);
        const pineTrunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 1, 8);
        const pineLeavesGeo = new THREE.SphereGeometry(4, 8, 8);

        const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex });
        const leavesMat = new THREE.MeshStandardMaterial({ color: 0x1a451b });
        const pineLeavesMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });

        const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, realCount);
        const leavesInst = new THREE.InstancedMesh(leavesGeo, leavesMat, realCount);
        const pineTrunkInst = new THREE.InstancedMesh(pineTrunkGeo, trunkMat, realCount);
        const pineLeavesInst = new THREE.InstancedMesh(pineLeavesGeo, pineLeavesMat, realCount);

        trunkInst.castShadow = false; leavesInst.castShadow = false;
        pineTrunkInst.castShadow = true; pineLeavesInst.castShadow = true;

        const dummy = new THREE.Object3D();
        let reg = 0, pine = 0;

        for (let i = 0; i < realCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * (this.arenaRadius - 80);
            const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
            const riverZ = Math.sin(x / 150) * 120 + 350;
            if (Math.abs(z - riverZ) < 60) { i--; continue; }

            const isPine = Math.random() > 0.5;
            let h = 1.0;
            if (isPine) {
                h = 15 + Math.random() * 10;
                dummy.position.set(x, h / 2, z); dummy.scale.set(1, h, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
                pineTrunkInst.setMatrixAt(pine, dummy.matrix);
                dummy.position.set(x, h, z); dummy.scale.set(1.5, 0.4, 1.5); dummy.updateMatrix();
                pineLeavesInst.setMatrixAt(pine, dummy.matrix);
                pine++;
            } else {
                h = 1.0 + Math.random() * 6.0;
                dummy.position.set(x, h / 2, z); dummy.scale.set(1, h, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
                trunkInst.setMatrixAt(reg, dummy.matrix);
                dummy.position.set(x, h + 4, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
                leavesInst.setMatrixAt(reg, dummy.matrix);
                reg++;
            }
            const tree = { type: 'tree', x, z, r: 0.8, h: h, isPine: isPine };
            this.forestData.push(tree);
            this.addToSpatialHash(x, z, tree);
        }
        this.scene.add(trunkInst, leavesInst, pineTrunkInst, pineLeavesInst);
    }

    // ─────────────────────────────────────────────
    // ENVIRONMENT DETAILS (Bushes & Twigs)
    // ─────────────────────────────────────────────
    createEnvironmentDetails(barkTex) {
        // Bushes: spheres of different sizes and greens
        const bushCount = 1800;
        const bushGeo = new THREE.SphereGeometry(1, 8, 8);
        const bushColors = [0x224411, 0x11330a, 0x334a1a];

        // Since different colors, we split bushes into 3 InstancedMeshes
        const bushInsts = bushColors.map(c => new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: c, roughness: 1 }), bushCount / 3));

        // Twigs: small cylinders
        const twigCount = 1200;
        const twigGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
        const twigInst = new THREE.InstancedMesh(twigGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), twigCount);

        const dummy = new THREE.Object3D();

        // Place Bushes
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < bushCount / 3; j++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 30 + Math.random() * (this.arenaRadius - 60);
                const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
                const riverZ = Math.sin(x / 150) * 120 + 350;
                if (Math.abs(z - riverZ) < 50) { j--; continue; }

                const s = 0.5 + Math.random() * 2.0;
                dummy.position.set(x, s * 0.4, z);
                dummy.scale.set(s, s * 0.8, s);
                dummy.rotation.set(0, Math.random() * Math.PI, 0);
                dummy.updateMatrix();
                bushInsts[i].setMatrixAt(j, dummy.matrix);
            }
            this.scene.add(bushInsts[i]);
        }

        // Place Twigs
        for (let i = 0; i < twigCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 30 + Math.random() * (this.arenaRadius - 60);
            const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
            const riverZ = Math.sin(x / 150) * 120 + 350;
            if (Math.abs(z - riverZ) < 40) { i--; continue; }

            const s = 0.5 + Math.random();
            dummy.position.set(x, 0.05, z);
            dummy.scale.set(1, s, 1);
            dummy.rotation.set(Math.PI / 2, Math.random() * Math.PI, Math.random() * 0.5);
            dummy.updateMatrix();
            twigInst.setMatrixAt(i, dummy.matrix);

            // Store metadata for picking up
            this.environmentMeshData.twigs.push({ x, z, originalIndex: i, collected: false });
        }
        this.twigInst = twigInst;
        this.scene.add(twigInst);
    }

    // ─────────────────────────────────────────────
    // ANIMALS
    // ─────────────────────────────────────────────
    createAnimals() {
        const createRabbit = () => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0x998877 }));
            body.scale.set(1.4, 1, 1);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: 0x998877 }));
            head.position.set(0.18, 0.15, 0);
            const ears = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.08), new THREE.MeshStandardMaterial({ color: 0xaa9988 }));
            ears.position.set(0.2, 0.3, 0);
            g.add(body, head, ears);
            return g;
        };

        const createDeer = () => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
            body.position.y = 0.8;
            const neck = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
            neck.position.set(0.3, 1.2, 0); neck.rotation.z = -0.4;
            const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
            head.position.set(0.45, 1.4, 0);
            const legs = [];
            for (let i = 0; i < 4; i++) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), new THREE.MeshStandardMaterial({ color: 0x5d3a1a }));
                leg.position.set(i < 2 ? 0.2 : -0.2, 0.4, i % 2 ? 0.1 : -0.1);
                legs.push(leg);
            }
            // Antlers for some deer
            if (Math.random() > 0.5) {
                const antlers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x4a2a1a }));
                antlers.position.set(0.45, 1.65, 0); g.add(antlers);
            }
            g.add(body, neck, head, ...legs);
            return g;
        };

        // Spawn 100 Rabbits
        for (let i = 0; i < 100; i++) {
            const mesh = createRabbit();
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * (this.arenaRadius - 100);
            const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
            mesh.position.set(x, 0, z);
            this.scene.add(mesh);
            this.animals.push({
                mesh, type: 'rabbit', state: 'idle', t: 0,
                pos: mesh.position.clone(), rot: Math.random() * Math.PI * 2,
                hp: 1, maxHp: 1, radius: 0.4, height: 0.5
            });
        }

        // Spawn 50 Deer
        for (let i = 0; i < 50; i++) {
            const mesh = createDeer();
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * (this.arenaRadius - 100);
            const x = Math.cos(angle) * dist, z = Math.sin(angle) * dist;
            mesh.position.set(x, 0, z);
            this.scene.add(mesh);
            this.animals.push({
                mesh, type: 'deer', state: 'idle', t: 0,
                pos: mesh.position.clone(), rot: Math.random() * Math.PI * 2,
                hp: 2, maxHp: 2, radius: 0.8, height: 1.6
            });
        }
    }

    // ─────────────────────────────────────────────
    // ANIMAL AI
    // ─────────────────────────────────────────────
    updateAnimals(dt) {
        for (const a of this.animals) {
            const distToPlayer = a.mesh.position.distanceTo(this.player.position);
            a.t -= dt;

            // Simple State Machine
            if (a.t <= 0) {
                if (a.state === 'idle') {
                    a.state = 'moving';
                    a.t = 2 + Math.random() * 5;
                    a.targetRot = Math.random() * Math.PI * 2;
                } else {
                    a.state = 'idle';
                    a.t = 1 + Math.random() * 3;
                }
            }

            // Fear logic
            if (distToPlayer < 15 && this.isSprinting) {
                a.state = 'fleeing';
                a.t = 3;
                // Move away from player
                const dir = a.mesh.position.clone().sub(this.player.position).normalize();
                a.targetRot = Math.atan2(dir.x, dir.z);
            }

            if (a.state === 'moving' || a.state === 'fleeing') {
                const speed = (a.type === 'deer' ? (a.state === 'fleeing' ? 12 : 3) : (a.state === 'fleeing' ? 6 : 2)) * dt;

                // Smooth rotation
                a.rot += (a.targetRot - a.rot) * 0.1;
                a.mesh.rotation.y = a.rot;

                const vx = Math.sin(a.rot) * speed;
                const vz = Math.cos(a.rot) * speed;

                // Procedural Hop for rabbits
                if (a.type === 'rabbit') {
                    a.mesh.position.y = Math.abs(Math.sin(performance.now() * 0.01)) * 0.4;
                }

                a.mesh.position.x += vx;
                a.mesh.position.z += vz;

                // River avoidance logic
                const riverZ = Math.sin(a.mesh.position.x / 150) * 120 + 350;
                if (Math.abs(a.mesh.position.z - riverZ) < 42) {
                    // Too close to river! Step back and turn around
                    a.mesh.position.x -= vx;
                    a.mesh.position.z -= vz;
                    a.targetRot += Math.PI; // Pick a different direction
                    a.t = 1; // pause shortly
                }

                // Tree/Rock collision for animals
                const nearby = this.getNearbyObjects(a.mesh.position.x, a.mesh.position.z);
                for (const obj of nearby) {
                    const dx = a.mesh.position.x - obj.x;
                    const dz = a.mesh.position.z - obj.z;
                    const rSum = obj.r + 0.6; // animal radius approx
                    if (dx * dx + dz * dz < rSum * rSum) {
                        a.mesh.position.x -= vx;
                        a.mesh.position.z -= vz;
                        a.targetRot += Math.PI * 0.5 + Math.random(); // Turn away
                        break;
                    }
                }

                // Arena boundary check
                if (a.mesh.position.length() > this.arenaRadius - 20) {
                    a.targetRot += Math.PI; // turn around
                }
            } else {
                a.mesh.position.y *= 0.8; // settle to ground
            }
        }
    }

    // ─────────────────────────────────────────────
    // TEXTURES
    // ─────────────────────────────────────────────
    generateTextures() {
        const createTex = (drawFn, w = 512, h = 512) => {
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            drawFn(canvas.getContext('2d'));
            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            return tex;
        };

        const grass = createTex(ctx => {
            ctx.fillStyle = '#3a5a2a'; ctx.fillRect(0, 0, 512, 512);
            for (let i = 0; i < 4000; i++) {
                ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.1})`;
                ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
            }
        });
        grass.repeat.set(150, 150);

        const water = createTex(ctx => {
            ctx.fillStyle = '#40e0d0'; ctx.fillRect(0, 0, 512, 512);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 4;
            for (let i = 0; i < 40; i++) {
                ctx.beginPath(); const y = Math.random() * 512; ctx.moveTo(0, y);
                for (let x = 0; x < 512; x += 20) ctx.lineTo(x, y + (Math.random() - 0.5) * 15);
                ctx.stroke();
            }
        });
        water.repeat.set(1, 15);

        const bark = createTex(ctx => {
            ctx.fillStyle = '#4a332a'; ctx.fillRect(0, 0, 512, 512);
            ctx.fillStyle = '#2a1a10';
            for (let i = 0; i < 50; i++) ctx.fillRect(Math.random() * 512, 0, 2 + Math.random() * 3, 512);
        });

        return { grass, water, bark };
    }

    // ─────────────────────────────────────────────
    // UPDATE
    // ─────────────────────────────────────────────
    update() {
        if (!this.simulationRunning || this._isDead) return;

        const dt = Math.min(this.clock.getDelta(), 0.05);

        // ── 1. Update Crouch State first ────────────────
        this.player.isCrouching = !!this.keys['shift'];
        const currentHeight = this.player.isCrouching ? this.player.crouchHeight : this.player.height;

        // ── 2. Global World State (Always Update) ───────
        this.updateSurvival(dt);
        this.updateAnimals(dt);
        this.updateProjectiles(dt);
        this.updateDayNight(dt);
        this.updateFOV(dt);
        this.updateCampfires(dt);
        this.updateCharge(dt);
        this.updateDrinkAnim(dt);
        this.checkNearWeapon();

        // ── 3. Player Movement & Physics ────────────────
        if (this.isClimbing) {
            // Rotation (Look around)
            this.player.rotationY -= this.mouse.x;
            this.player.rotationX -= this.mouse.y;
            this.player.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.player.rotationX));
            this.mouse.x = 0; this.mouse.y = 0;

            // ── Sticky Attachment ─────────────────────
            if (this.climbingTreePos) {
                const dx = this.player.position.x - this.climbingTreePos.x;
                const dz = this.player.position.z - this.climbingTreePos.z;
                const angle = Math.atan2(dz, dx);
                const snapDist = 0.85;
                this.player.position.x = this.climbingTreePos.x + Math.cos(angle) * snapDist;
                this.player.position.z = this.climbingTreePos.z + Math.sin(angle) * snapDist;
            }

            const climbSpeed = 5 * dt;
            if (this.keys['w']) this.player.position.y += climbSpeed;
            if (this.keys['s']) this.player.position.y -= climbSpeed;

            // ── Height Limit (Stay on trunk, below leaves) ──
            let maxH = 25;
            if (this.climbingTreePos) {
                // Pine leaves (sphere) start at h - 4. Regular leaves (cone) start at h - 1.
                // We leave a small extra buffer so the camera doesn't clip into leaves at all.
                const leavesOffset = this.climbingTreePos.isPine ? 4.8 : 1.8;
                maxH = this.climbingTreePos.h - leavesOffset;
            }
            this.player.position.y = Math.min(this.player.position.y, maxH + currentHeight);

            // Exit if reached floor
            const groundY = 0;
            if (this.player.position.y < groundY + currentHeight + 0.1) {
                this.exitClimb();
                this.player.position.y = groundY + currentHeight;
                this.player.isOnGround = true;
            }

            this.animatePlayerMesh(false, false, false, dt);
            this.updateCamera(currentHeight);
            return;
        }

        // Normal rotation
        this.player.rotationY -= this.mouse.x;
        this.player.rotationX -= this.mouse.y;
        this.player.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.player.rotationX));
        this.mouse.x = 0; this.mouse.y = 0;

        // ── Water detection ──────────────────────
        const riverZCenter = Math.sin(this.player.position.x / 150) * 120 + 350;
        const waterSurface = 0.05;
        const distToRiver = Math.abs(this.player.position.z - riverZCenter);
        const overRiver = distToRiver < 35;
        const inWater = overRiver && (this.player.position.y <= waterSurface + this.player.height + 0.3);

        // Horizontal Movement
        const moveDir = new THREE.Vector3();
        if (this.keys['w']) moveDir.z -= 1;
        if (this.keys['s']) moveDir.z += 1;
        if (this.keys['a']) moveDir.x -= 1;
        if (this.keys['d']) moveDir.x += 1;

        const isMoving = moveDir.lengthSq() > 0;
        if (isMoving) {
            let spd = this.player.speed;
            if (this.player.isCrouching) spd *= 0.5;
            if (this.isSprinting && !this.player.isCrouching) spd *= 1.9;
            if (inWater && this.player.position.y < waterSurface - 0.5) spd *= 0.55;

            moveDir.normalize().multiplyScalar(spd);
            moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotationY);

            const nextX = this.player.position.x + moveDir.x;
            const nextZ = this.player.position.z + moveDir.z;

            if (nextX * nextX + nextZ * nextZ < this.arenaRadius * this.arenaRadius) {
                let col = false;
                const pR = 0.4;
                const pFeet = this.player.position.y - currentHeight;

                const nearby = this.getNearbyObjects(nextX, nextZ);
                for (const obj of nearby) {
                    const dx = nextX - obj.x, dz = nextZ - obj.z;
                    if (dx * dx + dz * dz < (obj.r + pR) ** 2) {
                        if (obj.type === 'tree') {
                            if (pFeet > -1) { col = true; break; }
                        } else if (obj.type === 'rock') {
                            if (pFeet < obj.topY + 0.05 && this.player.position.y < obj.topY + currentHeight + 0.4) {
                                col = true; break;
                            }
                        }
                    }
                }

                if (!col) {
                    for (const p of this.pedestals) {
                        const dx = nextX - p.x, dz = nextZ - p.z;
                        if (dx * dx + dz * dz < (pR + p.r) ** 2 && this.player.position.y < p.h + 0.15) { col = true; break; }
                    }
                }
                if (!col) {
                    for (const b of this.solidBoxes) {
                        if (nextX >= b.x1 - pR && nextX <= b.x2 + pR && nextZ >= b.z1 - pR && nextZ <= b.z2 + pR && this.player.position.y < b.h) { col = true; break; }
                    }
                }

                if (!col) {
                    this.player.position.x = nextX;
                    this.player.position.z = nextZ;
                }
            }
        }
        this.animatePlayerMesh(isMoving, this.player.isCrouching, this.isSprinting, dt);

        // Vertical physics
        let groundY = 0;
        for (const p of this.pedestals) {
            const dx = this.player.position.x - p.x, dz = this.player.position.z - p.z;
            if (dx * dx + dz * dz < p.r * p.r) { groundY = p.h; break; }
        }
        for (const r of this.getNearbyObjects(this.player.position.x, this.player.position.z)) {
            if (r.type === 'rock') {
                const dx = this.player.position.x - r.x, dz = this.player.position.z - r.z;
                if (dx * dx + dz * dz < r.r * r.r * 0.7) {
                    if (r.topY > groundY) groundY = r.topY;
                }
            }
        }

        if (inWater) {
            const baseWater = waterSurface + currentHeight;
            if (!this.player.isCrouching) {
                if (this.player.position.y < baseWater - 0.05) {
                    this.player.verticalVelocity += 0.022;
                    this.player.verticalVelocity *= 0.82;
                    this.player.position.y += this.player.verticalVelocity;
                    if (this.player.position.y >= baseWater) {
                        this.player.position.y = baseWater;
                        this.player.verticalVelocity = 0;
                        this.player.isOnGround = true;
                    }
                    this.updateCamera(currentHeight);
                    if (this.sun) { this.sun.target.position.set(this.player.position.x, 0, this.player.position.z); this.sun.target.updateMatrixWorld(); }
                    return;
                } else { groundY = -15; }
            } else {
                this.player.isOnGround = false;
                const sinkTargetY = -14.5 + currentHeight;
                if (this.player.position.y > sinkTargetY + 0.05) {
                    this.player.verticalVelocity -= 0.05;
                    this.player.verticalVelocity = Math.max(this.player.verticalVelocity, -0.4);
                } else {
                    this.player.verticalVelocity = 0;
                    this.player.position.y = sinkTargetY;
                }
                this.player.position.y += this.player.verticalVelocity;
                if (this.keys[' ']) this.player.verticalVelocity = 0.15;

                this.updateCamera(currentHeight);
                if (this.sun) { this.sun.target.position.set(this.player.position.x, 0, this.player.position.z); this.sun.target.updateMatrixWorld(); }
                return;
            }
        }

        const baseY = groundY + currentHeight;
        if (this.player.isOnGround && this.player.position.y > baseY + 0.12) this.player.isOnGround = false;
        if (this.keys[' '] && this.player.isOnGround) {
            this.player.verticalVelocity = 0.26;
            this.player.isOnGround = false;
        }
        if (!this.player.isOnGround) {
            this.player.verticalVelocity -= 0.012;
            this.player.position.y += this.player.verticalVelocity;
        }
        if (this.player.position.y <= baseY) {
            this.player.position.y = baseY;
            this.player.verticalVelocity = 0;
            this.player.isOnGround = true;
        }

        if (this.sun) {
            this.sun.target.position.set(this.player.position.x, 0, this.player.position.z);
            this.sun.target.updateMatrixWorld();
        }
        this.updateCamera(currentHeight);
    }

    updateDayNight(dt) {
        this.dayCycleTime += dt;
        const cyclePercent = (this.dayCycleTime % this.totalCycleDuration) / this.totalCycleDuration;
        const angle = cyclePercent * Math.PI * 2;

        // Rotation: Sun rises in East (+X), sets in West (-X)
        // angle 0 = sunrise, angle PI/2 = noon, angle PI = sunset
        const radius = 600;
        const sunX = Math.cos(angle) * radius;
        const sunY = Math.sin(angle) * radius;
        this.sun.position.set(sunX, sunY, 150);

        // Intensity
        const dayFactor = Math.max(0, Math.sin(angle)); // 1 at noon, 0 at night
        this.sun.intensity = dayFactor * 1.5;
        this.ambientLight.intensity = 0.05 + dayFactor * 0.55;
        this.hemiLight.intensity = 0.05 + dayFactor * 0.55;

        // Sun color (warmer during sunrise/sunset)
        const sunsetFactor = Math.pow(1 - Math.abs(dayFactor - 0.5) * 2, 2);
        this.sun.color.setHSL(0.1, 0.5 * sunsetFactor, 1.0);

        // Sky / Fog Colors
        const skyDay = new THREE.Color(0x87ceeb);
        const skyNight = new THREE.Color(0x02020a);
        const currentSky = skyNight.clone().lerp(skyDay, dayFactor);

        // Apply sunset tint
        const sunSetColor = new THREE.Color(0xff7744);
        currentSky.lerp(sunSetColor, sunsetFactor * 0.4 * dayFactor);

        this.scene.background = currentSky;
        if (this.scene.fog) {
            this.scene.fog.color = currentSky;
            this.scene.fog.density = 0.003 + (1 - dayFactor) * 0.004;
        }
    }

    // ─────────────────────────────────────────────
    // CAMERA
    // ─────────────────────────────────────────────
    updateCamera(currentHeight) {
        if (this.cameraMode === 'first') {
            this.camera.position.copy(this.player.position);
            if (this.playerMesh) this.playerMesh.visible = false;
        } else {
            // Third person
            if (this.playerMesh) {
                this.playerMesh.visible = true;
                // player.position.y is the HEAD position (position + height)
                // feet are at player.position.y - currentHeight
                const feetY = this.player.position.y - currentHeight;
                this.playerMesh.position.set(
                    this.player.position.x,
                    feetY,              // mesh y=0 is feet, so this places feet at ground
                    this.player.position.z
                );
                this.playerMesh.rotation.y = this.player.rotationY + Math.PI;
            }

            // Camera behind & above
            const offset = new THREE.Vector3(0, 2.2, 5);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.rotationY);
            this.camera.position.set(
                this.player.position.x + offset.x,
                this.player.position.y - currentHeight + 2.5,
                this.player.position.z + offset.z
            );
            this.camera.lookAt(
                this.player.position.x,
                this.player.position.y - currentHeight + 1.2,
                this.player.position.z
            );
            return;
        }

        this.camera.rotation.order = 'YXZ';
        this.camera.rotation.y = this.player.rotationY;
        this.camera.rotation.x = this.player.rotationX;
    }

    // ─────────────────────────────────────────────
    // LOOP
    // ─────────────────────────────────────────────
    setupMinimap() {
        this.minimapCanvas = document.getElementById('minimap');
        this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;
        // View range: 1/3 of full arena radius
        this.minimapViewRange = this.arenaRadius * 1.05; // Extend to full arena
    }

    // ─────────────────────────────────────────────
    // STARTING INVENTORY
    // ─────────────────────────────────────────────
    setupStartingInventory() {
        const startItems = [
            { type: 'Knife', icon: '🔪' },   // slot 0
            { type: 'Bottle', icon: '🧴' },   // slot 1
            { type: 'Lighter', icon: '🔥' },   // slot 2
        ];

        startItems.forEach((item, idx) => {
            this.inventory[idx] = { type: item.type, icon: item.icon };
            const slotEl = document.getElementById('inv-' + idx);
            if (slotEl) {
                slotEl.querySelector('.inv-slot-icon').textContent = item.icon;
                slotEl.querySelector('.inv-slot-name').textContent = item.type;
            }
        });

        // Equip slot 0 (Knife) as the active weapon
        this.activeSlot = 0;
        document.querySelectorAll('.inv-slot').forEach((s, i) =>
            s.classList.toggle('active', i === 0));
        this.equipWeapon(0);
    }

    renderMinimap() {
        const canvas = this.minimapCanvas;
        const ctx = this.minimapCtx;
        if (!ctx || !canvas) return;

        const W = canvas.width;   // 180
        const H = canvas.height;  // 180
        const cx = W / 2, cy = H / 2;
        const R = W / 2;          // circle radius in pixels
        const range = this.minimapViewRange; // world units visible from center

        const toScreen = (wx, wz) => {
            const dx = wx - this.player.position.x;
            const dz = wz - this.player.position.z;
            // +rotationY rotates world so the player's view direction always faces UP
            const rot = this.player.rotationY;
            const rx = dx * Math.cos(rot) - dz * Math.sin(rot);
            const rz = dx * Math.sin(rot) + dz * Math.cos(rot);
            return {
                x: cx + (rx / range) * R,
                y: cy + (rz / range) * R
            };
        };

        // ── Clip circle ──────────────────────────
        ctx.save();
        ctx.clearRect(0, 0, W, H);
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.clip();

        // ── Background (dark forest) ─────────────
        ctx.fillStyle = '#1a2d12';
        ctx.fillRect(0, 0, W, H);

        // ── Arena border ─────────────────────────
        const borderPx = toScreen(
            this.player.position.x + this.arenaRadius,
            this.player.position.z
        );
        const borderRadius = Math.abs(borderPx.x - cx);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(borderRadius * 1.0, R - 2), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(231, 76, 60, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── River ─────────────────────────────────
        if (this.riverCurve) {
            ctx.beginPath();
            const steps = 80;
            let first = true;
            for (let i = 0; i <= steps; i++) {
                const pt = this.riverCurve.getPoint(i / steps);
                const s = toScreen(pt.x, pt.z);
                if (s.x < -R || s.x > W + R || s.y < -R || s.y > H + R) { first = true; continue; }
                if (first) { ctx.moveTo(s.x, s.y); first = false; }
                else ctx.lineTo(s.x, s.y);
            }
            ctx.strokeStyle = 'rgba(64,224,208,0.75)';
            ctx.lineWidth = 6;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        // ── Trees (sample) ────────────────────────
        const treeDotR = 1.5;
        ctx.fillStyle = 'rgba(40, 100, 40, 0.6)';
        const stride = 4; // draw every Nth tree for performance
        for (let i = 0; i < this.forestData.length; i += stride) {
            const t = this.forestData[i];
            const dx = t.x - this.player.position.x;
            const dz = t.z - this.player.position.z;
            if (dx * dx + dz * dz > range * range) continue; // outside view
            const s = toScreen(t.x, t.z);
            ctx.beginPath();
            ctx.arc(s.x, s.y, treeDotR, 0, Math.PI * 2);
            ctx.fill();
        }

        // ── Campfires ────────────────────────────
        for (const cf of this.campfires) {
            if (!cf.isLit) continue;
            const s = toScreen(cf.x, cf.z);
            if (s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;

            const pulse = (Math.sin(performance.now() * 0.01) + 1) / 2;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 4 + pulse * 4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 100, 0, ${0.4 + pulse * 0.4})`;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffcc00';
            ctx.fill();
        }

        // ── Pedestals ────────────────────────────
        ctx.fillStyle = 'rgba(200,180,80,0.85)';
        for (const p of this.pedestals) {
            const dx = p.x - this.player.position.x;
            const dz = p.z - this.player.position.z;
            if (dx * dx + dz * dz > range * range) continue;
            const s = toScreen(p.x, p.z);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // ── Player dot ────────────────────────────
        // Always center
        ctx.save();
        ctx.translate(cx, cy);

        // Direction cone (FOV indicator)
        const fovAngle = Math.PI / 3; // 60°
        const coneLen = 22;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, coneLen, -Math.PI / 2 - fovAngle / 2, -Math.PI / 2 + fovAngle / 2);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();

        // Player circle
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#e74c3c';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Arrow (facing direction = up on minimap since map rotates with player)
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(-4, -3);
        ctx.lineTo(4, -3);
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.fill();

        ctx.restore();

        // ── Subtle vignette ──────────────────────
        const grad = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        ctx.restore();
    }

    render() {
        if (this.renderer && this.scene && this.camera)
            this.renderer.render(this.scene, this.camera);
        this.renderMinimap();
    }

    loop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.loop());
    }

    // ─────────────────────────────────────────────
    // AIM / ZOOM
    // ─────────────────────────────────────────────
    setAiming(on) {
        this.isAiming = on;
        const overlay = document.getElementById('aim-overlay');
        if (overlay) overlay.classList.toggle('active', on);
    }

    updateFOV(dt) {
        const target = this.isAiming ? this.aimFOV : this.normalFOV;
        this.currentFOV += (target - this.currentFOV) * Math.min(1, dt * 14);
        if (this.camera) {
            this.camera.fov = this.currentFOV;
            this.camera.updateProjectionMatrix();
        }
    }

    // ─────────────────────────────────────────────
    // CHARGE
    // ─────────────────────────────────────────────
    updateCharge(dt) {
        const fill = document.getElementById('charge-bar-fill');
        const wrap = document.getElementById('charge-wrap');

        if (!this.isCharging) {
            this.chargeAmount = 0;
            if (wrap) wrap.style.opacity = '0';
            if (fill) fill.style.width = '0%';
            // Handle recoil animation
            if (this.weaponRecoil > 0) {
                this.weaponRecoil = Math.max(0, this.weaponRecoil - dt * 3);
                if (this.weaponRecoil === 0) this.equipWeapon(this.activeSlot);
            }
            return;
        }

        const elapsed = (performance.now() - this.chargeStart) / 1000;
        this.chargeAmount = Math.min(1, elapsed / this.maxChargeTime);

        if (wrap) wrap.style.opacity = '1';
        if (fill) {
            fill.style.width = (this.chargeAmount * 100) + '%';
            // Color: green → yellow → red
            const r = Math.round(40 + this.chargeAmount * 215);
            const g = Math.round(200 - this.chargeAmount * 160);
            fill.style.background = `linear-gradient(90deg,rgb(${r},${g},0),rgb(${Math.min(255, r + 30)},${Math.max(0, g + 20)},0))`;
        }

        // Visual: nudge held weapon backward as charge builds (bow-draw feel)
        if (this.heldWeaponMesh) {
            const kick = this.chargeAmount * 0.06;
            this.heldWeaponMesh.position.z += kick * 0.04;
        }
    }

    // ─────────────────────────────────────────────
    // FIRE
    // ─────────────────────────────────────────────
    fireWeapon() {
        const item = this.inventory[this.activeSlot];
        if (!item) return;

        const power = Math.max(0.15, this.chargeAmount);
        this.chargeAmount = 0;

        // Melee weapons (Sword / Knife)
        if (item.type === 'Sword' || item.type === 'Knife') {
            this.weaponRecoil = 0.25;
            if (this.heldWeaponMesh) {
                this.heldWeaponMesh.rotation.x -= 0.6; // swing animation
                setTimeout(() => { if (this.heldWeaponMesh) this.heldWeaponMesh.rotation.x += 0.6; }, 150);
            }

            const range = item.type === 'Sword' ? 3.5 : 2.2;
            const dmg = item.type === 'Sword' ? 1.0 : 0.6; // 2 hits with sword = 2hp (deer)

            // Hit detection for animals
            const dir = new THREE.Vector3();
            this.camera.getWorldDirection(dir);
            for (let j = this.animals.length - 1; j >= 0; j--) {
                const a = this.animals[j];
                const dx = a.mesh.position.x - this.player.position.x;
                const dz = a.mesh.position.z - this.player.position.z;
                const d2 = dx * dx + dz * dz;

                if (d2 < range * range) {
                    // Check if in front of player
                    const toA = a.mesh.position.clone().sub(this.player.position).normalize();
                    if (dir.dot(toA) > 0.4) {
                        a.hp -= dmg;
                        if (a.hp <= 0) {
                            this.killAnimal(a, j);
                        } else {
                            this.showItemMsg(`💥 Golpe! (${a.type} ${Math.ceil(a.hp)} HP)`);
                        }
                        break; // only hit one per swing
                    }
                }
            }
            return;
        }

        // ── Build projectile mesh ─────────────────
        const projGroup = new THREE.Group();
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4a18, roughness: 0.9 });
        const ironMat = new THREE.MeshStandardMaterial({ color: 0xc0c8d0, metalness: 0.95, roughness: 0.1 });

        if (item.type === 'Bow') {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), woodMat);
            shaft.rotation.x = Math.PI / 2;
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.28, 5), ironMat);
            tip.rotation.x = -Math.PI / 2;
            tip.position.z = -0.64;
            // Fletching
            const fletchMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, side: THREE.DoubleSide });
            for (let i = 0; i < 3; i++) {
                const f = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), fletchMat);
                f.position.set(0, 0, 0.45);
                f.rotation.z = (i / 3) * Math.PI * 2;
                f.position.y += Math.sin((i / 3) * Math.PI * 2) * 0.05;
                f.position.x += Math.cos((i / 3) * Math.PI * 2) * 0.05;
                projGroup.add(f);
            }
            projGroup.add(shaft, tip);
        } else if (item.type === 'Spear') {
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.2, 7), woodMat);
            shaft.rotation.x = Math.PI / 2;
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.50, 6), ironMat);
            tip.rotation.x = -Math.PI / 2;
            tip.position.z = -1.35;
            const butt = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 6), ironMat);
            butt.rotation.x = Math.PI / 2;
            butt.position.z = 1.21;
            projGroup.add(shaft, tip, butt);
        }

        // ── Position & orient ─────────────────────
        const eyeY = this.player.position.y + (this.player.isCrouching ? this.player.crouchHeight * 0.85 : this.player.height * 0.85);
        const start = this.player.position.clone();
        start.y = eyeY;

        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        // Offset spawn slightly forward so it doesn't clip the player
        start.addScaledVector(dir, 1.0);

        projGroup.position.copy(start);
        // lookAt(pos - dir) makes +Z point backward so -Z (tip) faces forward
        const lookTarget = start.clone().sub(dir);
        projGroup.lookAt(lookTarget);

        const baseSpeed = item.type === 'Bow' ? 52 : 38;
        const velocity = dir.clone().multiplyScalar(baseSpeed * power);

        projGroup.traverse(c => { if (c.isMesh) { c.castShadow = true; } });
        this.scene.add(projGroup);

        this.projectiles.push({
            mesh: projGroup,
            velocity,
            life: 0,
            maxLife: 8
        });

        // Weapon recoil kick
        this.weaponRecoil = 0.20;
        this.equipWeapon(this.activeSlot); // re-attach so recoil restores position
    }

    // ─────────────────────────────────────────────
    // PROJECTILE PHYSICS
    // ─────────────────────────────────────────────
    updateProjectiles(dt) {
        const GRAVITY = -9;
        const GROUND_Y = 0.05;   // flat terrain surface
        const STICK_LIFE = 60;     // seconds stuck before removal
        const FADE_START = 55;     // start fading 5s before removal

        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.life += dt;

            // ── Already stuck ────────────────────────────
            if (p.stuck) {
                if (p.life > FADE_START) {
                    const frac = (p.life - FADE_START) / (STICK_LIFE - FADE_START);
                    const opacity = Math.max(0, 1 - frac);
                    p.mesh.traverse(c => {
                        if (c.isMesh && c.material) {
                            c.material.transparent = true;
                            c.material.opacity = opacity;
                        }
                    });
                }
                if (p.life > STICK_LIFE) {
                    this.scene.remove(p.mesh);
                    this.projectiles.splice(i, 1);
                }
                continue;
            }

            // ── In flight ───────────────────────────────
            p.velocity.y += GRAVITY * dt;
            p.mesh.position.addScaledVector(p.velocity, dt);

            // Three.js Object3D.lookAt(target) makes +Z point TOWARD target.
            // Our tip is at local -Z (z = -0.64 / -1.35).
            // To make the tip (-Z) lead the flight we need -Z → velocity direction,
            // i.e. +Z → opposite of velocity.  So we look at (pos - velocity).
            if (p.velocity.lengthSq() > 0.01) {
                const tailPt = p.mesh.position.clone().sub(p.velocity);
                p.mesh.lookAt(tailPt);
            }

            // ── Collision detection ──────────────────────
            // Helper: embed tip into surface and freeze
            const stickIt = (embedLen) => {
                // tip direction = -Z in world space
                const tipDir = new THREE.Vector3(0, 0, -1).applyQuaternion(p.mesh.quaternion);
                p.mesh.position.addScaledVector(tipDir, embedLen);
                p.velocity.set(0, 0, 0);
                p.stuck = true;
                p.life = 0;       // restart counter from landing
            };

            let hit = false;

            // 1. Ground / pedestal
            let groundHere = GROUND_Y;
            for (const ped of this.pedestals) {
                const dx = p.mesh.position.x - ped.x;
                const dz = p.mesh.position.z - ped.z;
                if (dx * dx + dz * dz < ped.r * ped.r)
                    groundHere = Math.max(groundHere, ped.h);
            }
            if (p.mesh.position.y <= groundHere) {
                p.mesh.position.y = groundHere;
                stickIt(0.18);   // embed tip 18 cm into ground
                hit = true;
            }

            // 2. Tree trunks
            if (!hit) {
                const nearby = this.getNearbyObjects(p.mesh.position.x, p.mesh.position.z);
                for (const obj of nearby) {
                    if (obj.type !== 'tree') continue;
                    const dx = p.mesh.position.x - obj.x;
                    const dz = p.mesh.position.z - obj.z;
                    const trunkR = Math.min(obj.r * 0.45, 0.55); // trunk is narrower than crown
                    if (dx * dx + dz * dz < trunkR * trunkR && p.mesh.position.y < 7) {
                        stickIt(0.12);   // embed tip into bark
                        hit = true;
                        break;
                    }
                }
            }

            // 3. Animals
            if (!hit) {
                for (let j = this.animals.length - 1; j >= 0; j--) {
                    const a = this.animals[j];
                    const dx = p.mesh.position.x - a.mesh.position.x;
                    const dz = p.mesh.position.z - a.mesh.position.z;
                    const dy = p.mesh.position.y - (a.mesh.position.y + a.height * 0.5);

                    const distSq = dx * dx + dz * dz + dy * dy;
                    if (distSq < a.radius * a.radius) {
                        const dmg = p.type === 'Spear' ? 2 : 1;
                        a.hp -= dmg;

                        // Impact effect: small red flash or just stick it
                        stickIt(0.05);
                        hit = true;

                        if (a.hp <= 0) {
                            this.killAnimal(a, j);
                        }
                        break;
                    }
                }
            }

            // 4. Fell into abyss
            if (!hit && p.mesh.position.y < -20) {
                this.scene.remove(p.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }

    killAnimal(animal, index) {
        this.scene.remove(animal.mesh);
        if (animal.type === 'rabbit') {
            this.spawnLoot('Muslo', '🍗', animal.mesh.position.x, animal.mesh.position.z, 5);
        } else if (animal.type === 'deer') {
            this.spawnLoot('Costilla', '🍖', animal.mesh.position.x, animal.mesh.position.z, 2);
        }
        this.animals.splice(index, 1);
        this.showItemMsg(`💥 ${animal.type.toUpperCase()} ELIMINADO`);
    }
}
