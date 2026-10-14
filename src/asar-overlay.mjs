import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename } from 'node:fs/promises';
import { dirname, resolve, normalize } from 'node:path';
import { pipeline, finished } from 'node:stream/promises';
import { once } from 'node:events';
import { getRawHeader, extractFile, uncache } from '@electron/asar';

// These two small serializers belong to the pinned ASAR dependency. Reusing
// them avoids maintaining a second archive/pickle implementation.
const libraryUrl = import.meta.resolve('@electron/asar');
const { Pickle } = await import(new URL('./pickle.js', libraryUrl));
const { getFileIntegrityFromBuffer } = await import(new URL('./integrity.js', libraryUrl));

function entryAt(header, filename) {
  let entry = header;
  for (const part of filename.split('/')) entry = entry?.files?.[part];
  if (!entry || entry.files || entry.link || entry.unpacked) {
    throw new Error(`Overlay target must be a packed file: ${filename}`);
  }
  return entry;
}

/** Keep the original archive payload and append only the modified members. */
export async function writeAsarOverlay(sourcePath, destinationPath, replacements) {
  if (resolve(sourcePath) === resolve(destinationPath)) throw new Error('Source archive must remain unchanged');
  const { header: originalHeader, headerSize } = getRawHeader(sourcePath);
  const header = structuredClone(originalHeader);
  const sourceSize = (await stat(sourcePath)).size;
  const sourceDataStart = 8 + headerSize;
  let nextOffset = sourceSize - sourceDataStart;
  const buffers = [];
  for (const [filename, content] of replacements) {
    const entry = entryAt(header, filename);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    entry.offset = String(nextOffset);
    entry.size = buffer.length;
    // Generate the new member's packaging metadata. Existing digests are
    // neither recomputed nor compared; this is not a hash verification step.
    entry.integrity = getFileIntegrityFromBuffer(buffer);
    nextOffset += buffer.length;
    buffers.push(buffer);
  }
  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(JSON.stringify(header));
  const serializedHeader = headerPickle.toBuffer();
  const sizePickle = Pickle.createEmpty();
  sizePickle.writeUInt32(serializedHeader.length);
  await mkdir(dirname(destinationPath), { recursive: true });
  const temporaryPath = destinationPath + '.building';
  const output = createWriteStream(temporaryPath);
  output.write(sizePickle.toBuffer());
  output.write(serializedHeader);
  try {
    await pipeline(createReadStream(sourcePath, { start: sourceDataStart }), output, { end: false });
    for (const buffer of buffers) if (!output.write(buffer)) await once(output, 'drain');
    output.end();
    await finished(output);
    uncache(temporaryPath);
    for (const [filename, content] of replacements) {
      const expected = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
      if (!extractFile(temporaryPath, normalize(filename)).equals(expected)) {
        throw new Error(`Written source differs from replacement: ${filename}`);
      }
    }
    await rename(temporaryPath, destinationPath);
    uncache(destinationPath);
  } catch (error) {
    output.destroy();
    throw error;
  }
  return { sourceDataBytes: sourceSize - sourceDataStart, modifiedMembers: replacements.size };
}
