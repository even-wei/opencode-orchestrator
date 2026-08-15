---
name: db-analyzer
description: Inspects database schemas, indexes, and queries using PostgreSQL MCP tools
---

# PostgreSQL Database Analyzer Skill

This skill enables the agent to interact with relational databases and analyze query plans via MCP tools.

## Guidelines

1. **Schema Discovery:**
   - Use the `postgres-mcp` tools to query `information_schema.tables` and foreign key relationships.
   - Summarize primary keys and missing foreign key indexes.

2. **Index Optimization:**
   - Check slow queries against `pg_stat_statements` or `EXPLAIN ANALYZE`.
   - Recommend composite B-tree or BRIN indexes for high-volume time-series columns.

3. **Safety Rules:**
   - Always run read-only queries with `SELECT`.
   - Never execute `DROP TABLE`, `TRUNCATE`, or `ALTER TABLE ... DROP COLUMN` without explicit user permission.
