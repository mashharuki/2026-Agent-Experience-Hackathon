import { FLEET, MARK, STEP, visiblePressure, windAt } from "sailing-sim";
import * as THREE from "three";
import { makeBoat } from "./boat-visual";
import { createOcean, createSky } from "./ocean";
import { labelPosition } from "./presentation";
import type { SceneRuntime } from "./runtime";
import { waveEnvironment, waveSample } from "./wave-field";

function buoy(color: number, size = 1) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7 * size, 1.05 * size, 1.8 * size, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.46 }),
  );
  body.position.y = 0.7 * size;
  group.add(body);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 2.1 * size, 6),
    new THREE.MeshStandardMaterial({ color: 0xe8eff1 }),
  );
  mast.position.y = 1.9 * size;
  group.add(mast);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85 * size, 0.55 * size),
    new THREE.MeshStandardMaterial({ color: 0xfffaf0, side: THREE.DoubleSide }),
  );
  flag.position.set(0.4 * size, 2.7 * size, 0);
  group.add(flag);
  return group;
}

function makeWake() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(61 * 2 * 3);
  const uvs = new Float32Array(61 * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i < 61; i++) {
    uvs.set([0, i / 60, 1, i / 60], i * 4);
    if (i < 60) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uSpeed: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;uniform float uSpeed;
      void main(){float edge=pow(abs(vUv.x-.5)*2.,2.);float fizz=.65+.35*sin(vUv.y*170.+vUv.x*31.);
      float alpha=(1.-vUv.y)*(.07+.28*edge)*fizz*min(1.,uSpeed/2.);
      gl_FragColor=vec4(.85,.97,.98,alpha);
      #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function coast() {
  const positions: number[] = [];
  for (let i = 0; i < 100; i++) {
    const x = -2700 + i * 65;
    const height =
      22 + 45 * Math.sin(i * 0.18) ** 2 + 18 * Math.sin(i * 0.7) ** 2;
    positions.push(
      x,
      -1,
      -1850,
      x,
      height,
      -1850,
      x + 65,
      -1,
      -1850,
      x + 65,
      -1,
      -1850,
      x,
      height,
      -1850,
      x + 65,
      22 +
        45 * Math.sin((i + 1) * 0.18) ** 2 +
        18 * Math.sin((i + 1) * 0.7) ** 2,
      -1850,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0x86a8b4,
      fog: true,
      side: THREE.DoubleSide,
    }),
  );
}

export function mountScene(host: HTMLElement, runtime: SceneRuntime) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb7d1da, 650, 2600);
  scene.add(new THREE.HemisphereLight(0xe5f5ff, 0x31505c, 2.1));
  const sun = new THREE.DirectionalLight(0xffeed4, 3.1);
  sun.position.set(-65, 43, -62);
  scene.add(sun);
  const sky = createSky();
  scene.add(sky, coast());
  const ocean = createOcean();
  scene.add(ocean.group);
  const marks = [buoy(0xf78138), buoy(0xffd16d, 0.55), buoy(0xffd16d, 0.55)];
  const markPositions = [
    [MARK.x, -MARK.y],
    [-30, 0],
    [30, 0],
  ];
  marks.forEach((mark, i) => {
    mark.position.set(markPositions[i][0], 0, markPositions[i][1]);
    scene.add(mark);
  });
  const finish = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-30, 0.2, 0),
      new THREE.Vector3(30, 0.2, 0),
    ]),
    new THREE.LineDashedMaterial({
      color: 0xfff3cb,
      dashSize: 2,
      gapSize: 2,
      transparent: true,
      opacity: 0.4,
    }),
  );
  finish.computeLineDistances();
  scene.add(finish);
  const gate = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(12, 0.35, -MARK.y + 2),
      new THREE.Vector3(0, 0.35, -MARK.y - 12),
      new THREE.Vector3(-12, 0.35, -MARK.y),
    ]),
    new THREE.LineDashedMaterial({
      color: 0xffe6a7,
      dashSize: 1.5,
      gapSize: 2,
      transparent: true,
      opacity: 0.65,
    }),
  );
  gate.computeLineDistances();
  scene.add(gate);
  const boats = runtime.race.boats.map((boat, i) =>
    makeBoat(boat.color ?? (i ? 0x559cc3 : 0xef8354), i + 1),
  );
  const wakes = boats.map(() => makeWake());
  const trails = boats.map((_, i) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(1801 * 3), 3),
    );
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: runtime.race.boats[i].color ?? (i ? 0x92d3ec : 0xffd48e),
        transparent: true,
        opacity: 0.5,
      }),
    );
    line.frustumCulled = false;
    scene.add(line);
    return line;
  });
  boats.forEach((boat, i) => {
    scene.add(boat.group, wakes[i]);
  });
  // Name tags for fleet boats only; the legacy helm screen has no fleet identities.
  const labels = runtime.race.boats.map((boat) => {
    const meta = FLEET.find((entry) => entry.id === boat.id);
    if (!meta) return null;
    const label = document.createElement("div");
    label.className = "boat-label";
    label.setAttribute("aria-hidden", "true");
    const dot = document.createElement("i");
    dot.style.background = `#${meta.color.toString(16).padStart(6, "0")}`;
    const name = document.createElement("span");
    name.textContent = `${FLEET.indexOf(meta) + 1} ${meta.name}`;
    const pick = document.createElement("b");
    pick.textContent = "★";
    label.append(dot, name, pick);
    host.appendChild(label);
    return label;
  });
  const pressureRings = Array.from({ length: 3 }, () => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1, 64),
      new THREE.MeshBasicMaterial({
        color: 0x6bdacb,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
    return ring;
  });
  const windArrows = Array.from({ length: 5 }, () => {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      9,
      0xc7ebe5,
      2,
      1,
    );
    scene.add(arrow);
    return arrow;
  });
  const projected = new THREE.Vector3();
  let viewWidth = 0;
  let viewHeight = 0;
  const camera = new THREE.PerspectiveCamera(53, 1, 0.12, 15000);
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  const aim = new THREE.Vector3();
  let initialized = false;
  let previousView = runtime.view;
  let previousQuality = "";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    viewWidth = width;
    viewHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  const contextNotice = document.createElement("div");
  contextNotice.className = "context-notice";
  contextNotice.setAttribute("role", "alert");
  const restored = () => {
    contextNotice.textContent =
      "描画が復旧しました。再開できます。 / Graphics restored. You can resume.";
  };
  const lost = (event: Event) => {
    event.preventDefault();
    runtime.pause();
    contextNotice.textContent =
      "描画を一時停止しました。復旧しない場合は再読み込みしてください。 / Graphics interrupted. Reload if recovery fails.";
    host.appendChild(contextNotice);
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  host.appendChild(renderer.domElement);
  resize.observe(host);
  let last = 0;
  const frameTimes: number[] = [];
  let metricsTick = 0;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    if (last && !document.hidden) {
      frameTimes.push(now - last);
      if (frameTimes.length > 600) frameTimes.shift();
    }
    if (++metricsTick % 60 === 0 && frameTimes.length) {
      const sorted = [...frameTimes].sort((a, b) => a - b);
      host.dataset.frameP95 =
        sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1);
      host.dataset.frameSamples = String(sorted.length);
      host.dataset.quality = runtime.quality;
    }
    runtime.advance(last ? now - last : 0);
    last = now;
    const race = runtime.displayRace ?? runtime.race;
    const displayTrails = runtime.displayTrails ?? runtime.trails;
    const player = race.boats[runtime.focusIndex ?? 0];
    const time = race.tick * STEP;
    const still = reducedMotion.matches || runtime.cameraMotion === false;
    const visualTime = time;
    const environment = waveEnvironment(race.scenario, race.seed, time);
    const surfaceAt = (x: number, z: number) =>
      waveSample(x, z, visualTime, environment);
    const heightAt = (x: number, z: number) => surfaceAt(x, z).height;
    ocean.update(
      visualTime,
      windAt(race.scenario, race.seed, time, 0, 0).speed,
      visiblePressure(race.scenario, race.seed, time),
      player.x,
      -player.y,
      environment,
    );
    if (previousQuality !== runtime.quality) {
      renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio,
          runtime.quality === "economy"
            ? 0.85
            : runtime.quality === "standard"
              ? 1.15
              : 1.5,
        ),
      );
      ocean.setQuality(runtime.quality);
      previousQuality = runtime.quality;
    }
    boats.forEach((mesh, i) => {
      const boat = race.boats[i];
      const bob = heightAt(boat.x, -boat.y);
      mesh.group.visible = i === 0 || race.withOpponent;
      mesh.group.position.set(boat.x, bob, -boat.y);
      mesh.group.rotation.y = -boat.heading;
      const localWind = windAt(race.scenario, race.seed, time, boat.x, boat.y);
      const surface = surfaceAt(boat.x, -boat.y);
      const moving = race.status === "running";
      const smooth = moving ? 1 - Math.exp(-Math.max(dt, 0.001) * 7) : 1;
      const roll =
        surface.dx * Math.cos(boat.heading) +
        surface.dz * Math.sin(boat.heading);
      const pitch =
        surface.dx * Math.sin(boat.heading) -
        surface.dz * Math.cos(boat.heading);
      const heel = still
        ? 0
        : -boat.tackSide *
            Math.min(0.22, boat.speed * localWind.speed * 0.006) +
          roll;
      mesh.motion.rotation.z = heel;
      mesh.motion.rotation.x = still ? 0 : -pitch;
      mesh.main.rotation.y = THREE.MathUtils.lerp(
        mesh.main.rotation.y,
        boat.tackSide * (0.1 + boat.mainSheet * 1.25),
        smooth,
      );
      mesh.jib.rotation.y = THREE.MathUtils.lerp(
        mesh.jib.rotation.y,
        boat.tackSide * (0.12 + boat.mainSheet * 0.7),
        smooth,
      );
      mesh.rudder.rotation.y = -boat.rudder * 0.45;
      mesh.crew.position.x = THREE.MathUtils.lerp(
        mesh.crew.position.x,
        boat.tackSide > 0 ? 0 : 1,
        smooth * 0.6,
      );
      mesh.crew.rotation.z = still ? 0 : -heel * 1.2;
      const windX =
        -Math.sin(localWind.direction) * localWind.speed -
        Math.sin(boat.heading) * boat.speed;
      const windY =
        -Math.cos(localWind.direction) * localWind.speed -
        Math.cos(boat.heading) * boat.speed;
      const apparent = Math.hypot(windX, windY);
      for (const [geometry, base] of [
        [mesh.mainCloth, mesh.mainBase],
        [mesh.jibCloth, mesh.jibBase],
      ] as const) {
        const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let v = 0; v < attr.count; v++) {
          const fullness =
            Math.abs(boat.rudder) < 0.6
              ? 0.9 + Math.min(0.3, apparent * 0.02)
              : 0.35;
          const flutter = still
            ? 0
            : Math.sin(time * 15 + base[v * 3 + 1] * 5) *
              (Math.abs(boat.rudder) < 0.6 ? 0.002 : 0.018);
          attr.setX(v, base[v * 3] * fullness + flutter * base[v * 3 + 2]);
        }
        attr.needsUpdate = true;
        if (runtime.quality !== "economy") geometry.computeVertexNormals();
      }
      const tell = mesh.telltale.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      tell.setXYZ(1, 0.16, 2 + (still ? 0 : Math.sin(time * 12) * 0.035), 0.8);
      tell.needsUpdate = true;
      mesh.bowFoam.visible = boat.speed > 0.6 && runtime.quality !== "economy";
      mesh.bowFoam.scale.setScalar(0.7 + boat.speed * 0.1);
      const trail = displayTrails[i];

      const attribute = trails[i].geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let j = 0; j < trail.length; j++)
        attribute.setXYZ(
          j,
          trail[j].x,
          heightAt(trail[j].x, -trail[j].y) + 0.06,
          -trail[j].y,
        );
      attribute.needsUpdate = true;
      trails[i].geometry.setDrawRange(0, trail.length);
      trails[i].visible =
        (i === 0 || race.withOpponent) && runtime.view === "overview";
      const foam = wakes[i].geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const count = Math.min(61, trail.length);
      for (let j = 0; j < count; j++) {
        const p = trail[trail.length - 1 - j];
        const width = 0.2 + j * 0.035;
        for (let side = 0; side < 2; side++) {
          const offset = (side ? 1 : -1) * width;
          const x = p.x + Math.cos(p.heading) * offset;
          const z = -p.y + Math.sin(p.heading) * offset;
          foam.setXYZ(j * 2 + side, x, heightAt(x, z) + 0.055, z);
        }
      }
      foam.needsUpdate = true;
      wakes[i].geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
      wakes[i].material.uniforms.uSpeed.value = boat.speed;
      wakes[i].visible = i === 0 || race.withOpponent;
    });
    marks.forEach((mark, i) => {
      mark.position.y = heightAt(markPositions[i][0], markPositions[i][1]);
      mark.rotation.z = still
        ? 0
        : surfaceAt(markPositions[i][0], markPositions[i][1]).dx;
    });
    const patches = visiblePressure(race.scenario, race.seed, time);
    pressureRings.forEach((ring, i) => {
      const p = patches[i];
      ring.visible = runtime.tactics === true && Boolean(p);
      if (p) {
        ring.position.set(p.x, 0.35, -p.y);
        ring.scale.setScalar(p.radius);
      }
    });
    windArrows.forEach((arrow, i) => {
      arrow.visible = runtime.tactics === true;
      const x = (i - 2) * 40,
        y = 50;
      const w = windAt(race.scenario, race.seed, time, x, y);
      arrow.position.set(x, 1, -y);
      arrow.setDirection(
        new THREE.Vector3(-Math.sin(w.direction), 0, Math.cos(w.direction)),
      );
    });
    gate.visible = runtime.view === "overview" || runtime.tactics === true;
    const forward = new THREE.Vector3(
      Math.sin(player.heading),
      0,
      -Math.cos(player.heading),
    );
    const right = new THREE.Vector3(
      Math.cos(player.heading),
      0,
      Math.sin(player.heading),
    );
    if (runtime.view === "overview") {
      position.set(0, 225, 68);
      target.set(0, 0, -65);
    } else if (runtime.view === "helm") {
      position
        .set(player.x, 1.85 + heightAt(player.x, -player.y), -player.y)
        .addScaledVector(forward, -0.9)
        .addScaledVector(right, -player.tackSide * 0.85);
      target
        .set(player.x, 1.9, -player.y)
        .addScaledVector(forward, 45)
        .addScaledVector(right, -player.tackSide * 0.9);
    } else {
      position
        .set(player.x, 7.5, -player.y)
        .addScaledVector(forward, -16)
        .addScaledVector(right, -12);
      target
        .set(player.x, 2.3, -player.y)
        .addScaledVector(forward, 9)
        .addScaledVector(right, 4);
    }
    const snap = !initialized || previousView !== runtime.view || still;
    const smoothing = snap ? 1 : 1 - Math.exp(-dt * 4);
    camera.position.lerp(position, smoothing);
    aim.lerp(target, smoothing);
    camera.lookAt(aim);
    previousView = runtime.view;
    initialized = true;
    sky.position.copy(camera.position);
    camera.updateMatrixWorld();
    const occupied: { x: number; y: number }[] = [];
    labels.forEach((label, i) => {
      if (!label) return;
      const boat = race.boats[i];
      const onBoard = runtime.view !== "overview" && i === runtime.focusIndex;
      const spot =
        boats[i].group.visible && !onBoard
          ? labelPosition(
              projected.set(boat.x, 7, -boat.y).project(camera),
              viewWidth,
              viewHeight,
            )
          : null;
      if (spot) {
        let tries = 0;
        while (
          occupied.some(
            (p) => Math.abs(p.x - spot.x) < 105 && Math.abs(p.y - spot.y) < 23,
          ) &&
          tries++ < 4
        )
          spot.y -= 25;
        if (spot.y < 25) {
          label.hidden = true;
          return;
        }
        occupied.push({ ...spot });
      }
      label.hidden = spot === null;
      label.classList.toggle("is-prediction", boat.id === runtime.prediction);
      if (spot)
        label.style.transform = `translate(${spot.x}px, ${spot.y}px) translate(-50%, -100%)`;
    });
    ocean.reflect(renderer, scene, camera, runtime.quality);
    renderer.render(scene, camera);
  });
  return () => {
    renderer.setAnimationLoop(null);
    resize.disconnect();
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    renderer.domElement.removeEventListener("webglcontextrestored", restored);
    contextNotice.remove();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    ocean.dispose();
    for (const boat of boats) boat.numberTexture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    for (const label of labels) label?.remove();
  };
}
