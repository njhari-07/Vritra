import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Quaternion, Vector3 } from 'three';

const COLORS = { credit: '#3af0a8', debit: '#ff626d' };
const UP = new Vector3(0, 1, 0);

function FlowGlow({ start, end, rotation, color }) {
  const glow = useRef(null);
  const progress = useRef(0);

  useFrame(({ invalidate }, delta) => {
    if (!glow.current) return;
    progress.current = (progress.current + Math.min(delta, .05) / 1.8) % 1;
    glow.current.position.lerpVectors(start, end, progress.current);
    invalidate();
  });

  return (
    <group ref={glow} position={start}>
      <mesh><sphereGeometry args={[.34, 14, 10]} /><meshBasicMaterial color={color} transparent opacity={.22} depthWrite={false} /></mesh>
      <mesh quaternion={rotation}>
        <coneGeometry args={[.15, .4, 16]} />
        <meshBasicMaterial color="#f4ffff" />
      </mesh>
    </group>
  );
}

function PaymentLane({ direction, endpoint, split, selected, dimmed, animate }) {
  const { start, end, tip, rotation, center, length } = useMemo(() => {
    const unit = endpoint.clone().normalize();
    const side = new Vector3(-unit.z, 0, unit.x).normalize();
    const offset = split ? (direction === 'credit' ? -.28 : .28) : 0;
    const inner = unit.clone().multiplyScalar(1.18).addScaledVector(side, offset);
    const outer = endpoint.clone().addScaledVector(unit, -.72).addScaledVector(side, offset);
    const [start, end] = direction === 'credit' ? [outer, inner] : [inner, outer];
    const heading = end.clone().sub(start).normalize();
    return { start, end, tip: end.clone().addScaledVector(heading, -.19),
      rotation: new Quaternion().setFromUnitVectors(UP, heading), center: start.clone().lerp(end, .5),
      length: start.distanceTo(end) };
  }, [direction, endpoint, split]);
  const color = COLORS[direction];
  const opacity = dimmed ? .25 : 1;

  return <>
    {selected && <Line points={[start, end]} color={color} transparent opacity={.24} lineWidth={9} depthWrite={false} />}
    <Line points={[start, end]} color={color} transparent={dimmed} opacity={opacity} lineWidth={selected ? 3.6 : 2.2} />
    <mesh position={tip} quaternion={rotation}>
      <coneGeometry args={[.18, .39, 16]} />
      <meshBasicMaterial color={color} transparent={dimmed} opacity={opacity} />
    </mesh>
    <mesh position={center} quaternion={rotation}>
      <cylinderGeometry args={[.18, .18, length, 6]} />
      <meshBasicMaterial visible={false} />
    </mesh>
    {selected && animate && <FlowGlow start={start} end={end} rotation={rotation} color={color} />}
  </>;
}

function PartyNode({ party, position, active, direction, hasFocus, animate, onSelect, labelLayer }) {
  const sides = Object.keys(party.directions);
  const split = sides.length === 2;
  const node = useRef(null);
  const endpoint = useMemo(() => new Vector3(...position), [position]);
  const size = active ? .64 : .46;

  useFrame(({ camera }) => {
    if (split && node.current) node.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group onClick={event => { event.stopPropagation(); onSelect(party.key); }}>
      {sides.map(side => <PaymentLane key={side} direction={side} endpoint={endpoint} split={split}
        selected={active && (!direction || direction === side)}
        dimmed={hasFocus && (!active || Boolean(direction && direction !== side))} animate={animate} />)}
      <group ref={node} position={position}>
        {split ? sides.map(side => <mesh key={side}>
          <sphereGeometry args={[size, 20, 14, side === 'credit' ? -Math.PI / 2 : Math.PI / 2, Math.PI]} />
          <meshBasicMaterial color={COLORS[side]} />
        </mesh>) : <mesh>
          {party.kind === 'narration' ? <octahedronGeometry args={[size * 1.2]} />
            : party.kind === 'channel' ? <boxGeometry args={[size * 1.5, size * 1.5, size * 1.5]} />
            : <sphereGeometry args={[size, 20, 14]} />}
          <meshBasicMaterial color={COLORS[sides[0]]} />
        </mesh>}
      </group>
      <Html portal={labelLayer} position={position} center zIndexRange={active ? [5, 5] : [3, 0]}>
        <button type="button" className="statement-flow-node-label" title={party.label}
          data-directions={split ? 'both' : sides[0]} aria-pressed={active}
          aria-label={party.label + (split ? ' · incoming and outgoing' : sides[0] === 'credit' ? ' · incoming' : ' · outgoing')}
          onClick={() => onSelect(party.key)}>
          <i aria-hidden="true" /> <span>{party.label}</span>
        </button>
      </Html>
    </group>
  );
}

export default function StatementFlowScene({ parties, active, direction, onSelect }) {
  const labelLayer = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = event => setReducedMotion(event.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const positions = useMemo(() => parties.map((_, index) => {
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    const height = parties.length === 1 ? 0 : (1 - 2 * index / (parties.length - 1)) * .72;
    const radius = 7.5;
    const horizontal = radius * Math.sqrt(1 - height ** 2);
    return [horizontal * Math.cos(theta), radius * height, horizontal * Math.sin(theta)];
  }), [parties]);

  return (
    <div className="statement-flow-canvas">
      <div className="statement-flow-label-layer" ref={labelLayer} />
      <Canvas dpr={[1, 1.5]} frameloop="demand" camera={{ position: [11, 8, 17], fov: 52 }}
        fallback={<p>3D rendering is unavailable. Use the counterparty list and source rows below.</p>}>
        <color attach="background" args={['#101b2b']} />
        <gridHelper position={[0, -6.5, 0]} args={[28, 14, '#35506b', '#233449']} />
        <mesh>
          <sphereGeometry args={[1.08, 32, 20]} />
          <meshBasicMaterial color="#88baff" />
        </mesh>
        {parties.map((party, index) => (
          <PartyNode key={party.key} party={party} position={positions[index]} active={active === party.key}
            direction={direction} hasFocus={Boolean(active)} animate={!reducedMotion} onSelect={onSelect} labelLayer={labelLayer} />
        ))}
        <OrbitControls enableDamping={false} minDistance={8} maxDistance={43} />
      </Canvas>
    </div>
  );
}
