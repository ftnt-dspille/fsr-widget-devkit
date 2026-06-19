# FortiSOAR Query API: Aggregation and Filter Options

**Purpose:** Working notes for a future coding agent that needs to build better FortiSOAR `/api/query/{model}` requests, especially aggregation queries where the public guide is thin.

**Primary sources reviewed**

- `FortiSOAR-7.6.5-API_Guide.pdf`, Query API Reference pages 113-124.
- `FilterQueryBuilder.php`, especially filter parsing, aggregate expression generation, association aliasing, computed fields, and operator handling.
- `AggregateDataProvider.php`, especially the two-phase aggregate query flow.

## 1. Canonical query body shape

```json
{
  "logic": "AND",
  "filters": [],
  "sort": [
    {"field": "createDate", "direction": "DESC"}
  ],
  "aggregates": [
    {"operator": "groupby", "field": "status.itemValue", "alias": "status"},
    {"operator": "countdistinct", "field": "*", "alias": "total"}
  ],
  "limit": 30
}
```

Use `POST /api/query/{model}` for ad hoc query bodies. `$limit` can also be passed as a query parameter, and the provider reads request `$limit` when setting page size.

## 2. Filters

A filter is normally `{field, operator, value}`. The API guide states that fields can be root module fields or associated fields using dot notation or double-underscore notation, for example `status.itemValue`, `assignedToPerson.email`, or `status__itemValue`. The source converts double underscores to dots before resolving the field path.

| Operator | Publicly documented | Implementation notes for agents |
|---|---:|---|
| `eq` | Yes | Exact equality. For association values passed as `/api/...`, the UUID is extracted before comparison. |
| `neq` | Yes | Exact inequality. |
| `lt`, `lte`, `gt`, `gte` | Yes | Numeric/date comparisons. If `type` is `datetime` and value is numeric, code converts epoch to timestamp. |
| `in` | Yes | Accepts either an array or a pipe-delimited string. Strings are lowercased before comparison; association IRIs are converted to UUIDs. |
| `nin` | Yes | Same input behavior as `in`, but the generated expression is `NOT IN (...) OR field IS NULL`. |
| `like` | Yes | Value is lowercased; SQL wildcards `%` and `_` are expected. Non-JSON fields compare against `TEXT_LOWER(field)`. |
| `notlike` | Yes | Non-JSON fields only in the code path reviewed. |
| `contains` | Yes | JSON/object containment via `jsonContains`. Intended for object/json fields. |
| `isnull` | Yes | Boolean `true` means `IS NULL`; `false` means `IS NOT NULL`. |
| `exists` | No / unclear | Implemented as `jsonExists`; useful for JSON path/key existence checks, but not listed in the guide table. |

Nested filters are supported using `logic` plus nested `filters`, for example `A AND (B OR C)`. Use `logic: "AND"` or `logic: "OR"` at each level.

## 3. Sorting

Sort objects use `{field, direction}`. The guide documents `ASC` and `DESC`. Implementation resolves field aliases and can sort on aliases that have already been added by aggregate expressions, but sorting related fields may be skipped in some aggregate paths.

## 4. Aggregation operators

The guide states that `aggregates` is a list of `{operator, field, alias}` objects. The source supports the following operator mappings:

| Operator | DQL expression behavior | Notes |
|---|---|---|
| `fields` | Select field alias | Behaves like selecting raw fields; does not make the query an aggregate query by itself. |
| `select` | Select field alias | Same classification behavior as `fields`. |
| `count` | `COUNT(field)` | Use `field: "*"` carefully; internally `*` maps to the root alias. |
| `countdistinct` | `COUNT(DISTINCT field)` | Commonly shown with `field: "*"` for count by group. |
| `groupby` | Selects field and adds `GROUP BY field` | Must be paired with a metric such as count, avg, max, etc. |
| `sum` | `SUM(field)` | Numeric fields only. |
| `max` | `MAX(field)` | Numeric/date-like fields depending on database mapping. |
| `min` | `MIN(field)` | Numeric/date-like fields depending on database mapping. |
| `avg` | `AVG(field)` | Supports a computed comma-field pattern; see below. |
| `median` | `percentile_cont(0.5) within group (order by field)` | Implemented, but not explained in the guide beyond listing the operator. |
| `distinct` | Listed, but effectively no expression in reviewed source | Treat as suspect unless verified in the target instance. |

## 5. Common aggregation patterns

### Count records by picklist/status

```json
{
  "logic": "AND",
  "filters": [],
  "aggregates": [
    {"operator": "groupby", "field": "status.itemValue", "alias": "status"},
    {"operator": "countdistinct", "field": "*", "alias": "total"}
  ]
}
```

### Count related records linked to a parent

```json
{
  "logic": "AND",
  "filters": [
    {"field": "alerts.uuid", "operator": "eq", "value": "db7afbf7-56c8-4706-87b9-9a8ce2332d05"}
  ],
  "aggregates": [
    {"operator": "groupby", "field": "status.itemValue", "alias": "status"},
    {"operator": "countdistinct", "field": "*", "alias": "total"}
  ]
}
```

### Average duration between two date fields

The guide shows comma-separated fields such as `resolveddate,createDate`. In the source, comma-separated fields are treated as a computed expression. Default behavior subtracts the second field from the first. If `fieldOperator` is set to `sum`, commas are converted to addition instead.

```json
{
  "logic": "AND",
  "filters": [
    {"field": "resolveddate", "operator": "gte", "type": "primitive", "value": "2022-04-22T09:39:39.358Z"},
    {"field": "resolveddate", "operator": "lte", "type": "primitive", "value": "2022-05-22T09:39:39.358Z"}
  ],
  "aggregates": [
    {"operator": "avg", "field": "resolveddate,createDate", "alias": "avgResolveTime"}
  ]
}
```

## 6. Things possible but unclear or not well mentioned in the guide

1. **Aggregation uses a two-phase query in the provider.** Filters are first applied to a UUID-only subquery, then the aggregate query is constrained to `uuid IN (subquery)`. This means the aggregation result should respect filters and authorization/ownership scope, but query shape and pagination can matter.
2. **`select` and `fields` are not considered aggregate operators for aggregate-query detection.** If an `aggregates` list contains only `select`/`fields`, the source treats it differently from real aggregate queries.
3. **`distinct` is listed but appears incomplete in the reviewed implementation.** The switch case for `distinct` does not assign an aggregate expression. Avoid relying on it without testing.
4. **Computed aggregate fields are more capable than the guide explains.** A comma-separated field can represent a computed expression. Default operator is subtraction; `fieldOperator: "sum"` switches the computation to addition.
5. **`median` is implemented as a percentile expression.** The guide lists `median`, but the implementation clarifies that it maps to `percentile_cont(0.5) within group`.
6. **`exists` appears to be an undocumented JSON operator.** It maps to JSON existence logic and may be useful for extended/object fields.
7. **`in` and `nin` accept pipe-delimited values as well as arrays.** This is useful for simple clients, but arrays are clearer and safer.
8. **Case handling is not uniform across all operators.** `like`, `in`, and `nin` lower-case string values; `eq` does not appear to lower-case plain string values.
9. **Association IRI values are normalized to UUIDs.** For association filters, values like `/api/3/users/{uuid}` are reduced to `{uuid}`.
10. **Alias is practically important.** The guide says `alias` controls the returned field name. Source code also reads `alias` directly in some paths, so agents should always include it.
11. **`__selectFields` and `__ignoreFields` are documented for query responses, not aggregation shaping.** They are useful for normal query/export payload trimming but should not be confused with aggregate `fields`/`select` operators.
12. **Sorting with aggregation needs testing per model.** Sort is stripped from the filter subquery in the aggregate provider, while the aggregate builder can still process sort in the aggregate query. Related-field sorting is an area to verify.
13. **Pagination/limit can affect aggregate provider execution.** The provider applies first-result and max-results to both the filter subquery and aggregate query builder. For full-population aggregates, test whether `$limit` changes results in the target version.

## 7. Agent build guidance

- Prefer explicit `logic`, `filters`, and `aggregates` keys even when empty.
- Always include `alias` on every aggregate object.
- Use dot notation for relationships in generated requests. Double-underscore works but dot notation aligns with the guide.
- For counts by bucket, use `groupby` + `countdistinct` with `field: "*"`.
- For date/numeric metrics, use `avg`, `min`, `max`, `sum`, or `median` against a concrete field.
- Treat `distinct`, computed comma fields, `fieldOperator`, and `exists` as advanced features that require instance-level smoke tests.
- Build a small verification harness that logs request body, HTTP status, `hydra:member` shape, and first result row for each generated query.

## 8. Suggested smoke-test matrix

| Test | Query feature | Expected validation |
|---|---|---|
| Count all | `countdistinct` on `*` | Single total row. |
| Count by status | `groupby` + `countdistinct` | One row per status bucket. |
| Association filter | `assignedToUser.email` or related UUID | Results constrained to association. |
| JSON contains | `contains` on object field | Only records whose object contains requested key/value. |
| JSON exists | `exists` on object path | Verify operator works or fails cleanly. |
| Date range + avg duration | `gte`/`lte` + `avg` comma-field | Numeric/interval output matches manual sample. |
| Median | `median` on numeric/date duration field | Query succeeds and returns median-like value. |
| Distinct | `distinct` | Confirm whether unsupported/broken in target build. |
| Pagination sensitivity | Same aggregate with and without `$limit` | Confirm whether totals change. |

## 9. Source anchors used

- API guide pages 114-118: filter object shape, operators, nested logic, and sort.
- API guide pages 118-124: aggregation, associations, model type, `__selectFields`, and `__ignoreFields`.
- `FilterQueryBuilder.php` lines 130-140: aggregate-query detection excludes `select` and `fields`.
- `FilterQueryBuilder.php` lines 317-368: aggregate expression switch and alias behavior.
- `FilterQueryBuilder.php` lines 625-742: filter operator handling.
- `FilterQueryBuilder.php` lines 819-866 and 889-892: alias resolution, computed comma fields, and double-underscore conversion.
- `AggregateDataProvider.php` lines 40-68 and 88-107: `$limit`, filter subquery, and two-phase aggregate execution.
