// 외부 API 결과를 DB 에 두고 쓰는 탭들의 공통 뼈대.
//
// 탭을 열 때마다 상류를 부르지 않는다. 화면에 들어오면 DB 에 저장된 것만 읽고,
// 새로 받는 것은 사용자가 '받아오기' 를 눌렀을 때뿐이다.
//
// 그래야 하는 이유
//  - KIPRIS 무료 한도가 월 1,000회다. 특허 한 회사 조회에 상류를 여러 번 두드린다
//    (알체라는 433건을 30건씩 훑느라 15회). 탭을 몇 번 오가면 한도가 녹는다.
//  - 국민연금은 한 회사에 25회 안팎이 들고 응답도 10초 가까이 걸린다.
//  - DART 자본조달은 공시마다 원문을 한 번씩 받는다.
//
// 대신 언제 받은 값인지 항상 드러낸다 — 오래된 값을 최신인 줄 알고 보는 게
// 자동 갱신을 포기하는 것보다 위험하다.

import { useCallback, useEffect, useState } from 'react'

/**
 * @param {object}   o
 * @param {string}   o.key        회사 키. 바뀌면 다시 읽는다.
 * @param {Function} o.load       () => Promise<저장된 값|null>
 * @param {Function} o.fetch      () => Promise<새 값>
 * @param {Function} o.save       (값) => Promise<{warning?:string}>
 * @param {boolean}  [o.ready]    조회에 필요한 값이 다 준비됐는지
 */
export function useCachedRemote({ key, load, fetch: fetchRemote, save, ready = true }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState(null)

  // 화면에 들어오면 저장된 것만 읽는다. 여기서 상류를 부르지 않는다.
  useEffect(() => {
    if (!key) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    Promise.resolve(load(key))
      .then((cached) => alive && setData(cached || null))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [key, load])

  /** 사용자가 눌렀을 때만 상류를 부른다. */
  const fetchNow = useCallback(async () => {
    if (!ready || fetching) return
    setFetching(true)
    setError(null)
    try {
      const fresh = await fetchRemote((m) => setPhase(m))
      const saved = await save(key, fresh)
      setData({ ...fresh, fetchedAt: Date.now() })
      if (saved?.warning) setError(saved.warning)
    } catch (e) {
      setError(e.message)
    } finally {
      setFetching(false)
      setPhase('')
    }
  }, [ready, fetching, fetchRemote, save, key])

  return {
    data,
    fetchedAt: data?.fetchedAt ?? null,
    hasData: Boolean(data),
    stale: Boolean(data?.stale),
    loading,
    fetching,
    phase,
    error,
    fetchNow,
  }
}
