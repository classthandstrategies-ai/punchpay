// Upload validation regression tests: magic bytes, full decode, pixel budget, metadata stripping.
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { sanitizeImage, sniff } from "../lib/image.ts";

const jpegWithExif = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#c9c2b4" } })
  .jpeg().withExif({ IFD0: { Artist: "Homeowner Name", Copyright: "123 Private Street" } }).toBuffer();

test("magic bytes decide the type; a mismatched declared type is refused", async () => {
  const jpg = await jpegWithExif();
  assert.equal(sniff(jpg.subarray(0, 12)), "image/jpeg");
  await assert.rejects(sanitizeImage(jpg, "image/png"), /do not match/);
  await assert.rejects(sanitizeImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), /Only real JPG/);
});

test("a file that only starts like an image (polyglot / truncated) is refused", async () => {
  const header = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
  const polyglot = new Uint8Array([...header, ...new TextEncoder().encode("<?php system($_GET['x']); ?>")]);
  await assert.rejects(sanitizeImage(polyglot), /could not be decoded/);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#fff" } }).png().toBuffer();
  await assert.rejects(sanitizeImage(png.subarray(0, png.length - 40)), /could not be decoded/);
});

test("EXIF metadata (names, addresses, GPS) is stripped from what is stored", async () => {
  const input = await jpegWithExif();
  assert.ok((await sharp(input).metadata()).exif, "fixture has EXIF");
  const out = await sanitizeImage(input, "image/jpeg");
  const meta = await sharp(out.bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.ok(!out.bytes.includes(Buffer.from("Private Street")));
  assert.equal(out.type, "image/jpeg"); assert.equal(out.width, 64);
});

test("decompression bombs over the pixel budget are refused", async () => {
  const huge = await sharp({ create: { width: 9000, height: 9000, channels: 3, background: "#000" } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(huge.length < 4 * 1024 * 1024, "bomb is small on disk");
  await assert.rejects(sanitizeImage(huge), /could not be decoded/);
});

test("empty and oversized uploads are refused", async () => {
  await assert.rejects(sanitizeImage(new Uint8Array()), /between 1 byte and 4 MB/);
  await assert.rejects(sanitizeImage(new Uint8Array(4 * 1024 * 1024 + 1)), /between 1 byte and 4 MB/);
});
