// ZIP 안의 파일을 꺼낸다.
//
// DART 에서 공시서류를 내려받으면 HTML 이 ZIP 으로 묶여 온다. 사용자가 직접 풀어서
// 올리게 하면 어떤 파일을 고르느냐에 따라 표지 조각만 올라오는 일이 생긴다.
// 그래서 ZIP 을 그대로 받아 안에서 본문을 골라 쓴다.
//
// 라이브러리를 더 붙이지 않으려고 필요한 만큼만 직접 읽는다.
// deflate 해제는 브라우저 기본 DecompressionStream 을 쓴다.

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50

/**
 * @returns {Promise<Array<{name:string, size:number, bytes:() => Promise<ArrayBuffer>}>>}
 */
export async function readZip(buf) {
  const view = new DataView(buf)
  const eocd = findEocd(view)
  if (eocd < 0) throw new Error('ZIP 형식이 아닙니다.')

  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true) // 중앙 디렉터리 시작 위치

  const entries = []
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.byteLength || view.getUint32(p, true) !== CEN_SIG) break
    const method = view.getUint16(p + 10, true)
    const compSize = view.getUint32(p + 20, true)
    const rawSize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff = view.getUint32(p + 42, true)
    const nameBytes = new Uint8Array(buf, p + 46, nameLen)
    const name = decodeName(nameBytes)

    entries.push({
      name,
      size: rawSize,
      bytes: () => inflateEntry(buf, view, localOff, method, compSize),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  // 디렉터리 항목은 버린다.
  return entries.filter((e) => !e.name.endsWith('/'))
}

function findEocd(view) {
  // 주석이 붙을 수 있어 뒤에서부터 훑는다(최대 64KB).
  const start = Math.max(0, view.byteLength - 65_557)
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  return -1
}

/** ZIP 파일명은 UTF-8 또는 CP949 다. 깨지면 CP949 로 다시 읽는다. */
function decodeName(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('�')) return utf8.normalize('NFC')
  try {
    return new TextDecoder('euc-kr').decode(bytes).normalize('NFC')
  } catch {
    return utf8
  }
}

async function inflateEntry(buf, view, localOff, method, compSize) {
  if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error('ZIP 항목이 손상되었습니다.')
  const nameLen = view.getUint16(localOff + 26, true)
  const extraLen = view.getUint16(localOff + 28, true)
  const start = localOff + 30 + nameLen + extraLen
  const body = buf.slice(start, start + compSize)
  if (method === 0) return body // 무압축
  if (method !== 8) throw new Error(`지원하지 않는 압축 방식입니다 (method ${method}).`)
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).arrayBuffer()
}

const PICKABLE = /\.(html?|xhtml|xml|pdf|xlsx?|xlsm|csv|tsv|txt)$/i

/**
 * ZIP 안에서 분석할 파일 하나를 고른다.
 * DART 묶음에는 본문 하나에 이미지·서식 파일이 딸려 온다. 가장 큰 문서를 본문으로 본다.
 */
export function pickMainEntry(entries) {
  const docs = entries.filter((e) => PICKABLE.test(e.name) && !/__MACOSX|\/\._/.test(e.name))
  if (!docs.length) return null
  const rank = (n) => (/\.(html?|xhtml|xml)$/i.test(n) ? 0 : /\.pdf$/i.test(n) ? 1 : 2)
  return [...docs].sort((a, b) => rank(a.name) - rank(b.name) || b.size - a.size)[0]
}
