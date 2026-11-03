# COVID-19 Data Science Agent Demo data

Curated country-week panel for the demo question: how the reported COVID-19 epidemic evolved across countries, and how vaccination coverage relates to reported severity.

## Files

- `covid19_country_weekly_2020-01-01_2023-12-31.csv` — 49,210 rows, 21 columns; one record per ISO-3 country or territory and week.
- `metadata.json` — source and prepared-file SHA-256 hashes, retrieval date, date range, and transformation details.

## Source and preparation

Downloaded on 2026-11-03 from the public [Our World in Data COVID-19 dataset](https://github.com/owid/covid-19-data/blob/master/public/data/README.md), specifically its [complete CSV](https://raw.githubusercontent.com/owid/covid-19-data/master/public/data/owid-covid-data.csv). The source README says the GitHub-hosted data stopped updating on 2024-08-19. This prepared file is limited to 2020-01-01 through 2023-12-31 so the analysis period overlaps the historic vaccination rollout. The source file hash is recorded in `metadata.json`.

Rows are aggregated to Monday-start epidemiological weeks. Case and death rates are weekly means of the source's available seven-day-smoothed per-million values. Vaccination, hospitalization, excess mortality, and country covariates use the last non-missing source value in each week. Missing values are not carried forward. Aggregate regions without ISO-3 country codes and rows without a continent are excluded. See `metadata.json` for exact checksums and transformation details.

## Columns

- `iso_code`, `continent`, `location`: country or territory identifiers.
- `week_start`, `week_end`: epidemiological week boundaries.
- `new_cases_smoothed_per_million`, `new_deaths_smoothed_per_million`: weekly means of source seven-day-smoothed rates.
- `cases_observation_days`, `deaths_observation_days`: number of daily source observations contributing to each mean.
- `people_vaccinated_per_hundred`, `people_fully_vaccinated_per_hundred`, `total_boosters_per_hundred`: vaccination coverage values; `vaccination_observation_date` identifies the latest source vaccination observation in that week.
- `weekly_hosp_admissions_per_million`, `excess_mortality_cumulative_per_million`: optional severity measures with more limited country/time coverage.
- `population`, `median_age`, `aged_65_older`, `gdp_per_capita`, `hospital_beds_per_thousand`, `human_development_index`: country-level context variables.

## Interpretation

This is aggregate, observational data. Country-level associations do not establish individual vaccine effectiveness or causality. Case detection, definitions, testing, reporting cadence, and retrospective revisions differ across countries; reported deaths also do not capture all COVID-attributable mortality. Hospital and excess-mortality coverage is incomplete. The analysis should show coverage and missingness, use explicit vaccine-to-outcome lags, and state that ecological and time-varying confounding remain.

OWID's dataset is published under CC BY, with some third-party source data subject to their original terms. Credit Our World in Data and consult the source documentation before redistributing or publishing analyses.
