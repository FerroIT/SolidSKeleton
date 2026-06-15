"""Write glTF 2.0 output (.glb and .gltf)."""

import json
import os
import struct

import numpy as np

# public API

def write_glb(vertices: np.ndarray, faces: np.ndarray, path: str):

    verts, norms, idx = _unindex(
        np.asarray(vertices, dtype=np.float32),
        np.asarray(faces, dtype=np.uint32))

    buf = _buffer(verts, norms, idx)
    g = _gltf_json(verts, norms, idx, len(buf))

    jb = json.dumps(g, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((-len(jb)) % 4)

    total = 12 + 8 + len(jb) + 8 + len(buf)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))   # header
        f.write(struct.pack('<II', len(jb), 0x4E4F534A))     # JSON chunk
        f.write(jb)
        f.write(struct.pack('<II', len(buf), 0x004E4942))    # BIN chunk
        f.write(buf)


def write_gltf(vertices: np.ndarray, faces: np.ndarray, path: str):

    verts, norms, idx = _unindex(
        np.asarray(vertices, dtype=np.float32),
        np.asarray(faces, dtype=np.uint32))

    buf = _buffer(verts, norms, idx)

    bin_name = os.path.splitext(os.path.basename(path))[0] + '.bin'
    bin_path = os.path.join(os.path.dirname(path) or '.', bin_name)
    g = _gltf_json(verts, norms, idx, len(buf), bin_uri=bin_name)

    with open(bin_path, 'wb') as f:
        f.write(buf)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(g, f, indent=2)

# internals

def _unindex(verts, faces):

    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    n = np.cross(v1 - v0, v2 - v0).astype(np.float32)
    lengths = np.linalg.norm(n, axis=1, keepdims=True)
    n /= np.where(lengths < 1e-10, 1.0, lengths)

    nf = len(faces)
    ov = np.empty((nf * 3, 3), dtype=np.float32)
    on = np.empty((nf * 3, 3), dtype=np.float32)
    ov[0::3], ov[1::3], ov[2::3] = v0, v1, v2
    on[0::3] = on[1::3] = on[2::3] = n
    of = np.arange(nf * 3, dtype=np.uint32).reshape(-1, 3)
    return ov, on, of


def _buffer(verts, norms, faces):
    b = verts.tobytes() + norms.tobytes() + faces.tobytes()
    b += b'\x00' * ((-len(b)) % 4)
    return b


def _gltf_json(verts, norms, faces, buf_len, bin_uri=None):
    nv, nt = len(verts), len(faces)
    pl, nl, il = nv * 12, nv * 12, nt * 12

    buf_entry = {'byteLength': buf_len}
    if bin_uri is not None:
        buf_entry['uri'] = bin_uri

    return {
        'asset': {'version': '2.0', 'generator': 'ssk'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{
            'attributes': {'POSITION': 0, 'NORMAL': 1},
            'indices': 2, 'mode': 4,
        }]}],
        'accessors': [
            {'bufferView': 0, 'byteOffset': 0, 'componentType': 5126,
             'count': nv, 'type': 'VEC3',
             'min': verts.min(axis=0).tolist(),
             'max': verts.max(axis=0).tolist()},
            {'bufferView': 1, 'byteOffset': 0, 'componentType': 5126,
             'count': nv, 'type': 'VEC3'},
            {'bufferView': 2, 'byteOffset': 0, 'componentType': 5125,
             'count': nt * 3, 'type': 'SCALAR'},
        ],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0,      'byteLength': pl, 'target': 34962},
            {'buffer': 0, 'byteOffset': pl,      'byteLength': nl, 'target': 34962},
            {'buffer': 0, 'byteOffset': pl + nl, 'byteLength': il, 'target': 34963},
        ],
        'buffers': [buf_entry],
    }
