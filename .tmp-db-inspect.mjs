import { config } from "dotenv";
import pg from "pg";

config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const rows = await client.query(
  'select id, username, role, "tenantId" from "AdminUser" order by "createdAt"',
);
console.log("rows:", rows.rows);

const cols = await client.query(
  `select column_name, data_type, udt_name from information_schema.columns where table_name = 'AdminUser' order by ordinal_position`,
);
console.log("columns:", cols.rows);

const types = await client.query(
  `select t.typname from pg_type t where t.typname = 'AdminRole'`,
);
console.log("enum AdminRole exists:", types.rows.length > 0);

await client.end();
