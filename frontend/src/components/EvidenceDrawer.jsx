import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCaseTime } from '../case-time';
import JudgmentReview from './JudgmentReview';
import SourcePage from './SourcePage';
import StatementRowReview from './StatementRowReview';
import './evidence-drawer.css';

function SourceDetails({ evidence, api, token, downloadOriginal }) {
  const { time_basis: basis, extraction_method: method } = evidence;
  const locator = evidence.source_locator ?? {};
  const statement = method === 'bank-statement-row';
  const documentPreview = Boolean(locator.text_method);
  const location = evidence.dataset_id === 'synthetic-location';
  const type = statement ? 'Statement row' : evidence.dataset_id === 'court-judgment' ? 'Legal mention' : 'Source evidence';
  const sourceCoordinates = [
    locator.page != null && `Page ${locator.page}`,
    locator.sheet && `Sheet ${locator.sheet}`,
    locator.table != null && `Table ${locator.table}`,
    locator.row != null && `Row ${locator.row}`,
    locator.record_ordinal != null && `Record ${locator.record_ordinal}`,
    locator.line_start != null && (locator.line_end != null && locator.line_end !== locator.line_start
      ? `Lines ${locator.line_start}–${locator.line_end}` : `Line ${locator.line_start}`),
    locator.char_start != null && locator.char_end != null && `Characters ${locator.char_start}–${locator.char_end}`,
  ].filter(Boolean);
  const downloadLabel = statement ? 'Download statement' : documentPreview ? 'Download original document' : 'Download original source';

  return <section className="evidence-source" aria-label="Selected source">
    <div className="evidence-tags">
      <span className="tag">{type}</span>
      {evidence.synthetic && <span className="tag">Synthetic</span>}
    </div>
    <h3>{evidence.source}</h3>
    {sourceCoordinates.length > 0 && <p className="evidence-secondary">{sourceCoordinates.join(' · ')}</p>}
    <dl className="evidence-facts">
      <div><dt>Event time</dt><dd>
        {formatCaseTime(evidence.event_time, basis)}{basis === 'date_only' && <small> Date only</small>}
      </dd></div>
      <div><dt>Imported</dt><dd>{formatCaseTime(evidence.ingestion_time)}</dd></div>
      {documentPreview && <div><dt>Text extraction</dt><dd>{locator.text_method === 'pdf-text' ? 'Embedded PDF text' : 'Local OCR'}</dd></div>}
      {evidence.location_observation && <div><dt>Reported accuracy radius</dt>
        <dd>{evidence.location_observation.accuracy_m} m</dd></div>}
    </dl>
    {!statement && evidence.passage && <div className="evidence-passage">
      <h4>Source excerpt</h4>
      <blockquote>{evidence.passage}</blockquote>
    </div>}
    {(statement || location || documentPreview) && <div className="evidence-source-actions">
      <Button size="sm" variant="outline" onClick={() => downloadOriginal(evidence)}>{downloadLabel}</Button>
      {documentPreview && <SourcePage evidence={evidence} token={token} />}
    </div>}
    {statement && <StatementRowReview evidence={evidence} api={api} />}
    <details className="evidence-technical">
      <summary>Extraction details</summary>
      <p>{method} · v{evidence.extraction_version}</p>
      {basis && <p>Source time basis · {basis.replaceAll('_', ' ')}</p>}
      <pre>{JSON.stringify(locator, null, 2)}</pre>
    </details>
  </section>;
}

export default function EvidenceDrawer({ selected, ev, closeRef, onClose, onEvidenceLoad, onReview, api, token, downloadOriginal }) {
  const sourceIds = selected.evidence_ids || [];
  const context = selected.role || selected.reason || selected.type;
  return <aside className="drawer evidence-drawer" aria-label="Evidence detail">
    <header className="evidence-drawer-header">
      <div>
        <p className="eyebrow">Evidence detail</p>
        <h2>{selected.title && selected.name ? `${selected.title} · ${selected.name}`
          : selected.label || selected.left_name || selected.name || selected.title || 'Finding for review'}</h2>
      </div>
      <Button type="button" size="icon" variant="ghost" ref={closeRef} onClick={onClose} aria-label="Close evidence panel">
        <X aria-hidden="true" />
      </Button>
    </header>
    <div className="evidence-drawer-content">
      {context && <p className="evidence-secondary">{context}</p>}
      {sourceIds.length > 0 && <section className="evidence-references" aria-label="Source references">
        <h3>Source references <span>{sourceIds.length}</span></h3>
        <div>
          {sourceIds.map((id, index) => <Button key={id} type="button" size="sm"
            variant={ev?.id === id ? 'secondary' : 'outline'} aria-pressed={ev?.id === id}
            title={id} onClick={() => onEvidenceLoad(id)}>Source {index + 1}</Button>)}
        </div>
      </section>}
      {ev && <SourceDetails key={ev.id} evidence={ev} api={api} token={token} downloadOriginal={downloadOriginal} />}
      {ev?.dataset_id === 'court-judgment' && ev.extraction_method === 'en_legal_ner_sm' &&
        <JudgmentReview key={ev.id} evidenceId={ev.id} api={api} />}
      {selected.behavior_score != null && <p>
        Model score · {selected.behavior_score.toFixed(4)} <small>{selected.score_scope}</small>
      </p>}
      {selected.structural_context && <details className="evidence-technical">
        <summary>Structural context</summary>
        <pre>{JSON.stringify(selected.structural_context, null, 2)}</pre>
      </details>}
      {selected.assertions && <details className="evidence-technical">
        <summary>{selected.assertions.length} preserved assertions</summary>
        <pre>{JSON.stringify(selected.assertions, null, 2)}</pre>
      </details>}
      {selected.category && <section className="evidence-references">
        <h3>Record your review</h3>
        <div>
          <Button size="sm" onClick={() => onReview(selected, 'relevant')}>Relevant</Button>
          <Button size="sm" variant="outline" onClick={() => onReview(selected, 'not_relevant')}>Not relevant</Button>
          <Button size="sm" variant="outline" onClick={() => onReview(selected, 'insufficient_evidence')}>Insufficient evidence</Button>
        </div>
      </section>}
    </div>
  </aside>;
}
