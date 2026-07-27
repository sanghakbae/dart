import { useEffect, useMemo, useState } from 'react'
import { listUsers } from '../lib/usage'
import { Card, Tile, Empty, Callout, Badge } from './ui'
import { dateTimeText } from '../lib/format'

/**
 * 관리자 전용 이용 현황. 보기만 하는 화면이다 — 여기서는 아무것도 지우거나 고치지 않는다.
 * users 컬렉션은 규칙상 관리자만 목록 조회가 되므로, 실패하면 그대로 사유를 보여준다.
 */
export default function AdminPage({ companies, onBack, onShare, sharingKey }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    listUsers()
      .then((list) => alive && setUsers(list))
      .catch((e) =>
        alive &&
        setError(
          e?.code === 'permission-denied'
            ? '이용 현황을 읽을 권한이 없습니다. 관리자 계정으로 로그인했는지, firestore.rules 가 배포됐는지 확인해 주세요.'
            : `이용 현황을 불러오지 못했습니다: ${e.message}`
        )
      )
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const stats = useMemo(() => {
    const now = Date.now()
    const DAY = 86_400_000
    const active7 = users.filter((u) => now - (u.lastSeenAt || 0) < 7 * DAY).length
    const active30 = users.filter((u) => now - (u.lastSeenAt || 0) < 30 * DAY).length
    const logins = users.reduce((a, u) => a + (u.loginCount || 0), 0)
    const uploads = users.reduce((a, u) => a + (u.uploadCount || 0), 0)
    const reports = companies.reduce((a, c) => a + (c.reportCount || 0), 0)
    return { total: users.length, active7, active30, logins, uploads, reports }
  }, [users, companies])

  return (
    <div className="stack-lg">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-sm btn-ghost" type="button" onClick={onBack}>
          ‹ 분석 화면
        </button>
        <strong style={{ fontSize: 18 }}>이용 현황</strong>
        <Badge tone="info">관리자</Badge>
      </div>

      {error && <Callout tone="warn">{error}</Callout>}

      <div className="grid grid-tiles">
        <Tile label="가입 사용자" value={stats.total} suffix="명" />
        <Tile label="최근 7일 활동" value={stats.active7} suffix="명" />
        <Tile label="최근 30일 활동" value={stats.active30} suffix="명" />
        <Tile label="누적 로그인" value={stats.logins} suffix="회" />
        <Tile label="누적 업로드" value={stats.uploads} suffix="건" />
        <Tile label="저장된 보고서" value={stats.reports} suffix="건" />
      </div>

      <Card title="사용자" sub={loading ? '불러오는 중…' : `${users.length}명 · 최근 접속순`} tight>
        {loading ? (
          <div className="card-body"><Empty title="이용 현황을 불러오는 중입니다…" /></div>
        ) : !users.length ? (
          <div className="card-body">
            <Empty title="기록된 사용자가 없습니다">
              사용자가 구글 로그인을 한 번 하면 여기에 나타납니다.
            </Empty>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>사용자</th>
                  <th>이메일</th>
                  <th className="num">로그인</th>
                  <th className="num">업로드</th>
                  <th>최초 접속</th>
                  <th>최근 접속</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid}>
                    <td>{u.name || '(이름 없음)'}</td>
                    <td style={{ color: 'var(--text-2)' }}>{u.email || '-'}</td>
                    <td className="num">{u.loginCount ?? 0}</td>
                    <td className="num">{u.uploadCount ?? 0}</td>
                    <td style={{ color: 'var(--text-3)' }}>{u.firstSeenAt ? dateTimeText(u.firstSeenAt) : '-'}</td>
                    <td style={{ color: 'var(--text-3)' }}>{u.lastSeenAt ? dateTimeText(u.lastSeenAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="공통 노출 지정"
        sub={`${companies.length}개 회사 · 공개 ${companies.filter((c) => c.shared).length}개`}
        tight
      >
        {!companies.length ? (
          <div className="card-body"><Empty title="저장된 회사가 없습니다" /></div>
        ) : (
          <>
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <Callout>
                <strong>공통 노출</strong>을 켜면 로그인한 <strong>모든 계정</strong>의 목록에 그 회사가 나타납니다.
                끄면 올린 본인과 관리자에게만 보입니다.
              </Callout>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>회사</th>
                    <th>공통 노출</th>
                    <th className="num">보고서</th>
                    <th>연도</th>
                    <th>올린 계정</th>
                    <th>최근 업로드</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.key}>
                      <td>{c.name}</td>
                      <td>
                        <button
                          type="button"
                          className={`btn btn-sm${c.shared ? ' btn-primary' : ''}`}
                          onClick={() => onShare?.(c, !c.shared)}
                          disabled={sharingKey === c.key}
                        >
                          {sharingKey === c.key ? '변경 중…' : c.shared ? '공개 중' : '비공개'}
                        </button>
                      </td>
                      <td className="num">{c.reportCount}</td>
                      <td style={{ color: 'var(--text-2)' }}>{c.years.join(' · ') || '-'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{c.ownerEmail || '(기록 없음)'}</td>
                      <td style={{ color: 'var(--text-3)' }}>{c.uploadedAt ? dateTimeText(c.uploadedAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
