import React, { useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';

const COLORS = { credit: '#49d6aa', debit: '#f2a96b' };
const ORIGIN = [0, 0, 0];

function PaymentArrow({ group, position, selected, onSelect, labelLayer }) {
  const args = useMemo(() => {
    const endpoint = new Vector3(...position);
    const unit = endpoint.clone().normalize();
    const incoming = group.direction === 'credit';
    return [incoming ? unit.clone().negate() : unit,
      unit.clone().multiplyScalar(incoming ? endpoint.length() - .58 : 1.1),
      endpoint.length() - 1.75, COLORS[group.direction], .65, .42];
  }, [position, group.direction]);
  return (
    <group onClick={event => { event.stopPropagation(); onSelect(group.key); }}>
      <arrowHelper args={args} />
      <mesh position={position}>
        {group.kind === 'narration' ? <octahedronGeometry args={[selected ? .71 : .54]} />
          : group.kind === 'channel' ? <boxGeometry args={selected ? [.9, .9, .9] : [.66, .66, .66]} />
          : <sphereGeometry args={[selected ? .64 : .44, 18, 12]} />}
        <meshBasicMaterial color={COLORS[group.direction]} />
      </mesh>
      <Html portal={labelLayer} position={position} center zIndexRange={[3, 0]}>
        <span className="statement-flow-node-label">{group.label}</span>
      </Html>
    </group>
  );
}

export default function StatementFlowScene({ groups, active, onSelect }) {
  const labelLayer = useRef(null);
  const positions = useMemo(() => groups.map((group, index) => {
    const theta = index * Math.PI * (3 - Math.sqrt(5));
    const height = groups.length === 1 ? 0 : (1 - 2 * index / (groups.length - 1)) * 0.72;
    const radius = 7.5;
    const horizontal = radius * Math.sqrt(1 - height ** 2);
    return [horizontal * Math.cos(theta), radius * height, horizontal * Math.sin(theta)];
  }), [groups]);

  return (
    <div className="statement-flow-canvas">
      <div className="statement-flow-label-layer" ref={labelLayer} aria-hidden="true" />
      <Canvas dpr={[1, 1.5]} frameloop="demand" camera={{ position: [11, 8, 17], fov: 52 }}
        fallback={<p>3D rendering is unavailable. Use the payment links and source rows below.</p>}>
        <color attach="background" args={['#101b2b']} />
        <gridHelper position={[0, -6.5, 0]} args={[28, 14, '#35506b', '#233449']} />
        <mesh position={ORIGIN}>
          <sphereGeometry args={[1.08, 32, 20]} />
          <meshBasicMaterial color="#88baff" />
        </mesh>
        {groups.map((group, index) => (
          <PaymentArrow key={group.key} group={group} position={positions[index]}
            selected={active === group.key} onSelect={onSelect} labelLayer={labelLayer} />
        ))}
        <OrbitControls enableDamping={false} minDistance={8} maxDistance={43} />
      </Canvas>
    </div>
  );
}
