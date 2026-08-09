// DART 전체 기업코드(corpCode.xml)를 내려받아 검색용 인덱스로 굽는다.
//
//   node scripts/build-corp-index.mjs
//
// 결과: public/dart-corp-index.txt  ("고유번호,회사명,종목코드" 한 줄에 하나)
// 전체 12만 건 · 3.4MB 이지만 gzip 이 1.3MB 라 정적 호스팅으로 충분하다.
// DART_API_KEY 는 .env 또는 환경변수에서 읽는다. 빌드 시점에만 쓰이고 번들에 들어가지 않는다.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public/dart-corp-index.txt')

function apiKey() {
  if (process.env.DART_API_KEY) return process.env.DART_API_KEY
  const envFile = resolve(ROOT, '.env')
  if (existsSync(envFile)) {
    const m = /^DART_API_KEY\s*=\s*(.+)$/m.exec(readFileSync(envFile, 'utf-8'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return null
}

/** ZIP(단일 엔트리) 에서 첫 파일을 꺼낸다. corpCode.xml 응답은 항상 CORPCODE.xml 하나뿐이다. */
function unzipFirst(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP 형식이 아닙니다 (인증키 오류일 수 있습니다)')
  const method = buf.readUInt16LE(8)
  const nameLen = buf.readUInt16LE(26)
  const extraLen = buf.readUInt16LE(28)
  const start = 30 + nameLen + extraLen
  let compSize = buf.readUInt32LE(18)
  // 스트리밍 압축이면 로컬 헤더의 크기가 0 이다. 그 뒤 전부를 넘긴다(inflate 가 알아서 끊는다).
  if (!compSize) compSize = buf.length - start
  const body = buf.subarray(start, start + compSize)
  return method === 0 ? body : inflateRawSync(body)
}

const key = apiKey()
if (!key) {
  console.error('DART_API_KEY 가 없습니다. .env 에 DART_API_KEY=... 를 넣거나 환경변수로 넘겨주세요.')
  process.exit(1)
}

/**
 * corpCode.xml 내려받기.
 *
 * opendart 는 데이터센터 IP·빈 User-Agent 를 걸러 연결 자체를 끊는 일이 있다
 * (GitHub Actions 러너에서 10초 연결 타임아웃으로 배포가 통째로 실패했다).
 * 그래서 브라우저 같은 헤더를 붙이고 넉넉한 시간으로 몇 번 다시 시도한다.
 */
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  accept: 'application/zip,*/*',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

async function download(url, tries = 3) {
  let last = null
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      last = e
      console.warn(`  내려받기 실패 (${i}/${tries}): ${e?.message || e}`)
      if (i < tries) await new Promise((r) => setTimeout(r, i * 5000))
    }
  }
  throw last
}

console.log('corpCode.xml 내려받는 중…')
let zip
try {
  zip = await download(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`)
} catch (e) {
  // 색인은 '기업 검색' 에만 쓰인다. 이것 때문에 배포 전체를 막지 않는다 —
  // 업로드·분석·조회는 색인 없이도 그대로 동작한다.
  console.warn(`기업 검색 색인을 만들지 못했습니다: ${e?.message || e}`)
  console.warn(existsSync(OUT) ? '기존 색인을 그대로 둡니다.' : '이번 배포에서는 기업 검색만 비활성입니다.')
  process.exit(0)
}

// 인증 실패 시 ZIP 대신 XML 에러가 온다.
if (zip.subarray(0, 5).toString() === '<?xml') {
  throw new Error(`DART 응답: ${zip.toString('utf-8').slice(0, 300)}`)
}

const xml = unzipFirst(zip).toString('utf-8')
console.log(`XML ${(xml.length / 1e6).toFixed(1)}MB 해제 완료, 파싱 중…`)

const lines = []
const re = /<list>([\s\S]*?)<\/list>/g
const pick = (chunk, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(chunk)
  return m ? m[1].trim() : ''
}
let m
while ((m = re.exec(xml))) {
  const code = pick(m[1], 'corp_code')
  // 회사명에 쉼표가 든 법인이 있어 구분자를 깨뜨린다. 파싱은 앞 2개만 split 하도록 맞춰 뒀다.
  const name = pick(m[1], 'corp_name').replace(/[\r\n]+/g, ' ')
  const stock = pick(m[1], 'stock_code')
  if (code && name) lines.push(`${code},${stock},${name}`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, lines.join('\n'), 'utf-8')
console.log(`${OUT} 기록 완료 — ${lines.length.toLocaleString()}건, ${(Buffer.byteLength(lines.join('\n')) / 1e6).toFixed(2)}MB`)
