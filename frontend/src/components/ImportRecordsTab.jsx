import React from 'react';

/**
 * ImportRecordsTab — legacy upload form for direct file ingestion.
 * Accepts IBM CSV, narrative JSON, CDR CSV, case-history CSV, and VRITRA PDF v1.
 */
export default function ImportRecordsTab({ casesList, activeCase, busy, onUpload }) {
  return (
    <section className="panel import-panel">
      <h2>Add evidence to a case</h2>
      <p>Prototype intake accepts synthetic records only. Maximum file size: 25 MiB.</p>
      <form onSubmit={onUpload}>
        <label>
          Authorized case
          <select name="case" defaultValue={activeCase}>
            {casesList.map(c => (
              <option key={c.case_id} value={c.case_id}>
                {c.case_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Record format
          <select name="kind">
            <option value="ibm">IBM HI-Small CSV</option>
            <option value="narrative">Synthetic narrative JSON</option>
            <option value="cdr">Synthetic CDR CSV</option>
            <option value="history">Synthetic case-history CSV</option>
            <option value="pdf">VRITRA fixed-layout PDF v1</option>
          </select>
        </label>
        <label>
          Source file
          <input name="file" type="file" accept=".csv,.json,.pdf" required />
        </label>
        <button disabled={busy}>Validate and import →</button>
      </form>
    </section>
  );
}
