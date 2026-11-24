import React from 'react';

export default function StatementPageCoverage({ pages, pageRange }) {
  if (!pages?.length) return null;
  const caption = !pageRange ? 'Pages read'
    : pageRange[0] === pageRange[1] ? `Selected page ${pageRange[0]}`
      : `Selected pages ${pageRange[0]}–${pageRange[1]}`;
  return (
    <details className="statement-page-coverage" open={pages.some(page => !page.accepted || page.rejected)}>
      <summary>{caption} · {pages.length} {pages.length === 1 ? 'page' : 'pages'} processed</summary>
      <ul>
        {pages.map(page => (
          <li key={page.page}>
            <strong>Page {page.page}</strong>
            <span>{page.accepted} valid · {page.rejected} rejected</span>
            {page.diagnostic && <span className="statement-page-diagnostic">{page.diagnostic}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
