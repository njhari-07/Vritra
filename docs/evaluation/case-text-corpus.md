# Case text for role extraction research

The corpus collects published documents that can support a case role with a
source passage. The task is to retrieve the passage and extract the role
attributed by its source. A case can have several organizers, a disputed
attribution, or insufficient evidence for a role. Proceeding outcomes and
individual roles are separate annotations.

| Collection | Full documents collected | Use in this iteration |
| --- | ---: | --- |
| Published court opinions and orders | 60 | Role findings, outcomes, and unlabeled review candidates |
| Agency reports or filings | 56 | Source-attributed claims, procedural statements, and narrative accounts |
| Corporate plea materials | 1 | Corporate admissions and an example without a required named leader |
| News reports | 5 | Contemporary reports of allegations, pleas, verdicts, and sentencing |
| Historical nonfiction | 3 | Retrospective author, editor, and investigative accounts |
| Public-domain fiction | 4 | Separate narrative extraction examples |

The curated source list includes fourteen failed downloads. The local manifest
records the reasons, including browser verification and a missing file.
All 129 collected documents have verified original and extracted-text
checksums. Documents about the same case share a case identifier.
The FBI's narrative accounts describe the conduct in ordinary prose.
The labels retain the source and distinguish the agency's account from
the court's own language. [Madoff case history](https://www.fbi.gov/history/cases-and-criminals/bernie-madoff),
[Stanford verdict report](https://archives.fbi.gov/archives/houston/press-releases/2012/allen-stanford-convicted-in-houston-for-orchestrating-7-billion-investment-fraud-scheme)

Seven Australian securities regulator reports extend the source coverage beyond
U.S. and Indian records. Related Johnston and Courtenay House records share
case groups across their respective source documents. The reports distinguish
findings, admissions, allegations, and a participant’s narrower role. [ASIC example](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2024-releases/24-193mr-former-courtenay-house-director-sentenced-to-11-years-imprisonment)

Secondary reporting remains a discovery lead. The
[Free Press Journal’s Malegaon reporting](https://www.freepressjournal.in/mumbai/malegaon-money-laundering-case-apmc-accounts-exploited-for-198-crore-cash-withdrawals)
points to agency allegations and account records to corroborate.
[Reuters’ Danske reporting](https://www.investing.com/news/stock-market-news/danske-bank-pleads-guilty-to-resolve-longrunning-estonia-moneylaundering-probe-2963460)
provides a cross-check against the collected corporate plea materials.
Keep these as article links until use rights and source coverage have
been reviewed.

The 2025 archive search screened 897 metadata rows. Twenty-five English-PDF
candidates matched the topic filter, and 24 were selected and fetched. Topic
mentions are discovery criteria. Before labeling a disposition, read the
court's reasoning and final order. The 2024 metadata scan added three documents.
The same filter had no matches in the available 2023 metadata, which is
a limitation of the description filter. Archive files are credited to the Supreme
Court of India and Dattam Labs. [Open data registry](https://registry.opendata.aws/indian-supreme-court-judgments/)

## Reproduce the curated collection

From the project root:

```bash
.venv/bin/python scripts/collect_case_text.py
.venv/bin/python scripts/prepare_case_roles.py
.venv/bin/python scripts/evaluate_case_role_retrieval.py
.venv/bin/python scripts/train_case_passage_ranker.py
.venv/bin/python scripts/evaluate_case_actor_attribution.py
.venv/bin/python scripts/train_case_actor_linker.py
.venv/bin/python scripts/evaluate_case_document_attribution.py
```

The collection command reports a nonzero exit status if any selected download
fails. Successful downloads and their metadata remain available. Use `--ids`
for selected documents. Full text and raw files are under
`data/private/case-corpus/`, which is excluded from Git. The manifests record
original and normalized SHA-256 values and page, paragraph, or line locators.
Use the separate archive manifest under `archive-2025/` for archive text.

For the 2025 discovery pass, use the annual metadata Parquet from the registry's
public S3 bucket. Install PyArrow in a separate environment or temporary package
directory. Run `discover_court_cases.py` with that metadata file and an explicit
`--output` JSON path. Pass the resulting path to the collector with `--sources`
and choose a separate `--output` directory for archive downloads.

## Labels and baseline

The seed set contains 42 source-anchored claims across 39 case groups.
Twenty-one cases are development material and eighteen are held out. Each
claim records the source's basis, a character span in the extracted unit,
and actor mentions where the source names an actor. Multiple actors can
share one role claim. These labels are curated seeds awaiting independent
review. Indian archive annotations use the court's operative text.
An acquittal in a connected appeal is scoped to those appellants. A bail
or procedural order does not determine the underlying allegations.

The within-document TF-IDF baseline retrieved the labeled unit first for
9 of 20 held-out claims and in the top five for 17 of 20. Generic spaCy
found ten of twelve annotated organizer mentions when given the annotated
unit. Six of those twelve were detected in their labeled units at top five.
These counts measure mention overlap.

| Held-out task | Labeled units | Keyword top 1 / top 5 | Learned top 1 / top 5 |
| --- | ---: | ---: | ---: |
| Role findings and rejected role enhancements | 11 | 4 / 9 | 4 / 9 |
| Dispositions and merits scope | 9 | 5 / 8 | 1 / 5 |
| Overall | 20 | 9 / 17 | 5 / 14 |

The offline passage ranker is logistic regression over lexical and position
features, trained on the 21 development cases. It sees 343 candidate units,
22 of which are annotated targets. Other pages are weak training negatives
because some may contain other valid evidence. The learned ranker remains an experiment outside the served
app. Scores do not establish who held a role or how useful a finding is
to human investigators.

## Organizer attribution

The challenge contains 45 source-anchored benchmark excerpts with 37
expected actor links across both splits, plus three excerpts for reviewing
extra predictions. It includes co-organizers, nearby unrelated people,
findings stated through pronouns or party titles, rejected enhancements, and
allegations reported in bail orders. A no-answer label means the selected
excerpt establishes no named organizer under the benchmark's criteria.
Agency accounts of sentencing retain their source basis. The annotations
still need independent review.

| Method given the evidence excerpt | Correct links | Incorrect links | Missed links | Exact actor sets | No-answer passages with a false link |
| --- | ---: | ---: | ---: | ---: | ---: |
| Link every spaCy PERSON mention | 13 | 11 | 4 | 10 / 23 | 8 / 9 |
| Link direct subjects of organizer clauses | 3 | 0 | 14 | 11 / 23 | 0 / 9 |
| Also recognize explicit appellate affirmance | 4 | 0 | 13 | 12 / 23 | 0 / 9 |
| Also resolve uniquely named party titles from preceding context | 4 | 0 | 13 | 12 / 23 | 0 / 9 |

The final row links one additional actor on the development split, where a
prior sentence names the petitioner. The held-out split has no corresponding
title-context example. The evaluation matches full names or an unambiguous
annotated surname and runs on hand-selected passages. Misses include
pronoun references, list-based naming, and surnames missed by spaCy.

The experimental actor linker supplements explicit clause matches with
logistic regression over dependency roles and nearby mentions. The model
trains on sentence-level annotations with a verified source anchor. A
reviewed sentence can label multiple organizers or have an empty actor set.
Other sentences in the excerpt are excluded from classifier training.
Twenty-three reviewed development sentences yielded fifteen positive and
seven negative candidates. A fixed score cutoff of 0.65 and scope rules control
which candidates pass. The candidate generator considers proper nouns in specific role-related
positions when spaCy misses a name. It also recognizes enumerated sentencing
lists when the number of explicit names matches the stated number of
leaders. Given the reference excerpt, it surfaced fifteen of seventeen
expected links and six unmatched candidates. The hybrid linker retained
twelve correct links and zero incorrect links in this exploratory sample.

## Full-document attribution

The evaluation starts with 20 full documents from held-out case groups.
Each ranker selects up to five pages or paragraphs. The clause rules and
hybrid linker process each selected unit without excerpt boundaries or
reference names. References are used for scoring. Candidate sentences
retain their original offsets and source URL for review.

| Ranker and linker | Expected actor links with source unit retrieved | Correct benchmark links | Incorrect benchmark links | Extra links verified | Extra links awaiting review |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Keyword and clause rules | 12 / 17 | 3 / 17 | 0 | 2 | 2 |
| Keyword and hybrid linker | 12 / 17 | 8 / 17 | 0 | 3 | 2 |
| Learned ranker and clause rules | 16 / 17 | 3 / 17 | 0 | 3 | 0 |
| Learned ranker and hybrid linker | 16 / 17 | 11 / 17 | 0 | 4 | 0 |

The four extra links in the final row came from three reviewed source
sentences. Two repeat the trial court’s finding within an appellate opinion
vacating the sentence. The report preserves that procedural basis. These
post-hoc reviews leave the benchmark denominators unchanged. Review also
identified a record citation mislabeled by spaCy as a person. The extractor
now removes numeric citation strings and retains original offsets for
verification.

Errors from this benchmark guided the list and court-finding patterns.
The Australian documents contributed one correct benchmark link in the
learned-ranker run.

## Fresh case-group evaluation

Eleven new documents were collected. Ten had an annotated excerpt for the
fresh evaluation. The remaining document, a sentencing account that names
the person in the paragraph following the role statement, awaits a
multi-paragraph reference. The evaluation uses one excerpt per case group,
with six expected named actor links and four no-answer excerpts. The
development data, retrieval scoring, and attribution rules were frozen
before source selection. The evaluator rejects cases that overlap with
either earlier benchmark, including previous holdouts. The report records
hashes for the model code and input labels.

| Ranker and linker | Expected links with evidence retrieved in top five | Correct links | Incorrect reviewed links |
| --- | ---: | ---: | ---: |
| Keyword and clause rules | 4 / 6 | 0 | 1 |
| Keyword and hybrid linker | 4 / 6 | 0 | 0 |
| Learned ranker and clause rules | 5 / 6 | 0 | 1 |
| Learned ranker and hybrid linker | 5 / 6 | 0 | 0 |

For the learned ranker and hybrid linker, one evidence paragraph fell
outside the top five. Four retrieved excerpts produced no matching person
candidate. The fifth produced a matching candidate that the filter removed.
The clause-rule false link came from a defendant’s proposed alternative
organizer in the same paragraph as the appeal court’s finding. Depending
on the source, the missed attributions used pronouns, differed from the
training phrasing, or named the organizer in an appositive. [Appellate
opinion](https://www.govinfo.gov/content/pkg/USCOURTS-ca5-16-20126/pdf/USCOURTS-ca5-16-20126-0.pdf),
[FBI sentencing report](https://archives.fbi.gov/archives/seattle/press-releases/2009/se082009.htm)

```bash
.venv/bin/python scripts/evaluate_case_document_attribution.py \
  --fresh-challenge docs/evaluation/case-actor-fresh-challenge.json
```

The table above records the pre-revision result. Subsequent changes to
the linker recovered four of six links on those same cases. Those cases
informed the changes, so that run is a regression comparison.

## Cross-paragraph sentencing reports

An optional evaluator mode links an anonymous role statement to a nearby
named sentencing subject when their prison terms agree and the search
returns a unique match. It emits the exact role and identity spans, with
the corroborating term when it appears in a third paragraph. The label
requires both the correct person and the annotated identity span.

On four archived reports, the learned ranker retrieved two of three
annotated role statements in its top five. Both links were recovered
with paragraph context, versus zero without it. The missing role
statement was outside the top five. The participant-only excerpt produced
no false link. The report also correctly linked a named leader in a
separately reviewed paragraph of that document. The examples guided
the matching logic, and coverage is limited to this reporting pattern.
[FBI sentencing report](https://archives.fbi.gov/archives/losangeles/press-releases/2009/la110309.htm)

```bash
.venv/bin/python scripts/evaluate_case_document_attribution.py \
  --fresh-challenge docs/evaluation/case-actor-paragraph-challenge.json \
  --paragraph-context
```

### Retrieval depth and transfer

Increasing the learned ranker's cutoff from five to eight on the four
development reports retrieved all three annotated role statements. The
linker still recovered two. In the remaining report, the nearby identity
sentence gives the person's name without repeating the prison term.
[Archived sentencing report](https://archives.fbi.gov/archives/losangeles/press-releases/2010/la082710-1.htm)

Five additional FBI archive reports were labeled and evaluated with the
existing model and rules. Three state the identity separately from the
role sentence, and two place it in the role sentence. The learned ranker
retrieved all five reference paragraphs in its top five. The linker
recovered zero of the five exact reference links. It did correctly link
one person to two other reviewed paragraphs in the same report. Those
additional spans describe an official's statement and an account of court
records, respectively. [Archived identity fraud report](https://archives.fbi.gov/archives/newark/press-releases/2014/leader-of-large-scale-identity-theft-ring-sentenced-to-12-years-in-prison-for-his-role-in-fraud-enterprise)

The new reports expose a limitation of corroborating identity with a
repeated prison term. Several name the person in a plea or sentencing
sentence without repeating the duration. The reports also use explicit
phrasing such as “for leading” that the linker did not resolve. The base
and audited runs are saved as `paragraph-transfer-baseline.json` and
`paragraph-transfer-audited.json` in the private corpus.

A subsequent linker revision accepts an explicit nearby restatement of
the named sentencing subject's role when the identity is unique and no
competing prison term is stated. The report retains the unnamed lead,
the identity sentence, and the restatement. On the four development
reports, the learned ranker and revised linker recovered all three
reference links at a cutoff of eight, up from two. On the five transfer
reports, recognition of explicit named sentencing formulations recovered
two of five at a cutoff of five, up from zero. The transfer cases informed
this revision and now serve as regression examples. The revised runs are
`paragraph-challenge-restatement-top8.json` and
`paragraph-transfer-restatement.json` in the private corpus.

### Frozen sentencing holdout

Six newly collected FBI archive reports form a holdout for the revised
linker. Five have a source-attributed organizer, and one only describes
a participant. The learned ranker retrieved four of the five reference
paragraphs at a cutoff of five. The linker recovered zero reference links
and proposed no names on these documents. Of the four retrieved positive
cases, two had no matching name candidate and two had a candidate that
did not pass the linker. The participant-only paragraph was retrieved
without an organizer prediction. The additional cases and rules were
kept separate for this run. The output is `sentencing-holdout-top5.json`.
[Named organizer report](https://archives.fbi.gov/archives/phoenix/press-releases/2010/px031510.htm)
[Participant report](https://archives.fbi.gov/archives/miami/press-releases/2009/mm022009.htm)

The anonymous-lead report spells the surname differently in the
restitution paragraph and the judge's sentencing paragraph. The
reference uses the latter and records that paragraph as identity
evidence. [Archived sentencing report](https://archives.fbi.gov/archives/cleveland/press-releases/2013/akron-man-sentenced-to-10-years-in-prison-for-leading-mortgage-fraud-scheme-that-resulted-in-36-million-loss)

The next revision links the named subject of a sentencing clause to a
scheme that the same clause says the subject led, operated, or
orchestrated. It ignores datelines for parsing and maps evidence back
to the original character offsets. On the same six reports, it recovered
four of five links at top five, up from zero. The only miss was the
anonymous-lead passage outside the top five. The participant-only
control still produced no prediction. The earlier paragraph and
transfer benchmarks remained at three of three and two of five,
respectively. The six reports guided this change and now serve as
regression cases. The revised output is
`sentencing-holdout-revised-top5.json`.

### Australian regulator holdout

Six ASIC reports were added. Five previously unused case groups had
clear paragraph-level targets for this test, including three
source-attributed operators and two aiding-and-abetting controls. The
sixth report remains in the corpus for later annotation. The linker
rules were unchanged for the holdout.

The learned ranker retrieved all three operator passages and both
control passages in its top five. The linker recovered zero of three
operator links and made no predictions in the two control reports.
Two operator passages did not produce a matching candidate. A
candidate on the third was filtered out. The missed passages describe
active or passive operation of a scheme outside the explicit
sentencing clause that the last revision addressed. The output is
`asic-holdout-top5.json`.
[Active attribution](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2021-releases/21-314mr-former-victorian-financial-adviser-sentenced-to-jail-for-obtaining-financial-advantage-by-deception)
[Passive attribution](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2017-releases/17-128mr-victorian-man-convicted-over-unlicensed-financial-services)
[Aiding-and-abetting control](https://www.asic.gov.au/about-asic/news-centre/find-a-media-release/2024-releases/24-183mr-former-bby-employee-sentenced-for-aiding-and-abetting)

The subsequent revision adds explicit active and passive operation clauses
to the paragraph-aware linker for agency reports. It requires a named
person syntactically attached to the operation and wrongdoing language in
the same sentence. It filters common allegation, negation, and conditional
markers. On the ASIC examples that guided the revision it recovered three
of three annotated links, up from zero, with no links in either control.
The sentence and paragraph transfer regressions remained at four of five
and two of five. The revised ASIC report is
`asic-operator-revised-top5.json`. These are regression results.

### Narrative sources

Four books were collected from Project Gutenberg's mirror. Their
normalized records preserve paragraphs and the corresponding original
plain-text line ranges. The original ebook files are retained with
their notices. [Project Gutenberg mirroring policy](https://www.gutenberg.org/help/mirroring.html)

The narrative annotations distinguish a retrospective author's attribution,
an editor's description of a prosecution, an investigator's account of an
alias, a defense witness, and statements made by a fictional character.
The Stoker and Hawkins
excerpts share a Tichborne episode ID for future train/test grouping.
These labels are stored in `case-narrative-role-seeds.json` and are
outside the real-case training and benchmark runs. The historical works
capture the viewpoint of the author or editor.
[Famous Impostors](https://www.gutenberg.org/ebooks/51391)
[Hawkins's Reminiscences](https://www.gutenberg.org/ebooks/10392)
[The Molly Maguires and the Detectives](https://www.gutenberg.org/ebooks/76641)
[Dyke Darrel the Railroad Detective](https://www.gutenberg.org/ebooks/5901)

Run `.venv/bin/python scripts/prepare_case_narratives.py` to build
`narrative-role-annotations.jsonl` in the private corpus. The export checks
the original and normalized hashes, validates every book paragraph against
its original line range, resolves the person and role spans, and rejects
splits that share a source or episode. It currently contains ten
development annotations in seven paragraphs across three episodes. The labels still need
independent review and have no held-out narrative sample.

### Narrative training transfer

The offline experiment trains the same logistic-regression passage ranker
with and without the seven annotated narrative paragraphs. Two contain a
labeled organizer. The others are weak negatives for organizer retrieval
because their annotations support other roles. The experiment uses only
annotated narrative paragraphs, with equal aggregate weight per episode.
The real-case development and evaluation partitions are fixed.

| Held-out task | References | Real-case training top 1 / top 5 / top 10 | With narratives top 1 / top 5 / top 10 |
| --- | ---: | ---: | ---: |
| Role evidence | 11 | 4 / 9 / 11 | 3 / 9 / 11 |
| Disposition evidence | 9 | 1 / 5 / 7 | 3 / 5 / 6 |

The narrative supplement did not increase role-evidence retrieval at top
five and reduced top-one retrieval by one passage. This experiment uses
three narrative episodes and evaluates evidence ranking. It does not
measure organizer-to-person linking or establish that narrative examples
will improve the deployed pipeline. The default ranker still trains on
real-case annotations.

Run `.venv/bin/python scripts/evaluate_narrative_ranker_transfer.py` to
reproduce `narrative-ranker-transfer.json` in the private corpus.

### Narrative actor transfer

The default candidate generator surfaced none of the four labeled
organizers. The experimental narrative cues surfaced three and retained
explicit name suffixes such as “junior.” The audit added two co-organizer
annotations and one estate-title annotation for a string incorrectly
tagged as a person. Only manually annotated candidates were used for
supplemental training. Three covered organizers and the estate-title
candidate yielded four additional examples.

On 23 previously used evaluation passages from real cases, adding these
four examples changed no passage scores. Both models linked 12 of 17
expected names with zero incorrect links. These are passage-level
results from a small transfer experiment. The default actor pipeline
uses its existing cues and training data.

Run the following to reproduce `narrative-actor-candidates.json` in the
private corpus.

```bash
.venv/bin/python scripts/evaluate_narrative_actor_candidates.py \
  --transfer-challenge docs/evaluation/case-actor-challenge.json
```

### News collection and holdout

Five Wikinews articles were downloaded at fixed revision IDs. The
manifest records their publication dates, source URLs, and reuse terms.
The importer extracts article paragraphs before the sources section.
The two Madoff articles cover arrest and plea, respectively, and share
the case ID of the existing FBI account. [Wikinews copyright policy](https://en.wikinews.org/wiki/Wikinews:Copyright)

The news holdout uses three other case groups. Its single positive
reference is the report of the judge's explicit attribution in the
WorldCom sentencing article. The Enron verdict and Livent sentencing
passages are controls. The selected passages identify outcomes without
explicitly attributing an organizer role. The learned ranker retrieved
all three passages in its top five. The linker missed the organizer
reference and made no predictions on either control. The news articles
were excluded from training for this run. [WorldCom sentencing](https://en.wikinews.org/w/index.php?title=Former_WorldCom_CEO_Ebbers_sentenced_to_25_years&oldid=4811018)
[Livent sentencing](https://en.wikinews.org/w/index.php?title=Canadian_theatre_producers_sentenced_for_fraud&oldid=4815532)

```bash
.venv/bin/python scripts/evaluate_case_document_attribution.py \
  --fresh-challenge docs/evaluation/case-actor-news-holdout.json \
  --paragraph-context --output data/private/case-corpus/news-holdout-top5.json
```

A follow-up rule recognizes explicit organizer language in direct quotes
attributed to a judge identified in the same article. The report records
the quote and the separately located text establishing the speaker's
judicial role. It abstains on ambiguous speaker surnames, explicitly
identified attorneys and witnesses, negated attributions, and quotes
without an offense or scheme reference. The revised run recovered the
WorldCom reference and produced no organizer prediction in the two
controls. This is a regression result because the WorldCom passage
informed the rule. The revised report is
`news-judicial-quote-revised-top5.json`.

### Same-case reports at different procedural stages

The Madoff regression checks three sources in one case group. Its
negative references are an arrest report's allegations, a defense
lawyer's quotation about industry leadership, and a plea report that
does not explicitly assign the organizer role in the selected passage.
The positive reference comes from the FBI's retrospective attribution.
The learned ranker retrieved all four references in the top five of
their respective documents. The linker returned the one expected name
from the retrospective and produced no candidates in either news
article. The report keeps each reference's basis, original offsets,
and publication date where available. The retrospective was previously
evaluated, so this run is a case regression.

```bash
.venv/bin/python scripts/evaluate_case_document_attribution.py \
  --regression-challenge docs/evaluation/case-actor-stage-regression.json \
  --paragraph-context --output data/private/case-corpus/procedural-stage-regression-top5.json
```

### Guilty-plea attribution transfer

The archived DOJ Valencia sentencing report adds one unused case group.
The existing learned ranker retrieved the agency's explicit operating statement
at rank one. The hybrid linker missed the surname attribution because it had
no candidate for “Valencia ran her scheme”. At top ten the pipeline also
retrieved the guilty-plea paragraph and correctly produced no organizer link
for that paragraph. This tests abstention on a plea without a stated organizer
role. The distinct two-sentence ASIC charge-summary pattern still needs an
independent positive example. Three newer DOJ releases were identified but
their downloads returned browser verification pages.

Fixture: `case-actor-plea-transfer.json`. Private reports:
`plea-transfer-top5.json` and `plea-transfer-top10.json`.
[DOJ Valencia sentencing release](https://www.justice.gov/archive/usao/cac/Pressroom/pr2011/153.html)

The follow-up regression continues to retrieve the operating statement at
rank one. It links Valencia's full name using the earlier admission and a
named sentencing paragraph corroborating the prison term. The output carries
all three source spans. The guilty-plea paragraph still produces no link.
All 220 source-by-method rows in the previous pooled regression were unchanged.
The Valencia report guided this rule, so transfer remains unmeasured.
Private report: `possessive-scheme-regression-top10.json`.

### Pooled document regression

From the repository root with the local corpus and model dependencies installed:

```bash
.venv/bin/python scripts/evaluate_case_document_attribution.py \
  --paragraph-context --top-k 10 \
  --pooled-regression docs/evaluation/case-actor-{agency-pleas-holdout,asic-holdout,fresh-challenge,news-holdout,paragraph-challenge,paragraph-transfer,plea-transfer,sentencing-holdout,stage-regression}.json \
  --output data/private/case-corpus/pooled-regression-agency-pleas-top10.json
```

The command includes the base challenge's evaluation excerpts, deduplicates
identical annotations, and rejects conflicting annotations and cases shared
with training. The report records fixture hashes and counts misses by
retrieval, candidate generation, and filtering. The earlier learned ranker
and hybrid linker recovered 29 of 41 curated links with 37 retrieved in the
top five. Four misses came from retrieval, five from candidate generation,
and three from filtering. That run includes previously reviewed
cases and the Valencia regression.

At top ten the learned ranker retrieved evidence for all 41 expected links.
The hybrid recovered the Abrams link and missed the other three newly
retrieved links. Reviewing the two additional Kent candidates showed that
one restated a prior district court finding and the other was conditional
appellate discussion. The hybrid now filters the conditional statement.
The audited run recorded 30 correct links, seven candidate-generation
misses, and four filtering misses. The rules-only baseline still emits
the conditional candidate as a reviewed false positive.
Private report: `pooled-regression-audited-top10.json`.

### PDF footnotes and agency role statements

For court pages, the linker removes an inline footnote number before NLP
when the page also contains that footnote's label. Output offsets still
refer to the original extracted text. This separated the direct role
finding in Kent from the following sentence and recovered one link.
The 56-document regression reached 31 of 41 expected links.
Private report `pooled-regression-footnote-top10.json`.

Three FBI archive reports supplied independent examples of direct pleas
and a reported court finding. The initial run retrieved all three support
passages and recovered none of their expected links. After adding rules
for these constructions, the hybrid linked all three in the pooled
regression. The full top-ten regression reached 34 of 44 expected links
with 10 missed and zero incorrect links in reviewed excerpts. This is a
regression result because these reports guided the new rules.
Private reports `agency-pleas-holdout-top10.json` and
`pooled-regression-agency-pleas-top10.json`.
[Pettibone report](https://archives.fbi.gov/archives/washingtondc/press-releases/2012/former-alexandria-businessman-pleads-guilty-to-1.5-million-ponzi-scheme-and-sentenced-to-36-months)
[Heckmann report](https://archives.fbi.gov/archives/honolulu/press-releases/2013/peter-heckmann-pleads-guilty-to-operating-ponzi-scheme)
[Hawkins report](https://archives.fbi.gov/archives/houston/press-releases/2010/ho120110.htm)

### Review candidates in a new local document

```bash
.venv/bin/python scripts/predict_case_document.py /path/to/document.txt \
  --source-kind agency_report
```

Accepts UTF-8 text split by blank lines or corpus-style JSONL with a
`text` field and an increasing `page`, `paragraph`, or `line` locator.
Choose `judgment`, `agency_report`, or `news` to match the actual source.
The command fits the models locally from the development data and uses
the same prediction code as the document evaluator. It outputs the source
checksum, ranked locators, and evidence excerpts with offsets into the
corresponding text units. Cross-passage matches include supporting spans.
Every candidate starts with an unreviewed status. This entry point is a
local research command. It has no connection to the case workspace.
