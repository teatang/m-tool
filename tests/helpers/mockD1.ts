/**
 * ============================================================================
 * 基于 sql.js (WASM SQLite3) 的高保真 Cloudflare D1 内存测试适配器
 * 说明：
 * 1. 直接读取并执行项目真实迁移文件 `migrations/0001_init.sql`，确保表结构、索引、约束与线上完全一致；
 * 2. 支持 `prepare().bind().first() / all() / run() / raw()` 与事务级 `batch()`；
 * 3. 可将查询出来的 BLOB 转换为 `number[]`，精准模拟 Cloudflare D1 运行时返回值形态。
 * ============================================================================
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';

let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;

function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs();
  }
  return sqlJsPromise;
}

/**
 * 将入参规范化为 sql.js 可接受的绑定值
 */
function normalizeBindValue(val: unknown): SqlValue {
  if (val === undefined || val === null) {
    return null;
  }
  if (val instanceof Uint8Array) {
    return val;
  }
  if (val instanceof ArrayBuffer) {
    return new Uint8Array(val);
  }
  if (ArrayBuffer.isView(val)) {
    return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
  }
  if (typeof val === 'boolean') {
    return val ? 1 : 0;
  }
  return val as SqlValue;
}

/**
 * 将 SQLite 返回行中的 Uint8Array BLOB 模拟转换为 Cloudflare D1 实际的 `number[]` 格式
 */
function convertRowBlobsToD1Style(row: Record<string, SqlValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Uint8Array) {
      out[k] = Array.from(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private readonly db: Database;
  private readonly query: string;
  private params: SqlValue[] = [];

  constructor(db: Database, query: string, params: SqlValue[] = []) {
    this.db = db;
    this.query = query;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MockD1PreparedStatement(
      this.db,
      this.query,
      values.map((v) => normalizeBindValue(v)),
    );
  }

  private executeRows(): Record<string, unknown>[] {
    const stmt = this.db.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        const obj = stmt.getAsObject();
        rows.push(convertRowBlobsToD1Style(obj));
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const rows = this.executeRows();
    if (rows.length === 0) {
      return null;
    }
    const firstRow = rows[0];
    if (typeof colName === 'string') {
      return (firstRow[colName] ?? null) as T | null;
    }
    return firstRow as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = performance.now();
    const rows = this.executeRows();
    const duration = performance.now() - start;
    return {
      success: true,
      results: rows as T[],
      meta: {
        duration,
        size_after: 0,
        rows_read: rows.length,
        rows_written: this.db.getRowsModified(),
        last_row_id: 0,
        changed_db: this.db.getRowsModified() > 0,
        changes: this.db.getRowsModified(),
      },
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.run<T>();
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<any> {
    const stmt = this.db.prepare(this.query);
    try {
      if (this.params.length > 0) {
        stmt.bind(this.params);
      }
      const cols = stmt.getColumnNames();
      const rows: unknown[][] = [];
      while (stmt.step()) {
        rows.push(stmt.get() as unknown[]);
      }
      if (options?.columnNames) {
        return [cols, ...rows] as [string[], ...T[]];
      }
      return rows as T[];
    } finally {
      stmt.free();
    }
  }
}

/**
 * 创建并初始化已执行 `migrations/0001_init.sql` 的内存 D1Database 实例
 */
export async function createMockD1Database(): Promise<D1Database> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  // 执行真实 SQL 迁移脚本初始化数据表与索引
  const migrationSql = readFileSync(
    resolve(process.cwd(), 'migrations/0001_init.sql'),
    'utf-8',
  );
  db.exec(migrationSql);

  const mockD1: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return new MockD1PreparedStatement(db, query);
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      db.exec('BEGIN TRANSACTION');
      try {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
          results.push(await stmt.run<T>());
        }
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async exec(query: string): Promise<D1ExecResult> {
      const start = performance.now();
      db.exec(query);
      return {
        count: 1,
        duration: performance.now() - start,
      };
    },

    withSession(): D1DatabaseSession {
      throw new Error('MockD1 does not implement withSession');
    },

    async dump(): Promise<ArrayBuffer> {
      const bytes = db.export();
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
  };

  return mockD1;
}
