import React, { useEffect, useRef, useState } from 'react';

// Textareas normalize CRLF and use UTF-16 offsets. The ledger uses code points.
function sourceOffset(text, selectionOffset) {
  let displayed = 0;
  let original = 0;
  for (const token of text.match(/\r\n|[\s\S]/gu) || []) {
    if (displayed >= selectionOffset) break;
    displayed += token === '\r\n' ? 1 : token.length;
    original += Array.from(token).length;
  }
  return original;
}

export default function JudgmentReview({ evidenceId, api }) {
  const endpoint = '/evidence/' + encodeURIComponent(evidenceId) + '/judgment-review';
  const excerpt = useRef(null);
  const [review, setReview] = useState(null);
  const [decision, setDecision] = useState('approved');
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState('');
  const [span, setSpan] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let current = true;
    api(endpoint).then(data => {
      if (!current) return;
      setReview(data);
      setLabel(data.original.label);
      setSpan({ start: data.original.start, end: data.original.end, passage: data.original.passage });
    }).catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [endpoint, refresh]);

  function selectSpan() {
    const { selectionStart, selectionEnd } = excerpt.current;
    if (selectionStart === selectionEnd) {
      setError('Highlight the corrected passage in the excerpt first.');
      return;
    }
    const left = sourceOffset(review.context, selectionStart);
    const right = sourceOffset(review.context, selectionEnd);
    setSpan({
      start: review.context_start + left,
      end: review.context_start + right,
      passage: Array.from(review.context).slice(left, right).join('')
    });
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const saved = await api(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision, reason, previous_id: review.history[0]?.id ?? null,
          ...(decision === 'corrected' ? { start: span.start, end: span.end, label } : {})
        })
      });
      setReview({ ...review, history: [saved, ...review.history].slice(0, 50) });
      setReason('');
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="judgment-review" aria-label="Judgment mention review">
      <h3>Review judgment mention</h3>
      {error && <p role="alert">{error}</p>}
      {!review && !error && <p role="status">Loading source excerpt…</p>}
      {review && (
        <>
          <p>Latest decision: <strong>{review.history[0]?.decision ?? 'Pending review'}</strong></p>
          <label>Original source excerpt
            <textarea ref={excerpt} readOnly rows={5} value={review.context} />
          </label>
          <form onSubmit={submit}>
            <label>Decision
              <select value={decision} onChange={event => setDecision(event.target.value)}>
                <option value="approved">Approve original extraction</option>
                <option value="corrected">Correct the mention</option>
                <option value="rejected">Reject the mention</option>
              </select>
            </label>
            {decision === 'corrected' && (
              <>
                <label>Corrected label
                  <select value={label} onChange={event => setLabel(event.target.value)}>
                    {review.labels.map(item => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <button type="button" className="quiet" onClick={selectSpan}>Use highlighted source text</button>
                <blockquote>{span?.passage}</blockquote>
              </>
            )}
            <label>Reason
              <textarea value={reason} onChange={event => setReason(event.target.value)}
                minLength={3} maxLength={2000} required rows={3} />
            </label>
            <div className="case-actions">
              <button disabled={saving}>{saving ? 'Saving…' : 'Save review'}</button>
              <button type="button" className="quiet" disabled={saving} onClick={() => {
                setError('');
                setReview(null);
                setRefresh(value => value + 1);
              }}>Reload review</button>
            </div>
          </form>
          {review.history.length > 0 && (
            <details>
              <summary>Review history</summary>
              <ol>
                {review.history.map(item => (
                  <li key={item.id}>
                    <strong>{item.decision}</strong> · {item.actor} · <time>{item.at}</time>
                    <p>{item.reason}</p>
                    {item.mention && <p>{item.mention.label} · {item.mention.passage}</p>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
