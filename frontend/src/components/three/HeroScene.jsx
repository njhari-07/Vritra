import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import TwinklingStars from './TwinklingStars';

// "Case File Night" entity colours: each colour names one kind of entity.
const C = {
  person: '#5AA9FF', account: '#F2B544', phone: '#3DD6B5', place: '#A98BFF', case: '#EDF2FA',
  link: '#5AA9FF', loop: '#FF6B5B', night: '#0A1020'
};
const SIZE = { case: 0.2, person: 0.085, account: 0.075, phone: 0.06, place: 0.07 };

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* Illustrative investigation: three cases, each with people, accounts, phones and a place;
   one person shared across two cases, and two money loops running between accounts. */
function buildNetwork() {
  const rand = seeded(7);
  const jitter = s => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(s);
  const nodes = [];
  const links = [];
  const add = (type, p) => (nodes.push({ type, p }), nodes.length - 1);
  const cases = [0, 1, 2].map(i => {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    return add('case', new THREE.Vector3(Math.cos(a) * 2.3, (i - 1) * 0.7, Math.sin(a) * 2.3));
  });
  const accounts = [];
  cases.forEach(ci => {
    const hub = nodes[ci].p;
    const around = r => hub.clone().add(jitter(r)).add(new THREE.Vector3(0, 0, 0));
    const people = Array.from({ length: 5 }, () => add('person', around(2.2)));
    const accs = Array.from({ length: 3 }, () => add('account', around(2.6)));
    const phones = Array.from({ length: 2 }, () => add('phone', around(2.4)));
    const place = add('place', around(2.0));
    accounts.push(...accs);
    people.forEach((p, k) => {
      links.push([p, ci]);
      if (k < 3) links.push([p, accs[k]]);
      if (k < 2) links.push([p, phones[k]]);
      if (k % 2 === 0) links.push([p, place]);
    });
    links.push([phones[0], phones[1]]);
  });
  // A person referenced in two cases (cross-case link).
  const bridge = add('person', nodes[cases[0]].p.clone().lerp(nodes[cases[1]].p, 0.5).add(new THREE.Vector3(0, 0.6, 0)));
  links.push([bridge, cases[0]], [bridge, cases[1]]);
  // Money loops: transfers that return to the starting account.
  const loops = [
    [accounts[0], accounts[4], accounts[7], accounts[0]],
    [accounts[2], accounts[5], accounts[3], accounts[2]]
  ];
  return { nodes, links, loops };
}

function Network({ dim }) {
  const tilt = useRef();
  const spin = useRef();
  const dashes = useRef();
  const pulses = useRef();
  const { nodes, links, loops } = useMemo(() => buildNetwork(), []);

  const nodeMesh = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 18, 18);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ toneMapped: false }), nodes.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    nodes.forEach((n, i) => {
      const s = SIZE[n.type];
      m.makeScale(s, s, s).setPosition(n.p);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(C[n.type]).multiplyScalar(n.type === 'case' ? 1.6 : 1.35));
    });
    return mesh;
  }, [nodes]);

  const linkGeo = useMemo(() => {
    const pos = new Float32Array(links.length * 6);
    links.forEach(([a, b], k) => { nodes[a].p.toArray(pos, k * 6); nodes[b].p.toArray(pos, k * 6 + 3); });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, [nodes, links]);

  // Each loop is a closed path; dashes travel along it.
  const loopPaths = useMemo(() => loops.map(ids => {
    const pts = ids.map(i => nodes[i].p);
    const segs = pts.slice(1).map((p, i) => ({ a: pts[i], b: p, len: pts[i].distanceTo(p) }));
    return { segs, total: segs.reduce((s, x) => s + x.len, 0), pts };
  }), [loops, nodes]);
  const loopGeo = useMemo(() => {
    const arr = [];
    loopPaths.forEach(l => l.segs.forEach(s => arr.push(...s.a.toArray(), ...s.b.toArray())));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    return g;
  }, [loopPaths]);

  const DASHES_PER_LOOP = 18;
  const pulseLinks = useMemo(() => Array.from({ length: 24 }, (_, i) => ({ link: (i * 11) % links.length, t: (i * 0.29) % 1, speed: 0.25 + (i % 4) * 0.06 })), [links]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(), s: new THREE.Vector3() }), []);

  useFrame((state, dt) => {
    const { x, y } = state.pointer;
    // Tilt toward the cursor; spin slowly on its own.
    if (tilt.current) {
      tilt.current.rotation.x = THREE.MathUtils.lerp(tilt.current.rotation.x, -y * 0.35, 0.05);
      tilt.current.rotation.z = THREE.MathUtils.lerp(tilt.current.rotation.z, x * 0.12, 0.05);
      tilt.current.rotation.y = THREE.MathUtils.lerp(tilt.current.rotation.y, x * 0.45, 0.05);
    }
    if (spin.current) spin.current.rotation.y += dt * 0.07;
    const t = state.clock.elapsedTime;
    let k = 0;
    loopPaths.forEach(path => {
      for (let j = 0; j < DASHES_PER_LOOP; j++) {
        let dist = ((t * 0.55 + j / DASHES_PER_LOOP) % 1) * path.total;
        const seg = path.segs.find(s => (dist <= s.len ? true : ((dist -= s.len), false))) || path.segs[0];
        tmp.v.lerpVectors(seg.a, seg.b, Math.min(dist / seg.len, 1));
        tmp.d.subVectors(seg.b, seg.a).normalize();
        tmp.q.setFromUnitVectors(tmp.up, tmp.d);
        tmp.m.compose(tmp.v, tmp.q, tmp.s.set(0.022, 0.13, 0.022));
        dashes.current.setMatrixAt(k++, tmp.m);
      }
    });
    dashes.current.instanceMatrix.needsUpdate = true;
    pulseLinks.forEach((p, i) => {
      p.t += dt * p.speed;
      if (p.t > 1) { p.t = 0; p.link = (p.link + 7 + i) % links.length; }
      const [a, b] = links[p.link];
      tmp.v.lerpVectors(nodes[a].p, nodes[b].p, p.t);
      tmp.m.makeScale(0.025, 0.025, 0.025).setPosition(tmp.v);
      pulses.current.setMatrixAt(i, tmp.m);
    });
    pulses.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={tilt}>
      <group ref={spin}>
        <primitive object={nodeMesh} />
        <lineSegments geometry={linkGeo}>
          <lineBasicMaterial color={C.link} transparent opacity={dim ? 0.12 : 0.22} />
        </lineSegments>
        <lineSegments geometry={loopGeo}>
          <lineBasicMaterial color={C.loop} transparent opacity={dim ? 0.2 : 0.35} />
        </lineSegments>
        <instancedMesh ref={dashes} args={[undefined, undefined, loops.length * DASHES_PER_LOOP]}>
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <meshBasicMaterial color={new THREE.Color(C.loop).multiplyScalar(2.2)} toneMapped={false} />
        </instancedMesh>
        <instancedMesh ref={pulses} args={[undefined, undefined, pulseLinks.length]}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshBasicMaterial color={new THREE.Color(C.person).multiplyScalar(2.4)} toneMapped={false} />
        </instancedMesh>
      </group>
    </group>
  );
}

export default function HeroScene({ dim = false }) {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <Canvas camera={{ position: [0, 0.4, 8.2], fov: 50 }} dpr={[1, 1.75]} frameloop={reduced ? 'demand' : 'always'} gl={{ antialias: true }}>
      <color attach="background" args={[C.night]} />
      <fog attach="fog" args={[C.night, 7, 15]} />
      <TwinklingStars animate={!reduced} />
      <Network dim={dim} />
      <EffectComposer>
        <Bloom intensity={dim ? 0.55 : 1.0} luminanceThreshold={0.28} luminanceSmoothing={0.3} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
