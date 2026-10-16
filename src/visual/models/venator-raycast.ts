import { Box3, Matrix4, Mesh, Ray, Triangle, Vector3, type Intersection, type Raycaster } from 'three';

interface Node { box: Box3; left?: Node; right?: Node; triangles?: number[] }

/** Static mesh BVH. Leaves test original triangles, so decorations still occlude shots. */
export function accelerateRaycast(object: Mesh) {
  const geometry = object.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = (index?.count ?? position.count) / 3;
  const boxes: Box3[] = [], centers: Vector3[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const vertex = (triangle: number, corner: number, result: Vector3) => result.fromBufferAttribute(position, index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner);
  for (let i = 0; i < count; i++) {
    const box = new Box3().setFromPoints([vertex(i,0,a),vertex(i,1,b),vertex(i,2,c)]);
    boxes.push(box); centers.push(box.getCenter(new Vector3()));
  }
  function build(triangles: number[]): Node {
    const box = new Box3(); for (const i of triangles) box.union(boxes[i]!);
    if (triangles.length <= 24) return { box, triangles };
    const size = box.getSize(new Vector3());
    const axis = size.x > size.y && size.x > size.z ? 'x' : size.y > size.z ? 'y' : 'z';
    triangles.sort((a,b)=>centers[a]![axis]-centers[b]![axis]);
    const mid = Math.floor(triangles.length / 2);
    return { box, left: build(triangles.slice(0,mid)), right: build(triangles.slice(mid)) };
  }
  const root = build(Array.from({length:count},(_,i)=>i));
  const inverse = new Matrix4(), localRay = new Ray(), hit = new Vector3(), worldHit = new Vector3();
  object.raycast = function(raycaster: Raycaster, intersects: Intersection[]) {
    inverse.copy(this.matrixWorld).invert(); localRay.copy(raycaster.ray).applyMatrix4(inverse);
    const visit = (node: Node) => {
      if (!localRay.intersectsBox(node.box)) return;
      if (node.left && node.right) { visit(node.left); visit(node.right); return; }
      for (const i of node.triangles ?? []) {
        vertex(i,0,a); vertex(i,1,b); vertex(i,2,c);
        if (!localRay.intersectTriangle(a,b,c,true,hit)) continue;
        worldHit.copy(hit).applyMatrix4(this.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(worldHit);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        intersects.push({distance,point:worldHit.clone(),object:this,faceIndex:i,face:{
          a:index?index.getX(i*3):i*3,b:index?index.getX(i*3+1):i*3+1,c:index?index.getX(i*3+2):i*3+2,
          normal:Triangle.getNormal(a,b,c,new Vector3()),materialIndex:0,
        }});
      }
    };
    visit(root);
  };
}
