import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatCaseTime } from '../case-time';
import './place-evidence.css';

const PlaceMap = lazy(() => import('./PlaceMap'));
const relationship = {
  mention: 'Mentioned in document', address: 'Printed address',
  reported_presence: 'Reported presence', event_location: 'Reported event location',
};

function PlaceReview({ item, path, api, people, onSave, onSource }) {
  const [matches, setMatches] = useState(null);
  const [matchId, setMatchId] = useState('');
  const [personId, setPersonId] = useState(item.review?.person?.id || '');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endpoint = path + '/' + encodeURIComponent(item.id);

  async function find() {
    setReviewing(true);
    setBusy(true);
    setError('');
    try {
      const choices = await api(endpoint + '/matches');
      setMatches(choices);
      setMatchId(choices.some(option => option.id === item.review?.match?.id) ? item.review.match.id : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(status) {
    setBusy(true);
    setError('');
    try {
      const review = await api(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, match_id: matchId || null, person_id: personId || null }),
      });
      setReviewing(false);
      onSave(item.id, review);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const { place, locator, review } = item;
  return <article className="place-record" id={'place-' + item.id}>
    <div className="place-record-header">
      <div>
        <h3>{place.text}</h3>
        <p>{relationship[place.relation]}{place.subject ? ` · ${place.subject}` : ''}
          {item.event_time ? ` · ${formatCaseTime(item.event_time, item.time_basis)}` : ''}</p>
      </div>
      <span className="badge">{review?.status === 'confirmed' ? 'Mapped' : review?.status === 'unresolved' ? 'Unresolved' : 'Needs review'}</span>
    </div>
    {review?.match && <p>{review.match.name} · {review.match.geometry === 'area' ? 'Area reference' : 'Site reference'}
      {review.person ? ` · Linked case person: ${review.person.label}` : ''}</p>}
    <blockquote>{item.passage}</blockquote>
    <div className="place-actions">
      <Button variant="outline" size="sm" onClick={() => onSource(item.id, place.text)}>
        {locator.page ? `View source page ${locator.page}` : 'View source'}
      </Button>
      <Button size="sm" onClick={find} disabled={busy}>{review ? 'Review place' : 'Find place matches'}</Button>
      {item.event_time && review?.match && <a href="#recorded-event-list">View in timeline</a>}
    </div>
    {reviewing && <div className="place-match-review">
      {busy && !matches && <p role="status">Looking up places locally…</p>}
      {matches?.length === 0 && <p>No matching places in the local index.</p>}
      {matches?.length > 0 && <label>Place match
        <select value={matchId} onChange={event => setMatchId(event.target.value)} disabled={busy}>
          <option value="">Choose a match</option>
          {matches.map(choice => <option key={choice.id} value={choice.id}>
            {choice.name} · {choice.level} · {choice.provider}
          </option>)}
        </select>
      </label>}
      {place.relation === 'reported_presence' && people.length > 0 && <label>Link to a person already in this case (optional)
        <select value={personId} onChange={event => setPersonId(event.target.value)}>
          <option value="">Keep person as written in source</option>
          {people.map(person => <option key={person.id} value={person.id}>
            {person.label}{person.attrs?.authoritative_id ? ` · ${person.attrs.authoritative_id}` : ` · ${person.id.slice(-8)}`}
          </option>)}
        </select>
      </label>}
      <div className="place-actions">
        <Button size="sm" disabled={!matchId || busy} onClick={() => save('confirmed')}>Confirm place</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => save('unresolved')}>Leave unresolved</Button>
      </div>
    </div>}
    {error && <p role="alert" className="error">{error}</p>}
  </article>;
}

export default function DocumentPlaces({ caseId, api, onSource, onChanged, people, darkMode }) {
  const [places, setPlaces] = useState(null);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(15);
  const path = '/places/' + encodeURIComponent(caseId);
  useEffect(() => {
    if (!caseId) return;
    const abort = new AbortController();
    api(path, { signal: abort.signal }).then(data => {
      if (!abort.signal.aborted) setPlaces(data);
    }).catch(err => { if (!abort.signal.aborted) setError(err.message); });
    return () => abort.abort();
  }, [api, caseId, path]);

  const confirmed = useMemo(() => (places || []).filter(item => item.review?.status === 'confirmed'), [places]);

  function saved(id, review) {
    setPlaces(current => current.map(item => item.id === id ? { ...item, review } : item));
    onChanged();
  }

  return <section className="panel document-places">
    <div className="panel-head"><h2>Places from documents</h2>{places && <span>{confirmed.length} mapped · {places.length} extracted</span>}</div>
    <p>Review place names found in FIRs, court documents, and pasted text. Map markers keep the source’s wording and level of precision.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!places && !error && <p role="status">Loading place evidence…</p>}
    {places?.length === 0 && <p className="empty">Upload a document with a place mention to start mapping this case.</p>}
    {confirmed.length > 0 && <Suspense fallback={<p role="status">Loading map…</p>}>
      <PlaceMap entries={confirmed} onSource={onSource} darkMode={darkMode} />
    </Suspense>}
    {places?.slice(0, limit).map(item => <PlaceReview key={item.id} item={item} path={path} api={api} people={people}
      onSave={saved} onSource={onSource} />)}
    {places?.length > limit && <Button variant="outline" size="sm" onClick={() => setLimit(limit + 15)}>Show more places</Button>}
  </section>;
}
