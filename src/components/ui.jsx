import { abbrev, full, accounting, signedPct, toParagraphs } from '../lib/format'

/**
 * 보고서 본문 표시. PDF의 종이 줄바꿈을 그대로 두면 화면 폭을 못 채우므로
 * 문단 단위로 다시 흘려 브라우저가 행 끝에서 개행하게 한다.
 */
export function Prose({ text, muted, empty = '내용 없음' }) {
  const paras = toParagraphs(text)
  if (!paras.length) return <div className={`prose${muted ? ' muted' : ''}`}>{empty}</div>
  return (
    <div className={`prose${muted ? ' muted' : ''}`}>
      {paras.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  )
}

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
export function Tile({ label, value, unit, suffix, delta, deltaLabel, hint, tone }) {
  const dir = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  return (
    <div
      className={`tile${dir === 'flat' ? '' : ` tile-${dir}`}`}
      title={hint || (typeof value === 'number' ? full(value) : undefined)}
    >
      <div className="k">
        {label}
        {tone && <i className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: toneColor(tone) }} />}
      </div>
      <div className="v">
        {typeof value === 'number' ? abbrev(value) : value ?? '-'}
        {/* 명·건 같은 짧은 단위는 아랫줄이 아니라 숫자에 붙어야 한 덩어리로 읽힌다. */}
        {suffix && <span className="vs">{suffix}</span>}
      </div>
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

/** action 은 <p> 밖에 둔다 — 버튼을 children 으로 넘기면 <p> 안에 <div> 가 들어가 무효 마크업이 된다. */
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-act">{action}</div>}
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
                {/* 숫자가 없는 줄(기간 헤더·단위 표기·'자산' 같은 구분 줄)은 값 칸을 '-' 로
                    채우지 않고 한 줄 전체를 쓰는 소제목으로 표시한다. */}
                {r.span ? (
                  <td className="lbl span" colSpan={columns.length + 1}>{r.label}</td>
                ) : (
                <>
                <td className={`lbl${r.level >= 2 ? ' ind2' : r.level === 1 ? ' ind1' : ''}`}>
                  {r.label}
                  {r.derived && <span className="chip" style={{ marginLeft: 6 }}>계산값</span>}
                </td>
                {columns.map((c) => {
                  const v = r.values?.[c.key]
                  const isNum = typeof v === 'number'
                  return (
                    <td key={c.key} data-label={c.label} className={isNum && v < 0 ? 'neg' : ''} title={isNum ? full(v) : undefined}>
                      {c.render ? c.render(v, r) : isNum ? accounting(v) : v ?? '-'}
                    </td>
                  )
                })}
                </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="tnote">{note}</div>}
    </>
  )
}

/**
 * 주석 본문. 문단은 다시 흘려 쓰고, 원문의 표는 표로 되살린다.
 * (표를 문단으로 이어붙이면 "종업원급여 6,661,227,265 7,306,901,198 주식보상비용 …" 처럼 읽을 수 없다)
 */
export function NoteBody({ content, body, muted }) {
  const blocks = Array.isArray(content) && content.length ? content : null
  if (!blocks) return <Prose text={body} muted={muted} empty="본문 없음" />

  return (
    <div className="notebody">
      {blocks.map((b, i) =>
        b.type === 'toc' ? (
          // 목차는 "제목 ....... 쪽" 이라 문단으로 흘리면 점선만 남는다. 두 칸으로 정렬한다.
          <ul className="toc" key={i}>
            {b.rows.map((r, ri) => (
              <li key={ri}>
                <span className="toc-title">{r.title}</span>
                <span className="toc-dots" aria-hidden="true" />
                <span className="toc-page">{r.page}</span>
              </li>
            ))}
          </ul>
        ) : b.type === 'table' ? (
          <div className="tscroll" key={i}>
            <table className="fin note">
              {b.header && (
                <thead>
                  <tr>
                    {b.header.map((h, j) => (
                      <th key={j} className={j === 0 ? 'lbl' : undefined} scope="col">{h}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => {
                      const n = ci === 0 ? null : parseAmountish(cell)
                      // 주석 표에는 숫자가 아닌 설명 칸이 섞여 있다. 그것까지 우측정렬하면
                      // 읽는 순서가 끊기므로 글자 칸은 좌측정렬로 되돌린다.
                      const isText = ci > 0 && n == null && /[가-힣A-Za-z]/.test(cell || '')
                      return (
                        <td
                          key={ci}
                          data-label={b.header?.[ci] || ''}
                          className={ci === 0 ? 'lbl' : n != null && n < 0 ? 'neg' : isText ? 'txt' : undefined}
                        >
                          {cell || (ci === 0 ? '' : '-')}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Prose key={i} text={b.text} muted={muted} empty="" />
        )
      )}
    </div>
  )
}

function parseAmountish(s) {
  if (typeof s !== 'string') return null
  if (/^\(.*\)$/.test(s.trim())) return -1
  return null
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
