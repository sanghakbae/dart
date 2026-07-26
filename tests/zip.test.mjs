// DART 공시원문(document.xml) 은 ZIP 으로 온다. 그 해제 로직 회귀 테스트.
//
// 실제 DART 응답은 범용 플래그 bit 3(데이터 서술자) 로 압축되어 로컬 헤더의
// 압축·원본 크기가 둘 다 0이다. 예전 구현은 그때 "남은 바이트 전부" 로 폴백해
// 중앙 디렉터리까지 압축 스트림에 넣었고, 브라우저는
// "Trailing junk found after the end of the compressed stream" 으로 죽었다.
// 아래 첫 테스트가 정확히 그 형태를 재현한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync, crc32 } from 'node:zlib'
import { unzipMain } from '../server/dart-handler.mjs'

/**
 * 최소 ZIP 작성기.
 * @param {{name: string, body: Buffer, store?: boolean, descriptor?: boolean}[]} files
 */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const data = f.store ? f.body : deflateRawSync(f.body)
    const crc = crc32(f.body)
    // 데이터 서술자 방식이면 로컬 헤더에는 크기를 0으로 적고 뒤에 서술자를 붙인다.
    const streamed = f.descriptor !== false

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(streamed ? 0x08 : 0, 6)
    lh.writeUInt16LE(f.store ? 0 : 8, 8)
    lh.writeUInt32LE(streamed ? 0 : crc, 14)
    lh.writeUInt32LE(streamed ? 0 : data.length, 18)
    lh.writeUInt32LE(streamed ? 0 : f.body.length, 22)
    lh.writeUInt16LE(name.length, 26)

    const parts = [lh, name, data]
    if (streamed) {
      const dd = Buffer.alloc(16)
      dd.writeUInt32LE(0x08074b50, 0)
      dd.writeUInt32LE(crc, 4)
      dd.writeUInt32LE(data.length, 8)
      dd.writeUInt32LE(f.body.length, 12)
      parts.push(dd)
    }
    const local = Buffer.concat(parts)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(streamed ? 0x08 : 0, 8)
    cd.writeUInt16LE(f.store ? 0 : 8, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(f.body.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)

    locals.push(local)
    centrals.push(Buffer.concat([cd, name]))
    offset += local.length
  }

  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  const zip = Buffer.concat([...locals, cdBuf, eocd])
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)
}

const decode = (buf) => new TextDecoder('utf-8').decode(buf)
const XML = '<?xml version="1.0" encoding="utf-8"?><DOCUMENT>감사보고서 본문 ' + '가'.repeat(500) + '</DOCUMENT>'

test('데이터 서술자 방식(로컬 헤더 크기 0) ZIP 을 해제한다', async () => {
  const zip = makeZip([{ name: '20260402003876_00760.xml', body: Buffer.from(XML, 'utf8') }])
  assert.equal(decode(await unzipMain(zip)), XML)
})

test('크기가 로컬 헤더에 적힌 옛 형식도 해제한다', async () => {
  const zip = makeZip([{ name: 'a.xml', body: Buffer.from(XML, 'utf8'), descriptor: false }])
  assert.equal(decode(await unzipMain(zip)), XML)
})

test('무압축(store) 엔트리도 해제한다', async () => {
  const zip = makeZip([{ name: 'a.xml', body: Buffer.from(XML, 'utf8'), store: true }])
  assert.equal(decode(await unzipMain(zip)), XML)
})

test('엔트리가 여러 개면 가장 큰 것을 본문으로 고른다', async () => {
  // DART 는 서식·첨부를 같은 ZIP 에 담아 보낼 수 있다. 첫 엔트리가 본문이 아닐 수 있으므로
  // 순서가 아니라 크기로 고르는지 확인한다(작은 것을 먼저 넣었다).
  const zip = makeZip([
    { name: 'form.xml', body: Buffer.from('<FORM>서식</FORM>', 'utf8') },
    { name: 'body.xml', body: Buffer.from(XML, 'utf8') },
  ])
  assert.equal(decode(await unzipMain(zip)), XML)
})

test('ZIP 이 아닌 DART 오류 XML 은 message 를 담아 던진다', async () => {
  const err = '<result><status>013</status><message>조회된 데이타가 없습니다.</message></result>'
  const buf = new TextEncoder().encode(err).buffer
  await assert.rejects(() => unzipMain(buf), /조회된 데이타가 없습니다.*013/)
})

test('ZIP 도 아니고 DART 오류 형식도 아니면 앞부분을 보여준다', async () => {
  const buf = new TextEncoder().encode('<html><body>Gateway Timeout</body></html>').buffer
  await assert.rejects(() => unzipMain(buf), /ZIP 이 아닙니다.*Gateway Timeout/)
})
