// 외부 API 상태. 화면 상단에 띄운다.
//
// 키가 있어도 조용히 실패하는 일이 잦아서(만료·미승인·파라미터 표기 변경)
// 프록시가 상류를 실제로 한 번 불러 본 결과를 받아 온다.

import { useEffect, useState } from 'react'
import { proxyUrl, hasProxy } from './proxyBase.js'

const REFRESH_MS = 5 * 60 * 1000

export function fetchHealth() {
  return fetch(proxyUrl('/api/health')).then(async (r) => {
    const body = await r.json().catch(() => null)
    if (!r.ok || !body) throw new Error(`상태를 확인하지 못했습니다 (${r.status})`)
    return body
  })
}

/** @returns {{health:object|null, error:string|null, loading:boolean, reload:()=>void}} */
export function useHealth() {
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(hasProxy)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!hasProxy) {
      setLoading(false)
      setError('프록시 주소가 설정되지 않았습니다 (VITE_PROXY_BASE)')
      return
    }
    let alive = true
    setLoading(true)
    fetchHealth()
      .then((h) => alive && (setHealth(h), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [tick])

  // 주기적으로 다시 본다. 키 만료는 쓰는 도중에도 일어난다.
  useEffect(() => {
    if (!hasProxy) return
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  return { health, error, loading, reload: () => setTick((n) => n + 1) }
}
