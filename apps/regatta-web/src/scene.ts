import { MARK, STEP, visiblePressure, windAt } from "sailing-sim";
import * as THREE from "three";
import { makeBoat } from "./boat-visual";
import { createOcean, createSky, waveHeight } from "./ocean";
import type { PracticeRuntime } from "./runtime";

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

export function mountScene(host: HTMLElement, runtime: PracticeRuntime) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
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
  const boats = [makeBoat(0xef8354), makeBoat(0x559cc3)];
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
        color: i ? 0x92d3ec : 0xffd48e,
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
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  const lost = (event: Event) => {
    event.preventDefault();
    runtime.pause();
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  host.appendChild(renderer.domElement);
  resize.observe(host);
  let last = 0;
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    runtime.advance(last ? now - last : 0);
    last = now;
    const race = runtime.race;
    const player = race.boats[0];
    const time = race.tick * STEP;
    const visualTime = reducedMotion.matches ? 0 : time;
    const wind = windAt(race.scenario, race.seed, time, player.x, player.y);
    ocean.update(
      visualTime,
      wind.speed,
      visiblePressure(race.scenario, race.seed, time),
      player.x,
      -player.y,
    );
    if (previousQuality !== runtime.quality) {
      renderer.setPixelRatio(
        Math.min(
          window.devicePixelRatio,
          runtime.quality === "economy" ? 1 : 1.5,
        ),
      );
      previousQuality = runtime.quality;
    }
    boats.forEach((mesh, i) => {
      const boat = race.boats[i];
      const bob = waveHeight(boat.x, -boat.y, visualTime);
      mesh.group.visible = i === 0 || race.withOpponent;
      mesh.group.position.set(boat.x, bob, -boat.y);
      mesh.group.rotation.y = -boat.heading;
      const heel = reducedMotion.matches
        ? 0
        : -boat.tackSide * Math.min(0.16, boat.speed * 0.04) +
          Math.sin(visualTime * 1.3 + i) * 0.015;
      mesh.motion.rotation.z = heel;
      mesh.motion.rotation.x = reducedMotion.matches
        ? 0
        : Math.sin(visualTime * 1.7 + boat.y * 0.2) * 0.018;
      mesh.main.rotation.y = boat.tackSide * (0.1 + boat.mainSheet * 1.25);
      mesh.jib.rotation.y = boat.tackSide * 0.2;
      mesh.rudder.rotation.y = -boat.rudder * 0.45;
      mesh.crew.position.x = boat.tackSide > 0 ? 0 : 1;
      const trail = runtime.trails[i];
      const attribute = trails[i].geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let j = 0; j < trail.length; j++)
        attribute.setXYZ(
          j,
          trail[j].x,
          waveHeight(trail[j].x, -trail[j].y, visualTime) + 0.06,
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
          foam.setXYZ(j * 2 + side, x, waveHeight(x, z, visualTime) + 0.055, z);
        }
      }
      foam.needsUpdate = true;
      wakes[i].geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
      wakes[i].material.uniforms.uSpeed.value = boat.speed;
      wakes[i].visible = i === 0 || race.withOpponent;
    });
    marks.forEach((mark, i) => {
      mark.position.y = waveHeight(
        markPositions[i][0],
        markPositions[i][1],
        visualTime,
      );
      mark.rotation.z = reducedMotion.matches
        ? 0
        : Math.sin(visualTime * 1.1 + i) * 0.04;
    });
    gate.visible = runtime.view === "overview";
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
        .set(
          player.x,
          1.85 + waveHeight(player.x, -player.y, visualTime),
          -player.y,
        )
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
    const snap =
      !initialized || previousView !== runtime.view || reducedMotion.matches;
    const smoothing = snap ? 1 : 1 - Math.exp(-dt * 4);
    camera.position.lerp(position, smoothing);
    aim.lerp(target, smoothing);
    camera.lookAt(aim);
    previousView = runtime.view;
    initialized = true;
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  });
  return () => {
    renderer.setAnimationLoop(null);
    resize.disconnect();
    renderer.domElement.removeEventListener("webglcontextlost", lost);
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
    renderer.dispose();
    renderer.domElement.remove();
  };
}
