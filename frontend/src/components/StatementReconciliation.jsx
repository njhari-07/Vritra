import React from 'react';

const FIELDS = [
  ['opening_balance', 'Brought forward'],
  ['debit_count', 'Debit count'],
  ['credit_count', 'Credit count'],
  ['total_debit', 'Total debits'],
  ['total_credit', 'Total credits'],
  ['closing_balance', 'Closing balance'],
];

export default function StatementReconciliation({ result, saved = false }) {
  if (!result) return null;
  const { page, printed, checks, arithmetic_matches: arithmeticMatches } = result;
  const mismatch = checks && Object.values(checks).some(check => !check.matches);
  const rows = saved ? 'Saved' : 'Extracted';
  return (
    <details className="statement-page-coverage statement-reconciliation" open={mismatch || !arithmeticMatches}>
      <summary>Statement summary · Page {page}{checks ? mismatch ? ' · Difference found' : ' · Counts and totals match' : ''}</summary>
      <p>{checks
        ? mismatch ? `${rows} transaction counts or totals differ from the printed summary.`
          : `${rows} transaction counts and totals match the printed summary.`
        : 'Preview every page to check extracted transaction counts and totals against this summary.'}</p>
      <p>{arithmeticMatches ? 'The printed opening balance, totals, and closing balance reconcile.'
        : 'The printed opening balance, totals, and closing balance do not reconcile.'}</p>
      <dl>
        {FIELDS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{printed[key]}</dd>
            {checks?.[key]?.matches === false && <dd>{rows} {checks[key].extracted}</dd>}
          </div>
        ))}
      </dl>
    </details>
  );
}
