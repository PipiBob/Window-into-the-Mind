import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sha256,sha256Fallback} from '../web/sha256.mjs';
for(const input of [Buffer.alloc(0),Buffer.from('abc'),...([55,56,63,64,65,1000,1000000].map(n=>randomBytes(n))),readFileSync(new URL('../demo/programming/source.pdf',import.meta.url))]){
  const buffer=input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength);
  const expected=createHash('sha256').update(input).digest('hex');
  assert.equal(sha256Fallback(buffer),expected);
  assert.equal(await sha256(buffer),expected);
}
console.log('SHA-256 native/fallback: vectors, padding boundaries, random data and demo PDF passed');
