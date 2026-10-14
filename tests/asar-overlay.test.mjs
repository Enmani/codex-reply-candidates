import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { createPackage, extractFile } from '@electron/asar';
import { writeAsarOverlay } from '../src/asar-overlay.mjs';

test('overlay preserves unmodified binary members and source archive while replacing UTF-8 text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-candidate-archive-'));
  try {
    const input = join(root, 'input');
    await mkdir(input);
    await mkdir(join(input, 'nested'));
    await writeFile(join(input, 'nested', 'code.js'), 'const text="old";');
    const binary = Buffer.from([0, 255, 3, 0, 10]);
    await writeFile(join(input, 'asset.bin'), binary);
    const originalArchive = join(root, 'original.asar');
    const patchedArchive = join(root, 'patched.asar');
    await createPackage(input, originalArchive);
    const original = await readFile(originalArchive);
    const replacement = 'const text="新的候选";';
    await writeAsarOverlay(originalArchive, patchedArchive, new Map([['nested/code.js', replacement]]));
    assert.equal(extractFile(patchedArchive, normalize('nested/code.js')).toString('utf8'), replacement);
    assert.deepEqual(extractFile(patchedArchive, 'asset.bin'), binary);
    assert.deepEqual(await readFile(originalArchive), original);
    await assert.rejects(writeAsarOverlay(originalArchive, originalArchive, new Map()), /unchanged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
