Rebalanced synthetic exchange dataset

Purpose: model evaluation and data-quality testing only. All people, accounts, documents, transactions, and allegations are fictional.

Schema note: financial_wires.csv preserves the original column order and data types but corrects its duplicate Account headers to From Account and To Account. This is required to prevent standard CSV parsers from silently discarding one account field.

Label design: 16 positive and 16 negative transfers. Each positive transfer is paired with a negative transfer sharing the same date, amount, currency, and payment format. Every person-linked account appears in both classes. The intended signal is the simulated transfer-network pattern, not a protected characteristic, account name, time, amount, or payment format.

Limitations: this is still a small synthetic dataset and cannot prove real-world fairness, authenticity, or model performance. Use account-disjoint evaluation splits and validate on independently collected, properly governed data before any real-world use.
