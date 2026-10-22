import * as THREE from "three";

function clothGeometry(height: number, foot: number) {
  const positions: number[] = [];
  const indices: number[] = [];
  const columns = 12;
  const rows = 18;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      positions.push(
        Math.sin(u * Math.PI) * (1 - v) * foot * 0.12,
        v * height,
        u * foot * (1 - v) - v * 0.18,
      );
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const a = row * (columns + 1) + col;
      indices.push(
        a,
        a + 1,
        a + columns + 1,
        a + 1,
        a + columns + 2,
        a + columns + 1,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function spar(
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const delta = to.clone().sub(from);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), 8),
    material,
  );
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  return mesh;
}

export function makeBoat(accent: number) {
  const group = new THREE.Group();
  const motion = new THREE.Group();
  group.add(motion);
  const fiberglass = new THREE.MeshStandardMaterial({
    color: 0xf5f7ed,
    roughness: 0.35,
    metalness: 0.08,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: accent,
    roughness: 0.48,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aaeb7,
    metalness: 0.7,
    roughness: 0.3,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x193542,
    roughness: 0.8,
  });
  const hullShape = new THREE.Shape();
  hullShape.moveTo(0, -2.36);
  hullShape.bezierCurveTo(0.52, -1.93, 0.9, -0.45, 0.76, 2.15);
  hullShape.lineTo(-0.76, 2.15);
  hullShape.bezierCurveTo(-0.9, -0.45, -0.52, -1.93, 0, -2.36);
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hullShape, {
      depth: 0.45,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.09,
      bevelSegments: 2,
      steps: 1,
    }),
    fiberglass,
  );
  hull.rotation.x = Math.PI / 2;
  hull.position.y = 0.55;
  motion.add(hull);
  const deck = new THREE.Mesh(
    new THREE.ShapeGeometry(hullShape, 24),
    fiberglass,
  );
  deck.rotation.x = Math.PI / 2;
  deck.position.y = 0.58;
  deck.material.side = THREE.DoubleSide;
  motion.add(deck);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.05, 2.45), dark);
  cockpit.position.set(0, 0.62, 0.52);
  motion.add(cockpit);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(0.87, 0.05, 1.95),
    new THREE.MeshStandardMaterial({ color: 0xd4c9a9, roughness: 0.86 }),
  );
  floor.position.set(0, 0.65, 0.61);
  motion.add(floor);
  for (const x of [-0.63, 0.63]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.16, 2.9),
      fiberglass,
    );
    rail.position.set(x, 0.67, 0.5);
    motion.add(rail);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.12, 3.35),
      trim,
    );
    stripe.position.set(x * 1.12, 0.38, 0.25);
    motion.add(stripe);
  }
  for (let i = 0; i < 7; i++) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.015, 1.85),
      dark,
    );
    slat.position.set(-0.33 + i * 0.11, 0.68, 0.65);
    motion.add(slat);
  }
  const mastFoot = new THREE.Vector3(0, 0.65, -0.64);
  const mastTop = new THREE.Vector3(0, 6.4, -0.8);
  motion.add(spar(mastFoot, mastTop, 0.037, metal));
  const rig = new THREE.LineBasicMaterial({
    color: 0xc6d5db,
    transparent: true,
    opacity: 0.75,
  });
  for (const anchor of [
    [-0.65, 0.65, -0.2],
    [0.65, 0.65, -0.2],
    [0, 0.58, -2.27],
  ]) {
    motion.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          mastTop.clone(),
          new THREE.Vector3(...anchor),
        ]),
        rig,
      ),
    );
  }
  const cloth = new THREE.MeshStandardMaterial({
    color: 0xfffdf0,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.02,
  });
  const main = new THREE.Group();
  main.position.set(0, 1.08, -0.66);
  main.add(new THREE.Mesh(clothGeometry(5.05, 2.45), cloth));
  main.add(
    spar(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 2.45),
      0.028,
      metal,
    ),
  );
  const seamMaterial = new THREE.LineBasicMaterial({
    color: 0xb7c9ce,
    transparent: true,
    opacity: 0.48,
  });
  for (let row = 1; row <= 6; row++) {
    const v = row / 8;
    const points = Array.from({ length: 13 }, (_, col) => {
      const u = col / 12;
      return new THREE.Vector3(
        Math.sin(u * Math.PI) * (1 - v) * 2.45 * 0.12 + 0.003,
        v * 5.05,
        u * 2.45 * (1 - v) - v * 0.18,
      );
    });
    main.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        seamMaterial,
      ),
    );
  }
  motion.add(main);
  const jib = new THREE.Group();
  jib.position.set(0, 0.85, -2.22);
  jib.add(new THREE.Mesh(clothGeometry(4.1, 1.55), cloth));
  motion.add(jib);
  // Rudder, tiller and sheet are visible at the transom / in the cockpit.
  const rudder = new THREE.Group();
  rudder.position.set(0, 0.45, 2.24);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.4), dark);
  blade.position.set(0, -0.36, 0.12);
  rudder.add(blade);
  rudder.add(
    spar(
      new THREE.Vector3(0, 0.3, 0.1),
      new THREE.Vector3(0, 0.35, -1.3),
      0.025,
      dark,
    ),
  );
  motion.add(rudder);
  const crew = new THREE.Group();
  for (const z of [0.15, 1.1]) {
    const person = new THREE.Group();
    person.position.set(-0.5, 0.81, z);
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.17, 0.3, 4, 8),
      trim,
    );
    torso.position.y = 0.28;
    torso.rotation.z = -0.15;
    person.add(torso);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xd8aa86, roughness: 0.8 }),
    );
    head.position.set(-0.07, 0.65, 0);
    person.add(head);
    for (const offset of [-0.12, 0.12]) {
      person.add(
        spar(
          new THREE.Vector3(0, 0.15, offset),
          new THREE.Vector3(0.38, -0.1, offset),
          0.065,
          dark,
        ),
      );
    }
    crew.add(person);
  }
  motion.add(crew);
  return { group, motion, main, jib, rudder, crew };
}
