import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disposeModel, parseModel } from '../src/fbx.js';
import { poseSampler } from '../src/framing.js';

// Minimal FBX 7.4 with a visible triangle and an optional translation take.
// The take begins at 2 s on the source timeline (1 s = 46186158000 FBX units).
function fixture({ mesh = true, motion = 'moving', spaces = false, unnamed = false } = {}) {
  const geometry = mesh ? `
  Geometry: 1, "Geometry::Triangle", "Mesh" {
    Vertices: *9 {
      a: -1,0,0,1,0,0,0,2,0
    }
    PolygonVertexIndex: *3 {
      a: 0,1,-3
    }
  }` : '';
  const animation = motion ? `
  AnimationStack: 3, "AnimStack::Slide", "" {
    Properties70: {
      P: "LocalStart", "KTime", "Time", "",92372316000
      P: "LocalStop", "KTime", "Time", "",138558474000
    }
  }
  AnimationLayer: 4, "AnimLayer::BaseLayer", "" {
    Version: 100
  }
  AnimationCurveNode: 5, "AnimCurveNode::T", "" {
    Properties70: {
      P: "d|X", "Number", "", "A",0
    }
  }
  AnimationCurve: 6, "AnimCurve::X", "" {
    Default: 0
    KeyVer: 4008
    KeyTime: *2 {
      a: 92372316000,138558474000
    }
    KeyValueFloat: *2 {
      a: ${motion === 'moving' ? '0,2' : '0,0'}
    }
  }` : '';
  const text = `; FBX 7.4.0 project file
FBXHeaderExtension: {
  FBXHeaderVersion: 1003
  FBXVersion: 7400
}
Objects: {${geometry}
  Model: 2, "Model::${unnamed ? '' : mesh ? 'Triangle' : 'Rig'}", "${unnamed ? 'Null' : mesh ? 'Mesh' : 'LimbNode'}" {
    Version: 232
    Properties70: {
      P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
    }
  }${unnamed ? `
  Model: 7, "Model::Triangle", "Mesh" {
    Version: 232
  }` : ''}${animation}
}
Connections: {
  C: "OO",2,0${mesh ? (unnamed ? '\n  C: "OO",7,2\n  C: "OO",1,7' : '\n  C: "OO",1,2') : ''}${motion ? `
  C: "OO",4,3
  C: "OO",5,4
  C: "OP",5,2,"Lcl Translation"
  C: "OP",6,5,"d|X"` : ''}
}
`;
  return new TextEncoder().encode(spaces ? text : text.replace(/^(?: {2})+/gm, (indent) => '\t'.repeat(indent.length / 2))).buffer;
}

for (const spaces of [false, true]) {
  test(`FBX with ${spaces ? 'space' : 'tab'} indentation starts the take at its first key`, async () => {
    const asset = await parseModel(fixture({ spaces }), 'triangle.fbx');
    assert.equal(asset.clips.length, 1);
    assert.equal(asset.clips[0].duration, 1);
    assert.equal(asset.clips[0].name, 'Slide');
    const sampler = poseSampler(asset.rig, asset.clips[0]);
    sampler.pose(0.5);
    assert.equal(asset.meshes[0].position.x, 1);
    sampler.pose(1);
    assert.equal(asset.meshes[0].position.x, 2);
    sampler.dispose();
    disposeModel(asset.actor);
  });
}

test('an unnamed FBX root animates inside the framing transform', async () => {
  const asset = await parseModel(fixture({ unnamed: true }), 'unnamed-root.fbx');
  assert.equal(asset.rig.name, '');
  const initial = asset.actor.position.clone();
  const sampler = poseSampler(asset.rig, asset.clips[0]);
  sampler.pose(1);
  assert.equal(asset.rig.position.x, 2);
  assert.deepEqual(asset.actor.position, initial);
  sampler.dispose();
  disposeModel(asset.actor);
});

for (const motion of [null, 'stationary']) {
  test(`mesh remains available when FBX has ${motion ? 'a stationary take' : 'no takes'}`, async () => {
    const asset = await parseModel(fixture({ motion }), 'triangle.fbx');
    assert.equal(asset.meshes.length, 1);
    assert.equal(asset.clips.length, 0);
    assert.equal(asset.rawClipCount, motion ? 1 : 0);
    assert.equal(asset.bounds.isEmpty(), false);
    assert.equal(asset.bounds.min.y, 0);
    assert.ok(asset.bounds.max.y > 2);
    disposeModel(asset.actor);
  });
}

test('motion-only, an empty rig and a corrupt file get distinct import errors', async () => {
  await assert.rejects(parseModel(fixture({ mesh: false }), 'motion.fbx'), /есть движение, но нет видимого меша.*With Skin/);
  await assert.rejects(parseModel(fixture({ mesh: false, motion: null }), 'rig.fbx'), /нет видимого меша и клипов/);
  await assert.rejects(parseModel(new TextEncoder().encode('not-an-fbx').buffer, 'broken.fbx'), /не распознан как FBX/);
});
