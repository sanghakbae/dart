import { abbrev, full, accounting, signedPct } from '../lib/format'

export function Card({ title, sub, right, children, tight, id }) {
  return (
    <section className="card" id={id}>
      {(title || right) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {sub && <span className="sub">{sub}</span>}
          {right && <div className="spacer">{right}</div>}
        </header>
      )}
      <div className={`card-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  )
}

export function Badge({ tone = 'muted', children, dot }) {
  const cls = { good: 'badge-good', warn: 'badge-warn', critical: 'badge-critical', info: 'badge-info', muted: 'badge-muted' }[tone] || ''
  return (
    <span className={`badge ${cls}`}>
      {dot && <i className="dot" />}
      {children}
    </span>
  )
}

/** 스탯 타일. 큰 숫자는 축약, 전체 자릿수는 title 과 표에서 확인 가능하게 둔다. */
export function Tile({ label, value, unit, delta, deltaLabel, hint, tone }) {
  const dir = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  return (
    <div className="tile" title={hint || (typeof value === 'number' ? full(value) : undefined)}>
      <div className="k">
        {label}
        {tone && <i className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: toneColor(tone) }} />}
      </div>
      <div className="v">{typeof value === 'number' ? abbrev(value) : value ?? '-'}</div>
      {unit && <div className="u">{unit}</div>}
      {delta != null && (
        <div className={`d ${dir}`}>
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'} {signedPct(delta)}
          {deltaLabel ? ` ${deltaLabel}` : ''}
        </div>
      )}
    </div>
  )
}

function toneColor(t) {
  return { good: 'var(--good)', warn: 'var(--warning)', bad: 'var(--critical)', info: 'var(--series-1)' }[t] || 'var(--text-3)'
}

export function Insight({ tone, children }) {
  const mark = { good: '✓', warn: '!', bad: '✕', info: 'i' }[tone] || 'i'
  return (
    <div className={`insight ${tone || 'info'}`}>
      <span className="ic" aria-hidden="true">{mark}</span>
      <span>{children}</span>
    </div>
  )
}

export function Callout({ tone, children }) {
  return (
    <div className={`callout ${tone || ''}`}>
      <span aria-hidden="true">{tone === 'bad' ? '✕' : tone === 'warn' ? '!' : 'i'}</span>
      <span>{children}</span>
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Seg({ options, value, onChange, ariaLabel }) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} type="button" aria-pressed={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 재무제표 표. columns = [{key,label,align}] rows = [{label, level, values:{}, isSum}]
 * 모바일에서도 첫 열이 고정된 상태로 가로 스크롤해 모든 열을 볼 수 있다.
 */
export function FinTable({ columns, rows, note, minWidth }) {
  return (
    <>
      <div className="tscroll">
        <table className="fin" style={minWidth ? { minWidth } : undefined}>
          <thead>
            <tr>
              <th className="lbl" scope="col">계정과목</th>
              {columns.map((c) => (
                <th key={c.key} scope="col">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} className={`${r.level === 0 ? 'lv0' : ''} ${r.isSum ? 'sum' : ''}`.trim()}>
                <td className={`lbl${r.level >= 2 ? ' ind2' : r.level === 1 ? ' ind1' : ''}`}>
                  {r.label}
                  {r.derived && <span className="chip" style={{ marginLeft: 6 }}>계산값</span>}
                </td>
                {columns.map((c) => {
                  const v = r.values?.[c.key]
                  const isNum = typeof v === 'number'
                  return (
                    <td key={c.key} className={isNum && v < 0 ? 'neg' : ''} title={isNum ? full(v) : undefined}>
                      {c.render ? c.render(v, r) : isNum ? accounting(v) : v ?? '-'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="tnote">{note}</div>}
    </>
  )
}

export function Disclose({ summary, count, children, open }) {
  return (
    <details className="disclose" open={open}>
      <summary>
        <span>{summary}</span>
        {count != null && <span className="cnt">{count}</span>}
      </summary>
      <div className="dbody">{children}</div>
    </details>
  )
}

export function KV({ items }) {
  return (
    <dl className="kv">
      {items.filter((i) => i).map((i) => (
        <div key={i.k} style={{ display: 'contents' }}>
          <dt>{i.k}</dt>
          <dd>{i.v ?? '-'}</dd>
        </div>
      ))}
    </dl>
  )
}
