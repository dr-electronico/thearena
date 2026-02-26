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

        // Inventory (5 slots)
        this.inventory = [null, null, null, null, null];
        this.activeSlot = 0;
        this.heldWeaponMesh = null;
        this.weaponItems = [];

        // Cornucopia solid walls (AABB boxes)
        this.solidBoxes = [];

        // ── Combat system ───────────────────────────
        this.isCharging = false;    // LMB held
        this.chargeStart = 0;
        this.chargeAmount = 0;        // 0‥1
        this.maxChargeTime = 1.8;      // seconds to 100%
        this.projectiles = [];       // flying arrows / spears
        this.weaponRecoil = 0;        // transient kick value

        // ── Aim / zoom ───────────────────────────────
        this.isAiming = false;
        this.normalFOV = 75;
        this.aimFOV = 32;
        this.currentFOV = 75;

        this.init();
    }

    init() {
        if (typeof THREE === 'undefined') { console.error('Three.js not loaded'); return; }
        this.setupScene();
        this.setupControls();
        this.createWorld();
        this.createPlayerMesh();
        this.setupMinimap();
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
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        this.scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3d4d1f, 0.6));

        this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sun.position.set(100, 200, 100);
        this.sun.castShadow = true;
        this.sun.shadow.camera.left = -200;
        this.sun.shadow.camera.right = 200;
        this.sun.shadow.camera.top = 200;
        this.sun.shadow.camera.bottom = -200;
        this.sun.shadow.camera.far = 1000;
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
            // Slot select 1-5
            if (['1', '2', '3', '4', '5'].includes(e.key)) {
                const idx = parseInt(e.key) - 1;
                this.activeSlot = idx;
                document.querySelectorAll('.inv-slot').forEach((s, i) => s.classList.toggle('active', i === idx));
                this.equipWeapon(idx);
            }
            // Pickup nearest weapon crate
            if (e.key.toLowerCase() === 'e') this.tryPickup();
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

        // ── Combat: LMB = charge, release = fire ─────
        this.renderer.domElement.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // left — start charging
                if (this.inventory[this.activeSlot]) {
                    this.isCharging = true;
                    this.chargeStart = performance.now();
                }
            }
            if (e.button === 2) { // right — aim
                this.setAiming(true);
            }
        });
        this.renderer.domElement.addEventListener('mouseup', (e) => {
            if (e.button === 0 && this.isCharging) {
                this.isCharging = false;
                this.fireWeapon();
            }
            if (e.button === 2) {
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

        // Health decays if hydration or hunger low
        if (this.hydration < 20 || this.hunger < 20) {
            this.health = Math.max(0, this.health - 0.5);
        }
        // Regen if both good
        if (this.hydration > 60 && this.hunger > 60) {
            this.health = Math.min(100, this.health + 0.1);
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
    }

    // ─────────────────────────────────────────────
    // PICKUP
    // ─────────────────────────────────────────────
    tryPickup() {
        const REACH = 4.0;
        let best = null, bestDist = REACH * REACH;
        for (const item of this.weaponItems) {
            const dx = this.player.position.x - item.x;
            const dz = this.player.position.z - item.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestDist) { bestDist = d2; best = item; }
        }
        if (!best) return;

        const addToInventory = (type, icon) => {
            let slot = this.inventory.indexOf(null);
            if (slot === -1) slot = this.activeSlot;
            this.inventory[slot] = { type, icon };
            const slotEl = document.getElementById('inv-' + slot);
            if (slotEl) {
                slotEl.querySelector('.inv-slot-icon').textContent = icon;
                slotEl.querySelector('.inv-slot-name').textContent = type;
            }
            return slot;
        };

        const pickedSlot = addToInventory(best.type, best.icon);
        // No separate slot for arrows — Bow includes arrows

        this.scene.remove(best.mesh);
        this.weaponItems.splice(this.weaponItems.indexOf(best), 1);

        if (pickedSlot === this.activeSlot) this.equipWeapon(this.activeSlot);
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
        const realCount = 2000;
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
            if (isPine) {
                const height = 15 + Math.random() * 10;
                dummy.position.set(x, height / 2, z); dummy.scale.set(1, height, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
                pineTrunkInst.setMatrixAt(pine, dummy.matrix);
                dummy.position.set(x, height, z); dummy.scale.set(1.5, 0.4, 1.5); dummy.updateMatrix();
                pineLeavesInst.setMatrixAt(pine, dummy.matrix);
                pine++;
            } else {
                const scale = 1.0 + Math.random() * 6.0;
                dummy.position.set(x, scale / 2, z); dummy.scale.set(1, scale, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
                trunkInst.setMatrixAt(reg, dummy.matrix);
                dummy.position.set(x, scale + 4, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
                leavesInst.setMatrixAt(reg, dummy.matrix);
                reg++;
            }
            const tree = { type: 'tree', x, z, r: 0.8 };
            this.forestData.push(tree);
            this.addToSpatialHash(x, z, tree);
        }
        this.scene.add(trunkInst, leavesInst, pineTrunkInst, pineLeavesInst);
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
        if (!this.simulationRunning) return;

        // Look
        this.player.rotationY -= this.mouse.x;
        this.player.rotationX -= this.mouse.y;
        this.player.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.player.rotationX));
        this.mouse.x = 0; this.mouse.y = 0;

        // Crouch
        this.player.isCrouching = !!this.keys['shift'];
        const currentHeight = this.player.isCrouching ? this.player.crouchHeight : this.player.height;

        // ── Water detection ──────────────────────
        const riverZCenter = Math.sin(this.player.position.x / 150) * 120 + 350;
        const waterSurface = 0.05;
        const distToRiver = Math.abs(this.player.position.z - riverZCenter);
        const overRiver = distToRiver < 35;
        // Only "in water" if they're at or below the surface
        // inWater always uses standing height to detect proximity to river surface
        // (so pressing Shift while on water doesn't suddenly make inWater false)
        const inWater = overRiver && (this.player.position.y <= waterSurface + this.player.height + 0.3);

        // ── Movement ─────────────────────────────
        const moveDir = new THREE.Vector3();
        if (this.keys['w']) moveDir.z -= 1;
        if (this.keys['s']) moveDir.z += 1;
        if (this.keys['a']) moveDir.x -= 1;
        if (this.keys['d']) moveDir.x += 1;

        const isMoving = moveDir.lengthSq() > 0;
        if (isMoving) {
            let spd = this.player.speed;
            if (this.player.isCrouching) spd *= 0.5;
            if (this.isSprinting && !this.player.isCrouching) spd *= 1.9;  // sprint boost
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
                            // Trees block if player is at ground level (not deep in river)
                            if (pFeet > -1) { col = true; break; }
                        } else if (obj.type === 'rock') {
                            // Block only if player feet are below the rock top (can't jump over)
                            // Allow jump-over: player is blocked only when feet below topY
                            if (pFeet < obj.topY + 0.05 && this.player.position.y < obj.topY + currentHeight + 0.4) {
                                col = true; break;
                            }
                        }
                    }
                }

                // Pedestal
                if (!col) {
                    for (const p of this.pedestals) {
                        const dx = nextX - p.x, dz = nextZ - p.z;
                        if (dx * dx + dz * dz < (p.r + pR) ** 2 && this.player.position.y < p.h + 0.15) {
                            col = true; break;
                        }
                    }
                }

                // Solid boxes (Cornucopia walls)
                if (!col) {
                    for (const b of this.solidBoxes) {
                        if (nextX >= b.x1 - pR && nextX <= b.x2 + pR &&
                            nextZ >= b.z1 - pR && nextZ <= b.z2 + pR &&
                            this.player.position.y < b.h) {
                            col = true; break;
                        }
                    }
                }

                if (!col) {
                    this.player.position.x = nextX;
                    this.player.position.z = nextZ;
                }
            }
        }

        // Animate player mesh
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.animatePlayerMesh(isMoving, this.player.isCrouching, this.isSprinting, dt);
        this.updateSurvival(dt);
        this.checkNearWeapon();
        this.updateCharge(dt);
        this.updateProjectiles(dt);
        this.updateFOV(dt);

        // ── Vertical physics ──────────────────────
        // Determine "floor" height at player X,Z
        let groundY = 0;
        // Pedestal standing?
        for (const p of this.pedestals) {
            const dx = this.player.position.x - p.x, dz = this.player.position.z - p.z;
            if (dx * dx + dz * dz < p.r * p.r) { groundY = p.h; break; }
        }
        // Rock standing?
        for (const r of this.getNearbyObjects(this.player.position.x, this.player.position.z)) {
            if (r.type !== 'rock') continue;
            const dx = this.player.position.x - r.x, dz = this.player.position.z - r.z;
            if (dx * dx + dz * dz < r.r * r.r * 0.7) {
                if (r.topY > groundY) groundY = r.topY;
            }
        }

        if (inWater) {
            const baseWater = waterSurface + currentHeight;

            if (!this.player.isCrouching) {
                // Not crouching → float up gradually (buoyancy)
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
                } else {
                    groundY = waterSurface;
                }
            } else {
                // Crouching → sink hard and fast
                this.player.isOnGround = false;
                const sinkTargetY = -14.5 + currentHeight;

                // Apply strong downward force while not at bottom
                if (this.player.position.y > sinkTargetY + 0.05) {
                    this.player.verticalVelocity -= 0.05; // strong pull down
                    this.player.verticalVelocity = Math.max(this.player.verticalVelocity, -0.4); // cap speed
                } else {
                    this.player.verticalVelocity = 0;
                    this.player.position.y = sinkTargetY;
                }

                this.player.position.y += this.player.verticalVelocity;
                if (this.keys[' ']) { this.player.verticalVelocity = 0.15; } // swim up

                this.updateCamera(currentHeight);
                if (this.sun) { this.sun.target.position.set(this.player.position.x, 0, this.player.position.z); this.sun.target.updateMatrixWorld(); }
                return;
            }
        }

        // Normal land physics
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
        this.minimapViewRange = this.arenaRadius / 3; // 200 units
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

        // Melee weapons (Sword) — no projectile, just a recoil swing
        if (item.type === 'Sword') {
            this.weaponRecoil = 0.25;
            if (this.heldWeaponMesh) {
                this.heldWeaponMesh.rotation.x -= 0.5 * power;
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

            // 3. Fell into abyss
            if (!hit && p.mesh.position.y < -20) {
                this.scene.remove(p.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }
}
