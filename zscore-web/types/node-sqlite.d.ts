// types/node-sqlite.d.ts
// @types/node@20 尚未收录 node:sqlite（Node 22.5+ 内置模块）的类型声明。
// 这里按 Node 官方文档补一份最小可用声明，仅覆盖本项目实际用到的 API。
// 待 @types/node 升级到 22+ 后可删除本文件。

declare module "node:sqlite" {
  export type SQLInputValue =
    | null
    | number
    | bigint
    | string
    | Uint8Array;

  export type SQLOutputValue =
    | null
    | number
    | bigint
    | string
    | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[];
    get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    run(...params: SQLInputValue[]): StatementResultingChanges;
    iterate(...params: SQLInputValue[]): IterableIterator<Record<string, SQLOutputValue>>;
    expandedSQL: string;
    sourceSQL: string;
    setAllowBareNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    close(): void;
    open(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    isOpen: boolean;
    isTransaction: boolean;
  }
}
