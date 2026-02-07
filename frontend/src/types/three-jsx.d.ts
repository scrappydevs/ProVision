/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Object3DNode, MaterialNode } from "@react-three/fiber";
import type {
  Group,
  Mesh,
  Points,
  Line,
  CircleGeometry,
  BoxGeometry,
  SphereGeometry,
  PlaneGeometry,
  CylinderGeometry,
  RingGeometry,
  BufferGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  LineBasicMaterial,
  PointsMaterial,
  AmbientLight,
  DirectionalLight,
  PointLight,
  BufferAttribute,
} from "three";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      group: Object3DNode<Group, typeof Group>;
      mesh: Object3DNode<Mesh, typeof Mesh>;
      points: Object3DNode<Points, typeof Points>;
      line: Object3DNode<Line, typeof Line>;
      circleGeometry: Object3DNode<CircleGeometry, typeof CircleGeometry>;
      boxGeometry: Object3DNode<BoxGeometry, typeof BoxGeometry>;
      sphereGeometry: Object3DNode<SphereGeometry, typeof SphereGeometry>;
      planeGeometry: Object3DNode<PlaneGeometry, typeof PlaneGeometry>;
      cylinderGeometry: Object3DNode<CylinderGeometry, typeof CylinderGeometry>;
      ringGeometry: Object3DNode<RingGeometry, typeof RingGeometry>;
      bufferGeometry: Object3DNode<BufferGeometry, typeof BufferGeometry>;
      bufferAttribute: Object3DNode<BufferAttribute, typeof BufferAttribute>;
      meshBasicMaterial: MaterialNode<MeshBasicMaterial, typeof MeshBasicMaterial>;
      meshStandardMaterial: MaterialNode<MeshStandardMaterial, typeof MeshStandardMaterial>;
      lineBasicMaterial: MaterialNode<LineBasicMaterial, typeof LineBasicMaterial>;
      pointsMaterial: MaterialNode<PointsMaterial, typeof PointsMaterial>;
      ambientLight: Object3DNode<AmbientLight, typeof AmbientLight>;
      directionalLight: Object3DNode<DirectionalLight, typeof DirectionalLight>;
      pointLight: Object3DNode<PointLight, typeof PointLight>;
    }
  }
}
