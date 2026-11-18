import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

// Procedural "investigation network": a few communities of entities, linked
// inside and (sparsely) across clusters, with pulses travelling along links.
const PALETTE = ['#38bdf8', '#f59e0b', '#a78bfa', '#10b981', '#ec4899'];

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function buildNetwork(count = 170, clusters = 5) {
  const rand = seeded(42);
  const centers = Array.from({ length: clusters }, (_, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / clusters);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    return new THREE.Vector3().setFromSphericalCoords(2.3, phi, theta);
  });
  const nodes = Array.from({ length: count }, (_, i) => {
    const c = i % clusters;
    const p = centers[c].clone().add(
      new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(2.1)
    );
    return { p, c, size: rand() < 0.08 ? 0.11 : 0.035 + rand() * 0.04 };
  });
  const links = [];
  nodes.forEach((a, i) => {
    const near = nodes
      .map((b, j) => ({ j, d: a.p.distanceTo(b.p), same: a.c === b.c }))
      .filter(x => x.j !== i && x.same)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    near.forEach(({ j }) => i < j && links.push([i, j]));
    if (rand() < 0.05) links.push([i, Math.floor(rand() * count)]); // cross-case bridge
  });
  return { nodes, links };
}

function Network({ dim, offsetX }) {
  const group = useRef();
  const pulses = useRef();
  const { nodes, links } = useMemo(() => buildNetwork(), []);

  const nodeMesh = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 14, 14);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, nodes.length);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    nodes.forEach((n, i) => {
      m.makeScale(n.size, n.size, n.size).setPosition(n.p);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(PALETTE[n.c]).multiplyScalar(n.size > 0.1 ? 2.2 : 1.3));
    });
    return mesh;
  }, [nodes]);

  const lineGeo = useMemo(() => {
    const pos = new Float32Array(links.length * 6);
    const col = new Float32Array(links.length * 6);
    const c = new THREE.Color();
    links.forEach(([a, b], k) => {
      nodes[a].p.toArray(pos, k * 6);
      nodes[b].p.toArray(pos, k * 6 + 3);
      c.set(PALETTE[nodes[a].c]).toArray(col, k * 6);
      c.set(PALETTE[nodes[b].c]).toArray(col, k * 6 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, [nodes, links]);

  const pulseState = useMemo(
    () => Array.from({ length: 46 }, (_, i) => ({ link: (i * 37) % links.length, t: (i * 0.137) % 1, speed: 0.18 + (i % 5) * 0.05 })),
    [links]
  );
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3() }), []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const { x, y } = state.pointer;
    g.rotation.y += dt * 0.06;
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, y * 0.25, 0.04);
    g.position.x = THREE.MathUtils.lerp(g.position.x, offsetX + x * 0.3, 0.04);
    pulseState.forEach((p, i) => {
      p.t += dt * p.speed;
      if (p.t > 1) { p.t = 0; p.link = (p.link + 13 + i) % links.length; }
      const [a, b] = links[p.link];
      tmp.v.lerpVectors(nodes[a].p, nodes[b].p, p.t);
      tmp.m.makeScale(0.03, 0.03, 0.03).setPosition(tmp.v);
      pulses.current.setMatrixAt(i, tmp.m);
    });
    pulses.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <primitive object={nodeMesh} />
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial vertexColors transparent opacity={dim ? 0.12 : 0.22} />
      </lineSegments>
      <instancedMesh ref={pulses} args={[undefined, undefined, pulseState.length]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={[3, 3, 3.4]} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

export default function HeroScene({ dim = false, offsetX = 0 }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <Canvas
      camera={{ position: [0, 0, 8.5], fov: 50 }}
      dpr={[1, 1.75]}
      frameloop={reduced ? 'demand' : 'always'}
      gl={{ antialias: true, alpha: true }}
    >
      <fog attach="fog" args={['#05080f', 7, 15]} />
      <Stars radius={60} depth={30} count={1800} factor={3} fade speed={0.4} />
      <Network dim={dim} offsetX={offsetX} />
      <EffectComposer>
        <Bloom intensity={dim ? 0.6 : 1.15} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
